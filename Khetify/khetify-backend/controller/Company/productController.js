const Product = require("../../model/Company/productModel");
const Company = require("../../model/Company/Company");
const mongoose = require("mongoose");
const inventoryService = require("../../services/inventoryService"); // ← NEW
const { generateUniqueProductCode } = require("../../services/productCodeService");

// Escape user input before it goes into a RegExp so a stray "(" or "*" in the
// search box can't blow up (or widen) the query.
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A code collision between two concurrent creates is caught by the unique
// index; retry a few times with fresh random digits before giving up.
const PRODUCT_CODE_RETRIES = 5;
const isProductCodeDuplicate = (err) =>
  err?.code === 11000 && !!(err.keyPattern?.product_code || err.keyValue?.product_code);

/* ================= PAYLOAD NORMALIZATION =================
   Both create and update receive multipart form-data, where EVERY field arrives
   as a string (including "" for blanks) and objects/arrays arrive JSON-encoded.
   These helpers are shared by the two paths so the write flow behaves the same
   way on either route. */

// Every numeric path on the product schema.
const NUMBER_FIELDS = [
  "mrp", "costPrice", "gstPercentage",
  "price", "length", "width", "height", "weight",
  "availableStock", "minimumOrderQuantity", "monthlyProductionCapacity",
  "unitValue", "shelfLifeDays",
];
const DATE_FIELDS = ["manufacturingDate", "expiryDate"];

// Whitelists for the measurement unit selects. Enforced here rather than as a
// schema enum so a stray/blank value is quietly dropped (leaving the schema
// default or the existing value) instead of failing an unrelated update.
const MEASUREMENT_UNITS = {
  dimensionUnit: ["mm", "cm", "m", "inch", "ft"],
  weightUnit: ["g", "kg", "MT"],
};

// "" / null → drop the key (create: field stays unset, update: existing value is
// preserved). Numeric strings → real numbers. Garbage → dropped, never a 500.
const coerceNumbers = (body) => {
  for (const k of NUMBER_FIELDS) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === "" || v === null) {
      delete body[k];
    } else if (typeof v === "string") {
      const n = Number(v.trim());
      if (Number.isFinite(n)) body[k] = n;
      else delete body[k];
    }
  }
};

const coerceDates = (body) => {
  for (const k of DATE_FIELDS) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === "" || v === null) {
      delete body[k];
    } else if (typeof v === "string") {
      const d = new Date(v);
      if (!isNaN(d.getTime())) body[k] = d;
      else delete body[k];
    }
  }
};

const normalizeMeasurementUnits = (body) => {
  for (const [k, allowed] of Object.entries(MEASUREMENT_UNITS)) {
    if (!(k in body)) continue;
    const v = String(body[k] ?? "").trim();
    if (!allowed.includes(v)) delete body[k];
    else body[k] = v;
  }
};

// Bulk packaging variant attributes: "Is there a variant of bulk packaging?".
// Each entry is { name, values[] } — e.g. { name: "Color", values: ["Red","Blue"] }.
// Mutates `body.bulkPackaging` in place and returns an error message (or null).
// `strict` is off for drafts, so a half-filled draft can still be parked.
const MAX_BULK_ATTRS = 10;
const MAX_BULK_ATTR_VALUES = 25;
const MAX_BULK_TEXT_LEN = 60;

const normalizeBulkVariants = (body, { strict = true } = {}) => {
  const bp = body.bulkPackaging;
  // Nothing to do when the field wasn't sent, or arrived as unparseable junk
  // (the caller already dropped/kept it in that case).
  if (!bp || typeof bp !== "object" || Array.isArray(bp)) return null;

  bp.hasVariants = bp.hasVariants === true || bp.hasVariants === "true";

  // "No" (or absent) → the attribute list is always emptied, so switching the
  // answer back can never leave orphaned attributes behind.
  if (!bp.hasVariants) {
    bp.variantAttributes = [];
    return null;
  }

  const raw = Array.isArray(bp.variantAttributes) ? bp.variantAttributes : [];
  const attrs = raw
    .filter((a) => a && typeof a === "object" && !Array.isArray(a))
    .map((a) => {
      const values = (Array.isArray(a.values) ? a.values : [])
        .map((v) => String(v ?? "").trim().slice(0, MAX_BULK_TEXT_LEN))
        .filter(Boolean);
      return {
        name: String(a.name ?? "").trim().slice(0, MAX_BULK_TEXT_LEN),
        // De-duplicate case-insensitively, keeping the first spelling.
        values: values
          .filter((v, i) => values.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i)
          .slice(0, MAX_BULK_ATTR_VALUES),
      };
    })
    .filter((a) => a.name && a.values.length)
    .slice(0, MAX_BULK_ATTRS);

  const names = attrs.map((a) => a.name.toLowerCase());
  if (new Set(names).size !== names.length) {
    return "Bulk packaging variant attributes must have unique names";
  }
  if (strict && !attrs.length) {
    return "Add at least one bulk packaging attribute with a name and one value, or answer No";
  }

  bp.variantAttributes = attrs;
  return null;
};

/* ================= IDENTIFICATION & TRACEABILITY =================
   Normalisation for the three Identification fields and for shelf life. Shared
   by create and update so the stored shape is the same on either route. */

// HSN is exactly EIGHT DIGITS. Anything else — letters, spaces, punctuation, a
// 6-digit code — is not a valid Indian HSN, so the value is normalised to its
// digits here and validated below rather than being silently stored malformed.
const HSN_LENGTH = 8;
const normalizeHsn = (body) => {
  if (!("hsnCode" in body)) return;
  const digits = String(body.hsnCode ?? "").replace(/\D/g, "");
  if (!digits) delete body.hsnCode;
  else body.hsnCode = digits;
};

/**
 * THE "MANUFACTURED BY ANOTHER COMPANY" BLOCK.
 *
 * The tick arrives from multipart form-data as the STRING "true"/"false", so it
 * is coerced to a real boolean first. When it is off, the name and address are
 * DELETED rather than merely ignored — otherwise unticking the box on a second
 * attempt would leave the previously typed company name sitting in the record,
 * silently attributing the product to a manufacturer the user just removed.
 */
const normalizeThirdParty = (body) => {
  if (!("isThirdPartyProduct" in body)) return;
  const v = body.isThirdPartyProduct;
  const on = v === true || v === "true" || v === "on" || v === "1" || v === 1;
  body.isThirdPartyProduct = on;
  if (!on) {
    body.manufacturerCompanyName = "";
    body.manufacturerCompanyAddress = "";
  } else {
    if ("manufacturerCompanyName" in body) body.manufacturerCompanyName = String(body.manufacturerCompanyName ?? "").trim();
    if ("manufacturerCompanyAddress" in body) body.manufacturerCompanyAddress = String(body.manufacturerCompanyAddress ?? "").trim();
  }
};

/**
 * SHELF LIFE IS ENTERED IN DAYS, and the readable string is DERIVED here.
 *
 * The form sends `shelfLifeDays` only. The `shelfLife` string that the catalog
 * and edit screens already render is written from it, so there is exactly one
 * input and the two values can never drift apart. A request that sends only the
 * legacy string (an older client, or the edit form) is left completely alone.
 */
const deriveShelfLife = (body) => {
  const n = body.shelfLifeDays;
  if (typeof n !== "number" || !Number.isFinite(n)) return;
  body.shelfLife = `${n} Day${n === 1 ? "" : "s"}`;
};

/* ================= PAYLOAD VALIDATION =================
   Returns an error message string, or null when the payload is acceptable.
   `existing` lets an update validate against the merged (stored + incoming)
   picture rather than only the fields that happen to be in this request. */
const validateProductPayload = (body, { existing = {}, requireUnitValue = false, requireUpload = false } = {}) => {
  const pick = (k) => (k in body ? body[k] : existing?.[k]);
  const filled = (k) => String(pick(k) ?? "").trim() !== "";

  const negative = NUMBER_FIELDS.filter((k) => typeof body[k] === "number" && body[k] < 0);
  if (negative.length) {
    return `These values cannot be negative: ${negative.join(", ")}`;
  }

  // A unit of measurement without its value is meaningless ("Kilograms" of
  // what?). Only enforced on create so legacy products (unit saved before this
  // field existed) can still be edited.
  if (requireUnitValue) {
    const unit = pick("unit");
    const unitValue = Number(pick("unitValue"));
    if (unit && !(Number.isFinite(unitValue) && unitValue > 0)) {
      return "Please enter the measurement value for the selected unit of measurement";
    }
  }

  /* ── REQUIRED ON A REAL UPLOAD ──
     Gated behind `requireUpload`, which only the CREATE path sets and only for a
     real upload. Drafts stay deliberately lenient, and the UPDATE path never
     passes this flag, so editing an existing product is completely unaffected
     and a legacy product missing these values can still be saved. */
  if (requireUpload) {
    // Packaging & Measurement — all four.
    if (!filled("packagingType")) return "Packaging Type is required";
    if (!filled("unit")) return "Unit of Measurement is required";

    const dims = ["length", "width", "height"];
    const missingDim = dims.find((k) => !(Number(pick(k)) > 0));
    if (missingDim) return "Product Dimensions (length, width and height) are required and must be greater than zero";
    if (!(Number(pick("weight")) > 0)) return "Shipping Weight (Gross) is required and must be greater than zero";

    // Identification & Traceability.
    const hsn = String(pick("hsnCode") ?? "").trim();
    if (!hsn) return "HSN Code is required";
    if (!new RegExp(`^\\d{${HSN_LENGTH}}$`).test(hsn)) {
      return `HSN Code must be exactly ${HSN_LENGTH} digits`;
    }

    if (!filled("manufactureLicenseNo")) return "Manufacturer License No. is required";

    // The two extra fields are required ONLY while the box is ticked — which is
    // exactly how the form shows and hides them.
    if (pick("isThirdPartyProduct") === true) {
      if (!filled("manufacturerCompanyName")) return "Company Name is required for a product from another company";
      if (!filled("manufacturerCompanyAddress")) return "Company Address is required for a product from another company";
    }

    // Shelf life, in whole days.
    const days = Number(pick("shelfLifeDays"));
    if (!(Number.isFinite(days) && days > 0)) return "Shelf Life is required and must be a number of days greater than zero";
    if (!Number.isInteger(days)) return "Shelf Life must be a whole number of days";
  }

  return null;
};

/* ================= CREATE PRODUCT ================= */
exports.createProduct = async (req, res) => {
  try {
    const { companyId, variantType } = req.body;

    // ================= COMPANY CHECK =================
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // ================= IMAGE HANDLE =================
    // upload.fields() puts files in named buckets: req.files.productImages and
    // req.files.variantImages. Previously upload.array() gave a flat array.
    const productImageFiles = req.files?.productImages ?? [];
    if (productImageFiles.length > 0) {
      // Store a URL-safe relative path. file.path is an absolute filesystem path
      // (with backslashes on Windows) which breaks every downstream URL builder.
      // file.filename is the disk filename; the multer middleware places it in
      // uploads/products/, served by `app.use("/uploads", ...)`.
      req.body.productImages = productImageFiles.map((file) => `uploads/products/${file.filename}`);
    }

    // ================= NORMALIZE + VALIDATE =================
    // Blank numeric strings ("" from an untouched input) would otherwise reach
    // mongoose as a Number cast error → 500. Coerce first, validate second.
    coerceNumbers(req.body);
    coerceDates(req.body);
    normalizeMeasurementUnits(req.body);
    normalizeHsn(req.body);
    normalizeThirdParty(req.body);
    deriveShelfLife(req.body);

    // COUNTRY OF ORIGIN IS FIXED. The form renders it read-only, and the value
    // is set here as well so it can be neither left blank nor overridden by a
    // hand-made request.
    req.body.countryOrigin = "India";

    const isDraft = req.body.productUpload === "saveDraft";
    const invalid = validateProductPayload(req.body, {
      // Drafts are deliberately allowed to be incomplete.
      requireUnitValue: !isDraft,
      requireUpload: !isDraft,
    });
    if (invalid) {
      return res.status(400).json({ success: false, message: invalid });
    }

    // ================= NORMALIZE + VALIDATE =================
    // Blank numeric strings ("" from an untouched input) would otherwise reach
    // mongoose as a Number cast error → 500. Coerce first, validate second.
    coerceNumbers(req.body);
    coerceDates(req.body);
    normalizeMeasurementUnits(req.body);
    normalizeHsn(req.body);
    normalizeThirdParty(req.body);
    deriveShelfLife(req.body);

    // COUNTRY OF ORIGIN IS FIXED. The form renders it read-only, and the value
    // is set here as well so it can be neither left blank nor overridden by a
    // hand-made request.
    req.body.countryOrigin = "India";

    const isDraft = req.body.productUpload === "saveDraft";
    const invalid = validateProductPayload(req.body, {
      // Drafts are deliberately allowed to be incomplete.
      requireUnitValue: !isDraft,
      requireUpload: !isDraft,
    });
    if (invalid) {
      return res.status(400).json({ success: false, message: invalid });
    }

    // ================= VARIANT HANDLE =================
    if (req.body.variants && typeof req.body.variants === "string") {
      req.body.variants = JSON.parse(req.body.variants);
    }
    // Attach per-variant images. The frontend sends all variant image files under
    // the "variantImages" field (appended multiple times → multer collects them
    // as an ordered array), and stores each variant's position in that array as
    // `imageIndex`. Strip imageIndex before saving — it's a transport artefact.
    if (Array.isArray(req.body.variants) && req.body.variants.length > 0) {
      const variantFiles = req.files?.variantImages ?? [];
      req.body.variants = req.body.variants.map((v) => {
        const { imageIndex, ...rest } = v;
        const img =
          imageIndex != null && variantFiles[imageIndex]
            ? `uploads/products/${variantFiles[imageIndex].filename}`
            : undefined;
        return img != null ? { ...rest, image: img } : rest;
      });
    }
    // Bulk packaging may arrive as a JSON string from multipart form-data.
    if (req.body.bulkPackaging && typeof req.body.bulkPackaging === "string") {
      try { req.body.bulkPackaging = JSON.parse(req.body.bulkPackaging); } catch { /* ignore malformed */ }
    }
    const badBulkVariants = normalizeBulkVariants(req.body, {
      strict: req.body.productUpload !== "saveDraft",
    });
    if (badBulkVariants) {
      return res.status(400).json({ success: false, message: badBulkVariants });
    }
    if (variantType === "single") {
      req.body.variants = [];
    }
    if (variantType === "multiple") {
      req.body.price = undefined;
      req.body.length = undefined;
      req.body.width = undefined;
      req.body.height = undefined;
      req.body.weight = undefined;
    }

    // ================= CREATE PRODUCT =================
    // product_code is server-generated (schema pre-validate hook); anything the
    // client sends is dropped so a code can never be spoofed or reused.
    delete req.body.product_code;

    let newProduct;
    for (let attempt = 1; ; attempt++) {
      try {
        newProduct = new Product(req.body);
        await newProduct.save();
        break;
      } catch (err) {
        // Two products racing on the same random code: regenerate and retry.
        if (isProductCodeDuplicate(err) && attempt < PRODUCT_CODE_RETRIES) continue;
        throw err;
      }
    }

    // ================= NEW: SEED INVENTORY (IMS) =================
    // Create the company-owned inventory row so the marketplace has a
    // single source of truth for this product's stock from day one.
    try {
      const initialStock = Number(req.body.availableStock) || 0;
      const inv = await inventoryService.ensureInventory({
        productId: newProduct._id,
        ownerType: "company",
        ownerId: companyId,
        lowStockThreshold: Number(req.body.lowStockThreshold) || 0,
      });
      if (initialStock > 0) {
        await inventoryService.adjust({
          productId: newProduct._id,
          ownerType: "company",
          ownerId: companyId,
          delta: initialStock,
          channel: "online",
          note: "initial stock on product create",
          performedBy: companyId,
        });
      }
      void inv;
    } catch (invErr) {
      // Don't fail product creation if inventory seeding hiccups; just log it.
      console.error("Inventory seed warning:", invErr.message);
    }

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: newProduct,
    });
  } catch (error) {
    console.error("Create Product Error:", error);
    // Mongoose validation errors carry per-field detail — surface them instead
    // of a blank 500 so the upload form can tell the user what to fix.
    if (error?.name === "ValidationError") {
      const fields = Object.keys(error.errors || {});
      const detail = fields.map((f) => `${f}: ${error.errors[f].message}`).join(" · ");
      return res.status(400).json({
        success: false,
        message: detail || "Validation failed",
        fields,
      });
    }
    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

/* ================= GET SINGLE PRODUCT ================= */
exports.getSingleProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await Product.findById(productId).populate(
      "companyId",
      "companyInfo.companyName businessContact.businessEmail"
    );
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    console.error("Get Single Product Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

/* ================= GET ALL PRODUCTS ================= */
exports.getAllProducts = async (req, res) => {
  try {
    const { search, category } = req.query;
    // Always scope to the authenticated company (server-derived) — never trust
    // a client-supplied companyId (multi-tenancy invariant #1).
    const filter = { companyId: req.user.companyId };
    if (search && search.trim() !== "") {
      // Search matches the product NAME or the PRODUCT CODE (e.g. "PRE482").
      const rx = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [{ productName: rx }, { product_code: rx }];
    }
    if (category && category !== "undefined") {
      filter.category = category;
    }
    const products = await Product.find(filter)
      .populate("companyId", "companyInfo.companyName fullName")
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: products.length, data: products });
  } catch (error) {
    console.error("Get All Products Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ================= UPDATE PRODUCT ================= */
exports.updateProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }
    // The edit form loads the product with companyId POPULATED (an object), so
    // multipart form-data stringifies it to the literal "[object Object]".
    // Validate only a real ObjectId; anything else is dropped so the product
    // keeps its existing company (a product's owner never changes on edit).
    // Without this, Company.findById("[object Object]") throws a CastError on
    // path _id ("Invalid value for _id: [object Object]").
    if (req.body.companyId && mongoose.Types.ObjectId.isValid(req.body.companyId)) {
      const company = await Company.findById(req.body.companyId);
      if (!company) {
        return res.status(404).json({ success: false, message: "Company not found" });
      }
    } else {
      delete req.body.companyId;
    }
    const existingProduct = await Product.findById(productId);
    if (!existingProduct) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    // Multipart form-data sends every field as a string, including "" for blanks.
    // Mongoose Number/Date casts fail on "" → NaN/Invalid Date → 500 on validate.
    // Coerce empty strings to undefined so the existing value (or schema default)
    // is preserved; coerce numeric strings to numbers; coerce ISO date strings
    // to Date objects.
    // (Same NUMBER_FIELDS / DATE_FIELDS lists as create — see the shared
    // helpers at the top of this file.)
    coerceNumbers(req.body);
    coerceDates(req.body);
    normalizeMeasurementUnits(req.body);

    // Normalised on the same terms as create so the stored shape matches, but
    // WITHOUT `requireUpload`: an edit must never be rejected for a field the
    // product predates. Existing edit behaviour is unchanged.
    normalizeHsn(req.body);
    normalizeThirdParty(req.body);
    deriveShelfLife(req.body);
    const invalid = validateProductPayload(req.body, { existing: existingProduct });
    if (invalid) {
      return res.status(400).json({ success: false, message: invalid });
    }

    // Defensive: never let req.body overwrite the immutable identity fields.
    delete req.body._id;
    delete req.body.createdAt;
    delete req.body.updatedAt;
    // A product keeps its Product Code for life — editing (including renaming
    // the product) must never change it, and the client can't set it.
    delete req.body.product_code;

    // Self-heal: a legacy product that predates product_code (or slipped past
    // the backfill) gets one on its first edit. findByIdAndUpdate skips document
    // middleware, so the schema hook can't do this for us.
    if (!existingProduct.product_code) {
      req.body.product_code = await generateUniqueProductCode(
        existingProduct.productName || req.body.productName,
        { Model: Product },
      );
    }

    // ================= IMAGE HANDLE =================
    // The edit form is the single source of truth for the image set: it sends
    // the FULL list of existing images the user KEPT as `kept_images` (relative
    // paths), and appends any newly uploaded files separately. So the resulting
    // productImages = kept_images + new uploads. Removed images simply aren't in
    // kept_images, so they drop off. (The previous code read `removedImages`,
    // which the client never sends — that's why removed images persisted.)
    //
    // multer `.array("productImages")` puts text fields in req.body: a string
    // when one image is kept, an array when several, and undefined when none.
    let keptImages = req.body.kept_images;
    if (keptImages === undefined) keptImages = [];
    else if (!Array.isArray(keptImages)) keptImages = [keptImages];
    // Normalize each kept path to the clean "uploads/..." tail (tolerates legacy
    // absolute paths / backslashes that may have leaked into older records).
    let currentImages = keptImages
      .filter((p) => p != null && String(p).trim() !== "")
      .map((p) => {
        const s = String(p).replace(/\\/g, "/");
        const i = s.toLowerCase().indexOf("uploads/");
        return i >= 0 ? s.slice(i) : s;
      });

    const productImageFiles = req.files?.productImages ?? [];
    if (productImageFiles.length > 0) {
      // Keep S3 `location` if present, else the clean relative
      // "uploads/products/<filename>" path (never the absolute Windows
      // file.path, which breaks downstream URL builders).
      const newImages = productImageFiles.map((file) => file.location || `uploads/products/${file.filename}`);
      currentImages = [...currentImages, ...newImages];
    }
    req.body.productImages = currentImages;
    delete req.body.kept_images;
    delete req.body.removedImages;

    // ================= VARIANT HANDLE =================
    const { variantType } = req.body;
    // variants/bulkPackaging may arrive as a JSON string (good) OR — when the
    // form re-sends a live JS array/object — as multipart's "[object Object]"
    // junk. Parse what we can; if it's unparseable, DROP it so the existing
    // value is preserved instead of clobbering the field or throwing.
    if (req.body.variants && typeof req.body.variants === "string") {
      try { req.body.variants = JSON.parse(req.body.variants); }
      catch { delete req.body.variants; }
    }
    // Attach newly uploaded variant images (same mapping logic as createProduct).
    if (Array.isArray(req.body.variants) && req.body.variants.length > 0) {
      const variantFiles = req.files?.variantImages ?? [];
      req.body.variants = req.body.variants.map((v) => {
        const { imageIndex, ...rest } = v;
        const img =
          imageIndex != null && variantFiles[imageIndex]
            ? `uploads/products/${variantFiles[imageIndex].filename}`
            : undefined;
        return img != null ? { ...rest, image: img } : rest;
      });
    }
    if (req.body.bulkPackaging && typeof req.body.bulkPackaging === "string") {
      try { req.body.bulkPackaging = JSON.parse(req.body.bulkPackaging); }
      catch { delete req.body.bulkPackaging; }
    }

    // Strip subdocument _id fields. The frontend re-submits the existing product
    // (including variants[]._id) when editing; depending on serialization, those
    // _id values may arrive as JS objects (e.g. { $oid: "..." } from extended
    // JSON) which mongoose CANNOT cast to ObjectId, producing
    // "Invalid value for _id: [object Object]" on save. Stripping is safe — no
    // other entity in this codebase references a variant's or bulkPackaging's _id.
    if (Array.isArray(req.body.variants)) {
      req.body.variants = req.body.variants.map((v) => {
        if (v && typeof v === "object") {
          // Keep _id only if it's a valid 24-char hex string.
          if (v._id != null) {
            const s = String(v._id);
            if (!/^[0-9a-f]{24}$/i.test(s)) delete v._id;
            else v._id = s;
          }
        }
        return v;
      });
    }
    if (req.body.bulkPackaging && typeof req.body.bulkPackaging === "object") {
      if (req.body.bulkPackaging._id != null) {
        const s = String(req.body.bulkPackaging._id);
        if (!/^[0-9a-f]{24}$/i.test(s)) delete req.body.bulkPackaging._id;
        else req.body.bulkPackaging._id = s;
      }
    }
    // Sanitize the variant attribute list on the same terms as create. Not
    // strict: an edit that doesn't touch bulk packaging must never be rejected
    // for it (a form that can't send the object has it dropped above anyway).
    const badBulkVariants = normalizeBulkVariants(req.body, { strict: false });
    if (badBulkVariants) {
      return res.status(400).json({ success: false, message: badBulkVariants });
    }

    if (variantType === "single") {
      req.body.variants = [];
    }
    if (variantType === "multiple") {
      req.body.price = undefined;
      req.body.length = undefined;
      req.body.width = undefined;
      req.body.height = undefined;
      req.body.weight = undefined;
    }

    let updatedProduct;
    for (let attempt = 1; ; attempt++) {
      try {
        updatedProduct = await Product.findByIdAndUpdate(productId, req.body, {
          new: true,
          runValidators: true,
        });
        break;
      } catch (err) {
        // Only reachable on the self-heal path above (a normal edit never
        // touches product_code) — regenerate and retry.
        if (isProductCodeDuplicate(err) && attempt < PRODUCT_CODE_RETRIES) {
          req.body.product_code = await generateUniqueProductCode(
            existingProduct.productName || req.body.productName,
            { Model: Product },
          );
          continue;
        }
        throw err;
      }
    }
    res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: updatedProduct,
    });
  } catch (error) {
    console.error("Update Product Error:", error);
    // Mongoose validation errors carry per-field detail — surface them.
    if (error?.name === "ValidationError") {
      const fields = Object.keys(error.errors || {});
      const detail = fields.map((f) => `${f}: ${error.errors[f].message}`).join(" · ");
      return res.status(400).json({
        success: false,
        message: detail || "Validation failed",
        fields,
      });
    }
    if (error?.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: `Invalid value for ${error.path}: ${error.value}`,
      });
    }
    res.status(500).json({
      success: false,
      message: error?.message || "Server Error",
    });
  }
};

/* ================= DELETE PRODUCT ================= */
exports.deleteProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }
    const deletedProduct = await Product.findByIdAndDelete(productId);
    if (!deletedProduct) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
      data: deletedProduct,
    });
  } catch (error) {
    console.error("Delete Product Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};