const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const requireApprovedSeller = require("../../middlewares/requireApprovedSeller");
const authorize = require("../../middlewares/authorize");
const loadSubscription = require("../../middlewares/loadSubscription");
const enforceLimit = require("../../middlewares/enforceLimit");
const validate = require("../../middlewares/validate");
const { createSellerWarehouseBody } = require("../../validators/sellerWarehouseValidators");
const {
  getSellerWarehouses,
  getSellerWarehouseStockSummary,
  createSellerWarehouse,
  updateSellerWarehouse,
  deactivateSellerWarehouse,
} = require("../../controller/Seller/sellerWarehouseController");

// All seller warehouse routes require an APPROVED seller principal and are
// scoped to req.user.sellerId in the controller.
router.use(auth, requireApprovedSeller);

router.get("/", getSellerWarehouses);
router.get("/:id/stock-summary", getSellerWarehouseStockSummary); // aggregate fill (free module)
// The warehouse module is FREE for the first warehouse; the plan LIMIT is what's
// enforced (free = 1, paid = unlimited). No requireFeature here, or it would
// block the first warehouse on free.
// Creating a warehouse is seller_admin-only (warehouse:create resolves only via
// the admin "*"); editing/deactivating an existing one stays open to the
// warehouse manager (warehouse:manage).
router.post(
  "/",
  authorize("warehouse:create"),
  loadSubscription,
  enforceLimit("warehouses"),
  // Warehouse + Warehouse Manager arrive together; the manager block is
  // mandatory and its field rules are shared with the company flow via
  // validators/userValidators.js. Mirrors routes/Warehouse/warehouseRoutes.js.
  validate({ body: createSellerWarehouseBody }),
  createSellerWarehouse
);
router.put("/:id", authorize("warehouse:manage"), updateSellerWarehouse);
router.patch("/:id/deactivate", authorize("warehouse:manage"), deactivateSellerWarehouse);

module.exports = router;