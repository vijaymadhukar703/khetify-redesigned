const mongoose = require("mongoose");
const { generateUniqueProductCode } = require("../../services/productCodeService");

// ================= VARIANT SCHEMA =================

const variantSchema = new mongoose.Schema({
  // Human-readable combination label, e.g. "500g / Red"
  label: { type: String, required: true },

  // Key→value map of attribute names to their chosen values,
  // e.g. { Size: "500g", Color: "Red" }
  attributes: { type: Map, of: String, default: {} },

  sku:   { type: String },
  mrp:   { type: Number },
  stock: { type: Number, default: 0 },

  // Relative path to the variant-specific image, e.g. "uploads/products/<file>"
  // UNCHANGED and still the field the COMPANY upload flow writes and reads.
  image: { type: String },

  // ADDITIONAL images for the same variant — the seller's My Products form
  // allows several per variant, the company form still sends exactly one.
  //
  // ADDITIVE: `image` above is untouched, so every company product and every
  // already-saved variant behaves exactly as before. Where both are present,
  // `image` holds images[0] so anything reading the single field (the
  // storefront's colour swatches, for one) keeps working unchanged.
  images: { type: [String], default: [] },
});

// ================= PRODUCT SCHEMA =================

const productSchema = new mongoose.Schema(
  {
    // Company Reference.
    //
    // CONDITIONALLY required: a company product must always carry its company,
    // exactly as before. A SELLER-OWNED product ("My Products") has no company
    // at all — the seller uploaded it themselves — so the requirement is lifted
    // for those rows only. Behaviour for every company product is unchanged.
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: function () {
        return this.ownerType !== "seller";
      },
    },

    // ── OWNERSHIP ─────────────────────────────────────────────────────────
    // WHO owns this product row. Seller-uploaded products ("My Products") live
    // in this SAME collection, distinguished only by these two fields — 22
    // models ref "Product" (Inventory, Order, PickList, Shipment,
    // SellerListing…), so a separate collection would break marketplace
    // publish, ordering, stock-cut and shipment alike.
    //
    // ADDITIVE and defaulted: every pre-existing product reads as a company
    // product. IMPORTANT — company-side queries must NOT filter on
    // `ownerType: "company"`: legacy documents do not carry the field at all and
    // .lean() applies no schema default, so such a filter would make every old
    // product disappear. The company side is already scoped by `companyId`,
    // which is sufficient. The SELLER side always filters on BOTH
    // `ownerType: "seller"` AND `sellerId`.
    ownerType: {
      type: String,
      enum: ["company", "seller"],
      default: "company",
    },

    // The owning seller — set only when ownerType is "seller", null otherwise.
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      default: null,
      index: true,
    },

    // Human-readable product identifier: 3 letters from the product name + 3
    // random digits (e.g. "Premium Basmati Rice" → PRE482). Generated on the
    // SERVER by the pre("validate") hook below — never accepted from a client,
    // and never regenerated on edit. `sparse` so the unique index can be built
    // on a collection whose legacy rows have no code yet (run
    // scripts/backfillProductCode.js to fill them in).
    product_code: {
      type: String,
      required: true,
      unique: true,   // creates the unique index — this is the "indexed" bit
      sparse: true,
      uppercase: true,
      trim: true,
    },

    // Basic Product Info
    productName: { type: String },
    brandName:   { type: String },
    /**
     * SELLER-SIDE ONLY, optional. Picked from the horticulture catalogue on the
     * seller's upload form (khetifyApp/src/lib/horticultureProducts.js). Company
     * products never set it and stay null — nothing on that side reads it.
     */
    horticultureProduct: { type: String, default: null },
    category: { type: String },
    unitType: { type: String },
    unit: { type: String },
    // Numeric value that goes WITH `unit` — e.g. unit "Kilograms" + unitValue 50
    // reads as "50 kg" (net content of one retail unit). Captured by the dynamic
    // field that the Upload Product page renders once a unit is picked.
    unitValue: { type: Number },
    description: { type: String },

    // SKU & Codes
    skuNumber: { type: String },
    hsnCode: { type: String },
    batchNumber: { type: String },
    manufactureLicenseNo: { type: String },

    // ── MANUFACTURED BY ANOTHER COMPANY ──────────────────────────────────
    // Set when the uploading company did not make this product itself (the
    // "Is this product from another company?" tick on the upload form). The two
    // name/address fields are only meaningful while this is true, and are
    // cleared server-side whenever it is false, so an unticked product can never
    // keep a stale third-party name from an earlier attempt.
    // ADDITIVE and optional — every existing product keeps this false/unset and
    // is completely unaffected.
    isThirdPartyProduct: { type: Boolean, default: false },
    manufacturerCompanyName: { type: String },
    manufacturerCompanyAddress: { type: String },

    // When true, every physical unit gets its own serialized barcode
    // (UnitSerial). When false, stock is tracked purely by quantity (FEFO).
    trackSerial: { type: Boolean, default: false },

    // Pricing
    costPrice: { type: Number },
    mrp: { type: Number },
    gstPercentage: { type: Number, default: 0 },

    // Stock & Order
    availableStock: { type: Number },
    minimumOrderQuantity: { type: Number },
    monthlyProductionCapacity: { type: Number },

    // Origin & Packaging
    // Fixed to India on the upload form — the field is rendered read-only there
    // and the create path forces this value, so it can be neither blank nor
    // spoofed. Kept as a String (not an enum) so existing products that carry
    // another country still read and save exactly as they did.
    countryOrigin: { type: String, default: "India" },
    packagingType: { type: String },
    dispatchLocation: { type: String },

    // Bulk packaging — how the product ships in bulk and how many base units
    // each bulk package holds. e.g. type "Carton", capacity 50 → 1 carton = 50 units.
    bulkPackaging: {
      type: { type: String },        // Carton | Bag | Box | Sack | Drum | Other | <custom>
      customType: { type: String },  // free text when type === "Other"
      capacity: { type: Number },    // base units per package
      capacityUnit: { type: String, default: "units" },
    },

    // Dates
    manufacturingDate: { type: Date },
    expiryDate: { type: Date },
    /**
     * SHELF LIFE — captured in DAYS.
     *
     * `shelfLifeDays` is the structured value and the single source of truth:
     * a whole number of days, which is what the upload form now asks for.
     *
     * `shelfLife` is the human-readable string that has always lived here and is
     * what the catalog and edit screens already render ("365 Days"). It is NOT a
     * second input — the server derives it from `shelfLifeDays` on write, so the
     * two can never disagree, and every screen that already reads `shelfLife`
     * keeps working untouched. Legacy rows saved as "24 Months" still read fine,
     * which is why this stays a String rather than becoming a Number.
     */
    shelfLifeDays: { type: Number },
    shelfLife: { type: String },

    // Quality & Storage
    qualityGrade: { type: String },
    storageInstructions: { type: String },
    // Dosage / method of application — surfaced on the storefront product page.
    usageInstructions: { type: String },
    safetyInstructions: { type: String },

    // Images
    productImages: [
      {
        type: String,
      },
    ],

    // ================= VARIANT TYPE =================

    variantType: {
      type: String,
      enum: ["single", "multiple"],
      default: "single",
    },

    // ===== SINGLE PRODUCT DETAILS =====

    price: { type: Number },

    // Packed product dimensions (L × W × H) expressed in `dimensionUnit`.
    length: { type: Number },

    width: { type: Number },

    height: { type: Number },

    // Unit for length/width/height. No schema `enum` on purpose: the edit form
    // re-posts every field, and an empty string would then hard-fail validation
    // on an unrelated update. The allowed list is enforced in the controller
    // (normalizeMeasurementUnits), which drops anything unrecognised.
    dimensionUnit: { type: String, default: "cm" },

    // GROSS (packed) weight used for shipping — the NET content of one unit is
    // `unitValue` + `unit`. Two different numbers; neither replaces the other.
    weight: { type: Number },

    weightUnit: { type: String, default: "kg" },

    // ===== MULTIPLE VARIANTS =====

    variants: [variantSchema],

    // ================= STATUS =================

    productStatus: {
      type: String,
      enum: ["active", "inactive"],
      default: "inactive",
    },

    productUpload: {
      type: String,
      enum: ["saveDraft", "uploaded"],
      default: "saveDraft",
    },
  },
  { timestamps: true },
);

// ================= PRODUCT CODE =================
// Assign a unique product_code on the way in. Sitting on the schema (rather
// than in the controller) means every DOCUMENT create path — the API, scripts,
// tests, plain Model.create() — gets a code, which is what makes
// `required: true` safe. Raw upserts bypass document middleware, so those set
// the code themselves via $setOnInsert (see scripts/seedProducts.js).
//
// It only fires when the code is missing, so editing a product never changes
// its code. findByIdAndUpdate() bypasses document middleware entirely, so an
// update can't accidentally rewrite it either.
// (Async hook — mongoose awaits the returned promise; a rejection aborts the
// save, so there is no `next` callback to call.)
productSchema.pre("validate", async function assignProductCode() {
  if (!this.product_code) {
    // this.constructor === the Product model; passing it avoids a circular
    // require between this model and productCodeService.
    this.product_code = await generateUniqueProductCode(this.productName, {
      Model: this.constructor,
    });
  }
});

module.exports = mongoose.model("Product", productSchema);