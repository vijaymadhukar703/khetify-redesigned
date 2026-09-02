const Translation = require("../model/Master/Translation");
const { hashSource, normalizeSource } = require("../model/Master/Translation");

/**
 * 🌐 DYNAMIC-DATA LOCALISATION (customer storefront only).
 *
 * Static UI text lives in the frontend dictionary (i18n/shopTranslations.js).
 * This service handles text that lives in MONGO — categories, descriptions,
 * packaging, variant labels and anything else a company typed.
 *
 * ── THE TWO RULES THAT MAKE THIS SAFE ───────────────────────────────────────
 *
 * 1. IT NEVER BLOCKS A REQUEST. Every lookup is one indexed query against the
 *    cache. Nothing calls a translation API on the request path. A missing
 *    translation returns the ENGLISH ORIGINAL, so a cold cache, an empty
 *    database or a worker that has never run all render a working English
 *    storefront rather than blanks.
 *
 * 2. IT NEVER TRANSLATES WHAT IS NOT LANGUAGE. See TRANSLATABLE below: prices,
 *    quantities, SKU, HSN, GST, IDs, phone numbers and dates are excluded by
 *    name, and anything that looks like a code or a number is excluded by
 *    shape. A translated SKU is a wrong SKU.
 */

/** Languages the storefront may ask for. English is the source, never looked up. */
const SUPPORTED = new Set(["hi"]);

/**
 * FIELD RULES — which keys on a storefront payload carry human language.
 *
 * Deliberately a WHITELIST. A blacklist would silently start translating any
 * new field somebody adds to the product payload, which is how an SKU ends up
 * in Devanagari.
 *
 * `name` and `brand` are NOT here on purpose: a farmer recognises a product by
 * its brand name, and "Chia Seeds" → "चिया बीज" helps nobody while making the
 * product harder to search for. They stay in the language they were entered in.
 */
const TRANSLATABLE = new Set([
  "category",
  "description",
  "unit",
  "packagingType",
  "storageInstructions",
  "safetyInstructions",
  "usage",
  "usageInstructions",
  "howToUse",
  "features",
  "keyFeatures",
  "highlights",
  "label",        // variant label — "500g / Red"
  "countryOrigin",
]);

/**
 * Reject values that are not prose even when they sit on a translatable key.
 * Pure numbers, codes, measurements and anything very short or very long.
 */
function isTranslatableValue(v) {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s.length < 2 || s.length > 2000) return false;
  if (!/[A-Za-z]{2}/.test(s)) return false;      // no letters → a code or a number
  if (/^[\d\s.,%/-]+$/.test(s)) return false;     // "50", "2.5 / 3"
  if (/^[A-Z0-9-]{4,}$/.test(s)) return false;    // "SKU-4412", "HSN29054"
  return true;
}

/** Split a composite value ("500g / Red") so each part can hit the cache. */
const SPLIT_RX = /(\s*[/|·,-]\s*)/;

/* ────────────────────────────────────────────────────────────────────────────
 * READ PATH
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Look up many strings at once.
 *
 * @returns {Map<normalisedSource, translatedText>} — only strings that HAVE a
 *          translation. Everything else is simply absent, and callers fall back
 *          to English by leaving the original in place.
 */
async function lookup(strings, lang) {
  if (!SUPPORTED.has(lang) || !strings.length) return new Map();

  const byKey = new Map();
  for (const s of strings) {
    const norm = normalizeSource(s);
    if (norm) byKey.set(hashSource(s), norm);
  }
  if (!byKey.size) return new Map();

  const rows = await Translation.find({ key: { $in: [...byKey.keys()] }, lang })
    .select("key text source")
    .lean();

  const out = new Map();
  for (const r of rows) {
    // "pending" rows are placeholders a worker has not filled yet — treated
    // exactly like a miss, so the caller keeps the English original.
    if (r.text && r.source !== "pending") out.set(byKey.get(r.key), r.text);
  }
  return out;
}

/**
 * Record strings the storefront asked for but could not translate.
 *
 * FIRE AND FORGET — the caller does not await this and a failure is swallowed.
 * A translation worker reads these rows (source: "pending", ordered by hits) so
 * the most-viewed strings get translated first. `$setOnInsert` means an
 * existing human correction is never touched.
 */
function registerMissing(strings, lang) {
  if (!SUPPORTED.has(lang) || !strings.length) return;
  const ops = [];
  for (const s of strings) {
    const norm = normalizeSource(s);
    if (!norm) continue;
    ops.push({
      updateOne: {
        filter: { key: hashSource(s), lang },
        update: {
          $setOnInsert: { sourceText: String(s).trim(), source: "pending", text: "" },
          $inc: { hits: 1 },
        },
        upsert: true,
      },
    });
  }
  if (!ops.length) return;
  Translation.bulkWrite(ops, { ordered: false }).catch(() => {
    /* Best-effort telemetry. A failure here must never affect the response. */
  });
}

/** Every translatable string inside one payload object, including variants. */
function collect(obj, out = new Set()) {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      if (TRANSLATABLE.has(k)) v.forEach((x) => isTranslatableValue(x) && out.add(x));
      else v.forEach((x) => x && typeof x === "object" && collect(x, out));
      continue;
    }
    if (v && typeof v === "object") { collect(v, out); continue; }
    if (!TRANSLATABLE.has(k) || !isTranslatableValue(v)) continue;
    // Composite labels contribute their PARTS, so "500g / Red" is served by the
    // same "red" row every other product uses.
    if (k === "label" && SPLIT_RX.test(v)) {
      v.split(SPLIT_RX).forEach((part) => isTranslatableValue(part) && out.add(part));
    }
    out.add(v);
  }
  return out;
}

/** Rewrite one payload object in place-free fashion, using a lookup map. */
function apply(obj, map) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((x) => apply(x, map));

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      out[k] = TRANSLATABLE.has(k)
        ? v.map((x) => (isTranslatableValue(x) ? map.get(normalizeSource(x)) ?? x : x))
        : v.map((x) => (x && typeof x === "object" ? apply(x, map) : x));
      continue;
    }
    if (v && typeof v === "object") { out[k] = apply(v, map); continue; }
    if (TRANSLATABLE.has(k) && isTranslatableValue(v)) {
      if (k === "label" && SPLIT_RX.test(v)) {
        out[k] = v
          .split(SPLIT_RX)
          .map((p) => (SPLIT_RX.test(p) && !p.trim() ? p : map.get(normalizeSource(p)) ?? p))
          .join("");
      } else {
        out[k] = map.get(normalizeSource(v)) ?? v; // ?? → English fallback
      }
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * THE ONE FUNCTION CALLERS NEED.
 *
 * Translates a storefront payload (an object or an array of them) into `lang`,
 * leaving every untranslated string as the English original.
 *
 * Returns the payload UNCHANGED for English or an unsupported language, so the
 * English storefront runs exactly the code path it ran before this existed.
 */
async function localize(payload, lang) {
  if (!SUPPORTED.has(lang) || !payload) return payload;

  const list = Array.isArray(payload) ? payload : [payload];
  const strings = new Set();
  list.forEach((row) => collect(row, strings));
  if (!strings.size) return payload;

  const all = [...strings];
  const map = await lookup(all, lang);

  // Queue whatever we could not serve, ranked by demand. Not awaited.
  const missing = all.filter((s) => !map.has(normalizeSource(s)));
  if (missing.length) registerMissing(missing, lang);

  const done = list.map((row) => apply(row, map));
  return Array.isArray(payload) ? done : done[0];
}

/** Translate a bare list of strings (the category list is one). */
async function localizeStrings(values, lang) {
  if (!SUPPORTED.has(lang) || !Array.isArray(values) || !values.length) return values;
  const usable = values.filter(isTranslatableValue);
  const map = await lookup(usable, lang);
  const missing = usable.filter((s) => !map.has(normalizeSource(s)));
  if (missing.length) registerMissing(missing, lang);
  return values.map((v) => (isTranslatableValue(v) ? map.get(normalizeSource(v)) ?? v : v));
}

/* ────────────────────────────────────────────────────────────────────────────
 * SEARCH
 * ──────────────────────────────────────────────────────────────────────────*/

/** Cap how far one query can fan out, so `$or` cannot blow up. */
const MAX_EXPANSIONS = 3;

/**
 * TURN A NON-ENGLISH QUERY INTO THE ENGLISH IT STANDS FOR.
 *
 * The product data is English, so a Devanagari query can never regex-match it.
 * Reading the SAME cache backwards gives us the English source: a row with
 * text "बीज" has sourceText "seeds".
 *
 * This works for company-typed categories too — once "Bio Stimulants" has been
 * translated, searching its Hindi name finds it. A static dictionary never
 * could.
 *
 * ── PURELY ADDITIVE ─────────────────────────────────────────────────────────
 * Returns EXTRA terms, never a replacement. The caller keeps searching the
 * original string as well, so a query that works today returns exactly what it
 * returns today. Worst case this function contributes nothing.
 */
async function expandSearch(search, lang) {
  const q = String(search || "").trim();
  if (!SUPPORTED.has(lang) || q.length < 2) return [];

  const rx = new RegExp(escapeRx(q), "i");
  const rows = await Translation.find({ lang, text: rx, source: { $ne: "pending" } })
    .select("sourceText")
    .limit(MAX_EXPANSIONS * 4)
    .lean();

  const seen = new Set([q.toLowerCase()]);
  const out = [];
  for (const r of rows) {
    const src = (r.sourceText || "").trim();
    const k = src.toLowerCase();
    if (!src || seen.has(k)) continue;
    seen.add(k);
    out.push(src);
    if (out.length >= MAX_EXPANSIONS) break;
  }
  return out;
}

/** A user-typed search string is NOT a regex. */
function escapeRx(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Normalise whatever `?lang=` arrived as. Unknown → English. */
function pickLang(value) {
  const l = String(value || "").trim().toLowerCase().slice(0, 5);
  return SUPPORTED.has(l) ? l : "en";
}

module.exports = {
  SUPPORTED,
  TRANSLATABLE,
  pickLang,
  localize,
  localizeStrings,
  expandSearch,
  lookup,
  registerMissing,
};