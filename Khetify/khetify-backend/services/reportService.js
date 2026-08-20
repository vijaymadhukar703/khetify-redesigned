const mongoose = require("mongoose");

/**
 * Apply warehouse filtering to a report query. Supports the existing single
 * `warehouseId` query param AND a `warehouseIds` scope array injected by the
 * controller for warehouse-scoped users (services/warehouseScope.js) — so an
 * operations manager's report numbers are exactly the admin's numbers
 * filtered to their assigned warehouse.
 */
function applyWhFilter(filter, { warehouseId, warehouseIds } = {}, field = "warehouseId") {
  if (warehouseId) filter[field] = warehouseId;
  else if (Array.isArray(warehouseIds) && warehouseIds.length) filter[field] = { $in: warehouseIds };
  return filter;
}
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const Location = require("../model/Warehouse/Location");
const InventoryBin = require("../model/Inventory/InventoryBin");
const Warehouse = require("../model/Warehouse/Warehouse");
const Order = require("../model/Order/Order");
const Shipment = require("../model/Transport/Shipment");
require("../model/Sales/Customer"); // register schema for Order.customerId populate

const DAY = 86400000;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const daysBetween = (a, b) => Math.floor((a - b) / DAY);

function dateRange(from, to) {
  const r = {};
  if (from) r.$gte = new Date(from);
  if (to) r.$lte = new Date(to);
  return Object.keys(r).length ? r : null;
}

/* 1 ── stock on hand + valuation (weighted-average cost) */
async function stockOnHand(companyId, params = {}) {
  const filter = applyWhFilter({ ownerId: companyId, ownerType: "company", availableStock: { $gt: 0 } }, params);
  const rows = await Inventory.find(filter).populate("productId", "productName skuNumber category price mrp").populate("warehouseId", "name code");
  return rows.map((r) => {
    const qty = r.availableStock || 0;
    const salePrice = r.productId?.price || r.productId?.mrp || 0;
    const mrp = r.productId?.mrp || r.productId?.price || 0;
    return {
      // INTERNAL KEY (leading underscore) — the lot row this report line was
      // derived from, so Company → Analytics → View can open its Lot Details.
      // Underscore-prefixed keys are stripped from the CSV export and hidden by
      // the table, so no report column or exported file changes shape.
      _inventoryId: String(r._id),
      product: r.productId?.productName || "—",
      sku: r.productId?.skuNumber || "",
      warehouse: r.warehouseId?.name || "Unassigned",
      lot: r.lotNumber || r.batchNumber || "",
      batch: r.batchNumber || "",
      qty: r.availableStock,
      costPrice: round2(r.costPrice || 0),
      // Product MRP (per unit) — shown as the "MRP" column on the UI.
      value: round2(mrp),
      // Stock worth at selling price (qty × MRP/price) — complements `value` (at cost).
      amount: round2(qty * salePrice),
      expiry: r.expiryDate ? r.expiryDate.toISOString().slice(0, 10) : "",
      abcClass: r.abcClass || "",
    };
  });
}

/* 2 ── stock aging (days since the lot row was created ≈ receipt) */
async function stockAging(companyId, params = {}) {
  const filter = applyWhFilter({ ownerId: companyId, ownerType: "company", availableStock: { $gt: 0 } }, params);
  const rows = await Inventory.find(filter).populate("productId", "productName skuNumber");
  const now = Date.now();
  const bucket = (d) => (d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "90+");
  return rows.map((r) => {
    const age = daysBetween(now, new Date(r.createdAt).getTime());
    return { product: r.productId?.productName || "—", lot: r.lotNumber || r.batchNumber, qty: r.availableStock, ageDays: age, bucket: bucket(age), value: round2((r.availableStock || 0) * (r.costPrice || 0)) };
  });
}

/* 3 ── expiry risk (value at risk by 30/60/90-day horizon) */
async function expiryRisk(companyId, params = {}) {
  const now = new Date();
  const horizon = new Date(now.getTime() + 90 * DAY);
  const filter = applyWhFilter({ ownerId: companyId, ownerType: "company", availableStock: { $gt: 0 }, expiryDate: { $ne: null, $lte: horizon } }, params);
  const rows = await Inventory.find(filter).populate("productId", "productName skuNumber").sort({ expiryDate: 1 });
  return rows.map((r) => {
    const d = daysBetween(new Date(r.expiryDate).getTime(), now.getTime());
    return { product: r.productId?.productName || "—", lot: r.lotNumber || r.batchNumber, qty: r.availableStock, daysToExpiry: d, bucket: d < 0 ? "expired" : d <= 30 ? "≤30" : d <= 60 ? "≤60" : "≤90", valueAtRisk: round2((r.availableStock || 0) * (r.costPrice || 0)) };
  });
}

/* 4 ── movement register (the ledger) */
async function movementRegister(companyId, { from, to, warehouseId, warehouseIds, type } = {}) {
  const filter = { ownerId: companyId, ownerType: "company" };
  const dr = dateRange(from, to);
  if (dr) filter.createdAt = dr;
  if (type) filter.type = type;
  const rows = await StockMovement.find(filter).populate("productId", "productName skuNumber").populate("inventoryId", "warehouseId lotNumber batchNumber").sort({ createdAt: -1 }).limit(5000);
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

/* 5 ── warehouse utilization (binned qty vs bin capacity, per warehouse + zone) */
async function warehouseUtilization(companyId, params = {}) {
  const whFilter = applyWhFilter({ companyId }, params, "_id");
  const warehouses = await Warehouse.find(whFilter);
  const out = [];
  for (const wh of warehouses) {
    const bins = await Location.find({ companyId, warehouseId: wh._id, type: "bin" });
    const capacity = bins.reduce((s, b) => s + (b.capacityUnits || 0), 0);
    const binIds = bins.map((b) => b._id);
    const usedAgg = await InventoryBin.aggregate([{ $match: { locationId: { $in: binIds } } }, { $group: { _id: null, used: { $sum: "$qty" } } }]);
    const used = usedAgg[0]?.used || 0;
    out.push({ warehouse: wh.name, bins: bins.length, capacity, used, pct: capacity ? Math.round((used / capacity) * 100) : null });
  }
  return out;
}

/* 6 ── fill-rate & OTIF (approximate, from order statuses) */
async function fillRateOtif(companyId, { from, to } = {}) {
  const filter = { companyId };
  const dr = dateRange(from, to);
  if (dr) filter.placedAt = dr;
  const orders = await Order.find(filter).select("status dispatchedAt placedAt");
  const total = orders.length;
  const delivered = orders.filter((o) => o.status === "delivered").length;
  const shipped = orders.filter((o) => ["shipped", "delivered"].includes(o.status)).length;
  const returned = orders.filter((o) => o.status === "returned").length;
  const cancelled = orders.filter((o) => o.status === "cancelled").length;
  return [{
    totalOrders: total,
    fulfilled: shipped,
    fillRatePct: total ? Math.round((shipped / total) * 100) : 0,
    deliveredPct: total ? Math.round((delivered / total) * 100) : 0,
    returned, cancelled,
  }];
}

/* 7 ── fast / slow movers (90-day outflow velocity; dead = on-hand, no outflow) */
async function fastSlowMovers(companyId, { from, to } = {}) {
  const since = from ? new Date(from) : new Date(Date.now() - 90 * DAY);
  const until = to ? new Date(to) : new Date();
  const sales = await StockMovement.aggregate([
    { $match: { ownerId: new mongoose.Types.ObjectId(companyId), ownerType: "company", type: { $in: ["sale_online", "sale_offline"] }, createdAt: { $gte: since, $lte: until } } },
    { $group: { _id: "$productId", outQty: { $sum: { $abs: "$quantity" } } } },
  ]);
  const outMap = new Map(sales.map((s) => [String(s._id), s.outQty]));
  const onHand = await Inventory.aggregate([
    { $match: { ownerId: new mongoose.Types.ObjectId(companyId), ownerType: "company" } },
    { $group: { _id: "$productId", qty: { $sum: "$availableStock" } } },
  ]);
  const Product = require("../model/Company/productModel");
  const products = await Product.find({ companyId }, { productName: 1 });
  const onHandMap = new Map(onHand.map((o) => [String(o._id), o.qty]));
  const days = Math.max(1, daysBetween(until.getTime(), since.getTime()));
  return products.map((p) => {
    const out = outMap.get(String(p._id)) || 0;
    const oh = onHandMap.get(String(p._id)) || 0;
    return { product: p.productName, outQty: out, onHand: oh, dailyVelocity: round2(out / days), daysCover: out ? Math.round((oh / (out / days))) : null, dead: oh > 0 && out === 0 };
  }).sort((a, b) => b.outQty - a.outQty);
}

/* 8 ── transporter performance (transit time + exception rate) */
async function transporterPerformance(companyId, { from, to } = {}) {
  const filter = { companyId, dispatchedAt: { $ne: null } };
  const dr = dateRange(from, to);
  if (dr) filter.dispatchedAt = { ...dr, $ne: null };
  const ships = await Shipment.find(filter).populate("vehicleId", "regNo");
  const groups = {};
  for (const s of ships) {
    const key = s.transporter || s.vehicleId?.regNo || s.vehicleNo || "—";
    const g = (groups[key] = groups[key] || { transporter: key, shipments: 0, delivered: 0, exceptions: 0, transitMsSum: 0, transitN: 0 });
    g.shipments += 1;
    if (s.status === "exception") g.exceptions += 1;
    if (s.deliveredAt && s.dispatchedAt) { g.delivered += 1; g.transitMsSum += new Date(s.deliveredAt) - new Date(s.dispatchedAt); g.transitN += 1; }
  }
  return Object.values(groups).map((g) => ({
    transporter: g.transporter, shipments: g.shipments, delivered: g.delivered,
    avgTransitHrs: g.transitN ? round2(g.transitMsSum / g.transitN / 3600000) : null,
    exceptionRatePct: g.shipments ? Math.round((g.exceptions / g.shipments) * 100) : 0,
  }));
}

/* 9a ── GST sales register (invoice-wise tax summary) */
async function gstSalesRegister(companyId, { from, to } = {}) {
  const filter = { companyId, invoiceNumber: { $ne: null } };
  const dr = dateRange(from, to);
  if (dr) filter.placedAt = dr;
  const orders = await Order.find(filter).populate("customerId", "name gstin").sort({ placedAt: 1 });
  return orders.map((o) => {
    const t = (o.items || []).reduce((acc, it) => {
      const x = it.taxes || {};
      acc.taxable += x.taxable || 0; acc.cgst += x.cgst || 0; acc.sgst += x.sgst || 0; acc.igst += x.igst || 0;
      return acc;
    }, { taxable: 0, cgst: 0, sgst: 0, igst: 0 });
    return {
      invoice: o.invoiceNumber, date: (o.placedAt || o.createdAt).toISOString().slice(0, 10),
      customer: o.customerName || o.customerId?.name || "—", gstin: o.customerId?.gstin || "",
      taxable: round2(t.taxable), cgst: round2(t.cgst), sgst: round2(t.sgst), igst: round2(t.igst),
      total: round2(t.taxable + t.cgst + t.sgst + t.igst),
    };
  });
}

/* 9b ── GST HSN summary (for GSTR-1) */
async function gstHsnSummary(companyId, { from, to } = {}) {
  const filter = { companyId, invoiceNumber: { $ne: null } };
  const dr = dateRange(from, to);
  if (dr) filter.placedAt = dr;
  const orders = await Order.find(filter).select("items");
  const byHsn = {};
  for (const o of orders) for (const it of o.items || []) {
    const x = it.taxes || {};
    const key = x.hsnCode || "—";
    const g = (byHsn[key] = byHsn[key] || { hsn: key, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 });
    g.qty += it.qty || 0; g.taxable += x.taxable || 0; g.cgst += x.cgst || 0; g.sgst += x.sgst || 0; g.igst += x.igst || 0;
  }
  return Object.values(byHsn).map((g) => ({ hsn: g.hsn, qty: g.qty, taxable: round2(g.taxable), cgst: round2(g.cgst), sgst: round2(g.sgst), igst: round2(g.igst), totalTax: round2(g.cgst + g.sgst + g.igst) }));
}

const REPORTS = {
  "stock-on-hand": stockOnHand,
  "stock-aging": stockAging,
  "expiry-risk": expiryRisk,
  "movement-register": movementRegister,
  "warehouse-utilization": warehouseUtilization,
  "fill-rate-otif": fillRateOtif,
  "fast-slow-movers": fastSlowMovers,
  "transporter-performance": transporterPerformance,
  "gst-sales-register": gstSalesRegister,
  "gst-hsn-summary": gstHsnSummary,
};

// Reports that require the ADVANCED_ANALYTICS plan feature.
const ADVANCED = new Set(["stock-aging", "expiry-risk", "warehouse-utilization", "fill-rate-otif", "fast-slow-movers", "transporter-performance"]);

async function runReport(name, companyId, params) {
  const fn = REPORTS[name];
  if (!fn) { const e = new Error(`Unknown report: ${name}`); e.status = 404; throw e; }
  return fn(companyId, params || {});
}

/** Stream rows as CSV to the response (header row + one row per record). */
function streamCsv(res, name, rows) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.csv"`);
  if (!rows.length) { res.end(""); return; }
  // Underscore-prefixed keys are INTERNAL row metadata for the UI (e.g. the lot
  // id behind a Stock on Hand line) and are never exported — the CSV keeps
  // exactly the columns it has always had.
  const headers = Object.keys(rows[0]).filter((k) => !k.startsWith("_"));
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.write(headers.join(",") + "\n");
  for (const r of rows) res.write(headers.map((h) => esc(r[h])).join(",") + "\n");
  res.end();
}

module.exports = { runReport, streamCsv, REPORTS, ADVANCED };
