/**
 * shipmentBoxService.js — SHIPMENT BOXES for a transfer.
 *
 * A Shipment Box bundles units that were scanned INDIVIDUALLY so the road
 * consignment has cartons and the receiving seller scans one label instead of
 * every unit. It is logistics only.
 *
 * THE ONE RULE THAT KEEPS BULK PACKAGING UNTOUCHED
 * ────────────────────────────────────────────────
 * A unit that already belongs to a Bulk Package can never be put in a Shipment
 * Box. Its Bulk Packaging Label is already the thing the receiver scans, and
 * duplicating that identity is exactly how two labels for one carton — and two
 * competing sources of truth — get created. `packBoxes` refuses such units, and
 * the receive scanner accepts a Bulk Packaging ID directly, so a mixed shipment
 * is covered by whichever label each carton already carries.
 *
 * Nothing here writes stock. Reservations, unit state and the receipt itself all
 * stay where they were (lotService / barcodeService / shipmentService); a box is
 * a manifest of serials the receiving scan expands.
 */

const crypto = require("crypto");
const mongoose = require("mongoose");
const ShipmentBox = require("../model/Transport/ShipmentBox");
const BulkPackage = require("../model/Inventory/BulkPackage");
// WHAT A SCANNED CODE MEANS, from the one module that defines it — the same
// lookups, case handling and main-box cascade the company warehouse receive
// scan resolves through (receiveScanService). Reading a box row directly here
// is what made a MAIN box read as an empty carton and left inner-box, unit and
// lot labels unrecognised altogether.
const { unitHolderIds, findBox, findUnit } = require("./packagingScanService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const norm = (v) => String(v || "").trim().toUpperCase();

const MAX_BOXES = 200;
const MAX_UNITS_PER_BOX = 5000;

// Same construction as the shipment manifest token (shipmentService.qrFor), so
// both labels are verified the same way and neither can be guessed.
const SECRET = () => process.env.JWT_SECRET || process.env.QR_SECRET || "khetify-dev-secret";
const tokenFor = (boxId) =>
  crypto.createHmac("sha256", SECRET()).update(`sbox:${boxId}`).digest("hex").slice(0, 16);

/** What is printed and scanned: "<SHIPMENT BOX ID>.<token>". */
const boxPayload = (box) => `${box.shipmentBoxId}.${box.qrToken}`;

/** The shape the label and the review table need. */
function boxSummary(box) {
  const products = new Map();
  for (const u of box.units || []) {
    const key = String(u.productId);
    if (!products.has(key)) {
      products.set(key, { productId: key, productName: u.productName || "Item", quantity: 0, lots: new Set() });
    }
    const entry = products.get(key);
    entry.quantity += 1;
    if (u.lotNumber) entry.lots.add(u.lotNumber);
  }
  return {
    _id: String(box._id),
    shipmentBoxId: box.shipmentBoxId,
    boxNumber: box.boxNumber,
    totalBoxes: box.totalBoxes,
    totalUnits: box.totalUnits,
    status: box.status,
    qrPayload: boxPayload(box),
    shipmentId: String(box.shipmentId),
    products: [...products.values()].map((p) => ({ ...p, lots: [...p.lots] })),
    unitCodes: (box.units || []).map((u) => u.unitCode || u.serial),
  };
}

/**
 * PACK THE BOXES for a shipment.
 *
 * `groups` is what the operator built on screen: [{ units: [serial, …] }, …].
 * `unitIndex` is the authoritative per-unit record built by the transfer's own
 * re-resolution step (serial → { productId, inventoryId, lotNumber, boxed }),
 * so nothing here trusts the client for what a unit IS.
 *
 * Validation, in order:
 *   • at least one unit per box, within the size limits
 *   • every serial belongs to THIS transfer
 *   • no serial appears in two boxes, or twice in one
 *   • no serial already belongs to a Bulk Package
 *   • if boxes are used at all, EVERY loose unit must be in one — a half-packed
 *     consignment cannot be received by scanning boxes, and a rule that only
 *     sometimes holds is worse than no rule
 */
async function packBoxes({
  companyId, shipment, supplyOrderId, sellerId,
  sourceWarehouseId, destinationWarehouseId,
  groups = [], unitIndex, performedBy,
}) {
  const clean = (groups || [])
    .filter((g) => g && Array.isArray(g.units))
    .map((g) => [...new Set(g.units.map(norm).filter(Boolean))])
    .filter((units) => units.length);
  if (!clean.length) return [];

  if (clean.length > MAX_BOXES) throw httpErr(`A transfer cannot have more than ${MAX_BOXES} shipment boxes`, 400);
  const oversized = clean.find((u) => u.length > MAX_UNITS_PER_BOX);
  if (oversized) throw httpErr(`A shipment box cannot hold more than ${MAX_UNITS_PER_BOX} units`, 400);

  const seen = new Set();
  for (const units of clean) {
    for (const serial of units) {
      const rec = unitIndex.get(serial);
      if (!rec) throw httpErr(`${serial} is not part of this transfer, so it cannot be boxed`, 409);
      // Refused only when the WHOLE carton is on this transfer: the Bulk
      // Packaging Label is then already the thing the receiver scans. Units
      // taken OUT of a carton (a partial scan of it) are loose and belong in a
      // Shipment Box like any other individually scanned unit.
      if (rec.boxed) {
        throw httpErr(
          `${rec.unitCode || serial} is travelling inside Bulk Package ${rec.bulkPackagingId}, which is on this transfer in full — keep using that label instead of a shipment box.`,
          409
        );
      }
      if (seen.has(serial)) throw httpErr(`${rec.unitCode || serial} was put into more than one box`, 409);
      seen.add(serial);
    }
  }

  // Every LOOSE unit of the transfer must be accounted for.
  const loose = [...unitIndex.entries()].filter(([, r]) => !r.boxed).map(([s]) => s);
  const missing = loose.filter((s) => !seen.has(s));
  if (missing.length) {
    throw httpErr(
      `${missing.length} scanned unit(s) were not put into any shipment box. Every individually scanned unit must be in a box.`,
      400
    );
  }

  // "SB-<8 of the shipment id>-<box number>" — readable, and unique because the
  // shipment id is. The unique index is the real guarantee.
  const stem = String(shipment._id).slice(-8).toUpperCase();
  const docs = clean.map((units, i) => {
    const shipmentBoxId = `SB-${stem}-${String(i + 1).padStart(3, "0")}`;
    return {
      companyId,
      shipmentId: shipment._id,
      supplyOrderId: supplyOrderId || null,
      sellerId: sellerId || null,
      sourceWarehouseId: sourceWarehouseId || null,
      destinationWarehouseId: destinationWarehouseId || null,
      shipmentBoxId,
      boxNumber: i + 1,
      totalBoxes: clean.length,
      units: units.map((serial) => {
        const rec = unitIndex.get(serial);
        return {
          serial,
          unitCode: rec.unitCode || serial,
          productId: rec.productId,
          productName: rec.productName || null,
          inventoryId: rec.inventoryId,
          lotNumber: rec.lotNumber || null,
        };
      }),
      totalUnits: units.length,
      status: "packed",
      qrToken: tokenFor(shipmentBoxId),
      createdBy: performedBy || null,
    };
  });

  const created = await ShipmentBox.insertMany(docs);
  return created;
}

/** Mark a shipment's boxes as dispatched / received. Never touches stock. */
async function setBoxStatus(shipmentId, status, { receivedAt = null } = {}) {
  const patch = { status };
  if (status === "received") patch.receivedAt = receivedAt || new Date();
  await ShipmentBox.updateMany({ shipmentId }, { $set: patch });
}

/** Every box of a shipment, in packing order. */
async function boxesForShipment(shipmentId) {
  const rows = await ShipmentBox.find({ shipmentId }).sort({ boxNumber: 1 }).lean();
  return rows.map(boxSummary);
}

/** Boxes for several shipments at once (history lists). */
async function boxCountsForShipments(shipmentIds = []) {
  if (!shipmentIds.length) return new Map();
  const rows = await ShipmentBox.aggregate([
    { $match: { shipmentId: { $in: shipmentIds.map((id) => new mongoose.Types.ObjectId(String(id))) } } },
    { $group: { _id: "$shipmentId", boxes: { $sum: 1 }, units: { $sum: "$totalUnits" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { boxes: r.boxes, units: r.units }]));
}

/* ------------------------------------------------------- receiving scans */

/**
 * Resolve ONE code scanned while receiving a shipment, and say which of the
 * shipment's units it accounts for. READ-ONLY.
 *
 * Three kinds are understood, and the kind is decided by lookup, never by the
 * shape of the string:
 *   manifest      — the shipment label; stands for the WHOLE consignment
 *   shipment_box  — a carton packed for this transfer; stands for its units
 *   bulk_package  — an existing manufacturer box; stands for the units of it
 *                   that are on this shipment (its own label, unchanged)
 */
async function resolveReceiveScan(shipment, code) {
  const value = norm(code);
  if (!value) throw httpErr("Scan a label to continue", 400);

  const shipmentSerials = new Set(
    (shipment.lines || []).flatMap((l) => (l.serials || []).map(norm))
  );

  // 1. The shipment manifest — "<shipment id>.<token>".
  if (value === norm(`${shipment._id}.${shipment.qrToken}`)) {
    return {
      kind: "manifest",
      code: `${shipment._id}.${shipment.qrToken}`,
      label: "Shipment manifest",
      totalUnits: shipmentSerials.size,
      serials: [...shipmentSerials],
      products: [],
    };
  }

  // 2. A Shipment Box — "<SB-…>.<token>", or the bare box id typed in.
  const boxId = value.includes(".") ? value.split(".")[0] : value;
  const box = await ShipmentBox.findOne({ shipmentBoxId: boxId }).lean();
  if (box) {
    if (String(box.shipmentId) !== String(shipment._id)) {
      throw httpErr(`${box.shipmentBoxId} belongs to a different shipment.`, 409);
    }
    if (value.includes(".") && value.split(".")[1] !== box.qrToken) {
      throw httpErr(`${box.shipmentBoxId} could not be verified — scan the printed label.`, 409);
    }
    const summary = boxSummary(box);
    return {
      kind: "shipment_box",
      code: box.shipmentBoxId,
      label: `Shipment Box ${box.boxNumber} of ${box.totalBoxes}`,
      boxNumber: box.boxNumber,
      totalBoxes: box.totalBoxes,
      totalUnits: box.totalUnits,
      // Only the serials that are actually on this shipment count towards
      // coverage — a box can never vouch for stock it is not carrying.
      serials: (box.units || []).map((u) => norm(u.serial)).filter((s) => shipmentSerials.has(s)),
      products: summary.products,
      unitCodes: summary.unitCodes,
    };
  }

  // 3. An existing Bulk Package — its own label, still the right one to scan.
  // Looked up through findBox, which tries the code VERBATIM before falling back
  // to a case-insensitive match. Stored identifiers are not all upper case — a
  // three-level lot spells the inner segment of a unit code "BPinner" — so the
  // uppercased `boxId` alone could not find them.
  const bulk = await findBox(
    shipment.companyId, boxId,
    "bulk_packaging_id lot_id lot_number box_serial units_in_box product_id box_level parent_box_id"
  );
  if (bulk) {
    const UnitSerial = require("../model/Barcode/UnitSerial");
    // A MAIN carton owns no unit rows of its own — the units hang off the inner
    // boxes nailed inside it — so the lookup runs over whichever boxes actually
    // hold them. Scoping to the scanned box alone returned nothing for a main
    // box, which then read as "not part of this shipment".
    const holderIds = await unitHolderIds(shipment.companyId, bulk);
    const units = await UnitSerial.find({
      companyId: shipment.companyId, bulk_packaging_record_id: { $in: holderIds },
    }).select("serial unit_code productId inventoryId lotNumber").lean();
    const onBoard = units.filter((u) => shipmentSerials.has(norm(u.serial)));
    if (!onBoard.length) {
      throw httpErr(`${bulk.bulk_packaging_id} is not part of this shipment.`, 409);
    }
    const isMain = bulk.box_level === "main" && holderIds.length > 1;
    return {
      kind: "bulk_package",
      code: bulk.bulk_packaging_id,
      boxLevel: bulk.box_level === "main" ? "main" : "inner",
      label: isMain
        ? `Main Box ${bulk.box_serial} (${holderIds.length} inner boxes)`
        : `Bulk Package (box ${bulk.box_serial})`,
      totalUnits: onBoard.length,
      serials: onBoard.map((u) => norm(u.serial)),
      products: [{
        productId: String(bulk.product_id),
        productName: null,
        quantity: onBoard.length,
        lots: [bulk.lot_number].filter(Boolean),
      }],
      unitCodes: onBoard.map((u) => u.unit_code || u.serial),
    };
  }

  // 4. A SINGLE UNIT label — the smallest thing on the consignment. Receives
  //    exactly one unit, so a part-opened carton can still be counted in.
  const unit = await findUnit(shipment.companyId, boxId, "serial unit_code productId inventoryId lotNumber");
  if (unit) {
    if (!shipmentSerials.has(norm(unit.serial))) {
      throw httpErr(`${unit.unit_code || unit.serial} is not part of this shipment.`, 409);
    }
    return {
      kind: "unit",
      code: unit.unit_code || unit.serial,
      label: "Individual unit",
      totalUnits: 1,
      serials: [norm(unit.serial)],
      products: [{
        productId: String(unit.productId),
        productName: null,
        quantity: 1,
        lots: [unit.lotNumber].filter(Boolean),
      }],
      unitCodes: [unit.unit_code || unit.serial],
    };
  }

  // 5. A LOT label — every unit of that lot the shipment is carrying.
  //
  //    Answered from the shipment's OWN lines rather than from Inventory: a lot
  //    number has one row per warehouse and the consignment may carry only part
  //    of the lot, so the line is the only place that says what is actually on
  //    board. Matched on either spelling the line records.
  const lotLines = (shipment.lines || []).filter(
    (l) => norm(l.lotNumber) === value || norm(l.batchNumber) === value
  );
  if (lotLines.length) {
    const serials = [...new Set(
      lotLines.flatMap((l) => (l.serials || []).map(norm)).filter((x) => shipmentSerials.has(x))
    )];
    if (!serials.length) {
      throw httpErr(`Lot ${value} has no unit labels on this shipment — scan its box labels instead.`, 409);
    }
    return {
      kind: "lot",
      code: lotLines[0].lotNumber || lotLines[0].batchNumber,
      label: `Lot ${lotLines[0].lotNumber || lotLines[0].batchNumber}`,
      totalUnits: serials.length,
      serials,
      products: lotLines.map((l) => ({
        productId: String(l.productId),
        productName: null,
        quantity: (l.serials || []).filter((x) => shipmentSerials.has(norm(x))).length,
        lots: [l.lotNumber || l.batchNumber].filter(Boolean),
      })),
      unitCodes: serials,
    };
  }

  throw httpErr(
    `Unknown label "${value}". Scan the shipment manifest, a Shipment Box, a Lot, `
    + "a Bulk Packaging / Main Box / Inner Box label, or an individual unit.",
    404
  );
}

/**
 * Do these scanned codes account for every unit on the shipment? Recomputed
 * from the database on the server at receive time — the screen's running total
 * is a convenience, not the decision.
 */
async function coverageFor(shipment, codes = []) {
  const shipmentSerials = new Set(
    (shipment.lines || []).flatMap((l) => (l.serials || []).map(norm))
  );
  const covered = new Set();
  let sawManifest = false;

  for (const code of [...new Set((codes || []).map(norm).filter(Boolean))]) {
    const hit = await resolveReceiveScan(shipment, code);
    if (hit.kind === "manifest") sawManifest = true;
    for (const s of hit.serials) covered.add(norm(s));
  }

  const missing = [...shipmentSerials].filter((s) => !covered.has(s));
  return {
    total: shipmentSerials.size,
    covered: covered.size,
    missing: missing.length,
    // A shipment with no recorded serials at all can only be received the old
    // way, by the manifest.
    complete: sawManifest || (shipmentSerials.size > 0 && missing.length === 0),
  };
}

module.exports = {
  packBoxes,
  setBoxStatus,
  boxesForShipment,
  boxCountsForShipments,
  resolveReceiveScan,
  coverageFor,
  boxPayload,
  boxSummary,
  _internal: { tokenFor },
};