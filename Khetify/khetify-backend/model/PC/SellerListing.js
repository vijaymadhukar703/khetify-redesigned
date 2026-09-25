const mongoose = require("mongoose");

/**
 * A seller's published marketplace listing. TWO kinds now live here:
 *
 *   ownerType "company" — a COMPANY's product the seller resells. Gated by
 *       requireActivePC(companyId) + an active subscription, so the listing can
 *       only exist while the seller is an authorized reseller of that company.
 *       Unchanged in every respect.
 *
 *   ownerType "seller"  — the seller's OWN uploaded product (My Products).
 *       There is no company in the picture at all, so there is no PC to hold
 *       and `companyId` is null.
 *
 * READING RULE: never filter on `ownerType: "company"`. Every listing written
 * before this field existed does not carry it, and .lean() applies no schema
 * default — such a filter would hide all of them. Match POSITIVELY on
 * `ownerType: "seller"` to find the seller-own ones; everything else is a
 * company listing.
 */
const sellerListingSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },

    // WHOSE product this listing is for — see the note above. ADDITIVE and
    // defaulted, so every existing listing reads as a company listing.
    ownerType: { type: String, enum: ["company", "seller"], default: "company" },

    // The company whose product this is. CONDITIONALLY required: a listing of
    // the seller's OWN product has no company, so the requirement is lifted for
    // those rows only. Company listings behave exactly as before.
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      required: function () {
        return this.ownerType !== "seller";
      },
    },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    status: { type: String, enum: ["published", "unpublished"], default: "published" },
    price: { type: Number },
    publishedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// UNCHANGED. With companyId null for a seller-own listing this still gives the
// uniqueness that matters — one listing per (seller, product) — because null is
// a single, indexable value. No new index, no migration.
sellerListingSchema.index({ sellerId: 1, companyId: 1, productId: 1 }, { unique: true });

module.exports = mongoose.model("SellerListing", sellerListingSchema);
