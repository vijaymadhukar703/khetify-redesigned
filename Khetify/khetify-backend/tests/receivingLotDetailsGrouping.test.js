/**
 * THE RECEIVING WAREHOUSE'S LOT DETAILS GROUPS BY BOX, LIKE THE SENDER'S.
 *
 * A warehouse that receives a transfer gets a NEW Inventory row, while the
 * BulkPackage records still point at the SENDING row. lotDetails looked its
 * boxes up by lot_id, found none, and dropped every unit into the flat
 * `looseUnitCodes` list — 94 codes in one heap with no box headings. The boxes
 * are now discovered from the units themselves, so the same grouping (and the
 * same shared panel) renders on both sides.
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

let companyId, srcWh, destWh, productId;

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
// warehouse_manager is warehouse-scoped, which is the CURRENT-view branch.
const user = (warehouseIds) => ({ id: new mongoose.Types.ObjectId(), companyId, role: "warehouse_manager", warehouseIds });

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `rg-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  srcWh = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  destWh = await Warehouse.create({ companyId, name: "Indore", code: "IND" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

/** A boxed lot at the source, fully labelled and received. */
async function sourceLot({ qty, boxes, perBox }) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: srcWh._id, qty,
    lotOrigin: "company", pendingReceipt: true,
    hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox,
  });
  await Inventory.updateOne({ _id: inv._id }, { $set: { inTransitStock: 0, offlineStock: qty, availableStock: qty } });
  await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { status: "received" } });
  await barcodeService.generateUnits(companyId, inv._id, qty, {});
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

/**
 * The destination row a receipt creates, and the units moving onto it — exactly
 * what verifyReceipt does: a new Inventory row, units repointed, box records
 * left with the sending lot.
 */
async function receiveInto(srcLot, serials) {
  const dest = await Inventory.create({
    productId, ownerType: "company", ownerId: companyId, warehouseId: destWh._id,
    lotNumber: srcLot.lotNumber, batchNumber: srcLot.batchNumber,
    offlineStock: serials.length, availableStock: serials.length,
  });
  await UnitSerial.updateMany(
    { serial: { $in: serials } },
    { $set: { inventoryId: dest._id, status: "in_stock" } }
  );
  await Inventory.updateOne(
    { _id: srcLot._id },
    { $inc: { offlineStock: -serials.length, availableStock: -serials.length } }
  );
  return dest;
}

const detailsFor = async (lotId, warehouseId) => {
  const res = makeRes();
  await ctrl.lotDetails({ user: user([String(warehouseId)]), params: { id: String(lotId) } }, res);
  expect(res.statusCode).toBe(200);
  return res.body.data;
};

test("received units are grouped under their box heading, not dumped in a flat list", async () => {
  // 2 boxes × 50. Box 1 goes over whole, plus 44 units of box 2 — the reported
  // 94-unit case.
  const src = await sourceLot({ qty: 100, boxes: 2, perBox: 50 });
  const [box1, box2] = await BulkPackage.find({ lot_id: src._id }).sort({ box_serial: 1 });
  const b1 = await UnitSerial.find({ bulk_packaging_record_id: box1._id }).lean();
  const b2 = await UnitSerial.find({ bulk_packaging_record_id: box2._id }).limit(44).lean();
  const moved = [...b1, ...b2].map((u) => u.serial);

  const dest = await receiveInto(src, moved);
  const data = await detailsFor(dest._id, destWh._id);

  // THE BUG: this used to be all 94 codes with no box at all.
  expect(data.looseUnitCodes).toHaveLength(0);

  const groups = Object.fromEntries(data.looseUnitGroups.map((g) => [g.bulkPackagingId, g]));
  expect(Object.keys(groups)).toHaveLength(2);
  // Each group names its box and says how much of it is here — "50 of 50",
  // "44 of 50" — the same heading the sending page shows.
  expect(groups[box1.bulk_packaging_id].codes).toHaveLength(50);
  expect(groups[box1.bulk_packaging_id].unitsInBox).toBe(50);
  expect(groups[box2.bulk_packaging_id].codes).toHaveLength(44);
  expect(groups[box2.bulk_packaging_id].unitsInBox).toBe(50);
  expect(groups[box2.bulk_packaging_id].boxSerial).toBe(2);
});

test("a repack (BX) carton gets its own heading", async () => {
  const src = await sourceLot({ qty: 20, boxes: 2, perBox: 10 });
  const some = await UnitSerial.find({ inventoryId: src._id }).limit(6).lean();
  const serials = some.map((u) => u.serial);

  const rp = await RepackBox.create({
    company_id: companyId, warehouse_id: srcWh._id, product_id: productId,
    repack_box_id: "KH-BHO-ABC711-BX-20260801-0001",
    shipment_id: new mongoose.Types.ObjectId(), unit_count: serials.length,
  });
  await UnitSerial.updateMany({ serial: { $in: serials } }, { $set: { repack_box_id: rp._id } });

  const dest = await receiveInto(src, serials);
  const data = await detailsFor(dest._id, destWh._id);

  const repackGroup = data.looseUnitGroups.find((g) => g.kind === "repack");
  expect(repackGroup).toBeTruthy();
  expect(repackGroup.bulkPackagingId).toBe("KH-BHO-ABC711-BX-20260801-0001");
  expect(repackGroup.codes).toHaveLength(6);
  // Its units are counted ONCE — under the repack carton, not also under the
  // original box they were minted into.
  expect(data.looseUnitCodes).toHaveLength(0);
  const inOriginalBoxes = data.looseUnitGroups
    .filter((g) => g.kind !== "repack")
    .reduce((n, g) => n + g.codes.length, 0);
  expect(inOriginalBoxes).toBe(0);
});

test("the SENDING side is unchanged — its own boxes still render as box cards", async () => {
  const src = await sourceLot({ qty: 20, boxes: 2, perBox: 10 });
  const data = await detailsFor(src._id, srcWh._id);

  expect(data.bulkPackages).toHaveLength(2);
  expect(data.bulkPackages[0].unit_codes).toHaveLength(10);
  expect(data.looseUnitCodes).toHaveLength(0);
});
