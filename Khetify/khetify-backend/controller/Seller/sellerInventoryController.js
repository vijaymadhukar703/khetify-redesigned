const lotService = require("../../services/lotService");
const sellerTraceService = require("../../services/sellerTraceService");
const { warehouseScope } = require("../../services/warehouseScope");

/**
 * GET /api/seller/lots — the authenticated seller's OWN lot rows
 * (ownerType "seller", ownerId = sellerId), product + warehouse populated, in
 * the SAME shape as the company lots endpoint so the seller UI can reuse the
 * company list/dashboard logic. Read-only: sellers receive lots via supply
 * (Phase 3), they never create them. Scope is implicitly the seller's own
 * warehouses (their inventory rows only).
 */
exports.getSellerLots = async (req, res) => {
  try {
    // Warehouse-level scoping: a seller_manager sees ONLY their assigned
    // warehouse(s)' lots — the SAME owner-scoped rows the seller_admin sees, just
    // a filtered slice (one source of truth, stays in sync). seller_admin: null
    // scope → all.
    const scope = await warehouseScope(req.user);
    const warehouseId = req.query.warehouseId;
    // A scoped manager can't widen past their warehouses by passing a foreign id.
    if (scope && warehouseId && !scope.includes(String(warehouseId))) {
      return res.json({ success: true, count: 0, data: [] });
    }
    const rows = await lotService.getLots(req.user.sellerId, {
      ownerType: "seller",
      productId: req.query.productId,
      warehouseId,
      warehouseIds: warehouseId ? undefined : scope || undefined,
      expiring: req.query.expiring,
      expired: req.query.expired,
    });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/* ---------------- SELLER LOT TRACEABILITY (read-only) ---------------- */

// A seller manager is scoped to their assigned warehouse(s); a seller_admin is
// unscoped. Threaded into every trace call so a manager can't open a lot in a
// warehouse they aren't assigned to.
const traceScope = (req) => warehouseScope(req.user);

/**
 * GET /api/seller/lots/:lotId/details
 * The whole read-only Lot Details page: product + lot summary, seller stock
 * counts, packaging summary and the seller-visible Bulk Packaging IDs.
 */
exports.getLotDetails = async (req, res) => {
  try {
    const allowedWarehouseIds = await traceScope(req);
    const data = await sellerTraceService.getLotDetails(req.user.sellerId, req.params.lotId, { allowedWarehouseIds });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * GET /api/seller/lots/:lotId/available-units
 *
 * READ-ONLY: the FULL Unit IDs that make up this seller lot's available
 * quantity right now. Powers Seller → Analytics → View → "View Available
 * Units", where a bare "Available: 100" does not say WHICH 100.
 *
 * Moves no stock and writes nothing.
 */
exports.getAvailableUnits = async (req, res) => {
  try {
    const allowedWarehouseIds = await traceScope(req);
    const data = await sellerTraceService.getAvailableUnits(req.user.sellerId, req.params.lotId, { allowedWarehouseIds });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * GET /api/seller/lots/:lotId/bulk-packages/:packageId/units?page=&limit=&search=
 * The seller's OWN units inside one received Bulk Packaging box — paginated.
 */
exports.getPackageUnits = async (req, res) => {
  try {
    const allowedWarehouseIds = await traceScope(req);
    const out = await sellerTraceService.getPackageUnits(
      req.user.sellerId, req.params.lotId, req.params.packageId,
      { page: req.query.page, limit: req.query.limit, search: req.query.search, allowedWarehouseIds }
    );
    res.json({ success: true, ...out });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * GET /api/seller/lots/:lotId/units?page=&limit=&search=
 * A NON-BULK seller lot's units — paginated.
 */
exports.getLotUnits = async (req, res) => {
  try {
    const allowedWarehouseIds = await traceScope(req);
    const out = await sellerTraceService.getLotUnits(
      req.user.sellerId, req.params.lotId,
      { page: req.query.page, limit: req.query.limit, search: req.query.search, allowedWarehouseIds }
    );
    res.json({ success: true, ...out });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * GET /api/seller/lots/:lotId/history
 * Seller-visible traceability history for the lot.
 */
exports.getLotHistory = async (req, res) => {
  try {
    const allowedWarehouseIds = await traceScope(req);
    const data = await sellerTraceService.getHistory(req.user.sellerId, req.params.lotId, { allowedWarehouseIds });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};
