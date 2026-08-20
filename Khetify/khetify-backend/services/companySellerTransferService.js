/**
 * companySellerTransferService.js — COMPANY WAREHOUSE → SELLER stock transfer,
 * initiated by the warehouse and verified by SCANNING.
 *
 * WHY THIS EXISTS, AND WHAT IT DELIBERATELY DOES NOT DO
 * ─────────────────────────────────────────────────────
 * The company→seller rails already exist end to end: a seller requests supply,
 * the company approves + assigns a source warehouse, Send Stock picks/packs it,
 * dispatch commits the stock out, and the seller scan-receives it into their own
 * inventory (supplyController + shipmentService + sellerSupplyController).
 *
 * The ONLY thing missing was the other direction of initiative: a warehouse
 * manager PUSHING stock to a seller without waiting for a request. So this file
 * adds exactly that — a scan-driven front door — and then hands the movement to
 * the existing machinery. It creates NO new stock mathematics:
 *
 *   reservation ................ lotService.reserveLotQty / releaseLotQty
 *   unit state ................. barcodeService.transitionUnits
 *   shelf / warehouse checks ... pickScanService.assertLotOnShelf / assertBoxOnShelf
 *   the movement itself ........ shipmentService.createShipment + dispatchShipment
 *   the seller landing ......... shipmentService.verifyReceipt, reached through the
 *                                seller's EXISTING "Scan to receive" screen
 *   ownership guards ........... warehouseOwnershipService, pcService
 *
 * The transfer is recorded as a SupplyOrder with `initiatedBy: "company"`, which
 * is what makes the whole downstream work untouched: the seller's supply screen
 * already offers "Scan to receive" for any dispatched supply order, and the
 * company's supply list / shipment tracking already show its status and history.
 *
 * SCANNING — the hierarchy is the same one the rest of the warehouse works with,
 * and the TYPE of a scan is decided by an exact database lookup, never by
 * parsing the string:
 *
 *   Bulk Packaging ID → every available unit in that physical box
 *   Lot Number        → every available unit of a lot that is NOT boxed
 *   Unit Code         → that one unit
 *
 * The one intentional difference from the dispatch scan (dispatchScanService) is
 * that there is no required quantity to count against: here the scan DEFINES
 * what is being transferred, so nothing is capped and nothing is refused for
 * being "more than the shipment needs".
 */

const mongoose = require("mongoose");
const SupplyOrder = require("../model/Supply/SupplyOrder");
const Inventory = require("../model/Inventory/Inventory");
const Product = require("../model/Company/productModel");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const Warehouse = require("../model/Warehouse/Warehouse");
const Seller = require("../model/Seller/Seller");
const PrincipalCertificate = require("../model/PC/PrincipalCertificate");
const Shipment = require("../model/Transport/Shipment");
const lotService = require("./lotService");
const barcodeService = require("./barcodeService");
const shipmentService = require("./shipmentService");
const shipmentBoxService = require("./shipmentBoxService");
const pcService = require("./pcService");
const fileService = require("./fileService");
const { assertCompanyWarehouse, assertSellerWarehouse } = require("./warehouseOwnershipService");
const { assertLotOnShelf, assertBoxOnShelf, PICKABLE_STATUS, MSG: PICK_MSG } = require("./pickScanService");
// WHAT A SCANNED CODE MEANS, from the one place that defines it. The warehouse
// dispatch scan already reads a carton this way; the seller transfer scan read
// the box row directly instead, which is why a main box and an inner box that
// scan cleanly warehouse-to-warehouse were refused on the way to a seller.
const { unitHolderIds, boxStockLocation, findUnit, codeVariants } = require("./packagingScanService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const norm = (v) => String(v || "").trim().toUpperCase();

// A scan session larger than this is not a realistic warehouse operation; the
// same guard rail pickScanService puts on its own selection.
const MAX_UNITS = 20000;

const MSG = {
  noCode: "A code is required",
  unknown: (code) => `Unknown code "${code}".`,
  duplicate: (code) => `${code} has already been added to this transfer.`,
  notInStock: (code, status) => `${code} is not available (${status}).`,
  noneEligible: (id) => `No available units in ${id} — they are already added or unavailable.`,
  noUnits: (number) =>
    `Lot ${number} has no unit labels, so it cannot be transferred by scanning. Generate its labels first.`,
  boxedLot: (number) =>
    `Lot ${number} is packed into boxes. Scan a Bulk Packaging ID or an individual Unit Code.`,
  elsewhere: (code) => `${code} is not in this warehouse.`,
  nothingScanned: "Scan at least one item before confirming the transfer",
  notAuthorized: "This seller does not hold an active Principal Certificate from your company",
  raced: "Some of the scanned units were just taken by another user — rescan and try again",

  // ── QUANTITY RULES ──
  // The same all-or-nothing carton rule the warehouse→warehouse dispatch scan
  // applies (dispatchScanService.MSG), in the same words: a sealed box may not
  // stand for a part of itself, so if it holds more than the transfer still
  // needs, the operator scans single units instead.
  nothingLeft: "Every unit this transfer requires has already been scanned.",
  partialBox: (need, have, id) =>
    `This transfer needs ${need} of ${have} units from ${id}. Scan the individual unit codes instead.`,
  partialLot: (need, have, number) =>
    `This transfer needs ${need} of ${have} units from ${number}. Scan the individual unit codes instead.`,
  incomplete: (scanned, total) =>
    `Scan every unit before transferring — ${scanned} of ${total} scanned.`,
  overQuantity: (scanned, total) =>
    `Only ${total} unit(s) were requested, but ${scanned} were scanned. Remove the extras.`,
  badQuantity: (available) =>
    `Enter a quantity between 1 and ${available} — that is what this warehouse has available.`,
  noStock: "This product has no available stock in this warehouse",
};

/**
 * The quantity context for one scan: which PRODUCT the transfer is for and how
 * many of its units are still wanted. Both optional — a transfer built without a
 * product/quantity (the multi-product path) simply has no cap.
 */
function quantityCtx({ productId = null, requiredQty = null, selectedCount = 0, lines = null, scannedPerProduct = null }) {
  // MULTI-PRODUCT (a seller request with several lines): each product carries
  // its own requirement, and the scan itself decides which line it belongs to.
  if (Array.isArray(lines) && lines.length) {
    const byProduct = new Map();
    for (const l of lines) {
      const pid = String(l.productId || "");
      if (!pid) continue;
      const required = Number(l.requiredQty);
      const done = Number(scannedPerProduct?.get(pid) || 0);
      byProduct.set(pid, {
        required: Number.isFinite(required) && required > 0 ? required : null,
        remaining: Number.isFinite(required) && required > 0 ? Math.max(0, required - done) : null,
      });
    }
    return { mode: "multi", byProduct, productId: null, remaining: null };
  }

  // SINGLE PRODUCT (a hand-built transfer): unchanged.
  const required = Number(requiredQty);
  return {
    mode: "single",
    byProduct: null,
    productId: productId ? String(productId) : null,
    // null = uncapped.
    remaining: Number.isFinite(required) && required > 0
      ? Math.max(0, required - selectedCount)
      : null,
  };
}

/**
 * The scanned code must belong to a product this transfer is for, and — once it
 * does — the remaining quantity to check it against is THAT product's, not a
 * transfer-wide one. Mutates ctx.remaining so the existing carton/lot size
 * checks below need no changes at all.
 */
function assertProduct(ctx, lot) {
  const pid = String(lot.productId);
  if (ctx.mode === "multi") {
    const line = ctx.byProduct.get(pid);
    if (!line) throw httpErr(PICK_MSG.wrongProduct, 409);
    ctx.remaining = line.remaining;
    return;
  }
  if (ctx.productId && pid !== ctx.productId) {
    throw httpErr(PICK_MSG.wrongProduct, 409);
  }
}

/**
 * The three transfer documents. Declared once so the upload, the storage key,
 * the model field and the read-back can never drift apart.
 *   field    — multipart field name the form posts
 *   docKey   — SupplyOrder path the record lives on
 *   label    — what the operator sees
 */
const TRANSFER_DOCS = [
  { field: "challanDocument", docKey: "challanDocument", label: "Challan" },
  { field: "billDocument", docKey: "billDocument", label: "Bill" },
  { field: "biltyDocument", docKey: "biltyDocument", label: "Bilty" },
];

const DOC_MIME = /^(application\/pdf|image\/(jpeg|jpg|png|webp))$/i;
const DOC_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Push the uploaded files to storage and return the records to save.
 * `files` is multer's memoryStorage output keyed by field name (upload.fields).
 * Validation is repeated here rather than trusted from the middleware: the
 * middleware accepts an extension OR a mimetype, and a transfer document must
 * be a real PDF or image.
 */
async function storeTransferDocuments(companyId, files, performedBy) {
  const out = {};
  if (!files) return out;

  for (const { field, label } of TRANSFER_DOCS) {
    const file = Array.isArray(files[field]) ? files[field][0] : files[field];
    if (!file || !file.buffer?.length) continue;

    if (!DOC_MIME.test(String(file.mimetype || ""))) {
      throw httpErr(`The ${label} document must be a PDF or an image (JPG, PNG, WEBP)`, 400);
    }
    if (file.size > DOC_MAX_BYTES) {
      throw httpErr(`The ${label} document must be smaller than 10MB`, 400);
    }

    const safe = String(file.originalname || "document")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(-80);
    const key = `transfers/${companyId}/${Date.now()}-${field}-${safe}`;
    const { key: storedKey } = await fileService.uploadBuffer(file.buffer, key, file.mimetype);

    out[field] = {
      fileKey: storedKey,
      fileName: file.originalname || safe,
      mimeType: file.mimetype,
      size: file.size,
      uploadedAt: new Date(),
      uploadedBy: performedBy || null,
    };
  }
  return out;
}

/**
 * Turn stored document records into something the UI can open. The URL is
 * resolved at READ time (signed for S3, /uploads/… for local) and never
 * persisted — see services/fileService.
 */
async function readTransferDocuments(order) {
  const out = {};
  for (const { docKey } of TRANSFER_DOCS) {
    const doc = order?.[docKey];
    if (!doc?.fileKey) { out[docKey] = null; continue; }
    out[docKey] = {
      fileName: doc.fileName || "document",
      mimeType: doc.mimeType || null,
      size: doc.size || null,
      uploadedAt: doc.uploadedAt || null,
      url: await fileService.signedUrl(doc.fileKey),
    };
  }
  return out;
}

/* ------------------------------------------------------------------ helpers */

/**
 * THE SOURCE WAREHOUSE GATE. Every read and write in this file passes through
 * here, so "does this stock belong to the company warehouse the operator is
 * transferring from" is answered in exactly one place.
 *
 * `allowedWarehouseIds` is the caller's warehouse scope (warehouseScope(); null
 * for an unscoped role). A scoped operator may only send from a warehouse they
 * are assigned to.
 */
async function assertSource(companyId, fromWarehouseId, allowedWarehouseIds) {
  if (!fromWarehouseId || !mongoose.Types.ObjectId.isValid(String(fromWarehouseId))) {
    throw httpErr("Select the warehouse the stock is being sent from", 400);
  }
  const wh = await assertCompanyWarehouse(companyId, fromWarehouseId);
  if (Array.isArray(allowedWarehouseIds)
      && !allowedWarehouseIds.map(String).includes(String(fromWarehouseId))) {
    throw httpErr("You are not assigned to that warehouse", 403);
  }
  return wh;
}

/** The lot row a scan resolved to, scoped to this company. */
function loadLot(companyId, lotId) {
  return Inventory.findOne({ _id: lotId, ownerType: "company", ownerId: companyId })
    .select("lotNumber batchNumber warehouseId productId availableStock inTransitStock has_bulk_packaging");
}

/** Units of a lot that are on the shelf here and could go out. */
function eligibleUnits(companyId, lotId, extra = {}) {
  return UnitSerial.find({
    companyId,
    ownerType: "company",
    ownerId: companyId,
    inventoryId: lotId,
    status: PICKABLE_STATUS,
    ...extra,
  })
    .select("serial unit_code status bulk_packaging_id bulk_packaging_record_id inventoryId")
    .lean();
}

/**
 * How many units of a carton are currently on the shelf. This is what decides
 * whether scanning it unit-by-unit amounts to taking the WHOLE carton (in which
 * case its Bulk Packaging Label travels with it) or only PART of it (in which
 * case those units have been taken out of the carton and are loose for this
 * transfer — they need a Shipment Box).
 */
function cartonUnitCount(companyId, bulkPackageRecordId) {
  return UnitSerial.countDocuments({
    companyId, ownerType: "company", ownerId: companyId,
    bulk_packaging_record_id: bulkPackageRecordId, status: PICKABLE_STATUS,
  });
}

/**
 * Which product each already-scanned serial belongs to, counted per product.
 * Resolved from the DATABASE rather than trusted from the client, so a request
 * cannot claim a line is less full than it is. Two queries regardless of size.
 */
async function scannedCountsByProduct(companyId, serials) {
  const counts = new Map();
  if (!serials.length) return counts;

  // BOTH SPELLINGS. A three-level lot stores the inner-box segment of a UNIT
  // code as "BPinner", so an upper-cased `$in` misses every one of them and the
  // per-product tally came back short — which then let the quantity cap accept
  // more units than the line actually wanted. See packagingScanService.
  const units = await UnitSerial.find({
    companyId, ownerType: "company", ownerId: companyId,
    $or: [
      { serial: { $in: codeVariants(serials) } },
      { unit_code: { $in: codeVariants(serials) } },
    ],
  }).select("inventoryId").lean();
  if (!units.length) return counts;

  const lotIds = [...new Set(units.map((u) => String(u.inventoryId)))];
  const lots = await Inventory.find({ _id: { $in: lotIds }, ownerType: "company", ownerId: companyId })
    .select("productId").lean();
  const productByLot = new Map(lots.map((l) => [String(l._id), String(l.productId)]));

  for (const u of units) {
    const pid = productByLot.get(String(u.inventoryId));
    if (!pid) continue;
    counts.set(pid, (counts.get(pid) || 0) + 1);
  }
  return counts;
}

/** Product names for a set of ids, in one query. */
async function productNames(companyId, productIds) {
  const ids = [...new Set(productIds.map(String))].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await Product.find({ _id: { $in: ids }, companyId })
    .select("productName skuNumber unit unitValue")
    .lean();
  return new Map(rows.map((p) => [String(p._id), p]));
}

/** The answer one scan returns — one row for the transfer list. */
async function scanResult(companyId, { scanType, lot, added, skipped, bulkPackagingId = null, ctx = null, cartonUnits = null }) {
  const meta = (await productNames(companyId, [lot.productId])).get(String(lot.productId)) || {};
  return {
    scanType,
    lotId: String(lot._id),
    lotNumber: lot.lotNumber || lot.batchNumber,
    warehouseId: lot.warehouseId ? String(lot.warehouseId) : null,
    productId: String(lot.productId),
    productName: meta.productName || "Item",
    skuNumber: meta.skuNumber || null,
    unit: meta.unit || null,
    addedUnitCodes: added,
    addedQuantity: added.length,
    // CAN THESE UNITS GO INTO A SHIPMENT BOX?
    // A whole carton scanned by its Bulk Packaging ID never can — it already has
    // a label, and that label travels with it.
    //
    // A unit scanned INDIVIDUALLY can, even when it came out of a carton: taking
    // 5 units out of a 200-unit box means the box stays on the shelf and those 5
    // are loose for this transfer. Whether they are loose or amount to the whole
    // carton is arithmetic across the WHOLE scan, not something one scan knows,
    // so the carton's size is reported and the caller settles it (the screen
    // live, and resolveScannedUnits authoritatively at confirm).
    boxable: scanType !== "bulk_package",
    bulkPackagingId,
    bulkPackageUnitsAvailable: cartonUnits,
    skippedQuantity: skipped,
    // null when the transfer is uncapped (no quantity entered). In multi-product
    // mode this is THIS PRODUCT's remainder, not a transfer-wide one.
    remainingRequired: ctx && ctx.remaining !== null ? Math.max(0, ctx.remaining - added.length) : null,
    // Which requested line this scan filled, so the screen updates that row.
    lineRequiredQty: ctx?.mode === "multi"
      ? (ctx.byProduct.get(String(lot.productId))?.required ?? null)
      : null,
  };
}

/* -------------------------------------------------------------- scan cases */

/** A whole physical box: every available unit inside it that isn't already in. */
async function scanBox(companyId, box, fromWarehouseIds, selected, ctx) {
  // WHICH LOT ROW THIS CARTON'S STOCK IS ON — read from its UNITS, never from
  // the box's own `lot_id`.
  //
  // A BulkPackage row is anchored for life to the row it was minted against. A
  // warehouse->warehouse receipt lands its units on a BRAND-NEW Inventory row at
  // the destination, so at the receiving warehouse `lot_id` still names the
  // SENDER's row — and loading that row here resolved a lot sitting in the
  // sender's warehouse, which the shelf check then refused. The lot label worked
  // throughout because a lot number resolves through Inventory, which has one
  // row per warehouse; a box has only its one stale pointer.
  const boxCache = new Map();
  const location = await boxStockLocation(companyId, box, boxCache);

  // The row in the warehouse this transfer is sending FROM. A carton split by a
  // partial transfer genuinely sits on two rows, and only the half that is here
  // may leave.
  const here = fromWarehouseIds.map(String);
  let lot = null;
  let anyRow = null;
  for (const id of location.inventoryIds) {
    const row = await loadLot(companyId, id);
    if (!row) continue;
    anyRow = anyRow || row;
    if (here.includes(String(row.warehouseId))) { lot = row; break; }
  }
  // Not on this shelf: hand the row we did find to the shared checks so the
  // operator gets the real reason ("is currently at <warehouse>") rather than a
  // blank "already transferred out".
  if (!lot) lot = anyRow;
  if (!lot) throw httpErr(MSG.elsewhere(box.bulk_packaging_id), 409);

  assertProduct(ctx, lot);
  await assertLotOnShelf(lot, fromWarehouseIds);
  await assertBoxOnShelf(box, lot, fromWarehouseIds, { companyId, cache: boxCache });

  // A MAIN carton owns no unit rows of its own — the units hang off the inner
  // boxes nailed inside it — so the lookup runs over whichever boxes actually
  // hold them. Scoping to `box._id` alone is what made a main box resolve to
  // zero units and read as an empty carton.
  const holderIds = await unitHolderIds(companyId, box);
  const units = await eligibleUnits(companyId, lot._id, {
    bulk_packaging_record_id: { $in: holderIds },
  });
  const fresh = units.filter((u) => !selected.has(norm(u.serial)));
  if (!fresh.length) {
    const anySelected = units.some((u) => selected.has(norm(u.serial)));
    throw httpErr(
      anySelected ? MSG.duplicate(box.bulk_packaging_id) : MSG.noneEligible(box.bulk_packaging_id),
      409
    );
  }

  if (ctx.remaining !== null) {
    if (ctx.remaining <= 0) throw httpErr(MSG.nothingLeft, 409);
    if (fresh.length > ctx.remaining) {
      throw httpErr(MSG.partialBox(ctx.remaining, fresh.length, box.bulk_packaging_id), 409);
    }
  }

  return scanResult(companyId, {
    scanType: "bulk_package", lot, ctx,
    added: fresh.map((u) => u.serial), skipped: units.length - fresh.length,
    bulkPackagingId: box.bulk_packaging_id,
    cartonUnits: units.length,
  });
}

/**
 * A whole UNBOXED lot. A lot that IS packed into boxes is refused here — its
 * identity for shipping purposes is the box, so the operator must scan the Bulk
 * Packaging ID (or single unit codes). Same rule, and same wording, as the
 * warehouse-transfer dispatch scan.
 */
async function scanLot(companyId, lot, fromWarehouseIds, selected, ctx) {
  assertProduct(ctx, lot);
  await assertLotOnShelf(lot, fromWarehouseIds);

  const number = lot.lotNumber || lot.batchNumber;
  // IS THIS ROW'S STOCK PACKED INTO BOXES? Its own cartons, and — when it has
  // none — the cartons its units still carry. `lot_id` counts ZERO at a RECEIVING
  // warehouse (the boxes stay anchored to the sender's row), so a bulk-packed lot
  // silently accepted a bare Lot Number there while the same scan was refused at
  // the sending warehouse. Both ends answer from the same evidence now.
  const boxCount = await BulkPackage.countDocuments({ company_id: companyId, lot_id: lot._id })
    || (await UnitSerial.distinct("bulk_packaging_record_id", {
      companyId, ownerType: "company", ownerId: companyId,
      inventoryId: lot._id, bulk_packaging_record_id: { $ne: null },
    })).length;
  if (boxCount > 0) throw httpErr(MSG.boxedLot(number), 409);

  const units = await eligibleUnits(companyId, lot._id);
  if (!units.length) throw httpErr(MSG.noUnits(number), 409);

  const fresh = units.filter((u) => !selected.has(norm(u.serial)));
  if (!fresh.length) throw httpErr(MSG.duplicate(number), 409);

  if (ctx.remaining !== null) {
    if (ctx.remaining <= 0) throw httpErr(MSG.nothingLeft, 409);
    if (fresh.length > ctx.remaining) {
      throw httpErr(MSG.partialLot(ctx.remaining, fresh.length, number), 409);
    }
  }

  return scanResult(companyId, {
    scanType: "lot", lot, ctx,
    added: fresh.map((u) => u.serial), skipped: units.length - fresh.length,
  });
}

/** ONE unit. Its lot — and its carton, when it lives in one — must be here too. */
async function scanUnit(companyId, unit, fromWarehouseIds, selected, ctx) {
  const code = unit.unit_code || unit.serial;
  if (selected.has(norm(unit.serial))) throw httpErr(MSG.duplicate(code), 409);

  const lot = await loadLot(companyId, unit.inventoryId);
  if (!lot) throw httpErr(MSG.elsewhere(code), 409);
  assertProduct(ctx, lot);
  await assertLotOnShelf(lot, fromWarehouseIds);

  let cartonUnits = null;
  if (unit.bulk_packaging_record_id) {
    const box = await BulkPackage.findOne({ _id: unit.bulk_packaging_record_id, company_id: companyId })
      .select("bulk_packaging_id status warehouse_id lot_id box_level parent_box_id company_id");
    if (box) await assertBoxOnShelf(box, lot, fromWarehouseIds, { companyId });
    cartonUnits = await cartonUnitCount(companyId, unit.bulk_packaging_record_id);
  }
  // Anything other than in_stock — picked, packed, shipped, sold, damaged — is
  // either already committed elsewhere or already transferred out.
  if (unit.status !== PICKABLE_STATUS) throw httpErr(MSG.notInStock(code, unit.status), 409);
  if (ctx.remaining !== null && ctx.remaining <= 0) throw httpErr(MSG.nothingLeft, 409);

  return scanResult(companyId, {
    scanType: "unit", lot, added: [unit.serial], skipped: 0, ctx,
    bulkPackagingId: unit.bulk_packaging_id || null,
    cartonUnits,
  });
}

/* ------------------------------------------------------------------ read API */

/**
 * What the transfer screen needs to open: the warehouses this operator may send
 * FROM, and the sellers they may send TO (with each seller's own warehouses as
 * the destination options).
 *
 * A seller is transferable-to only while they hold an ACTIVE Principal
 * Certificate from this company — the same authorization the seller's own supply
 * request uses, read through the same service.
 */
async function transferOptions(companyId, { allowedWarehouseIds = null } = {}) {
  const whFilter = { companyId, isActive: true };
  if (Array.isArray(allowedWarehouseIds)) whFilter._id = { $in: allowedWarehouseIds };
  const sourceWarehouses = await Warehouse.find(whFilter)
    .select("name code")
    .sort({ name: 1 })
    .lean();

  // Sellers this company has issued a live PC to.
  const certs = await PrincipalCertificate.find({ companyId, status: "active" });
  const active = certs.filter((c) => c.isCurrentlyActive());
  const certBySeller = new Map(active.map((c) => [String(c.sellerId), c]));
  const sellerIds = [...certBySeller.keys()];

  const [sellers, sellerWarehouses] = await Promise.all([
    Seller.find({ _id: { $in: sellerIds } }).select("sellerInfo.businessName sellerInfo.city sellerInfo.state contact.ownerName email phone").lean(),
    Warehouse.find({ sellerId: { $in: sellerIds }, isActive: true }).select("name code sellerId").sort({ name: 1 }).lean(),
  ]);
  const whBySeller = new Map();
  for (const w of sellerWarehouses) {
    const key = String(w.sellerId);
    if (!whBySeller.has(key)) whBySeller.set(key, []);
    whBySeller.get(key).push({ _id: String(w._id), name: w.name, code: w.code || null });
  }

  return {
    sourceWarehouses: sourceWarehouses.map((w) => ({ _id: String(w._id), name: w.name, code: w.code || null })),
    sellers: sellers
      .map((s) => ({
        _id: String(s._id),
        // The seller's COMPANY NAME — what the form shows once they are chosen.
        businessName: s.sellerInfo?.businessName || s.contact?.ownerName || "Seller",
        ownerName: s.contact?.ownerName || null,
        city: s.sellerInfo?.city || null,
        state: s.sellerInfo?.state || null,
        phone: s.phone || null,
        email: s.email || null,
        pcNumber: certBySeller.get(String(s._id))?.pcNumber || null,
        warehouses: whBySeller.get(String(s._id)) || [],
      }))
      .sort((a, b) => a.businessName.localeCompare(b.businessName)),
  };
}

/**
 * WHAT THIS WAREHOUSE HAS, per product — the "select the product to transfer"
 * list, and the ceiling the quantity field is validated against.
 *
 * `availableQty` sums availableStock across NON-EXPIRED lots of this warehouse,
 * the same definition the supply "Assign a source warehouse" screen uses
 * (supplyController.getSourceOptions), so the two never disagree.
 *
 * `unitsAvailable` is how many LABELED units are on the shelf for it. Since a
 * transfer is built by scanning, that — not availableQty — is the real ceiling,
 * and showing both makes an un-labelled lot obvious instead of mysterious.
 */
async function warehouseProducts(companyId, { warehouseId, allowedWarehouseIds = null } = {}) {
  await assertSource(companyId, warehouseId, allowedWarehouseIds);

  // EVERY lot this warehouse holds — no filtering in the query. Anything that
  // cannot be transferred is reported as such below instead of disappearing:
  // an operator looking at stock on a shelf must be able to find that product
  // in this list and read WHY it is unavailable.
  const lots = await Inventory.find({
    ownerType: "company", ownerId: companyId, warehouseId,
  })
    .select("productId availableStock reservedStock inTransitStock lotNumber batchNumber has_bulk_packaging expiryDate")
    .lean();
  if (!lots.length) return [];

  // Labeled units on the shelf, per lot. Same owner filter the scan services
  // use (pickScanService / dispatchScanService), so the count can never claim a
  // unit the scanner would then refuse.
  const unitRows = await UnitSerial.aggregate([
    {
      $match: {
        ownerType: "company",
        ownerId: new mongoose.Types.ObjectId(String(companyId)),
        status: PICKABLE_STATUS,
        inventoryId: { $in: lots.map((l) => new mongoose.Types.ObjectId(String(l._id))) },
      },
    },
    { $group: { _id: "$inventoryId", units: { $sum: 1 } } },
  ]);
  const unitsByLot = new Map(unitRows.map((r) => [String(r._id), r.units]));

  const now = new Date();
  const byProduct = new Map();

  for (const l of lots) {
    const pid = String(l.productId);
    if (!byProduct.has(pid)) {
      byProduct.set(pid, {
        productId: pid,
        availableQty: 0,   // TRANSFERABLE: non-expired availableStock (unchanged meaning)
        unitsAvailable: 0, // TRANSFERABLE: labelled units on non-expired lots
        expiredQty: 0,     // held, but past expiry
        reservedQty: 0,    // held, but committed to an order/supply
        pendingQty: 0,     // booked to this warehouse, not yet received
        lots: [],
      });
    }
    const entry = byProduct.get(pid);

    const expired = !!(l.expiryDate && new Date(l.expiryDate) < now);
    const available = Number(l.availableStock || 0);
    const reserved = Number(l.reservedStock || 0);
    const pending = Number(l.inTransitStock || 0);
    const units = unitsByLot.get(String(l._id)) || 0;

    entry.reservedQty += reserved;
    entry.pendingQty += pending;
    if (expired) {
      // Expired stock stays OUT of the transferable totals — the same rule the
      // supply source-warehouse screen applies — but the product still shows.
      entry.expiredQty += available;
    } else {
      entry.availableQty += available;
      entry.unitsAvailable += units;
    }

    // A lot is worth listing if the warehouse physically has anything of it.
    if (available > 0 || units > 0 || pending > 0) {
      entry.lots.push({
        inventoryId: String(l._id),
        lotNumber: l.lotNumber || l.batchNumber,
        availableQty: available,
        unitsAvailable: units,
        pendingQty: pending,
        expired,
        hasBulkPackaging: !!l.has_bulk_packaging,
        expiryDate: l.expiryDate || null,
      });
    }
  }

  const names = await productNames(companyId, [...byProduct.keys()]);

  return [...byProduct.values()]
    // Only drop a product the warehouse holds NOTHING of — a leftover zero row.
    .filter((p) => p.availableQty > 0 || p.unitsAvailable > 0
      || p.expiredQty > 0 || p.pendingQty > 0 || p.reservedQty > 0)
    .map((p) => {
      const meta = names.get(p.productId) || {};
      // Scanning is what fills a transfer, so a product is only transferable
      // when it has BOTH transferable stock and labelled units for it.
      const transferableQty = Math.min(p.availableQty, p.unitsAvailable);
      let blockedReason = null;
      if (transferableQty <= 0) {
        if (p.pendingQty > 0 && p.availableQty <= 0) blockedReason = "awaiting receipt";
        else if (p.expiredQty > 0 && p.availableQty <= 0) blockedReason = "expired";
        else if (p.reservedQty > 0 && p.availableQty <= 0) blockedReason = "reserved";
        else if (p.unitsAvailable <= 0) blockedReason = "no unit labels";
        else blockedReason = "no available stock";
      }
      return {
        ...p,
        productName: meta.productName || "Item",
        skuNumber: meta.skuNumber || null,
        unit: meta.unit || null,
        unitValue: meta.unitValue ?? null,
        transferableQty,
        transferable: transferableQty > 0,
        blockedReason,
        lots: p.lots.sort((a, b) => String(a.lotNumber).localeCompare(String(b.lotNumber))),
      };
    })
    // Transferable products first, then alphabetical.
    .sort((a, b) => (b.transferable ? 1 : 0) - (a.transferable ? 1 : 0)
      || a.productName.localeCompare(b.productName));
}

/**
 * Resolve ONE scanned code for a transfer being built. READ-ONLY — it reserves
 * nothing and moves nothing; the authoritative checks run again inside confirm.
 *
 * `selectedCodes` is what the screen has accumulated so far, so a re-scan is
 * reported as a duplicate instead of silently counting twice.
 */
async function resolveTransferScan(companyId, {
  code, fromWarehouseId, selectedCodes = [], allowedWarehouseIds = null,
  productId = null, requiredQty = null,
  // MULTI-PRODUCT: [{ productId, requiredQty }] — every line of the seller's
  // request. When present the operator does not choose a product at all; the
  // scan is matched to its line, and capped by THAT line's remainder.
  lines = null,
}) {
  const value = norm(code);
  if (!value) throw httpErr(MSG.noCode, 400);
  await assertSource(companyId, fromWarehouseId, allowedWarehouseIds);

  const codes = [...new Set((selectedCodes || []).map(norm).filter(Boolean))];
  if (codes.length > MAX_UNITS) throw httpErr("Too many units in one transfer", 400);
  const selected = new Set(codes);
  // The codes AS THE CLIENT ECHOED THEM. `codes` above is upper-cased for
  // COMPARING (symmetric, both sides folded the same way), which is correct for
  // the duplicate check but wrong for a database lookup — see below.
  const rawCodes = [...new Set((selectedCodes || []).map((c) => String(c || "").trim()).filter(Boolean))];
  // The cap: this transfer is for ONE product and ONE quantity, so a scan may
  // never add a unit of another product, nor take the count past the quantity.
  const scannedPerProduct = Array.isArray(lines) && lines.length
    ? await scannedCountsByProduct(companyId, rawCodes)
    : null;
  const ctx = quantityCtx({ productId, requiredQty, selectedCount: codes.length, lines, scannedPerProduct });

  // The stock must be in the SOURCE warehouse — nowhere else. Passing this as
  // the allowed list to the shared shelf checks is what produces the existing
  // "X is currently at <warehouse>, not <warehouse>" and "not received yet"
  // messages, unchanged.
  const fromWarehouseIds = [String(fromWarehouseId)];

  const box = await BulkPackage.findOne({ company_id: companyId, bulk_packaging_id: value })
    // box_level and parent_box_id are what tell a MAIN carton from an inner one.
    // Without them unitHolderIds cannot cascade into the boxes that actually hold
    // the units, and a main box resolves to nothing at all.
    .select("bulk_packaging_id lot_id status warehouse_id box_serial units_in_box box_level parent_box_id company_id");
  if (box) return scanBox(companyId, box, fromWarehouseIds, selected, ctx);

  /**
   * THE UNIT LOOKUP — matched AS THE CODE IS STORED, not upper-cased.
   *
   * This is the whole three-level fix. `value` is `norm(code)`, i.e. upper-cased,
   * which is right for COMPARING two codes but wrong for querying: stored
   * identifiers are not all upper case. A three-level lot spells the inner-box
   * segment of a UNIT code "BPinner" (lotNumberSegmentService keeps that case on
   * purpose) while the BOX rows spell it "BPINNER" — so an upper-cased lookup
   * found the box fine and never found the unit, and the scan fell through to
   * the lot branch and ended as "unknown code". A two-level lot's unit codes are
   * already all upper case, which is exactly why that case never broke.
   *
   * `findUnit` is the SHARED, case-safe lookup from packagingScanService that
   * the dispatch and receive scans have always used: verbatim first (indexed,
   * the normal path), then anchored case-insensitive for a hand-typed code.
   * Reusing it rather than re-implementing the case handling is what keeps this
   * scan agreeing with the others about what a code means.
   *
   * NOTHING ELSE CHANGES. The unit found here still goes through the very same
   * scanUnit — its Inner Box → parent → lot resolution, the shelf and warehouse
   * checks, ownership, duplicate protection and the quantity cap all run exactly
   * as before.
   */
  const unit = await findUnit(
    companyId,
    String(code || "").trim(),
    "serial unit_code status inventoryId bulk_packaging_id bulk_packaging_record_id",
  );
  // Defensive: only ever act on a record whose stored code IS what was scanned.
  if (unit && (norm(unit.serial) === value || norm(unit.unit_code) === value)) {
    return scanUnit(companyId, unit, fromWarehouseIds, selected, ctx);
  }

  // A lot number can occupy several Inventory rows (a transfer copies the lot
  // identity into the destination warehouse), so the row this scan means is the
  // one in the source warehouse.
  const lotRows = await Inventory.find({
    ownerType: "company", ownerId: companyId,
    $or: [{ lotNumber: value }, { batchNumber: value }],
  }).select("lotNumber batchNumber warehouseId productId availableStock inTransitStock");
  if (lotRows.length) {
    const here = lotRows.find((r) => String(r.warehouseId) === String(fromWarehouseId));
    // Not in this warehouse: hand the first row to the shared check so the
    // operator gets the real reason (wrong warehouse / not received) rather than
    // a blank "unknown code".
    return scanLot(companyId, here || lotRows[0], fromWarehouseIds, selected, ctx);
  }

  throw httpErr(MSG.unknown(value), 404);
}

/**
 * Recent company-initiated transfers, for the history panel on the screen.
 * Warehouse-scoped: an operator sees the transfers sent from their warehouse(s).
 */
async function transferHistory(companyId, { allowedWarehouseIds = null, limit = 20 } = {}) {
  const filter = { companyId, initiatedBy: "company" };
  if (Array.isArray(allowedWarehouseIds)) filter.sourceWarehouseId = { $in: allowedWarehouseIds };

  const rows = await SupplyOrder.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(100, Math.max(1, Number(limit) || 20)))
    .populate({ path: "sellerId", model: "Seller", select: "sellerInfo.businessName" })
    .populate({ path: "items.productId", select: "productName" })
    .populate({ path: "warehouseId", select: "name" })
    .populate({ path: "sourceWarehouseId", select: "name" })
    .lean();

  const shipmentIds = rows.map((r) => r.shipmentId).filter(Boolean);
  const shipments = shipmentIds.length
    ? await Shipment.find({ _id: { $in: shipmentIds }, companyId }).select("status lrNumber qrToken").lean()
    : [];
  const shipmentById = new Map(shipments.map((s) => [String(s._id), s]));
  const boxCounts = await shipmentBoxService.boxCountsForShipments(shipmentIds);

  return rows.map((r) => {
    const ship = shipmentById.get(String(r.shipmentId || "")) || null;
    return {
      _id: String(r._id),
      createdAt: r.createdAt,
      status: r.status,
      seller: r.sellerId?.sellerInfo?.businessName || "Seller",
      destinationWarehouse: r.warehouseId?.name || null,
      sourceWarehouse: r.sourceWarehouseId?.name || null,
      totalUnits: (r.items || []).reduce((s, it) => s + Number(it.quantity || 0), 0),
      products: (r.items || []).map((it) => ({
        productName: it.productId?.productName || "Item",
        quantity: Number(it.quantity || 0),
      })),
      shipmentId: r.shipmentId ? String(r.shipmentId) : null,
      shipmentStatus: ship?.status || null,
      boxCount: boxCounts.get(String(r.shipmentId || ""))?.boxes || 0,
      // The manifest the seller scans to receive. Not secret — the sender may
      // re-display it at any time (see shipmentService.dispatchShipment).
      qrPayload: ship?.qrToken ? `${r.shipmentId}.${ship.qrToken}` : null,
      ref: ship?.lrNumber || (r.shipmentId ? `SH-${String(r.shipmentId).slice(-6).toUpperCase()}` : null),
    };
  });
}

/**
 * The Shipment Box labels of one transfer, for re-printing. Scoped to the
 * company, and to the operator's warehouse when they are assigned to one.
 */
async function transferBoxes(companyId, supplyOrderId, { allowedWarehouseIds = null } = {}) {
  const order = await SupplyOrder.findOne({ _id: supplyOrderId, companyId })
    .select("shipmentId sourceWarehouseId initiatedBy").lean();
  if (!order) throw httpErr("Transfer not found", 404);
  if (Array.isArray(allowedWarehouseIds)
      && !allowedWarehouseIds.map(String).includes(String(order.sourceWarehouseId))) {
    throw httpErr("You are not assigned to that warehouse", 403);
  }
  if (!order.shipmentId) return [];
  return shipmentBoxService.boxesForShipment(order.shipmentId);
}

/**
 * One transfer's paperwork — the three numbers and their uploaded copies, with
 * freshly resolved (signed, short-lived) URLs. Used by the View/Download
 * controls wherever an existing transfer is shown.
 */
async function transferDocuments(companyId, supplyOrderId, { allowedWarehouseIds = null } = {}) {
  const order = await SupplyOrder.findOne({ _id: supplyOrderId, companyId })
    .select("sourceWarehouseId challanNumber billNumber biltyNumber challanDocument billDocument biltyDocument")
    .lean();
  if (!order) throw httpErr("Transfer not found", 404);
  if (Array.isArray(allowedWarehouseIds)
      && !allowedWarehouseIds.map(String).includes(String(order.sourceWarehouseId))) {
    throw httpErr("You are not assigned to that warehouse", 403);
  }
  return {
    challanNumber: order.challanNumber || null,
    billNumber: order.billNumber || null,
    biltyNumber: order.biltyNumber || null,
    documents: await readTransferDocuments(order),
  };
}

/**
 * PREFILL for "Dispatch to Seller".
 *
 * Turns an APPROVED seller supply request into the values the transfer form
 * needs, so the warehouse manager never re-keys the seller, their warehouse or
 * the product. Read-only: it authorises and reads, and changes nothing. The
 * request itself is untouched — the transfer that follows is created the same
 * way as any other (a company-initiated SupplyOrder), so the approval flow keeps
 * working exactly as before.
 *
 * `approvedQty` is the quantity the company ALLOCATED at approval (the sum of
 * the per-lot plan). Where approval recorded no allocation it falls back to the
 * requested quantity, which is what the operator would otherwise read off the
 * request by eye.
 */
async function transferPrefill(companyId, supplyOrderId, { allowedWarehouseIds = null } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(supplyOrderId))) {
    throw httpErr("Supply request not found", 404);
  }
  const order = await SupplyOrder.findOne({ _id: supplyOrderId, companyId })
    .populate({ path: "sellerId", model: "Seller", select: "sellerInfo.businessName contact.ownerName" })
    .populate({ path: "items.productId", select: "productName skuNumber unit" })
    .populate({ path: "warehouseId", select: "name code" })
    .populate({ path: "sourceWarehouseId", select: "name code" })
    .lean();
  if (!order) throw httpErr("Supply request not found", 404);

  // Warehouse-level access, matching supplyController.getSupplyOrderDetails:
  // 404 rather than 403 so an id cannot be used to probe what exists.
  if (Array.isArray(allowedWarehouseIds)
      && !allowedWarehouseIds.map(String).includes(String(order.sourceWarehouseId?._id || order.sourceWarehouseId || ""))) {
    throw httpErr("Supply request not found", 404);
  }

  // Only a request the company has APPROVED can be dispatched. Anything already
  // on its way (or finished) must not be dispatched a second time.
  if (order.status !== "approved") {
    throw httpErr(
      order.status === "requested"
        ? "This request has not been approved yet"
        : `This request is already ${String(order.status).replace(/_/g, " ")}`,
      409
    );
  }

  const items = (order.items || []).map((it) => {
    const approved = (it.allocations || []).reduce((sum, a) => sum + Number(a.qty || 0), 0);
    return {
      productId: String(it.productId?._id || it.productId),
      productName: it.productId?.productName || "Item",
      skuNumber: it.productId?.skuNumber || null,
      unit: it.productId?.unit || null,
      requestedQty: Number(it.quantity || 0),
      approvedQty: approved > 0 ? approved : Number(it.quantity || 0),
    };
  });

  return {
    supplyOrderId: String(order._id),
    requestNumber: `SR-${String(order._id).slice(-6).toUpperCase()}`,
    status: order.status,
    requestedAt: order.createdAt,
    notes: order.notes || null,
    seller: {
      _id: String(order.sellerId?._id || order.sellerId),
      businessName: order.sellerId?.sellerInfo?.businessName || "Seller",
      ownerName: order.sellerId?.contact?.ownerName || null,
    },
    // Where it is going, and where it is coming from — both already decided by
    // the approval, so the form has nothing to ask.
    destinationWarehouse: order.warehouseId
      ? { _id: String(order.warehouseId._id), name: order.warehouseId.name, code: order.warehouseId.code || null }
      : null,
    sourceWarehouse: order.sourceWarehouseId
      ? { _id: String(order.sourceWarehouseId._id), name: order.sourceWarehouseId.name, code: order.sourceWarehouseId.code || null }
      : null,
    items,
    totalApprovedQty: items.reduce((s, i) => s + i.approvedQty, 0),
  };
}

/* --------------------------------------------------------------- confirm */

/**
 * RE-RESOLVE the whole scan payload from the database. The screen's list is UX
 * only; this is what decides. Every unit must:
 *   • exist and be owned by this company
 *   • sit on a lot in the SOURCE warehouse (and that lot must be received)
 *   • be in a carton that is itself received and here, when it is boxed
 *   • still be in_stock — never already picked, packed, shipped or transferred
 *
 * Returns the units grouped the way a SupplyOrder wants them: per product, and
 * per source lot within it.
 */
async function resolveScannedUnits(companyId, codes, fromWarehouseId, { productId = null, quantity = null, lines = null } = {}) {
  const wanted = [...new Set((codes || []).map(norm).filter(Boolean))];
  if (!wanted.length) throw httpErr(MSG.nothingScanned, 400);
  if (wanted.length > MAX_UNITS) throw httpErr("Too many units in one transfer", 400);

  // THE QUANTITY IS THE CONTRACT. When the form declared one, the scan must
  // match it exactly — not fewer (something is still on the floor) and not more
  // (someone scanned past the ceiling). Checked before anything is looked up.
  const declared = Number(quantity);
  if (!Array.isArray(lines) && Number.isFinite(declared) && declared > 0) {
    if (wanted.length < declared) throw httpErr(MSG.incomplete(wanted.length, declared), 409);
    if (wanted.length > declared) throw httpErr(MSG.overQuantity(wanted.length, declared), 409);
  }

  // BOTH SPELLINGS, for the same reason the scan lookup does it: `wanted` is
  // upper-cased for comparison, but a three-level lot's unit codes are stored
  // with a mixed-case "BPinner" segment. Querying only the folded form found
  // none of them, so a transfer whose units came out of an Inner Box failed at
  // confirm with "unknown code" even when every scan had been accepted.
  // The comparison below still uses `wanted`, so the stray check is unchanged.
  const units = await UnitSerial.find({
    companyId, ownerType: "company", ownerId: companyId,
    $or: [
      { serial: { $in: codeVariants(codes) } },
      { unit_code: { $in: codeVariants(codes) } },
    ],
  }).select("serial unit_code status inventoryId productId bulk_packaging_id bulk_packaging_record_id").lean();

  const found = new Map();
  for (const u of units) {
    if (wanted.includes(norm(u.serial))) found.set(norm(u.serial), u);
    else if (wanted.includes(norm(u.unit_code))) found.set(norm(u.unit_code), u);
  }
  const stray = wanted.find((c) => !found.has(c));
  if (stray) throw httpErr(MSG.unknown(stray), 409);

  const fromWarehouseIds = [String(fromWarehouseId)];
  const lotCache = new Map();
  const boxCache = new Map();
  const byLot = new Map(); // inventoryId → { lot, serials[] }

  for (const u of found.values()) {
    const lotKey = String(u.inventoryId);
    if (!lotCache.has(lotKey)) {
      const lot = await loadLot(companyId, u.inventoryId);
      if (!lot) throw httpErr(MSG.elsewhere(u.unit_code || u.serial), 409);
      await assertLotOnShelf(lot, fromWarehouseIds);
      lotCache.set(lotKey, lot);
    }
    const lot = lotCache.get(lotKey);

    if (u.bulk_packaging_record_id) {
      const boxKey = String(u.bulk_packaging_record_id);
      if (!boxCache.has(boxKey)) {
        const box = await BulkPackage.findOne({ _id: u.bulk_packaging_record_id, company_id: companyId })
          .select("bulk_packaging_id status warehouse_id lot_id box_level parent_box_id company_id");
        boxCache.set(boxKey, box || null);
        if (box) await assertBoxOnShelf(box, lot, fromWarehouseIds, { companyId });
      }
    }
    if (u.status !== PICKABLE_STATUS) {
      throw httpErr(MSG.notInStock(u.unit_code || u.serial, u.status), 409);
    }
    // Every unit must belong to the transfer: the one product the operator
    // selected, or one of the requested lines.
    if (productId && String(lot.productId) !== String(productId)) {
      throw httpErr(PICK_MSG.wrongProduct, 409);
    }
    if (Array.isArray(lines) && lines.length
        && !lines.some((l) => String(l.productId) === String(lot.productId))) {
      throw httpErr(PICK_MSG.wrongProduct, 409);
    }

    if (!byLot.has(lotKey)) byLot.set(lotKey, { lot, serials: [] });
    byLot.get(lotKey).serials.push(u.serial);
  }

  // Group the lots under their product — one SupplyOrder item per product, one
  // allocation per source lot, exactly the shape approve+pick would have built.
  const byProduct = new Map();
  for (const { lot, serials } of byLot.values()) {
    const pid = String(lot.productId);
    if (!byProduct.has(pid)) byProduct.set(pid, []);
    byProduct.get(pid).push({ lot, serials });
  }

  // EVERY REQUESTED LINE MUST BE COMPLETE. A multi-product transfer goes out in
  // one consignment, so a line left short (or overfilled) is caught here, before
  // anything is reserved. Names are resolved only to write a readable message.
  if (Array.isArray(lines) && lines.length) {
    const scannedByProduct = new Map();
    for (const { lot, serials } of byLot.values()) {
      const pid = String(lot.productId);
      scannedByProduct.set(pid, (scannedByProduct.get(pid) || 0) + serials.length);
    }
    const wrong = lines
      .map((l) => ({
        productId: String(l.productId),
        required: Number(l.requiredQty) || 0,
        scanned: scannedByProduct.get(String(l.productId)) || 0,
      }))
      .filter((l) => l.required > 0 && l.scanned !== l.required);

    if (wrong.length) {
      const names = await productNames(companyId, wrong.map((l) => l.productId));
      const detail = wrong
        .map((l) => `${names.get(l.productId)?.productName || "Item"} ${l.scanned}/${l.required}`)
        .join(", ");
      const short = wrong.some((l) => l.scanned < l.required);
      throw httpErr(
        short
          ? `Scan every requested unit before transferring — ${detail}`
          : `More units were scanned than requested — ${detail}`,
        409
      );
    }
  }

  // ── WHOLE CARTON, OR UNITS TAKEN OUT OF ONE? ──
  // A unit that belongs to a Bulk Package is only covered by that carton's label
  // if the ENTIRE carton is going on this transfer. Take 5 units out of a
  // 200-unit box and the box stays on the shelf: those 5 are loose, and they
  // need a Shipment Box like any other individually scanned unit.
  const scannedPerCarton = new Map();
  for (const u of found.values()) {
    if (!u.bulk_packaging_record_id) continue;
    const key = String(u.bulk_packaging_record_id);
    scannedPerCarton.set(key, (scannedPerCarton.get(key) || 0) + 1);
  }
  const cartonComplete = new Map();
  for (const [key, scannedCount] of scannedPerCarton.entries()) {
    const onShelf = await cartonUnitCount(companyId, key);
    cartonComplete.set(key, scannedCount >= onShelf);
  }

  // Per-unit facts, straight from the database — including whether the unit may
  // go into a Shipment Box.
  const names = await productNames(companyId, [...byProduct.keys()]);
  const unitIndex = new Map();
  for (const u of found.values()) {
    const lot = lotCache.get(String(u.inventoryId));
    const cartonKey = u.bulk_packaging_record_id ? String(u.bulk_packaging_record_id) : null;
    const wholeCarton = !!cartonKey && cartonComplete.get(cartonKey) === true;
    unitIndex.set(norm(u.serial), {
      serial: u.serial,
      unitCode: u.unit_code || u.serial,
      productId: lot.productId,
      productName: names.get(String(lot.productId))?.productName || null,
      inventoryId: lot._id,
      lotNumber: lot.lotNumber || lot.batchNumber || null,
      // `boxed` now means "its whole carton is travelling, so the Bulk Packaging
      // Label covers it" — NOT merely "it once came from a carton".
      boxed: wholeCarton,
      bulkPackagingId: u.bulk_packaging_id || null,
    });
  }

  return { byProduct, unitIndex };
}

/** Give back everything a failed confirm had already taken. Best-effort. */
async function rollback(companyId, order, performedBy) {
  try {
    for (const it of order.items || []) {
      for (const a of it.allocations || []) {
        if (a.committed) continue;
        const qty = Number(a.reservedQty || 0);
        if (qty > 0) {
          await lotService.releaseLotQty({
            ownerType: "company", ownerId: companyId, inventoryId: a.inventoryId, qty,
            refType: "SupplyOrder", refId: order._id, performedBy,
          }).catch(() => {});
        }
      }
    }
    const serials = (order.items || []).flatMap((it) => (it.allocations || []).flatMap((a) => a.serials || []));
    if (serials.length) {
      await barcodeService.transitionUnits(companyId, serials, {
        toStatus: "in_stock", event: "released", refType: "SupplyOrder", refId: order._id,
        actorId: performedBy, force: true,
      }).catch(() => {});
    }
    // Cartons packed for a transfer that never left are meaningless.
    if (order.shipmentId) {
      await require("../model/Transport/ShipmentBox")
        .deleteMany({ shipmentId: order.shipmentId }).catch(() => {});
    }
    // The transfer never happened, so it must not linger on either portal's
    // supply list. Only ever reached before dispatch.
    await SupplyOrder.deleteOne({ _id: order._id, companyId, status: { $nin: ["dispatched", "in_transit", "arrived", "partially_received", "received", "delivered"] } });
  } catch { /* rollback is best-effort — the original error is what matters */ }
}

/**
 * CONFIRM THE TRANSFER — the single write path.
 *
 * Sequence, all of it on existing rails:
 *   1. authorize the seller (active PC) + both warehouses (ownership)
 *   2. re-resolve every scanned unit from the database
 *   3. record the transfer as a company-initiated SupplyOrder
 *   4. RESERVE each source lot            → lotService.reserveLotQty
 *   5. move the units picked → packed     → barcodeService.transitionUnits
 *   6. create the cross-owner shipment    → shipmentService.createShipment
 *   7. DISPATCH it                        → shipmentService.dispatchShipment
 *      (commits the reservation, sends exactly these serials in-transit, flips
 *       the supply order to "dispatched" and notifies the seller)
 *
 * After step 7 the stock is gone from the company warehouse and the seller
 * receives it through their existing "Scan to receive" screen, which lands it
 * into seller inventory with the lot, box and unit relationships intact.
 */
async function confirmTransfer(companyId, {
  sellerId, destinationWarehouseId, fromWarehouseId, codes = [], notes,
  // Transfer paperwork — stored on the transfer record and shown wherever the
  // transfer is (shipment tracking, the seller's supply detail).
  challanNumber, billNumber, biltyNumber,
  // multer memoryStorage output (upload.fields) — the scanned copy of each doc.
  documentFiles = null,
  // The single-product form declares both; the multi-product path leaves them
  // null and is validated by the scan alone.
  productId = null, quantity = null,
  // MULTI-PRODUCT: [{ productId, requiredQty }] — the seller's requested lines.
  // Every one must be scanned in full for the transfer to go.
  lines = null,
  // The seller request being fulfilled, so the shipment carries its serial.
  supplyOrderId = null,
  // [{ units: [serial, …] }, …] — how the operator grouped the individually
  // scanned units into road cartons. Optional; units already in a Bulk Package
  // are never included (their own label keeps being the one that is scanned).
  boxes = [],
  vehicleNo, transporter, driverName, driverPhone, lrNumber,
  performedBy, allowedWarehouseIds = null,
}) {
  if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) {
    throw httpErr("Select the seller receiving this transfer", 400);
  }
  const source = await assertSource(companyId, fromWarehouseId, allowedWarehouseIds);

  // PAPERWORK IS MANDATORY. Every consignment leaves with a challan, a bill and
  // a bilty number; a transfer without them cannot be reconciled at the seller's
  // gate or in an audit. Checked before anything is reserved or moved.
  const docNumbers = {
    challanNumber: String(challanNumber || "").trim(),
    billNumber: String(billNumber || "").trim(),
    biltyNumber: String(biltyNumber || "").trim(),
  };
  const missingDocs = [
    ["challanNumber", "Challan"],
    ["billNumber", "Bill"],
    ["biltyNumber", "Bilty"],
  ].filter(([k]) => !docNumbers[k]).map(([, label]) => label);
  if (missingDocs.length) {
    throw httpErr(
      `Enter the ${missingDocs.join(", ")} number${missingDocs.length > 1 ? "s" : ""} before transferring`,
      400
    );
  }

  // …and the scanned copy of each. Checked here, before anything is reserved,
  // so a request that skips the upload cannot move stock.
  const missingDocFiles = TRANSFER_DOCS
    .filter(({ field }) => {
      const f = documentFiles?.[field];
      const file = Array.isArray(f) ? f[0] : f;
      return !file || !file.buffer?.length;
    })
    .map(({ label }) => label);
  if (missingDocFiles.length) {
    throw httpErr(
      `Attach the ${missingDocFiles.join(", ")} document${missingDocFiles.length > 1 ? "s" : ""} (PDF or image) before transferring`,
      400
    );
  }

  // AUTHORIZATION: the same "active Principal Certificate" test the seller's own
  // supply request uses, so the two directions can never disagree.
  if (!(await pcService.hasActivePc(sellerId, companyId))) throw httpErr(MSG.notAuthorized, 403);

  // The destination must be a warehouse THAT SELLER owns.
  if (!destinationWarehouseId) throw httpErr("Select the seller warehouse receiving this transfer", 400);
  const dest = await assertSellerWarehouse(sellerId, destinationWarehouseId);

  const { byProduct, unitIndex } = await resolveScannedUnits(
    companyId, codes, fromWarehouseId, { productId, quantity, lines }
  );

  const seller = await Seller.findById(sellerId).select("sellerInfo.businessName").lean();
  const sellerName = seller?.sellerInfo?.businessName || "Seller";

  const storedDocs = await storeTransferDocuments(companyId, documentFiles, performedBy);

  // ── 3. the transfer record ──
  const items = [...byProduct.entries()].map(([productId, groups]) => ({
    productId,
    quantity: groups.reduce((s, g) => s + g.serials.length, 0),
    pickedQty: 0,
    packedQty: 0,
    allocations: groups.map((g) => ({
      inventoryId: g.lot._id,
      lotNumber: g.lot.lotNumber || null,
      batchNumber: g.lot.batchNumber || null,
      warehouseId: g.lot.warehouseId,
      qty: g.serials.length,
      reservedQty: 0,
      committed: false,
      serials: [],
      allocatedAt: new Date(),
      allocatedBy: performedBy || null,
    })),
  }));

  const order = await SupplyOrder.create({
    sellerId,
    companyId,
    initiatedBy: "company",
    sourceRequestId: mongoose.Types.ObjectId.isValid(String(supplyOrderId || "")) ? supplyOrderId : null,
    items,
    warehouseId: destinationWarehouseId,
    sourceWarehouseId: fromWarehouseId,
    notes: notes || undefined,
    ...docNumbers,
    // Uploaded BEFORE the order is created, so a storage failure aborts the
    // transfer cleanly instead of leaving a half-documented dispatch.
    ...storedDocs,
    // "approved" is the state the existing pick path starts from; this transfer
    // walks it forward to packed → dispatched in one operator action.
    status: "approved",
  });

  try {
    // ── 4. reserve, lot by lot (atomic + conditional inside lotService) ──
    for (const item of order.items) {
      for (const a of item.allocations) {
        await lotService.reserveLotQty({
          ownerType: "company", ownerId: companyId, inventoryId: a.inventoryId,
          qty: Number(a.qty || 0), refType: "SupplyOrder", refId: order._id, performedBy,
        });
        a.reservedQty = Number(a.qty || 0);
      }
    }

    // ── 5. the units themselves: in_stock → picked → packed ──
    const allSerials = [...byProduct.values()].flat().flatMap((g) => g.serials);
    const { moved } = await barcodeService.transitionUnits(companyId, allSerials, {
      toStatus: "picked", event: "picked", refType: "SupplyOrder", refId: order._id, actorId: performedBy,
    });
    if (moved.length !== allSerials.length) throw httpErr(MSG.raced, 409);
    await barcodeService.transitionUnits(companyId, allSerials, {
      toStatus: "packed", event: "packed", refType: "SupplyOrder", refId: order._id, actorId: performedBy, force: true,
    });

    // Record the serials on their lot's allocation — this is what dispatch ships
    // (and ONLY what it ships), and what the seller's receipt lands.
    const groupsByLot = new Map();
    for (const groups of byProduct.values()) for (const g of groups) groupsByLot.set(String(g.lot._id), g);
    for (const item of order.items) {
      for (const a of item.allocations) {
        a.serials = [...(groupsByLot.get(String(a.inventoryId))?.serials || [])];
      }
      item.pickedQty = item.quantity;
      item.packedQty = item.quantity;
    }
    order.markModified("items");
    order.status = "packed";
    await order.save();

    // ── 6. the cross-owner shipment ──
    const lines = [];
    for (const item of order.items) {
      for (const a of item.allocations) {
        if (Number(a.reservedQty || 0) <= 0) continue;
        lines.push({
          inventoryId: a.inventoryId, productId: item.productId,
          lotNumber: a.lotNumber, batchNumber: a.batchNumber,
          qty: Number(a.reservedQty), serials: [...(a.serials || [])],
        });
      }
    }
    const shipment = await shipmentService.createShipment(companyId, {
      refType: "SupplyOrder", refId: order._id,
      fromWarehouseId, toType: "seller", toOwnerType: "seller", toOwnerId: sellerId,
      toWarehouseId: destinationWarehouseId,
      toLabel: `${sellerName} (transfer)`,
      lines, vehicleNo, transporter, driverName, driverPhone, lrNumber,
      /**
       * THE CHALLAN IS MIRRORED ONTO THE SHIPMENT.
       *
       * It was already collected and already MANDATORY above — both the number
       * and the scanned copy — but it lived only on the SupplyOrder. The
       * Transfers table reads every row from the SHIPMENT
       * (shipmentService.listShipments → `deliveryChallanNumber` +
       * `challanDocumentUrl`), which is why a Company → Seller row showed an
       * empty Challan cell while a warehouse → warehouse row did not.
       *
       * Writing the SAME two fields the rest of the system already uses is what
       * makes that column light up with no new API, no new column and no
       * frontend change.
       *
       * THE TWO RECORDS SPELL THEIR FIELDS DIFFERENTLY — SupplyOrder stores
       * `fileKey/fileName/mimeType`, Shipment stores `key/name/mime` — so the
       * record is MAPPED across rather than passed through. It is the same
       * stored object either way: only the key is carried over, so the file is
       * never uploaded twice and the SupplyOrder copy stays exactly where it was
       * for the existing Documents view.
       */
      deliveryChallanNumber: docNumbers.challanNumber || undefined,
      ...(storedDocs.challanDocument?.fileKey ? {
        challanDocument: {
          key: storedDocs.challanDocument.fileKey,
          name: storedDocs.challanDocument.fileName,
          mime: storedDocs.challanDocument.mimeType,
          size: storedDocs.challanDocument.size,
        },
      } : {}),
      /* THE BILL AND THE BILTY, mirrored the same way and for the same reason.

         Both were already collected here and already mandatory — they simply
         lived only on the SupplyOrder, so the Transfers table (which reads
         SHIPMENTS) had nothing to print. Both keep the SAME names they carry on
         the SupplyOrder, so the copy is straight across with no re-interpreting.

         Same field-name mapping as above — SupplyOrder spells a stored file
         `fileKey/fileName/mimeType`, Shipment spells it `key/name/mime`. Only
         the key is carried across, so no file is uploaded twice and the
         SupplyOrder copies stay exactly where they are for the Documents view. */
      biltyNumber: docNumbers.biltyNumber || undefined,
      ...(storedDocs.biltyDocument?.fileKey ? {
        biltyDocument: {
          key: storedDocs.biltyDocument.fileKey,
          name: storedDocs.biltyDocument.fileName,
          mime: storedDocs.biltyDocument.mimeType,
          size: storedDocs.biltyDocument.size,
        },
      } : {}),
      billNumber: docNumbers.billNumber || undefined,
      ...(storedDocs.billDocument?.fileKey ? {
        billDocument: {
          key: storedDocs.billDocument.fileKey,
          name: storedDocs.billDocument.fileName,
          mime: storedDocs.billDocument.mimeType,
          size: storedDocs.billDocument.size,
        },
      } : {}),
      performedBy,
    });
    order.shipmentId = shipment._id;
    await order.save();

    // ── 6b. road cartons for the loose units (Bulk Packages keep their own) ──
    const packedBoxes = await shipmentBoxService.packBoxes({
      companyId, shipment, supplyOrderId: order._id, sellerId,
      sourceWarehouseId: fromWarehouseId, destinationWarehouseId,
      groups: boxes, unitIndex, performedBy,
    });

    // ── 7. dispatch: stock leaves, units go in-transit, seller is notified ──
    const { qrPayload } = await shipmentService.dispatchShipment(companyId, shipment._id, { performedBy });
    if (packedBoxes.length) await shipmentBoxService.setBoxStatus(shipment._id, "dispatched");

    // ── THE SELLER REQUEST IS NOW FULFILLED ──
    // Done LAST, and only once the goods are actually on the road: everything
    // above can still fail and roll back, and a request must keep showing on
    // Send Stock until the transfer truly completes. Opening the transfer page,
    // or abandoning it half-way, changes nothing here.
    //
    // No new status is introduced — the request moves to "dispatched", the same
    // status the old Pick → Pack → Dispatch path set, and carries the shipment
    // so the seller can receive against either row. (verifyReceipt refuses a
    // second receipt, so the two cannot double-land.)
    if (order.sourceRequestId) {
      await SupplyOrder.updateOne(
        { _id: order.sourceRequestId, companyId, status: "approved" },
        // `shipment.dispatchedAt` is the schema's own nested path — the same
        // one the old dispatch step wrote.
        { $set: { status: "dispatched", shipmentId: shipment._id, "shipment.dispatchedAt": new Date() } },
      ).catch((e) => {
        // The stock has already left; failing the whole transfer now would be
        // worse than a request that lingers on the list.
        console.error("could not close seller request", String(order.sourceRequestId), e.message);
      });
    }

    // dispatchShipment sets the supply order to "dispatched" itself; re-read so
    // the caller reports the true state rather than our local copy.
    const fresh = await SupplyOrder.findById(order._id).select("status").lean();

    return {
      supplyOrderId: String(order._id),
      shipmentId: String(shipment._id),
      status: fresh?.status || "dispatched",
      qrPayload,
      ref: shipment.lrNumber || `SH-${String(shipment._id).slice(-6).toUpperCase()}`,
      // Every Shipment Box label to print, ready to hand to the packer.
      boxes: packedBoxes.map(shipmentBoxService.boxSummary),
      seller: sellerName,
      challanNumber: order.challanNumber || null,
      billNumber: order.billNumber || null,
      biltyNumber: order.biltyNumber || null,
      documents: await readTransferDocuments(order),
      sourceWarehouse: source?.name || null,
      destinationWarehouse: dest?.name || null,
      totalUnits: lines.reduce((s, l) => s + l.qty, 0),
      items: await (async () => {
        const names = await productNames(companyId, order.items.map((i) => i.productId));
        return order.items.map((i) => ({
          productId: String(i.productId),
          productName: names.get(String(i.productId))?.productName || "Item",
          quantity: i.quantity,
          lots: i.allocations.map((a) => ({
            lotNumber: a.lotNumber || a.batchNumber, quantity: Number(a.reservedQty || 0),
          })),
        }));
      })(),
    };
  } catch (err) {
    await rollback(companyId, order, performedBy);
    throw err;
  }
}

module.exports = {
  MSG,
  TRANSFER_DOCS,
  readTransferDocuments,
  transferOptions,
  warehouseProducts,
  transferBoxes,
  transferDocuments,
  transferPrefill,
  resolveTransferScan,
  transferHistory,
  confirmTransfer,
  _internal: { resolveScannedUnits, assertSource },
};