const mongoose = require("mongoose");
const Warehouse = require("../../model/Warehouse/Warehouse");
const Inventory = require("../../model/Inventory/Inventory");
const Seller = require("../../model/Seller/Seller");
const { assertSellerWarehouse } = require("../../services/warehouseOwnershipService");
const { warehouseScope, inScope } = require("../../services/warehouseScope");
const { withTransaction } = require("../../services/txn");
const sellerMember = require("../../services/sellerMemberService");
const { locationFromMapsUrl } = require("../../utils/mapsUrl");

/**
 * Aggregate the seller's owner-scoped inventory grouped by warehouse:
 *   usedUnits = Σ(onlineStock + offlineStock) — physical on-hand occupancy
 *   lotCount  = number of lots (rows) currently holding stock
 * Owner-scoped strictly to { ownerType:"seller", ownerId }. Returns a Map keyed
 * by warehouseId string. Pass a warehouseId to scope to one warehouse.
 */
async function stockByWarehouse(sellerId, warehouseId) {
  const match = { ownerType: "seller", ownerId: new mongoose.Types.ObjectId(String(sellerId)) };
  if (warehouseId) match.warehouseId = new mongoose.Types.ObjectId(String(warehouseId));
  const rows = await Inventory.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$warehouseId",
        usedUnits: { $sum: { $add: ["$onlineStock", "$offlineStock"] } },
        lotCount: { $sum: { $cond: [{ $gt: [{ $add: ["$onlineStock", "$offlineStock"] }, 0] }, 1, 0] } },
      },
    },
  ]);
  const map = new Map();
  rows.forEach((r) => map.set(String(r._id), { usedUnits: r.usedUnits || 0, lotCount: r.lotCount || 0 }));
  return map;
}

/**
 * Seller-owned warehouses. Mirrors the company warehouse handlers
 * (controller/Warehouse/warehouseController.js) but scopes every query by
 * req.user.sellerId instead of companyId. A seller can only ever see/touch
 * warehouses they own (sellerId), never a company's or another seller's.
 *
 * Routes are guarded by authMiddleware + requireApprovedSeller, so only an
 * APPROVED seller principal reaches these handlers.
 */

/** Fields a seller may set on a warehouse (everything else is server-controlled). */
function pickWarehouseFields(body = {}) {
  const out = {};
  if (body.name !== undefined) out.name = body.name;
  if (body.code !== undefined) out.code = body.code;
  if (body.capacityUnits !== undefined) out.capacityUnits = body.capacityUnits;
  if (body.geofenceRadiusM !== undefined) out.geofenceRadiusM = body.geofenceRadiusM;
  if (body.location !== undefined) out.location = body.location;
  if (body.address !== undefined) {
    const a = body.address || {};
    out.address = {
      line1: a.line1,
      city: a.city,
      district: a.district,
      state: a.state,
      pincode: a.pincode,
    };
  }
  return out;
}

/** GET /api/seller/warehouses — the authenticated seller's warehouses, each
 * enriched with its real owner-scoped fill (usedUnits/lotCount) so cards show
 * occupancy without an extra call. */
exports.getSellerWarehouses = async (req, res) => {
  try {
    // Warehouse-level scoping: a seller_manager (or any non-"*" seller role with
    // assigned warehouseIds) sees ONLY their warehouse(s); seller_admin sees all.
    const scope = await warehouseScope(req.user);
    const filter = { sellerId: req.user.sellerId };
    if (scope) filter._id = { $in: scope };
    const rows = await Warehouse.find(filter).sort({ createdAt: -1 });
    const fill = await stockByWarehouse(req.user.sellerId);
    const data = rows.map((w) => {
      const s = fill.get(String(w._id)) || { usedUnits: 0, lotCount: 0 };
      const usedPct = w.capacityUnits ? Math.min(100, Math.round((s.usedUnits / w.capacityUnits) * 100)) : null;
      return { ...w.toObject(), usedUnits: s.usedUnits, lotCount: s.lotCount, usedPct };
    });
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /api/seller/warehouses/:id/stock-summary — aggregate fill for ONE owned
 * warehouse (free Warehouses module; lot-level detail is the paid Inventory
 * module). Strictly owner-scoped. */
exports.getSellerWarehouseStockSummary = async (req, res) => {
  try {
    await assertSellerWarehouse(req.user.sellerId, req.params.id); // 403/404 if not owned
    // A scoped manager may only read summaries for their assigned warehouse(s).
    const scope = await warehouseScope(req.user);
    if (!inScope(scope, req.params.id)) {
      return res.status(403).json({ success: false, message: "This warehouse isn't assigned to you" });
    }
    const wh = await Warehouse.findOne({ _id: req.params.id, sellerId: req.user.sellerId }).select("capacityUnits name");
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });
    const fill = (await stockByWarehouse(req.user.sellerId, req.params.id)).get(String(req.params.id)) || { usedUnits: 0, lotCount: 0 };
    const capacity = wh.capacityUnits || null;
    const usedPct = capacity ? Math.min(100, Math.round((fill.usedUnits / capacity) * 100)) : null;
    res.json({ success: true, data: { warehouseId: String(wh._id), totalUnits: fill.usedUnits, usedUnits: fill.usedUnits, lotCount: fill.lotCount, capacity, usedPct } });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * POST /api/seller/warehouses
 *
 * WAREHOUSE + WAREHOUSE MANAGER, created together.
 *
 * The seller mirror of controller/Warehouse/warehouseController.createWarehouse
 * — same architecture, same validation source, same role-assignment idea, same
 * email. A seller team member is no longer created from Administration →
 * Team & Roles; the manager who runs a warehouse is created WITH that warehouse
 * and assigned to it in the same call. Body: the usual warehouse fields plus
 *   manager: { name, email, phone, password }
 * (shape enforced by validators/sellerWarehouseValidators.js).
 *
 * ALL-OR-NOTHING:
 *  1. The manager's email/phone are checked for duplicates BEFORE anything is
 *     written — the likeliest failure, caught with nothing to undo.
 *  2. Both writes run inside services/txn.withTransaction, so on a replica set
 *     they commit or abort as one unit.
 *  3. On a standalone mongod (no transaction support) withTransaction runs the
 *     callback session-less; the catch below then DELETES the just-created
 *     warehouse if the manager fails, so a warehouse never survives without
 *     its manager. The manager can never survive without the warehouse either,
 *     since it is written second.
 *
 * Response shape is unchanged (`data` is still the warehouse) with the new
 * manager added alongside it, so nothing that reads this endpoint breaks.
 */
exports.createSellerWarehouse = async (req, res) => {
  try {
    const { manager, mapsUrl } = req.body;
    const fields = pickWarehouseFields(req.body);
    if (!fields.name) return res.status(400).json({ success: false, message: "name is required" });
    if (!manager) {
      return res.status(400).json({
        success: false,
        message: "Manager details are required to create a warehouse",
      });
    }

    // An explicitly supplied `location` always wins; otherwise we try to read
    // coordinates out of the Maps link, and fall back to the model's own
    // default when the link carries none (e.g. a short maps.app.goo.gl link).
    const geo = fields.location || locationFromMapsUrl(mapsUrl) || undefined;

    // Pre-flight duplicate check: fail before any document exists.
    await sellerMember.assertUniqueIdentity({ email: manager.email, phone: manager.phone });

    const created = await withTransaction(async (session) => {
      const opts = session ? { session } : {};
      let warehouseId = null;
      try {
        const [wh] = await Warehouse.create(
          [{
            ...fields,
            sellerId: req.user.sellerId,
            location: geo,
            mapsUrl: mapsUrl || undefined,
          }],
          opts
        );
        warehouseId = wh._id;

        // Assigned to THIS warehouse on creation — that array is what
        // services/warehouseScope.js reads for warehouse-level access, so the
        // manager is scoped to their warehouse from their very first login.
        const user = await sellerMember.createSellerMember({
          sellerId: req.user.sellerId,
          name: manager.name,
          email: manager.email,
          phone: manager.phone,
          password: manager.password,
          role: sellerMember.SELLER_WAREHOUSE_MANAGER_ROLE,
          warehouseIds: [wh._id],
          session,
        });

        return { warehouse: wh, manager: user };
      } catch (err) {
        // No session (standalone mongod) → compensate by hand.
        if (!session && warehouseId) {
          await Warehouse.deleteOne({ _id: warehouseId }).catch(() => {});
        }
        throw err;
      }
    });

    // ── WELCOME EMAIL ──
    // Sent ONLY here: past withTransaction, so the warehouse AND the manager
    // are both committed. Any failure earlier (duplicate email/phone, a bad
    // warehouse, the compensating delete) throws into the catch below and
    // never reaches this line, so a half-created pair can't be emailed about.
    //
    // Deliberately NON-FATAL: the records already exist, so a bounced or
    // misconfigured mailbox must not turn a successful creation into a 500.
    // The outcome is reported as `managerEmailSent` instead, and the raw
    // password is never written to the log.
    //
    // Same helper, same template, same transport as the company flow — the only
    // difference is `loginPath`, which points the seller's manager at the
    // SELLER sign-in page they actually use.
    let managerEmailSent = false;
    try {
      const seller = await Seller.findById(req.user.sellerId)
        .select("sellerInfo.businessName contact.ownerName")
        .lean();
      await sellerMember.sendWarehouseManagerWelcomeEmail({
        managerName: created.manager.name,
        email: created.manager.email,
        password: manager.password, // plaintext, request-scoped, email only
        companyName: seller?.sellerInfo?.businessName || seller?.contact?.ownerName,
        warehouseName: created.warehouse.name,
        loginPath: "/seller/login",
      });
      managerEmailSent = true;
    } catch (mailErr) {
      console.error("createSellerWarehouse: manager welcome email failed:", mailErr.message);
    }

    res.status(201).json({
      success: true,
      message: "Warehouse and manager created",
      data: created.warehouse,
      manager: created.manager,
      managerEmailSent,
    });
  } catch (err) {
    console.error("createSellerWarehouse error:", err);
    res
      .status(err.status || 500)
      .json({ success: false, message: err.status ? err.message : "Server error" });
  }
};

/** PUT /api/seller/warehouses/:id — edit, only if owned by this seller.
 *
 * Editing NEVER touches the warehouse's manager: that account already exists
 * and its lifecycle (enable / disable / remove) lives in Team & Roles. Same
 * rule as the company edit handler. */
exports.updateSellerWarehouse = async (req, res) => {
  try {
    const wh = await Warehouse.findOne({ _id: req.params.id, sellerId: req.user.sellerId });
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });

    const fields = pickWarehouseFields(req.body);
    // Merge the address key-by-key rather than replacing the sub-document, so a
    // caller that omits `district` doesn't silently wipe a saved one.
    const { address, ...rest } = fields;
    Object.assign(wh, rest);
    if (address) {
      if (!wh.address) wh.address = {};
      for (const k of ["line1", "city", "district", "state", "pincode"]) {
        if (address[k] !== undefined) wh.address[k] = address[k];
      }
      wh.markModified("address");
    }

    // Google Maps link. ADDITIVE: only touched when the caller actually sends
    // the key, so every existing PUT caller behaves exactly as before. Sending
    // "" clears it.
    if (req.body.mapsUrl !== undefined) {
      const link = String(req.body.mapsUrl || "").trim();
      if (link && !/^https?:\/\/\S+$/i.test(link)) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid link starting with http:// or https://",
        });
      }
      wh.mapsUrl = link || undefined;
      // Keep the geo point in step when the new link carries coordinates.
      const derived = locationFromMapsUrl(link);
      if (derived) {
        wh.location = derived;
        wh.markModified("location");
      }
    }

    await wh.save();
    res.json({ success: true, message: "Warehouse updated", data: wh });
  } catch (err) {
    console.error("updateSellerWarehouse error:", err);
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : "Server error" });
  }
};

/** PATCH /api/seller/warehouses/:id/deactivate — soft-disable, only if owned. */
exports.deactivateSellerWarehouse = async (req, res) => {
  try {
    const wh = await Warehouse.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.user.sellerId },
      { $set: { isActive: false } },
      { new: true }
    );
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });
    res.json({ success: true, message: "Warehouse deactivated", data: { _id: wh._id, isActive: wh.isActive } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Ownership guard lives in services/warehouseOwnershipService.js (shared with
// the lot service's supplyTransfer). Re-exported here for backwards compatibility.
exports.assertSellerWarehouse = assertSellerWarehouse;