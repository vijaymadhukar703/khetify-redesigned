const mongoose = require("mongoose");
const Seller = require("../../model/Seller/Seller");
const Product = require("../../model/Company/productModel");
const Inventory = require("../../model/Inventory/Inventory");
const pcService = require("../../services/pcService");

/**
 * Seller product catalog — a READ-ONLY view of the seller's linked (supplying)
 * company's products. Sellers have no catalog of their own; they only resell.
 *
 * SECURITY: the projection is an explicit ALLOW-LIST of resale-relevant fields.
 * It deliberately EXCLUDES costPrice and any other internal cost data so the
 * company's margin can never leak to a seller. ProductCost is never queried.
 */
const SELLER_PRODUCT_FIELDS =
  "productName category skuNumber brandName packagingType unit unitType mrp hsnCode productImages product_code";

/** Resolve the caller's catalog company, gated on an ACTIVE PC (issuing a PC is
 * now the authorization — there is no separate link approval). Picks the
 * seller's primary supplying company if it has an active PC, else the first
 * company that issued the seller a PC. */
async function resolveSupplyingCompany(req, res) {
  const companies = (await pcService.companiesWithActivePc(req.user.sellerId)).map(String);
  if (!companies.length) {
    res.status(403).json({ success: false, message: "No active Principal Certificate yet — apply for a PC to sell a company's products." });
    return null;
  }
  const seller = await Seller.findById(req.user.sellerId).select("supplyingCompanyId");
  const primary = seller?.supplyingCompanyId && companies.includes(String(seller.supplyingCompanyId)) ? String(seller.supplyingCompanyId) : null;
  return primary || companies[0];
}

/** Resolve which company's catalog to show. An explicit ?companyId= is honoured
 * only when the seller holds an ACTIVE PC for it; otherwise fall back to the
 * primary company the seller is PC-authorized for. */
async function resolveCatalogCompany(req, res) {
  if (req.query.companyId) {
    if (!(await pcService.hasActivePc(req.user.sellerId, req.query.companyId))) {
      res.status(403).json({ success: false, message: "An active Principal Certificate for this company is required." });
      return null;
    }
    return req.query.companyId;
  }
  return resolveSupplyingCompany(req, res);
}

/** GET /api/seller/products[?companyId=] — a linked company's active, uploaded products. */
exports.getSellerProducts = async (req, res) => {
  try {
    const companyId = await resolveCatalogCompany(req, res);
    if (!companyId) return;

    const filter = { companyId, productStatus: "active", productUpload: "uploaded" };
    if (req.query.search) filter.productName = { $regex: String(req.query.search), $options: "i" };
    if (req.query.category) filter.category = { $regex: `^${String(req.query.category)}$`, $options: "i" };

    const products = await Product.find(filter).select(SELLER_PRODUCT_FIELDS).sort({ productName: 1 }).lean();

    // Attach the seller's OWN available stock per product (summed across their
    // inventory rows). The storefront publish flow uses this to gate
    // "Publish on marketplace" — a seller can only list a product they actually
    // hold; otherwise they must request supply first.
    const LOW_STOCK_THRESHOLD = 10; // show "low stock" at/below this (or the seller's own threshold, whichever is higher)
    const productIds = products.map((p) => p._id);
    const stockByProduct = new Map();
    if (productIds.length) {
      const rows = await Inventory.aggregate([
        {
          $match: {
            ownerType: "seller",
            ownerId: new mongoose.Types.ObjectId(String(req.user.sellerId)),
            productId: { $in: productIds },
          },
        },
        { $group: { _id: "$productId", available: { $sum: "$availableStock" }, threshold: { $max: "$lowStockThreshold" } } },
      ]);
      for (const r of rows) {
        const available = Math.max(0, Math.round(Number(r.available) || 0));
        const threshold = Math.max(Number(r.threshold) || 0, LOW_STOCK_THRESHOLD);
        stockByProduct.set(String(r._id), { available, lowStock: available > 0 && available <= threshold });
      }
    }
    const data = products.map((p) => {
      const s = stockByProduct.get(String(p._id));
      return { ...p, availableStock: s ? s.available : 0, lowStock: s ? s.lowStock : false };
    });

    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /api/seller/products/:id — detail, only if it belongs to the linked company. */
exports.getSellerProduct = async (req, res) => {
  try {
    const companyId = await resolveSupplyingCompany(req, res);
    if (!companyId) return;

    const product = await Product.findOne({ _id: req.params.id, companyId })
      .select(SELLER_PRODUCT_FIELDS)
      .lean();
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    res.json({ success: true, data: product });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Exported for tests / reuse.
exports.SELLER_PRODUCT_FIELDS = SELLER_PRODUCT_FIELDS;