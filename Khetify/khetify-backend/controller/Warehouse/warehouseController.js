const Warehouse = require("../../model/Warehouse/Warehouse");
const { warehouseScope } = require("../../services/warehouseScope");
const { withTransaction } = require("../../services/txn");
const companyMember = require("../../services/companyMemberService");
const audit = require("../../services/auditService");
const Company = require("../../model/Company/Company");
const User = require("../../model/User/User");
const bcrypt = require("bcryptjs");

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

/**
 * The warehouse manager(s) assigned to the given warehouses.
 *
 * Matched exactly as createWarehouse assigns them: a company user carrying
 * the warehouse-manager role with this warehouse in `warehouseIds`, scoped to
 * the caller's own company. Sorted oldest-first so "the manager" is stable.
 *
 * The projection is EXPLICIT and deliberately narrow: passwordHash must never
 * leave this process. `warehouseIds` is read only to group rows and is dropped
 * from what is returned to the client.
 */
const MANAGER_PUBLIC_FIELDS = "_id name email phone";

async function findWarehouseManagers(companyId, warehouseIds, session) {
  return User.find({
    companyId,
    role: companyMember.WAREHOUSE_MANAGER_ROLE,
    warehouseIds: { $in: warehouseIds },
  })
    .select(MANAGER_PUBLIC_FIELDS + " warehouseIds")
    .sort({ createdAt: 1 })
    .session(session || null)
    .lean();
}

/** Only ever the four public fields — never the whole user document. */
const publicManager = (u) =>
  (u ? { _id: u._id, name: u.name, email: u.email, phone: u.phone } : null);

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
    const rows = await Warehouse.find(filter).sort({ createdAt: -1 }).lean();

    // The Edit Warehouse modal reads this list (there is no single-warehouse
    // GET), so the assigned manager rides along with each row. One query for
    // the whole page, not one per warehouse. A warehouse created before
    // managers existed simply carries null.
    const managers = await findWarehouseManagers(req.user.companyId, rows.map((w) => w._id));
    const byWarehouse = new Map();
    for (const u of managers) {
      for (const id of u.warehouseIds || []) {
        const k = String(id);
        if (!byWarehouse.has(k)) byWarehouse.set(k, []);
        byWarehouse.get(k).push(u);
      }
    }
    const data = rows.map((w) => {
      const found = byWarehouse.get(String(w._id)) || [];
      // First by createdAt, plus a count so the frontend can tell when a
      // warehouse somehow ended up with more than one manager.
      return { ...w, manager: publicManager(found[0]), managerCount: found.length };
    });
    res.json({ success: true, count: data.length, data });
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

    // ── MANAGER (optional) ──
    // Absent key → this handler behaves exactly as it always has: save the
    // warehouse and return. Every manager field below is likewise optional.
    const { manager } = req.body;
    if (manager === undefined || manager === null) {
      await wh.save(); // runs the company-XOR-seller pre('validate') hook
      return res.json({ success: true, message: "Warehouse updated", data: wh });
    }
    if (typeof manager !== "object" || Array.isArray(manager)) {
      return res.status(400).json({ success: false, message: "manager must be an object" });
    }

    // Editing a manager, never creating one — creation belongs to the create
    // flow, which also assigns the role and the warehouse.
    const [assigned] = await findWarehouseManagers(req.user.companyId, [wh._id]);
    if (!assigned) {
      return res.status(400).json({
        success: false,
        message: "This warehouse has no manager to edit. Managers are assigned when the warehouse is created.",
      });
    }

    // Normalised the same way companyMemberService writes them, so the login
    // lookup (a case-insensitive email match) keeps resolving.
    const nextName = manager.name !== undefined ? String(manager.name || "").trim() : undefined;
    const nextEmail = manager.email !== undefined ? String(manager.email || "").trim().toLowerCase() : undefined;
    const nextPhone = manager.phone !== undefined ? String(manager.phone || "").trim() : undefined;
    // ONLY a non-empty string is a password change. Missing, null or "" means
    // keep the existing one — a manager must never be locked out by a save
    // that simply didn't retype it.
    const rawPassword = typeof manager.password === "string" ? manager.password.trim() : "";

    if (nextName !== undefined && !nextName) return res.status(400).json({ success: false, message: "Manager name cannot be empty" });
    if (nextEmail !== undefined && !nextEmail) return res.status(400).json({ success: false, message: "Manager email cannot be empty" });
    if (nextPhone !== undefined && !nextPhone) return res.status(400).json({ success: false, message: "Manager phone cannot be empty" });

    // Snapshot for the no-session fallback below.
    const before = await Warehouse.findById(wh._id).lean();

    const saved = await withTransaction(async (session) => {
      const opts = session ? { session } : {};
      let warehouseWritten = false;
      try {
        // The SAME duplicate check the create path runs, excluding this very
        // user — otherwise re-saving an unchanged email fails against itself.
        // Runs BEFORE any write, so the likeliest rejection leaves the
        // warehouse untouched even where transactions aren't available.
        if (nextEmail !== undefined || nextPhone !== undefined) {
          await companyMember.assertUniqueIdentity({
            email: nextEmail,
            phone: nextPhone,
            excludeId: assigned._id,
            session,
          });
        }

        const $set = {};
        if (nextName !== undefined) $set.name = nextName;
        if (nextEmail !== undefined) $set.email = nextEmail;
        if (nextPhone !== undefined) $set.phone = nextPhone;
        // Same algorithm and same cost factor as createCompanyMember.
        if (rawPassword) $set.passwordHash = await bcrypt.hash(rawPassword, 10);

        await wh.save(opts); // runs the company-XOR-seller pre('validate') hook
        warehouseWritten = true;

        // role, companyId and warehouseIds are deliberately NOT in $set: this
        // endpoint edits a manager's details, not their permissions.
        if (Object.keys($set).length) {
          await User.updateOne({ _id: assigned._id, companyId: req.user.companyId }, { $set }, opts);
        }

        const fresh = await User.findById(assigned._id)
          .select(MANAGER_PUBLIC_FIELDS)
          .session(session || null)
          .lean();
        return fresh;
      } catch (err) {
        // No session (standalone mongod) → put the warehouse back by hand, so a
        // rejected manager edit can't leave a renamed warehouse behind.
        if (!session && warehouseWritten && before) {
          await Warehouse.replaceOne({ _id: wh._id }, before).catch(() => {});
        }
        throw err;
      }
    });

    // Mirrors the create path's "user.created" entry so the trail is
    // continuous. The password is never part of it.
    await audit.log({
      req,
      action: "user.updated",
      entityType: "User",
      entityId: assigned._id,
      after: {
        name: saved?.name,
        email: saved?.email,
        role: companyMember.WAREHOUSE_MANAGER_ROLE,
        passwordChanged: !!rawPassword,
      },
    });

    // ── CHANGE NOTIFICATION ──
    // Past withTransaction and past the audit entry, so the record is already
    // committed. Deliberately NON-FATAL, exactly like the create path: a
    // bounced mailbox must never turn a successful save into a 500, so the
    // outcome is reported as `managerEmailSent` instead. The raw password is
    // handed to the mailer and never written to a log.
    const changedFields = [];
    if (nextName !== undefined && nextName !== (assigned.name || "")) changedFields.push("Name");
    if (nextEmail !== undefined && nextEmail !== (assigned.email || "")) changedFields.push("Email");
    if (nextPhone !== undefined && nextPhone !== (assigned.phone || "")) changedFields.push("Phone");
    if (rawPassword) changedFields.push("Password");

    let managerEmailSent = false;
    if (changedFields.length) {
      try {
        const company = await Company
          .findById(req.user.companyId)
          .select("companyInfo.companyName fullName")
          .lean();
        const companyName = company?.companyInfo?.companyName || company?.fullName;

        // When the LOGIN EMAIL moved, both addresses are told: the old one so a
        // manager who did not expect this can raise the alarm, the new one so
        // they know where they sign in now. `assigned` was read before the
        // update, so it still holds the old address.
        const recipients = [saved?.email];
        if (changedFields.includes("Email") && assigned.email) recipients.unshift(assigned.email);
        const unique = [...new Set(recipients.filter(Boolean))];

        for (const to of unique) {
          await companyMember.sendWarehouseManagerUpdatedEmail({
            managerName: saved?.name,
            to,
            changedFields,
            password: rawPassword || undefined, // plaintext, request-scoped, email only
            companyName,
            warehouseName: wh.name,
          });
        }
        managerEmailSent = unique.length > 0;
      } catch (mailErr) {
        console.error("updateWarehouse: manager update email failed:", mailErr.message);
      }
    }

    const updated = await Warehouse.findById(wh._id);
    res.json({ success: true, message: "Warehouse updated", data: updated, manager: publicManager(saved), managerEmailSent });
  } catch (err) {
    console.error("updateWarehouse error:", err);
    res
      .status(err.status || 500)
      .json({ success: false, message: err.status ? err.message : "Server error" });
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