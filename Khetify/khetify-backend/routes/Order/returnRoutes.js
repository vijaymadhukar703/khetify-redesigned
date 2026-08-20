const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const { FEATURES } = require("../../config/plans");
const { createBody } = require("../../validators/returnValidators");
const ctrl = require("../../controller/Order/returnController");

// Returns is an ADMINISTRATION module — gated on the paid ADMINISTRATION
// feature, matching the UI gate at /returns.
const adminGate = [loadSubscription, requireFeature(FEATURES.ADMINISTRATION)];

router.get("/", auth, authorize("return:read"), ...adminGate, ctrl.list);
router.post("/", auth, authorize("return:create"), ...adminGate, validate({ body: createBody }), ctrl.create);
router.post("/:id/post", auth, authorize("return:post"), ...adminGate, ctrl.post);

module.exports = router;