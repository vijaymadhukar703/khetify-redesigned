/**
 * dispatchScanService.js — the scan-out step for a WAREHOUSE→WAREHOUSE transfer.
 *
 * A seller supply is scanned before it can be dispatched (pickScanService). A
 * warehouse transfer had no such step: the sending warehouse pressed Dispatch
 * and the stock left on trust. This gives it the same verification and nothing
 * more — the dispatch itself, the resulting status and every downstream flow are
 * untouched.
 *
 * It counts UNITS AGAINST WHAT THE SHIPMENT REQUIRES, per product, exactly as
 * the pick scan does — which is what makes the two dialogs identical:
 *
 *   Bulk Packaging ID → every available unit in that carton, but ONLY when the
 *                       shipment still needs all of them. A 3-unit box against a
 *                       1-unit requirement is refused: the carton is not going
 *                       out, so its ID must not tick off that unit.
 *   Lot Number        → every available unit of an unboxed lot, same all-or-
 *                       nothing rule.
 *   Unit Code         → one unit.
 *
 * Codes are matched by EXACT string equality against stored identifiers, never
 * parsed — so a manually composed lot number scans like a Khetify-generated one.
 * Every scan runs the same received-and-here checks the pick flow uses
 * (pickScanService.assertLotOnShelf / assertBoxOnShelf), with the same wording.
 */

const Shipment = require("../model/Transport/Shipment");
const Inventory = require("../model/Inventory/Inventory");
const Product = require("../model/Company/productModel");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const { assertLotOnShelf, assertBoxOnShelf, PICKABLE_STATUS } = require("./pickScanService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * WHAT A SCANNED CODE MEANS is shared with the receiving side — same lookups,
 * same case handling, same main-box cascade (services/packagingScanService.js).
 * Only the eligibility rules below are this direction's own.
 */
const {
  norm, matchEither, codeVariants, unitHolderIds, boxStockLocation, findBox, findUnit,
} = require("./packagingScanService");

/** The operator-facing reference for a shipment ("SH-EA951F"). */
const refOf = (shipment) =>
  shipment.lrNumber || `SH-${String(shipment._id).slice(-6).toUpperCase()}`;

const MSG = {
  notOnShipment: (code, ref) => `${code} is not on shipment ${ref}.`,
  duplicate: (code) => `${code} has already been scanned.`,
  unknown: (code) => `Unknown code "${code}".`,
  // The whole carton is not going out, so its ID may not stand for the part
  // that is. Says exactly how many are wanted, and what to do instead.
  partialBox: (need, have, id) =>
    `This shipment needs ${need} of ${have} units from ${id}. Scan the individual unit codes instead.`,
  partialLot: (need, have, number) =>
    `This shipment needs ${need} of ${have} units from ${number}. Scan the individual unit codes instead.`,
  nothingLeft: "Every unit this shipment requires has already been scanned.",
  noneEligible: (id) => `No available units in ${id} — they are already scanned or unavailable.`,
  notInStock: (code, status) => `${code} is not available (${status}).`,
  noUnits: (number) =>
    `Lot ${number} has no unit labels, so it cannot be scanned out. Generate its labels first.`,
  incomplete: (scanned, total) =>
    `Scan every unit before dispatching — ${scanned} of ${total} scanned.`,
};

/**
 * Only a warehouse→warehouse transfer gets this step. Everything else — supply
 * to a seller, a customer delivery, a manual shipment — dispatches as before.
 */
const isWarehouseTransfer = (shipment) =>
  shipment?.toType === "warehouse" && !!shipment?.toWarehouseId;

async function loadShipment(companyId, shipmentId) {
  const shipment = await Shipment.findOne({ _id: shipmentId, companyId });
  if (!shipment) throw httpErr("Shipment not found", 404);
  if (!isWarehouseTransfer(shipment)) throw httpErr("This shipment is not a warehouse transfer", 400);
  return shipment;
}

const LOT_FIELDS = "lotNumber batchNumber warehouseId productId availableStock inTransitStock";

/**
 * What this shipment is: how many units of each PRODUCT it must carry, and
 * WHICH LOTS may be scanned against it.
 *
 * THE TWO ARE NOT THE SAME QUESTION, and treating them as one is what refused a
 * perfectly good carton.
 *
 * The planned lines are an ALLOCATION — `New Shipment` asks only for a product
 * and a quantity, and the server splits that across the source warehouse's lots
 * earliest-expiry-first (shipmentService.createShipment → planAllocation). They
 * say HOW MUCH is going, decided before anyone walked to a shelf. They do not,
 * and cannot, say which physical cartons the operator will reach for: a request
 * for 50 of one product spread over three lots is planned as 40 + 10 out of two
 * of them, and the third lot then read as "not on shipment" however it was
 * scanned — lot number, main carton or inner box alike.
 *
 * So the REQUIRED QUANTITIES still come from the plan, but the scannable lots
 * are every lot of those products on the source warehouse's shelf. Nothing is
 * loosened by it: each scan still runs the same received-and-here checks, still
 * counts against the planned quantity, and the dispatch itself already rewrites
 * its lines from what was actually scanned (see dispatchShipment) — so what
 * leaves is what the operator picked, deducted from the lots it truly came out
 * of.
 */
async function shipmentContext(companyId, shipment) {
  const lines = (shipment.lines || []).filter((l) => l.inventoryId);
  const lotIds = [...new Set(lines.map((l) => String(l.inventoryId)))];
  const lots = await Inventory.find({
    _id: { $in: lotIds },
    ownerType: "company",
    ownerId: companyId,
  }).select(LOT_FIELDS);

  const lotById = new Map(lots.map((l) => [String(l._id), l]));
  // REQUIRED IS READ OFF THE PLAN ONLY — the widening below adds lots that may
  // be scanned, never quantity that must be.
  const required = new Map();
  for (const line of lines) {
    const lot = lotById.get(String(line.inventoryId));
    if (!lot) continue;
    const pid = String(lot.productId);
    required.set(pid, (required.get(pid) || 0) + Number(line.qty || 0));
  }

  // The transfer leaves FROM this warehouse, so that is the only place its
  // stock may currently be.
  const fromWarehouseIds = shipment.fromWarehouseId ? [String(shipment.fromWarehouseId)] : null;

  // EVERY OTHER LOT OF THE SAME PRODUCTS ON THAT SHELF. Scoped by company,
  // product and warehouse, so a lot of another product, another tenant or
  // another warehouse is still refused exactly as before. Not filtered by stock
  // level either: a lot that is empty or still in transit resolves and gets its
  // own honest message ("no available units", "receive it first") rather than
  // the misleading "not on shipment".
  //
  // Skipped when the shipment names no source warehouse — there is then nothing
  // to scope a widening to, so that path keeps its previous behaviour.
  if (fromWarehouseIds && required.size) {
    const siblings = await Inventory.find({
      ownerType: "company",
      ownerId: companyId,
      productId: { $in: [...required.keys()] },
      warehouseId: { $in: fromWarehouseIds },
      _id: { $nin: [...lotById.keys()] },
    }).select(LOT_FIELDS);
    for (const lot of siblings) lotById.set(String(lot._id), lot);
  }

  return { ref: refOf(shipment), lotById, required, fromWarehouseIds };
}

/** The product rows the dialog renders, in the shipment's own order. */
async function dispatchChecklist(companyId, shipmentId) {
  const shipment = await loadShipment(companyId, shipmentId);
  const ctx = await shipmentContext(companyId, shipment);

  const products = await Product.find({ _id: { $in: [...ctx.required.keys()] }, companyId })
    .select("productName")
    .lean();
  const nameById = new Map(products.map((p) => [String(p._id), p.productName]));

  return {
    shipmentId: String(shipment._id),
    ref: ctx.ref,
    fromWarehouseId: shipment.fromWarehouseId ? String(shipment.fromWarehouseId) : null,
    items: [...ctx.required.entries()].map(([productId, requiredQty]) => ({
      productId,
      name: nameById.get(productId) || "Item",
      requiredQty,
      // Every row here is driven by scanning — there is no typed-quantity path.
      trackSerial: true,
    })),
  };
}

/**
 * The units already scanned, counted PER PRODUCT. Resolved from the database,
 * never from what the client says they add up to.
 */
async function countSelected(companyId, selectedCodes, ctx) {
  const codes = [...new Set((selectedCodes || []).map(norm).filter(Boolean))];
  if (!codes.length) return { set: new Set(), byProduct: new Map() };

  // Queried with BOTH spellings: a mixed-case serial ("…BPinner01…") is not
  // found by its upper-cased form, and when this lookup found nothing the
  // per-product tally stayed at zero — which is what let a second scan
  // over-pick past the required quantity.
  const units = await UnitSerial.find({ companyId, serial: { $in: codeVariants(selectedCodes) } })
    .select("serial inventoryId")
    .lean();

  const byProduct = new Map();
  for (const u of units) {
    const lot = ctx.lotById.get(String(u.inventoryId));
    if (!lot) continue;
    const pid = String(lot.productId);
    byProduct.set(pid, (byProduct.get(pid) || 0) + 1);
  }
  return { set: new Set(codes), byProduct };
}

/** How many more units of this product the shipment still needs. */
function remainingFor(ctx, productId, selected) {
  const need = ctx.required.get(String(productId)) || 0;
  return Math.max(0, need - (selected.byProduct.get(String(productId)) || 0));
}

/** Units of this lot that are on the shelf here and could go out. */
function eligibleUnits(companyId, lotId, extra = {}) {
  return UnitSerial.find({
    companyId,
    ownerType: "company",
    ownerId: companyId,
    inventoryId: lotId,
    status: PICKABLE_STATUS,
    ...extra,
  })
    .select("serial unit_code status bulk_packaging_id bulk_packaging_record_id")
    .lean();
}

/** The answer the dialog consumes — the same shape the pick scan returns. */
function result({
  scanType, lot, productId, added, skipped, selected, ctx, bulkPackagingId = null,
  boxLevel = null, boxUnitTotal = null, unavailable = 0,
}) {
  const already = selected.byProduct.get(String(productId)) || 0;
  const scannedQuantity = already + added.length;
  return {
    scanType,
    lotId: String(lot._id),
    lotNumber: lot.lotNumber || lot.batchNumber,
    bulkPackagingId,
    // ADDITIVE — which level the carton was, so the dialog can say "Main box"
    // rather than just "box". `scanType` keeps its existing values.
    boxLevel,
    productId: String(productId),
    addedUnitCodes: added,
    addedQuantity: added.length,
    skippedQuantity: skipped,
    // ADDITIVE — how big the carton is and how much of it could NOT go out
    // (dispatched, damaged, reserved, not yet labelled). Lets the dialog report
    // "Added 20 of 30 — 10 units unavailable" instead of a silent short count.
    boxUnitTotal,
    unavailableQuantity: unavailable,
    scannedQuantity,
    remainingRequired: Math.max(0, (ctx.required.get(String(productId)) || 0) - scannedQuantity),
  };
}

/* ------------------------------------------------------------- scan cases */

/**
 * A WHOLE CARTON — a MAIN bulk packaging box or an inner box.
 *
 * A main box adds every available unit across the inner boxes inside it (see
 * unitHolderIds); an inner box adds its own. Units already scanned — typically
 * because an inner box was scanned before its parent carton — are counted once
 * and once only: `fresh` is what is left after removing them.
 *
 * All-or-nothing against the REQUIREMENT: the shipment must still need every
 * fresh unit in the carton, or the box is not going out whole and its ID must
 * not stand for the part of it that is. Units that are simply unavailable
 * (dispatched, damaged, reserved) do not block the scan — they are reported.
 *
 * WHICH LOT ROW THE CARTON BELONGS TO IS READ FROM ITS UNITS, not from its own
 * `lot_id`. A box is anchored for life to the row it was minted against, while a
 * transfer receipt lands its units on a BRAND-NEW row at the destination — so on
 * the second leg of a Company → Head Office → Indore chain the carton pointed at
 * Head Office's row, which is not on Indore's shipment, and a perfectly good
 * Bulk Packaging ID read as "not on shipment". The units moved; the box record
 * did not; the units are the truth.
 */
async function scanBox(companyId, box, ctx, selected) {
  // Asked once, reused by the shelf check below.
  const boxLocations = new Map();
  const location = await boxStockLocation(companyId, box, boxLocations);

  // Still all-or-nothing about BELONGING: the carton's stock must sit on a lot
  // row this shipment may draw from. A box of a lot the shipment never carries
  // resolves to nothing here and is refused exactly as before.
  const lot = location.inventoryIds.map((id) => ctx.lotById.get(String(id))).find(Boolean);
  if (!lot) throw httpErr(MSG.notOnShipment(box.bulk_packaging_id, ctx.ref), 409);

  await assertLotOnShelf(lot, ctx.fromWarehouseIds);
  await assertBoxOnShelf(box, lot, ctx.fromWarehouseIds, { companyId, cache: boxLocations });

  const holderIds = await unitHolderIds(companyId, box);
  const scope = { bulk_packaging_record_id: { $in: holderIds } };
  const units = await eligibleUnits(companyId, lot._id, scope);
  // Everything physically in the carton, whatever state it is in — the
  // denominator of "Added 20 of 30".
  const boxUnitTotal = await UnitSerial.countDocuments({ companyId, inventoryId: lot._id, ...scope });

  const fresh = units.filter((u) => !selected.set.has(norm(u.serial)));
  if (!fresh.length) {
    const anySelected = units.some((u) => selected.set.has(norm(u.serial)));
    throw httpErr(anySelected ? MSG.duplicate(box.bulk_packaging_id) : MSG.noneEligible(box.bulk_packaging_id), 409);
  }

  const need = remainingFor(ctx, lot.productId, selected);
  if (need <= 0) throw httpErr(MSG.nothingLeft, 409);
  if (fresh.length > need) throw httpErr(MSG.partialBox(need, fresh.length, box.bulk_packaging_id), 409);

  return result({
    scanType: "bulk_package", lot, productId: lot.productId,
    added: fresh.map((u) => u.serial), skipped: units.length - fresh.length,
    selected, ctx, bulkPackagingId: box.bulk_packaging_id,
    boxLevel: box.box_level === "main" ? "main" : "inner",
    boxUnitTotal,
    unavailable: Math.max(0, boxUnitTotal - units.length),
  });
}

/** A whole UNBOXED lot. Same all-or-nothing rule as a carton. */
async function scanLot(companyId, lot, ctx, selected) {
  await assertLotOnShelf(lot, ctx.fromWarehouseIds);

  const number = lot.lotNumber || lot.batchNumber;
  // IS THIS ROW'S STOCK PACKED INTO BOXES? Its own cartons, and — when it has
  // none — the cartons its units still carry. A BulkPackage row stays anchored
  // to the row it was minted against, so `lot_id` alone counts ZERO at a
  // RECEIVING warehouse: a bulk-packed lot silently accepted a bare Lot Number
  // there while the very same scan was refused at the sending warehouse. Both
  // ends now answer the same way, from the same evidence the box scan uses.
  const boxCount = await BulkPackage.countDocuments({ company_id: companyId, lot_id: lot._id })
    || (await UnitSerial.distinct("bulk_packaging_record_id", {
      companyId, ownerType: "company", ownerId: companyId,
      inventoryId: lot._id, bulk_packaging_record_id: { $ne: null },
    })).length;
  if (boxCount > 0) {
    throw httpErr(
      `Lot ${number} is packed into boxes. Scan a Bulk Packaging ID or an individual Unit Code.`,
      409
    );
  }

  const units = await eligibleUnits(companyId, lot._id);
  if (!units.length) throw httpErr(MSG.noUnits(number), 409);

  const fresh = units.filter((u) => !selected.set.has(norm(u.serial)));
  if (!fresh.length) throw httpErr(MSG.duplicate(number), 409);

  const need = remainingFor(ctx, lot.productId, selected);
  if (need <= 0) throw httpErr(MSG.nothingLeft, 409);
  if (fresh.length > need) throw httpErr(MSG.partialLot(need, fresh.length, number), 409);

  return result({
    scanType: "lot", lot, productId: lot.productId,
    added: fresh.map((u) => u.serial), skipped: units.length - fresh.length, selected, ctx,
  });
}

/**
 * ONE UNIT. It must belong to a lot this shipment carries, still be on this
 * warehouse's shelf, and — when it lives in a carton — that carton must itself
 * be received and here.
 */
async function scanUnit(companyId, unit, ctx, selected) {
  const code = unit.unit_code || unit.serial;
  const lot = ctx.lotById.get(String(unit.inventoryId));
  if (!lot) throw httpErr(MSG.notOnShipment(code, ctx.ref), 409);

  if (selected.set.has(norm(unit.serial))) throw httpErr(MSG.duplicate(code), 409);

  await assertLotOnShelf(lot, ctx.fromWarehouseIds);
  if (unit.bulk_packaging_record_id) {
    const box = await BulkPackage.findOne({ _id: unit.bulk_packaging_record_id, company_id: companyId })
      .select("bulk_packaging_id status warehouse_id");
    if (box) await assertBoxOnShelf(box, lot, ctx.fromWarehouseIds, { companyId });
  }

  if (unit.status !== PICKABLE_STATUS) throw httpErr(MSG.notInStock(code, unit.status), 409);
  if (remainingFor(ctx, lot.productId, selected) <= 0) throw httpErr(MSG.nothingLeft, 409);

  return result({
    scanType: "unit", lot, productId: lot.productId,
    added: [unit.serial], skipped: 0, selected, ctx,
    bulkPackagingId: unit.bulk_packaging_id || null,
  });
}

/* ------------------------------------------------------------------ entry */

/**
 * Resolve ONE scanned code against this shipment. Read-only — it moves nothing.
 *
 * Priority only decides which lookup runs first; WHAT the code is comes from
 * which collection actually holds it.
 */
async function resolveDispatchScan(companyId, shipmentId, { code, selectedCodes = [] }) {
  // Kept VERBATIM for the database lookups (see matchEither); comparisons below
  // fold both sides with norm().
  const value = String(code || "").trim();
  if (!value) throw httpErr("A code is required", 400);

  const shipment = await loadShipment(companyId, shipmentId);
  const ctx = await shipmentContext(companyId, shipment);
  const selected = await countSelected(companyId, selectedCodes, ctx);

  // box_level is what tells a MAIN carton from an inner one, so it must be
  // selected here — without it every box looked like an inner box and a main
  // box resolved to zero units.
  const box = await findBox(
    companyId, value,
    "bulk_packaging_id lot_id status warehouse_id box_serial box_level parent_box_id",
  );
  if (box) return scanBox(companyId, box, ctx, selected);

  const unit = await findUnit(
    companyId, value,
    "serial unit_code status inventoryId bulk_packaging_id bulk_packaging_record_id",
  );
  if (unit) return scanUnit(companyId, unit, ctx, selected);

  // A lot number can occupy several Inventory rows; only one of them is on this
  // shipment, so that is the row this scan means.
  const onShipment = [...ctx.lotById.values()].find(
    (l) => norm(l.lotNumber) === norm(value) || norm(l.batchNumber) === norm(value)
  );
  if (onShipment) return scanLot(companyId, onShipment, ctx, selected);

  // Does the code exist elsewhere at all? If it does, the honest answer is "not
  // on this shipment"; if not, it is simply unknown.
  const knownLot = await matchEither(
    (v) => Inventory.exists({
      ownerType: "company",
      ownerId: companyId,
      $or: [{ lotNumber: v }, { batchNumber: v }],
    }),
    value,
  );
  throw knownLot
    ? httpErr(MSG.notOnShipment(value, ctx.ref), 409)
    : httpErr(MSG.unknown(value), 404);
}

/* ------------------------------------------------------- confirm guard */

/**
 * THE WRITE-PATH GUARD, called by dispatchShipment before anything moves.
 *
 * Re-derives what the shipment requires and re-resolves every scanned code from
 * the database — the client's arithmetic is never trusted. Requires the units to
 * cover each product exactly, and each one to still be dispatchable. Two
 * operators dispatching the same transfer at once both land here.
 *
 * Applies ONLY when the caller supplied a scan, which the dispatch dialog always
 * does. A caller that supplies none keeps its previous behaviour, so the
 * existing "dispatch immediately on create" paths are unaffected.
 */
async function assertDispatchScanned(companyId, shipment, scannedCodes) {
  if (!Array.isArray(scannedCodes)) return null;
  if (!isWarehouseTransfer(shipment)) return null;

  const ctx = await shipmentContext(companyId, shipment);
  if (!ctx.required.size) return null;

  const codes = [...new Set(scannedCodes.map(norm).filter(Boolean))];
  // Matched on BOTH spellings — an upper-cased-only lookup found none of a
  // three-level lot's mixed-case serials, so every scanned code read as "stray"
  // and the dispatch was refused after a perfectly good scan.
  const units = await UnitSerial.find({ companyId, serial: { $in: codeVariants(scannedCodes) } })
    .select("serial unit_code status inventoryId bulk_packaging_record_id")
    .lean();
  const found = new Set(units.map((u) => norm(u.serial)));

  // A code that is not a unit of this shipment must not count toward it.
  const stray = codes.find((c) => !found.has(c));
  if (stray) throw httpErr(MSG.notOnShipment(stray, ctx.ref), 409);

  const boxIds = [...new Set(units.map((u) => u.bulk_packaging_record_id).filter(Boolean).map(String))];
  const boxes = boxIds.length
    ? await BulkPackage.find({ _id: { $in: boxIds }, company_id: companyId })
      .select("bulk_packaging_id status warehouse_id")
      .lean()
    : [];
  const boxById = new Map(boxes.map((b) => [String(b._id), b]));

  const byProduct = new Map();
  // WHICH LOT EACH SCANNED UNIT ACTUALLY CAME OUT OF. The shipment's planned
  // lines are an ALLOCATION made before anything was picked (earliest expiry
  // first); what physically left the shelf is decided by the scan. Deducting
  // against the plan is what debited the wrong lot, so the truth is collected
  // here and handed back for the caller to deduct against.
  const byLot = new Map();
  // WHERE EACH CARTON IS, asked once per box rather than once per unit — this
  // loop meets the same box for every one of its units. The dialog resolved the
  // carton the same way (scanBox), so a scan the modal accepted cannot be
  // refused here for having moved warehouse.
  const boxLocations = new Map();
  for (const u of units) {
    const lot = ctx.lotById.get(String(u.inventoryId));
    if (!lot) throw httpErr(MSG.notOnShipment(u.unit_code || u.serial, ctx.ref), 409);

    await assertLotOnShelf(lot, ctx.fromWarehouseIds);
    const box = boxById.get(String(u.bulk_packaging_record_id || ""));
    if (box) await assertBoxOnShelf(box, lot, ctx.fromWarehouseIds, { companyId, cache: boxLocations });
    if (u.status !== PICKABLE_STATUS) throw httpErr(MSG.notInStock(u.unit_code || u.serial, u.status), 409);

    const pid = String(lot.productId);
    byProduct.set(pid, (byProduct.get(pid) || 0) + 1);

    const key = String(lot._id);
    let entry = byLot.get(key);
    if (!entry) {
      entry = {
        inventoryId: lot._id,
        productId: lot.productId,
        lotNumber: lot.lotNumber,
        batchNumber: lot.batchNumber,
        qty: 0,
        serials: [],
      };
      byLot.set(key, entry);
    }
    entry.qty += 1;
    entry.serials.push(u.serial);
  }

  let scanned = 0;
  let total = 0;
  for (const [pid, need] of ctx.required.entries()) {
    total += need;
    scanned += Math.min(need, byProduct.get(pid) || 0);
  }
  if (scanned !== total) throw httpErr(MSG.incomplete(scanned, total), 409);

  return { ref: ctx.ref, count: total, byLot: [...byLot.values()] };
}

/**
 * WHICH LOTS THIS DISPATCH MAY DRAW ON — the one answer, for every caller.
 *
 * The planned lines are an earliest-expiry ALLOCATION, not a picking list, so
 * this is wider than them: every lot of the shipment's products on the source
 * warehouse's shelf (see shipmentContext). The scan resolver has worked that way
 * since multi-lot picking was allowed.
 *
 * Exported because repacking has to agree with it. It did not: the scan accepted
 * a unit from a lot the plan had not named, and then packing those very units
 * into a carton refused them as "not one of this shipment's picked units" —
 * two definitions of the same thing, in two files.
 */
async function eligibleLotIds(companyId, shipment) {
  const ctx = await shipmentContext(companyId, shipment);
  return new Set([...ctx.lotById.keys()]);
}

module.exports = {
  MSG,
  isWarehouseTransfer,
  dispatchChecklist,
  resolveDispatchScan,
  assertDispatchScanned,
  eligibleLotIds,
  refOf,
};
