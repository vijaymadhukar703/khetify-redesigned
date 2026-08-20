const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const requireApprovedSeller = require("../../middlewares/requireApprovedSeller");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const { FEATURES } = require("../../config/plans");
const {
  getSellerLots,
  getLotDetails,
  getAvailableUnits,
  getPackageUnits,
  getLotUnits,
  getLotHistory,
} = require("../../controller/Seller/sellerInventoryController");

// Read-only seller inventory (lots / stock / batches) — a PAID feature
// (INVENTORY_VIEW). Free sellers can still receive (inbound) and sell (outbound)
// via their own routes; they just can't open the inventory views.
router.use(auth, requireApprovedSeller, loadSubscription, requireFeature(FEATURES.INVENTORY_VIEW));
router.get("/", getSellerLots);

// ── Lot Traceability (read-only) ──
// A seller only ever reaches their OWN lot here; the service's ownerType/ownerId
// filter is the access check (403 "You do not have access to this inventory lot.").
// Units are paginated so a lot with thousands of units never renders at once.
router.get("/:lotId/details", getLotDetails);
// Read-only: WHICH Unit IDs make up this lot's available quantity right now.
// Powers Seller → Analytics → View → "View Available Units".
router.get("/:lotId/available-units", getAvailableUnits);
router.get("/:lotId/history", getLotHistory);
router.get("/:lotId/units", getLotUnits);
router.get("/:lotId/bulk-packages/:packageId/units", getPackageUnits);

module.exports = router;
