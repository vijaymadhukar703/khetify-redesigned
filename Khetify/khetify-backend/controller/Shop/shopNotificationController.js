const StockNotification = require("../../model/Shop/StockNotification");
const Notification = require("../../model/Notification/Notification");
const stockNotificationService = require("../../services/stockNotificationService");

/**
 * Customer Notification Controller
 * Handles stock notifications and customer notification preferences
 */
exports.subscribeToStockNotification = async (req, res) => {
  try {
    const { productId, listingId, variantLabel, notificationChannels } = req.body;
    const customerId = req.consumer.id;

    // Validate input
    if (!productId) {
      return res.status(400).json({ success: false, message: "Product ID is required" });
    }

    // Create subscription
    const subscription = await stockNotificationService.createStockNotification(
      customerId,
      productId,
      variantLabel,
      notificationChannels || { email: true, sms: false, inApp: true },
      listingId
    );

    return res.status(201).json({
      success: true,
      message: "You will be notified when this product is back in stock",
      data: subscription,
    });
  } catch (error) {
    console.error("Error subscribing to stock notification:", error);

    if (error.status === 409) {
      return res.status(409).json({ success: false, message: error.message });
    }

    if (error.status === 404) {
      return res.status(404).json({ success: false, message: error.message });
    }

    return res.status(error.status || 500).json({ success: false, message: error.message || "Server error" });
  }
};

/**
 * Cancel a stock notification subscription
 * DELETE /api/shop/notifications/stock/:notificationId
 */
exports.cancelStockNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const customerId = req.consumer.id;

    const result = await stockNotificationService.cancelStockNotification(
      notificationId,
      customerId
    );

    return res.status(200).json({
      success: true,
      message: "Notification subscription cancelled",
      data: result,
    });
  } catch (error) {
    console.error("Error cancelling stock notification:", error);

    if (error.status === 404) {
      return res.status(404).json({ success: false, message: error.message });
    }

    if (error.status === 403) {
      return res.status(403).json({ success: false, message: error.message });
    }

    return res.status(error.status || 500).json({ success: false, message: error.message || "Server error" });
  }
};

/**
 * Get all active stock notifications for the logged-in customer
 * GET /api/shop/notifications/stock
 */
exports.getStockNotifications = async (req, res) => {
  try {
    const customerId = req.consumer.id;
    const { status = "active", page = 1, limit = 20 } = req.query;

    const result = await stockNotificationService.getCustomerNotifications(
      customerId,
      {
        status: status ? status.split(",") : ["active"],
        page: parseInt(page),
        limit: parseInt(limit),
      }
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching stock notifications:", error);
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

/**
 * Get all notifications (in-app) for the logged-in customer
 * GET /api/shop/notifications/inbox
 */
exports.getInAppNotifications = async (req, res) => {
  try {
    const customerId = req.consumer.id;
    const { read = null, page = 1, limit = 20 } = req.query;

    // Build query
    const query = {
      recipientType: "customer",
      recipientId: customerId,
    };

    if (read !== null) {
      query.read = read === "true";
    }

    const skip = (page - 1) * limit;

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(query);

    // Count unread
    const unreadCount = await Notification.countDocuments({
      recipientType: "customer",
      recipientId: customerId,
      read: false,
    });

    return res.status(200).json({
      success: true,
      data: {
        notifications,
        total,
        unreadCount,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching in-app notifications:", error);
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

/**
 * Mark a notification as read
 * PATCH /api/shop/notifications/:notificationId/read
 */
exports.markNotificationAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const customerId = req.consumer.id;

    const notification = await Notification.findById(notificationId);

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    if (notification.recipientId.toString() !== customerId) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    notification.read = true;
    await notification.save();

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data: notification,
    });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

/**
 * Mark all notifications as read for a customer
 * PATCH /api/shop/notifications/mark-all-read
 */
exports.markAllNotificationsAsRead = async (req, res) => {
  try {
    const customerId = req.consumer.id;

    const result = await Notification.updateMany(
      {
        recipientType: "customer",
        recipientId: customerId,
        read: false,
      },
      { read: true }
    );

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      data: {
        modifiedCount: result.modifiedCount,
      },
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

/**
 * Delete a notification
 * DELETE /api/shop/notifications/:notificationId
 */
exports.deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const customerId = req.consumer.id;

    const notification = await Notification.findById(notificationId);

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    if (notification.recipientId.toString() !== customerId) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    await Notification.findByIdAndDelete(notificationId);

    return res.status(200).json({
      success: true,
      message: "Notification deleted",
    });
  } catch (error) {
    console.error("Error deleting notification:", error);
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};