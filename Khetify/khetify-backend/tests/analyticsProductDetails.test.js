/**
 * Company → Analytics → View.
 *
 * The View action needs two things and adds no business logic of its own:
 *   1. the Stock on Hand row must carry the LOT it was derived from, without
 *      changing any report column or the CSV export;
 *   2. GET /lots/:id/details must already answer every field the details page
 *      renders — it is the same endpoint Company → Inventory → View runs on.
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
const reportService = require("../services/reportService");
const lotCtrl = require("../controller/Inventory/lotController");

let companyId, productId, warehouseId, otherWarehouseId;

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const adminUser = () => ({ id: companyId, companyId, role: "company_admin" });
const details = async (id, user = adminUser()) => {
  const res = mockRes();
  await lotCtrl.lotDetails({ params: { id }, user, query: {} }, res);
  return res;
};
const availableUnits = async (id, user = adminUser()) => {
  const res = mockRes();
  await lotCtrl.availableUnits({ params: { id }, user, query: {} }, res);
  return res;
};

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Owner", email: `apd-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  productId = (await Product.create({
    companyId, productName: "Premium Basmati Rice", skuNumber: "PBR-01",
    product_code: "PBR-01", category: "Grains", mrp: 250, price: 240,
  }))._id;
  warehouseId = (await Warehouse.create({
    companyId, name: "Bhopal Warehouse", code: "BHO",
    address: { line1: "MP Nagar", city: "Bhopal", state: "MP", pincode: "462011" },
  }))._id;
  otherWarehouseId = (await Warehouse.create({ companyId, name: "Indore Warehouse", code: "IND" }))._id;
  await BulkPackage.syncIndexes();
  await UnitSerial.syncIndexes();
});

/** A labelled, on-the-books lot, optionally packed into boxes. */
async function makeLot({ qty, boxes, perBox } = {}) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId, qty,
    lotOrigin: "company", pendingReceipt: true,
    ...(boxes ? { hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox } : {}),
  });
  await Inventory.updateOne(
    { _id: inv._id },
    { $set: { inTransitStock: 0, offlineStock: qty, availableStock: qty, lowStockThreshold: 10, receiving_status: "received" } }
  );
  await barcodeService.generateUnits(companyId, inv._id, qty, {});
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

describe("the Stock on Hand row carries its lot", () => {
  test("_inventoryId points at the Inventory row the line was built from", async () => {
    const lot = await makeLot({ qty: 30 });
    const [row] = await reportService.runReport("stock-on-hand", companyId, {});
    expect(String(row._inventoryId)).toBe(String(lot._id));
  });

  test("no visible report column is added — every other key is unchanged", async () => {
    await makeLot({ qty: 30 });
    const [row] = await reportService.runReport("stock-on-hand", companyId, {});
    expect(Object.keys(row).filter((k) => !k.startsWith("_"))).toEqual([
      "product", "sku", "warehouse", "lot", "batch", "qty",
      "costPrice", "value", "amount", "expiry", "abcClass",
    ]);
  });

  test("the CSV export drops internal keys", async () => {
    await makeLot({ qty: 30 });
    const rows = await reportService.runReport("stock-on-hand", companyId, {});
    const chunks = [];
    const res = { setHeader() {}, write: (s) => chunks.push(s), end: (s) => { if (s) chunks.push(s); } };
    reportService.streamCsv(res, "stock-on-hand", rows);
    const [header] = chunks.join("").split("\n");
    expect(header).toBe("product,sku,warehouse,lot,batch,qty,costPrice,value,amount,expiry,abcClass");
    expect(chunks.join("")).not.toContain(String(rows[0]._inventoryId));
  });
});

describe("the details endpoint answers every section", () => {
  test("Product Summary + Inventory Information come off the lot", async () => {
    const lot = await makeLot({ qty: 30 });
    const { body } = await details(lot._id);
    const d = body.data;

    // 1 · Product Summary
    expect(d.lot.productId.productName).toBe("Premium Basmati Rice");
    expect(d.lot.productId.product_code).toBe("PBR-01");
    expect(d.lot.productId.category).toBe("Grains");
    expect(d.lot.productId.mrp).toBe(250);
    expect(d.lot.productId.price).toBe(240);   // needed for Total Amount
    expect(d.lot.warehouseId.name).toBe("Bhopal Warehouse");
    expect(d.lot.lotNumber || d.lot.batchNumber).toBeTruthy();

    // 2 · Inventory Information
    expect(d.lot.availableStock).toBe(30);
    expect(d.lot.originalQuantity).toBe(30);
    expect(d.lot.lowStockThreshold).toBe(10);
    expect(d.lot.receiving_status).toBe("received");

    // 5 · Stock Summary — the warehouse location parts the page flattens.
    expect(d.lot.warehouseId.code).toBe("BHO");
    expect(d.lot.warehouseId.address).toMatchObject({ line1: "MP Nagar", city: "Bhopal", pincode: "462011" });
  });

  test("units carry inventoryId, so a box's CURRENT quantity is countable", async () => {
    const lot = await makeLot({ qty: 20, boxes: 2, perBox: 10 });
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });

    // Six of BP-001's ten units move to another warehouse — the receipt repoints
    // their inventoryId, exactly as shipmentService does.
    const moved = await UnitSerial.find({ inventoryId: lot._id, box_serial: 1 }).limit(6).lean();
    const dest = await Inventory.create({
      productId, ownerType: "company", ownerId: companyId,
      warehouseId: otherWarehouseId, batchNumber: lot.batchNumber, lotNumber: lot.lotNumber,
      offlineStock: 6, availableStock: 6,
    });
    await UnitSerial.updateMany({ _id: { $in: moved.map((u) => u._id) } }, { $set: { inventoryId: dest._id } });

    const { body } = await details(lot._id);
    const units = body.data.units;
    expect(units.every((u) => u.inventoryId !== undefined)).toBe(true);

    // What the page computes for Packaging Information.
    const here = units.filter((u) => String(u.inventoryId) === String(lot._id) && u.status === "in_stock");
    const inBox1 = here.filter((u) => String(u.bulk_packaging_record_id) === String(box1._id));
    expect(inBox1).toHaveLength(4);            // CURRENT quantity
    expect(box1.units_in_box).toBe(10);        // PACKAGE quantity — unchanged
  });

  test("a single-package lot exposes its unit IDs and statuses", async () => {
    const lot = await makeLot({ qty: 5 });
    const { body } = await details(lot._id);
    const loose = body.data.units.filter((u) => !u.bulk_packaging_record_id);
    expect(loose).toHaveLength(5);
    expect(loose.every((u) => (u.unit_code || u.serial) && u.status === "in_stock")).toBe(true);
  });

  test("another company's lot is not readable", async () => {
    const lot = await makeLot({ qty: 5 });
    const stranger = new mongoose.Types.ObjectId();
    const res = await details(lot._id, { id: stranger, companyId: stranger, role: "company_admin" });
    expect(res.statusCode).toBe(404);
  });
});

/**
 * "View Available Units" — WHICH units make up the available quantity, listed by
 * their FULL Unit ID. Every ID must be the code stored on a real UnitSerial row
 * and must reflect the CURRENT state after transfers, sales and receipts.
 * Nothing is generated from a lot number and a counter.
 */
describe("available Unit IDs", () => {
  /** Every unit code actually available for a lot row, straight from the DB. */
  const trueIds = (inventoryId) =>
    UnitSerial.find({ inventoryId, ownerType: "company", status: "in_stock" })
      .select("serial unit_code box_serial unit_serial")
      .sort({ box_serial: 1, unit_serial: 1, serial: 1 })
      .lean()
      .then((r) => r.map((u) => u.unit_code || u.serial));
  /** Flatten the response into the list the popup renders, in order. */
  const listed = (body) => (body.data.groups || []).flatMap((g) => g.unitIds);

  test("a fully-stocked lot lists every one of its unit IDs", async () => {
    const lot = await makeLot({ qty: 100 });
    const { body } = await availableUnits(lot._id);

    expect(body.data.availableStock).toBe(100);
    expect(body.data.labelledCount).toBe(100);
    expect(body.data.truncated).toBe(false);
    expect(body.data.boxed).toBe(false);
    expect(body.data.groups).toHaveLength(1);
    expect(body.data.groups[0].bulkPackagingId).toBeNull();
    expect(listed(body)).toEqual(await trueIds(lot._id));
    // Full stored codes, never bare numbers. A single-package lot's code is
    // built from the lot key (separators stripped) plus the padded sequence.
    expect(listed(body)[0]).toMatch(/^[A-Z0-9]+-001$/);
    expect(listed(body)[99]).toMatch(/-100$/);
  });

  test("sold and shipped units are absent — only the survivors are listed", async () => {
    const lot = await makeLot({ qty: 10 });
    const all = await trueIds(lot._id);
    // Units 3 and 4 leave, exactly as the spec's example.
    await UnitSerial.updateMany({ inventoryId: lot._id, unit_serial: 3 }, { $set: { status: "sold" } });
    await UnitSerial.updateMany({ inventoryId: lot._id, unit_serial: 4 }, { $set: { status: "shipped" } });

    const { body } = await availableUnits(lot._id);
    const shown = listed(body);

    expect(shown).toHaveLength(8);
    expect(shown).toContain(all[0]);
    expect(shown).toContain(all[1]);
    expect(shown).toContain(all[4]);
    expect(shown).not.toContain(all[2]); // …-003
    expect(shown).not.toContain(all[3]); // …-004
  });

  test("units transferred to another warehouse move to that warehouse's list", async () => {
    const lot = await makeLot({ qty: 50 });
    const all = await trueIds(lot._id);
    const dest = await Inventory.create({
      productId, ownerType: "company", ownerId: companyId,
      warehouseId: otherWarehouseId, batchNumber: lot.batchNumber, lotNumber: lot.lotNumber,
      offlineStock: 20, availableStock: 20,
    });
    // The transfer receipt repoints inventoryId — exactly what shipmentService does.
    await UnitSerial.updateMany(
      { inventoryId: lot._id, unit_serial: { $gte: 31 } },
      { $set: { inventoryId: dest._id } }
    );

    const here = listed((await availableUnits(lot._id)).body);
    const there = listed((await availableUnits(dest._id)).body);

    expect(here).toEqual(all.slice(0, 30));
    expect(there).toEqual(all.slice(30));
    // No code appears in both places, and none went missing.
    expect(here.filter((c) => there.includes(c))).toEqual([]);
    expect([...here, ...there].sort()).toEqual([...all].sort());
  });

  test("units supplied to a seller are no longer the company's", async () => {
    const lot = await makeLot({ qty: 10 });
    const all = await trueIds(lot._id);
    await UnitSerial.updateMany(
      { inventoryId: lot._id, unit_serial: { $gte: 6 } },
      { $set: { ownerType: "seller", ownerId: new mongoose.Types.ObjectId() } }
    );
    expect(listed((await availableUnits(lot._id)).body)).toEqual(all.slice(0, 5));
  });

  test("a boxed lot lists each box's own unit IDs, in box order", async () => {
    const lot = await makeLot({ qty: 20, boxes: 2, perBox: 10 });
    const [box1, box2] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });

    const { body } = await availableUnits(lot._id);
    expect(body.data.boxed).toBe(true);
    expect(body.data.groups.map((g) => g.bulkPackagingId))
      .toEqual([box1.bulk_packaging_id, box2.bulk_packaging_id]);

    // Each ID carries its own box prefix — the codes are unambiguous even though
    // the numbers inside them restart at 1 per box.
    for (const g of body.data.groups) {
      expect(g.unitIds).toHaveLength(10);
      expect(g.count).toBe(10);
      expect(g.unitIds.every((c) => c.startsWith(g.bulkPackagingId))).toBe(true);
    }
    expect(body.data.groups[0].unitIds[0]).toBe(`${box1.bulk_packaging_id}-001`);
  });

  test("a partly-picked box lists only what is left in it", async () => {
    const lot = await makeLot({ qty: 20, boxes: 2, perBox: 10 });
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });
    await UnitSerial.updateMany(
      { bulk_packaging_record_id: box1._id, unit_serial: { $in: [3, 4, 8] } },
      { $set: { status: "picked" } }
    );

    const { body } = await availableUnits(lot._id);
    const g = body.data.groups.find((x) => x.bulkPackagingId === box1.bulk_packaging_id);
    expect(g.unitIds).toEqual([1, 2, 5, 6, 7, 9, 10].map((n) => `${box1.bulk_packaging_id}-${String(n).padStart(3, "0")}`));
    expect(g.count).toBe(7);
  });

  test("an emptied box disappears rather than listing nothing", async () => {
    const lot = await makeLot({ qty: 20, boxes: 2, perBox: 10 });
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });
    await UnitSerial.updateMany({ bulk_packaging_record_id: box1._id }, { $set: { status: "shipped" } });

    const { body } = await availableUnits(lot._id);
    expect(body.data.groups).toHaveLength(1);
    expect(body.data.groups[0].bulkPackagingId).not.toBe(box1.bulk_packaging_id);
  });

  test("an unlabelled lot lists no IDs rather than inventing them", async () => {
    const inv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId, qty: 40, batchNumber: "NO-LABELS",
    });
    const { body } = await availableUnits(inv._id);
    expect(body.data.availableStock).toBe(40);
    expect(body.data.labelledCount).toBe(0);
    expect(body.data.groups).toEqual([]);
  });

  test("a very large lot is capped, and says so", async () => {
    const lot = await makeLot({ qty: 20 });
    const spy = jest.spyOn(UnitSerial, "countDocuments");
    // Report a bigger true total than the list returned, the way the real cap
    // behaves at MAX_AVAILABLE_UNITS — the payload must own up to it.
    spy.mockResolvedValueOnce(9000);
    const { body } = await availableUnits(lot._id);
    expect(body.data.labelledCount).toBe(9000);
    expect(body.data.listed).toBe(20);
    expect(body.data.truncated).toBe(true);
    spy.mockRestore();
  });

  test("another company's lot is not readable", async () => {
    const lot = await makeLot({ qty: 5 });
    const stranger = new mongoose.Types.ObjectId();
    const res = await availableUnits(lot._id, { id: stranger, companyId: stranger, role: "company_admin" });
    expect(res.statusCode).toBe(404);
  });
});
