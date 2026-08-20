/**
 * sellerTraceService.js — read-only Lot Traceability for a SELLER.
 *
 * A seller only ever sees what was dispatched to them and what they now hold.
 * Everything here is scoped to the seller's OWN Inventory row (ownerType
 * "seller", ownerId = sellerId) and the units that point at it — so the
 * company's other warehouses, other sellers' units, reserved/internal
 * quantities, cost price and picking sessions are structurally out of reach.
 *
 * Ownership is decided by database relations (Inventory.ownerId, UnitSerial
 * ownerType/ownerId/inventoryId), never by parsing a code string.
 */

const mongoose = require("mongoose");
const Inventory = require("../model/Inventory/Inventory");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const BulkPackage = require("../model/Inventory/BulkPackage");
// The available-unit rule lives in ONE place; this service only re-owners it.
const barcodeService = require("./barcodeService");
const Warehouse = require("../model/Warehouse/Warehouse");
const Company = require("../model/Company/Company");
const SupplyOrder = require("../model/Supply/SupplyOrder");

const NO_ACCESS = "You do not have access to this inventory lot.";

// A seller "currently holds" a unit in any of these states; the rest
// (sold / dispatched / returned out / damaged / recalled) are history, counted
// separately so current stock is never conflated with total received.
const CURRENT_STATES = new Set(["in_stock", "picked", "packed"]);

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const isId = (v) => v && mongoose.Types.ObjectId.isValid(String(v));

/**
 * The seller's OWN lot row, or a 403. A seller can only open a lot whose stock
 * is (or was) theirs — the ownerType/ownerId filter is the access check.
 */
async function loadSellerLot(sellerId, lotId, { allowedWarehouseIds } = {}) {
  if (!isId(lotId)) throw httpErr(NO_ACCESS, 403);
  const lot = await Inventory.findOne({ _id: lotId, ownerType: "seller", ownerId: sellerId })
    .populate("productId", "productName product_code category unit unitType mrp companyId has_bulk_packaging number_of_boxes units_per_box packagingType")
    // ADDITIVE `address`: Seller → Analytics → View shows the warehouse location.
    .populate("warehouseId", "name code address");
  if (!lot) throw httpErr(NO_ACCESS, 403);

  // Warehouse-scoped seller managers only reach their assigned warehouse(s).
  if (Array.isArray(allowedWarehouseIds)
      && !allowedWarehouseIds.map(String).includes(String(lot.warehouseId?._id || lot.warehouseId))) {
    throw httpErr(NO_ACCESS, 403);
  }
  return lot;
}

/** Supplying company name — the originating manufacturer, from the product. */
async function supplyingCompany(lot) {
  const companyId = lot.productId?.companyId;
  if (!companyId) return null;
  const c = await Company.findById(companyId).select("companyInfo.companyName fullName");
  return c?.companyInfo?.companyName || c?.fullName || null;
}

/**
 * The COMPANY source warehouse this seller lot was supplied from. Resolved from
 * the supply order that fulfilled this seller + product (its sourceWarehouseId).
 * Best-effort and read-only — a name for the trace view, nothing the seller can
 * act on.
 */
async function sourceWarehouseName(sellerId, lot) {
  const so = await SupplyOrder.findOne({
    sellerId, sourceWarehouseId: { $ne: null }, "items.productId": lot.productId?._id || lot.productId,
  }).sort({ createdAt: -1 }).select("sourceWarehouseId");
  if (!so?.sourceWarehouseId) return null;
  const wh = await Warehouse.findById(so.sourceWarehouseId).select("name");
  return wh?.name || null;
}

/** The bare serial strings of this seller lot. */
async function sellerSerials(sellerId, lotId) {
  const rows = await UnitSerial.find({ ownerType: "seller", ownerId: sellerId, inventoryId: lotId })
    .select("serial").lean();
  return rows.map((r) => r.serial);
}

/** When this seller lot was first received, from its supplied_to_seller events. */
async function receivedAt(sellerId, lot) {
  const serials = await sellerSerials(sellerId, lot._id);
  if (!serials.length) return lot.receivedAt || null;
  const ev = await UnitEvent.findOne({ serial: { $in: serials }, event: "supplied_to_seller" })
    .sort({ at: 1 })
    .select("at");
  return ev?.at || lot.receivedAt || null;
}

/** Split a set of unit docs into received-total vs currently-held counts. */
function splitCounts(units) {
  const received = units.length;
  const current = units.filter((u) => CURRENT_STATES.has(u.status)).length;
  return { received, current };
}

/* ---------------------------------------------------------------- summary */

/**
 * The whole details page in one read: lot + product summary, seller stock
 * counts, packaging summary, and the seller-visible Bulk Packaging IDs (units
 * are fetched lazily, per package, by the paginated endpoints below).
 */
async function getLotDetails(sellerId, lotId, { allowedWarehouseIds } = {}) {
  const lot = await loadSellerLot(sellerId, lotId, { allowedWarehouseIds });
  const p = lot.productId || {};

  // Every unit that is (or was) this seller's for this lot.
  const units = await UnitSerial.find({ ownerType: "seller", ownerId: sellerId, inventoryId: lot._id })
    .select("status bulk_packaging_record_id")
    .lean();

  const totalReceived = units.length;
  const currentUnits = units.filter((u) => CURRENT_STATES.has(u.status)).length;

  // ── seller-visible Bulk Packaging IDs ──
  // Group the seller's units by their parent box. A box appears ONLY when the
  // seller holds at least one of its units, and the counts are the seller's —
  // the other units of that box (never sent here) are neither shown nor counted.
  const boxIds = [...new Set(units.map((u) => String(u.bulk_packaging_record_id)).filter((v) => v && v !== "null"))];
  const boxes = boxIds.length
    ? await BulkPackage.find({ _id: { $in: boxIds } })
        .populate("warehouse_id", "name code")
        .lean()
    : [];
  const boxById = new Map(boxes.map((b) => [String(b._id), b]));

  const perBox = new Map();
  for (const u of units) {
    const k = String(u.bulk_packaging_record_id || "");
    if (!boxById.has(k)) continue;
    if (!perBox.has(k)) perBox.set(k, { received: 0, current: 0 });
    const c = perBox.get(k);
    c.received += 1;
    if (CURRENT_STATES.has(u.status)) c.current += 1;
  }

  const bulkPackages = [...perBox.entries()]
    .map(([k, c]) => {
      const box = boxById.get(k);
      return {
        bulkPackageId: String(box._id),
        bulkPackagingId: box.bulk_packaging_id,
        boxSerial: box.box_serial,
        // The lot number PRINTED ON THE CARTON, read off the box record itself.
        // The Labels page prints the same Bulk Packaging label the company
        // prints, and that label carries the box's own lot number.
        lotNumber: box.lot_number || null,
        unitsOriginallyInPackage: box.units_in_box,
        unitsReceivedBySeller: c.received,
        currentUnitsWithSeller: c.current,
        sourceWarehouse: box.warehouse_id?.name || null,
        status: box.status,
        /**
         * WHERE THIS BOX SITS IN THE PACKAGING TREE.
         *
         * Both fields are read straight off the BulkPackage record the company
         * created — this invents no structure and stores nothing. They were
         * simply not projected, so the seller UI had a flat list of boxes and no
         * way to tell an inner box from a main one, or which main box it
         * belonged to. The company Labels page builds its Lot → Main Box → Inner
         * Box → Units tree from exactly these two values.
         *
         * `parentBoxId` is null on a two-level lot, which is what makes the
         * seller page degrade to the same flat Box → Units layout the company
         * page falls back to.
         */
        boxLevel: box.box_level || null,
        parentBoxId: box.parent_box_id ? String(box.parent_box_id) : null,
      };
    })
    .sort((a, b) => (a.boxSerial || 0) - (b.boxSerial || 0));

  /**
   * THE MAIN (OUTER) BOXES above the boxes the seller actually holds.
   *
   * A unit points at the box that PHYSICALLY holds it — for a three-level lot
   * that is the INNER box — so the list above never contains the outer cartons.
   * They are resolved here from the inner boxes' own `parent_box_id`, so a main
   * box appears only when the seller holds at least one unit inside it. Nothing
   * is counted twice: these are a separate level, not extra entries in
   * `bulkPackages`.
   *
   * Empty for a two-level lot, which is precisely the signal the UI uses to fall
   * back to the flat layout.
   */
  /**
   * AN INNER BOX'S NUMBER IS ITS POSITION INSIDE ITS OWN MAIN BOX (1…n),
   * restarting under every main box — NOT its lot-wide `box_serial`, which would
   * read as "box 7 of 10" on a carton that is really box 2 of 5.
   *
   * Derived the same way the company endpoint derives it (lotController), by
   * counting boxes per parent in serial order. Nothing is stored: this is a
   * display index, and computing it identically on both sides is what makes the
   * two pages label the same carton with the same number.
   */
  const seenPerParent = new Map();
  for (const b of bulkPackages) {
    if (!b.parentBoxId) continue;
    const n = (seenPerParent.get(b.parentBoxId) || 0) + 1;
    seenPerParent.set(b.parentBoxId, n);
    b.innerIndex = n;
  }

  const parentIds = [...new Set(bulkPackages.map((b) => b.parentBoxId).filter(Boolean))];
  const mainBoxRows = parentIds.length
    ? await BulkPackage.find({ _id: { $in: parentIds } }).lean()
    : [];
  const mainBoxes = mainBoxRows
    .map((m) => ({
      bulkPackageId: String(m._id),
      bulkPackagingId: m.bulk_packaging_id,
      boxSerial: m.box_serial,
      // As-packed figures straight off the carton record, for its printed label.
      unitsInBox: m.units_in_box,
      lotNumber: m.lot_number || null,
      // How many of this carton's inner boxes the SELLER actually holds — the
      // same count the numbering above ran to, so "inner box 2 of 3" can never
      // disagree with the number of cards rendered beneath it.
      innerTotal: seenPerParent.get(String(m._id)) || 0,
    }))
    .sort((a, b) => (a.boxSerial || 0) - (b.boxSerial || 0));

  const isBulk = bulkPackages.length > 0;
  const [company, sourceWh, recvAt] = await Promise.all([
    supplyingCompany(lot),
    sourceWarehouseName(sellerId, lot),
    receivedAt(sellerId, lot),
  ]);

  const packagingType = isBulk
    ? `${lot.number_of_boxes || bulkPackages.length} Bulk Packages × ${lot.units_per_box || bulkPackages[0]?.unitsOriginallyInPackage || 0} Units`
    : "Single Package / Direct Lot Units";

  return {
    lot: {
      lotId: String(lot._id),
      lotNumber: lot.lotNumber || lot.batchNumber,
      batchNumber: lot.mfgBatchNo || lot.batchNumber || null,
      productName: p.productName || null,
      productCode: p.product_code || null,
      category: p.category || null,
      unit: p.unit || p.unitType || null,
      mrp: p.mrp ?? null,
      mfgDate: lot.mfgDate || null,
      expiryDate: lot.expiryDate || null,
      supplyingCompany: company,
      sourceWarehouse: sourceWh,
      sellerWarehouse: lot.warehouseId?.name || null,
      receivedAt: recvAt,
      packagingType,
      isBulk,
      // ADDITIVE — Seller → Analytics → View reports the lot's stock state and
      // where it sits. Read straight off the lot row and its warehouse; every
      // field above is untouched, so the Lot Details page is unaffected.
      receivingStatus: lot.receiving_status || null,
      lowStockThreshold: Number(lot.lowStockThreshold || 0),
      sellerWarehouseCode: lot.warehouseId?.code || null,
      sellerWarehouseAddress: lot.warehouseId?.address || null,
    },
    stock: {
      // Seller stock counts — deliberately SEPARATE from any company-wide or
      // original lot quantity.
      totalUnitsReceived: totalReceived,
      currentUnits,
      // A lot's live seller quantity as the inventory list computes it.
      currentQuantity: Number(lot.availableStock || 0),
    },
    bulkPackages,
    // ADDITIVE — the outer level of a three-level lot. Absent/empty on every
    // two-level lot, so existing callers that ignore it are unaffected.
    mainBoxes,
  };
}

/**
 * WHICH units make up this seller lot's available quantity — the FULL Unit IDs.
 *
 * The seller-side counterpart of the company answer, and it delegates to the
 * SAME barcodeService.availableUnitIds rather than restating the rule: only the
 * owner pair differs (`seller`/sellerId instead of `company`/companyId), which
 * is exactly what makes a unit supplied downstream stop counting here and start
 * counting there. Access is the usual loadSellerLot check, so a seller can only
 * ever ask about their own lot and a scoped manager only about their warehouse.
 *
 * Read-only.
 */
async function getAvailableUnits(sellerId, lotId, { allowedWarehouseIds } = {}) {
  const lot = await loadSellerLot(sellerId, lotId, { allowedWarehouseIds });
  const { boxed, labelledCount, listed, truncated, groups } =
    await barcodeService.availableUnitIds(sellerId, lot._id, { ownerType: "seller" });
  return {
    inventoryId: lot._id,
    lotNumber: lot.lotNumber || lot.batchNumber || null,
    warehouse: lot.warehouseId?.name || null,
    // The lot row's own figure, so the popup can say plainly when the labels
    // account for less than the balance instead of quietly disagreeing.
    availableStock: Number(lot.availableStock || 0),
    labelledCount,
    listed,
    truncated,
    boxed,
    groups,
  };
}

/* --------------------------------------------------------- paginated units */

/** Shape a unit row for the seller trace tables. */
async function unitRow(u, sourceWhByBox) {
  return {
    unitCode: u.unit_code || u.serial,
    unitSerial: u.unit_serial ?? null,
    bulkPackagingId: u.bulk_packaging_id || null,
    lotNumber: u.lotNumber || u.batchNumber || null,
    receivedStatus: "received",           // it is the seller's, so it was received
    currentStatus: u.status,
    receivedAt: u.createdAt || null,
    sourceWarehouse: u.bulk_packaging_record_id
      ? sourceWhByBox.get(String(u.bulk_packaging_record_id)) || null
      : null,
  };
}

/**
 * Units of ONE seller-received Bulk Packaging box, paginated + searchable.
 * Only the seller's own units of that box are returned — the units of that box
 * that were never sent here simply are not in this seller's UnitSerial set.
 */
async function getPackageUnits(sellerId, lotId, packageId, { page = 1, limit = 50, search = "", allowedWarehouseIds } = {}) {
  await loadSellerLot(sellerId, lotId, { allowedWarehouseIds }); // access gate
  if (!isId(packageId)) throw httpErr("Package not found", 404);

  const filter = {
    ownerType: "seller", ownerId: sellerId, inventoryId: lotId,
    bulk_packaging_record_id: packageId,
  };
  applySearch(filter, search);

  return paginate(filter, page, limit, sellerId);
}

/**
 * Units of a NON-BULK seller lot, paginated + searchable. Excludes any unit
 * that belongs to a box (those are reached through getPackageUnits).
 */
async function getLotUnits(sellerId, lotId, { page = 1, limit = 50, search = "", allowedWarehouseIds } = {}) {
  await loadSellerLot(sellerId, lotId, { allowedWarehouseIds }); // access gate

  const filter = {
    ownerType: "seller", ownerId: sellerId, inventoryId: lotId,
    bulk_packaging_record_id: null,
  };
  applySearch(filter, search);

  return paginate(filter, page, limit, sellerId);
}

function applySearch(filter, search) {
  const q = String(search || "").trim();
  if (!q) return;
  // Anchored, escaped, case-insensitive prefix/substring on the code only.
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  filter.$or = [{ serial: rx }, { unit_code: rx }];
}

async function paginate(filter, page, limit, sellerId) {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(100, Math.max(1, Number(limit) || 50));

  const total = await UnitSerial.countDocuments(filter);
  const rows = await UnitSerial.find(filter)
    .select("serial unit_code unit_serial box_serial bulk_packaging_id bulk_packaging_record_id lotNumber batchNumber status createdAt")
    .sort({ box_serial: 1, unit_serial: 1, serial: 1 })
    .skip((p - 1) * l)
    .limit(l)
    .lean();

  // Resolve each box's company source warehouse once.
  const boxIds = [...new Set(rows.map((r) => String(r.bulk_packaging_record_id)).filter((v) => v && v !== "null"))];
  const sourceWhByBox = new Map();
  if (boxIds.length) {
    const boxes = await BulkPackage.find({ _id: { $in: boxIds } }).populate("warehouse_id", "name").select("warehouse_id").lean();
    for (const b of boxes) sourceWhByBox.set(String(b._id), b.warehouse_id?.name || null);
  }

  const data = await Promise.all(rows.map((u) => unitRow(u, sourceWhByBox)));
  return { data, page: p, limit: l, total, totalPages: Math.ceil(total / l) };
}

/* -------------------------------------------------------------- history */

/**
 * Seller-visible traceability history for this lot: only events the seller is a
 * party to — dispatched to them, received, sold, returned, recalled. Company /
 * warehouse internal events (generated, printed, putaway, picked, packed) are
 * hidden. Aggregated per (event, day) so a 2000-unit lot reads as a handful of
 * rows rather than thousands.
 */
const SELLER_EVENTS = {
  supplied_to_seller: { label: "Received by Seller", to: "Seller" },
  sold: { label: "Unit Sold", from: "Seller", to: "Customer" },
  returned: { label: "Unit Returned", to: "Seller" },
  recalled: { label: "Unit Recalled", from: "Seller" },
};

async function getHistory(sellerId, lotId, { allowedWarehouseIds } = {}) {
  await loadSellerLot(sellerId, lotId, { allowedWarehouseIds }); // access gate

  const serials = await sellerSerials(sellerId, lotId);
  if (!serials.length) return [];

  const events = await UnitEvent.find({
    serial: { $in: serials },
    event: { $in: Object.keys(SELLER_EVENTS) },
  }).select("event at refType refId serial").sort({ at: 1 }).lean();

  // Group by event + calendar day + reference.
  const groups = new Map();
  for (const e of events) {
    const day = e.at ? new Date(e.at).toISOString().slice(0, 10) : "—";
    const key = `${e.event}|${day}|${e.refType || ""}|${String(e.refId || "")}`;
    if (!groups.has(key)) {
      groups.set(key, { event: e.event, at: e.at, refType: e.refType || null, refId: e.refId ? String(e.refId) : null, quantity: 0 });
    }
    groups.get(key).quantity += 1;
  }

  return [...groups.values()]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .map((g) => ({
      at: g.at,
      event: SELLER_EVENTS[g.event]?.label || g.event,
      from: SELLER_EVENTS[g.event]?.from || null,
      to: SELLER_EVENTS[g.event]?.to || null,
      quantity: g.quantity,
      referenceNo: g.refId,
      referenceType: g.refType,
    }));
}

module.exports = {
  getLotDetails,
  getAvailableUnits,
  getPackageUnits,
  getLotUnits,
  getHistory,
  NO_ACCESS,
};