/**
 * THE RECEIVE CASCADE, BOTH WAYS — and everything derived from it.
 *
 * The reported lot: 40 units, 2 bulk cartons × 4 inner boxes × 5 units, received
 * by scanning the BULK PACKAGING IDs. Its inner boxes stayed "created", so
 * Boxes Received read 0 of 8, Units Received 0 of 40, and the lot sat on
 * PARTIALLY RECEIVED with every unit on the shelf.
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
const ctrl = require("../controller/Inventory/lotController");

let companyId, wh, productId;

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const detailsFor = async (lotId, user) => {
  const res = makeRes();
  await ctrl.lotDetails({ user, params: { id: String(lotId) } }, res);
  expect(res.statusCode).toBe(200);
  return res.body.data;
};
const companyUser = () => ({ id: companyId, companyId, role: "company_admin" });
const warehouseUser = () => ({ id: new mongoose.Types.ObjectId(), companyId, role: "warehouse_manager", warehouseIds: [String(wh._id)] });

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `rc-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  wh = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

/** The reported lot, awaiting receipt: 2 × 4 × 5 = 40. */
async function pendingLot({ qty = 40, boxes = 8, perBox = 5, mainBoxes = 2 } = {}) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: wh._id, qty,
    lotOrigin: "company", pendingReceipt: true,
    hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox,
    mainBoxes, boxesPerMain: boxes / mainBoxes,
  });
  await barcodeService.generateUnits(companyId, inv._id, qty, {});
  return Inventory.findById(inv._id);
}

const receive = (code) => svc.receiveBox(companyId, code, { allowedWarehouseIds: [String(wh._id)] });

test("scanning both BULK cartons receives all 8 inner boxes and all 40 units", async () => {
  const lot = await pendingLot();
  const mains = await BulkPackage.find({ lot_id: lot._id, box_level: "main" }).sort({ box_serial: 1 });

  for (const m of mains) await receive(m.bulk_packaging_id);

  // Every inner box carries the receipt, with a date and an actor — not "created".
  const inners = await BulkPackage.find({ lot_id: lot._id, box_level: "inner" }).lean();
  expect(inners).toHaveLength(8);
  expect(inners.every((b) => b.status === "received")).toBe(true);
  expect(inners.every((b) => !!b.received_at)).toBe(true);

  // …and it is SAVED, not a display trick: read straight from the collection.
  expect(await BulkPackage.countDocuments({ lot_id: lot._id, status: "created" })).toBe(0);

  // Every derived figure follows.
  const summary = await svc.summaryForLot(companyId, lot._id);
  expect(summary).toMatchObject({
    totalBoxes: 8, receivedBoxes: 8, pendingBoxes: 0,
    receivedUnits: 40, pendingUnits: 0,
  });
  const after = await Inventory.findById(lot._id);
  expect(after.receiving_status).toBe("received");
  expect(after.availableStock).toBe(40);
  expect(await UnitSerial.countDocuments({ inventoryId: lot._id, status: "in_stock" })).toBe(40);
});

test("each carton lands ITS OWN units, not the first N of the lot", async () => {
  const lot = await pendingLot();
  const mains = await BulkPackage.find({ lot_id: lot._id, box_level: "main" }).sort({ box_serial: 1 });
  // Receive the SECOND carton only.
  await receive(mains[1].bulk_packaging_id);

  const innerIds = (await BulkPackage.find({ parent_box_id: mains[1]._id }).select("_id").lean()).map((b) => b._id);
  const inStock = await UnitSerial.find({ inventoryId: lot._id, status: "in_stock" }).lean();
  expect(inStock).toHaveLength(20);
  // All 20 belong to carton 2 — carton 1's units are still awaiting receipt.
  expect(inStock.every((u) => innerIds.some((id) => String(id) === String(u.bulk_packaging_record_id)))).toBe(true);
});

test("receiving the LAST inner box closes its carton upwards", async () => {
  const lot = await pendingLot();
  const [main] = await BulkPackage.find({ lot_id: lot._id, box_level: "main" }).sort({ box_serial: 1 });
  const inners = await BulkPackage.find({ parent_box_id: main._id }).sort({ box_serial: 1 });

  for (const b of inners.slice(0, 3)) await receive(b.bulk_packaging_id);
  // Three of four in — the carton is genuinely still open.
  expect((await BulkPackage.findById(main._id)).status).toBe("created");

  await receive(inners[3].bulk_packaging_id);
  const closed = await BulkPackage.findById(main._id);
  expect(closed.status).toBe("received");
  expect(closed.received_at).toBeTruthy();
});

test("a partly-received lot still reports PARTIALLY RECEIVED honestly", async () => {
  const lot = await pendingLot();
  const [main] = await BulkPackage.find({ lot_id: lot._id, box_level: "main" }).sort({ box_serial: 1 });
  await receive(main.bulk_packaging_id);

  const summary = await svc.summaryForLot(companyId, lot._id);
  expect(summary).toMatchObject({ receivedBoxes: 4, pendingBoxes: 4, receivedUnits: 20, pendingUnits: 20 });
  expect((await Inventory.findById(lot._id)).receiving_status).toBe("partially_received");
});

test("both pages get the same three-level shape", async () => {
  const lot = await pendingLot();
  const mains = await BulkPackage.find({ lot_id: lot._id, box_level: "main" }).sort({ box_serial: 1 });
  for (const m of mains) await receive(m.bulk_packaging_id);

  const whData = await detailsFor(lot._id, warehouseUser());
  const coData = await detailsFor(lot._id, companyUser());

  for (const [label, data] of [["warehouse", whData], ["company", coData]]) {
    const boxes = data.bulkPackages;
    expect(boxes.length).toBeGreaterThan(0);
    // Every inner box names its carton, which is what the panel nests on.
    expect({ page: label, allNested: boxes.every((b) => !!b.parent_bulk_packaging_id) })
      .toEqual({ page: label, allNested: true });
    expect(new Set(boxes.map((b) => b.parent_bulk_packaging_id)).size).toBe(2);
    expect({ page: label, allReceived: boxes.every((b) => b.status === "received" && !!b.received_at) })
      .toEqual({ page: label, allReceived: true });
  }
  // The company page states the packaging roll-up too.
  expect(coData.packaging).toMatchObject({ totalBoxes: 8, receivedBoxes: 8, pendingBoxes: 0 });
});
