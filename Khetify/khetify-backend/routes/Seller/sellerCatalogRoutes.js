const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const { FEATURES } = require("../../config/plans");
const { getSellerProducts, getSellerProduct } = require("../../controller/Seller/sellerCatalogController");

// Read-only catalog of the linked company's products — a PAID feature
// (BASIC_CATALOG). No approval gate; the PLAN is the gate, and it is enforced
// here and not only in the sidebar, so a locked module cannot be reached by
// calling the API directly.
// Also gated by catalog:read — a warehouse manager (seller_manager) has NO
// catalog capability, so they are blocked here server-side too.
router.use(auth, authorize("catalog:read"), loadSubscription, requireFeature(FEATURES.BASIC_CATALOG));
router.get("/", getSellerProducts);
router.get("/:id", getSellerProduct);

module.exports = router;
