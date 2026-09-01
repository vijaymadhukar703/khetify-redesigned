const mongoose = require("mongoose");
const Inventory = require("../model/Inventory/Inventory");
const Product = require("../model/Company/productModel");
const ctrl = require("../controller/Seller/sellerMyProductController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const asSeller = (sellerId) => ({
  user: { sellerId, principalType: "seller", role: "seller_admin", id: sellerId },
  body: {}, params: {}, query: {},
});

const DAY = 86400000;
const daysFromNow = (n) => new Date(Date.now() + n * DAY);

let sellerId, product;

/** One seller-owned Inventory lot. `batchNumber` keeps rows on distinct keys. */
const lot = (over = {}) =>
  Inventory.create({
    productId: product._id,
    ownerType: "seller",
    ownerId: sellerId,
    warehouseId: new mongoose.Types.ObjectId(),
    batchNumber: `LOT-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
    availableStock: 0,
    ...over,
  });

const listed = async () => {
  const res = mockRes();
  await ctrl.listMyProducts(asSeller(sellerId), res);
  return res.body.data[0];
};

beforeEach(async () => {
  sellerId = new mongoose.Types.ObjectId();
  product = await Product.create({
    productName: "Shelf Life Test", ownerType: "seller", sellerId, companyId: null, unit: "Kilograms",
  });
});

describe("expired stock is not counted as sellable", () => {
  test("a good lot and an expired lot are reported SEPARATELY, not summed", async () => {
    await lot({ availableStock: 40, expiryDate: daysFromNow(120) });
    await lot({ availableStock: 25, expiryDate: daysFromNow(-3) });

    const p = await listed();
    // The bug this guards: 65 would read as sellable stock and let the seller
    // publish expired agricultural input.
    expect(p.totalStock).toBe(40);
    expect(p.expiredStock).toBe(25);
  });

  test("ONLY expired stock reads as zero sellable, with the held amount still visible", async () => {
    await lot({ availableStock: 30, expiryDate: daysFromNow(-1) });

    const p = await listed();
    expect(p.totalStock).toBe(0);
    expect(p.expiredStock).toBe(30);
  });

  test("a lot with NO expiry date counts as sellable", async () => {
    // The null guard matters: BSON sorts a missing/null field below every date,
    // so an unguarded `expiryDate < now` would call this expired.
    await lot({ availableStock: 12, expiryDate: null });

    const p = await listed();
    expect(p.totalStock).toBe(12);
    expect(p.expiredStock).toBe(0);
  });

  test("a lot expiring later TODAY is still sellable", async () => {
    await lot({ availableStock: 9, expiryDate: daysFromNow(0.5) });

    const p = await listed();
    expect(p.totalStock).toBe(9);
    expect(p.expiredStock).toBe(0);
  });

  test("a product with no stock at all reports zeros, not undefined", async () => {
    const p = await listed();
    expect(p.totalStock).toBe(0);
    expect(p.expiredStock).toBe(0);
    expect(p.lowStockThreshold).toBe(0);
  });
});

describe("lowStockThreshold drives the Low stock badge", () => {
  test("the highest threshold across the product's lots is returned", async () => {
    await lot({ availableStock: 5, lowStockThreshold: 3 });
    await lot({ availableStock: 5, lowStockThreshold: 10 });

    const p = await listed();
    expect(p.totalStock).toBe(10);
    // Highest wins — the earliest warning is the safe direction.
    expect(p.lowStockThreshold).toBe(10);
  });

  test("no threshold set reports 0, so the UI shows no badge", async () => {
    await lot({ availableStock: 100 });

    const p = await listed();
    expect(p.lowStockThreshold).toBe(0);
  });

  test("an expired lot's stock does not rescue a product from Low stock", async () => {
    await lot({ availableStock: 2, lowStockThreshold: 5, expiryDate: daysFromNow(60) });
    await lot({ availableStock: 500, lowStockThreshold: 5, expiryDate: daysFromNow(-10) });

    const p = await listed();
    // 2 sellable against a threshold of 5 → the UI badges this Low stock, even
    // though 502 units are physically on the shelf.
    expect(p.totalStock).toBe(2);
    expect(p.lowStockThreshold).toBe(5);
    expect(p.expiredStock).toBe(500);
  });
});

describe("stock stays scoped to the caller", () => {
  test("another seller's stock for the same product is never counted", async () => {
    await lot({ availableStock: 10, expiryDate: daysFromNow(30) });
    await Inventory.create({
      productId: product._id,
      ownerType: "seller",
      ownerId: new mongoose.Types.ObjectId(), // a different seller
      warehouseId: new mongoose.Types.ObjectId(),
      batchNumber: "OTHER-1",
      availableStock: 999,
    });

    const p = await listed();
    expect(p.totalStock).toBe(10);
  });
});
