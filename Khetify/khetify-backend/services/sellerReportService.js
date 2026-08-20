const mongoose = require("mongoose");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const { streamCsv } = require("./reportService");

/**
 * Seller analytics reports — the owner-aware mirror of services/reportService.js
 * but scoped to a SELLER ({ ownerType:"seller", ownerId }) and valued at MRP
 * (sellers never see cost). Each report also accepts a `warehouseIds` scope
 * array injected by the controller for a warehouse-scoped seller_manager, so a
 * manager's numbers are exactly the admin's numbers filtered to their assigned
 * warehouse(s) — one source of truth (services/warehouseScope.js).
 *
 * Reuses reportService.streamCsv for CSV export (no duplication).
 */
const DAY = 86400000;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const daysBetween = (a, b) => Math.floor((a - b) / DAY);

function dateRange(from, to) {
  const r = {};
  if (from) r.$gte = new Date(from);
  if (to) r.$lte = new Date(to);
  return Object.keys(r).length ? r : null;
}

/** Add the warehouse filter: explicit single warehouseId, else the scope $in. */
function applyWhFilter(filter, { warehouseId, warehouseIds } = {}, field = "warehouseId") {
  if (warehouseId) filter[field] = warehouseId;
  else if (Array.isArray(warehouseIds) && warehouseIds.length) filter[field] = { $in: warehouseIds };
  return filter;
}

const ownerFilter = (sellerId) => ({ ownerType: "seller", ownerId: sellerId });
const PRODUCT_SELECT = "productName skuNumber category mrp unit";
const mrpValue = (r) => round2((r.availableStock || 0) * (r.productId?.mrp || 0));

/* 1 ── stock on hand (MRP valuation) */
async function stockOnHand(sellerId, params = {}) {
  const filter = applyWhFilter({ ...ownerFilter(sellerId), batchNumber: { $ne: null }, availableStock: { $gt: 0 } }, params);
  const rows = await Inventory.find(filter).populate("productId", PRODUCT_SELECT).populate("warehouseId", "name code");
  return rows.map((r) => ({
    // INTERNAL KEY (leading underscore) — the seller lot row this report line was
    // derived from, so Seller → Analytics → View can open its details. Stripped
    // from the CSV by reportService.streamCsv and hidden by the table, so no
    // report column or exported file changes shape.
    _inventoryId: String(r._id),
    product: r.productId?.productName || "—",
    sku: r.productId?.skuNumber || "",
    warehouse: r.warehouseId?.name || "Unassigned",
    lot: r.lotNumber || r.batchNumber || "",
    batch: r.batchNumber || "",
    qty: r.availableStock,
    mrp: round2(r.productId?.mrp || 0),
    value: mrpValue(r),
    expiry: r.expiryDate ? r.expiryDate.toISOString().slice(0, 10) : "",
  }));
}

/* 2 ── stock aging (days since the lot row was created ≈ receipt) */
async function stockAging(sellerId, params = {}) {
  const filter = applyWhFilter({ ...ownerFilter(sellerId), batchNumber: { $ne: null }, availableStock: { $gt: 0 } }, params);
  const rows = await Inventory.find(filter).populate("productId", PRODUCT_SELECT).populate("warehouseId", "name");
  const now = Date.now();
  const bucket = (d) => (d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "90+");
  return rows.map((r) => {
    const age = daysBetween(now, new Date(r.createdAt).getTime());
    return { product: r.productId?.productName || "—", warehouse: r.warehouseId?.name || "Unassigned", lot: r.lotNumber || r.batchNumber, qty: r.availableStock, ageDays: age, bucket: bucket(age), value: mrpValue(r) };
  });
}

/* 3 ── expiry risk (value at risk within a 90-day horizon, MRP) */
async function expiryRisk(sellerId, params = {}) {
  const now = new Date();
  const horizon = new Date(now.getTime() + 90 * DAY);
  const filter = applyWhFilter({ ...ownerFilter(sellerId), availableStock: { $gt: 0 }, expiryDate: { $ne: null, $lte: horizon } }, params);
  const rows = await Inventory.find(filter).populate("productId", PRODUCT_SELECT).populate("warehouseId", "name").sort({ expiryDate: 1 });
  return rows.map((r) => {
    const d = daysBetween(new Date(r.expiryDate).getTime(), now.getTime());
    return { product: r.productId?.productName || "—", warehouse: r.warehouseId?.name || "Unassigned", lot: r.lotNumber || r.batchNumber, qty: r.availableStock, daysToExpiry: d, bucket: d < 0 ? "expired" : d <= 30 ? "≤30" : d <= 60 ? "≤60" : "≤90", valueAtRisk: mrpValue(r) };
  });
}

/* 4 ── low stock (at or below the reorder level) */
async function lowStock(sellerId, params = {}) {
  const filter = applyWhFilter({ ...ownerFilter(sellerId), batchNumber: { $ne: null }, lowStockThreshold: { $gt: 0 }, $expr: { $lte: ["$availableStock", "$lowStockThreshold"] } }, params);
  const rows = await Inventory.find(filter).populate("productId", PRODUCT_SELECT).populate("warehouseId", "name code");
  return rows.map((r) => ({
    product: r.productId?.productName || "—",
    sku: r.productId?.skuNumber || "",
    warehouse: r.warehouseId?.name || "Unassigned",
    lot: r.lotNumber || r.batchNumber || "",
    qty: r.availableStock,
    reorderAt: r.lowStockThreshold,
    status: (r.availableStock || 0) <= 0 ? "out of stock" : "low",
  }));
}

/* 5 ── movement register (the append-only ledger) */
async function movementRegister(sellerId, { from, to, warehouseId, warehouseIds, type } = {}) {
  const filter = ownerFilter(sellerId);
  const dr = dateRange(from, to);
  if (dr) filter.createdAt = dr;
  if (type) filter.type = type;
  const rows = await StockMovement.find(filter)
    .populate("productId", "productName skuNumber")
    .populate("inventoryId", "warehouseId lotNumber batchNumber")
    .sort({ createdAt: -1 })
    .limit(5000);
  return rows
    .filter((m) => {
      const wh = String(m.inventoryId?.warehouseId || "");
      if (warehouseId) return wh === String(warehouseId);
      if (Array.isArray(warehouseIds) && warehouseIds.length) return warehouseIds.map(String).includes(wh);
      return true;
    })
    .map((m) => ({
      date: m.createdAt.toISOString().slice(0, 19).replace("T", " "),
      type: m.type, channel: m.channel,
      product: m.productId?.productName || "—",
      lot: m.inventoryId?.lotNumber || m.inventoryId?.batchNumber || "",
      qty: m.quantity, balanceAfter: m.balanceAfter, ref: m.refType || "", note: m.note || "",
    }));
}

const REPORTS = {
  "stock-on-hand": stockOnHand,
  "stock-aging": stockAging,
  "expiry-risk": expiryRisk,
  "low-stock": lowStock,
  "movement-register": movementRegister,
};

async function runReport(name, sellerId, params) {
  const fn = REPORTS[name];
  if (!fn) { const e = new Error(`Unknown report: ${name}`); e.status = 404; throw e; }
  return fn(sellerId, params || {});
}

/**
 * Headline dashboard numbers for a seller, warehouse-scoped. Values at MRP.
 * Returns stock value, expiring value (≤90d), and lot health counts so the
 * dashboard renders without the paid lot-level endpoint.
 */
async function dashboard(sellerId, { warehouseIds } = {}) {
  const oid = new mongoose.Types.ObjectId(String(sellerId));
  const match = { ownerType: "seller", ownerId: oid, batchNumber: { $ne: null } };
  if (Array.isArray(warehouseIds) && warehouseIds.length) {
    match.warehouseId = { $in: warehouseIds.map((id) => new mongoose.Types.ObjectId(String(id))) };
  }
  const horizon = new Date(Date.now() + 90 * DAY);
  const lookupProduct = [
    { $lookup: { from: "products", localField: "productId", foreignField: "_id", as: "p" } },
    { $unwind: { path: "$p", preserveNullAndEmptyArrays: true } },
  ];
  const mrpExpr = { $multiply: ["$availableStock", { $ifNull: ["$p.mrp", 0] }] };

  const [valAgg, expAgg, health] = await Promise.all([
    Inventory.aggregate([{ $match: { ...match, availableStock: { $gt: 0 } } }, ...lookupProduct, { $group: { _id: null, v: { $sum: mrpExpr } } }]),
    Inventory.aggregate([{ $match: { ...match, availableStock: { $gt: 0 }, expiryDate: { $ne: null, $lte: horizon } } }, ...lookupProduct, { $group: { _id: null, v: { $sum: mrpExpr } } }]),
    Inventory.aggregate([
      { $match: match },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        inStock: { $sum: { $cond: [{ $gt: ["$availableStock", 0] }, 1, 0] } },
        outOfStock: { $sum: { $cond: [{ $lte: ["$availableStock", 0] }, 1, 0] } },
        lowStock: { $sum: { $cond: [{ $and: [{ $gt: ["$lowStockThreshold", 0] }, { $gt: ["$availableStock", 0] }, { $lte: ["$availableStock", "$lowStockThreshold"] }] }, 1, 0] } },
      } },
    ]),
  ]);

  const h = health[0] || {};
  return {
    stockValue: Math.round(valAgg[0]?.v || 0),
    expiringValue: Math.round(expAgg[0]?.v || 0),
    totalLots: h.total || 0,
    lots: h.inStock || 0,
    lowStock: h.lowStock || 0,
    outOfStock: h.outOfStock || 0,
  };
}

module.exports = { runReport, dashboard, REPORTS, streamCsv };
