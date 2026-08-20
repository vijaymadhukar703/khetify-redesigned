const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const { emitInventoryUpdate, checkLowStock } = require("./inventoryService");
const { withTransaction } = require("./txn");
const { frozenWarehouseIds } = require("./freezeService");
const { generateKhetifyLotNumber, nextLotSerial, formatLotSerial, registerLotNumber, LOT_NUMBER_TAKEN } = require("./lotNumberService");
const {
  validateBulkPackaging,
  createBulkPackages,
  boxIdFor,
  lotHasBoxes,
  summaryForLot,
  SCAN_BOXES_SEPARATELY,
} = require("./bulkPackageService");
const BulkPackage = require("../model/Inventory/BulkPackage");
const { buildMainBoxId } = require("./lotNumberSegmentService");
const { normalizeSegments, buildLotNumber, packagingSpans } = require("./lotNumberSegmentService");
// Unit labels for a boxed lot are minted at creation — see the end of receiveLot.
const { ensureLotUnitLabels } = require("./barcodeService");
const { assertSellerWarehouse, assertCompanyWarehouse } = require("./warehouseOwnershipService");
const { assertWarehouseCapacity } = require("./warehouseCapacityService");

/**
 * Error carrying an HTTP status the controller can surface.
 *
 * NOTE: findPendingLot/confirmLotReceipt below already called httpErr() but it
 * was never defined in this module, so every one of those branches threw
 * "ReferenceError: httpErr is not defined" and the caller saw a 500 instead of
 * the intended message ("Lot not found.", "already been received", …). Defining
 * it here fixes those paths as a side effect of using it in the new code.
 */
function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/* ---------- lot numbering ---------- */

/**
 * Auto lot number used when the operator doesn't type one when creating a lot.
 * Always the Khetify-generated shape:
 *
 *   KH-<COMPANY>-<PRODUCT_CODE>[-BP001~BPnnn]-<YYYY>-<MM>-<DD>-<SKU0001~SKUnnnn>-<SERIAL>
 *   e.g. KH-BHO-PRE498-BP001~BP005-2026-07-25-SKU0001~SKU1000-0001
 *
 * The Bulk Packaging range appears only for a lot packed into boxes; the date is
 * the lot's MANUFACTURING date. The numbering choice is made per-lot in the UI,
 * not as a company-wide setting.
 *
 * Returns { lotNumber, serial, segments } — see services/lotNumberService.js.
 */
async function autoLotNumber(
  companyId,
  { productId, mfgDate, boxCount = 0, innerCount = 0, unitCount = 0, session } = {}
) {
  const { segments, serial } = await generateKhetifyLotNumber(companyId, {
    productId,
    mfgDate,
    boxed: boxCount > 0,
    // A three-level lot has inner boxes as well as main ones, and each level
    // gets its OWN range rather than the two being multiplied into one span.
    nested: innerCount > 0,
    session,
  });
  // Assembled here because only this call knows what the two ranges span: the
  // Bulk Packaging range covers the boxes, the SKU range the lot's quantity.
  // The serial closes it — see generateKhetifyLotNumber for why it is kept.
  const body = buildLotNumber(segments, { boxCount, innerCount, unitCount });
  return { lotNumber: `${body}-${formatLotSerial(serial)}`, serial, segments };
}

/**
 * Lot origins whose numbers are claimed in the LotNumber registry: the lots a
 * human MINTS through Create Lot (Main Company) or Receive Lot (Company
 * Warehouse). A GRN carries the supplier's own lot codes — two suppliers may
 * legitimately reuse a code across products — so GRN postings are left out, as
 * are unlabelled/legacy callers.
 */
const REGISTERED_LOT_ORIGINS = new Set(["company", "warehouse"]);

/**
 * A BOX ID CLASH, named — and told which parts can actually resolve it.
 *
 * The SKU range is deliberately left out of a box ID (a box is not a unit), so
 * changing it cannot separate two lots' boxes. Saying so is the difference
 * between a message the operator can act on and one that sends them in circles.
 */
/**
 * The lot cannot tell its OWN boxes apart. Distinct from MSG_BOX_ID_TAKEN: no
 * other lot is involved, so the parts that usually resolve a clash (Batch, the
 * date) are irrelevant — the number is missing a packaging level.
 */
const MSG_BOX_ID_SELF_CLASH = (boxId) =>
  `This lot would give two different boxes the same Bulk Packaging ID (${boxId}). `
  + "Boxes are packed inside main boxes, so the lot number needs an Inner Box part "
  + "— tick it (set to Variable) so a box and the main box holding it get different IDs.";

const MSG_BOX_ID_TAKEN = (boxId, onLot) =>
  `Bulk Packaging ID ${boxId} is already used by lot ${onLot}. `
  + "A box ID is built from the same parts as the lot number WITHOUT the SKU range, "
  + "so change a part that appears in it — Bulk Packaging, Batch or the date.";

/**
 * The FIRST box ID this lot would mint that another lot already owns, or null.
 *
 * Read-only, and run before anything is written, so a refusal costs nothing. It
 * mints the very IDs createBulkPackages would (boxIdFor / buildMainBoxId), so
 * the two can never disagree about what the clash is.
 *
 * A box belonging to a row of the SAME lot number is not a clash — receiveLot
 * upserts, and a top-up receive into an existing lot re-runs this path while
 * createBulkPackages is idempotent for it.
 */
async function firstTakenBoxId(companyId, { lotNumber, segments, lotSerial, packaging, nestedBoxes, session } = {}) {
  // The shape boxIdFor / buildMainBoxId read a lot through.
  const probe = {
    lotNumber,
    batchNumber: lotNumber,
    lot_number_segments: segments || null,
    lot_number_serial: lotSerial || null,
    packaging_boxes_per_main: nestedBoxes?.boxesPerMain || null,
  };

  const ids = [];
  for (let i = 1; i <= Number(packaging.numberOfBoxes); i += 1) ids.push(boxIdFor(probe, i));
  if (nestedBoxes) {
    for (let i = 1; i <= nestedBoxes.mainBoxes; i += 1) {
      const id = buildMainBoxId(probe, i);
      if (id) ids.push(id);
    }
  }

  // A LOT THAT CLASHES WITH ITSELF — checked before anything is looked up,
  // because no other lot has to exist for this to fail.
  //
  // Every box of a lot needs its own ID, and the number is the only thing that
  // supplies one. When a packaging level has no part in the number, the boxes at
  // that level render identically: a main box states the inner span it holds
  // ("...-IB01~IB03") where an inner box states its own member ("...-IB01"), so
  // with no inner part BOTH come out as the bare value segments and the lot mints
  // the same ID twice.
  //
  // This used to be invisible here — the candidates were de-duplicated into a Set
  // and only compared against OTHER lots — so the collision surfaced from
  // insertMany as a raw E11000 on `bulkpackages`, which lotController can only
  // report as "a Bulk Packaging ID that already exists". It does not exist; the
  // lot is about to create it twice, and no amount of changing the Batch or the
  // date can help. Naming the missing part is the only actionable message.
  //
  // Khetify-generated numbers never reach this: khetifyLotSegments always emits
  // the inner range for a nested lot (services/lotNumberService.js).
  const firstSelfDupe = ids.find((id, i) => id && ids.indexOf(id) !== i);
  if (firstSelfDupe) throw httpErr(MSG_BOX_ID_SELF_CLASH(firstSelfDupe), 400);

  const taken = await BulkPackage.find({
    bulk_packaging_id: { $in: [...new Set(ids.filter(Boolean))] },
    lot_number: { $ne: lotNumber },
  })
    .select("bulk_packaging_id lot_number")
    .session(session || null)
    .lean();

  return taken.length ? { id: taken[0].bulk_packaging_id, lotNumber: taken[0].lot_number } : null;
}

/* Ledger writer (same shape inventoryService uses internally).
 * Pass `session` to enlist the write in an active transaction. */
async function ledger(
  inv,
  { type, channel = "internal", quantity, refType, refId, performedBy, note, session }
) {
  await StockMovement.create(
    [
      {
        inventoryId: inv._id,
        productId: inv.productId,
        ownerType: inv.ownerType,
        ownerId: inv.ownerId,
        type,
        channel,
        quantity,
        balanceAfter: inv.availableStock,
        refType,
        refId,
        performedBy,
        note,
      },
    ],
    session ? { session } : {}
  );
}

const POPULATE_PRODUCT = {
  path: "productId",
  select:
    "productName category unitType unit packagingType mrp brandName skuNumber hsnCode productImages companyId",
  populate: { path: "companyId", select: "companyName" },
};

/* ---------- queries ---------- */

/**
 * All lot rows (batchNumber != null) for an owner, joined with product +
 * warehouse. Owner-aware: defaults to ownerType "company" so the existing
 * company caller is unchanged; sellers pass ownerType "seller".
 */
async function getLots(ownerId, { ownerType = "company", productId, warehouseId, warehouseIds, expiring, expired, excludePending = false, lotOrigin } = {}) {
  const filter = {
    ownerType,
    ownerId,
    batchNumber: { $ne: null },
  };
  // ORIGINAL LOT REGISTER (Main Company Inventory) — opt-in, off by default, so
  // every existing caller keeps the full live list. `lotOrigin: "company"` keeps
  // only lots the Main Company actually minted and drops the destination rows a
  // warehouse→warehouse transfer lands (those copy the source's lot identity
  // verbatim, so they are otherwise indistinguishable), plus warehouse/GRN-created
  // lots and unmigrated rows.
  if (lotOrigin) filter.lotOrigin = lotOrigin;
  // A warehouse must not see (or count) stock it hasn't received yet: hide rows
  // that are purely awaiting receipt (nothing on the books, qty still in
  // transit). A row with some received stock AND more incoming still shows.
  if (excludePending) {
    filter.$nor = [{ inTransitStock: { $gt: 0 }, availableStock: { $lte: 0 } }];
  }
  if (productId) filter.productId = productId;
  if (warehouseId) filter.warehouseId = warehouseId;
  // Warehouse-level access control: restrict to the caller's assigned
  // warehouses (services/warehouseScope.js). Combined with `warehouseId`
  // above via implicit AND, so a scoped user can't widen their view.
  else if (Array.isArray(warehouseIds) && warehouseIds.length) filter.warehouseId = { $in: warehouseIds };

  const now = new Date();
  if (expiring === "true") {
    const horizon = new Date(now.getTime() + 90 * 86400000);
    filter.expiryDate = { $gte: now, $lte: horizon };
    filter.availableStock = { $gt: 0 };
  }
  if (expired === "true") {
    filter.expiryDate = { $lt: now };
    filter.availableStock = { $gt: 0 };
  }

  // Expiry-focused views surface what expires soonest; the default list shows
  // the most recently created lot on top. (Stock rotation FEFO is handled
  // separately in sellFEFO/allocateFEFO and is unaffected.)
  const sort = (expiring === "true" || expired === "true")
    ? { expiryDate: 1 }            // expiry views: soonest-expiring first
    : { createdAt: -1, _id: -1 };  // default: newest lot on top
  return Inventory.find(filter)
    .populate(POPULATE_PRODUCT)
    .populate("warehouseId", "name code address")
    .sort(sort);
}

/* ---------- Company Warehouse: pending receipt ---------- */

/**
 * Find the lot AWAITING RECEIPT at this warehouse, by EXACT parent lot number.
 *
 * Read-only — moves nothing. The scanned string is trimmed and then matched
 * WHOLE against the stored number: it is never parsed, split or pattern-tested,
 * so a composed number carrying "/" or "~", with any number of parts, resolves
 * exactly like a Khetify-generated one. Both the code as scanned and its
 * uppercase form are tried, because stored numbers are uppercase.
 */
async function findPendingLot(companyId, { lotNumber, allowedWarehouseIds = null }) {
  const raw = String(lotNumber || "").trim();
  if (!raw) throw httpErr("Lot not found.", 404);
  const forms = [raw, raw.toUpperCase()];

  const rows = await Inventory.find({
    ownerType: "company", ownerId: companyId,
    $or: [{ lotNumber: { $in: forms } }, { batchNumber: { $in: forms } }],
  })
    .populate("productId", "productName skuNumber")
    .populate("warehouseId", "name code");
  if (!rows.length) {
    // Verbatim, with character codes — a label that encoded a sanitised version
    // of the number looks identical on screen but can never match.
    console.warn(
      "[scan] no match on lot number",
      JSON.stringify({
        company: String(companyId),
        scanned: raw,
        length: raw.length,
        charCodes: [...raw].map((ch) => ch.charCodeAt(0)).join(","),
      })
    );
    throw httpErr("Lot not found.", 404);
  }

  const pending = rows.filter((r) => (r.inTransitStock || 0) > 0);
  if (!pending.length) {
    // The lot exists but nothing is awaiting receipt for it.
    const mineReceived = rows.some((r) =>
      !Array.isArray(allowedWarehouseIds) ||
      allowedWarehouseIds.map(String).includes(String(r.warehouseId?._id || r.warehouseId))
    );
    throw httpErr(mineReceived ? "This transfer has already been received." : "No incoming transfer found for this lot.", 409);
  }

  const mine = Array.isArray(allowedWarehouseIds)
    ? pending.filter((r) => allowedWarehouseIds.map(String).includes(String(r.warehouseId?._id || r.warehouseId)))
    : pending;
  if (!mine.length) throw httpErr("This lot is not assigned to your warehouse.", 403);

  const row = mine[0];
  // BULK PACKAGING: a lot packed into boxes must be received ONE BOX AT A TIME.
  // Scanning the parent lot would book the whole quantity in a single go, which
  // is exactly what the box-by-box flow exists to prevent.
  if (await lotHasBoxes(row._id)) {
    const err = httpErr(SCAN_BOXES_SEPARATELY, 409);
    err.packaging = await summaryForLot(companyId, row._id);
    throw err;
  }

  return {
    inventoryId: row._id,
    lotNumber: row.lotNumber || row.batchNumber,
    batchNumber: row.batchNumber,
    mfgBatchNo: row.mfgBatchNo || null,
    productId: row.productId?._id || row.productId,
    productName: row.productId?.productName || "—",
    warehouseId: row.warehouseId?._id || row.warehouseId,
    destination: row.warehouseId?.name || "—",
    qty: row.inTransitStock,
    mfgDate: row.mfgDate || null,
    expiryDate: row.expiryDate || null,
    status: "awaiting_receipt",
  };
}

/**
 * CONFIRM RECEIPT of a pending lot at the warehouse. Atomically moves the whole
 * in-transit qty onto the books, writes the single `supply_in` ledger row, and
 * activates the lot's already-generated child units (generated/printed →
 * in_stock) — their serial, lotNumber, productId and printed flag are untouched
 * and no unit is created or deleted. Conditional on inTransitStock, so a repeat
 * confirm can never double-add.
 */
async function confirmLotReceipt(companyId, inventoryId, { performedBy, allowedWarehouseIds = null } = {}) {
  const row = await Inventory.findOne({ _id: inventoryId, ownerType: "company", ownerId: companyId });
  if (!row) throw httpErr("Lot not found.", 404);
  if (Array.isArray(allowedWarehouseIds) && !allowedWarehouseIds.map(String).includes(String(row.warehouseId))) {
    throw httpErr("This lot is not assigned to your warehouse.", 403);
  }
  // BULK PACKAGING: never let the whole lot land in one confirm — each box is
  // received by scanning its own Bulk Packaging ID.
  if (await lotHasBoxes(row._id)) throw httpErr(SCAN_BOXES_SEPARATELY, 409);

  const qty = Number(row.inTransitStock || 0);
  if (qty <= 0) throw httpErr("This transfer has already been received.", 409);

  const inv = await withTransaction(async (session) => {
    // Conditional on the exact pending qty — a concurrent/repeat confirm fails.
    const doc = await Inventory.findOneAndUpdate(
      { _id: row._id, ownerType: "company", ownerId: companyId, inTransitStock: { $gte: qty } },
      {
        $inc: { inTransitStock: -qty, offlineStock: qty, availableStock: qty },
        // Single-package lot: this one confirm IS the whole receipt.
        $set: { receivedAt: new Date(), receivedBy: performedBy || null, receiving_status: "received" },
      },
      { new: true, session }
    );
    if (!doc) throw httpErr("This transfer has already been received.", 409);
    await ledger(doc, {
      type: "supply_in", channel: "internal", quantity: qty,
      refType: "Transfer", refId: doc._id, performedBy,
      note: `Lot ${doc.lotNumber || doc.batchNumber} received into warehouse`,
      session,
    });

    // Child units already minted for this lot become available HERE — never
    // before the receipt. Same row, so parent lot + serials are unchanged.
    const units = await UnitSerial.find({
      ownerType: "company", ownerId: companyId, inventoryId: doc._id,
      status: { $in: ["generated", "printed"] },
    }).session(session);
    if (units.length) {
      await UnitSerial.updateMany(
        { _id: { $in: units.map((u) => u._id) } },
        { $set: { status: "in_stock" } },
        { session }
      );
      await UnitEvent.insertMany(
        units.map((u) => ({ companyId: u.companyId, serial: u.serial, event: "in_stock", fromStatus: u.status, toStatus: "in_stock", refType: "Transfer", refId: doc._id, actorId: performedBy })),
        { session }
      );
    }
    return doc;
  });

  emitInventoryUpdate(inv);
  return inv;
}

/* ---------- operations ---------- */

/**
 * Stock-in one lot. Upserts the (product, owner, warehouse, batch) row
 * that the existing unique index already enforces, sets lot metadata,
 * and writes a supply_in ledger entry.
 *
 * If a `session` is passed, the work runs INSIDE that transaction (no new one)
 * — this lets callers like postGRN receive many lots atomically in a single
 * transaction. Without a session it opens its own via withTransaction.
 */
async function receiveLot({
  ownerId,
  productId,
  warehouseId = null,
  lotNumber,
  // Segmented manual entry: the LEADING parts only — the serial is appended
  // here, never sent by the client. Ignored when a full lotNumber is present.
  lotNumberPrefix,
  // COMPOSED manual entry: the ordered parts themselves. Preferred over
  // lotNumberPrefix because the Bulk Packaging / SKU parts render as RANGES
  // whose span is the box count and the lot quantity — values only this call
  // knows. Kept on the row so each box and unit ID descends from the same
  // recipe. See services/lotNumberSegmentService.js.
  lotSegments,
  batchNumber,
  mfgBatchNo,
  expiryDate = null,
  mfgDate = null,
  qty,
  lowStockThreshold,
  performedBy,
  note,
  refType,
  refId,
  unitCost,
  session,
  // Company → Company Warehouse assignment: book the qty to the warehouse as
  // IN TRANSIT instead of stocking it. The warehouse must scan the parent lot
  // and Confirm Receive (confirmLotReceipt) before it becomes available. GRN
  // posting and every other caller leave this false — a GRN *is* the receipt.
  pendingReceipt = false,
  // Provenance of the row this call may INSERT (Inventory.lotOrigin): "company"
  // when the Main Company mints the lot, "warehouse" for a Company Warehouse
  // Receive Lot, "grn" for a GRN posting. Only "company" rows appear on the Main
  // Company original-lot register. Defaults to "unknown" rather than guessing —
  // an unlabelled row is reviewable, a mislabelled one is invisible.
  lotOrigin = "unknown",
  // BULK PACKAGING — the lot is physically packed into `numberOfBoxes` outer
  // boxes of `unitsPerBox` units each. When on, the lot gets one Bulk Packaging
  // ID per box and the warehouse receives it box by box instead of in one go.
  // Off (the default) is the historical single-package behaviour, unchanged.
  hasBulkPackaging = false,
  numberOfBoxes,
  unitsPerBox,
  // THREE-LEVEL PACKAGING. `numberOfBoxes` remains the INNER box count
  // (main × per-main), so every existing reader is untouched; these two say how
  // those inner boxes are grouped. Absent → the historical two-level lot.
  mainBoxes,
  boxesPerMain,
  // Mint every box's unit labels once the lot exists (see the end of this
  // function). Set by the Create Lot / Receive Lot endpoint; off for GRN
  // postings and internal callers, which keep the on-demand labelling flow.
  mintUnitLabels = false,
}) {
  if (!productId || !qty || qty <= 0) {
    const err = new Error("productId, batchNumber and positive qty are required");
    err.status = 400;
    throw err;
  }
  // BULK PACKAGING validation runs FIRST, before a lot number is minted or any
  // stock is touched — a mismatched boxes × units-per-box must cost nothing.
  // This is the authoritative check: the browser form enforces the same rule,
  // but editing the quantity field there cannot get past this.
  const packaging = validateBulkPackaging({ hasBulkPackaging, numberOfBoxes, unitsPerBox, qty });
  // The three-level grouping, only when both counts are given AND they agree
  // with the inner box count the payload already carries.
  const mainCount = Math.trunc(Number(mainBoxes) || 0);
  const perMain = Math.trunc(Number(boxesPerMain) || 0);
  const nestedBoxes = packaging && mainCount > 0 && perMain > 0
    && mainCount * perMain === packaging.numberOfBoxes
    ? { mainBoxes: mainCount, boxesPerMain: perMain }
    : null;

  // Lot number is the SINGLE identity. A manually-typed lotNumber wins; a
  // client-supplied batchNumber is honoured as the lot only when no lotNumber
  // was given (legacy callers) — never as a separate value. When neither is
  // supplied the system auto-generates the Khetify number.
  // The batch column always SHADOWS the lot number so the two can never
  // diverge; it survives only as the unique-index key (CLAUDE.md invariant #3).
  let lot = lotNumber || batchNumber;
  // Manual = the operator typed the number; generated = we mint it. Both end up
  // in the same field, but only one of them is ours to guarantee the shape of.
  let isManualLot = !!lot;
  let lotSerial = null;
  // SEGMENTED MANUAL: the operator chose the leading parts, we own the serial.
  // It comes from the SAME lifetime per-(company, product) counter the Khetify
  // number uses and is allocated inside THIS transaction, so two operators
  // creating a lot at the same instant can never mint the same number. The
  // client cannot supply or influence it.
  // COMPOSED MANUAL: the number is assembled here from the operator's parts so
  // the range parts can state their real spans — Bulk Packaging over the boxes,
  // SKU over the lot quantity.
  //
  // NO SERIAL IS ADDED. The operator defined the whole format, so nothing may be
  // appended that they did not choose. Uniqueness therefore has to be enforced
  // rather than manufactured: the number must be genuinely free, checked below
  // and guaranteed by the registry's unique index.
  let segments = lot ? null : normalizeSegments(lotSegments);
  // Only a HAND-BUILT composed number has no serial and therefore has to be
  // proved unique. A generated one is closed by its serial, so it keeps the
  // ordinary registry behaviour (a re-receive into the same lot is a top-up).
  // Only a HAND-BUILT composed number has no serial and therefore has to be
  // proved unique. A generated one is closed by its serial, so it keeps the
  // ordinary registry behaviour (a re-receive into the same lot is a top-up).
  const composedManual = !!segments;
  if (segments) {
    // Spans come from packagingSpans, the same rule the generated number below
    // uses and the same one the Create Lot preview shows. Passing them by hand
    // here is what made the stored number disagree with the preview: the INNER
    // box count went in as `boxCount`, so the Bulk Packaging range spanned the
    // inner boxes instead of the cartons and the Inner Box part, having no count
    // of its own, rendered as nothing and vanished from the number.
    lot = buildLotNumber(segments, packagingSpans({
      qty,
      numberOfBoxes: packaging?.numberOfBoxes || 0,
      ...(nestedBoxes || {}),
    }));
    if (!lot) throw httpErr("Please fill in at least one part of the lot number.", 400);
    isManualLot = true;

    /**
     * A SERIAL FOR THE BOX AND UNIT IDS — never for the lot number itself.
     *
     * A box ID is the lot number's parts MINUS the SKU range (a box is not a
     * unit), and a unit ID collapses that range to one member starting at 001.
     * So two composed lots differing only in their SKU span — say SKU001~SKU010
     * and SKU001~SKU020 — minted byte-identical box IDs, inner box IDs, main
     * carton IDs AND unit codes. The global unique indexes then refused the
     * second lot, and told the operator to change the one part that cannot
     * possibly help.
     *
     * A KHETIFY-GENERATED lot never had this problem, because its serial closes
     * every derived ID (see withSerial / serialOf). This gives a composed lot
     * the same thing. The LOT NUMBER is untouched — buildLotNumber above has
     * already run and appends no serial, so the operator's format is still
     * theirs in full.
     *
     * Allocated from the SAME lifetime per-(company, product) counter the
     * generated number uses. `nextSeq` is an atomic $inc, so two operators
     * saving at the same instant get different serials and cannot collide.
     *
     * BACKWARD COMPATIBLE BY CONSTRUCTION: a lot created before this has no
     * stored serial, serialOf() returns "", and every one of its printed IDs
     * still reads and scans exactly as it does today.
     */
    lotSerial = await nextLotSerial(ownerId, productId, session);
  }
  if (!lot && lotNumberPrefix) {
    lotSerial = await nextLotSerial(ownerId, productId, session);
    lot = `${String(lotNumberPrefix).trim().toUpperCase()}-${formatLotSerial(lotSerial)}`;
    // The SHAPE is the operator's, so the registry records it as manual — but
    // with the real serial, exactly like a generated number.
    isManualLot = true;
  }
  if (!lot) {
    // KHETIFY-GENERATED. Its ranges span the same things the operator's do — the
    // boxes and the lot quantity — and its segments are kept on the row so each
    // box and unit ID descends from this number exactly as it does in the manual
    // mode. The serial still closes it; nothing here can clash.
    let generated;
    ({ lotNumber: lot, serial: lotSerial, segments: generated } = await autoLotNumber(ownerId, {
      productId,
      mfgDate,
      // Bulk range = the MAIN boxes; inner range = the boxes inside ONE of them.
      // A two-level lot has no inner range and the bulk range spans its boxes,
      // exactly as before. Derived by the same rule as the composed number above
      // so the two shapes can never drift apart again.
      ...packagingSpans({
        qty,
        numberOfBoxes: packaging?.numberOfBoxes || 0,
        ...(nestedBoxes || {}),
      }),
      session,
    }));
    if (!lot) {
      const err = new Error("productId, a lot number and positive qty are required");
      err.status = 400;
      throw err;
    }
    segments = normalizeSegments(generated);
  }
  lotNumber = lot;
  batchNumber = lot;
  const setFields = { lotNumber: lot, batchNumber: lot };
  // Manufacturer/supplier batch number — a SEPARATE, optional, display-only
  // value. It never participates in the lot identity/index, so it can't clash
  // with the batchNumber shadow above. Trimmed; blank → left unset (null).
  if (typeof mfgBatchNo === "string") {
    const trimmed = mfgBatchNo.trim();
    if (trimmed) setFields.mfgBatchNo = trimmed;
  }
  if (expiryDate) setFields.expiryDate = expiryDate;
  if (mfgDate) setFields.mfgDate = mfgDate;
  if (typeof lowStockThreshold === "number") setFields.lowStockThreshold = lowStockThreshold;

  // ORIGINAL LOT REGISTER (immutable). $setOnInsert — never $set — so these are
  // written only when this call actually CREATES the row. receiveLot upserts on
  // the lot identity, so a second receive into the same lot adds stock but must
  // leave the original creation figures alone.
  const insertOnlyFields = { originalQuantity: qty, lotOrigin };
  // The recipe that built this number — generated or hand-composed — kept so
  // each box and unit ID descends from it. Insert-only: the number is the row's
  // identity, so a top-up receive must never re-write how it was formed.
  //
  // `lot_number_serial` closes every BOX and UNIT id this lot mints (withSerial
  // / serialOf), which is what keeps them apart from another lot built out of
  // the same parts. Stored for a composed number as well as a generated one —
  // the LOT NUMBER still carries no serial either way, because buildLotNumber
  // does not add one.
  if (segments) {
    insertOnlyFields.lot_number_segments = segments;
    if (lotSerial) insertOnlyFields.lot_number_serial = lotSerial;
  }
  if (packaging) {
    setFields.has_bulk_packaging = true;
    setFields.number_of_boxes = packaging.numberOfBoxes;
    setFields.units_per_box = packaging.unitsPerBox;
    // How those inner boxes are grouped, so a label can name the main box that
    // holds one. Only on a three-level lot.
    if (nestedBoxes) {
      setFields.packaging_main_boxes = nestedBoxes.mainBoxes;
      setFields.packaging_boxes_per_main = nestedBoxes.boxesPerMain;
    }
  }
  // A lot booked to a warehouse starts out awaiting receipt; one stocked
  // immediately is already on the books. Insert-only so a later top-up receive
  // can't reset a partially-received lot back to "pending".
  if (pendingReceipt) insertOnlyFields.receiving_status = "pending";

  // One Bulk Packaging ID per physical box, minted inside the same transaction
  // as the lot itself. No-op when bulk packaging is off, and idempotent — a
  // second receive into an existing lot row never doubles the boxes up.
  const mintBoxes = async (invDoc, s) => {
    if (!packaging) return;
    await createBulkPackages({
      companyId: ownerId,
      productId,
      lot: invDoc,
      numberOfBoxes: packaging.numberOfBoxes,
      unitsPerBox: packaging.unitsPerBox,
      warehouseId,
      session: s,
    });
  };

  const core = async (s) => {
    // A COMPOSED number has no serial to keep it apart from an earlier lot, so
    // it must be free before anything is written. The registry claim below is
    // the atomic guarantee; this also catches a clash with a lot that never
    // reached the registry (a GRN's supplier code, a legacy row), which would
    // otherwise be silently TOPPED UP by the upsert further down instead of
    // being reported as the duplicate it is.
    if (composedManual) {
      const clash = await Inventory.findOne({
        ownerType: "company",
        ownerId,
        batchNumber: lot,
      })
        .select("_id")
        .session(s || null);
      if (clash) throw httpErr(LOT_NUMBER_TAKEN, 409);
    }

    // A BOX ID THAT IS ALREADY TAKEN — checked here, by name, before anything
    // is written.
    //
    // A box ID is built from the SAME parts as the lot number MINUS the SKU
    // range: a box is not a unit, so it carries no unit number. Two lots that
    // differ only in that range therefore mint IDENTICAL box IDs, and the
    // global unique index on `bulk_packaging_id` refuses the second one.
    //
    // That refusal used to surface as "This lot number already exists" — which
    // is not true and sends the operator to change the one part that cannot
    // help, since the SKU range is not in the box ID at all. Worse, on a
    // standalone MongoDB (no transaction to roll back) the lot could be written
    // and its labels silently fail, leaving a lot with no unit codes.
    if (packaging) {
      const clashingBox = await firstTakenBoxId(ownerId, {
        lotNumber: lot,
        segments,
        // The SAME serial the boxes will actually be minted with, so the probe
        // builds the very IDs createBulkPackages would. Composed lots carry one
        // now too — without it this checked a shape that is no longer minted and
        // reported a clash against every older lot built from the same parts.
        lotSerial,
        packaging,
        nestedBoxes,
        session: s,
      });
      if (clashingBox) throw httpErr(MSG_BOX_ID_TAKEN(clashingBox.id, clashingBox.lotNumber), 409);
    }

    // Claim the number in the lot-number registry (unique index on
    // companyId+lotNumber) BEFORE any stock moves, so a duplicate — typed by
    // hand or produced by a race — is rejected with nothing written. Only lots
    // minted through Create Lot / Receive Lot are claimed; GRN and legacy
    // callers keep their previous behaviour exactly.
    if (REGISTERED_LOT_ORIGINS.has(lotOrigin)) {
      await registerLotNumber({
        companyId: ownerId,
        productId,
        lotNumber: lot,
        source: isManualLot ? "manual" : "khetify",
        serial: lotSerial,
        // A composed number must be genuinely new — not even the same product
        // may re-use it, because there is no serial to tell the two lots apart.
        requireNew: composedManual,
        session: s,
      });
    }

    // Capacity guard: this lot's qty must fit within the destination warehouse's
    // remaining space. Checked inside the txn so it sees earlier lines' stock-in
    // (e.g. a multi-line GRN) and the cap holds cumulatively.
    await assertWarehouseCapacity({ ownerType: "company", ownerId, warehouseId, addQty: qty, session: s });

    // Weighted-average cost: recompute from the pre-receipt row when a unitCost
    // is supplied. Done as a read-then-write within the same session.
    if (typeof unitCost === "number" && unitCost >= 0) {
      const prev = await Inventory.findOne({ productId, ownerType: "company", ownerId, warehouseId, batchNumber }).session(s || null);
      const prevQty = prev ? (prev.offlineStock || 0) + (prev.onlineStock || 0) : 0;
      const prevCost = prev?.costPrice || 0;
      setFields.costPrice = prevQty + qty > 0 ? (prevQty * prevCost + qty * unitCost) / (prevQty + qty) : unitCost;
    }
    // PENDING RECEIPT: book the qty to the warehouse as in-transit only. It is
    // NOT stock yet — no offline/available, and therefore NO ledger row (the
    // ledger tracks stock on the books; the single `supply_in` is written by
    // confirmLotReceipt when the warehouse actually receives it).
    if (pendingReceipt) {
      const pending = await Inventory.findOneAndUpdate(
        { productId, ownerType: "company", ownerId, warehouseId, batchNumber },
        {
          $inc: { inTransitStock: qty },
          $set: { ...setFields, receivedAt: null, receivedBy: null },
          $setOnInsert: insertOnlyFields,
        },
        { new: true, upsert: true, session: s }
      );
      await mintBoxes(pending, s);
      return pending;
    }

    const doc = await Inventory.findOneAndUpdate(
      { productId, ownerType: "company", ownerId, warehouseId, batchNumber },
      {
        $inc: { offlineStock: qty, availableStock: qty },
        $set: setFields,
        $setOnInsert: insertOnlyFields,
      },
      { new: true, upsert: true, session: s }
    );
    await ledger(doc, {
      type: "supply_in",
      channel: "internal",
      quantity: qty,
      refType: refType || "Manual",
      refId,
      performedBy,
      note: note || `Lot ${setFields.lotNumber} received`,
      session: s,
    });
    // Boxes are a PHYSICAL identity, so they exist even when the lot is stocked
    // straight away (nothing to scan-receive, but the labels still print).
    await mintBoxes(doc, s);
    return doc;
  };

  // Run within the caller's transaction if given, else open our own.
  const inv = session ? await core(session) : await withTransaction(core);

  // UNIT LABELS FOR THE WHOLE LOT, minted at creation rather than left for an
  // operator to ask for. Generation fills a boxed lot's boxes in order, so a lot
  // that was only ever partly generated had its first box fully labelled and the
  // rest empty — a received box would then show "No unit labels generated for
  // this box yet" while its neighbour listed all of them.
  //
  // EVERY LOT, not only a boxed one. This was gated on `packaging`, which is
  // null when bulk packaging is off, so a SINGLE-PACKAGE lot was created with no
  // unit labels at all: the Labels page opened on "0 of 10 unit(s) already
  // labelled" and someone had to press Generate by hand, for a lot whose boxed
  // neighbour had been labelled automatically. Nothing about the packaging
  // decides whether a unit deserves an identity.
  //
  // ensureLotUnitLabels is lot-generic — it asks for the shortfall against the
  // lot's created quantity and hands it to generateUnits, which is the very
  // function the manual Generate button calls. So a single-package lot's codes
  // come out in exactly the format they always did; only the trigger is new.
  //
  // OPT-IN (`mintUnitLabels`). Create Lot / Receive Lot asks for it; GRN
  // postings, the seeder and every internal caller keep the on-demand flow,
  // where the Labels page decides how many to print and when.
  //
  // Deliberately AFTER the transaction and best-effort: the lot is already
  // committed, so a label failure must not turn a successful create into a 500.
  // A create that FAILS never reaches this line, so a rolled-back lot can never
  // leave unit codes behind. ensureLotUnitLabels is idempotent and the backfill
  // script runs the same rule, so a lot that misses out here is repairable
  // rather than broken.
  if (mintUnitLabels) {
    try {
      await ensureLotUnitLabels(ownerId, inv._id, { performedBy });
    } catch (err) {
      console.warn(
        "[lot] unit labels not minted at creation",
        JSON.stringify({ lot: inv.lotNumber || inv.batchNumber, inventoryId: String(inv._id), error: err?.message })
      );
    }
  }

  emitInventoryUpdate(inv);
  return inv;
}

/**
 * Move qty of a lot row to another warehouse. Atomic on the source
 * (filter requires availableStock >= qty), upserts the destination row
 * with the same batch/lot/expiry, and writes transfer_out + transfer_in.
 */
async function transferLot({ inventoryId, toWarehouseId, qty, performedBy }) {
  qty = Number(qty);
  if (!inventoryId || !toWarehouseId || !qty || qty <= 0) {
    const err = new Error("inventoryId, toWarehouseId and positive qty are required");
    err.status = 400;
    throw err;
  }
  // Block transfer-OUT from a warehouse under audit freeze.
  const srcRow = await Inventory.findById(inventoryId).select("warehouseId ownerId ownerType");
  if (srcRow) {
    const frozen = await frozenWarehouseIds(srcRow.ownerId);
    if (frozen.has(String(srcRow.warehouseId))) {
      const err = new Error("Source warehouse is under an audit freeze — transfers out are blocked");
      err.status = 409;
      throw err;
    }
    // Capacity guard on the DESTINATION warehouse. Checked BEFORE mutating the
    // source so a rejection never leaves a partial write on a standalone (dev)
    // MongoDB that has no transaction to roll back. A same-warehouse move is a
    // net-zero occupancy change, so it's skipped.
    if (String(srcRow.warehouseId) !== String(toWarehouseId)) {
      await assertWarehouseCapacity({ ownerType: srcRow.ownerType, ownerId: srcRow.ownerId, warehouseId: toWarehouseId, addQty: qty });
    }
  }
  const { src, dest } = await withTransaction(async (session) => {
    const srcDoc = await Inventory.findOneAndUpdate(
      { _id: inventoryId, availableStock: { $gte: qty } },
      { $inc: { offlineStock: -qty, availableStock: -qty } },
      { new: true, session }
    );
    if (!srcDoc) {
      const err = new Error("INSUFFICIENT_STOCK");
      err.status = 409;
      throw err;
    }
    const destDoc = await Inventory.findOneAndUpdate(
      {
        productId: srcDoc.productId,
        ownerType: srcDoc.ownerType,
        ownerId: srcDoc.ownerId,
        warehouseId: toWarehouseId,
        batchNumber: srcDoc.batchNumber,
      },
      {
        $inc: { offlineStock: qty, availableStock: qty },
        $set: { lotNumber: srcDoc.lotNumber, expiryDate: srcDoc.expiryDate },
      },
      { new: true, upsert: true, session }
    );
    await ledger(srcDoc, { type: "transfer_out", quantity: -qty, refType: "Transfer", performedBy, session });
    await ledger(destDoc, { type: "transfer_in", quantity: qty, refType: "Transfer", performedBy, session });
    return { src: srcDoc, dest: destDoc };
  });

  emitInventoryUpdate(src);
  emitInventoryUpdate(dest);
  await checkLowStock(src); // source dropped — may have crossed its threshold
  return { src, dest };
}

/**
 * FEFO sale: deduct qty of a product from its NON-EXPIRED lots,
 * earliest expiry first. Returns the per-lot breakdown so the caller
 * can print it on the invoice / picklist.
 */
async function sellFEFO({ ownerType = "company", ownerId, productId, qty, channel = "offline", refId, performedBy, warehouseId }) {
  qty = Number(qty);
  const now = new Date();
  const lotFilter = {
    productId,
    ownerType,
    ownerId,
    availableStock: { $gt: 0 },
    $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
  };
  if (warehouseId) lotFilter.warehouseId = warehouseId; // restrict to a single store/warehouse
  const allLots = await Inventory.find(lotFilter).sort({ expiryDate: 1 });

  // Lots in a warehouse under audit freeze cannot be picked.
  const frozen = await frozenWarehouseIds(ownerId);
  const lots = allLots.filter((l) => !frozen.has(String(l.warehouseId)));

  const total = lots.reduce((s, l) => s + l.availableStock, 0);
  if (total < qty) {
    const totalAll = allLots.reduce((s, l) => s + l.availableStock, 0);
    if (totalAll >= qty) {
      const err = new Error("Stock is under an audit freeze — selling is blocked until the audit completes");
      err.status = 409;
      throw err;
    }
    const err = new Error(`INSUFFICIENT_STOCK (have ${total}, need ${qty})`);
    err.status = 409;
    throw err;
  }

  const stockField = channel === "online" ? "onlineStock" : "offlineStock";
  const type = channel === "online" ? "sale_online" : "sale_offline";

  // Allocate across lots atomically. The whole deduction either commits or
  // rolls back, so a mid-loop failure can't leave a partial sale. Updated
  // docs are collected and emitted AFTER commit (never emit a rolled-back row).
  const { consumed, touched } = await withTransaction(async (session) => {
    const consumedLocal = [];
    const touchedLocal = [];
    let remaining = qty;

    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.availableStock, remaining);
      const inv = await Inventory.findOneAndUpdate(
        { _id: lot._id, availableStock: { $gte: take } },
        { $inc: { [stockField]: -take, availableStock: -take } },
        { new: true, session }
      );
      if (!inv) continue; // raced; next lot covers it
      remaining -= take;
      consumedLocal.push({ inventoryId: inv._id, lotNumber: inv.lotNumber, batchNumber: inv.batchNumber, qty: take });
      await ledger(inv, {
        type,
        channel,
        quantity: -take,
        refType: "Order",
        refId,
        performedBy,
        note: `FEFO pick from lot ${inv.lotNumber || inv.batchNumber}`,
        session,
      });
      touchedLocal.push(inv);
    }
    if (remaining > 0) {
      const err = new Error("CONCURRENT_STOCK_CHANGE — retry");
      err.status = 409;
      throw err;
    }
    return { consumed: consumedLocal, touched: touchedLocal };
  });

  for (const inv of touched) {
    emitInventoryUpdate(inv);
    await checkLowStock(inv); // lot dropped — may have crossed its threshold
  }
  return consumed;
}

/**
 * FEFO RESERVE: move qty of a product from available → reserved across its
 * non-expired, non-frozen lots (earliest expiry first), recording the per-lot
 * allocation so dispatch can commit exactly what was reserved. Returns the
 * allocation array to store on the order line.
 */
async function allocateFEFO({ ownerType = "company", ownerId, productId, qty, refId, refType = "Order", performedBy, warehouseId }) {
  qty = Number(qty);
  const now = new Date();
  const allLots = await Inventory.find({
    productId,
    ownerType,
    ownerId,
    ...(warehouseId ? { warehouseId } : {}), // restrict to a single source warehouse (supply)
    availableStock: { $gt: 0 },
    $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
  }).sort({ expiryDate: 1 });

  const frozen = await frozenWarehouseIds(ownerId);
  const lots = allLots.filter((l) => !frozen.has(String(l.warehouseId)));
  const total = lots.reduce((s, l) => s + l.availableStock, 0);
  if (total < qty) {
    const totalAll = allLots.reduce((s, l) => s + l.availableStock, 0);
    const err = new Error(totalAll >= qty ? "Stock is under an audit freeze" : `INSUFFICIENT_STOCK (have ${total}, need ${qty})`);
    err.status = 409;
    throw err;
  }

  const { allocations, touched } = await withTransaction(async (session) => {
    const allocs = [];
    const touchedLocal = [];
    let remaining = qty;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.availableStock, remaining);
      const inv = await Inventory.findOneAndUpdate(
        { _id: lot._id, availableStock: { $gte: take } },
        { $inc: { reservedStock: take, availableStock: -take } },
        { new: true, session }
      );
      if (!inv) continue;
      remaining -= take;
      allocs.push({ inventoryId: inv._id, lotNumber: inv.lotNumber, batchNumber: inv.batchNumber, warehouseId: inv.warehouseId, qty: take, committed: false, serials: [] });
      await ledger(inv, { type: "reserve", channel: "internal", quantity: -take, refType, refId, performedBy, note: `Reserve from lot ${inv.lotNumber || inv.batchNumber}`, session });
      touchedLocal.push(inv);
    }
    if (remaining > 0) {
      const err = new Error("CONCURRENT_STOCK_CHANGE — retry");
      err.status = 409;
      throw err;
    }
    return { allocations: allocs, touched: touchedLocal };
  });

  for (const inv of touched) emitInventoryUpdate(inv);
  return allocations;
}

/**
 * PLAN which lot(s) will fulfil `qty` — the READ-ONLY twin of allocateFEFO.
 * Moves NO stock and writes NO ledger row.
 *
 * Used by SUPPLY APPROVAL, which is AUTHORIZATION ONLY: it records the intended
 * source lot(s) so the warehouse knows what to pick, but the stock must stay
 * fully available until the warehouse actually PICKS it (reserveLotQty).
 * Availability here is an advisory pre-check; the authoritative check is the
 * conditional reserve at pick.
 *
 * Pass `inventoryId` to plan ONE specific parent lot; omit it for FEFO order.
 */
async function planAllocation({ ownerType = "company", ownerId, productId, qty, warehouseId, inventoryId }) {
  qty = Number(qty);
  if (!qty || qty <= 0) { const e = new Error("A positive qty is required"); e.status = 400; throw e; }
  const now = new Date();

  let lots;
  if (inventoryId) {
    const lot = await Inventory.findOne({ _id: inventoryId, ownerType, ownerId });
    if (!lot) { const e = new Error("Selected lot not found"); e.status = 404; throw e; }
    if (warehouseId && String(lot.warehouseId) !== String(warehouseId)) {
      const e = new Error("Selected lot is not in the chosen source warehouse"); e.status = 400; throw e;
    }
    lots = [lot];
  } else {
    lots = await Inventory.find({
      productId, ownerType, ownerId,
      ...(warehouseId ? { warehouseId } : {}),
      availableStock: { $gt: 0 },
      $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
    }).sort({ expiryDate: 1 });
  }

  const frozen = await frozenWarehouseIds(ownerId);
  lots = lots.filter((l) => !frozen.has(String(l.warehouseId)));
  const total = lots.reduce((s, l) => s + (l.availableStock || 0), 0);
  if (total < qty) { const e = new Error(`INSUFFICIENT_STOCK (have ${total}, need ${qty})`); e.status = 409; throw e; }

  const allocs = [];
  let remaining = qty;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.availableStock, remaining);
    remaining -= take;
    allocs.push({
      inventoryId: lot._id, lotNumber: lot.lotNumber, batchNumber: lot.batchNumber,
      warehouseId: lot.warehouseId, qty: take, reservedQty: 0, committed: false, serials: [],
    });
  }
  return allocs;
}

/**
 * RESERVE `qty` on ONE lot — this is the moment stock stops being available.
 * Called at PICK (not at approval). Atomic + conditional on availableStock, so
 * two picks can never reserve the same units. Writes one `reserve` ledger row.
 */
async function reserveLotQty({ ownerType = "company", ownerId, inventoryId, qty, refType = "SupplyOrder", refId, performedBy, session }) {
  qty = Number(qty);
  if (!qty || qty <= 0) return null;
  const run = async (s) => {
    const inv = await Inventory.findOneAndUpdate(
      { _id: inventoryId, ownerType, ownerId, availableStock: { $gte: qty } },
      { $inc: { reservedStock: qty, availableStock: -qty } },
      { new: true, session: s }
    );
    if (!inv) { const e = new Error("INSUFFICIENT_STOCK — this lot no longer has enough available stock"); e.status = 409; throw e; }
    await ledger(inv, { type: "reserve", channel: "internal", quantity: -qty, refType, refId, performedBy, note: `Reserve from lot ${inv.lotNumber || inv.batchNumber}`, session: s });
    return inv;
  };
  const inv = session ? await run(session) : await withTransaction(run);
  emitInventoryUpdate(inv);
  return inv;
}

/**
 * RELEASE `qty` reserved on ONE lot back to available (cancel BEFORE dispatch).
 * Never called once an allocation is committed (dispatched) — those goods have
 * physically left and only the return flow may bring them back.
 */
async function releaseLotQty({ ownerType = "company", ownerId, inventoryId, qty, refType = "SupplyOrder", refId, performedBy }) {
  qty = Number(qty);
  if (!qty || qty <= 0) return null;
  const inv = await withTransaction(async (session) => {
    const row = await Inventory.findOneAndUpdate(
      { _id: inventoryId, ownerType, ownerId, reservedStock: { $gte: qty } },
      { $inc: { reservedStock: -qty, availableStock: qty } },
      { new: true, session }
    );
    if (!row) return null; // nothing reserved to release
    await ledger(row, { type: "release", channel: "internal", quantity: qty, refType, refId, performedBy, note: `Release lot ${row.lotNumber || row.batchNumber}`, session });
    return row;
  });
  if (inv) emitInventoryUpdate(inv);
  return inv;
}

/**
 * Reserve `qty` from ONE specific lot (Inventory row) — the lot-specific
 * counterpart to allocateFEFO. Used when the operator chooses the exact PARENT
 * LOT to fulfil from (e.g. a lot-specific company → seller transfer), so the
 * reserved allocation IS that lot and its child unit serials validate at pick
 * (the pick checks unit.inventoryId ∈ the order's reserved allocations).
 *
 * Same reservation semantics as FEFO: availableStock → reservedStock, one
 * `reserve` ledger row, identical allocation shape. Reserves NOTHING extra —
 * this does not create stock; it just moves the lot's available into reserved.
 */
async function allocateFromLot({ ownerType = "company", ownerId, inventoryId, qty, warehouseId, refId, refType = "SupplyOrder", performedBy }) {
  qty = Number(qty);
  if (!inventoryId || !qty || qty <= 0) {
    const err = new Error("inventoryId and a positive qty are required");
    err.status = 400;
    throw err;
  }
  const lot = await Inventory.findOne({ _id: inventoryId, ownerType, ownerId });
  if (!lot) { const err = new Error("Selected lot not found"); err.status = 404; throw err; }
  // The chosen lot must sit in the assigned source warehouse.
  if (warehouseId && String(lot.warehouseId) !== String(warehouseId)) {
    const err = new Error("Selected lot is not in the chosen source warehouse"); err.status = 400; throw err;
  }
  const frozen = await frozenWarehouseIds(ownerId);
  if (frozen.has(String(lot.warehouseId))) { const err = new Error("Selected lot is under an audit freeze"); err.status = 409; throw err; }
  if ((lot.availableStock || 0) < qty) {
    const err = new Error(`INSUFFICIENT_STOCK (lot has ${lot.availableStock || 0}, need ${qty})`); err.status = 409; throw err;
  }

  const { allocations, touched } = await withTransaction(async (session) => {
    const inv = await Inventory.findOneAndUpdate(
      { _id: lot._id, availableStock: { $gte: qty } },
      { $inc: { reservedStock: qty, availableStock: -qty } },
      { new: true, session }
    );
    if (!inv) { const err = new Error("CONCURRENT_STOCK_CHANGE — retry"); err.status = 409; throw err; }
    await ledger(inv, { type: "reserve", channel: "internal", quantity: -qty, refType, refId, performedBy, note: `Reserve from lot ${inv.lotNumber || inv.batchNumber}`, session });
    return {
      allocations: [{ inventoryId: inv._id, lotNumber: inv.lotNumber, batchNumber: inv.batchNumber, warehouseId: inv.warehouseId, qty, committed: false, serials: [] }],
      touched: [inv],
    };
  });
  for (const inv of touched) emitInventoryUpdate(inv);
  return allocations;
}

/**
 * COMMIT a stored allocation on dispatch: reserved → out of the channel bucket
 * (the actual sale). Writes a sale ledger row per lot. Idempotent per
 * allocation via the `committed` flag (caller sets it after success).
 */
// ownerType is accepted for API symmetry with the other FEFO helpers; commit
// targets specific inventory _ids (already owner-bound), so it needs no filter.
async function commitAllocation({ ownerType = "company", ownerId, allocations, channel = "offline", refId, performedBy }) {
  const stockField = channel === "online" ? "onlineStock" : "offlineStock";
  const type = channel === "online" ? "sale_online" : "sale_offline";
  return withTransaction(async (session) => {
    for (const a of allocations) {
      if (a.committed) continue;
      const inv = await Inventory.findOneAndUpdate(
        { _id: a.inventoryId, reservedStock: { $gte: a.qty } },
        { $inc: { reservedStock: -a.qty, [stockField]: -a.qty } },
        { new: true, session }
      );
      if (!inv) {
        const err = new Error("NO_RESERVATION to commit (was it already dispatched?)");
        err.status = 409;
        throw err;
      }
      a.committed = true;
      await ledger(inv, { type, channel, quantity: -a.qty, refType: "Order", refId, performedBy, note: `Dispatch from lot ${a.lotNumber || a.batchNumber}`, session });
      emitInventoryUpdate(inv);
    }
    return allocations;
  });
}

/**
 * COMMIT a SUPPLY allocation on dispatch (company → seller). Like
 * commitAllocation, but the goods go to another owner rather than being sold:
 * reserved → out of offlineStock, and the ledger row is `supply_out` with
 * refType "SupplyOrder" (never `sale_*`, so company sales analytics stay clean
 * — CLAUDE.md). availableStock is unchanged: it was already reduced when the
 * stock was reserved at approval, and here reservedStock and offlineStock both
 * drop by qty, so online+offline−reserved holds. The seller side lands the
 * matching `supply_in` at scan-verified receipt.
 */
async function commitSupplyAllocation({ ownerId, allocations, refId, performedBy }) {
  return withTransaction(async (session) => {
    for (const a of allocations) {
      if (a.committed) continue;
      const qty = a.qty ?? a.quantity;
      const inv = await Inventory.findOneAndUpdate(
        { _id: a.inventoryId, reservedStock: { $gte: qty } },
        { $inc: { reservedStock: -qty, offlineStock: -qty } },
        { new: true, session }
      );
      if (!inv) {
        const err = new Error("NO_RESERVATION to dispatch (was the supply already dispatched?)");
        err.status = 409;
        throw err;
      }
      a.committed = true;
      await ledger(inv, { type: "supply_out", channel: "internal", quantity: -qty, refType: "SupplyOrder", refId, performedBy, note: `Supply dispatch from lot ${a.lotNumber || a.batchNumber}`, session });
      emitInventoryUpdate(inv);
    }
    return allocations;
  });
}

/**
 * RELEASE a stored allocation (order cancelled before dispatch):
 * reserved → available again. Only releases not-yet-committed allocations.
 */
async function releaseAllocation({ ownerType = "company", ownerId, allocations, refId, performedBy }) {
  return withTransaction(async (session) => {
    for (const a of allocations) {
      if (a.committed) continue;
      const inv = await Inventory.findOneAndUpdate(
        { _id: a.inventoryId, reservedStock: { $gte: a.qty } },
        { $inc: { reservedStock: -a.qty, availableStock: a.qty } },
        { new: true, session }
      );
      if (!inv) continue; // nothing to release
      await ledger(inv, { type: "release", channel: "internal", quantity: a.qty, refType: "Order", refId, performedBy, note: `Release lot ${a.lotNumber || a.batchNumber}`, session });
      emitInventoryUpdate(inv);
    }
    return allocations;
  });
}

/**
 * SUPPLY TRANSFER (company → seller): lot-accurate, atomic, traceable.
 *
 * FEFO-consumes the company's earliest-expiry non-expired, non-frozen lots
 * FROM THE ASSIGNED SOURCE WAREHOUSE only, and MIRRORS each consumed lot into
 * the seller's destination warehouse, PRESERVING the company's lotNumber /
 * batchNumber / expiryDate / mfgDate (farm-to-dealer traceability). Company
 * side writes `supply_out`, the seller side `supply_in`, both with refType
 * "SupplyOrder" — never `sale_*`, so company sales analytics stay clean.
 * Everything runs in ONE transaction; any shortfall throws 409 and rolls back.
 *
 * onlineStock / reservedStock are untouched on both sides, so
 * availableStock = online + offline − reserved holds throughout.
 *
 * Returns [{ productId, lots: [{ lotNumber, qty }] }].
 */
async function supplyTransfer({ companyId, sellerId, sourceWarehouseId, destWarehouseId, items, refId, performedBy }) {
  if (!companyId || !sellerId || !destWarehouseId) {
    const err = new Error("companyId, sellerId and destWarehouseId are required");
    err.status = 400;
    throw err;
  }
  if (!sourceWarehouseId) {
    const err = new Error("A source warehouse must be assigned to fulfil this supply");
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("items[] are required");
    err.status = 400;
    throw err;
  }
  // The source must be a company warehouse; the destination a seller warehouse.
  await assertCompanyWarehouse(companyId, sourceWarehouseId);
  await assertSellerWarehouse(sellerId, destWarehouseId);

  const now = new Date();
  const frozen = await frozenWarehouseIds(companyId);

  const { summary, touched } = await withTransaction(async (session) => {
    const summaryLocal = [];
    const touchedLocal = [];

    for (const item of items) {
      const productId = item.productId;
      let remaining = Number(item.quantity);
      if (!productId || !remaining || remaining <= 0) {
        const err = new Error("each item needs a productId and a positive quantity");
        err.status = 400;
        throw err;
      }

      // Company lots IN THE ASSIGNED SOURCE WAREHOUSE, FEFO (earliest expiry
      // first), non-expired, non-frozen.
      const allLots = await Inventory.find({
        productId,
        ownerType: "company",
        ownerId: companyId,
        warehouseId: sourceWarehouseId,
        availableStock: { $gt: 0 },
        $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
      }).sort({ expiryDate: 1 }).session(session);
      const lots = allLots.filter((l) => !frozen.has(String(l.warehouseId)));

      const total = lots.reduce((s, l) => s + l.availableStock, 0);
      if (total < remaining) {
        const err = new Error(`INSUFFICIENT_STOCK (have ${total}, need ${remaining})`);
        err.status = 409;
        throw err;
      }

      const perItemLots = [];
      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(lot.availableStock, remaining);

        // Capacity guard on the seller's destination warehouse, BEFORE moving
        // any stock (so a standalone/dev MongoDB with no rollback can't be left
        // with a partial move). The running increments from earlier lots in
        // this same session are counted via the occupancy read.
        await assertWarehouseCapacity({ ownerType: "seller", ownerId: sellerId, warehouseId: destWarehouseId, addQty: take, session });

        // Company OUT — guarded decrement so a race can't oversell.
        const srcDoc = await Inventory.findOneAndUpdate(
          { _id: lot._id, availableStock: { $gte: take } },
          { $inc: { offlineStock: -take, availableStock: -take } },
          { new: true, session }
        );
        if (!srcDoc) continue; // raced; a later lot covers it
        remaining -= take;
        await ledger(srcDoc, {
          type: "supply_out", channel: "internal", quantity: -take,
          refType: "SupplyOrder", refId, performedBy,
          note: `Supply out lot ${srcDoc.lotNumber || srcDoc.batchNumber} → seller`,
          session,
        });
        touchedLocal.push(srcDoc);

        // Seller IN — mirror the lot identity into the seller's warehouse.
        const destDoc = await Inventory.findOneAndUpdate(
          { productId, ownerType: "seller", ownerId: sellerId, warehouseId: destWarehouseId, batchNumber: srcDoc.batchNumber },
          {
            $inc: { offlineStock: take, availableStock: take },
            $setOnInsert: { lotNumber: srcDoc.lotNumber, expiryDate: srcDoc.expiryDate, mfgDate: srcDoc.mfgDate },
          },
          { new: true, upsert: true, session }
        );
        await ledger(destDoc, {
          type: "supply_in", channel: "internal", quantity: take,
          refType: "SupplyOrder", refId, performedBy,
          note: `Supply in lot ${destDoc.lotNumber || destDoc.batchNumber} ← company`,
          session,
        });
        touchedLocal.push(destDoc);

        // UNIT-LEVEL TRANSFER (Phase 4b): the LABELED portion of this lot moves
        // with the goods. Re-point up to `take` available units of the company
        // lot to the seller (same serials — globally unique, never re-minted),
        // and log a per-unit event. Any unlabeled remainder stays as the
        // lot-level seller stock upserted above. Sellers never mint serials.
        const movable = await UnitSerial.find({
          ownerType: "company", ownerId: companyId, inventoryId: srcDoc._id,
          status: { $in: ["generated", "printed", "in_stock"] },
        }).limit(take).session(session);
        if (movable.length) {
          const ids = movable.map((u) => u._id);
          await UnitSerial.updateMany(
            { _id: { $in: ids } },
            { $set: { ownerType: "seller", ownerId: sellerId, inventoryId: destDoc._id, currentLocationId: null, status: "in_stock" } },
            { session }
          );
          await UnitEvent.insertMany(
            movable.map((u) => ({
              companyId: u.companyId, serial: u.serial, event: "supplied_to_seller",
              fromStatus: u.status, toStatus: "in_stock", refType: "SupplyOrder", refId, actorId: performedBy,
            })),
            { session }
          );
        }

        perItemLots.push({ lotNumber: srcDoc.lotNumber || srcDoc.batchNumber, qty: take });
      }

      if (remaining > 0) {
        const err = new Error("CONCURRENT_STOCK_CHANGE — retry");
        err.status = 409;
        throw err;
      }
      summaryLocal.push({ productId, lots: perItemLots });
    }

    return { summary: summaryLocal, touched: touchedLocal };
  });

  // Post-commit side effects (never emit a rolled-back row).
  for (const inv of touched) {
    emitInventoryUpdate(inv);
    await checkLowStock(inv);
  }
  return summary;
}

module.exports = { getLots, receiveLot, findPendingLot, confirmLotReceipt, transferLot, sellFEFO, allocateFEFO, allocateFromLot, planAllocation, reserveLotQty, releaseLotQty, commitAllocation, commitSupplyAllocation, releaseAllocation, supplyTransfer, generateKhetifyLotNumber, autoLotNumber };