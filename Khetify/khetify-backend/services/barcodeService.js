const mongoose = require("mongoose");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const Inventory = require("../model/Inventory/Inventory");
const Product = require("../model/Company/productModel");
const Location = require("../model/Warehouse/Location");
const Order = require("../model/Order/Order");
const InventoryBin = require("../model/Inventory/InventoryBin");
const BulkPackage = require("../model/Inventory/BulkPackage");
const { nextSeqBlock } = require("./counterService");
const { buildUnitId } = require("./lotNumberSegmentService");
const { unitHoldingBoxes } = require("./bulkPackageService");
const { hasCapability, isWarehouseRole } = require("../config/permissions");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const MAX_GENERATE = 10000;

/**
 * Owner-aware scoping. Accepts EITHER an owner object { ownerType, ownerId }
 * OR a bare companyId (legacy callers → treated as the company owner). This
 * keeps every existing internal caller (pick/pack/dispatch/shipment/pos, which
 * pass companyId) working unchanged, while letting seller callers pass an
 * explicit owner.
 */
function normalizeOwner(owner) {
  if (owner && typeof owner === "object" && owner.ownerType) {
    return { ownerType: owner.ownerType, ownerId: owner.ownerId };
  }
  return { ownerType: "company", ownerId: owner };
}

/* ------------------------------------------------------------- formats */

/**
 * LEGACY lot barcode content: K-L-<companyShort>-<sku>-<lot>.
 *
 * DO NOT USE FOR NEW LABELS, and it is wired to nothing. It STRIPS every
 * character outside [A-Z0-9] from the lot number, so for a composed number
 * ("BHO-BAT/876-GP001~GP005") it produces a string that matches no stored lot
 * and can never be scanned back. A label must encode the identifier byte for
 * byte — which is what the label components do: they render `lot.lotNumber`
 * itself, through Code 128 (khetifyApp/src/lib/barcode128.jsx), which can carry
 * "/", "~" and "-" unchanged.
 *
 * Kept only so an old caller cannot silently disappear; resolveScan still
 * decodes labels printed in this shape.
 */
function lotBarcode(companyShort, sku, lot) {
  const c = (companyShort || "CO").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  const s = (sku || "GEN").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `K-L-${c}-${s}-${String(lot).toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
}

/** Sanitize a lot/batch number for use inside a Code-128 serial. */
function lotKey(lot) {
  return String(lot || "LOT").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Unit serial: <LOTNUMBER>-<seq, 3+ padded>. The visible sequence is the lot
 * number followed by a running number (e.g. lot "UR-2026-JUN-001" →
 * UR2026JUN001-001 … -050). There is NO prefix: serials are stored bare and
 * resolveScan() looks them up directly (tolerating a legacy "K-U-" on labels
 * printed before the prefix was dropped). Sequence is unique per lot (see
 * generateUnits).
 */
function unitSerial(lot, seq) {
  return `${lotKey(lot)}-${String(seq).padStart(3, "0")}`;
}

/**
 * Unit code for a unit inside a BULK PACKAGING BOX:
 * <BULK_PACKAGING_ID>-<UNIT_SERIAL, 3-padded>, e.g.
 * KH-BHO-URE838-2026-07-0002-BP-001-005.
 *
 * Unlike the lot-based serial above, the Bulk Packaging ID is NOT stripped of
 * its separators — the box ID is a human-readable identity that the operator
 * reads off the outer carton, and Code 128 (and Code 39) encode "-" fine. The
 * per-unit number restarts at 001 inside every box; global uniqueness comes
 * from the box ID prefix, which is itself globally unique.
 *
 * FALLBACK FORMAT. A lot whose number was composed from segments numbers its
 * units continuously across the lot instead — its number states one unbroken
 * unit range, so a per-box restart would contradict the carton. See
 * buildContinuousBoxUnitDocs.
 */
function boxUnitCode(bulkPackagingId, seq) {
  return `${String(bulkPackagingId).toUpperCase()}-${String(seq).padStart(3, "0")}`;
}

const qrFor = (serial) => JSON.stringify({ t: "unit", s: serial });

/* ------------------------------------------------------------ generate */

const BULK_CONFIG_INCOMPLETE = "Bulk Packaging configuration is incomplete for this lot.";
const BULK_BOX_MISSING = "A Bulk Packaging ID is missing for one or more boxes.";

/**
 * SINGLE-PACKAGE LOT (Lot → Units) — the original, unchanged path. The counter
 * is keyed on the lot number, so the sequence is continuous across every batch
 * printed for that lot.
 */
async function buildLotUnitDocs(companyId, inv, lot, qty, base) {
  const { start, end } = await nextSeqBlock(companyId, `unit-lot-${lotKey(lot)}`, qty);
  const docs = [];
  for (let seq = start; seq <= end; seq++) {
    // A lot whose number was COMPOSED from segments spells its units with the
    // operator's own SKU prefix and digit width, at the position the SKU part
    // holds in the number. Every other lot keeps the historical <LOT>-<NNN>.
    const serial = buildUnitId(inv, { unitNumber: seq }) || unitSerial(lot, seq);
    docs.push({ ...base, serial, unit_code: serial, unit_serial: seq, qr: qrFor(serial) });
  }
  return docs;
}

/**
 * BULK PACKAGING LOT built from a COMPOSED lot number.
 *
 * The lot number states ONE continuous unit range (…-UI0001~UI1000-…), so the
 * units must actually run 1…1000 across the whole lot — they may NOT restart at
 * 0001 inside each box, or the range on the carton would name units that do not
 * exist. One lot-wide counter therefore allocates every unit number, and each
 * one is filed into the box that holds it: units 1…perBox in box 1, the next
 * perBox in box 2, and so on. That mapping is pure arithmetic, so a partial
 * generation resumes in exactly the right box.
 *
 * The counter is the SAME key the single-package path uses, so a lot can never
 * hand out one unit number twice however it is packed.
 */
async function buildContinuousBoxUnitDocs(companyId, inv, boxes, qty, base) {
  const perBox = Number(inv.units_per_box);
  const capacity = boxes.length * perBox;
  const lot = inv.lotNumber || inv.batchNumber || String(inv._id);

  const { start, end } = await nextSeqBlock(companyId, `unit-lot-${lotKey(lot)}`, qty);
  if (end > capacity) throw httpErr(`This lot holds at most ${capacity} unit(s).`, 409);

  const docs = [];
  for (let seq = start; seq <= end; seq++) {
    const box = boxes[Math.ceil(seq / perBox) - 1];
    const code = buildUnitId(inv, { boxSerial: box.box_serial, unitNumber: seq });
    docs.push({
      ...base,
      serial: code,
      unit_code: code,
      unit_serial: seq,
      qr: qrFor(code),
      bulk_packaging_record_id: box._id,
      bulk_packaging_id: box.bulk_packaging_id,
      box_serial: box.box_serial,
    });
  }
  return docs;
}

/**
 * BULK PACKAGING LOT (Lot → Box → Units) — fill the boxes IN ORDER: BP-001
 * first, then BP-002, and so on. A box never takes more than `units_per_box`
 * units, so a partial generation always resumes exactly where the last one
 * stopped.
 *
 * Slots inside a box are allocated through the SAME atomic counter the lot path
 * uses, keyed per box. That is what makes two concurrent generate calls safe:
 * they receive disjoint ranges, so neither can hand out a unit number the other
 * already took, and the per-box cap below is checked against the allocated
 * range rather than a racy count.
 */
async function buildBoxUnitDocs(companyId, inv, qty, base) {
  const perBox = Number(inv.units_per_box);
  const boxCount = Number(inv.number_of_boxes);
  if (!perBox || perBox <= 0 || !boxCount || boxCount <= 0) throw httpErr(BULK_CONFIG_INCOMPLETE, 400);

  // The boxes that HOLD units — a three-level lot's outer cartons are not
  // filled directly, so they must not consume slots here.
  const boxes = unitHoldingBoxes(
    await BulkPackage.find({ company_id: companyId, lot_id: inv._id }).sort({ box_serial: 1 })
  );
  // Every box the lot claims to have must actually exist as a record.
  if (boxes.length !== boxCount) throw httpErr(BULK_BOX_MISSING, 400);
  if (boxes.some((b) => !b.bulk_packaging_id)) throw httpErr(BULK_BOX_MISSING, 400);

  // COMPOSED lot number → one continuous unit range across the lot.
  if (buildUnitId(inv, { boxSerial: 1, unitNumber: 1 })) {
    return buildContinuousBoxUnitDocs(companyId, inv, boxes, qty, base);
  }

  const docs = [];
  let remaining = qty;

  for (const box of boxes) {
    if (remaining <= 0) break;

    // How many slots this box still has. Counting the units already linked to it
    // is what makes a repeat generate a no-op for boxes that are already full.
    const used = await UnitSerial.countDocuments({ bulk_packaging_record_id: box._id });
    const free = perBox - used;
    if (free <= 0) continue;

    const take = Math.min(free, remaining);
    const { start, end } = await nextSeqBlock(companyId, `unit-box-${box.bulk_packaging_id}`, take);
    // A box may never hold more than units_per_box units — if the counter has
    // run past the box capacity, refuse rather than mint an over-numbered unit.
    if (end > perBox) throw httpErr(`Box ${box.box_serial} can hold at most ${perBox} unit(s).`, 409);

    for (let seq = start; seq <= end; seq++) {
      const code = boxUnitCode(box.bulk_packaging_id, seq);
      docs.push({
        ...base,
        serial: code,
        unit_code: code,
        unit_serial: seq,
        qr: qrFor(code),
        bulk_packaging_record_id: box._id,
        bulk_packaging_id: box.bulk_packaging_id,
        box_serial: box.box_serial,
      });
    }
    remaining -= take;
  }

  if (!docs.length) throw httpErr("Every box in this lot is already fully labelled.", 409);
  return docs;
}

/**
 * Bulk-generate `qty` unit serials for an inventory (lot) row. Each serial is
 * the lot number followed by a running sequence (<LOT>-<NNN>). The counter
 * is keyed on the lot number, so the sequence is continuous and unique across
 * every batch printed for that lot. Reserves a contiguous counter block so
 * serials are unique without per-unit round-trips, then inserts them with
 * status "generated". Marks the product trackSerial.
 *
 * `role` (optional) is the caller's role. Child unit serials are controlled by
 * the MAIN COMPANY, so a company-warehouse role is rejected here — the route's
 * authorize("lot:receive") cannot express this, because warehouse roles need
 * that same capability for GRN/receive. Omitting `role` does not bypass
 * anything: the route middleware still gates the request.
 */
async function generateUnits(companyId, inventoryId, qty, { performedBy, role } = {}) {
  // Generation is COMPANY-ONLY — sellers never mint serials (keeps `serial`
  // globally unique and collision-free). Reject a seller owner.
  const owner = normalizeOwner(companyId);
  if (owner.ownerType !== "company") throw httpErr("Sellers cannot generate unit serials", 403);
  // ...and within the company, only the MAIN COMPANY mints them. A warehouse
  // views, prints and reprints the labels it received; it never creates new unit
  // records. Enforced server-side: the disabled button is UX only.
  if (isWarehouseRole(role)) throw httpErr("Only the Main Company can generate unit labels.", 403);
  companyId = owner.ownerId;

  qty = Number(qty);
  if (!inventoryId || !qty || qty <= 0) throw httpErr("inventoryId and positive qty are required");
  if (qty > MAX_GENERATE) throw httpErr(`Cannot generate more than ${MAX_GENERATE} at once`);

  const inv = await Inventory.findOne({ _id: inventoryId, ownerId: companyId, ownerType: "company" });
  if (!inv) throw httpErr("Inventory row not found", 404);

  // LABEL CAPACITY = the lot's ORIGINAL CREATED QUANTITY.
  //
  // A unit label is a physical sticker for a unit that was MANUFACTURED into
  // this lot, so the number you may print is fixed the moment the lot is
  // created. It must NOT follow live stock: a lot created at 100 that has since
  // dispatched 40 still has 100 physical units in the world, and the company
  // must still be able to print (or reprint) all 100 labels. Reading live stock
  // also reported 0 for a lot the warehouse hadn't received yet.
  //
  // originalQuantity is immutable — written once by lotService.receiveLot via
  // $setOnInsert and never touched by any movement. Rows that predate it (the
  // 005-original-lot-quantity migration could not prove a value) fall back to
  // on-hand + in-transit, which is the closest thing those rows have.
  const existing = await UnitSerial.countDocuments({ companyId, inventoryId: inv._id });
  const cap = typeof inv.originalQuantity === "number"
    ? inv.originalQuantity
    : Number(inv.availableStock || 0) + Number(inv.inTransitStock || 0);
  if (existing + qty > cap) {
    const remaining = Math.max(0, cap - existing);
    throw httpErr(
      remaining === 0
        ? "All unit labels for this lot have already been generated."
        : `Lot was created with ${cap} unit(s)${existing ? ` and ${existing} are already labelled` : ""} — you can generate at most ${remaining} more.`,
      409
    );
  }

  // ROOT-CAUSE FIX (parent-lot / unit-serial warehouse assignment):
  // When the parent lot (this Inventory row) is ALREADY assigned to a warehouse,
  // its stock is physically on hand there — so serials minted afterwards are
  // AVAILABLE in that warehouse immediately. They are already tied to the
  // warehouse through `inventoryId` (Inventory.warehouseId is the lot's
  // warehouse), so we do NOT add a duplicate warehouse field; we only start them
  // in this model's available/pickable state ("in_stock") instead of "generated"
  // (which would otherwise wait for a putaway that this direct-create flow never
  // performs). Unassigned lots (warehouseId === null) keep the original
  // "generated" flow untouched — no behaviour change for GRN/putaway-less lots.
  //
  // This adds NO stock: serials are tracking records over the lot's EXISTING
  // quantity. The cap check above already prevents ever labelling more units
  // than the lot holds, and re-generate/reprint can't create duplicates.
  // A lot that is still AWAITING the warehouse's Confirm Receive is not stock
  // yet, so its serials must NOT be pickable: they stay "generated" and are
  // activated to "in_stock" by lotService.confirmLotReceipt. Only a lot whose
  // stock is genuinely on the books mints available units.
  const pendingReceipt = Number(inv.inTransitStock || 0) > 0 && Number(inv.availableStock || 0) <= 0;
  const warehoused = !!inv.warehouseId && !pendingReceipt;
  const initialStatus = warehoused ? "in_stock" : "generated";
  const lot = inv.lotNumber || inv.batchNumber || String(inv._id);

  const base = {
    companyId,
    ownerType: "company",
    ownerId: companyId,
    productId: inv.productId,
    inventoryId: inv._id,
    lotNumber: inv.lotNumber,
    batchNumber: inv.batchNumber,
    status: initialStatus,
  };

  // BULK PACKAGING lot → units are minted INTO BOXES, in box order, and their
  // codes descend from the box ID. Everything else keeps the historical
  // lot-based serial untouched.
  const docs = inv.has_bulk_packaging
    ? await buildBoxUnitDocs(companyId, inv, qty, base)
    : await buildLotUnitDocs(companyId, inv, lot, qty, base);

  await UnitSerial.insertMany(docs, { ordered: false });

  // Trace: record availability at the lot's warehouse for units minted straight
  // into stock (keeps the unit lifecycle coherent for later pick/transfer).
  if (warehoused) {
    await UnitEvent.insertMany(
      docs.map((d) => ({ companyId, serial: d.serial, event: "in_stock", fromStatus: "generated", toStatus: "in_stock", refType: "Lot", refId: inv._id, actorId: performedBy })),
      { ordered: false }
    );
  }

  // Generating serials implies the product is serial-tracked going forward.
  await Product.updateOne({ _id: inv.productId, companyId }, { $set: { trackSerial: true } });

  return { generated: docs.length, firstSerial: docs[0].serial, lastSerial: docs[docs.length - 1].serial, status: initialStatus };
}

/**
 * MINT WHATEVER LABELS THIS LOT IS STILL MISSING, for the whole lot at once.
 *
 * Unit labels used to appear only when an operator pressed Generate, for
 * whatever quantity they typed. Since generation fills the boxes IN ORDER, a lot
 * of 4 × 250 that was generated at 250 ended up with box 1 fully labelled and
 * boxes 2-4 with nothing — which is why a received box could show "No unit
 * labels generated for this box yet" while its neighbour listed all of them.
 *
 * This asks for the SHORTFALL against the lot's created quantity, so:
 *   • a fresh lot gets every box's labels in one go;
 *   • a partly-labelled lot is topped up into exactly the boxes that lack them,
 *     because generateUnits skips boxes that are already full;
 *   • numbering continues across the lot rather than restarting per box, so the
 *     range the lot number declares (…-SKU0001~SKU1000-…) stays true;
 *   • re-running is a no-op once the lot is complete.
 *
 * Used at lot creation (lotService.receiveLot) and by the backfill script, so
 * both repair a lot by the same rule.
 */
async function ensureLotUnitLabels(companyId, inventoryId, { performedBy } = {}) {
  const inv = await Inventory.findOne({ _id: inventoryId, ownerId: companyId, ownerType: "company" });
  if (!inv) return { generated: 0, reason: "lot not found" };

  // The lot's CREATED quantity is what may be labelled — the same cap
  // generateUnits enforces. Never live stock.
  const cap = typeof inv.originalQuantity === "number"
    ? inv.originalQuantity
    : Number(inv.availableStock || 0) + Number(inv.inTransitStock || 0);
  const existing = await UnitSerial.countDocuments({ companyId, inventoryId: inv._id });
  const missing = cap - existing;
  if (missing <= 0) return { generated: 0, reason: "already complete" };

  return generateUnits(companyId, inv._id, missing, { performedBy });
}

/* -------------------------------------------------------------- queries */

/**
 * How many unit labels exist per lot, for EVERY lot of this owner, in one query.
 *
 * The Labels page needs this to show each lot's remaining label capacity in the
 * dropdown; loading the units of every lot just to count them would be one
 * request (and thousands of documents) per lot. Returns { <inventoryId>: n }.
 */
async function unitCountsByLot(owner, { identityScope = false } = {}) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  const rows = await UnitSerial.aggregate([
    { $match: { ownerType, ownerId: new mongoose.Types.ObjectId(String(ownerId)) } },
    { $group: { _id: "$inventoryId", count: { $sum: 1 } } },
  ]);
  const byRow = rows.reduce((acc, r) => { acc[String(r._id)] = r.count; return acc; }, {});
  if (!identityScope) return byRow;

  // COMPANY SCOPE — see listUnits. The dropdown keys on inventoryId, so the
  // per-row counts are summed per LOT NUMBER and every row of that lot is given
  // the whole figure: the company reads one lot of 20, not a 12 here and an 8
  // there that both look like short lots.
  const lots = await Inventory.find({ ownerType, ownerId, _id: { $in: Object.keys(byRow) } })
    .select("lotNumber batchNumber")
    .lean();
  const identityOf = new Map(lots.map((l) => [String(l._id), l.lotNumber || l.batchNumber || String(l._id)]));

  const totals = new Map();
  for (const [rowId, n] of Object.entries(byRow)) {
    const key = identityOf.get(rowId) || rowId;
    totals.set(key, (totals.get(key) || 0) + n);
  }
  // Every row of the company's books, not only those that already hold units —
  // a destination row whose units all moved on still belongs to the same lot.
  const allRows = await Inventory.find({ ownerType, ownerId }).select("lotNumber batchNumber").lean();
  return allRows.reduce((acc, r) => {
    const key = r.lotNumber || r.batchNumber || String(r._id);
    const n = totals.get(key);
    if (n) acc[String(r._id)] = n;
    return acc;
  }, {});
}

/**
 * The unit labels of a lot.
 *
 * `identityScope` — WHOSE QUESTION IS BEING ASKED.
 *
 * A lot is one Inventory row PER WAREHOUSE, and a warehouse→warehouse transfer
 * repoints a moved unit's `inventoryId` to the destination row. So the default,
 * row-scoped answer ("units attributed to this row") is the right one for a
 * WAREHOUSE: it holds what it holds.
 *
 * It is the wrong answer for the COMPANY, which owns both warehouses. Reading a
 * 20-unit lot through one of its rows after 10 units moved on returned 10, and
 * the Labels page then reported "10 of 20 unit(s) already labelled — you can
 * generate up to 10 more" for a lot that was fully labelled the day it was
 * created. The stock never left the company; only its address changed.
 *
 * With identityScope the set is every unit ever minted for this lot NUMBER,
 * whichever row now holds it. Each unit still carries `inventoryId`, so a caller
 * can say where it currently is.
 */
async function listUnits(owner, {
  inventoryId, lotNumber, status, limit = 2000, identityScope = false, excludeDispatched = false,
} = {}) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  const filter = { ownerType, ownerId };

  // ALREADY ON A TRUCK. A dispatched unit keeps `inventoryId` pointing at the
  // sending row until the far end receives it, so a row-scoped list went on
  // offering its labels for printing after the goods had gone. Opt-in, because
  // the COMPANY still owns those labels wherever the stock is.
  if (excludeDispatched) filter.status = { $ne: "shipped" };

  // Resolve the row to the lot IDENTITY it belongs to, and ask by that instead.
  const lot = identityScope && inventoryId && !lotNumber
    ? await Inventory.findOne({ _id: inventoryId, ownerType, ownerId }).select("lotNumber batchNumber").lean()
    : null;
  const identity = lot?.lotNumber || lot?.batchNumber || null;

  if (identity) filter.$or = [{ lotNumber: identity }, { batchNumber: identity }];
  else if (inventoryId) filter.inventoryId = inventoryId;
  if (lotNumber) filter.lotNumber = lotNumber;
  if (status) filter.status = status;

  return UnitSerial.find(filter).sort({ serial: 1 }).limit(Math.min(Number(limit) || 2000, 10000));
}

/* --------------------------------------------------------- transitions */

// Allowed forward transitions (and recall/return as special cases).
const NEXT = {
  generated: ["printed", "in_stock", "recalled", "damaged"],
  printed: ["in_stock", "recalled", "damaged"],
  in_stock: ["picked", "recalled", "damaged"],
  picked: ["packed", "in_stock", "recalled"],
  packed: ["shipped", "picked", "recalled"],
  shipped: ["sold", "returned"],
  sold: ["returned"],
  returned: ["in_stock", "damaged"],
  damaged: [],
  recalled: [],
};

/**
 * Transition a set of serials to a new status, writing one UnitEvent each.
 * Skips serials that cannot legally make the transition unless `force`.
 */
async function transitionUnits(owner, serials, { toStatus, event, refType, refId, locationId, actorId, set = {}, force = false } = {}) {
  if (!Array.isArray(serials) || !serials.length) throw httpErr("serials are required");
  // Scope to the CURRENT owner — a seller can only transition units they own,
  // a company only its own. UnitEvent.companyId stays the unit's originating
  // company (immutable trace root), regardless of who now holds it.
  const { ownerType, ownerId } = normalizeOwner(owner);
  const units = await UnitSerial.find({ ownerType, ownerId, serial: { $in: serials } });
  const moved = [];
  const skipped = [];
  const events = [];
  for (const u of units) {
    if (!force && !(NEXT[u.status] || []).includes(toStatus)) {
      skipped.push({ serial: u.serial, from: u.status });
      continue;
    }
    const update = { status: toStatus, ...set };
    if (locationId !== undefined) update.currentLocationId = locationId;
    // COMPARE-AND-SWAP on the status we just read. Without the status in the
    // filter, two pickers scanning the same unit at the same moment both pass
    // the NEXT[] check above and both write "picked" — the unit would be picked
    // into two different orders. Matching on the observed status means only one
    // of them can win; the loser is reported as skipped.
    // matchedCount (not modifiedCount): a forced no-op transition to the same
    // status modifies nothing yet is still a legitimate match.
    const r = await UnitSerial.updateOne({ _id: u._id, status: u.status }, { $set: update });
    if (!r.matchedCount) {
      skipped.push({ serial: u.serial, from: u.status });
      continue;
    }
    events.push({
      companyId: u.companyId, serial: u.serial, event: event || toStatus,
      fromStatus: u.status, toStatus, refType, refId, locationId, actorId,
    });
    moved.push(u.serial);
  }
  if (events.length) await UnitEvent.insertMany(events, { ordered: false });
  return { moved, skipped };
}

/**
 * Print / RE-PRINT labels for the owner's units. First print moves a freshly
 * "generated" unit to "printed"; re-printing a unit that's already advanced
 * (printed / in_stock / …) does NOT regress its lifecycle status — it just logs
 * a "printed" event. Owner-scoped, so a seller can only (re)print units it owns.
 */
async function markPrinted(owner, serials, { actorId } = {}) {
  if (!Array.isArray(serials) || !serials.length) throw httpErr("serials are required");
  const { ownerType, ownerId } = normalizeOwner(owner);
  const units = await UnitSerial.find({ ownerType, ownerId, serial: { $in: serials } });
  const moved = [];
  const events = [];
  for (const u of units) {
    // First print of a still-"generated" unit advances it to "printed"; a unit
    // already put away/available ("in_stock", etc.) keeps its stock status but
    // is still flagged printed. The `printed` flag is what the Labels page reads,
    // so it is set here for EVERY unit (independent of the stock status).
    const toStatus = u.status === "generated" ? "printed" : u.status;
    const set = { printed: true, printedAt: new Date() };
    if (u.status === "generated") set.status = "printed";
    await UnitSerial.updateOne({ _id: u._id }, { $set: set });
    events.push({ companyId: u.companyId, serial: u.serial, event: "printed", fromStatus: u.status, toStatus, refType: "Label", actorId });
    moved.push(u.serial);
  }
  if (events.length) await UnitEvent.insertMany(events, { ordered: false });
  return { moved, skipped: [] };
}

async function unitHistory(owner, serial) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  // Serials are globally unique — look up by serial, then authorize: visible to
  // the CURRENT owner OR to the ORIGINATING company (full-chain trace).
  const unit = await UnitSerial.findOne({ serial }).populate("productId", "productName skuNumber").populate("currentLocationId", "fullCode");
  if (!unit) throw httpErr("Serial not found", 404);
  const isCurrentOwner = unit.ownerType === ownerType && String(unit.ownerId) === String(ownerId);
  const isOriginatingCompany = ownerType === "company" && String(unit.companyId) === String(ownerId);
  if (!isCurrentOwner && !isOriginatingCompany) throw httpErr("Serial not found", 404);
  // Events are keyed by serial (no owner) so the FULL chain is returned.
  const events = await UnitEvent.find({ serial }).sort({ at: 1 });
  return { unit, events };
}

/* -------------------------------------------------------------- scan */

/** Lot rows holding this exact number, under either identity column. */
function lotRowsFor({ ownerId, ownerType, code }) {
  const forms = [code, code.toUpperCase()];
  return Inventory.find({
    ownerId,
    ownerType,
    $or: [{ lotNumber: { $in: forms } }, { batchNumber: { $in: forms } }],
  }).populate("productId", "productName skuNumber");
}

/**
 * A scan that matched nothing, recorded verbatim.
 *
 * The character codes are logged alongside the text because THAT is what makes
 * a byte-for-byte mismatch visible: a label rendered through a symbology that
 * silently drops "~", or a scanner emitting a different dash, looks identical
 * on screen and never matches. Printed only on a miss, so a working scanner is
 * never noisy.
 */
function logScanMiss({ ownerType, ownerId, rawCode, code }) {
  const bytes = [...code].map((ch) => ch.charCodeAt(0)).join(",");
  console.warn(
    "[scan] no match",
    JSON.stringify({
      owner: `${ownerType}:${ownerId}`,
      raw: String(rawCode ?? ""),
      scanned: code,
      length: code.length,
      charCodes: bytes,
    })
  );
}

function nextActionsFor(type, status, role) {
  const can = (c) => hasCapability(role, c);
  if (type === "unit") {
    const actions = [];
    if (["generated", "printed", "returned"].includes(status) && can("putaway:execute")) actions.push("putaway");
    if (status === "in_stock" && can("order:create")) actions.push("pick");
    if (status === "picked" && can("order:create")) actions.push("pack");
    if (status === "packed" && can("shipment:read")) actions.push("dispatch");
    return actions;
  }
  if (type === "location" && can("location:read")) return ["view_bin"];
  if (type === "lot" && can("lot:read")) return ["view_lot"];
  return [];
}

/**
 * Single scan entry point. Returns the matched entity plus role-aware next
 * actions.
 *
 * THE SCANNED STRING IS NEVER PARSED TO DECIDE WHAT IT IS. It is trimmed and
 * then matched, whole and exactly, against the identifiers actually stored in
 * the database — unit serial, lot number, Bulk Packaging ID, bin code. A lot
 * number composed by an operator may contain "/" and "~" and may have any
 * number of "-"-separated parts, so any regex, prefix test, segment count or
 * split("-") would reject legitimate codes; asking the database is the only
 * thing that stays correct for every format.
 *
 * The one remaining pattern test is the LAST resort: "K-L-…" is a legacy label
 * format whose barcode embedded the lot number rather than being it. Those
 * labels are stuck on real cartons, so they are still decoded — but only after
 * every exact lookup has come up empty, so it can never shadow a real code.
 */
async function resolveScan(owner, rawCode, role) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  const code = String(rawCode || "").trim();
  if (!code) throw httpErr("Empty scan");

  // Unit serial. Stored codes are uppercase, so the uppercased form is tried as
  // well as the code exactly as scanned. ("K-U-" is a legacy label prefix that
  // was never part of the stored serial.)
  const unit = await UnitSerial.findOne({
    ownerType,
    ownerId,
    serial: { $in: [code, code.toUpperCase(), code.replace(/^K-U-/i, "").toUpperCase()] },
  })
    .populate("productId", "productName skuNumber")
    .populate("currentLocationId", "fullCode");
  if (unit) {
    return { type: "unit", unit, nextActions: nextActionsFor("unit", unit.status, role) };
  }

  // Raw lot / batch number, scoped to the scanner's own inventory.
  const rows = await lotRowsFor({ ownerId, ownerType, code });
  if (rows.length) return { type: "lot", lot: code, rows, nextActions: nextActionsFor("lot", null, role) };

  // One outer box of a lot. Companies only — a seller holds units, not cartons.
  if (ownerType === "company") {
    const box = await BulkPackage.findOne({
      company_id: ownerId,
      bulk_packaging_id: { $in: [code, code.toUpperCase()] },
    }).populate("product_id", "productName skuNumber");
    if (box) return { type: "box", box, nextActions: nextActionsFor("lot", null, role) };

    // Location fullCode (sellers have no storage locations).
    const loc = await Location.findOne({ companyId: ownerId, fullCode: code.toUpperCase() });
    if (loc) return { type: "location", location: loc, nextActions: nextActionsFor("location", null, role) };
  }

  // LEGACY "K-L-<co>-<sku>-<lot>" label, decoded only because nothing above
  // matched the code as it stands.
  if (/^K-L-/i.test(code)) {
    const lot = code.split("-").slice(4).join("-");
    const legacyRows = await lotRowsFor({ ownerId, ownerType, code: lot });
    if (legacyRows.length) {
      return { type: "lot", lot, rows: legacyRows, nextActions: nextActionsFor("lot", null, role) };
    }
  }

  // Nothing matched. Log the scanned string EXACTLY as it arrived, byte for
  // byte, so a label that encodes a sanitised or escaped version of an
  // identifier is visible rather than silently unscannable.
  logScanMiss({ ownerType, ownerId, rawCode, code });
  throw httpErr("Unrecognized code", 404);
}

/* ------------------------------------------------------------- recall */

/**
 * Recall a lot. Marks every not-yet-sold serial "recalled" (blocking it from
 * picking) and returns the full distribution: where stock is held + which
 * orders/customers received units from this lot.
 */
async function recall(companyId, lotNumber, { performedBy } = {}) {
  if (!lotNumber) throw httpErr("lotNumber is required");

  // companyId here is the ORIGINATING company, which never changes when a unit
  // is supplied to a seller — so this query reaches units across ALL current
  // owners (company-held AND seller-held), exactly what a recall must do.
  const units = await UnitSerial.find({ companyId, lotNumber });
  const recallable = units.filter((u) => !["sold", "returned", "recalled"].includes(u.status));
  const soldUnits = units.filter((u) => u.status === "sold");

  // Mark recallable units recalled + event log.
  if (recallable.length) {
    const serials = recallable.map((u) => u.serial);
    await UnitSerial.updateMany({ companyId, serial: { $in: serials } }, { $set: { status: "recalled" } });
    await UnitEvent.insertMany(
      recallable.map((u) => ({ companyId, serial: u.serial, event: "recalled", fromStatus: u.status, toStatus: "recalled", refType: "Recall", actorId: performedBy })),
      { ordered: false }
    );
  }

  // Stock distribution from the quantity ledger (covers non-serialized stock too).
  const invRows = await Inventory.find({ ownerId: companyId, ownerType: "company", $or: [{ lotNumber }, { batchNumber: lotNumber }] }).populate("warehouseId", "name code");
  const invIds = invRows.map((r) => r._id);
  const bins = await InventoryBin.find({ inventoryId: { $in: invIds }, qty: { $gt: 0 } }).populate("locationId", "fullCode");
  const stock = invRows.map((r) => ({
    warehouse: r.warehouseId?.name || "—",
    availableStock: r.availableStock,
    damagedStock: r.damagedStock,
    bins: bins.filter((b) => String(b.inventoryId) === String(r._id)).map((b) => ({ bin: b.locationId?.fullCode, qty: b.qty })),
  }));

  // Customers reached: orders that received serials from this lot.
  const orderIds = [...new Set(units.filter((u) => u.orderId).map((u) => String(u.orderId)))];
  const orders = await Order.find({ _id: { $in: orderIds }, companyId }).select("orderNumber customerName customerId");
  const customers = orders.map((o) => ({ orderId: o._id, orderNumber: o.orderNumber, customerName: o.customerName, customerId: o.customerId }));

  return {
    lotNumber,
    recalledUnits: recallable.length,
    soldUnits: soldUnits.length,
    stock,
    customers,
  };
}

/* --------------------------------------------------- available unit IDs */

// A read-only popup, not an export: cap the list so a 10,000-unit lot cannot
// turn one click into a multi-megabyte payload. The true total is reported
// alongside, so the caller can say what it is not showing — the same pattern
// lotController uses for the Lot Details page.
const MAX_AVAILABLE_UNITS = 5000;

/**
 * WHICH units make up a lot row's available quantity, right now — the FULL unit
 * IDs, exactly as they are stored.
 *
 * "Available" is decided the same way every other read on this data decides it:
 *   • the unit still points at THIS Inventory row — a warehouse→warehouse
 *     transfer repoints `inventoryId` on receipt, so anything moved away drops
 *     out on its own;
 *   • the company still owns it — a unit supplied to a seller changes owner;
 *   • its status is `in_stock` — picked / packed / shipped / sold / damaged /
 *     recalled units are not on the shelf.
 *
 * Every ID returned is the code stored on a real UnitSerial row (`unit_code`,
 * falling back to the canonical `serial`). Nothing is derived from a lot number
 * and a counter, so a sold or transferred unit simply is not in the list — there
 * is no sequence to leave a hole in.
 *
 * Grouped by Bulk Packaging ID when the lot is boxed, so the popup can render
 * each box the way Lot Details does.
 *
 * OWNER-AGNOSTIC. `ownerType`/`ownerId` is the holder pair every other read on
 * this data uses (lotController.currentLotUnits, sellerTraceService), so the
 * same function answers for a company warehouse and for a seller — a unit
 * supplied downstream changes owner, which is exactly the distinction needed.
 * `ownerType` defaults to "company", so the company call site is unchanged.
 *
 * Read-only: moves no stock, writes nothing.
 */
async function availableUnitIds(ownerId, inventoryId, { ownerType = "company" } = {}) {
  const filter = { ownerType, ownerId, inventoryId, status: "in_stock" };
  const [available, units] = await Promise.all([
    UnitSerial.countDocuments(filter),
    UnitSerial.find(filter)
      .select("serial unit_code unit_serial box_serial bulk_packaging_id bulk_packaging_record_id")
      // Label order: box by box, then by the unit's number inside it.
      .sort({ box_serial: 1, unit_serial: 1, serial: 1 })
      .limit(MAX_AVAILABLE_UNITS)
      .lean(),
  ]);

  const byGroup = new Map();
  for (const u of units) {
    const key = u.bulk_packaging_id || "";
    if (!byGroup.has(key)) {
      byGroup.set(key, {
        bulkPackagingId: u.bulk_packaging_id || null,
        boxSerial: u.box_serial ?? null,
        unitIds: [],
      });
    }
    byGroup.get(key).unitIds.push(u.unit_code || u.serial);
  }

  const groups = [...byGroup.values()]
    .map((g) => ({ ...g, count: g.unitIds.length }))
    .sort((a, b) => (a.boxSerial || 0) - (b.boxSerial || 0));

  return {
    boxed: groups.some((g) => g.bulkPackagingId),
    // How many labelled units are actually on the shelf. Compared against the
    // lot row's availableStock by the caller: a lot that is partly unlabelled,
    // or holds non-serialised stock, legitimately reports fewer.
    labelledCount: available,
    listed: units.length,
    truncated: units.length < available,
    groups,
  };
}

module.exports = {
  lotBarcode,
  unitSerial,
  availableUnitIds,
  MAX_AVAILABLE_UNITS,
  boxUnitCode,
  BULK_CONFIG_INCOMPLETE,
  BULK_BOX_MISSING,
  generateUnits,
  ensureLotUnitLabels,
  listUnits,
  unitCountsByLot,
  markPrinted,
  transitionUnits,
  unitHistory,
  resolveScan,
  recall,
  MAX_GENERATE,
};
