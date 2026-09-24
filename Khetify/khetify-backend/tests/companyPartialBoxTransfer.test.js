/**
 * A BOX MOVES ONLY WHEN ALL OF ITS UNITS HAVE ARRIVED.
 *
 * A company warehouse→warehouse transfer may take some units of a labelled box
 * and leave the rest behind. The box record (`lot_id` + `warehouse_id`) used to
 * follow the first unit that arrived, so a carton 2 of whose 5 units were still
 * at Bhopal was booked at Indore: Bhopal could no longer scan it, and Indore
 * could pick the 3 arrivals as if they were the sealed original box.
 *
 * The box now stays with the units still at the source and follows once the
 * last of them lands — including when that happens in a later transfer.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const Shipment = require("../model/Transport/Shipment");
const SupplyOrder = require("../model/Supply/SupplyOrder");
const lotService = require("../services/lotService");
const shipmentService = require("../services/shipmentService");
const pickScan = require("../services/pickScanService");
const notificationService = require("../services/notificationService");

let companyId, bhopal, indore, productId, actor;

beforeEach(() => {
  jest.spyOn(notificationService, "notifyWarehouseTeam").mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `pbt-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  actor = new mongoose.Types.ObjectId();
  bhopal = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  indore = await Warehouse.create({ companyId, name: "Indore", code: "IND" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
  await BulkPackage.syncIndexes();
});

/** A labelled lot at Bhopal, fully on the shelf. */
async function lotAtBhopal(opts) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: bhopal._id,
    lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true, hasBulkPackaging: true,
    ...opts,
  });
  await Inventory.updateOne(
    { _id: inv._id },
    { $set: { inTransitStock: 0, offlineStock: opts.qty, availableStock: opts.qty } }
  );
  await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { status: "received", warehouse_id: bhopal._id } });
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

/** Bhopal → Indore: create, dispatch these exact units, receive at Indore. */
async function transfer(src, serials) {
  const ship = await shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", toLabel: "Indore",
    fromWarehouseId: bhopal._id, toWarehouseId: indore._id,
    lines: [{ inventoryId: src._id, qty: serials.length }],
  });
  await shipmentService.dispatchShipment(companyId, ship._id, { scannedCodes: serials, performedBy: actor });
  await shipmentService.verifyReceipt(companyId, ship._id, {
    qr: `${ship._id}.${(await Shipment.findById(ship._id)).qrToken}`,
    warehouseId: String(indore._id), verifierId: actor, performedBy: actor,
  });
}

const unitsOf = async (box) =>
  (await UnitSerial.find({ bulk_packaging_record_id: box._id }).sort({ unit_serial: 1 }).lean()).map((u) => u.serial);
const destRow = (src) => Inventory.findOne({ ownerId: companyId, warehouseId: indore._id, lotNumber: src.lotNumber });

/** Scan a box label for a supply request needing `need` units from `lotRowId`, as `warehouseId`. */
async function scanBox(box, lotRowId, warehouseId, need) {
  const so = await SupplyOrder.create({
    sellerId: new mongoose.Types.ObjectId(), companyId, status: "approved",
    items: [{ productId, quantity: need, allocations: [{ inventoryId: lotRowId, warehouseId, qty: need }] }],
  });
  return pickScan.resolvePickScan(companyId, {
    code: box.bulk_packaging_id, orderType: "supply", orderId: so._id,
    allowedWarehouseIds: [String(warehouseId)],
  });
}

/* ------------------------------------------------------------ two-level */

describe("a two-level box (5 units) moved Bhopal → Indore", () => {
  let src, box;
  beforeEach(async () => {
    src = await lotAtBhopal({ qty: 20, numberOfBoxes: 4, unitsPerBox: 5 });
    box = await BulkPackage.findOne({ lot_id: src._id }).sort({ box_serial: 1 });
  });

  test("3 of 5 units: the box stays at Bhopal with the 2 that did not travel", async () => {
    await transfer(src, (await unitsOf(box)).slice(0, 3));

    const b = await BulkPackage.findById(box._id);
    expect(String(b.lot_id)).toBe(String(src._id));
    expect(String(b.warehouse_id)).toBe(String(bhopal._id));
  });

  test("3 of 5 units: Bhopal can still scan the box for the 2 left in it", async () => {
    await transfer(src, (await unitsOf(box)).slice(0, 3));

    const r = await scanBox(box, src._id, bhopal._id, 2);
    expect(r.addedQuantity).toBe(2);
  });

  test("3 of 5 units: Indore cannot pick the 3 arrivals as the original sealed box", async () => {
    await transfer(src, (await unitsOf(box)).slice(0, 3));
    const dest = await destRow(src);

    await expect(scanBox(box, dest._id, indore._id, 3)).rejects.toMatchObject({ status: 403 });
  });

  test("5 of 5 units: the whole box moves to Indore, as before", async () => {
    await transfer(src, await unitsOf(box));
    const dest = await destRow(src);

    const b = await BulkPackage.findById(box._id);
    expect(String(b.lot_id)).toBe(String(dest._id));
    expect(String(b.warehouse_id)).toBe(String(indore._id));
    expect((await scanBox(box, dest._id, indore._id, 5)).addedQuantity).toBe(5);
  });

  test("3 then the remaining 2: the box stays after the first, and follows after the second", async () => {
    const serials = await unitsOf(box);

    await transfer(src, serials.slice(0, 3));
    expect(String((await BulkPackage.findById(box._id)).lot_id)).toBe(String(src._id));

    await transfer(src, serials.slice(3));
    const dest = await destRow(src);
    const b = await BulkPackage.findById(box._id);
    expect(String(b.lot_id)).toBe(String(dest._id));
    expect(String(b.warehouse_id)).toBe(String(indore._id));
  });

  test("the other boxes of the lot are untouched", async () => {
    await transfer(src, (await unitsOf(box)).slice(0, 3));

    const others = await BulkPackage.find({ _id: { $ne: box._id }, company_id: companyId });
    expect(others).toHaveLength(3);
    for (const o of others) {
      expect(String(o.lot_id)).toBe(String(src._id));
      expect(String(o.warehouse_id)).toBe(String(bhopal._id));
    }
  });

  test("stock and units add up: nothing created, nothing lost", async () => {
    const serials = await unitsOf(box);
    await transfer(src, serials.slice(0, 3));
    await transfer(src, serials.slice(3));
    const dest = await destRow(src);

    const s = await Inventory.findById(src._id);
    expect(s.availableStock).toBe(15);
    expect(dest.availableStock).toBe(5);

    const all = await UnitSerial.find({ companyId, lotNumber: src.lotNumber }).lean();
    expect(all).toHaveLength(20);
    expect(new Set(all.map((u) => u.serial)).size).toBe(20);
    expect(all.filter((u) => String(u.inventoryId) === String(src._id))).toHaveLength(15);
    expect(all.filter((u) => String(u.inventoryId) === String(dest._id))).toHaveLength(5);
  });
});

/* ---------------------------------------------------------- three-level */

describe("a three-level lot (2 main × 5 inner × 2 units) moved Bhopal → Indore", () => {
  let src, main1, main2, inners1;
  beforeEach(async () => {
    src = await lotAtBhopal({ qty: 20, numberOfBoxes: 10, unitsPerBox: 2, mainBoxes: 2, boxesPerMain: 5 });
    [main1, main2] = await BulkPackage.find({ lot_id: src._id, box_level: "main" }).sort({ box_serial: 1 });
    inners1 = await BulkPackage.find({ parent_box_id: main1._id }).sort({ box_serial: 1 });
  });
  const serialsOf = async (boxes) => (await Promise.all(boxes.map(unitsOf))).flat();

  test("every inner box of main 1 travels in full: main 1 moves with them, main 2 stays", async () => {
    await transfer(src, await serialsOf(inners1));
    const dest = await destRow(src);

    for (const b of await BulkPackage.find({ parent_box_id: main1._id })) {
      expect(String(b.lot_id)).toBe(String(dest._id));
    }
    expect(String((await BulkPackage.findById(main1._id)).lot_id)).toBe(String(dest._id));
    expect(String((await BulkPackage.findById(main2._id)).lot_id)).toBe(String(src._id));
  });

  test("one inner box only half travels: that inner box AND main 1 stay at Bhopal", async () => {
    const serials = await serialsOf(inners1);
    await transfer(src, serials.slice(0, serials.length - 1));
    const dest = await destRow(src);

    const moved = await BulkPackage.find({ parent_box_id: main1._id }).sort({ box_serial: 1 });
    expect(moved.slice(0, 4).every((b) => String(b.lot_id) === String(dest._id))).toBe(true);
    expect(String(moved[4].lot_id)).toBe(String(src._id));
    expect(String((await BulkPackage.findById(main1._id)).lot_id)).toBe(String(src._id));
  });
});
