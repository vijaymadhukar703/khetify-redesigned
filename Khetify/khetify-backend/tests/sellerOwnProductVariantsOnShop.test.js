const mongoose = require("mongoose");
const Product = require("../model/Company/productModel");
const SellerListing = require("../model/PC/SellerListing");
const shop = require("../services/shopCatalogService");
const pc = require("../controller/Seller/sellerPcController");
const ctrl = require("../controller/Seller/sellerMyProductController");
const { createMyProductBody, updateMyProductBody } = require("../validators/sellerMyProductValidators");

/**
 * VARIANTS ON THE STOREFRONT — the seller's OWN product must behave exactly
 * like a company product.
 *
 * THE PATH, for the record: variants never travel through SellerListing and are
 * never read via companyId. services/shopCatalogService.toShopVariants() reads
 * `product.variants` off the Product document, and toShopProduct() attaches it
 * for every listing regardless of owner. Publishing carries productId + price
 * only — for BOTH kinds. So the seller-own path is already the company path;
 * these tests exist to keep it that way.
 */

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const asSeller = (sellerId, body = {}) => ({
  user: { sellerId, principalType: "seller", role: "seller_admin", id: sellerId },
  body, params: {}, query: {},
});

const TWO_VARIANTS = [
  { label: "red", attributes: { Color: "red" }, sku: "UREA-RED" },
  { label: "yellow", attributes: { Color: "yellow" }, sku: "UREA-YELLO" },
];

let sellerId, companyId;
beforeEach(() => {
  sellerId = new mongoose.Types.ObjectId();
  companyId = new mongoose.Types.ObjectId();
});

/** Create one of the seller's own products through the real endpoint. */
async function createOwn(extra = {}) {
  const res = mockRes();
  await ctrl.createMyProduct(
    asSeller(sellerId, createMyProductBody.parse({
      productName: "Urea Test", mrp: 100, shelfLifeDays: 365, ...extra,
    })),
    res
  );
  expect(res.statusCode).toBe(201);
  return res.body.data;
}

/** Publish it the way the My Products modal does — productId + price, no companyId. */
async function publishOwn(productId, price = 250) {
  const res = mockRes();
  await pc.publishListing(asSeller(sellerId, { productId: String(productId), price }), res);
  expect(res.statusCode).toBe(201);
  return res.body.data;
}

describe("a seller-own product carries its variants to the storefront", () => {
  test("detail page: label, attributes and SKU all arrive", async () => {
    const product = await createOwn({ variants: TWO_VARIANTS });
    const listing = await publishOwn(product._id);

    const shown = await shop.getProduct(String(listing._id));

    expect(shown.variantType).toBe("multiple");
    expect(shown.variants).toHaveLength(2);
    // The COLOR selector is driven by `attributes`; the Specifications row
    // labelled "Variant SKU" is driven by `sku`. Both must be present.
    expect(shown.variants.map((v) => v.label)).toEqual(["red", "yellow"]);
    expect(shown.variants.map((v) => v.sku)).toEqual(["UREA-RED", "UREA-YELLO"]);
    expect(shown.variants[0].attributes).toEqual({ Color: "red" });
    expect(shown.variants[1].attributes).toEqual({ Color: "yellow" });
  });

  test("a variant with NO per-variant mrp still survives the payload filter", async () => {
    // toShopVariants keeps a row on label OR image OR mrp. The seller form
    // leaves the variant MRP column blank far more often than the company form
    // does (which pre-fills it), so `label` is what has to carry these rows —
    // a filter that required a price would drop every one of them.
    const product = await createOwn({ variants: TWO_VARIANTS });
    const listing = await publishOwn(product._id);

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.variants.every((v) => v.mrp === null)).toBe(true);
    expect(shown.variants).toHaveLength(2);
  });

  test("variants added by EDITING an existing product reach the storefront too", async () => {
    const product = await createOwn();
    expect(product.variants).toHaveLength(0);

    const req = asSeller(sellerId, updateMyProductBody.parse({ variants: TWO_VARIANTS }));
    req.params = { id: String(product._id) };
    const uRes = mockRes();
    await ctrl.updateMyProduct(req, uRes);
    expect(uRes.statusCode).toBe(200);
    expect(uRes.body.data.variantType).toBe("multiple");

    const listing = await publishOwn(product._id);
    const shown = await shop.getProduct(String(listing._id));
    expect(shown.variants.map((v) => v.sku)).toEqual(["UREA-RED", "UREA-YELLO"]);
  });

  test("the LIST path carries variants as well, not only the detail page", async () => {
    const product = await createOwn({ variants: TWO_VARIANTS });
    const listing = await publishOwn(product._id);

    const list = await shop.listProducts({});
    const row = list.items.find((i) => String(i.listingId) === String(listing._id));
    expect(row).toBeTruthy();
    expect(row.variants).toHaveLength(2);
    expect(row.variantType).toBe("multiple");
  });

  test("localisation does not strip the variants", async () => {
    const product = await createOwn({ variants: TWO_VARIANTS });
    const listing = await publishOwn(product._id);

    for (const lang of ["en", "hi"]) {
      const shown = await shop.getProduct(String(listing._id), lang);
      expect(shown.variants).toHaveLength(2);
      expect(shown.variants[0].sku).toBe("UREA-RED");
    }
  });

  test("a seller-own product with NO variants yields [] — no variant UI", async () => {
    const product = await createOwn();
    const listing = await publishOwn(product._id);

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.variants).toEqual([]);
    expect(shown.variantType).toBe("single");
  });
});

describe("the company product keeps behaving exactly as before", () => {
  test("a company listing's variants are shaped identically", async () => {
    const product = await Product.create({
      productName: "Soil Testing Kit",
      companyId,
      mrp: 500,
      productStatus: "active",
      variants: [
        { label: "red", attributes: { Color: "red" }, sku: "SOIL-RED", mrp: 500 },
        { label: "yellow", attributes: { Color: "yellow" }, sku: "SOIL-YELLO", mrp: 500 },
      ],
    });
    const listing = await SellerListing.create({
      sellerId, companyId, productId: product._id, price: 500, status: "published",
    });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.variants).toHaveLength(2);
    expect(shown.variants.map((v) => v.sku)).toEqual(["SOIL-RED", "SOIL-YELLO"]);
    expect(shown.variants[0].attributes).toEqual({ Color: "red" });
    // The company path still resolves a real company id; the seller-own one is
    // null. Both are valid, and neither affects the variants.
    expect(String(shown.companyId)).toBe(String(companyId));
  });

  test("company and seller-own variants come back in the SAME shape", async () => {
    const own = await createOwn({ variants: TWO_VARIANTS });
    const ownListing = await publishOwn(own._id);

    const coProduct = await Product.create({
      productName: "Soil Testing Kit", companyId, mrp: 500, productStatus: "active",
      variants: [{ label: "red", attributes: { Color: "red" }, sku: "SOIL-RED", mrp: 500 }],
    });
    const coListing = await SellerListing.create({
      sellerId, companyId, productId: coProduct._id, price: 500, status: "published",
    });

    const a = await shop.getProduct(String(ownListing._id));
    const b = await shop.getProduct(String(coListing._id));
    // Identical key set — the storefront cannot tell the two apart structurally,
    // which is the whole point: one path, not two.
    expect(Object.keys(a.variants[0]).sort()).toEqual(Object.keys(b.variants[0]).sort());
  });
});
