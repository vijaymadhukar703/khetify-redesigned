/**
 * GET /api/lots/:id/transfer-snapshot — the IMMUTABLE historical view behind
 * Warehouse → Transfer History → View for a Company → Warehouse transfer.
 *
 * The bug it fixes: the View page used to read /lots/:id/details, whose units
 * are the LIVE set still pointing at the Inventory row. A later warehouse→
 * warehouse transfer REASSIGNS a moved unit's inventoryId to the destination
 * row, so the original transfer appeared to shrink (100 → 80). A Transfer
 * History record must instead read what ARRIVED on that date, forever.
 *
 * These tests pin that the snapshot stays at the original 100 after 20 units are
 * moved out, and prove the live /details endpoint is the one that shrinks — the
 * exact before/after the fix turns on.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const UnitSerial = require("../model/Barcode/UnitSerial");
const BulkPackage = require("../model/Inventory/BulkPackage");
const lotService = require("../services/lotService");
const barcodeService = require("../services/barcodeService");
const lotCtrl = require("../controller/Inventory/lotController");
const User = require("../model/User/User");

let companyId, productId, bhopal, indore;

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

// Main Company principal → Company → Inventory → View (original register).
const adminUser = () => ({ id: companyId, companyId, role: "company_admin" });

// A Bhopal-scoped warehouse manager → Company Warehouse → Inventory → View
// (current stock). warehouseScope reads the live User doc, so it must exist.
async function bhopalManager() {
  const u = await User.create({
    companyId, name: "Bhopal WM", email: `wm-${new mongoose.Types.ObjectId()}@x.com`,
    password: "x", role: "warehouse_manager", warehouseIds: [bhopal._id],
  });
  return { id: u._id, companyId, role: "warehouse_manager" };
}

beforeEach(async () => {
  const company = await Company.create({
    fullName: "Khetify Co", email: `c-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Khetify Agro" },
  });
  companyId = company._id;
  bhopal = await Warehouse.create({ companyId, name: "Bhopal Warehouse", code: "BHO" });
  indore = await Warehouse.create({ companyId, name: "Indore Warehouse", code: "IND" });
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "URE494", price: 10, mrp: 10 });
  productId = p._id;
});

/** Company mints a lot against Bhopal, Bhopal confirms receipt, labels minted. */
async function companyToWarehouse(lotNumber, qty) {
  const res = mockRes();
  await lotCtrl.receiveLot(
    { body: { productId, warehouseId: bhopal._id, lotNumber, qty }, user: adminUser() },
    res,
  );
  expect(res.statusCode).toBe(200);
  const inv = res.body.data;
  await lotService.confirmLotReceipt(companyId, inv._id, { performedBy: companyId });
  // The units are minted BY THE CREATE ITSELF now (lotController opts in with
  // mintUnitLabels), for a single-package lot as well as a boxed one. Generating
  // them again here would ask for `qty` more than the lot was created with and
  // be refused by the capacity guard, which is the correct answer — there is
  // nothing left to generate.
  expect(await UnitSerial.countDocuments({ inventoryId: inv._id })).toBe(qty);
  return inv;
}

/** Simulate a later Bhopal → Indore transfer of `qty` units: the receipt path
 *  reassigns each moved unit's inventoryId to the destination row and drops the
 *  source's live balance. Nothing here touches lotNumber/companyId. */
async function transferOut(sourceInvId, lotNumber, qty) {
  const dest = await Inventory.create({
    productId, ownerType: "company", ownerId: companyId, warehouseId: indore._id,
    lotNumber, batchNumber: lotNumber, availableStock: qty, lotOrigin: "transfer",
  });
  const movers = await UnitSerial.find({ inventoryId: sourceInvId }).limit(qty).select("_id");
  await UnitSerial.updateMany(
    { _id: { $in: movers.map((m) => m._id) } },
    { $set: { inventoryId: dest._id, status: "in_stock" } },
  );
  await Inventory.updateOne({ _id: sourceInvId }, { $inc: { availableStock: -qty } });
}

const snapshot = async (id, user = adminUser()) => {
  const res = mockRes();
  await lotCtrl.lotTransferSnapshot({ params: { id }, user }, res);
  return res;
};
const details = async (id, user = adminUser()) => {
  const res = mockRes();
  await lotCtrl.lotDetails({ params: { id }, user }, res);
  return res;
};

describe("Company → Warehouse transfer snapshot is immutable", () => {
  test("still shows the ORIGINAL 100 units after 20 are transferred out", async () => {
    const inv = await companyToWarehouse("KH-BHO-URE494-2026-07-0100", 100);
    await transferOut(inv._id, "KH-BHO-URE494-2026-07-0100", 20);

    const res = await snapshot(inv._id);
    expect(res.statusCode).toBe(200);
    const d = res.body.data;
    expect(d.snapshot).toBe(true);
    expect(d.unitTotal).toBe(100);        // Quantity / "100 of 100"
    expect(d.units).toHaveLength(100);     // every original Unit Code, none dropped
    expect(d.lot.originalQuantity).toBe(100);
  });

  test("Company → Inventory → View (company_admin) shows the ORIGINAL Company allocation, not live balances", async () => {
    const inv = await companyToWarehouse("KH-BHO-URE494-2026-07-0130", 100);
    await transferOut(inv._id, "KH-BHO-URE494-2026-07-0130", 29);

    const live = await details(inv._id, adminUser());
    expect(live.statusCode).toBe(200);
    const d = live.body.data;
    expect(d.register).toBe("original");
    // Stock Context = original allocation: Bhopal 100 only; the Indore transfer
    // destination (no originalQuantity) is excluded.
    expect(d.stockByWarehouse).toHaveLength(1);
    expect(d.stockByWarehouse[0].warehouse).toBe("Bhopal Warehouse");
    expect(d.stockByWarehouse[0].availableStock).toBe(100); // shown in the stock column
    expect(d.stockByWarehouse[0].assignedQty).toBe(100);
    // Every section is the original register — all 100, never the live 71.
    expect(d.unitTotal).toBe(100);
    expect(d.units).toHaveLength(100);
  });

  test("Company → Inventory → View Stock Context: Current Stock = allocation, Awaiting Receipt = allocated − received", async () => {
    // Company allocates 2000 to Bhopal (booked, awaiting receipt).
    const res = mockRes();
    await lotCtrl.receiveLot(
      { body: { productId, warehouseId: bhopal._id, lotNumber: "KH-BHO-URE494-2026-07-0140", qty: 2000 }, user: adminUser() },
      res,
    );
    const inv = res.body.data;
    expect(inv.inTransitStock).toBe(2000);
    // Warehouse has received only 1000 so far → 1000 still awaiting receipt.
    await Inventory.updateOne(
      { _id: inv._id },
      { $set: { availableStock: 1000, inTransitStock: 1000, receiving_status: "partially_received" } },
    );

    const d = (await details(inv._id, adminUser())).body.data;
    const row = d.stockByWarehouse[0];
    expect(row.warehouse).toBe("Bhopal Warehouse");
    expect(row.availableStock).toBe(2000);  // Current Stock = allocation (immutable)
    expect(row.inTransitStock).toBe(1000);  // Awaiting Receipt = 2000 − 1000 received
    expect(row.assignedQty).toBe(2000);
  });

  test("Company Warehouse → Inventory → View (warehouse manager) reflects CURRENT stock, while the snapshot stays original", async () => {
    const inv = await companyToWarehouse("KH-BHO-URE494-2026-07-0101", 100);
    await transferOut(inv._id, "KH-BHO-URE494-2026-07-0101", 20);

    const live = await details(inv._id, await bhopalManager());
    expect(live.statusCode).toBe(200);
    // Warehouse Inventory View = current warehouse state: 20 units left this row.
    expect(live.body.data.units).toHaveLength(80);
    expect(live.body.data.unitTotal).toBe(80);
    const thisRow = live.body.data.stockByWarehouse.find((s) => s.isThisRow);
    expect(thisRow.availableStock).toBe(80);

    // Transfer History → View is untouched: still the original 100.
    const snap = await snapshot(inv._id);
    expect(snap.body.data.units).toHaveLength(100);
    expect(snap.body.data.unitTotal).toBe(100);
  });

  test("Company Warehouse Stock Context shows only THIS warehouse's current stock, never another warehouse's destination row", async () => {
    const inv = await companyToWarehouse("KH-BHO-URE494-2026-07-0110", 100);
    await transferOut(inv._id, "KH-BHO-URE494-2026-07-0110", 29);

    const live = await details(inv._id, await bhopalManager());
    const ctx = live.body.data.stockByWarehouse;
    // Only the viewed warehouse (Bhopal). The Indore transfer destination is a
    // different warehouse's inventory and must not appear on this page.
    expect(ctx).toHaveLength(1);
    expect(ctx[0].warehouse).toBe("Bhopal Warehouse");
    expect(ctx[0].isThisRow).toBe(true);
    expect(ctx[0].availableStock).toBe(71);          // current stock, NOT the original 100
    expect(live.body.data.units).toHaveLength(71);   // current unit codes only
  });

  test("Packaging Summary keeps the ORIGINAL structure, but the box list and Unit Labels stay current", async () => {
    // A boxed lot: 2 boxes × 3 units. (Mirrors the reported 2×50 lot.)
    const inv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: bhopal._id,
      lotNumber: "KH-BHO-BOX-0001", qty: 6, lotOrigin: "company", pendingReceipt: true,
      hasBulkPackaging: true, numberOfBoxes: 2, unitsPerBox: 3,
    });
    await barcodeService.generateUnits(companyId, inv._id, 6, { performedBy: companyId });
    // Simulate the boxes being received so their units are available in-stock
    // (a pending boxed lot mints "generated" units).
    await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
    const boxes = await BulkPackage.find({ lot_id: inv._id }).sort({ box_serial: 1 });
    expect(boxes).toHaveLength(2);
    // Box #2 (the one that stays) is received here; box #1 is not (it will leave).
    await BulkPackage.updateOne({ _id: boxes[1]._id }, { $set: { status: "received" } });

    // Transfer ALL 3 units of box #1 to another warehouse row.
    const dest = await Inventory.create({
      productId, ownerType: "company", ownerId: companyId, warehouseId: indore._id,
      lotNumber: "KH-BHO-BOX-0001", batchNumber: "KH-BHO-BOX-0001", availableStock: 3, lotOrigin: "transfer",
    });
    await UnitSerial.updateMany(
      { inventoryId: inv._id, bulk_packaging_record_id: boxes[0]._id },
      { $set: { inventoryId: dest._id } },
    );

    const live = await details(inv._id, await bhopalManager());
    const d = live.body.data;

    // Bulk Packaging IDs (box LIST) — current: only the box still physically here.
    expect(d.bulkPackages).toHaveLength(1);
    expect(String(d.bulkPackages[0]._id)).toBe(String(boxes[1]._id));
    // Unit Codes / Unit Labels — current: 3 units belong to this warehouse.
    expect(d.units).toHaveLength(3);
    expect(d.unitTotal).toBe(3);

    // Packaging SUMMARY — ORIGINAL structure (same logic as Company → Inventory):
    // both boxes counted, the box that left shows as pending, not erased.
    expect(d.lot.number_of_boxes).toBe(2);        // "2 boxes × 3 units" Packaging line
    expect(d.packaging.totalBoxes).toBe(2);
    expect(d.packaging.receivedBoxes).toBe(1);
    expect(d.packaging.pendingBoxes).toBe(1);
    expect(d.packaging.receivedUnits).toBe(3);
    expect(d.packaging.pendingUnits).toBe(3);

    // Company → Inventory → View (company_admin) unchanged: same Packaging Summary,
    // but original everywhere (all 2 boxes listed, all 6 unit labels).
    const orig = await details(inv._id, adminUser());
    expect(orig.body.data.lot.number_of_boxes).toBe(2);
    expect(orig.body.data.bulkPackages).toHaveLength(2);
    expect(orig.body.data.packaging.totalBoxes).toBe(2);

    // Transfer History snapshot is untouched: both boxes, all 6 original units.
    const snap = await snapshot(inv._id);
    expect(snap.body.data.bulkPackages).toHaveLength(2);
    expect(snap.body.data.units).toHaveLength(6);
  });

  test("all three sections stay in sync with the Inventory list qty when a unit leaves available stock", async () => {
    // Reproduces the reported drift: 100 received, 29 transferred out, then 1 of
    // the remaining units is damaged. availableStock = 70 (the Inventory list qty),
    // but 71 UnitSerials still point at this row.
    const inv = await companyToWarehouse("KH-BHO-URE494-2026-07-0120", 100);
    await transferOut(inv._id, "KH-BHO-URE494-2026-07-0120", 29);
    const [victim] = await UnitSerial.find({ inventoryId: inv._id, status: "in_stock" }).limit(1);
    await UnitSerial.updateOne({ _id: victim._id }, { $set: { status: "damaged" } });
    await Inventory.updateOne({ _id: inv._id }, { $set: { availableStock: 70 }, $inc: { damagedStock: 1 } });

    const live = await details(inv._id, await bhopalManager());
    const d = live.body.data;
    const stockCtx = d.stockByWarehouse.find((s) => s.isThisRow).availableStock;

    // Inventory list qty (availableStock) is the single source of truth: all
    // three sections equal it, and the damaged unit does not appear.
    expect(stockCtx).toBe(70);                 // Stock Context
    expect(d.unitTotal).toBe(70);              // Packaging Summary / Unit Labels
    expect(d.units).toHaveLength(70);          // Unit Codes
    expect(d.units.every((u) => u.status === "in_stock")).toBe(true);

    // Transfer History is untouched — still every original 100.
    const snap = await snapshot(inv._id);
    expect(snap.body.data.units).toHaveLength(100);
  });

  test("a single un-transferred lot reads identically on both endpoints", async () => {
    const inv = await companyToWarehouse("KH-BHO-URE494-2026-07-0102", 40);

    const snap = await snapshot(inv._id);
    const live = await details(inv._id);
    expect(snap.body.data.units).toHaveLength(40);
    expect(live.body.data.units).toHaveLength(40);
    expect(snap.body.data.unitTotal).toBe(40);
  });

  test("another warehouse's lot is never leaked to a scoped manager", async () => {
    const inv = await companyToWarehouse("KH-BHO-URE494-2026-07-0103", 10);
    // A manager scoped to Indore only must not open a Bhopal lot's snapshot.
    const u = await User.create({
      companyId, name: "Indore Mgr", email: `im-${new mongoose.Types.ObjectId()}@x.com`,
      password: "x", role: "warehouse_manager", warehouseIds: [indore._id],
    });
    const res = await snapshot(inv._id, { id: u._id, companyId, role: "warehouse_manager" });
    expect(res.statusCode).toBe(403);
  });
});
