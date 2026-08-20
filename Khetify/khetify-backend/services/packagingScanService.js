/**
 * packagingScanService.js — HOW A SCANNED CODE BECOMES A SET OF UNITS.
 *
 * The warehouse scans the same four things whichever direction the stock is
 * moving: a Bulk Packaging ID, an inner box inside one, a repack carton, or a
 * single unit. Sending them out (dispatchScanService) and taking them in
 * (receiveScanService) differ only in WHICH UNITS COUNT — on the shelf here, or
 * in transit to here — never in what a code means.
 *
 * So the meaning lives here, once. Each caller supplies its own eligibility
 * filter and its own rules about quantity; neither re-implements the lookups,
 * the case handling or the main-box cascade, all three of which have already
 * been the source of real bugs.
 *
 * NOTHING IN HERE WRITES. It answers "what does this code refer to?" and stops.
 */

const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const RepackBox = require("../model/Inventory/RepackBox");
const Inventory = require("../model/Inventory/Inventory");

/** For COMPARING two codes — both sides folded the same way, so it is symmetric. */
const norm = (v) => String(v || "").trim().toUpperCase();

/**
 * FOR QUERYING, the stored value must be matched as it is stored — and stored
 * identifiers are NOT all upper case. A three-level lot spells the inner-box
 * segment of a UNIT code "BPinner" (lotNumberSegmentService keeps that case
 * deliberately), while the box rows spell it "BPINNER". Upper-casing a code
 * before a database lookup therefore made every unit of a three-level lot
 * unfindable.
 *
 * So: try the value VERBATIM first (indexed, the normal case), and only then
 * case-insensitively for a hand-typed code. The fallback regex is anchored and
 * fully escaped — an identifier may legally contain "~", "/", "." and "-", none
 * of which may act as regex syntax.
 */
const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ciExact = (v) => new RegExp(`^${escapeRegex(v)}$`, "i");

async function matchEither(run, value) {
  return (await run(value)) || (await run(ciExact(value)));
}

/** Both spellings of every code, so one `$in` matches however it was echoed. */
const codeVariants = (list) => [
  ...new Set((list || []).flatMap((c) => {
    const raw = String(c || "").trim();
    return raw ? [raw, raw.toUpperCase()] : [];
  })),
];

/**
 * WHICH BOX ROWS ACTUALLY HOLD THE UNITS of a scanned carton.
 *
 * A three-level lot stores its units against the INNER boxes; the MAIN box is a
 * carton over them and owns no unit rows of its own (`units_in_box` on it is a
 * roll-up, not a link). So a main box resolves to its children — the parent link
 * is read from `parent_box_id`, never by parsing the ID string, whose segments
 * are a convention rather than a contract.
 *
 * A two-level lot's box, and any inner box, holds its units directly. A main box
 * with no children is such a box, so it falls back to itself.
 *
 * THIS IS THE CASCADE. Scanning the outer carton must reach everything nailed
 * inside it, in either direction — a main box that resolved to zero units is the
 * bug this function exists to prevent.
 */
async function unitHolderIds(companyId, box) {
  if (box.box_level !== "main") return [box._id];
  const inners = await BulkPackage.find({ company_id: companyId, parent_box_id: box._id })
    .select("_id")
    .lean();
  return inners.length ? inners.map((b) => b._id) : [box._id];
}

/**
 * WHERE A CARTON'S STOCK IS RIGHT NOW — answered from its UNITS, never from the
 * box's own `lot_id` / `warehouse_id`.
 *
 * A BulkPackage row is anchored FOREVER to the lot row and the warehouse it was
 * minted against. A warehouse→warehouse receipt creates a brand-new Inventory
 * row at the destination and repoints every moved unit's `inventoryId` to it
 * (shipmentService.verifyReceipt), but leaves the carton's own fields alone. So
 * at the RECEIVING warehouse the box still claims to belong to the sender's lot
 * row, in the sender's warehouse — and reading either field there refuses stock
 * that is physically on the shelf. That is exactly what made a Bulk Packaging ID
 * unscannable on the second leg of a Company → Head Office → Indore chain.
 *
 * The units always know. This is the same discovery bulkPackageService.boxesForRow
 * already does in the other direction (boxes found THROUGH units, not units
 * through boxes); stating it once here is what keeps the dispatch scan, the unit
 * scan and the dispatch confirm from disagreeing about where a carton is.
 *
 * A MAIN carton of a three-level lot owns no unit rows of its own, so the lookup
 * runs over the boxes that actually hold them — the same `unitHolderIds` cascade
 * the scan itself uses, never a re-implementation of it.
 *
 * FALLS BACK to the box's own fields ONLY when it has no units at all: a freshly
 * minted, never-labelled carton, which is precisely the case units cannot answer
 * for. A box whose units DO exist but sit somewhere else does not fall back — it
 * resolves to where they are, so the callers' existing "already been transferred
 * out" / wrong-warehouse refusals still fire.
 *
 * `cache` is an optional Map, keyed by box id, for callers that ask about the
 * same carton repeatedly (the dispatch confirm walks unit by unit). It holds the
 * in-flight promise, so a repeat ask costs nothing.
 */
async function boxStockLocation(companyId, box, cache = null) {
  const key = String(box._id);
  if (cache && cache.has(key)) return cache.get(key);

  const pending = (async () => {
    const holderIds = await unitHolderIds(companyId, box);
    const inventoryIds = (await UnitSerial.distinct("inventoryId", {
      ...(companyId ? { companyId } : {}),
      bulk_packaging_record_id: { $in: holderIds },
    })).filter(Boolean);

    // Never populated — the box's own anchor is the only answer there is.
    if (!inventoryIds.length) {
      return {
        hasUnits: false,
        inventoryIds: box.lot_id ? [String(box.lot_id)] : [],
        warehouseIds: box.warehouse_id ? [String(box.warehouse_id)] : [],
      };
    }

    // A carton split by a PARTIAL transfer legitimately sits in two places at
    // once, so this is a list, not a single value.
    const rows = await Inventory.find({ _id: { $in: inventoryIds } }).select("warehouseId").lean();
    return {
      hasUnits: true,
      inventoryIds: inventoryIds.map(String),
      warehouseIds: [...new Set(rows.map((r) => String(r.warehouseId)).filter(Boolean))],
    };
  })();

  if (cache) cache.set(key, pending);
  return pending;
}

/* ------------------------------------------------------------- lookups */

/** The Bulk Packaging box a code names, or null. */
const findBox = (companyId, value, select) =>
  matchEither(
    (v) => BulkPackage.findOne({ company_id: companyId, bulk_packaging_id: v }).select(select),
    value,
  );

/** The unit a code names — by serial or by its unit_code mirror — or null. */
const findUnit = (companyId, value, select) =>
  matchEither(
    (v) => UnitSerial.findOne({ companyId, $or: [{ serial: v }, { unit_code: v }] }).select(select),
    value,
  );

/** The repack carton a code names, or null. */
const findRepackBox = (companyId, value, select) =>
  matchEither(
    (v) => RepackBox.findOne({ company_id: companyId, repack_box_id: v }).select(select),
    value,
  );

module.exports = {
  norm,
  escapeRegex,
  ciExact,
  matchEither,
  codeVariants,
  unitHolderIds,
  boxStockLocation,
  findBox,
  findUnit,
  findRepackBox,
};
