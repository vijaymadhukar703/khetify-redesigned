/**
 * sellerDispatchScanService.js — the scan-out step for a SELLER
 * WAREHOUSE → WAREHOUSE transfer.
 *
 * ── WHAT THIS IS ──
 * The seller mirror of services/dispatchScanService.js, rule for rule. The
 * company version counts UNITS AGAINST WHAT THE SHIPMENT REQUIRES, per product:
 *
 *   Bulk Packaging ID → every available unit in that carton, but ONLY when the
 *                       shipment still needs all of them. A 3-unit box against a
 *                       1-unit requirement is refused: the carton is not going
 *                       out, so its ID must not tick off that unit.
 *   Main Box ID       → cascades through the inner boxes nailed inside it
 *   Inner Box ID      → that box
 *   Lot Number        → every available unit of an unboxed lot, same
 *                       all-or-nothing rule
 *   Unit Code         → one unit
 *
 * ── WHY IT IS A SEPARATE FILE ──
 * dispatchScanService is hard-scoped to a company on every single query
 * (`Shipment.findOne({ _id, companyId })`, `UnitSerial.find({ companyId, … })`,
 * `Inventory.find({ ownerType: "company", ownerId: companyId })`). Making it
 * owner-polymorphic would mean editing the module the entire company warehouse
 * dispatches through. Company behaviour must stay exactly as it is, so this is
 * a seller-only implementation reached only from seller routes.
 *
 * ── WHAT IS SHARED ──
 * The pure, write-free LOOKUP helpers in services/packagingScanService.js —
 * `norm`, `matchEither`, `codeVariants` and the main-box cascade
 * `unitHolderIds`. Those answer "what does this code refer to?" and nothing
 * else, so a carton is read identically on both sides. BulkPackage rows carry
 * no seller key (a box belongs to the ORIGINATING company for life), so a box
 * is resolved by its ID and then proven to be the seller's by the ownership of
 * the UNITS inside it — the same rule sellerPickScanService already uses.
 *
 * NOTHING HERE WRITES. `resolveDispatchScan` is read-only, and
 * `assertDispatchScanned` only re-derives and refuses.
 */

const Shipment = require("../model/Transport/Shipment");
const Inventory = require("../model/Inventory/Inventory");
const Product = require("../model/Company/productModel");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const { norm, matchEither, codeVariants, unitHolderIds } = require("./packagingScanService");

function httpErr(message, status = 400, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

/** A unit may only be scanned out while it is on the shelf here. */
const PICKABLE = "in_stock";

/** The operator-facing reference for a shipment ("SH-EA951F"). */
const refOf = (shipment) =>
  shipment.lrNumber || `SH-${String(shipment._id).slice(-6).toUpperCase()}`;

const MSG = {
  notOnShipment: (code, ref) => `${code} is not on transfer ${ref}.`,
  duplicate: (code) => `${code} has already been scanned.`,
  unknown: (code) => `Unknown code "${code}".`,
  partialBox: (need, have, id) =>
    `This transfer needs ${need} of ${have} units from ${id}. Scan the individual unit codes instead.`,
  partialLot: (need, have, number) =>
    `This transfer needs ${need} of ${have} units from ${number}. Scan the individual unit codes instead.`,
  nothingLeft: "Every unit this transfer requires has already been scanned.",
  noneEligible: (id) => `No available units in ${id} — they are already scanned or unavailable.`,
  notInStock: (code, status) => `${code} is not available (${status}).`,
  noUnits: (number) =>
    `Lot ${number} has no unit labels, so it cannot be scanned out. Generate its labels first.`,
  wrongWarehouse: (label) =>
    `${label} is not held at this transfer's source warehouse. Only stock here can be sent.`,
  notReceived: (label) => `${label} was dispatched here but not received yet. Receive it before sending.`,
  incomplete: (scanned, total) =>
    `Scan every unit before dispatching — ${scanned} of ${total} scanned.`,
};

/**
 * Only a SELLER warehouse→warehouse transfer gets this step. A customer
 * shipment (toType "customer") is deliberately excluded: it keeps its own
 * Send Stock scan → box → delivery-label → dispatch-order flow, untouched.
 */
const isSellerWarehouseTransfer = (shipment) =>
  shipment?.ownerType === "seller" && shipment?.toType === "warehouse" && !!shipment?.toWarehouseId;

async function loadShipment(sellerId, shipmentId) {
  const shipment = await Shipment.findOne({ _id: shipmentId, ownerType: "seller", ownerId: sellerId });
  if (!shipment) throw httpErr("Shipment not found", 404);
  if (!isSellerWarehouseTransfer(shipment)) {
    throw httpErr("This shipment is not a warehouse transfer", 400);
  }
  return shipment;
}

const LOT_FIELDS = "lotNumber batchNumber warehouseId productId availableStock inTransitStock";

/**
 * What this transfer is: how many units of each PRODUCT it must carry, and
 * WHICH LOTS may be scanned against it.
 *
 * THE TWO ARE NOT THE SAME QUESTION. The planned lines are an ALLOCATION — the
 * transfer form asks only for a product and a quantity, and the server splits
 * that across the source warehouse's lots earliest-expiry-first
 * (sellerTransferService.planTransferLines). They say HOW MUCH is going,
 * decided before anyone walked to a shelf; they cannot say which physical
 * cartons the operator will reach for.
 *
 * So the REQUIRED QUANTITIES come from the plan, but the scannable lots are
 * every seller lot of those products sitting in the source warehouse. Nothing
 * is loosened: each scan still runs the same held-here checks, still counts
 * against the planned quantity, and the dispatch rewrites its lines from what
 * was actually scanned — so what leaves is what the operator picked, deducted
 * from the lots it truly came out of.
 */
async function shipmentContext(sellerId, shipment) {
  const lines = (shipment.lines || []).filter((l) => l.inventoryId);
  const lotIds = [...new Set(lines.map((l) => String(l.inventoryId)))];
  const lots = await Inventory.find({
    _id: { $in: lotIds }, ownerType: "seller", ownerId: sellerId,
  }).select(LOT_FIELDS);

  const lotById = new Map(lots.map((l) => [String(l._id), l]));

  // REQUIRED IS READ OFF THE PLAN ONLY.
  const required = new Map();
  for (const line of lines) {
    const lot = lotById.get(String(line.inventoryId));
    const pid = String(line.productId || lot?.productId || "");
    if (!pid) continue;
    required.set(pid, (required.get(pid) || 0) + Number(line.qty || 0));
  }

  const fromWarehouseId = shipment.fromWarehouseId ? String(shipment.fromWarehouseId) : null;

  // EVERY OTHER SELLER LOT OF THE SAME PRODUCTS IN THAT WAREHOUSE. Scoped by
  // owner, product and warehouse, so a lot of another product, another seller
  // or another warehouse is still refused exactly as before.
  if (fromWarehouseId && required.size) {
    const siblings = await Inventory.find({
      ownerType: "seller",
      ownerId: sellerId,
      productId: { $in: [...required.keys()] },
      warehouseId: fromWarehouseId,
      _id: { $nin: [...lotById.keys()] },
    }).select(LOT_FIELDS);
    for (const lot of siblings) lotById.set(String(lot._id), lot);
  }

  return { sellerId: String(sellerId), ref: refOf(shipment), lotById, required, fromWarehouseId };
}

/** The lot must be in the source warehouse and actually on the shelf. */
function assertLotOnShelf(ctx, lot, label) {
  if (ctx.fromWarehouseId && String(lot.warehouseId) !== ctx.fromWarehouseId) {
    throw httpErr(MSG.wrongWarehouse(label), 403, { code: "WRONG_WAREHOUSE" });
  }
  if (Number(lot.availableStock || 0) <= 0 && Number(lot.inTransitStock || 0) > 0) {
    throw httpErr(MSG.notReceived(label), 409, { code: "NOT_RECEIVED" });
  }
}

/** The product rows the dialog renders, in the transfer's own order. */
async function dispatchChecklist(sellerId, shipmentId) {
  const shipment = await loadShipment(sellerId, shipmentId);
  const ctx = await shipmentContext(sellerId, shipment);

  const products = await Product.find({ _id: { $in: [...ctx.required.keys()] } })
    .select("productName")
    .lean();
  const nameById = new Map(products.map((p) => [String(p._id), p.productName]));

  // THE DELIVERY CHALLAN ALREADY ON THIS TRANSFER, if any. Captured when the
  // transfer was raised (New Transfer) or at a previous visit to this dialog.
  // Read from the SAME two fields the transfer table renders — the shipment's
  // own `deliveryChallanNumber` and `challanDocument` — so the dialog and the
  // table can never disagree about whether the paperwork is in place. The link
  // is resolved from the stored key at read time, never persisted.
  const challanDocumentUrl = shipment.challanDocument?.key
    ? await require("./fileService").signedUrl(shipment.challanDocument.key)
    : null;

  return {
    shipmentId: String(shipment._id),
    ref: ctx.ref,
    status: shipment.status,
    fromWarehouseId: ctx.fromWarehouseId,
    fromLabel: shipment.fromLabel || null,
    toWarehouseId: shipment.toWarehouseId ? String(shipment.toWarehouseId) : null,
    toLabel: shipment.toLabel || null,
    challanNumber: shipment.deliveryChallanNumber || null,
    challanDocumentName: shipment.challanDocument?.name || null,
    challanDocumentUrl,
    // Dispatch is blocked until BOTH are present — the dialog reads this rather
    // than re-deriving the rule, so the button and the server agree.
    challanComplete: !!(shipment.deliveryChallanNumber && shipment.challanDocument?.key),
    items: [...ctx.required.entries()].map(([productId, requiredQty]) => ({
      productId,
      name: nameById.get(productId) || "Item",
      requiredQty,
      // Every row here is driven by scanning — there is no typed-quantity path.
      trackSerial: true,
    })),
  };
}

/**
 * The units already scanned, counted PER PRODUCT. Resolved from the database,
 * never from what the client says they add up to.
 */
async function countSelected(sellerId, selectedCodes, ctx) {
  const codes = [...new Set((selectedCodes || []).map(norm).filter(Boolean))];
  if (!codes.length) return { set: new Set(), byProduct: new Map() };

  // Queried with BOTH spellings: a mixed-case serial ("…BPinner01…") is not
  // found by its upper-cased form alone.
  const units = await UnitSerial.find({
    ownerType: "seller", ownerId: sellerId, serial: { $in: codeVariants(selectedCodes) },
  }).select("serial inventoryId").lean();

  const byProduct = new Map();
  for (const u of units) {
    const lot = ctx.lotById.get(String(u.inventoryId));
    if (!lot) continue;
    const pid = String(lot.productId);
    byProduct.set(pid, (byProduct.get(pid) || 0) + 1);
  }
  return { set: new Set(codes), byProduct };
}

/** How many more units of this product the transfer still needs. */
function remainingFor(ctx, productId, selected) {
  const need = ctx.required.get(String(productId)) || 0;
  return Math.max(0, need - (selected.byProduct.get(String(productId)) || 0));
}

/** Units of this lot that are on the shelf here and could go out. */
function eligibleUnits(sellerId, lotId, extra = {}) {
  return UnitSerial.find({
    ownerType: "seller",
    ownerId: sellerId,
    inventoryId: lotId,
    status: PICKABLE,
    ...extra,
  })
    .select("serial unit_code status bulk_packaging_id bulk_packaging_record_id seller_repack_box_id")
    .lean();
}

/** The answer the dialog consumes. */
function result({
  scanType, lot, productId, added, skipped, selected, ctx, bulkPackagingId = null,
  boxLevel = null, boxUnitTotal = null, unavailable = 0,
}) {
  const already = selected.byProduct.get(String(productId)) || 0;
  const scannedQuantity = already + added.length;
  return {
    scanType,
    lotId: String(lot._id),
    lotNumber: lot.lotNumber || lot.batchNumber,
    bulkPackagingId,
    boxLevel,
    productId: String(productId),
    addedUnitCodes: added,
    addedQuantity: added.length,
    skippedQuantity: skipped,
    boxUnitTotal,
    unavailableQuantity: unavailable,
    scannedQuantity,
    remainingRequired: Math.max(0, (ctx.required.get(String(productId)) || 0) - scannedQuantity),
  };
}

/* ------------------------------------------------------------- scan cases */

/**
 * A WHOLE CARTON — a MAIN bulk packaging box or an inner box.
 *
 * A main box adds every available unit across the inner boxes inside it (see
 * unitHolderIds); an inner box adds its own. Units already scanned — typically
 * because an inner box was scanned before its parent carton — are counted once
 * and once only.
 *
 * All-or-nothing against the REQUIREMENT: the transfer must still need every
 * fresh unit in the carton, or the box is not going out whole and its ID must
 * not stand for the part of it that is.
 *
 * WHICH LOT ROW THE CARTON BELONGS TO IS READ FROM ITS UNITS, not from its own
 * `lot_id`. A box is anchored for life to the row it was minted against, while
 * a transfer receipt lands its units on a row at the destination — so reading
 * `lot_id` would make a perfectly good carton read as "not on this transfer"
 * on the second leg of a chain. The units moved; the box record did not; the
 * units are the truth.
 */
async function scanBox(sellerId, box, ctx, selected) {
  const label = box.bulk_packaging_id;
  if (box.status === "cancelled") throw httpErr(`${label} has been cancelled.`, 409, { code: "CANCELLED" });

  // The units the carton actually holds, as far as THIS seller is concerned.
  const holderIds = await unitHolderIds(box.company_id, box);
  const scope = { bulk_packaging_record_id: { $in: holderIds } };

  const owned = await UnitSerial.find({
    ownerType: "seller", ownerId: sellerId, ...scope,
  }).select("inventoryId").lean();
  if (!owned.length) throw httpErr(MSG.notOnShipment(label, ctx.ref), 409, { code: "NOT_ON_SHIPMENT" });

  // Belonging: the carton's stock must sit on a lot row this transfer may draw
  // from. A box of a lot the transfer never carries resolves to nothing here.
  const lot = owned
    .map((u) => ctx.lotById.get(String(u.inventoryId)))
    .find(Boolean);
  if (!lot) throw httpErr(MSG.notOnShipment(label, ctx.ref), 409, { code: "NOT_ON_SHIPMENT" });

  assertLotOnShelf(ctx, lot, `Box ${label}`);

  // Units of this carton STILL IN THIS WAREHOUSE'S lot row. A transfer repoints
  // a moved unit's inventoryId but leaves bulk_packaging_record_id alone, so a
  // query not scoped to this lot row would keep finding units that left.
  const units = await eligibleUnits(sellerId, lot._id, scope);
  const boxUnitTotal = await UnitSerial.countDocuments({
    ownerType: "seller", ownerId: sellerId, inventoryId: lot._id, ...scope,
  });

  const fresh = units.filter((u) => !selected.set.has(norm(u.serial)));
  if (!fresh.length) {
    const anySelected = units.some((u) => selected.set.has(norm(u.serial)));
    throw httpErr(anySelected ? MSG.duplicate(label) : MSG.noneEligible(label), 409, { code: "DUPLICATE" });
  }

  const need = remainingFor(ctx, lot.productId, selected);
  if (need <= 0) throw httpErr(MSG.nothingLeft, 409, { code: "NOTHING_LEFT" });
  if (fresh.length > need) throw httpErr(MSG.partialBox(need, fresh.length, label), 409, { code: "TOO_BIG" });

  return result({
    scanType: "bulk_package", lot, productId: lot.productId,
    added: fresh.map((u) => u.serial), skipped: units.length - fresh.length,
    selected, ctx, bulkPackagingId: label,
    boxLevel: box.box_level === "main" ? "main" : "inner",
    boxUnitTotal,
    unavailable: Math.max(0, boxUnitTotal - units.length),
  });
}

/** A whole UNBOXED lot. Same all-or-nothing rule as a carton. */
async function scanLot(sellerId, lot, ctx, selected) {
  const number = lot.lotNumber || lot.batchNumber;
  assertLotOnShelf(ctx, lot, `Lot ${number}`);

  // IS THIS ROW'S STOCK PACKED INTO BOXES? Answered from the cartons its units
  // still carry, not from BulkPackage.lot_id — a box row stays anchored to the
  // row it was minted against, so `lot_id` alone counts ZERO at a receiving
  // warehouse and a bulk-packed lot would silently accept a bare Lot Number.
  const boxRecordIds = await UnitSerial.distinct("bulk_packaging_record_id", {
    ownerType: "seller", ownerId: sellerId,
    inventoryId: lot._id, bulk_packaging_record_id: { $ne: null },
  });
  if (boxRecordIds.length > 0) {
    throw httpErr(
      `Lot ${number} is packed into boxes. Scan a Bulk Packaging ID, an inner box, or an individual Unit Code.`,
      409, { code: "BULK_LOT" }
    );
  }

  const units = await eligibleUnits(sellerId, lot._id);
  if (!units.length) throw httpErr(MSG.noUnits(number), 409, { code: "NONE_ELIGIBLE" });

  const fresh = units.filter((u) => !selected.set.has(norm(u.serial)));
  if (!fresh.length) throw httpErr(MSG.duplicate(number), 409, { code: "DUPLICATE" });

  const need = remainingFor(ctx, lot.productId, selected);
  if (need <= 0) throw httpErr(MSG.nothingLeft, 409, { code: "NOTHING_LEFT" });
  if (fresh.length > need) throw httpErr(MSG.partialLot(need, fresh.length, number), 409, { code: "TOO_BIG" });

  return result({
    scanType: "lot", lot, productId: lot.productId,
    added: fresh.map((u) => u.serial), skipped: units.length - fresh.length, selected, ctx,
  });
}

/**
 * ONE UNIT. It must belong to a lot this transfer carries, still be on this
 * warehouse's shelf, and still be in stock.
 */
async function scanUnit(sellerId, unit, ctx, selected) {
  const code = unit.unit_code || unit.serial;
  const lot = ctx.lotById.get(String(unit.inventoryId));
  if (!lot) throw httpErr(MSG.notOnShipment(code, ctx.ref), 409, { code: "NOT_ON_SHIPMENT" });

  if (selected.set.has(norm(unit.serial))) throw httpErr(MSG.duplicate(code), 409, { code: "DUPLICATE" });

  assertLotOnShelf(ctx, lot, `Unit ${code}`);

  if (unit.status !== PICKABLE) throw httpErr(MSG.notInStock(code, unit.status), 409, { code: "NOT_AVAILABLE" });
  if (remainingFor(ctx, lot.productId, selected) <= 0) {
    throw httpErr(MSG.nothingLeft, 409, { code: "NOTHING_LEFT" });
  }

  return result({
    scanType: "unit", lot, productId: lot.productId,
    added: [unit.serial], skipped: 0, selected, ctx,
    bulkPackagingId: unit.bulk_packaging_id || null,
  });
}

/* ------------------------------------------------------------------ entry */

/**
 * Resolve ONE scanned code against this transfer. Read-only — it moves nothing.
 *
 * Priority only decides which lookup runs first; WHAT the code is comes from
 * which collection actually holds it.
 */
async function resolveDispatchScan(sellerId, shipmentId, { code, selectedCodes = [] }) {
  const value = String(code || "").trim();
  if (!value) throw httpErr("A code is required", 400);

  const shipment = await loadShipment(sellerId, shipmentId);
  const ctx = await shipmentContext(sellerId, shipment);
  const selected = await countSelected(sellerId, selectedCodes, ctx);

  // 1 — A carton. box_level is what tells a MAIN carton from an inner one, so
  //     it must be selected here or every box would look like an inner box and
  //     a main box would resolve to zero units.
  const box = await matchEither(
    (v) => BulkPackage.findOne({ bulk_packaging_id: v })
      .select("bulk_packaging_id company_id lot_id status warehouse_id box_serial box_level parent_box_id"),
    value,
  );
  if (box) return scanBox(sellerId, box, ctx, selected);

  // 2 — One unit, by either of the two codes it is known by.
  const unit = await matchEither(
    (v) => UnitSerial.findOne({
      ownerType: "seller", ownerId: sellerId, $or: [{ serial: v }, { unit_code: v }],
    }).select("serial unit_code status inventoryId bulk_packaging_id bulk_packaging_record_id"),
    value,
  );
  if (unit) return scanUnit(sellerId, unit, ctx, selected);

  // 3 — A lot number can occupy several Inventory rows; only the one on this
  //     transfer is the row this scan means.
  const onShipment = [...ctx.lotById.values()].find(
    (l) => norm(l.lotNumber) === norm(value) || norm(l.batchNumber) === norm(value)
  );
  if (onShipment) return scanLot(sellerId, onShipment, ctx, selected);

  // Does the code exist elsewhere at all? If it does, the honest answer is "not
  // on this transfer"; if not, it is simply unknown.
  const knownLot = await matchEither(
    (v) => Inventory.exists({
      ownerType: "seller", ownerId: sellerId, $or: [{ lotNumber: v }, { batchNumber: v }],
    }),
    value,
  );
  throw knownLot
    ? httpErr(MSG.notOnShipment(value, ctx.ref), 409, { code: "NOT_ON_SHIPMENT" })
    : httpErr(MSG.unknown(value), 404, { code: "UNKNOWN" });
}

/* ------------------------------------------------------- confirm guard */

/**
 * THE WRITE-PATH GUARD, called before anything moves.
 *
 * Re-derives what the transfer requires and re-resolves every scanned code from
 * the database — the client's arithmetic is never trusted. Requires the units
 * to cover each product exactly, and each one to still be dispatchable. Two
 * operators dispatching the same transfer at once both land here.
 *
 * Returns `byLot` — WHICH LOT EACH SCANNED UNIT ACTUALLY CAME OUT OF. The
 * planned lines are an allocation made before anything was picked; what
 * physically left the shelf is decided by the scan, so the caller rewrites the
 * lines from this before the stock deduction runs.
 */
async function assertDispatchScanned(sellerId, shipment, scannedCodes) {
  if (!Array.isArray(scannedCodes)) throw httpErr("Scan the stock before dispatching", 400, { code: "NO_SCAN" });
  if (!isSellerWarehouseTransfer(shipment)) throw httpErr("This shipment is not a warehouse transfer", 400);

  const ctx = await shipmentContext(sellerId, shipment);
  if (!ctx.required.size) throw httpErr("This transfer has no lines to dispatch", 409);

  const codes = [...new Set(scannedCodes.map(norm).filter(Boolean))];
  if (!codes.length) throw httpErr("Scan the stock before dispatching", 400, { code: "NO_SCAN" });

  const units = await UnitSerial.find({
    ownerType: "seller", ownerId: sellerId, serial: { $in: codeVariants(scannedCodes) },
  }).select("serial unit_code status inventoryId bulk_packaging_record_id seller_repack_box_id").lean();
  const found = new Set(units.map((u) => norm(u.serial)));

  // A code that is not a unit of this transfer must not count toward it.
  const stray = codes.find((c) => !found.has(c));
  if (stray) throw httpErr(MSG.notOnShipment(stray, ctx.ref), 409, { code: "NOT_ON_SHIPMENT" });

  const byProduct = new Map();
  const byLot = new Map();
  for (const u of units) {
    const lot = ctx.lotById.get(String(u.inventoryId));
    if (!lot) throw httpErr(MSG.notOnShipment(u.unit_code || u.serial, ctx.ref), 409, { code: "NOT_ON_SHIPMENT" });

    assertLotOnShelf(ctx, lot, `Unit ${u.unit_code || u.serial}`);
    if (u.status !== PICKABLE) {
      throw httpErr(MSG.notInStock(u.unit_code || u.serial, u.status), 409, { code: "NOT_AVAILABLE" });
    }

    const pid = String(lot.productId);
    byProduct.set(pid, (byProduct.get(pid) || 0) + 1);

    const key = String(lot._id);
    let entry = byLot.get(key);
    if (!entry) {
      entry = {
        inventoryId: lot._id,
        productId: lot.productId,
        lotNumber: lot.lotNumber,
        batchNumber: lot.batchNumber,
        qty: 0,
        serials: [],
      };
      byLot.set(key, entry);
    }
    entry.qty += 1;
    entry.serials.push(u.serial);
  }

  let scanned = 0;
  let total = 0;
  for (const [pid, need] of ctx.required.entries()) {
    total += need;
    scanned += Math.min(need, byProduct.get(pid) || 0);
  }
  if (scanned !== total) throw httpErr(MSG.incomplete(scanned, total), 409, { code: "INCOMPLETE" });

  return { ref: ctx.ref, count: total, byLot: [...byLot.values()] };
}

/**
 * WHICH LOTS THIS DISPATCH MAY DRAW ON — the one answer, for every caller.
 *
 * Wider than the planned lines, exactly as the scan resolver is (see
 * shipmentContext). Exported because boxing has to agree with it: a unit the
 * scan accepted must not then be refused when it is packed into a carton.
 */
async function eligibleLotIds(sellerId, shipment) {
  const ctx = await shipmentContext(sellerId, shipment);
  return new Set([...ctx.lotById.keys()]);
}

module.exports = {
  MSG,
  isSellerWarehouseTransfer,
  loadShipment,
  shipmentContext,
  dispatchChecklist,
  resolveDispatchScan,
  assertDispatchScanned,
  eligibleLotIds,
  refOf,
};