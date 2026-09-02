const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const ctrl = require("../../controller/Seller/sellerTraceController");

// Seller traceability — scan a unit/lot and see its journey. Read-only;
// inventory:read (seller_admin / manager / staff all hold it).
router.use(auth, authorize("inventory:read"));
router.get("/unit/:serial", ctrl.unit);
router.get("/lot/:lotNumber", ctrl.lot);

module.exports = router;
