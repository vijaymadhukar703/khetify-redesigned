/**
 * lotNumberSpans.js — WHAT EACH RANGE PART OF A LOT NUMBER COUNTS TO.
 *
 * The Create Lot modal shows the number as it is being built, and the server
 * assembles the number that is actually stored. Both must reach the same string
 * from the same packaging figures, so both read their spans from this one rule.
 *
 * MUST STAY IDENTICAL to khetify-backend/services/lotNumberSegmentService.js
 * `packagingSpans` — the two run in different bundles (this one in the browser,
 * that one in Node) and cannot import each other, so the rule is stated once per
 * side and pinned from both by tests/lotNumberSpans.test.js. Change one and the
 * test fails; there is no way to change one quietly.
 *
 *   bulk  → the MAIN boxes
 *   inner → the boxes inside ONE main box (numbering restarts in every carton,
 *           so these are the only inner numbers that exist)
 *   sku   → the lot's units
 */

/** A whole count, or 0 — form fields arrive as strings. */
const count = (v) => Math.max(0, Math.trunc(Number(v) || 0));

/**
 * `numberOfBoxes` is the INNER box count on a three-level lot (main × per-main)
 * and the plain box count on a two-level one — what it means everywhere else in
 * the system. Three-level grouping applies only when both counts are present AND
 * multiply out to it; anything else is a two-level lot with no inner level.
 */
export function packagingSpans({ qty, numberOfBoxes, mainBoxes, boxesPerMain } = {}) {
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

export default packagingSpans;
