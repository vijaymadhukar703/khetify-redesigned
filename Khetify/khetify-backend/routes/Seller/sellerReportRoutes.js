const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const { FEATURES } = require("../../config/plans");
const ctrl = require("../../controller/Seller/sellerReportController");

// Seller analytics. Any seller with report:read (seller_admin + the
// warehouse manager; seller_staff has none). Numbers are owner-scoped to the
// seller and warehouse-scoped for a manager.
router.use(auth, authorize("report:read"));

// The dashboard summary is an aggregate (like the free warehouse stock-summary)
// — available on any plan.
router.get("/dashboard", ctrl.dashboard);
router.get("/", ctrl.list);
// Lot-level report runs are the paid Inventory view (INVENTORY_VIEW): a free
// seller (and its members) get 402/403 UPGRADE_REQUIRED.
router.get("/:name", loadSubscription, requireFeature(FEATURES.INVENTORY_VIEW), ctrl.run);

module.exports = router;
