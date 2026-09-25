const mongoose = require("mongoose");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const ctrl = require("../controller/Seller/sellerMyProductController");
const { createMyProductBody, addMyProductStockBody } = require("../validators/sellerMyProductValidators");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const asSeller = (sellerId, body = {}, query = {}) => ({
  user: { sellerId, principalType: "seller", role: "seller_admin", id: sellerId },
  body, query, params: {},
});

let sellerId, wh;

/** Create one of the seller's own products through the real create endpoint. */
async function makeProduct(extra = {}) {
  const res = mockRes();
  await ctrl.createMyProduct(
    // shelfLifeDays is REQUIRED on create now — Add Stock derives each lot's
    // expiry from it, so a product without one would produce lots the expiry
    // filters and FEFO picking cannot see.
    asSeller(sellerId, createMyProductBody.parse({ productName: "Test Product", mrp: 100, shelfLifeDays: 365, ...extra })),
    res
  );
  expect(res.statusCode).toBe(201);
  return res.body.data;
}

/** Post to the real POST /stock handler. */
async function addStock(body) {
  const res = mockRes();
  await ctrl.addMyProductStock(asSeller(sellerId, addMyProductStockBody.parse(body)), res);
  return res;
}

beforeEach(async () => {
  sellerId = new mongoose.Types.ObjectId();
  wh = await Warehouse.create({ sellerId, name: "Seller WH" });
});

describe("variant stock is stored, and variants never merge into one row", () => {
  test("Red and Yellow of the SAME product become TWO rows, each with its variant", async () => {
    const product = await makeProduct({
      unit: "Pieces",
      variants: [
        { label: "Red", attributes: { Color: "Red" }, sku: "TP-RED" },
        { label: "Yellow", attributes: { Color: "Yellow" }, sku: "TP-YEL" },
      ],
    });

    const red = await addStock({ productId: String(product._id), warehouseId: String(wh._id), qty: 30, variantSku: "TP-RED" });
    const yellow = await addStock({ productId: String(product._id), warehouseId: String(wh._id), qty: 12, variantSku: "TP-YEL" });
    expect(red.statusCode).toBe(201);
    expect(yellow.statusCode).toBe(201);

    // TWO distinct Inventory rows — the merge this bug caused is gone.
    const rows = await Inventory.find({ productId: product._id, ownerType: "seller", ownerId: sellerId }).lean();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.variantSku).sort()).toEqual(["TP-RED", "TP-YEL"]);
    expect(rows.find((r) => r.variantSku === "TP-RED").availableStock).toBe(30);
    expect(rows.find((r) => r.variantSku === "TP-YEL").availableStock).toBe(12);

    // ...and GET /stock hands the variant to the UI.
    const listRes = mockRes();
    await ctrl.getMyProductStock(asSeller(sellerId, {}, {}), listRes);
    expect(listRes.body.data).toHaveLength(2);
    expect(listRes.body.data.map((r) => r.variantSku).sort()).toEqual(["TP-RED", "TP-YEL"]);
  });

  test("re-stocking the SAME variant tops up its own row, it does not make a third", async () => {
    const product = await makeProduct({
      variants: [{ label: "Red", sku: "TP-RED" }, { label: "Yellow", sku: "TP-YEL" }],
    });
    const first = await addStock({ productId: String(product._id), warehouseId: String(wh._id), qty: 10, variantSku: "TP-RED" });
    // Same lot number → same row, quantity added.
    await addStock({
      productId: String(product._id), warehouseId: String(wh._id), qty: 5,
      variantSku: "TP-RED", lotNumber: first.body.data.lotNumber,
    });

    const rows = await Inventory.find({ productId: product._id, ownerType: "seller", ownerId: sellerId }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].availableStock).toBe(15);
  });

  test("a multi-variant product REFUSES stock with no variant (400)", async () => {
    const product = await makeProduct({ variants: [{ label: "Red", sku: "TP-RED" }] });
    const res = await addStock({ productId: String(product._id), warehouseId: String(wh._id), qty: 5 });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/which variant/i);
  });

  test("a variant that isn't the product's is refused, not silently stored", async () => {
    const product = await makeProduct({ variants: [{ label: "Red", sku: "TP-RED" }] });
    const res = await addStock({ productId: String(product._id), warehouseId: String(wh._id), qty: 5, variantSku: "TP-BLUE" });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/not a variant/i);
  });

  test("a SINGLE-variant product still works and stores variantSku null", async () => {
    const product = await makeProduct({ unit: "Kilograms" });
    const res = await addStock({ productId: String(product._id), warehouseId: String(wh._id), qty: 7 });
    expect(res.statusCode).toBe(201);
    const rows = await Inventory.find({ productId: product._id, ownerType: "seller", ownerId: sellerId }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].variantSku).toBeNull();
    expect(rows[0].availableStock).toBe(7);
  });

  test("reusing ONE lot number across two variants is refused with a clear message", async () => {
    const product = await makeProduct({
      variants: [{ label: "Red", sku: "TP-RED" }, { label: "Yellow", sku: "TP-YEL" }],
    });
    await addStock({ productId: String(product._id), warehouseId: String(wh._id), qty: 5, variantSku: "TP-RED", lotNumber: "SHARED-1" });
    const res = await addStock({ productId: String(product._id), warehouseId: String(wh._id), qty: 5, variantSku: "TP-YEL", lotNumber: "SHARED-1" });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/already used for another variant/i);
  });
});

describe("the unit shown under QTY is the product's own Unit of Measurement", () => {
  test("GET /stock carries the product's `unit` through untouched", async () => {
    const product = await makeProduct({ unit: "Kilograms", unitValue: 50 });
    await addStock({ productId: String(product._id), warehouseId: String(wh._id), qty: 4 });

    const res = mockRes();
    await ctrl.getMyProductStock(asSeller(sellerId, {}, {}), res);
    // Not "Grams", not the "kg" weightUnit default, not the "cm" dimensionUnit
    // default — exactly what the seller picked.
    expect(res.body.data[0].productId.unit).toBe("Kilograms");
  });

  test("a product with NO unit reports none, so the UI can show nothing", async () => {
    const product = await makeProduct({});
    await addStock({ productId: String(product._id), warehouseId: String(wh._id), qty: 4 });

    const res = mockRes();
    await ctrl.getMyProductStock(asSeller(sellerId, {}, {}), res);
    const p = res.body.data[0].productId;
    expect(p.unit || "").toBe("");
    // The two defaulted unit fields must NOT leak into the payload as a
    // stand-in for the real one.
    expect(p.weightUnit).toBeUndefined();
    expect(p.dimensionUnit).toBeUndefined();
  });
});
