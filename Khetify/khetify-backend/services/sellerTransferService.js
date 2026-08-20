const TransferRequest = require("../model/Transport/TransferRequest");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const shipmentService = require("./shipmentService");

/** Throw a tagged http error. */
function httpErr(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const POPULATE = [
  { path: "productId", select: "productName skuNumber" },
  { path: "fromWarehouseId", select: "name code" },
  { path: "toWarehouseId", select: "name code" },
  // WHO asked and WHO decided — the Requests table names them ("Accepted by
  // …"), and without these the row could only say that a decision happened.
  // Read-only projection: no filter, no rule and no write depends on them.
  { path: "requestedBy", select: "name" },
  { path: "decidedBy", select: "name" },
  // Only for its reference — `lrNumber` is what shipmentRef() falls back from.
  { path: "shipmentId", select: "lrNumber" },
];
const ownerFilter = (sellerId) => ({ ownerType: "seller", ownerId: sellerId });

/**
 * Seller inter-warehouse transfers — the owner-aware mirror of the company
 * transfer flow (TransferRequest + shipmentService), scoped to the seller. The
 * lifecycle is request → accept (FEFO-pick + planned Shipment) → dispatch
 * (in_transit) → scan-receive (lands in B, ledger transfer_out/in, request
 * fulfilled). `scope` (warehouse-id array) limits a seller_manager to their
 * assigned warehouse(s); seller_admin (scope = null) is unscoped.
 */
async function listRequests(sellerId, scope, status) {
  const filter = { ...ownerFilter(sellerId) };
  if (status) filter.status = status;
  if (Array.isArray(scope) && scope.length) {
    filter.$or = [{ fromWarehouseId: { $in: scope } }, { toWarehouseId: { $in: scope } }];
  }
  return TransferRequest.find(filter).populate(POPULATE).sort({ createdAt: -1 }).limit(300);
}

/**
 * Create a transfer REQUEST (no stock moves yet). Stock always flows
 * fromWarehouseId (holder/source) → toWarehouseId (receiver). `mode` decides who
 * may INITIATE under warehouse scoping:
 *   push — the SOURCE initiates ("I send my stock") → must own fromWarehouseId.
 *   pull — the DESTINATION initiates ("I ask for stock") → must own toWarehouseId.
 */
async function createRequest({ sellerId, fromWarehouseId, toWarehouseId, productId, qty, note, requestedBy, scope, mode = "push" }) {
  qty = Number(qty);
  if (!["push", "pull"].includes(mode)) throw httpErr(400, "mode must be 'push' or 'pull'");
  if (!fromWarehouseId || !toWarehouseId || !productId || !qty || qty <= 0) {
    throw httpErr(400, "fromWarehouseId, toWarehouseId, productId and a positive qty are required");
  }
  if (String(fromWarehouseId) === String(toWarehouseId)) throw httpErr(400, "Source and destination must differ");

  const [fromOk, toOk] = await Promise.all([
    Warehouse.findOne({ _id: fromWarehouseId, sellerId }).select("name"),
    Warehouse.findOne({ _id: toWarehouseId, sellerId }).select("name"),
  ]);
  if (!fromOk || !toOk) throw httpErr(400, "Both warehouses must be your own");

  // The initiator's own warehouse: source for a push, destination for a pull.
  if (Array.isArray(scope) && scope.length) {
    const ownWh = mode === "pull" ? toWarehouseId : fromWarehouseId;
    if (!scope.map(String).includes(String(ownWh))) {
      throw httpErr(403, mode === "pull"
        ? "You can only request stock INTO your assigned warehouse(s)"
        : "You can only move stock OUT of your assigned warehouse(s)");
    }
  }

  const doc = await TransferRequest.create({
    ...ownerFilter(sellerId), mode, productId, fromWarehouseId, toWarehouseId, qty, note, requestedBy,
  });
  return { doc: await TransferRequest.findById(doc._id).populate(POPULATE), fromName: fromOk.name, toName: toOk.name };
}

/**
 * Load a pending request, scope-checked. The ACCEPTOR is whoever holds the
 * stock being moved — and it must NOT be the initiator:
 *   push — the SOURCE initiated, so the DESTINATION (toWarehouseId) decides.
 *   pull — the DESTINATION initiated, so the HOLDER/SOURCE (fromWarehouseId)
 *          decides (it owns the stock being asked for).
 * seller_admin (no scope) decides either way.
 */
async function loadPending(sellerId, id, scope) {
  const doc = await TransferRequest.findOne({ _id: id, ...ownerFilter(sellerId) });
  if (!doc) throw httpErr(404, "Request not found");
  if (doc.status !== "requested") throw httpErr(409, `Request already ${doc.status}`);
  const deciderWh = doc.mode === "pull" ? doc.fromWarehouseId : doc.toWarehouseId;
  if (Array.isArray(scope) && scope.length && !scope.map(String).includes(String(deciderWh))) {
    throw httpErr(403, doc.mode === "pull"
      ? "Only the holding warehouse (or the seller admin) can decide this request"
      : "Only the destination warehouse (or the seller admin) can decide this request");
  }
  return doc;
}

/**
 * Accept: verify the source warehouse holds enough (FEFO over the seller's lots
 * in A); if short, 409 with the available qty (request stays pending). If
 * enough, FEFO-pick the lots and create a PLANNED Shipment A→B (owner-aware),
 * link it on the request.
 */
/**
 * FEFO pick plan for one product out of one warehouse.
 *
 * Lifted OUT of acceptRequest so the request-driven transfer and the DIRECT
 * transfer draw their lots by exactly the same rule — earliest expiry first,
 * skipping lots with no batch, refusing outright when the warehouse is short.
 * acceptRequest's behaviour is unchanged; it now calls this instead of holding
 * its own copy.
 */
async function planTransferLines({ sellerId, warehouseId, productId, qty }) {
  const lots = await Inventory.find({
    ...ownerFilter(sellerId), warehouseId, productId,
    batchNumber: { $ne: null }, availableStock: { $gt: 0 },
  }).select("availableStock expiryDate lotNumber");
  lots.sort((a, b) => {
    if (!a.expiryDate && !b.expiryDate) return 0;
    if (!a.expiryDate) return 1;
    if (!b.expiryDate) return -1;
    return a.expiryDate - b.expiryDate;
  });
  const available = lots.reduce((s, l) => s + l.availableStock, 0);
  if (available < qty) {
    const err = httpErr(409, `Stock not available — only ${available} of ${qty} unit(s) in the source warehouse.`);
    err.data = { available, requested: qty };
    throw err;
  }
  const lines = [];
  let remaining = qty;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.availableStock, remaining);
    lines.push({ inventoryId: lot._id, qty: take });
    remaining -= take;
  }
  return lines;
}

async function acceptRequest({ sellerId, id, performedBy, note, scope }) {
  const doc = await loadPending(sellerId, id, scope);

  const lines = await planTransferLines({
    sellerId, warehouseId: doc.fromWarehouseId, productId: doc.productId, qty: doc.qty,
  });

  const toWh = await Warehouse.findOne({ _id: doc.toWarehouseId, sellerId }).select("name");
  const shipment = await shipmentService.createShipment(
    { ownerType: "seller", ownerId: sellerId },
    {
      refType: "TransferRequest", refId: doc._id, fromWarehouseId: doc.fromWarehouseId,
      toType: "warehouse", toWarehouseId: doc.toWarehouseId, toOwnerType: "seller", toOwnerId: sellerId,
      toLabel: `${toWh?.name || "Warehouse"} (transfer)`, lines, performedBy,
    }
  );

  doc.status = "accepted";
  doc.decidedBy = performedBy;
  doc.decidedAt = new Date();
  doc.shipmentId = shipment._id;
  if (note) doc.decisionNote = note;
  await doc.save();
  return { doc: await TransferRequest.findById(doc._id).populate(POPULATE), shipment, lineCount: lines.length };
}

async function rejectRequest({ sellerId, id, note, performedBy, scope }) {
  const doc = await loadPending(sellerId, id, scope);
  doc.status = "rejected";
  doc.decidedBy = performedBy;
  doc.decidedAt = new Date();
  if (note) doc.decisionNote = note;
  await doc.save();
  return TransferRequest.findById(doc._id).populate(POPULATE);
}

/**
 * DIRECT TRANSFER — no prior request.
 *
 * The seller mirror of the company's direct warehouse→warehouse transfer
 * (POST /api/tms/shipments with refType "Transfer" + toType "warehouse"): the
 * holding warehouse simply decides to send stock, and a planned Shipment is
 * raised straight away with no TransferRequest in between.
 *
 * Everything downstream is IDENTICAL to the requested path — the same
 * shipmentService.createShipment, the same Send Stock pick/scan/dispatch, the
 * same scan-receive at the destination. The ONLY difference is `refType`:
 * "Transfer" here versus "TransferRequest" there, which is exactly how the
 * company side distinguishes them too. So this adds an entry point, not a
 * second transfer mechanism.
 *
 * `items` is [{ productId, qty }] so one direct transfer can carry several
 * products, each FEFO-picked out of the source warehouse.
 */
async function createDirectTransfer({ sellerId, fromWarehouseId, toWarehouseId, items, note, performedBy, scope, challanNumber, challanDocument }) {
  if (!fromWarehouseId || !toWarehouseId) throw httpErr(400, "Source and destination warehouses are required");
  if (String(fromWarehouseId) === String(toWarehouseId)) {
    throw httpErr(400, "Source and destination must be different warehouses");
  }
  const rows = (Array.isArray(items) ? items : [])
    .map((i) => ({ productId: i?.productId, qty: Number(i?.qty) }))
    .filter((i) => i.productId && Number.isFinite(i.qty) && i.qty > 0);
  if (!rows.length) throw httpErr(400, "Add at least one product and quantity");

  // Both warehouses must belong to THIS seller.
  const [from, to] = await Promise.all([
    Warehouse.findOne({ _id: fromWarehouseId, sellerId }).select("name"),
    Warehouse.findOne({ _id: toWarehouseId, sellerId }).select("name"),
  ]);
  if (!from) throw httpErr(404, "Source warehouse not found");
  if (!to) throw httpErr(404, "Destination warehouse not found");

  // A warehouse-scoped manager may only send FROM a warehouse they run. The
  // destination is deliberately unrestricted — you may send to any of the
  // seller's warehouses, the same rule the request flow already uses.
  if (scope && !scope.some((w) => String(w) === String(fromWarehouseId))) {
    throw httpErr(403, "That warehouse isn't assigned to you");
  }

  // FEFO per product, so a shortfall is refused BEFORE any shipment exists.
  const lines = [];
  for (const r of rows) {
    const picked = await planTransferLines({
      sellerId, warehouseId: fromWarehouseId, productId: r.productId, qty: r.qty,
    });
    lines.push(...picked);
  }

  const shipment = await shipmentService.createShipment(
    { ownerType: "seller", ownerId: sellerId },
    {
      // "Transfer" (not "TransferRequest") — there is no request behind it.
      refType: "Transfer", refId: null,
      fromWarehouseId, toType: "warehouse", toWarehouseId,
      toOwnerType: "seller", toOwnerId: sellerId,
      toLabel: `${to.name || "Warehouse"} (transfer)`,
      lines, note, performedBy,
      // THE DELIVERY CHALLAN, handed straight to the EXISTING shipment fields.
      //
      // Shipment already carries `deliveryChallanNumber` and a `challanDocument`
      // { key, name, mime, size } sub-document, and createShipment already
      // persists both — they were added for the company warehouse transfer and
      // are owner-agnostic. So this needs no new model field, no new collection
      // and no change to shipmentService: a seller transfer simply starts
      // populating the same two fields, and every read path that already
      // resolves them (listShipments → challanDocumentUrl) works for the seller
      // rows the moment they are set.
      //
      // `challanDocument` is passed through only when a file was actually
      // uploaded — createShipment spreads it conditionally on `.key`, so an
      // undefined value leaves the field unset exactly as before.
      deliveryChallanNumber: String(challanNumber || "").trim() || undefined,
      challanDocument,
    }
  );
  return { shipment, fromName: from.name, toName: to.name, lineCount: lines.length };
}

module.exports = { listRequests, createRequest, acceptRequest, rejectRequest, createDirectTransfer, planTransferLines };