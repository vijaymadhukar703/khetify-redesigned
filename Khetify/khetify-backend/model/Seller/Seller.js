const mongoose = require("mongoose");

/**
 * Seller — a downstream distributor with its OWN login/portal. A seller
 * receives bulk supply from a Company and resells onward. It is a first-class
 * principal: seller data is scoped by sellerId (= the seller's own _id),
 * exactly as company data is scoped by companyId.
 *
 * The inventory engine is already owner-polymorphic
 * ({ ownerType: "company" | "seller", ownerId }); later phases reuse it. This
 * model only establishes the seller principal + onboarding profile.
 *
 * Mirrors the essentials of model/Company/Company.js, seller-flavoured.
 */
const sellerSchema = new mongoose.Schema(
  {
    // ── BASIC AUTH ──
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    // Hashed password (bcrypt). Named passwordHash to make the at-rest form
    // explicit — never store or return a plaintext password.
    passwordHash: {
      type: String,
      required: true,
    },

    // STATUS ENUM (sellers start pending until the supplying company / admin
    // approves them — mirrors the company approval gate).
    status: {
      type: String,
      enum: ["pending", "active", "suspended"],
      default: "pending",
    },

    // ── SELLER INFO ──
    sellerInfo: {
      businessName: { type: String, trim: true },
      businessType: { type: String, trim: true },
      productCategories: [{ type: String, trim: true }],
      yearStarted: { type: String, trim: true },
    },

    // ── CONTACT ──
    contact: {
      address: {
        line: { type: String, trim: true },
        city: { type: String, trim: true },
        state: { type: String, trim: true },
        pincode: { type: String, trim: true },
      },
      ownerName: { type: String, trim: true },
      officialEmail: { type: String, trim: true },
      officialPhone: { type: String, trim: true },
    },

    // ── VERIFICATION / DOCUMENTS ──
    verification: {
      gstin: { type: String, trim: true },
      pan: { type: String, trim: true },
      udyam: { type: String, trim: true },

      // OTHER REGISTRATION LICENCES — number only; the certificate itself is
      // a SellerDocument row of the matching docType.
      //
      // They live here rather than on that row because a seller may record a
      // number WITHOUT uploading anything, and a SellerDocument cannot exist
      // without a file (`fileKey` is required, and stays that way).
      //
      // ADDITIVE and optional: every field defaults to undefined, so no
      // existing seller document changes and nothing that reads
      // `verification` today is affected.
      licences: {
        tan: { type: String, trim: true },
        gumasta: { type: String, trim: true },
        udyam: { type: String, trim: true },
        agriculture: { type: String, trim: true },
        horticulture: { type: String, trim: true },
      },

      docs: [{ type: String }], // uploaded document urls
    },

    // The company that supplies this seller. Set when the seller applies to a
    // company; the link is only live once that company approves it. Seller-side
    // stock/orders will reference this company's products.
    supplyingCompanyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },

    // ── COMPANY-LINK LIFECYCLE ──
    // A seller self-registers, applies to a supplying company, and that company
    // approves/rejects. Features that depend on the relationship are gated until
    // linkStatus === "approved" (see middlewares/requireApprovedSeller.js).
    linkStatus: {
      type: String,
      enum: ["unlinked", "pending", "approved", "rejected"],
      default: "unlinked",
    },
    linkRequestedAt: { type: Date },
    linkDecidedAt: { type: Date },
    linkRejectionReason: { type: String },
    // The one-time "Linked to Khetify" banner is shown until acknowledged. Reset
    // to false whenever the seller is (re-)approved after being unlinked.
    linkApprovalAcknowledged: { type: Boolean, default: false },

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

    // Placeholder for seller IMS settings — populated in later phases.
    imsSettings: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true },
);

sellerSchema.index({ email: 1 });

// Nearest-warehouse / proximity lookups against the stored consent point.
// 2dsphere skips documents with no point, so accounts that never answered
// or denied simply are not in the index.
sellerSchema.index({ "locationAccess.point": "2dsphere" });

module.exports = mongoose.model("Seller", sellerSchema);