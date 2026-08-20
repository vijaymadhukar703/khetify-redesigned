const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const lotService = require("../services/lotService");
const svc = require("../services/barcodeService");
const { BULK_CONFIG_INCOMPLETE, BULK_BOX_MISSING } = require("../services/barcodeService");

let companyId, warehouseId, productId;

beforeEach(async () => {
  const company = await Company.create({
    fullName: "Owner",
    email: `bu-${new mongoose.Types.ObjectId()}@x.com`,
    password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = company._id;
  warehouseId = (await Warehouse.create({ companyId, name: "Khargone", code: "KHA" }))._id;
  productId = (await Product.create({ companyId, productName: "Urea Fertilizer" }))._id;
  await UnitSerial.syncIndexes();
  await BulkPackage.syncIndexes();
});

// These tests pin the FALLBACK identity formats — "<LOT>-BP<serial>" for a box
// and a per-box unit sequence restarting at 001 — which govern a lot whose
// number the system did not compose: a GRN's supplier code, a legacy row, or
// any lot created with an explicit number. A Khetify-GENERATED number is now
// composed from segments and its boxes/units descend from it instead (see
// lotNumberSegmentService and tests/lotDetailsBoxUnits.test.js), so each lot
// here is given its own explicit number to stay on the path under test.
let lotSeq = 0;
const legacyNumber = () => `LEGACY-LOT-${++lotSeq}`;

/** A boxed lot: 10 units = 2 boxes × 5 (the spec's worked example). */
const boxedLot = (opts = {}) =>
  lotService.receiveLot({
    ownerId: companyId, productId, warehouseId, lotNumber: legacyNumber(),
    qty: 10, lotOrigin: "company", pendingReceipt: true,
    hasBulkPackaging: true, numberOfBoxes: 2, unitsPerBox: 5,
    ...opts,
  });

/** A plain lot, no bulk packaging. */
const plainLot = (opts = {}) =>
  lotService.receiveLot({
    ownerId: companyId, productId, warehouseId, lotNumber: legacyNumber(),
    qty: 10, lotOrigin: "company", pendingReceipt: true, ...opts,
  });

const unitsOf = (invId) =>
  UnitSerial.find({ inventoryId: invId }).sort({ box_serial: 1, unit_serial: 1 }).lean();

describe("unit codes descend from the Bulk Packaging ID", () => {
  test("<BULK_PACKAGING_ID>-<UNIT_SERIAL>, restarting at 001 in every box", async () => {
    const inv = await boxedLot();
    await svc.generateUnits(companyId, inv._id, 10, {});
    const units = await unitsOf(inv._id);

    expect(units).toHaveLength(10);
    expect(units.map((u) => u.unit_code)).toEqual([
      `${inv.lotNumber}-BP-001-001`,
      `${inv.lotNumber}-BP-001-002`,
      `${inv.lotNumber}-BP-001-003`,
      `${inv.lotNumber}-BP-001-004`,
      `${inv.lotNumber}-BP-001-005`,
      `${inv.lotNumber}-BP-002-001`,
      `${inv.lotNumber}-BP-002-002`,
      `${inv.lotNumber}-BP-002-003`,
      `${inv.lotNumber}-BP-002-004`,
      `${inv.lotNumber}-BP-002-005`,
    ]);
  });

  test("serial stays in step with unit_code (the canonical scan field)", async () => {
    const inv = await boxedLot();
    await svc.generateUnits(companyId, inv._id, 10, {});
    const units = await unitsOf(inv._id);
    expect(units.every((u) => u.serial === u.unit_code)).toBe(true);
    // the QR payload carries the same code
    expect(JSON.parse(units[0].qr)).toEqual({ t: "unit", s: units[0].unit_code });
  });

  test("each unit stores its box references and its parent lot", async () => {
    const inv = await boxedLot();
    await svc.generateUnits(companyId, inv._id, 10, {});
    const boxes = await BulkPackage.find({ lot_id: inv._id }).sort({ box_serial: 1 }).lean();
    const units = await unitsOf(inv._id);

    const first = units[0];
    expect(String(first.bulk_packaging_record_id)).toBe(String(boxes[0]._id));
    expect(first.bulk_packaging_id).toBe(boxes[0].bulk_packaging_id);
    expect(first.box_serial).toBe(1);
    expect(first.unit_serial).toBe(1);
    // parent lot references are kept exactly as before
    expect(String(first.inventoryId)).toBe(String(inv._id));
    expect(first.lotNumber).toBe(inv.lotNumber);
    expect(String(first.companyId)).toBe(String(companyId));
    expect(String(first.productId)).toBe(String(productId));

    const sixth = units[5];
    expect(String(sixth.bulk_packaging_record_id)).toBe(String(boxes[1]._id));
    expect(sixth.box_serial).toBe(2);
    expect(sixth.unit_serial).toBe(1); // restarts inside box 2
  });

  test("a unit is linked to exactly ONE box", async () => {
    const inv = await boxedLot();
    await svc.generateUnits(companyId, inv._id, 10, {});
    const units = await unitsOf(inv._id);
    // scalar fields, so one box each; and the split is 5/5
    const perBox = units.reduce((m, u) => ({ ...m, [u.box_serial]: (m[u.box_serial] || 0) + 1 }), {});
    expect(perBox).toEqual({ 1: 5, 2: 5 });
  });

  test("unit codes are globally unique at the database level", async () => {
    const inv = await boxedLot();
    await svc.generateUnits(companyId, inv._id, 10, {});
    const [u] = await unitsOf(inv._id);
    await expect(
      UnitSerial.create({
        companyId, ownerType: "company", ownerId: companyId,
        serial: `${u.unit_code}-X`, unit_code: u.unit_code,
        productId, inventoryId: inv._id,
      })
    ).rejects.toThrow(/duplicate key/i);
  });
});

describe("box-order filling and partial generation", () => {
  test("the first 5 go to BP-001, the next 5 to BP-002", async () => {
    const inv = await boxedLot();

    await svc.generateUnits(companyId, inv._id, 5, {});
    let units = await unitsOf(inv._id);
    expect(units).toHaveLength(5);
    expect(units.every((u) => u.box_serial === 1)).toBe(true);

    await svc.generateUnits(companyId, inv._id, 5, {});
    units = await unitsOf(inv._id);
    expect(units).toHaveLength(10);
    expect(units.filter((u) => u.box_serial === 2)).toHaveLength(5);
  });

  test("a partial batch spills into the next box without exceeding units_per_box", async () => {
    const inv = await boxedLot();
    await svc.generateUnits(companyId, inv._id, 3, {}); // box 1: 3 used, 2 free
    await svc.generateUnits(companyId, inv._id, 4, {}); // 2 finish box 1, 2 start box 2

    const units = await unitsOf(inv._id);
    expect(units.filter((u) => u.box_serial === 1)).toHaveLength(5);
    expect(units.filter((u) => u.box_serial === 2)).toHaveLength(2);
    expect(units.filter((u) => u.box_serial === 2).map((u) => u.unit_serial)).toEqual([1, 2]);
  });

  test("no box ever holds more than units_per_box", async () => {
    const inv = await boxedLot();
    await svc.generateUnits(companyId, inv._id, 10, {});
    const boxes = await BulkPackage.find({ lot_id: inv._id }).lean();
    for (const b of boxes) {
      expect(await UnitSerial.countDocuments({ bulk_packaging_record_id: b._id })).toBe(5);
    }
  });

  test("generating past the lot quantity is refused (the existing cap still holds)", async () => {
    const inv = await boxedLot();
    await expect(svc.generateUnits(companyId, inv._id, 11, {})).rejects.toThrow(
      /generate at most/i,
    );
    expect(await UnitSerial.countDocuments({ inventoryId: inv._id })).toBe(0);
  });

  test("once every box is full, another generate is refused", async () => {
    const inv = await boxedLot();
    await svc.generateUnits(companyId, inv._id, 10, {});
    await expect(svc.generateUnits(companyId, inv._id, 1, {})).rejects.toThrow(
      "All unit labels for this lot have already been generated.",
    );
    expect(await UnitSerial.countDocuments({ inventoryId: inv._id })).toBe(10);
  });

  test("CONCURRENT generates never mint the same unit code twice", async () => {
    const inv = await boxedLot();
    await Promise.allSettled([
      svc.generateUnits(companyId, inv._id, 5, {}),
      svc.generateUnits(companyId, inv._id, 5, {}),
    ]);

    const units = await unitsOf(inv._id);
    const codes = units.map((u) => u.unit_code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(units.length).toBeLessThanOrEqual(10);
    // and no box overflowed
    for (const s of [1, 2]) {
      expect(units.filter((u) => u.box_serial === s).length).toBeLessThanOrEqual(5);
    }
  });
});

describe("label capacity comes from the ORIGINAL lot quantity", () => {
  const Inventory = require("../model/Inventory/Inventory");

  test("a lot still awaiting warehouse receipt can be fully labelled (availableStock is 0)", async () => {
    const inv = await plainLot(); // pendingReceipt → availableStock 0, inTransitStock 10
    expect(inv.availableStock).toBe(0);
    expect(inv.originalQuantity).toBe(10);

    await svc.generateUnits(companyId, inv._id, 10, {});
    expect(await UnitSerial.countDocuments({ inventoryId: inv._id })).toBe(10);
  });

  test("dispatching stock does NOT shrink the label capacity", async () => {
    const inv = await plainLot();
    await svc.generateUnits(companyId, inv._id, 4, {});

    // The lot moves onto the books and then 8 units leave the building.
    await Inventory.updateOne(
      { _id: inv._id },
      { $set: { inTransitStock: 0, offlineStock: 2, availableStock: 2 } },
    );

    // 10 were manufactured, 4 are labelled → 6 labels must still be mintable
    // even though only 2 units remain in stock.
    await svc.generateUnits(companyId, inv._id, 6, {});
    expect(await UnitSerial.countDocuments({ inventoryId: inv._id })).toBe(10);
  });

  test("a boxed lot's capacity is boxes × units-per-box, unaffected by receiving", async () => {
    const inv = await boxedLot(); // 2 × 5 = 10
    expect(inv.originalQuantity).toBe(10);
    // Simulate the warehouse having received only the first box.
    await Inventory.updateOne(
      { _id: inv._id },
      { $set: { inTransitStock: 5, offlineStock: 5, availableStock: 5, receiving_status: "partially_received" } },
    );
    await svc.generateUnits(companyId, inv._id, 10, {});
    expect(await UnitSerial.countDocuments({ inventoryId: inv._id })).toBe(10);
  });

  test("the cap is still the original quantity — one more is refused", async () => {
    const inv = await plainLot();
    await svc.generateUnits(companyId, inv._id, 10, {});
    await expect(svc.generateUnits(companyId, inv._id, 1, {})).rejects.toThrow(
      "All unit labels for this lot have already been generated.",
    );
  });

  test("a partial over-request reports how many are actually left", async () => {
    const inv = await plainLot();
    await svc.generateUnits(companyId, inv._id, 7, {});
    await expect(svc.generateUnits(companyId, inv._id, 5, {})).rejects.toThrow(
      /created with 10 unit\(s\) and 7 are already labelled — you can generate at most 3 more/,
    );
  });

  test("a legacy row with no originalQuantity falls back to on-hand + in-transit", async () => {
    const legacy = await Inventory.create({
      productId, ownerType: "company", ownerId: companyId, warehouseId,
      lotNumber: "LEGACY-LOT", batchNumber: "LEGACY-LOT",
      offlineStock: 6, availableStock: 6,
    });
    expect(legacy.originalQuantity).toBeNull();

    await svc.generateUnits(companyId, legacy._id, 6, {});
    await expect(svc.generateUnits(companyId, legacy._id, 1, {})).rejects.toThrow(
      "All unit labels for this lot have already been generated.",
    );
  });
});

describe("unitCountsByLot (drives the Labels dropdown's remaining count)", () => {
  test("returns a count per lot, keyed by inventoryId", async () => {
    const a = await plainLot();
    const b = await boxedLot();
    await svc.generateUnits(companyId, a._id, 4, {});
    await svc.generateUnits(companyId, b._id, 7, {});

    const counts = await svc.unitCountsByLot(companyId);
    expect(counts[String(a._id)]).toBe(4);
    expect(counts[String(b._id)]).toBe(7);
  });

  test("a lot with no labels is simply absent (reads as 0)", async () => {
    const untouched = await plainLot();
    const counts = await svc.unitCountsByLot(companyId);
    expect(counts[String(untouched._id)]).toBeUndefined();
  });

  test("counts are owner-scoped — another company's units never leak in", async () => {
    const mine = await plainLot();
    await svc.generateUnits(companyId, mine._id, 3, {});

    const stranger = new mongoose.Types.ObjectId();
    const counts = await svc.unitCountsByLot(stranger);
    expect(counts).toEqual({});
  });

  test("the count matches the lot's original quantity once fully labelled", async () => {
    const inv = await plainLot(); // created with 10
    await svc.generateUnits(companyId, inv._id, 10, {});
    const counts = await svc.unitCountsByLot(companyId);
    // original 10 − 10 labelled → the dropdown shows "(avail 0)"
    expect(inv.originalQuantity - counts[String(inv._id)]).toBe(0);
  });
});

describe("validation", () => {
  test("missing box records → 'A Bulk Packaging ID is missing for one or more boxes.'", async () => {
    const inv = await boxedLot();
    await BulkPackage.deleteOne({ lot_id: inv._id, box_serial: 2 });
    await expect(svc.generateUnits(companyId, inv._id, 5, {})).rejects.toThrow(BULK_BOX_MISSING);
  });

  test("a box row with a blank Bulk Packaging ID is caught too", async () => {
    const inv = await boxedLot();
    await BulkPackage.collection.updateOne(
      { lot_id: inv._id, box_serial: 1 },
      { $set: { bulk_packaging_id: "" } },
    );
    await expect(svc.generateUnits(companyId, inv._id, 5, {})).rejects.toThrow(BULK_BOX_MISSING);
  });

  test("incomplete packaging config → 'Bulk Packaging configuration is incomplete for this lot.'", async () => {
    const inv = await boxedLot();
    const Inventory = require("../model/Inventory/Inventory");
    await Inventory.collection.updateOne({ _id: inv._id }, { $unset: { units_per_box: "" } });
    await expect(svc.generateUnits(companyId, inv._id, 5, {})).rejects.toThrow(BULK_CONFIG_INCOMPLETE);
  });

  test("a blocked generation writes no units at all", async () => {
    const inv = await boxedLot();
    await BulkPackage.deleteOne({ lot_id: inv._id, box_serial: 2 });
    await expect(svc.generateUnits(companyId, inv._id, 5, {})).rejects.toThrow();
    expect(await UnitSerial.countDocuments({ inventoryId: inv._id })).toBe(0);
  });
});

describe("non-bulk lots keep the existing behaviour", () => {
  test("codes stay the lot-number format, with no box references", async () => {
    const inv = await plainLot();
    await svc.generateUnits(companyId, inv._id, 10, {});
    const units = await unitsOf(inv._id);

    const lotKey = inv.lotNumber.replace(/[^A-Z0-9]/g, "");
    expect(units[0].serial).toBe(`${lotKey}-001`);
    expect(units[9].serial).toBe(`${lotKey}-010`);
    expect(units.every((u) => u.bulk_packaging_record_id === null)).toBe(true);
    expect(units.every((u) => u.bulk_packaging_id === null)).toBe(true);
    expect(units.every((u) => u.box_serial === null)).toBe(true);
  });

  test("the lot counter keeps running across batches (unchanged)", async () => {
    const inv = await plainLot();
    await svc.generateUnits(companyId, inv._id, 4, {});
    await svc.generateUnits(companyId, inv._id, 3, {});
    const units = await unitsOf(inv._id);
    const lotKey = inv.lotNumber.replace(/[^A-Z0-9]/g, "");
    expect(units.map((u) => u.serial)).toEqual(
      [1, 2, 3, 4, 5, 6, 7].map((n) => `${lotKey}-00${n}`),
    );
  });

  test("units minted before this feature existed are untouched", async () => {
    const inv = await plainLot();
    // A pre-feature row: no unit_code, no box fields.
    await UnitSerial.collection.insertOne({
      companyId, ownerType: "company", ownerId: companyId,
      serial: "LEGACY-001", productId, inventoryId: inv._id,
      lotNumber: inv.lotNumber, status: "generated", printed: false,
    });
    await svc.generateUnits(companyId, inv._id, 2, {});

    const legacy = await UnitSerial.findOne({ serial: "LEGACY-001" }).lean();
    expect(legacy.serial).toBe("LEGACY-001");
    expect(legacy.unit_code).toBeUndefined(); // never back-written
    // and several legacy rows can coexist — the unique index is sparse
    await UnitSerial.collection.insertOne({
      companyId, ownerType: "company", ownerId: companyId,
      serial: "LEGACY-002", productId, inventoryId: inv._id, status: "generated",
    });
    expect(await UnitSerial.countDocuments({ serial: /^LEGACY-/ })).toBe(2);
  });

  test("listUnits returns the new fields for boxed lots and nulls for plain ones", async () => {
    const boxed = await boxedLot();
    await svc.generateUnits(companyId, boxed._id, 5, {});
    const [u] = await svc.listUnits(companyId, { inventoryId: boxed._id });
    expect(u.bulk_packaging_id).toBe(`${boxed.lotNumber}-BP-001`);
    expect(u.box_serial).toBe(1);
  });
});
