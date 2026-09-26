const uploadCleanup = require("../../middlewares/productUploadCleanup");
const mongoose = require("mongoose");
const AdminProduct = require("../../model/Admin/AdminProduct");
const { applyUploadedImages } = require("../Seller/sellerMyProductController");

/**
 * ADMIN PRODUCT LIBRARY — the platform admin's own product catalog, stored in
 * the separate "admin_products" collection (model/Admin/AdminProduct.js).
 *
 * Modelled on controller/Seller/sellerMyProductController.js, minus the
 * seller-only concerns: there is no owner filter (the admin sees the whole
 * library), no stock and no horticulture paperwork gate.
 */

exports.applyUploadedImages = applyUploadedImages;

/* PAGINATION — same clamping as the seller list: a bad or negative value falls
   back to the default instead of producing NaN, and `limit` is capped. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const paginate = (req) => {
  const rawPage = Number.parseInt(req.query.page, 10);
  const rawLimit = Number.parseInt(req.query.limit, 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;
  return { page, limit, skip: (page - 1) * limit };
};

const pageMeta = ({ page, limit }, total) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

// Escape user input before it goes into a RegExp so a stray "(" or "*" in the
// search box can't blow up (or widen) the query.
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const fail = (res, err) =>
  res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });

/* Copied from sellerMyProductController.js (not exported there). */

/** SHELF LIFE: the readable string is DERIVED from whole days. */
const deriveShelfLife = (body) => {
  const n = body.shelfLifeDays;
  if (typeof n !== "number" || !Number.isFinite(n)) return;
  body.shelfLife = `${n} Day${n === 1 ? "" : "s"}`;
};

/** VARIANT TYPE is derived from the variants list, never taken from the client. */
const deriveVariantType = (body) => {
  if (!Array.isArray(body.variants)) return;
  body.variantType = body.variants.length ? "multiple" : "single";
};

/* ================= LIST ================= */

/** GET /api/admin/products?search=&category=&status=&page=&limit= */
exports.listAdminProducts = async (req, res) => {
  try {
    const filter = {};
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(req.query.search), "i");
      filter.$or = [{ productName: rx }, { brandName: rx }];
    }
    if (req.query.category) {
      filter.category = { $regex: `^${escapeRegex(req.query.category)}$`, $options: "i" };
    }
    if (req.query.status === "active" || req.query.status === "inactive") {
      filter.productStatus = req.query.status;
    }

    const pg = paginate(req);
    // Counted against the SAME filter the page is cut from.
    const total = await AdminProduct.countDocuments(filter);
    const data = await AdminProduct.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(pg.skip)
      .limit(pg.limit)
      .lean();

    res.json({ success: true, data, pagination: pageMeta(pg, total) });
  } catch (err) {
    fail(res, err);
  }
};

/* ================= DUPLICATE CHECK (before /:id in the routes) ================= */

/** GET /api/admin/products/duplicate-check?name= — advisory, never blocks a create. */
exports.duplicateCheck = async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    if (!name) return res.json({ success: true, count: 0, data: [] });

    const matches = await AdminProduct.find({
      productName: { $regex: escapeRegex(name), $options: "i" },
    })
      .select("productName product_code brandName category unit unitValue productImages companyName createdAt")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    res.json({ success: true, count: matches.length, data: matches });
  } catch (err) {
    fail(res, err);
  }
};

/* ================= READ ONE ================= */

/** GET /api/admin/products/:id */
exports.getAdminProduct = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    const product = await AdminProduct.findById(req.params.id).lean();
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    res.json({ success: true, data: product });
  } catch (err) {
    fail(res, err);
  }
};

/* ================= CREATE ================= */

/**
 * POST /api/admin/products
 *
 * `product_code` is minted by the schema's pre("validate") hook (cloned from
 * the Product schema); `createdByAdmin` is stamped from the token.
 */
exports.createAdminProduct = async (req, res) => {
  let writeStarted = false;
  try {
    const body = { ...req.body };
    deriveShelfLife(body);
    deriveVariantType(body);

    writeStarted = true;
    const product = await AdminProduct.create({
      ...body,
      createdByAdmin: req.admin.id,
      productStatus: body.productStatus === "inactive" ? "inactive" : "active",
      productUpload: "uploaded",
    });

    uploadCleanup.commit(req);
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    await uploadCleanup.rollbackRejected(req, err, writeStarted);
    if (err?.name === "ValidationError") {
      return res.status(400).json({ success: false, message: err.message });
    }
    fail(res, err);
  }
};

/* ================= UPDATE ================= */

/** PUT /api/admin/products/:id — product_code is never updated. */
exports.updateAdminProduct = async (req, res) => {
  let writeStarted = false;
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      await uploadCleanup.rollback(req);
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    const body = { ...req.body };
    // The validator already strips these; kept as a second line of defence.
    delete body.product_code;
    delete body.createdByAdmin;
    deriveShelfLife(body);
    deriveVariantType(body);

    writeStarted = true;
    const product = await AdminProduct.findByIdAndUpdate(
      req.params.id,
      { $set: body },
      { new: true, runValidators: true }
    );
    if (!product) { await uploadCleanup.rollback(req); return res.status(404).json({ success: false, message: "Product not found" }); }

    uploadCleanup.commit(req);
    res.json({ success: true, data: product });
  } catch (err) {
    await uploadCleanup.rollbackRejected(req, err, writeStarted);
    if (err?.name === "ValidationError") {
      return res.status(400).json({ success: false, message: err.message });
    }
    fail(res, err);
  }
};
