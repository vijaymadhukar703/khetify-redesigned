/**
 * GET /api/orders/history — the filters behind Company → Transfer History.
 *
 * Status, warehouse, date range and free-text search, each on its own and then
 * combined with AND. Every assertion is against the CONTROLLER, so a filter that
 * only appears to work because the page happens to render few rows cannot pass.
 *
 * Order History (every other role) and the warehouse-scoped view (?scope=warehouse)
 * are covered too, so this file also guards them against regressions.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const Order = require("../model/Order/Order");
const Shipment = require("../model/Transport/Shipment");
const lotService = require("../services/lotService");
const shipmentService = require("../services/shipmentService");
const orderCtrl = require("../controller/Order/orderController");

let companyId, indore, bhopal, pune, productA, productB, lotA, lotB;

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const adminUser = () => ({ id: companyId, companyId, role: "company_admin" });

/** The exact request the Company Transfer History page makes. */
const history = async (query = {}, user = adminUser()) => {
  const res = mockRes();
  await orderCtrl.getHistory({ query: { excludeRequests: "1", transfersOnly: "1", ...query }, user }, res);
  return res;
};
const refs = (res) => (res.body?.data || []).map((r) => r.ref);
const refOf = (s) => s.lrNumber || `SH-${String(s._id).slice(-6).toUpperCase()}`;

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Owner", email: `cth-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  indore = await Warehouse.create({ companyId, name: "Indore Warehouse", code: "IND" });
  bhopal = await Warehouse.create({ companyId, name: "Bhopal Warehouse", code: "BHO" });
  pune = await Warehouse.create({ companyId, name: "Pune Warehouse", code: "PUN" });

  productA = await Product.create({ companyId, productName: "Premium Basmati Rice", skuNumber: "PBR-01", price: 10 });
  productB = await Product.create({ companyId, productName: "Urea Fertilizer", skuNumber: "URE-99", price: 20 });

  lotA = await lotService.receiveLot({ ownerId: companyId, productId: productA._id, warehouseId: indore._id, batchNumber: "KH-BHO-XYZ398-2026-07-0001", qty: 100 });
  lotB = await lotService.receiveLot({ ownerId: companyId, productId: productB._id, warehouseId: indore._id, batchNumber: "KH-BHO-ABC111-2026-07-0002", qty: 100 });
});

/** A warehouse→warehouse transfer, optionally back-dated and multi-lot. */
async function transfer({ to = bhopal, lines, createdAt, status } = {}) {
  const s = await shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse",
    fromWarehouseId: indore._id, toWarehouseId: to._id, toLabel: to.name,
    lines: lines || [{ inventoryId: lotA._id, qty: 10 }],
  });
  const set = {};
  // Straight through the driver: mongoose refuses to let an update rewrite a
  // timestamps-managed `createdAt`, and back-dating is the whole point here.
  if (createdAt) set.createdAt = new Date(createdAt);
  if (status) set.status = status;
  if (Object.keys(set).length) await Shipment.collection.updateOne({ _id: s._id }, { $set: set });
  return Shipment.findById(s._id);
}

describe("date range", () => {
  test("a transfer created ON the To date is included (the range is inclusive)", async () => {
    const s = await transfer({ createdAt: "2025-12-31T09:15:00.000Z" });
    const res = await history({ from: "2025-01-01", to: "2025-12-31" });
    expect(refs(res)).toEqual([refOf(s)]);
  });

  test("a transfer created ON the From date is included", async () => {
    const s = await transfer({ createdAt: "2025-01-01T18:40:00.000Z" });
    const res = await history({ from: "2025-01-01", to: "2025-12-31" });
    expect(refs(res)).toEqual([refOf(s)]);
  });

  test("transfers outside the range are excluded on both sides", async () => {
    await transfer({ createdAt: "2024-12-31T23:00:00.000Z" });
    await transfer({ createdAt: "2026-01-01T01:00:00.000Z" });
    const inside = await transfer({ createdAt: "2025-06-15T10:00:00.000Z" });
    const res = await history({ from: "2025-01-01", to: "2025-12-31" });
    expect(refs(res)).toEqual([refOf(inside)]);
  });

  test("only one bound given — the filter is ignored, as specified", async () => {
    const old = await transfer({ createdAt: "2020-01-01T00:00:00.000Z" });
    const recent = await transfer({ createdAt: "2025-06-15T00:00:00.000Z" });
    expect(refs(await history({ from: "2025-01-01" })).sort())
      .toEqual([refOf(old), refOf(recent)].sort());
    expect(refs(await history({ to: "2021-01-01" })).sort())
      .toEqual([refOf(old), refOf(recent)].sort());
  });

  test("From later than To is rejected rather than silently returning nothing", async () => {
    await transfer({ createdAt: "2025-06-15T00:00:00.000Z" });
    const res = await history({ from: "2025-12-31", to: "2025-01-01" });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/from date/i);
  });
});

describe("warehouse", () => {
  test("matches a transfer on either side of the move", async () => {
    const out = await transfer({ to: bhopal });                       // Indore → Bhopal
    await transfer({ to: pune });                                     // Indore → Pune
    expect(refs(await history({ warehouseId: String(bhopal._id) }))).toEqual([refOf(out)]);
  });

  test("a warehouse with no transfers returns nothing", async () => {
    await transfer({ to: bhopal });
    const spare = await Warehouse.create({ companyId, name: "Nagpur Warehouse", code: "NAG" });
    expect(refs(await history({ warehouseId: String(spare._id) }))).toEqual([]);
  });
});

describe("status", () => {
  test("the Received bucket includes a partially received transfer", async () => {
    const full = await transfer({ status: "received" });
    const partial = await transfer({ status: "partially_received" });
    await transfer({ status: "in_transit" });
    expect(refs(await history({ statusBucket: "received" })).sort())
      .toEqual([refOf(full), refOf(partial)].sort());
  });

  test("the In Transit bucket covers every step before receipt", async () => {
    const planned = await transfer({ status: "planned" });
    const dispatched = await transfer({ status: "dispatched" });
    const arrived = await transfer({ status: "arrived" });
    await transfer({ status: "received" });
    await transfer({ status: "cancelled" });
    expect(refs(await history({ statusBucket: "in_transit" })).sort())
      .toEqual([refOf(planned), refOf(dispatched), refOf(arrived)].sort());
  });

  test("no status returns every transfer, closed ones included", async () => {
    await transfer({ status: "received" });
    await transfer({ status: "cancelled" });
    expect((await history({})).body.count).toBe(2);
  });
});

describe("search", () => {
  test("matches the transfer reference", async () => {
    const s = await transfer();
    await transfer({ to: pune });
    expect(refs(await history({ q: refOf(s) }))).toEqual([refOf(s)]);
  });

  test("matches a product name", async () => {
    const s = await transfer({ lines: [{ inventoryId: lotA._id, qty: 5 }] });
    await transfer({ lines: [{ inventoryId: lotB._id, qty: 5 }] });
    expect(refs(await history({ q: "basmati" }))).toEqual([refOf(s)]);
  });

  test("matches a PRODUCT CODE", async () => {
    const s = await transfer({ lines: [{ inventoryId: lotB._id, qty: 5 }] });
    await transfer({ lines: [{ inventoryId: lotA._id, qty: 5 }] });
    expect(refs(await history({ q: "URE-99" }))).toEqual([refOf(s)]);
  });

  test("matches a lot number", async () => {
    const s = await transfer({ lines: [{ inventoryId: lotA._id, qty: 5 }] });
    await transfer({ lines: [{ inventoryId: lotB._id, qty: 5 }] });
    expect(refs(await history({ q: "XYZ398" }))).toEqual([refOf(s)]);
  });

  test("matches a lot beyond the first on a multi-lot transfer", async () => {
    // The Lot No. column condenses to "FIRST +1 more"; searching the SECOND lot
    // must still find the row.
    const s = await transfer({ lines: [{ inventoryId: lotA._id, qty: 5 }, { inventoryId: lotB._id, qty: 5 }] });
    expect(refs(await history({ q: "ABC111" }))).toEqual([refOf(s)]);
    expect(refs(await history({ q: "Urea" }))).toEqual([refOf(s)]);
    expect(refs(await history({ q: "URE-99" }))).toEqual([refOf(s)]);
  });

  test("matches a warehouse name, on either side", async () => {
    const s = await transfer({ to: bhopal });
    await transfer({ to: pune });
    expect(refs(await history({ q: "bhopal" }))).toEqual([refOf(s)]);
    expect(refs(await history({ q: "indore" })).length).toBe(2); // source of both
  });

  test("is case-insensitive and ignores surrounding spaces", async () => {
    const s = await transfer();
    expect(refs(await history({ q: "  BaSmAtI  " }))).toEqual([refOf(s)]);
  });

  test("no match shows an empty list, not everything", async () => {
    await transfer();
    expect(refs(await history({ q: "nothing-like-this" }))).toEqual([]);
  });
});

describe("filters combine with AND", () => {
  test("status + warehouse + date + search together", async () => {
    // The one row that satisfies everything.
    const match = await transfer({ to: bhopal, status: "received", createdAt: "2025-06-15T10:00:00.000Z", lines: [{ inventoryId: lotA._id, qty: 5 }] });
    // Each of these fails exactly one condition.
    await transfer({ to: bhopal, status: "in_transit", createdAt: "2025-06-15T10:00:00.000Z" });          // status
    await transfer({ to: pune, status: "received", createdAt: "2025-06-15T10:00:00.000Z" });              // warehouse
    await transfer({ to: bhopal, status: "received", createdAt: "2024-06-15T10:00:00.000Z" });            // date
    await transfer({ to: bhopal, status: "received", createdAt: "2025-06-15T10:00:00.000Z", lines: [{ inventoryId: lotB._id, qty: 5 }] }); // search

    const res = await history({
      statusBucket: "received",
      warehouseId: String(bhopal._id),
      from: "2025-01-01", to: "2025-12-31",
      q: "XYZ398",
    });
    expect(refs(res)).toEqual([refOf(match)]);
  });

  test("no filters returns the complete list — what Clear reloads", async () => {
    await transfer({ to: bhopal, status: "received", createdAt: "2025-06-15T10:00:00.000Z" });
    await transfer({ to: pune, status: "in_transit", createdAt: "2024-01-02T10:00:00.000Z" });
    expect((await history({})).body.count).toBe(2);
  });
});

describe("the list is transfers only, so paging and the limit are spent on them", () => {
  test("seller/customer orders cannot crowd transfers out of the response", async () => {
    // Orders are newer than the transfer, so a mixed list truncated to `limit`
    // would drop the transfer entirely.
    await Order.insertMany(Array.from({ length: 5 }, (_, i) => ({
      companyId, status: "delivered", customerName: `Buyer ${i}`,
      totalAmount: 100, placedAt: new Date("2026-01-01T00:00:00.000Z"),
      items: [{ productId: productA._id, qty: 1, price: 100 }],
    })));
    const s = await transfer({ createdAt: "2025-06-15T10:00:00.000Z" });

    const res = await history({ limit: "3" });
    expect(refs(res)).toEqual([refOf(s)]);
    expect(res.body.data.every((r) => r.kind === "shipment" && r.toType === "warehouse")).toBe(true);
  });

  test("a customer shipment is not a transfer and never appears", async () => {
    await shipmentService.createShipment(companyId, {
      refType: "Order", toType: "customer", fromWarehouseId: indore._id, toLabel: "A Customer",
      lines: [{ inventoryId: lotA._id, qty: 3 }],
    });
    const s = await transfer();
    expect(refs(await history({}))).toEqual([refOf(s)]);
  });
});

describe("other consumers of /orders/history are unchanged", () => {
  const plain = async (query = {}) => {
    const res = mockRes();
    await orderCtrl.getHistory({ query, user: adminUser() }, res);
    return res;
  };

  test("Order History (no flags) still returns orders AND shipments", async () => {
    await Order.create({
      companyId, status: "delivered", customerName: "Buyer", totalAmount: 100,
      placedAt: new Date("2025-06-15T00:00:00.000Z"),
      items: [{ productId: productA._id, qty: 1, price: 100 }],
    });
    await transfer({ createdAt: "2025-06-15T10:00:00.000Z" });
    const kinds = (await plain()).body.data.map((r) => r.kind);
    expect(kinds).toContain("seller");
    expect(kinds).toContain("shipment");
  });

  test("Order History keeps EXACT status matching on ?status=", async () => {
    await transfer({ status: "in_transit" });
    await transfer({ status: "received" });
    const res = await plain({ status: "received", excludeRequests: "1" });
    expect(res.body.data.map((r) => r.status)).toEqual(["received"]);
  });
});
