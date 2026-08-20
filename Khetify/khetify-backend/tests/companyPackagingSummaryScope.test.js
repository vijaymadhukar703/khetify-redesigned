/**
 * THE COMPANY'S PACKAGING SUMMARY IS SCOPED TO THE WHOLE LOT.
 *
 * A lot is one Inventory row per warehouse, and summaryForLot answers per ROW —
 * which is right for a warehouse and wrong for the company, which owns every
 * warehouse. Opened on the SENDING row the company read "Unit Labels 10" for a
 * lot it had minted 20 labels for; opened on the RECEIVING row it read
 * "2 boxes · 10 units" of a four-box, twenty-unit lot. The unit list beside it
 * showed all 20 the whole time (originalLotUnits has always been identity-
 * scoped) — only the summary disagreed.
 *
 * The WAREHOUSE view stays row-scoped and is asserted here too, so the fix
 * cannot leak into it.
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
    fullName: "Co", email: `cps-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
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
const asCompany = () => ({ id: companyId, companyId, role: "company_admin" });
const asWarehouse = () => ({ id: companyId, companyId, role: "warehouse_manager" });

const summaryFor = async (lotRowId, user) => {
  const res = mockRes();
  await lotCtrl.lotDetails({ params: { id: lotRowId }, user }, res);
  return res.body.data.packaging;
};

/** The reported lot: 2 cartons × 2 inner × 5 = 20, at Bhopal, fully received. */
async function lotAtBhopal() {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: bhopal._id, qty: 20,
    lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
    hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 5,
    mainBoxes: 2, boxesPerMain: 2,
  });
  await Inventory.updateOne(
    { _id: inv._id },
    { $set: { inTransitStock: 0, offlineStock: 20, availableStock: 20 } }
  );
  await BulkPackage.updateMany(
    { lot_id: inv._id },
    { $set: { status: "received", warehouse_id: bhopal._id } }
  );
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

/** Move whole inner boxes to Indore, as the receipt path does. */
async function moveToIndore(src, boxSerials) {
  const boxes = await BulkPackage.find({
    lot_id: src._id, box_level: "inner", box_serial: { $in: boxSerials },
  });
  const moving = await UnitSerial.find({
    inventoryId: src._id, bulk_packaging_record_id: { $in: boxes.map((b) => b._id) },
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

/* ------------------------------------------------------------- the company */

describe("the company reads the whole lot", () => {
  test("UNIT LABELS is 20 — every label of the lot, wherever the stock is", async () => {
    const src = await lotAtBhopal();
    await moveToIndore(src, [1, 2]);

    expect((await summaryFor(src._id, asCompany())).unitLabels).toBe(20);
  });

  test("…and 20 from the RECEIVING row too — either row is the same lot", async () => {
    const src = await lotAtBhopal();
    const dest = await moveToIndore(src, [1, 2]);

    expect((await summaryFor(dest._id, asCompany())).unitLabels).toBe(20);
  });

  test("every other figure is the lot's, from either row", async () => {
    const src = await lotAtBhopal();
    const dest = await moveToIndore(src, [1, 2]);

    const expected = {
      totalBoxes: 4, receivedBoxes: 4, pendingBoxes: 0,
      receivedUnits: 20, pendingUnits: 0, cancelledBoxes: 0,
      unitsPerBox: 5, unitLabels: 20,
    };
    expect(await summaryFor(src._id, asCompany())).toMatchObject(expected);
    // This row used to report 2 boxes and 10 units — half the lot.
    expect(await summaryFor(dest._id, asCompany())).toMatchObject(expected);
  });

  test("it does not move however many times the stock does", async () => {
    const src = await lotAtBhopal();
    await moveToIndore(src, [1]);
    await moveToIndore(await Inventory.findById(src._id), [2]);

    expect(await summaryFor(src._id, asCompany())).toMatchObject({
      totalBoxes: 4, receivedUnits: 20, unitLabels: 20,
    });
  });

  test("before any transfer it reads the same — nothing changed for a whole lot", async () => {
    const src = await lotAtBhopal();

    expect(await summaryFor(src._id, asCompany())).toMatchObject({
      totalBoxes: 4, receivedBoxes: 4, receivedUnits: 20, unitLabels: 20, unitsPerBox: 5,
    });
  });

  test("a SINGLE-PACKAGE lot still has no box summary at all", async () => {
    const inv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: bhopal._id, qty: 10,
      lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
    });

    expect(await summaryFor(inv._id, asCompany())).toBeNull();
  });
});

/* ----------------------------------------------------------- the warehouse */

describe("the warehouse still reads its own shelf", () => {
  test("the SENDING warehouse counts what is left with it", async () => {
    const src = await lotAtBhopal();
    await moveToIndore(src, [1, 2]);

    const s = await summaryFor(src._id, asWarehouse());
    // UNIT LABELS is what is on its shelf now…
    expect(s.unitLabels).toBe(10);
    // …while the box figures record what it RECEIVED, which sending stock
    // onward does not change — see sendingSideAfterDispatch.
    expect(s.totalBoxes).toBe(4);
    expect(s.receivedUnits).toBe(20);
  });

  test("the RECEIVING warehouse counts what arrived", async () => {
    const src = await lotAtBhopal();
    const dest = await moveToIndore(src, [1, 2]);

    const s = await summaryFor(dest._id, asWarehouse());
    expect(s.totalBoxes).toBe(2);
    expect(s.receivedUnits).toBe(10);
    expect(s.unitLabels).toBe(10);
  });

  test("the two warehouses' label counts add up to the company's", async () => {
    const src = await lotAtBhopal();
    const dest = await moveToIndore(src, [1, 2]);

    const a = await summaryFor(src._id, asWarehouse());
    const b = await summaryFor(dest._id, asWarehouse());
    const co = await summaryFor(src._id, asCompany());
    expect(a.unitLabels + b.unitLabels).toBe(co.unitLabels);
  });
});
