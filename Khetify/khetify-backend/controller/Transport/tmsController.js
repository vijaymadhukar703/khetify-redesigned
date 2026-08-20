const vehicleService = require("../../services/vehicleService");
const shipmentService = require("../../services/shipmentService");
const dispatchScanService = require("../../services/dispatchScanService");
const receiveScanService = require("../../services/receiveScanService");
const audit = require("../../services/auditService");
const { warehouseScope } = require("../../services/warehouseScope");
const { hasCapability } = require("../../config/permissions");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("TMS error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

/* vehicles */
exports.listVehicles = async (req, res) => { try { const r = await vehicleService.listVehicles(req.user.companyId); res.json({ success: true, count: r.length, data: r }); } catch (e) { fail(res, e); } };
exports.createVehicle = async (req, res) => { try { res.status(201).json({ success: true, data: await vehicleService.createVehicle(req.user.companyId, req.body) }); } catch (e) { fail(res, e); } };
exports.updateVehicle = async (req, res) => { try { res.json({ success: true, data: await vehicleService.updateVehicle(req.user.companyId, req.params.id, req.body) }); } catch (e) { fail(res, e); } };

/* drivers */
exports.listDrivers = async (req, res) => { try { const r = await vehicleService.listDrivers(req.user.companyId); res.json({ success: true, count: r.length, data: r }); } catch (e) { fail(res, e); } };
exports.createDriver = async (req, res) => { try { res.status(201).json({ success: true, data: await vehicleService.createDriver(req.user.companyId, req.body) }); } catch (e) { fail(res, e); } };
exports.updateDriver = async (req, res) => { try { res.json({ success: true, data: await vehicleService.updateDriver(req.user.companyId, req.params.id, req.body) }); } catch (e) { fail(res, e); } };

/* shipments */
exports.listShipments = async (req, res) => {
  try {
    // Warehouse-level access: scoped users (assigned operations managers)
    // only see transfers touching their warehouses — e.g. Katni's manager
    // sees the incoming LOT-001 transfer; Indore's manager does not.
    const scope = await warehouseScope(req.user);
    const r = await shipmentService.listShipments(req.user.companyId, { ...req.query, ...(scope && { warehouseIds: scope }) });

    // How many Shipment Boxes each consignment carries, so the tracking table
    // can offer their labels. Additive: one grouped read, and a shipment without
    // boxes reports 0.
    //
    // NEVER let this break the shipments list. Box counts are a convenience on
    // top of the table; if the lookup fails the operator must still see their
    // shipments, so the count falls back to 0 and the list is returned as it
    // always was.
    let counts = new Map();
    try {
      const shipmentBoxService = require("../../services/shipmentBoxService");
      counts = await shipmentBoxService.boxCountsForShipments(r.map((s) => s._id));
    } catch (e) {
      console.error("shipment box counts unavailable:", e.message);
    }
    // THE SELLER REQUEST'S SERIAL. A shipment raised from "Dispatch to Seller"
    // points at the transfer's own SupplyOrder, which records the seller request
    // it fulfils (`sourceRequestId`). Resolving that here means this table shows
    // the SAME SR-… the Send Stock list shows, rather than a second number for
    // one piece of work. Wrapped like the box counts: a failure here must never
    // cost the operator their shipments list.
    const requestByOrder = new Map();
    try {
      const SupplyOrder = require("../../model/Supply/SupplyOrder");
      const supplyIds = r.filter((s) => s.refType === "SupplyOrder" && s.refId).map((s) => String(s.refId));
      if (supplyIds.length) {
        const orders = await SupplyOrder.find({ _id: { $in: supplyIds }, companyId: req.user.companyId })
          .select("sourceRequestId").lean();
        for (const o of orders) {
          // Fall back to the order's own id — a seller-initiated supply IS the request.
          requestByOrder.set(String(o._id), String(o.sourceRequestId || o._id));
        }
      }
    } catch (e) {
      console.error("supply request refs unavailable:", e.message);
    }
    const requestRefOf = (s) => {
      if (s.refType !== "SupplyOrder" || !s.refId) return null;
      const id = requestByOrder.get(String(s.refId));
      return id ? `SR-${id.slice(-6).toUpperCase()}` : null;
    };

    const withBoxes = r.map((s) => ({
      ...s,
      boxCount: counts.get(String(s._id))?.boxes || 0,
      requestRef: requestRefOf(s),
    }));

    res.json({ success: true, count: withBoxes.length, data: withBoxes });
  } catch (e) { fail(res, e); }
};

/**
 * GET /api/shipments/:id/boxes
 * The Shipment Box labels of one consignment, for printing from the tracking
 * table. Read-only, company-scoped, and warehouse-scoped for assigned users.
 */
exports.shipmentBoxes = async (req, res) => {
  try {
    const Shipment = require("../../model/Transport/Shipment");
    const sh = await Shipment.findOne({ _id: req.params.id, companyId: req.user.companyId })
      .select("fromWarehouseId toWarehouseId").lean();
    if (!sh) return res.status(404).json({ success: false, message: "Shipment not found" });

    const scope = await warehouseScope(req.user);
    if (scope) {
      const mine = scope.map(String);
      const touches = mine.includes(String(sh.fromWarehouseId)) || mine.includes(String(sh.toWarehouseId));
      if (!touches) return res.status(403).json({ success: false, message: "Not your warehouse" });
    }

    const shipmentBoxService = require("../../services/shipmentBoxService");
    const data = await shipmentBoxService.boxesForShipment(req.params.id);
    res.json({ success: true, count: data.length, data });
  } catch (e) { fail(res, e); }
};
exports.getShipment = async (req, res) => { try { res.json({ success: true, data: await shipmentService.getShipment(req.user.companyId, req.params.id) }); } catch (e) { fail(res, e); } };
exports.createShipment = async (req, res) => {
  try {
    // Warehouse-to-warehouse transfers require inventory:transfer. company_admin
    // is denied this capability (see config/permissions ROLE_DENIED), so admins
    // can still create customer/manual shipments but never initiate transfers.
    const isWarehouseTransfer = req.body.refType === "Transfer" || req.body.toType === "warehouse";
    if (isWarehouseTransfer && !hasCapability(req.user.role, "inventory:transfer")) {
      return res.status(403).json({ success: false, message: "Not allowed to transfer between warehouses" });
    }
    // The challan document, when one was posted. ANY file type and ANY size is
    // accepted here — the warehouse attaches whatever paperwork it holds. It is
    // stored through the SAME storage service every other upload uses (local
    // disk or S3, by STORAGE_DRIVER); only the key is persisted, never a
    // guessed URL. The filename is still sanitised, because it becomes part of
    // the storage key.
    const challanDocument = await storeChallan(req);
    const s = await shipmentService.createShipment(req.user.companyId, { ...req.body, challanDocument, performedBy: req.user.id });
    res.status(201).json({ success: true, message: "Shipment planned", data: s });
  } catch (e) { fail(res, e); }
};
/**
 * Store an uploaded delivery challan and return the record to persist —
 * `{ key, name, mime, size }`, or undefined when no file was posted.
 *
 * Lifted verbatim out of createShipment so the CREATE and the DISPATCH paths
 * store the challan identically rather than growing two near-copies. Only the
 * storage KEY is persisted, never a guessed URL and never the bare filename —
 * the reachable link is re-resolved from that key on every read
 * (shipmentService.challanUrl), which is what keeps a private bucket working
 * and the document openable months later. An image and a PDF are handled the
 * same way; the filename is sanitised because it becomes part of the key.
 */
async function storeChallan(req) {
  const f = req.file;
  if (!f) return undefined;
  const safe = String(f.originalname || "challan").replace(/[^\w.-]+/g, "_").slice(-80);
  const key = `shipments/${req.user.companyId}/${Date.now()}-${safe}`;
  const fileService = require("../../services/fileService");
  await fileService.uploadBuffer(f.buffer, key, f.mimetype);
  return { key, name: f.originalname, mime: f.mimetype, size: f.size };
}

/** Scoped users may only act on shipments leaving THEIR warehouse. */
async function assertOutgoingScope(req, res) {
  const scope = await warehouseScope(req.user);
  if (!scope) return true;
  const Shipment = require("../../model/Transport/Shipment");
  const sh = await Shipment.findOne({ _id: req.params.id, companyId: req.user.companyId }).select("fromWarehouseId");
  if (!sh) { res.status(404).json({ success: false, message: "Shipment not found" }); return false; }
  if (sh.fromWarehouseId && !scope.includes(String(sh.fromWarehouseId))) {
    res.status(403).json({ success: false, message: "Access denied — only the source warehouse can dispatch this shipment" });
    return false;
  }
  return true;
}

exports.approve = async (req, res) => {
  try {
    if (!(await assertOutgoingScope(req, res))) return;
    const s_ = await shipmentService.approveShipment(req.user.companyId, req.params.id, { performedBy: req.user.id });
    await audit.log({ req, action: "shipment.approved", entityType: "Shipment", entityId: req.params.id, after: { status: s_.status } });
    res.json({ success: true, message: "Approved", data: { status: s_.status } });
  } catch (e) { fail(res, e); }
};
/**
 * GET /api/shipments/:id/dispatch-checklist
 * What a warehouse→warehouse transfer is supposed to contain, so the sending
 * warehouse can tick each item off as it scans. Read-only.
 */
exports.dispatchChecklist = async (req, res) => {
  try {
    if (!(await assertOutgoingScope(req, res))) return;
    const data = await dispatchScanService.dispatchChecklist(req.user.companyId, req.params.id);
    res.json({ success: true, data });
  } catch (e) { fail(res, e); }
};

/**
 * POST /api/shipments/:id/dispatch-scan  { code, scannedKeys }
 * Resolve ONE scanned code against this shipment. Read-only — it moves nothing;
 * the dispatch itself re-checks everything.
 */
exports.dispatchScan = async (req, res) => {
  try {
    if (!(await assertOutgoingScope(req, res))) return;
    const data = await dispatchScanService.resolveDispatchScan(req.user.companyId, req.params.id, {
      code: req.body.code,
      selectedCodes: req.body.selectedCodes || [],
    });
    res.json({ success: true, data });
  } catch (e) { fail(res, e); }
};

exports.dispatch = async (req, res) => {
  try {
    if (!(await assertOutgoingScope(req, res))) return;

    /**
     * THE DELIVERY CHALLAN IS MANDATORY BEFORE THE GOODS LEAVE.
     *
     * Both the NUMBER and the DOCUMENT must be on the shipment by the time it
     * dispatches, however the transfer was raised. A DIRECT transfer collects
     * them on the New Transfer form; one created by ACCEPTING A REQUEST never
     * saw that form and so arrives here with neither — which is exactly the gap
     * this closes.
     *
     * What is checked is the FINAL STATE — what the shipment holds once
     * anything supplied with this call has been applied — not what this
     * particular request carried. So a transfer that already has its paperwork
     * dispatches without re-uploading, and one without it is stopped here.
     *
     * Enforced BEFORE dispatchShipment, so a shipment refused for missing
     * paperwork has moved no stock and is left exactly as it was.
     */
    // Required locally, matching how the other handlers in this file reach the
    // model — no module-level import is added.
    const Shipment = require("../../model/Transport/Shipment");
    const shipment = await Shipment.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" });

    const uploaded = await storeChallan(req);
    const challanNumber = String(req.body?.deliveryChallanNumber || req.body?.challanNumber || "").trim();
    if (challanNumber) shipment.deliveryChallanNumber = challanNumber;
    if (uploaded?.key) shipment.challanDocument = uploaded;

    /* SCOPED TO WAREHOUSE → WAREHOUSE TRANSFERS.

       This one route dispatches every kind of shipment — customer parcels and
       manual movements come through it too. Only a transfer between two company
       warehouses carries a delivery challan, so only that case is gated;
       everything else dispatches exactly as it always did, with or without
       paperwork. */
    const isWarehouseTransfer = shipment.toType === "warehouse" && !!shipment.toWarehouseId;

    if (isWarehouseTransfer && !shipment.deliveryChallanNumber) {
      return res.status(400).json({
        success: false,
        message: "Enter the delivery challan number before dispatching.",
        code: "CHALLAN_NUMBER_REQUIRED",
      });
    }
    if (isWarehouseTransfer && !shipment.challanDocument?.key) {
      return res.status(400).json({
        success: false,
        message: "Attach the delivery challan document (image or PDF) before dispatching.",
        code: "CHALLAN_DOCUMENT_REQUIRED",
      });
    }
    // Saved now, so the paperwork survives even if the scan check inside
    // dispatchShipment refuses this attempt and the operator comes back to it.
    if (challanNumber || uploaded?.key) await shipment.save();

    const r = await shipmentService.dispatchShipment(req.user.companyId, req.params.id, { ...req.body, performedBy: req.user.id });
    await audit.log({ req, action: "shipment.dispatched", entityType: "Shipment", entityId: req.params.id });
    res.json({ success: true, message: "Dispatched", data: { shipment: { _id: r.shipment._id, status: r.shipment.status }, qrPayload: r.qrPayload } });
  } catch (e) { fail(res, e); }
};
/**
 * GET /api/shipments/incoming?lot=<PARENT LOT NO>
 * Resolve an exact parent lot to the incoming transfer awaiting THIS warehouse
 * (Inventory → Receive Lot scan). Read-only — the receipt itself still goes
 * through POST /shipments/:id/verify, which moves the stock atomically.
 */
exports.incomingByLot = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const r = await shipmentService.findIncomingByLot(req.user.companyId, {
      lotNumber: req.query.lot,
      allowedWarehouseIds: scope,
    });
    res.json({ success: true, data: r });
  } catch (e) { fail(res, e); }
};
/**
 * GET /api/shipments/:id/details
 * READ-ONLY: summary + parent lots + the exact child serials this transfer
 * moved. Warehouse-scoped: a scoped user can only open their own movements.
 */
exports.shipmentDetails = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const r = await shipmentService.shipmentDetails(req.user.companyId, req.params.id, { allowedWarehouseIds: scope });
    res.json({ success: true, data: r });
  } catch (e) { fail(res, e); }
};
/**
 * GET /api/shipments/:id/receive-checklist — what is still coming in, per
 * product, and how much has already landed.
 */
exports.receiveChecklist = async (req, res) => {
  try {
    const data = await receiveScanService.receiveChecklist(req.user.companyId, req.params.id);
    res.json({ success: true, data });
  } catch (e) { fail(res, e); }
};

/**
 * POST /api/shipments/:id/receive-scan  { code, selectedCodes }
 * Resolve ONE scanned code against this incoming transfer. Read-only — nothing
 * lands until receive-units, which re-checks every serial.
 */
exports.receiveScan = async (req, res) => {
  try {
    const data = await receiveScanService.resolveReceiveScan(req.user.companyId, req.params.id, {
      code: req.body.code,
      selectedCodes: req.body.selectedCodes || [],
    });
    res.json({ success: true, data });
  } catch (e) { fail(res, e); }
};

/**
 * POST /api/shipments/:id/receive-units  { serials, warehouseId, lat, lng }
 * Land the scanned units. Partial by design — the transfer stays receivable
 * until nothing is left in transit.
 */
exports.receiveUnits = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const r = await receiveScanService.receiveScannedUnits(req.user.companyId, req.params.id, {
      ...req.body,
      allowedWarehouseIds: scope,
      verifierId: req.user.id,
      performedBy: req.user.id,
    });
    // Same proof-of-receipt trail the shipping-label path leaves — who received
    // what, where, and how much of the transfer is still on the road.
    await audit.log({
      req,
      action: "shipment.received_by_scan",
      entityType: "Shipment",
      entityId: req.params.id,
      after: { status: r.status, receivedNow: r.receivedNow, stillInTransit: r.stillInTransit },
    });
    res.json({ success: true, message: `Received ${r.receivedNow} unit(s)`, data: r });
  } catch (e) { fail(res, e); }
};

exports.verifyReceipt = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const r = await shipmentService.verifyReceipt(req.user.companyId, req.params.id, { ...req.body, allowedWarehouseIds: scope, verifierId: req.user.id, performedBy: req.user.id });
    // Proof-of-delivery audit trail: who verified, when, at which warehouse,
    // which shipment and which lots — every verification leaves a row.
    await audit.log({
      req,
      action: "shipment.verified",
      entityType: "Shipment",
      entityId: req.params.id,
      after: {
        status: r.shipment.status,
        shortages: r.shortages,
        method: r.shipment.pod?.method,
        verifiedBy: r.shipment.pod?.verifiedBy,
        verifiedAt: r.shipment.pod?.verifiedAt,
        warehouseId: r.shipment.toWarehouseId,
        lots: (r.shipment.lines || []).map((l) => ({ lotNumber: l.lotNumber, qty: l.qty, receivedQty: l.receivedQty })),
      },
    });
    // Delivery confirmation: the SOURCE warehouse's team and the company
    // admin are notified that the destination scanned and received the lots —
    // the sender knows their shipment has landed.
    try {
      const { notifyWarehouseTeam, notifyAdmin } = require("../../services/notificationService");
      // Close the loop on stock requests: an accepted request whose linked
      // shipment was just received is now fulfilled.
      const TransferRequest = require("../../model/Transport/TransferRequest");
      await TransferRequest.updateMany(
        { companyId: req.user.companyId, shipmentId: req.params.id, status: "accepted" },
        { $set: { status: "fulfilled" } }
      );
      const lotsTxt = (r.shipment.lines || []).map((l) => `${l.lotNumber} ×${l.receivedQty ?? l.qty}`).join(", ");
      const msg = `${r.shipment.toLabel} received the transfer${lotsTxt ? ` (${lotsTxt})` : ""}${r.shortages ? ` with ${r.shortages} discrepancy(ies)` : " in full"}`;
      await notifyWarehouseTeam(req.user.companyId, r.shipment.fromWarehouseId, {
        title: "Transfer delivered", body: msg, payload: { shipmentId: r.shipment._id, kind: "transfer_received" },
      });
      await notifyAdmin(req.user.companyId, {
        title: "Transfer received", body: msg, payload: { shipmentId: r.shipment._id, kind: "transfer_received" },
      });
    } catch (notifyErr) { console.error("receipt notification failed:", notifyErr.message); }

    res.json({ success: true, message: r.shortages ? `Received with ${r.shortages} discrepancy(ies)` : "Received in full", data: { status: r.shipment.status, shortages: r.shortages } });
  } catch (e) { fail(res, e); }
};
exports.exception = async (req, res) => {
  try { const s = await shipmentService.reportException(req.user.companyId, req.params.id, { ...req.body, byUserId: req.user.id }); res.json({ success: true, data: { status: s.status } }); }
  catch (e) { fail(res, e); }
};
exports.deliver = async (req, res) => {
  try {
    const s = await shipmentService.completeDelivery(req.user.companyId, req.params.id, { verifierId: req.user.id, signedBy: req.body.signedBy, photoUrls: req.body.photoUrls || [], lat: req.body.lat, lng: req.body.lng });
    res.json({ success: true, message: "Delivered", data: { status: s.status } });
  } catch (e) { fail(res, e); }
};
exports.discrepancies = async (req, res) => { try { const r = await shipmentService.listDiscrepancies(req.user.companyId, req.query); res.json({ success: true, count: r.length, data: r }); } catch (e) { fail(res, e); } };

/* ---- driver mobile ---- */
exports.driverLogin = async (req, res) => {
  try { res.json({ success: true, data: await vehicleService.driverLogin(req.body) }); }
  catch (e) { fail(res, e); }
};
exports.myShipments = async (req, res) => {
  try { const r = await shipmentService.listForDriver(req.user.companyId, req.user.id); res.json({ success: true, count: r.length, data: r }); }
  catch (e) { fail(res, e); }
};
exports.driverArrived = async (req, res) => {
  try { const s = await shipmentService.markArrived(req.user.companyId, req.params.id, { driverId: req.user.id, lat: req.body.lat, lng: req.body.lng }); res.json({ success: true, data: { status: s.status } }); }
  catch (e) { fail(res, e); }
};
exports.driverDeliver = async (req, res) => {
  try {
    const photoUrls = (req.files || []).map((f) => `/uploads/${f.filename}`).concat(req.body.photoUrls || []);
    const s = await shipmentService.completeDelivery(req.user.companyId, req.params.id, { verifierId: req.user.id, signedBy: req.body.signedBy, photoUrls, lat: req.body.lat, lng: req.body.lng });
    res.json({ success: true, message: "Delivered", data: { status: s.status } });
  } catch (e) { fail(res, e); }
};
exports.driverException = async (req, res) => {
  try { const s = await shipmentService.reportException(req.user.companyId, req.params.id, { byUserId: req.user.id, note: req.body.note, lat: req.body.lat, lng: req.body.lng }); res.json({ success: true, data: { status: s.status } }); }
  catch (e) { fail(res, e); }
};