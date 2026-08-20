const Order = require("../../model/Order/Order");
const Inventory = require("../../model/Inventory/Inventory");
const lotService = require("../../services/lotService");
const salesService = require("../../services/salesService");
const audit = require("../../services/auditService");

/** POST /api/orders — create a confirmed sale order (customer + GST + FEFO reservation). */
exports.createOrder = async (req, res) => {
  try {
    const order = await salesService.createOrder({ ownerType: "company", ownerId: req.user.companyId }, { ...req.body, performedBy: req.user.id });
    await audit.log({ req, action: "order.created", entityType: "Order", entityId: order._id, after: { invoiceNumber: order.invoiceNumber, totalAmount: order.totalAmount } });
    res.status(201).json({ success: true, message: `Order created · ${order.invoiceNumber}`, data: order });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

// Statuses that count as a realised sale (revenue + units).
const SOLD = ["confirmed", "shipped", "delivered"];
const DAY = 86400000;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Allowed status transitions for the seller-order workflow.
const TRANSITIONS = {
  pending: ["confirmed", "cancelled"],   // approve / reject
  confirmed: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["delivered"],                // dispatch already deducted stock
  delivered: ["returned"],
  returned: [],
  cancelled: [],
};

/** GET /api/orders?status=&limit=  — list this company's orders, recent first. */
exports.getOrders = async (req, res) => {
  try {
    const filter = { companyId: req.user.companyId };
    if (req.query.status) filter.status = req.query.status;
    const rows = await Order.find(filter)
      .sort({ placedAt: -1 })
      .limit(Math.min(Number(req.query.limit) || 200, 500));
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error("getOrders error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * GET /api/orders/summary — the numbers the dashboard shows.
 * Returns all-time order count plus this-week revenue / units / returns and a
 * 7-day (Mon→Sun of the current week) units-sold series for the trend chart.
 */
exports.getSummary = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const now = new Date();

    // Optional window: ?from&to (ISO). Defaults to the last 7 days so existing
    // callers keep identical behaviour (backwards-compatible).
    const hasRange = !!(req.query.from || req.query.to);
    const to = req.query.to ? new Date(req.query.to) : now;
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 7 * DAY);
    const spanDays = Math.max(1, Math.ceil((to - from) / DAY));

    // Adaptive trend buckets across the window (≤ ~13 buckets).
    let bucketMs, bucketCount, labelFor;
    if (spanDays <= 14) {
      bucketMs = DAY; bucketCount = spanDays;
      labelFor = (d) => DAY_LABELS[d.getDay()];
    } else if (spanDays <= 92) {
      bucketMs = 7 * DAY; bucketCount = Math.ceil(spanDays / 7);
      labelFor = (d) => `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]}`;
    } else {
      bucketMs = 30 * DAY; bucketCount = Math.ceil(spanDays / 30);
      labelFor = (d) => ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
    }
    bucketCount = Math.min(bucketCount, 13);
    const buckets = Array.from({ length: bucketCount }, (_, i) => {
      const d = new Date(from.getTime() + i * bucketMs);
      return { day: labelFor(d), units: 0 };
    });

    const orderFilter = { companyId, placedAt: { $gte: from, $lte: to } };
    const [totalOrders, recent] = await Promise.all([
      hasRange ? Order.countDocuments(orderFilter) : Order.countDocuments({ companyId }),
      Order.find(orderFilter).select("totalUnits totalAmount status placedAt"),
    ]);

    let weekRevenue = 0;
    let weekUnits = 0;
    let weekReturns = 0;

    for (const o of recent) {
      if (o.status === "returned") {
        weekReturns += o.totalUnits || 0;
        continue;
      }
      if (!SOLD.includes(o.status)) continue; // pending / cancelled don't count
      weekRevenue += o.totalAmount || 0;
      weekUnits += o.totalUnits || 0;
      const idx = Math.floor((new Date(o.placedAt) - from) / bucketMs);
      if (idx >= 0 && idx < buckets.length) buckets[idx].units += o.totalUnits || 0;
    }

    res.json({
      success: true,
      // weekRevenue/weekUnits/weekReturns now reflect the SELECTED window
      // (kept under the same names for backwards compatibility); range* are
      // explicit aliases.
      data: {
        totalOrders,
        weekRevenue, weekUnits, weekReturns, weekly: buckets,
        rangeRevenue: weekRevenue, rangeUnits: weekUnits, rangeReturns: weekReturns,
        rangeOrders: totalOrders, spanDays,
      },
    });
  } catch (err) {
    console.error("getSummary error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /api/orders/:id — single order with its current allowed next-states. */
exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, companyId: req.user.companyId }).lean();
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    order.nextStates = TRANSITIONS[order.status] || [];
    res.json({ success: true, data: order });
  } catch (err) {
    console.error("getOrder error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * GET /api/orders/:id/picklist — read-only FEFO plan: for each line item, which
 * non-expired lots (earliest expiry first) would be picked to fulfil the qty.
 * Nothing is deducted; this is the warehouse pick/pack sheet.
 */
exports.getPicklist = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await Order.findOne({ _id: req.params.id, companyId });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    const now = new Date();
    const lines = [];
    for (const it of order.items || []) {
      const lots = await Inventory.find({
        productId: it.productId,
        ownerType: "company",
        ownerId: companyId,
        availableStock: { $gt: 0 },
        $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
      })
        .populate("warehouseId", "name")
        .sort({ expiryDate: 1 });

      let remaining = it.qty;
      const picks = [];
      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(lot.availableStock, remaining);
        remaining -= take;
        picks.push({
          lotNumber: lot.lotNumber || lot.batchNumber,
          batchNumber: lot.batchNumber,
          warehouse: lot.warehouseId?.name || "Unassigned",
          take,
        });
      }
      lines.push({ name: it.name, qty: it.qty, shortfall: Math.max(0, remaining), picks });
    }
    res.json({ success: true, data: { orderNumber: order.orderNumber, lines } });
  } catch (err) {
    console.error("getPicklist error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * PATCH /api/orders/:id/status { status } — drive the workflow.
 * Transitioning to "shipped" (dispatch) deducts stock FEFO, lot by lot, for
 * each line item via lotService.sellFEFO, writing the StockMovement ledger.
 */
exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const companyId = req.user.companyId;
    const order = await Order.findOne({ _id: req.params.id, companyId });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    const allowed = TRANSITIONS[order.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot move an order from "${order.status}" to "${status}".`,
      });
    }

    const hasAllocations = (order.items || []).some((it) => (it.allocations || []).length > 0);

    // Dispatch — commit the reserved allocations (new flow) or, for legacy
    // orders without allocations, fall back to deducting FEFO at dispatch.
    if (status === "shipped") {
      if (hasAllocations) {
        for (const it of order.items || []) {
          if (!it.allocations?.length) continue;
          await lotService.commitAllocation({ ownerId: companyId, allocations: it.allocations, channel: order.channel || "offline", refId: order._id, performedBy: companyId });
        }
        order.markModified("items");
      } else {
        for (const it of order.items || []) {
          await lotService.sellFEFO({ ownerId: companyId, productId: it.productId, qty: it.qty, channel: order.channel || "offline", refId: order._id, performedBy: companyId });
        }
      }
    }

    // Cancel — release any still-reserved (uncommitted) allocations.
    if (status === "cancelled" && hasAllocations) {
      for (const it of order.items || []) {
        if (!it.allocations?.length) continue;
        await lotService.releaseAllocation({ ownerId: companyId, allocations: it.allocations, refId: order._id, performedBy: companyId });
      }
      order.markModified("items");
    }

    order.status = status;
    if (status === "shipped") order.dispatchedAt = new Date();
    await order.save();

    const out = order.toObject();
    out.nextStates = TRANSITIONS[order.status] || [];
    res.json({ success: true, message: `Order marked ${status}`, data: out });
  } catch (err) {
    console.error("updateStatus error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * GET /api/orders/history — unified, read-only ORDER HISTORY across:
 *   - Order            (seller / customer orders, completed, cancelled)
 *   - TransferRequest  (warehouse-to-warehouse transfers)
 *   - Shipment         (dispatch / shipment history)
 *
 * Each row is normalised to a common shape with a status timeline. All sources
 * are scoped by companyId (multi-tenancy invariant). Additive endpoint — does
 * not touch existing /api/orders routes or response shapes.
 *
 * Query: from, to (placedAt/createdAt window), type (seller|transfer|shipment),
 *        status, warehouseId, sellerId, productId, q (free text), limit,
 *        excludeRequests (1 = actual stock movements only, see below).
 *
 * excludeRequests — OPT-IN, default off, so every existing caller is unchanged.
 * A warehouse-to-warehouse move is stored as TWO records: a TransferRequest
 * (the authorisation, TR-*) and the Shipment created when it is fulfilled (the
 * physical movement, SH-*). A history that lists both shows one movement twice
 * and double-counts its value. Callers that want movements only — the Company
 * and Warehouse "Transfer History" views, whose TR-* rows already live in
 * Operations → Shipment Tracking & Transfers → Requests — pass this flag.
 */
const TransferRequest = require("../../model/Transport/TransferRequest");
const Shipment = require("../../model/Transport/Shipment");
const { warehouseScope } = require("../../services/warehouseScope");
// Company → Warehouse rows label their source with the company's own name.
const Company = require("../../model/Company/Company");
const { shipmentRef } = require("../../services/shipmentService");

// Condense a list of item names / lot numbers into one cell value:
// "—" when empty, the single value, or "First +N more" for multiple distinct.
function summarizeList(arr) {
  const vals = [...new Set((arr || []).filter(Boolean).map(String))];
  if (!vals.length) return "—";
  if (vals.length === 1) return vals[0];
  return `${vals[0]} +${vals.length - 1} more`;
}

// Map a status onto the canonical 5-step timeline used by the UI.
const ORDER_STEPS = ["created", "approved", "packed", "dispatched", "delivered"];
function orderTimeline(status) {
  const reached = {
    pending: ["created"],
    confirmed: ["created", "approved"],
    packed: ["created", "approved", "packed"],
    shipped: ["created", "approved", "packed", "dispatched"],
    delivered: ["created", "approved", "packed", "dispatched", "delivered"],
    returned: ["created", "approved", "packed", "dispatched", "delivered"],
    cancelled: ["created"],
  }[status] || ["created"];
  return ORDER_STEPS.map((s) => ({ step: s, done: reached.includes(s) }));
}

exports.getHistory = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { from, to, type, status, warehouseId, sellerId, productId, q } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);

    // WAREHOUSE SCOPING (server-enforced, never trusted from the client).
    // A warehouse-scoped user (Company Warehouse) may only ever see movements
    // their own warehouse(s) took part in — as SOURCE or DESTINATION. An
    // unscoped caller (the main Company, scope === null) is unaffected, so the
    // Company Transfer History keeps its exact current behaviour.
    const scope = await warehouseScope(req.user);
    const scoped = Array.isArray(scope) && scope.length > 0;
    // Explicit WAREHOUSE-HISTORY mode (?scope=warehouse) — "warehouse TRANSFERS
    // MY warehouse took part in". Deny by default: warehouseScope() treats a
    // user with no assigned warehouses as UNSCOPED (legacy rule other callers
    // rely on), which must never mean "show company-wide data" on this view.
    const warehouseOnly = req.query.scope === "warehouse";
    if (warehouseOnly && !scoped) {
      return res.json({ success: true, count: 0, data: [] });
    }
    // Actual stock movements only — drops the TransferRequest (TR-*) source.
    // Applied at the QUERY, not on the response: the union below is capped at
    // `limit`, so filtering these rows out client-side would let request rows
    // evict real shipments from the list.
    const excludeRequests =
      req.query.excludeRequests === "1" || req.query.excludeRequests === "true";
    // TRANSFERS ONLY — Company → Transfer History (OPT-IN, default off).
    //
    // That page renders warehouse→warehouse movements and nothing else, but the
    // union below was assembled from seller orders + EVERY shipment and only
    // then capped at `limit`. A company with recent customer activity therefore
    // spent the whole budget on rows the page discards, and the transfers its
    // filters were meant to narrow never reached the response at all — which is
    // exactly what "the filters don't filter" looked like.
    //
    // With this flag the query returns precisely what the page renders, so the
    // status/warehouse/date/search conditions all apply BEFORE the cap and
    // pagination pages through real results.
    const transfersOnly =
      req.query.transfersOnly === "1" || req.query.transfersOnly === "true";

    // STATUS BUCKETS — the Company filter offers "In Transit" and "Received",
    // which are GROUPS of pipeline statuses rather than single values (a
    // `dispatched` or `arrived` transfer is in transit; a `partially_received`
    // one has been received). Resolved in the QUERY so the bucket narrows rows
    // before the cap. OPT-IN: ?status= keeps its exact-match meaning for every
    // existing caller.
    const STATUS_BUCKETS = {
      received: ["received", "partially_received", "delivered", "fulfilled", "completed"],
      in_transit: [
        "draft", "planned", "picking", "picked", "packed", "approved", "loading",
        "pending", "dispatched", "in_transit", "arrived", "verifying",
      ],
    };
    const statusBucket = STATUS_BUCKETS[req.query.statusBucket] || null;
    // Honour an explicit ?warehouseId, but never outside the caller's scope.
    const whFilter = scoped
      ? (warehouseId && scope.map(String).includes(String(warehouseId)) ? [warehouseId] : scope)
      : (warehouseId ? [warehouseId] : null);
    const whOr = whFilter
      ? [{ fromWarehouseId: { $in: whFilter } }, { toWarehouseId: { $in: whFilter } }]
      : null;

    // DATE RANGE — INCLUSIVE of both days.
    //
    // The client sends calendar days ("2025-12-31"), which `new Date()` reads as
    // UTC MIDNIGHT. Comparing a mid-day timestamp against that raw To value cut
    // the entire final day out of the range: a transfer created at 09:15 on 31
    // Dec was excluded from a 01 Jan → 31 Dec filter. Widening To to the end of
    // its day is the fix; From already meant the start of its day.
    const dayStart = (v) => { const d = new Date(v); return Number.isNaN(+d) ? null : (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00.000Z`) : d); };
    const dayEnd = (v) => { const d = new Date(v); return Number.isNaN(+d) ? null : (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T23:59:59.999Z`) : d); };
    const fromAt = from ? dayStart(from) : null;
    const toAt = to ? dayEnd(to) : null;
    // A backwards range is a mistake worth reporting, not an empty list to stare
    // at. Reported only for the Company view, so no existing caller gains a new
    // failure mode.
    if (transfersOnly && fromAt && toAt && fromAt > toAt) {
      return res.status(400).json({ success: false, message: "From date cannot be later than To date" });
    }
    // The Transfer History filter bar specifies a RANGE: with only one end
    // filled in there is no range to apply, so the date filter is ignored.
    // Every other caller keeps applying whichever bound it sent.
    const halfOpen = transfersOnly && !(fromAt && toAt);
    const dateBetween = (d) => {
      if (halfOpen) return true;
      if (fromAt && d < fromAt) return false;
      if (toAt && d > toAt) return false;
      return true;
    };

    const out = [];
    // FREE-TEXT HAYSTACK, per row — everything Search must match, UNCONDENSED.
    // The Item and Lot No. columns show a summarised "First +N more", so a
    // multi-lot transfer could only ever be found by its FIRST product or lot;
    // and the product CODE was never in the response at all. Rows with no entry
    // here fall back to the original ref/party/item/lot concatenation, leaving
    // Order History's search exactly as it was.
    const haystack = new Map();
    const indexRow = (row, ...parts) => {
      haystack.set(row, parts.flat().filter(Boolean).map(String).join(" ").toLowerCase());
      return row;
    };

    // 1) Seller / customer orders — skipped entirely for a warehouse-scoped
    //    caller: an order has no warehouse dimension, so it can never be "this
    //    warehouse's" movement.
    //    Skipped for ?transfersOnly=1 too: a sale is not a transfer, and letting
    //    orders into the union only for the page to drop them is what starved
    //    Transfer History of the rows its filters act on.
    if (!scoped && !transfersOnly && (!type || type === "seller" || type === "order")) {
      const f = { companyId };
      if (status) f.status = status;
      if (sellerId) f.customerId = sellerId;
      const orders = await Order.find(f).sort({ placedAt: -1 }).limit(limit).lean();
      for (const o of orders) {
        if (!dateBetween(o.placedAt || o.createdAt)) continue;
        if (productId && !(o.items || []).some((i) => String(i.productId) === String(productId))) continue;
        const items = o.items || [];
        out.push({
          id: o._id,
          kind: "seller",
          ref: o.orderNumber || o.invoiceNumber || String(o._id).slice(-6),
          party: o.customerName || "—",
          // Split party into from/to (a sale flows from us → the customer).
          from: "—",
          to: o.customerName || "—",
          itemName: summarizeList(items.map((i) => i.name)),
          lotNo: summarizeList(items.flatMap((i) => (i.allocations || []).map((a) => a.lotNumber || a.batchNumber))),
          status: o.status,
          total: o.totalAmount || 0,
          units: o.totalUnits || 0,
          date: o.placedAt || o.createdAt,
          timeline: orderTimeline(o.status),
        });
      }
    }

    // 2) Warehouse transfer REQUESTS (authorisation records, not movements).
    if (!excludeRequests && (!type || type === "transfer")) {
      const f = { companyId };
      if (productId) f.productId = productId;
      if (whOr) f.$or = whOr;
      const transfers = await TransferRequest.find(f)
        .sort({ createdAt: -1 }).limit(limit)
        .populate("fromWarehouseId", "name").populate("toWarehouseId", "name")
        .populate("productId", "productName price mrp").lean();
      for (const t of transfers) {
        if (!dateBetween(t.createdAt)) continue;
        const unitPrice = t.productId?.price || t.productId?.mrp || 0;
        out.push({
          id: t._id,
          kind: "transfer",
          ref: `TR-${String(t._id).slice(-6).toUpperCase()}`,
          party: `${t.fromWarehouseId?.name || "?"} → ${t.toWarehouseId?.name || "?"}`,
          from: t.fromWarehouseId?.name || "—",
          to: t.toWarehouseId?.name || "—",
          // Additive: lets a warehouse view derive Incoming/Outgoing by ID.
          fromWarehouseId: t.fromWarehouseId?._id || t.fromWarehouseId || null,
          toWarehouseId: t.toWarehouseId?._id || t.toWarehouseId || null,
          itemName: t.productId?.productName || "—",
          lotNo: "—", // transfer requests target a product, not a specific lot
          status: t.status,
          // Goods value = qty × unit price (transfers have no monetary total of their own).
          total: (t.qty || 0) * unitPrice,
          units: t.qty || 0,
          date: t.createdAt,
          timeline: null,
        });
      }
    }

    // 3) Shipments
    if (!type || type === "shipment") {
      const f = { companyId };
      if (status) f.status = status;
      // Bucket filtering, in the query. Only when no exact ?status= was given,
      // so an explicit status always wins.
      else if (statusBucket) f.status = { $in: statusBucket };
      if (whOr) f.$or = whOr;
      // WAREHOUSE-HISTORY mode shows warehouse TRANSFERS only — never "Sales".
      // `toType` is the real stored discriminator (enum customer|warehouse|
      // vendor|seller, default "customer") and is exactly what the UI's shared
      // movementKind() reads: toType === "warehouse" => "Transfer", anything
      // else (customer / seller supply / vendor) => "Sales". Filtering on the
      // same field keeps the API and the Type column consistent by construction,
      // so a Sales row can never reach the list, the cards or the totals.
      // Company → Transfer History wants the same thing, for the same reason.
      if (warehouseOnly || transfersOnly) f.toType = "warehouse";
      const shipments = await Shipment.find(f)
        .sort({ createdAt: -1 }).limit(limit)
        .populate("fromWarehouseId", "name").populate("toWarehouseId", "name")
        // ADDITIVE projection: the product CODE is a documented Search target and
        // was not being fetched at all. Both spellings are selected because the
        // catalogue carries `skuNumber` and the newer `product_code`.
        .populate("lines.productId", "productName price mrp skuNumber product_code").lean();
      for (const s of shipments) {
        if (!dateBetween(s.createdAt)) continue;
        const lines = s.lines || [];
        // Goods value = Σ (line qty × unit price). Falls back to freight cost when
        // no line prices are available (e.g. a customer shipment with no lines).
        const goodsValue = lines.reduce(
          (sum, l) => sum + (l.qty || 0) * (l.productId?.price || l.productId?.mrp || 0),
          0,
        );
        const row = {
          id: s._id,
          kind: "shipment",
          // Additive (non-breaking) field: lets the UI label a warehouse→warehouse
          // shipment as "Transfer" vs a customer/vendor one as "Sales". The enum
          // value itself is unchanged.
          toType: s.toType,
          // Same helper the Shipments list uses, so a row here and a row there
          // always read the same reference. Output is unchanged.
          ref: shipmentRef(s),
          party: `${s.fromWarehouseId?.name || "?"} → ${s.toWarehouseId?.name || "?"}`,
          from: s.fromWarehouseId?.name || s.fromLabel || "—",
          to: s.toWarehouseId?.name || s.toLabel || "—",
          // Additive: lets a warehouse view derive Incoming/Outgoing by ID.
          fromWarehouseId: s.fromWarehouseId?._id || s.fromWarehouseId || null,
          toWarehouseId: s.toWarehouseId?._id || s.toWarehouseId || null,
          dispatchedAt: s.dispatchedAt || null,
          deliveredAt: s.deliveredAt || null,
          itemName: summarizeList(lines.map((l) => l.productId?.productName)),
          lotNo: summarizeList(lines.map((l) => l.lotNumber || l.batchNumber)),
          status: s.status,
          total: goodsValue || s.freightCost || 0,
          // Sum the shipment lines so the quantity column is meaningful (was 0).
          units: lines.reduce((n, l) => n + (l.qty || 0), 0),
          date: s.createdAt,
          timeline: (s.statusHistory || []).map((e) => ({ step: e.status, at: e.at })),
        };
        out.push(row);
        // Searchable on: reference, both warehouse names, and EVERY line's
        // product name, product code and lot/batch number — the raw values, not
        // the "First +N more" the columns display.
        indexRow(
          row, row.ref, row.from, row.to,
          lines.map((l) => l.productId?.productName),
          lines.map((l) => l.productId?.skuNumber),
          lines.map((l) => l.productId?.product_code),
          lines.map((l) => l.lotNumber),
          lines.map((l) => l.batchNumber),
        );
      }
    }

    // 4) COMPANY → WAREHOUSE lot assignments (INCOMING for the destination).
    //
    //    WHY THIS BLOCK EXISTS. Blocks 2 and 3 read TransferRequest and Shipment.
    //    A Company → Warehouse move writes NEITHER: lotController.receiveLot
    //    calls lotService.receiveLot({ pendingReceipt: true }) for a
    //    company_admin creating a lot against a warehouseId, which only books
    //    the qty onto the destination Inventory row (inTransitStock +
    //    receiving_status "pending"), and lotService.confirmLotReceipt then
    //    flips it to receiving_status "received". No SH-* / TR-* document is
    //    ever created, which is exactly why these transfers were invisible here.
    //    The source of truth is therefore the Inventory row itself.
    //
    //    ADDITIVE BY CONSTRUCTION — nothing above is touched: this only PUSHES
    //    extra rows into the same `out` array, in the same shape, and is gated
    //    on ?scope=warehouse so the main Company Transfer History
    //    (pages/Company/OrderHistory.jsx, which never sends that flag) sees no
    //    change at all. No inventory, stock figure or transfer workflow is
    //    written to — this is a read-only projection.
    if (warehouseOnly && whFilter && (!type || type === "transfer" || type === "shipment")) {
      const f = {
        ownerType: "company",
        ownerId: companyId,
        // Same scope array blocks 2/3 use, so this view can never widen it.
        warehouseId: { $in: whFilter },
        // The two provable markers of a Company → Warehouse assignment:
        //  - receiving_status is written ONLY on the pendingReceipt path
        //    (lotService.receiveLot / confirmLotReceipt / bulkPackageService),
        //    i.e. by this flow and nothing else;
        //  - lotOrigin "company" is the provenance stamp for a lot the MAIN
        //    company minted, and covers legacy rows backfilled by
        //    scripts/migrations/005-original-lot-quantity.js that predate
        //    receiving_status.
        //    A warehouse→warehouse destination copy is stamped "transfer", a GRN
        //    posting "grn" and a warehouse's own Receive Lot "warehouse", so
        //    none of them can be picked up here and double-counted against the
        //    SH-* row block 3 already returns for them.
        $or: [
          { receiving_status: { $in: ["pending", "partially_received", "received"] } },
          { lotOrigin: "company" },
        ],
      };
      if (productId) f.productId = productId;

      const [assignments, company] = await Promise.all([
        Inventory.find(f)
          .sort({ createdAt: -1 })
          .limit(limit)
          .populate("warehouseId", "name")
          .populate("productId", "productName price mrp")
          .lean(),
        Company.findById(companyId).select("companyInfo.companyName").lean(),
      ]);
      const companyLabel = company?.companyInfo?.companyName || "Company";

      for (const inv of assignments) {
        // Received date when it has one, else when it was booked to the warehouse.
        const when = inv.receivedAt || inv.createdAt;
        if (!dateBetween(when)) continue;
        // Derived, never stored: a row with stock still in transit is pending,
        // one with none left to receive is received. receiving_status wins when
        // present (it also carries "partially_received" for box-by-box lots).
        const rowStatus =
          inv.receiving_status ||
          (Number(inv.inTransitStock || 0) > 0 ? "pending" : "received");
        // ?status= is an exact match here, matching blocks 1 and 3.
        if (status && rowStatus !== status) continue;
        // The quantity the COMPANY sent. originalQuantity is the immutable
        // write-once creation figure, so it stays correct after the warehouse
        // has received the lot and inTransitStock has dropped to 0.
        const qty =
          Number(inv.originalQuantity) ||
          Number(inv.inTransitStock || 0) ||
          Number(inv.availableStock || 0);
        const unitPrice = inv.productId?.price || inv.productId?.mrp || 0;
        out.push({
          id: inv._id,
          // Distinct kind: the UI keys rows on `${kind}-${id}`, so this can
          // never collide with a shipment or request row.
          kind: "company_transfer",
          // Reads "Transfer" through the shared movementKind() helper, same as
          // a warehouse→warehouse shipment.
          toType: "warehouse",
          // Derived from the immutable _id like shipmentRef()/TR-, with its own
          // prefix so an operator can tell a company assignment apart from an
          // SH-* shipment at a glance.
          ref: `CW-${String(inv._id).slice(-6).toUpperCase()}`,
          party: `${companyLabel} → ${inv.warehouseId?.name || "?"}`,
          from: companyLabel,
          to: inv.warehouseId?.name || "—",
          // fromWarehouseId stays null — the source is the Company, not a
          // warehouse. toWarehouseId is what makes directionOf() in the UI
          // resolve this row as "Incoming" for the destination warehouse.
          fromWarehouseId: null,
          toWarehouseId: inv.warehouseId?._id || inv.warehouseId || null,
          itemName: inv.productId?.productName || "—",
          lotNo: inv.lotNumber || inv.batchNumber || "—",
          status: rowStatus,
          total: qty * unitPrice,
          units: qty,
          date: when,
          timeline: null,
        });
      }
    }

    // Free-text filter. Trimmed, so a code pasted with stray whitespace still
    // matches. Rows indexed above search their full field set; the rest keep the
    // original ref + party + item + lot behaviour.
    let rows = out;
    if (q) {
      const needle = String(q).trim().toLowerCase();
      if (needle) {
        rows = rows.filter((r) =>
          (haystack.get(r) || `${r.ref} ${r.party} ${r.itemName} ${r.lotNo}`.toLowerCase()).includes(needle));
      }
    }

    rows.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json({ success: true, count: rows.length, data: rows.slice(0, limit) });
  } catch (err) {
    console.error("order history error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};