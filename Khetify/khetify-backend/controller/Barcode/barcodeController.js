const svc = require("../../services/barcodeService");
const audit = require("../../services/auditService");

// The company is the unit owner for all company-side barcode flows.
const companyOwner = (req) => ({ ownerType: "company", ownerId: req.user.companyId });

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("Barcode error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

exports.generate = async (req, res) => {
  try {
    // `role` lets the service bar a company warehouse from minting serials —
    // only the main company controls child units. Print/reprint/list are
    // deliberately not passed a role: a warehouse must keep doing those.
    const r = await svc.generateUnits(req.user.companyId, req.body.inventoryId, req.body.qty, { performedBy: req.user.id, role: req.user.role });
    await audit.log({ req, action: "units.generated", entityType: "Inventory", entityId: req.body.inventoryId, after: r });
    res.status(201).json({ success: true, message: `Generated ${r.generated} unit barcode(s)`, data: r });
  } catch (err) { fail(res, err); }
};

/**
 * THE MAIN COMPANY READS A LOT AS ONE THING, wherever its units now sit.
 *
 * A warehouse holds what it holds, so it keeps the row-scoped answer. The
 * company owns every warehouse, so a warehouse→warehouse move is an internal
 * relocation, not a loss — the same rule lotController already applies to
 * Company → Inventory → View, and it is gated on the very same role.
 */
const companyIdentityScope = (req) => req.user.role === "company_admin";

exports.list = async (req, res) => {
  try {
    const identityScope = companyIdentityScope(req);
    const rows = await svc.listUnits(companyOwner(req), {
      ...req.query,
      identityScope,
      // A WAREHOUSE prints what is on its own shelf, so stock already dispatched
      // drops out of its Labels page the moment it leaves. The company keeps
      // every label of the lot — the goods are still its own, just elsewhere.
      excludeDispatched: !identityScope,
    });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

/**
 * GET /api/units/counts
 * Unit-label count per lot, keyed by inventoryId — one aggregate instead of a
 * per-lot round trip. Drives the Labels page's per-lot remaining capacity.
 */
exports.counts = async (req, res) => {
  try {
    const data = await svc.unitCountsByLot(companyOwner(req), {
      identityScope: companyIdentityScope(req),
    });
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};

exports.print = async (req, res) => {
  try {
    const r = await svc.markPrinted(companyOwner(req), req.body.serials, { actorId: req.user.id });
    res.json({ success: true, message: `Marked ${r.moved.length} printed`, data: r });
  } catch (err) { fail(res, err); }
};

exports.transition = async (req, res) => {
  try {
    const r = await svc.transitionUnits(companyOwner(req), req.body.serials, { ...req.body, actorId: req.user.id });
    res.json({ success: true, message: `Moved ${r.moved.length}, skipped ${r.skipped.length}`, data: r });
  } catch (err) { fail(res, err); }
};

exports.history = async (req, res) => {
  try {
    const r = await svc.unitHistory(companyOwner(req), req.params.serial);
    res.json({ success: true, data: r });
  } catch (err) { fail(res, err); }
};

exports.scan = async (req, res) => {
  try {
    const r = await svc.resolveScan(companyOwner(req), req.body.code, req.user.role);
    res.json({ success: true, data: r });
  } catch (err) { fail(res, err); }
};

exports.recall = async (req, res) => {
  try {
    const r = await svc.recall(req.user.companyId, req.body.lotNumber, { performedBy: req.user.id });
    await audit.log({ req, action: "lot.recalled", entityType: "Lot", after: { lotNumber: r.lotNumber, recalledUnits: r.recalledUnits, soldUnits: r.soldUnits } });
    res.json({ success: true, message: `Recalled ${r.recalledUnits} unit(s); ${r.soldUnits} already sold`, data: r });
  } catch (err) { fail(res, err); }
};
