const Package = require("../model/Outbound/Package");
const Shipment = require("../model/Transport/Shipment");
const Order = require("../model/Order/Order");
const Warehouse = require("../model/Warehouse/Warehouse");
const Product = require("../model/Company/productModel");
const { nextSeq } = require("./counterService");

/**
 * SELLER PACK SERVICE  (Phase 4)
 *
 * Turns a fully-picked seller shipment into a CUSTOMER PARCEL and produces the
 * delivery label that travels on it.
 *
 * ── WHICH BOX SYSTEM THIS REUSES, AND WHY ──
 * The existing `Package` model (model/Outbound/Package.js) is reused, not
 * duplicated. Of the three carton records in this codebase it is the only one
 * that is actually a customer parcel:
 *
 *   • BulkPackage — the INVENTORY carton (main / inner box). Scoped to a single
 *     lot and used for scanning; it is what sellerPickScanService resolves.
 *     Using it as a delivery parcel would corrupt that model, and its labels are
 *     explicitly out of scope.
 *   • RepackBox   — company-scoped, and ONE PRODUCT PER CARTON by design, so it
 *     cannot hold a multi-product customer order at all.
 *   • Package     — multi-item, order-linked, and `packageNumber` already
 *     doubles as the carton barcode. Exactly this.
 *
 * ── HOW SELLER AND COMPANY PACKAGES STAY SEPARATE ──
 * `Package` gained `ownerType`/`ownerId` (defaulting to "company"), the same
 * additive pattern UnitSerial and Inventory already use. Every query in this
 * file is scoped `{ ownerType: "seller", ownerId: sellerId }`, and no company
 * code sets or reads those fields — so the two never meet. The company's own
 * services (packService.js, dispatchService.js) are untouched; this is a
 * parallel seller implementation, mirroring how sellerPickScanService sits
 * beside pickScanService.
 *
 * ── QUANTITY SAFETY ──
 * The parcel's contents are read from the SHIPMENT'S OWN `lines[].pickedQty` —
 * the quantities Phase 3 validated and the pick recorded. Nothing here takes a
 * quantity, a product or a serial from the caller, so a client cannot pack or
 * dispatch more than was actually picked.
 */

const norm = (v) => String(v == null ? "" : v).trim();

function httpErr(message, status = 400, extra = {}) {
  const e = new Error(message);
  e.status = status;
  Object.assign(e, extra);
  return e;
}

/**
 * PKG-YYYYMM-#### for a seller.
 *
 * Uses the shared counterService exactly as the company's packService does, but
 * with a SELLER-SCOPED key, so seller and company numbering can never draw from
 * the same sequence. Uniqueness per seller is additionally enforced by the
 * partial index on the model.
 */
/**
 * A package number for a DRAFT box — minted without saving anything.
 *
 * The manager prints the label and sticks it on the carton BEFORE dispatch, so
 * the barcode has to exist before the parcel does. A counter cannot be used for
 * that: `nextSeq` writes, and a back-out would leave a consumed number (or,
 * worse, hand the same number to the next attempt).
 *
 * So a draft number carries a RANDOM suffix instead of a sequence. It is minted
 * in memory, printed, and only persisted if the dispatch succeeds. Nothing is
 * reserved, so backing out costs nothing and leaves nothing behind — the number
 * is simply never used.
 *
 * Same PKG-YYYYMM- prefix as the counter-based numbers, so both read alike; the
 * partial unique index on (ownerId, packageNumber) is what actually guarantees
 * no two seller parcels collide.
 */
function draftPackageNumber() {
  const period = new Date().toISOString().slice(0, 7).replace("-", "");
  // 8 base-36 chars ≈ 2.8e12 combinations — collision is not a practical risk,
  // and the unique index catches it regardless.
  const rand = Array.from({ length: 8 }, () =>
    "0123456789ABCDEFGHJKMNPQRSTUVWXYZ"[Math.floor(Math.random() * 33)]).join("");
  return `PKG-${period}-${rand}`;
}

/** Shape a draft number must have to be accepted back at dispatch. */
const DRAFT_PKG_RE = /^PKG-\d{6}-[0-9A-HJ-NP-Z]{8}$/;

async function nextSellerPackageNumber(sellerId) {
  const period = new Date().toISOString().slice(0, 7).replace("-", ""); // YYYYMM
  const seq = await nextSeq(sellerId, `seller-pkg-${period}`);
  return `PKG-${period}-${String(seq).padStart(4, "0")}`;
}

/** The shipment, with the checks every Phase 4 operation needs. */
async function loadPackable(sellerId, shipmentId) {
  const shipment = await Shipment.findOne({
    _id: shipmentId, ownerType: "seller", ownerId: sellerId,
  });
  if (!shipment) throw httpErr("Shipment not found", 404);
  return shipment;
}

/**
 * What is actually IN the parcel: picked quantity per product, summed across the
 * lots it was drawn from, with the serials that were picked.
 *
 * Read from `lines[].pickedQty`, never from `qty` — a line's planned quantity is
 * what was asked for, `pickedQty` is what was validated and taken. They are
 * equal on a complete pick, and using the latter means a partial pick can never
 * be packed as though it were whole.
 */
function contentsOf(shipment) {
  const byProduct = new Map();
  for (const l of shipment.lines || []) {
    if (!l.productId) continue;
    const picked = Number(l.pickedQty || 0);
    if (picked <= 0) continue;
    const pid = String(l.productId);
    if (!byProduct.has(pid)) byProduct.set(pid, { productId: pid, qty: 0, serials: [] });
    const row = byProduct.get(pid);
    row.qty += picked;
    // Serials the pick recorded for this line, when the stock is serialised.
    (l.serials || []).forEach((sn) => row.serials.push(sn));
  }
  return [...byProduct.values()];
}

/** Every product fully picked? Packing may not start before that. */
function shortfall(shipment) {
  const short = [];
  for (const l of shipment.lines || []) {
    const need = Number(l.qty || 0) - Number(l.pickedQty || 0);
    if (need > 0) short.push({ lotNumber: l.lotNumber || l.batchNumber || null, remaining: need });
  }
  return short;
}

/**
 * CREATE (or return) THE SHIPMENT BOX for a seller customer order.
 *
 * Idempotent: a shipment already carrying a package returns it rather than
 * minting a second barcode, so a double-click or a retried request cannot
 * produce two parcels for one order.
 *
 * The parcel is associated with the order, customer, seller, warehouse,
 * products and the ACTUAL PICKED quantities.
 */
async function createSellerPackage({ sellerId, shipmentId, performedBy = null, weightKg, dims }) {
  const shipment = await loadPackable(sellerId, shipmentId);

  // Already packed → hand back what exists. Never mint a second barcode.
  const existing = await Package.findOne({
    ownerType: "seller", ownerId: sellerId, shipmentId: shipment._id,
  });
  if (existing) return { package: existing, created: false };

  if (["dispatched", "in_transit", "arrived", "delivered"].includes(shipment.status)) {
    throw httpErr("This shipment has already been dispatched.", 409, { code: "ALREADY_DISPATCHED" });
  }

  const short = shortfall(shipment);
  if (short.length) {
    const total = short.reduce((n, s) => n + s.remaining, 0);
    throw httpErr(
      `${total} unit(s) still to pick. Finish picking before creating the shipment box.`,
      409, { code: "NOT_PICKED" }
    );
  }

  const items = contentsOf(shipment);
  if (!items.length) {
    throw httpErr("Nothing has been picked for this shipment yet.", 409, { code: "NOT_PICKED" });
  }

  const packageNumber = await nextSellerPackageNumber(sellerId);
  const doc = await Package.create({
    // Seller-owned. `companyId` is deliberately left unset — see the model.
    ownerType: "seller",
    ownerId: sellerId,
    orderId: shipment.refType === "Order" ? shipment.refId : null,
    refType: shipment.refType === "Order" ? "Order" : "Order",
    refId: shipment.refId,
    shipmentId: shipment._id,
    packageNumber,
    items,
    status: "packed",
    packedBy: performedBy || undefined,
    ...(weightKg != null && weightKg !== "" ? { weightKg: Number(weightKg) } : {}),
    ...(norm(dims) ? { dims: norm(dims) } : {}),
  });

  return { package: doc, created: true };
}


/**
 * Contents for ONE box, from an explicit selection of validated tokens.
 *
 * `resolved` comes from sellerPickScanService.buildSellerPickPayload, which has
 * already proved every token exists, is seller-owned, is in this warehouse and
 * is still pickable. This only groups what survived into package items.
 */
function contentsFromResolved(resolved) {
  const byProduct = new Map();
  for (const u of resolved.units || []) {
    const pid = String(u.productId);
    if (!byProduct.has(pid)) byProduct.set(pid, { productId: pid, qty: 0, serials: [] });
    const row = byProduct.get(pid);
    row.qty += 1;
    row.serials.push(u.serial);
  }
  for (const l of resolved.lots || []) {
    const pid = String(l.productId);
    if (!byProduct.has(pid)) byProduct.set(pid, { productId: pid, qty: 0, serials: [] });
    byProduct.get(pid).qty += Number(l.qty || 0);
  }
  return [...byProduct.values()].filter((r) => r.qty > 0);
}

/**
 * CREATE ONE BOX FROM SELECTED UNITS.
 *
 * The manager ticks some of the units they have scanned and presses Add to Box;
 * this mints a parcel containing exactly those. Called again with the remaining
 * units it mints Box 2, Box 3, and so on — a shipment may therefore hold SEVERAL
 * packages, which is why this does not reuse createSellerPackage's
 * one-parcel-per-shipment rule.
 *
 * `contents` must already have been validated and picked by the caller (see
 * sellerShipmentController.createBox, which records the pick through the
 * existing pickShipment before calling this). Nothing here takes a quantity or
 * a product from the client.
 */
async function createSellerBox({ sellerId, shipment, resolved, performedBy = null, weightKg, dims, packageNumber = null }) {
  const items = contentsFromResolved(resolved);
  if (!items.length) {
    throw httpErr("Select at least one scanned unit to put in the box.", 400, { code: "EMPTY_BOX" });
  }

  // The number PRINTED ON THE CARTON, when the manager labelled the box before
  // dispatching. Saving that exact number is what keeps the sticker and the
  // record in agreement — minting a fresh one here would silently invalidate a
  // label that is already on the box.
  //
  // Only a value in the draft format is honoured, and it must not already be in
  // use, so a caller cannot claim an arbitrary or duplicate barcode.
  let number = null;
  if (packageNumber) {
    if (!DRAFT_PKG_RE.test(String(packageNumber))) {
      throw httpErr("That box label is not valid. Re-print the label and try again.", 400, { code: "BAD_PACKAGE_NUMBER" });
    }
    const clash = await Package.findOne({
      ownerType: "seller", ownerId: sellerId, packageNumber: String(packageNumber),
    }).select("_id").lean();
    if (clash) {
      throw httpErr("That box label has already been used. Re-print the label and try again.", 409, { code: "DUPLICATE_PACKAGE_NUMBER" });
    }
    number = String(packageNumber);
  }
  const finalNumber = number || (await nextSellerPackageNumber(sellerId));
  const doc = await Package.create({
    ownerType: "seller",
    ownerId: sellerId,
    orderId: shipment.refType === "Order" ? shipment.refId : null,
    refType: "Order",
    refId: shipment.refId,
    shipmentId: shipment._id,
    packageNumber: finalNumber,
    items,
    status: "packed",
    packedBy: performedBy || undefined,
    ...(weightKg != null && weightKg !== "" ? { weightKg: Number(weightKg) } : {}),
    ...(norm(dims) ? { dims: norm(dims) } : {}),
  });
  return doc;
}

/** Remove a parcel. Used only to undo boxes minted moments earlier when the
 *  dispatch that follows them fails, so no orphan barcode survives. */
async function deleteSellerBox({ sellerId, packageId }) {
  await Package.deleteOne({ _id: packageId, ownerType: "seller", ownerId: sellerId });
}

/** Every box raised for a shipment, oldest first (Box 1, Box 2, …). */
async function listSellerBoxes({ sellerId, shipmentId }) {
  return Package.find({ ownerType: "seller", ownerId: sellerId, shipmentId })
    .sort({ createdAt: 1 }).lean();
}


/** Product names for a set of ids. */
async function productNames(ids) {
  const rows = await Product.find({ _id: { $in: [...new Set(ids.map(String))] } })
    .select("productName").lean();
  return new Map(rows.map((p) => [String(p._id), p.productName]));
}

/**
 * The customer / origin block shared by the draft preview and the final label,
 * so a printed preview and the real thing can never disagree about where the
 * parcel is going. Read from the ACTUAL order — nothing hardcoded, and no
 * country line, because no address in this system stores one.
 */
async function deliveryContext(sellerId, shipment) {
  const order = shipment.refType === "Order" && shipment.refId
    ? await Order.findOne({ _id: shipment.refId, ownerType: "seller", ownerId: sellerId })
      .select("orderNumber invoiceNumber customerName shippingAddress billingAddress placedAt")
      .lean()
    : null;

  const a = order?.shippingAddress || order?.billingAddress || null;
  if (!a || !norm(a.line1)) {
    throw httpErr(
      "This order has no delivery address, so a label cannot be printed. Add the address to the order first.",
      409, { code: "NO_ADDRESS" }
    );
  }
  const from = shipment.fromWarehouseId
    ? await Warehouse.findOne({ _id: shipment.fromWarehouseId, sellerId }).select("name address").lean()
    : null;

  return {
    orderNumber: order?.invoiceNumber || order?.orderNumber || null,
    placedAt: order?.placedAt || null,
    deliverTo: {
      name: order?.customerName || shipment.toLabel || null,
      line1: a.line1 || null, line2: a.line2 || null,
      city: a.city || null, district: a.district || null,
      state: a.state || null, pincode: a.pincode || null, phone: a.phone || null,
    },
    from: from
      ? { name: from.name, city: from.address?.city || null, state: from.address?.state || null, pincode: from.address?.pincode || null }
      : null,
  };
}


/* ------------------------------------------- draft (nothing persisted) */

/**
 * PREVIEW A BOX LABEL WITHOUT SAVING ANYTHING.
 *
 * The manager builds boxes and prints their labels BEFORE the operation is
 * committed, so this renders a label from validated-but-uncommitted contents.
 * It writes nothing: no Package row, no counter is consumed, no package number
 * is minted. Back out of the popup and there is nothing to clean up, because
 * nothing was ever created.
 *
 * The consequence is that a preview label has no package barcode yet — that
 * number is assigned at dispatch, which is the moment the parcel becomes real.
 * The preview is marked as such so nobody sticks an unnumbered label on a
 * carton and assumes it is final.
 */
async function draftBoxLabel({ sellerId, shipmentId, resolved, boxNumber = 1, boxCount = 1, weightKg, dims, packageNumber = null }) {
  const shipment = await loadPackable(sellerId, shipmentId);
  const items = contentsFromResolved(resolved);
  if (!items.length) {
    throw httpErr("Select at least one scanned unit to put in the box.", 400, { code: "EMPTY_BOX" });
  }
  const base = await deliveryContext(sellerId, shipment);
  const names = await productNames(items.map((i) => i.productId));
  // Reuse the number this box was already given, so re-opening the label does
  // not produce a second barcode for the same carton.
  const number = packageNumber && DRAFT_PKG_RE.test(packageNumber)
    ? packageNumber
    : draftPackageNumber();

  return {
    ...base,
    draft: true,
    packageId: null,
    // A REAL, printable number and barcode — the same one that will be saved
    // when this box is dispatched.
    packageNumber: number,
    barcode: number,
    boxNumber,
    boxCount,
    items: items.map((i) => ({
      productId: String(i.productId),
      productName: names.get(String(i.productId)) || "Item",
      qty: i.qty,
    })),
    totalUnits: items.reduce((n, i) => n + (i.qty || 0), 0),
    weightKg: weightKg != null && weightKg !== "" ? Number(weightKg) : null,
    dims: norm(dims) || null,
  };
}

/**
 * THE CUSTOMER DELIVERY LABEL.
 *
 * A normal e-commerce parcel label: who it is going to, where, what is in it and
 * the barcode to scan. It is a SEPARATE artefact from the Lot / Bulk Package /
 * Main Box / Inner Box / Unit labels, which identify inventory and are left
 * exactly as they are.
 *
 * Every field is read from the ACTUAL ORDER — nothing is hardcoded. The address
 * is the one the customer ordered against, and there is deliberately NO country
 * line: no address schema in this codebase stores one, and inventing a value
 * for a shipping label is worse than omitting it.
 *
 * `barcode` is the package number, matching how packageNumber already doubles
 * as the carton barcode elsewhere.
 */
async function sellerDeliveryLabel({ sellerId, shipmentId, packageId = null }) {
  const shipment = await loadPackable(sellerId, shipmentId);

  // A shipment may hold several boxes, so the label is per BOX. Without an id
  // the most recent one is used — the box just created.
  const pkg = packageId
    ? await Package.findOne({ _id: packageId, ownerType: "seller", ownerId: sellerId, shipmentId: shipment._id }).lean()
    : await Package.findOne({ ownerType: "seller", ownerId: sellerId, shipmentId: shipment._id })
      .sort({ createdAt: -1 }).lean();
  if (!pkg) {
    throw httpErr("Create the shipment box before printing the delivery label.", 409, { code: "NO_PACKAGE" });
  }
  const all = await Package.find({ ownerType: "seller", ownerId: sellerId, shipmentId: shipment._id })
    .sort({ createdAt: 1 }).select("_id").lean();
  const boxIndex = all.findIndex((x) => String(x._id) === String(pkg._id));

  const order = shipment.refType === "Order" && shipment.refId
    ? await Order.findOne({ _id: shipment.refId, ownerType: "seller", ownerId: sellerId })
      .select("orderNumber invoiceNumber customerName shippingAddress billingAddress placedAt")
      .lean()
    : null;

  const a = order?.shippingAddress || order?.billingAddress || null;
  if (!a || !norm(a.line1)) {
    throw httpErr(
      "This order has no delivery address, so a label cannot be printed. Add the address to the order first.",
      409, { code: "NO_ADDRESS" }
    );
  }

  const names = new Map(
    (await Product.find({ _id: { $in: pkg.items.map((i) => i.productId) } })
      .select("productName").lean())
      .map((p) => [String(p._id), p.productName])
  );

  const from = shipment.fromWarehouseId
    ? await Warehouse.findOne({ _id: shipment.fromWarehouseId, sellerId }).select("name address").lean()
    : null;

  return {
    packageId: String(pkg._id),
    packageNumber: pkg.packageNumber,
    barcode: pkg.packageNumber,
    // "Box 2 of 3" on the carton, so a split parcel is obvious at the door.
    boxNumber: boxIndex >= 0 ? boxIndex + 1 : 1,
    boxCount: all.length || 1,
    orderNumber: order?.invoiceNumber || order?.orderNumber || null,
    placedAt: order?.placedAt || null,
    deliverTo: {
      name: order?.customerName || shipment.toLabel || null,
      line1: a.line1 || null,
      line2: a.line2 || null,
      city: a.city || null,
      district: a.district || null,
      state: a.state || null,
      pincode: a.pincode || null,
      phone: a.phone || null,
    },
    from: from ? { name: from.name, city: from.address?.city || null, state: from.address?.state || null, pincode: from.address?.pincode || null } : null,
    items: pkg.items.map((i) => ({
      productId: String(i.productId),
      productName: names.get(String(i.productId)) || "Item",
      qty: i.qty,
    })),
    totalUnits: pkg.items.reduce((n, i) => n + (i.qty || 0), 0),
    weightKg: pkg.weightKg || null,
    dims: pkg.dims || null,
  };
}

/** The parcel for a shipment, if one has been created. Read-only. */
async function getSellerPackage({ sellerId, shipmentId }) {
  return Package.findOne({ ownerType: "seller", ownerId: sellerId, shipmentId }).lean();
}

/**
 * Mark the parcel shipped when its shipment dispatches.
 *
 * Deducts nothing and moves no stock — that stays entirely with the existing
 * dispatch path. This only flips the parcel's own status, and is idempotent, so
 * a retried dispatch cannot double-apply.
 */
async function markSellerPackageShipped({ sellerId, shipmentId }) {
  await Package.updateOne(
    { ownerType: "seller", ownerId: sellerId, shipmentId, status: "packed" },
    { $set: { status: "shipped" } }
  );
}

module.exports = {
  draftBoxLabel,
  createSellerPackage,
  createSellerBox,
  deleteSellerBox,
  listSellerBoxes,
  sellerDeliveryLabel,
  getSellerPackage,
  markSellerPackageShipped,
  _internal: { contentsOf, shortfall, contentsFromResolved },
};