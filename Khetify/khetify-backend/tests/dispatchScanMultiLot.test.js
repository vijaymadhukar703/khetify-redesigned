/**
 * SCAN-OUT ACROSS THE LOTS OF ONE PRODUCT — including a lot the plan never named.
 *
 * `New Shipment` asks the operator for a PRODUCT and a QUANTITY; the server then
 * splits that across the source warehouse's lots, earliest expiry first, and
 * writes one line per lot. Those lines are an allocation, not a picking list —
 * they are decided before anyone walks to a shelf.
 *
 * The scan-out dialog treated them as the picking list: every scan was resolved
 * against the lots the plan happened to name, so a lot it did not reach was
 * refused as "not on shipment" however it was scanned. On a shelf holding three
 * lots of one product, a 50-unit transfer planned as 40 + 10 left the third lot
 * unscannable — and because that lot was the one packed main-carton → inner box
 * → unit, it read as "nested packaging cannot be scanned" when in truth nothing
 * about the nesting was involved.
 *
 * These fix the lots on the operator's shelf to exactly the ones in the report
 * (one unboxed, one nested, one flat) and cover both the widening and the rules
 * that must survive it.
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
const shipmentService = require("../services/shipmentService");
const scanSvc = require("../services/dispatchScanService");
const notificationService = require("../services/notificationService");

let companyId, srcWh, otherWh, destWh, productId, otherProductId;

beforeEach(() => {
  jest.spyOn(notificationService, "notifyWarehouseTeam").mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `mlot-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  srcWh = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  otherWh = await Warehouse.create({ companyId, name: "Indore", code: "IND" });
  destWh = await Warehouse.create({ companyId, name: "Dest", code: "WH2" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
  otherProductId = (await Product.create({ companyId, productName: "xyz" }))._id;
});

/* ---- the operator's own lot-number format, part by part ---------------- */

const V = (key, value) => ({ key, type: "value", value });
const R = (key, prefix, digits = 3) => ({ key, type: "range", mode: "variable", prefix, digits });
const DATE = [V("batch", "BAT"), V("year", "2026"), V("month", "08"), V("date", "01")];
const HEAD = [V("company", "BHO"), V("product", "PRO")];

/**
 * A received, labelled lot sitting on a warehouse shelf.
 *
 * `tag` adds one more value part to the number. A composed lot number is claimed
 * in the LotNumber registry and must be genuinely unique, so two lots built from
 * the same parts — the second copy of a shape, for another product or another
 * warehouse — need something to tell them apart.
 */
async function makeLot({
  segments, qty, boxes, perBox, mainBoxes, boxesPerMain,
  productId: pid, warehouseId, expiryDate, tag,
} = {}) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId: pid || productId,
    warehouseId: warehouseId || srcWh._id, qty,
    lotOrigin: "company", pendingReceipt: true, expiryDate,
    lotSegments: tag ? [...segments, V("other", tag)] : segments,
    ...(boxes ? { hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox } : {}),
    ...(mainBoxes ? { mainBoxes, boxesPerMain } : {}),
  });
  await Inventory.updateOne(
    { _id: inv._id },
    { $set: { inTransitStock: 0, offlineStock: qty, availableStock: qty } }
  );
  await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { status: "received", received_at: new Date() } });
  await barcodeService.generateUnits(companyId, inv._id, qty, {});
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

/** LOT 1 — one package, 40 units, no boxes at all. */
const unboxedLot = (o = {}) => makeLot({
  qty: 40, segments: [...HEAD, ...DATE, V("other", "LOT"), R("sku", "SKU")], ...o,
});
/** LOT 2 — NESTED: 2 main cartons × 2 inner boxes × 5 units. */
const nestedLot = (o = {}) => makeLot({
  qty: 20, boxes: 4, perBox: 5, mainBoxes: 2, boxesPerMain: 2,
  segments: [...HEAD, R("bulk", "BP"), R("inner", "INNER"), ...DATE, R("sku", "SKU")], ...o,
});
/** LOT 3 — FLAT: 3 boxes × 20 units, no inner level. */
const flatLot = (o = {}) => makeLot({
  qty: 60, boxes: 3, perBox: 20,
  segments: [...HEAD, R("bulk", "BP"), ...DATE, R("sku", "SKU")], ...o,
});

/**
 * The whole shelf, exactly as the report describes it.
 *
 * Expiry dates are set DELIBERATELY so the earliest-expiry plan is decided by
 * them and nothing else: the unboxed lot goes first, then the flat one, and
 * together they cover any transfer of 100 or fewer — so the NESTED lot is never
 * allocated, which is the situation every test below is about. Left undated, the
 * plan fell back to whatever order the index happened to return the tied rows
 * in, which is a lot number away from changing.
 */
async function threeLots() {
  const lot1 = await unboxedLot({ expiryDate: new Date("2027-01-01") });
  const lot3 = await flatLot({ expiryDate: new Date("2027-02-01") });
  const lot2 = await nestedLot({ expiryDate: new Date("2027-12-01") });
  return { lot1, lot2, lot3 };
}

/** What the New Shipment form posts: a product and a quantity, nothing else. */
const transferOf = (qty, pid) =>
  shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", fromWarehouseId: srcWh._id,
    toWarehouseId: destWh._id, toLabel: "Warehouse transfer",
    lines: [{ productId: pid || productId, qty }],
  });

const scan = (ship, code, selectedCodes = []) =>
  scanSvc.resolveDispatchScan(companyId, ship._id, { code, selectedCodes });

const boxOf = (lot, level, boxSerial) =>
  BulkPackage.findOne({ lot_id: lot._id, box_level: level, box_serial: boxSerial });

const idOf = async (...args) => (await boxOf(...args)).bulk_packaging_id;

/** Which lots the earliest-expiry plan actually named. */
const plannedLotIds = (ship) => (ship.lines || []).map((l) => String(l.inventoryId));

describe("a lot the plan never allocated is still scannable", () => {
  test("the FEFO plan really does leave one of the three lots out", async () => {
    const { lot1, lot2, lot3 } = await threeLots();
    const ship = await transferOf(50);
    // The premise of the whole bug: 50 units are covered by the two
    // earliest-expiry lots without ever naming the nested one, so nothing about
    // it appears on the shipment.
    expect(plannedLotIds(ship)).toEqual([String(lot1._id), String(lot3._id)]);
    expect(plannedLotIds(ship)).not.toContain(String(lot2._id));
  });

  test("MAIN carton of that lot adds all 10 units across its two inner boxes", async () => {
    const { lot2 } = await threeLots();
    const ship = await transferOf(50);

    const r = await scan(ship, await idOf(lot2, "main", 1));
    expect(r.addedQuantity).toBe(10);
    expect(r.boxLevel).toBe("main");
    expect(r.lotId).toBe(String(lot2._id));
    expect(r.remainingRequired).toBe(40);
  });

  test("INNER box of that lot adds only its own 5", async () => {
    const { lot2 } = await threeLots();
    const ship = await transferOf(50);

    const r = await scan(ship, await idOf(lot2, "inner", 1));
    expect(r.addedQuantity).toBe(5);
    expect(r.boxLevel).toBe("inner");
    expect(r.remainingRequired).toBe(45);
  });

  test("a UNIT of that lot adds one", async () => {
    const { lot2 } = await threeLots();
    const ship = await transferOf(50);
    const unit = await UnitSerial.findOne({ inventoryId: lot2._id });

    const r = await scan(ship, unit.serial);
    expect(r.addedQuantity).toBe(1);
    expect(r.scanType).toBe("unit");
  });

  test("an UNBOXED lot the plan skipped scans by its lot number", async () => {
    // The nested lot expires first, so a 20-unit transfer is covered by it
    // alone and the unboxed one is never named.
    const lot2 = await nestedLot({ expiryDate: new Date("2027-01-01") });
    // 20 units too, so the whole-lot rule ("all or nothing") is satisfied and
    // this test is about resolution, not about a partial lot.
    const lot1 = await unboxedLot({ qty: 20, expiryDate: new Date("2027-06-01") });
    const ship = await transferOf(20);
    expect(plannedLotIds(ship)).toEqual([String(lot2._id)]);
    expect(plannedLotIds(ship)).not.toContain(String(lot1._id));

    const r = await scan(ship, lot1.lotNumber);
    expect(r.addedQuantity).toBe(20);
    expect(r.lotId).toBe(String(lot1._id));
    expect(String(lot2._id)).not.toBe(r.lotId);
  });

  test("MIXED PICK: three lots, one transfer — the unboxed lot then the nested cartons", async () => {
    const { lot1, lot2 } = await threeLots();
    const ship = await transferOf(50);
    let selected = [];

    const whole = await scan(ship, lot1.lotNumber, selected);
    expect(whole.addedQuantity).toBe(40);
    selected = [...selected, ...whole.addedUnitCodes];

    const carton = await scan(ship, await idOf(lot2, "main", 1), selected);
    expect(carton.addedQuantity).toBe(10);
    selected = [...selected, ...carton.addedUnitCodes];

    expect(selected).toHaveLength(50);
    expect(carton.remainingRequired).toBe(0);
  });
});

describe("what the widening must NOT let through", () => {
  test("WRONG PRODUCT: another product's carton on the same shelf is refused", async () => {
    await threeLots();
    const other = await flatLot({ productId: otherProductId, tag: "XYZ" });
    const ship = await transferOf(50);

    await expect(scan(ship, await idOf(other, "main", 1))).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("is not on shipment"),
    });
  });

  test("WRONG WAREHOUSE: the same product's carton at another warehouse is refused", async () => {
    await threeLots();
    const elsewhere = await nestedLot({ warehouseId: otherWh._id, tag: "IND" });
    const ship = await transferOf(50);

    await expect(scan(ship, await idOf(elsewhere, "main", 1))).rejects.toMatchObject({ status: 409 });
  });

  test("OVER-PICK: a carton is refused once the required quantity is covered", async () => {
    const { lot1, lot2 } = await threeLots();
    const ship = await transferOf(45);

    const whole = await scan(ship, lot1.lotNumber);
    expect(whole.addedQuantity).toBe(40);

    // 5 still required, but a main carton holds 10 — all or nothing.
    await expect(scan(ship, await idOf(lot2, "main", 1), whole.addedUnitCodes))
      .rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("needs 5 of 10 units"),
      });

    // Its inner box holds exactly 5, so that one goes.
    const inner = await scan(ship, await idOf(lot2, "inner", 1), whole.addedUnitCodes);
    expect(inner.addedQuantity).toBe(5);
    expect(inner.remainingRequired).toBe(0);
  });

  test("NOTHING LEFT: a further carton is refused once every unit is scanned", async () => {
    const { lot1, lot2 } = await threeLots();
    const ship = await transferOf(50);

    const whole = await scan(ship, lot1.lotNumber);
    const carton = await scan(ship, await idOf(lot2, "main", 1), whole.addedUnitCodes);
    const selected = [...whole.addedUnitCodes, ...carton.addedUnitCodes];

    await expect(scan(ship, await idOf(lot2, "main", 2), selected)).rejects.toMatchObject({
      status: 409,
      message: scanSvc.MSG.nothingLeft,
    });
  });
});

describe("the nested rules, on a lot the plan never named", () => {
  test("DOUBLE COUNT: inner box first, then its parent carton — the parent adds only the other 5", async () => {
    const { lot2 } = await threeLots();
    const ship = await transferOf(50);

    const inner = await scan(ship, await idOf(lot2, "inner", 1));
    expect(inner.addedQuantity).toBe(5);

    const parent = await scan(ship, await idOf(lot2, "main", 1), inner.addedUnitCodes);
    expect(parent.addedQuantity).toBe(5);
    expect(parent.skippedQuantity).toBe(5);
    // The five already in hand are counted once, not twice.
    expect(parent.scannedQuantity).toBe(10);
    // …and nothing is reported as unavailable — they are picked, not missing.
    expect(parent.unavailableQuantity).toBe(0);
  });

  test("PARTIAL BOX: unavailable units are skipped and reported, not silently dropped", async () => {
    const { lot2 } = await threeLots();
    const ship = await transferOf(50);

    // Two units of the first main carton have already gone out.
    const gone = await UnitSerial.find({ bulk_packaging_record_id: (await boxOf(lot2, "inner", 1))._id })
      .limit(2);
    await UnitSerial.updateMany({ _id: { $in: gone.map((u) => u._id) } }, { $set: { status: "shipped" } });

    const r = await scan(ship, await idOf(lot2, "main", 1));
    // "Added 8 of 10 — 2 units unavailable" is rendered from exactly these.
    expect(r.addedQuantity).toBe(8);
    expect(r.boxUnitTotal).toBe(10);
    expect(r.unavailableQuantity).toBe(2);
  });

  test("a repeat scan of the same carton is refused as a duplicate", async () => {
    const { lot2 } = await threeLots();
    const ship = await transferOf(50);
    const code = await idOf(lot2, "main", 1);

    const first = await scan(ship, code);
    await expect(scan(ship, code, first.addedUnitCodes)).rejects.toMatchObject({
      status: 409,
      message: scanSvc.MSG.duplicate(code),
    });
  });
});

describe("the dispatch guard follows the goods, not the plan", () => {
  test("a scan drawn from an unplanned lot is accepted and reported per lot", async () => {
    const { lot1, lot2 } = await threeLots();
    const ship = await transferOf(50);

    const whole = await scan(ship, lot1.lotNumber);
    const carton = await scan(ship, await idOf(lot2, "main", 1), whole.addedUnitCodes);
    const scanned = [...whole.addedUnitCodes, ...carton.addedUnitCodes];

    const shipDoc = await require("../model/Transport/Shipment").findById(ship._id);
    const verified = await scanSvc.assertDispatchScanned(companyId, shipDoc, scanned);

    expect(verified.count).toBe(50);
    const byLot = Object.fromEntries(verified.byLot.map((l) => [String(l.inventoryId), l.qty]));
    expect(byLot[String(lot1._id)]).toBe(40);
    // The lot the plan never named is where 10 of the units actually came from.
    expect(byLot[String(lot2._id)]).toBe(10);
  });

  test("an incomplete scan is still refused", async () => {
    const { lot2 } = await threeLots();
    const ship = await transferOf(50);

    const carton = await scan(ship, await idOf(lot2, "main", 1));
    const shipDoc = await require("../model/Transport/Shipment").findById(ship._id);

    await expect(scanSvc.assertDispatchScanned(companyId, shipDoc, carton.addedUnitCodes))
      .rejects.toMatchObject({ status: 409, message: scanSvc.MSG.incomplete(10, 50) });
  });
});
