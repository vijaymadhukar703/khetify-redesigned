const express = require("express");
const router = express.Router();
const sellerStockRequestController = require("../../controller/Seller/sellerStockRequestController");
const authMiddleware = require("../../middlewares/authMiddlewares");

// All routes require seller authentication
router.use(authMiddleware);

/**
 * Seller Stock Request Routes
 * View pending stock notifications from customers
 */

// Get all pending stock requests for seller's products
router.get("/", sellerStockRequestController.getPendingStockRequests);

// Get interested customers for a specific product
router.get("/:productId", sellerStockRequestController.getInterestedCustomers);

// Get summary stats of stock requests
router.get("/stats/summary", sellerStockRequestController.getStockRequestStats);

module.exports = router;