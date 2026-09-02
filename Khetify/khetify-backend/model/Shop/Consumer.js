const mongoose = require("mongoose");

/**
 * A public storefront shopper (customer-shop). This is a GLOBAL end-consumer
 * account — distinct from:
 *   - User        (a team member owned by a company/seller),
 *   - Sales/Customer (an owner-scoped CRM record; one is auto-created per seller
 *                     when a consumer places an order with that seller).
 *
 * A consumer browses every seller's published listings without logging in and
 * only authenticates at checkout. Auth is email/phone + password; email OTP
 * (via mailerService) optionally verifies the email. No SMS is sent — phone is
 * stored as contact info only.
 */
const shopAddressSchema = new mongoose.Schema(
  {
    label: { type: String }, // "Home", "Work", ...
    fullName: { type: String },
    phone: { type: String },
    line1: { type: String },
    line2: { type: String },
    city: { type: String },
    district: { type: String },
    state: { type: String },
    stateCode: { type: String }, // GST state code, e.g. "23" (MP)
    pincode: { type: String },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

const consumerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true },

    emailVerified: { type: Boolean, default: false },
    // Short-lived email OTP for verification (hash + expiry; never store raw).
    emailOtp: {
      codeHash: { type: String },
      expiresAt: { type: Date },
      attempts: { type: Number, default: 0 },
    },

    addresses: { type: [shopAddressSchema], default: [] },
    status: { type: String, enum: ["active", "disabled"], default: "active" },
    // ── LIVE LOCATION (browser geolocation consent) ──────────────────────
    // ADDITIVE. Recorded when the portal asks for live location right after
    // registration / login. `status` is the ACCOUNT-level answer, which is what
    // makes "granted → never ask again, denied → ask again next login" work
    // across devices; the browser's own permission is only a hint and is not
    // readable everywhere.
    //
    // Absent on every pre-existing account, which reads as "never asked" and
    // simply means the prompt is shown once.
    locationAccess: {
      // "revoked" = switched off from the settings page; unlike "denied" it is a
      // standing decision, so the login prompt does not reopen for it.
      status: { type: String, enum: ["granted", "denied", "revoked"], default: null },
      // GeoJSON Point, [longitude, latitude] — the SAME shape and field order
      // as Warehouse.location, so one $geoNear works against either collection
      // and the nearest-warehouse lookup needs no translation layer.
      //
      // NO DEFAULTS on either key, deliberately. A default would make Mongoose
      // materialise `point: { type: "Point" }` with no coordinates on every
      // save — including for accounts that DENIED — and the 2dsphere index
      // rejects a Point with an empty coordinate array. The whole object is
      // written at once, only when consent is granted, or not at all.
      point: {
        type: { type: String, enum: ["Point"] },
        coordinates: { type: [Number] }, // [lng, lat]
      },
      accuracy: { type: Number }, // metres, as reported by the device
      // READABLE ADDRESS, resolved SERVER-SIDE from the point above. Stored so
      // the account can be read, filtered and supported by a human without
      // geocoding the coordinates again on every screen.
      //
      // Every field is optional: geocoding can fail or return a partial answer,
      // and a missing village name is no reason to reject a good fix. `point`
      // stays the machine-readable truth; this is the human-readable view of it.
      address: {
        state: { type: String },
        district: { type: String },
        city: { type: String },       // city / town / village
        pincode: { type: String },
        country: { type: String },
        formatted: { type: String },  // full one-line address from the provider
        provider: { type: String },   // "google" | "nominatim" — which one answered
        resolvedAt: { type: Date },
      },
      capturedAt: { type: Date }, // when the coordinates were taken
      decidedAt: { type: Date },  // when allow/deny was last answered
    },

    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

// A consumer logs in by email OR phone; both are unique when present (sparse so
// an account may carry only one of them).
consumerSchema.index({ email: 1 }, { unique: true, sparse: true });
consumerSchema.index({ phone: 1 }, { unique: true, sparse: true });

// Nearest-warehouse / proximity lookups against the stored consent point.
// 2dsphere skips documents with no point, so accounts that never answered
// or denied simply are not in the index.
consumerSchema.index({ "locationAccess.point": "2dsphere" });

module.exports = mongoose.model("Consumer", consumerSchema);