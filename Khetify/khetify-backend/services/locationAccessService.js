/**
 * LIVE-LOCATION CONSENT — shared by the Seller and the Customer (Consumer).
 *
 * ── WHY THE DECISION IS STORED SERVER-SIDE ──
 * The browser already remembers its OWN permission, but that answer is per
 * device and per origin, and it is not readable at all in some browsers. The
 * product rule is per ACCOUNT:
 *
 *   granted  → never ask again, on any login, on any device
 *   denied   → ask again on the next login
 *   (unset)  → never asked yet; ask
 *
 * Only a stored decision can answer that, so the decision lives on the Seller /
 * Consumer document and the browser permission is treated as a hint.
 *
 * ── WHAT IS TRUSTED ──
 * Nothing from the client except the two coordinates and the accuracy, each
 * range-checked below. Timestamps are taken from the SERVER clock: a client
 * that could backdate `capturedAt` could make a stale fix look current.
 *
 * ── STORED AS GEOJSON ──
 * The coordinates live in `locationAccess.point` as a GeoJSON Point, indexed
 * 2dsphere, in the SAME shape as Warehouse.location. That is what makes the
 * nearest-warehouse lookup a plain $geoNear instead of pulling every account
 * into the application and computing distances by hand. Two loose `latitude` /
 * `longitude` numbers cannot be geo-queried at all, which is why they are not
 * what is written — even though that is the shape the API hands back.
 *
 * ── DENIAL DOES NOT ERASE ──
 * A denial writes the status and the decision time only. Any previously
 * captured coordinates are left alone — a refusal to share a NEW fix is not a
 * request to forget the last one, and deleting it would silently change what
 * the rest of the system already had.
 */

/**
 * ── THE THREE ANSWERS, AND WHY "denied" AND "revoked" ARE NOT THE SAME ──
 *
 *   granted  — sharing. Never asked again.
 *   denied   — the PROMPT was refused (Not now, or the browser blocked it).
 *              Asked again on the next login: a refusal in the moment is not a
 *              standing decision, and the person may simply have been busy.
 *   revoked  — turned OFF deliberately from the settings page. Never asked
 *              again. Someone who went into settings to switch this off has
 *              made a standing decision, and re-opening the prompt at their
 *              next login would be nagging them for an answer they already
 *              gave. They turn it back on from the same place.
 *
 * Collapsing the last two into one status would force a choice between nagging
 * the settings user and never re-asking the one who just dismissed a dialog.
 */
const { reverseGeocode } = require("./reverseGeocodeService");

const ALLOWED_STATUSES = ["granted", "denied", "revoked"];

/** Statuses that stop the login prompt from ever opening again. */
const SETTLED_STATUSES = ["granted", "revoked"];

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/**
 * Validate a consent payload and return the fields to write.
 *
 * @param {object} body  { status, latitude?, longitude?, accuracy? }
 * @returns {object} a partial `locationAccess` — assign it over the existing one
 */
async function buildLocationAccess(body = {}) {
  const status = String(body.status || "").trim().toLowerCase();
  if (!ALLOWED_STATUSES.includes(status)) {
    throw badRequest('status must be "granted", "denied" or "revoked"');
  }

  const now = new Date();

  // DENIED: record the refusal and the time, nothing else. Any coordinates
  // captured earlier are left alone — see "DENIAL DOES NOT ERASE" above.
  if (status === "denied") {
    return { status: "denied", decidedAt: now };
  }

  // REVOKED: consent WITHDRAWN from settings, so the coordinates go too.
  //
  // This is the one case that must erase. Someone switching location off is
  // asking us to stop holding their position, not merely to stop asking for a
  // new one; keeping the last fix on file after they said stop would defeat the
  // point of offering the switch at all. `point: undefined` unsets the field,
  // which also drops the document out of the 2dsphere index.
  if (status === "revoked") {
    return {
      status: "revoked",
      point: undefined,
      accuracy: undefined,
      capturedAt: undefined,
      address: undefined,
      decidedAt: now,
    };
  }

  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw badRequest("latitude must be a number between -90 and 90");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw badRequest("longitude must be a number between -180 and 180");
  }

  const accuracy = Number(body.accuracy);

  // The ADDRESS IS RESOLVED HERE, from the coordinates, and any address the
  // caller sent is ignored. Trusting client-supplied text would let anyone
  // store whatever address they liked against their own account — the whole
  // point of showing it back to them is that it is what we actually resolved.
  //
  // A null result is fine and expected: the provider may be down, rate-limited
  // or simply not know the place. The fix is still saved, just without a name.
  const resolved = await reverseGeocode(latitude, longitude);

  return {
    status: "granted",
    // GeoJSON, so this is queryable — [LONGITUDE, LATITUDE], in that order.
    // The reversed order is the single most common way to get geo queries
    // silently wrong: lat/lng is how people say it, lng/lat is what GeoJSON
    // and every $near / $geoNear expects.
    point: { type: "Point", coordinates: [longitude, latitude] },
    // Accuracy is advisory metadata from the device; drop it rather than store
    // a nonsense value when it is missing or negative.
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : undefined,
    capturedAt: now,
    address: resolved
      ? {
          state: resolved.state,
          district: resolved.district,
          city: resolved.city,
          pincode: resolved.pincode,
          country: resolved.country,
          formatted: resolved.formatted,
          provider: resolved.provider,
          resolvedAt: now,
        }
      : undefined,
    decidedAt: now,
  };
}

/**
 * Apply a validated consent to a Mongoose document WITHOUT clobbering the
 * fields the new decision does not carry (see "DENIAL DOES NOT ERASE" above).
 * The caller saves.
 */
function applyLocationAccess(doc, patch) {
  const current = (doc.locationAccess && doc.locationAccess.toObject
    ? doc.locationAccess.toObject()
    : doc.locationAccess) || {};

  const next = { ...current, ...patch };

  // A spread does NOT remove a key whose new value is undefined — it keeps the
  // key sitting there as undefined, and Mongoose then leaves the OLD value in
  // place on the document. That would make "revoked" quietly keep the very
  // coordinates it exists to erase, so the keys are deleted outright.
  for (const key of Object.keys(patch)) {
    if (patch[key] === undefined) {
      delete next[key];
      doc.set(`locationAccess.${key}`, undefined);
    }
  }

  doc.locationAccess = next;
  return doc;
}

/**
 * The shape the portals receive. Deliberately small: the prompt only needs to
 * know whether it must ask, and the coordinates are useful to anything that
 * later wants to pre-fill an address or rank warehouses by distance.
 */
function publicLocationAccess(locationAccess) {
  const la = locationAccess || {};
  if (!la.status) return { status: null };

  // Stored as [lng, lat]; handed out as named fields. Callers reading a
  // coordinate PAIR are the ones who get the order wrong, so the API never
  // exposes one — it names each number.
  const coords = Array.isArray(la.point?.coordinates) ? la.point.coordinates : [];
  const [longitude, latitude] = coords.length === 2 ? coords : [null, null];

  const a = la.address || null;

  return {
    status: la.status,
    latitude,
    longitude,
    accuracy: la.accuracy == null ? null : la.accuracy,
    capturedAt: la.capturedAt || null,
    // null rather than an empty object when nothing resolved, so the UI can
    // test one thing to decide between "here is where you are" and "we have
    // your coordinates but could not name the place".
    address: a && (a.state || a.district || a.city || a.pincode)
      ? {
          state: a.state || null,
          district: a.district || null,
          city: a.city || null,
          pincode: a.pincode || null,
          country: a.country || null,
          formatted: a.formatted || null,
        }
      : null,
  };
}

module.exports = {
  ALLOWED_STATUSES,
  SETTLED_STATUSES,
  buildLocationAccess,
  applyLocationAccess,
  publicLocationAccess,
};