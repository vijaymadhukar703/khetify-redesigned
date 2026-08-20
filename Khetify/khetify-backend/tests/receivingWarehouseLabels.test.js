/**
 * THE RECEIVING WAREHOUSE'S BARCODES & LABELS PAGE.
 *
 * A lot is one Inventory row per warehouse, but a BulkPackage row is anchored to
 * the row it was minted against. A warehouse that RECEIVES a transfer gets a
 * brand-new Inventory row, so the boxes endpoint — keyed on lot_id — returned
 * nothing there and the page fell back to its flat grid: the lot label, then a
 * heap of unit labels with no Bulk Packaging label, no inner box and no "Units
 * in this box" heading, while the SENDING warehouse grouped them properly.
 *
 * These cover the receiving side getting the same three levels, the "Box n of m"
 * denominator staying true to what is printed on the carton, and the sending
 * side coming back byte-for-byte unchanged.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const lotService = require("../services/lotService");
const lotCtrl = require("../controller/Inventory/lotController");

let companyId, bhopal, indore, productId;

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `rwl-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  bhopal = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  indore = await Warehouse.create({ companyId, name: "Indore", code: "IND" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const user = () => ({ id: companyId, companyId, role: "warehouse_manager" });

const boxesOf = async (lotRowId) => {
  const res = mockRes();
  await lotCtrl.listBulkPackages({ params: { id: lotRowId }, user: user() }, res);
  return res.body;
};

/** A boxed lot created at Bhopal and fully labelled. */
async function lotAtBhopal({ qty = 20, boxes = 4, perBox = 5, mainBoxes, boxesPerMain } = {}) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: bhopal._id, qty,
    lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
    hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox,
    ...(mainBoxes ? { mainBoxes, boxesPerMain } : {}),
  });
  await Inventory.updateOne(
    { _id: inv._id },
    { $set: { inTransitStock: 0, offlineStock: qty, availableStock: qty } }
  );
  await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { status: "received" } });
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

/**
 * Move whole boxes to Indore, exactly as the receipt path does: a new Inventory
 * row, and each moved unit's inventoryId repointed. The BulkPackage records
 * stay with the sending row — which is the whole point.
 */
async function moveBoxesToIndore(src, boxSerials) {
  const boxes = await BulkPackage.find({ lot_id: src._id, box_serial: { $in: boxSerials } });
  const moving = await UnitSerial.find({
    inventoryId: src._id,
    bulk_packaging_record_id: { $in: boxes.map((b) => b._id) },
  });
  const dest = await Inventory.findOneAndUpdate(
    { productId, ownerType: "company", ownerId: companyId, warehouseId: indore._id, batchNumber: src.batchNumber },
    { $inc: { offlineStock: moving.length, availableStock: moving.length }, $set: { lotNumber: src.lotNumber } },
    { new: true, upsert: true }
  );
  await UnitSerial.updateMany(
    { _id: { $in: moving.map((u) => u._id) } },
    { $set: { inventoryId: dest._id } }
  );
  await Inventory.updateOne(
    { _id: src._id },
    { $inc: { offlineStock: -moving.length, availableStock: -moving.length } }
  );
  return dest;
}

/* ------------------------------------------------- the receiving warehouse */

describe("a receiving row gets the same box structure", () => {
  test("TWO LEVELS: the boxes it received come back, with their units", async () => {
    const src = await lotAtBhopal({ qty: 20, boxes: 4, perBox: 5 });
    const dest = await moveBoxesToIndore(src, [1, 2]);

    const r = await boxesOf(dest._id);
    // It holds two of the lot's four cartons — and knows they are cartons.
    expect(r.data).toHaveLength(2);
    expect(r.data.map((b) => b.box_serial).sort()).toEqual([1, 2]);
    // Every returned box really does hold this row's units, so the page can
    // group them under it.
    for (const b of r.data) {
      const n = await UnitSerial.countDocuments({
        inventoryId: dest._id, bulk_packaging_record_id: b._id,
      });
      expect(n).toBe(5);
    }
  });

  test("\"Box n of m\" counts against the LOT, not against what arrived", async () => {
    const src = await lotAtBhopal({ qty: 20, boxes: 4, perBox: 5 });
    const dest = await moveBoxesToIndore(src, [1, 2]);

    const r = await boxesOf(dest._id);
    // The carton's printed sticker says "BOX 2 OF 4"; the screen must agree.
    expect(r.totalBoxes).toBe(4);
  });

  test("THREE LEVELS: the Bulk Packaging cartons above the inner boxes come too", async () => {
    // 2 cartons × 2 inner × 5 units.
    const src = await lotAtBhopal({ qty: 20, boxes: 4, perBox: 5, mainBoxes: 2, boxesPerMain: 2 });
    const dest = await moveBoxesToIndore(src, [1, 2]);   // both inner boxes of carton 1

    const r = await boxesOf(dest._id);
    expect(r.data).toHaveLength(2);
    // The middle level — without this the page drew inner boxes flat.
    expect(r.mainBoxes).toHaveLength(1);
    expect(r.mainBoxes[0].inner_total).toBe(2);
    // …and each inner box states its position INSIDE that carton.
    expect(r.data.map((b) => b.inner_index).sort()).toEqual([1, 2]);
  });

  test("a HALF-received carton still names its parent", async () => {
    const src = await lotAtBhopal({ qty: 20, boxes: 4, perBox: 5, mainBoxes: 2, boxesPerMain: 2 });
    const dest = await moveBoxesToIndore(src, [3]);   // one inner box of carton 2

    const r = await boxesOf(dest._id);
    expect(r.data).toHaveLength(1);
    expect(r.mainBoxes).toHaveLength(1);
    expect(r.data[0].parent_box_id).toBeTruthy();
  });

  test("LOOSE UNITS stay loose — no box is invented for them", async () => {
    // A single-package lot, transferred. There are no cartons to inherit.
    const inv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: bhopal._id, qty: 10,
      lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
    });
    await Inventory.updateOne(
      { _id: inv._id },
      { $set: { inTransitStock: 0, offlineStock: 10, availableStock: 10 } }
    );
    const src = await Inventory.findById(inv._id);
    const dest = await moveBoxesToIndore(src, []);   // creates the row, moves nothing
    await UnitSerial.updateMany({ inventoryId: src._id }, { $set: { inventoryId: dest._id } });

    const r = await boxesOf(dest._id);
    expect(r.data).toHaveLength(0);
    expect(r.mainBoxes).toHaveLength(0);
  });
});

/* --------------------------------------------------- the sending warehouse */

describe("the sending warehouse is unchanged", () => {
  test("TWO LEVELS: it still sees all four of its boxes", async () => {
    const src = await lotAtBhopal({ qty: 20, boxes: 4, perBox: 5 });

    const before = await boxesOf(src._id);
    expect(before.data).toHaveLength(4);
    expect(before.totalBoxes).toBe(4);
    expect(before.mainBoxes).toHaveLength(0);
  });

  test("THREE LEVELS: cartons, inner boxes and their positions are as before", async () => {
    const src = await lotAtBhopal({ qty: 20, boxes: 4, perBox: 5, mainBoxes: 2, boxesPerMain: 2 });

    const r = await boxesOf(src._id);
    expect(r.data).toHaveLength(4);
    expect(r.mainBoxes).toHaveLength(2);
    expect(r.mainBoxes.map((m) => m.inner_total)).toEqual([2, 2]);
    expect(r.data.map((b) => b.inner_index)).toEqual([1, 2, 1, 2]);
    expect(r.boxesPerMain).toBe(2);
  });

  test("…and it is STILL unchanged after some of its stock leaves", async () => {
    const src = await lotAtBhopal({ qty: 20, boxes: 4, perBox: 5, mainBoxes: 2, boxesPerMain: 2 });
    const before = await boxesOf(src._id);
    await moveBoxesToIndore(src, [1, 2]);

    const after = await boxesOf(src._id);
    // The lot's boxes belong to this row; a transfer moves stock, not records.
    expect(after.data.map((b) => b.bulk_packaging_id)).toEqual(
      before.data.map((b) => b.bulk_packaging_id)
    );
    expect(after.mainBoxes).toHaveLength(2);
    expect(after.totalBoxes).toBe(4);
  });
});
