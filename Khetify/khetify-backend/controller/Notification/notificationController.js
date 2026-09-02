const Notification = require("../../model/Notification/Notification");
const Inventory = require("../../model/Inventory/Inventory");
const { notify } = require("../../services/notificationService");

const DAY = 86400000;

/** GET /api/notifications */
exports.getNotifications = async (req, res) => {
  try {
    const rows = await Notification.find({ recipientId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(100);
    const unread = rows.filter((n) => !n.read).length;
    res.json({ success: true, unread, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** PUT /api/notifications/:id/read */
exports.markRead = async (req, res) => {
  try {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientId: req.user.id },
      { read: true },
      { new: true }
    );

    
    if (!n) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: n });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** PUT /api/notifications/read-all — mark every notification read. */
exports.markAllRead = async (req, res) => {
  try {
    await Notification.updateMany({ recipientId: req.user.id, read: false }, { read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/notifications/scan — generate expiry + low-stock alerts from the
 * company's current lots. Idempotent: skips a (type, lot) pair that already has
 * an unread alert, so repeated scans don't spam duplicates.
 */
exports.scanAlerts = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const now = new Date();

    const lots = await Inventory.find({
      ownerType: "company",
      ownerId: companyId,
      batchNumber: { $ne: null },
      availableStock: { $gt: 0 },
    }).populate("productId", "productName");

    const existing = await Notification.find({
      recipientId: companyId,
      read: false,
      type: { $in: ["expiry", "low_stock"] },
    }).select("type payload");
    const seen = new Set(existing.map((n) => `${n.type}:${n.payload?.lotId}`));

    let created = 0;
    for (const l of lots) {
      const name = l.productId?.productName || "A product";
      const lotKey = String(l._id);

      // expiry
      if (l.expiryDate) {
        const days = Math.ceil((new Date(l.expiryDate) - now) / DAY);
        if (days <= 90 && !seen.has(`expiry:${lotKey}`)) {
          await notify({
            recipientType: "company",
            recipientId: companyId,
            type: "expiry",
            title: days < 0 ? "Lot expired" : "Lot expiring soon",
            body:
              days < 0
                ? `${name} — lot ${l.lotNumber || l.batchNumber} expired ${Math.abs(days)} day(s) ago.`
                : `${name} — lot ${l.lotNumber || l.batchNumber} expires in ${days} day(s).`,
            payload: { lotId: lotKey, productId: l.productId?._id, days },
          });
          created += 1;
        }
      }

      // low stock
      if (l.lowStockThreshold > 0 && l.availableStock <= l.lowStockThreshold && !seen.has(`low_stock:${lotKey}`)) {
        await notify({
          recipientType: "company",
          recipientId: companyId,
          type: "low_stock",
          title: "Low stock",
          body: `${name} — lot ${l.lotNumber || l.batchNumber} down to ${l.availableStock} unit(s).`,
          payload: { lotId: lotKey, productId: l.productId?._id, availableStock: l.availableStock },
        });
        created += 1;
      }
    }
    res.json({ success: true, created });
  } catch (err) {
    console.error("scanAlerts error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
