const mongoose = require("mongoose");
const StockNotification = require("../model/Shop/StockNotification");
const Notification = require("../model/Notification/Notification");
const Product = require("../model/Company/productModel");
const Consumer = require("../model/Shop/Consumer");
const SellerListing = require("../model/PC/SellerListing");

/**
 * Service to manage stock notifications for customers
 */
class StockNotificationService {
  /**
   * Create a stock notification request for a customer
   * @param {String} customerId - Consumer ID
   * @param {String} productId - Product ID
   * @param {String} variantLabel - Variant label for display
   * @param {Object} notificationChannels - Preferred channels (email, sms, inApp)
   * @param {String} [listingId] - The marketplace SellerListing the customer was viewing (used to attribute this request to the right seller)
   * @returns {Object} - Created StockNotification
   */
  async createStockNotification(
    customerId,
    productId,
    variantLabel,
    notificationChannels = { email: true, sms: false, inApp: true },
    listingId = null
  ) {
    try {
      // Validate product exists
      const product = await Product.findById(productId);
      if (!product) {
        throw { status: 404, message: "Product not found" };
      }

      // Validate consumer exists
      const consumer = await Consumer.findById(customerId);
      if (!consumer) {
        throw { status: 404, message: "Customer not found" };
      }

      // Check for existing notification for this customer+product, in ANY
      // status. `{ customerId, productId }` is a unique index in the model,
      // so a second `.save()` for the same pair always throws E11000 — even
      // when the existing record is cancelled/expired/notified, not
      // pending. So anything but a genuinely "active" record must be
      // REACTIVATED in place, not inserted fresh, or every re-subscribe
      // attempt (including a customer's SECOND time being notified about
      // the same product) crashes with "Subscription Failed: E11000
      // duplicate key error".
      const existingNotification = await StockNotification.findOne({
        customerId,
        productId,
      });

      if (existingNotification && existingNotification.status === "active") {
        // Only a genuinely PENDING request blocks a new one. "notified"
        // means the customer's last request was already fulfilled once —
        // e.g. they subscribed, the product restocked and they got told,
        // and it has since gone out of stock again. That is a completed
        // request, not a duplicate, so it must fall through to reactivation
        // below just like a cancelled/expired one — otherwise a customer
        // could only ever be notified about a product ONE time, ever.
        throw {
          status: 409,
          message: "You have already requested notification for this product",
        };
      }

      // Determine the seller AND the storefront listing to attribute this
      // request to.
      //
      // `product.sellerId` is ONLY set for `ownerType: "seller"` (a seller's
      // OWN "My Products" upload) — see model/Company/productModel.js. The
      // far more common storefront case is a COMPANY product that a seller
      // has published to the marketplace via a SellerListing; for those,
      // product.sellerId is null, so relying on it alone silently drops the
      // notification for every company product (it saves with sellerId:
      // null, which then matches no seller's Demand Monitor query).
      //
      // The resolved listing's _id is ALSO stored (see listingId on the
      // model) and carried into the "stock available" in-app notification's
      // payload — the storefront product route is /customer-shop/product/
      // :listingId, not /:productId, so without this the notification's
      // "View Product" link opens a page that can never resolve.
      //
      // Prefer the SPECIFIC listing the customer was actually looking at
      // (passed from the product page as listingId — correct even when
      // several sellers list the same company product). Fall back to the
      // product's own sellerId for a seller's own product, and finally to
      // any published listing of this product as a best-effort default for
      // older callers that don't send listingId.
      let sellerId = null;
      let resolvedListingId = null;
      if (listingId && mongoose.isValidObjectId(listingId)) {
        const listing = await SellerListing.findOne({ _id: listingId, productId }).select("sellerId");
        if (listing) {
          sellerId = listing.sellerId;
          resolvedListingId = listing._id;
        }
      }
      if (!sellerId && product.ownerType === "seller") {
        sellerId = product.sellerId;
      }
      if (!resolvedListingId) {
        const anyListing = await SellerListing.findOne({ productId, status: "published" }).select("sellerId");
        if (anyListing) {
          resolvedListingId = anyListing._id;
          if (!sellerId) sellerId = anyListing.sellerId;
        }
      }

      if (existingNotification) {
        // Reactivate the cancelled/expired/already-notified record instead
        // of inserting a new one (which would collide with the unique
        // index) — this is what lets a customer be notified again after a
        // product goes out of stock a second time.
        existingNotification.set({
          variantLabel,
          sellerId,
          listingId: resolvedListingId,
          notificationChannels,
          status: "active",
          notifiedAt: null,
          cancellationReason: null,
          notificationCount: 0,
        });
        await existingNotification.save();
        return existingNotification;
      }

      // Create the notification request
      const stockNotification = new StockNotification({
        customerId,
        productId,
        variantLabel,
        sellerId,
        listingId: resolvedListingId,
        notificationChannels,
      });

      await stockNotification.save();
      return stockNotification;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Cancel a stock notification request
   * @param {String} notificationId - StockNotification ID
   * @param {String} customerId - Consumer ID (for authorization)
   * @returns {Object} - Updated StockNotification
   */
  async cancelStockNotification(notificationId, customerId) {
    try {
      const notification = await StockNotification.findById(notificationId);

      if (!notification) {
        throw { status: 404, message: "Notification request not found" };
      }

      // Verify ownership
      if (notification.customerId.toString() !== customerId) {
        throw {
          status: 403,
          message: "Unauthorized: Can only cancel your own notifications",
        };
      }

      notification.status = "cancelled";
      notification.cancellationReason = "customer_cancelled";
      await notification.save();

      return notification;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get all notifications for a customer
   * @param {String} customerId - Consumer ID
   * @param {Object} options - Pagination/filter options
   * @returns {Object} - List of notifications with pagination
   */
  async getCustomerNotifications(customerId, options = {}) {
    try {
      const {
        status = ["active", "notified"],
        limit = 20,
        page = 1,
      } = options;

      const skip = (page - 1) * limit;

      const notifications = await StockNotification.find({
        customerId,
        status: { $in: Array.isArray(status) ? status : [status] },
      })
        .populate("productId", "productName brandName product_code")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await StockNotification.countDocuments({
        customerId,
        status: { $in: Array.isArray(status) ? status : [status] },
      });

      return {
        notifications,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get pending stock requests for a seller (for dashboard/analytics)
   * @param {String} sellerId - Seller ID
   * @returns {Array} - List of products with pending notifications
   */
  async getSellerPendingRequests(sellerId) {
    try {
      // Get all active stock notifications for this seller
      const pendingRequests = await StockNotification.aggregate([
        {
          $match: {
            sellerId: new mongoose.Types.ObjectId(sellerId),
            status: "active",
          },
        },
        {
          $group: {
            _id: "$productId",
            interestedCustomers: { $sum: 1 },
            variantLabel: { $first: "$variantLabel" },
          },
        },
        {
          $lookup: {
            from: "products",
            localField: "_id",
            foreignField: "_id",
            as: "product",
          },
        },
        {
          $unwind: {
            path: "$product",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            productId: "$_id",
            productName: "$product.productName",
            productCode: "$product.product_code",
            variantLabel: 1,
            interestedCustomers: 1,
          },
        },
        {
          $sort: { interestedCustomers: -1 },
        },
      ]);

      return pendingRequests;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Check if product stock is now available and notify subscribers
   * This is called after every inventory update (sale, GRN, adjustment, transfer)
   * @param {String} productId - Product ID
   * @param {String} variantId - Variant ID (for matching)
   * @param {Number} newStock - New stock quantity
   * @returns {Object} - Notification summary
   */
  async checkAndNotifyStockAvailability(productId, variantId, newStock) {
    try {
      // Only proceed if stock is now available (> 0)
      if (newStock <= 0) {
        return { notified: 0, error: null };
      }

      // Find all active subscription requests for this product
      const subscriptions = await StockNotification.find({
        productId,
        status: "active",
      }).populate("customerId");

      if (subscriptions.length === 0) {
        return { notified: 0, error: null };
      }

      // Get product details
      const product = await Product.findById(productId).lean();
      if (!product) {
        return { notified: 0, error: "Product not found" };
      }

      // Create and send notifications to all subscribers
      const notifiedCount = await this._notifySubscribers(
        subscriptions,
        product
      );

      return { notified: notifiedCount, error: null };
    } catch (error) {
      console.error("Error in checkAndNotifyStockAvailability:", error);
      return { notified: 0, error: error.message };
    }
  }

  /**
   * Internal: Send notifications to subscribers
   * @private
   */
  async _notifySubscribers(subscriptions, product) {
    let notifiedCount = 0;

    // Computed once per product (not once per subscriber) — a fallback for
    // subscriptions saved before the `listingId` field existed on the model.
    const fallbackListingId = subscriptions.some((s) => !s.listingId)
      ? await this._fallbackListingId(product._id)
      : null;

    for (const subscription of subscriptions) {
      try {
        // Create in-app notification
        const notification = new Notification({
          recipientType: "customer",
          recipientId: subscription.customerId._id,
          type: "stock_available",
          title: `${product.productName} is now available!`,
          body: `${subscription.variantLabel || "This product"} is back in stock. Limited quantity available.`,
          payload: {
            productId: product._id,
            // The storefront route is /customer-shop/product/:listingId, NOT
            // /:productId — without this, "View Product" on the notification
            // opens a page that can never resolve a product.
            listingId: subscription.listingId || fallbackListingId,
            productName: product.productName,
            variantLabel: subscription.variantLabel,
            productCode: product.product_code,
          },
          read: false,
        });

        await notification.save();

        // Update StockNotification record
        subscription.status = "notified";
        subscription.notifiedAt = new Date();
        subscription.notificationCount = (subscription.notificationCount || 0) + 1;
        await subscription.save();

        notifiedCount++;
      } catch (innerError) {
        console.error(
          `Failed to notify customer ${subscription.customerId._id}:`,
          innerError
        );
      }
    }

    return notifiedCount;
  }

  /**
   * Best-effort lookup of any published listing for a product, for
   * subscriptions saved before the `listingId` field existed on the model.
   * @private
   */
  async _fallbackListingId(productId) {
    const listing = await SellerListing.findOne({ productId, status: "published" }).select("_id");
    return listing ? listing._id : null;
  }

  /**
   * Cancel all notifications for a product (when product is deleted/unpublished)
   * @param {String} productId - Product ID
   * @param {String} reason - Cancellation reason
   */
  async cancelNotificationsForProduct(productId, reason = "product_deleted") {
    try {
      const result = await StockNotification.updateMany(
        {
          productId,
          status: { $in: ["active", "notified"] },
        },
        {
          status: "cancelled",
          cancellationReason: reason,
        }
      );

      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Clean up expired notifications (optional maintenance task)
   * Notifications older than 30 days are marked as expired
   */
  async cleanupExpiredNotifications(daysOld = 30) {
    try {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() - daysOld);

      const result = await StockNotification.updateMany(
        {
          status: "active",
          createdAt: { $lt: expiryDate },
        },
        {
          status: "expired",
          cancellationReason: "expired",
        }
      );

      return result;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new StockNotificationService();