const PickList = require("../model/Outbound/PickList");
const Order = require("../model/Order/Order");
const UnitSerial = require("../model/Barcode/UnitSerial");
const InventoryBin = require("../model/Inventory/InventoryBin");
const Location = require("../model/Warehouse/Location");
const { nextSeq } = require("./counterService");
const locationService = require("./locationService");
const barcodeService = require("./barcodeService");
const { validateConfirmPick } = require("./pickScanService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function nextWaveNumber(companyId) {
  const seq = await nextSeq(companyId, "wave");
  return `WAVE-${String(seq).padStart(4, "0")}`;
}

/** Choose the bin holding the most of an inventory row (pick faces first). */
async function chooseSourceBin(companyId, inventoryId) {
  const bins = await InventoryBin.find({ companyId, inventoryId, qty: { $gt: 0 } }).populate("locationId", "fullCode isPickFace");
  if (!bins.length) return null;
  bins.sort((a, b) => (b.locationId?.isPickFace ? 1 : 0) - (a.locationId?.isPickFace ? 1 : 0) || b.qty - a.qty);
  return bins[0].locationId || null;
}

/**
 * Generate a pick wave from confirmed orders' stored FEFO allocations. One line
 * per allocation, sourced from the bin holding it, routed (sorted) by bin
 * fullCode — a simple S-shape walk path.
 *
 * (Seller SUPPLY orders do NOT use waves — they are picked directly against
 * their reserved allocations via the supply controller's /pick endpoint.)
 */
async function generateWave(companyId, { warehouseId, orderIds }) {
  if (!orderIds?.length) throw httpErr("orderIds are required");
  const orders = await Order.find({ _id: { $in: orderIds }, companyId });
  if (!orders.length) throw httpErr("No matching orders", 404);

  const lines = [];
  for (const order of orders) {
    for (const it of order.items || []) {
      for (const a of it.allocations || []) {
        if (a.committed) continue; // already dispatched
        const bin = await chooseSourceBin(companyId, a.inventoryId);
        lines.push({
          orderId: order._id,
          productId: it.productId,
          inventoryId: a.inventoryId,
          lotNumber: a.lotNumber,
          fromLocationId: bin?._id || null,
          fromCode: bin?.fullCode || "POOL",
          qty: a.qty,
          pickedQty: 0,
          serials: [],
          status: "pending",
        });
      }
    }
  }
  if (!lines.length) throw httpErr("Nothing to pick for these orders (no open allocations)", 400);

  // S-shape route: sort by bin fullCode.
  lines.sort((a, b) => String(a.fromCode).localeCompare(String(b.fromCode)));

  const waveNumber = await nextWaveNumber(companyId);
  return PickList.create({ companyId, warehouseId, waveNumber, orderIds, lines, status: "open" });
}

/**
 * Scan-pick a line: optionally verify the scanned bin, decrement it, and for
 * serial-tracked stock transition the scanned units in_stock → picked.
 */
async function pickLine(companyId, pickListId, lineIndex, { binCode, serials, qty, performedBy } = {}) {
  const pl = await PickList.findOne({ _id: pickListId, companyId });
  if (!pl) throw httpErr("Pick list not found", 404);
  const line = pl.lines[lineIndex];
  if (!line) throw httpErr("Pick line not found", 404);
  if (line.status === "picked") throw httpErr("Line already picked", 409);

  // Verify the scanned bin matches the routed source (when one is set).
  if (line.fromLocationId && binCode) {
    const loc = await Location.findOne({ companyId, fullCode: String(binCode).toUpperCase() });
    if (!loc || String(loc._id) !== String(line.fromLocationId)) {
      throw httpErr(`Wrong bin — expected ${line.fromCode}`, 409);
    }
  }

  const pickQty = serials?.length ? serials.length : Number(qty || line.qty - line.pickedQty);
  if (pickQty <= 0) throw httpErr("Nothing to pick");

  // Decrement the physical bin (stock leaves the bin into staging; Inventory
  // totals stay reserved until dispatch commits them).
  if (line.fromLocationId) {
    await locationService.moveBinStock({ companyId, fromLocationId: line.fromLocationId, toLocationId: null, inventoryId: line.inventoryId, qty: pickQty, performedBy });
  }

  // Serial-tracked: transition the scanned units to picked.
  if (serials?.length) {
    const units = await require("../model/Barcode/UnitSerial").find({ companyId, serial: { $in: serials } });
    for (const u of units) {
      if (String(u.inventoryId) !== String(line.inventoryId)) {
        throw httpErr(`Serial ${u.serial} is not from the lot being picked`, 409);
      }
    }
    await barcodeService.transitionUnits(companyId, serials, { toStatus: "picked", event: "picked", refType: "PickList", refId: pl._id, actorId: performedBy });
    line.serials.push(...serials);
  }

  line.pickedQty += pickQty;
  if (line.pickedQty >= line.qty) line.status = "picked";
  pl.status = pl.lines.every((l) => l.status === "picked") ? "picked" : "in_progress";
  pl.markModified("lines");
  await pl.save();
  return pl;
}

/**
 * Direct scan-pick a confirmed ORDER straight against its stored allocations —
 * NO PickList/wave (mirror of the supply direct-pick). Scanned serials go
 * in_stock → picked and are recorded on their allocation; pickedQty tracks
 * progress per line. Owned stock stays reserved until dispatch commits it.
 */
async function pickOrderDirect(companyId, orderId, { picks, performedBy, allowedWarehouseIds = null } = {}) {
  if (!Array.isArray(picks) || !picks.length) throw httpErr("picks are required");
  const order = await Order.findOne({ _id: orderId, companyId });
  if (!order) throw httpErr("Order not found", 404);
  if (!["confirmed", "packed"].includes(order.status)) throw httpErr(`Cannot pick a ${order.status} order`, 409);

  for (const pick of picks) {
    const item = (order.items || []).find((it) => String(it.productId) === String(pick.productId));
    if (!item) throw httpErr(`Product ${pick.productId} is not on this order`, 400);
    const allocByInv = new Map((item.allocations || []).map((a) => [String(a.inventoryId), a]));

    let pickQty;
    if (Array.isArray(pick.serials) && pick.serials.length) {
      // SERVER-SIDE re-validation of the whole payload: duplicates, ownership,
      // reserved-lot membership, warehouse and status, plus the quantity cap.
      // The modal's counts are never trusted.
      // Orders keep the STRICT reserved-lot rule: their FEFO allocations were
      // reserved when the order was confirmed, so picking an unreserved lot
      // would deduct stock nothing ever held. (Dynamic, pick-time allocation is
      // a SUPPLY-request feature — see supplyController.pickSupplyOrder.)
      const { serials } = await validateConfirmPick(companyId, {
        serials: pick.serials,
        allocByInv,
        remainingRequired: Math.max(0, Number(item.qty || 0) - Number(item.pickedQty || 0)),
        allowedWarehouseIds,
      });
      const units = await UnitSerial.find({ companyId, serial: { $in: serials } });
      const bySerial = new Map(units.map((u) => [u.serial, u]));

      // transitionUnits is a compare-and-swap per unit, so a unit another picker
      // took between the check above and here is REPORTED, never double-picked.
      const { moved } = await barcodeService.transitionUnits(companyId, serials, { toStatus: "picked", event: "picked", refType: "Order", refId: order._id, actorId: performedBy });
      if (moved.length !== serials.length) {
        throw httpErr("Some units were picked by another user just now — rescan and try again", 409);
      }
      for (const s of serials) {
        const a = allocByInv.get(String(bySerial.get(s).inventoryId));
        a.serials = a.serials || [];
        if (!a.serials.includes(s)) a.serials.push(s);
      }
      pickQty = serials.length;
    } else {
      pickQty = Number(pick.qty);
      if (!pickQty || pickQty <= 0) throw httpErr("Each pick needs serials or a positive qty");
    }

    if (pick.binCode) {
      const loc = await Location.findOne({ companyId, fullCode: String(pick.binCode).toUpperCase() });
      const inventoryId = item.allocations?.[0]?.inventoryId;
      if (loc && inventoryId) {
        await locationService.moveBinStock({ companyId, fromLocationId: loc._id, toLocationId: null, inventoryId, qty: pickQty, performedBy }).catch(() => {});
      }
    }

    item.pickedQty = Math.min(item.qty, (item.pickedQty || 0) + pickQty);
  }

  order.markModified("items");
  await order.save();
  return order;
}

async function listPickLists(companyId, { status, warehouseId } = {}) {
  const filter = { companyId };
  if (status) filter.status = status;
  if (warehouseId) filter.warehouseId = warehouseId;
  return PickList.find(filter).populate("orderIds", "orderNumber invoiceNumber").sort({ createdAt: -1 });
}

async function getPickList(companyId, id) {
  const pl = await PickList.findOne({ _id: id, companyId }).populate("lines.productId", "productName skuNumber");
  if (!pl) throw httpErr("Pick list not found", 404);
  return pl;
}

module.exports = { generateWave, pickLine, pickOrderDirect, listPickLists, getPickList };
