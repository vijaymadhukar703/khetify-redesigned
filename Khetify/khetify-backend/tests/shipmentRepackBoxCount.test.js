/**
 * "BOX PACKAGING (n)" ON THE SHIPMENTS TABLE.
 *
 * Repack cartons are assembled inside the scan-out dialog, and once it closed
 * their IDs were unreachable — no label to print, nothing to look up. The
 * Shipments row now offers the list, which means the row has to know whether
 * there is one and how big it is.
 *
 * The count rides back with the shipments list rather than being fetched per
 * row, so these pin it: present on rows that have cartons, ZERO (never missing)
 * on the ones that do not, counted per shipment, and dropping again when a box
 * is unpacked — an unpacked carton is an audit record, not a box on a shelf, so
 * it must not be offered for printing.
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
const shipmentService = require("../services/shipmentService");
const repackService = require("../services/repackService");

let companyId, srcWh, destWh, productId, actor;

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `rpc-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  actor = new mongoose.Types.ObjectId();
  srcWh = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  destWh = await Warehouse.create({ companyId, name: "Dest", code: "WH2" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

/** A received, labelled lot on the source shelf. */
async function makeLot(qty) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: srcWh._id, qty,
    lotOrigin: "company", pendingReceipt: true,
  });
  await Inventory.updateOne(
    { _id: inv._id },
    { $set: { inTransitStock: 0, offlineStock: qty, availableStock: qty } }
  );
  await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { status: "received" } });
  await barcodeService.generateUnits(companyId, inv._id, qty, {});
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

const shipmentFor = (lot, qty) =>
  shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", toLabel: "Dest",
    fromWarehouseId: srcWh._id, toWarehouseId: destWh._id,
    lines: [{ inventoryId: lot._id, qty }],
  });

const serialsOf = (lot, skip, n) =>
  UnitSerial.find({ inventoryId: lot._id }).sort({ unit_serial: 1 }).skip(skip).limit(n).lean()
    .then((u) => u.map((x) => x.serial));

/** The listed row for one shipment. */
const rowFor = async (shipmentId) => {
  const rows = await shipmentService.listShipments(companyId);
  return rows.find((r) => String(r._id) === String(shipmentId));
};

test("a shipment with no cartons reports ZERO, not a missing field", async () => {
  const lot = await makeLot(10);
  const ship = await shipmentFor(lot, 10);

  const row = await rowFor(ship._id);
  expect(row).toHaveProperty("repackBoxCount");
  expect(row.repackBoxCount).toBe(0);
});

test("the count is how many cartons were packed for THAT shipment", async () => {
  const lot = await makeLot(20);
  const ship = await shipmentFor(lot, 20);

  await repackService.packUnits(companyId, {
    shipmentId: ship._id, serials: await serialsOf(lot, 0, 4), performedBy: actor,
  });
  await repackService.packUnits(companyId, {
    shipmentId: ship._id, serials: await serialsOf(lot, 4, 3), performedBy: actor,
  });

  expect((await rowFor(ship._id)).repackBoxCount).toBe(2);
});

test("one shipment's cartons are never counted on another", async () => {
  const lot = await makeLot(20);
  const packed = await shipmentFor(lot, 10);
  const bare = await shipmentFor(lot, 10);

  await repackService.packUnits(companyId, {
    shipmentId: packed._id, serials: await serialsOf(lot, 0, 5), performedBy: actor,
  });

  expect((await rowFor(packed._id)).repackBoxCount).toBe(1);
  expect((await rowFor(bare._id)).repackBoxCount).toBe(0);
});

test("an UNPACKED carton stops counting — there is no box left to label", async () => {
  const lot = await makeLot(20);
  const ship = await shipmentFor(lot, 20);

  const a = await repackService.packUnits(companyId, {
    shipmentId: ship._id, serials: await serialsOf(lot, 0, 4), performedBy: actor,
  });
  await repackService.packUnits(companyId, {
    shipmentId: ship._id, serials: await serialsOf(lot, 4, 4), performedBy: actor,
  });
  expect((await rowFor(ship._id)).repackBoxCount).toBe(2);

  await repackService.unpackBox(companyId, a.repackBoxId, { performedBy: actor });
  expect((await rowFor(ship._id)).repackBoxCount).toBe(1);
});

test("the list the modal renders carries what each row shows", async () => {
  const lot = await makeLot(10);
  const ship = await shipmentFor(lot, 10);
  await repackService.packUnits(companyId, {
    shipmentId: ship._id, serials: await serialsOf(lot, 0, 4), performedBy: actor,
  });

  const [box] = await repackService.listForShipment(companyId, ship._id);
  // Box ID + barcode value, product, units, created on/by, lots inside — the
  // six things the list and the printed label are drawn from.
  expect(box.repackBoxId).toMatch(/-BX-/);
  expect(box.productName).toBe("abc");
  expect(box.unitCount).toBe(4);
  expect(box.lotCount).toBe(1);
  expect(box.createdAt).toBeTruthy();
  expect(box).toHaveProperty("createdBy");
  expect(box.shipmentRef).toBeTruthy();
});

test("every existing field on a shipment row is still there", async () => {
  const lot = await makeLot(10);
  const ship = await shipmentFor(lot, 10);

  const row = await rowFor(ship._id);
  // The count is ADDITIVE — nothing the table already read may have moved.
  for (const key of ["_id", "ref", "status", "lines", "toType", "fromName", "toName"]) {
    expect(row).toHaveProperty(key);
  }
});
