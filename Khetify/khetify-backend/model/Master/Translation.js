const mongoose = require("mongoose");
const crypto = require("crypto");

/**
 * 🌐 TRANSLATION CACHE — one row per (source text, language).
 *
 * ── KEYED ON THE TEXT, NOT ON THE RECORD ────────────────────────────────────
 *
 * The obvious design is a `translations` field on Product. This is deliberately
 * NOT that, and the reason is dedup:
 *
 *   • "seeds" is the category of hundreds of products. Keyed on the product it
 *     is translated hundreds of times; keyed on the TEXT it is ONE row that
 *     serves every one of them, today and every product uploaded tomorrow.
 *   • A company typing its own category ("Bio Stimulants") produces a new row
 *     automatically. Nothing has to be deployed for it to become translatable.
 *   • Editing a product does not lose its translations — the text is the key,
 *     so unchanged text keeps its translation and changed text simply misses
 *     the cache and gets queued.
 *   • Adding Marathi later means INSERTING ROWS (lang: "mr"). No schema change,
 *     no migration, no code change.
 *
 * `key` is a hash of the NORMALISED source text (see `hashSource`), so
 * "Seeds", "seeds" and " seeds " all resolve to the same row.
 *
 * ── NEVER STORE HERE ────────────────────────────────────────────────────────
 * Prices, quantities, SKU, HSN, GST, IDs, phone numbers, dates. They are not
 * language — a translated SKU is a wrong SKU. The caller decides what is
 * translatable (see FIELD RULES in services/translationService.js); this model
 * just stores strings.
 */
const translationSchema = new mongoose.Schema(
  {
    /** sha1 of the normalised source text. Indexed with `lang`. */
    key: { type: String, required: true, index: true },

    /**
     * The English original, stored verbatim (not normalised) so the reverse
     * lookup that powers Hindi SEARCH can return something usable, and so a
     * human reviewing the row can see exactly what was translated.
     */
    sourceText: { type: String, required: true },

    /** BCP-47-ish short code: "hi", later "mr", "gu", … */
    lang: { type: String, required: true, index: true },

    /** The translation. Empty until a worker or a human fills it. */
    text: { type: String, default: "" },

    /**
     * WHO WROTE IT — and this is the rule that makes the cache trustworthy:
     *
     *   "human" is NEVER overwritten by "mt".
     *
     * Machine translation gets agricultural terms wrong often enough that a
     * correction has to be permanent. Fix a bad row once, mark it human, and no
     * background job can undo it.
     *
     * "pending" means: we know this string needs translating, nobody has yet.
     * The read path treats pending exactly like missing — it returns English.
     */
    source: { type: String, enum: ["human", "mt", "pending"], default: "pending" },

    /** How many times the storefront asked for this string. Lets a worker
     *  translate the most-seen strings first instead of in insertion order. */
    hits: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// The only query the read path makes: many keys, one language.
translationSchema.index({ key: 1, lang: 1 }, { unique: true });
// Reverse lookup for search: "बीज" → "seeds".
translationSchema.index({ lang: 1, text: 1 });
// Lets a worker pull the highest-value untranslated strings first.
translationSchema.index({ lang: 1, source: 1, hits: -1 });

/**
 * Normalise before hashing so trivial differences share one row.
 * Case-folded, whitespace-collapsed, trimmed.
 */
function normalizeSource(text) {
  return String(text ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function hashSource(text) {
  return crypto.createHash("sha1").update(normalizeSource(text)).digest("hex");
}

const Translation = mongoose.model("Translation", translationSchema);

module.exports = Translation;
module.exports.normalizeSource = normalizeSource;
module.exports.hashSource = hashSource;