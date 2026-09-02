const express = require("express");
const router = express.Router();

const consumerAuth = require("../../middlewares/consumerAuth");
const cat = require("../../controller/Shop/shopCatalogController");
const auth = require("../../controller/Shop/shopAuthController");
const order = require("../../controller/Shop/shopOrderController");
// 💳 ONLINE PAYMENT (mock gateway). COD does not touch this controller.
const payment = require("../../controller/Shop/shopPaymentController");

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

// COD lane — UNCHANGED. Creates the order(s) immediately, payment pending.
// Price the basket for the COD review screen. Reads only — places nothing.
// Declared before "/checkout" purely for readability; the paths don't collide.
router.post("/checkout/review", consumerAuth, order.review);
router.post("/checkout", consumerAuth, order.checkout);

/* ─────────── 💳 Online payment (mock gateway) ───────────
   Deliberately a SEPARATE namespace from /checkout so the two payment
   lanes never share a code path. The order is created by the payment
   service only AFTER the gateway confirms, so an unpaid online order can
   never reach a seller queue. */
// Which gateway is live + its PUBLISHABLE key. MUST stay above the
// "/payments/:paymentId" GET below, or Express would match "config" as an id.
router.get("/payments/config", consumerAuth, payment.config);

/* 🔔 Razorpay -> us, server to server. NO consumerAuth: Razorpay has no login.
   Its authenticity is the signature over the raw body, checked in the handler.
   Declared before the ":paymentId" routes so "webhook" is never read as an id.
   This is what makes an order appear even when the shopper closed the tab the
   instant they paid. */
router.post("/payments/webhook", payment.webhook);

router.post("/payments/initiate", consumerAuth, payment.initiate);
// The REAL return leg from the gateway's checkout.
router.post("/payments/:paymentId/verify", consumerAuth, payment.verify);
// Shopper closed the gateway window without paying — reopen so retry works.
router.post("/payments/:paymentId/dismiss", consumerAuth, payment.dismiss);
// ⛔ MOCK GATEWAY ONLY. The service refuses this whenever Razorpay is active,
//    so it is unreachable in any environment that has real credentials.
router.post("/payments/:paymentId/mock/complete", consumerAuth, payment.completeMock);
router.post("/payments/:paymentId/cancel", consumerAuth, payment.cancel);
router.get("/payments/:paymentId", consumerAuth, payment.getPayment);

router.get("/orders", consumerAuth, order.listOrders);
router.get("/orders/:id", consumerAuth, order.getOrder);
// 🛒 Cancel your own order (service allows it only while status === "pending").
router.post("/orders/:id/cancel", consumerAuth, order.cancelOrder);

module.exports = router;