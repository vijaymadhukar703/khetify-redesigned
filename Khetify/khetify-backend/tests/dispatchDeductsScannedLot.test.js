/**
 * DISPATCH DEDUCTS THE LOT THAT WAS SCANNED — not the lot the plan guessed.
 *
 * The reported case, exactly: one product, two lots at Bhopal —
 *   Lot A: 100 units (2 bulk boxes × 50)
 *   Lot B:  10 units
 * The operator scans BOTH of A's bulk packaging IDs (100) and 4 unit codes from
 * B, then dispatches.
 *
 * The shipment's lines are an ALLOCATION made when the transfer was raised
 * (earliest expiry first), so they read B:10 + A:94. Deduction ran off those
 * lines, which emptied B and left 6 in A — precisely inverted. Dispatch now
 * rewrites the lines from the verified scan first.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const Shipment = require("../model/Transport/Shipment");
const lotService = require("../services/lotService");
const barcodeService = require("../services/barcodeService");
const shipmentService = require("../services/shipmentService");
const scanSvc = require("../services/dispatchScanService");
const notificationService = require("../services/notificationService");

let companyId, srcWh, destWh, productId;

beforeEach(() => {
  jest.spyOn(notificationService, "notifyWarehouseTeam").mockResolvedValue();
  jest.spyOn(notificationService, "notifyAdmin").mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `dl-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  srcWh = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  destWh = await Warehouse.create({ companyId, name: "Indore", code: "IND" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

async function makeLot({ qty, boxes, perBox, expiresInDays }) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: srcWh._id, qty,
    lotOrigin: "company", pendingReceipt: true,
    expiryDate: new Date(Date.now() + expiresInDays * 86400000),
    ...(boxes ? { hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox } : {}),
  });
  await Inventory.updateOne({ _id: inv._id }, { $set: { inTransitStock: 0, offlineStock: qty, availableStock: qty } });
  await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { status: "received" } });
  await barcodeService.generateUnits(companyId, inv._id, qty, {});
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

test("100 from lot A + 4 from lot B leaves A=0 and B=6 — the scanned lots, not the planned ones", async () => {
  // B expires FIRST, so a plan built by expiry would put B on the shipment first.
  const lotA = await makeLot({ qty: 100, boxes: 2, perBox: 50, expiresInDays: 300 });
  const lotB = await makeLot({ qty: 10, expiresInDays: 30 });

  // The shipment as PLANNED: 104 units of the product, FEFO-allocated.
  const ship = await shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", toLabel: "Indore",
    fromWarehouseId: srcWh._id, toWarehouseId: destWh._id,
    lines: [{ productId, qty: 104 }],
  });
  // Proof the plan really is the inverted split that caused the bug.
  const planned = Object.fromEntries(ship.lines.map((l) => [String(l.inventoryId), l.qty]));
  expect(planned[String(lotB._id)]).toBe(10);
  expect(planned[String(lotA._id)]).toBe(94);

  // WHAT THE OPERATOR ACTUALLY SCANS: both of A's cartons, then 4 units of B.
  let scanned = [];
  for (const box of await BulkPackage.find({ lot_id: lotA._id }).sort({ box_serial: 1 })) {
    const r = await scanSvc.resolveDispatchScan(companyId, ship._id, {
      code: box.bulk_packaging_id, selectedCodes: scanned,
    });
    scanned = [...scanned, ...r.addedUnitCodes];
  }
  expect(scanned).toHaveLength(100);

  const fromB = await UnitSerial.find({ inventoryId: lotB._id }).limit(4).lean();
  for (const u of fromB) {
    const r = await scanSvc.resolveDispatchScan(companyId, ship._id, { code: u.serial, selectedCodes: scanned });
    scanned = [...scanned, ...r.addedUnitCodes];
  }
  expect(scanned).toHaveLength(104);

  await shipmentService.dispatchShipment(companyId, ship._id, { scannedCodes: scanned });

  // THE BUG: this used to read A=6, B=0.
  expect((await Inventory.findById(lotA._id)).availableStock).toBe(0);
  expect((await Inventory.findById(lotB._id)).availableStock).toBe(6);

  // The lines now describe what physically left, so the receiving end gets it right too.
  const after = await Shipment.findById(ship._id).lean();
  const shipped = Object.fromEntries(after.lines.map((l) => [String(l.inventoryId), l.qty]));
  expect(shipped[String(lotA._id)]).toBe(100);
  expect(shipped[String(lotB._id)]).toBe(4);
});

test("exactly the scanned unit codes leave the source — the rest stay in stock", async () => {
  const lotA = await makeLot({ qty: 100, boxes: 2, perBox: 50, expiresInDays: 300 });
  const lotB = await makeLot({ qty: 10, expiresInDays: 30 });
  const ship = await shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", toLabel: "Indore",
    fromWarehouseId: srcWh._id, toWarehouseId: destWh._id,
    lines: [{ productId, qty: 104 }],
  });

  let scanned = [];
  for (const box of await BulkPackage.find({ lot_id: lotA._id }).sort({ box_serial: 1 })) {
    const r = await scanSvc.resolveDispatchScan(companyId, ship._id, { code: box.bulk_packaging_id, selectedCodes: scanned });
    scanned = [...scanned, ...r.addedUnitCodes];
  }
  const fromB = await UnitSerial.find({ inventoryId: lotB._id }).limit(4).lean();
  for (const u of fromB) {
    const r = await scanSvc.resolveDispatchScan(companyId, ship._id, { code: u.serial, selectedCodes: scanned });
    scanned = [...scanned, ...r.addedUnitCodes];
  }
  await shipmentService.dispatchShipment(companyId, ship._id, { scannedCodes: scanned });

  // Every scanned code — and only those — is now shipped.
  const shippedNow = await UnitSerial.find({ serial: { $in: scanned } }).lean();
  expect(shippedNow.every((u) => u.status === "shipped")).toBe(true);

  // Lot B keeps its other 6 units in stock, and they are the ones NOT scanned.
  const bLeft = await UnitSerial.find({ inventoryId: lotB._id, status: "in_stock" }).lean();
  expect(bLeft).toHaveLength(6);
  expect(bLeft.some((u) => scanned.includes(u.serial))) .toBe(false);

  // Lot A has nothing left at this warehouse.
  expect(await UnitSerial.countDocuments({ inventoryId: lotA._id, status: "in_stock" })).toBe(0);
});

test("a dispatch with no scan keeps the old quantity-only behaviour", async () => {
  const lot = await makeLot({ qty: 20, expiresInDays: 100 });
  const ship = await shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", toLabel: "Indore",
    fromWarehouseId: srcWh._id, toWarehouseId: destWh._id,
    lines: [{ inventoryId: lot._id, qty: 5 }],
  });
  await shipmentService.dispatchShipment(companyId, ship._id, {});
  expect((await Inventory.findById(lot._id)).availableStock).toBe(15);
});
