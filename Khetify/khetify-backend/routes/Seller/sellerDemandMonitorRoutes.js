const express = require("express");
const router = express.Router();
const {
  getSellerQuantityRequests,
  getInterestedUsers,
  updateRequestStatus,
  getQuantityRequestsSummary,
} = require("../../controller/Shop/quantityRequestController");
const authMiddleware = require("../../middlewares/authMiddlewares");

// All routes require seller authentication — sellerId comes from the token
// (req.user.sellerId), never from the URL, mirroring sellerStockRequestRoutes.
router.use(authMiddleware);

// Base mount: /api/seller/quantity-requests (see Server.js)
// Matches lib/sellerApi.js calls exactly:
//   GET  quantity-requests
//   GET  quantity-requests/interested/:productId
//   PUT  quantity-requests/:requestId/status
//   GET  quantity-requests/summary
router.get("/", getSellerQuantityRequests);
router.get("/interested/:productId", getInterestedUsers);
router.put("/:requestId/status", updateRequestStatus);
router.get("/summary", getQuantityRequestsSummary);

module.exports = router;
