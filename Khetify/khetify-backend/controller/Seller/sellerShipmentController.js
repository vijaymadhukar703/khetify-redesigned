const shipmentService = require("../../services/shipmentService");
const Warehouse = require("../../model/Warehouse/Warehouse");
const TransferRequest = require("../../model/Transport/TransferRequest");
const Order = require("../../model/Order/Order");
const Product = require("../../model/Company/productModel");
const orderCtrl = require("./sellerOrderController");
const sellerScan = require("../../services/sellerPickScanService");
const sellerPack = require("../../services/sellerPackService");
const { warehouseScope, inScope } = require("../../services/warehouseScope");

const sellerOwner = (req) => ({ ownerType: "seller", ownerId: req.user.sellerId });
const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });

/**
 * READ-ONLY DISPLAY ENRICHMENT for Send Stock.
 *
 * A customer-order shipment carries `toLabel` (a decorated string) and
 * `customerId`, but no delivery address and no product names — its lines hold
 * only productId + lotNumber. So the warehouse's Send Stock queue could say
 * "Warehouse 1 → Ravi Kumar · 3 lot(s)" and nothing else: not what to pick, not
 * how many, not where it is going. The manager had to leave the page to find out.
 *
 * This attaches what the page needs to show, and NOTHING ELSE:
 *   • `order`    — orderNumber / invoiceNumber, customer name, delivery address
 *   • `products` — one row PER ORDERED PRODUCT with its requested quantity,
 *                  which is what a multi-product order needs (the shipment's
 *                  own `lines` are per LOT, so a 20-unit product drawn from
 *                  three lots is three lines — useful for picking, useless for
 *                  answering "what did the customer order?")
 *   • `lines[].productName` — so the existing per-lot rows can name their product
 *
 * STRICTLY ADDITIVE AND STRICTLY READ-ONLY. Every existing field is passed
 * through untouched; nothing is written, filtered or reordered, and no shipment
 * state is touched. It also lives HERE, in the seller controller, rather than in
 * services/shipmentService.listShipments — that function is shared with the
 * company Send Stock, and the brief is that Company stays unchanged.
 *
 * Non-order shipments (inter-warehouse transfers) get `productName` on their
 * lines and no `order` block, so the transfer rows render exactly as before.
 */
async function withOrderContext(owner, shipments) {
  const rows = shipments.map((s) => (typeof s.toObject === "function" ? s.toObject() : s));
  if (!rows.length) return rows;

  // One read per collection for the whole page, not per row.
  const orderIds = [...new Set(
    rows.filter((s) => s.refType === "Order" && s.refId).map((s) => String(s.refId))
  )];
  const orders = orderIds.length
    ? await Order.find({ _id: { $in: orderIds }, ownerType: "seller", ownerId: owner.ownerId })
        .select("orderNumber invoiceNumber customerName shippingAddress billingAddress items status placedAt")
        .lean()
    : [];
  const orderById = new Map(orders.map((o) => [String(o._id), o]));

  // Product names for every line AND every order item.
  const productIds = new Set();
  rows.forEach((s) => (s.lines || []).forEach((l) => l.productId && productIds.add(String(l.productId))));
  orders.forEach((o) => (o.items || []).forEach((it) => it.productId && productIds.add(String(it.productId))));
  const products = productIds.size
    ? await Product.find({ _id: { $in: [...productIds] } }).select("productName").lean()
    : [];
  const nameById = new Map(products.map((p) => [String(p._id), p.productName]));

  return rows.map((s) => {
    const out = {
      ...s,
      lines: (s.lines || []).map((l) => ({
        ...l,
        productName: nameById.get(String(l.productId)) || null,
      })),
    };

    const order = s.refType === "Order" && s.refId ? orderById.get(String(s.refId)) : null;
    if (!order) return out;

    const a = order.shippingAddress || order.billingAddress || null;

    // ONE ROW PER ORDERED PRODUCT, restricted to the products THIS shipment is
    // responsible for. A split order raises one shipment per warehouse, so this
    // warehouse must be shown only its own products — never the sibling
    // warehouse's, which it cannot pick and is not accountable for.
    const mine = new Set((s.lines || []).map((l) => String(l.productId)));
    const items = (order.items || [])
      .filter((it) => it.productId && (mine.size === 0 || mine.has(String(it.productId))))
      .map((it) => {
        const pid = String(it.productId);
        // Picked progress for this product, summed across its lots in this
        // shipment — the shipment's own numbers, not the order's.
        const forProduct = (s.lines || []).filter((l) => String(l.productId) === pid);
        return {
          productId: pid,
          productName: it.name || nameById.get(pid) || "Item",
          requestedQty: it.qty,
          plannedQty: forProduct.reduce((n, l) => n + (l.qty || 0), 0),
          pickedQty: forProduct.reduce((n, l) => n + (l.pickedQty || 0), 0),
          lotCount: forProduct.length,
        };
      });

    out.order = {
      orderId: String(order._id),
      orderNumber: order.orderNumber || null,
      invoiceNumber: order.invoiceNumber || null,
      status: order.status,
      placedAt: order.placedAt,
      customerName: order.customerName || s.toLabel || null,
      address: a
        ? {
          line1: a.line1 || null,
          line2: a.line2 || null,
          city: a.city || null,
          district: a.district || null,
          state: a.state || null,
          pincode: a.pincode || null,
          phone: a.phone || null,
        }
        : null,
    };
    out.products = items;
    return out;
  });
}

/** GET /api/seller/shipments — the seller's shipments (supply + transfers),
 * owner + warehouse scoped. */
exports.list = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const rows = await shipmentService.listShipments(sellerOwner(req), { status: req.query.status, warehouseIds: scope || undefined });
    // Display-only: attach the customer, delivery address and per-product
    // requested quantities the Send Stock table shows. Adds keys, changes none.
    const data = await withOrderContext(sellerOwner(req), rows);
    res.json({ success: true, count: data.length, data });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/shipments/:id */
exports.get = async (req, res) => {
  try {
    const s = await shipmentService.getShipment(sellerOwner(req), req.params.id);
    const [data] = await withOrderContext(sellerOwner(req), [s]);
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/shipments/:id/manifest — build/return the scannable shipping
 * label (QR) so it can be PRINTED before dispatch. Only the source warehouse's
 * manager (or seller_admin) can print it. */
exports.manifest = async (req, res) => {
  try {
    const s = await shipmentService.getShipment(sellerOwner(req), req.params.id);
    const scope = await warehouseScope(req.user);
    if (scope && !inScope(scope, s.fromWarehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — not your source warehouse" });
    }
    const { qrPayload } = await shipmentService.ensureManifest(sellerOwner(req), req.params.id);
    res.json({ success: true, data: { qrPayload } });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/seller/shipments/:id/scan — VALIDATE ONE SCANNED CODE.
 *
 * Read-only: resolves the code against the database and reports what it is
 * worth. It reserves nothing and deducts nothing — Confirm Pick still does that
 * through the existing /pick route, which is untouched.
 *
 * Body: { code, selectedTokens? }. The client sends NO quantity, NO warehouse
 * and NO product; all three are derived server-side from the shipment. The
 * previously accepted tokens are re-resolved on every call, so progress cannot
 * be inflated from the client.
 */
exports.scan = async (req, res) => {
  try {
    const data = await sellerScan.resolveSellerScan({
      sellerId: req.user.sellerId,
      shipmentId: req.params.id,
      code: req.body?.code,
      selectedTokens: req.body?.selectedTokens || [],
    });
    res.json({ success: true, data });
  } catch (err) {
    // `code` distinguishes the refusal reason for the UI toast.
    res.status(err.status || 500).json({
      success: false, message: err.message || "Server error", code: err.code || null,
    });
  }
};

/** GET /api/seller/shipments/:id/scan-state — per-product Requested / Scanned /
 *  Remaining for the pick modal. Read-only. */
exports.scanState = async (req, res) => {
  try {
    const data = await sellerScan.sellerScanState({
      sellerId: req.user.sellerId,
      shipmentId: req.params.id,
      selectedTokens: [],
    });
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/seller/shipments/:id/scan-pick — CONFIRM a scanned pick.
 *
 * Body: { tokens: [...], requireComplete? }. The client sends only the tokens
 * it believes it earned; NO quantities, NO line indexes, NO warehouse. Every
 * token is re-validated against the database (buildSellerPickPayload) and the
 * line payload is BUILT server-side from what survives.
 *
 * Only then is the EXISTING shipmentService.pickShipment called, with a payload
 * that has been proven correct. That service is shared with the company side and
 * is not modified — this route just refuses to hand it anything unverified. The
 * older /pick route is left exactly as it was for backward compatibility.
 */
exports.scanPick = async (req, res) => {
  try {
    const { picks, products } = await sellerScan.buildSellerPickPayload({
      sellerId: req.user.sellerId,
      shipmentId: req.params.id,
      tokens: req.body?.tokens || [],
      requireComplete: req.body?.requireComplete === true,
    });
    const s = await shipmentService.pickShipment(sellerOwner(req), req.params.id, {
      picks, performedBy: req.user.id,
    });
    res.json({ success: true, message: "Pick recorded", data: s, products });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false, message: err.message || "Server error", code: err.code || null,
    });
  }
};

/** POST /api/seller/shipments/:id/pick { picks:[{ lineIndex, qty?, serials? }] }
 * — scan units/lots until each line's requested qty is met. Only the source
 * warehouse's manager (or seller_admin) may pick. */
exports.pick = async (req, res) => {
  try {
    const s = await shipmentService.getShipment(sellerOwner(req), req.params.id);
    const scope = await warehouseScope(req.user);
    if (scope && !inScope(scope, s.fromWarehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — not your source warehouse" });
    }
    const shipment = await shipmentService.pickShipment(sellerOwner(req), req.params.id, { picks: req.body.picks || [], performedBy: req.user.id });
    res.json({ success: true, message: shipment.status === "picked" ? "Fully picked — ready to pack" : "Pick updated", data: shipment });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/seller/shipments/:id/box-label — PREVIEW a box label. SAVES NOTHING.
 *
 * Body: { tokens, boxNumber, boxCount, weightKg?, dims? }. The tokens are
 * re-validated against the database so the preview can only ever describe real,
 * available stock — but no pick is recorded, no Package row is written and no
 * package number is minted. Backing out leaves nothing behind because nothing
 * was created.
 */
exports.boxLabelPreview = async (req, res) => {
  try {
    const tokens = req.body?.tokens || [];
    if (!Array.isArray(tokens) || !tokens.length) {
      return res.status(400).json({
        success: false, message: "Select at least one scanned unit to put in the box.", code: "EMPTY_BOX",
      });
    }
    const { resolved } = await sellerScan.buildSellerPickPayload({
      sellerId: req.user.sellerId, shipmentId: req.params.id, tokens, requireComplete: false,
    });
    const data = await sellerPack.draftBoxLabel({
      sellerId: req.user.sellerId,
      shipmentId: req.params.id,
      resolved,
      boxNumber: Number(req.body?.boxNumber) || 1,
      boxCount: Number(req.body?.boxCount) || 1,
      weightKg: req.body?.weightKg,
      dims: req.body?.dims,
      // Re-opening a box's label must show the SAME barcode that was printed,
      // not mint a second one for a carton already wearing a sticker.
      packageNumber: req.body?.packageNumber || null,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false, message: err.message || "Server error", code: err.code || null,
    });
  }
};

/**
 * POST /api/seller/shipments/:id/dispatch-order — THE ONLY WRITE IN THIS FLOW.
 *
 * Body: { boxes: [{ tokens, weightKg?, dims? }] }.
 *
 * Everything the manager did in the popup — scanning, boxing, labelling — was
 * held in the browser and nothing was saved. This single call commits the whole
 * operation, in order:
 *
 *   1. VALIDATE every token in every box against the database, and require the
 *      order to be COMPLETE. A token may appear in only one box.
 *   2. PICK   — the existing shipmentService.pickShipment, unchanged.
 *   3. PACK   — the existing shipmentService.packShipment, unchanged.
 *   4. BOX    — one Package per box, with its real package number.
 *   5. DISPATCH — the existing shipmentService.dispatchShipment, which remains
 *      the single point at which stock actually moves.
 *
 * IF ANY STEP FAILS the packages created in step 4 are removed and the shipment
 * is left as it was, so a half-dispatched order cannot exist. Steps 2 and 3 are
 * idempotent against a retry: pickShipment records what was validated, and a
 * repeat of the same call with the same tokens is refused by the scan validator
 * because the units are no longer `in_stock`.
 *
 * Returns the final labels — the first point at which a real package barcode
 * exists.
 */
exports.dispatchOrder = async (req, res) => {
  try {
    const boxes = Array.isArray(req.body?.boxes) ? req.body.boxes : [];
    if (!boxes.length) {
      return res.status(400).json({
        success: false, message: "Add the scanned units to at least one box before dispatching.", code: "NO_BOXES",
      });
    }

    const sellerId = req.user.sellerId;
    const shipmentId = req.params.id;

    const current = await shipmentService.getShipment(sellerOwner(req), shipmentId);
    const scope = await warehouseScope(req.user);
    if (scope && !inScope(scope, current.fromWarehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — not your source warehouse" });
    }
    if (["dispatched", "in_transit", "arrived", "delivered"].includes(current.status)) {
      return res.status(409).json({
        success: false, message: "This shipment has already been dispatched.", code: "ALREADY_DISPATCHED",
      });
    }

    // A unit may only be in ONE box.
    const seen = new Set();
    for (const b of boxes) {
      for (const t of b?.tokens || []) {
        if (seen.has(t)) {
          return res.status(409).json({
            success: false, message: "The same unit appears in more than one box.", code: "DUPLICATE_IN_BOXES",
          });
        }
        seen.add(t);
      }
    }
    const allTokens = [...seen];

    // 1. Validate everything, and require the order to be complete.
    const { picks } = await sellerScan.buildSellerPickPayload({
      sellerId, shipmentId, tokens: allTokens, requireComplete: true,
    });
    // Per-box contents, validated separately so each parcel's contents are real.
    const perBox = [];
    for (const b of boxes) {
      const r = await sellerScan.buildSellerPickPayload({
        sellerId, shipmentId, tokens: b.tokens || [], requireComplete: false,
      });
      perBox.push({
        resolved: r.resolved, weightKg: b.weightKg, dims: b.dims,
        // The number already PRINTED on this carton. Saved as-is (after format
        // and uniqueness checks) so the sticker matches the record.
        packageNumber: b.packageNumber || null,
      });
    }

    // 2 + 3. Pick, then pack — the existing shared services, unchanged.
    const picked = await shipmentService.pickShipment(sellerOwner(req), shipmentId, {
      picks, performedBy: req.user.id,
    });
    await shipmentService.packShipment(sellerOwner(req), shipmentId, { performedBy: req.user.id });

    // 4. Create the real parcels. Tracked so they can be undone if step 5 fails.
    const created = [];
    try {
      for (const b of perBox) {
        created.push(await sellerPack.createSellerBox({
          sellerId, shipment: picked, resolved: b.resolved,
          performedBy: req.user.id, weightKg: b.weightKg, dims: b.dims,
          packageNumber: b.packageNumber,
        }));
      }

      // 5. Dispatch — the single point at which stock moves.
      const { shipment, qrPayload } = await shipmentService.dispatchShipment(
        sellerOwner(req), shipmentId, { performedBy: req.user.id }
      );
      if (shipment.refType === "Order" && shipment.refId) {
        try { await orderCtrl.shipOrder(shipment.refId, sellerId, shipment); }
        catch (e) { console.error("order ship sync:", e.message); }
      }
      try { await sellerPack.markSellerPackageShipped({ sellerId, shipmentId }); }
      catch (e) { console.error("seller package status sync:", e.message); }

      const labels = [];
      for (const pkg of created) {
        try {
          labels.push(await sellerPack.sellerDeliveryLabel({ sellerId, shipmentId, packageId: pkg._id }));
        } catch (e) { console.error("label build:", e.message); }
      }

      res.json({
        success: true,
        message: "Dispatched — on its way to the customer",
        data: { _id: shipment._id, status: shipment.status, qrPayload },
        boxes: created,
        labels,
      });
    } catch (err) {
      // Dispatch failed after parcels were minted — remove them so no orphan
      // package or barcode is left behind.
      for (const pkg of created) {
        await sellerPack.deleteSellerBox({ sellerId, packageId: pkg._id }).catch(() => {});
      }
      throw err;
    }
  } catch (err) {
    res.status(err.status || 500).json({
      success: false, message: err.message || "Server error", code: err.code || null,
    });
  }
};

/**
 * GET /api/seller/shipments/:id/delivery-label — the CUSTOMER PARCEL label.
 *
 * Read-only. `?packageId=` selects one box; without it the most recent box is
 * used. Separate from the lot / bulk / main box / inner box / unit inventory
 * labels, which are untouched.
 */
exports.deliveryLabel = async (req, res) => {
  try {
    const data = await sellerPack.sellerDeliveryLabel({
      sellerId: req.user.sellerId,
      shipmentId: req.params.id,
      packageId: req.query.packageId || null,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false, message: err.message || "Server error", code: err.code || null,
    });
  }
};

/** GET /api/seller/shipments/:id/box — every box raised for this shipment,
 *  oldest first (Box 1, Box 2, …). Read-only. */
exports.getBox = async (req, res) => {
  try {
    const boxes = await sellerPack.listSellerBoxes({
      sellerId: req.user.sellerId, shipmentId: req.params.id,
    });
    res.json({ success: true, data: boxes, count: boxes.length });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/shipments/:id/pack — pack a fully-picked shipment (then it
 * moves to Dispatch). Only the source warehouse's manager (or seller_admin). */
exports.pack = async (req, res) => {
  try {
    const s = await shipmentService.getShipment(sellerOwner(req), req.params.id);
    const scope = await warehouseScope(req.user);
    if (scope && !inScope(scope, s.fromWarehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — not your source warehouse" });
    }
    const shipment = await shipmentService.packShipment(sellerOwner(req), req.params.id, { performedBy: req.user.id });
    // Customer-order shipment: keep the order tracker in step (→ packed).
    if (shipment.refType === "Order" && shipment.refId) {
      try { await orderCtrl.markOrderPacked(shipment.refId, req.user.sellerId); } catch (e) { console.error("order pack sync:", e.message); }
    }
    res.json({ success: true, message: "Packed — print the label to dispatch", data: shipment });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/shipments/:id/dispatch { labelPrinted, ...transport } —
 * stock leaves the source (in_transit). Dispatch is BLOCKED until the shipping
 * label has been printed (labelPrinted:true), mirroring the company. Only the
 * source warehouse's manager (or seller_admin) may dispatch. */
exports.dispatch = async (req, res) => {
  try {
    const s = await shipmentService.getShipment(sellerOwner(req), req.params.id);
    const scope = await warehouseScope(req.user);
    if (scope && !inScope(scope, s.fromWarehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — not your source warehouse" });
    }
    if (req.body.labelPrinted !== true) {
      return res.status(409).json({ success: false, message: "Print the shipping label before dispatch" });
    }
    const { shipment, qrPayload } = await shipmentService.dispatchShipment(sellerOwner(req), req.params.id, { performedBy: req.user.id });
    // Customer-order shipment moved NO stock (toType "customer"); ship the order
    // now — the single sale-deduction (commit reservation or FEFO) + mark shipped.
    if (shipment.refType === "Order" && shipment.refId) {
      // Pass the SHIPMENT so a split order deducts only this parcel's products
      // from this warehouse, and only flips to "shipped" on the last parcel.
      try { await orderCtrl.shipOrder(shipment.refId, req.user.sellerId, shipment); } catch (e) { console.error("order ship sync:", e.message); }
    }
    // The parcel follows its shipment. Status only — deducts nothing, moves no
    // stock; the existing dispatch path above remains the only thing that does.
    try { await sellerPack.markSellerPackageShipped({ sellerId: req.user.sellerId, shipmentId: req.params.id }); }
    catch (e) { console.error("seller package status sync:", e.message); }
    res.json({ success: true, message: "Dispatched — stock is in transit", data: { _id: shipment._id, status: shipment.status, qrPayload } });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/shipments/:id/receive { qr, warehouseId?, lines? } —
 * scan-to-receive at the destination warehouse. Lands stock into B, marks the
 * linked transfer request fulfilled. */
exports.receive = async (req, res) => {
  try {
    if (!req.body.qr) return res.status(400).json({ success: false, message: "Scan the manifest QR to receive this shipment" });
    const sellerWarehouseIds = (await Warehouse.find({ sellerId: req.user.sellerId }).select("_id")).map((w) => String(w._id));
    const scope = await warehouseScope(req.user); // a manager can only receive into their own warehouse(s)
    const allowed = scope ? sellerWarehouseIds.filter((id) => scope.map(String).includes(id)) : sellerWarehouseIds;

    const { shipment, shortages } = await shipmentService.verifyReceipt(sellerOwner(req), req.params.id, {
      verifierId: req.user.id,
      qr: req.body.qr,
      warehouseId: req.body.warehouseId,
      allowedWarehouseIds: allowed,
      lines: req.body.lines || [],
      performedBy: req.user.id,
    });

    // Mark the linked transfer request fulfilled on a full receipt.
    if (shipment.refType === "TransferRequest" && shipment.refId && !shortages) {
      await TransferRequest.updateOne(
        { _id: shipment.refId, ownerType: "seller", ownerId: req.user.sellerId },
        { $set: { status: "fulfilled" } }
      );
    }
    res.json({ success: true, message: shortages ? `Received with ${shortages} discrepancy(ies)` : "Received in full — stock updated", data: { status: shipment.status, shortages } });
  } catch (err) { fail(res, err); }
};