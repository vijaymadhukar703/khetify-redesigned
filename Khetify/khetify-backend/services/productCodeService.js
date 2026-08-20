/**
 * productCodeService.js — generates the human-readable Product Code that every
 * company product carries (`product_code`).
 *
 * Format: <3 uppercase letters from the product name><3 random digits>
 *   "Premium Basmati Rice" → PRE482
 *   "Urea Fertilizer"      → URE105
 *
 * Spaces, digits and special characters are ignored when building the prefix,
 * so "10-26-26 NPK Mix" → "NPK" + 3 digits.
 *
 * Codes are ALWAYS generated on the server (never accepted from the client) and
 * are checked against the database before being handed out. The unique index on
 * Product.product_code is the final authority — callers that write concurrently
 * should still retry on an E11000 duplicate-key error (see productController).
 */

const mongoose = require("mongoose");

const NON_ALPHA = /[^A-Za-z]/g;
const PREFIX_LEN = 3;
const DIGIT_LEN = 3;
const PREFIX_PAD = "X";          // pads names with fewer than 3 letters ("Zn" → ZNX)
const FALLBACK_PREFIX = "PRD";   // name has no letters at all ("12-32-16" → PRD)
const MAX_RANDOM_ATTEMPTS = 25;  // random tries before falling back to a full sweep

// ---- in-process reservations -------------------------------------------------
// Between "generated" and "written to Mongo" a code is invisible to
// Model.exists(), so two concurrent creates in the same process (e.g. a
// Promise.all over 25 products with the same name) could draw the same code and
// one of them would hit the unique index. Remembering the codes we just handed
// out closes that window. Bounded, because a long-running server would
// otherwise grow this forever — by the time an entry is evicted the product has
// long since been persisted and the database check covers it.
// Cross-process races are still possible; the unique index catches those and
// the caller retries (see productController).
const RECENT_LIMIT = 2000;
const recentlyIssued = new Set();

function rememberIssued(code) {
  recentlyIssued.add(code);
  if (recentlyIssued.size > RECENT_LIMIT) {
    // Sets iterate in insertion order — evict the oldest entry.
    recentlyIssued.delete(recentlyIssued.values().next().value);
  }
  return code;
}

/**
 * First 3 alphabetic characters of the product name, uppercased.
 * Non-alphabetic characters are stripped before slicing.
 */
function buildPrefix(productName) {
  const letters = String(productName || "").replace(NON_ALPHA, "").toUpperCase();
  if (!letters) return FALLBACK_PREFIX;
  return (letters + PREFIX_PAD.repeat(PREFIX_LEN)).slice(0, PREFIX_LEN);
}

/** Zero-padded random digit string, e.g. 7 → "007". */
function randomDigits(len = DIGIT_LEN) {
  const max = 10 ** len;
  return String(Math.floor(Math.random() * max)).padStart(len, "0");
}

/** A syntactically valid code for this name — NOT checked for uniqueness. */
function buildProductCode(productName, digitLen = DIGIT_LEN) {
  return buildPrefix(productName) + randomDigits(digitLen);
}

/**
 * Generate a Product Code that is not already taken.
 *
 * @param {string} productName
 * @param {object} [opts]
 * @param {import("mongoose").Model} [opts.Model]  Product model (defaults to the
 *        registered "Product" model; pass `this.constructor` from a schema hook
 *        to avoid a circular require).
 * @param {Set<string>} [opts.reserved]  Codes handed out in this process but not
 *        yet persisted — used by the backfill script so a single run can't hand
 *        the same code to two products.
 * @returns {Promise<string>}
 */
async function generateUniqueProductCode(productName, opts = {}) {
  const Model = opts.Model || mongoose.model("Product");
  const reserved = opts.reserved instanceof Set ? opts.reserved : null;
  const prefix = buildPrefix(productName);

  // Claim the candidate SYNCHRONOUSLY (before the first await), otherwise two
  // concurrent callers both pass the check while the other is still awaiting the
  // database and end up with the same code. A candidate that turns out to be
  // taken stays claimed — it was unusable anyway.
  const isTaken = async (code) => {
    if (recentlyIssued.has(code)) return true;
    if (reserved && reserved.has(code)) return true;
    rememberIssued(code);
    return !!(await Model.exists({ product_code: code }));
  };

  // 1) Cheap path: random digits + duplicate check, retried on collision.
  for (let i = 0; i < MAX_RANDOM_ATTEMPTS; i++) {
    const code = prefix + randomDigits(DIGIT_LEN);
    if (!(await isTaken(code))) return code;
  }

  // 2) This prefix is crowded (up to 1000 slots). Sweep the whole space once and
  //    pick a free slot at random instead of gambling on more random draws.
  const rows = await Model.find({ product_code: new RegExp(`^${prefix}\\d{${DIGIT_LEN}}$`) })
    .select("product_code")
    .lean();
  const taken = new Set(rows.map((r) => r.product_code));
  recentlyIssued.forEach((c) => taken.add(c));
  if (reserved) reserved.forEach((c) => taken.add(c));

  const free = [];
  for (let n = 0; n < 10 ** DIGIT_LEN; n++) {
    const code = prefix + String(n).padStart(DIGIT_LEN, "0");
    if (!taken.has(code)) free.push(code);
  }
  // Draw-and-claim, synchronously, so a concurrent sweep can't take the same slot.
  while (free.length) {
    const [code] = free.splice(Math.floor(Math.random() * free.length), 1);
    if (!recentlyIssued.has(code)) return rememberIssued(code);
  }

  // 3) All 1000 slots for this prefix are used. Widen the numeric part rather
  //    than failing the product create outright.
  for (let i = 0; i < MAX_RANDOM_ATTEMPTS; i++) {
    const code = prefix + randomDigits(DIGIT_LEN + 1);
    if (!(await isTaken(code))) return code;
  }

  throw new Error(`Unable to generate a unique product code for prefix "${prefix}"`);
}

module.exports = {
  buildPrefix,
  randomDigits,
  buildProductCode,
  generateUniqueProductCode,
  // Test-only: the in-process reservation set outlives a database reset, which
  // would make code-specific assertions order-dependent.
  __resetIssuedCodes: () => recentlyIssued.clear(),
};
