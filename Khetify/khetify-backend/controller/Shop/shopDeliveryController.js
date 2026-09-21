/**
 * shopDeliveryController.js
 *
 * Thin public endpoints the storefront calls for delivery checking.
 * All business logic lives in deliveryService.js.
 */

const delivery = require("../../services/deliveryService");

/**
 * GET /api/shop/delivery/check?pincode=451001
 *
 * Public — no auth required. Returns whether the logistics network
 * can deliver to a pincode and, if yes, the freight amount.
 */
exports.checkDelivery = async (req, res) => {
  try {
    const result = await delivery.checkPincodeServiceability(req.query.pincode);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};