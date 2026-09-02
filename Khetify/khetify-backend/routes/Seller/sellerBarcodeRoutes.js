const express = require("express");

const auth = require("../../middlewares/authMiddlewares");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const { FEATURES } = require("../../config/plans");
const ctrl = require("../../controller/Seller/sellerBarcodeController");

// Seller unit labels: view / (re)print / scan / history — a PAID feature
// (UNIT_LABELS). The plan is the gate; scoped to the seller as current owner.
// NO generate route — sellers never mint serials (they receive labeled units).
const labelGate = [auth, loadSubscription, requireFeature(FEATURES.UNIT_LABELS)];

const units = express.Router();
units.use(...labelGate);
units.get("/", ctrl.listUnits);
units.post("/print", ctrl.print);
units.get("/:serial/history", ctrl.history);

const scan = express.Router();
scan.use(...labelGate);
scan.post("/", ctrl.scan);

module.exports = { units, scan };
