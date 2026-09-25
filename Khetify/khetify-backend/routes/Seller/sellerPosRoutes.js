const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const ctrl = require("../../controller/Seller/sellerPosController");

// Counter sale: bill and stock deduction in one request. Reuses
// salesService.createOrder + sellerOrderController.shipOrder.
router.use(auth);
router.post("/sale", authorize("order:create"), ctrl.createSale);
// Viewing a past bill is a READ, so order:read rather than order:create.
router.get("/sale/:id/invoice", authorize("order:read"), ctrl.invoicePdf);

module.exports = router;
