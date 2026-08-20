const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const Warehouse = require("../model/Warehouse/Warehouse");
const Shipment = require("../model/Transport/Shipment");
const Order = require("../model/Order/Order");
const Product = require("../model/Company/productModel");

/**
 * SELLER PICK SCAN VALIDATION  (Phase 3 · Part 1)
 *
 * Real database validation for every code scanned while a SELLER warehouse
 * picks a customer order. Before this, the seller pick modal accepted ANY
 * string: `addScan` pushed whatever was typed and the count was the length of
 * the array, so twenty arbitrary characters marked twenty units picked. This
 * service is what makes a seller scan mean something.
 *
 * ── WHY THIS IS A SEPARATE FILE ──
 * services/pickScanService.js already implements exactly these rules for the
 * COMPANY side, and it is deliberately left untouched. Every one of its queries
 * is hard-scoped to a company:
 *
 *     Order.findOne({ _id, companyId })
 *     Inventory.findOne({ ownerType: "company", ownerId: companyId })
 *     UnitSerial.find({ companyId, ownerType: "company", ownerId: companyId })
 *     BulkPackage.findOne({ company_id: companyId, … })
 *
 * Making it owner-polymorphic would mean editing the single scan router that
 * the whole company warehouse depends on. The brief is that company behaviour
 * must be EXACTLY as before, so this is a separate, seller-only implementation
 * that no company code path can reach. The RULES are modelled on the company
 * service — same checks, same ordering, same refusal reasons — but the queries
 * are seller-scoped and it is reached only from seller routes.
 *
 * ── WHAT IS THE SOURCE OF TRUTH ──
 * Everything. The caller sends a code and the tokens it believes it has already
 * accepted; it sends NO quantity, NO warehouse and NO product. Those all come
 * from the database:
 *
 *   • the fulfilling WAREHOUSE comes from the shipment (`fromWarehouseId`)
 *   • the requested QUANTITY per product comes from the shipment's own lines
 *   • the quantity a label REPRESENTS is counted from unit rows (or, for an
 *     unserialised lot, read from the lot's availableStock)
 *
 * The previously accepted tokens are RE-RESOLVED against the database on every
 * call, so a client cannot inflate its progress by inventing them.
 *
 * ── CURRENT WAREHOUSE, NEVER A STALE ONE ──
 * A box's own `warehouse_id` is a denormalised copy of its lot's, frozen when
 * the carton was minted and never rewritten by a transfer receipt. Reading it
 * would let Warehouse 1 keep scanning cartons it has already transferred away,
 * and would stop Warehouse 2 scanning what is physically on its shelf. So a
 * box's location is derived from ITS UNITS — each unit's `inventoryId` points
 * at the Inventory row it currently sits in, and that row names the warehouse
 * that holds it today. Same reasoning as the company service's boxStockLocation,
 * reimplemented here against seller-owned rows.
 */

/* ------------------------------------------------------------- helpers */

const norm = (v) => String(v == null ? "" : v).trim();
const PICKABLE = "in_stock";

function httpErr(message, status = 400, extra = {}) {
  const e = new Error(message);
  e.status = status;
  Object.assign(e, extra);
  return e;
}

const MSG = {
  unknown: (c) => `"${c}" is not a known label. Scan a lot, bulk package, box, inner box or unit label.`,
  wrongProduct: (scanned, expected) =>
    `This label is for ${scanned || "a different product"}, not ${expected}. It has not been counted.`,
  wrongProductLabel: (label, scannedName, expected) =>
    `${label} is ${scannedName || "a different product"}, which is not part of this shipment${expected ? ` — this shipment needs ${expected}` : ""}. It has not been counted.`,
  wrongWarehouse: (label, actual, expected) =>
    `${label} is at ${actual || "another warehouse"}, not ${expected}. Only stock held here can be picked.`,
  notReceived: (label) => `${label} was dispatched here but not received yet. Receive it before picking.`,
  cancelled: (label) => `${label} has been cancelled.`,
  alreadyScanned: (label) => `${label} has already been scanned for this pick.`,
  notAvailable: (label, status) => `${label} is not available to pick (${status}).`,
  nothingLeft: (p) => `${p} is already fully picked. Nothing left to scan.`,
  tooBig: (label, have, need) =>
    `${label} holds ${have} unit(s) but only ${need} more are needed. Scan a smaller label or individual units — no extra stock has been picked.`,
  empty: (label) => `${label} has no pickable stock in this warehouse.`,
};

/** Warehouse names for readable errors. Best-effort. */
async function warehouseNames(ids) {
  const clean = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!clean.length) return new Map();
  const rows = await Warehouse.find({ _id: { $in: clean } }).select("name").lean();
  return new Map(rows.map((w) => [String(w._id), w.name]));
}

/* --------------------------------------------------------- the context */

/**
 * What this pick is: which warehouse is fulfilling it, which products it owes
 * and how many of each.
 *
 * The warehouse is the SHIPMENT's `fromWarehouseId` — the warehouse actually
 * raised to fulfil this part of the order. On a split order each warehouse has
 * its own shipment, so this is automatically the right one and a warehouse can
 * never scan against a sibling's products.
 */
async function loadContext(sellerId, shipmentId) {
  const shipment = await Shipment.findOne({
    _id: shipmentId, ownerType: "seller", ownerId: sellerId,
  }).lean();
  if (!shipment) throw httpErr("Shipment not found", 404);

  const warehouseId = shipment.fromWarehouseId ? String(shipment.fromWarehouseId) : null;
  if (!warehouseId) throw httpErr("This shipment has no source warehouse.", 409);

  // Required quantity PER PRODUCT, summed over the shipment's own lines. The
  // shipment is what this warehouse owes — not the whole order, which may be
  // split across warehouses.
  const required = new Map();
  for (const l of shipment.lines || []) {
    if (!l.productId) continue;
    const pid = String(l.productId);
    required.set(pid, (required.get(pid) || 0) + (l.qty || 0));
  }
  // Quantity already committed by a PREVIOUS confirmed pick, which this scan
  // session must not re-pick.
  const alreadyPicked = new Map();
  for (const l of shipment.lines || []) {
    if (!l.productId) continue;
    const pid = String(l.productId);
    alreadyPicked.set(pid, (alreadyPicked.get(pid) || 0) + (l.pickedQty || 0));
  }

  const ids = [...required.keys()];
  const products = ids.length
    ? await Product.find({ _id: { $in: ids } }).select("productName").lean()
    : [];
  const nameById = new Map(products.map((p) => [String(p._id), p.productName]));

  // Prefer the order's own snapshot name when there is one.
  let orderNames = new Map();
  if (shipment.refType === "Order" && shipment.refId) {
    const order = await Order.findOne({
      _id: shipment.refId, ownerType: "seller", ownerId: sellerId,
    }).select("items").lean();
    orderNames = new Map((order?.items || [])
      .filter((it) => it.productId)
      .map((it) => [String(it.productId), it.name]));
  }

  return {
    sellerId: String(sellerId),
    shipmentId: String(shipment._id),
    warehouseId,
    required,
    alreadyPicked,
    productName: (pid) => orderNames.get(String(pid)) || nameById.get(String(pid)) || "this product",
  };
}

/* ------------------------------------------------------ token handling */

/**
 * A scan is remembered as TOKENS, never as a number.
 *
 *   unit:<serial>  — one serialised unit
 *   lot:<lotId>    — a whole UNSERIALISED lot row
 *
 * A box / bulk / inner-box scan expands into the unit tokens it contains, so a
 * carton and the units inside it can never both be counted: the second scan
 * finds its tokens already present and is refused as a duplicate.
 *
 * Every token is re-resolved from the database on each call, so the quantity a
 * token is worth is never taken from the client.
 */
async function resolveTokens(ctx, tokens) {
  const unique = [...new Set((tokens || []).map(norm).filter(Boolean))];
  const serials = unique.filter((t) => t.startsWith("unit:")).map((t) => t.slice(5));
  const lotIds = unique.filter((t) => t.startsWith("lot:")).map((t) => t.slice(4));

  const byProduct = new Map(); // productId -> qty already selected
  const add = (pid, n) => byProduct.set(String(pid), (byProduct.get(String(pid)) || 0) + n);

  if (serials.length) {
    const units = await UnitSerial.find({
      ownerType: "seller", ownerId: ctx.sellerId, serial: { $in: serials },
    }).select("serial productId").lean();
    units.forEach((u) => add(u.productId, 1));
  }
  if (lotIds.length) {
    const lots = await Inventory.find({
      _id: { $in: lotIds }, ownerType: "seller", ownerId: ctx.sellerId,
    }).select("productId availableStock").lean();
    lots.forEach((l) => add(l.productId, Number(l.availableStock || 0)));
  }

  return { set: new Set(unique), byProduct };
}

/** How much of `productId` this scan session may still take. */
function remainingFor(ctx, selected, productId) {
  const pid = String(productId);
  const req = ctx.required.get(pid) || 0;
  const done = (ctx.alreadyPicked.get(pid) || 0) + (selected.byProduct.get(pid) || 0);
  return Math.max(0, req - done);
}

/** Per-product progress, for the modal's Requested / Scanned / Remaining. */
function progress(ctx, selected) {
  return [...ctx.required.entries()].map(([pid, req]) => {
    const scanned = (ctx.alreadyPicked.get(pid) || 0) + (selected.byProduct.get(pid) || 0);
    return {
      productId: pid,
      productName: ctx.productName(pid),
      requestedQty: req,
      scannedQty: scanned,
      remainingQty: Math.max(0, req - scanned),
      complete: scanned >= req,
    };
  });
}

/* ------------------------------------------------------ shared guards */

/** The lot row must be seller-owned, hold the right product, and BE HERE. */
async function assertLotUsable(ctx, lot, label) {
  const pid = String(lot.productId);

  if (!ctx.required.has(pid)) {
    // Name the product that was actually scanned. ctx only knows the ordered
    // ones, so an unordered product would otherwise read as "this product" —
    // useless when the whole point is telling the operator what they grabbed.
    const other = await Product.findOne({ _id: pid }).select("productName").lean();
    throw httpErr(
      MSG.wrongProductLabel(label, other?.productName, [...ctx.required.keys()].map((k) => ctx.productName(k)).join(" or ")),
      409, { code: "WRONG_PRODUCT" }
    );
  }
  // CURRENT location, from the lot row itself — never a denormalised copy.
  if (String(lot.warehouseId) !== ctx.warehouseId) {
    const names = await warehouseNames([lot.warehouseId, ctx.warehouseId]);
    throw httpErr(
      MSG.wrongWarehouse(label, names.get(String(lot.warehouseId)), names.get(ctx.warehouseId) || "this warehouse"),
      403,
      { code: "WRONG_WAREHOUSE" }
    );
  }
  // Dispatched here but never received: not on the shelf, so not pickable.
  if (Number(lot.availableStock || 0) <= 0 && Number(lot.inTransitStock || 0) > 0) {
    throw httpErr(MSG.notReceived(label), 409, { code: "NOT_RECEIVED" });
  }
  return pid;
}

/**
 * WHERE IS THIS CARTON, REALLY? Derived from its units' current Inventory rows,
 * never from `box.warehouse_id`. Returns the distinct warehouse ids its units
 * currently sit in.
 */
async function boxWarehouses(ctx, box) {
  const units = await UnitSerial.find({
    ownerType: "seller", ownerId: ctx.sellerId, bulk_packaging_record_id: box._id,
  }).select("inventoryId").lean();
  const invIds = [...new Set(units.map((u) => String(u.inventoryId)).filter(Boolean))];
  if (!invIds.length) return [];
  const rows = await Inventory.find({ _id: { $in: invIds } }).select("warehouseId").lean();
  return [...new Set(rows.map((r) => String(r.warehouseId)).filter(Boolean))];
}

/* --------------------------------------------------------- scan cases */

/** A whole carton: bulk package, main box or inner box — same collection. */
async function scanBox(ctx, box, selected) {
  const label = `Box ${box.bulk_packaging_id}`;
  if (box.status === "cancelled") throw httpErr(MSG.cancelled(label), 409, { code: "CANCELLED" });

  const lot = await Inventory.findOne({
    _id: box.lot_id, ownerType: "seller", ownerId: ctx.sellerId,
  }).select("productId warehouseId availableStock inTransitStock lotNumber batchNumber");
  if (!lot) throw httpErr(MSG.unknown(box.bulk_packaging_id), 404, { code: "UNKNOWN" });

  const pid = await assertLotUsable(ctx, lot, label);

  // Location from the UNITS, so a transferred carton follows its stock.
  const where = await boxWarehouses(ctx, box);
  if (where.length && !where.includes(ctx.warehouseId)) {
    const names = await warehouseNames([...where, ctx.warehouseId]);
    throw httpErr(
      MSG.wrongWarehouse(label, names.get(where[0]), names.get(ctx.warehouseId) || "this warehouse"),
      403,
      { code: "WRONG_WAREHOUSE" }
    );
  }

  // Units of this carton STILL IN THIS WAREHOUSE'S lot row. A transfer repoints
  // a moved unit's inventoryId but leaves bulk_packaging_record_id alone, so a
  // query not scoped to this lot row would keep finding units that left.
  const units = await UnitSerial.find({
    ownerType: "seller", ownerId: ctx.sellerId,
    bulk_packaging_record_id: box._id, inventoryId: lot._id,
  }).select("serial status").lean();

  const available = units.filter((u) => u.status === PICKABLE);
  if (!available.length) throw httpErr(MSG.empty(label), 409, { code: "NONE_ELIGIBLE" });

  // Every unit already selected → this exact carton was scanned before.
  const fresh = available.filter((u) => !selected.set.has(`unit:${u.serial}`));
  if (!fresh.length) throw httpErr(MSG.alreadyScanned(label), 409, { code: "DUPLICATE" });

  const need = remainingFor(ctx, selected, pid);
  if (need <= 0) throw httpErr(MSG.nothingLeft(ctx.productName(pid)), 409, { code: "NOTHING_LEFT" });
  // A carton is all-or-nothing: taking part of it would split the physical box
  // with no record of which half moved. Refuse rather than silently over-pick.
  if (fresh.length > need) {
    throw httpErr(MSG.tooBig(label, fresh.length, need), 409, { code: "TOO_BIG" });
  }

  return {
    scanType: box.box_level === "inner" ? "inner_box" : "box",
    label: box.bulk_packaging_id,
    productId: pid,
    addedQuantity: fresh.length,
    tokens: fresh.map((u) => `unit:${u.serial}`),
    lotNumber: lot.lotNumber || lot.batchNumber || null,
  };
}

/** One individual unit. */
async function scanUnit(ctx, unit, selected) {
  const label = `Unit ${unit.serial}`;
  if (selected.set.has(`unit:${unit.serial}`)) {
    throw httpErr(MSG.alreadyScanned(label), 409, { code: "DUPLICATE" });
  }

  const lot = await Inventory.findOne({
    _id: unit.inventoryId, ownerType: "seller", ownerId: ctx.sellerId,
  }).select("productId warehouseId availableStock inTransitStock lotNumber batchNumber");
  if (!lot) throw httpErr(MSG.unknown(unit.serial), 404, { code: "UNKNOWN" });

  const pid = await assertLotUsable(ctx, lot, label);

  if (unit.status !== PICKABLE) {
    throw httpErr(
      ["picked", "packed", "shipped", "sold"].includes(unit.status)
        ? `${label} is already reserved, dispatched or sold.`
        : MSG.notAvailable(label, unit.status),
      409,
      { code: "NOT_AVAILABLE" }
    );
  }
  if (remainingFor(ctx, selected, pid) <= 0) {
    throw httpErr(MSG.nothingLeft(ctx.productName(pid)), 409, { code: "NOTHING_LEFT" });
  }

  return {
    scanType: "unit",
    label: unit.serial,
    productId: pid,
    addedQuantity: 1,
    tokens: [`unit:${unit.serial}`],
    lotNumber: lot.lotNumber || lot.batchNumber || null,
  };
}

/** A lot label: take the whole lot. */
async function scanLot(ctx, lot, selected) {
  const number = lot.lotNumber || lot.batchNumber || "This lot";
  const label = `Lot ${number}`;
  const pid = await assertLotUsable(ctx, lot, label);

  // A lot packed into cartons must move carton by carton, or the box records
  // would no longer describe where the units are.
  const boxCount = await BulkPackage.countDocuments({ lot_id: lot._id, status: { $ne: "cancelled" } });

  const units = await UnitSerial.find({
    ownerType: "seller", ownerId: ctx.sellerId, inventoryId: lot._id,
  }).select("serial status").lean();

  const need = remainingFor(ctx, selected, pid);
  if (need <= 0) throw httpErr(MSG.nothingLeft(ctx.productName(pid)), 409, { code: "NOTHING_LEFT" });

  // ── SERIALISED LOT ──
  if (units.length) {
    if (boxCount > 0) {
      throw httpErr(
        `${label} is packed into boxes. Scan the box or inner-box labels instead.`,
        409, { code: "BULK_LOT" }
      );
    }
    const available = units.filter((u) => u.status === PICKABLE);
    if (!available.length) throw httpErr(MSG.empty(label), 409, { code: "NONE_ELIGIBLE" });
    const fresh = available.filter((u) => !selected.set.has(`unit:${u.serial}`));
    if (!fresh.length) throw httpErr(MSG.alreadyScanned(label), 409, { code: "DUPLICATE" });
    if (fresh.length > need) throw httpErr(MSG.tooBig(label, fresh.length, need), 409, { code: "TOO_BIG" });
    return {
      scanType: "lot", label: number, productId: pid,
      addedQuantity: fresh.length, tokens: fresh.map((u) => `unit:${u.serial}`),
      lotNumber: number,
    };
  }

  // ── UNSERIALISED LOT ──
  // Seller stock is not always unit-serialised. The lot's own availableStock is
  // then the quantity the label represents — still read from the database, and
  // still subject to the same "must not exceed what is needed" rule.
  if (selected.set.has(`lot:${lot._id}`)) {
    throw httpErr(MSG.alreadyScanned(label), 409, { code: "DUPLICATE" });
  }
  const qty = Number(lot.availableStock || 0);
  if (qty <= 0) throw httpErr(MSG.empty(label), 409, { code: "NONE_ELIGIBLE" });
  if (qty > need) throw httpErr(MSG.tooBig(label, qty, need), 409, { code: "TOO_BIG" });

  return {
    scanType: "lot", label: number, productId: pid,
    addedQuantity: qty, tokens: [`lot:${lot._id}`], lotNumber: number,
  };
}

/* ------------------------------------------------------------- entry */

/**
 * Resolve one scanned code for a seller shipment pick.
 *
 * Lookup order — the order only decides which query runs first; WHAT the code
 * is comes from whichever collection actually holds it:
 *   1. Bulk package / main box / inner box  (BulkPackage.bulk_packaging_id)
 *   2. Individual unit                      (UnitSerial.serial | unit_code)
 *   3. Lot                                  (Inventory.lotNumber | batchNumber)
 *
 * A code in none of them is rejected — arbitrary text is never a valid scan.
 */
async function resolveSellerScan({ sellerId, shipmentId, code, selectedTokens = [] }) {
  const value = norm(code);
  if (!value) throw httpErr("A code is required", 400);

  const ctx = await loadContext(sellerId, shipmentId);
  const selected = await resolveTokens(ctx, selectedTokens);

  const finish = (scan) => {
    // Recompute progress INCLUDING this scan, so the caller never has to add up
    // anything itself.
    const after = new Set([...selected.set, ...scan.tokens]);
    const merged = {
      set: after,
      byProduct: new Map(selected.byProduct),
    };
    merged.byProduct.set(
      String(scan.productId),
      (merged.byProduct.get(String(scan.productId)) || 0) + scan.addedQuantity
    );
    return {
      ...scan,
      productName: ctx.productName(scan.productId),
      // The tokens THIS scan contributed, so the caller can list the individual
      // units it just added and let the manager tick them into a box. A carton
      // scan contributes one token per unit inside it, which is what makes
      // "scan a box, then split it across two parcels" possible.
      addedTokens: scan.tokens,
      tokens: [...after],
      products: progress(ctx, merged),
    };
  };

  const box = await BulkPackage.findOne({ bulk_packaging_id: value });
  if (box) return finish(await scanBox(ctx, box, selected));

  const unit = await UnitSerial.findOne({
    ownerType: "seller", ownerId: sellerId,
    $or: [{ serial: value }, { unit_code: value }],
  }).select("serial unit_code status inventoryId productId bulk_packaging_id bulk_packaging_record_id");
  // Defensive: only act on a record whose stored code IS what was scanned.
  if (unit && (norm(unit.serial) === value || norm(unit.unit_code) === value)) {
    return finish(await scanUnit(ctx, unit, selected));
  }

  // A lot number can occupy SEVERAL Inventory rows (a transfer copies the lot
  // identity into the destination warehouse). Prefer the row in THIS warehouse;
  // otherwise hand over the first so the operator gets the real reason (wrong
  // warehouse / wrong product) rather than a blank "unknown".
  const lotRows = await Inventory.find({
    ownerType: "seller", ownerId: sellerId,
    $or: [{ lotNumber: value }, { batchNumber: value }],
  }).select("_id productId warehouseId availableStock inTransitStock lotNumber batchNumber");
  if (lotRows.length) {
    const here = lotRows.find((r) => String(r.warehouseId) === ctx.warehouseId);
    return finish(await scanLot(ctx, here || lotRows[0], selected));
  }

  throw httpErr(MSG.unknown(value), 404, { code: "UNKNOWN" });
}

/** Per-product progress for an empty or in-flight session (modal open / reset). */
async function sellerScanState({ sellerId, shipmentId, selectedTokens = [] }) {
  const ctx = await loadContext(sellerId, shipmentId);
  const selected = await resolveTokens(ctx, selectedTokens);
  return {
    warehouseId: ctx.warehouseId,
    tokens: [...selected.set],
    products: progress(ctx, selected),
  };
}


/* -------------------------------------------------- confirm-pick guard */

/**
 * RE-VALIDATE A CONFIRM PICK, SERVER-SIDE, AND BUILD THE PAYLOAD.
 *
 * This is the inventory-safety boundary. The modal's counts are UX only; this
 * is what actually decides what may be picked. Every token the client submits
 * is resolved against the database again here — a fabricated token resolves to
 * nothing and is worth nothing, so no stock can be marked picked merely because
 * a string was typed.
 *
 * Re-checked for EVERY token, not just the ones scanned this session:
 *   • the unit / lot exists and is seller-owned
 *   • it belongs to a product this shipment actually owes
 *   • its lot sits in the shipment's CURRENT fulfilling warehouse
 *   • it is still pickable (not already picked / packed / shipped / sold)
 *   • the per-product total does not exceed what is required
 *
 * Returns `{ picks, products }` where `picks` is in the exact shape the
 * EXISTING shipmentService.pickShipment already accepts
 * ([{ lineIndex, serials }] / [{ lineIndex, qty }]). That service is shared
 * with the company side and is deliberately NOT modified — this simply hands it
 * a payload that has been proven correct first.
 *
 * `requireComplete` refuses a partial confirm, so an order can only move on when
 * every product is fully scanned.
 */
async function buildSellerPickPayload({ sellerId, shipmentId, tokens = [], requireComplete = false }) {
  const shipment = await Shipment.findOne({
    _id: shipmentId, ownerType: "seller", ownerId: sellerId,
  }).lean();
  if (!shipment) throw httpErr("Shipment not found", 404);

  const ctx = await loadContext(sellerId, shipmentId);
  const unique = [...new Set((tokens || []).map(norm).filter(Boolean))];
  const serials = unique.filter((t) => t.startsWith("unit:")).map((t) => t.slice(5));
  const lotTokens = unique.filter((t) => t.startsWith("lot:")).map((t) => t.slice(4));

  // ── resolve every unit token ──
  const units = serials.length
    ? await UnitSerial.find({
      ownerType: "seller", ownerId: sellerId, serial: { $in: serials },
    }).select("serial status productId inventoryId").lean()
    : [];
  const foundSerials = new Set(units.map((u) => u.serial));
  const ghosts = serials.filter((x) => !foundSerials.has(x));
  if (ghosts.length) {
    throw httpErr(`${ghosts.length} scanned label(s) could not be verified. Re-scan and try again.`, 409, { code: "UNKNOWN" });
  }

  // ── resolve every lot token ──
  const lotRows = lotTokens.length
    ? await Inventory.find({
      _id: { $in: lotTokens }, ownerType: "seller", ownerId: sellerId,
    }).select("_id productId warehouseId availableStock inTransitStock lotNumber batchNumber").lean()
    : [];
  if (lotRows.length !== lotTokens.length) {
    throw httpErr("Some scanned lots could not be verified. Re-scan and try again.", 409, { code: "UNKNOWN" });
  }

  // Lot rows for the units, so warehouse/product can be re-checked per unit.
  const invIds = [...new Set(units.map((u) => String(u.inventoryId)))];
  const invRows = invIds.length
    ? await Inventory.find({ _id: { $in: invIds }, ownerType: "seller", ownerId: sellerId })
      .select("_id productId warehouseId availableStock inTransitStock lotNumber batchNumber").lean()
    : [];
  const invById = new Map(invRows.map((r) => [String(r._id), r]));

  const byProduct = new Map();
  const bump = (pid, n) => byProduct.set(String(pid), (byProduct.get(String(pid)) || 0) + n);

  // A unit's product/warehouse come from ITS OWN lot row, never from the client.
  for (const u of units) {
    const lot = invById.get(String(u.inventoryId));
    if (!lot) throw httpErr(`Unit ${u.serial} has no stock record here.`, 409, { code: "UNKNOWN" });
    await assertLotUsable(ctx, lot, `Unit ${u.serial}`);
    if (u.status !== PICKABLE) {
      throw httpErr(`Unit ${u.serial} is no longer available (${u.status}). Re-scan the remaining stock.`, 409, { code: "NOT_AVAILABLE" });
    }
    bump(lot.productId, 1);
  }
  for (const lot of lotRows) {
    await assertLotUsable(ctx, lot, `Lot ${lot.lotNumber || lot.batchNumber}`);
    const qty = Number(lot.availableStock || 0);
    if (qty <= 0) {
      throw httpErr(`Lot ${lot.lotNumber || lot.batchNumber} has no stock left. Re-scan.`, 409, { code: "NONE_ELIGIBLE" });
    }
    bump(lot.productId, qty);
  }

  // ── per-product totals must not exceed what is required ──
  for (const [pid, req] of ctx.required.entries()) {
    const already = ctx.alreadyPicked.get(pid) || 0;
    const now = byProduct.get(pid) || 0;
    if (already + now > req) {
      throw httpErr(
        `${ctx.productName(pid)}: ${already + now} scanned but only ${req} requested. Remove the extra stock.`,
        409, { code: "TOO_BIG" }
      );
    }
  }

  const products = [...ctx.required.entries()].map(([pid, req]) => {
    const scanned = (ctx.alreadyPicked.get(pid) || 0) + (byProduct.get(pid) || 0);
    return {
      productId: pid, productName: ctx.productName(pid),
      requestedQty: req, scannedQty: scanned,
      remainingQty: Math.max(0, req - scanned), complete: scanned >= req,
    };
  });

  if (requireComplete) {
    const short = products.filter((p) => !p.complete);
    if (short.length) {
      throw httpErr(
        `Not every product is fully scanned — ${short.map((p) => `${p.productName} needs ${p.remainingQty} more`).join("; ")}.`,
        409, { code: "INCOMPLETE" }
      );
    }
  }

  // ── map onto the shipment's own lines ──
  // Each line is one LOT of one product; a validated unit belongs to the line
  // holding its lot row. Quantities are capped per line so a line can never be
  // over-picked even if the scans for that product were spread oddly.
  const lines = shipment.lines || [];
  const picks = [];
  const serialsByLine = new Map();
  for (const u of units) {
    const idx = lines.findIndex((l) => String(l.inventoryId) === String(u.inventoryId));
    if (idx < 0) {
      throw httpErr(
        `Unit ${u.serial} is from a lot this shipment was not planned against. Confirm the pick with the planned lots, or ask for the order to be re-approved.`,
        409, { code: "UNPLANNED_LOT" }
      );
    }
    if (!serialsByLine.has(idx)) serialsByLine.set(idx, []);
    serialsByLine.get(idx).push(u.serial);
  }
  for (const [idx, list] of serialsByLine.entries()) {
    const line = lines[idx];
    const room = (line.qty || 0) - (line.pickedQty || 0);
    if (list.length > room) {
      throw httpErr(
        `Lot ${line.lotNumber || line.batchNumber || ""} can only take ${room} more unit(s) on this shipment.`.trim(),
        409, { code: "TOO_BIG" }
      );
    }
    picks.push({ lineIndex: idx, serials: list });
  }
  // Unserialised lots are picked by quantity against their own line.
  for (const lot of lotRows) {
    const idx = lines.findIndex((l) => String(l.inventoryId) === String(lot._id));
    if (idx < 0) {
      throw httpErr(
        `Lot ${lot.lotNumber || lot.batchNumber} is not one of this shipment's planned lots.`,
        409, { code: "UNPLANNED_LOT" }
      );
    }
    const line = lines[idx];
    const room = (line.qty || 0) - (line.pickedQty || 0);
    const qty = Math.min(Number(lot.availableStock || 0), room);
    if (qty > 0) picks.push({ lineIndex: idx, qty });
  }

  if (!picks.length) throw httpErr("Nothing validated to pick. Scan the stock first.", 400, { code: "EMPTY" });
  // The resolved stock itself, so a caller building a BOX knows exactly which
  // units and quantities went into it — read from the database here, never
  // from the client.
  const resolved = {
    units: units.map((u) => ({
      serial: u.serial,
      productId: String(invById.get(String(u.inventoryId)).productId),
    })),
    lots: lotRows.map((l) => ({
      inventoryId: String(l._id),
      productId: String(l.productId),
      qty: Number(l.availableStock || 0),
      lotNumber: l.lotNumber || l.batchNumber || null,
    })),
  };
  return { picks, products, resolved };
}

module.exports = { resolveSellerScan, sellerScanState, buildSellerPickPayload, _internal: { loadContext, resolveTokens, progress } };