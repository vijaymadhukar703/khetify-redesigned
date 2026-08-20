const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const enforceLimit = require("../../middlewares/enforceLimit");
const validate = require("../../middlewares/validate");
const { createWarehouseBody } = require("../../validators/warehouseValidators");
const { FEATURES } = require("../../config/plans");

const {
  getWarehouses,
  createWarehouse,
  updateWarehouse,
  nearestWarehouse,
} = require("../../controller/Warehouse/warehouseController");

router.get("/", auth, getWarehouses);
router.get("/nearest", auth, nearestWarehouse);

// Edit an existing warehouse — admin-only (warehouse:manage). No plan gating
// since editing doesn't add a new warehouse.
router.put("/:id", auth, authorize("warehouse:manage"), updateWarehouse);

// Premium: multi-warehouse, plus the count limit per plan.
// Warehouses are company infrastructure: only the company admin can create
// them ("warehouse:manage" resolves only via the admin "*" wildcard —
// operations managers get 403).
router.post(
  "/",
  auth,
  authorize("warehouse:manage"),
  loadSubscription,
  requireFeature(FEATURES.MULTI_WAREHOUSE),
  enforceLimit("warehouses"),
  // Warehouse + Warehouse Manager arrive together; the manager block is
  // mandatory and its field rules are shared with Add Team Member.
  validate({ body: createWarehouseBody }),
  createWarehouse
);

module.exports = router;