/**
 * lotNumberSegmentService.js — the operator-composed lot number, and the box /
 * unit IDs that descend from it.
 *
 * A lot number built in the Create Lot modal is an ORDERED list of segments.
 * There are exactly two kinds:
 *
 *   VALUE segment  — printed as typed.  { key, type: "value", value }
 *                    Company Code, Product Code, Year, Month, Date,
 *                    Batch Number, Other.
 *   RANGE segment  — Bulk Packaging and SKU, in one of two modes:
 *                    { key, type: "range", mode, prefix, digits }
 *
 *                    mode "variable" (the default) — printed as a span from the
 *                      first to the last member of a numbered series: Bulk
 *                      Packaging over 1 … box count, SKU over 1 … unit count.
 *                      Each box / unit then takes its OWN member of that series.
 *                    mode "fixed" — printed as the single typed value, with no
 *                      span and no "~". It counts nothing, so it is a plain
 *                      constant: every box / unit carries the same value. `digits`
 *                      is meaningless here and is not used.
 *
 * The LOT number states the whole span, because a lot IS the whole span:
 *
 *   BHO-OPP247-2026-GP00AS001~GP00AS003-UI0001~UI1000
 *   └─ value ──────┘└─ bulk range ────┘└─ sku range ──┘
 *
 * One physical box, and one physical unit, are single members of those spans,
 * so their IDs are the SAME segments with the ranges collapsed to one value:
 *
 *   box  BHO-OPP247-2026-GP00AS002                 (no SKU — a box is not a unit)
 *   unit BHO-OPP247-2026-GP00AS002-UI0435
 *
 * Because the lot number states ONE continuous unit span, unit numbers run
 * continuously across the whole lot (0001…1000) and never restart inside a box —
 * see services/barcodeService.js, which allocates them from one lot-wide counter.
 *
 * NO SERIAL IS APPENDED. A composed number is the operator's format in full, so
 * nothing may be added that they did not choose — which also means the serial is
 * no longer what makes it unique. lotService rejects a composed number that is
 * already taken, backed by the unique index on the LotNumber registry.
 * (Khetify-GENERATED numbers still carry their serial; that path is untouched.)
 *
 * Composed lots created BEFORE the serial was dropped kept theirs in
 * `lot_number_serial`; serialOf still returns it for those, so their box and
 * unit IDs continue to match the number printed on their cartons.
 *
 * Lots created WITHOUT segments (Khetify-generated numbers, GRN postings, every
 * pre-existing lot) return null from normalizeSegments and every caller falls
 * back to its original behaviour untouched.
 */

const { formatLotSerial } = require("./lotNumberService");

/** The two segments that render as a range. Everything else is a value. */
// "inner" is the MIDDLE packaging level: boxes inside a main box. Present only
// on a three-level lot; a two-level one has bulk + sku exactly as before.
const RANGE_KEYS = new Set(["bulk", "inner", "sku"]);

const MIN_DIGITS = 1;
const MAX_DIGITS = 12;
// The width a range falls back to when a payload carries none. Two, matching
// both the Create Lot builder's floor (ImsLots.autoDigits) and the generated
// shape (lotNumberService.GENERATED_DIGITS), so every path agrees. A stored
// recipe carries its OWN width, so lots minted at three digits are unaffected.
const DEFAULT_DIGITS = 2;
const MAX_SEGMENTS = 20;

/**
 * Accept a client-supplied segment list, or null when there isn't a usable one.
 *
 * Nothing here is trusted: keys are lower-cased, text is trimmed + uppercased to
 * match every other lot identity in the system, and a digit count is clamped to
 * a sane width. A VALUE segment with nothing typed in it is DROPPED — a ticked
 * but empty part has always been skipped rather than emitting an empty piece.
 * A RANGE segment may legitimately have an empty prefix (there is deliberately
 * no built-in default such as "BP"), so it survives on its digits alone.
 */
function normalizeSegments(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;

  const out = [];
  const seen = new Set();
  for (const s of raw.slice(0, MAX_SEGMENTS)) {
    const key = String(s?.key || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    if (RANGE_KEYS.has(key)) {
      const n = parseInt(s?.digits, 10);
      out.push({
        key,
        type: "range",
        // Anything that is not explicitly "fixed" counts — the series is the
        // historical behaviour and the one a malformed payload must fall to.
        mode: s?.mode === "fixed" ? "fixed" : "variable",
        // Uppercased like every other lot identity, UNLESS the segment asks to
        // keep its case — the generated inner-box prefix is spelt "BPinner".
        prefix: s?.keepCase
          ? String(s?.prefix ?? "").trim()
          : String(s?.prefix ?? "").trim().toUpperCase(),
        ...(s?.keepCase ? { keepCase: true } : {}),
        digits: Number.isInteger(n) ? Math.min(MAX_DIGITS, Math.max(MIN_DIGITS, n)) : DEFAULT_DIGITS,
      });
      continue;
    }

    const value = String(s?.value ?? "").trim().toUpperCase();
    if (!value) continue;
    out.push({ key, type: "value", value });
  }

  return out.length ? out : null;
}

/** One member of a range: <prefix><n, zero-padded to the segment's width>. */
function member(seg, n) {
  const i = Math.max(0, Math.trunc(Number(n) || 0));
  return `${seg.prefix}${String(i).padStart(seg.digits, "0")}`;
}

/**
 * How many members a range segment spans — one count per level:
 *   bulk  → the MAIN boxes
 *   inner → the inner boxes INSIDE ONE MAIN BOX
 *   sku   → the lot's units
 *
 * The inner level counts PER MAIN BOX, not across the lot, because that is the
 * only numbering that exists: inner box numbers restart inside every carton
 * (innerIndexOf), so a lot of 2 cartons holding 2 boxes each has inner numbers
 * 01 and 02 and no others. Spanning it 01~04 named two members that are printed
 * on nothing — and disagreed with the main box's own inner span (mainBoxIdBody),
 * which has always read 01~02.
 */
function spanOf(key, { boxCount, innerCount, unitCount }) {
  if (key === "bulk") return Math.trunc(Number(boxCount) || 0);
  if (key === "inner") return Math.trunc(Number(innerCount) || 0);
  if (key === "sku") return Math.trunc(Number(unitCount) || 0);
  return 0;
}

/** A whole count, or 0 — accepts the numeric strings a form post arrives as. */
const count = (v) => Math.max(0, Math.trunc(Number(v) || 0));

/**
 * WHAT EACH RANGE PART COUNTS TO, derived from the packaging the operator
 * entered. THE ONE definition of it.
 *
 * Every caller that builds a lot number reads its spans from here — the
 * hand-composed number and the Khetify-generated one alike. They used to derive
 * them independently and did not agree: the composed path passed the INNER box
 * count as `boxCount` and no `innerCount` at all, so a lot of 2 cartons × 2
 * boxes × 5 units was stored as "…-BP001~BP004-…" with the inner part missing
 * entirely, while the same lot previewed as "…-BP001~BP002-INNER001~INNER002-…".
 *
 * `numberOfBoxes` is the INNER box count on a three-level lot (main × per-main)
 * and the plain box count on a two-level one — which is what it has always meant
 * everywhere else in the system, so nothing else has to change to read it.
 * Three-level grouping applies only when both counts are present AND multiply
 * out to it; anything else is a two-level lot with no inner level at all.
 */
function packagingSpans({ qty, numberOfBoxes, mainBoxes, boxesPerMain } = {}) {
  const boxes = count(numberOfBoxes);
  const mains = count(mainBoxes);
  const perMain = count(boxesPerMain);
  const nested = mains > 0 && perMain > 0 && mains * perMain === boxes;

  return {
    boxCount: nested ? mains : boxes,
    innerCount: nested ? perMain : 0,
    unitCount: count(qty),
  };
}

/**
 * Which MAIN box holds inner box `innerSerial`. BulkPackage rows are the inner
 * boxes, numbered 1..(main × per-main) across the lot, so the main box is simple
 * arithmetic — nothing extra is stored per box.
 */
const mainBoxOf = (innerSerial, boxesPerMain) => {
  const per = Math.trunc(Number(boxesPerMain) || 0);
  const n = Math.trunc(Number(innerSerial) || 0);
  return per > 0 && n > 0 ? Math.ceil(n / per) : n;
};

/**
 * An inner box's number WITHIN ITS MAIN BOX. BulkPackage rows are numbered
 * 1..(main × per-main) across the lot, but a label states the position inside
 * its own carton — inner box 7 of a 5-per-main lot is "02" of main box 2.
 */
const innerIndexOf = (innerSerial, boxesPerMain) => {
  const per = Math.trunc(Number(boxesPerMain) || 0);
  const n = Math.trunc(Number(innerSerial) || 0);
  return per > 0 && n > 0 ? ((n - 1) % per) + 1 : n;
};

/**
 * ONE MAIN BOX's body: its own member, then the FIRST and LAST inner box it
 * contains, and no SKU segment — a main box is not a unit.
 *
 *   KH-BHO-PRE607-BP01-BPINNER01~BPINNER05-2026-07-01
 *
 * The inner span reads as a RANGE ("~"), the same way the lot number states its
 * own spans — a main box holds inner boxes 01 through 05.
 */
function mainBoxIdBody(segments, { mainSerial, boxesPerMain } = {}) {
  const per = Math.max(1, Math.trunc(Number(boxesPerMain) || 1));
  return join(
    segments.flatMap((seg) => {
      if (seg.type === "value") return [seg.value];
      if (isFixed(seg)) return [seg.prefix];
      if (seg.key === "bulk") return [member(seg, mainSerial)];
      if (seg.key === "inner") return [`${member(seg, 1)}~${member(seg, per)}`];
      return [];
    })
  );
}

/** Join the rendered pieces, skipping any that came out empty. */
const join = (parts) => parts.filter(Boolean).join("-");

/** A FIXED range is a constant: the same string everywhere, counting nothing. */
const isFixed = (seg) => seg.type === "range" && seg.mode === "fixed";

/**
 * The lot number body — every ticked segment at its position. A variable range
 * spans first ~ last; a fixed one prints its single value. A variable range
 * whose span is unknown (no box count yet) is skipped rather than printed as an
 * empty span.
 */
function lotNumberBody(segments, { boxCount, innerCount, unitCount } = {}) {
  return join(
    segments.map((seg) => {
      if (seg.type === "value") return seg.value;
      if (isFixed(seg)) return seg.prefix;
      const last = spanOf(seg.key, { boxCount, innerCount, unitCount });
      if (last <= 0) return "";
      return `${member(seg, 1)}~${member(seg, last)}`;
    })
  );
}

/**
 * ONE BOX's body: the bulk range collapses to that box's own number, and the SKU
 * range is dropped — a box is a container of units, not a single unit.
 *
 * A FIXED segment is kept whichever one it is: it names no individual box or
 * unit, so there is nothing to collapse or drop — it is simply part of the
 * number, exactly as it reads in the lot number itself.
 */
function boxIdBody(segments, { boxSerial, boxesPerMain } = {}) {
  return join(
    segments.map((seg) => {
      if (seg.type === "value") return seg.value;
      if (isFixed(seg)) return seg.prefix;
      // On a three-level lot the box row IS the inner box, so the main-box
      // segment names the carton that holds it.
      if (seg.key === "bulk") {
        return member(seg, boxesPerMain ? mainBoxOf(boxSerial, boxesPerMain) : boxSerial);
      }
      if (seg.key === "inner") return member(seg, innerIndexOf(boxSerial, boxesPerMain));
      return "";
    })
  );
}

/**
 * ONE UNIT's body: each variable range collapses to a single member — the box
 * that holds it and its own running number within the lot. A lot with no boxes
 * simply has no bulk segment to collapse.
 */
function unitIdBody(segments, { boxSerial, unitNumber, boxesPerMain } = {}) {
  return join(
    segments.map((seg) => {
      if (seg.type === "value") return seg.value;
      if (isFixed(seg)) return seg.prefix;
      // Both packaging levels collapse to a single member, so a unit label
      // states which main box AND which inner box it sits in.
      if (seg.key === "bulk") {
        if (!boxSerial) return "";
        return member(seg, boxesPerMain ? mainBoxOf(boxSerial, boxesPerMain) : boxSerial);
      }
      if (seg.key === "inner") {
        return boxSerial ? member(seg, innerIndexOf(boxSerial, boxesPerMain)) : "";
      }
      return member(seg, unitNumber);
    })
  );
}

/**
 * The serial that closes every ID of a lot minted BEFORE serials were dropped
 * from composed numbers, or "" for one minted since (the normal case now).
 *
 * Read strictly from the stored field. It is deliberately NOT recovered from the
 * tail of the lot number: a composed number now legitimately ends in digits of
 * its own ("…-2026", "…-SKU0001~SKU1000"), and reading those as a serial would
 * repeat them on every box and unit ID.
 */
function serialOf(lot) {
  const stored = Number(lot?.lot_number_serial);
  return Number.isFinite(stored) && stored > 0 ? formatLotSerial(stored) : "";
}

const withSerial = (body, serial) => join([body, serial]);

/* ---------- the three public builders ---------- */

/**
 * The full lot number: the ticked segments, in the operator's order, and
 * nothing else. No serial — see the note at the top of this file.
 */
function buildLotNumber(segments, { boxCount, innerCount, unitCount } = {}) {
  return lotNumberBody(segments, { boxCount, innerCount, unitCount });
}

/**
 * Bulk Packaging ID for one box of a stored lot, or null when the lot was not
 * built from segments (the caller then keeps its own historical format).
 */
function buildBoxId(lot, boxSerial) {
  const segments = normalizeSegments(lot?.lot_number_segments);
  if (!segments) return null;
  const boxesPerMain = lot?.packaging_boxes_per_main || null;
  return withSerial(boxIdBody(segments, { boxSerial, boxesPerMain }), serialOf(lot));
}

/**
 * Unit ID for one unit of a stored lot, or null when the lot was not built from
 * segments. `unitNumber` is the unit's running number ACROSS THE LOT.
 */
function buildUnitId(lot, { boxSerial = null, unitNumber } = {}) {
  const segments = normalizeSegments(lot?.lot_number_segments);
  if (!segments) return null;
  const boxesPerMain = lot?.packaging_boxes_per_main || null;
  return withSerial(unitIdBody(segments, { boxSerial, unitNumber, boxesPerMain }), serialOf(lot));
}

/**
 * Main box ID for a stored lot, or null when the lot was not built from
 * segments. Main boxes have no BulkPackage row of their own — they are a level
 * of the numbering, derived from the lot's grouping.
 */
function buildMainBoxId(lot, mainSerial) {
  const segments = normalizeSegments(lot?.lot_number_segments);
  if (!segments) return null;
  const boxesPerMain = lot?.packaging_boxes_per_main || null;
  if (!boxesPerMain) return null;
  return withSerial(mainBoxIdBody(segments, { mainSerial, boxesPerMain }), serialOf(lot));
}

module.exports = {
  buildMainBoxId,
  innerIndexOf,
  mainBoxOf,
  packagingSpans,
  RANGE_KEYS,
  DEFAULT_DIGITS,
  normalizeSegments,
  lotNumberBody,
  boxIdBody,
  unitIdBody,
  buildLotNumber,
  buildBoxId,
  buildUnitId,
  serialOf,
};
