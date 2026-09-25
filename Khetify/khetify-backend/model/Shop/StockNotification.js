const mongoose = require("mongoose");

const stockNotificationSchema = new mongoose.Schema(
  {
    // Customer who requested the notification
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consumer",
      required: true,
      index: true,
    },

    // Product being requested
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    // Variant label for display (stored in case product/variant is deleted)
    variantLabel: { type: String },

    // Seller who owns this product (denormalized for quick seller lookup)
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      index: true,
      default: null,
    },

    // The marketplace SellerListing this request came from (the storefront
    // product page route is /customer-shop/product/:listingId, NOT
    // /:productId — this is what "View Product" on the resulting
    // notification needs to actually open the right page). Null when no
    // published listing could be resolved at subscribe time.
    listingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SellerListing",
      default: null,
    },

    // Current status of the request
    status: {
      type: String,
      enum: ["active", "notified", "cancelled", "expired"],
      default: "active",
      index: true,
    },

    // Customer's preferred notification channel(s)
    notificationChannels: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      inApp: { type: Boolean, default: true },
    },

    // When the notification was actually sent (if status is 'notified')
    notifiedAt: { type: Date },

    // Why the notification was cancelled or expired
    cancellationReason: {
      type: String,
      enum: [
        "customer_cancelled",
        "product_deleted",
        "product_unpublished",
        "expired",
        null,
      ],
      default: null,
    },

    // Number of times customer was notified for this request
    notificationCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Ensure one customer can only subscribe once per product
stockNotificationSchema.index(
  { customerId: 1, productId: 1 },
  { unique: true, sparse: true }
);

// Index for finding all subscriptions for a seller
stockNotificationSchema.index({ sellerId: 1, status: 1 });

// Index for cleaning up expired subscriptions
stockNotificationSchema.index({ createdAt: 1, status: 1 });

module.exports = mongoose.model("StockNotification", stockNotificationSchema);