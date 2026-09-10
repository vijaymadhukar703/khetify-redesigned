const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipientType: {
      type: String,
      enum: ["company", "seller", "warehouse_manager", "customer"],
      required: true,
    },
    recipientId: { type: mongoose.Schema.Types.ObjectId, required: true },
    type: {
      type: String,
      enum: ["low_stock", "expiry", "shipment", "order", "supply_status", "pc_status", "stock_available"],
      required: true,
    },
    title: { type: String },
    body: { type: String },
    payload: { type: Object },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ recipientId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ recipientType: 1, recipientId: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
