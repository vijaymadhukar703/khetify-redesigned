const express = require("express");
const router = express.Router();
const {
  createQuantityRequest,
  getCustomerQuantityRequests,
  deleteQuantityRequest,
} = require("../../controller/Shop/quantityRequestController");
const consumerAuth = require("../../middlewares/consumerAuth");

// POST is authenticated so we can trust customerId from token
// GET + DELETE also require auth — customers can only see/delete their own requests
router.use(consumerAuth);

// Base mount: /api/shop/quantity-requests
// POST /           → create a request  (customerId injected from JWT in controller)
// GET  /           → get own requests  (customerId from req.consumer.id in controller)
// DELETE /:id      → delete own request
router.post("/", createQuantityRequest);
router.get("/", getCustomerQuantityRequests);
router.delete("/:requestId", deleteQuantityRequest);

module.exports = router;