const HsnGstRate = require("../model/Master/HsnGstRate");

/**
 * HSN → GST LOOKUP.
 *
 * ── THE PROBLEM THIS SOLVES ──
 * The notification is written at HEADING level: of the 1163 codes in it, 1018
 * are 4-digit and only 93 are 8-digit. A user typing a full 8-digit tariff item
 * such as 08045020 would find NOTHING on an exact match, even though the rate is
 * unambiguous — the notification states it against 0804.
 *
 * So the lookup walks UP the HSN hierarchy, which is how the code is actually
 * structured: 8-digit tariff item → 6-digit sub-heading → 4-digit heading.
 *
 *   08045020 → 080450 → 0804 ✓ 5%
 *
 * IT STOPS AT THE FIRST LEVEL THAT HAS DATA — it does not merge levels. If
 * 080450 existed with its own rate, that would be the answer and 0804 would
 * never be consulted, because the more specific entry is the governing one.
 *
 * ── WHAT IT REFUSES TO DO ──
 * When the matched level carries MORE THAN ONE rate, no rate is returned as the
 * answer. It returns every applicable rate WITH its condition and lets the
 * person decide. Picking the first row, the lowest, or the most common would all
 * be guesses, and on 3105 the guess is a real fertiliser mispriced by 13 points.
 *
 * It never falls back to a 2-digit chapter either. Chapter-level rows in the
 * notification are catch-alls ("28 or 38 — Micronutrients…") whose scope is set
 * by the description, so a 2-digit hit says almost nothing about a specific
 * product. Better to report not-found than to answer with a chapter average.
 */

/** Only digits, 4–8 of them. Same rule the upload form enforces. */
const HSN_RE = /^\d{4,8}$/;

/**
 * The levels to try, most specific first. Duplicates are dropped so a 4-digit
 * input is queried once, not three times.
 */
function candidatesFor(code) {
  const out = [];
  for (const c of [code, code.slice(0, 6), code.slice(0, 4)]) {
    if (c.length >= 4 && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * Resolve a code.
 *
 * Returns one of:
 *   { status: "invalid"   }                       — not 4–8 digits
 *   { status: "not_found" }                       — nothing at any level
 *   { status: "single",   gstRate, matchedHsn, matchedLevel, rates:[…] }
 *   { status: "multiple", matchedHsn, matchedLevel, rates:[…] }
 *
 * `rates` always carries the full option list so the caller can show the
 * conditions; for "single" it simply has one element.
 */
async function lookupHsn(rawCode) {
  const code = String(rawCode || "").trim();
  if (!HSN_RE.test(code)) {
    return { status: "invalid", message: "HSN code must be 4 to 8 digits" };
  }

  for (const candidate of candidatesFor(code)) {
    // Sorted so the option list is stable between calls — the UI renders these
    // as choices and they should not reorder on a refetch.
    const rows = await HsnGstRate.find({ hsnCode: candidate })
      .select("hsnCode gstRate description appliesTo schedule")
      .sort({ gstRate: 1, description: 1 })
      .lean();

    if (!rows.length) continue;

    const rates = rows.map((r) => ({
      gstRate: r.gstRate,
      description: r.description,
      appliesTo: r.appliesTo || null,
      schedule: r.schedule || null,
    }));

    // DISTINCT RATES decide the outcome, not the number of rows: one rate stated
    // twice under two wordings is still one rate and can be filled in safely.
    const distinct = [...new Set(rates.map((r) => r.gstRate))];

    const base = {
      matchedHsn: candidate,
      matchedLevel: candidate === code ? "exact" : `${candidate.length}-digit parent`,
      queried: code,
      rates,
    };

    return distinct.length === 1
      ? { status: "single", gstRate: distinct[0], ...base }
      : { status: "multiple", ...base };
  }

  return {
    status: "not_found",
    queried: code,
    message: `HSN ${code} was not found in the GST rate master. Please select the GST rate manually.`,
  };
}

/**
 * SEARCH the master by leading digits, for the autocomplete on the upload form.
 *
 * PREFIX ONLY, anchored with ^ — an HSN is a hierarchy read left to right, so
 * "31" means chapter 31 and must not also return 2831 or 7310. The input is
 * digits-only (validated below), so it is safe inside a RegExp with no escaping
 * needed; it is escaped anyway rather than relying on that.
 *
 * ONE ROW PER CODE. The collection stores a row per (code, rate, description),
 * so a code with two rates would otherwise appear twice in the list. Results are
 * grouped by code and each carries EVERY rate it has, which is what lets the
 * dropdown mark an ambiguous code before the user picks it.
 *
 * Ordered SHORTEST FIRST: typing "0804" should offer the heading 0804 above the
 * eight-digit items beneath it, because the heading is what the notification
 * actually states the rate against.
 */
const SEARCH_MIN = 2;   // below this the list is meaninglessly broad
const SEARCH_MAX = 8;

async function searchHsn(rawPrefix, { limit = 20 } = {}) {
  const prefix = String(rawPrefix || "").trim();
  if (!/^\d+$/.test(prefix) || prefix.length < SEARCH_MIN || prefix.length > SEARCH_MAX) {
    return { status: "invalid", results: [] };
  }

  const rows = await HsnGstRate.find({ hsnCode: new RegExp(`^${prefix.replace(/[^0-9]/g, "")}`) })
    .select("hsnCode gstRate description appliesTo schedule")
    .lean();

  const byCode = new Map();
  for (const r of rows) {
    if (!byCode.has(r.hsnCode)) byCode.set(r.hsnCode, []);
    byCode.get(r.hsnCode).push({
      gstRate: r.gstRate,
      description: r.description,
      appliesTo: r.appliesTo || null,
      schedule: r.schedule || null,
    });
  }

  const results = [...byCode.entries()]
    .sort((a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([hsnCode, rates]) => {
      rates.sort((x, y) => x.gstRate - y.gstRate || x.description.localeCompare(y.description));
      const distinct = [...new Set(rates.map((r) => r.gstRate))];
      return {
        hsnCode,
        rates,
        // The dropdown shows a single rate outright, and flags the rest as
        // needing a choice — it never shows one of several as "the" rate.
        gstRate: distinct.length === 1 ? distinct[0] : null,
        multiple: distinct.length > 1,
        description: rates[0].description,
      };
    });

  return { status: "ok", total: byCode.size, results };
}

module.exports = { lookupHsn, searchHsn, HSN_RE, candidatesFor };