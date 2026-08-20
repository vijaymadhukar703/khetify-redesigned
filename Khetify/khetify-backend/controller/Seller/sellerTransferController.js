const sellerTransferService = require("../../services/sellerTransferService");
const lotService = require("../../services/lotService");
const Warehouse = require("../../model/Warehouse/Warehouse");
const { warehouseScope, inScope } = require("../../services/warehouseScope");
const { notify } = require("../../services/notificationService");
const fileService = require("../../services/fileService");
const shipmentService = require("../../services/shipmentService");

const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Server error", ...(err.data ? { data: err.data } : {}) });

/** GET /api/seller/transfers/warehouses — ALL warehouses owned by the seller
 * ACCOUNT (never manager-scoped), for the transfer DESTINATION picker + the
 * "need 2 warehouses" guard. A manager may send to any of the seller's
 * warehouses even if it isn't assigned to them. Strictly seller-scoped. */
exports.accountWarehouses = async (req, res) => {
  try {
    const rows = await Warehouse.find({ sellerId: req.user.sellerId }).select("name code isActive").sort({ name: 1 });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/transfers/stock?warehouseId= — the products the seller HOLDS
 * in a warehouse (in-stock lots, grouped by product), to populate the transfer
 * Product picker. Owner + warehouse scoped; NOT gated by the paid inventory
 * view (moving your own stock shouldn't need a plan). */
exports.warehouseStock = async (req, res) => {
  try {
    const warehouseId = req.query.warehouseId;
    if (!warehouseId) return res.status(400).json({ success: false, message: "warehouseId is required" });

    // The warehouse must be the seller's own (never another seller's).
    const owns = await Warehouse.exists({ _id: warehouseId, sellerId: req.user.sellerId });
    if (!owns) return res.status(404).json({ success: false, message: "Warehouse not found" });

    // For a PULL request you're asking ANOTHER of your warehouses to send stock,
    // so the holder needn't be one you're assigned to. For a PUSH (sending from
    // your own warehouse) keep the manager-scope check.
    if (!req.query.forRequest) {
      const scope = await warehouseScope(req.user);
      if (scope && !inScope(scope, warehouseId)) {
        return res.status(403).json({ success: false, message: "That warehouse isn't assigned to you" });
      }
    }

    const rows = await lotService.getLots(req.user.sellerId, { ownerType: "seller", warehouseId });
    const live = rows.filter((r) => (r.availableStock || 0) > 0);

    // Group the in-stock lots by product so the picker lists distinct products
    // (the accept step FEFO-picks across that product's lots).
    const byProduct = new Map();
    for (const r of live) {
      const p = r.productId || {};
      const id = String(p._id || r.productId);
      if (!byProduct.has(id)) byProduct.set(id, { productId: id, productName: p.productName || "—", skuNumber: p.skuNumber || "", availableQty: 0, lots: [] });
      const entry = byProduct.get(id);
      entry.availableQty += r.availableStock;
      entry.lots.push({ lotNumber: r.lotNumber || r.batchNumber, expiryDate: r.expiryDate || null, availableStock: r.availableStock });
    }
    const data = Array.from(byProduct.values()).sort((a, b) => a.productName.localeCompare(b.productName));
    res.json({ success: true, count: data.length, data });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/transfers — the seller's inter-warehouse transfer requests
 * (with their linked shipment). Owner + warehouse scoped. */
exports.listTransfers = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const rows = await sellerTransferService.listRequests(req.user.sellerId, scope, req.query.status);
    // ADDITIVE: `transferRef` — the SH-… of the linked shipment, the SAME value
    // the Transfers table shows. `shipmentService.shipmentRef` is the one
    // definition of that string, so the two lists can never drift apart. Null
    // until a shipment exists, which the UI reads as "Not created". Every
    // existing field is passed through untouched, including the populated
    // `shipmentId` the UI already uses as a truthy "shipment created" flag.
    const data = rows.map((r) => {
      const row = typeof r.toObject === "function" ? r.toObject() : r;
      return { ...row, transferRef: shipmentService.shipmentRef(row.shipmentId) };
    });
    res.json({ success: true, count: data.length, data });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/transfers — create a transfer request (no stock moves yet).
 * Body: { fromWarehouseId (holder/source), toWarehouseId (receiver), productId,
 * qty, note, mode? "push"|"pull" }. Stock always flows source → receiver; mode
 * only sets who initiates/accepts. */
exports.createTransfer = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const mode = req.body.mode === "pull" ? "pull" : "push";
    const { doc, fromName, toName } = await sellerTransferService.createRequest({
      sellerId: req.user.sellerId,
      fromWarehouseId: req.body.fromWarehouseId,
      toWarehouseId: req.body.toWarehouseId,
      productId: req.body.productId,
      qty: req.body.qty,
      note: req.body.note,
      requestedBy: req.user.id,
      scope,
      mode,
    });
    await notify({
      recipientType: "seller", recipientId: req.user.sellerId, type: "shipment",
      title: mode === "pull" ? "New stock request" : "New transfer request",
      body: mode === "pull"
        ? `${doc.qty} unit(s) requested from ${fromName} → ${toName}.`
        : `${doc.qty} unit(s) to transfer from ${fromName} → ${toName}.`,
      payload: { transferRequestId: doc._id, kind: "transfer_request" },
    }).catch(() => {});
    res.status(201).json({
      success: true,
      message: mode === "pull" ? "Request sent — the holding warehouse can accept it" : "Transfer requested — accept it to create the shipment",
      data: doc,
    });
  } catch (err) { fail(res, err); }
};

/**
 * STORE THE UPLOADED DELIVERY CHALLAN and return the descriptor the shipment
 * persists — `{ key, name, mime, size }`.
 *
 * THE FILENAME IS NOT THE DOCUMENT. Only the storage KEY is persisted, never a
 * guessed public URL and never the bare name: the reachable link is resolved
 * from that key on every read (shipmentService.challanUrl → fileService.signedUrl),
 * which is what keeps a private S3 bucket working and what makes the document
 * still openable months later. This is the SAME mechanism the company warehouse
 * transfer uses (controller/Transport/tmsController.createShipment) and the same
 * storage service every other upload in the project goes through, so an image
 * and a PDF are both stored and served identically.
 *
 * The key is namespaced by seller so one seller's paperwork can never collide
 * with another's, and the original filename is sanitised because it becomes part
 * of that key.
 */
async function storeChallan(req) {
  const f = req.file;
  if (!f) return undefined;
  const safe = String(f.originalname || "challan").replace(/[^\w.-]+/g, "_").slice(-80);
  const key = `seller-transfers/${req.user.sellerId}/${Date.now()}-${safe}`;
  await fileService.uploadBuffer(f.buffer, key, f.mimetype);
  return { key, name: f.originalname, mime: f.mimetype, size: f.size };
}

/**
 * POST /api/seller/transfers/direct — DIRECT transfer, no prior request.
 *
 * Body: { fromWarehouseId, toWarehouseId, items: [{ productId, qty }], note }.
 * Raises a planned Shipment immediately. From there it is the SAME pipeline a
 * requested transfer uses: Send Stock → scan → dispatch → scan-receive at the
 * destination, which is what actually moves the stock.
 */
exports.directTransfer = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);

    // MULTIPART OR JSON, both accepted. A multipart body carries every field as
    // a STRING, so `items` arrives as JSON text rather than an array; a plain
    // JSON caller still sends a real array. Parsing here rather than in the
    // service keeps the service's contract (an array of { productId, qty })
    // unchanged for every other caller.
    let items = req.body.items;
    if (typeof items === "string") {
      try { items = JSON.parse(items); }
      catch { return res.status(400).json({ success: false, message: "items must be a valid list of products" }); }
    }

    const challanDocument = await storeChallan(req);

    const { shipment, fromName, toName, lineCount } = await sellerTransferService.createDirectTransfer({
      sellerId: req.user.sellerId,
      fromWarehouseId: req.body.fromWarehouseId,
      toWarehouseId: req.body.toWarehouseId,
      items,
      note: req.body.note,
      // The challan number as printed on the document, and the stored document
      // itself. Both optional and both additive — a transfer raised without
      // them behaves exactly as it did.
      challanNumber: req.body.challanNumber,
      challanDocument,
      performedBy: req.user.id,
      scope,
    });
    await notify({
      recipientType: "seller", recipientId: req.user.sellerId, type: "shipment",
      title: "Stock transfer created",
      body: `Transfer from ${fromName} → ${toName} is ready to pick and dispatch.`,
      payload: { shipmentId: shipment._id, kind: "transfer_direct" },
    }).catch(() => {});
    res.status(201).json({
      success: true,
      message: `Transfer created with ${lineCount} lot(s). Process it from Send Stock.`,
      data: shipment,
    });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/transfers/:id/accept — FEFO-pick + create a planned Shipment. */
exports.acceptTransfer = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const { doc, lineCount } = await sellerTransferService.acceptRequest({
      sellerId: req.user.sellerId, id: req.params.id, performedBy: req.user.id, note: req.body?.note, scope,
    });
    res.json({ success: true, message: `Accepted — shipment created with ${lineCount} lot(s). Dispatch it from Shipments.`, data: doc });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/transfers/:id/reject */
exports.rejectTransfer = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const doc = await sellerTransferService.rejectRequest({ sellerId: req.user.sellerId, id: req.params.id, note: req.body?.note, performedBy: req.user.id, scope });
    res.json({ success: true, message: "Request rejected", data: doc });
  } catch (err) { fail(res, err); }
};