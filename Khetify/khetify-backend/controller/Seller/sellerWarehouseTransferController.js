const Shipment = require("../../model/Transport/Shipment");
const shipmentService = require("../../services/shipmentService");
const sellerDispatchScan = require("../../services/sellerDispatchScanService");
const sellerRepack = require("../../services/sellerRepackService");
const sellerReceiveScan = require("../../services/sellerReceiveScanService");
const Warehouse = require("../../model/Warehouse/Warehouse");
const { warehouseScope, inScope } = require("../../services/warehouseScope");
const { notify } = require("../../services/notificationService");
const fileService = require("../../services/fileService");

/**
 * SELLER WAREHOUSE → WAREHOUSE TRANSFER — the whole flow.
 *
 * This controller is the seller mirror of the company transfer endpoints on
 * controller/Transport/tmsController.js (dispatch-checklist / dispatch-scan /
 * repack-boxes / dispatch / receive-checklist / receive-scan / receive-units),
 * and it is deliberately a SEPARATE FILE from
 * controller/Seller/sellerShipmentController.js.
 *
 * WHAT THAT SEPARATION PROTECTS. The seller SEND-STOCK flow in that file —
 * `/scan`, `/scan-pick`, `/box-label`, `/dispatch-order`, `/delivery-label` —
 * is how a SELLER → CUSTOMER order is picked, boxed and dispatched, and it is
 * built around a customer parcel: an address, a city, a state, a PIN, a phone
 * and an e-commerce delivery label. None of that exists for a transfer between
 * two of the seller's own warehouses, and none of it is touched here. Every
 * route in that file keeps working exactly as it did.
 *
 * THE FLOW:
 *   1. the source warehouse picks a destination and products (existing
 *      /api/seller/transfers/direct or the request → accept path — unchanged)
 *   2. GET  transfer-checklist   — what must be scanned, per product
 *   3. POST transfer-scan        — resolve ONE label, validated server-side
 *   4. POST transfer-box         — tick scanned units, pack them into a box
 *   5. POST transfer-box/discard — undo a box before dispatch
 *   6. POST transfer-dispatch    — re-validate everything, then dispatch
 *   7. GET  transfer-boxes       — every box + its label payload
 *   8. GET  transfer-receive-checklist / POST transfer-receive-scan
 *   9. POST transfer-receive     — land the scanned boxes at the destination
 */

const sellerOwner = (req) => ({ ownerType: "seller", ownerId: req.user.sellerId });

/** Shipment statuses in which the goods have not yet left the source warehouse. */
const PRE_DISPATCH_STATUSES = new Set([
  "draft", "planned", "picking", "picked", "packed", "approved", "loading", "pending",
]);

const fail = (res, err) =>
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Server error",
    code: err.code || null,
  });

/** Only the SOURCE warehouse's manager (or seller_admin) may send. */
async function assertSource(req, shipment) {
  const scope = await warehouseScope(req.user);
  if (scope && !inScope(scope, shipment.fromWarehouseId)) {
    const e = new Error("Access denied — not your source warehouse");
    e.status = 403;
    throw e;
  }
}

/**
 * STORE AN UPLOADED DELIVERY CHALLAN and return the descriptor the shipment
 * persists — `{ key, name, mime, size }`.
 *
 * THE FILENAME IS NOT THE DOCUMENT. Only the storage KEY is persisted, never a
 * guessed URL and never the bare name: the reachable link is resolved from that
 * key on every read (fileService.signedUrl), which is what keeps a private S3
 * bucket working and the document openable later. The SAME mechanism the seller
 * New Transfer form and the company warehouse transfer already use, so an image
 * and a PDF are stored and served identically.
 */
async function storeChallan(req) {
  const f = req.file;
  if (!f) return undefined;
  const safe = String(f.originalname || "challan").replace(/[^\w.-]+/g, "_").slice(-80);
  const key = `seller-transfers/${req.user.sellerId}/${Date.now()}-${safe}`;
  await fileService.uploadBuffer(f.buffer, key, f.mimetype);
  return { key, name: f.originalname, mime: f.mimetype, size: f.size };
}

/* ------------------------------------------------------------- dispatch */

/**
 * GET /api/seller/shipments/:id/transfer-checklist
 *
 * OPENING THE DIALOG SWEEPS ANY LEFTOVER DRAFT BOXES.
 *
 * A draft box only means something inside the session that made it. If a
 * previous session ended without dispatching — the operator closed the tab, the
 * laptop slept, the connection dropped — its boxes are stale and their units
 * must not still be held. Closing the dialog discards them explicitly, but that
 * call can never be guaranteed to arrive, so the guarantee lives HERE instead:
 * every visit starts from a clean slate and the units are loose again.
 *
 * Only DRAFTS are swept. A dispatched transfer's boxes are permanent and are
 * never touched, so reopening a dispatched transfer to reprint labels is safe.
 */
exports.checklist = async (req, res) => {
  try {
    const shipment = await sellerDispatchScan.loadShipment(req.user.sellerId, req.params.id);
    if (PRE_DISPATCH_STATUSES.has(shipment.status)) {
      await sellerRepack.discardDraftBoxes(req.user.sellerId, req.params.id, { performedBy: req.user.id })
        .catch(() => { /* a failed sweep must not stop the dialog opening */ });
    }
    const data = await sellerDispatchScan.dispatchChecklist(req.user.sellerId, req.params.id);
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/seller/shipments/:id/transfer-abandon
 *
 * The operator closed the transfer without dispatching. Every draft box is
 * deleted and its units become loose stock again immediately — they are not
 * "already inside a box" and are free for any other transfer.
 *
 * Idempotent, and harmless on a dispatched transfer: `packed` boxes are never
 * touched, so a stray call after a successful dispatch changes nothing.
 */
exports.abandon = async (req, res) => {
  try {
    const shipment = await sellerDispatchScan.loadShipment(req.user.sellerId, req.params.id);
    await assertSource(req, shipment);
    if (!PRE_DISPATCH_STATUSES.has(shipment.status)) {
      return res.json({ success: true, message: "Already dispatched — boxes kept", data: { discarded: 0 } });
    }
    const data = await sellerRepack.discardDraftBoxes(req.user.sellerId, req.params.id, { performedBy: req.user.id });
    res.json({
      success: true,
      message: data.discarded
        ? `${data.discarded} draft box(es) discarded — ${data.unitCount} unit(s) available again`
        : "Nothing to discard",
      data,
    });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/seller/shipments/:id/transfer-scan  { code, selectedCodes[] }
 *
 * Read-only. Resolves the code against the database and reports what it is
 * worth. It reserves nothing and deducts nothing — transfer-dispatch is the
 * only call that moves stock, and it re-checks every code again.
 */
exports.scan = async (req, res) => {
  try {
    const data = await sellerDispatchScan.resolveDispatchScan(req.user.sellerId, req.params.id, {
      code: req.body?.code,
      selectedCodes: req.body?.selectedCodes || [],
    });
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/seller/shipments/:id/transfer-box  { serials[] }
 *
 * Pack the ticked units into a NEW transfer box and mint its ID. The server
 * refuses anything that is not one of THIS transfer's scannable units, so a box
 * can never reach into the rest of the warehouse.
 *
 * THE SCANNED COUNT DOES NOT MOVE: boxing is a grouping, not a movement.
 */
exports.packBox = async (req, res) => {
  try {
    const shipment = await sellerDispatchScan.loadShipment(req.user.sellerId, req.params.id);
    await assertSource(req, shipment);
    const data = await sellerRepack.packUnits(req.user.sellerId, {
      shipmentId: req.params.id,
      serials: req.body?.serials || [],
      performedBy: req.user.id,
    });
    res.status(201).json({
      success: true,
      message: `Packed ${data.unitCount} unit(s) into ${data.sellerBoxId}`,
      data,
    });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/seller/shipments/:id/transfer-box/discard  { sellerBoxId }
 *
 * The box was never dispatched, so it is removed outright and its units come
 * back as loose ones. A POST with the ID in the body rather than a DELETE on a
 * path segment, so the ID (which contains "-" and digits) can never be confused
 * with a shipment id by the router.
 */
exports.discardBox = async (req, res) => {
  try {
    const shipment = await sellerDispatchScan.loadShipment(req.user.sellerId, req.params.id);
    await assertSource(req, shipment);
    const data = await sellerRepack.discardBox(
      req.user.sellerId,
      req.body?.sellerBoxId || req.body?.repackBoxId,
      { performedBy: req.user.id },
    );
    res.json({
      success: true,
      message: `${data.sellerBoxId} removed — ${data.unitCount} unit(s) are loose again`,
      data,
    });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/shipments/:id/transfer-boxes — every box + label payload. */
exports.boxes = async (req, res) => {
  try {
    const rows = await sellerRepack.listForShipment(req.user.sellerId, req.params.id);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/seller/shipments/:id/transfer-dispatch  { scannedCodes[] }
 *
 * THE ONLY WRITE THAT MOVES STOCK.
 *
 *   1. RE-VALIDATE every scanned code against the database and require the
 *      transfer to be complete (sellerDispatchScanService.assertDispatchScanned).
 *      The client's arithmetic is never trusted.
 *   2. REWRITE THE LINES FROM WHAT WAS ACTUALLY SCANNED. The planned lines are
 *      an earliest-expiry ALLOCATION made before anyone walked to a shelf; the
 *      deduction below is per line, so leaving them alone would debit the lots
 *      the PLAN named rather than the lots the operator scanned out. This is
 *      exactly what the company dispatch does inside
 *      shipmentService.dispatchShipment for a company transfer — and that
 *      branch is company-only (`if (companyId && …)`), so the seller side does
 *      it here rather than by editing the shared service.
 *   3. DISPATCH through the EXISTING, shared shipmentService.dispatchShipment,
 *      which is the single point at which stock leaves: it deducts each source
 *      lot (`in_transit_out`), marks exactly the recorded serials `shipped`
 *      with `currentShipmentId`, and mints the manifest QR.
 *
 * Returns the manifest payload AND every box label, so the manager can print a
 * label for each carton the moment the dispatch succeeds.
 */
exports.dispatch = async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const shipment = await sellerDispatchScan.loadShipment(sellerId, req.params.id);
    await assertSource(req, shipment);

    if (["dispatched", "in_transit", "arrived", "partially_received", "received", "delivered"].includes(shipment.status)) {
      return res.status(409).json({
        success: false, message: "This transfer has already been dispatched.", code: "ALREADY_DISPATCHED",
      });
    }

    /**
     * THE DELIVERY CHALLAN IS MANDATORY BEFORE THE GOODS LEAVE.
     *
     * Both the NUMBER and the DOCUMENT must be on the transfer by the time it
     * dispatches. Either may have been captured when the transfer was raised
     * (the New Transfer form), so what is checked is the FINAL STATE — what the
     * shipment holds once anything supplied with this call has been applied —
     * rather than what this particular request carried. That way a transfer
     * created with its paperwork dispatches without re-uploading, and one
     * created without it is stopped here until both are given.
     *
     * Enforced BEFORE the scan is validated and long before any stock moves, so
     * a transfer refused for missing paperwork is left exactly as it was.
     */
    const uploaded = await storeChallan(req);
    const challanNumber = String(req.body?.challanNumber || "").trim();
    if (challanNumber) shipment.deliveryChallanNumber = challanNumber;
    if (uploaded?.key) shipment.challanDocument = uploaded;

    if (!shipment.deliveryChallanNumber) {
      return res.status(400).json({
        success: false,
        message: "Enter the delivery challan number before dispatching.",
        code: "CHALLAN_NUMBER_REQUIRED",
      });
    }
    if (!shipment.challanDocument?.key) {
      return res.status(400).json({
        success: false,
        message: "Attach the delivery challan document (image or PDF) before dispatching.",
        code: "CHALLAN_DOCUMENT_REQUIRED",
      });
    }
    // Saved now, so the paperwork survives even if the scan check below refuses
    // this attempt and the manager comes back to it.
    if (challanNumber || uploaded?.key) await shipment.save();

    // 1. Validate — throws unless every required unit is accounted for.
    // Multipart sends every field as a STRING, so the scanned codes arrive as
    // JSON text; a JSON caller still sends a real array.
    let scannedCodes = req.body?.scannedCodes || [];
    if (typeof scannedCodes === "string") {
      try { scannedCodes = JSON.parse(scannedCodes); }
      catch { scannedCodes = []; }
    }
    const verified = await sellerDispatchScan.assertDispatchScanned(
      sellerId, shipment, scannedCodes,
    );

    // 2. What was scanned is what leaves.
    if (verified?.byLot?.length) {
      shipment.lines = verified.byLot.map((l) => ({
        inventoryId: l.inventoryId,
        productId: l.productId,
        lotNumber: l.lotNumber,
        batchNumber: l.batchNumber,
        qty: l.qty,
        serials: l.serials,
        pickedQty: l.qty,
        receivedQty: null,
      }));
      await shipment.save();
    }

    // 3. The shared dispatch — unchanged, and still the only place stock moves.
    const { shipment: dispatched, qrPayload } = await shipmentService.dispatchShipment(
      sellerOwner(req), req.params.id, { performedBy: req.user.id },
    );

    // 4. THE BOXES BECOME PERMANENT — and only now. Up to this line every box
    //    was a draft that abandoning the transfer would have deleted; the goods
    //    are on their way, so the split is no longer reversible.
    await sellerRepack.commitBoxes(sellerId, req.params.id);

    const boxes = await sellerRepack.listForShipment(sellerId, req.params.id);

    await notify({
      recipientType: "seller", recipientId: sellerId, type: "shipment",
      title: "Transfer dispatched",
      body: `${verified.count} unit(s) in ${boxes.length} box(es) are on the way to ${dispatched.toLabel || "the destination warehouse"}. Scan the box labels there to receive them.`,
      payload: { shipmentId: dispatched._id, kind: "transfer_dispatched" },
    }).catch(() => {});

    res.json({
      success: true,
      message: `Dispatched — ${verified.count} unit(s) in ${boxes.length} box(es) are in transit`,
      data: { _id: dispatched._id, status: dispatched.status, qrPayload, ref: verified.ref },
      boxes,
    });
  } catch (err) { fail(res, err); }
};

/* -------------------------------------------------------------- receive */

/** GET /api/seller/shipments/:id/transfer-receive-checklist */
exports.receiveChecklist = async (req, res) => {
  try {
    const data = await sellerReceiveScan.receiveChecklist(req.user.sellerId, req.params.id);
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/shipments/:id/transfer-receive-scan  { code, selectedCodes[] } */
exports.receiveScan = async (req, res) => {
  try {
    const data = await sellerReceiveScan.resolveReceiveScan(req.user.sellerId, req.params.id, {
      code: req.body?.code,
      selectedCodes: req.body?.selectedCodes || [],
    });
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/seller/shipments/:id/transfer-receive  { serials[], warehouseId? }
 *
 * Lands whatever was scanned. Partial by design — the rest stays in transit and
 * the dialog can be reopened for it. Only the DESTINATION warehouse's manager
 * (or seller_admin) may receive; the service re-checks that too.
 */
exports.receive = async (req, res) => {
  try {
    const sellerWarehouseIds = (await Warehouse.find({ sellerId: req.user.sellerId }).select("_id"))
      .map((w) => String(w._id));
    const scope = await warehouseScope(req.user);
    const allowed = scope
      ? sellerWarehouseIds.filter((id) => scope.map(String).includes(id))
      : sellerWarehouseIds;

    const data = await sellerReceiveScan.receiveScannedUnits(req.user.sellerId, req.params.id, {
      serials: req.body?.serials || [],
      warehouseId: req.body?.warehouseId,
      allowedWarehouseIds: allowed,
      performedBy: req.user.id,
    });

    res.json({
      success: true,
      message: data.stillInTransit
        ? `Received ${data.receivedNow} unit(s) — ${data.stillInTransit} still in transit`
        : `Received ${data.receivedNow} unit(s) — transfer complete, stock updated`,
      data,
    });
  } catch (err) { fail(res, err); }
};

/* ----------------------------------------------------------------- misc */

/**
 * GET /api/seller/shipments/:id/transfer-manifest — the shipping label for a
 * dispatched transfer, re-printable by the source warehouse at any time.
 */
exports.manifest = async (req, res) => {
  try {
    const shipment = await Shipment.findOne({
      _id: req.params.id, ownerType: "seller", ownerId: req.user.sellerId,
    }).select("qrToken fromWarehouseId");
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" });
    await assertSource(req, shipment);
    if (!shipment.qrToken) {
      return res.status(409).json({ success: false, message: "This transfer has not been dispatched yet" });
    }
    res.json({ success: true, data: { qrPayload: `${shipment._id}.${shipment.qrToken}` } });
  } catch (err) { fail(res, err); }
};