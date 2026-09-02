const mongoose = require("mongoose");
const Product = require("../../model/Company/productModel");
const Seller = require("../../model/Seller/Seller");
const SellerDocument = require("../../model/PC/SellerDocument");
const Inventory = require("../../model/Inventory/Inventory");
const Warehouse = require("../../model/Warehouse/Warehouse");
const sellerOwnStockService = require("../../services/sellerOwnStockService");
const { warehouseScope } = require("../../services/warehouseScope");

/**
 * MY PRODUCTS — the seller's OWN catalog plus their own (old/existing) stock.
 *
 * Seller products live in the SAME `Product` collection as company products,
 * marked by `ownerType: "seller"` + `sellerId`. That is what keeps marketplace
 * publish, orders, stock-cut, pick lists and shipments working — 22 models ref
 * "Product", so a parallel collection would break every one of them.
 *
 * THE ONE RULE IN THIS FILE: every query — read AND write — carries BOTH
 * `ownerType: "seller"` AND `sellerId: req.user.sellerId`. `sellerId` alone
 * would be satisfiable by a stray company row; `ownerType` alone is scoped to
 * nobody. Together they are a seller's own products and nothing else.
 *
 * (The mirror rule, in model/Company/productModel.js: the COMPANY side must NOT
 * filter on `ownerType: "company"` — legacy rows predate the field and .lean()
 * applies no default, so such a filter would hide them. Company queries are
 * already scoped by companyId.)
 */

/**
 * HORTICULTURE PAPERWORK GATE — per-product, and only when it applies.
 *
 * Picking a "Horticulture Product" on the upload form is a claim that needs
 * backing: the seller must have a horticulture licence NUMBER and the
 * CERTIFICATE file for it. Leave the dropdown empty and nothing here runs — the
 * product saves like any other.
 *
 * PRESENCE, NOT STATUS — the same rule middlewares/requireSellerProductDocs.js
 * follows. SellerDocument.status defaults to "pending" and no admin screen ever
 * moves it to "verified", so gating on status would block every seller forever.
 *
 * WHERE THE NUMBER COMES FROM. Either source counts:
 *   · Seller.verification.licences.horticulture — the AUTHORITATIVE value, per
 *     the note in model/PC/SellerDocument.js. The Profile edits this directly.
 *   · the horticulture SellerDocument's `documentNumber` — a snapshot taken
 *     when the file was uploaded.
 * The snapshot alone is not enough to test: sellerAuthController.upsertSellerDoc
 * writes it ONLY on a file upload, so a seller who uploads the certificate first
 * and types the number afterwards keeps an empty snapshot forever, with no way
 * out but re-uploading the same file. The certificate itself has only one
 * source — the row's fileUrl — so that half is checked there and nowhere else.
 *
 * Returns the `missing` array (empty = clear to save).
 */
const HORTICULTURE_DOC_TYPE = "horticulture";

const missingHorticultureDocs = async (sellerId) => {
  const [seller, doc] = await Promise.all([
    Seller.findById(sellerId).select("verification.licences.horticulture").lean(),
    SellerDocument.findOne({ sellerId, docType: HORTICULTURE_DOC_TYPE })
      .sort({ createdAt: -1 })
      .select("documentNumber fileUrl")
      .lean(),
  ]);

  const hasNumber = Boolean(
    String(seller?.verification?.licences?.horticulture || "").trim() ||
    String(doc?.documentNumber || "").trim()
  );
  // A row can exist with only a fileKey; an upload that never produced a URL is
  // not a certificate the seller can be said to hold.
  const hasCertificate = Boolean(String(doc?.fileUrl || "").trim());

  const missing = [];
  if (!hasNumber) missing.push("number");
  if (!hasCertificate) missing.push("certificate");
  return missing;
};

/**
 * Runs the gate for one write and, if it fails, sends the 400 itself. Returns
 * true when the caller must stop. Shared by CREATE and UPDATE so the two can
 * never drift apart — an edit that ADDS a horticulture product is exactly as
 * much of a claim as a create that does.
 */
const blockedOnHorticultureDocs = async (req, res) => {
  if (!String(req.body?.horticultureProduct || "").trim()) return false;
  const missing = await missingHorticultureDocs(req.user.sellerId);
  if (!missing.length) return false;
  res.status(400).json({
    success: false,
    code: "HORTICULTURE_DOCS_REQUIRED",
    missing,
    // Word-for-word what the form's banner shows (SellerMyProductForm.jsx), so
    // a seller reading this from an API client is told the same thing as one
    // reading it in the page.
    message:
      "To upload this product, please go to your profile and upload your Horticulture licence number and certificate.",
  });
  return true;
};

/**
 * PAGINATION — shared by the two list endpoints so both read the same params
 * and answer in the same shape.
 *
 * OPT-IN. A caller that sends NEITHER param gets the whole filtered list, as
 * these endpoints have always returned. That is not politeness, it is a
 * correctness requirement: SellerAddStockModal calls getMyProducts() bare to
 * fill its product dropdown, and silently capping that at 10 would hide a
 * seller's other products from the Add stock form. Paging happens only when
 * the caller asks for it.
 *
 * Both are CLAMPED rather than trusted. `limit` is capped so a hand-typed
 * ?limit=100000 cannot be used to pull a seller's whole catalog (and its
 * per-product stock aggregate) in one request; a non-numeric or negative value
 * falls back to the default instead of producing NaN, which Mongo would reject.
 *
 * ORDER MATTERS, and it is the same in both endpoints: build the FILTER, count
 * the filtered set, then skip/limit. Counting before filtering would report a
 * total the rows on screen contradict.
 */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const paginate = (req) => {
  const enabled = req.query.page !== undefined || req.query.limit !== undefined;
  const rawPage = Number.parseInt(req.query.page, 10);
  const rawLimit = Number.parseInt(req.query.limit, 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;
  return { enabled, page, limit, skip: (page - 1) * limit };
};

/** Applies the page to a query, or leaves it whole when the caller did not
 *  ask to be paged. */
const withPage = (query, { enabled, skip, limit }) =>
  (enabled ? query.skip(skip).limit(limit) : query);

/** The pagination half of a list response. `count` stays what it always was —
 *  the number of rows in THIS response — and `total` is the filtered set.
 *  An unpaged call reports the whole set as the one page it is. */
const pageMeta = ({ enabled, page, limit }, total) => ({
  page: enabled ? page : 1,
  limit: enabled ? limit : total,
  total,
  totalPages: enabled ? Math.max(1, Math.ceil(total / limit)) : 1,
});

/** The owner filter. Never build a query in this file without it. */
const ownerFilter = (req) => ({ ownerType: "seller", sellerId: req.user.sellerId });

// Escape user input before it goes into a RegExp so a stray "(" or "*" in the
// search box can't blow up (or widen) the query.
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const fail = (res, err) =>
  res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });

/**
 * SHELF LIFE: the form sends whole DAYS; the readable string every catalog and
 * edit screen already renders is DERIVED from it, so the two can never drift.
 * Same rule as the company product controller.
 */
const deriveShelfLife = (body) => {
  const n = body.shelfLifeDays;
  if (typeof n !== "number" || !Number.isFinite(n)) return;
  body.shelfLife = `${n} Day${n === 1 ? "" : "s"}`;
};

/**
 * VARIANT TYPE IS DERIVED, never taken from the client — the validator does not
 * even accept it. A product is "multiple" exactly when it carries variants, so
 * the flag and the list cannot disagree (a "multiple" product with an emptied
 * variant list is the bug this rules out). Only touched when `variants` is
 * actually part of this request, so an edit that doesn't mention them leaves
 * both fields alone.
 */
const deriveVariantType = (body) => {
  if (!Array.isArray(body.variants)) return;
  body.variantType = body.variants.length ? "multiple" : "single";
};

/* ================= UPLOADED IMAGES =================
   Runs between multer and the zod validator on the two write routes (see
   routes/Seller/sellerMyProductRoutes.js for why it sits there rather than
   inside the handlers).

   THE PATH STRINGS ARE COPIED FROM controller/Company/productController.js,
   deliberately and exactly: `uploads/products/<file.filename>`, a URL-safe
   RELATIVE path. Not `file.path` — that is an absolute filesystem path with
   backslashes on Windows, which breaks every downstream URL builder. The
   storefront resolves seller and company images through the same helper, so a
   different shape here would render a broken image rather than none, which is
   worse. `file.location` is preferred when present (S3), as on the company
   update path. */

/** "uploads/products/x.jpg" for a multer file — S3 location when there is one. */
const uploadedPath = (file) => file.location || `uploads/products/${file.filename}`;

/** Tolerates legacy absolute paths / backslashes that leaked into old records. */
const cleanImagePath = (p) => {
  const s = String(p).replace(/\\/g, "/");
  const i = s.toLowerCase().indexOf("uploads/");
  return i >= 0 ? s.slice(i) : s;
};

const applyUploadedImages = (req, res, next) => {
  try {
    /* ── PRODUCT GALLERY ──────────────────────────────────────────────────
       productImages = kept images + new uploads, the same rule the company
       edit form follows: the form sends the FULL list of existing images the
       user KEPT as `kept_images`, so anything they removed simply is not in
       it and drops off. Multipart sends a bare string when one is kept and an
       array when several. On create there are none and this is just the
       uploads. */
    let kept = req.body.kept_images;
    if (kept === undefined) kept = [];
    else if (!Array.isArray(kept)) kept = [kept];

    const current = kept
      .filter((p) => p != null && String(p).trim() !== "")
      .map(cleanImagePath);

    const productImageFiles = req.files?.productImages ?? [];
    const merged = [...current, ...productImageFiles.map(uploadedPath)];

    // Only set the key when there is something to say. An UPDATE that sends no
    // images at all must leave the stored gallery alone rather than clear it.
    if (merged.length > 0 || kept.length > 0 || productImageFiles.length > 0) {
      req.body.productImages = merged;
    }
    delete req.body.kept_images;

    /* ── VARIANTS ─────────────────────────────────────────────────────────
       `variants` arrives as a JSON string from FormData. Parse what we can;
       if it is unparseable, DROP it so the stored value is preserved instead
       of being clobbered — the company update path makes the same choice. */
    if (typeof req.body.variants === "string") {
      try { req.body.variants = JSON.parse(req.body.variants); }
      catch { delete req.body.variants; }
    }

    /* Attach per-variant images. EVERY variant photo — for every variant — is
       appended under the ONE "variantImages" multipart field, so multer
       collects them as a single ordered array. Each variant says which
       positions in that array are its own:

         imageIndexes: [0, 2]   several photos (the seller form)
         imageIndex: 0          exactly one (kept for older clients)

       Both are transport artefacts and neither reaches the document.

       A variant KEEPS the paths it already had: the client re-sends them in
       `images`, and new uploads are appended after them, so an edit that adds
       one photo does not drop the other four. Same rule as the product
       gallery's kept_images above.

       `image` (singular) is then set to images[0]. It is the field the
       company flow uses and the field the storefront's colour swatch reads,
       so keeping it in step is what stops a multi-image variant from losing
       its swatch. */
    if (Array.isArray(req.body.variants) && req.body.variants.length > 0) {
      const variantFiles = req.files?.variantImages ?? [];
      const fileAt = (i) => (i != null && variantFiles[i] ? uploadedPath(variantFiles[i]) : null);

      req.body.variants = req.body.variants.map((v) => {
        const { imageIndex, imageIndexes, ...rest } = v || {};

        const kept = (Array.isArray(rest.images) ? rest.images : [])
          .filter((x) => x != null && String(x).trim() !== "")
          .map(cleanImagePath);

        const indexes = Array.isArray(imageIndexes)
          ? imageIndexes
          : (imageIndex != null ? [imageIndex] : []);
        const uploaded = indexes.map(fileAt).filter(Boolean);

        const images = [...kept, ...uploaded];
        if (images.length) {
          // images[0] mirrors into `image` so every existing single-image
          // reader keeps working.
          return { ...rest, images, image: images[0] };
        }
        // Nothing at all: fall back to a lone `image` if the client sent one,
        // which is how a variant saved before this feature keeps its photo.
        if (rest.image) {
          const only = cleanImagePath(rest.image);
          return { ...rest, image: only, images: [only] };
        }
        return { ...rest, images: [] };
      });
    }

    return next();
  } catch (err) {
    return next(err);
  }
};

exports.applyUploadedImages = applyUploadedImages;

/* ================= LIST ================= */

/**
 * GET /api/seller/my-products?search=&category=&status=&page=&limit=
 *
 * The seller's own products, each with `totalStock` — the sum of their
 * availableStock across their own Inventory rows for that product.
 *
 * PAGINATED. The filters are applied first and the page is cut from the
 * filtered set, so `total` always describes what the seller is looking at:
 * search for one product and the count says 1, not the size of the catalog.
 */
exports.listMyProducts = async (req, res) => {
  try {
    const filter = ownerFilter(req);
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(req.query.search), "i");
      filter.$or = [{ productName: rx }, { brandName: rx }, { skuNumber: rx }, { product_code: rx }];
    }
    if (req.query.category) {
      filter.category = { $regex: `^${escapeRegex(req.query.category)}$`, $options: "i" };
    }
    if (req.query.status === "active" || req.query.status === "inactive") {
      filter.productStatus = req.query.status;
    }

    const pg = paginate(req);
    // Counted against the SAME filter the page is cut from — the two can never
    // describe different sets.
    const total = await Product.countDocuments(filter);
    const products = await withPage(
      Product.find(filter).sort({ createdAt: -1, _id: -1 }),
      pg
    ).lean();

    /* ── STOCK PER PRODUCT — ONE aggregate for the page, not one per row ──
       EXPIRED STOCK IS NOT SELLABLE, so it is not part of the total.

       This used to be a flat $sum of every lot. A seller holding one expired
       lot and one good lot saw the two added together, read it as stock they
       could sell, and could publish on that basis — sending a customer expired
       agricultural input. So the sum is split: `totalStock` counts only lots
       that are still good, and `expiredStock` reports the rest separately so it
       is visible rather than silently dropped.

       A lot with NO expiry date counts as valid. The null guard is load-bearing:
       BSON sorts a missing/null field BELOW every date, so `expiryDate < now`
       alone would mark every never-expiring lot as expired. */
    const productIds = products.map((p) => p._id);
    const stockByProduct = new Map();
    if (productIds.length) {
      const now = new Date();
      const isExpired = {
        $and: [{ $ne: ["$expiryDate", null] }, { $lt: ["$expiryDate", now] }],
      };
      const rows = await Inventory.aggregate([
        {
          $match: {
            ownerType: "seller",
            ownerId: new mongoose.Types.ObjectId(String(req.user.sellerId)),
            productId: { $in: productIds },
          },
        },
        {
          $group: {
            _id: "$productId",
            valid: { $sum: { $cond: [isExpired, 0, "$availableStock"] } },
            expired: { $sum: { $cond: [isExpired, "$availableStock", 0] } },
            // The alert level the seller set when adding stock. $max across the
            // product's lots: the highest threshold anyone asked for is the
            // earliest warning, and warning early is the safe direction.
            threshold: { $max: "$lowStockThreshold" },
          },
        },
      ]);
      for (const r of rows) {
        stockByProduct.set(String(r._id), {
          total: Math.max(0, Number(r.valid) || 0),
          expired: Math.max(0, Number(r.expired) || 0),
          threshold: Math.max(0, Number(r.threshold) || 0),
        });
      }
    }

    const data = products.map((p) => {
      const s = stockByProduct.get(String(p._id));
      return {
        ...p,
        // Sellable only — expired lots excluded.
        totalStock: s?.total || 0,
        // Held but not sellable. Surfaced so "0 in stock" next to a full
        // warehouse is explainable rather than baffling.
        expiredStock: s?.expired || 0,
        // 0 means "no alert set" — the UI shows no low-stock badge for it.
        lowStockThreshold: s?.threshold || 0,
      };
    });
    res.json({ success: true, count: data.length, ...pageMeta(pg, total), data });
  } catch (err) {
    fail(res, err);
  }
};

/* ================= CREATE ================= */

/**
 * POST /api/seller/my-products
 *
 * Ownership is stamped by the SERVER, never taken from the body (the validator
 * strips those keys anyway): ownerType "seller", sellerId from the token, and
 * companyId explicitly null — a seller's own product belongs to no company,
 * which is exactly why productModel's companyId requirement is conditional.
 * `product_code` is minted by the model's pre("validate") hook, as for every
 * other product.
 */
exports.createMyProduct = async (req, res) => {
  try {
    if (await blockedOnHorticultureDocs(req, res)) return;
    const body = { ...req.body };
    deriveShelfLife(body);
    deriveVariantType(body);

    const product = await Product.create({
      ...body,
      ownerType: "seller",
      sellerId: req.user.sellerId,
      companyId: null,
      // A seller's own product is usable the moment it is created — there is no
      // draft/upload review step on this side.
      productStatus: body.productStatus === "inactive" ? "inactive" : "active",
      productUpload: "uploaded",
    });

    res.status(201).json({ success: true, data: product });
  } catch (err) {
    if (err?.name === "ValidationError") {
      return res.status(400).json({ success: false, message: err.message });
    }
    fail(res, err);
  }
};

/* ================= STOCK (defined before /:id in the routes) ================= */

/**
 * GET /api/seller/my-products/stock?productId=&warehouseId=&expiring=&expired=&page=&limit=
 *
 * The seller's own stock for their OWN products only. Three-way scoped: the
 * Inventory rows are the seller's (ownerType/ownerId), the products are the
 * seller's (ownerType/sellerId), and a warehouse-scoped manager sees only their
 * assigned warehouses.
 *
 * PAGINATED, and the expiry chips are part of the filter — so the count beside
 * "Expiring ≤ 90d" is the number of expiring lots, not the size of the whole
 * stock list.
 */
exports.getMyProductStock = async (req, res) => {
  try {
    // Warehouse-level access control, same rule as the seller lots endpoint: a
    // seller_manager sees only their assigned warehouse(s); seller_admin holds
    // "*" and is unscoped (null).
    const pg = paginate(req);
    // Every early return below is an EMPTY page, not an unpaginated one — the
    // caller reads the same fields whether there are rows or not.
    const emptyPage = { success: true, count: 0, ...pageMeta(pg, 0), data: [] };

    const scope = await warehouseScope(req.user);
    const warehouseId = req.query.warehouseId;
    if (scope && warehouseId && !scope.includes(String(warehouseId))) {
      return res.json(emptyPage);
    }

    // Which products are mine — the list that keeps company-supplied stock out
    // of this view even though it sits in the same Inventory collection.
    const mine = await Product.find(ownerFilter(req)).select("_id").lean();
    if (!mine.length) return res.json(emptyPage);
    let myProductIds = mine.map((p) => p._id);

    if (req.query.productId) {
      const wanted = String(req.query.productId);
      myProductIds = myProductIds.filter((id) => String(id) === wanted);
      if (!myProductIds.length) return res.json(emptyPage);
    }

    const filter = {
      ownerType: "seller",
      ownerId: req.user.sellerId,
      productId: { $in: myProductIds },
      batchNumber: { $ne: null },
    };
    if (warehouseId) filter.warehouseId = warehouseId;
    else if (scope && scope.length) filter.warehouseId = { $in: scope };

    const now = new Date();
    if (req.query.expiring === "true") {
      filter.expiryDate = { $gte: now, $lte: new Date(now.getTime() + 90 * 86400000) };
      filter.availableStock = { $gt: 0 };
    }
    if (req.query.expired === "true") {
      filter.expiryDate = { $lt: now };
      filter.availableStock = { $gt: 0 };
    }

    const expiryView = req.query.expiring === "true" || req.query.expired === "true";
    // Counted after every filter above (ownership, warehouse scope, product,
    // expiry chip) has been folded into `filter`.
    const total = await Inventory.countDocuments(filter);
    const query = Inventory.find(filter)
      .populate({
        path: "productId",
        select: "productName product_code category unit unitType packagingType mrp brandName skuNumber productImages ownerType sellerId",
      })
      .populate("warehouseId", "name code address")
      // The _id tiebreak is what makes the sort TOTAL. Without it two lots
      // sharing an expiry date have no defined order, and Mongo is free to
      // return them differently between requests — which on a paginated list
      // shows one row twice and drops another entirely.
      .sort(expiryView ? { expiryDate: 1, _id: 1 } : { createdAt: -1, _id: -1 });
    const rows = await withPage(query, pg);

    res.json({ success: true, count: rows.length, ...pageMeta(pg, total), data: rows });
  } catch (err) {
    fail(res, err);
  }
};

/**
 * POST /api/seller/my-products/stock
 *
 * Add the seller's own existing stock. All the ownership checks (product is
 * theirs, warehouse is theirs) live in the service, so any caller gets them.
 */
exports.addMyProductStock = async (req, res) => {
  try {
    /* NO WAREHOUSE AT ALL — answered first, and separately.

       The service already refuses a missing or non-owned warehouse ("A
       warehouse is required" / "Warehouse not found for this seller"), so this
       is not a hole being closed; it is a seller who has not created a single
       warehouse yet being TOLD that, instead of reading a message that sounds
       like they picked the wrong one. The form hides Add stock in this state,
       so reaching here means an API client — which is exactly who needs the
       message to say what to do. */
    const warehouseCount = await Warehouse.countDocuments({ sellerId: req.user.sellerId });
    if (warehouseCount === 0) {
      return res.status(400).json({
        success: false,
        code: "NO_WAREHOUSE",
        message: "Stock is stored in a warehouse. Create a warehouse first, then record the stock you already hold.",
      });
    }

    // A warehouse-scoped manager may only stock into a warehouse they are
    // assigned to. (The service separately proves the warehouse is the
    // SELLER's; this is the narrower per-user check on top.)
    const scope = await warehouseScope(req.user);
    if (scope && !scope.includes(String(req.body.warehouseId))) {
      return res.status(403).json({ success: false, message: "You are not assigned to this warehouse" });
    }

    const inv = await sellerOwnStockService.addSellerOwnStock({
      sellerId: req.user.sellerId,
      productId: req.body.productId,
      warehouseId: req.body.warehouseId,
      lotNumber: req.body.lotNumber,
      // Which variant. The service requires it whenever the product has
      // variants and rejects one that isn't actually the product's.
      variantSku: req.body.variantSku,
      mfgDate: req.body.mfgDate,
      expiryDate: req.body.expiryDate,
      qty: req.body.qty,
      lowStockThreshold: req.body.lowStockThreshold,
      performedBy: req.user.id,
    });

    res.status(201).json({ success: true, data: inv });
  } catch (err) {
    fail(res, err);
  }
};

/* ================= DUPLICATE CHECK (before /:id in the routes) ================= */

/**
 * GET /api/seller/my-products/duplicate-check?name=
 *
 * Advisory only — it never blocks a create. Returns up to 5 of the seller's own
 * products whose name looks like the one being typed, so they can spot that
 * they already added it. Scoped to their own products, so it can't be used to
 * probe anyone else's catalog.
 */
exports.duplicateCheck = async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    if (!name) return res.json({ success: true, count: 0, data: [] });

    const matches = await Product.find({
      ...ownerFilter(req),
      productName: { $regex: escapeRegex(name), $options: "i" },
    })
      .select("productName product_code brandName category unit unitValue productImages createdAt")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    res.json({ success: true, count: matches.length, data: matches });
  } catch (err) {
    fail(res, err);
  }
};

/* ================= READ ONE ================= */

/** GET /api/seller/my-products/:id */
exports.getMyProduct = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    const product = await Product.findOne({ _id: req.params.id, ...ownerFilter(req) }).lean();
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    const [stock] = await Inventory.aggregate([
      {
        $match: {
          ownerType: "seller",
          ownerId: new mongoose.Types.ObjectId(String(req.user.sellerId)),
          productId: new mongoose.Types.ObjectId(String(product._id)),
        },
      },
      { $group: { _id: null, total: { $sum: "$availableStock" } } },
    ]);

    res.json({ success: true, data: { ...product, totalStock: Math.max(0, Number(stock?.total) || 0) } });
  } catch (err) {
    fail(res, err);
  }
};

/* ================= UPDATE ================= */

/**
 * PUT /api/seller/my-products/:id
 *
 * The owner filter is part of the UPDATE ITSELF, not a separate read-then-write:
 * a product that isn't this seller's simply doesn't match, so there is no window
 * in which someone else's row could be written. Ownership fields are not in the
 * validated body and are never assignable here.
 */
exports.updateMyProduct = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    if (await blockedOnHorticultureDocs(req, res)) return;
    const body = { ...req.body };
    deriveShelfLife(body);
    deriveVariantType(body);

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, ...ownerFilter(req) },
      { $set: body },
      { new: true, runValidators: true }
    );
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    res.json({ success: true, data: product });
  } catch (err) {
    if (err?.name === "ValidationError") {
      return res.status(400).json({ success: false, message: err.message });
    }
    fail(res, err);
  }
};
