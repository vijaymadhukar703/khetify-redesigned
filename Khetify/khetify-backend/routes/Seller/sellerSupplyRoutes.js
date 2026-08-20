const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const requireApprovedSeller = require("../../middlewares/requireApprovedSeller");
const requireWarehouseExists = require("../../middlewares/requireWarehouseExists");
const { createSellerSupplyOrder, getSellerSupplyOrders, receiveSupply, scanReceiveBox } = require("../../controller/Seller/sellerSupplyController");

// Seller-initiated supply requests. Approved sellers only; scoped to the seller.
router.use(auth, requireApprovedSeller);
// A supply request must name a destination warehouse, so CREATION is blocked
// until the seller owns one. Same middleware the company Lot gate uses; it
// resolves the owner from req.user.sellerId here.
// Only POST / is gated — listing and receiving an ALREADY-PLACED request stay
// open, so nothing existing breaks for a seller who later deactivates a
// warehouse.
router.post(
  "/",
  requireWarehouseExists({
    message: "Please create a Warehouse first before creating an Inbound Supply Request.",
  }),
  createSellerSupplyOrder
);
router.get("/", getSellerSupplyOrders);
// Resolve ONE scanned label (manifest / Shipment Box / Bulk Packaging) and
// report live coverage. Read-only — receiving still happens below.
router.post("/:id/scan-box", scanReceiveBox);
router.post("/:id/receive", receiveSupply); // scan-verify + receive into seller stock

module.exports = router;