const GRN = require("../model/Inventory/GRN");
const PutawayTask = require("../model/Inventory/PutawayTask");
const PurchaseOrder = require("../model/Purchase/PurchaseOrder");
const Product = require("../model/Company/productModel");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const Warehouse = require("../model/Warehouse/Warehouse");
const { withTransaction } = require("./txn");
const { nextSeq } = require("./counterService");
const lotService = require("./lotService");
const locationService = require("./locationService");
const { assertWarehouseCapacity } = require("./warehouseCapacityService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const yymmdd = (d = new Date()) =>
  `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

/* ------------------------------------------------------------- numbering */

async function nextGrnNumber(companyId, session) {
  const now = new Date();
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const seq = await nextSeq(companyId, `grn-${period}`, session);
  return `GRN-${period}-${String(seq).padStart(4, "0")}`;
}

/**
 * Auto lot code when a line has no lot/batch. Uses the Khetify generator
 * (KH-<COMPANY>-<PRODUCT_CODE>-<YYYY>-<MM>-<SERIAL>) via lotService; falls back
 * to the legacy LOT-<sku>-<yymmdd>-<seq> if that returns nothing OR cannot run
 * — the generator needs the company name and the product's product_code, and a
 * GRN posting must never fail just because one of those is missing.
 */
async function generateLotCode(companyId, product, session, warehouseId = null) {
  void warehouseId; // no longer part of the lot number; kept for call-site compatibility
  let auto = null;
  try {
    ({ lotNumber: auto } = await lotService.autoLotNumber(companyId, { productId: product?._id, session }));
  } catch {
    auto = null; // fall through to the legacy code below
  }
  if (auto) return auto;
  // last-resort fallback: legacy LOT-<sku>-<yymmdd>-<seq>.
  const sku = (product?.skuNumber || "GEN").toUpperCase().replace(/\s+/g, "");
  const seq = await nextSeq(companyId, `lot-${sku}-${yymmdd()}`, session);
  return `LOT-${sku}-${yymmdd()}-${String(seq).padStart(3, "0")}`;
}

/* ----------------------------------------------------------------- create */

/**
 * Create a draft GRN, optionally prefilled from a PurchaseOrder's lines.
 * (PO items carry a name + qty + price; we match the name to a product when
 * possible, else leave productId blank for the operator to set.)
 */
async function createGRN(companyId, { refType = "Manual", refId = null, warehouseId, supplierId = null, lines = [], vehicleNo, lrNumber, invoiceNo, notes }) {
  const wh = await Warehouse.findOne({ _id: warehouseId, companyId });
  if (!wh) throw httpErr("Warehouse not found", 404);

  let grnLines = lines;
  if ((!lines || !lines.length) && refType === "PurchaseOrder" && refId) {
    const po = await PurchaseOrder.findOne({ _id: refId, companyId });
    if (!po) throw httpErr("Purchase order not found", 404);
    const products = await Product.find({ companyId });
    const byName = new Map(products.map((p) => [String(p.productName || "").toLowerCase(), p]));
    grnLines = (po.items || []).map((it) => {
      const match = byName.get(String(it.name || "").toLowerCase());
      return {
        productId: match?._id || null,
        name: it.name,
        expectedQty: it.qty,
        unitCost: it.price,
      };
    });
    supplierId = supplierId || po.vendorId;
  }

  // Warehouse capacity guard: block creating a GRN whose expected quantity
  // would push the destination warehouse past capacity (or when it is already
  // full). Occupancy is the sum of live-lot availableStock — the same figure
  // the Warehouses page shows; the rule is re-checked authoritatively at post.
  const expectedIncoming = (grnLines || []).reduce((s, l) => s + Math.max(0, Number(l.expectedQty || 0)), 0);
  await assertWarehouseCapacity({ ownerType: "company", ownerId: companyId, warehouseId, addQty: expectedIncoming });

  // NOTE: a GRN receives (adds) stock, so its expected quantity is intentionally
  // NOT capped against the product's current availableStock — operators may
  // receive more than what is on hand. Only the warehouse capacity guard above
  // constrains how much can be received.

  const grnNumber = await nextGrnNumber(companyId);
  const grn = await GRN.create({
    companyId,
    grnNumber,
    refType,
    refId,
    warehouseId,
    supplierId,
    lines: grnLines,
    vehicleNo,
    lrNumber,
    invoiceNo,
    notes,
    status: "draft",
  });
  return grn;
}

/* ---------------------------------------------------------------- receive */

/**
 * Record received / accepted / rejected quantities per line and move the GRN
 * to "received". Lines are matched to the existing GRN lines by index; any
 * field provided overwrites. acceptedQty defaults to received − rejected.
 */
async function receiveGRN(companyId, grnId, { lines = [], vehicleNo, lrNumber, invoiceNo, receivedBy }) {
  const grn = await GRN.findOne({ _id: grnId, companyId });
  if (!grn) throw httpErr("GRN not found", 404);
  if (["completed", "cancelled"].includes(grn.status)) throw httpErr(`GRN is ${grn.status}`, 409);

  lines.forEach((patch, i) => {
    const line = grn.lines[i];
    if (!line) return;
    const fields = ["productId", "receivedQty", "acceptedQty", "rejectedQty", "rejectReason", "lotNumber", "batchNumber", "mfgDate", "expiryDate", "mrp", "unitCost"];
    for (const f of fields) if (patch[f] !== undefined) line[f] = patch[f];
    const received = Number(line.receivedQty || 0);
    const rejected = Number(line.rejectedQty || 0);
    if (patch.acceptedQty === undefined) line.acceptedQty = Math.max(0, received - rejected);
  });

  if (vehicleNo !== undefined) grn.vehicleNo = vehicleNo;
  if (lrNumber !== undefined) grn.lrNumber = lrNumber;
  if (invoiceNo !== undefined) grn.invoiceNo = invoiceNo;
  if (receivedBy) grn.receivedBy = receivedBy;
  grn.status = "received";
  await grn.save();
  return grn;
}

/* ------------------------------------------------------------------- post */

/** Add rejected qty to damagedStock with a 'damage' ledger row (in txn). */
async function addDamaged(session, { companyId, productId, warehouseId, batchNumber, lotNumber, qty, performedBy, refId, note }) {
  const inv = await Inventory.findOneAndUpdate(
    { productId, ownerType: "company", ownerId: companyId, warehouseId, batchNumber },
    { $inc: { damagedStock: qty }, $set: { lotNumber: lotNumber || batchNumber } },
    { new: true, upsert: true, session }
  );
  await StockMovement.create(
    [{
      inventoryId: inv._id,
      productId,
      ownerType: "company",
      ownerId: companyId,
      type: "damage",
      channel: "internal",
      quantity: qty,
      balanceAfter: inv.availableStock,
      refType: "GRN",
      refId,
      performedBy,
      note: note || "Rejected at goods receipt",
    }],
    { session }
  );
  return inv;
}

/**
 * Post a received GRN: accepted qty becomes sellable lots, rejected qty becomes
 * damagedStock — all in ONE transaction. Then generates putaway tasks for each
 * accepted line and moves the GRN to putaway_pending (or completed).
 */
async function postGRN(companyId, grnId, { performedBy } = {}) {
  const grn = await GRN.findOne({ _id: grnId, companyId });
  if (!grn) throw httpErr("GRN not found", 404);
  if (!["received", "qc_pending", "putaway_pending"].includes(grn.status)) {
    throw httpErr(`GRN must be received before posting (is ${grn.status})`, 409);
  }
  if (grn.postedAt) throw httpErr("GRN already posted", 409);

  // Resolve products up front for lot-code generation.
  const productIds = grn.lines.map((l) => l.productId).filter(Boolean);
  const products = new Map((await Product.find({ _id: { $in: productIds }, companyId })).map((p) => [String(p._id), p]));

  for (const [i, line] of grn.lines.entries()) {
    const accepted = Number(line.acceptedQty || 0);
    const rejected = Number(line.rejectedQty || 0);
    if ((accepted > 0 || rejected > 0) && !line.productId) {
      throw httpErr(`Line ${i + 1}: productId is required before posting`, 400);
    }
  }

  // Enforce the warehouse capacity cap up front (friendly early rejection
  // before opening the transaction). The accepted qty across all lines is what
  // physically enters this warehouse as sellable stock; receiveLot re-checks
  // per line inside the txn as the authoritative backstop.
  const totalIncoming = grn.lines.reduce((s, l) => s + Math.max(0, Number(l.acceptedQty || 0)), 0);
  await assertWarehouseCapacity({ ownerType: "company", ownerId: companyId, warehouseId: grn.warehouseId, addQty: totalIncoming });

  const created = await withTransaction(async (session) => {
    const tasks = [];
    for (const [i, line] of grn.lines.entries()) {
      const accepted = Number(line.acceptedQty || 0);
      const rejected = Number(line.rejectedQty || 0);
      if (accepted <= 0 && rejected <= 0) continue;

      const product = products.get(String(line.productId));
      // Lot number is the single identity: generate one if absent (falling back
      // to any legacy batch value), then mirror it onto the batch column so the
      // two can never diverge.
      if (!line.lotNumber) line.lotNumber = line.batchNumber || await generateLotCode(companyId, product, session, grn.warehouseId);
      line.batchNumber = line.lotNumber;

      if (accepted > 0) {
        const inv = await lotService.receiveLot({
          ownerId: companyId,
          productId: line.productId,
          warehouseId: grn.warehouseId,
          lotNumber: line.lotNumber,
          batchNumber: line.batchNumber,
          expiryDate: line.expiryDate || null,
          mfgDate: line.mfgDate || null,
          qty: accepted,
          unitCost: line.unitCost,
          performedBy,
          refType: "GRN",
          refId: grn._id,
          note: `GRN ${grn.grnNumber} line ${i + 1}`,
          // A GRN receipt is not a Main-Company-minted lot — it stays off the
          // original-lot register while keeping its live stock as before.
          lotOrigin: "grn",
          session,
        });
        tasks.push({ line, lineIndex: i, inventoryId: inv._id, productId: line.productId, qty: accepted });
      }

      if (rejected > 0) {
        await addDamaged(session, {
          companyId,
          productId: line.productId,
          warehouseId: grn.warehouseId,
          batchNumber: line.batchNumber,
          lotNumber: line.lotNumber,
          qty: rejected,
          performedBy,
          refId: grn._id,
          note: line.rejectReason || `GRN ${grn.grnNumber} rejected`,
        });
      }
    }

    // Generate putaway tasks (suggestion is a heuristic read of committed state).
    const taskDocs = [];
    for (const t of tasks) {
      const product = products.get(String(t.productId));
      let suggested = null;
      try {
        suggested = await locationService.suggestBin(companyId, {
          warehouseId: grn.warehouseId,
          productId: t.productId,
          category: product?.category,
        });
      } catch { /* suggestion is best-effort */ }
      taskDocs.push({
        companyId,
        warehouseId: grn.warehouseId,
        grnId: grn._id,
        lineIndex: t.lineIndex,
        inventoryId: t.inventoryId,
        productId: t.productId,
        qty: t.qty,
        suggestedLocationId: suggested?._id || null,
        status: "pending",
      });
    }
    if (taskDocs.length) await PutawayTask.create(taskDocs, { session });

    grn.status = taskDocs.length ? "putaway_pending" : "completed";
    grn.postedAt = new Date();
    grn.qcBy = performedBy;
    await grn.save({ session });

    return taskDocs.length;
  });

  return { grn, putawayTasks: created };
}

/* ---------------------------------------------------------------- writeoff */

/**
 * Write off damaged stock (scrap). Reduces damagedStock and writes a 'writeoff'
 * ledger row. Gated at the route by adjustment:approve. Sprint 2.2 adds a
 * formal request → approve workflow on top of this primitive.
 */
async function writeOffDamaged(companyId, { inventoryId, qty, reason, performedBy }) {
  qty = Number(qty);
  if (!inventoryId || !qty || qty <= 0) throw httpErr("inventoryId and positive qty are required");
  return withTransaction(async (session) => {
    const inv = await Inventory.findOneAndUpdate(
      { _id: inventoryId, ownerId: companyId, ownerType: "company", damagedStock: { $gte: qty } },
      { $inc: { damagedStock: -qty } },
      { new: true, session }
    );
    if (!inv) throw httpErr("Not enough damaged stock to write off", 409);
    await StockMovement.create(
      [{
        inventoryId: inv._id,
        productId: inv.productId,
        ownerType: "company",
        ownerId: companyId,
        type: "writeoff",
        channel: "internal",
        quantity: -qty,
        balanceAfter: inv.availableStock,
        refType: "Manual",
        performedBy,
        note: reason || "Damaged stock written off",
      }],
      { session }
    );
    return inv;
  });
}

/* --------------------------------------------------------------- queries */

async function listGRNs(companyId, { status, warehouseId, warehouseIds } = {}) {
  const filter = { companyId };
  if (status) filter.status = status;
  if (warehouseId) filter.warehouseId = warehouseId;
  // Warehouse-level access control (services/warehouseScope.js).
  else if (Array.isArray(warehouseIds) && warehouseIds.length) filter.warehouseId = { $in: warehouseIds };
  return GRN.find(filter)
    .populate("warehouseId", "name code")
    .populate("supplierId", "name")
    .populate("lines.productId", "productName skuNumber category")
    .sort({ createdAt: -1 });
}

async function getGRN(companyId, grnId) {
  const grn = await GRN.findOne({ _id: grnId, companyId })
    .populate("warehouseId", "name code")
    .populate("supplierId", "name")
    .populate("lines.productId", "productName skuNumber category");
  if (!grn) throw httpErr("GRN not found", 404);
  return grn;
}

module.exports = {
  createGRN,
  receiveGRN,
  postGRN,
  writeOffDamaged,
  listGRNs,
  getGRN,
  // exported for return service reuse
  nextGrnNumber,
};
