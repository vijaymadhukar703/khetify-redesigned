const express = require("express");
const router = express.Router();
const auth = require("../../middlewares/authMiddlewares");
const { listSellerCategories, createSellerCategory } = require("../../controller/Master/sellerCategoryController");

// Seller product-category master: read the dropdown, append to it.
// Both require a token — an anonymous caller must never be able to write into a
// list every seller reads. No approval/subscription gate: this is used during
// onboarding, before a seller is approved.
router.get("/", auth, listSellerCategories);
router.post("/", auth, createSellerCategory);

module.exports = router;
