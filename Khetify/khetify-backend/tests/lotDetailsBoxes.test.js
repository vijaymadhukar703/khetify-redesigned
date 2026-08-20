/**
 * GET /api/lots/:id/details — the "Bulk Packaging IDs" section on
 * Company Warehouse → Inventory → View.
 *
 * The bug: the box list was derived from the page's UNIT array, which is capped
 * at MAX_DETAIL_UNITS and sorted by box — so in a lot with more units than the
 * cap, every box past the cut vanished from the list while the header count and
 * Transfer History still knew about it. A never-received box could also appear,
 * because units of a warehoused lot are minted straight to "in_stock" and the
 * list only ever looked at units, never at the box's own state.
 *
 * These pin the rule: a box is listed when it was RECEIVED, is booked to this
 * lot's warehouse, and still holds units of this row — and the section's count
 * comes from that same array, so the two cannot disagree.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const UnitSerial = require("../model/Barcode/UnitSerial");
const BulkPackage = require("../model/Inventory/BulkPackage");
const User = require("../model/User/User");
const lotService = require("../services/lotService");
const barcodeService = require("../services/barcodeService");
const lotCtrl = require("../controller/Inventory/lotController");

let companyId, productId, bhopal, indore;

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

/** A Bhopal-scoped manager → the CURRENT-stock branch of lotDetails. */
async function bhopalManager() {
  const u = await User.create({
    companyId, name: "Bhopal WM", email: `wm-${new mongoose.Types.ObjectId()}@x.com`,
    password: "x", role: "warehouse_manager", warehouseIds: [bhopal._id],
  });
  return { id: u._id, companyId, role: "warehouse_manager" };
}

beforeEach(async () => {
  const company = await Company.create({
    fullName: "Khetify Co", email: `c-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Khetify Agro" },
  });
  companyId = company._id;
  bhopal = await Warehouse.create({ companyId, name: "Bhopal Warehouse", code: "BHO" });
  indore = await Warehouse.create({ companyId, name: "Indore Warehouse", code: "IND" });
  productId = (await Product.create({ companyId, productName: "Urea", skuNumber: "URE494" }))._id;
});

/** A boxed lot booked to Bhopal, labelled, with its units on the shelf. */
async function boxedLot({ boxes, perBox }) {
  const qty = boxes * perBox;
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: bhopal._id, qty,
    lotOrigin: "company", pendingReceipt: true,
    hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox,
  });
  await Inventory.updateOne(
    { _id: inv._id },
    { $set: { inTransitStock: 0, offlineStock: qty, availableStock: qty } }
  );
  await barcodeService.generateUnits(companyId, inv._id, qty, {});
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

const receive = (lotId, serials) =>
  BulkPackage.updateMany(
    { lot_id: lotId, box_serial: { $in: serials } },
    { $set: { status: "received", received_at: new Date() } }
  );

/** Move one box's units to another warehouse's row, as a transfer receipt does. */
async function transferBoxOut(lot, boxSerial) {
  const dest = await Inventory.create({
    productId, ownerType: "company", ownerId: companyId, warehouseId: indore._id,
    lotNumber: lot.lotNumber, batchNumber: lot.batchNumber, availableStock: 0, lotOrigin: "transfer",
  });
  const [box] = await BulkPackage.find({ lot_id: lot._id, box_serial: boxSerial });
  await UnitSerial.updateMany(
    { bulk_packaging_record_id: box._id },
    { $set: { inventoryId: dest._id } }
  );
}

const details = async (id, user) => {
  const res = mockRes();
  await lotCtrl.lotDetails({ params: { id }, user }, res);
  return res;
};

const listed = (res) => res.body.data.bulkPackages.map((b) => b.box_serial);

describe("Bulk Packaging IDs lists the boxes actually on this shelf", () => {
  test("a box the warehouse never received is not listed, however its labels read", async () => {
    // BP002's units are "in_stock" like every other box's — the box itself is
    // what says it has not arrived.
    const lot = await boxedLot({ boxes: 4, perBox: 5 });
    await receive(lot._id, [1, 4]);

    const res = await details(lot._id, await bhopalManager());
    expect(res.statusCode).toBe(200);
    expect(listed(res)).toEqual([1, 4]);
  });

  test("the listed boxes keep their REAL numbers, not 1..n", async () => {
    const lot = await boxedLot({ boxes: 4, perBox: 5 });
    await receive(lot._id, [1, 4]);

    const res = await details(lot._id, await bhopalManager());
    const boxes = res.body.data.bulkPackages;
    // "Box 4 of 4" — the page reads box_serial and lot.number_of_boxes.
    expect(boxes.map((b) => b.box_serial)).toEqual([1, 4]);
    expect(res.body.data.lot.number_of_boxes).toBe(4);
  });

  test("presence is the BOX's state, never its units", async () => {
    // receiveBox activates the first units of the LOT, not the box's own, so a
    // received box routinely holds no "in_stock" units of its own. Reading
    // presence off units is what dropped BP003; only the box row decides.
    const lot = await boxedLot({ boxes: 4, perBox: 5 });
    await receive(lot._id, [1, 3]);
    await UnitSerial.updateMany({ inventoryId: lot._id }, { $set: { status: "generated" } });

    const res = await details(lot._id, await bhopalManager());
    expect(listed(res)).toEqual([1, 3]);
  });

  test("a box booked to ANOTHER warehouse is not listed", async () => {
    const lot = await boxedLot({ boxes: 3, perBox: 5 });
    await receive(lot._id, [1, 2, 3]);
    await BulkPackage.updateOne({ lot_id: lot._id, box_serial: 2 }, { $set: { warehouse_id: indore._id } });

    const res = await details(lot._id, await bhopalManager());
    expect(listed(res)).toEqual([1, 3]);
  });

  test("status casing does not matter", async () => {
    const lot = await boxedLot({ boxes: 2, perBox: 5 });
    await receive(lot._id, [1, 2]);
    await BulkPackage.collection.updateOne(
      { lot_id: lot._id, box_serial: 2 },
      { $set: { status: "RECEIVED" } }
    );

    const res = await details(lot._id, await bhopalManager());
    expect(listed(res)).toEqual([1, 2]);
  });

  test("a received box with no received_at is still listed", async () => {
    const lot = await boxedLot({ boxes: 2, perBox: 5 });
    await receive(lot._id, [1, 2]);
    await BulkPackage.updateOne({ lot_id: lot._id, box_serial: 2 }, { $set: { received_at: null } });

    const res = await details(lot._id, await bhopalManager());
    expect(listed(res)).toEqual([1, 2]);
  });

  test("a box past the unit cap is still listed — the list is not a slice", async () => {
    // 3 boxes × 800 = 2,400 units against a 2,000 cap. Sorted by box, the cut
    // lands inside box 3, which used to disappear entirely.
    const lot = await boxedLot({ boxes: 3, perBox: 800 });
    await receive(lot._id, [1, 2, 3]);

    const res = await details(lot._id, await bhopalManager());
    expect(res.body.data.unitsTruncated).toBe(true);
    expect(listed(res)).toEqual([1, 2, 3]);
  });

  test("the section count is the length of that same list", async () => {
    const lot = await boxedLot({ boxes: 4, perBox: 5 });
    await receive(lot._id, [1, 4]);

    const res = await details(lot._id, await bhopalManager());
    // The panel renders `boxes.length` box(es) over the array it is handed, so
    // proving the array is right proves the header is.
    expect(res.body.data.bulkPackages).toHaveLength(2);
  });

  test("THE REPORTED LOT — 4 boxes, BP001 and BP003 received", async () => {
    // Expected: header "2 box(es)", BP001 and BP003 listed with their real
    // numbers, BP002 and BP004 absent, Packaging Summary still reading
    // BOXES RECEIVED 2 / UNITS RECEIVED 500 — all from one filter.
    const lot = await boxedLot({ boxes: 4, perBox: 250 });
    await receive(lot._id, [1, 3]);

    const res = await details(lot._id, await bhopalManager());
    const { bulkPackages, packaging } = res.body.data;

    expect(bulkPackages).toHaveLength(2);
    expect(bulkPackages.map((b) => b.box_serial)).toEqual([1, 3]);
    expect(packaging.receivedBoxes).toBe(2);
    expect(packaging.receivedUnits).toBe(500);
    // The section header renders `boxes.length` over this same array, so the
    // summary and the header are the same number by construction.
    expect(bulkPackages.length).toBe(packaging.receivedBoxes);
  });

  test("the main Company's original register still lists every box", async () => {
    // Company → Inventory → View is the ORIGINAL register, not this shelf.
    const lot = await boxedLot({ boxes: 4, perBox: 5 });
    await receive(lot._id, [1, 4]);

    const res = await details(lot._id, { id: companyId, companyId, role: "company_admin" });
    expect(res.body.data.bulkPackages).toHaveLength(4);
  });
});
