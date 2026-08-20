/**
 * GET /api/orders/history?scope=warehouse — Company → Warehouse transfers.
 *
 * A Company → Warehouse move writes NO Shipment and NO TransferRequest: the
 * main company mints the lot against a warehouseId, which books it onto the
 * destination Inventory row as inTransitStock (receiving_status "pending"),
 * and the warehouse's Confirm Receive flips it to "received". That is why these
 * transfers never reached Warehouse Transfer History, which only read the
 * Shipment / TransferRequest collections.
 *
 * These tests pin the fix AND the two things it must not break: the existing
 * warehouse→warehouse rows, and the main Company Transfer History.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const User = require("../model/User/User");
const Shipment = require("../model/Transport/Shipment");
const lotService = require("../services/lotService");
const lotCtrl = require("../controller/Inventory/lotController");
const orderCtrl = require("../controller/Order/orderController");

let companyId, productId, bhopal, indore;

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const adminUser = () => ({ id: companyId, companyId, role: "company_admin" });

/** A Bhopal warehouse manager — scoped, so ?scope=warehouse resolves to Bhopal. */
async function bhopalManager() {
  const u = await User.create({
    companyId, name: "Bhopal Manager", email: `wm-${new mongoose.Types.ObjectId()}@x.com`,
    password: "x", role: "warehouse_manager", warehouseIds: [bhopal._id],
  });
  return { id: u._id, companyId, role: "warehouse_manager" };
}

const history = async (query, user) => {
  const res = mockRes();
  await orderCtrl.getHistory({ query, user }, res);
  return res.body;
};
const refs = (body) => (body.data || []).map((r) => r.ref);

beforeEach(async () => {
  const company = await Company.create({
    fullName: "Khetify Co", email: `c-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Khetify Agro" },
  });
  companyId = company._id;
  bhopal = await Warehouse.create({ companyId, name: "Bhopal Warehouse", code: "BHO" });
  indore = await Warehouse.create({ companyId, name: "Indore Warehouse", code: "IND" });
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "URE494", price: 10 });
  productId = p._id;
});

/** The reported flow: company creates a lot against Bhopal, Bhopal receives it. */
async function companyToWarehouse(lotNumber, qty, { confirm = true } = {}) {
  const res = mockRes();
  await lotCtrl.receiveLot(
    { body: { productId, warehouseId: bhopal._id, lotNumber, qty }, user: adminUser() },
    res,
  );
  expect(res.statusCode).toBe(200);
  const inv = res.body.data;
  expect(inv.inTransitStock).toBe(qty); // booked, not yet stock
  if (confirm) await lotService.confirmLotReceipt(companyId, inv._id, { performedBy: companyId });
  return inv;
}

describe("Company → Warehouse transfers in Warehouse Transfer History", () => {
  test("a received Company → Warehouse lot appears as an Incoming row", async () => {
    const inv = await companyToWarehouse("KH-BHO-URE494-2026-07-0002", 30);

    const body = await history({ scope: "warehouse", excludeRequests: "1" }, await bhopalManager());
    const row = (body.data || []).find((r) => r.lotNo === "KH-BHO-URE494-2026-07-0002");

    expect(row).toBeDefined();
    expect(row.kind).toBe("company_transfer");
    expect(row.ref).toBe(`CW-${String(inv._id).slice(-6).toUpperCase()}`);
    expect(row.units).toBe(30);
    expect(row.status).toBe("received");
    expect(row.from).toBe("Khetify Agro");
    expect(row.to).toBe("Bhopal Warehouse");
    // Direction is derived client-side from these two IDs: a null source + my
    // warehouse as destination is what makes the UI read "Incoming".
    expect(row.fromWarehouseId).toBeNull();
    expect(String(row.toWarehouseId)).toBe(String(bhopal._id));
    // Reads "Transfer" (not "Sales") through the shared movementKind() helper.
    expect(row.toType).toBe("warehouse");
    expect(row.total).toBe(300); // 30 × ₹10
  });

  test("a lot still awaiting Confirm Receive shows as pending, not received", async () => {
    await companyToWarehouse("KH-BHO-URE494-2026-07-0003", 12, { confirm: false });

    const body = await history({ scope: "warehouse", excludeRequests: "1" }, await bhopalManager());
    const row = (body.data || []).find((r) => r.lotNo === "KH-BHO-URE494-2026-07-0003");

    expect(row.status).toBe("pending");
    expect(row.units).toBe(12);
  });

  test("Company → Warehouse and Warehouse → Warehouse appear together", async () => {
    await companyToWarehouse("KH-BHO-URE494-2026-07-0002", 30);
    // An existing outgoing warehouse→warehouse shipment, untouched by the fix.
    const shipment = await Shipment.create({
      companyId, fromWarehouseId: bhopal._id, toType: "warehouse",
      toWarehouseId: indore._id, toLabel: "Indore Warehouse", status: "received",
      lines: [{ productId, lotNumber: "KH-BHO-PRE959-2026-07-0001", qty: 20 }],
    });

    const body = await history({ scope: "warehouse", excludeRequests: "1" }, await bhopalManager());
    const all = refs(body);

    expect(all).toContain(`CW-${String((body.data.find((r) => r.kind === "company_transfer")).id).slice(-6).toUpperCase()}`);
    expect(all).toContain(`SH-${String(shipment._id).slice(-6).toUpperCase()}`);
    expect(body.data.filter((r) => r.kind === "company_transfer")).toHaveLength(1);
    expect(body.data.filter((r) => r.kind === "shipment")).toHaveLength(1);
  });

  test("another warehouse's Company → Warehouse lot is never leaked", async () => {
    // Company assigns a lot to INDORE; a Bhopal manager must not see it.
    const res = mockRes();
    await lotCtrl.receiveLot(
      { body: { productId, warehouseId: indore._id, lotNumber: "KH-IND-URE494-2026-07-0009", qty: 44 }, user: adminUser() },
      res,
    );
    expect(res.statusCode).toBe(200);

    const body = await history({ scope: "warehouse", excludeRequests: "1" }, await bhopalManager());
    expect(refs(body)).toHaveLength(0);
  });

  test("a warehouse's OWN Receive Lot is not reported as a Company transfer", async () => {
    // lotOrigin "warehouse" — stocked in directly, no company hand-off.
    const res = mockRes();
    await lotCtrl.receiveLot(
      { body: { productId, warehouseId: bhopal._id, lotNumber: "KH-BHO-OWN-0001", qty: 7 }, user: await bhopalManager() },
      res,
    );
    expect(res.statusCode).toBe(200);

    const body = await history({ scope: "warehouse", excludeRequests: "1" }, await bhopalManager());
    expect(body.data.filter((r) => r.kind === "company_transfer")).toHaveLength(0);
  });

  test("the main Company Transfer History is unchanged (no scope=warehouse)", async () => {
    await companyToWarehouse("KH-BHO-URE494-2026-07-0002", 30);

    const body = await history({ excludeRequests: "1" }, adminUser());
    expect(body.data.filter((r) => r.kind === "company_transfer")).toHaveLength(0);
  });
});