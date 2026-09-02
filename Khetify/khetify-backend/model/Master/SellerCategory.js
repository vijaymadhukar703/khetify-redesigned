const mongoose = require("mongoose");

/**
 * SELLER PRODUCT CATEGORY MASTER.
 *
 * The list behind "Primary product categories" in seller onboarding. Four rows
 * are seeded by the system (Seed, Pesticide, Fertilizer, Machinery); anything a
 * seller types through the form's "Other" box is added here, so the NEXT seller
 * sees it in the dropdown instead of retyping it.
 *
 * ── WHY nameKey EXISTS ──
 * `name` is what a human reads and is stored exactly as it was typed
 * ("Micronutrient"). Dedupe, though, has to be case-insensitive — "seeds",
 * "Seeds" and "SEEDS" are one category, and a unique index on `name` would let
 * all three in. `nameKey` is the lowercased, trimmed form and carries the unique
 * index, so the collection can never hold the same category twice under
 * different capitalisation.
 *
 * ── "Other" IS NOT A ROW ──
 * It is a UI affordance that opens the free-text box, never a category, so it is
 * deliberately absent from this collection.
 *
 * ── WHY SELLERS STORE NAMES, NOT IDS ──
 * Seller.sellerInfo.productCategories keeps the category NAMES. If a row here is
 * later renamed or deactivated, every existing seller's saved data still reads
 * the same — the master feeds the picker, it does not own the seller's answer.
 */
const sellerCategorySchema = new mongoose.Schema(
  {
    // Display name, as typed: "Micronutrient".
    name: { type: String, required: true, trim: true },

    // name.toLowerCase().trim() — the real uniqueness key (see above).
    nameKey: { type: String, required: true, unique: true, trim: true },

    // true for the four rows the seeder owns. Kept so a system category can be
    // told apart from one a seller invented (and so the seeder can be re-run
    // without claiming seller-created rows).
    isSeeded: { type: Boolean, default: false },

    // Which seller first added it. null for seeded rows.
    createdBySellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", default: null },

    // Soft delete: the picker only offers active rows, while sellers who already
    // chose a now-retired category keep their saved value untouched.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

sellerCategorySchema.index({ nameKey: 1 }, { unique: true });

module.exports = mongoose.model("SellerCategory", sellerCategorySchema);
