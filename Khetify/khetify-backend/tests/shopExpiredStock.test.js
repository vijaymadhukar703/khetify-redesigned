const mongoose = require("mongoose");
const Product = require("../model/Company/productModel");
const SellerListing = require("../model/PC/SellerListing");
const Inventory = require("../model/Inventory/Inventory");
const shop = require("../services/shopCatalogService");

/**
 * EXPIRED STOCK MUST NOT BE SELLABLE ON THE STOREFRONT.
 *
 * Covers both aggregations that count seller stock — stockMap() (product page +
 * checkout) and the listProducts() $lookup (catalogue grid) — plus the rule that
 * a null expiry stays valid, which is what keeps the existing catalogue visible.
 */

const DAY = 86400000;
const daysFromNow = (n) => new Date(Date.now() + n * DAY);

let sellerId, companyId;

/** A published seller listing for a product, with the given inventory lots. */
async function listProductWithLots({ lots = [], productOver = {}, listingOver = {} } = {}) {
  const product = await Product.create({
    productName: "abc", companyId, productStatus: "active", unit: "Grams", mrp: 100, ...productOver,
  });
  const listing = await SellerListing.create({
    sellerId, companyId, productId: product._id, price: 100, status: "published", ...listingOver,
  });
  for (const [i, lot] of lots.entries()) {
    await Inventory.create({
      productId: product._id,
      ownerType: "seller",
      ownerId: sellerId,
      warehouseId: new mongoose.Types.ObjectId(),
      batchNumber: `L-${i}-${Math.random().toString(36).slice(2, 8)}`,
      availableStock: lot.qty,
      expiryDate: lot.expiry,
    });
  }
  return { product, listing };
}

beforeEach(() => {
  sellerId = new mongoose.Types.ObjectId();
  companyId = new mongoose.Types.ObjectId();
});

describe("1 + 4. the product page reports only sellable stock", () => {
  test("200 valid + 600 expired reads as 200, NOT 800", async () => {
    const { listing } = await listProductWithLots({
      lots: [
        { qty: 200, expiry: daysFromNow(90) },
        { qty: 600, expiry: daysFromNow(-5) },
      ],
    });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.availableStock).toBe(200);
    expect(shown.inStock).toBe(true);
  });

  test("a product whose stock is ENTIRELY expired reads as out of stock", async () => {
    // The trap: with the rows filtered out this would look like a product with
    // NO inventory at all and fall back to product.availableStock. The
    // conditional sum keeps the group present and reports a real 0.
    const { listing } = await listProductWithLots({
      lots: [{ qty: 500, expiry: daysFromNow(-1) }],
      productOver: { availableStock: 500 },
    });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.availableStock).toBe(0);
    expect(shown.inStock).toBe(false);
  });

  test("a lot expiring LATER TODAY is still sellable all day", async () => {
    // "Today" is normalised to midnight, so a lot dated today does not blink out
    // partway through the day.
    const today = new Date();
    today.setHours(6, 0, 0, 0);
    const { listing } = await listProductWithLots({ lots: [{ qty: 40, expiry: today }] });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.availableStock).toBe(40);
  });
});

describe("3. a null expiry stays VALID — the whole catalogue must not vanish", () => {
  test("lots with no expiry date count in full", async () => {
    const { listing } = await listProductWithLots({
      lots: [{ qty: 75, expiry: null }, { qty: 25, expiry: null }],
    });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.availableStock).toBe(100);
    expect(shown.inStock).toBe(true);
  });

  test("a listing with NO inventory rows still falls back to the product's own stock", async () => {
    // How a company product a seller holds no lots for keeps showing. This
    // fallback is exactly why the fix is a conditional SUM and not a $match.
    const { listing } = await listProductWithLots({
      lots: [],
      productOver: { availableStock: 42 },
    });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.availableStock).toBe(42);
  });

  test("mixed: null-expiry + valid + expired counts the first two only", async () => {
    const { listing } = await listProductWithLots({
      lots: [
        { qty: 10, expiry: null },
        { qty: 20, expiry: daysFromNow(30) },
        { qty: 900, expiry: daysFromNow(-30) },
      ],
    });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.availableStock).toBe(30);
  });
});

describe("2. checkout uses the same number as the product page", () => {
  test("resolveForCheckout reports 200, so 500 cannot be ordered", async () => {
    const { listing } = await listProductWithLots({
      lots: [
        { qty: 200, expiry: daysFromNow(90) },
        { qty: 600, expiry: daysFromNow(-5) },
      ],
    });

    const resolved = await shop.resolveForCheckout([String(listing._id)]);
    const line = resolved.get(String(listing._id));
    // resolveForCheckout feeds off stockMap(), so it inherits the same rule —
    // the page cannot say 200 while checkout quietly allows 800.
    expect(line.availableStock).toBe(200);
    expect(line.availableStock).toBeLessThan(500);

    const shown = await shop.getProduct(String(listing._id));
    expect(line.availableStock).toBe(shown.availableStock);
  });

  test("an all-expired product resolves to 0 at checkout", async () => {
    const { listing } = await listProductWithLots({
      lots: [{ qty: 300, expiry: daysFromNow(-2) }],
      productOver: { availableStock: 300 },
    });

    const resolved = await shop.resolveForCheckout([String(listing._id)]);
    expect(resolved.get(String(listing._id)).availableStock).toBe(0);
  });
});

describe("5. the catalogue grid agrees, and its filters still work", () => {
  test("listProducts reports the sellable number, not the shelf number", async () => {
    const { listing } = await listProductWithLots({
      lots: [
        { qty: 200, expiry: daysFromNow(90) },
        { qty: 600, expiry: daysFromNow(-5) },
      ],
    });

    const list = await shop.listProducts({});
    const row = list.items.find((i) => i.listingId === String(listing._id));
    expect(row.availableStock).toBe(200);
    expect(row.inStock).toBe(true);
  });

  test("an all-expired product shows out of stock in the grid too", async () => {
    const { listing } = await listProductWithLots({
      lots: [{ qty: 500, expiry: daysFromNow(-10) }],
      productOver: { availableStock: 500 },
    });

    const list = await shop.listProducts({});
    const row = list.items.find((i) => i.listingId === String(listing._id));
    expect(row.availableStock).toBe(0);
    expect(row.inStock).toBe(false);
  });

  test("search and category filtering are unaffected", async () => {
    await listProductWithLots({
      lots: [{ qty: 5, expiry: daysFromNow(30) }],
      productOver: { productName: "Neem Oil Spray", category: "pesticides" },
    });
    await listProductWithLots({
      lots: [{ qty: 5, expiry: daysFromNow(30) }],
      productOver: { productName: "Urea Bag", category: "fertilizers" },
    });

    const bySearch = await shop.listProducts({ search: "Neem" });
    expect(bySearch.items.map((i) => i.name)).toEqual(["Neem Oil Spray"]);

    const byCategory = await shop.listProducts({ category: "fertilizers" });
    expect(byCategory.items.map((i) => i.name)).toEqual(["Urea Bag"]);
  });

  test("the in-stock filter uses the sellable number", async () => {
    await listProductWithLots({
      lots: [{ qty: 100, expiry: daysFromNow(-1) }],
      productOver: { productName: "All Expired" },
    });
    await listProductWithLots({
      lots: [{ qty: 100, expiry: daysFromNow(60) }],
      productOver: { productName: "Still Good" },
    });

    // The param is inStockOnly; it filters on _inStock, which derives from the
    // same _stock the fix corrected.
    const list = await shop.listProducts({ inStockOnly: "true" });
    const names = list.items.map((i) => i.name);
    expect(names).toContain("Still Good");
    expect(names).not.toContain("All Expired");
  });
});
