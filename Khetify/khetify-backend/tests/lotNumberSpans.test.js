/**
 * THE SPANS OF A COMPOSED / GENERATED LOT NUMBER.
 *
 * A three-level lot's number disagreed with the number the Create Lot modal had
 * just previewed. The two derived their spans independently, and the server's
 * derivation was wrong twice over: it passed the INNER box count as the Bulk
 * Packaging span, and passed no inner span at all — so 2 cartons × 2 boxes × 5
 * units was stored as
 *
 *   BHO-PRO-BP001~BP004-BAT-2026-08-01-SKU001~SKU020      (four cartons, no inner part)
 *
 * where the operator had been shown, and the cartons are actually labelled,
 *
 *   BHO-PRO-BP001~BP002-INNER001~INNER002-BAT-2026-08-01-SKU001~SKU020
 *
 * Both sides now read packagingSpans. These pin the resulting strings, the
 * shapes that must NOT change (single package, flat bulk packaging), and the
 * fact that the browser's copy of the rule still answers exactly as this one
 * does — the one thing that could let them drift apart again.
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const lotService = require("../services/lotService");
const barcodeService = require("../services/barcodeService");
const bulkPackageService = require("../services/bulkPackageService");
const shipmentService = require("../services/shipmentService");
const dispatchScanService = require("../services/dispatchScanService");
const notificationService = require("../services/notificationService");
const { packagingSpans } = require("../services/lotNumberSegmentService");

beforeEach(() => {
  jest.spyOn(notificationService, "notifyWarehouseTeam").mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

let companyId, warehouseId, productId;

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `spans-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  warehouseId = (await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" }))._id;
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

const V = (key, value) => ({ key, type: "value", value });
const R = (key, prefix, digits = 3) => ({ key, type: "range", mode: "variable", prefix, digits });
const DATE = [V("batch", "BAT"), V("year", "2026"), V("month", "08"), V("date", "01")];
const HEAD = [V("company", "BHO"), V("product", "PRO")];

/** Create a lot exactly as the Create Lot modal posts it. */
const createLot = ({ segments, qty, boxes, perBox, mainBoxes, boxesPerMain }) =>
  lotService.receiveLot({
    ownerId: companyId, productId, warehouseId, qty,
    lotOrigin: "company", pendingReceipt: true, lotSegments: segments,
    ...(boxes ? { hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox } : {}),
    ...(mainBoxes ? { mainBoxes, boxesPerMain } : {}),
  });

/* ------------------------------------------------- the composed lot number */

describe("a COMPOSED number states each level's real span", () => {
  test("THREE LEVELS: 2 cartons × 2 inner boxes × 5 units", async () => {
    const inv = await createLot({
      qty: 20, boxes: 4, perBox: 5, mainBoxes: 2, boxesPerMain: 2,
      segments: [...HEAD, R("bulk", "BP"), R("inner", "INNER"), ...DATE, R("sku", "SKU")],
    });

    // Bulk spans the CARTONS (2), inner spans the boxes inside ONE of them (2).
    expect(inv.lotNumber).toBe("BHO-PRO-BP001~BP002-INNER001~INNER002-BAT-2026-08-01-SKU001~SKU020");
    expect(inv.batchNumber).toBe(inv.lotNumber);
  });

  test("FLAT BULK PACKAGING keeps its shape, and grows no INNER part", async () => {
    const inv = await createLot({
      qty: 60, boxes: 3, perBox: 20,
      segments: [...HEAD, R("bulk", "BP"), ...DATE, R("sku", "SKU")],
    });

    expect(inv.lotNumber).toBe("BHO-PRO-BP001~BP003-BAT-2026-08-01-SKU001~SKU060");
    expect(inv.lotNumber).not.toContain("INNER");
  });

  test("a ticked Inner Box part renders as nothing on a lot that has no inner level", async () => {
    const inv = await createLot({
      qty: 60, boxes: 3, perBox: 20,
      segments: [...HEAD, R("bulk", "BP"), R("inner", "INNER"), ...DATE, R("sku", "SKU")],
    });

    expect(inv.lotNumber).toBe("BHO-PRO-BP001~BP003-BAT-2026-08-01-SKU001~SKU060");
  });

  test("SINGLE PACKAGE (no boxes at all) keeps its shape", async () => {
    const inv = await createLot({
      qty: 40,
      segments: [...HEAD, ...DATE, V("other", "LOT"), R("sku", "SKU")],
    });

    expect(inv.lotNumber).toBe("BHO-PRO-BAT-2026-08-01-LOT-SKU001~SKU040");
  });

  test("packaging counts that do not multiply out are NOT read as three-level", async () => {
    // 3 × 2 ≠ 4, so the grouping is refused and the lot is a plain 4-box one.
    const inv = await createLot({
      qty: 20, boxes: 4, perBox: 5, mainBoxes: 3, boxesPerMain: 2,
      segments: [...HEAD, R("bulk", "BP"), R("inner", "INNER"), ...DATE, R("sku", "SKU")],
    });

    expect(inv.lotNumber).toBe("BHO-PRO-BP001~BP004-BAT-2026-08-01-SKU001~SKU020");
  });
});

/* -------------------------------------------- the Khetify-generated number */

describe("a GENERATED number spans the same levels", () => {
  test("THREE LEVELS: the inner range covers one carton's boxes, not the lot's", async () => {
    const inv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId, qty: 20,
      lotOrigin: "company", pendingReceipt: true,
      hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 5,
      mainBoxes: 2, boxesPerMain: 2,
    });

    expect(inv.lotNumber).toContain("-BP01~BP02-");
    expect(inv.lotNumber).toContain("-BPinner01~BPinner02-");
  });
});

/* ------------------------------------ nothing below the lot number moved */

describe("box and unit IDs carry the lot's own serial", () => {
  /**
   * The assertions below used to end at the date. A composed lot now closes
   * every DERIVED id with its lot serial, exactly as a Khetify-generated one
   * always has — which is what keeps two lots built from the same parts apart
   * (see lotDuplicateMessages). The LOT NUMBER is unchanged and still carries no
   * serial; only the ids beneath it gained one.
   */
  test("the cartons, inner boxes and units of a three-level lot", async () => {
    const inv = await createLot({
      qty: 20, boxes: 4, perBox: 5, mainBoxes: 2, boxesPerMain: 2,
      segments: [...HEAD, R("bulk", "BP"), R("inner", "INNER"), ...DATE, R("sku", "SKU")],
    });
    await barcodeService.generateUnits(companyId, inv._id, 20, {});

    // The operator's format, in full, with nothing appended.
    expect(inv.lotNumber).toBe("BHO-PRO-BP001~BP002-INNER001~INNER002-BAT-2026-08-01-SKU001~SKU020");
    const s = String(inv.lot_number_serial).padStart(4, "0");

    const mains = await BulkPackage.find({ lot_id: inv._id, box_level: "main" }).sort({ box_serial: 1 });
    expect(mains.map((b) => b.bulk_packaging_id)).toEqual([
      `BHO-PRO-BP001-INNER001~INNER002-BAT-2026-08-01-${s}`,
      `BHO-PRO-BP002-INNER001~INNER002-BAT-2026-08-01-${s}`,
    ]);

    const inners = await BulkPackage.find({ lot_id: inv._id, box_level: "inner" }).sort({ box_serial: 1 });
    expect(inners.map((b) => b.bulk_packaging_id)).toEqual([
      `BHO-PRO-BP001-INNER001-BAT-2026-08-01-${s}`,
      `BHO-PRO-BP001-INNER002-BAT-2026-08-01-${s}`,
      `BHO-PRO-BP002-INNER001-BAT-2026-08-01-${s}`,
      `BHO-PRO-BP002-INNER002-BAT-2026-08-01-${s}`,
    ]);

    const first = await UnitSerial.findOne({ inventoryId: inv._id }).sort({ unit_serial: 1 });
    expect(first.serial).toBe(`BHO-PRO-BP001-INNER001-BAT-2026-08-01-SKU001-${s}`);
    expect(await UnitSerial.countDocuments({ inventoryId: inv._id })).toBe(20);
  });
});

/* --------------------------------------------- OLD LOTS ARE LEFT ALONE */

describe("lots minted before the fix", () => {
  test("keep their number, and are still found by it", async () => {
    // A lot stored in the old, wrong shape — the bulk range over the INNER
    // boxes and no inner part at all. Written straight to the collection, which
    // is exactly how it sits in the database today.
    const legacy = await Inventory.create({
      productId, ownerType: "company", ownerId: companyId, warehouseId,
      lotNumber: "BHO-PRO-BP001~BP004-BAT-2026-08-01-SKU001~SKU020",
      batchNumber: "BHO-PRO-BP001~BP004-BAT-2026-08-01-SKU001~SKU020",
      availableStock: 20, offlineStock: 20,
    });

    const found = await Inventory.findOne({
      ownerId: companyId,
      lotNumber: "BHO-PRO-BP001~BP004-BAT-2026-08-01-SKU001~SKU020",
    });
    expect(String(found._id)).toBe(String(legacy._id));
    // Nothing rewrites it: the number is printed on the cartons.
    expect(found.lotNumber).toBe("BHO-PRO-BP001~BP004-BAT-2026-08-01-SKU001~SKU020");
  });

  test("a NEW lot may take the shape an OLD one no longer produces", async () => {
    // The old number is registered; the new rule mints a different string for
    // the same packaging, so the two coexist rather than collide.
    await Inventory.create({
      productId, ownerType: "company", ownerId: companyId, warehouseId,
      lotNumber: "BHO-PRO-BP001~BP004-BAT-2026-08-01-SKU001~SKU020",
      batchNumber: "BHO-PRO-BP001~BP004-BAT-2026-08-01-SKU001~SKU020",
      availableStock: 20, offlineStock: 20,
    });

    const fresh = await createLot({
      qty: 20, boxes: 4, perBox: 5, mainBoxes: 2, boxesPerMain: 2,
      segments: [...HEAD, R("bulk", "BP"), R("inner", "INNER"), ...DATE, R("sku", "SKU")],
    });
    expect(fresh.lotNumber).toBe("BHO-PRO-BP001~BP002-INNER001~INNER002-BAT-2026-08-01-SKU001~SKU020");
  });
});

/* --------------------------------- a new-format lot scans, end to end */

describe("the new number resolves in both scan flows", () => {
  test("RECEIVING: a carton of a new-format lot is found and booked in", async () => {
    const inv = await createLot({
      qty: 20, boxes: 4, perBox: 5, mainBoxes: 2, boxesPerMain: 2,
      segments: [...HEAD, R("bulk", "BP"), R("inner", "INNER"), ...DATE, R("sku", "SKU")],
    });
    await Inventory.updateOne(
      { _id: inv._id },
      { $set: { inTransitStock: 20, offlineStock: 0, availableStock: 0 } }
    );
    await barcodeService.generateUnits(companyId, inv._id, 20, {});

    const main = await BulkPackage.findOne({ lot_id: inv._id, box_level: "main", box_serial: 1 });
    const incoming = await bulkPackageService.findIncomingBox(companyId, main.bulk_packaging_id);
    // Whatever the stored ID is, the scan resolves it whole — never parsed.
    expect(incoming.bulkPackagingId).toBe(main.bulk_packaging_id);
    expect(incoming.bulkPackagingId).toMatch(/^BHO-PRO-BP001-INNER001~INNER002-BAT-2026-08-01-\d{4}$/);
    expect(incoming.unitsInBox).toBe(10);

    const received = await bulkPackageService.receiveBox(companyId, main.bulk_packaging_id, {});
    expect(received.receivedUnits).toBe(10);
    // The carton's own two inner boxes came in with it.
    expect(await BulkPackage.countDocuments({ lot_id: inv._id, status: "received" })).toBe(3);
  });

  test("DISPATCH: the lot number, a carton and an inner box all resolve", async () => {
    const inv = await createLot({
      qty: 20, boxes: 4, perBox: 5, mainBoxes: 2, boxesPerMain: 2,
      segments: [...HEAD, R("bulk", "BP"), R("inner", "INNER"), ...DATE, R("sku", "SKU")],
    });
    await Inventory.updateOne(
      { _id: inv._id },
      { $set: { inTransitStock: 0, offlineStock: 20, availableStock: 20 } }
    );
    await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { status: "received" } });
    await barcodeService.generateUnits(companyId, inv._id, 20, {});
    await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });

    const destWh = await Warehouse.create({ companyId, name: "Dest", code: "WH2" });
    const ship = await shipmentService.createShipment(companyId, {
      refType: "Transfer", toType: "warehouse", fromWarehouseId: warehouseId,
      toWarehouseId: destWh._id, toLabel: "Dest",
      lines: [{ inventoryId: inv._id, qty: 20 }],
    });
    const scan = (code, selectedCodes = []) =>
      dispatchScanService.resolveDispatchScan(companyId, ship._id, { code, selectedCodes });

    const main = await BulkPackage.findOne({ lot_id: inv._id, box_level: "main", box_serial: 1 });
    const carton = await scan(main.bulk_packaging_id);
    expect(carton.addedQuantity).toBe(10);
    expect(carton.boxLevel).toBe("main");
    // The number the dialog shows against the row is the new one.
    expect(carton.lotNumber).toBe("BHO-PRO-BP001~BP002-INNER001~INNER002-BAT-2026-08-01-SKU001~SKU020");

    const inner = await BulkPackage.findOne({ lot_id: inv._id, box_level: "inner", box_serial: 3 });
    const box = await scan(inner.bulk_packaging_id, carton.addedUnitCodes);
    expect(box.addedQuantity).toBe(5);
    expect(box.boxLevel).toBe("inner");
  });

  test("a lot stored in the OLD shape still scans out unchanged", async () => {
    // Built by today's code, then its number forced back to the shape the bug
    // produced — the boxes and units keep the IDs they were minted with, which
    // is exactly the state a pre-fix lot is in.
    const inv = await createLot({
      qty: 20, boxes: 4, perBox: 5, mainBoxes: 2, boxesPerMain: 2,
      segments: [...HEAD, R("bulk", "BP"), R("inner", "INNER"), ...DATE, R("sku", "SKU")],
    });
    const OLD = "BHO-PRO-BP001~BP004-BAT-2026-08-01-SKU001~SKU020";
    await Inventory.updateOne(
      { _id: inv._id },
      { $set: { lotNumber: OLD, batchNumber: OLD, inTransitStock: 0, offlineStock: 20, availableStock: 20 } }
    );
    await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { status: "received", lot_number: OLD } });
    await barcodeService.generateUnits(companyId, inv._id, 20, {});
    await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });

    const destWh = await Warehouse.create({ companyId, name: "Dest", code: "WH3" });
    const ship = await shipmentService.createShipment(companyId, {
      refType: "Transfer", toType: "warehouse", fromWarehouseId: warehouseId,
      toWarehouseId: destWh._id, toLabel: "Dest",
      lines: [{ inventoryId: inv._id, qty: 20 }],
    });

    // Scanned by the OLD lot number printed on its label…
    await expect(
      dispatchScanService.resolveDispatchScan(companyId, ship._id, { code: OLD })
    ).rejects.toThrow(/packed into boxes/);   // …which is the boxed-lot rule, not a resolution failure

    const main = await BulkPackage.findOne({ lot_id: inv._id, box_level: "main", box_serial: 1 });
    const r = await dispatchScanService.resolveDispatchScan(companyId, ship._id, {
      code: main.bulk_packaging_id,
    });
    expect(r.addedQuantity).toBe(10);
    expect(r.lotNumber).toBe(OLD);
  });
});

/* ------------------------------- the browser's copy of the rule agrees */

describe("packagingSpans", () => {
  const CASES = [
    ["three-level", { qty: 20, numberOfBoxes: 4, mainBoxes: 2, boxesPerMain: 2 }, { boxCount: 2, innerCount: 2, unitCount: 20 }],
    ["flat bulk", { qty: 60, numberOfBoxes: 3 }, { boxCount: 3, innerCount: 0, unitCount: 60 }],
    ["single package", { qty: 40, numberOfBoxes: 0 }, { boxCount: 0, innerCount: 0, unitCount: 40 }],
    ["counts that disagree", { qty: 20, numberOfBoxes: 4, mainBoxes: 3, boxesPerMain: 2 }, { boxCount: 4, innerCount: 0, unitCount: 20 }],
    ["one carton", { qty: 10, numberOfBoxes: 2, mainBoxes: 1, boxesPerMain: 2 }, { boxCount: 1, innerCount: 2, unitCount: 10 }],
    ["strings from a form post", { qty: "20", numberOfBoxes: "4", mainBoxes: "2", boxesPerMain: "2" }, { boxCount: 2, innerCount: 2, unitCount: 20 }],
    ["nothing entered", {}, { boxCount: 0, innerCount: 0, unitCount: 0 }],
  ];

  test.each(CASES)("%s", (_name, input, expected) => {
    expect(packagingSpans(input)).toEqual(expected);
  });

  /**
   * THE BROWSER'S COPY, answering the same questions. The modal runs in a Vite
   * ESM bundle and the server in CommonJS, so the rule is written once per side
   * rather than imported; this is what stops the two copies drifting. The file
   * is tiny and dependency-free, so evaluating it here is enough to run it.
   */
  test("the Create Lot modal's copy of the rule gives identical answers", () => {
    const src = fs
      .readFileSync(path.join(__dirname, "../../khetifyApp/src/lib/lotNumberSpans.js"), "utf8")
      .replace(/^export default .*$/m, "")   // drop the default re-export
      .replace(/^export /gm, "");            // `export function f` → `function f`
    // eslint-disable-next-line no-new-func
    const browserCopy = new Function(`${src}\nreturn packagingSpans;`)();

    expect(typeof browserCopy).toBe("function");
    for (const [, input, expected] of CASES) {
      expect(browserCopy(input)).toEqual(expected);
    }
  });
});
