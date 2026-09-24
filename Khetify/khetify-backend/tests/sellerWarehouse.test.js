const mongoose = require("mongoose");
const Warehouse = require("../model/Warehouse/Warehouse");
const ctrl = require("../controller/Seller/sellerWarehouseController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

let sellerA, sellerB, companyId;
beforeEach(() => {
  sellerA = new mongoose.Types.ObjectId();
  sellerB = new mongoose.Types.ObjectId();
  companyId = new mongoose.Types.ObjectId();
});
const asSeller = (sellerId, body = {}, params = {}) => ({ user: { sellerId, principalType: "seller" }, body, params });

describe("Warehouse ownership is company XOR seller", () => {
  test("rejects a warehouse with NEITHER owner", async () => {
    await expect(Warehouse.create({ name: "Orphan" })).rejects.toBeTruthy();
  });

  test("rejects a warehouse with BOTH owners", async () => {
    await expect(Warehouse.create({ name: "Both", companyId, sellerId: sellerA })).rejects.toBeTruthy();
  });

  test("accepts a company-only and a seller-only warehouse", async () => {
    const c = await Warehouse.create({ companyId, name: "Co WH" });
    const s = await Warehouse.create({ sellerId: sellerA, name: "Seller WH" });
    expect(String(c.companyId)).toBe(String(companyId));
    expect(String(s.sellerId)).toBe(String(sellerA));
  });
});

describe("seller warehouse endpoints are seller-scoped", () => {
  // A warehouse is created together with its Warehouse Manager (a new seller
  // team member), so a create request always carries one. Email and phone are
  // unique per manager.
  const manager = (tag, phone) => ({ name: `Manager ${tag}`, email: `mgr-${tag}@x.com`, phone, password: "secret123" });

  test("create + list returns only the caller's warehouses", async () => {
    const cRes = mockRes();
    await ctrl.createSellerWarehouse(asSeller(sellerA, { name: "A1", code: "A1", address: { city: "Indore", state: "MP" }, capacityUnits: 100, manager: manager("a1", "9000000001") }), cRes);
    expect(cRes.statusCode).toBe(201);
    expect(String(cRes.body.data.sellerId)).toBe(String(sellerA));
    // …and its manager belongs to seller A and is scoped to that warehouse.
    expect(String(cRes.body.manager.ownerId)).toBe(String(sellerA));
    expect(cRes.body.manager.warehouseIds.map(String)).toEqual([String(cRes.body.data._id)]);

    // another seller's warehouse + a company warehouse must not leak in
    const bRes = mockRes();
    await ctrl.createSellerWarehouse(asSeller(sellerB, { name: "B1", manager: manager("b1", "9000000002") }), bRes);
    expect(bRes.statusCode).toBe(201);
    await Warehouse.create({ companyId, name: "Co WH" });

    const listRes = mockRes();
    await ctrl.getSellerWarehouses(asSeller(sellerA), listRes);
    expect(listRes.body.count).toBe(1);
    expect(listRes.body.data[0].name).toBe("A1");
  });

  test("create requires a name", async () => {
    const res = mockRes();
    await ctrl.createSellerWarehouse(asSeller(sellerA, { code: "X" }), res);
    expect(res.statusCode).toBe(400);
  });

  test("update/deactivate only affect the caller's own warehouse", async () => {
    const wh = await Warehouse.create({ sellerId: sellerA, name: "A1" });

    // seller B cannot edit seller A's warehouse → 404
    const foreign = mockRes();
    await ctrl.updateSellerWarehouse(asSeller(sellerB, { name: "Hacked" }, { id: wh._id }), foreign);
    expect(foreign.statusCode).toBe(404);

    // owner can edit
    const ok = mockRes();
    await ctrl.updateSellerWarehouse(asSeller(sellerA, { name: "A1-renamed" }, { id: wh._id }), ok);
    expect(ok.body.data.name).toBe("A1-renamed");

    // owner can deactivate
    const deact = mockRes();
    await ctrl.deactivateSellerWarehouse(asSeller(sellerA, {}, { id: wh._id }), deact);
    expect(deact.body.data.isActive).toBe(false);
  });
});

describe("assertSellerWarehouse", () => {
  test("returns the warehouse when owned by the seller", async () => {
    const wh = await Warehouse.create({ sellerId: sellerA, name: "A1" });
    const found = await ctrl.assertSellerWarehouse(sellerA, wh._id);
    expect(String(found._id)).toBe(String(wh._id));
  });

  test("throws (403) for a foreign seller's warehouse", async () => {
    const wh = await Warehouse.create({ sellerId: sellerA, name: "A1" });
    await expect(ctrl.assertSellerWarehouse(sellerB, wh._id)).rejects.toMatchObject({ status: 403 });
  });

  test("throws for a company warehouse", async () => {
    const wh = await Warehouse.create({ companyId, name: "Co WH" });
    await expect(ctrl.assertSellerWarehouse(sellerA, wh._id)).rejects.toMatchObject({ status: 403 });
  });
});
