const mongoose = require("mongoose");
const Product = require("../model/Company/productModel");
const SellerListing = require("../model/PC/SellerListing");
const Inventory = require("../model/Inventory/Inventory");
const shop = require("../services/shopCatalogService");

/**
 * PER-VARIANT STOCK on the product detail page.
 *
 * The rule that matters most: `variantStock` is NULL — not {} — for a product
 * whose stock is not tracked per variant. Null means "fall back to the product
 * total"; an empty object would read as "every variant is zero" and mark the
 * whole company catalogue out of stock.
 */

const DAY = 86400000;
const daysFromNow = (n) => new Date(Date.now() + n * DAY);

let sellerId, companyId;

async function publish({ variants = [], lots = [], productOver = {} } = {}) {
  const product = await Product.create({
    productName: "abc", companyId, productStatus: "active", unit: "Grams", mrp: 100,
    variants, ...productOver,
  });
  const listing = await SellerListing.create({
    sellerId, companyId, productId: product._id, price: 100, status: "published",
  });
  for (const [i, lot] of lots.entries()) {
    await Inventory.create({
      productId: product._id,
      ownerType: "seller",
      ownerId: sellerId,
      warehouseId: new mongoose.Types.ObjectId(),
      batchNumber: `L-${i}-${Math.random().toString(36).slice(2, 8)}`,
      availableStock: lot.qty,
      expiryDate: lot.expiry ?? null,
      variantSku: lot.variantSku ?? null,
    });
  }
  return { product, listing };
}

const TWO = [
  { label: "yellow", attributes: { Color: "yellow" }, sku: "ABC-YELLO" },
  { label: "red", attributes: { Color: "red" }, sku: "ABC-RED" },
];

beforeEach(() => {
  sellerId = new mongoose.Types.ObjectId();
  companyId = new mongoose.Types.ObjectId();
});

describe("1 + 2. each variant reports its own stock, and they add up to the total", () => {
  test("yellow 150 + red 50 → per-variant map, total 200", async () => {
    const { listing } = await publish({
      variants: TWO,
      lots: [
        { qty: 150, variantSku: "ABC-YELLO", expiry: daysFromNow(90) },
        { qty: 50, variantSku: "ABC-RED", expiry: daysFromNow(90) },
      ],
    });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.variantStock).toEqual({ "ABC-YELLO": 150, "ABC-RED": 50 });
    // The total the page shows with nothing selected is unchanged, and the two
    // variants add up to it.
    expect(shown.availableStock).toBe(200);
    expect(Object.values(shown.variantStock).reduce((a, b) => a + b, 0)).toBe(200);
  });

  test("expired lots are excluded per variant too", async () => {
    const { listing } = await publish({
      variants: TWO,
      lots: [
        { qty: 150, variantSku: "ABC-YELLO", expiry: daysFromNow(90) },
        { qty: 900, variantSku: "ABC-YELLO", expiry: daysFromNow(-3) },
        { qty: 50, variantSku: "ABC-RED", expiry: null },
      ],
    });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.variantStock).toEqual({ "ABC-YELLO": 150, "ABC-RED": 50 });
    expect(shown.availableStock).toBe(200);
  });
});

describe("3. a variant with nothing left reads as zero, its sibling does not", () => {
  test("red sold out, yellow still stocked", async () => {
    const { listing } = await publish({
      variants: TWO,
      lots: [
        { qty: 200, variantSku: "ABC-YELLO", expiry: daysFromNow(90) },
        { qty: 0, variantSku: "ABC-RED", expiry: daysFromNow(90) },
      ],
    });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.variantStock["ABC-RED"]).toBe(0);
    expect(shown.variantStock["ABC-YELLO"]).toBe(200);
  });

  test("a variant with NO lot at all is simply absent — the page reads that as 0", async () => {
    const { listing } = await publish({
      variants: TWO,
      lots: [{ qty: 200, variantSku: "ABC-YELLO", expiry: daysFromNow(90) }],
    });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.variantStock).toEqual({ "ABC-YELLO": 200 });
    expect(shown.variantStock["ABC-RED"]).toBeUndefined();
  });
});

describe("4. products that are NOT variant-tracked keep the old behaviour", () => {
  test("a COMPANY product's lots carry no variantSku → variantStock is null", async () => {
    // The company catalogue must never go dark because of this feature.
    const { listing } = await publish({
      variants: TWO,
      lots: [{ qty: 300, expiry: daysFromNow(90) }], // no variantSku
    });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.variantStock).toBeNull();
    // Null, NOT {} — an empty object would read as "all variants zero".
    expect(shown.variantStock).not.toEqual({});
    expect(shown.availableStock).toBe(300);
    expect(shown.inStock).toBe(true);
  });

  test("a product with no inventory rows at all → variantStock null", async () => {
    const { listing } = await publish({ variants: TWO, lots: [], productOver: { availableStock: 42 } });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.variantStock).toBeNull();
    expect(shown.availableStock).toBe(42);
  });

  test("a product with NO variants → variantStock null, total unchanged", async () => {
    const { listing } = await publish({
      lots: [{ qty: 60, expiry: daysFromNow(30) }],
    });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.variantStock).toBeNull();
    expect(shown.availableStock).toBe(60);
  });

  test("mixed lots: only the variant-tagged ones enter the map, total counts both", async () => {
    const { listing } = await publish({
      variants: TWO,
      lots: [
        { qty: 100, variantSku: "ABC-YELLO", expiry: daysFromNow(90) },
        { qty: 25, expiry: daysFromNow(90) }, // untagged, older stock
      ],
    });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.variantStock).toEqual({ "ABC-YELLO": 100 });
    // The untagged 25 is still part of the product total — nothing is lost.
    expect(shown.availableStock).toBe(125);
  });
});

describe("5. the rest of the storefront is untouched", () => {
  test("the catalogue grid carries no variantStock and the same totals", async () => {
    const { listing } = await publish({
      variants: TWO,
      lots: [
        { qty: 150, variantSku: "ABC-YELLO", expiry: daysFromNow(90) },
        { qty: 50, variantSku: "ABC-RED", expiry: daysFromNow(90) },
      ],
    });

    const list = await shop.listProducts({});
    const row = list.items.find((i) => i.listingId === String(listing._id));
    // The grid shows the product total, exactly as before — no per-variant
    // grouping leaked into it.
    expect(row.availableStock).toBe(200);
    expect(row.variantStock).toBeNull();
  });

  test("search and category still work", async () => {
    await publish({ lots: [{ qty: 5, expiry: daysFromNow(30) }], productOver: { productName: "Neem Oil", category: "pesticides" } });
    await publish({ lots: [{ qty: 5, expiry: daysFromNow(30) }], productOver: { productName: "Urea Bag", category: "fertilizers" } });

    expect((await shop.listProducts({ search: "Neem" })).items.map((i) => i.name)).toEqual(["Neem Oil"]);
    expect((await shop.listProducts({ category: "fertilizers" })).items.map((i) => i.name)).toEqual(["Urea Bag"]);
  });

  test("checkout still resolves the product TOTAL (variant-aware checkout is separate work)", async () => {
    const { listing } = await publish({
      variants: TWO,
      lots: [
        { qty: 150, variantSku: "ABC-YELLO", expiry: daysFromNow(90) },
        { qty: 50, variantSku: "ABC-RED", expiry: daysFromNow(90) },
      ],
    });

    const resolved = await shop.resolveForCheckout([String(listing._id)]);
    expect(resolved.get(String(listing._id)).availableStock).toBe(200);
  });
});
