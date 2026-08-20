const Warehouse = require("../model/Warehouse/Warehouse");

/**
 * Gate an action on the caller owning AT LEAST ONE warehouse.
 *
 * Business rule: stock always lands in a warehouse, so a principal that has
 * not set one up yet must not be able to create stock. The frontend hides or
 * disables the action, but this middleware is the authoritative check — a
 * direct API call (Postman, curl, a stale tab) is rejected here.
 *
 * Works for BOTH principals off the same Warehouse collection, which stores
 * a company warehouse under `companyId` and a seller warehouse under
 * `sellerId` (the same split middlewares/enforceLimit.js counts by):
 *
 *   // Company — Lot creation
 *   router.post("/receive", auth, authorize("lot:receive"), requireWarehouseExists(), receiveLot);
 *
 *   // Seller — Inbound Supply Request
 *   router.post("/", requireWarehouseExists({ message: "…before creating an Inbound Supply Request." }), createSellerSupplyOrder);
 *
 * Notes:
 *  - `companyId` wins when both are present; a token carrying NEITHER is
 *    passed through untouched, so no other flow changes.
 *  - `Warehouse.exists` is an indexed, projection-free lookup — one cheap query.
 */
module.exports = function requireWarehouseExists(options = {}) {
  const message =
    options.message || "Please create a Warehouse first before creating a Lot.";

  return async (req, res, next) => {
    try {
      // Resolve the owner the same way the Warehouse collection is keyed.
      const companyId = req.user?.companyId;
      const sellerId = req.user?.sellerId;
      const owner = companyId ? { companyId } : sellerId ? { sellerId } : null;
      // Neither principal — this rule does not apply.
      if (!owner) return next();

      const exists = await Warehouse.exists(owner);
      if (!exists) {
        return res.status(400).json({
          success: false,
          code: "NO_WAREHOUSE",
          message,
        });
      }
      next();
    } catch (err) {
      console.error("requireWarehouseExists error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  };
};