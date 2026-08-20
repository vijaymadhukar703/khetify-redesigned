const repackService = require("../../services/repackService");
const audit = require("../../services/auditService");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("Repack error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

/**
 * POST /api/repack-boxes  { shipmentId, serials[] }
 * Pack loose picked units into a NEW carton and mint its ID.
 */
exports.pack = async (req, res) => {
  try {
    const data = await repackService.packUnits(req.user.companyId, {
      shipmentId: req.body.shipmentId,
      serials: req.body.serials,
      performedBy: req.user.id,
    });
    await audit.log({
      req, action: "repack.packed", entityType: "RepackBox", entityId: data.repackBoxId,
      after: { units: data.unitCount, lots: data.lotCount, shipmentId: data.shipmentId },
    });
    res.status(201).json({ success: true, message: `Packed ${data.unitCount} unit(s) into ${data.repackBoxId}`, data });
  } catch (e) { fail(res, e); }
};

/** GET /api/repack-boxes/:repackBoxId — contents, grouped by original lot. */
exports.contents = async (req, res) => {
  try {
    res.json({ success: true, data: await repackService.boxContents(req.user.companyId, req.params.repackBoxId) });
  } catch (e) { fail(res, e); }
};

/** GET /api/repack-boxes?shipmentId=… — the cartons packed for one shipment. */
exports.listForShipment = async (req, res) => {
  try {
    const rows = await repackService.listForShipment(req.user.companyId, req.query.shipmentId);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { fail(res, e); }
};

/**
 * DELETE /api/repack-boxes/:repackBoxId — the carton was never dispatched, so
 * remove it entirely and hand its units back as loose ones.
 *
 * The AUDIT LOG IS ADDED TO, NEVER ERASED. The service deletes the box row and
 * the units' own "repacked" events — a unit's history should not claim it was
 * boxed when the box never went anywhere — but who packed it and who took it
 * back are both operator actions, and this records the second rather than
 * deleting the first. `before` carries what was removed, so the pair reads as
 * one story even though the row itself is gone.
 */
exports.discard = async (req, res) => {
  try {
    const data = await repackService.discardBox(req.user.companyId, req.params.repackBoxId, {
      performedBy: req.user.id,
    });
    await audit.log({
      req, action: "repack.discarded", entityType: "RepackBox", entityId: data.repackBoxId,
      before: { units: data.unitCount, shipmentId: data.shipmentId },
      after: null,
    });
    res.json({
      success: true,
      message: `${data.repackBoxId} removed — ${data.unitCount} unit(s) are loose again`,
      data,
    });
  } catch (e) { fail(res, e); }
};

/** POST /api/repack-boxes/:repackBoxId/unpack — break it back into loose units. */
exports.unpack = async (req, res) => {
  try {
    const data = await repackService.unpackBox(req.user.companyId, req.params.repackBoxId, {
      performedBy: req.user.id,
    });
    await audit.log({
      req, action: "repack.unpacked", entityType: "RepackBox", entityId: data.repackBoxId,
      after: { units: data.unitCodes.length },
    });
    res.json({ success: true, message: `${data.repackBoxId} unpacked`, data });
  } catch (e) { fail(res, e); }
};
