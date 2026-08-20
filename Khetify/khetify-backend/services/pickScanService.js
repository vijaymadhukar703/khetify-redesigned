/**
 * pickScanService.js — resolves ONE barcode scanned in the Send Stock → Pick
 * modal into the exact set of unit codes it selects.
 *
 * The scan hierarchy the warehouse works with:
 *   1. Bulk Packaging ID  → every eligible unit inside that physical box
 *   2. Unit code (boxed)  → that one unit
 *   3. Lot number         → every eligible unit of a NON-BULK lot
 *   4. Unit code (plain)  → that one unit
 *
 * The TYPE of a scan is decided by an EXACT database lookup, never by parsing
 * the string. A Bulk Packaging ID and the unit codes inside it share a prefix
 * ("…-BP-001" vs "…-BP-001-001"), so guessing from shape would mis-resolve the
 * moment a code format changes; asking the database cannot.
 *
 * Read-only: this moves no stock and reserves nothing. It answers "what would
 * this scan select?" so the modal can accumulate a selection. The authoritative
 * checks run again at Confirm Pick, inside its transaction.
 */

const Order = require("../model/Order/Order");
const SupplyOrder = require("../model/Supply/SupplyOrder");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const Warehouse = require("../model/Warehouse/Warehouse");
// WHERE A CARTON'S STOCK ACTUALLY IS, read from its units — shared with the
// dispatch scan so both flows locate a box the same way.
const { boxStockLocation } = require("./packagingScanService");

// A unit is pickable only from this status. Anything else — picked, packed,
// shipped, sold, returned, damaged, recalled — is deliberately excluded, which
// is also what stops a unit already taken by another open pick from being
// counted here.
const PICKABLE_STATUS = "in_stock";

// Guard rail on the selection the client echoes back; a pick of more than this
// many individual units is not a realistic scan session.
const MAX_SELECTED = 20000;

const MSG = {
  packageScanned: "This Bulk Packaging ID has already been scanned.",
  unitScanned: "This unit has already been scanned.",
  lotScanned: "Every available unit of this lot has already been scanned.",
  bulkLot: "This lot uses Bulk Packaging IDs. Scan a Bulk Packaging ID or individual Unit Code.",
  unknown: (code) => `Unknown code "${code}".`,
  wrongLot: "This code belongs to a lot that is not reserved for this request.",
  wrongProduct: "This code belongs to a different product than the requested item.",
  wrongWarehouse: "This stock is not available in the current warehouse.",
  notReceived: "This stock has not been received by the warehouse yet.",
  packageTooBig: (have, need) =>
    `This package contains ${have} eligible units, but only ${need} units are required. Scan individual Unit Codes instead.`,
  lotTooBig: (have, need) =>
    `This lot contains ${have} eligible units, but only ${need} units are required. Scan individual Unit Codes instead.`,
  nothingLeft: "Required quantity has already been picked.",
  noneEligible: "No available units in this package — they are already picked or unavailable.",
  fullyTransferred: (id) =>
    `${id} has already been transferred out. Its units are no longer in this warehouse.`,
  // SUPPLY only — a sealed box is indivisible, so its available quantity must
  // equal what the request still needs, exactly.
  packageQtyMismatch: (have, need) =>
    `This Bulk Packaging ID contains ${have} units. The remaining quantity is ${need}. `
    + "Bulk Packaging IDs can only be picked when the package quantity exactly matches "
    + "the remaining required quantity.",
  noneEligibleLot: "No available units in this lot — they are already picked or unavailable.",

  // ── stock that exists but may not LEAVE this warehouse yet ──
  // Existing here, but not RECEIVED here, are different things: a box booked to
  // a warehouse is scannable the moment it is dispatched, long before anyone
  // confirms it onto the shelf. Each of these says which it is, and where the
  // stock actually is, so the operator can go and fix it.
  notReceivedBox: (id, where) =>
    `${id} has not been received yet. Receive it before transferring.`
    + ` (Status: in transit${where ? ` to ${where}` : ""}.)`,
  wrongWarehouseBox: (id, at, from) => `${id} is currently at ${at}, not ${from}.`,
  cancelledBox: (id) => `${id} has been cancelled and cannot be transferred.`,
  notReceivedLot: (number, where) =>
    `${number} has not been received yet. Receive it before transferring.`
    + ` (Status: in transit${where ? ` to ${where}` : ""}.)`,
  wrongWarehouseLot: (number, at, from) => `${number} is currently at ${at}, not ${from}.`,
};

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const norm = (v) => String(v || "").trim().toUpperCase();

/**
 * Warehouse names for a message. Best-effort: an id with no row (or none given)
 * simply reads as "another warehouse" at the call site.
 */
async function warehouseNames(ids) {
  const clean = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!clean.length) return new Map();
  const rows = await Warehouse.find({ _id: { $in: clean } }).select("name").lean();
  return new Map(rows.map((w) => [String(w._id), w.name]));
}

const nameOf = (names, id, fallback = "another warehouse") => names.get(String(id)) || fallback;

const fromLabel = (names, allowedWarehouseIds) =>
  (allowedWarehouseIds || []).map((w) => names.get(String(w))).filter(Boolean).join(" / ")
  || "this warehouse";

/**
 * MAY THIS LOT'S STOCK LEAVE THE WAREHOUSE? Two questions, and the answer to
 * both must be yes:
 *
 *   1. RECEIVED — quantity still sitting in `inTransitStock` was dispatched to
 *      the warehouse but never confirmed onto its shelf. It is not there to
 *      send on.
 *   2. LOCATION — the lot row must be in a warehouse the caller may pick from.
 *
 * This used to run only for a LATER-CREATED lot: a lot allocated at approval
 * returned early and was never checked, so a box dispatched to the warehouse
 * and never received could still be scanned out. Both paths are checked now.
 */
async function assertLotOnShelf(lot, allowedWarehouseIds) {
  const number = lot.lotNumber || lot.batchNumber || "This lot";

  if (Array.isArray(allowedWarehouseIds)
      && !allowedWarehouseIds.map(String).includes(String(lot.warehouseId))) {
    const names = await warehouseNames([lot.warehouseId, ...allowedWarehouseIds]);
    throw httpErr(
      MSG.wrongWarehouseLot(number, nameOf(names, lot.warehouseId), fromLabel(names, allowedWarehouseIds)),
      403
    );
  }

  if (Number(lot.availableStock || 0) <= 0 && Number(lot.inTransitStock || 0) > 0) {
    const names = await warehouseNames([lot.warehouseId]);
    throw httpErr(MSG.notReceivedLot(number, names.get(String(lot.warehouseId))), 409);
  }
}

/**
 * MAY THIS BOX LEAVE? Same two questions, asked of the carton itself.
 *
 * A box is "created" from the moment it is minted and only becomes "received"
 * when a warehouse scans it in (bulkPackageService.receiveBox). "created" alone
 * does NOT mean unreceived, though: a lot a warehouse creates for itself is on
 * the shelf immediately and its boxes are never scanned in. What distinguishes
 * the two is the LOT — quantity still in transit means this box's units have
 * not been booked onto any shelf, whoever holds the paperwork.
 *
 * WHERE the box is comes from its UNITS (boxStockLocation), not from its own
 * `warehouse_id`. That field is a denormalised copy of the lot's, frozen at mint
 * time and never rewritten by a transfer receipt — so at a warehouse that
 * RECEIVED the carton it still names the sender, and this check refused stock
 * standing on the shelf in front of the operator.
 *
 * `opts.companyId` scopes that lookup; `opts.cache` is a Map shared by callers
 * that ask about the same carton once per unit.
 */
async function assertBoxOnShelf(box, lot, allowedWarehouseIds, opts = {}) {
  const id = box.bulk_packaging_id;

  if (box.status === "cancelled") throw httpErr(MSG.cancelledBox(id), 409);

  // The carton's REAL location(s). Empty only for a box with no units and no
  // warehouse of its own, where the lot row is the authority — the same
  // fallback chain this check has always used.
  const location = await boxStockLocation(opts.companyId || box.company_id, box, opts.cache || null);
  const boxWarehouses = location.warehouseIds.length
    ? location.warehouseIds
    : [String(box.warehouse_id || lot.warehouseId || "")].filter(Boolean);
  const boxWarehouse = boxWarehouses[0];

  if (box.status !== "received" && Number(lot.inTransitStock || 0) > 0) {
    const names = await warehouseNames(boxWarehouses);
    throw httpErr(MSG.notReceivedBox(id, names.get(String(boxWarehouse))), 409);
  }

  // ANY of them, not all: a carton split by a partial transfer is genuinely at
  // both ends, and the half that stayed here may still leave. Which units
  // actually go is decided by the caller, scoped to this warehouse's lot row.
  if (Array.isArray(allowedWarehouseIds)) {
    const allowed = allowedWarehouseIds.map(String);
    if (!boxWarehouses.some((w) => allowed.includes(w))) {
      const names = await warehouseNames([...boxWarehouses, ...allowedWarehouseIds]);
      throw httpErr(
        MSG.wrongWarehouseBox(id, nameOf(names, boxWarehouse), fromLabel(names, allowedWarehouseIds)),
        403
      );
    }
  }
}

/* ------------------------------------------------------- order context */

/**
 * The request being picked, reduced to what a scan needs: which lots are
 * reserved for it, how much of each product is still required, and which
 * product each lot belongs to.
 */
async function loadContext(companyId, { orderType, orderId }) {
  const isSupply = orderType === "supply";
  const doc = isSupply
    ? await SupplyOrder.findOne({ _id: orderId, companyId })
    : await Order.findOne({ _id: orderId, companyId });
  if (!doc) throw httpErr(isSupply ? "Supply order not found" : "Order not found", 404);

  const qtyField = isSupply ? "quantity" : "qty";
  // inventoryId → the request item that lot is already allocated to.
  const itemByLot = new Map();
  // productId → the request item. This is what makes a LATER-CREATED lot
  // pickable: a lot produced and shipped to the warehouse after approval is
  // matched by PRODUCT, then allocated at pick (see assertLotUsable).
  const itemByProduct = new Map();
  const items = [];
  for (const it of doc.items || []) {
    const entry = {
      productId: String(it.productId?._id || it.productId),
      approvedQty: Number(it[qtyField] || 0),
      pickedQty: Number(it.pickedQty || 0),
    };
    items.push(entry);
    itemByProduct.set(entry.productId, entry);
    for (const a of it.allocations || []) {
      if (a?.inventoryId) itemByLot.set(String(a.inventoryId), entry);
    }
  }

  // A SUPPLY request only AUTHORIZES a quantity — approval records a source-lot
  // plan but reserves no stock (stock moves available → reserved at pick). That
  // is what makes it safe to bind a new lot here. A customer ORDER, by contrast,
  // reserves its FEFO allocations at confirm time, so picking an unreserved lot
  // there would deduct stock that was never reserved; orders keep the strict
  // reserved-lot rule.
  // `isSupply` also selects the INDIVISIBLE-BOX rule in scanBulkPackage, which
  // is a Send Stock → Pick Supply policy and applies to that flow only.
  return { items, itemByLot, itemByProduct, allowDynamicAllocation: isSupply, isSupply };
}

/**
 * Units the client already has selected, counted PER REQUEST ITEM.
 *
 * Counting per item (not per lot) is what makes a multi-lot pick add up: units
 * already taken from lot A and units just scanned from a later-created lot B
 * both count against the same item's approved quantity.
 */
async function loadSelected(companyId, selectedCodes, ctx) {
  const codes = [...new Set((selectedCodes || []).map(norm).filter(Boolean))];
  const byItem = new Map();
  if (!codes.length) return { set: new Set(), byItem };
  if (codes.length > MAX_SELECTED) throw httpErr("Too many units in one pick session", 400);

  const rows = await UnitSerial.find({ companyId, serial: { $in: codes } })
    .select("serial inventoryId productId")
    .lean();

  for (const r of rows) {
    // Allocated lot first; otherwise fall back to the product, which is how a
    // dynamically-allocated (later-created) lot is attributed to its item.
    const item = ctx.itemByLot.get(String(r.inventoryId))
      || ctx.itemByProduct.get(String(r.productId));
    if (!item) continue;
    byItem.set(item, (byItem.get(item) || 0) + 1);
  }
  return { set: new Set(codes), byItem };
}

/** How many more units of this item the request still needs. */
function remainingFor(ctx, item, selected) {
  const alreadySelected = selected.byItem.get(item) || 0;
  return Math.max(0, item.approvedQty - item.pickedQty - alreadySelected);
}

/**
 * Decide whether this lot may be picked for this request, and against which
 * item.
 *
 * TWO ways a lot qualifies:
 *   1. It was allocated at approval — the original rule.
 *   2. LATER-CREATED LOT: it was not planned at approval, but it holds the
 *      REQUESTED PRODUCT, it has been received into the picker's warehouse and
 *      it has stock on the books. The allocation is then created at Confirm
 *      Pick. A request may therefore be fulfilled from several lots.
 *
 * Path 2 is deliberately narrow: the product must match, the warehouse must be
 * the caller's, and the stock must actually be on the shelf — a lot still
 * awaiting the warehouse's Receive confirmation is refused.
 *
 * Returns { item, lot, dynamic } — `dynamic` marks an allocation that does not
 * exist yet.
 */
async function assertLotUsable(companyId, lotId, ctx, allowedWarehouseIds) {
  const lot = await Inventory.findOne({ _id: lotId, ownerType: "company", ownerId: companyId })
    .select("lotNumber batchNumber warehouseId has_bulk_packaging productId availableStock inTransitStock");
  if (!lot) throw httpErr(MSG.wrongLot, 409);

  // RECEIVED + LOCATION, for EVERY path. Being allocated to the request says
  // the paperwork is right; it says nothing about whether the stock has landed.
  await assertLotOnShelf(lot, allowedWarehouseIds);

  const allocated = ctx.itemByLot.get(String(lotId));
  if (allocated) return { item: allocated, lot, dynamic: false };

  if (!ctx.allowDynamicAllocation) throw httpErr(MSG.wrongLot, 409);

  // ── later-created lot ──
  const item = ctx.itemByProduct.get(String(lot.productId));
  if (!item) throw httpErr(MSG.wrongProduct, 409);

  // Nothing on the books at all — not in transit either, so this is simply not
  // this warehouse's stock.
  if (Number(lot.availableStock || 0) <= 0) throw httpErr(MSG.wrongWarehouse, 409);

  return { item, lot, dynamic: true };
}

/* --------------------------------------------------------- scan cases */

/** Shape the answer the modal consumes. */
function result({ scanType, lot, item, added, skipped, selected, bulkPackagingId = null, dynamic = false }) {
  const currentPickedQuantity = item.pickedQty + (selected.byItem.get(item) || 0) + added.length;
  return {
    scanType,
    lotId: String(lot._id),
    lotNumber: lot.lotNumber || lot.batchNumber,
    warehouseId: lot.warehouseId ? String(lot.warehouseId) : null,
    bulkPackagingId,
    productId: item.productId,
    // True when this lot was not planned at approval and will be allocated to
    // the request at Confirm Pick.
    newAllocation: dynamic,
    addedUnitCodes: added,
    addedQuantity: added.length,
    skippedQuantity: skipped,
    currentPickedQuantity,
    remainingRequired: Math.max(0, item.approvedQty - currentPickedQuantity),
  };
}

/**
 * CASE 1 — a whole physical box.
 *
 * SUPPLY (Send Stock → Pick Supply) treats a Bulk Packaging ID as INDIVISIBLE:
 * a sealed carton ships whole or not at all, so the box's available quantity
 * must EQUAL what the request still needs. 99 or 101 against a 100-unit box are
 * both refused — the first would split the carton, the second would over-pick
 * it. A short-fall is picked by Lot or by individual Unit Codes instead.
 *
 * The customer-ORDER pick keeps its original top-up behaviour (a box may fill
 * part of a line); this rule was specified for Pick Supply only.
 */
async function scanBulkPackage(companyId, box, ctx, selected, allowedWarehouseIds) {
  const { item, lot, dynamic } = await assertLotUsable(companyId, box.lot_id, ctx, allowedWarehouseIds);
  // THE CARTON'S OWN state, on top of its lot's: existing is not the same as
  // being received here. A box dispatched to this warehouse and never scanned
  // in is refused, by name and with where it actually is.
  await assertBoxOnShelf(box, lot, allowedWarehouseIds, { companyId });

  const units = await UnitSerial.find({
    companyId, ownerType: "company", ownerId: companyId,
    bulk_packaging_record_id: box._id,
  }).select("serial status inventoryId").lean();

  // AVAILABILITY IS COUNTED, NEVER READ OFF THE BOX. `units_in_box` is the
  // ORIGINAL size of the carton and never changes; what this warehouse still
  // holds does. A warehouse→warehouse transfer repoints a moved unit's
  // `inventoryId` to the destination row (shipmentService, transfer receipt) but
  // leaves `bulk_packaging_record_id` alone, so a box query that is not scoped
  // to THIS warehouse's lot row keeps finding units that physically left —
  // which is how a fully-transferred Bulk Packaging ID stayed scannable here.
  const here = units.filter((u) => String(u.inventoryId) === String(lot._id));
  if (units.length && !here.length) throw httpErr(MSG.fullyTransferred(box.bulk_packaging_id), 409);

  // THE BOX'S AVAILABLE QUANTITY — counted, not read off `units_in_box`.
  const available = here.filter((u) => u.status === PICKABLE_STATUS);
  const need = remainingFor(ctx, item, selected);

  // Skipped = units still in this warehouse that the scan could not take. Units
  // that have left are not "skipped", they are simply not here.
  const asResult = (added) => result({
    scanType: "bulk_package", lot, item, added,
    skipped: here.length - added.length, selected, dynamic,
    bulkPackagingId: box.bulk_packaging_id,
  });

  if (ctx.isSupply) {
    if (!available.length) throw httpErr(MSG.noneEligible, 409);
    // Any unit of the box already in the selection — a repeat box scan, or units
    // scanned one by one — means it can no longer go in as a COMPLETE package.
    if (available.some((u) => selected.set.has(u.serial))) throw httpErr(MSG.packageScanned, 409);
    if (need <= 0) throw httpErr(MSG.nothingLeft, 409);
    // No partial dispatch, no over-dispatch, no splitting.
    if (available.length !== need) throw httpErr(MSG.packageQtyMismatch(available.length, need), 409);
    return asResult(available.map((u) => u.serial));
  }

  // ── customer ORDER pick — unchanged ──
  const eligible = available.filter((u) => !selected.set.has(u.serial));
  // Everything in this box is already in the selection → a repeat scan.
  if (!eligible.length) {
    const anySelected = here.some((u) => selected.set.has(u.serial));
    throw httpErr(anySelected ? MSG.packageScanned : MSG.noneEligible, 409);
  }
  if (need <= 0) throw httpErr(MSG.nothingLeft, 409);
  // A whole-package scan is all-or-nothing: taking part of a box would leave the
  // physical carton split with no record of which half moved.
  if (eligible.length > need) throw httpErr(MSG.packageTooBig(eligible.length, need), 409);

  return asResult(eligible.map((u) => u.serial));
}

/** CASES 2 & 4 — one individual unit, boxed or not. */
async function scanUnit(companyId, unit, ctx, selected, allowedWarehouseIds) {
  if (selected.set.has(unit.serial)) throw httpErr(MSG.unitScanned, 409);
  const { item, lot, dynamic } = await assertLotUsable(companyId, unit.inventoryId, ctx, allowedWarehouseIds);

  // A unit inside a carton inherits the carton's state — one unit cannot be
  // taken out of a box the warehouse has not received.
  if (unit.bulk_packaging_record_id) {
    const box = await BulkPackage.findOne({
      _id: unit.bulk_packaging_record_id,
      company_id: companyId,
    }).select("bulk_packaging_id status warehouse_id");
    if (box) await assertBoxOnShelf(box, lot, allowedWarehouseIds, { companyId });
  }

  if (unit.status !== PICKABLE_STATUS) {
    throw httpErr(
      ["picked", "packed", "shipped"].includes(unit.status)
        ? "This unit is already reserved or in transit."
        : `This unit is not available (${unit.status}).`,
      409
    );
  }
  if (remainingFor(ctx, item, selected) <= 0) throw httpErr(MSG.nothingLeft, 409);

  return result({
    scanType: "unit", lot, item, added: [unit.serial], skipped: 0, selected, dynamic,
    bulkPackagingId: unit.bulk_packaging_id || null,
  });
}

/** CASE 3 — a NON-BULK lot number: take the whole lot. */
async function scanLot(companyId, lotRow, ctx, selected, allowedWarehouseIds) {
  const { item, lot, dynamic } = await assertLotUsable(companyId, lotRow._id, ctx, allowedWarehouseIds);

  // A lot packed into boxes must move box by box — see BulkPackage.
  const boxCount = await BulkPackage.countDocuments({ company_id: companyId, lot_id: lot._id });
  if (boxCount > 0) throw httpErr(MSG.bulkLot, 409);

  const units = await UnitSerial.find({
    companyId, ownerType: "company", ownerId: companyId, inventoryId: lot._id,
  }).select("serial status").lean();

  const eligible = units.filter((u) => u.status === PICKABLE_STATUS && !selected.set.has(u.serial));
  if (!eligible.length) {
    const anySelected = units.some((u) => selected.set.has(u.serial));
    throw httpErr(anySelected ? MSG.lotScanned : MSG.noneEligibleLot, 409);
  }

  const need = remainingFor(ctx, item, selected);
  if (need <= 0) throw httpErr(MSG.nothingLeft, 409);
  if (eligible.length > need) throw httpErr(MSG.lotTooBig(eligible.length, need), 409);

  const added = eligible.map((u) => u.serial);
  return result({
    scanType: "lot", lot, item, added,
    skipped: units.length - added.length, selected, dynamic,
  });
}

/* ------------------------------------------------------------- entry */

/**
 * Resolve `code` against the database, in priority order:
 *   1. exact Bulk Packaging ID
 *   2. exact unit code (serial, or the unit_code mirror)
 *   3. exact lot number (or its batch shadow)
 *
 * The priority only decides which lookup runs first — what the code IS comes
 * from which collection actually holds it.
 */
async function resolvePickScan(companyId, { code, orderType, orderId, selectedCodes = [], allowedWarehouseIds = null }) {
  const value = norm(code);
  if (!value) throw httpErr("A code is required", 400);

  const ctx = await loadContext(companyId, { orderType, orderId });
  const selected = await loadSelected(companyId, selectedCodes, ctx);

  const box = await BulkPackage.findOne({ company_id: companyId, bulk_packaging_id: value });
  if (box) return scanBulkPackage(companyId, box, ctx, selected, allowedWarehouseIds);

  const unit = await UnitSerial.findOne({
    companyId,
    $or: [{ serial: value }, { unit_code: value }],
  }).select("serial unit_code status inventoryId bulk_packaging_id bulk_packaging_record_id");
  // Defensive: only ever act on a record whose stored code IS what was scanned.
  if (unit && (norm(unit.serial) === value || norm(unit.unit_code) === value)) {
    return scanUnit(companyId, unit, ctx, selected, allowedWarehouseIds);
  }

  // A lot number can occupy SEVERAL Inventory rows (a transfer copies the lot
  // identity into the destination warehouse), so choose the row this scan
  // actually means: the one already allocated to the request, else — for a
  // later-created lot — the one sitting in the picker's warehouse with stock on
  // the books. assertLotUsable then re-checks whichever row is chosen.
  const lotRows = await Inventory.find({
    ownerType: "company", ownerId: companyId,
    $or: [{ lotNumber: value }, { batchNumber: value }],
  }).select("_id warehouseId productId availableStock");
  if (lotRows.length) {
    const inScope = (r) => !Array.isArray(allowedWarehouseIds)
      || allowedWarehouseIds.map(String).includes(String(r.warehouseId));
    const chosen =
      lotRows.find((r) => ctx.itemByLot.has(String(r._id)))
      || (ctx.allowDynamicAllocation
        ? lotRows.find((r) => inScope(r) && Number(r.availableStock || 0) > 0)
          || lotRows.find((r) => inScope(r))
          // Nothing usable, but the lot DOES exist — hand the first row to
          // assertLotUsable so the operator gets the real reason (wrong
          // warehouse / wrong product / not received yet) instead of a blanket
          // "not reserved for this request".
          || lotRows[0]
        : null);
    if (!chosen) throw httpErr(MSG.wrongLot, 409);
    return scanLot(companyId, chosen, ctx, selected, allowedWarehouseIds);
  }

  throw httpErr(MSG.unknown(value), 404);
}

/* ------------------------------------------------- confirm-pick guard */

/**
 * Re-validate a Confirm Pick payload SERVER-SIDE. The modal's counts are UX
 * only — this is what actually decides, and it runs for both the order and the
 * supply pick paths.
 *
 * Checks, in order:
 *   • duplicates inside the payload (["S1","S1"] would otherwise count as 2)
 *   • every serial exists and belongs to this company
 *   • its lot is one this request may draw from — either already allocated, or
 *     (supply only) a LATER-CREATED lot of the requested product that this
 *     warehouse has received
 *   • its lot sits in a warehouse the caller may pick from
 *   • it is still pickable (not already picked / packed / shipped / damaged …)
 *   • the total does not exceed what the request still needs
 *
 * Returns { serials, newLots } — the de-duplicated list to act on, and the lots
 * that still need an allocation record creating for them.
 */
async function validateConfirmPick(companyId, {
  serials, allocByInv, remainingRequired, allowedWarehouseIds = null,
  // Supply picks may bind a lot that was not planned at approval. Orders may
  // not: their FEFO allocations were reserved at confirm time.
  allowDynamicAllocation = false,
  productId = null,
}) {
  const wanted = (serials || []).map(norm).filter(Boolean);
  if (!wanted.length) throw httpErr("serials are required", 400);

  // De-duplicate but keep scan order, so the count can never be inflated by a
  // repeated code in the payload.
  const unique = [...new Set(wanted)];

  const units = await UnitSerial.find({ companyId, serial: { $in: unique } })
    .select("serial status inventoryId productId bulk_packaging_record_id")
    .lean();
  const bySerial = new Map(units.map((u) => [u.serial, u]));

  // Warehouse ownership and receipt are properties of the unit's LOT.
  const lotIds = [...new Set(units.map((u) => String(u.inventoryId)))];
  const lots = await Inventory.find({ _id: { $in: lotIds }, ownerType: "company", ownerId: companyId })
    .select("warehouseId productId lotNumber batchNumber availableStock inTransitStock")
    .lean();
  const lotById = new Map(lots.map((l) => [String(l._id), l]));

  // …and of the CARTON, for a unit that sits in one.
  const boxIds = [...new Set(units.map((u) => u.bulk_packaging_record_id).filter(Boolean).map(String))];
  const boxes = boxIds.length
    ? await BulkPackage.find({ _id: { $in: boxIds }, company_id: companyId })
      .select("bulk_packaging_id status warehouse_id")
      .lean()
    : [];
  const boxById = new Map(boxes.map((b) => [String(b._id), b]));

  // Lots the caller must create an allocation for (later-created lots).
  const newLots = new Map();
  // One location lookup per CARTON, not per serial — this loop asks about the
  // same box once for every unit inside it.
  const boxLocations = new Map();

  for (const s of unique) {
    const u = bySerial.get(s);
    if (!u) throw httpErr(`Unknown serial ${s}`, 409);

    const lotId = String(u.inventoryId);
    const lot = lotById.get(lotId);
    if (!lot) throw httpErr(`Serial ${s} is not from this company's stock`, 409);

    // RECEIVED + LOCATION, for every serial, allocated or not. This is the
    // write path: whatever the client believed when it scanned, stock that is
    // still in transit — or in another warehouse — cannot leave here. Two
    // operators scanning the same box at once both land on this check.
    await assertLotOnShelf(lot, allowedWarehouseIds);
    const box = boxById.get(String(u.bulk_packaging_record_id || ""));
    if (box) await assertBoxOnShelf(box, lot, allowedWarehouseIds, { companyId, cache: boxLocations });

    if (!allocByInv.has(lotId)) {
      if (!allowDynamicAllocation) {
        throw httpErr(`Serial ${s} is not from this request's reserved lots`, 409);
      }
      // LATER-CREATED LOT — bind it, but only if it really is this product and
      // really is on this warehouse's shelf.
      if (productId && String(lot.productId) !== String(productId)) {
        throw httpErr(`Serial ${s}: ${MSG.wrongProduct}`, 409);
      }
      if (Number(lot.availableStock || 0) <= 0) {
        throw httpErr(`Serial ${s}: ${MSG.wrongWarehouse}`, 409);
      }
      if (!newLots.has(lotId)) {
        newLots.set(lotId, {
          inventoryId: lot._id,
          lotNumber: lot.lotNumber || lot.batchNumber,
          batchNumber: lot.batchNumber,
          warehouseId: lot.warehouseId,
          count: 0,
        });
      }
      newLots.get(lotId).count += 1;
    }

    if (u.status !== PICKABLE_STATUS) throw httpErr(`Serial ${s} is ${u.status}, cannot pick`, 409);
  }

  if (Number.isFinite(remainingRequired) && unique.length > remainingRequired) {
    throw httpErr(
      `Picked quantity (${unique.length}) exceeds the ${remainingRequired} unit(s) still required for this item`,
      409
    );
  }

  return { serials: unique, newLots: [...newLots.values()] };
}

module.exports = {
  resolvePickScan,
  validateConfirmPick,
  // Shared with the warehouse-transfer dispatch scan so BOTH flows reject
  // unreceived / mislocated stock with the very same wording.
  assertLotOnShelf,
  assertBoxOnShelf,
  MSG,
  PICKABLE_STATUS,
};
