const { rollback } = require("../../middlewares/productUploadCleanup");
const express = require("express");
const router = express.Router();

const requireAdmin = require("../../middlewares/requireAdmin");
const validate = require("../../middlewares/validate");
// The same multer config the company and seller product routes use.
const upload = require("../../middlewares/upload");
const { createAdminProductBody, updateAdminProductBody } = require("../../validators/adminProductValidators");
const {
  applyUploadedImages,
  listAdminProducts,
  getAdminProduct,
  createAdminProduct,
  updateAdminProduct,
  duplicateCheck,
} = require("../../controller/Admin/adminProductController");

/**
 * ADMIN PRODUCT LIBRARY — mounted at /api/admin/products (Server.js), ahead of
 * the generic /api/admin router. Platform admin only.
 */
router.use(requireAdmin);

// Must be declared BEFORE "/:id", or "duplicate-check" is matched as an id.
router.get("/duplicate-check", duplicateCheck);

router.get("/", listAdminProducts);

// Multipart write routes: upload → normalise transport shape → validate → handler.
router.post(
  "/",
  upload.uploadProductFields,
  applyUploadedImages,
  validate({ body: createAdminProductBody }, rollback),
  createAdminProduct
);

router.get("/:id", getAdminProduct);
router.put(
  "/:id",
  upload.uploadProductFields,
  applyUploadedImages,
  validate({ body: updateAdminProductBody }, rollback),
  updateAdminProduct
);

module.exports = router;
