/**
 * lotNumberService.js — the Khetify-generated lot number, and the registry that
 * keeps every issued lot number unique.
 *
 * Format:  KH-<COMPANY_CODE>-<PRODUCT_CODE>-<YYYY>-<MM>-<SERIAL>
 * Example: KH-BHO-PRE482-2026-07-0001
 *
 *   KH           fixed Khetify prefix
 *   COMPANY_CODE first 3 alphabetic characters of the company name, uppercase
 *   PRODUCT_CODE the product's STORED product_code (never re-derived here)
 *   YYYY / MM    year and 2-digit month the lot is created in
 *   SERIAL       running counter for this (company, product), zero-padded to 4
 *
 * The serial is a LIFETIME counter per (company, product): it does not reset in
 * January, and a deleted or cancelled lot never gives its number back — the
 * counter only ever moves forward. Year/month are display only.
 *
 * Everything is generated on the server; the client never supplies any part of a
 * generated number.
 */

const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const LotNumber = require("../model/Inventory/LotNumber");
const { nextSeq } = require("./counterService");

const SERIAL_PAD = 4;

// Exact operator-facing messages (asserted by tests — keep them verbatim).
const PRODUCT_CODE_MISSING =
  "Product code is missing. Please update the product before creating a lot.";
const COMPANY_NAME_MISSING =
  "Company name is missing. Please add your company name before creating a lot.";
// A composed (Enter-manually) number carries no serial, so the operator's own
// parts are the only thing making it unique. Nothing is ever appended to fix a
// clash — they are told to change a part.
const LOT_NUMBER_TAKEN =
  "This lot number already exists. Change one of the parts to make it unique.";

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * First 3 ALPHABETIC characters of the company name, uppercased. Spaces, digits
 * and special characters are ignored ("3M Agri Ltd" → "MAG"). A name with fewer
 * than 3 letters keeps what it has ("Zn Co" → "ZNC", "Ab" → "AB") — it is NOT
 * padded. Returns "" when the name has no letters at all, which the caller
 * turns into a validation error.
 */
function buildCompanyCode(companyName) {
  return String(companyName || "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, 3);
}

/** Counter key — scopes the running serial to (company, product). */
const serialKey = (productId) => `kh-lot-product-${productId}`;

/** The company's 3-letter code, or a 400 when the company name isn't set. */
async function companyCodeFor(companyId, session) {
  const company = await Company.findById(companyId)
    .select("companyInfo.companyName")
    .session(session || null);
  if (!company) throw httpErr("Company not found", 404);

  const code = buildCompanyCode(company.companyInfo?.companyName);
  if (!code) throw httpErr(COMPANY_NAME_MISSING, 400);
  return code;
}

/**
 * The product's STORED product_code. Deliberately read from the database and
 * never re-derived from the product name — a lot must carry the exact same code
 * the catalog shows.
 */
async function productCodeFor(companyId, productId, session) {
  const product = await Product.findOne({ _id: productId, companyId })
    .select("product_code")
    .session(session || null);
  if (!product) throw httpErr("Product not found", 404);

  const code = String(product.product_code || "").trim().toUpperCase();
  if (!code) throw httpErr(PRODUCT_CODE_MISSING, 400);
  return code;
}

/**
 * The NEXT lifetime serial for this (company, product).
 *
 * Deliberately the SAME counter generateKhetifyLotNumber uses, so a lot whose
 * leading parts were typed by hand and a fully Khetify-generated lot draw from
 * ONE sequence and can never mint the same number. Allocated through nextSeq,
 * which is atomic — pass the caller's `session` so it is allocated inside their
 * transaction and two concurrent creates get 0001 and 0002, never both 0001.
 *
 * A serial is never accepted from a client: it is the one part of a lot number
 * the system alone may decide.
 */
async function nextLotSerial(companyId, productId, session) {
  if (!productId) throw httpErr("A product is required to generate a lot number.", 400);
  return nextSeq(companyId, serialKey(productId), session);
}

/** The serial as it appears inside a lot number: zero-padded to SERIAL_PAD. */
const formatLotSerial = (serial) => String(serial).padStart(SERIAL_PAD, "0");

/* ---------- the generated number, as SEGMENTS ---------- */

const KHETIFY_PREFIX = "KH";
const BULK_PREFIX = "BP";
const INNER_PREFIX = "BPinner";
const SKU_PREFIX = "SKU";
/**
 * MINIMUM width for every generated range, not a fixed one.
 *
 * padStart never truncates, so a number wider than this prints at its own width.
 * That is why the two ends of a range legitimately differ — the start is always
 * the minimum, the end as wide as its largest member needs:
 *   2 main boxes → BP01~BP02      20 boxes in each → BPinner01~BPinner20
 *   600 units    → SKU01~SKU600
 *
 * The inner range spans ONE CARTON's boxes, not the lot's 40 — inner numbering
 * restarts in every carton, so those are the only inner numbers that exist. See
 * lotNumberSegmentService.packagingSpans.
 */
const GENERATED_DIGITS = 2;

/**
 * The Khetify shape expressed in the SAME segment vocabulary the operator's own
 * builder uses (services/lotNumberSegmentService.js):
 *
 *   KH-<COMPANY>-<PRODUCT>-<BP001~BPnnn>-<YYYY>-<MM>-<DD>-<SKU0001~SKUnnnn>
 *
 * Describing it this way is what makes a generated lot's box and unit IDs come
 * out right for free: the ranges collapse to a single member for one carton and
 * one unit, exactly as they do for a hand-built number, so both modes label
 * identically and there is no second code path to keep in step.
 *
 * The BULK segment is present only for a lot that is actually packed into boxes.
 * The date is the MANUFACTURING date — the lot's own date, not the moment the
 * record happened to be created — falling back to today when none is given.
 *
 * Pure: no database, no counter. The spans and the serial are supplied by the
 * caller, which is what keeps this free of a cycle with the segment service.
 */
function khetifyLotSegments({ companyCode, productCode, mfgDate, boxed = false, nested = false } = {}) {
  const d = mfgDate ? new Date(mfgDate) : new Date();
  const range = (key, prefix) => ({ key, type: "range", mode: "variable", prefix, digits: GENERATED_DIGITS });
  return [
    { key: "kh", type: "value", value: KHETIFY_PREFIX },
    { key: "company", type: "value", value: companyCode },
    { key: "product", type: "value", value: productCode },
    // Bulk = the MAIN boxes. On a three-level lot the inner boxes get their own
    // range straight after it, so the two levels stay distinct instead of being
    // multiplied into one span.
    ...(boxed ? [range("bulk", BULK_PREFIX)] : []),
    ...(boxed && nested ? [{ ...range("inner", INNER_PREFIX), keepCase: true }] : []),
    { key: "year", type: "value", value: String(d.getFullYear()) },
    { key: "month", type: "value", value: String(d.getMonth() + 1).padStart(2, "0") },
    { key: "date", type: "value", value: String(d.getDate()).padStart(2, "0") },
    range("sku", SKU_PREFIX),
  ];
}

/**
 * Everything needed to build the next Khetify lot number for (company, product):
 * its segments, and the serial that closes it.
 *
 * THE SERIAL IS KEPT. It is what guarantees the number is unique, and this mode
 * cannot fall back on the operator to resolve a clash: every segment is derived,
 * so two production runs of the same product, on the same day, with the same box
 * count and quantity would have no lever to differentiate. (The hand-built mode
 * has no serial precisely because there the operator CAN change a part.)
 *
 * It comes from the atomic Counter (findOneAndUpdate $inc + upsert on a unique
 * (companyId, key) index), so two concurrent creates get 0001 and 0002 — never
 * the same number. Pass the caller's `session` to allocate it inside their
 * transaction.
 *
 * The caller assembles the string, because only it knows the box count and the
 * quantity the two ranges span (services/lotService.js autoLotNumber).
 */
async function generateKhetifyLotNumber(companyId, { productId, mfgDate, boxed = false, nested = false, session } = {}) {
  if (!productId) throw httpErr("A product is required to generate a lot number.", 400);

  const companyCode = await companyCodeFor(companyId, session);
  const productCode = await productCodeFor(companyId, productId, session);

  // Lifetime running serial for this (company, product) — never reset by period.
  const serial = await nextLotSerial(companyId, productId, session);

  return {
    segments: khetifyLotSegments({ companyCode, productCode, mfgDate, boxed, nested }),
    serial,
  };
}

/**
 * Claim a lot number in the registry. Idempotent for the SAME product (a
 * re-receive into an existing lot is one lot topped up, not a duplicate); throws
 * 409 when the number is already held by a DIFFERENT product.
 *
 * The unique index on (companyId, lotNumber) is what actually decides the race:
 * two concurrent claims both upsert, one wins, and the loser re-reads the
 * winner's row and is judged against it.
 */
async function registerLotNumber({ companyId, productId, lotNumber, source = "manual", serial = null, requireNew = false, session }) {
  const lot = String(lotNumber || "").trim().toUpperCase();
  if (!lot) throw httpErr("A lot number is required", 400);

  // STRICT CLAIM, for a number that carries no serial of its own: the number
  // must be genuinely new, so re-using it is refused even for the same product.
  //
  // An insert (not an upsert) is what makes this safe under concurrency — the
  // unique index decides the race, so of two operators composing the same parts
  // at the same instant exactly one is written and the other is told to change
  // a part. A pre-read could not promise that.
  if (requireNew) {
    try {
      await LotNumber.create([{ companyId, lotNumber: lot, productId, source, serial }], {
        session: session || undefined,
      });
    } catch (err) {
      if (err?.code === 11000) throw httpErr(LOT_NUMBER_TAKEN, 409);
      throw err;
    }
    return lot;
  }

  try {
    await LotNumber.updateOne(
      { companyId, lotNumber: lot },
      { $setOnInsert: { companyId, lotNumber: lot, productId, source, serial } },
      { upsert: true, session: session || undefined }
    );
  } catch (err) {
    // A concurrent claim inserted first — not an error by itself; the ownership
    // check below decides whether this caller may use the number.
    if (err?.code !== 11000) throw err;
  }

  const row = await LotNumber.findOne({ companyId, lotNumber: lot })
    .select("productId")
    .session(session || null);
  if (row && String(row.productId) !== String(productId)) {
    throw httpErr(`Lot number ${lot} is already used by another product.`, 409);
  }
  return lot;
}

module.exports = {
  buildCompanyCode,
  khetifyLotSegments,
  generateKhetifyLotNumber,
  nextLotSerial,
  formatLotSerial,
  registerLotNumber,
  serialKey,
  PRODUCT_CODE_MISSING,
  COMPANY_NAME_MISSING,
  LOT_NUMBER_TAKEN,
};