const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const loadSubscription = require("../../middlewares/loadSubscription");
const enforceLimit = require("../../middlewares/enforceLimit");
const ctrl = require("../../controller/Seller/sellerCustomerController");

// Seller's own buyer book (end customers + dealers). Any signed-in seller —
// the supplying company's approval is no longer a gate anywhere on this side.
router.use(auth);
router.get("/", ctrl.list);
// Creating a customer is capped per plan (free = 50, paid = unlimited).
router.post("/", authorize("customer:create"), loadSubscription, enforceLimit("customers"), ctrl.create);
router.get("/:id", ctrl.get);
router.put("/:id", authorize("customer:update"), ctrl.update);
router.get("/:id/history", ctrl.history);

module.exports = router;
