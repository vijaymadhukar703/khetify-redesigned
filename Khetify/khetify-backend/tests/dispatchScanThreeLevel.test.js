/**
 * SCAN-OUT ON A THREE-LEVEL LOT — Lot → Main box → Inner box → Unit.
 *
 * The scan-out dialog resolved an INNER box but not a MAIN one: a main carton
 * owns no unit rows (its units hang off the inner boxes inside it), so the
 * lookup by `bulk_packaging_record_id: box._id` came back empty and the scan was
 * refused. It also upper-cased every code before querying, which no unit of a
 * three-level lot matches — their serials spell the segment "BPinner".
 *
 * These cover all four levels, the double-count / partial-box / over-pick rules,
 * and a transfer that draws on TWO lots of the same product.
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

let companyId, srcWh, destWh, productId, otherProductId;

beforeEach(() => {
  jest.spyOn(notificationService, "notifyWarehouseTeam").mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `d3-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  srcWh = await Warehouse.create({ companyId, name: "Source", code: "WH1" });
  destWh = await Warehouse.create({ companyId, name: "Dest", code: "WH2" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
  otherProductId = (await Product.create({ companyId, productName: "xyz" }))._id;
});

/**
 * A received, labelled lot on the source shelf.
 * `mainBoxes` makes it three-level (main × inner × units).
 */
async function makeLot({ qty, boxes, perBox, mainBoxes, productId: pid, warehouseId } = {}) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId: pid || productId,
    warehouseId: warehouseId || srcWh._id, qty,
    lotOrigin: "company", pendingReceipt: true,
    ...(boxes ? { hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox } : {}),
    ...(mainBoxes ? { mainBoxes, boxesPerMain: boxes / mainBoxes } : {}),
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

const makeTransfer = (lines) =>
  shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", fromWarehouseId: srcWh._id, toWarehouseId: destWh._id,
    toLabel: "Dest", lines,
  });

const scan = (ship, code, selectedCodes = []) =>
  scanSvc.resolveDispatchScan(companyId, ship._id, { code, selectedCodes });

const boxes = (lot, level) =>
  BulkPackage.find({ lot_id: lot._id, ...(level ? { box_level: level } : {}) }).sort({ box_serial: 1 });

/** The 3 × 3 × 10 lot from the report. */
const threeLevelLot = () => makeLot({ qty: 90, boxes: 9, perBox: 10, mainBoxes: 3 });

describe("BUG 1 — every level resolves", () => {
  test("a MAIN bulk packaging ID adds all 30 units across its 3 inner boxes", async () => {
    const lot = await threeLevelLot();
    const ship = await makeTransfer([{ inventoryId: lot._id, qty: 90 }]);
    const [main] = await boxes(lot, "main");

    const r = await scan(ship, main.bulk_packaging_id);
    expect(r.addedQuantity).toBe(30);
    expect(r.boxLevel).toBe("main");
    expect(r.bulkPackagingId).toBe(main.bulk_packaging_id);
    expect(r.remainingRequired).toBe(60);
  });

  test("an INNER bulk packaging ID adds only its own 10", async () => {
    const lot = await threeLevelLot();
    const ship = await makeTransfer([{ inventoryId: lot._id, qty: 90 }]);
    const [inner] = await boxes(lot, "inner");

    const r = await scan(ship, inner.bulk_packaging_id);
    expect(r.addedQuantity).toBe(10);
    expect(r.boxLevel).toBe("inner");
  });

  test("a UNIT code adds exactly one — its mixed-case serial is matched verbatim", async () => {
    const lot = await threeLevelLot();
    const ship = await makeTransfer([{ inventoryId: lot._id, qty: 90 }]);
    const unit = await UnitSerial.findOne({ inventoryId: lot._id });
    // The serial really does carry a mixed-case segment; that is the case an
    // upper-casing lookup used to miss.
    expect(unit.serial).toMatch(/BPinner/);

    const r = await scan(ship, unit.serial);
    expect(r.addedQuantity).toBe(1);
    expect(r.scanType).toBe("unit");
  });

  test("a LOT number adds the whole (unboxed) lot", async () => {
    const lot = await makeLot({ qty: 12 });
    const ship = await makeTransfer([{ inventoryId: lot._id, qty: 12 }]);
    const r = await scan(ship, lot.lotNumber);
    expect(r.addedQuantity).toBe(12);
    expect(r.scanType).toBe("lot");
  });

  test("three main boxes cover the whole 90-unit lot, and the dispatch guard accepts it", async () => {
    const lot = await threeLevelLot();
    const ship = await makeTransfer([{ inventoryId: lot._id, qty: 90 }]);
    const mains = await boxes(lot, "main");

    let picked = [];
    for (const m of mains) {
      const r = await scan(ship, m.bulk_packaging_id, picked);
      picked = [...picked, ...r.addedUnitCodes];
    }
    expect(picked).toHaveLength(90);

    // The write-path guard re-resolves every code — this is what refused a
    // three-level scan at the moment of dispatch.
    const ok = await scanSvc.assertDispatchScanned(companyId, ship, picked);
    expect(ok.count).toBe(90);
    // It also reports WHICH LOT each scanned unit came from — what dispatch now
    // deducts against instead of the planned allocation.
    expect(ok.byLot).toHaveLength(1);
    expect(String(ok.byLot[0].inventoryId)).toBe(String(lot._id));
    expect(ok.byLot[0].qty).toBe(90);
  });
});

describe("BUG 2 — one product, two lots on the same shipment", () => {
  test("after the first lot is fully scanned, the second lot's box still scans", async () => {
    const big = await makeLot({ qty: 90, boxes: 9, perBox: 10, mainBoxes: 3 });
    const small = await makeLot({ qty: 10, boxes: 1, perBox: 10 });
    // A 100-unit shipment of the same product, split across both lots.
    const ship = await makeTransfer([
      { inventoryId: big._id, qty: 90 },
      { inventoryId: small._id, qty: 10 },
    ]);

    let picked = [];
    for (const m of await boxes(big, "main")) {
      const r = await scan(ship, m.bulk_packaging_id, picked);
      picked = [...picked, ...r.addedUnitCodes];
    }
    expect(picked).toHaveLength(90);

    const [smallBox] = await boxes(small);
    const r = await scan(ship, smallBox.bulk_packaging_id, picked);
    expect(r.addedQuantity).toBe(10);
    expect(String(r.lotId)).toBe(String(small._id));
    expect(r.remainingRequired).toBe(0);

    const ok = await scanSvc.assertDispatchScanned(companyId, ship, [...picked, ...r.addedUnitCodes]);
    expect(ok.count).toBe(100);
  });
});

describe("the rules that must not break", () => {
  test("DOUBLE COUNT: inner box first, then its parent — the parent adds only the other 20", async () => {
    const lot = await threeLevelLot();
    const ship = await makeTransfer([{ inventoryId: lot._id, qty: 90 }]);
    const [main] = await boxes(lot, "main");
    const inner = (await boxes(lot, "inner")).find((b) => String(b.parent_box_id) === String(main._id));

    const first = await scan(ship, inner.bulk_packaging_id);
    expect(first.addedQuantity).toBe(10);

    const second = await scan(ship, main.bulk_packaging_id, first.addedUnitCodes);
    expect(second.addedQuantity).toBe(20);           // not 30
    expect(second.scannedQuantity).toBe(30);          // 10 + 20 counted once
    // No serial is handed out twice.
    expect(new Set([...first.addedUnitCodes, ...second.addedUnitCodes]).size).toBe(30);
  });

  test("PARTIAL BOX: unavailable units are skipped and reported, not silently dropped", async () => {
    const lot = await threeLevelLot();
    const ship = await makeTransfer([{ inventoryId: lot._id, qty: 90 }]);
    const [main] = await boxes(lot, "main");
    const inners = (await boxes(lot, "inner")).filter((b) => String(b.parent_box_id) === String(main._id));

    // 10 of this carton's 30 units are no longer dispatchable.
    await UnitSerial.updateMany(
      { bulk_packaging_record_id: inners[0]._id },
      { $set: { status: "damaged" } }
    );

    const r = await scan(ship, main.bulk_packaging_id);
    expect(r.addedQuantity).toBe(20);
    expect(r.boxUnitTotal).toBe(30);
    expect(r.unavailableQuantity).toBe(10);   // "Added 20 of 30 — 10 unavailable"
  });

  test("OVER-PICK: a 30-unit carton is refused when only 10 are still required, and says so", async () => {
    const lot = await threeLevelLot();
    // The shipment only wants 10 of the 90.
    const ship = await makeTransfer([{ inventoryId: lot._id, qty: 10 }]);
    const [main] = await boxes(lot, "main");

    await expect(scan(ship, main.bulk_packaging_id)).rejects.toThrow(
      /needs 10 of 30 units .* Scan the individual unit codes instead/
    );
    // …and the unit-by-unit route works, so the operator is never stuck.
    const unit = await UnitSerial.findOne({ inventoryId: lot._id });
    const r = await scan(ship, unit.serial);
    expect(r.addedQuantity).toBe(1);
  });

  test("WRONG PRODUCT: a carton of another product is refused, not ignored", async () => {
    const mine = await threeLevelLot();
    const theirs = await makeLot({ qty: 30, boxes: 3, perBox: 10, mainBoxes: 1, productId: otherProductId });
    const ship = await makeTransfer([{ inventoryId: mine._id, qty: 90 }]);
    const [otherMain] = await boxes(theirs, "main");

    await expect(scan(ship, otherMain.bulk_packaging_id)).rejects.toThrow(/is not on shipment/);
  });

  test("WRONG WAREHOUSE: a carton sitting at another warehouse is refused by name", async () => {
    const elsewhere = await Warehouse.create({ companyId, name: "Elsewhere", code: "WH9" });
    const away = await makeLot({ qty: 30, boxes: 3, perBox: 10, mainBoxes: 1, warehouseId: elsewhere._id });
    // Deliberately put the away lot on the shipment so the refusal must come
    // from the location check, not from "not on this shipment".
    const ship = await makeTransfer([{ inventoryId: away._id, qty: 30 }]);
    const [main] = await boxes(away, "main");

    await expect(scan(ship, main.bulk_packaging_id)).rejects.toThrow(/is currently at Elsewhere, not Source/);
  });

  test("an unknown code is refused as unknown", async () => {
    const lot = await threeLevelLot();
    const ship = await makeTransfer([{ inventoryId: lot._id, qty: 90 }]);
    await expect(scan(ship, "NO-SUCH-CODE")).rejects.toThrow(/Unknown code/);
  });
});
