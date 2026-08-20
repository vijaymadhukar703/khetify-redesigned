const mongoose = require("mongoose");
const SellerListing = require("../model/PC/SellerListing");
const Product = require("../model/Company/productModel");
const Seller = require("../model/Seller/Seller");
const Company = require("../model/Company/Company");
const Inventory = require("../model/Inventory/Inventory");

/**
 * Public storefront catalog (customer-shop). Surfaces every seller's PUBLISHED
 * marketplace listing (SellerListing.status === "published" — i.e. exactly what
 * the seller creates via "Publish on marketplace") joined with its product,
 * seller, company and LIVE stock. No auth — a shopper browses freely and only
 * logs in at checkout. Nothing here is hardcoded: unpublishing a listing (or
 * deactivating the product) makes it disappear immediately.
 *
 * A "shop product" is a listing (not a bare product): the same product resold
 * by two sellers is two storefront cards, each priced/stocked by that seller.
 *
 * Stock is the seller's own availableStock (Inventory rows where
 * ownerType:"seller", ownerId:sellerId) — the ONLY number the marketplace reads
 * for "in stock?".
 */

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** The unit price a shopper pays: the seller's listing price, else product MRP/price. */
function listingPrice(listing, product) {
  if (listing.price != null) return listing.price;
  return product?.mrp ?? product?.price ?? 0;
}

/** Sum a seller's live availableStock for a set of (sellerId, productId) pairs.
 * Returns a Map keyed by `${sellerId}:${productId}` → number. */
async function stockMap(pairs) {
  if (!pairs.length) return new Map();
  const productIds = [...new Set(pairs.map((p) => String(p.productId)))].map((id) => new mongoose.Types.ObjectId(id));
  const sellerIds = [...new Set(pairs.map((p) => String(p.sellerId)))].map((id) => new mongoose.Types.ObjectId(id));
  const rows = await Inventory.aggregate([
    { $match: { ownerType: "seller", ownerId: { $in: sellerIds }, productId: { $in: productIds } } },
    { $group: { _id: { ownerId: "$ownerId", productId: "$productId" }, avail: { $sum: "$availableStock" } } },
  ]);
  const map = new Map();
  for (const r of rows) map.set(`${r._id.ownerId}:${r._id.productId}`, r.avail);
  return map;
}

/** Shape one listing+product+seller into the card/detail payload sent to the UI. */
function toShopProduct(listing, product, seller, company, availableStock) {
  const price = listingPrice(listing, product);
  const stock = Number.isFinite(availableStock) ? availableStock : (product.availableStock ?? 0);
  return {
    listingId: String(listing._id),
    sellerId: String(listing.sellerId),
    companyId: String(listing.companyId),
    productId: String(product._id),
    name: product.productName,
    brand: product.brandName,
    sku: product.skuNumber || null,
    category: product.category,
    description: product.description,
    unit: product.unit,
    unitType: product.unitType,
    unitValue: product.unitValue ?? null,
    // Already rendered by ShopProductDetail's usage block — it was simply never
    // captured on the Company upload form until now.
    usageInstructions: product.usageInstructions || null,
    images: product.productImages || [],
    price,
    mrp: product.mrp ?? null,
    gstPercentage: product.gstPercentage || 0,
    availableStock: stock,
    inStock: stock > 0,
    minimumOrderQuantity: product.minimumOrderQuantity || 1,
    seller: seller
      ? {
          id: String(seller._id),
          name: seller.sellerInfo?.businessName || seller.contact?.ownerName || "Seller",
          city: seller.contact?.address?.city,
          state: seller.contact?.address?.state,
        }
      : null,
    companyName: company?.companyInfo?.companyName || null,
    publishedAt: listing.publishedAt,
  };
}

/**
 * List published storefront products.
 * @param {object} q { search, category, minPrice, maxPrice, sort, page, limit, inStockOnly }
 */
/* ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS WAS REWRITTEN
 *
 * The old listProducts() loaded EVERY published listing, then every referenced
 * product / seller / company, then ran a stock aggregate over the whole
 * catalogue — and only THEN filtered, sorted and paginated in JavaScript. So
 * asking for 8 search suggestions did the same work as asking for the entire
 * shop. It was O(catalogue) on every single request, and ~99% of that work was
 * thrown away.
 *
 * Now Mongo does the work:
 *   • search resolves to ids FIRST, against one indexed collection
 *   • the join, filters, sort and pagination all run inside one aggregation
 *   • seller + company are joined only for the ONE PAGE being returned
 *   • categories come from a cached aggregate instead of a full catalogue scan
 *
 * getProduct() and resolveForCheckout() below are untouched — checkout depends
 * on them and they were already point lookups.
 * ───────────────────────────────────────────────────────────────────────────── */

// Real collection names, read off the models — never hardcode "products" etc.
const C_PRODUCTS = Product.collection.name;
const C_SELLERS = Seller.collection.name;
const C_COMPANIES = Company.collection.name;
const C_INVENTORY = Inventory.collection.name;

// A user-typed search string is NOT a regex. Escape it, or "a+b" blows up.
const escapeRx = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Caps the $in list when a search matches a huge slice of the catalogue.
const SEARCH_PRODUCT_CAP = 2000;
const SEARCH_SELLER_CAP = 200;

const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

/* A facet filter can be multi-select ("PUMA" AND "NIKE"), so it arrives either
   as a single string or as an array. Normalise both to a clean array. */
const many = (v) => {
  if (v == null || v === "") return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => String(x).trim()).filter(Boolean);
};

/* Categories change rarely but are requested on every home/dashboard load, so a
   short TTL cache turns a repeated aggregate into a single map lookup. */
let categoryCache = { at: 0, list: [] };
const CATEGORY_TTL_MS = 5 * 60 * 1000;

async function listCategories() {
  if (Date.now() - categoryCache.at < CATEGORY_TTL_MS) return categoryCache.list;

  const rows = await SellerListing.aggregate([
    { $match: { status: "published" } },
    { $group: { _id: "$productId" } },
    { $lookup: { from: C_PRODUCTS, localField: "_id", foreignField: "_id", as: "p" } },
    { $unwind: "$p" },
    { $match: { "p.productStatus": "active", "p.category": { $nin: [null, ""] } } },
    { $group: { _id: "$p.category" } },
    { $sort: { _id: 1 } },
  ]);

  categoryCache = { at: Date.now(), list: rows.map((r) => r._id) };
  return categoryCache.list;
}

/**
 * Resolve a free-text search to the ids it matches, using ONE indexed
 * collection per entity instead of scanning the whole join graph.
 * Returns null when there is no search (caller then skips the id filter).
 */
async function searchToIds(search) {
  const rx = new RegExp(escapeRx(search), "i");

  const [products, sellers] = await Promise.all([
    Product.find({
      productStatus: "active",
      $or: [{ productName: rx }, { brandName: rx }, { category: rx }, { skuNumber: rx }],
    })
      .select("_id")
      .limit(SEARCH_PRODUCT_CAP)
      .lean(),
    Seller.find({ "sellerInfo.businessName": rx })
      .select("_id")
      .limit(SEARCH_SELLER_CAP)
      .lean(),
  ]);

  return {
    productIds: products.map((p) => p._id),
    sellerIds: sellers.map((s) => s._id),
  };
}

async function listProducts(q = {}) {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(60, Math.max(1, Number(q.limit) || 24));
  const skip = (page - 1) * limit;

  const match = { status: "published" };

  // 1. Search → ids, from indexed single-collection queries.
  const search = (q.search || "").trim();
  if (search) {
    const { productIds, sellerIds } = await searchToIds(search);
    if (!productIds.length && !sellerIds.length) {
      return {
        items: [], total: 0, page, limit, pages: 1, sort: q.sort || "relevance",
        priceRange: { min: 0, max: 0 },
        facets: { categories: [], brands: [], sellers: [], discounts: [] },
        categories: await listCategories(),
      };
    }
    const or = [];
    if (productIds.length) or.push({ productId: { $in: productIds } });
    if (sellerIds.length) or.push({ sellerId: { $in: sellerIds } });
    match.$or = or;
  }

  const pipeline = [
    { $match: match },
    { $lookup: { from: C_PRODUCTS, localField: "productId", foreignField: "_id", as: "p" } },
    { $unwind: "$p" },
    { $match: { "p.productStatus": "active" } }, // inactive product → listing hidden
  ];

  /* RELEVANCE. Sorting search results by "newest" is wrong — someone typing
     "wheat" wants the wheat, not whatever was listed most recently. So when
     there IS a search we score each row and rank by it:

        exact name match        100
        name starts with        +50   ("wheat seed" for "wheat")
        name contains anywhere  +20   ("organic wheat" for "wheat")
        brand contains          +8
        category contains       +5

     $indexOfCP returns -1 when absent, 0 when the term is at the start. */
  if (search) {
    const needle = search.toLowerCase();
    const at = (field) => ({
      $indexOfCP: [{ $toLower: { $ifNull: [field, ""] } }, needle],
    });
    pipeline.push({
      $addFields: {
        _score: {
          $add: [
            { $cond: [{ $eq: [{ $toLower: "$p.productName" }, needle] }, 100, 0] },
            { $cond: [{ $eq: [at("$p.productName"), 0] }, 50, 0] },
            { $cond: [{ $gte: [at("$p.productName"), 0] }, 20, 0] },
            { $cond: [{ $gte: [at("$p.brandName"), 0] }, 8, 0] },
            { $cond: [{ $gte: [at("$p.category"), 0] }, 5, 0] },
          ],
        },
      },
    });
  }

  // 2. Effective price — mirrors listingPrice(): listing price, else MRP, else 0.
  pipeline.push({
    $addFields: {
      _price: { $ifNull: ["$price", { $ifNull: ["$p.mrp", { $ifNull: ["$p.price", 0] }] }] },
    },
  });

  const minPrice = num(q.minPrice);
  const maxPrice = num(q.maxPrice);

  // 3. Live seller stock. This runs AFTER the search/category filters, so it
  //    only touches the survivors — not the whole catalogue like before.
  pipeline.push(
    {
      $lookup: {
        from: C_INVENTORY,
        let: { sid: "$sellerId", pid: "$productId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$ownerType", "seller"] },
                  { $eq: ["$ownerId", "$$sid"] },
                  { $eq: ["$productId", "$$pid"] },
                ],
              },
            },
          },
          { $group: { _id: null, avail: { $sum: "$availableStock" } } },
        ],
        as: "_inv",
      },
    },
    {
      $addFields: {
        _stock: {
          $ifNull: [{ $arrayElemAt: ["$_inv.avail", 0] }, { $ifNull: ["$p.availableStock", 0] }],
        },
      },
    },
    { $addFields: { _inStock: { $gt: ["$_stock", 0] } } },
    /* Discount % — the "50% off" refinement every marketplace has. Only real
       when the product carries an MRP above the price actually charged. */
    {
      $addFields: {
        _discount: {
          $let: {
            vars: { mrp: { $ifNull: ["$p.mrp", 0] } },
            in: {
              $cond: [
                { $gt: ["$$mrp", "$_price"] },
                {
                  $floor: {
                    $multiply: [{ $divide: [{ $subtract: ["$$mrp", "$_price"] }, "$$mrp"] }, 100],
                  },
                },
                0,
              ],
            },
          },
        },
      },
    }
  );

  /* 4. Ordering. In-stock always outranks out-of-stock — that rule is unchanged.
        The DEFAULT differs by intent: a search ranks by relevance, browsing
        ranks by newest. */
  const sortKey = q.sort || (search ? "relevance" : "newest");
  const sort =
    {
      relevance: search
        ? { _inStock: -1, _score: -1, publishedAt: -1 }
        : { _inStock: -1, publishedAt: -1 }, // no search → nothing to be relevant to
      price_asc: { _inStock: -1, _price: 1 },
      price_desc: { _inStock: -1, _price: -1 },
      name_asc: { _inStock: -1, "p.productName": 1 },
      newest: { _inStock: -1, publishedAt: -1 },
    }[sortKey] || { _inStock: -1, publishedAt: -1 };

  /* ── 5. REFINEMENTS (facets) ──────────────────────────────────────────────
     This is what the sidebar on Flipkart / Amazon / Myntra actually is: not the
     whole catalogue's categories, but the ones PRESENT IN THESE RESULTS, with
     counts — "Seeds (32)", "PUMA (18)".

     THE RULE THAT MAKES FACETING WORK: a facet must EXCLUDE ITS OWN FILTER.
     If the brand facet were computed after the brand filter, ticking "PUMA"
     would leave the sidebar showing only "PUMA (18)" — the shopper could never
     see that 9 NIKE also matched, or add it. So each facet applies every filter
     EXCEPT its own. Price and stock apply everywhere, because they genuinely
     narrow what is on offer.
     ───────────────────────────────────────────────────────────────────────── */
  const categories = many(q.category);
  const brands = many(q.brand);
  const sellers = many(q.seller);
  const minDiscount = num(q.minDiscount);

  const fCategory = categories.length ? [{ $match: { "p.category": { $in: categories } } }] : [];
  const fBrand = brands.length ? [{ $match: { "p.brandName": { $in: brands } } }] : [];
  const fSeller = sellers.length
    ? [{ $match: { sellerId: { $in: sellers.filter(mongoose.isValidObjectId).map((id) => new mongoose.Types.ObjectId(id)) } } }]
    : [];
  const fDiscount = minDiscount != null ? [{ $match: { _discount: { $gte: minDiscount } } }] : [];

  const fPrice = [];
  if (minPrice != null || maxPrice != null) {
    const cond = {};
    if (minPrice != null) cond.$gte = minPrice;
    if (maxPrice != null) cond.$lte = maxPrice;
    fPrice.push({ $match: { _price: cond } });
  }

  const fStock =
    q.inStockOnly === "true" || q.inStockOnly === true ? [{ $match: { _inStock: true } }] : [];

  const countBy = (field) => [
    { $match: { [field]: { $nin: [null, ""] } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 40 },
    { $project: { _id: 0, value: "$_id", count: 1 } },
  ];

  // "25% off or more" style buckets, each counting everything at or above it.
  const DISCOUNT_TIERS = [10, 25, 40, 50, 60];
  const discountFacet = [
    ...fCategory, ...fBrand, ...fSeller, ...fPrice, ...fStock,
    {
      $group: {
        _id: null,
        ...Object.fromEntries(
          DISCOUNT_TIERS.map((t) => [
            `t${t}`,
            { $sum: { $cond: [{ $gte: ["$_discount", t] }, 1, 0] } },
          ])
        ),
      },
    },
  ];

  const applyAll = [...fCategory, ...fBrand, ...fSeller, ...fDiscount, ...fPrice, ...fStock];

  pipeline.push({
    $facet: {
      // Price bounds, measured BEFORE the price filter — otherwise dragging the
      // range would keep collapsing its own bounds.
      priceRange: [
        ...fCategory, ...fBrand, ...fSeller, ...fDiscount, ...fStock,
        { $group: { _id: null, min: { $min: "$_price" }, max: { $max: "$_price" } } },
      ],

      // Each facet excludes itself.
      categories: [...fBrand, ...fSeller, ...fDiscount, ...fPrice, ...fStock, ...countBy("p.category")],
      brands: [...fCategory, ...fSeller, ...fDiscount, ...fPrice, ...fStock, ...countBy("p.brandName")],
      sellers: [
        ...fCategory, ...fBrand, ...fDiscount, ...fPrice, ...fStock,
        { $group: { _id: "$sellerId", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ],
      discounts: discountFacet,

      total: [...applyAll, { $count: "n" }],
      items: [
        ...applyAll,
        { $sort: sort },
        { $skip: skip },
        { $limit: limit },
        // Seller + company joined AFTER $skip/$limit — one page hydrated, not
        // the entire result set.
        { $lookup: { from: C_SELLERS, localField: "sellerId", foreignField: "_id", as: "s" } },
        { $lookup: { from: C_COMPANIES, localField: "companyId", foreignField: "_id", as: "c" } },
      ],
    },
  });

  const [res] = await SellerListing.aggregate(pipeline).allowDiskUse(true);
  const total = res?.total?.[0]?.n || 0;

  const items = (res?.items || []).map((row) =>
    toShopProduct(row, row.p, row.s?.[0], row.c?.[0], row._stock)
  );

  // The seller facet groups by id; resolve the ids to names in one query.
  const sellerRows = res?.sellers || [];
  let sellerFacet = [];
  if (sellerRows.length) {
    const docs = await Seller.find({ _id: { $in: sellerRows.map((r) => r._id) } })
      .select("sellerInfo.businessName contact.ownerName")
      .lean();
    const nameById = new Map(
      docs.map((d) => [
        String(d._id),
        d.sellerInfo?.businessName || d.contact?.ownerName || "Khetify seller",
      ])
    );
    sellerFacet = sellerRows.map((r) => ({
      value: String(r._id),
      label: nameById.get(String(r._id)) || "Khetify seller",
      count: r.count,
    }));
  }

  const d = res?.discounts?.[0] || {};
  const discountFacetOut = DISCOUNT_TIERS
    .map((t) => ({ value: t, label: `${t}% off or more`, count: d[`t${t}`] || 0 }))
    .filter((x) => x.count > 0); // never offer a refinement that leads to zero

  const range = res?.priceRange?.[0];

  return {
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    sort: sortKey,
    priceRange: range
      ? { min: Math.floor(range.min ?? 0), max: Math.ceil(range.max ?? 0) }
      : { min: 0, max: 0 },

    // 🔍 The refinement sidebar — describes THESE RESULTS, not the catalogue.
    facets: {
      categories: res?.categories || [],
      brands: res?.brands || [],
      sellers: sellerFacet,
      discounts: discountFacetOut,
    },

    // Full catalogue category list — for the BROWSE page's nav, not for search.
    categories: await listCategories(),
  };
}

/**
 * Lightweight autocomplete for the header search box.
 *
 * This is the endpoint the search-as-you-type dropdown should call — NOT
 * listProducts(). The dropdown only renders a name and a link, so it has no
 * business joining sellers, companies or running a stock aggregation. Two small
 * indexed queries, no aggregation, ~8 rows.
 */
async function suggest(term, limit = 8) {
  const q = String(term || "").trim();
  if (q.length < 2) return []; // one letter matches half the shop — not useful

  const cap = Math.min(12, Math.max(1, Number(limit) || 8));
  const rx = new RegExp(escapeRx(q), "i");

  // Match on the product name only — that is what people actually type.
  const products = await Product.find({ productStatus: "active", productName: rx })
    .select("productName")
    .limit(50)
    .lean();
  if (!products.length) return [];

  // Keep only products that a seller has actually published.
  const listings = await SellerListing.find({
    status: "published",
    productId: { $in: products.map((p) => p._id) },
  })
    .select("_id productId")
    .lean();
  if (!listings.length) return [];

  const nameById = new Map(products.map((p) => [String(p._id), p.productName]));

  // One suggestion per PRODUCT (not per listing) — the same seed listed by five
  // sellers should not fill the dropdown with five identical rows.
  const seen = new Set();
  const out = [];
  for (const l of listings) {
    const key = String(l.productId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ listingId: String(l._id), name: nameById.get(key) });
    if (out.length >= cap) break;
  }
  return out;
}

async function getProduct(listingId) {
  if (!mongoose.isValidObjectId(listingId)) throw httpErr("Product not found", 404);
  const listing = await SellerListing.findOne({ _id: listingId, status: "published" }).lean();
  if (!listing) throw httpErr("Product not found", 404);
  const [product, seller, company, stocks] = await Promise.all([
    Product.findOne({ _id: listing.productId, productStatus: "active" }).lean(),
    Seller.findById(listing.sellerId).select("sellerInfo contact").lean(),
    Company.findById(listing.companyId).select("companyInfo.companyName").lean(),
    stockMap([{ sellerId: listing.sellerId, productId: listing.productId }]),
  ]);
  if (!product) throw httpErr("Product not found", 404);
  const stock = stocks.get(`${listing.sellerId}:${listing.productId}`);
  return toShopProduct(listing, product, seller, company, stock);
}

/**
 * Resolve a set of listing ids into trusted, priced+stocked line data for
 * checkout — NEVER trust prices/stock from the client. Returns a map keyed by
 * listingId.
 */
async function resolveForCheckout(listingIds = []) {
  const ids = [...new Set(listingIds.map(String))].filter((id) => mongoose.isValidObjectId(id));
  const listings = await SellerListing.find({ _id: { $in: ids }, status: "published" }).lean();
  const productIds = listings.map((l) => l.productId);
  const [products, stocks] = await Promise.all([
    Product.find({ _id: { $in: productIds }, productStatus: "active" }).lean(),
    stockMap(listings.map((l) => ({ sellerId: l.sellerId, productId: l.productId }))),
  ]);
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  const map = new Map();
  for (const l of listings) {
    const product = productMap.get(String(l.productId));
    if (!product) continue;
    const stock = stocks.get(`${l.sellerId}:${l.productId}`);
    map.set(String(l._id), {
      listingId: String(l._id),
      sellerId: String(l.sellerId),
      companyId: String(l.companyId),
      productId: String(l.productId),
      name: product.productName,
      price: listingPrice(l, product),
      gstPercentage: product.gstPercentage || 0,
      hsnCode: product.hsnCode,
      // 🖼️ Snapshot the image onto the checkout resolution so the order line can
      //    store it. An order should show what the shopper actually bought, even
      //    if the seller changes the product photo (or delists it) years later.
      image: product.productImages?.[0] || null,
      availableStock: Number.isFinite(stock) ? stock : (product.availableStock ?? 0),
    });
  }
  return map;
}

module.exports = { listProducts, listCategories, suggest, getProduct, resolveForCheckout };