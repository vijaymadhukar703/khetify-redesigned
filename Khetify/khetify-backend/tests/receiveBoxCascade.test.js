/**
 * RECEIVING A MAIN CARTON RECEIVES WHAT IS INSIDE IT.
 *
 * Two lots, both three-level. One was received by scanning INNER box IDs and
 * read "RECEIVED"; the other by scanning BULK PACKAGING (main) IDs and read
 * "PARTIALLY RECEIVED" — even with every unit on the shelf.
 *
 * receiveBox claimed only the box that was scanned. pendingBoxCount counts the
 * INNER boxes of a three-level lot, so a main-box scan left them all "created"
 * and the lot could never reach zero pending. Scanning a main carton now
 * cascades into the inner boxes nailed inside it.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const lotService = require("../services/lotService");
const barcodeService = require("../services/barcodeService");
const svc = require("../services/bulkPackageService");

let companyId, wh, productId;

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `rb-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  wh = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

/** A three-level lot AWAITING RECEIPT at the warehouse (boxes still "created"). */
async function pendingLot({ qty, boxes, perBox, mainBoxes }) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: wh._id, qty,
    lotOrigin: "company", pendingReceipt: true,
    hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox,
    ...(mainBoxes ? { mainBoxes, boxesPerMain: boxes / mainBoxes } : {}),
  });
  await barcodeService.generateUnits(companyId, inv._id, qty, {});
  return Inventory.findById(inv._id);
}

const statusOf = async (lotId) => (await Inventory.findById(lotId)).receiving_status;

test("LOT B — scanning every MAIN carton leaves the lot RECEIVED, not partially", async () => {
  // 8 inner boxes × 5 units across 2 main cartons = 40 units.
  const lot = await pendingLot({ qty: 40, boxes: 8, perBox: 5, mainBoxes: 2 });
  const mains = await BulkPackage.find({ lot_id: lot._id, box_level: "main" }).sort({ box_serial: 1 });
  expect(mains).toHaveLength(2);

  await svc.receiveBox(companyId, mains[0].bulk_packaging_id, { allowedWarehouseIds: [String(wh._id)] });
  // Half way: genuinely partial, and it says so.
  expect(await statusOf(lot._id)).toBe("partially_received");

  const out = await svc.receiveBox(companyId, mains[1].bulk_packaging_id, { allowedWarehouseIds: [String(wh._id)] });

  // THE BUG: this used to stay "partially_received" for ever.
  expect(await statusOf(lot._id)).toBe("received");
  expect(out.receivingStatus).toBe("received");

  // The cascade really did reach the inner boxes.
  expect(await BulkPackage.countDocuments({ lot_id: lot._id, box_level: "inner", status: "created" })).toBe(0);
  expect(await BulkPackage.countDocuments({ lot_id: lot._id, box_level: "inner", status: "received" })).toBe(8);

  // …and every unit is on the shelf.
  const after = await Inventory.findById(lot._id);
  expect(after.availableStock).toBe(40);
  expect(after.inTransitStock).toBe(0);
  expect(await UnitSerial.countDocuments({ inventoryId: lot._id, status: "in_stock" })).toBe(40);
});

test("LOT A — scanning every INNER box still works exactly as before", async () => {
  // 4 inner boxes × 3 units across 2 main cartons = 12 units.
  const lot = await pendingLot({ qty: 12, boxes: 4, perBox: 3, mainBoxes: 2 });
  const inners = await BulkPackage.find({ lot_id: lot._id, box_level: "inner" }).sort({ box_serial: 1 });

  for (const b of inners) {
    await svc.receiveBox(companyId, b.bulk_packaging_id, { allowedWarehouseIds: [String(wh._id)] });
  }

  expect(await statusOf(lot._id)).toBe("received");
  const after = await Inventory.findById(lot._id);
  expect(after.availableStock).toBe(12);
  expect(await UnitSerial.countDocuments({ inventoryId: lot._id, status: "in_stock" })).toBe(12);
});

test("an inner box of an already-cascaded carton cannot be received twice", async () => {
  const lot = await pendingLot({ qty: 40, boxes: 8, perBox: 5, mainBoxes: 2 });
  const [main] = await BulkPackage.find({ lot_id: lot._id, box_level: "main" }).sort({ box_serial: 1 });
  await svc.receiveBox(companyId, main.bulk_packaging_id, { allowedWarehouseIds: [String(wh._id)] });

  const inner = await BulkPackage.findOne({ lot_id: lot._id, parent_box_id: main._id });
  await expect(
    svc.receiveBox(companyId, inner.bulk_packaging_id, { allowedWarehouseIds: [String(wh._id)] })
  ).rejects.toThrow(/already been received/i);

  // No double count: still exactly one carton's worth on the books.
  expect((await Inventory.findById(lot._id)).availableStock).toBe(20);
});

test("a TWO-level lot is untouched — no cascade, same status roll-up", async () => {
  const lot = await pendingLot({ qty: 10, boxes: 2, perBox: 5 });
  const boxes = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });
  expect(boxes.every((b) => b.box_level === "main")).toBe(true);

  await svc.receiveBox(companyId, boxes[0].bulk_packaging_id, { allowedWarehouseIds: [String(wh._id)] });
  expect(await statusOf(lot._id)).toBe("partially_received");
  await svc.receiveBox(companyId, boxes[1].bulk_packaging_id, { allowedWarehouseIds: [String(wh._id)] });
  expect(await statusOf(lot._id)).toBe("received");
});
