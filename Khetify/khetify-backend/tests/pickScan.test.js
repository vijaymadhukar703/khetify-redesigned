const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const SupplyOrder = require("../model/Supply/SupplyOrder");
const lotService = require("../services/lotService");
const barcodeService = require("../services/barcodeService");
const { resolvePickScan, validateConfirmPick, MSG } = require("../services/pickScanService");

let companyId, warehouseId, otherWarehouseId, productId, sellerId;

/**
 * A lot booked to the warehouse and labelled. `received: false` leaves it
 * awaiting the warehouse's Receive confirmation (qty still in transit).
 */
async function makeLot({ qty, boxes, perBox, productId: pid, warehouseId: whId, received = true } = {}) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId: pid || productId, warehouseId: whId || warehouseId, qty,
    lotOrigin: "company", pendingReceipt: true,
    ...(boxes ? { hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox } : {}),
  });
  if (received) {
    // Put the stock on the books so its units are pickable.
    await Inventory.updateOne(
      { _id: inv._id },
      { $set: { inTransitStock: 0, offlineStock: qty, availableStock: qty } }
    );
  }
  await barcodeService.generateUnits(companyId, inv._id, qty, {});
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: received ? "in_stock" : "generated" } });
  return Inventory.findById(inv._id);
}

/** A supply order with NO source lot planned at approval. */
async function makeUnallocatedOrder(qty, pid) {
  return SupplyOrder.create({
    companyId, sellerId, status: "approved",
    items: [{ productId: pid || productId, quantity: qty, pickedQty: 0, allocations: [] }],
  });
}

/** A supply order reserving `qty` of `lot`. */
async function makeOrder(lot, qty) {
  return SupplyOrder.create({
    companyId, sellerId, status: "approved",
    items: [{
      productId, quantity: qty, pickedQty: 0,
      allocations: [{ inventoryId: lot._id, lotNumber: lot.lotNumber, qty, serials: [] }],
    }],
  });
}

const scan = (order, code, selectedCodes = [], allowedWarehouseIds = null) =>
  resolvePickScan(companyId, { code, orderType: "supply", orderId: order._id, selectedCodes, allowedWarehouseIds });

const codesOf = (lotId, boxSerial) =>
  UnitSerial.find({ inventoryId: lotId, ...(boxSerial ? { box_serial: boxSerial } : {}) })
    .sort({ unit_serial: 1 }).lean().then((r) => r.map((u) => u.serial));

beforeEach(async () => {
  const co = await Company.create({
    fullName: "Owner", email: `ps-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = co._id;
  sellerId = new mongoose.Types.ObjectId();
  warehouseId = (await Warehouse.create({ companyId, name: "Khargone", code: "KHA" }))._id;
  otherWarehouseId = (await Warehouse.create({ companyId, name: "Indore", code: "IND" }))._id;
  productId = (await Product.create({ companyId, productName: "Premium Basmati Rice" }))._id;
  await BulkPackage.syncIndexes();
  await UnitSerial.syncIndexes();
});

describe("CASE 1 — Bulk Packaging ID scan", () => {
  test("adds every eligible unit in the box", async () => {
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const order = await makeOrder(lot, 5); // one box exactly closes the request
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });

    const r = await scan(order, box1.bulk_packaging_id);
    expect(r.scanType).toBe("bulk_package");
    expect(r.bulkPackagingId).toBe(box1.bulk_packaging_id);
    expect(r.addedQuantity).toBe(5);
    expect(r.addedUnitCodes).toEqual(await codesOf(lot._id, 1));
    expect(r.currentPickedQuantity).toBe(5);
    expect(r.remainingRequired).toBe(0);
  });

  test("the same package twice is refused", async () => {
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const order = await makeOrder(lot, 5);
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });

    const first = await scan(order, box1.bulk_packaging_id);
    await expect(scan(order, box1.bulk_packaging_id, first.addedUnitCodes))
      .rejects.toThrow(MSG.packageScanned);
  });

  test("a box whose units were already scanned individually is refused", async () => {
    // The carton is no longer sealed as far as the pick is concerned — part of
    // it is already in the selection, so it cannot go in as a whole package.
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const order = await makeOrder(lot, 5);
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });
    const box1Codes = await codesOf(lot._id, 1);

    const u1 = await scan(order, box1Codes[0]);
    await expect(scan(order, box1.bulk_packaging_id, u1.addedUnitCodes))
      .rejects.toThrow(MSG.packageScanned);
  });

  test("units that are not in stock are skipped, and reported", async () => {
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    // 2 of the box's 5 are damaged, so its available quantity is 3.
    const order = await makeOrder(lot, 3);
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });
    const box1Codes = await codesOf(lot._id, 1);
    await UnitSerial.updateMany({ serial: { $in: box1Codes.slice(0, 2) } }, { $set: { status: "damaged" } });

    const r = await scan(order, box1.bulk_packaging_id);
    expect(r.addedQuantity).toBe(3);
    expect(r.skippedQuantity).toBe(2);
  });

  test("a package of a DIFFERENT product is refused", async () => {
    const reserved = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const otherProduct = (await Product.create({ companyId, productName: "Urea Fertilizer" }))._id;
    const stranger = await makeLot({ qty: 10, boxes: 2, perBox: 5, productId: otherProduct });
    const order = await makeOrder(reserved, 10);
    const [foreignBox] = await BulkPackage.find({ lot_id: stranger._id }).sort({ box_serial: 1 });

    await expect(scan(order, foreignBox.bulk_packaging_id)).rejects.toThrow(MSG.wrongProduct);
  });

  test("a package in another warehouse is refused for a scoped picker", async () => {
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const order = await makeOrder(lot, 10);
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });

    await expect(scan(order, box1.bulk_packaging_id, [], [otherWarehouseId]))
      .rejects.toThrow(/is currently at/);
  });

  test("a box the warehouse never received is refused, even though its lot is allocated", async () => {
    // The reported bug. The box was dispatched here and is scannable, its lot
    // IS reserved for this request — and being allocated is exactly what used
    // to return before any receipt check ran.
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5, received: false });
    const order = await makeOrder(lot, 5);
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });

    await expect(scan(order, box1.bulk_packaging_id)).rejects.toThrow(/has not been received yet/);
  });

  test("with one box received and one still in transit, only the received box scans", async () => {
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5, received: false });
    const order = await makeOrder(lot, 5);
    const [box1, box2] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });

    // Box 1 arrives: its 5 units land on the shelf. Box 2 is still in transit.
    await BulkPackage.updateOne({ _id: box1._id }, { $set: { status: "received", received_at: new Date() } });
    await Inventory.updateOne(
      { _id: lot._id },
      { $set: { inTransitStock: 5, offlineStock: 5, availableStock: 5 } }
    );
    const box1Codes = await codesOf(lot._id, 1);
    await UnitSerial.updateMany({ serial: { $in: box1Codes } }, { $set: { status: "in_stock" } });

    const ok = await scan(order, box1.bulk_packaging_id);
    expect(ok.addedQuantity).toBe(5);
    await expect(scan(order, box2.bulk_packaging_id)).rejects.toThrow(/has not been received yet/);
  });

  test("Confirm Pick refuses a unit from a box the warehouse never received", async () => {
    // The write path, not the scan: a stale client cannot post its way past it.
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5, received: false });
    const codes = await codesOf(lot._id, 1);
    await UnitSerial.updateMany({ inventoryId: lot._id }, { $set: { status: "in_stock" } });

    await expect(validateConfirmPick(companyId, {
      serials: [codes[0]],
      allocByInv: new Map([[String(lot._id), { qty: 5 }]]),
      remainingRequired: 5,
    })).rejects.toThrow(/has not been received yet/);
  });
});

/**
 * A warehouse→warehouse transfer, reduced to the two writes a pick has to
 * respect: the destination Inventory row, and the moved units' `inventoryId`
 * being repointed at it on receipt (shipmentService). `bulk_packaging_record_id`
 * is deliberately LEFT ALONE — exactly as the real receipt leaves it — because
 * that is what made a fully-transferred box keep resolving in the source
 * warehouse.
 */
async function transferUnitsAway(lot, serials, toWarehouseId = otherWarehouseId) {
  const dest = await Inventory.findOneAndUpdate(
    {
      productId: lot.productId, ownerType: "company", ownerId: companyId,
      warehouseId: toWarehouseId, batchNumber: lot.batchNumber,
    },
    { $inc: { offlineStock: serials.length, availableStock: serials.length }, $set: { lotNumber: lot.lotNumber } },
    { new: true, upsert: true }
  );
  await Inventory.updateOne(
    { _id: lot._id },
    { $inc: { offlineStock: -serials.length, availableStock: -serials.length } }
  );
  await UnitSerial.updateMany(
    { serial: { $in: serials } },
    { $set: { inventoryId: dest._id, status: "in_stock" } }
  );
  return Inventory.findById(lot._id);
}

describe("a Bulk Packaging ID with zero available quantity", () => {
  test("a box fully transferred to another warehouse can no longer be scanned", async () => {
    // BP-001/002/003, 100 units each — the reported lot.
    const lot = await makeLot({ qty: 300, boxes: 3, perBox: 100 });
    const order = await makeOrder(lot, 100);
    const [box1, box2] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });

    // BP-001 leaves for another warehouse — available quantity here drops to 0.
    await transferUnitsAway(lot, await codesOf(lot._id, 1));

    await expect(scan(order, box1.bulk_packaging_id)).rejects.toThrow(/has already been transferred out/);

    // BP-002 is untouched and still picks in full.
    const r = await scan(order, box2.bulk_packaging_id);
    expect(r.addedQuantity).toBe(100);
  });

  test("the original box size is never used — availability is what is left here", async () => {
    const lot = await makeLot({ qty: 20, boxes: 2, perBox: 10 });
    // 6 of BP-001's 10 units leave, so the box is worth 4 here — and the request
    // needs exactly 4. The 10 printed on the carton is never consulted.
    const order = await makeOrder(lot, 4);
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });
    const box1Codes = await codesOf(lot._id, 1);

    await transferUnitsAway(lot, box1Codes.slice(0, 6));

    const r = await scan(order, box1.bulk_packaging_id);
    expect(r.addedQuantity).toBe(4);
    expect(r.addedUnitCodes).toEqual(box1Codes.slice(6));
    expect(r.skippedQuantity).toBe(0); // the 6 that left are gone, not "skipped"
  });

  test("a transferred box is refused even when it was allocated to the request", async () => {
    // The strictest case: the lot IS this request's reserved allocation, so the
    // lot-level checks all pass — only the per-box availability catches it.
    const lot = await makeLot({ qty: 100, boxes: 1, perBox: 100 });
    const order = await makeOrder(lot, 100);
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });

    await transferUnitsAway(lot, await codesOf(lot._id, 1));

    await expect(scan(order, box1.bulk_packaging_id)).rejects.toThrow(/has already been transferred out/);
  });

  test("units still here but not in stock keep the 'already picked or unavailable' reason", async () => {
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const order = await makeOrder(lot, 10);
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });
    await UnitSerial.updateMany({ inventoryId: lot._id, box_serial: 1 }, { $set: { status: "picked" } });

    await expect(scan(order, box1.bulk_packaging_id)).rejects.toThrow(MSG.noneEligible);
  });
});

/**
 * A Bulk Packaging ID is a SEALED, INDIVISIBLE package: it may be picked only
 * when its available quantity is exactly what the request still needs. Short of
 * that would split the carton; over that would over-dispatch it.
 *
 * The five cases below are the specified acceptance examples, all against a
 * 100-unit BP-001.
 */
describe("a Bulk Packaging ID is indivisible — exact-quantity match only", () => {
  /** BP-001 = 100 units, in a lot big enough that the request drives the test. */
  const bp100 = async (requiredQty) => {
    const lot = await makeLot({ qty: 300, boxes: 3, perBox: 100 });
    const order = await makeOrder(lot, requiredQty);
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });
    return { lot, order, box1 };
  };

  test("remaining 100 vs a 100-unit package → allowed", async () => {
    const { order, box1 } = await bp100(100);
    const r = await scan(order, box1.bulk_packaging_id);
    expect(r.addedQuantity).toBe(100);
    expect(r.remainingRequired).toBe(0);
  });

  test("remaining 99 vs a 100-unit package → refused, with both numbers named", async () => {
    const { order, box1 } = await bp100(99);
    await expect(scan(order, box1.bulk_packaging_id)).rejects.toThrow(
      "This Bulk Packaging ID contains 100 units. The remaining quantity is 99. "
      + "Bulk Packaging IDs can only be picked when the package quantity exactly matches "
      + "the remaining required quantity."
    );
  });

  test("remaining 101 vs a 100-unit package → refused", async () => {
    const { order, box1 } = await bp100(101);
    await expect(scan(order, box1.bulk_packaging_id))
      .rejects.toThrow(MSG.packageQtyMismatch(100, 101));
  });

  test("remaining 200 vs a 100-unit package → refused (no multi-box top-up)", async () => {
    const { order, box1 } = await bp100(200);
    await expect(scan(order, box1.bulk_packaging_id))
      .rejects.toThrow(MSG.packageQtyMismatch(100, 200));
  });

  test("remaining 50 vs a 100-unit package → refused (no partial dispatch)", async () => {
    const { order, box1 } = await bp100(50);
    await expect(scan(order, box1.bulk_packaging_id))
      .rejects.toThrow(MSG.packageQtyMismatch(100, 50));
  });

  test("already-picked quantity counts — a 100-unit box fits a 300-unit line with 200 picked", async () => {
    const { order, box1 } = await bp100(300);
    order.items[0].pickedQty = 200;
    await order.save();

    const r = await scan(order, box1.bulk_packaging_id);
    expect(r.addedQuantity).toBe(100);
    expect(r.remainingRequired).toBe(0);
  });

  test("units already selected count — a second box is refused once the line is short", async () => {
    // 200 required, BP-001 scanned (100 selected) → 100 still needed, but the
    // rule is evaluated against the selection, so BP-002 (100) now fits exactly.
    const lot = await makeLot({ qty: 300, boxes: 3, perBox: 100 });
    const order = await makeOrder(lot, 200);
    const [box1, box2] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });

    // BP-001 at remaining 200 is refused outright.
    await expect(scan(order, box1.bulk_packaging_id))
      .rejects.toThrow(MSG.packageQtyMismatch(100, 200));

    // Reaching 200 therefore means picking the first 100 another way (units), at
    // which point BP-002 matches the remaining 100 exactly.
    const unitCodes = await codesOf(lot._id, 1);
    const r = await scan(order, box2.bulk_packaging_id, unitCodes);
    expect(r.addedQuantity).toBe(100);
    expect(r.remainingRequired).toBe(0);
  });

  test("the rule does NOT apply to the customer-ORDER pick", async () => {
    const lot = await makeLot({ qty: 300, boxes: 3, perBox: 100 });
    const Order = require("../model/Order/Order");
    const ord = await Order.create({
      companyId, status: "confirmed",
      items: [{
        productId, qty: 200, price: 100, pickedQty: 0,
        allocations: [{ inventoryId: lot._id, lotNumber: lot.lotNumber, qty: 200, serials: [] }],
      }],
    });
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });

    const r = await resolvePickScan(companyId, {
      code: box1.bulk_packaging_id, orderType: "order", orderId: ord._id, selectedCodes: [],
    });
    expect(r.addedQuantity).toBe(100);
    expect(r.remainingRequired).toBe(100);
  });
});

describe("CASE 2 — unit code inside a box", () => {
  test("adds exactly one unit and keeps its parent box", async () => {
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const order = await makeOrder(lot, 10);
    const codes = await codesOf(lot._id, 1);

    const r1 = await scan(order, codes[0]);
    expect(r1.scanType).toBe("unit");
    expect(r1.addedQuantity).toBe(1);
    expect(r1.currentPickedQuantity).toBe(1);
    expect(r1.bulkPackagingId).toBe(`${lot.lotNumber}-BP-001`);

    const r2 = await scan(order, codes[1], r1.addedUnitCodes);
    expect(r2.currentPickedQuantity).toBe(2);
  });

  test("the same unit twice is refused", async () => {
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const order = await makeOrder(lot, 10);
    const codes = await codesOf(lot._id, 1);

    const r = await scan(order, codes[0]);
    await expect(scan(order, codes[0], r.addedUnitCodes)).rejects.toThrow(MSG.unitScanned);
  });

  test("an already-picked unit is refused", async () => {
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const order = await makeOrder(lot, 10);
    const codes = await codesOf(lot._id, 1);
    await UnitSerial.updateOne({ serial: codes[0] }, { $set: { status: "picked" } });

    await expect(scan(order, codes[0])).rejects.toThrow(/already reserved or in transit/i);
  });
});

describe("CASE 3 — non-bulk lot number scan", () => {
  test("adds every available unit of the lot", async () => {
    const lot = await makeLot({ qty: 6 });
    const order = await makeOrder(lot, 6);

    const r = await scan(order, lot.lotNumber);
    expect(r.scanType).toBe("lot");
    expect(r.addedQuantity).toBe(6);
    expect(r.remainingRequired).toBe(0);
  });

  test("scanning the same lot again adds nothing", async () => {
    const lot = await makeLot({ qty: 6 });
    const order = await makeOrder(lot, 6);
    const r = await scan(order, lot.lotNumber);
    await expect(scan(order, lot.lotNumber, r.addedUnitCodes)).rejects.toThrow(MSG.lotScanned);
  });

  test("a lot WITH Bulk Packaging IDs refuses the parent-lot scan", async () => {
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const order = await makeOrder(lot, 10);
    await expect(scan(order, lot.lotNumber)).rejects.toThrow(MSG.bulkLot);
  });
});

describe("CASE 4 — unit code of a non-bulk lot", () => {
  test("adds one unit at a time", async () => {
    const lot = await makeLot({ qty: 6 });
    const order = await makeOrder(lot, 6);
    const codes = await codesOf(lot._id);

    const r1 = await scan(order, codes[0]);
    const r2 = await scan(order, codes[1], r1.addedUnitCodes);
    expect(r1.scanType).toBe("unit");
    expect(r1.bulkPackagingId).toBeNull();
    expect(r2.currentPickedQuantity).toBe(2);
  });
});

describe("request quantity validation", () => {
  test("a package bigger than what is still required is refused", async () => {
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const order = await makeOrder(lot, 2); // only 2 required
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });

    await expect(scan(order, box1.bulk_packaging_id))
      .rejects.toThrow(MSG.packageQtyMismatch(5, 2));
  });

  test("a lot bigger than what is still required is refused", async () => {
    const lot = await makeLot({ qty: 6 });
    const order = await makeOrder(lot, 2);
    await expect(scan(order, lot.lotNumber)).rejects.toThrow(
      "This lot contains 6 eligible units, but only 2 units are required. Scan individual Unit Codes instead."
    );
  });

  test("individual units stop once the required quantity is reached", async () => {
    const lot = await makeLot({ qty: 6 });
    const order = await makeOrder(lot, 2);
    const codes = await codesOf(lot._id);

    const r1 = await scan(order, codes[0]);
    const r2 = await scan(order, codes[1], r1.addedUnitCodes);
    expect(r2.remainingRequired).toBe(0);
    await expect(scan(order, codes[2], [...r1.addedUnitCodes, ...r2.addedUnitCodes]))
      .rejects.toThrow(MSG.nothingLeft);
  });

  test("already-picked quantity counts against what is still required", async () => {
    const lot = await makeLot({ qty: 6 });
    const order = await makeOrder(lot, 6);
    order.items[0].pickedQty = 4;
    await order.save();

    // 2 left → the whole 6-unit lot no longer fits.
    await expect(scan(order, lot.lotNumber)).rejects.toThrow(/only 2 units are required/);
  });
});

describe("scan lookup priority", () => {
  test("a box ID resolves as a package, and its unit codes as units", async () => {
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const order = await makeOrder(lot, 5);
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });
    const codes = await codesOf(lot._id, 1);

    // "…-BP-001" and "…-BP-001-001" share a prefix — only the DB tells them apart.
    expect((await scan(order, box1.bulk_packaging_id)).scanType).toBe("bulk_package");
    expect((await scan(order, codes[0])).scanType).toBe("unit");
  });

  test("matching is case- and whitespace-insensitive", async () => {
    const lot = await makeLot({ qty: 6 });
    const order = await makeOrder(lot, 6);
    const r = await scan(order, `  ${lot.lotNumber.toLowerCase()}  `);
    expect(r.scanType).toBe("lot");
  });

  test("an unknown code is a 404", async () => {
    const lot = await makeLot({ qty: 6 });
    const order = await makeOrder(lot, 6);
    await expect(scan(order, "NOT-A-REAL-CODE")).rejects.toThrow(/Unknown code/);
  });
});

describe("validateConfirmPick — the server-side guard", () => {
  const allocFor = (lot, qty) => new Map([[String(lot._id), { inventoryId: lot._id, qty, serials: [] }]]);

  test("de-duplicates repeated serials in the payload", async () => {
    const lot = await makeLot({ qty: 6 });
    const codes = await codesOf(lot._id);
    const out = await validateConfirmPick(companyId, {
      serials: [codes[0], codes[0], codes[1]],
      allocByInv: allocFor(lot, 6),
      remainingRequired: 6,
    });
    expect(out.serials).toEqual([codes[0], codes[1]]);
    expect(out.newLots).toEqual([]); // the lot was already allocated
  });

  test("refuses more than the request still needs", async () => {
    const lot = await makeLot({ qty: 6 });
    const codes = await codesOf(lot._id);
    await expect(validateConfirmPick(companyId, {
      serials: codes, allocByInv: allocFor(lot, 6), remainingRequired: 2,
    })).rejects.toThrow(/exceeds the 2 unit\(s\) still required/);
  });

  test("refuses a serial from a lot the request did not reserve", async () => {
    const reserved = await makeLot({ qty: 6 });
    const stranger = await makeLot({ qty: 6 });
    const foreign = await codesOf(stranger._id);
    await expect(validateConfirmPick(companyId, {
      serials: [foreign[0]], allocByInv: allocFor(reserved, 6), remainingRequired: 6,
    })).rejects.toThrow(/not from this request's reserved lots/);
  });

  test("refuses a serial outside the picker's warehouse", async () => {
    const lot = await makeLot({ qty: 6 });
    const codes = await codesOf(lot._id);
    await expect(validateConfirmPick(companyId, {
      serials: [codes[0]], allocByInv: allocFor(lot, 6), remainingRequired: 6,
      allowedWarehouseIds: [otherWarehouseId],
    })).rejects.toThrow(/is currently at/);
  });

  test("refuses a serial that is no longer in stock", async () => {
    const lot = await makeLot({ qty: 6 });
    const codes = await codesOf(lot._id);
    await UnitSerial.updateOne({ serial: codes[0] }, { $set: { status: "shipped" } });
    await expect(validateConfirmPick(companyId, {
      serials: [codes[0]], allocByInv: allocFor(lot, 6), remainingRequired: 6,
    })).rejects.toThrow(/is shipped, cannot pick/);
  });

  test("refuses an unknown serial", async () => {
    const lot = await makeLot({ qty: 6 });
    await expect(validateConfirmPick(companyId, {
      serials: ["NOPE-001"], allocByInv: allocFor(lot, 6), remainingRequired: 6,
    })).rejects.toThrow(/Unknown serial/);
  });
});

describe("LATER-CREATED LOT — allocated at pick time", () => {
  test("a lot created AFTER approval is pickable by its Bulk Packaging ID", async () => {
    // Approved with no source lot at all — the lot is produced afterwards.
    const order = await makeUnallocatedOrder(5);
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });

    const r = await scan(order, box1.bulk_packaging_id);
    expect(r.scanType).toBe("bulk_package");
    expect(r.newAllocation).toBe(true);
    expect(r.addedQuantity).toBe(5);
    expect(r.lotId).toBe(String(lot._id));
    expect(r.warehouseId).toBe(String(warehouseId));
  });

  test("…by an individual boxed unit code", async () => {
    const order = await makeUnallocatedOrder(10);
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const codes = await codesOf(lot._id, 1);

    const r = await scan(order, codes[0]);
    expect(r.scanType).toBe("unit");
    expect(r.newAllocation).toBe(true);
    expect(r.currentPickedQuantity).toBe(1);
  });

  test("…by a non-bulk lot number", async () => {
    const order = await makeUnallocatedOrder(6);
    const lot = await makeLot({ qty: 6 });

    const r = await scan(order, lot.lotNumber);
    expect(r.scanType).toBe("lot");
    expect(r.newAllocation).toBe(true);
    expect(r.addedQuantity).toBe(6);
  });

  test("…by a non-bulk unit code", async () => {
    const order = await makeUnallocatedOrder(6);
    const lot = await makeLot({ qty: 6 });
    const codes = await codesOf(lot._id);

    const r = await scan(order, codes[0]);
    expect(r.newAllocation).toBe(true);
    expect(r.addedQuantity).toBe(1);
  });

  test("a request is fulfilled from SEVERAL lots — 60 from A, 40 from B", async () => {
    const order = await makeUnallocatedOrder(100);
    const lotA = await makeLot({ qty: 60 });
    const lotB = await makeLot({ qty: 40 });

    const a = await scan(order, lotA.lotNumber);
    expect(a.addedQuantity).toBe(60);
    expect(a.remainingRequired).toBe(40);

    const b = await scan(order, lotB.lotNumber, a.addedUnitCodes);
    expect(b.addedQuantity).toBe(40);
    expect(b.currentPickedQuantity).toBe(100);
    expect(b.remainingRequired).toBe(0);
  });

  test("units already selected from lot A count against lot B's scan", async () => {
    const order = await makeUnallocatedOrder(10);
    const lotA = await makeLot({ qty: 8 });
    const lotB = await makeLot({ qty: 8 });

    const a = await scan(order, lotA.lotNumber);   // 8 of 10
    expect(a.remainingRequired).toBe(2);
    // Lot B holds 8, only 2 are still required → the whole-lot scan is refused.
    await expect(scan(order, lotB.lotNumber, a.addedUnitCodes))
      .rejects.toThrow("This lot contains 8 eligible units, but only 2 units are required. Scan individual Unit Codes instead.");
  });

  test("a lot NOT YET received by the warehouse is refused", async () => {
    const order = await makeUnallocatedOrder(6);
    const lot = await makeLot({ qty: 6, received: false });
    await expect(scan(order, lot.lotNumber)).rejects.toThrow(/has not been received yet/);
  });

  test("a lot in a DIFFERENT warehouse is refused for a scoped picker", async () => {
    const order = await makeUnallocatedOrder(6);
    const lot = await makeLot({ qty: 6, warehouseId: otherWarehouseId });
    await expect(scan(order, lot.lotNumber, [], [warehouseId])).rejects.toThrow(/is currently at/);
  });

  test("a lot of a DIFFERENT product is refused", async () => {
    const order = await makeUnallocatedOrder(6);
    const otherProduct = (await Product.create({ companyId, productName: "Urea Fertilizer" }))._id;
    const lot = await makeLot({ qty: 6, productId: otherProduct });
    await expect(scan(order, lot.lotNumber)).rejects.toThrow(MSG.wrongProduct);
  });

  test("a customer ORDER keeps the strict reserved-lot rule", async () => {
    const lot = await makeLot({ qty: 6 });
    const Order = require("../model/Order/Order");
    const ord = await Order.create({
      companyId, status: "confirmed",
      items: [{ productId, qty: 6, price: 100, pickedQty: 0, allocations: [] }],
    });
    await expect(resolvePickScan(companyId, {
      code: lot.lotNumber, orderType: "order", orderId: ord._id, selectedCodes: [],
    })).rejects.toThrow(MSG.wrongLot);
  });

  test("Confirm Pick reports the lots that need allocating", async () => {
    const lot = await makeLot({ qty: 6 });
    const codes = await codesOf(lot._id);
    const out = await validateConfirmPick(companyId, {
      serials: codes.slice(0, 3),
      allocByInv: new Map(),        // nothing was allocated at approval
      remainingRequired: 6,
      allowDynamicAllocation: true,
      productId,
    });
    expect(out.serials).toHaveLength(3);
    expect(out.newLots).toHaveLength(1);
    expect(String(out.newLots[0].inventoryId)).toBe(String(lot._id));
    expect(out.newLots[0].lotNumber).toBe(lot.lotNumber);
    expect(String(out.newLots[0].warehouseId)).toBe(String(warehouseId));
    expect(out.newLots[0].count).toBe(3);
  });

  test("Confirm Pick refuses a dynamic lot of the wrong product", async () => {
    const otherProduct = (await Product.create({ companyId, productName: "Urea Fertilizer" }))._id;
    const lot = await makeLot({ qty: 6, productId: otherProduct });
    const codes = await codesOf(lot._id);
    await expect(validateConfirmPick(companyId, {
      serials: [codes[0]], allocByInv: new Map(), remainingRequired: 6,
      allowDynamicAllocation: true, productId,
    })).rejects.toThrow(MSG.wrongProduct);
  });

  test("Confirm Pick refuses a dynamic lot the warehouse has not received", async () => {
    const lot = await makeLot({ qty: 6, received: false });
    const codes = await codesOf(lot._id);
    await UnitSerial.updateMany({ inventoryId: lot._id }, { $set: { status: "in_stock" } });
    await expect(validateConfirmPick(companyId, {
      serials: [codes[0]], allocByInv: new Map(), remainingRequired: 6,
      allowDynamicAllocation: true, productId,
    })).rejects.toThrow(/has not been received yet/);
  });
});

describe("concurrent picking", () => {
  test("two pickers taking the same unit — only one wins", async () => {
    const lot = await makeLot({ qty: 6 });
    const codes = await codesOf(lot._id);

    const [a, b] = await Promise.all([
      barcodeService.transitionUnits(companyId, [codes[0]], { toStatus: "picked", event: "picked" }),
      barcodeService.transitionUnits(companyId, [codes[0]], { toStatus: "picked", event: "picked" }),
    ]);
    const wins = [a, b].filter((r) => r.moved.length === 1).length;
    expect(wins).toBe(1);
    expect((await UnitSerial.findOne({ serial: codes[0] })).status).toBe("picked");
  });
});
