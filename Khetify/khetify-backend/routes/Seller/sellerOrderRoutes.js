const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const requireApprovedSeller = require("../../middlewares/requireApprovedSeller");
const authorize = require("../../middlewares/authorize");
const ctrl = require("../../controller/Seller/sellerOrderController");

// Seller outbound sales. Approved sellers only; scoped to the seller.
router.use(auth, requireApprovedSeller);
router.post("/", authorize("order:create"), ctrl.createOrder);
router.get("/", ctrl.getOrders);
router.get("/:id", ctrl.getOrder);
router.get("/:id/picklist", ctrl.getPicklist);
// Per-warehouse availability + nearest-warehouse recommendation for the
// "Assign a warehouse" popup shown when the seller approves an order.
router.get("/:id/source-options", ctrl.getSourceOptions);
router.patch("/:id/status", authorize("order:update"), ctrl.updateStatus);
// Note: confirmed orders are fulfilled through the SHIPMENT pipeline
// (Operations → Send Stock → Pick/Pack/Dispatch); the shipment is created on
// confirm and its pack/dispatch sync the order via controller hooks.

module.exports = router;