const { prepare } = require("../../services/variantEditCompatibility");
const express = require("express");
const validateVariantMeasurements = require("../../validators/companyVariantMeasurements");
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
  cleanupFinishedDeletedProducts,
} = require("../../controller/Company/productController");

// Products are company master data: WRITES are company_admin-only.
// "product:manage" resolves only through the admin "*" wildcard, so
// operations/sales managers get 403 here while reads stay unchanged.
router.post("/create", auth, authorize("product:manage"), upload.uploadProductFields, validateVariantMeasurements, createProduct);

// ✅ Get all products (scoped to the authenticated company)
router.get("/all", auth, getAllProducts);

// ✅ Get single product
router.get("/:productId", getSingleProduct);

router.put("/:productId", auth, authorize("product:manage"), upload.uploadProductFields, prepare("company"), validateVariantMeasurements, updateProduct);

router.delete("/delete-product/:productId", auth, authorize("product:manage"), deleteProduct);

// ⚠️ ADMIN ONLY — MAINTENANCE OPERATION
// Permanently delete finished deleted products from database.
// Run when:
// - Stock for a deleted product reaches 0 (completely sold/consumed)
// - Want to clean up old deleted products to maintain database hygiene
// SAFE: Checks that product is deleted AND has no remaining stock
router.post("/cleanup/finished-deleted", auth, authorize("product:manage"), cleanupFinishedDeletedProducts);

module.exports = router;