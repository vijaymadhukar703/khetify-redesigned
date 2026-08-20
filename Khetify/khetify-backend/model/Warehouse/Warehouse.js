const mongoose = require("mongoose");

const warehouseSchema = new mongoose.Schema(
  {
    // Ownership is mutually exclusive: a warehouse belongs to EITHER a company
    // OR a seller (enforced by the pre-validate hook below). companyId is no
    // longer required so a seller-owned warehouse can exist; every existing
    // company warehouse keeps its companyId, so this is non-breaking.
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: false,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      default: null,
    },
    name: { type: String, required: true },
    code: { type: String },
    address: {
      line1: String,
      city: String,
      district: String,
      state: String,
      pincode: String,
    },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
    },
    // OPTIONAL Google Maps share link for the warehouse, captured on the
    // Add Warehouse form. Purely informational — a human-openable pointer to
    // the site. `location` above remains the machine-readable geo field used
    // by the 2dsphere index, the nearest-warehouse lookup and the delivery
    // geofence, and is unchanged.
    mapsUrl: { type: String, trim: true },
    capacityUnits: { type: Number },
    // Radius (metres) around `location` within which a delivery may be
    // verified — the geofence check during shipment receipt.
    geofenceRadiusM: { type: Number, default: 300 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

warehouseSchema.index({ location: "2dsphere" }); // nearest-warehouse allocation
warehouseSchema.index({ sellerId: 1 }); // seller-scoped warehouse lookups

// Exactly one owner: a warehouse is company-owned XOR seller-owned, never both
// and never neither. (Sync pre-validate hook — throw to fail validation; the
// modern Mongoose style avoids the `next` callback.)
warehouseSchema.pre("validate", function () {
  const hasCompany = !!this.companyId;
  const hasSeller = !!this.sellerId;
  if (hasCompany === hasSeller) {
    throw new Error("A warehouse must belong to exactly one of a company or a seller");
  }
});

module.exports = mongoose.model("Warehouse", warehouseSchema);