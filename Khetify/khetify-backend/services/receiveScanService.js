/**
 * receiveScanService.js — the scan step for RECEIVING a warehouse→warehouse
 * transfer, box by box.
 *
 * THE SHIPPING LABEL WAS THE ONLY WAY IN. One manifest barcode is minted per
 * shipment, so a transfer that physically arrives as five cartons had one label
 * between them — there is no carton to stick it on, and no way to receive four
 * today and the fifth tomorrow. Every carton already carries its own printed
 * barcode; this lets the receiving warehouse scan those instead.
 *
 * WHAT A CODE MEANS is not decided here. It comes from packagingScanService,
 * the very module the dispatch scan resolves through, so a Bulk Packaging ID, an
 * inner box, a repack carton and a unit are read identically at both ends of the
 * journey — including the main-box cascade, where scanning an outer carton must
 * reach every unit nailed inside it.
 *
 * WHAT THIS SIDE OWNS is which units count. Sending out, a unit must be on the
 * shelf here ("in_stock"). Coming in, it must be IN TRANSIT ON THIS SHIPMENT
 * ("shipped" + currentShipmentId), which is what makes every other answer fall
 * out correctly: stock that was never dispatched is not part of the transfer,
 * and stock already landed is no longer in transit, so it can never be received
 * twice however it is scanned.
 *
 * The shipping label keeps working exactly as it did — shipmentService.
 * verifyReceipt is untouched. Here it is one more code the resolver accepts, a
 * shortcut that selects everything still in transit.
 */

const mongoose = require("mongoose");
const Shipment = require("../model/Transport/Shipment");
const Inventory = require("../model/Inventory/Inventory");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const StockMovement = require("../model/Inventory/StockMovement");
const { withTransaction } = require("./txn");
const { withinGeofence } = require("./geoService");
const { emitInventoryUpdate } = require("./inventoryService");
const {
  norm, codeVariants, unitHolderIds, findBox, findUnit, findRepackBox,
} = require("./packagingScanService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** A unit is receivable only from this status, and only on THIS shipment. */
const IN_TRANSIT_STATUS = "shipped";

/**
 * The states a transfer can still be received in. "partially_received" is here
 * and deliberately so: three cartons today and two tomorrow is the whole point
 * of scanning them individually, and a shipment that stopped being receivable
 * the moment the first box landed could not do it.
 */
const RECEIVABLE = new Set(["in_transit", "arrived", "verifying", "partially_received"]);

/** The operator-facing reference for a shipment ("SH-EA951F"). */
const refOf = (shipment) =>
  shipment.lrNumber || `SH-${String(shipment._id).slice(-6).toUpperCase()}`;

/** "3 Aug 2026" — the date an operator would read off a receipt. */
const onDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;

const MSG = {
  notOnTransfer: (code, ref) => `${code} is not part of transfer ${ref}.`,
  // SAYS WHEN. A carton scanned twice on a partly-received transfer is the
  // normal case, not an error the operator caused — the date is what tells them
  // it was this transfer's earlier visit rather than something gone wrong.
  alreadyReceived: (code, when) =>
    when
      ? `${code} — already received on ${onDate(when)}.`
      : `${code} — already received.`,
  unknown: (code) => `Unknown code "${code}".`,
  nothingLeft: "Everything on this transfer has already been received.",
  noneLeftInBox: (id, when) =>
    when
      ? `${id} — already received on ${onDate(when)}.`
      : `${id} — already received.`,
  notReceivable: (status) => `Cannot receive a ${status} shipment.`,
  notATransfer: "This shipment is not a warehouse transfer — use the shipping label to receive it.",
  wrongWarehouse: "Access denied — wrong warehouse",
  sourceCannotReceive: "Access denied — wrong warehouse (source cannot complete the receipt)",
  driverSelfVerify: "The driver cannot verify their own delivery",
  nothingScanned: "Scan at least one code before receiving.",
  staleScan: "These units are no longer in transit — someone may have received them already.",
};

/* ------------------------------------------------------------- shipment */

async function loadShipment(companyId, shipmentId) {
  const shipment = await Shipment.findOne({ _id: shipmentId, companyId });
  if (!shipment) throw httpErr("Shipment not found", 404);
  // Scanning cartons in is a WAREHOUSE TRANSFER flow. A seller supply and a
  // customer delivery land through their own paths, which are untouched.
  if (shipment.toType !== "warehouse" || !shipment.toWarehouseId) throw httpErr(MSG.notATransfer, 400);
  if (!RECEIVABLE.has(shipment.status)) throw httpErr(MSG.notReceivable(shipment.status), 409);
  return shipment;
}

/**
 * MAY THIS USER RECEIVE HERE? The very checks the shipping-label path runs
 * (shipmentService.verifyReceipt), applied to the scan path so neither is the
 * softer way in.
 */
function assertDestination(shipment, { warehouseId, allowedWarehouseIds, verifierId } = {}) {
  if (Array.isArray(allowedWarehouseIds)
      && !allowedWarehouseIds.map(String).includes(String(shipment.toWarehouseId))) {
    throw httpErr(MSG.wrongWarehouse, 403);
  }
  if (warehouseId) {
    if (shipment.fromWarehouseId && String(warehouseId) === String(shipment.fromWarehouseId)) {
      throw httpErr(MSG.sourceCannotReceive, 403);
    }
    if (String(warehouseId) !== String(shipment.toWarehouseId)) throw httpErr(MSG.wrongWarehouse, 403);
  }
  if (verifierId && shipment.driverId && String(verifierId) === String(shipment.driverId)) {
    throw httpErr(MSG.driverSelfVerify, 403);
  }
}

/** Is this the shipment's own manifest barcode? */
const isShippingLabel = (shipment, value) =>
  !!shipment.qrToken && norm(value) === norm(`${shipment._id}.${shipment.qrToken}`);

/**
 * WHEN THESE UNITS LANDED on this transfer, or null if they never did.
 *
 * Read from the unit events rather than the shipment: a partly-received transfer
 * is received over several visits, and the answer wanted is "when did THIS
 * carton come in", not "when was the last thing received". The newest event of
 * the set is that answer.
 */
async function receivedOn(companyId, shipmentId, serials) {
  if (!serials?.length) return null;
  const ev = await UnitEvent.findOne({
    companyId,
    serial: { $in: codeVariants(serials) },
    event: "transferred_in",
    refType: "Transfer",
    refId: shipmentId,
  })
    .sort({ at: -1 })
    .select("at")
    .lean();
  return ev?.at || null;
}

/* --------------------------------------------------------------- context */

/**
 * WHAT IS STILL COMING, and what has already landed.
 *
 * Expected is read off the shipment's lines — after dispatch those are no longer
 * a plan but the record of what physically left (dispatchShipment rewrites them
 * from the scan). Received is `line.receivedQty`, which both this path and the
 * shipping-label path maintain, so the counter reads the same whichever way the
 * goods came in.
 */
async function receiveContext(companyId, shipment) {
  const lines = shipment.lines || [];
  const lotIds = [...new Set(lines.map((l) => String(l.inventoryId)).filter(Boolean))];
  const lots = await Inventory.find({ _id: { $in: lotIds } })
    .select("lotNumber batchNumber productId warehouseId")
    .lean();
  const lotById = new Map(lots.map((l) => [String(l._id), l]));

  const expected = new Map();
  const received = new Map();
  for (const line of lines) {
    const pid = String(line.productId || lotById.get(String(line.inventoryId))?.productId || "");
    if (!pid) continue;
    expected.set(pid, (expected.get(pid) || 0) + Number(line.qty || 0));
    received.set(pid, (received.get(pid) || 0) + Number(line.receivedQty || 0));
  }

  return { ref: refOf(shipment), lotById, expected, received };
}

/** The product rows the dialog renders. */
async function receiveChecklist(companyId, shipmentId) {
  const shipment = await Shipment.findOne({ _id: shipmentId, companyId });
  if (!shipment) throw httpErr("Shipment not found", 404);
  const ctx = await receiveContext(companyId, shipment);

  const products = await Product.find({ _id: { $in: [...ctx.expected.keys()] }, companyId })
    .select("productName")
    .lean();
  const nameById = new Map(products.map((p) => [String(p._id), p.productName]));

  // Counted from the units themselves, not from the lines — the honest answer to
  // "how much is still on the truck".
  const stillInTransit = await UnitSerial.countDocuments({
    companyId, status: IN_TRANSIT_STATUS, currentShipmentId: shipment._id,
  });

  const items = [...ctx.expected.entries()].map(([productId, expectedQty]) => ({
    productId,
    name: nameById.get(productId) || "Item",
    expectedQty,
    receivedQty: ctx.received.get(productId) || 0,
  }));

  // WHAT CAME IN ON THE EARLIER VISITS, per lot and with the date it landed.
  //
  // A transfer received over several days reopens on a blank dialog otherwise:
  // the counter would read 40/50 with nothing to show for the 40, and the
  // operator has no way to tell which cartons they already took. Read from the
  // unit events, which are the record of what physically landed — the lines only
  // carry totals.
  const landedEvents = await UnitEvent.find({
    companyId, event: "transferred_in", refType: "Transfer", refId: shipment._id,
  })
    .select("serial at")
    .sort({ at: 1 })
    .lean();

  const alreadyReceived = [];
  if (landedEvents.length) {
    const landedSerials = landedEvents.map((e) => e.serial);
    const atBySerial = new Map(landedEvents.map((e) => [e.serial, e.at]));
    const landedUnits = await UnitSerial.find({ companyId, serial: { $in: landedSerials } })
      .select("serial lotNumber batchNumber productId")
      .lean();

    const byLot = new Map();
    for (const u of landedUnits) {
      const key = u.lotNumber || u.batchNumber || "—";
      let row = byLot.get(key);
      if (!row) {
        row = {
          lotNumber: key,
          productId: String(u.productId),
          name: nameById.get(String(u.productId)) || "Item",
          qty: 0,
          receivedAt: null,
        };
        byLot.set(key, row);
      }
      row.qty += 1;
      // The LATEST landing of this lot — the visit the operator remembers.
      const at = atBySerial.get(u.serial);
      if (at && (!row.receivedAt || new Date(at) > new Date(row.receivedAt))) row.receivedAt = at;
    }
    alreadyReceived.push(...byLot.values());
  }

  return {
    shipmentId: String(shipment._id),
    ref: ctx.ref,
    status: shipment.status,
    toWarehouseId: shipment.toWarehouseId ? String(shipment.toWarehouseId) : null,
    receivable: shipment.toType === "warehouse" && RECEIVABLE.has(shipment.status),
    items,
    expectedTotal: items.reduce((n, i) => n + i.expectedQty, 0),
    receivedTotal: items.reduce((n, i) => n + i.receivedQty, 0),
    stillInTransit,
    alreadyReceived,
  };
}

/* ------------------------------------------------------------ resolving */

/** Units of this shipment still in transit, optionally narrowed. */
function inTransitUnits(companyId, shipmentId, extra = {}) {
  return UnitSerial.find({
    companyId,
    status: IN_TRANSIT_STATUS,
    currentShipmentId: shipmentId,
    ...extra,
  })
    .select("serial unit_code inventoryId lotNumber batchNumber productId bulk_packaging_id bulk_packaging_record_id repack_box_id")
    .sort({ lotNumber: 1, unit_serial: 1 })
    .lean();
}

/** The answer the dialog consumes — the same shape the dispatch scan returns. */
function result({
  scanType, units, ctx, selected, label,
  bulkPackagingId = null, repackBoxId = null, boxLevel = null,
  boxUnitTotal = null, alreadyReceived = 0,
}) {
  const fresh = units.filter((u) => !selected.has(norm(u.serial)));
  const first = fresh[0] || units[0] || {};
  const productId = String(first.productId || "");
  return {
    scanType,
    label,
    boxLevel,
    bulkPackagingId,
    repackBoxId,
    lotId: first.inventoryId ? String(first.inventoryId) : null,
    lotNumber: first.lotNumber || first.batchNumber || null,
    // A carton may legitimately hold several lots (a repack one always may), so
    // the row states that rather than pretending there is a single lot.
    lotCount: new Set(fresh.map((u) => String(u.inventoryId))).size,
    productId,
    addedUnitCodes: fresh.map((u) => u.serial),
    addedQuantity: fresh.length,
    skippedQuantity: units.length - fresh.length,
    boxUnitTotal,
    alreadyReceivedQuantity: alreadyReceived,
    expectedTotal: [...ctx.expected.values()].reduce((a, b) => a + b, 0),
  };
}

/**
 * Resolve ONE scanned code against this incoming transfer. READ-ONLY — it moves
 * nothing; receiveScannedUnits re-checks everything before any stock lands.
 *
 * `selectedCodes` is what the dialog already holds, so a carton scanned after
 * one of its own units adds only the rest — the same once-and-once-only rule the
 * dispatch dialog applies.
 */
async function resolveReceiveScan(companyId, shipmentId, { code, selectedCodes = [] }) {
  const value = String(code || "").trim();
  if (!value) throw httpErr("A code is required", 400);

  const shipment = await loadShipment(companyId, shipmentId);
  const ctx = await receiveContext(companyId, shipment);
  const selected = new Set((selectedCodes || []).map(norm).filter(Boolean));

  /* 1 — THE SHIPPING LABEL, kept as a shortcut over the same machinery: it
         selects everything still in transit, in one scan. */
  if (isShippingLabel(shipment, value)) {
    const units = await inTransitUnits(companyId, shipment._id);
    if (!units.length) throw httpErr(MSG.nothingLeft, 409);
    const fresh = units.filter((u) => !selected.has(norm(u.serial)));
    if (!fresh.length) throw httpErr(MSG.alreadyReceived("This shipping label"), 409);
    return result({
      scanType: "shipment", units, ctx, selected,
      label: `Shipping label · ${ctx.ref}`,
    });
  }

  /* 2 — A BULK PACKAGING BOX, main or inner. A main carton resolves through its
         inner boxes (packagingScanService.unitHolderIds), which is what makes
         the cascade land everything nailed inside it. */
  const box = await findBox(companyId, value, "bulk_packaging_id box_level parent_box_id lot_id");
  if (box) {
    const holderIds = await unitHolderIds(companyId, box);
    const scope = { bulk_packaging_record_id: { $in: holderIds } };
    const units = await inTransitUnits(companyId, shipment._id, scope);
    if (!units.length) {
      // Does the box exist on this transfer at all? A box whose units are all
      // landed reads differently from one that was never dispatched here.
      const boxSerials = (await UnitSerial.find({ companyId, ...scope }).select("serial").lean())
        .map((u) => u.serial);
      const when = await receivedOn(companyId, shipment._id, boxSerials);
      throw httpErr(
        when ? MSG.noneLeftInBox(box.bulk_packaging_id, when) : MSG.notOnTransfer(box.bulk_packaging_id, ctx.ref),
        409,
      );
    }
    const fresh = units.filter((u) => !selected.has(norm(u.serial)));
    if (!fresh.length) throw httpErr(MSG.alreadyReceived(box.bulk_packaging_id), 409);
    const boxUnitTotal = await UnitSerial.countDocuments({ companyId, ...scope });
    return result({
      scanType: "bulk_package", units, ctx, selected,
      boxLevel: box.box_level === "main" ? "main" : "inner",
      bulkPackagingId: box.bulk_packaging_id,
      label: `${box.box_level === "main" ? "Bulk packaging" : "Inner box"} · ${box.bulk_packaging_id}`,
      boxUnitTotal,
    });
  }

  /* 3 — A REPACK CARTON, assembled at dispatch out of loose units. It may hold
         several lots, which is exactly why its own ID has to be scannable. */
  const repack = await findRepackBox(companyId, value, "repack_box_id status");
  if (repack) {
    const units = await inTransitUnits(companyId, shipment._id, { repack_box_id: repack._id });
    if (!units.length) {
      const boxSerials = (await UnitSerial.find({ companyId, repack_box_id: repack._id }).select("serial").lean())
        .map((u) => u.serial);
      const when = await receivedOn(companyId, shipment._id, boxSerials);
      throw httpErr(
        when ? MSG.noneLeftInBox(repack.repack_box_id, when) : MSG.notOnTransfer(repack.repack_box_id, ctx.ref),
        409,
      );
    }
    const fresh = units.filter((u) => !selected.has(norm(u.serial)));
    if (!fresh.length) throw httpErr(MSG.alreadyReceived(repack.repack_box_id), 409);
    const boxUnitTotal = await UnitSerial.countDocuments({ companyId, repack_box_id: repack._id });
    return result({
      scanType: "repack", units, ctx, selected,
      repackBoxId: repack.repack_box_id,
      bulkPackagingId: repack.repack_box_id,
      label: `Box packaging · ${repack.repack_box_id}`,
      boxUnitTotal,
    });
  }

  /* 4 — ONE UNIT. */
  const unit = await findUnit(companyId, value, "serial unit_code status currentShipmentId");
  if (unit) {
    const code2 = unit.unit_code || unit.serial;
    if (String(unit.currentShipmentId || "") !== String(shipment._id)) {
      // It was on this transfer and has landed, or it was never on it at all.
      const when = await receivedOn(companyId, shipment._id, [unit.serial]);
      throw httpErr(when ? MSG.alreadyReceived(code2, when) : MSG.notOnTransfer(code2, ctx.ref), 409);
    }
    if (unit.status !== IN_TRANSIT_STATUS) {
      throw httpErr(MSG.alreadyReceived(code2, await receivedOn(companyId, shipment._id, [unit.serial])), 409);
    }
    if (selected.has(norm(unit.serial))) throw httpErr(MSG.alreadyReceived(code2), 409);

    const [full] = await inTransitUnits(companyId, shipment._id, { _id: unit._id });
    if (!full) throw httpErr(MSG.alreadyReceived(code2), 409);
    return result({ scanType: "unit", units: [full], ctx, selected, label: `Unit · ${code2}` });
  }

  /* 5 — A LOT NUMBER: everything of that lot still in transit on this transfer. */
  const onTransfer = [...ctx.lotById.values()].find(
    (l) => norm(l.lotNumber) === norm(value) || norm(l.batchNumber) === norm(value)
  );
  if (onTransfer) {
    const units = await inTransitUnits(companyId, shipment._id, { inventoryId: onTransfer._id });
    if (!units.length) throw httpErr(MSG.noneLeftInBox(onTransfer.lotNumber || value), 409);
    const fresh = units.filter((u) => !selected.has(norm(u.serial)));
    if (!fresh.length) throw httpErr(MSG.alreadyReceived(onTransfer.lotNumber || value), 409);
    return result({
      scanType: "lot", units, ctx, selected,
      label: `Lot · ${onTransfer.lotNumber || onTransfer.batchNumber}`,
    });
  }

  // Known to the system but not to this transfer, or not known at all.
  const known = await Inventory.exists({
    ownerType: "company", ownerId: companyId,
    $or: [{ lotNumber: value }, { batchNumber: value }],
  });
  throw known
    ? httpErr(MSG.notOnTransfer(value, ctx.ref), 409)
    : httpErr(MSG.unknown(value), 404);
}

/* ------------------------------------------------------------- receiving */

/**
 * LAND THE SCANNED UNITS. Partial by design: whatever is scanned is received,
 * and the shipment stays receivable until nothing is left in transit.
 *
 * Every unit is re-resolved from the database — the client's list is a request,
 * never the truth — and only units still `shipped` on THIS shipment can land, so
 * two operators receiving the same carton at once cannot both book it in.
 *
 * The landing itself is the warehouse-transfer landing verifyReceipt performs,
 * applied per source lot: the destination Inventory row is upserted, the ledger
 * gets its `in_transit_in` row, and the units are repointed to that row. A unit
 * keeps its serial, its lot identity and its original packaging links — only its
 * warehouse (through inventoryId) and its status move.
 */
async function receiveScannedUnits(companyId, shipmentId, {
  serials = [], verifierId, performedBy, warehouseId, allowedWarehouseIds = null, lat, lng,
} = {}) {
  const codes = codeVariants(serials);
  if (!codes.length) throw httpErr(MSG.nothingScanned, 400);

  const shipment = await loadShipment(companyId, shipmentId);
  assertDestination(shipment, { warehouseId, allowedWarehouseIds, verifierId });

  const dest = await Warehouse.findOne({ _id: shipment.toWarehouseId, companyId });
  if (!dest) throw httpErr("Destination warehouse not found", 404);
  // GPS attestation, exactly as the shipping-label path requires it.
  const fence = withinGeofence(dest, lat, lng);
  if (!fence.ok) throw httpErr(`Outside warehouse geofence (${fence.distance}m > ${fence.radius}m)`, 409);

  const units = await UnitSerial.find({
    companyId,
    serial: { $in: codes },
    status: IN_TRANSIT_STATUS,
    currentShipmentId: shipment._id,
  }).select("serial inventoryId productId batchNumber lotNumber");
  if (!units.length) throw httpErr(MSG.staleScan, 409);

  // BY SOURCE LOT — one destination row, one ledger entry and one repoint per
  // lot, however many cartons the units arrived in.
  const byLot = new Map();
  for (const u of units) {
    const key = String(u.inventoryId);
    if (!byLot.has(key)) byLot.set(key, []);
    byLot.get(key).push(u);
  }

  const landedRows = [];
  await withTransaction(async (session) => {
    for (const [lotId, lotUnits] of byLot.entries()) {
      const qty = lotUnits.length;
      const src = await Inventory.findById(lotId)
        .select("productId lotNumber batchNumber expiryDate mfgDate mfgBatchNo")
        .session(session);
      if (!src) throw httpErr("Source lot not found", 404);

      // The destination row for this lot. $setOnInsert on the immutable
      // metadata so merging into an existing row never overwrites it.
      const inv = await Inventory.findOneAndUpdate(
        {
          productId: src.productId, ownerType: "company", ownerId: companyId,
          warehouseId: shipment.toWarehouseId, batchNumber: src.batchNumber,
        },
        {
          $inc: { offlineStock: qty, availableStock: qty },
          $set: { lotNumber: src.lotNumber },
          $setOnInsert: {
            expiryDate: src.expiryDate || null,
            mfgDate: src.mfgDate || null,
            mfgBatchNo: src.mfgBatchNo || null,
          },
        },
        { new: true, upsert: true, session }
      );

      await StockMovement.create([{
        inventoryId: inv._id, productId: src.productId, ownerType: "company", ownerId: companyId,
        type: "in_transit_in", channel: "internal", quantity: qty, balanceAfter: inv.availableStock,
        refType: "Transfer", refId: shipment._id, performedBy,
        note: `Scanned in (shipment ${shipment._id})`,
      }], { session });

      // CLAIM THE UNITS. Conditional on them still being in transit, so a
      // concurrent receipt of the same carton lands them once only.
      const claimed = await UnitSerial.updateMany(
        {
          _id: { $in: lotUnits.map((u) => u._id) },
          status: IN_TRANSIT_STATUS, currentShipmentId: shipment._id,
        },
        { $set: { inventoryId: inv._id, status: "in_stock", currentShipmentId: null } },
        { session }
      );
      if (!claimed.modifiedCount) throw httpErr(MSG.staleScan, 409);

      await UnitEvent.insertMany(
        lotUnits.map((u) => ({
          companyId, serial: u.serial, event: "transferred_in",
          fromStatus: IN_TRANSIT_STATUS, toStatus: "in_stock",
          refType: "Transfer", refId: shipment._id, actorId: verifierId || performedBy || null,
        })),
        { session }
      );

      // The line this lot came in on, so the progress counter and the
      // shipping-label path read the same figure.
      for (const line of shipment.lines) {
        if (String(line.inventoryId) !== lotId) continue;
        line.receivedQty = Math.min(Number(line.qty || 0), Number(line.receivedQty || 0) + qty);
        break;
      }

      landedRows.push({
        inventoryId: String(inv._id),
        lotNumber: src.lotNumber || src.batchNumber,
        productId: String(src.productId),
        qty,
        serials: lotUnits.map((u) => u.serial),
      });
      emitInventoryUpdate(inv);
    }
  });

  // NOTHING LEFT ON THE TRUCK decides the status — not whether the lines add up,
  // because a short transfer would otherwise never close.
  const stillInTransit = await UnitSerial.countDocuments({
    companyId, status: IN_TRANSIT_STATUS, currentShipmentId: shipment._id,
  });
  const status = stillInTransit === 0 ? "received" : "partially_received";

  shipment.pod = {
    ...shipment.pod,
    verifiedBy: verifierId || null,
    verifiedAt: new Date(),
    warehouseId: shipment.toWarehouseId,
    method: "scan",
  };
  shipment.statusHistory.push({
    status, at: new Date(), byUserId: verifierId || null,
    warehouseId: shipment.toWarehouseId, lat, lng,
    note: stillInTransit === 0
      ? "Received in full by scan"
      : `Scanned in — ${stillInTransit} unit(s) still in transit`,
  });
  shipment.status = status;
  if (stillInTransit === 0) shipment.deliveredAt = new Date();
  await shipment.save();

  const ctx = await receiveContext(companyId, shipment);
  return {
    shipmentId: String(shipment._id),
    ref: ctx.ref,
    status,
    receivedNow: units.length,
    stillInTransit,
    byLot: landedRows,
  };
}

module.exports = {
  MSG,
  RECEIVABLE,
  refOf,
  receiveChecklist,
  resolveReceiveScan,
  receiveScannedUnits,
};
