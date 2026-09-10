const express = require("express");
const router = express.Router();
const notificationController = require("../../controller/Shop/shopNotificationController");
const consumerAuth = require("../../middlewares/consumerAuth");

// All routes require consumer authentication
router.use(consumerAuth);

/**
 * Stock Notification Routes
 */

// Subscribe to stock availability notification
router.post("/subscribe", notificationController.subscribeToStockNotification);

// Cancel stock notification subscription
router.delete("/stock/:notificationId", notificationController.cancelStockNotification);

// Get customer's stock notification subscriptions
router.get("/stock", notificationController.getStockNotifications);

/**
 * In-App Notification Routes
 */

// Get in-app notifications (inbox)
router.get("/inbox", notificationController.getInAppNotifications);

// Mark single notification as read
router.patch("/:notificationId/read", notificationController.markNotificationAsRead);

// Mark all notifications as read
router.patch("/mark-all-read", notificationController.markAllNotificationsAsRead);

// Delete single notification
router.delete("/:notificationId", notificationController.deleteNotification);

module.exports = router;
