/**
 * WHICH IDENTITY ACTUALLY CLASHED — said correctly.
 *
 * Creating a lot mints three kinds of identity, and they collide for different
 * reasons and are fixed in different ways:
 *
 *   lot number          the whole thing, SKU range included
 *   Bulk Packaging ID   the same parts WITHOUT the SKU range — a box is not a unit
 *   unit code           the same parts WITH one member of the SKU range
 *
 * So two lots whose numbers genuinely differ —
 *   VNR-PRO-BU001~BU002-BAT-2026-08-01-SKU001~SKU010
 *   VNR-PRO-BU001~BU002-BAT-2026-08-01-SKU001~SKU100
 * — still mint the SAME box IDs ("VNR-PRO-BU001-BAT-2026-08-01"), and the second
 * lot was refused with "This lot number already exists. Change one of the parts
 * to make it unique." That is false (the numbers differ) and it points at the
 * one part that cannot help (the SKU range is not in a box ID).
 *
 * Worse, on a standalone MongoDB — no transaction to roll back — the lot was
 * written anyway and its unit labels failed silently, leaving a lot with no
 * codes at all and a success message on screen.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const lotCtrl = require("../controller/Inventory/lotController");

let companyId, warehouseId, productId;

beforeEach(async () => {
  // The unique indexes are the whole subject here, and mongoose builds them
  // asynchronously — without this the first inserts can slip in before they
  // exist and a duplicate is silently accepted.
  await Promise.all([BulkPackage.init(), UnitSerial.init(), Inventory.init()]);

  const c = await Company.create({
    fullName: "Co", email: `dupm-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  warehouseId = (await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" }))._id;
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const V = (key, value) => ({ key, type: "value", value });
const R = (key, prefix, digits = 3) => ({ key, type: "range", mode: "variable", prefix, digits });

/** The reported format: company, product, bulk range, batch, date, SKU range. */
const SEGMENTS = [
  V("company", "VNR"), V("product", "PRO"), R("bulk", "BU"),
  V("batch", "BAT"), V("year", "2026"), V("month", "08"), V("date", "01"),
];
const withSku = [...SEGMENTS, R("sku", "SKU")];

const create = async (body) => {
  const res = mockRes();
  await lotCtrl.receiveLot({
    body: { productId, warehouseId, mfgDate: "2026-08-01", ...body },
    user: { id: companyId, companyId, role: "company_admin" },
  }, res);
  return res;
};

const boxedLot = (qty, perBox, segments = withSku) => create({
  qty, lotSegments: segments,
  hasBulkPackaging: true, numberOfBoxes: 2, unitsPerBox: perBox,
});

/* ------------------------------------------------------ the reported case */

describe("two lots whose BOX IDs collide", () => {
  test("the first lot is created, with no error", async () => {
    const a = await boxedLot(10, 5);

    expect(a.statusCode).toBe(200);
    expect(a.body.success).toBe(true);
    expect(a.body.message).not.toMatch(/already exists/i);
    expect(a.body.data.lotNumber).toBe("VNR-PRO-BU001~BU002-BAT-2026-08-01-SKU001~SKU010");
  });

  /**
   * BOTH LOTS ARE CREATED NOW — the clash cannot happen.
   *
   * These four used to assert the refusal, which was the right answer while box
   * IDs carried nothing to tell two such lots apart. Each lot's own serial now
   * closes its box and unit IDs (as a Khetify-generated lot's always have), so
   * there is nothing left to refuse. The guard stays as an unreachable safety
   * net; see "the guard is still there" below.
   */
  test("the second lot is CREATED, not refused", async () => {
    await boxedLot(10, 5);
    const b = await boxedLot(100, 50);

    expect(b.statusCode).toBe(200);
    expect(b.body.success).toBe(true);
    expect(b.body.message).not.toMatch(/already/i);
    // Its NUMBER is still exactly the operator's format — no serial added.
    expect(b.body.data.lotNumber).toBe("VNR-PRO-BU001~BU002-BAT-2026-08-01-SKU001~SKU100");
  });

  test("their BOX IDs differ by the lot serial", async () => {
    await boxedLot(10, 5);
    await boxedLot(100, 50);

    const ids = (await BulkPackage.find({ company_id: companyId }).lean())
      .map((b) => b.bulk_packaging_id).sort();
    expect(ids).toEqual([
      "VNR-PRO-BU001-BAT-2026-08-01-0001", "VNR-PRO-BU001-BAT-2026-08-01-0002",
      "VNR-PRO-BU002-BAT-2026-08-01-0001", "VNR-PRO-BU002-BAT-2026-08-01-0002",
    ]);
    expect(new Set(ids).size).toBe(4);
  });

  test("EVERY label of both lots is minted — no silent failure", async () => {
    await boxedLot(10, 5);
    await boxedLot(100, 50);

    // 10 + 100. This used to come out at 10, the second lot's labels having
    // died on the unit-code index while the API reported success.
    expect(await UnitSerial.countDocuments({ companyId })).toBe(110);
    const codes = (await UnitSerial.find({ companyId }).select("serial").lean()).map((u) => u.serial);
    expect(new Set(codes).size).toBe(110);
  });

  test("the unit codes carry the serial too, so SKU001 of each lot differs", async () => {
    await boxedLot(10, 5);
    await boxedLot(100, 50);

    const first = await UnitSerial.find({ serial: /-SKU001-/ }).select("serial").lean();
    expect(first.map((u) => u.serial).sort()).toEqual([
      "VNR-PRO-BU001-BAT-2026-08-01-SKU001-0001",
      "VNR-PRO-BU001-BAT-2026-08-01-SKU001-0002",
    ]);
  });
});

/* -------------------------------------------------- the clash is resolvable */

describe("changing a part that IS in the box ID works", () => {
  test("a different BATCH creates the second lot cleanly", async () => {
    await boxedLot(10, 5);

    const b = await boxedLot(100, 50, [
      V("company", "VNR"), V("product", "PRO"), R("bulk", "BU"),
      V("batch", "BAT2"), V("year", "2026"), V("month", "08"), V("date", "01"),
      R("sku", "SKU"),
    ]);

    expect(b.statusCode).toBe(200);
    expect(b.body.message).not.toMatch(/already exists/i);
    expect(await BulkPackage.countDocuments({ company_id: companyId })).toBe(4);
    expect(await UnitSerial.countDocuments({ companyId })).toBe(110);
  });

  test("a different DATE works too", async () => {
    await boxedLot(10, 5);

    const b = await boxedLot(100, 50, [
      V("company", "VNR"), V("product", "PRO"), R("bulk", "BU"),
      V("batch", "BAT"), V("year", "2026"), V("month", "08"), V("date", "02"),
      R("sku", "SKU"),
    ]);
    expect(b.statusCode).toBe(200);
  });
});

/* ------------------------------------- old lots keep their printed IDs */

describe("lots created BEFORE the serial keep their IDs", () => {
  test("a lot with no stored serial still mints the old, serial-less shape", async () => {
    const a = await boxedLot(10, 5);
    // Exactly the state an older lot is in: the recipe is stored, the serial
    // is not. Its cartons were printed without one and must stay readable.
    await Inventory.updateOne({ _id: a.body.data._id }, { $unset: { lot_number_serial: 1 } });
    const legacy = await Inventory.findById(a.body.data._id).lean();

    const { buildBoxId, buildUnitId } = require("../services/lotNumberSegmentService");
    expect(buildBoxId(legacy, 1)).toBe("VNR-PRO-BU001-BAT-2026-08-01");
    expect(buildUnitId(legacy, { boxSerial: 1, unitNumber: 1 }))
      .toBe("VNR-PRO-BU001-BAT-2026-08-01-SKU001");
  });
});

/* --------------------------------------------- the guard is still there */

describe("the box-ID guard remains, as a safety net", () => {
  test("it fires when a box ID really is taken, and says which", async () => {
    const a = await boxedLot(10, 5);
    // Force the exact state the guard exists for: a box already carrying the ID
    // this lot's serial would mint. Unreachable through the UI now.
    await Inventory.updateOne({ _id: a.body.data._id }, { $unset: { lot_number_serial: 1 } });
    await BulkPackage.updateOne(
      { bulk_packaging_id: "VNR-PRO-BU001-BAT-2026-08-01-0001" },
      { $set: { bulk_packaging_id: "VNR-PRO-BU001-BAT-2026-08-01-0002", lot_number: "OTHER-LOT" } }
    );

    const b = await boxedLot(100, 50);
    expect(b.statusCode).toBe(409);
    expect(b.body.message).toContain("Bulk Packaging ID VNR-PRO-BU001-BAT-2026-08-01-0002");
    expect(b.body.message).not.toMatch(/lot number already exists/i);
  });
});

/* ------------------------------------------- the other duplicates, unchanged */

describe("every other clash keeps its own message", () => {
  test("a genuinely REPEATED lot number still says so", async () => {
    await boxedLot(10, 5);
    // The very same parts — same SKU range too, so the numbers really do match.
    const again = await boxedLot(10, 5);

    expect(again.statusCode).toBe(409);
    expect(again.body.message).toMatch(/lot number already exists/i);
  });

  test("a SINGLE-PACKAGE lot repeated says the same", async () => {
    const segments = [...SEGMENTS, R("sku", "SKU")];
    await create({ qty: 10, lotSegments: segments });
    const again = await create({ qty: 10, lotSegments: segments });

    expect(again.statusCode).toBe(409);
    expect(again.body.message).toMatch(/lot number already exists/i);
  });
});

/* -------------------------------------------------- success stays silent */

describe("a lot that is created reports no error at all", () => {
  test("boxed", async () => {
    const r = await boxedLot(10, 5);
    expect(r.statusCode).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.message).toMatch(/^Lot created|^Lot received/);
    expect(r.body.bulkPackages).toHaveLength(2);
  });

  test("single package", async () => {
    const r = await create({ qty: 7, lotSegments: [...SEGMENTS, R("sku", "SKU")] });
    expect(r.statusCode).toBe(200);
    expect(r.body.success).toBe(true);
    expect(await UnitSerial.countDocuments({ companyId })).toBe(7);
  });

  test("KHETIFY-GENERATED lots never collide with each other", async () => {
    const a = await create({ qty: 10, hasBulkPackaging: true, numberOfBoxes: 2, unitsPerBox: 5 });
    const b = await create({ qty: 10, hasBulkPackaging: true, numberOfBoxes: 2, unitsPerBox: 5 });

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    // Their serials keep them apart.
    expect(a.body.data.lotNumber).not.toBe(b.body.data.lotNumber);
    expect(await BulkPackage.countDocuments({ company_id: companyId })).toBe(4);
  });
});

/* ------------------------------------------------- the mapper in isolation */

describe("duplicateKeyMessage", () => {
  const map = (message, keyValue) =>
    lotCtrl.__duplicateKeyMessage({ code: 11000, message, keyValue });

  test("a bulkpackages clash names the box, never the lot number", () => {
    const m = map(
      'E11000 duplicate key error collection: db.bulkpackages index: bulk_packaging_id_1 dup key: { bulk_packaging_id: "X-1" }',
      { bulk_packaging_id: "X-1" },
    );
    expect(m).toMatch(/Bulk Packaging ID/);
    expect(m).not.toMatch(/lot number already exists/i);
  });

  test("a unitserials clash names the unit code", () => {
    const m = map(
      'E11000 duplicate key error collection: db.unitserials index: serial_1 dup key: { serial: "X-1-SKU01" }',
      { serial: "X-1-SKU01" },
    );
    expect(m).toMatch(/unit code/i);
  });

  test("a lotnumbers clash keeps the original wording", () => {
    const m = map(
      'E11000 duplicate key error collection: db.lotnumbers index: companyId_1_lotNumber_1 dup key: { lotNumber: "X" }',
      { lotNumber: "X" },
    );
    expect(m).toMatch(/lot number already exists/i);
  });

  test("anything that is not a duplicate key is left alone", () => {
    expect(lotCtrl.__duplicateKeyMessage(new Error("boom"))).toBeNull();
    expect(lotCtrl.__duplicateKeyMessage({ status: 400, message: "bad" })).toBeNull();
  });
});
