/**
 * bulkPackageService.js — Bulk Packaging IDs: one identity per PHYSICAL OUTER
 * BOX of a lot, and the box-by-box warehouse receiving that goes with them.
 *
 * Identity ladder (never mix these up):
 *   Lot Number        — the whole lot            KH-BHO-PRE482-2026-07-0001
 *   Bulk Packaging ID — one outer box of the lot KH-BHO-PRE482-2026-07-0001-BP003
 *   Unit barcode      — one unit inside a box    (services/barcodeService.js)
 *
 * Receiving rules:
 *   • A lot WITH boxes may not be received by scanning the parent lot number.
 *   • One scan books exactly that box's `units_in_box` — never the whole lot.
 *   • A box may be received once, at its destination warehouse, and only from
 *     status "created". The conditional update below is what guarantees it, so
 *     two simultaneous scans can never add the quantity twice.
 */

const mongoose = require("mongoose");
const BulkPackage = require("../model/Inventory/BulkPackage");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const { emitInventoryUpdate } = require("./inventoryService");
const { buildBoxId, buildMainBoxId } = require("./lotNumberSegmentService");
const { withTransaction } = require("./txn");

const SERIAL_PAD = 3;

const ALREADY_RECEIVED = "This Bulk Packaging ID has already been received.";
const SCAN_BOXES_SEPARATELY =
  "This lot has multiple Bulk Packaging IDs. Please scan each box separately.";
const PACKAGING_MISMATCH =
  "Number of boxes × units per box must be equal to the total lot quantity.";

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * A code that matched no stored identifier, recorded verbatim with its
 * character codes — the only way a byte-for-byte mismatch (a label whose
 * symbology dropped "~", a scanner emitting a different dash) is visible,
 * since the two read identically on screen.
 */
/**
 * "BLPA0003 was already received on 12 Jul 2026." — the generic sentence is
 * kept on the end so callers (and tests) matching ALREADY_RECEIVED still do.
 */
function alreadyReceivedMsg(box) {
  const at = box?.received_at
    ? new Date(box.received_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : null;
  if (!at) return ALREADY_RECEIVED;
  return `${box.bulk_packaging_id} was already received on ${at}. ${ALREADY_RECEIVED}`;
}

function logIdMiss(kind, companyId, code) {
  console.warn(
    `[scan] no match on ${kind}`,
    JSON.stringify({
      company: String(companyId),
      scanned: code,
      length: code.length,
      charCodes: [...code].map((ch) => ch.charCodeAt(0)).join(","),
    })
  );
}

/** A positive whole number, or null. Accepts numeric strings from form posts. */
function positiveInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * "<LOT>-BP<SERIAL>" — e.g. KH-BHO-PRE482-2026-07-0001-BP001.
 *
 * The FALLBACK format, for a lot whose number the operator did not compose:
 * Khetify-generated numbers, GRN postings and every pre-existing lot. "BP" is
 * this format's own marker, not a default prefix — a lot built from segments
 * carries its OWN Bulk Packaging prefix and never comes through here (see
 * boxIdFor / lotNumberSegmentService).
 *
 * NOTE: there is deliberately NO hyphen between "BP" and the serial. Boxes
 * created before this change keep their original "…-BP-001" ID: the ID is the
 * identity printed on the physical carton, so it is never rewritten. Every
 * lookup here is an EXACT match on the stored value, so both shapes resolve.
 */
function buildBulkPackagingId(lotNumber, boxSerial) {
  return `${String(lotNumber).trim().toUpperCase()}-BP${String(boxSerial).padStart(SERIAL_PAD, "0")}`;
}

/**
 * This box's ID. A lot whose number was COMPOSED from segments spells its boxes
 * with the operator's own Bulk Packaging prefix and digit width, at the position
 * the box part occupies in the number:
 *
 *   lot  BHO-OPP247-2026-GP00AS001~GP00AS003-UI0001~UI1000-0001
 *   box  BHO-OPP247-2026-GP00AS002-0001
 *
 * Any other lot keeps the historical "<LOT>-BP<SERIAL>" above.
 */
function boxIdFor(lot, boxSerial) {
  return (
    buildBoxId(lot, boxSerial) ||
    buildBulkPackagingId(lot.lotNumber || lot.batchNumber, boxSerial)
  );
}

/**
 * Validate the operator's bulk-packaging input against the lot quantity.
 * Returns null when bulk packaging is off, else { numberOfBoxes, unitsPerBox }.
 *
 * This is the BACKEND copy of the rule the modal enforces — editing the
 * quantity field in the browser cannot get past it.
 */
function validateBulkPackaging({ hasBulkPackaging, numberOfBoxes, unitsPerBox, qty }) {
  if (!hasBulkPackaging) return null;

  const boxes = positiveInt(numberOfBoxes);
  const perBox = positiveInt(unitsPerBox);
  if (!boxes || !perBox) {
    throw httpErr("Number of boxes and units per box must be positive whole numbers.", 400);
  }
  if (boxes * perBox !== Number(qty)) throw httpErr(PACKAGING_MISMATCH, 400);

  return { numberOfBoxes: boxes, unitsPerBox: perBox };
}

/**
 * Mint the Bulk Packaging IDs for a freshly created lot.
 *
 * Idempotent: a lot that already has boxes is left alone, so a re-receive into
 * the same lot row (which upserts) never doubles them up.
 */
async function createBulkPackages({ companyId, productId, lot, numberOfBoxes, unitsPerBox, warehouseId, session }) {
  const existing = await BulkPackage.countDocuments({ lot_id: lot._id }).session(session || null);
  if (existing > 0) return [];

  const lotNumber = lot.lotNumber || lot.batchNumber;
  const opts = session ? { session } : {};
  const base = {
    company_id: companyId,
    product_id: productId,
    lot_id: lot._id,
    lot_number: lotNumber,
    status: "created",
    warehouse_id: warehouseId || null,
  };

  // THREE-LEVEL LOT: main boxes own inner boxes.
  //
  // The main boxes are created FIRST so each inner row can carry its parent's
  // _id. `numberOfBoxes` is the INNER count (main × per-main), which is what it
  // has always meant, so every reader of it is unaffected — and inner rows keep
  // their LOT-WIDE box_serial (1..N) for the same reason: unit generation, the
  // scan lookups and the label pages all key off it. Position within a parent is
  // derived (innerIndexOf), never stored twice.
  const perMain = Number(lot.packaging_boxes_per_main) || 0;
  const mainCount = Number(lot.packaging_main_boxes) || 0;

  if (perMain > 0 && mainCount > 0 && mainCount * perMain === Number(numberOfBoxes)) {
    const mains = await BulkPackage.insertMany(
      Array.from({ length: mainCount }, (_, i) => ({
        ...base,
        box_level: "main",
        parent_box_id: null,
        bulk_packaging_id: buildMainBoxId(lot, i + 1),
        box_serial: i + 1,
        // A main box holds every unit of the inner boxes inside it.
        units_in_box: perMain * Number(unitsPerBox),
      })),
      opts
    );

    const inners = await BulkPackage.insertMany(
      Array.from({ length: Number(numberOfBoxes) }, (_, i) => ({
        ...base,
        box_level: "inner",
        parent_box_id: mains[Math.ceil((i + 1) / perMain) - 1]._id,
        bulk_packaging_id: boxIdFor(lot, i + 1),
        box_serial: i + 1,
        units_in_box: unitsPerBox,
      })),
      opts
    );
    return [...mains, ...inners];
  }

  // TWO-LEVEL LOT — a single flat list of 'main' rows with no children, exactly
  // as before.
  const docs = Array.from({ length: numberOfBoxes }, (_, i) => ({
    ...base,
    box_level: "main",
    parent_box_id: null,
    bulk_packaging_id: boxIdFor(lot, i + 1),
    box_serial: i + 1,
    units_in_box: unitsPerBox,
  }));

  return BulkPackage.insertMany(docs, opts);
}

/* ---------- queries ---------- */

/**
 * The boxes of a lot that HOLD UNITS, in box order.
 *
 * On a three-level lot that is the inner boxes; on a two-level lot every row is
 * 'main' and holds units directly. Main rows of a three-level lot are excluded
 * on purpose: every caller of this — receive, dispatch, pick, the label pages,
 * the packaging roll-up — means "the boxes stock sits in", and counting the
 * outer cartons as well would double every figure. Ask for them explicitly with
 * listMainBoxes.
 */
function unitHoldingBoxes(rows) {
  const inners = (rows || []).filter((b) => b.box_level === "inner");
  return inners.length ? inners : (rows || []).filter((b) => b.box_level !== "inner");
}

/**
 * How many of a lot's boxes are still waiting to be received.
 *
 * The query form of unitHoldingBoxes: on a three-level lot only the inner boxes
 * are ever scanned in, so only they count; on a two-level lot every row is a
 * 'main' box that holds units directly and every row counts.
 */
async function pendingBoxCount(lotId, session) {
  const q = (filter) => {
    const c = BulkPackage.countDocuments(filter);
    return session ? c.session(session) : c;
  };
  const hasInner = await q({ lot_id: lotId, box_level: "inner" });
  return hasInner > 0
    ? q({ lot_id: lotId, box_level: "inner", status: "created" })
    : q({ lot_id: lotId, box_level: { $ne: "inner" }, status: "created" });
}

async function listByLot(companyId, lotId) {
  return unitHoldingBoxes(
    await BulkPackage.find({ company_id: companyId, lot_id: lotId }).sort({ box_serial: 1 })
  );
}

/**
 * THE UNIT-HOLDING BOXES OF ONE INVENTORY ROW — including cartons whose records
 * belong to ANOTHER row of the same lot.
 *
 * A lot is one Inventory row per warehouse, but a BulkPackage row is anchored to
 * the lot row it was minted against. A warehouse that RECEIVES a transfer gets a
 * brand-new Inventory row, so listByLot (keyed on lot_id) returns nothing there
 * — which is why the receiving warehouse's pages showed a heap of loose unit
 * codes with no box headings while the sending warehouse grouped them properly.
 *
 * The units themselves still know their carton, so the boxes are discovered from
 * them. Everything downstream then runs the SAME code the sending side already
 * runs; there is no second implementation of the grouping.
 */
async function boxesForRow(companyId, lotId) {
  const own = await listByLot(companyId, lotId);
  const inheritedIds = await UnitSerial.distinct("bulk_packaging_record_id", {
    companyId,
    ownerType: "company",
    ownerId: companyId,
    inventoryId: lotId,
    bulk_packaging_record_id: { $ne: null },
  });
  const ownIds = new Set(own.map((b) => String(b._id)));
  const extra = inheritedIds.filter((id) => id && !ownIds.has(String(id)));
  if (!extra.length) return own;

  const inherited = await BulkPackage.find({ _id: { $in: extra }, company_id: companyId })
    .sort({ box_serial: 1 });
  return [...own, ...inherited];
}

/**
 * The MAIN cartons above a given set of boxes, read from their own parent links.
 *
 * listMainBoxes is keyed on lot_id and so comes back empty on a receiving row,
 * exactly as listByLot does. Reading the parents off the boxes works from either
 * side, and still returns nothing for a two-level lot — whose boxes have no
 * parent — so that shape stays flat.
 */
async function mainBoxesFor(companyId, boxes) {
  const parentIds = [...new Set((boxes || []).map((b) => String(b.parent_box_id || "")).filter(Boolean))];
  if (!parentIds.length) return [];
  return BulkPackage.find({ _id: { $in: parentIds }, company_id: companyId }).sort({ box_serial: 1 });
}

/**
 * HOW MANY BOXES THE LOT HAS IN TOTAL — what "Box 2 of 4" is counted against.
 *
 * Taken from the boxes' OWN lot, not from the row being viewed: a carton's
 * printed label says "BOX 2 OF 4" and the screen must agree with the sticker,
 * even at a warehouse that only received two of the four.
 */
async function lotBoxTotal(companyId, boxes) {
  const lotIds = [...new Set((boxes || []).map((b) => String(b.lot_id || "")).filter(Boolean))];
  if (lotIds.length !== 1) return (boxes || []).length;
  return (await listByLot(companyId, lotIds[0])).length;
}

/** The MAIN boxes of a three-level lot, in order. Empty on a two-level lot. */
async function listMainBoxes(companyId, lotId) {
  const all = await BulkPackage.find({ company_id: companyId, lot_id: lotId }).sort({ box_serial: 1 });
  return all.some((b) => b.box_level === "inner")
    ? all.filter((b) => b.box_level === "main")
    : [];
}

/* ---------- which boxes are physically at a warehouse ---------- */

const boxStatus = (b) => String(b?.status || "").trim().toLowerCase();
/** A warehouse id however it arrives — raw, populated, or missing. */
const whId = (v) => String(v?._id || v || "");

/**
 * THE ONE ANSWER to "which of this lot's boxes are on this warehouse's shelf?"
 *
 * A box is here when the warehouse RECEIVED it and it is booked to that
 * warehouse. Nothing else decides it — in particular:
 *
 *   • NOT its units. receiveBox activates the first `units_in_box` units of the
 *     LOT rather than the box's own (see step 4 there), so a genuinely received
 *     box can still have every one of its labels sitting at "generated". Reading
 *     presence off units therefore drops real boxes, which is exactly how BP003
 *     went missing while the summary counted it.
 *   • NOT `received_at`, which older rows may not carry.
 *   • NOT position. There is no slice, take, limit or index anywhere in here:
 *     every box of the lot is tested on its own state.
 *
 * A box with NO warehouse recorded is treated as being at its lot's warehouse —
 * `warehouse_id` is a denormalised copy of the lot's, so when it is absent the
 * lot is the authority.
 */
function boxesPresentAt(boxes, warehouseId) {
  const here = whId(warehouseId);
  return (boxes || []).filter((b) => {
    if (boxStatus(b) !== "received") return false;
    const booked = whId(b.warehouse_id);
    return !booked || booked === here;
  });
}

/** The same answer, fetched. Boxes come back in box order. */
async function boxesAtWarehouse(companyId, lotId, warehouseId) {
  return boxesPresentAt(await listByLot(companyId, lotId), warehouseId);
}

/**
 * Received / total / pending-units roll-up for a lot.
 *
 * Pass `warehouseId` and the RECEIVED figures are counted through
 * boxesPresentAt — the very same function that builds the Bulk Packaging IDs
 * list — so a page showing both can never have them disagree. Omit it and the
 * roll-up is the lot-wide one every other caller already gets.
 */
/**
 * EVERY ROW OF ONE LOT, and every box and unit under all of them.
 *
 * A lot is one Inventory row per warehouse. A WAREHOUSE holds what it holds, so
 * its summary is row-scoped. The COMPANY owns every warehouse, so its scope is
 * the whole lot however its stock is spread — the same rule lotController
 * already applies to the company's unit list (originalLotUnits) and to the
 * Labels page (barcodeService listUnits `identityScope`).
 */
async function lotIdentityScope(companyId, lotId) {
  const lot = await Inventory.findOne({ _id: lotId, ownerType: "company", ownerId: companyId })
    .select("lotNumber batchNumber")
    .lean();
  const identity = lot?.lotNumber || lot?.batchNumber;
  if (!identity) return null;

  const rows = await Inventory.find({
    ownerType: "company",
    ownerId: companyId,
    $or: [{ lotNumber: identity }, { batchNumber: identity }],
  }).select("_id").lean();

  // The union of every row's boxes, deduped — a carton is one physical box
  // however many rows its units are spread over.
  const seen = new Map();
  for (const r of rows) {
    for (const b of await boxesForRow(companyId, r._id)) {
      if (!seen.has(String(b._id))) seen.set(String(b._id), b);
    }
  }

  const unitLabels = await UnitSerial.countDocuments({
    ownerType: "company",
    ownerId: companyId,
    $or: [{ lotNumber: identity }, { batchNumber: identity }],
  });

  return { boxes: [...seen.values()], unitLabels };
}

async function summaryForLot(companyId, lotId, { warehouseId, identityScope = false } = {}) {
  // THE BOXES THIS ROW'S STOCK IS IN — its own, plus any carton whose record
  // belongs to the row that SENT the goods (boxesForRow).
  //
  // This used to be `find({ lot_id: lotId })`, which is empty at a RECEIVING
  // warehouse: a BulkPackage row is anchored to the lot row it was minted
  // against, and a receipt creates a brand-new row. So the whole summary came
  // back null there — the page printed "0 boxes", "Total Boxes 0", and the
  // Received / Pending figures did not render at all, while the Bulk Packaging
  // IDs section below it listed the very cartons on the shelf.
  // THE SCOPE THIS SUMMARY ANSWERS FOR.
  //
  // Row-scoped by default: a warehouse's Packaging Summary describes what that
  // warehouse holds. The COMPANY asks for the whole lot — it owns every
  // warehouse, so a warehouse→warehouse move is an internal relocation, and
  // reading one row told it half the story. Opened on the SENDING row it showed
  // "Unit Labels 10" for a lot it had minted 20 labels for; opened on the
  // RECEIVING row it showed "2 boxes · 10 units" of a four-box, twenty-unit lot.
  const identity = identityScope ? await lotIdentityScope(companyId, lotId) : null;

  const own = identity ? identity.boxes : await listByLot(companyId, lotId);
  const boxes = unitHoldingBoxes(identity ? identity.boxes : await boxesForRow(companyId, lotId));

  // A UNIT LABEL COUNT for that scope, whatever state the units are in.
  //
  // Deliberately NOT filtered by stock status. "Unit Labels" answers "how many
  // codes exist", not "how much is on the shelf" — the page read it off an
  // in-stock-only count, so a warehouse holding units that were minted but not
  // yet put away (or already dispatched) showed 0 while the box cards below
  // listed every one of their codes.
  const unitLabels = identity
    ? identity.unitLabels
    : await UnitSerial.countDocuments({
      ownerType: "company", ownerId: companyId, inventoryId: lotId,
      // Labels that have gone out with the goods are no longer this shelf's to
      // count — the units are on a truck, and their codes will be read at the
      // far end. Only for a WAREHOUSE view; the lot-wide roll-up counts them.
      ...(warehouseId === undefined ? {} : { status: { $ne: "shipped" } }),
    });

  if (!boxes.length) return null;   // single package — the page says so itself

  // WHICH BOXES ARE HERE.
  //   own       — the existing rule: received, and booked to this warehouse
  //   inherited — here by construction; this row's units are inside them. Their
  //               `warehouse_id` names the SENDER, so the booked-warehouse test
  //               would reject every one of them.
  const ownIds = new Set(own.map((b) => String(b._id)));
  const mine = boxes.filter((b) => ownIds.has(String(b._id)));
  const inherited = boxes.filter((b) => !ownIds.has(String(b._id)));
  const received = [
    ...(warehouseId === undefined
      ? mine.filter((b) => boxStatus(b) === "received")
      : boxesPresentAt(mine, warehouseId)),
    ...inherited,
  ];

  const cancelled = boxes.filter((b) => boxStatus(b) === "cancelled");
  const receivedIds = new Set(received.map((b) => String(b._id)));
  const pending = boxes.filter(
    (b) => !receivedIds.has(String(b._id)) && boxStatus(b) !== "cancelled"
  );

  /**
   * THE BOX FIGURES ARE A RECEIPT RECORD, AND A RECORD DOES NOT MOVE.
   *
   * "6 boxes × 5 units · 6 received · 30 units received" is the answer to
   * "what did this warehouse take in", and sending some of it onward does not
   * change what it took in. These were briefly made live — a carton emptied by a
   * later transfer dropped out and the summary read "3 boxes · 15 units" — which
   * quietly rewrote history and left no figure saying what had actually arrived.
   *
   * UNIT LABELS is the one live figure here, and deliberately so: it answers
   * "how many codes are on this shelf now", which is what falls when stock
   * leaves. See the count below.
   *
   * (What is still PHYSICALLY here is the Bulk Packaging IDs section's job, and
   * it lists only the remaining cartons — the two sections answer different
   * questions on purpose.)
   */
  // The units-per-box the boxes themselves state, so a receiving row — whose
  // Inventory record carries neither `number_of_boxes` nor `units_per_box` —
  // can still read "2 boxes × 5 units".
  const perBox = boxes.find((b) => Number(b.units_in_box) > 0)?.units_in_box ?? null;

  return {
    totalBoxes: boxes.length,
    receivedBoxes: received.length,
    cancelledBoxes: cancelled.length,
    pendingBoxes: pending.length,
    receivedUnits: received.reduce((s, b) => s + Number(b.units_in_box || 0), 0),
    pendingUnits: pending.reduce((s, b) => s + Number(b.units_in_box || 0), 0),
    // ADDITIVE — both read by the Packaging Summary so the two sides of a
    // transfer are drawn from ONE calculation.
    unitsPerBox: perBox,
    unitLabels,
  };
}

/**
 * Why a received box is NOT counted as present here. Printed only when the two
 * actually disagree, so a healthy lot is silent — this is the diagnostic for a
 * box whose warehouse does not match the lot's.
 */
function logBoxPresenceMismatch(lotId, warehouseId, boxes, present) {
  const presentIds = new Set(present.map((b) => String(b._id)));
  const dropped = (boxes || []).filter(
    (b) => boxStatus(b) === "received" && !presentIds.has(String(b._id))
  );
  if (!dropped.length) return;
  console.warn(
    "[boxes] received but not at this warehouse",
    JSON.stringify({
      lotId: String(lotId),
      lotWarehouse: whId(warehouseId),
      boxes: (boxes || []).map((b) => ({
        id: b.bulk_packaging_id,
        serial: b.box_serial,
        status: b.status,
        warehouse: whId(b.warehouse_id) || null,
        receivedAt: b.received_at || null,
      })),
    })
  );
}

/**
 * Resolve a scanned Bulk Packaging ID to the box awaiting receipt.
 *
 * READ-ONLY — moves nothing. The code is matched WHOLE against the stored
 * `bulk_packaging_id`; it is never parsed, so a box ID built from a composed lot
 * number (with "/" or "~", and any number of parts) resolves exactly like the
 * "<LOT>-BP001" shape. Both the code as scanned and its uppercase form are
 * tried, because stored IDs are uppercase.
 */
async function findIncomingBox(companyId, code, { allowedWarehouseIds = null } = {}) {
  const raw = String(code || "").trim();
  if (!raw) throw httpErr("Bulk Packaging ID not found.", 404);

  const box = await BulkPackage.findOne({
    company_id: companyId,
    bulk_packaging_id: { $in: [raw, raw.toUpperCase()] },
  })
    .populate("product_id", "productName product_code skuNumber")
    .populate("warehouse_id", "name code")
    .populate("lot_id", "lotNumber batchNumber mfgDate expiryDate mfgBatchNo inTransitStock");
  if (!box) {
    logIdMiss("bulk packaging id", companyId, raw);
    throw httpErr("Bulk Packaging ID not found.", 404);
  }

  if (box.status === "received") throw httpErr(alreadyReceivedMsg(box), 409);
  if (box.status === "cancelled") throw httpErr("This Bulk Packaging ID has been cancelled.", 409);

  // A box may only be received at the warehouse it was booked to.
  if (Array.isArray(allowedWarehouseIds)) {
    const dest = String(box.warehouse_id?._id || box.warehouse_id || "");
    if (!allowedWarehouseIds.map(String).includes(dest)) {
      throw httpErr("This box is not assigned to your warehouse.", 403);
    }
  }

  const summary = await summaryForLot(companyId, box.lot_id?._id || box.lot_id);
  return shapeBox(box, summary);
}

function shapeBox(box, summary) {
  const lot = box.lot_id || {};
  return {
    bulkPackagingId: box.bulk_packaging_id,
    boxSerial: box.box_serial,
    unitsInBox: box.units_in_box,
    status: box.status,
    inventoryId: lot._id || box.lot_id,
    lotNumber: box.lot_number,
    productId: box.product_id?._id || box.product_id,
    productName: box.product_id?.productName || "—",
    productCode: box.product_id?.product_code || null,
    warehouseId: box.warehouse_id?._id || box.warehouse_id,
    destination: box.warehouse_id?.name || "—",
    mfgBatchNo: lot.mfgBatchNo || null,
    mfgDate: lot.mfgDate || null,
    expiryDate: lot.expiryDate || null,
    receivedAt: box.received_at || null,
    packaging: summary,
  };
}

/* ---------- receiving ---------- */

/** Ledger writer — same shape lotService uses. */
async function ledger(inv, { quantity, refId, performedBy, note, session }) {
  await StockMovement.create(
    [
      {
        inventoryId: inv._id,
        productId: inv.productId,
        ownerType: inv.ownerType,
        ownerId: inv.ownerId,
        type: "supply_in",
        channel: "internal",
        quantity,
        balanceAfter: inv.availableStock,
        refType: "Transfer",
        refId,
        performedBy,
        note,
      },
    ],
    session ? { session } : {}
  );
}

/**
 * RECEIVE ONE BOX. Books exactly `units_in_box` onto the destination
 * warehouse's shelves and marks the box received.
 *
 * Duplicate/concurrent protection: the box is claimed with a conditional
 * findOneAndUpdate on `status: "created"`. Only one caller can win that
 * transition, so a second (or simultaneous) scan of the same ID moves no stock
 * and gets ALREADY_RECEIVED. The stock increment is likewise conditional on
 * enough inTransitStock, so quantity can never be added twice.
 */
async function receiveBox(companyId, code, { performedBy, allowedWarehouseIds = null } = {}) {
  // Whole-string match, exactly as findIncomingBox does — never parsed.
  const raw = String(code || "").trim();
  if (!raw) throw httpErr("A Bulk Packaging ID is required.", 400);

  const found = await BulkPackage.findOne({
    company_id: companyId,
    bulk_packaging_id: { $in: [raw, raw.toUpperCase()] },
  });
  if (!found) {
    logIdMiss("bulk packaging id", companyId, raw);
    throw httpErr("Bulk Packaging ID not found.", 404);
  }
  if (found.status === "received") throw httpErr(alreadyReceivedMsg(found), 409);
  if (found.status === "cancelled") throw httpErr("This Bulk Packaging ID has been cancelled.", 409);
  if (Array.isArray(allowedWarehouseIds) && !allowedWarehouseIds.map(String).includes(String(found.warehouse_id))) {
    throw httpErr("This box is not assigned to your warehouse.", 403);
  }

  const { inv, box, qty } = await withTransaction(async (session) => {
    // 1) CLAIM the box. Whoever flips created → received owns this scan; every
    //    other concurrent scan of the same ID fails here and moves nothing.
    const claimed = await BulkPackage.findOneAndUpdate(
      { _id: found._id, status: "created" },
      { $set: { status: "received", received_at: new Date(), received_by: performedBy || null } },
      { new: true, session }
    );
    if (!claimed) throw httpErr(ALREADY_RECEIVED, 409);

    // 1b) CASCADE INTO THE INNER BOXES. Scanning a MAIN carton receives
    //     everything inside it — the inner boxes are not scanned separately,
    //     they arrive nailed into the same crate. Without this they stayed
    //     "created" forever, and pendingBoxCount (which counts inner boxes on a
    //     three-level lot) never reached zero, so a lot whose every unit had
    //     landed was still reported "partially_received".
    //
    //     Only ever cascades DOWNWARDS from the box actually scanned, and only
    //     over inner boxes still awaiting receipt — a cancelled one is left
    //     alone. An inner-box scan changes nothing here, so that path behaves
    //     exactly as before.
    // The boxes whose UNITS THIS SCAN LANDS — and only this scan.
    //
    // A carton's `units_in_box` is a ROLL-UP of the inner boxes inside it, so
    // booking it wholesale double-counts every inner box that was already
    // received on its own: scanning inner box 1 (5 units) and then its parent
    // carton (10) booked 15 for 10 physical units, and the lot's
    // `inTransitStock` stuck at 5 with nothing left to receive.
    //
    // So the quantity is summed from the boxes this scan actually flips — the
    // ones still "created" at the moment it claims them. Already-received inner
    // boxes are skipped: their units were booked when they landed.
    const landedBoxIds = [claimed._id];
    let landedQty = Number(claimed.units_in_box || 0);

    if (claimed.box_level === "main") {
      const inners = await BulkPackage.find({ company_id: companyId, parent_box_id: claimed._id })
        .select("_id status units_in_box")
        .session(session);

      // A main box with NO children holds its units directly — that is every
      // box of a two-level lot — so it keeps its own quantity.
      if (inners.length) {
        // Cancelled inner boxes are never received, so their units never land.
        const landing = inners.filter((b) => b.status === "created");
        if (landing.length) {
          await BulkPackage.updateMany(
            { _id: { $in: landing.map((b) => b._id) } },
            { $set: { status: "received", received_at: claimed.received_at, received_by: performedBy || null } },
            { session }
          );
        }
        landedBoxIds.push(...landing.map((b) => b._id));
        landedQty = landing.reduce((s, b) => s + Number(b.units_in_box || 0), 0);
      }
    }

    // 1c) AND UPWARDS. An inner box is scanned on its own; once the LAST one of
    //     a carton has landed, the carton itself is here — leaving it "created"
    //     made the outer box read as still awaiting a receipt that has already
    //     happened. Only flips when nothing inside is still pending.
    if (claimed.box_level === "inner" && claimed.parent_box_id) {
      const stillPending = await BulkPackage.countDocuments({
        company_id: companyId,
        parent_box_id: claimed.parent_box_id,
        status: "created",
      }).session(session);
      if (stillPending === 0) {
        await BulkPackage.updateOne(
          { _id: claimed.parent_box_id, status: "created" },
          { $set: { status: "received", received_at: claimed.received_at, received_by: performedBy || null } },
          { session }
        );
      }
    }

    // 2) Move exactly what THIS scan landed from in-transit onto the books.
    //
    //    landedQty is 0 when every inner box of the carton had already been
    //    received one by one: their units are on the books, and the scan only
    //    settles the carton's own status. Booking nothing is the correct answer
    //    there — moving stock again is precisely the double count above.
    let doc = await Inventory.findOne({ _id: claimed.lot_id, ownerType: "company", ownerId: companyId })
      .session(session);
    if (!doc) throw httpErr("This box's lot no longer exists.", 409);

    if (landedQty > 0) {
      doc = await Inventory.findOneAndUpdate(
        {
          _id: claimed.lot_id,
          ownerType: "company",
          ownerId: companyId,
          inTransitStock: { $gte: landedQty },
        },
        {
          $inc: { inTransitStock: -landedQty, offlineStock: landedQty, availableStock: landedQty },
          $set: { receivedAt: new Date(), receivedBy: performedBy || null },
        },
        { new: true, session }
      );
      if (!doc) throw httpErr("This box's quantity is no longer awaiting receipt.", 409);

      await ledger(doc, {
        quantity: landedQty,
        refId: doc._id,
        performedBy,
        note: `Box ${claimed.box_serial} (${claimed.bulk_packaging_id}) received into warehouse`,
        session,
      });
    }

    // 3) Roll the lot's receiving status forward. Only when the LAST box lands
    //    does the lot become fully received.
    //
    //    Counted over the boxes that are actually SCANNED — the unit-holding
    //    ones. A three-level lot's outer cartons are not received individually,
    //    so their status stays "created" for the lot's whole life; counting them
    //    would leave every such lot stuck on "partially_received" even after all
    //    ten inner boxes had landed.
    const remaining = await pendingBoxCount(claimed.lot_id, session);
    await Inventory.updateOne(
      { _id: claimed.lot_id },
      { $set: { receiving_status: remaining === 0 ? "received" : "partially_received" } },
      { session }
    );

    // 4) Activate the unit barcodes that belong to this box's share of the lot.
    //    Mirrors lotService.confirmLotReceipt: serials, lot and printed flags are
    //    untouched — only the stock status moves.
    //    THE BOX'S OWN UNITS, not any `qty` units of the lot. Taking the first
    //    N of the lot activated whichever serials happened to sort first, so
    //    receiving carton 2 could mark carton 1's units in stock — the counts
    //    looked right while every per-box list was wrong. `landedBoxIds` is the
    //    scanned box plus, for a main carton, the inner boxes inside it.
    //
    //    A lot whose units were minted before boxes carried this link has none
    //    pointing at the box; those fall back to the original quantity-only
    //    path so legacy receives keep working.
    const scope = {
      ownerType: "company",
      ownerId: companyId,
      inventoryId: claimed.lot_id,
      status: { $in: ["generated", "printed"] },
    };
    const linked = await UnitSerial.countDocuments({
      ...scope,
      bulk_packaging_record_id: { $in: landedBoxIds },
    }).session(session);
    const units = linked > 0
      ? await UnitSerial.find({ ...scope, bulk_packaging_record_id: { $in: landedBoxIds } }).session(session)
      : await UnitSerial.find(scope).limit(landedQty).session(session);
    if (units.length) {
      await UnitSerial.updateMany(
        { _id: { $in: units.map((u) => u._id) } },
        { $set: { status: "in_stock" } },
        { session }
      );
      await UnitEvent.insertMany(
        units.map((u) => ({
          companyId: u.companyId,
          serial: u.serial,
          event: "in_stock",
          fromStatus: u.status,
          toStatus: "in_stock",
          refType: "Transfer",
          refId: claimed.lot_id,
          actorId: performedBy,
        })),
        { session }
      );
    }

    return { inv: doc, box: claimed, qty: landedQty };
  });

  emitInventoryUpdate(inv);

  const summary = await summaryForLot(companyId, box.lot_id);
  return {
    bulkPackagingId: box.bulk_packaging_id,
    boxSerial: box.box_serial,
    receivedUnits: qty,
    lotNumber: box.lot_number,
    inventoryId: box.lot_id,
    receivingStatus: summary && summary.pendingBoxes === 0 ? "received" : "partially_received",
    packaging: summary,
    lot: inv,
  };
}

/** True when this lot is packed into boxes (so the parent lot may not be scanned). */
async function lotHasBoxes(lotId) {
  if (!lotId || !mongoose.Types.ObjectId.isValid(String(lotId))) return false;
  return (await BulkPackage.countDocuments({ lot_id: lotId })) > 0;
}

module.exports = {
  buildBulkPackagingId,
  boxIdFor,
  validateBulkPackaging,
  createBulkPackages,
  listByLot,
  boxesForRow,
  mainBoxesFor,
  lotBoxTotal,
  listMainBoxes,
  unitHoldingBoxes,
  boxesPresentAt,
  boxesAtWarehouse,
  logBoxPresenceMismatch,
  summaryForLot,
  findIncomingBox,
  receiveBox,
  lotHasBoxes,
  positiveInt,
  ALREADY_RECEIVED,
  SCAN_BOXES_SEPARATELY,
  PACKAGING_MISMATCH,
};