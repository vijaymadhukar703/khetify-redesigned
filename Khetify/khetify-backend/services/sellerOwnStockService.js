const mongoose = require("mongoose");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const LotNumber = require("../model/Inventory/LotNumber");
const Product = require("../model/Company/productModel");
const { emitInventoryUpdate } = require("./inventoryService");
const { withTransaction } = require("./txn");
const { assertSellerWarehouse } = require("./warehouseOwnershipService");

/**
 * SELLER'S OWN OPENING STOCK — "My Products" → Add Stock.
 *
 * WHY A SEPARATE SERVICE. lotService.receiveLot() is the company lot flow: it
 * hardcodes `ownerType: "company"` on every read and write (the composed-number
 * clash probe, the weighted-average read, both upserts and the capacity guard),
 * mints Khetify lot numbers out of the COMPANY code, claims box IDs, and mints
 * unit labels. None of that is correct for a seller stocking in goods they
 * already own, and editing receiveLot would put the company lot lifecycle at
 * risk. So this is a deliberately SMALL sibling of it — same collections, same
 * field names, same ledger shape — that only ever writes seller-owned rows.
 *
 * WHAT IT WRITES (identical shape to receiveLot, so every existing reader —
 * getLots, the trace pages, the reports — reads this data correctly):
 *   1. Inventory  — upsert on the lot identity (productId, ownerType "seller",
 *                   ownerId = sellerId, warehouseId, batchNumber), with
 *                   `batchNumber` SHADOWED to equal `lotNumber` exactly as
 *                   receiveLot does (it is the lot IDENTITY key in the unique
 *                   index, not a free-text manufacturer batch), and the
 *                   write-once original-lot register set via $setOnInsert.
 *   2. LotNumber  — one registry row per issued number, so a number can never be
 *                   handed out twice for two different products.
 *   3. StockMovement — one `supply_in` ledger row. There is no "opening_stock"
 *                   movement type and the enum is deliberately NOT extended:
 *                   `supply_in` is the existing "goods came onto the books"
 *                   type that every report, trace and analytics reader already
 *                   understands. The note says where it came from.
 */

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/* ---------- lot numbering ---------- */

// A seller's own opening stock carries no company code and no per-company
// serial, so it gets its own unmistakable shape: MYP-<6 uppercase chars>.
// "MYP" = My Products, which is what the seller sees on screen.
const LOT_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const LOT_RANDOM_LEN = 6;
const LOT_GENERATE_RETRIES = 5;

function randomLotNumber() {
  let out = "";
  for (let i = 0; i < LOT_RANDOM_LEN; i += 1) {
    out += LOT_ALPHABET[Math.floor(Math.random() * LOT_ALPHABET.length)];
  }
  return `MYP-${out}`;
}

/**
 * Mint a lot number that is free for this seller. The registry's unique index
 * is the real guarantee (see the claim in the write path below); this pre-check
 * just keeps the common case from burning a retry there.
 */
async function generateLotNumber(sellerId, session) {
  for (let attempt = 0; attempt < LOT_GENERATE_RETRIES; attempt += 1) {
    const candidate = randomLotNumber();
    const taken = await LotNumber.findOne({ companyId: sellerId, lotNumber: candidate })
      .select("_id")
      .session(session || null);
    if (!taken) return candidate;
  }
  throw httpErr("Could not generate a unique lot number. Please try again.", 500);
}

/**
 * Claim `lotNumber` in the registry for this seller.
 *
 * NOTE ON `companyId`: LotNumber is keyed by (companyId, lotNumber) and that
 * field is the OWNER of the number, which for a seller's own stock is the
 * seller. Storing sellerId there keeps a seller's numbering namespace separate
 * from every company's — a company can never collide with a seller, and vice
 * versa — using the collection's existing unique index rather than a new one.
 * Mirrors lotNumberService.registerLotNumber, minus the company-only serial.
 */
async function claimLotNumber({ sellerId, productId, lotNumber, source, session }) {
  try {
    await LotNumber.updateOne(
      { companyId: sellerId, lotNumber },
      { $setOnInsert: { companyId: sellerId, lotNumber, productId, source, serial: null } },
      { upsert: true, session: session || undefined }
    );
  } catch (err) {
    // A concurrent claim inserted first — not an error by itself; the ownership
    // check below decides whether this caller may use the number.
    if (err?.code !== 11000) throw err;
  }

  const row = await LotNumber.findOne({ companyId: sellerId, lotNumber })
    .select("productId")
    .session(session || null);
  // Re-stocking the SAME lot of the SAME product is legitimate (one lot, topped
  // up). The same number against a DIFFERENT product is the duplicate we refuse.
  if (row && String(row.productId) !== String(productId)) {
    throw httpErr(`Lot number ${lotNumber} is already used by another product.`, 409);
  }
}

/* ---------- ledger ---------- */

// Same writer shape lotService uses, so the two produce indistinguishable rows.
async function ledger(inv, { type, quantity, refType, refId, performedBy, note, session }) {
  await StockMovement.create(
    [
      {
        inventoryId: inv._id,
        productId: inv.productId,
        ownerType: inv.ownerType,
        ownerId: inv.ownerId,
        type,
        channel: "internal",
        quantity,
        balanceAfter: inv.availableStock,
        refType,
        refId,
        performedBy,
        note,
      },
    ],
    session ? { session } : {}
  );
}

/* ---------- shelf life ---------- */

/**
 * Whole-days shelf life off the product, from the structured `shelfLifeDays`
 * first and the legacy human string ("365 Days", "24 Months") only as a
 * fallback, so pre-existing products still derive an expiry. Returns null when
 * the product carries no usable shelf life.
 */
function shelfLifeDays(product) {
  const n = Number(product?.shelfLifeDays);
  if (Number.isFinite(n) && n > 0) return Math.round(n);

  const raw = String(product?.shelfLife || "").trim();
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(day|week|month|year)s?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const perUnit = { day: 1, week: 7, month: 30, year: 365 }[match[2].toLowerCase()];
  return Math.round(value * perUnit);
}

/* ---------- add stock ---------- */

/**
 * Stock in a quantity of the seller's OWN product (their existing/old stock).
 *
 * Every write is seller-owned: Inventory.ownerType "seller" / ownerId =
 * sellerId, and the product itself must be one of this seller's own
 * (Product.ownerType "seller" + sellerId), never a company product — company
 * goods reach a seller through the supply flow, which is untouched.
 *
 * Returns the Inventory row.
 */
async function addSellerOwnStock({
  sellerId,
  productId,
  warehouseId,
  lotNumber,
  variantSku = null,
  mfgDate = null,
  expiryDate = null,
  qty,
  lowStockThreshold,
  performedBy,
} = {}) {
  if (!sellerId) throw httpErr("A seller is required", 400);
  if (!productId || !mongoose.isValidObjectId(String(productId))) {
    throw httpErr("A valid product is required", 400);
  }
  const quantity = Number(qty);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw httpErr("Quantity must be greater than zero", 400);
  }
  if (!warehouseId) throw httpErr("A warehouse is required", 400);

  // OWNERSHIP GUARD 1 — the product. Both halves, always: `sellerId` alone would
  // let a company product with a coincidental value through, and `ownerType`
  // alone is not scoped to anyone.
  const product = await Product.findOne({
    _id: productId,
    ownerType: "seller",
    sellerId,
  })
    .select("productName shelfLife shelfLifeDays variants")
    .lean();
  if (!product) throw httpErr("Product not found in My Products", 404);

  // ── WHICH VARIANT ────────────────────────────────────────────────────────
  // A multi-variant product's Red and Yellow are different physical stock, so
  // the row has to say which one it is. Enforced HERE rather than in the
  // controller so every caller of this service gets the same guarantee (the
  // product — and therefore its variant list — is already loaded above).
  const productVariants = Array.isArray(product.variants) ? product.variants : [];
  const variant = String(variantSku || "").trim();
  let variantKey = null;
  if (productVariants.length) {
    if (!variant) throw httpErr("Select which variant this stock is for", 400);
    // The value must be one this product actually offers — otherwise a typo
    // would quietly open a third, phantom variant row.
    const match = productVariants.find(
      (v) => String(v.sku || "").trim() === variant || String(v.label || "").trim() === variant
    );
    if (!match) throw httpErr(`"${variant}" is not a variant of this product`, 400);
    // Store the SKU when there is one, else the label — the same value the
    // form's dropdown submits, so the row and the picker always agree.
    variantKey = String(match.sku || match.label || "").trim() || null;
  } else if (variant) {
    // A variant sent for a single-variant product is a client bug, not a
    // silent no-op.
    throw httpErr("This product has no variants", 400);
  }

  // OWNERSHIP GUARD 2 — the warehouse must belong to THIS seller, so stock can
  // never be stocked into a company warehouse or another seller's. Throws 403.
  await assertSellerWarehouse(sellerId, warehouseId);

  const mfg = mfgDate ? new Date(mfgDate) : null;
  if (mfg && Number.isNaN(mfg.getTime())) throw httpErr("Invalid manufacturing date", 400);

  let expiry = expiryDate ? new Date(expiryDate) : null;
  if (expiry && Number.isNaN(expiry.getTime())) throw httpErr("Invalid expiry date", 400);
  // No expiry given but the product declares a shelf life → derive it from the
  // manufacturing date, so an expiry-aware view (FEFO, expiring/expired filters)
  // still has something to work with.
  if (!expiry && mfg) {
    const days = shelfLifeDays(product);
    if (days) expiry = new Date(mfg.getTime() + days * 86400000);
  }
  if (expiry && mfg && expiry <= mfg) {
    throw httpErr("Expiry date must be after the manufacturing date", 400);
  }

  const typed = String(lotNumber || "").trim().toUpperCase();
  const isManualLot = !!typed;
  const lot = isManualLot ? typed : await generateLotNumber(sellerId, null);

  // `batchNumber` IS the lot identity key in Inventory's unique index and is
  // shadowed to the lot number, exactly as lotService.receiveLot does it.
  const setFields = {
    lotNumber: lot,
    batchNumber: lot,
  };
  // Written on INSERT via the upsert filter below (Mongo copies the filter's
  // equality keys into a new document), and set here too so a top-up into an
  // existing pre-variant row gets labelled rather than left null.
  if (variantKey) setFields.variantSku = variantKey;
  if (expiry) setFields.expiryDate = expiry;
  if (mfg) setFields.mfgDate = mfg;
  if (typeof lowStockThreshold === "number" && Number.isFinite(lowStockThreshold)) {
    setFields.lowStockThreshold = Math.max(0, lowStockThreshold);
  }

  // ORIGINAL LOT REGISTER — immutable, write-once. $setOnInsert (never $set) so
  // a top-up into the same lot adds stock but leaves the creation figures alone.
  // lotOrigin "unknown" is the honest label: the enum has no seller-own value
  // and it is NOT extended here — "company"/"warehouse"/"grn"/"transfer" would
  // each be a lie, and the Main Company register filters on "company", so these
  // rows correctly never appear there.
  const insertOnlyFields = { originalQuantity: quantity, lotOrigin: "unknown" };

  const core = async (session) => {
    // Claim the number BEFORE any stock moves, so a duplicate is rejected with
    // nothing written.
    await claimLotNumber({
      sellerId,
      productId,
      lotNumber: lot,
      source: isManualLot ? "manual" : "khetify",
      session,
    });

    // `variantSku` IS PART OF THE LOOKUP: without it Red and Yellow upsert onto
    // the same row and merge into one total. `null` also matches rows saved
    // before this field existed (Mongo treats a missing field as null), so a
    // single-variant product keeps topping up its original row exactly as before.
    const doc = await Inventory.findOneAndUpdate(
      { productId, ownerType: "seller", ownerId: sellerId, warehouseId, batchNumber: lot, variantSku: variantKey },
      {
        $inc: { offlineStock: quantity, availableStock: quantity },
        $set: setFields,
        $setOnInsert: insertOnlyFields,
      },
      { new: true, upsert: true, session: session || undefined }
    );

    await ledger(doc, {
      type: "supply_in",
      quantity,
      refType: "Manual",
      refId: undefined,
      performedBy,
      note: `Own stock added for ${product.productName || "product"} (lot ${lot})`,
      session,
    });

    return doc;
  };

  let inv;
  try {
    inv = await withTransaction(core);
  } catch (err) {
    // The unique index is (product, owner, warehouse, batchNumber) and stays
    // that way — so typing the SAME lot number for two different variants is
    // refused. That is the correct answer (one lot number = one lot), but the
    // raw E11000 would surface as a 500, so it is named here instead.
    if (err?.code === 11000) {
      throw httpErr(
        `Lot number ${lot} is already used for another variant of this product. Use a different lot number.`,
        409
      );
    }
    throw err;
  }
  emitInventoryUpdate(inv);
  return inv;
}

module.exports = { addSellerOwnStock };
