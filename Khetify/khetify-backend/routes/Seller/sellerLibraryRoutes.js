const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const {
  listLibraryCompanies,
  listLibraryProducts,
  listLibraryProductDetails,
} = require("../../controller/Seller/sellerLibraryController");

/**
 * INBUILT LIBRARY (seller side) — read-only names from the admin Product
 * Library, for the "Inbuilt Library" tab of My Products → Upload product.
 *
 * Mounted at /api/seller/library, so middlewares/principalRouteGuard already
 * refuses any non-seller token before this router runs. "myproduct:manage"
 * because the only caller is the upload form, which is a write flow.
 */
router.use(auth, authorize("myproduct:manage"));

router.get("/companies", listLibraryCompanies);
router.get("/products", listLibraryProducts);
router.get("/product-details", listLibraryProductDetails);

module.exports = router;
