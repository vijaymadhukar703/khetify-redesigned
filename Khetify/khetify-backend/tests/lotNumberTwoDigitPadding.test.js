/**
 * THE MANUAL BUILDER'S RANGE WIDTH — two digits, growing when it must.
 *
 * Every range of a composed lot number padded to three ("BUL001~BUL002"), while
 * the Khetify-generated shape has always used two
 * (lotNumberService.GENERATED_DIGITS). The two now agree, and the width still
 * grows on its own so a count is never truncated.
 *
 * The width TRAVELS WITH THE SEGMENT: the Create Lot builder derives it
 * (ImsLots.autoDigits) and posts it, and the server renders the number from
 * that — so the preview and the stored value are the same string by
 * construction. A lot minted at three digits keeps the width on its own stored
 * recipe, so its number, box IDs and unit codes are never rewritten.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const lotService = require("../services/lotService");
const { normalizeSegments, buildLotNumber } = require("../services/lotNumberSegmentService");

let companyId, warehouseId, productId;

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `pad-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  warehouseId = (await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" }))._id;
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

const V = (key, value) => ({ key, type: "value", value });
/** What the builder posts: the width it derived for that part's own span. */
const R = (key, prefix, digits) => ({ key, type: "range", mode: "variable", prefix, digits });

/** The reported format, with the widths a 2-digit floor produces. */
const segments = ({ bulk = 2, sku = 2, inner = null } = {}) => [
  V("company", "BHO"), V("product", "PRO"),
  R("bulk", "BUL", bulk),
  ...(inner ? [R("inner", "INNER", inner)] : []),
  V("batch", "BAT"), V("year", "2026"), V("month", "08"), V("date", "01"),
  R("sku", "SKU", sku),
];

const createLot = (extra) => lotService.receiveLot({
  ownerId: companyId, productId, warehouseId,
  lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
  ...extra,
});

/* ------------------------------------------------------------- the number */

describe("a composed lot number pads to two", () => {
  test("2 boxes × 2 inner × 5 units reads in two digits throughout", async () => {
    const inv = await createLot({
      qty: 20, lotSegments: segments({ inner: 2 }),
      hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 5,
      mainBoxes: 2, boxesPerMain: 2,
    });

    expect(inv.lotNumber).toBe("BHO-PRO-BUL01~BUL02-INNER01~INNER02-BAT-2026-08-01-SKU01~SKU20");
  });

  test("a two-level lot too", async () => {
    const inv = await createLot({
      qty: 20, lotSegments: segments(),
      hasBulkPackaging: true, numberOfBoxes: 5, unitsPerBox: 4,
    });

    expect(inv.lotNumber).toBe("BHO-PRO-BUL01~BUL05-BAT-2026-08-01-SKU01~SKU20");
  });

  test("a single-package lot too", async () => {
    const inv = await createLot({ qty: 8, lotSegments: segments() });
    expect(inv.lotNumber).toBe("BHO-PRO-BAT-2026-08-01-SKU01~SKU08");
  });
});

/* ------------------------------------------------------ it grows, never cuts */

describe("the width grows with the count", () => {
  test.each([
    [9, 2, "SKU01~SKU09"],
    [99, 2, "SKU01~SKU99"],
    [100, 3, "SKU001~SKU100"],
    [1000, 4, "SKU0001~SKU1000"],
  ])("%i units → %i digits", async (qty, digits, expected) => {
    const inv = await createLot({ qty, lotSegments: segments({ sku: digits }) });
    expect(inv.lotNumber).toContain(expected);
  });

  test("a 100-box lot pads its bulk range to three, SKU to its own width", async () => {
    const inv = await createLot({
      qty: 200, lotSegments: segments({ bulk: 3, sku: 3 }),
      hasBulkPackaging: true, numberOfBoxes: 100, unitsPerBox: 2,
    });
    expect(inv.lotNumber).toBe("BHO-PRO-BUL001~BUL100-BAT-2026-08-01-SKU001~SKU200");
  });
});

/* --------------------------------------------- box IDs and unit codes match */

describe("box IDs and unit codes read the same way as the number", () => {
  test("three levels — every ID in two digits, closed by the lot serial", async () => {
    const inv = await createLot({
      qty: 20, lotSegments: segments({ inner: 2 }),
      hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 5,
      mainBoxes: 2, boxesPerMain: 2,
    });

    const inner = await BulkPackage.find({ lot_id: inv._id, box_level: "inner" }).sort({ box_serial: 1 }).lean();
    expect(inner[0].bulk_packaging_id).toMatch(/^BHO-PRO-BUL01-INNER01-BAT-2026-08-01-\d{4}$/);

    const main = await BulkPackage.find({ lot_id: inv._id, box_level: "main" }).sort({ box_serial: 1 }).lean();
    expect(main[0].bulk_packaging_id).toMatch(/^BHO-PRO-BUL01-INNER01~INNER02-BAT-2026-08-01-\d{4}$/);

    const unit = await UnitSerial.findOne({ inventoryId: inv._id }).sort({ unit_serial: 1 }).lean();
    expect(unit.serial).toMatch(/^BHO-PRO-BUL01-INNER01-BAT-2026-08-01-SKU01-\d{4}$/);
  });

  test("two levels", async () => {
    const inv = await createLot({
      qty: 20, lotSegments: segments(),
      hasBulkPackaging: true, numberOfBoxes: 5, unitsPerBox: 4,
    });

    const box = await BulkPackage.findOne({ lot_id: inv._id, box_serial: 1 }).lean();
    expect(box.bulk_packaging_id).toMatch(/^BHO-PRO-BUL01-BAT-2026-08-01-\d{4}$/);
    const unit = await UnitSerial.findOne({ inventoryId: inv._id }).sort({ unit_serial: 1 }).lean();
    expect(unit.serial).toMatch(/^BHO-PRO-BUL01-BAT-2026-08-01-SKU01-\d{4}$/);
  });
});

/* ------------------------------------------------- old lots are not rewritten */

describe("lots minted at three digits keep their IDs", () => {
  test("a stored 3-digit recipe still renders 3-digit", () => {
    // The recipe travels with the lot, so an older lot's number, boxes and units
    // are rebuilt at the width they were printed with.
    const old = normalizeSegments(segments({ bulk: 3, sku: 3, inner: 3 }));
    expect(buildLotNumber(old, { boxCount: 2, innerCount: 2, unitCount: 20 }))
      .toBe("BHO-PRO-BUL001~BUL002-INNER001~INNER002-BAT-2026-08-01-SKU001~SKU020");
  });

  test("an old lot row is untouched by the new default", async () => {
    const OLD = "BHO-PRO-BUL001~BUL002-BAT-2026-08-01-SKU001~SKU020";
    const row = await Inventory.create({
      productId, ownerType: "company", ownerId: companyId, warehouseId,
      lotNumber: OLD, batchNumber: OLD, availableStock: 20, offlineStock: 20,
      lot_number_segments: normalizeSegments(segments({ bulk: 3, sku: 3 })),
    });

    const found = await Inventory.findOne({ ownerId: companyId, lotNumber: OLD });
    expect(String(found._id)).toBe(String(row._id));
    expect(found.lotNumber).toBe(OLD);
    // Its stored widths are still three — nothing rewrote the recipe.
    expect(found.lot_number_segments.find((s) => s.key === "sku").digits).toBe(3);
  });

  test("a NEW lot and an OLD one coexist under different numbers", async () => {
    const OLD = "BHO-PRO-BUL001~BUL002-BAT-2026-08-01-SKU001~SKU020";
    await Inventory.create({
      productId, ownerType: "company", ownerId: companyId, warehouseId,
      lotNumber: OLD, batchNumber: OLD, availableStock: 20, offlineStock: 20,
    });

    const fresh = await createLot({
      qty: 20, lotSegments: segments(),
      hasBulkPackaging: true, numberOfBoxes: 2, unitsPerBox: 10,
    });
    expect(fresh.lotNumber).toBe("BHO-PRO-BUL01~BUL02-BAT-2026-08-01-SKU01~SKU20");
    expect(fresh.lotNumber).not.toBe(OLD);
  });
});

/* ------------------------------------------- the fallback width, when unstated */

describe("a segment that carries no width", () => {
  test("falls back to two, not three", () => {
    const segs = normalizeSegments([
      V("company", "BHO"), { key: "sku", type: "range", mode: "variable", prefix: "SKU" },
    ]);
    expect(segs.find((s) => s.key === "sku").digits).toBe(2);
    expect(buildLotNumber(segs, { unitCount: 5 })).toBe("BHO-SKU01~SKU05");
  });
});
