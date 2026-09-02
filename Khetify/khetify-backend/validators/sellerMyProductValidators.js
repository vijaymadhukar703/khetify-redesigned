const { z } = require("zod");

/**
 * "My Products" — the seller's OWN catalog and their own opening stock.
 *
 * NOTE: middlewares/validate.js writes the parsed result back onto req.body and
 * zod strips unknown keys, so every field the controller reads must appear
 * below. Anything not listed here simply never reaches the controller, which is
 * the point: a seller cannot smuggle `companyId`, `ownerType`, `sellerId`,
 * `product_code` or `productStatus` into a create/update by hand.
 */

const objectId = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

// A blank optional text field is normal on this form (the seller fills in what
// they know), so "" is accepted everywhere and simply stored as empty.
const text = (max = 255) => z.string().trim().max(max).optional();

// Numbers arrive as strings from the form. "" → undefined (field left unset /
// existing value preserved), never a validation failure on an unrelated edit.
const optionalNumber = (label) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number({ invalid_type_error: `${label} must be a number` }).nonnegative(`${label} cannot be negative`).optional()
  );

const optionalDate = (label) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.date({ invalid_type_error: `${label} is not a valid date` }).optional()
  );

/* Same result as optionalDate — a real Date — but a blank/missing value is a
   stated error rather than an absent field, so the caller is told WHICH date is
   missing instead of a bare "Invalid date".

   Deliberately NOT z.coerce.date({ required_error }): coercion runs
   `new Date(undefined)` FIRST, so a missing value arrives at validation as an
   Invalid Date and is reported as a bad date — required_error and
   invalid_type_error are never consulted, and an errorMap sees the coerced
   value rather than what was sent. The emptiness has to be judged before any
   coercion happens, which is what this does. */
const requiredDate = (label) =>
  z
    .any()
    .superRefine((v, ctx) => {
      if (v === "" || v === null || v === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is required` });
        return;
      }
      if (Number.isNaN(new Date(v).getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is not a valid date` });
      }
    })
    .transform((v) => new Date(v));

/**
 * ONE VARIANT ROW of a multi-variant product.
 *
 * `stock` IS DELIBERATELY ABSENT and is not accepted from the client. A
 * seller's stock has exactly ONE door — My Products → Stock → Add stock, which
 * writes a real Inventory lot with a lot number, dates and a ledger row. A
 * quantity typed on the product form would be a SECOND, parallel number that
 * nothing reconciles, and the two would drift apart from the first sale. Every
 * variant therefore starts at the schema default of 0 and only the stock flow
 * moves it. The form enforces the same rule by rendering that cell read-only.
 */
const variantBody = z.object({
  label: z.string({ required_error: "Variant label is required" }).trim().min(1).max(200),
  // { "Size": "500g", "Color": "Red" } — mirrors the Map on the product schema.
  attributes: z.record(z.string().trim().max(60)).optional(),
  sku: z.string().trim().max(80).optional(),
  mrp: optionalNumber("Variant MRP"),
  // The single image the storefront's colour swatch reads. Written by the
  // server as images[0]; kept in the schema so an edit can re-send it.
  image: z.string().trim().max(500).optional(),
  // Up to 5 photos per variant. Paths only — the FILES arrive separately
  // under the "variantImages" multipart field and are resolved into this
  // array by applyUploadedImages before validation runs.
  images: z.array(z.string().trim().max(500)).max(5).optional(),
});

// The catalog fields a seller may set on their own product. Deliberately a
// SUBSET of the product schema — the company-only blocks (the third-party
// manufacturer name/address, supply & logistics) are not part of this module.
const productFields = {
  brandName: text(120),
  // Optional free-form string rather than an enum: the horticulture catalogue
  // is expected to grow, and the frontend list is the single source of truth.
  horticultureProduct: text(200),
  category: text(120),
  unitType: text(60),
  unit: text(60),
  unitValue: optionalNumber("Unit value"),
  description: text(5000),
  skuNumber: text(80),
  hsnCode: text(20),
  batchNumber: text(80),
  packagingType: text(80),
  countryOrigin: text(80),
  qualityGrade: text(80),
  storageInstructions: text(2000),
  usageInstructions: text(2000),
  safetyInstructions: text(2000),
  costPrice: optionalNumber("Cost price"),
  mrp: optionalNumber("MRP"),
  price: optionalNumber("Price"),
  gstPercentage: optionalNumber("GST percentage"),
  minimumOrderQuantity: optionalNumber("Minimum order quantity"),
  shelfLifeDays: optionalNumber("Shelf life"),
  manufacturingDate: optionalDate("Manufacturing date"),
  expiryDate: optionalDate("Expiry date"),
  length: optionalNumber("Length"),
  width: optionalNumber("Width"),
  height: optionalNumber("Height"),
  dimensionUnit: text(10),
  weight: optionalNumber("Weight"),
  weightUnit: text(10),
  productImages: z.array(z.string().trim().max(500)).max(10).optional(),
  // Optional for a seller: they are usually reselling, not manufacturing, so a
  // state licence number may not exist. (The company form requires it.)
  manufactureLicenseNo: text(40),
  // Multi-variant products. `variantType` is NOT accepted — the controller
  // derives it from this array, so the flag and the list can never disagree.
  variants: z.array(variantBody).max(100).optional(),
};

/**
 * SHELF LIFE IS REQUIRED ON CREATE — seller products only; the company
 * validator is untouched.
 *
 * Add Stock derives every lot's expiry date from this number. A product created
 * without one produces lots with no expiry, and from then on the Stock tab's
 * Expiring/Expired filters and FEFO picking are both blind to that stock. For
 * agricultural inputs that is not a state a product should be allowed to exist
 * in, so it is refused at the door rather than discovered later.
 *
 * Whole days, greater than zero — the same shape the form enforces.
 */
const requiredShelfLifeDays = z.preprocess(
  (v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    // Coerced HERE rather than with z.coerce.number(), which turns undefined
    // into NaN and would report a MISSING field as a type error ("must be a
    // number") instead of "is required". Unparseable input is passed through
    // untouched so it still fails as the wrong type.
    const n = Number(v);
    return Number.isNaN(n) ? v : n;
  },
  z
    .number({
      required_error: "Shelf life (days) is required",
      invalid_type_error: "Shelf life must be a number of days",
    })
    .int("Shelf life must be a whole number of days")
    .positive("Shelf life must be greater than zero")
);

const createMyProductBody = z.object({
  productName: z
    .string({ required_error: "Product name is required" })
    .trim()
    .min(1, "Product name is required")
    .max(200),
  ...productFields,
  // Overrides the optional entry in productFields — required on CREATE only.
  // The UPDATE body keeps it optional: an edit that omits the field leaves the
  // stored value alone rather than wiping it.
  shelfLifeDays: requiredShelfLifeDays,
  // The Active toggle on the upload form.
  productStatus: z.enum(["active", "inactive"]).optional(),
});

// Every field optional on edit — the form re-posts what it holds, and a
// partially filled product must stay saveable.
const updateMyProductBody = z.object({
  productName: z.string().trim().min(1, "Product name cannot be blank").max(200).optional(),
  ...productFields,
  // The seller's own product may be taken off/put back on their own listings.
  productStatus: z.enum(["active", "inactive"]).optional(),
});

/** POST /stock — the seller's own opening stock for one of their products. */
const addMyProductStockBody = z.object({
  productId: objectId,
  warehouseId: objectId,
  // WHICH variant this stock is. Required by the service whenever the product
  // actually has variants — see addSellerOwnStock.
  variantSku: z.string().trim().max(120).optional(),
  // Blank → the service mints MYP-<6 chars>.
  lotNumber: z.string().trim().max(120).optional(),
  mfgDate: optionalDate("Manufacturing date"),
  /* REQUIRED, unlike everywhere else this field appears. The expiry used to be
     derived from the product's shelf life when it was left out; it no longer is
     (see addSellerOwnStock), so an omitted expiry would mean a lot with NO
     expiry — invisible to the Expiring/Expired filters and to FEFO picking.
     The seller reads it off the pack and sends it. */
  expiryDate: requiredDate("Expiry date"),
  qty: z.coerce
    .number({ required_error: "Quantity is required", invalid_type_error: "Quantity must be a number" })
    .positive("Quantity must be greater than zero"),
  lowStockThreshold: optionalNumber("Low stock threshold"),
});

module.exports = { createMyProductBody, updateMyProductBody, addMyProductStockBody };
