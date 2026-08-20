const mongoose = require("mongoose");
const Order = require("../../model/Order/Order");
const Inventory = require("../../model/Inventory/Inventory");
const Warehouse = require("../../model/Warehouse/Warehouse");
const Product = require("../../model/Company/productModel");
const UnitSerial = require("../../model/Barcode/UnitSerial");
const Shipment = require("../../model/Transport/Shipment");
const lotService = require("../../services/lotService");
const salesService = require("../../services/salesService");
const barcodeService = require("../../services/barcodeService");
const shipmentService = require("../../services/shipmentService");
const { rankByProximity, planAllocation } = require("../../services/warehouseProximityService");

// Same workflow map the company order controller uses.
const TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: ["returned"],
  returned: [],
  cancelled: [],
};

const sellerOwner = (req) => ({ ownerType: "seller", ownerId: req.user.sellerId });
const sellerScope = (req) => ({ ownerType: "seller", ownerId: req.user.sellerId });
const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });

/** POST /api/seller/orders — create a confirmed sale order (FEFO reservation from seller stock). */
exports.createOrder = async (req, res) => {
  try {
    const order = await salesService.createOrder(sellerOwner(req), { ...req.body, performedBy: req.user.sellerId });
    res.status(201).json({ success: true, message: `Order created · ${order.invoiceNumber}`, data: order });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/orders */
exports.getOrders = async (req, res) => {
  try {
    const filter = sellerScope(req);
    if (req.query.status) filter.status = req.query.status;
    const rows = await Order.find(filter).sort({ placedAt: -1 }).limit(Math.min(Number(req.query.limit) || 200, 500));
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/orders/:id */
exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, ...sellerScope(req) }).lean();
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    order.nextStates = TRANSITIONS[order.status] || [];
    res.json({ success: true, data: order });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/orders/:id/picklist — FEFO plan over the SELLER's lots. */
exports.getPicklist = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, ...sellerScope(req) });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    const now = new Date();
    const lines = [];
    for (const it of order.items || []) {
      const lots = await Inventory.find({
        productId: it.productId, ownerType: "seller", ownerId: req.user.sellerId,
        availableStock: { $gt: 0 }, $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
      }).populate("warehouseId", "name").sort({ expiryDate: 1 });
      let remaining = it.qty;
      const picks = [];
      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(lot.availableStock, remaining);
        remaining -= take;
        picks.push({ lotNumber: lot.lotNumber || lot.batchNumber, batchNumber: lot.batchNumber, warehouse: lot.warehouseId?.name || "Unassigned", take });
      }
      lines.push({ name: it.name, qty: it.qty, shortfall: Math.max(0, remaining), picks });
    }
    res.json({ success: true, data: { orderNumber: order.orderNumber, lines } });
  } catch (err) { fail(res, err); }
};

/**
 * GET /api/seller/orders/:id/source-options
 *
 * PER-PRODUCT warehouse availability for this order, so "Assign a warehouse"
 * can answer the real question: for EVERY product independently, which of the
 * seller's warehouses hold enough of it, and how much?
 *
 * Deliberately the SELLER MIRROR of the company's
 * controller/Supply/supplyController.getSourceOptions — same aggregation, same
 * `availableQty` definition (availableStock summed across NON-EXPIRED lots,
 * exactly what FEFO would draw), same per-warehouse row shape. What is added
 * for the seller is that an order may be SPLIT: warehouse coverage is reported
 * product by product instead of collapsing to a single canFulfill flag, because
 * a basket of three products can perfectly well be served by two warehouses.
 *
 * Response:
 *   warehouses[]  — every warehouse holding at least one ordered product, in
 *                   proximity order, each with per-product availability and
 *                   `coversAll` when it alone could serve the whole order.
 *   products[]    — one row per ordered line: what it needs, which warehouses
 *                   can cover it, and `fulfillable:false` when none can.
 *   plan          — the recommended productId → warehouseId allocation
 *                   (fewest warehouses, nearest; see planAllocation).
 *   unfulfillable[] — products no warehouse can cover in full. Non-empty means
 *                   the order cannot be approved; the UI says which and why.
 *
 * Recommending is ADVISORY: the seller may reassign any product to any
 * warehouse that actually has enough of it.
 */
exports.getSourceOptions = async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const order = await Order.findOne({ _id: req.params.id, ...sellerScope(req) }).lean();
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    const now = new Date();
    const lines = (order.items || []).filter((it) => it.productId);
    const productIds = lines.map((it) => new mongoose.Types.ObjectId(String(it.productId)));

    // `address` is what proximity is measured against: the shipping address the
    // order was placed with, falling back to billing.
    const address = order.shippingAddress || order.billingAddress || null;

    const warehouses = await Warehouse.find({ sellerId, isActive: { $ne: false } })
      .select("name code address location")
      .sort({ name: 1 })
      .lean();

    // Sum available, non-expired stock per (warehouse, product) in one pass.
    const agg = productIds.length
      ? await Inventory.aggregate([
          {
            $match: {
              ownerType: "seller",
              ownerId: new mongoose.Types.ObjectId(String(sellerId)),
              productId: { $in: productIds },
              $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
            },
          },
          { $group: { _id: { wh: "$warehouseId", product: "$productId" }, available: { $sum: "$availableStock" } } },
        ])
      : [];
    const key = (wh, prod) => `${wh}|${prod}`;
    const avail = new Map(agg.map((r) => [key(r._id.wh, r._id.product), r.available]));

    // Order lines snapshot `name` at sale time, but it can be blank on older
    // rows — fall back to the live product name so the modal always shows one.
    const names = new Map(
      (await Product.find({ _id: { $in: productIds } }).select("productName").lean())
        .map((p) => [String(p._id), p.productName])
    );
    const nameOf = (it) => it.name || names.get(String(it.productId)) || "Item";

    const all = warehouses.map((w) => {
      const items = lines.map((it) => {
        const pid = String(it.productId);
        const availableQty = avail.get(key(w._id, pid)) || 0;
        return {
          productId: pid,
          productName: nameOf(it),
          requiredQty: it.qty,
          availableQty,
          canCover: availableQty >= it.qty,
        };
      });
      return {
        warehouseId: w._id,
        name: w.name,
        code: w.code || null,
        address: w.address || null,
        items,
        // True only when this warehouse alone could serve the ENTIRE order —
        // the no-split case, and what the single-warehouse flow relied on.
        coversAll: items.length > 0 && items.every((i) => i.canCover),
        // Kept under its old name so anything still reading the previous
        // response shape behaves identically.
        canFulfill: items.length > 0 && items.every((i) => i.canCover),
      };
    });

    // A warehouse holding NONE of the ordered products is noise in the picker.
    const relevant = all.filter((w) => w.items.some((i) => i.availableQty > 0));
    const ranked = rankByProximity(relevant, address);
    const plan = planAllocation(ranked);

    // Per-product view: who can cover this line, nearest first.
    const products = lines.map((it) => {
      const pid = String(it.productId);
      const options = ranked
        .map((w) => {
          const row = w.items.find((i) => i.productId === pid);
          return {
            warehouseId: String(w.warehouseId),
            name: w.name,
            code: w.code,
            availableQty: row?.availableQty || 0,
            canCover: !!row?.canCover,
            proximity: w.proximity,
          };
        })
        .filter((o) => o.availableQty > 0);
      const coverable = options.filter((o) => o.canCover);
      return {
        productId: pid,
        productName: nameOf(it),
        requiredQty: it.qty,
        options,
        fulfillable: coverable.length > 0,
        // The planner's pick for this line, so the UI can pre-select it.
        recommendedWarehouseId: plan[pid] || null,
        // Best on offer when nothing can cover it — makes the shortfall concrete.
        bestAvailableQty: options.reduce((m, o) => Math.max(m, o.availableQty), 0),
      };
    });

    const unfulfillable = products
      .filter((p) => !p.fulfillable)
      .map((p) => ({
        productId: p.productId,
        productName: p.productName,
        requiredQty: p.requiredQty,
        bestAvailableQty: p.bestAvailableQty,
        reason: p.bestAvailableQty > 0
          ? `No single warehouse has ${p.requiredQty} — the most in any one is ${p.bestAvailableQty}.`
          : "No warehouse holds this product.",
      }));

    res.json({
      success: true,
      // `data` keeps the warehouse rows, so the previous response shape (a list
      // of warehouses with items[] and canFulfill) still reads correctly.
      data: ranked,
      warehouses: ranked,
      products,
      plan,
      unfulfillable,
      canApprove: unfulfillable.length === 0 && products.length > 0,
      splitCount: new Set(Object.values(plan)).size,
      // Echoed so the modal can show WHICH address the recommendation was
      // measured against — a recommendation you can't sanity-check is worse
      // than none.
      deliveryAddress: address
        ? { city: address.city, district: address.district, state: address.state, pincode: address.pincode }
        : null,
    });
  } catch (err) { fail(res, err); }
};

/**
 * PATCH /api/seller/orders/:id/status — drive the workflow.
 * On "shipped": commit reserved seller stock (or FEFO fallback) AND close the
 * traceability chain — the seller's units for the sold lots become "sold",
 * linked to the buyer. On "cancelled": release reserved stock.
 *
 * On "confirmed" the body may carry `sourceWarehouseId` — the warehouse the
 * seller picked in "Assign a warehouse". It is recorded on the order and scopes
 * the shipment's pick lines. OPTIONAL: omitted, everything behaves exactly as
 * before (lines built FEFO across every warehouse), so existing callers and
 * already-confirmed orders are unaffected.
 */
exports.updateStatus = async (req, res) => {
  try {
    const { status, sourceWarehouseId, allocation } = req.body;
    const sellerId = req.user.sellerId;
    const order = await Order.findOne({ _id: req.params.id, ownerType: "seller", ownerId: sellerId });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    const allowed = TRANSITIONS[order.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: `Cannot move an order from "${order.status}" to "${status}".` });
    }

    // ── WAREHOUSE ASSIGNMENT (approval only) ──
    // `allocation` is [{ productId, warehouseId }] — one entry per ordered line,
    // which is what a SPLIT order needs. `sourceWarehouseId` is the older
    // single-warehouse form and is still accepted: it simply assigns every line
    // to that one warehouse. Neither given, nothing is assigned and the order
    // behaves exactly as it did before this field existed.
    if (status === "confirmed" && (allocation || sourceWarehouseId)) {
      const lines = (order.items || []).filter((it) => it.productId);
      const wanted = Array.isArray(allocation) && allocation.length
        ? new Map(allocation.filter((a) => a && a.productId && a.warehouseId)
            .map((a) => [String(a.productId), String(a.warehouseId)]))
        : new Map(lines.map((it) => [String(it.productId), String(sourceWarehouseId)]));

      // Every line must be assigned — a half-allocated order would silently
      // fall back to all-warehouse FEFO for the rest, which is exactly the
      // ambiguity this feature exists to remove.
      const missing = lines.filter((it) => !wanted.get(String(it.productId)));
      if (missing.length) {
        return res.status(400).json({
          success: false,
          message: `Assign a warehouse for every product — ${missing.map((m) => m.name || "an item").join(", ")} still unassigned.`,
        });
      }

      // Every referenced warehouse must belong to THIS seller — never trust an
      // id off the wire.
      const ids = [...new Set(wanted.values())];
      const owned = await Warehouse.find({ _id: { $in: ids }, sellerId }).select("_id name").lean();
      if (owned.length !== ids.length) {
        return res.status(404).json({ success: false, message: "Warehouse not found" });
      }

      // Re-check availability SERVER-SIDE at the moment of approval. The modal
      // checked too, but stock moves between opening it and pressing Approve,
      // and an order approved against stock that is already gone would only
      // fail later, at pick, in someone else's hands.
      const now = new Date();
      for (const it of lines) {
        const whId = wanted.get(String(it.productId));
        const rows = await Inventory.aggregate([
          {
            $match: {
              ownerType: "seller",
              ownerId: new mongoose.Types.ObjectId(String(sellerId)),
              warehouseId: new mongoose.Types.ObjectId(String(whId)),
              productId: new mongoose.Types.ObjectId(String(it.productId)),
              $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
            },
          },
          { $group: { _id: null, available: { $sum: "$availableStock" } } },
        ]);
        const have = rows[0]?.available || 0;
        if (have < it.qty) {
          const wh = owned.find((w) => String(w._id) === String(whId));
          return res.status(409).json({
            success: false,
            message: `${wh?.name || "That warehouse"} no longer has enough ${it.name || "stock"} — needs ${it.qty}, has ${have}. Reopen the warehouse picker and try again.`,
          });
        }
      }

      for (const it of order.items || []) {
        const whId = wanted.get(String(it.productId));
        if (whId) it.sourceWarehouseId = whId;
      }
      order.markModified("items");
      // Order-level id only when the WHOLE order comes from one warehouse; a
      // split order has no single source, so it stays null.
      order.sourceWarehouseId = ids.length === 1 ? ids[0] : null;
    }

    const hasAllocations = (order.items || []).some((it) => (it.allocations || []).length > 0);

    if (status === "shipped") {
      // The ONE place stock leaves for a sale (commit reservation or FEFO),
      // shared with the warehouse dispatch flow — so deduction can never double.
      await shipOrderStock(order, sellerId);
    }

    if (status === "cancelled" && hasAllocations) {
      for (const it of order.items || []) {
        if (!it.allocations?.length) continue;
        await lotService.releaseAllocation({ ownerType: "seller", ownerId: sellerId, allocations: it.allocations, refId: order._id, performedBy: sellerId });
      }
      order.markModified("items");
    }

    order.status = status;
    if (status === "shipped") order.dispatchedAt = new Date();
    await order.save();

    // On confirm, create the customer Shipment so the order rides the SAME
    // warehouse pick → pack → label-gated dispatch pipeline as supply/transfers
    // (it then shows in Operations → Send Stock → Pick). Non-fatal.
    if (status === "confirmed") {
      try { await ensureOrderShipments(order, sellerId); }
      catch (e) { console.error("order shipment create:", e.message); }
    }

    const out = order.toObject();
    out.nextStates = TRANSITIONS[order.status] || [];
    res.json({ success: true, message: `Order marked ${status}`, data: out });
  } catch (err) { fail(res, err); }
};

/**
 * Transition the seller's units for each committed allocation to "sold", linking
 * the order + customer, so a scan of that unit traces company → seller → buyer.
 */
async function markUnitsSold(order, sellerId, only = null) {
  const serials = [];
  for (const it of order.items || []) {
    // On a SPLIT order only the dispatching parcel's products are sold now;
    // the rest are marked when their own warehouse dispatches.
    if (only && !only.has(String(it.productId))) continue;
    for (const a of it.allocations || []) {
      const lotFilter = a.inventoryId
        ? { inventoryId: a.inventoryId }
        : { lotNumber: a.lotNumber };
      const units = await UnitSerial.find({
        ownerType: "seller", ownerId: sellerId, ...lotFilter,
        status: { $in: ["in_stock", "printed", "generated"] },
      }).limit(a.qty || 0).select("serial");
      serials.push(...units.map((u) => u.serial));
    }
  }
  if (!serials.length) return;
  await barcodeService.transitionUnits(
    { ownerType: "seller", ownerId: sellerId },
    serials,
    { toStatus: "sold", event: "sold", refType: "Order", refId: order._id, set: { orderId: order._id, customerId: order.customerId }, force: true }
  );
}

/**
 * The single sale-deduction path: commit the order's FEFO reservations (or
 * deduct FEFO if it was never reserved) and mark its units sold. Called from the
 * status flow AND the warehouse dispatch flow — and from THERE ONLY — so an
 * order's stock can be deducted exactly once no matter which path ships it.
 */
async function shipOrderStock(order, sellerId, { only = null, warehouseId = null } = {}) {
  const channel = order.channel || "offline";
  const lines = (order.items || []).filter((it) => !only || only.has(String(it.productId)));
  const hasAllocations = lines.some((it) => (it.allocations || []).length > 0);
  if (hasAllocations) {
    for (const it of lines) {
      if (!it.allocations?.length) continue;
      await lotService.commitAllocation({ ownerType: "seller", ownerId: sellerId, allocations: it.allocations, channel, refId: order._id, performedBy: sellerId });
    }
    order.markModified("items");
  } else {
    // Where no reservation exists, deduct FEFO — from the ASSIGNED warehouse
    // when the seller picked one at confirm, so the units leave the warehouse
    // that was actually told to fulfil the line. `warehouseId` is an existing
    // sellFEFO parameter; passing undefined (no assignment, and every order
    // confirmed before this field existed) keeps the previous all-warehouse
    // behaviour byte for byte.
    //
    // Per-line assignment wins over the caller's hint, so a split order always
    // draws each product from its own warehouse.
    for (const it of lines) {
      const wh = it.sourceWarehouseId || warehouseId || order.sourceWarehouseId || null;
      await lotService.sellFEFO({
        ownerType: "seller", ownerId: sellerId, productId: it.productId, qty: it.qty,
        channel, refId: order._id, performedBy: sellerId,
        ...(wh ? { warehouseId: wh } : {}),
      });
    }
  }
  await markUnitsSold(order, sellerId, only);
}

/** FEFO pick plan → shipment lines (one per lot drawn), with the holding
 *  warehouse, so the order rides the real shipment pick/pack pipeline. Does NOT
 *  move stock — that happens once at dispatch via shipOrderStock.
 *
 *  `warehouseId` is OPTIONAL: pass the warehouse the seller assigned at confirm
 *  to draw lots from THAT warehouse only. Omitted (the previous behaviour and
 *  every pre-existing order), lots are drawn FEFO across all of them.
 *
 *  `only` is OPTIONAL: a Set of productId strings to restrict the plan to. A
 *  SPLIT order builds one shipment per warehouse, and each must contain ONLY
 *  the products assigned to it — so warehouse 2 never sees, picks or scans a
 *  product that warehouse 1 is shipping. */
async function buildOrderShipmentLines(order, sellerId, warehouseId = null, only = null) {
  const now = new Date();
  const lines = [];
  for (const it of order.items || []) {
    if (only && !only.has(String(it.productId))) continue;
    const lots = await Inventory.find({
      productId: it.productId, ownerType: "seller", ownerId: sellerId,
      ...(warehouseId ? { warehouseId } : {}),
      availableStock: { $gt: 0 }, $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
    }).sort({ expiryDate: 1 });
    let remaining = it.qty;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.availableStock, remaining);
      remaining -= take;
      lines.push({ inventoryId: lot._id, productId: it.productId, lotNumber: lot.lotNumber || lot.batchNumber, batchNumber: lot.batchNumber, qty: take, _warehouseId: lot.warehouseId || null });
    }
  }
  return lines;
}

/** Every live customer shipment for this order. A split order has one per
 *  assigned warehouse; an unsplit one has exactly a single row, so the old
 *  single-shipment behaviour is just the one-element case of this. */
async function findOrderShipments(orderId, sellerId, statuses) {
  return Shipment.find({
    refType: "Order", refId: orderId, ownerType: "seller", ownerId: sellerId,
    ...(statuses ? { status: { $in: statuses } } : {}),
  });
}

const LIVE_STATUSES = ["planned", "approved", "picking", "picked", "packed"];

/** Find a live customer shipment for this order, if any. Kept for callers that
 *  only need to know whether the order has entered the pipeline. */
async function findOrderShipment(orderId, sellerId) {
  return Shipment.findOne({
    refType: "Order", refId: orderId, ownerType: "seller", ownerId: sellerId,
    status: { $in: LIVE_STATUSES },
  });
}

/**
 * Group the order's lines by the warehouse assigned to each at confirm.
 * Returns a Map warehouseId → Set(productId). An order with no assignment at
 * all yields a single null-keyed group, which reproduces the old behaviour of
 * one shipment drawn FEFO across every warehouse.
 */
function groupLinesByWarehouse(order) {
  const groups = new Map();
  for (const it of order.items || []) {
    if (!it.productId) continue;
    const wh = it.sourceWarehouseId ? String(it.sourceWarehouseId) : (order.sourceWarehouseId ? String(order.sourceWarehouseId) : null);
    if (!groups.has(wh)) groups.set(wh, new Set());
    groups.get(wh).add(String(it.productId));
  }
  return groups;
}

/**
 * Idempotently create the customer Shipment(s) for a confirmed order so it
 * enters the warehouse Send-Stock pipeline (Pick → Pack → label-gated
 * Dispatch). Shipments are `toType:"customer"`, so dispatching one moves NO
 * stock — the sale deduction happens via shipOrderStock as each ships.
 *
 * ONE SHIPMENT PER ASSIGNED WAREHOUSE. A single-warehouse order therefore
 * produces exactly one shipment, identical to before; a split order produces
 * one per warehouse, each carrying only its own products, so each warehouse's
 * Send Stock queue shows only what it was actually asked to ship.
 */
async function ensureOrderShipments(order, sellerId) {
  const existing = await findOrderShipments(order._id, sellerId, LIVE_STATUSES);
  if (existing.length) return existing; // already in the pipeline

  const created = [];
  for (const [whId, productIds] of groupLinesByWarehouse(order)) {
    const built = await buildOrderShipmentLines(order, sellerId, whId, productIds);
    if (!built.length) continue; // no stock for this group — nothing to raise
    // With a warehouse assigned every line came from it, so it IS the origin.
    // Without one, fall back to the first drawn lot's warehouse, as before.
    const fromWarehouseId = whId || built[0]._warehouseId || null;
    const lines = built.map(({ _warehouseId, ...l }) => l); // strip helper field
    created.push(await shipmentService.createShipment(
      { ownerType: "seller", ownerId: sellerId },
      { refType: "Order", refId: order._id, toType: "customer", toLabel: order.customerName || "Customer", fromWarehouseId, lines, performedBy: sellerId }
    ));
  }
  return created;
}

/** Kept as the singular name earlier code used; now returns the first shipment
 *  raised. Prefer ensureOrderShipments, which reports them all. */
async function ensureOrderShipment(order, sellerId) {
  const all = await ensureOrderShipments(order, sellerId);
  return all[0] || null;
}

/**
 * Hook: shipment PACKED → sync the order to "packed" (for the customer tracker).
 *
 * SPLIT-AWARE. The order is only "packed" once EVERY shipment raised for it is
 * packed or beyond — otherwise warehouse 1 finishing first would tell the
 * customer the whole order was packed while warehouse 2 had not started.
 */
exports.markOrderPacked = async (orderId, sellerId) => {
  const order = await Order.findOne({ _id: orderId, ownerType: "seller", ownerId: sellerId });
  if (!order || order.status !== "confirmed") return;
  const shipments = await findOrderShipments(orderId, sellerId);
  const DONE = ["packed", "dispatched", "in_transit", "arrived", "verifying", "delivered"];
  const allPacked = shipments.length > 0 && shipments.every((s) => DONE.includes(s.status));
  if (!allPacked) return; // some warehouse is still picking
  order.status = "packed";
  await order.save();
};

/**
 * Hook: shipment DISPATCHED → deduct THAT shipment's stock and, once every
 * shipment has gone, mark the order shipped.
 *
 * SPLIT-AWARE, and this is the important one. Previously any dispatch deducted
 * the WHOLE order and flipped it to shipped — on a split order that would have
 * deducted warehouse 2's products the moment warehouse 1 dispatched, from
 * whichever lots FEFO found, and told the customer everything had shipped.
 *
 * Now the deduction is scoped to the products in the dispatching shipment,
 * drawn from ITS warehouse, so each parcel deducts exactly its own contents
 * exactly once. The order flips to "shipped" only on the last one.
 *
 * `shipment` is optional: without it the whole order is deducted, which is the
 * correct behaviour for an unsplit order and for anything created before this
 * change. Idempotent.
 */
exports.shipOrder = async (orderId, sellerId, shipment = null) => {
  const order = await Order.findOne({ _id: orderId, ownerType: "seller", ownerId: sellerId });
  if (!order || ["shipped", "delivered", "cancelled", "returned"].includes(order.status)) return;

  const siblings = await findOrderShipments(orderId, sellerId);
  const isSplit = siblings.length > 1;

  if (isSplit && shipment) {
    // Deduct ONLY this parcel's products, from its own warehouse.
    const productIds = new Set((shipment.lines || []).map((l) => String(l.productId)));
    await shipOrderStock(order, sellerId, { only: productIds, warehouseId: shipment.fromWarehouseId });
  } else {
    await shipOrderStock(order, sellerId);
  }

  // The customer's order has shipped only when every parcel is on its way.
  const GONE = ["dispatched", "in_transit", "arrived", "verifying", "delivered"];
  const allGone = siblings.length > 0 && siblings.every(
    (s) => GONE.includes(s.status) || (shipment && String(s._id) === String(shipment._id))
  );
  if (isSplit && !allGone) { await order.save(); return; } // partial: keep status, persist deduction

  order.status = "shipped";
  order.dispatchedAt = new Date();
  await order.save();
};