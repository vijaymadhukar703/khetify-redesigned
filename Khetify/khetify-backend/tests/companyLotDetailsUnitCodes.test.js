/**
 * THE COMPANY VIEW SHOWS UNIT CODES.
 *
 * Same lot, two pages: the warehouse's Lot Details listed all 8 codes while the
 * company's said "No unit codes were recorded for this stock" — with Packaging
 * Summary reading "Unit Labels: 8" on both. The page renders three arrays
 * (bulkPackages, looseUnitGroups, looseUnitCodes); the company branch returned
 * the raw `units` array and the boxes but never built the two loose ones, so a
 * lot with no bulk packaging had nothing to draw.
 *
 * Company scope also spans warehouses, so once a transfer has split a lot its
 * units are grouped by WAREHOUSE — which the warehouse page never needs.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const RepackBox = require("../model/Inventory/RepackBox");
const lotService = require("../services/lotService");
const barcodeService = require("../services/barcodeService");
const ctrl = require("../controller/Inventory/lotController");

let companyId, whA, whB, productId;

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
// company_admin is the ORIGINAL-REGISTER branch — the company-side page.
const companyUser = () => ({ id: companyId, companyId, role: "company_admin" });
const warehouseUser = (whId) => ({ id: new mongoose.Types.ObjectId(), companyId, role: "warehouse_manager", warehouseIds: [String(whId)] });

const detailsFor = async (lotId, user) => {
  const res = makeRes();
  await ctrl.lotDetails({ user, params: { id: String(lotId) } }, res);
  expect(res.statusCode).toBe(200);
  return res.body.data;
};

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `cl-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  whA = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  whB = await Warehouse.create({ companyId, name: "Indore", code: "IND" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

async function makeLot({ qty, boxes, perBox, warehouseId }) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: warehouseId || whA._id, qty,
    lotOrigin: "company", pendingReceipt: true,
    ...(boxes ? { hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox } : {}),
  });
  await Inventory.updateOne({ _id: inv._id }, { $set: { inTransitStock: 0, offlineStock: qty, availableStock: qty } });
  await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { status: "received" } });
  await barcodeService.generateUnits(companyId, inv._id, qty, {});
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

test("a NON-BOXED lot lists its unit codes on the company page, like the warehouse page", async () => {
  const lot = await makeLot({ qty: 8 });   // the reported lot shape: no bulk packaging

  const wh = await detailsFor(lot._id, warehouseUser(whA._id));
  const co = await detailsFor(lot._id, companyUser());

  // The warehouse page always worked — 8 codes.
  expect(wh.looseUnitCodes).toHaveLength(8);
  // THE BUG: this was empty, so the panel printed "No unit codes were recorded".
  expect(co.looseUnitCodes).toHaveLength(8);
  expect(co.looseUnitGroups).toHaveLength(0);
  // …and the summary figure both pages already agreed on.
  expect(co.unitTotal).toBe(8);
});

test("a BOXED lot keeps its units under their box cards, not duplicated in a list", async () => {
  const lot = await makeLot({ qty: 20, boxes: 2, perBox: 10 });
  const co = await detailsFor(lot._id, companyUser());

  expect(co.bulkPackages).toHaveLength(2);
  // Every unit belongs to a rendered card, so nothing is listed twice.
  expect(co.looseUnitCodes).toHaveLength(0);
  expect(co.looseUnitGroups).toHaveLength(0);
  expect(co.units).toHaveLength(20);
});

test("a lot spanning TWO warehouses still lists its units as ONE flat list", async () => {
  const lot = await makeLot({ qty: 8 });
  // A transfer lands 3 units on a second warehouse's own row.
  const moved = (await UnitSerial.find({ inventoryId: lot._id }).limit(3).lean()).map((u) => u.serial);
  const dest = await Inventory.create({
    productId, ownerType: "company", ownerId: companyId, warehouseId: whB._id,
    lotNumber: lot.lotNumber, batchNumber: lot.batchNumber,
    offlineStock: 3, availableStock: 3,
  });
  await UnitSerial.updateMany({ serial: { $in: moved } }, { $set: { inventoryId: dest._id } });
  await Inventory.updateOne({ _id: lot._id }, { $inc: { offlineStock: -3, availableStock: -3 } });

  const co = await detailsFor(lot._id, companyUser());

  // This used to assert per-warehouse groups. Where the stock sits is a
  // WAREHOUSE fact; the company's unit list answers what it created and sent, so
  // it reads as one list however far the stock has since travelled. Stock by
  // Warehouse on the same page still says where everything is.
  expect(co.warehouseCount).toBe(2);
  expect(co.looseUnitGroups).toHaveLength(0);
  expect(co.looseUnitCodes).toHaveLength(8);
});

test("a repack (BX) carton gets NO heading of its own on a single-package lot", async () => {
  // This used to assert the opposite. A repack carton is assembled by a
  // WAREHOUSE at dispatch, so on a lot the company shipped as a single package
  // it is that warehouse's handling, not a packaging level of the lot — and
  // giving it a group made the page grow a "Bulk Packaging IDs" section for a
  // lot with no boxes in it, pulling those units out of the unit list.
  // See tests/companySinglePackageRepack.test.js for the full rule.
  const lot = await makeLot({ qty: 6 });
  const serials = (await UnitSerial.find({ inventoryId: lot._id }).limit(4).lean()).map((u) => u.serial);
  const rp = await RepackBox.create({
    company_id: companyId, warehouse_id: whA._id, product_id: productId,
    repack_box_id: "KH-BHO-ABC472-BX-20260801-0001",
    shipment_id: new mongoose.Types.ObjectId(), unit_count: 4,
  });
  await UnitSerial.updateMany({ serial: { $in: serials } }, { $set: { repack_box_id: rp._id } });

  const co = await detailsFor(lot._id, companyUser());

  expect(co.looseUnitGroups.find((g) => g.kind === "repack")).toBeUndefined();
  // All six stay in the plain list, and none of them names the carton — that is
  // the warehouse's own handling, not part of what the company packed.
  expect(co.looseUnitCodes).toHaveLength(6);
  expect(co.looseUnitCodeMeta).toBeUndefined();
});

test("the WAREHOUSE page is untouched", async () => {
  const lot = await makeLot({ qty: 20, boxes: 2, perBox: 10 });
  const wh = await detailsFor(lot._id, warehouseUser(whA._id));
  expect(wh.bulkPackages).toHaveLength(2);
  expect(wh.bulkPackages[0].unit_codes).toHaveLength(10);
  expect(wh.looseUnitCodes).toHaveLength(0);
});
