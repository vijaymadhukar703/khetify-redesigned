const mongoose = require("mongoose");

const quantityRequestSchema = new mongoose.Schema(
  {
    // Customer who submitted the request
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    customerName: { type: String },
    customerEmail: { type: String },
    customerPhone: { type: String },

    // Product and listing information
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MasterProduct",
      required: true,
    },
    listingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Listing",
      required: true,
    },
    productName: { type: String },
    productImage: { type: String },

    // Variant details (if variant selected)
    variantId: { type: String }, // SKU or variant ID
    variantDetails: {
      label: { type: String },
      attributes: { type: Object }, // { color: "Red", size: "M" }
      image: { type: String },
    },

    // Request details
    requestedQuantity: {
      type: Number,
      required: true,
      min: 1,
    },
    isUrgent: {
      type: Boolean,
      default: false,
    },

    // Seller information
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
    },
    sellerName: { type: String },

    // Request status
    status: {
      type: String,
      enum: ["pending", "fulfilled", "rejected", "partially_fulfilled"],
      default: "pending",
    },
    rejectionReason: { type: String }, // If rejected
    sellerMessage: { type: String },   // Free-text reply seller sends to customer

    // Track whether customer has seen this request
    viewedByCustomer: { type: Boolean, default: false },
    viewedBySeller: { type: Boolean, default: false },

    // Additional notes
    notes: { type: String },
  },
  { timestamps: true }
);

// Index for faster queries
quantityRequestSchema.index({ customerId: 1, createdAt: -1 });
quantityRequestSchema.index({ sellerId: 1, createdAt: -1 });
quantityRequestSchema.index({ listingId: 1, createdAt: -1 });
quantityRequestSchema.index({ status: 1, createdAt: -1 });
quantityRequestSchema.index({ sellerId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("QuantityRequest", quantityRequestSchema);