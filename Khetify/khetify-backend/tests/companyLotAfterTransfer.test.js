/**
 * THE COMPANY'S VIEW OF A LOT AFTER ITS STOCK HAS MOVED BETWEEN WAREHOUSES.
 *
 * A lot is one Inventory row PER WAREHOUSE, and a warehouse→warehouse transfer
 * repoints a moved unit's `inventoryId` to the destination row. Two things read
 * that wrongly for the COMPANY, which owns both warehouses:
 *
 *   1. Lot Details listed every box TWICE once the lot spanned more than one
 *      warehouse — once as its card, once as a bare group underneath — so a
 *      2 × 2 lot reported "2 bulk box(es) · 8 inner box(es)" and printed every
 *      unit ID twice.
 *   2. The Labels page counted only the units still pointing at the row it was
 *      opened on, so a fully-labelled 20-unit lot read "10 of 20 … you can
 *      generate up to 10 more" after half of it moved on.
 *
 * Neither is true of a WAREHOUSE, which holds what it holds — that view stays
 * row-scoped and is asserted here too, so the fix cannot leak into it.
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
const lotCtrl = require("../controller/Inventory/lotController");

let companyId, bhopal, indore, productId;

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `clt-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
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
const companyUser = () => ({ id: companyId, companyId, role: "company_admin" });
const warehouseUser = (wh) => ({ id: companyId, companyId, role: "warehouse_manager", warehouseId: wh._id });

const details = async (id, user = companyUser()) => {
  const res = mockRes();
  await lotCtrl.lotDetails({ params: { id }, user }, res);
  return res;
};

/**
 * THE REPORTED LOT: 2 bulk boxes × 2 inner boxes × 5 units = 20, created by the
 * company into Bhopal and fully labelled.
 */
async function companyLotAtBhopal() {
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
  await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { status: "received" } });
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

/**
 * Bhopal → Indore for `qty` units: the receipt path creates the destination row
 * and repoints each moved unit's inventoryId. Exactly what verifyReceipt /
 * receiveScannedUnits do, reduced to what this page reads.
 */
async function moveToIndore(src, qty) {
  const dest = await Inventory.findOneAndUpdate(
    {
      productId, ownerType: "company", ownerId: companyId,
      warehouseId: indore._id, batchNumber: src.batchNumber,
    },
    {
      $inc: { offlineStock: qty, availableStock: qty },
      $set: { lotNumber: src.lotNumber },
    },
    { new: true, upsert: true }
  );
  const moving = await UnitSerial.find({ inventoryId: src._id }).sort({ unit_serial: 1 }).limit(qty);
  await UnitSerial.updateMany(
    { _id: { $in: moving.map((u) => u._id) } },
    { $set: { inventoryId: dest._id } }
  );
  await Inventory.updateOne(
    { _id: src._id },
    { $inc: { offlineStock: -qty, availableStock: -qty } }
  );
  return dest;
}

/* ------------------------------------------------------------------ bug 1 */

describe("BUG 1 — every box and unit appears exactly once", () => {
  test("before any transfer the company sees 4 inner boxes, 20 units", async () => {
    const lot = await companyLotAtBhopal();

    const d = (await details(lot._id)).body.data;
    expect(d.bulkPackages).toHaveLength(4);
    expect(d.units).toHaveLength(20);
    expect(d.looseUnitGroups).toHaveLength(0);
  });

  test("AFTER a warehouse→warehouse transfer it is still 4 boxes, not 8", async () => {
    const lot = await companyLotAtBhopal();
    await moveToIndore(lot, 10);

    const d = (await details(lot._id)).body.data;
    expect(d.warehouseCount).toBe(2);
    // The reported symptom: "2 bulk box(es) · 8 inner box(es)".
    expect(d.bulkPackages).toHaveLength(4);
    const boxIds = d.bulkPackages.map((b) => b.bulk_packaging_id);
    expect(new Set(boxIds).size).toBe(4);
  });

  test("no box is listed a SECOND time as a loose group", async () => {
    const lot = await companyLotAtBhopal();
    await moveToIndore(lot, 10);

    const d = (await details(lot._id)).body.data;
    const cardIds = new Set(d.bulkPackages.map((b) => b.bulk_packaging_id));
    for (const g of d.looseUnitGroups) {
      expect(cardIds.has(g.bulkPackagingId)).toBe(false);
    }
  });

  test("no UNIT ID is printed twice — 20 codes, all distinct", async () => {
    const lot = await companyLotAtBhopal();
    await moveToIndore(lot, 10);

    const d = (await details(lot._id)).body.data;
    const inCards = d.bulkPackages.flatMap((b) =>
      d.units.filter((u) => String(u.bulk_packaging_record_id) === String(b._id))
        .map((u) => u.unit_code || u.serial));
    const inGroups = d.looseUnitGroups.flatMap((g) => g.codes);
    const shown = [...inCards, ...inGroups];

    expect(shown).toHaveLength(20);
    expect(new Set(shown).size).toBe(20);
    expect(d.units).toHaveLength(20);
    expect(d.unitTotal).toBe(20);
  });

  test("each box says WHERE its units now are", async () => {
    const lot = await companyLotAtBhopal();
    await moveToIndore(lot, 10);   // the first two inner boxes move whole

    const d = (await details(lot._id)).body.data;
    const at = Object.fromEntries(d.bulkPackages.map((b) => [b.box_serial, b.warehouse]));
    expect(at[1]).toBe("Indore");
    expect(at[2]).toBe("Indore");
    expect(at[3]).toBe("Bhopal");
    expect(at[4]).toBe("Bhopal");
  });

  test("a box SPLIT across warehouses reports the split, not one name", async () => {
    const lot = await companyLotAtBhopal();
    await moveToIndore(lot, 3);    // breaks inner box 1 (5 units) in half

    const d = (await details(lot._id)).body.data;
    const box1 = d.bulkPackages.find((b) => b.box_serial === 1);
    expect(box1.warehouse).toBeNull();
    expect(box1.warehouseBreakdown).toEqual(
      expect.arrayContaining([
        { warehouse: "Indore", qty: 3 },
        { warehouse: "Bhopal", qty: 2 },
      ])
    );
  });

  test("the total stays 20 however many times the stock moves", async () => {
    const lot = await companyLotAtBhopal();
    await moveToIndore(lot, 5);
    await moveToIndore(await Inventory.findById(lot._id), 5);

    const d = (await details(lot._id)).body.data;
    expect(d.units).toHaveLength(20);
    expect(d.unitTotal).toBe(20);
    expect(d.bulkPackages).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------ bug 2 */

describe("BUG 2 — the company's label count survives a transfer", () => {
  test("all 20 labels are still the company's after 10 move to Indore", async () => {
    const lot = await companyLotAtBhopal();
    await moveToIndore(lot, 10);

    const units = await barcodeService.listUnits(
      { ownerType: "company", ownerId: companyId },
      { inventoryId: lot._id, identityScope: true },
    );
    // The Labels page renders `units.length of originalQuantity` — 20 of 20.
    expect(units).toHaveLength(20);
    expect((await Inventory.findById(lot._id)).originalQuantity).toBe(20);
  });

  test("…and the dropdown's per-lot count reads 20 on EVERY row of the lot", async () => {
    const lot = await companyLotAtBhopal();
    const dest = await moveToIndore(lot, 10);

    const counts = await barcodeService.unitCountsByLot(
      { ownerType: "company", ownerId: companyId },
      { identityScope: true },
    );
    expect(counts[String(lot._id)]).toBe(20);
    expect(counts[String(dest._id)]).toBe(20);
  });

  test("nothing is left to generate — the lot was fully labelled at creation", async () => {
    const lot = await companyLotAtBhopal();
    await moveToIndore(lot, 10);

    const units = await barcodeService.listUnits(
      { ownerType: "company", ownerId: companyId },
      { inventoryId: lot._id, identityScope: true },
    );
    const remaining = (await Inventory.findById(lot._id)).originalQuantity - units.length;
    expect(remaining).toBe(0);
  });
});

/* -------------------------------------------------- the warehouse is untouched */

describe("the WAREHOUSE view stays row-scoped", () => {
  test("a warehouse sees only the units it holds", async () => {
    const lot = await companyLotAtBhopal();
    await moveToIndore(lot, 10);

    // No identityScope — the default, which is what the warehouse gets.
    const units = await barcodeService.listUnits(
      { ownerType: "company", ownerId: companyId },
      { inventoryId: lot._id },
    );
    expect(units).toHaveLength(10);
  });

  test("its per-lot count is its own, not the company's total", async () => {
    const lot = await companyLotAtBhopal();
    const dest = await moveToIndore(lot, 10);

    const counts = await barcodeService.unitCountsByLot({ ownerType: "company", ownerId: companyId });
    expect(counts[String(lot._id)]).toBe(10);
    expect(counts[String(dest._id)]).toBe(10);
  });

  test("its Lot Details page still reports its own stock", async () => {
    const lot = await companyLotAtBhopal();
    await moveToIndore(lot, 10);

    const res = await details(lot._id, warehouseUser(bhopal));
    expect(res.statusCode).toBe(200);
    // The CURRENT branch — not the company register.
    expect(res.body.data.register).toBeUndefined();
  });
});
