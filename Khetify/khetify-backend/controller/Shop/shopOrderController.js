const orderService = require("../../services/shopOrderService");

exports.checkout = async (req, res) => {
  try {
    const orders = await orderService.checkout(req.consumer.id, req.body);
    res.status(201).json({
      success: true,
      message: orders.length > 1 ? `${orders.length} orders placed` : "Order placed",
      data: orders,
      count: orders.length,
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

exports.listOrders = async (req, res) => {
  try {
    const orders = await orderService.listOrders(req.consumer.id);
    res.json({ success: true, data: orders, count: orders.length });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

exports.getOrder = async (req, res) => {
  try {
    const order = await orderService.getOrder(req.consumer.id, req.params.id);
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * 🛒 POST /api/shop/orders/:id/cancel
 * A shopper cancelling their own order. Allowed only while it is "pending"
 * (before the seller reserves stock) — the service enforces that.
 */
exports.cancelOrder = async (req, res) => {
  try {
    const order = await orderService.cancelOrder(req.consumer.id, req.params.id, req.body?.reason);
    res.json({ success: true, message: "Order cancelled", data: order });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

exports.listAddresses = async (req, res) => {
  try {
    const addresses = await orderService.listAddresses(req.consumer.id);
    res.json({ success: true, data: addresses });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

exports.addAddress = async (req, res) => {
  try {
    const addresses = await orderService.addAddress(req.consumer.id, req.body);
    res.status(201).json({ success: true, message: "Address saved", data: addresses });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * 👤 PROFILE — PUT /api/shop/addresses/:addressId
 * Edit a saved address in place. Every handler returns the FULL updated address
 * list (same as add/delete already do), so the UI never has to re-fetch.
 */
exports.updateAddress = async (req, res) => {
  try {
    const addresses = await orderService.updateAddress(req.consumer.id, req.params.addressId, req.body);
    res.json({ success: true, message: "Address updated", data: addresses });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** 👤 PROFILE — PATCH /api/shop/addresses/:addressId/default */
exports.setDefaultAddress = async (req, res) => {
  try {
    const addresses = await orderService.setDefaultAddress(req.consumer.id, req.params.addressId);
    res.json({ success: true, message: "Default address updated", data: addresses });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

exports.deleteAddress = async (req, res) => {
  try {
    const addresses = await orderService.deleteAddress(req.consumer.id, req.params.addressId);
    res.json({ success: true, message: "Address removed", data: addresses });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};