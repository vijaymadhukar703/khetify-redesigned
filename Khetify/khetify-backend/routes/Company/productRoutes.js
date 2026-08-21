const express = require("express");
const router = express.Router();
const upload = require("../../middlewares/upload");
const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");

const {
  createProduct,
  getSingleProduct,
  getAllProducts,
  updateProduct,
  deleteProduct,
} = require("../../controller/Company/productController");

// Products are company master data: WRITES are company_admin-only.
// "product:manage" resolves only through the admin "*" wildcard, so
// operations/sales managers get 403 here while reads stay unchanged.
router.post("/create", auth, authorize("product:manage"), upload.uploadProductFields, createProduct);

// ✅ Get all products (scoped to the authenticated company)
router.get("/all", auth, getAllProducts);

// ✅ Get single product
router.get("/:productId", getSingleProduct);

router.put("/:productId", auth, authorize("product:manage"), upload.uploadProductFields, updateProduct);

router.delete("/delete-product/:productId", auth, authorize("product:manage"), deleteProduct);

module.exports = router;
