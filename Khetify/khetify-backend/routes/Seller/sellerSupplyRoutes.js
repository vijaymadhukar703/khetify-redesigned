const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const requireWarehouseExists = require("../../middlewares/requireWarehouseExists");
const authorize = require("../../middlewares/authorize");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const { FEATURES } = require("../../config/plans");
const { createSellerSupplyOrder, getSellerSupplyOrders, receiveSupply, scanReceiveBox } = require("../../controller/Seller/sellerSupplyController");

// Seller-initiated supply requests — a PAID feature (SUPPLY_WORKFLOW). Scoped
// to the seller; no approval gate. The PLAN is the gate, enforced here and not
// only in the sidebar, so a locked module cannot be reached by calling the API.
router.use(auth, loadSubscription, requireFeature(FEATURES.SUPPLY_WORKFLOW));
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
/* RECEIVING IS THE WAREHOUSE'S JOB, NOT HEAD OFFICE'S.
   supply:receive is held by seller_manager (via "supply:*") and explicitly
   DENIED to seller_admin in config/permissions.js — the same rule that already
   keeps seller_admin out of transfer:create, and for the same reason: the
   person who signs for the goods must be the person holding them.

   These two routes previously had NO capability check at all, so any seller
   member could receive a supply. Hiding the button in the UI is not enough on
   its own — the button is a convenience, this is the actual enforcement. */

// Resolve ONE scanned label (manifest / Shipment Box / Bulk Packaging) and
// report live coverage. Read-only in the sense that it writes no stock, but it
// is part of receiving and is gated with it: a role that may not receive has no
// business walking the scan flow.
router.post("/:id/scan-box", authorize("supply:receive"), scanReceiveBox);
router.post("/:id/receive", authorize("supply:receive"), receiveSupply); // scan-verify + receive into seller stock

module.exports = router;