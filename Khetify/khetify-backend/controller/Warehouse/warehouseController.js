const Warehouse = require("../../model/Warehouse/Warehouse");
const { warehouseScope } = require("../../services/warehouseScope");
const { withTransaction } = require("../../services/txn");
const companyMember = require("../../services/companyMemberService");
const audit = require("../../services/auditService");
const Company = require("../../model/Company/Company");

/**
 * Best-effort: read [longitude, latitude] out of a Google Maps link.
 *
 * The Maps link is optional and purely informational, but when it happens to
 * carry coordinates we use them to fill Warehouse.location — the field that
 * backs the 2dsphere index, the nearest-warehouse lookup and the delivery
 * geofence. That keeps those features working without putting a latitude /
 * longitude box back on the form.
 *
 * Recognised: the `@lat,lng,zoom` segment of a /maps/place/… URL, a `?q=lat,lng`
 * or `?ll=lat,lng` query, and the `!3dlat!4dlng` pair Google appends. A short
 * maps.app.goo.gl link carries no coordinates until it is followed, so it
 * simply yields null — the URL is still stored, nothing fails.
 *
 * Returns a GeoJSON Point, or null when nothing trustworthy is found.
 */
function locationFromMapsUrl(url) {
  if (!url || typeof url !== "string") return null;

  // Order matters: !3d!4d is the PLACE PIN, while @lat,lng is only the map
  // viewport centre — so the pin is preferred when a URL carries both.
  const patterns = [
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,     // …!3d23.8343!4d80.3897 (place pin)
    /[?&](?:q|ll|center|daddr)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/i, // ?q=23.8343,80.3897
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,        // /maps/place/…/@23.8343,80.3897,17z
  ];

  for (const re of patterns) {
    const m = url.match(re);
    if (!m) continue;
    // Every recognised pattern above yields LATITUDE first, then longitude.
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    const sane =
      Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
      !(lat === 0 && lng === 0);
    if (sane) return { type: "Point", coordinates: [lng, lat] };
  }
  return null;
}

/** GET /api/warehouse */
exports.getWarehouses = async (req, res) => {
  try {
    // DIRECTORY MODE (?directory=1): every company warehouse, names only.
    // Needed by transfer/shipment destination pickers — a scoped operations
    // manager must be able to SEND to any company warehouse even though their
    // data visibility is restricted to their own. No capacity/geofence/stock
    // details are exposed here.
    if (req.query.directory) {
      const rows = await Warehouse.find({ companyId: req.user.companyId })
        .select("name code address")
        .sort({ name: 1 });
      return res.json({ success: true, count: rows.length, data: rows });
    }

    // Warehouse-level access: scoped users (e.g. an operations manager
    // assigned to Khargone) only see their assigned warehouses.
    const scope = await warehouseScope(req.user);
    const filter = { companyId: req.user.companyId };
    if (scope) filter._id = { $in: scope };
    const rows = await Warehouse.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/warehouse  (premium: multi_warehouse + enforceLimit)
 *
 * WAREHOUSE + WAREHOUSE MANAGER, created together.
 *
 * A company member is no longer created from the Team page; the manager who
 * runs a warehouse is created WITH that warehouse and assigned to it in the
 * same call. Body: the usual warehouse fields plus
 *   manager: { name, email, phone, password }
 * (shape enforced by validators/warehouseValidators.js).
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
exports.createWarehouse = async (req, res) => {
  try {
    const { name, code, address, location, capacityUnits, manager, mapsUrl } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "name is required" });
    if (!manager) {
      return res.status(400).json({
        success: false,
        message: "Manager details are required to create a warehouse",
      });
    }

    // The Maps link is OPTIONAL. An explicitly supplied `location` always wins;
    // otherwise we try to read coordinates out of the link, and fall back to the
    // model's own default when neither is available.
    const geo = location || locationFromMapsUrl(mapsUrl) || undefined;

    // Pre-flight duplicate check: fail before any document exists.
    await companyMember.assertUniqueIdentity({ email: manager.email, phone: manager.phone });

    const created = await withTransaction(async (session) => {
      const opts = session ? { session } : {};
      let warehouseId = null;
      try {
        const [wh] = await Warehouse.create(
          [{
            companyId: req.user.companyId,
            name,
            code,
            address,
            location: geo,
            capacityUnits,
            mapsUrl: mapsUrl || undefined,
          }],
          opts
        );
        warehouseId = wh._id;

        // Assigned to THIS warehouse on creation — that array is what
        // services/warehouseScope.js reads for warehouse-level access.
        const user = await companyMember.createCompanyMember({
          companyId: req.user.companyId,
          name: manager.name,
          email: manager.email,
          phone: manager.phone,
          password: manager.password,
          role: companyMember.WAREHOUSE_MANAGER_ROLE,
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

    // Same audit action the old Add Member flow wrote, so the trail is continuous.
    await audit.log({
      req,
      action: "user.created",
      entityType: "User",
      entityId: created.manager._id,
      after: {
        name: created.manager.name,
        email: created.manager.email,
        role: created.manager.role,
        warehouseIds: created.manager.warehouseIds,
      },
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
    let managerEmailSent = false;
    try {
      // The display name lives at companyInfo.companyName; `fullName` is the
      // signup contact and is the fallback the rest of the codebase uses
      // (sellerCompanyController, adminController, sellerAuthController).
      const company = await Company
        .findById(req.user.companyId)
        .select("companyInfo.companyName fullName")
        .lean();
      await companyMember.sendWarehouseManagerWelcomeEmail({
        managerName: created.manager.name,
        email: created.manager.email,
        password: manager.password, // plaintext, request-scoped, email only
        companyName: company?.companyInfo?.companyName || company?.fullName,
        warehouseName: created.warehouse.name,
      });
      managerEmailSent = true;
    } catch (mailErr) {
      console.error("createWarehouse: manager welcome email failed:", mailErr.message);
    }

    res.status(201).json({
      success: true,
      message: "Warehouse and manager created",
      data: created.warehouse,
      manager: created.manager,
      managerEmailSent,
    });
  } catch (err) {
    console.error("createWarehouse error:", err);
    res
      .status(err.status || 500)
      .json({ success: false, message: err.status ? err.message : "Server error" });
  }
};

/** PUT /api/warehouse/:id — edit an existing company warehouse. */
exports.updateWarehouse = async (req, res) => {
  try {
    // Scope by companyId so a company can only edit its OWN warehouses.
    const wh = await Warehouse.findOne({
      _id: req.params.id,
      companyId: req.user.companyId,
    });
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });

    const { name, code, address, capacityUnits } = req.body;
    if (name !== undefined) {
      if (!name) return res.status(400).json({ success: false, message: "name is required" });
      wh.name = name;
    }
    if (code !== undefined) wh.code = code;
    if (capacityUnits !== undefined) {
      wh.capacityUnits = capacityUnits === "" || capacityUnits === null ? undefined : capacityUnits;
    }
    if (address && typeof address === "object") {
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

    // Explicit coordinates still win when a caller sends them (API compatibility).
    if (req.body.location && Array.isArray(req.body.location.coordinates)) {
      const [lng, lat] = req.body.location.coordinates.map(Number);
      const valid =
        Number.isFinite(lng) && Number.isFinite(lat) &&
        lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
      if (!valid) {
        return res.status(400).json({ success: false, message: "Location coordinates are invalid" });
      }
      wh.location = { type: "Point", coordinates: [lng, lat] };
      wh.markModified("location");
    }

    await wh.save(); // runs the company-XOR-seller pre('validate') hook
    res.json({ success: true, message: "Warehouse updated", data: wh });
  } catch (err) {
    console.error("updateWarehouse error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /api/warehouse/nearest?lng=..&lat=.. — nearest active warehouse. */
exports.nearestWarehouse = async (req, res) => {
  try {
    const lng = parseFloat(req.query.lng);
    const lat = parseFloat(req.query.lat);
    if (Number.isNaN(lng) || Number.isNaN(lat)) {
      return res.status(400).json({ success: false, message: "lng and lat are required" });
    }
    const wh = await Warehouse.findOne({
      companyId: req.user.companyId,
      isActive: true,
      location: {
        $near: { $geometry: { type: "Point", coordinates: [lng, lat] } },
      },
    });
    res.json({ success: true, data: wh });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};