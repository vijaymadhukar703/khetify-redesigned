/**
 * sellerReceiveScanService.js — the scan step for RECEIVING a SELLER
 * warehouse → warehouse transfer, box by box.
 *
 * The seller mirror of services/receiveScanService.js. See
 * sellerDispatchScanService for why the company module could not simply be
 * reused: every query in it is hard-scoped to a company.
 *
 * THE SHIPPING LABEL WAS THE ONLY WAY IN. One manifest barcode is minted per
 * shipment, so a transfer that physically arrives as five cartons had a single
 * barcode between them — nothing to stick it on, and no way to take three today
 * and two tomorrow. Every carton now carries its own printed ID, so this
 * accepts all of them:
 *
 *   Shipping label     → everything still in transit, in one scan
 *   Transfer Box ID    → a box assembled at dispatch (KH-…-SBX-…)
 *   Bulk Packaging ID  → the carton, cascading through its inner boxes
 *   Inner Box ID       → that box
 *   Lot Number         → that lot's share of the transfer
 *   Unit Code          → one unit
 *
 * WHAT THIS SIDE OWNS is which units count. Sending out, a unit must be on the
 * shelf here ("in_stock"). Coming in, it must be IN TRANSIT ON THIS SHIPMENT
 * ("shipped" + currentShipmentId), which is what makes every other answer fall
 * out correctly: stock that was never dispatched is not part of the transfer,
 * and stock already landed is no longer in transit, so it can never be received
 * twice however it is scanned.
 *
 * ── WHY THE LANDING IS PERFORMED HERE ──
 * shipmentService.verifyReceipt is the shared, manifest-QR path and is left
 * exactly as it is. Its seller→seller branch credits the destination Inventory
 * row and writes the ledger entry, but it does not repoint the UNIT rows or the
 * BULK PACKAGE rows — so units stayed "shipped" forever and a carton kept
 * pointing at the source warehouse. Rather than edit a function the company
 * warehouse also runs through, the seller transfer landing is done in full
 * here: units are repointed to the destination lot row, their status returns to
 * "in_stock", and `BulkPackage.lot_id` / `warehouse_id` follow the units they
 * hold, so a carton scanned at the destination resolves to where it actually is.
 */

const Shipment = require("../model/Transport/Shipment");
const Inventory = require("../model/Inventory/Inventory");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const StockMovement = require("../model/Inventory/StockMovement");
const SellerRepackBox = require("../model/Seller/SellerRepackBox");
const TransferRequest = require("../model/Transport/TransferRequest");
const { withTransaction } = require("./txn");
const { emitInventoryUpdate } = require("./inventoryService");
const { norm, matchEither, codeVariants, unitHolderIds } = require("./packagingScanService");
const sellerRepack = require("./sellerRepackService");

function httpErr(message, status = 400, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

/** A unit is receivable only from this status, and only on THIS shipment. */
const IN_TRANSIT_STATUS = "shipped";

/**
 * The states a transfer can still be received in. "partially_received" is here
 * deliberately: three cartons today and two tomorrow is the whole point of
 * scanning them individually.
 */
const RECEIVABLE = new Set(["in_transit", "arrived", "verifying", "partially_received"]);

const refOf = (shipment) =>
  shipment.lrNumber || `SH-${String(shipment._id).slice(-6).toUpperCase()}`;

const onDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;

const MSG = {
  notOnTransfer: (code, ref) => `${code} is not part of transfer ${ref}.`,
  alreadyReceived: (code, when) =>
    when ? `${code} — already received on ${onDate(when)}.` : `${code} — already received.`,
  unknown: (code) => `Unknown code "${code}".`,
  nothingLeft: "Everything on this transfer has already been received.",
  noneLeftInBox: (id, when) =>
    when ? `${id} — already received on ${onDate(when)}.` : `${id} — already received.`,
  notReceivable: (status) => `Cannot receive a ${status} shipment.`,
  notATransfer: "This shipment is not a warehouse transfer.",
  wrongWarehouse: "Access denied — wrong warehouse",
  sourceCannotReceive: "Access denied — wrong warehouse (source cannot complete the receipt)",
  nothingScanned: "Scan at least one label before receiving.",
  staleScan: "These units are no longer in transit — someone may have received them already.",
};

/* ------------------------------------------------------------- shipment */

async function loadShipment(sellerId, shipmentId, { requireReceivable = true } = {}) {
  const shipment = await Shipment.findOne({ _id: shipmentId, ownerType: "seller", ownerId: sellerId });
  if (!shipment) throw httpErr("Shipment not found", 404);
  if (shipment.toType !== "warehouse" || !shipment.toWarehouseId) throw httpErr(MSG.notATransfer, 400);
  if (requireReceivable && !RECEIVABLE.has(shipment.status)) {
    throw httpErr(MSG.notReceivable(shipment.status), 409);
  }
  return shipment;
}

/**
 * MAY THIS USER RECEIVE HERE? The very checks the manifest path runs
 * (shipmentService.verifyReceipt), applied to the scan path so neither is the
 * softer way in.
 */
function assertDestination(shipment, { warehouseId, allowedWarehouseIds } = {}) {
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
}

/** Is this the shipment's own manifest barcode? */
const isShippingLabel = (shipment, value) =>
  !!shipment.qrToken && norm(value) === norm(`${shipment._id}.${shipment.qrToken}`);

/** When these units landed on this transfer, or null if they never did. */
async function receivedOn(shipmentId, serials) {
  if (!serials?.length) return null;
  const ev = await UnitEvent.findOne({
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
 * WHAT IS STILL COMING, and what has already landed. Expected is read off the
 * shipment's lines — after dispatch those are no longer a plan but the record
 * of what physically left (the dispatch rewrites them from the scan).
 */
async function receiveContext(sellerId, shipment) {
  const lines = shipment.lines || [];
  const lotIds = [...new Set(lines.map((l) => String(l.inventoryId)).filter(Boolean))];
  const lots = lotIds.length
    ? await Inventory.find({ _id: { $in: lotIds } })
      .select("lotNumber batchNumber productId warehouseId")
      .lean()
    : [];
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

/** The product rows the receive dialog renders. */
async function receiveChecklist(sellerId, shipmentId) {
  const shipment = await loadShipment(sellerId, shipmentId, { requireReceivable: false });
  const ctx = await receiveContext(sellerId, shipment);

  const products = await Product.find({ _id: { $in: [...ctx.expected.keys()] } })
    .select("productName")
    .lean();
  const nameById = new Map(products.map((p) => [String(p._id), p.productName]));

  const stillInTransit = await UnitSerial.countDocuments({
    ownerType: "seller", ownerId: sellerId,
    status: IN_TRANSIT_STATUS, currentShipmentId: shipment._id,
  });

  const items = [...ctx.expected.entries()].map(([productId, expectedQty]) => ({
    productId,
    name: nameById.get(productId) || "Item",
    expectedQty,
    receivedQty: ctx.received.get(productId) || 0,
  }));

  // WHAT CAME IN ON THE EARLIER VISITS, per lot and with the date it landed.
  // Without it a transfer reopened on day two shows "Received 40 / 50" with
  // nothing to account for the 40.
  const landedEvents = await UnitEvent.find({
    event: "transferred_in", refType: "Transfer", refId: shipment._id,
  })
    .select("serial at")
    .sort({ at: 1 })
    .lean();

  const alreadyReceived = [];
  if (landedEvents.length) {
    const atBySerial = new Map(landedEvents.map((e) => [e.serial, e.at]));
    const landedUnits = await UnitSerial.find({
      ownerType: "seller", ownerId: sellerId, serial: { $in: landedEvents.map((e) => e.serial) },
    })
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
      const at = atBySerial.get(u.serial);
      if (at && (!row.receivedAt || new Date(at) > new Date(row.receivedAt))) row.receivedAt = at;
    }
    alreadyReceived.push(...byLot.values());
  }

  // The boxes this transfer travelled in, so the dialog can show a checklist of
  // exactly what the operator should have in their hands.
  const boxes = (await sellerRepack.listForShipment(sellerId, shipment._id)).map((b) => ({
    boxNumber: b.boxNumber,
    totalBoxes: b.totalBoxes,
    sellerBoxId: b.sellerBoxId,
    productName: b.productName,
    unitCount: b.unitCount,
    status: b.status,
  }));

  return {
    shipmentId: String(shipment._id),
    ref: ctx.ref,
    status: shipment.status,
    fromLabel: shipment.fromLabel || null,
    toLabel: shipment.toLabel || null,
    toWarehouseId: shipment.toWarehouseId ? String(shipment.toWarehouseId) : null,
    receivable: RECEIVABLE.has(shipment.status),
    items,
    expectedTotal: items.reduce((n, i) => n + i.expectedQty, 0),
    receivedTotal: items.reduce((n, i) => n + i.receivedQty, 0),
    stillInTransit,
    alreadyReceived,
    boxes,
  };
}

/* ------------------------------------------------------------ resolving */

/** Units of this shipment still in transit, optionally narrowed. */
function inTransitUnits(sellerId, shipmentId, extra = {}) {
  return UnitSerial.find({
    ownerType: "seller",
    ownerId: sellerId,
    status: IN_TRANSIT_STATUS,
    currentShipmentId: shipmentId,
    ...extra,
  })
    .select("serial unit_code inventoryId lotNumber batchNumber productId bulk_packaging_id bulk_packaging_record_id seller_repack_box_id")
    .sort({ lotNumber: 1, unit_serial: 1 })
    .lean();
}

function result({
  scanType, units, ctx, selected, label,
  bulkPackagingId = null, sellerBoxId = null, boxLevel = null,
  boxUnitTotal = null,
}) {
  const fresh = units.filter((u) => !selected.has(norm(u.serial)));
  const first = fresh[0] || units[0] || {};
  return {
    scanType,
    label,
    boxLevel,
    bulkPackagingId,
    sellerBoxId,
    lotId: first.inventoryId ? String(first.inventoryId) : null,
    lotNumber: first.lotNumber || first.batchNumber || null,
    // A box may legitimately hold several lots, so the row states that rather
    // than pretending there is a single lot.
    lotCount: new Set(fresh.map((u) => String(u.inventoryId))).size,
    productId: String(first.productId || ""),
    addedUnitCodes: fresh.map((u) => u.serial),
    addedQuantity: fresh.length,
    skippedQuantity: units.length - fresh.length,
    boxUnitTotal,
    expectedTotal: [...ctx.expected.values()].reduce((a, b) => a + b, 0),
  };
}

/**
 * Resolve ONE scanned code against this incoming transfer. READ-ONLY — it moves
 * nothing; receiveScannedUnits re-checks everything before any stock lands.
 */
async function resolveReceiveScan(sellerId, shipmentId, { code, selectedCodes = [] }) {
  const value = String(code || "").trim();
  if (!value) throw httpErr("A code is required", 400);

  const shipment = await loadShipment(sellerId, shipmentId);
  const ctx = await receiveContext(sellerId, shipment);
  const selected = new Set((selectedCodes || []).map(norm).filter(Boolean));

  /* 1 — THE SHIPPING LABEL, a shortcut over the same machinery: it selects
         everything still in transit, in one scan. */
  if (isShippingLabel(shipment, value)) {
    const units = await inTransitUnits(sellerId, shipment._id);
    if (!units.length) throw httpErr(MSG.nothingLeft, 409, { code: "NOTHING_LEFT" });
    const fresh = units.filter((u) => !selected.has(norm(u.serial)));
    if (!fresh.length) throw httpErr(MSG.alreadyReceived("This shipping label"), 409, { code: "DUPLICATE" });
    return result({ scanType: "shipment", units, ctx, selected, label: `Shipping label · ${ctx.ref}` });
  }

  /* 2 — A TRANSFER BOX packed at dispatch. Its own ID, on its own label. */
  const sellerBox = await matchEither(
    (v) => SellerRepackBox.findOne({ seller_id: sellerId, seller_repack_box_id: v })
      .select("seller_repack_box_id status shipment_id"),
    value,
  );
  if (sellerBox) {
    if (String(sellerBox.shipment_id) !== String(shipment._id)) {
      throw httpErr(`${sellerBox.seller_repack_box_id} belongs to a different transfer.`, 409, { code: "WRONG_SHIPMENT" });
    }
    const units = await inTransitUnits(sellerId, shipment._id, { seller_repack_box_id: sellerBox._id });
    if (!units.length) {
      const boxSerials = (await UnitSerial.find({ seller_repack_box_id: sellerBox._id }).select("serial").lean())
        .map((u) => u.serial);
      const when = await receivedOn(shipment._id, boxSerials);
      throw httpErr(
        when
          ? MSG.noneLeftInBox(sellerBox.seller_repack_box_id, when)
          : MSG.notOnTransfer(sellerBox.seller_repack_box_id, ctx.ref),
        409, { code: "NOTHING_LEFT" }
      );
    }
    const fresh = units.filter((u) => !selected.has(norm(u.serial)));
    if (!fresh.length) throw httpErr(MSG.alreadyReceived(sellerBox.seller_repack_box_id), 409, { code: "DUPLICATE" });
    const boxUnitTotal = await UnitSerial.countDocuments({ seller_repack_box_id: sellerBox._id });
    return result({
      scanType: "seller_box", units, ctx, selected,
      sellerBoxId: sellerBox.seller_repack_box_id,
      bulkPackagingId: sellerBox.seller_repack_box_id,
      label: `Transfer box · ${sellerBox.seller_repack_box_id}`,
      boxUnitTotal,
    });
  }

  /* 3 — A BULK PACKAGING BOX, main or inner. A main carton resolves through its
         inner boxes, which is what makes the cascade land everything nailed
         inside it. */
  const box = await matchEither(
    (v) => BulkPackage.findOne({ bulk_packaging_id: v })
      .select("bulk_packaging_id company_id box_level parent_box_id lot_id"),
    value,
  );
  if (box) {
    const holderIds = await unitHolderIds(box.company_id, box);
    const scope = { bulk_packaging_record_id: { $in: holderIds } };
    const units = await inTransitUnits(sellerId, shipment._id, scope);
    if (!units.length) {
      const boxSerials = (await UnitSerial.find(scope).select("serial").lean()).map((u) => u.serial);
      const when = await receivedOn(shipment._id, boxSerials);
      throw httpErr(
        when ? MSG.noneLeftInBox(box.bulk_packaging_id, when) : MSG.notOnTransfer(box.bulk_packaging_id, ctx.ref),
        409, { code: "NOTHING_LEFT" }
      );
    }
    const fresh = units.filter((u) => !selected.has(norm(u.serial)));
    if (!fresh.length) throw httpErr(MSG.alreadyReceived(box.bulk_packaging_id), 409, { code: "DUPLICATE" });
    const boxUnitTotal = await UnitSerial.countDocuments({ ownerType: "seller", ownerId: sellerId, ...scope });
    return result({
      scanType: "bulk_package", units, ctx, selected,
      boxLevel: box.box_level === "main" ? "main" : "inner",
      bulkPackagingId: box.bulk_packaging_id,
      label: `${box.box_level === "main" ? "Bulk packaging" : "Inner box"} · ${box.bulk_packaging_id}`,
      boxUnitTotal,
    });
  }

  /* 4 — ONE UNIT. */
  const unit = await matchEither(
    (v) => UnitSerial.findOne({
      ownerType: "seller", ownerId: sellerId, $or: [{ serial: v }, { unit_code: v }],
    }).select("serial unit_code status currentShipmentId"),
    value,
  );
  if (unit) {
    const code2 = unit.unit_code || unit.serial;
    if (String(unit.currentShipmentId || "") !== String(shipment._id)
      || unit.status !== IN_TRANSIT_STATUS) {
      const when = await receivedOn(shipment._id, [unit.serial]);
      throw httpErr(when ? MSG.alreadyReceived(code2, when) : MSG.notOnTransfer(code2, ctx.ref), 409, { code: "NOT_IN_TRANSIT" });
    }
    if (selected.has(norm(unit.serial))) throw httpErr(MSG.alreadyReceived(code2), 409, { code: "DUPLICATE" });

    const [full] = await inTransitUnits(sellerId, shipment._id, { _id: unit._id });
    if (!full) throw httpErr(MSG.alreadyReceived(code2), 409, { code: "DUPLICATE" });
    return result({ scanType: "unit", units: [full], ctx, selected, label: `Unit · ${code2}` });
  }

  /* 5 — A LOT NUMBER: everything of that lot still in transit on this transfer. */
  const onTransfer = [...ctx.lotById.values()].find(
    (l) => norm(l.lotNumber) === norm(value) || norm(l.batchNumber) === norm(value)
  );
  if (onTransfer) {
    const units = await inTransitUnits(sellerId, shipment._id, { inventoryId: onTransfer._id });
    if (!units.length) throw httpErr(MSG.noneLeftInBox(onTransfer.lotNumber || value), 409, { code: "NOTHING_LEFT" });
    const fresh = units.filter((u) => !selected.has(norm(u.serial)));
    if (!fresh.length) throw httpErr(MSG.alreadyReceived(onTransfer.lotNumber || value), 409, { code: "DUPLICATE" });
    return result({
      scanType: "lot", units, ctx, selected,
      label: `Lot · ${onTransfer.lotNumber || onTransfer.batchNumber}`,
    });
  }

  const known = await Inventory.exists({
    ownerType: "seller", ownerId: sellerId,
    $or: [{ lotNumber: value }, { batchNumber: value }],
  });
  throw known
    ? httpErr(MSG.notOnTransfer(value, ctx.ref), 409, { code: "NOT_ON_TRANSFER" })
    : httpErr(MSG.unknown(value), 404, { code: "UNKNOWN" });
}

/* --------------------------------------------------------- box relocation */

/**
 * BOXES FOLLOW THEIR UNITS.
 *
 * A BulkPackage row states its location TWICE: `lot_id` (the Inventory row the
 * carton belongs to) and `warehouse_id` (where it is booked). Neither is
 * touched by the stock ledger, so without this a transfer left the quantity and
 * the unit labels at the destination while every carton still pointed at the
 * SOURCE row in the SOURCE warehouse — and the next scan of that box ID was
 * refused as "not held at this warehouse".
 *
 * A MAIN carton travels only when every inner box inside it did, so a partial
 * transfer moves exactly the cartons that physically went.
 *
 * Nothing is created or deleted and no `bulk_packaging_id` is rewritten — that
 * identity is printed on the physical carton and never changes; only where the
 * carton IS does.
 */
async function moveBoxesWithUnits({ units, toLotId, toWarehouseId, session }) {
  const candidateIds = [...new Set(
    units.map((u) => u.bulk_packaging_record_id).filter(Boolean).map(String)
  )];
  if (!candidateIds.length) return;

  /**
   * A CARTON ONLY TRAVELS IF ALL OF IT TRAVELLED.
   *
   * Since a unit can now be taken OUT of a box and sent on its own, a single
   * unit of a bulk carton may arrive here while the rest of that carton stays
   * behind at the source. Relocating the carton on the strength of that one unit
   * would move a box record away from the units still sitting in it — the exact
   * disagreement between a box and its contents that `boxStockLocation` exists
   * to work around.
   *
   * So a carton is relocated only when NOTHING of it is left anywhere else. The
   * question is asked of the units themselves: are there any units of this box
   * that are not among the ones just landed? If there are, the box stays put and
   * the arrived unit simply lives at the destination without its old carton —
   * which is correct, because physically it arrived loose, in a new transfer box.
   */
  const landedIds = new Set(units.map((u) => String(u._id)));
  const movedIds = [];
  for (const boxId of candidateIds) {
    const stragglers = await UnitSerial.countDocuments({
      bulk_packaging_record_id: boxId,
      _id: { $nin: [...landedIds] },
    }).session(session);
    if (!stragglers) movedIds.push(boxId);
  }
  if (!movedIds.length) return;

  const moved = await BulkPackage.find({ _id: { $in: movedIds } })
    .select("parent_box_id")
    .session(session)
    .lean();
  const parentIds = [...new Set(moved.map((b) => b.parent_box_id).filter(Boolean).map(String))];

  const wholeParents = [];
  if (parentIds.length) {
    const movedSet = new Set(movedIds);
    const children = await BulkPackage.find({ parent_box_id: { $in: parentIds } })
      .select("parent_box_id")
      .session(session)
      .lean();
    const byParent = new Map();
    for (const c of children) {
      const key = String(c.parent_box_id);
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(String(c._id));
    }
    for (const [parent, kids] of byParent) {
      if (kids.every((id) => movedSet.has(id))) wholeParents.push(parent);
    }
  }

  await BulkPackage.updateMany(
    { _id: { $in: [...movedIds, ...wholeParents] } },
    { $set: { lot_id: toLotId, warehouse_id: toWarehouseId } },
    { session }
  );
}

/* ------------------------------------------------------------- receiving */

/**
 * LAND THE SCANNED UNITS. Partial by design: whatever is scanned is received,
 * and the transfer stays receivable until nothing is left in transit.
 *
 * Every unit is re-resolved from the database — the client's list is a request,
 * never the truth — and only units still `shipped` on THIS shipment can land,
 * so two managers receiving the same box at once cannot both book it in.
 *
 * Per source lot: the destination Inventory row is upserted, the ledger gets its
 * `in_transit_in` row, the units are repointed to that row and returned to
 * stock, and the cartons that travelled follow them.
 */
async function receiveScannedUnits(sellerId, shipmentId, {
  serials = [], performedBy, warehouseId, allowedWarehouseIds = null,
} = {}) {
  const codes = codeVariants(serials);
  if (!codes.length) throw httpErr(MSG.nothingScanned, 400, { code: "NOTHING_SCANNED" });

  const shipment = await loadShipment(sellerId, shipmentId);
  assertDestination(shipment, { warehouseId, allowedWarehouseIds });

  // The destination warehouse must be this seller's own. There is deliberately
  // NO geofence and NO customer/delivery information: a warehouse transfer is
  // validated by warehouse ownership and the scanned labels, exactly as the
  // seller manifest path already is.
  const dest = await Warehouse.findOne({ _id: shipment.toWarehouseId, sellerId });
  if (!dest) throw httpErr("Destination warehouse not found", 404);

  const units = await UnitSerial.find({
    ownerType: "seller",
    ownerId: sellerId,
    serial: { $in: codes },
    status: IN_TRANSIT_STATUS,
    currentShipmentId: shipment._id,
  }).select("serial inventoryId productId batchNumber lotNumber bulk_packaging_record_id companyId");
  if (!units.length) throw httpErr(MSG.staleScan, 409, { code: "STALE_SCAN" });

  // BY SOURCE LOT — one destination row, one ledger entry and one repoint per
  // lot, however many boxes the units arrived in.
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
          productId: src.productId, ownerType: "seller", ownerId: sellerId,
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
        inventoryId: inv._id, productId: src.productId, ownerType: "seller", ownerId: sellerId,
        type: "in_transit_in", channel: "internal", quantity: qty, balanceAfter: inv.availableStock,
        refType: "Transfer", refId: shipment._id, performedBy,
        note: `Scanned in (shipment ${shipment._id})`,
      }], { session });

      // CLAIM THE UNITS. Conditional on them still being in transit, so a
      // concurrent receipt of the same box lands them once only.
      const claimed = await UnitSerial.updateMany(
        {
          _id: { $in: lotUnits.map((u) => u._id) },
          status: IN_TRANSIT_STATUS, currentShipmentId: shipment._id,
        },
        { $set: { inventoryId: inv._id, status: "in_stock", currentShipmentId: null } },
        { session }
      );
      if (!claimed.modifiedCount) throw httpErr(MSG.staleScan, 409, { code: "STALE_SCAN" });

      await UnitEvent.insertMany(
        lotUnits.map((u) => ({
          companyId: u.companyId, serial: u.serial, event: "transferred_in",
          fromStatus: IN_TRANSIT_STATUS, toStatus: "in_stock",
          refType: "Transfer", refId: shipment._id, actorId: performedBy || null,
        })),
        { session }
      );

      // Cartons follow the units they hold — see moveBoxesWithUnits.
      await moveBoxesWithUnits({
        units: lotUnits, toLotId: inv._id, toWarehouseId: shipment.toWarehouseId, session,
      });

      // The line this lot came in on, so the progress counter reads true.
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

  // NOTHING LEFT ON THE TRUCK decides the status — not whether the lines add
  // up, because a short transfer would otherwise never close.
  const stillInTransit = await UnitSerial.countDocuments({
    ownerType: "seller", ownerId: sellerId,
    status: IN_TRANSIT_STATUS, currentShipmentId: shipment._id,
  });
  const status = stillInTransit === 0 ? "received" : "partially_received";

  shipment.pod = {
    ...shipment.pod,
    verifiedBy: performedBy || null,
    verifiedAt: new Date(),
    warehouseId: shipment.toWarehouseId,
    method: "scan",
  };
  shipment.statusHistory.push({
    status, at: new Date(), byUserId: performedBy || null,
    warehouseId: shipment.toWarehouseId,
    note: stillInTransit === 0
      ? "Received in full by scan"
      : `Scanned in — ${stillInTransit} unit(s) still in transit`,
  });
  shipment.status = status;
  if (stillInTransit === 0) shipment.deliveredAt = new Date();
  await shipment.save();

  if (stillInTransit === 0) {
    await sellerRepack.markReceived(sellerId, shipment._id).catch(() => {});
    // A request-driven transfer is fulfilled the moment the last unit lands.
    if (shipment.refType === "TransferRequest" && shipment.refId) {
      await TransferRequest.updateOne(
        { _id: shipment.refId, ownerType: "seller", ownerId: sellerId },
        { $set: { status: "fulfilled" } }
      ).catch(() => {});
    }
  }

  const ctx = await receiveContext(sellerId, shipment);
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