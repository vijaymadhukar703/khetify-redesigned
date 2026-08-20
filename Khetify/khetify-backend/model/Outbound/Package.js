const mongoose = require("mongoose");

/**
 * A packed carton for an order. Each scanned serial is verified to belong to
 * the order's allocation before it goes in (mis-pick guard). packageNumber
 * doubles as the carton barcode.
 */
const packageItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    qty: { type: Number, required: true },
    serials: { type: [String], default: [] },
  },
  { _id: false }
);

const packageSchema = new mongoose.Schema(
  {
    // OWNERSHIP — additive, and the same pattern UnitSerial and Inventory
    // already use: `ownerType`/`ownerId` name the true owner while `companyId`
    // stays as it was.
    //
    // `ownerType` DEFAULTS to "company", so every existing package row and
    // every package the company packs is unchanged — company code neither sets
    // nor reads these fields, and its queries keep matching exactly what they
    // matched before.
    //
    // `companyId` remains REQUIRED for company packages. It is optional only
    // for a seller package, because a seller warehouse packs a carton for its
    // own customer: there is no company in that transaction, and inventing one
    // would put a company's id on a document it does not own. (This differs
    // from UnitSerial, where companyId is genuinely meaningful — those units
    // were minted by a company and merely re-owned to the seller on transfer.)
    ownerType: { type: String, enum: ["company", "seller"], default: "company", index: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: function () { return this.ownerType !== "seller"; },
    },
    // Set for customer-order packages (unchanged). Null for seller-supply
    // packages, which carry refType/refId instead.
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    // Polymorphic source: a customer Order (default) or a seller SupplyOrder.
    refType: { type: String, enum: ["Order", "SupplyOrder"], default: "Order" },
    refId: { type: mongoose.Schema.Types.ObjectId },
    packageNumber: { type: String, required: true }, // PKG-YYYYMM-#### (= barcode)
    items: [packageItemSchema],
    weightKg: { type: Number },
    dims: { type: String }, // "LxWxH cm"
    status: { type: String, enum: ["packed", "shipped"], default: "packed" },
    packedBy: { type: mongoose.Schema.Types.ObjectId },
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", default: null },
  },
  { timestamps: true }
);

// UNCHANGED company indexes. A seller package has no companyId, so it does not
// participate in either of these — which is why the seller needs its own.
packageSchema.index({ companyId: 1, packageNumber: 1 }, { unique: true });
packageSchema.index({ companyId: 1, orderId: 1 });

// SELLER indexes. Partial, so they cover ONLY seller rows and cannot alter how
// the company indexes above behave. The unique one keeps package numbers unique
// per seller — without it, two sellers could mint the same PKG-… barcode, since
// their numbering is drawn from separate per-seller counters.
packageSchema.index(
  { ownerId: 1, packageNumber: 1 },
  { unique: true, partialFilterExpression: { ownerType: "seller" } }
);
packageSchema.index(
  { ownerType: 1, ownerId: 1, orderId: 1 },
  { partialFilterExpression: { ownerType: "seller" } }
);

module.exports = mongoose.model("Package", packageSchema);