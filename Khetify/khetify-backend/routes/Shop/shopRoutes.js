const express = require("express");
const router = express.Router();

const consumerAuth = require("../../middlewares/consumerAuth");
const cat = require("../../controller/Shop/shopCatalogController");
const auth = require("../../controller/Shop/shopAuthController");
const order = require("../../controller/Shop/shopOrderController");

/* ─────────── Public storefront (no login) ─────────── */
router.get("/products", cat.listProducts);
router.get("/categories", cat.listCategories);
router.get("/products/:listingId", cat.getProduct);

/* ─────────── Consumer auth ─────────── */
router.post("/auth/register", auth.register);
router.post("/auth/login", auth.login);
router.post("/auth/verify-otp", consumerAuth, auth.verifyOtp);
router.post("/auth/resend-otp", consumerAuth, auth.resendOtp);
router.get("/auth/me", consumerAuth, auth.me);

/* ─────────── 👤 Profile (self-service, all consumerAuth-scoped) ─────────── */
// PATCH (not PUT): a partial update of the shopper's own name / phone.
router.patch("/auth/me", consumerAuth, auth.updateMe);
// Change the account password (current password required).
router.post("/auth/change-password", consumerAuth, auth.changePassword);

/* ─────────── Protected: addresses, checkout, orders ─────────── */
router.get("/addresses", consumerAuth, order.listAddresses);
router.post("/addresses", consumerAuth, order.addAddress);
// 👤 PROFILE: the address book needs edit + default, not just add/delete.
// The more specific "/:addressId/default" is declared BEFORE the bare
// "/:addressId" so it can never be swallowed by it.
router.patch("/addresses/:addressId/default", consumerAuth, order.setDefaultAddress);
router.put("/addresses/:addressId", consumerAuth, order.updateAddress);
router.delete("/addresses/:addressId", consumerAuth, order.deleteAddress);

router.post("/checkout", consumerAuth, order.checkout);
router.get("/orders", consumerAuth, order.listOrders);
router.get("/orders/:id", consumerAuth, order.getOrder);
// 🛒 Cancel your own order (service allows it only while status === "pending").
router.post("/orders/:id/cancel", consumerAuth, order.cancelOrder);

module.exports = router;