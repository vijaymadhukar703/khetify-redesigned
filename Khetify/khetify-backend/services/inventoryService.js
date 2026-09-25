const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const { emitToCompany, emitToSeller } = require("../sockets");
const { notify } = require("./notificationService");
const stockNotificationService = require("./stockNotificationService");

/* ---------- helpers ---------- */

function emitInventoryUpdate(inv) {
  const payload = {
    productId: inv.productId,
    ownerType: inv.ownerType,
    ownerId: inv.ownerId,
    availableStock: inv.availableStock,
    reservedStock: inv.reservedStock,
  };
  if (inv.ownerType === "company") emitToCompany(inv.ownerId, "inventory:updated", payload);
  else emitToSeller(inv.ownerId, "inventory:updated", payload);

  // Customer "Notify Me" subscriptions: this is the ONE place every stock-
  // writing flow already calls (lot receive, seller's own stock add, bulk
  // packaging, scan-receive, GRN, adjustments, reserve/commit/release...) —
  // so hooking the check in here covers every restock path at once, instead
  // of only the single one (GRN) that had it wired before. Deliberately NOT
  // awaited: checkAndNotifyStockAvailability() catches its own errors and
  // never throws, and it's a no-op whenever availableStock is <= 0 or there
  // are no active subscribers, so this never blocks or risks the caller's
  // own inventory write. It's also self-idempotent — each subscription
  // flips to "notified" after firing once, so later inventory events for
  // the same product (e.g. a sale) don't re-notify the same subscriber.
  stockNotificationService.checkAndNotifyStockAvailability(inv.productId, null, inv.availableStock);
}

async function writeLedger(inv, { type, channel, quantity, refType, refId, performedBy, note }) {
  await StockMovement.create({
    inventoryId: inv._id,
    productId: inv.productId,
    ownerType: inv.ownerType,
    ownerId: inv.ownerId,
    type,
    channel: channel || "internal",
    quantity,
    balanceAfter: inv.availableStock,
    refType,
    refId,
    performedBy,
    note,
  });
}

async function checkLowStock(inv) {
  if (inv.lowStockThreshold > 0 && inv.availableStock <= inv.lowStockThreshold) {
    await notify({
      recipientType: inv.ownerType,
      recipientId: inv.ownerId,
      type: "low_stock",
      title: "Low stock alert",
      body: `Stock for a product has dropped to ${inv.availableStock}.`,
      payload: { productId: inv.productId, availableStock: inv.availableStock },
    });
  }
}

/* ---------- create / seed ---------- */

/**
 * Ensure an inventory row exists for a product+owner. Called when a product
 * is created in the marketplace, and lazily elsewhere.
 */
async function ensureInventory({ productId, ownerType, ownerId, warehouseId = null, lowStockThreshold = 0 }) {
  return Inventory.findOneAndUpdate(
    { productId, ownerType, ownerId, warehouseId, batchNumber: null },
    { $setOnInsert: { lowStockThreshold } },
    { new: true, upsert: true }
  );
}

/* ---------- core operations ---------- */

/**
 * Reserve stock at order placement. Atomic + overselling-proof:
 * the filter requires availableStock >= qty, so concurrent orders
 * for the last unit cannot both succeed.
 */
async function reserve({ productId, ownerType, ownerId, qty, refId, performedBy }) {
  const inv = await Inventory.findOneAndUpdate(
    { productId, ownerType, ownerId, availableStock: { $gte: qty } },
    { $inc: { reservedStock: qty, availableStock: -qty } },
    { new: true }
  );
  if (!inv) {
    const err = new Error("INSUFFICIENT_STOCK");
    err.status = 409;
    throw err;
  }
  await writeLedger(inv, { type: "reserve", quantity: -qty, refType: "Order", refId, performedBy });
  emitInventoryUpdate(inv);
  await checkLowStock(inv);
  return inv;
}

/** Fulfill: convert reserved into an actual sale (online or offline). */
async function commit({ productId, ownerType, ownerId, qty, channel = "online", refId, performedBy }) {
  const stockField = channel === "offline" ? "offlineStock" : "onlineStock";
  const inv = await Inventory.findOneAndUpdate(
    { productId, ownerType, ownerId, reservedStock: { $gte: qty } },
    { $inc: { reservedStock: -qty, [stockField]: -qty } },
    { new: true }
  );
  if (!inv) {
    const err = new Error("NO_RESERVATION");
    err.status = 409;
    throw err;
  }
  await writeLedger(inv, {
    type: channel === "offline" ? "sale_offline" : "sale_online",
    channel,
    quantity: -qty,
    refType: "Order",
    refId,
    performedBy,
  });
  emitInventoryUpdate(inv);
  return inv;
}

/** Release a reservation (order cancelled before fulfillment). */
async function release({ productId, ownerType, ownerId, qty, refId, performedBy }) {
  const inv = await Inventory.findOneAndUpdate(
    { productId, ownerType, ownerId, reservedStock: { $gte: qty } },
    { $inc: { reservedStock: -qty, availableStock: qty } },
    { new: true }
  );
  if (!inv) return null;
  await writeLedger(inv, { type: "release", quantity: qty, refType: "Order", refId, performedBy });
  emitInventoryUpdate(inv);
  return inv;
}

/** Restore stock on a return. */
async function restock({ productId, ownerType, ownerId, qty, channel = "online", refId, performedBy }) {
  const stockField = channel === "offline" ? "offlineStock" : "onlineStock";
  const inv = await Inventory.findOneAndUpdate(
    { productId, ownerType, ownerId },
    { $inc: { [stockField]: qty, availableStock: qty } },
    { new: true }
  );
  if (!inv) return null;
  await writeLedger(inv, { type: "return", channel, quantity: qty, refType: "Order", refId, performedBy });
  emitInventoryUpdate(inv);
  return inv;
}

/**
 * Manual correction (e.g. a stock count, damage, or initial stock-in).
 * delta is signed; channel decides which bucket it lands in.
 */
async function adjust({ productId, ownerType, ownerId, delta, channel = "online", note, performedBy }) {
  const stockField = channel === "offline" ? "offlineStock" : "onlineStock";
  const inv = await Inventory.findOneAndUpdate(
    { productId, ownerType, ownerId },
    { $inc: { [stockField]: delta, availableStock: delta } },
    { new: true, upsert: true }
  );
  await writeLedger(inv, {
    type: "adjustment",
    channel,
    quantity: delta,
    refType: "Manual",
    note,
    performedBy,
  });
  emitInventoryUpdate(inv);
  await checkLowStock(inv);
  return inv;
}

module.exports = {
  ensureInventory,
  reserve,
  commit,
  release,
  restock,
  adjust,
  emitInventoryUpdate,
  checkLowStock,
};