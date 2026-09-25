const AdminProduct = require("../../model/Admin/AdminProduct");

/**
 * INBUILT LIBRARY — the seller's READ-ONLY window onto the admin Product
 * Library (model/Admin/AdminProduct.js, collection "admin_products").
 *
 * NAMES ONLY. The seller sees which companies are in the library and the
 * product names under each; nothing else leaves this file — no prices, no
 * legal name, licence or CIN. Every query projects explicitly so a field added
 * to the model later cannot leak by default.
 *
 * Inactive library products are hidden. `$ne: "inactive"` rather than
 * `"active"` so a row with no status at all still counts as listed.
 */
const LISTED = { productStatus: { $ne: "inactive" } };

const fail = (res) => res.status(500).json({ success: false, message: "Server error" });

/** GET /api/seller/library/companies → ["Company A", "Company B"] */
exports.listLibraryCompanies = async (req, res) => {
  try {
    const names = await AdminProduct.distinct("companyName", LISTED);
    // distinct() is case/whitespace-sensitive, so trim first and de-duplicate
    // again — "Acme" and "Acme " are one company to a seller.
    const data = [...new Set(
      names
        .map((n) => String(n ?? "").trim())
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    res.json({ success: true, data });
  } catch {
    fail(res);
  }
};

/** GET /api/seller/library/products?companyName= → [{ _id, productName }] */
exports.listLibraryProducts = async (req, res) => {
  try {
    const companyName = String(req.query.companyName ?? "").trim();
    if (!companyName) {
      return res.status(400).json({ success: false, message: "companyName is required" });
    }

    const data = await AdminProduct.find({ companyName, ...LISTED })
      .select("_id productName")
      .sort({ productName: 1 })
      .lean();

    res.json({ success: true, data });
  } catch {
    fail(res);
  }
};

/**
 * GET /api/seller/library/product-details?companyName=&productName=&category=
 *
 * The catalog details of the matching library product(s), newest first, so the
 * Inbuilt Library form can pre-fill from them. An EXCLUSION projection, so the
 * fields the seller must never see are named here explicitly: the company's
 * legal identity (legalName / licNo / cinNo), the admin's cost price, the
 * admin's own product_code and the audit field createdByAdmin.
 */
const HIDDEN_DETAIL_FIELDS = "-legalName -licNo -cinNo -createdByAdmin -costPrice -product_code -__v";

exports.listLibraryProductDetails = async (req, res) => {
  try {
    const companyName = String(req.query.companyName ?? "").trim();
    const productName = String(req.query.productName ?? "").trim();
    const category = String(req.query.category ?? "").trim();
    if (!companyName || !productName || !category) {
      return res.status(400).json({
        success: false,
        message: "companyName, productName and category are required",
      });
    }

    const data = await AdminProduct.find({ companyName, productName, category, ...LISTED })
      .select(HIDDEN_DETAIL_FIELDS)
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data });
  } catch {
    fail(res);
  }
};
