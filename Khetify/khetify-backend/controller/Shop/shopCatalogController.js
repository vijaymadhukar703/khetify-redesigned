const catalog = require("../../services/shopCatalogService");

/** GET /api/shop/products — public, paginated storefront listing. */
exports.listProducts = async (req, res) => {
  try {
    const result = await catalog.listProducts(req.query);
    res.json({ success: true, ...result, data: result.items, count: result.items.length });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** GET /api/shop/categories — public category list for the shop nav. */
exports.listCategories = async (req, res) => {
  try {
    // ?lang=hi → localised labels; anything else → English, unchanged.
    const categories = await catalog.listCategories(req.query.lang);
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** GET /api/shop/products/:listingId — public product detail. */
exports.getProduct = async (req, res) => {
  try {
    const product = await catalog.getProduct(req.params.listingId, req.query.lang);
    res.json({ success: true, data: product });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};