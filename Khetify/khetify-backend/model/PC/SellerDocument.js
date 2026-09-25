const mongoose = require("mongoose");

/**
 * A KYC / business document a seller uploads once and reuses across Principal
 * Certificate applications. Files live in S3 (services/storage.js); we keep the
 * key + url + metadata here. Owner-scoped strictly by sellerId.
 */
const sellerDocumentSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    // The five licence types at the end are ADDED, nothing removed — every
    // existing value still validates, so no stored document changes meaning.
    docType: {
      type: String,
      enum: [
        "gst", "pan", "license", "business_registration", "address_proof", "other",
        "tan", "gumasta", "udyam", "agriculture", "horticulture",
      ],
      default: "other",
    },
    label: { type: String },

    // The licence/registration number printed on THIS certificate.
    //
    // A snapshot that travels with the file, so a stored certificate is
    // self-describing. It is NOT the editable source of truth: a seller can
    // type a licence number without uploading anything, and this row cannot
    // exist without a file (`fileKey` is required). The authoritative value
    // lives on Seller.verification.licences and is what the Profile reads.
    documentNumber: { type: String },
    fileKey: { type: String, required: true },
    fileUrl: { type: String },
    fileName: { type: String },
    mimeType: { type: String },
    status: { type: String, enum: ["pending", "verified", "rejected"], default: "pending" },
    note: { type: String },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

sellerDocumentSchema.index({ sellerId: 1, createdAt: -1 });

module.exports = mongoose.model("SellerDocument", sellerDocumentSchema);
