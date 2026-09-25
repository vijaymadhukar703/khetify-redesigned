const reportService = require("../../services/reportService");
const Inventory = require("../../model/Inventory/Inventory");
const Shipment = require("../../model/Transport/Shipment");
const Order = require("../../model/Order/Order");
const SupplyOrder = require("../../model/Supply/SupplyOrder");
const { resolveFeatures, FEATURES } = require("../../config/plans");
const { effectivePlan } = require("../../services/subscriptionService");
const { warehouseScope, inScope } = require("../../services/warehouseScope");
const { hasCapability } = require("../../config/permissions");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("Report error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

/** GET /api/reports/:name?from&to&warehouseId&format=csv */
exports.run = async (req, res) => {
  try {
    const name = req.params.name;
    if (!reportService.REPORTS[name]) return res.status(404).json({ success: false, message: "Unknown report" });

    // Advanced reports require the ADVANCED_ANALYTICS plan feature.
    if (reportService.ADVANCED.has(name)) {
      const plan = effectivePlan(req.subscription);
      if (!resolveFeatures(plan).includes(FEATURES.ADVANCED_ANALYTICS)) {
        return res.status(403).json({ success: false, code: "UPGRADE_REQUIRED", message: `Your ${plan} plan does not include advanced analytics.` });
      }
    }

    // Warehouse-level access: a scoped operations manager gets the SAME
    // report the admin sees, restricted to their assigned warehouse(s).
    const scope = await warehouseScope(req.user);
    if (scope && req.query.warehouseId && !inScope(scope, req.query.warehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — wrong warehouse" });
    }
    const params = { from: req.query.from, to: req.query.to, warehouseId: req.query.warehouseId, type: req.query.type, ...(scope && { warehouseIds: scope }) };
    const rows = await reportService.runReport(name, req.user.companyId, params);

    if (req.query.format === "csv") return reportService.streamCsv(res, name, rows);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

exports.list = async (req, res) => {
  res.json({ success: true, data: Object.keys(reportService.REPORTS).map((name) => ({ name, advanced: reportService.ADVANCED.has(name) })) });
};

/** GET /api/reports/dashboard — the 4 headline numbers. */
exports.dashboard = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const mongoose = require("mongoose");
    // Aggregate $match does NOT auto-cast strings to ObjectId (unlike find),
    // so the company filter must be a real ObjectId or it matches nothing.
    const companyOid = new mongoose.Types.ObjectId(companyId);
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    // Optional sales window: ?from&to (ISO). Defaults to "today" so existing
    // callers that pass no range keep the exact same numbers (backwards-compatible).
    const salesFrom = req.query.from ? new Date(req.query.from) : startOfDay;
    const salesTo = req.query.to ? new Date(req.query.to) : null;
    const placedRange = { $gte: salesFrom, ...(salesTo && { $lte: salesTo }) };
    const horizon = new Date(Date.now() + 90 * 86400000);

    // Warehouse-level access: the headline numbers for a scoped operations
    // manager are the admin's numbers filtered to their warehouse — same
    // collections, same math, one source of truth. (Orders are company-wide;
    // they aren't warehouse-bound.)
    const scope = await warehouseScope(req.user);
    const whIn = scope ? { warehouseId: { $in: scope.map((id) => new mongoose.Types.ObjectId(id)) } } : {};
    const shipWh = scope
      ? { $or: [{ fromWarehouseId: { $in: scope.map((id) => new mongoose.Types.ObjectId(id)) } }, { toWarehouseId: { $in: scope.map((id) => new mongoose.Types.ObjectId(id)) } }] }
      : {};

    /* Scoping for SALES TO SELLERS. `sourceWarehouseId` is the warehouse the
       goods LEFT — the one making the sale. (`warehouseId` on SupplyOrder is
       the seller's destination, so it would credit the wrong side.) No scope =
       admin = every warehouse = the company total. */
    const supplyWh = scope
      ? { sourceWarehouseId: { $in: scope.map((id) => new mongoose.Types.ObjectId(id)) } }
      : {};

    /* WHICH DATE THE PERIOD FILTER APPLIES TO.
       The dispatch timestamp lives at `shipment.dispatchedAt` — a NESTED field,
       not a root one — and is only set once the goods actually leave. Rows
       dispatched before that field was being written have it null, so the
       filter falls back to `createdAt` rather than dropping those sales
       entirely: `$ifNull` picks whichever exists, and the comparison runs
       against that. */
    const supplySaleDate = { $ifNull: ["$shipment.dispatchedAt", "$createdAt"] };

    // Headline "Stock Value" is ALWAYS valued at MRP × availableStock, using the
    // same lot rows and math as the Inventory page's "Total Stock Value" so the
    // three surfaces (Inventory, Dashboard, Home) never disagree. (Previously
    // this was cost-first for cost:read roles, which diverged from the Inventory
    // page whenever a cost price existed.)
    const stockValueExpr = { $multiply: ["$availableStock", { $ifNull: ["$p.mrp", 0] }] };

    // Cost-aware valuation is retained ONLY for the separate "Expiring" tile so
    // that unrelated card keeps its existing behaviour.
    const canCost = hasCapability(req.user.role, "cost:read");
    const valueExpr = canCost
      ? {
          $multiply: [
            "$availableStock",
            { $let: {
              vars: { c: { $ifNull: ["$p.costPrice", 0] }, ic: { $ifNull: ["$costPrice", 0] }, m: { $ifNull: ["$p.mrp", 0] } },
              in: { $cond: [{ $gt: ["$$c", 0] }, "$$c", { $cond: [{ $gt: ["$$ic", 0] }, "$$ic", "$$m"] }] },
            } },
          ],
        }
      : { $multiply: ["$availableStock", { $ifNull: ["$p.mrp", 0] }] };
    const lookupProduct = [
      { $lookup: { from: "products", localField: "productId", foreignField: "_id", as: "p" } },
      { $unwind: { path: "$p", preserveNullAndEmptyArrays: true } },
    ];

    const [valAgg, expAgg, openShipments, todayAgg, supplySalesAgg] = await Promise.all([
      Inventory.aggregate([
        // Count ACTUAL LOTS only (batchNumber != null) — identical to the source
        // behind the Inventory page's "Total Stock Value" (lotService.getLots).
        // This excludes phantom/channel rows that carry no lot/batch, which were
        // inflating the dashboard figure.
        { $match: { ownerId: companyOid, ownerType: "company", batchNumber: { $ne: null }, ...whIn } },
        ...lookupProduct,
        { $group: { _id: null, v: { $sum: stockValueExpr } } },
      ]),
      Inventory.aggregate([
        { $match: { ownerId: companyOid, ownerType: "company", availableStock: { $gt: 0 }, expiryDate: { $ne: null, $lte: horizon }, ...whIn } },
        ...lookupProduct,
        { $group: { _id: null, v: { $sum: valueExpr } } },
      ]),
      Shipment.countDocuments({ companyId, status: { $in: ["planned", "approved", "loading", "dispatched", "in_transit", "arrived"] }, ...shipWh }),
      Order.aggregate([{ $match: { companyId: companyOid, placedAt: placedRange, status: { $in: ["confirmed", "packed", "shipped", "delivered"] } } }, { $group: { _id: null, amt: { $sum: "$totalAmount" }, n: { $sum: 1 } } }]),

      /* ── SALES TO SELLERS ──────────────────────────────────────────────
         The "Sales" tile is the value of stock this company has DISPATCHED to
         its sellers, not customer-order revenue. Those are two different money
         flows and adding them would double-count the same goods, so this is a
         separate aggregation over SupplyOrder and the Order figure above is
         left exactly as it was for the Sales-overview panel.

         VALUED AT PRODUCT MRP × QUANTITY. `SupplyOrder.items[].unitPrice`
         exists on the schema but NO code path ever writes it — every create
         site (companySellerTransferService, sellerSupplyController,
         supplyController) omits it — so summing it would return a flat zero.
         MRP is the same basis the dashboard's Stock Value tile already uses,
         so a warehouse's stock and its dispatched sales are valued the same way.

         COUNTED ONCE, AT DISPATCH. Only orders that have actually left
         (dispatched onwards, excluding rejected/cancelled) are included, and an
         order contributes exactly one row per item — a later status change from
         `dispatched` to `received` moves it along the list but never adds it twice.

         WAREHOUSE SCOPING uses `sourceWarehouseId` — the warehouse the goods
         physically left. `warehouseId` on this model is the seller's DESTINATION
         warehouse, so scoping on it would credit the sale to the wrong side.
         An admin (no scope) gets every warehouse, which is the company total. */
      SupplyOrder.aggregate([
        { $match: {
          companyId: companyOid,
          status: { $in: ["dispatched", "in_transit", "arrived", "partially_received", "received", "delivered"] },
          ...supplyWh,
        } },
        // The date test is an $expr because the field is computed ($ifNull),
        // which a plain range query cannot express.
        { $match: { $expr: {
          $and: [
            { $gte: [supplySaleDate, salesFrom] },
            ...(salesTo ? [{ $lte: [supplySaleDate, salesTo] }] : []),
          ],
        } } },
        { $unwind: "$items" },
        { $lookup: { from: "products", localField: "items.productId", foreignField: "_id", as: "p" } },
        { $unwind: { path: "$p", preserveNullAndEmptyArrays: true } },
        { $group: {
          _id: null,
          amt: { $sum: { $multiply: [{ $ifNull: ["$items.quantity", 0] }, { $ifNull: ["$p.mrp", 0] }] } },
          orders: { $addToSet: "$_id" },
        } },
        { $project: { amt: 1, n: { $size: "$orders" } } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        stockValue: Math.round(valAgg[0]?.v || 0),
        expiringValue: Math.round(expAgg[0]?.v || 0),
        openShipments,
        todaySales: Math.round(todayAgg[0]?.amt || 0),
        todayOrders: todayAgg[0]?.n || 0,
        // Range-aware aliases (same numbers when no from/to is passed).
        rangeSales: Math.round(todayAgg[0]?.amt || 0),
        rangeOrders: todayAgg[0]?.n || 0,
        /* SALES TO SELLERS for the selected period — company-wide for an admin,
           this warehouse only for a scoped manager. Additive: every field above
           is unchanged, so the Sales-overview panel and any other caller keep
           the exact numbers they had. */
        supplySales: Math.round(supplySalesAgg[0]?.amt || 0),
        supplyOrders: supplySalesAgg[0]?.n || 0,
      },
    });
  } catch (err) { fail(res, err); }
};