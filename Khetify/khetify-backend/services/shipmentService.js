const crypto = require("crypto");
const mongoose = require("mongoose");
const Shipment = require("../model/Transport/Shipment");
const Vehicle = require("../model/Transport/Vehicle");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const Discrepancy = require("../model/Transport/Discrepancy");
const Order = require("../model/Order/Order");
const Package = require("../model/Outbound/Package");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
// Physical outer boxes of a lot — read here only, to group a transfer's serials
// under the Bulk Packaging ID they travelled in (shipmentDetails).
const BulkPackage = require("../model/Inventory/BulkPackage");
const RepackBox = require("../model/Inventory/RepackBox");
const { withTransaction } = require("./txn");
const { withinGeofence } = require("./geoService");
const { assertWarehouseCapacity } = require("./warehouseCapacityService");
const barcodeService = require("./barcodeService");
// planAllocation only — it SPLITS a product quantity across lots (earliest
// expiry first) and writes nothing. lotService does not require this module
// back, so there is no cycle.
const lotService = require("./lotService");
// Scan-out verification for warehouse→warehouse transfers (dispatch only).
const { assertDispatchScanned } = require("./dispatchScanService");
let emitToCompany = () => {};
let emitToSeller = () => {};
try { ({ emitToCompany, emitToSeller } = require("../sockets")); } catch { /* sockets optional in tests */ }

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Resolve actor ids to display names for READ-ONLY detail views.
 *
 * A shipment step can be taken by a warehouse USER or by the company owner —
 * company-owner tokens are signed with `id === companyId`, so the same id space
 * covers both collections and both must be consulted. Unknown ids are simply
 * absent from the map, which renders as "—" rather than a raw ObjectId.
 */
async function actorNames(ids) {
  const uniq = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!uniq.length) return new Map();
  const User = require("../model/User/User");
  const Company = require("../model/Company/Company");
  const [users, companies] = await Promise.all([
    User.find({ _id: { $in: uniq } }).select("name").lean(),
    Company.find({ _id: { $in: uniq } }).select("companyInfo.companyName fullName").lean(),
  ]);
  const byId = new Map();
  for (const u of users) if (u.name) byId.set(String(u._id), u.name);
  for (const c of companies) {
    const label = c.companyInfo?.companyName || c.fullName;
    if (label && !byId.has(String(c._id))) byId.set(String(c._id), label);
  }
  return byId;
}

/**
 * THE shipment reference — the single definition, reused everywhere a shipment
 * is shown (Shipments list, Transfer History, Supply Request detail, the
 * incoming-by-lot lookup, shipmentDetails).
 *
 * There is no stored reference column: `SH-<last 6 of _id>` is DERIVED from the
 * immutable Mongo _id, so it is stable for the life of the shipment without
 * costing a counter or a write. A carrier LR number, when one has been entered,
 * IS the real-world reference and wins — that is why the fallback exists.
 *
 * Kept in one place ON PURPOSE: the whole point of the Shipments list's ref
 * column is that an operator can match a row against the same SH-… they read in
 * Transfer History. Two copies of this expression that drift apart would break
 * exactly that. Do not re-inline it.
 */
function shipmentRef(shipment) {
  if (!shipment?._id) return null;
  return shipment.lrNumber || `SH-${String(shipment._id).slice(-6).toUpperCase()}`;
}

/**
 * A REACHABLE link to this shipment's delivery challan scan, resolved from the
 * stored key at read time (signed under the S3 driver, /uploads/<key> under
 * local). Null when the shipment carries no challan document.
 */
async function challanUrl(shipment) {
  const key = shipment?.challanDocument?.key;
  if (!key) return null;
  return require("./fileService").signedUrl(key);
}

/**
 * The same resolver, for any stored despatch document on a shipment.
 *
 * `challanUrl` above is left exactly as it is because other callers use it by
 * name; this is the general form the list uses for the BL and the Bill so all
 * three documents are read through ONE code path instead of three copies.
 * Returns null when nothing is stored, so a row without the paper skips the
 * signing call entirely.
 */
async function shipmentDocUrl(shipment, field) {
  const key = shipment?.[field]?.key;
  if (!key) return null;
  return require("./fileService").signedUrl(key);
}

/** Name off a populated warehouse ref; null when it is still a bare ObjectId. */
const warehouseName = (ref) => (ref && typeof ref === "object" && ref.name) || null;

/**
 * The From / To a shipment ACTUALLY moved between, resolved from the warehouse
 * RELATIONS rather than the denormalised *Label strings.
 *
 * `toLabel` is not a warehouse name — it is a decorated string built at creation,
 * e.g. `${toWh?.name || "Warehouse"} (stock request)` (transferRequestController)
 * or `${toWh?.name || "Warehouse"} (transfer)` (sellerTransferService). When that
 * lookup came back empty the stored label degraded to the literal
 * "Warehouse (transfer)" — a business-flow label sitting where a warehouse name
 * belongs. The relation is the truth, so read it first; this is the same
 * resolution Transfer History already uses, which is why that view reads correctly.
 *
 * A warehouse-bound shipment falls back to "—" rather than the label: the label
 * is known to carry flow text, and an em dash is honest where a wrong name is not.
 * Customer/seller/vendor destinations have no warehouse to resolve, so for those
 * `toLabel` IS the destination (the customer or seller name) and still applies.
 */
function shipmentRoute(shipment) {
  const from = warehouseName(shipment.fromWarehouseId) || shipment.fromLabel || "—";
  const toWarehouse = warehouseName(shipment.toWarehouseId);
  const to = shipment.toType === "warehouse"
    ? toWarehouse || "—"
    : toWarehouse || shipment.toLabel || "—";
  return { fromName: from, toName: to };
}

/**
 * Owner-awareness. Every service entry takes an `owner` first argument that is
 * EITHER a bare companyId (legacy/company callers — normalised to a company
 * owner) OR an explicit { ownerType, ownerId } (sellers). This lets seller
 * inter-warehouse transfers ride the SAME shipment lifecycle, scoped to the
 * seller, without changing any company call site.
 */
function normalizeOwner(arg) {
  if (arg && typeof arg === "object" && arg.ownerType) return { ownerType: arg.ownerType, ownerId: arg.ownerId };
  return { ownerType: "company", ownerId: arg };
}
/** Mongo filter that scopes a Shipment query to its owner. */
function ownerScope(owner) {
  return owner.ownerType === "seller"
    ? { ownerType: "seller", ownerId: owner.ownerId }
    : { companyId: owner.ownerId };
}
/** Mongo filter that scopes a Warehouse to its owner. */
function warehouseOwnerScope(owner) {
  return owner.ownerType === "seller" ? { sellerId: owner.ownerId } : { companyId: owner.ownerId };
}

const SECRET = () => process.env.JWT_SECRET || "test-secret";
const qrFor = (shipmentId) => crypto.createHmac("sha256", SECRET()).update(`ship:${shipmentId}`).digest("hex").slice(0, 16);

function pushStatus(shipment, status, { byUserId, warehouseId, lat, lng, note } = {}) {
  shipment.status = status;
  shipment.statusHistory.push({ status, at: new Date(), byUserId, warehouseId, lat, lng, note });
}
function emit(shipment) {
  const payload = { _id: shipment._id, status: shipment.status };
  if (shipment.companyId) { try { emitToCompany(shipment.companyId, "shipment:update", payload); } catch { /* noop */ } }
  // Owner + cross-owner visibility: push to a seller owner and/or a seller
  // destination so their portals refresh in real time.
  if (shipment.ownerType === "seller" && shipment.ownerId) {
    try { emitToSeller(shipment.ownerId, "shipment:update", payload); } catch { /* noop */ }
  }
  if (shipment.toOwnerType === "seller" && shipment.toOwnerId && String(shipment.toOwnerId) !== String(shipment.ownerId || "")) {
    try { emitToSeller(shipment.toOwnerId, "shipment:update", payload); } catch { /* noop */ }
  }
}

/* ----------------------------------------------------------------- create */

async function createShipment(ownerArg, body) {
  const owner = normalizeOwner(ownerArg);
  const companyId = owner.ownerType === "company" ? owner.ownerId : undefined;
  const { refType = "Manual", refId = null, fromWarehouseId = null, toType = "customer", toWarehouseId = null, toOwnerType = "company", toOwnerId = null, customerId = null, toLabel, lines = [], vehicleId, driverId, vehicleNo, driverName, driverPhone, transporter, ewayBillNo, lrNumber, freightCost, plannedRoute, deliveryChallanNumber, challanDocument, biltyNumber, biltyDocument, billNumber, billDocument, performedBy } = body;
  if (!toLabel) throw httpErr("toLabel is required");
  if (vehicleId) {
    const v = await Vehicle.findOne({ _id: vehicleId, ...warehouseOwnerScope(owner) });
    if (!v) throw httpErr("Vehicle not found", 404);
  }

  // For warehouse transfers, enrich each line from its OWNER's source inventory
  // row. Supply shipments arrive with fully-built lines (FEFO-picked by the
  // supply controller) — pass them through.
  //
  // A line may name EITHER an exact lot (`inventoryId`, what Lots → Transfer and
  // accepted stock requests send) OR just a PRODUCT and a quantity, which is
  // what the warehouse New Shipment form sends: the operator says what and how
  // much, and the lots are chosen here, earliest expiry first. Nothing is
  // reserved or deducted either way — lotService.planAllocation only plans, and
  // stock moves at dispatch.
  let enriched = lines;
  if (toType === "warehouse") {
    enriched = [];
    for (const l of lines) {
      if (!l.inventoryId && l.productId) {
        if (!fromWarehouseId) throw httpErr("A source warehouse is required to ship by product", 400);
        const allocs = await lotService.planAllocation({
          ownerType: owner.ownerType, ownerId: owner.ownerId,
          productId: l.productId, qty: Number(l.qty), warehouseId: fromWarehouseId,
        });
        for (const a of allocs) {
          enriched.push({
            inventoryId: a.inventoryId, productId: l.productId,
            lotNumber: a.lotNumber, batchNumber: a.batchNumber, qty: a.qty,
          });
        }
        continue;
      }
      const inv = await Inventory.findOne({ _id: l.inventoryId, ownerId: owner.ownerId, ownerType: owner.ownerType });
      if (!inv) throw httpErr(`Source inventory ${l.inventoryId} not found`, 404);
      enriched.push({ inventoryId: inv._id, productId: inv.productId, lotNumber: inv.lotNumber, batchNumber: inv.batchNumber, qty: Number(l.qty) });
    }
  }

  const from = fromWarehouseId ? await Warehouse.findOne({ _id: fromWarehouseId, ...warehouseOwnerScope(owner) }) : null;
  const shipment = await Shipment.create({
    companyId, ownerType: owner.ownerType, ownerId: owner.ownerId,
    refType, refId, fromWarehouseId, fromLabel: from?.name, toType, toWarehouseId,
    toOwnerType, toOwnerId: toOwnerId || (toOwnerType === "company" ? companyId : null), customerId, toLabel,
    lines: enriched, vehicleId, driverId, vehicleNo, driverName, driverPhone, transporter, ewayBillNo, lrNumber, freightCost,
    // Delivery challan captured when the shipment is raised. Both are optional
    // at this layer — the warehouse form requires them, other creators (Lots →
    // Transfer, accepted stock requests, supply) raise shipments without one.
    deliveryChallanNumber, ...(challanDocument?.key ? { challanDocument } : {}),
    // BL and BILL — persisted exactly like the challan beside them: the number
    // always, the document only when one was actually stored, so an absent file
    // leaves the field unset rather than writing an empty sub-document.
    ...(biltyNumber ? { biltyNumber } : {}), ...(biltyDocument?.key ? { biltyDocument } : {}),
    ...(billNumber ? { billNumber } : {}), ...(billDocument?.key ? { billDocument } : {}),
    plannedRoute, status: "planned", statusHistory: [{ status: "planned", at: new Date(), byUserId: performedBy }],
  });
  return shipment;
}

/* ---------------------------------------------------------------- approve */

/** Approve a planned shipment (lifecycle: created → approved → dispatched). */
async function approveShipment(ownerArg, shipmentId, { performedBy } = {}) {
  const owner = normalizeOwner(ownerArg);
  const shipment = await Shipment.findOne({ _id: shipmentId, ...ownerScope(owner) });
  if (!shipment) throw httpErr("Shipment not found", 404);
  if (!["draft", "planned"].includes(shipment.status)) throw httpErr(`Cannot approve a ${shipment.status} shipment`, 409);
  pushStatus(shipment, "approved", { byUserId: performedBy, warehouseId: shipment.fromWarehouseId });
  await shipment.save();
  emit(shipment);
  return shipment;
}

/* ------------------------------------------------------------- pick / pack */

/**
 * Send-Stock PICK for a transfer shipment — scan units/lots (or enter qty)
 * until each line's requested qty is met. `picks` is
 * [{ lineIndex, qty?, serials? }]; serials (scanned) count 1 each and are
 * recorded on the line, otherwise qty is added. pickedQty is capped at the
 * line's qty. The shipment becomes "picked" once every line is fully picked,
 * else "picking". Owner-scoped; only the source side calls this.
 */
async function pickShipment(ownerArg, shipmentId, { picks = [], performedBy } = {}) {
  const owner = normalizeOwner(ownerArg);
  const shipment = await Shipment.findOne({ _id: shipmentId, ...ownerScope(owner) });
  if (!shipment) throw httpErr("Shipment not found", 404);
  if (!["planned", "picking"].includes(shipment.status)) throw httpErr(`Cannot pick a ${shipment.status} shipment`, 409);

  for (const p of picks || []) {
    const idx = Number(p.lineIndex);
    const line = shipment.lines[idx];
    if (!line) throw httpErr(`Invalid pick line ${p.lineIndex}`, 400);
    const remaining = (line.qty || 0) - (line.pickedQty || 0);
    if (remaining <= 0) continue;
    let add;
    if (Array.isArray(p.serials) && p.serials.length) {
      // Scan-pick: dedupe within the line, count each fresh serial as one unit.
      const fresh = p.serials.filter((s) => s && !(line.serials || []).includes(s)).slice(0, remaining);
      line.serials = [...(line.serials || []), ...fresh];
      add = fresh.length;
    } else {
      add = Math.max(0, Math.min(remaining, Number(p.qty) || 0));
    }
    line.pickedQty = (line.pickedQty || 0) + add;
  }

  const fully = shipment.lines.length > 0 && shipment.lines.every((l) => (l.pickedQty || 0) >= (l.qty || 0));
  pushStatus(shipment, fully ? "picked" : "picking", { byUserId: performedBy, warehouseId: shipment.fromWarehouseId });
  await shipment.save();
  emit(shipment);
  return shipment;
}

/**
 * Send-Stock PACK for a transfer shipment — only a fully-picked shipment can be
 * packed. Moves it to "packed", ready for the label-gated dispatch. Owner-scoped.
 */
async function packShipment(ownerArg, shipmentId, { performedBy } = {}) {
  const owner = normalizeOwner(ownerArg);
  const shipment = await Shipment.findOne({ _id: shipmentId, ...ownerScope(owner) });
  if (!shipment) throw httpErr("Shipment not found", 404);
  if (shipment.status === "packed") return shipment; // idempotent
  if (shipment.status !== "picked") throw httpErr("Pick every line in full before packing", 409);
  pushStatus(shipment, "packed", { byUserId: performedBy, warehouseId: shipment.fromWarehouseId });
  await shipment.save();
  emit(shipment);
  return shipment;
}

/* --------------------------------------------------------------- dispatch */

/**
 * Dispatch: stock physically leaves. For TRANSFERS, deduct each source line
 * (in_transit_out) — the goods are now "in transit" and belong to no warehouse
 * until receipt. Generates a manifest QR (HMAC) printed/shown to the receiver.
 *
 * The manifest QR/barcode (qrPayload) is not secret: the sender can re-display
 * it any time. Receiving needs only this QR + destination-warehouse validation.
 */
async function dispatchShipment(ownerArg, shipmentId, { performedBy, lat, lng, scannedCodes } = {}) {
  const owner = normalizeOwner(ownerArg);
  const companyId = owner.ownerType === "company" ? owner.ownerId : undefined;
  const shipment = await Shipment.findOne({ _id: shipmentId, ...ownerScope(owner) });
  if (!shipment) throw httpErr("Shipment not found", 404);

  // SCAN-OUT for a warehouse→warehouse transfer. Runs before the status gate
  // and before anything moves, so a shipment that fails verification is left
  // exactly as it was. No-op unless the caller actually supplied a scan, which
  // keeps every existing dispatch path untouched.
  if (companyId && Array.isArray(scannedCodes)) {
    const verified = await assertDispatchScanned(companyId, shipment, scannedCodes);
    /**
     * WHAT WAS SCANNED IS WHAT LEAVES.
     *
     * The lines on a planned shipment are an ALLOCATION — chosen by earliest
     * expiry when the transfer was raised, before a single carton was picked.
     * The stock loop below deducts per line, so it was debiting the lots the
     * PLAN named rather than the lots the operator actually scanned out. With
     * two lots of one product (100 + 10) and a scan of 100 from the first and
     * 4 from the second, the plan's split (10 + 94) emptied the wrong lot and
     * left 6 in the other — exactly inverted.
     *
     * So the lines are rewritten from the verified scan before anything moves:
     * one line per lot ACTUALLY scanned, carrying its own serials. Everything
     * downstream — this deduction, the units marked shipped, and what the
     * destination receives — then follows the physical goods.
     *
     * Only ever narrows to what the scan proved: assertDispatchScanned has
     * already refused any code that is not on this shipment, not received, not
     * at this warehouse, or not in stock.
     */
    if (verified?.byLot?.length) {
      shipment.lines = verified.byLot.map((l) => ({
        inventoryId: l.inventoryId,
        productId: l.productId,
        lotNumber: l.lotNumber,
        batchNumber: l.batchNumber,
        qty: l.qty,
        serials: l.serials,
        pickedQty: l.qty,
        receivedQty: null,
      }));
    }
  }
  // "picked"/"packed" are the Send-Stock pipeline states (transfer shipments);
  // "planned"/"approved"/"loading" stay dispatchable for back-compat.
  if (!["draft", "planned", "picked", "packed", "approved", "loading"].includes(shipment.status)) throw httpErr(`Cannot dispatch a ${shipment.status} shipment`, 409);

  // Source-side owner (whose lots leave). For a company shipment that's the
  // company; for a seller transfer it's the seller.
  const srcOwnerType = shipment.ownerType || "company";
  const srcOwnerId = shipment.ownerId || companyId;

  // Stock physically leaves at dispatch for warehouse transfers AND seller
  // supply shipments (cross-owner): the source lots go in-transit.
  const deductsStock = shipment.toType === "warehouse" || shipment.toType === "seller";
  const isSupply = shipment.refType === "SupplyOrder";
  await withTransaction(async (session) => {
    if (deductsStock) {
      // Capacity guard for a warehouse-to-warehouse transfer: the whole
      // shipment must fit the destination. Checked at dispatch (before stock
      // leaves the source) so an overflowing transfer is stopped before goods
      // move. Source and destination share the same owner here, so srcOwner
      // scopes the destination occupancy correctly. Cross-owner supply
      // shipments (toType "seller") land under their own receipt rules.
      if (shipment.toType === "warehouse" && shipment.toWarehouseId) {
        const incoming = shipment.lines.reduce((s, l) => s + Math.max(0, Number(l.qty || 0)), 0);
        // Count stock already dispatched toward this destination but not yet
        // received. Without this, several queued transfers each pass the check
        // against stale (pre-arrival) occupancy and then all land — overflowing
        // the destination. A warehouse belongs to exactly one owner, so scoping
        // by the destination id alone is correct.
        const pend = await Shipment.aggregate([
          {
            $match: {
              _id: { $ne: shipment._id },
              toWarehouseId: new mongoose.Types.ObjectId(String(shipment.toWarehouseId)),
              status: { $in: ["dispatched", "in_transit", "arrived"] },
            },
          },
          { $unwind: "$lines" },
          { $group: { _id: null, units: { $sum: "$lines.qty" } } },
        ]).session(session);
        const inTransit = Number(pend?.[0]?.units) || 0;
        await assertWarehouseCapacity({ ownerType: srcOwnerType, ownerId: srcOwnerId, warehouseId: shipment.toWarehouseId, addQty: incoming + inTransit, session });
      }
      for (const line of shipment.lines) {
        let inv;
        if (isSupply) {
          // Supply was RESERVED at approval — commit it: reserved → out of
          // offlineStock (availableStock was already reduced at reserve, so it
          // stays put and online+offline−reserved holds). Ledger is `supply_out`
          // (never sale_*), mirrored by `supply_in` at the seller's receipt.
          inv = await Inventory.findOneAndUpdate(
            { _id: line.inventoryId, ownerId: srcOwnerId, ownerType: srcOwnerType, reservedStock: { $gte: line.qty } },
            { $inc: { reservedStock: -line.qty, offlineStock: -line.qty } },
            { new: true, session }
          );
          if (!inv) throw httpErr(`No reservation to dispatch for lot ${line.lotNumber} — re-approve to allocate`, 409);
          await StockMovement.create([{ inventoryId: inv._id, productId: inv.productId, ownerType: srcOwnerType, ownerId: srcOwnerId, type: "supply_out", channel: "internal", quantity: -line.qty, balanceAfter: inv.availableStock, refType: "SupplyOrder", refId: shipment._id, performedBy, note: `Supply out (shipment ${shipment._id})` }], { session });

          // EXACTLY THE UNITS THE PICKER ACCEPTED go in-transit — they are
          // recorded on the line at manifest time (supplyController.manifestLines).
          //
          // Selecting by lot + `.limit(line.qty)` instead hands out whichever
          // units of the lot happen to sort first, which need not be the picked
          // ones: a Bulk Packaging ID whose scan was REJECTED is still `in_stock`
          // on the same lot, and its units — minted first — sorted ahead of the
          // boxes that were actually picked. They shipped, landed at the seller's
          // receipt, and showed up in Seller Lot Details. Honouring the recorded
          // serials is what keeps a rejected package out of the transfer.
          //
          // No serials on the line = non-serialized stock, or a shipment planned
          // before serials were carried: keep the original quantity-only path.
          const pickedSerials = (line.serials || []).filter(Boolean);
          const unitScope = {
            ownerType: srcOwnerType, ownerId: srcOwnerId, inventoryId: line.inventoryId,
            status: { $in: ["packed", "picked", "in_stock"] },
          };
          const units = pickedSerials.length
            ? await UnitSerial.find({ ...unitScope, serial: { $in: pickedSerials } }).session(session)
            : await UnitSerial.find(unitScope).limit(line.qty).session(session);
          if (units.length) {
            await UnitSerial.updateMany(
              { _id: { $in: units.map((u) => u._id) } },
              { $set: { status: "shipped", currentShipmentId: shipment._id } },
              { session }
            );
            await UnitEvent.insertMany(
              units.map((u) => ({ companyId: u.companyId, serial: u.serial, event: "in_transit", fromStatus: u.status, toStatus: "shipped", refType: "Shipment", refId: shipment._id, actorId: performedBy })),
              { session }
            );
          }
        } else {
          // Warehouse transfer: deduct available now (not pre-reserved).
          inv = await Inventory.findOneAndUpdate(
            { _id: line.inventoryId, ownerId: srcOwnerId, ownerType: srcOwnerType, availableStock: { $gte: line.qty } },
            { $inc: { offlineStock: -line.qty, availableStock: -line.qty } },
            { new: true, session }
          );
          if (!inv) throw httpErr(`Insufficient stock to dispatch lot ${line.lotNumber}`, 409);
          await StockMovement.create([{ inventoryId: inv._id, productId: inv.productId, ownerType: srcOwnerType, ownerId: srcOwnerId, type: "in_transit_out", channel: "internal", quantity: -line.qty, balanceAfter: inv.availableStock, refType: "Transfer", refId: shipment._id, performedBy, note: `In-transit out (shipment ${shipment._id})` }], { session });

          // Child units FOLLOW THEIR PARENT LOT: the labeled units of this lot go
          // in-transit with the goods (mirrors the supply branch above), so they
          // stop being pickable at the source the moment the stock leaves, and
          // verifyReceipt can land them in the destination warehouse.
          // No-op when the lot has no child units (non-serialized stock is
          // completely unaffected). Creates/deletes nothing; serial, lotNumber,
          // productId and printed status are untouched.
          //
          // EXACTLY THE UNITS THAT WERE SCANNED, when the line records them.
          // Taking any `line.qty` units of the lot marked arbitrary serials as
          // shipped, so the codes that physically left were not the codes that
          // disappeared from the source's unit list. A line with no serials
          // (non-serialised stock, or a dispatch with no scan) keeps the
          // original quantity-only path.
          const shippedSerials = (line.serials || []).filter(Boolean);
          const unitFilter = {
            ownerType: srcOwnerType, ownerId: srcOwnerId, inventoryId: line.inventoryId,
            status: { $in: ["packed", "picked", "in_stock"] },
          };
          const units = shippedSerials.length
            ? await UnitSerial.find({ ...unitFilter, serial: { $in: shippedSerials } }).session(session)
            : await UnitSerial.find(unitFilter).limit(line.qty).session(session);
          if (units.length) {
            await UnitSerial.updateMany(
              { _id: { $in: units.map((u) => u._id) } },
              { $set: { status: "shipped", currentShipmentId: shipment._id } },
              { session }
            );
            await UnitEvent.insertMany(
              units.map((u) => ({ companyId: u.companyId, serial: u.serial, event: "in_transit", fromStatus: u.status, toStatus: "shipped", refType: "Shipment", refId: shipment._id, actorId: performedBy })),
              { session }
            );
          }
        }
      }
    }
  });

  shipment.qrToken = qrFor(shipment._id);
  shipment.dispatchedAt = new Date();
  pushStatus(shipment, "in_transit", { byUserId: performedBy, warehouseId: shipment.fromWarehouseId, lat, lng });
  await shipment.save();
  if (shipment.vehicleId) await Vehicle.updateOne({ _id: shipment.vehicleId, companyId }, { $set: { status: "on_trip" } });
  emit(shipment);

  const qrPayload = `${shipment._id}.${shipment.qrToken}`;

  // Code-free heads-up to the destination warehouse team: the manifest QR is
  // all they need to receive (plus destination-warehouse validation). The
  // qrPayload is NOT secret — the sender can re-display it any time.
  const toWarehouse = shipment.toType === "warehouse" && shipment.toWarehouseId;
  if (toWarehouse && shipment.ownerType !== "seller") {
    try {
      const { notifyWarehouseTeam } = require("./notificationService");
      await notifyWarehouseTeam(companyId, shipment.toWarehouseId, {
        type: "shipment",
        title: "Incoming transfer",
        body: `A transfer from ${shipment.fromLabel || "the source warehouse"} is on its way. Scan its manifest QR at your warehouse to receive it into stock.`,
        payload: { shipmentId: shipment._id, kind: "transfer_incoming" },
      });
    } catch { /* notifications are best-effort */ }
  } else if (toWarehouse && shipment.ownerType === "seller") {
    // Seller inter-warehouse transfer: heads-up to the seller to scan-receive.
    try {
      const { notify } = require("./notificationService");
      await notify({
        recipientType: "seller", recipientId: shipment.ownerId, type: "shipment",
        title: "Incoming transfer",
        body: `A transfer from ${shipment.fromLabel || "your source warehouse"} is on its way. Scan its manifest QR to receive it into stock.`,
        payload: { shipmentId: shipment._id, kind: "transfer_incoming" },
      }).catch(() => {});
    } catch { /* best-effort */ }
  }

  // Supply fulfilment: advance the linked SupplyOrder and tell the seller to
  // scan the manifest at their warehouse to receive it.
  if (isSupply && shipment.refId) {
    try {
      const SupplyOrder = require("../model/Supply/SupplyOrder");
      await SupplyOrder.updateOne({ _id: shipment.refId }, { $set: { status: "dispatched" } });
      const { notify } = require("./notificationService");
      await notify({
        recipientType: "seller", recipientId: shipment.toOwnerId, type: "supply_status",
        title: "Supply on its way",
        body: "Scan the manifest QR at your warehouse to receive this supply into stock.",
        payload: { shipmentId: shipment._id, supplyOrderId: shipment.refId, kind: "supply_dispatched" },
      }).catch(() => {});
    } catch { /* best-effort */ }
  }

  return { shipment, qrPayload };
}

/* ---------------------------------------------------------------- arrived */

async function markArrived(ownerArg, shipmentId, { driverId, lat, lng } = {}) {
  const owner = normalizeOwner(ownerArg);
  const shipment = await Shipment.findOne({ _id: shipmentId, ...ownerScope(owner) });
  if (!shipment) throw httpErr("Shipment not found", 404);
  if (driverId && shipment.driverId && String(shipment.driverId) !== String(driverId)) throw httpErr("Not your shipment", 403);
  if (!["in_transit", "dispatched"].includes(shipment.status)) throw httpErr(`Cannot mark arrived from ${shipment.status}`, 409);
  pushStatus(shipment, "arrived", { byUserId: driverId, lat, lng });
  await shipment.save();
  emit(shipment);

  // Supply fulfilment: mirror arrival onto the SupplyOrder and tell the seller
  // it's at their gate (they still receive by scanning the manifest QR).
  if (shipment.refType === "SupplyOrder" && shipment.refId) {
    try {
      const SupplyOrder = require("../model/Supply/SupplyOrder");
      await SupplyOrder.updateOne({ _id: shipment.refId, status: { $in: ["dispatched", "in_transit"] } }, { $set: { status: "arrived" } });
      const { notify } = require("./notificationService");
      await notify({
        recipientType: "seller", recipientId: shipment.toOwnerId, type: "supply_status",
        title: "Supply has arrived",
        body: "Your supply has arrived — scan the manifest QR to receive it into stock.",
        payload: { shipmentId: shipment._id, supplyOrderId: shipment.refId, kind: "supply_arrived" },
      }).catch(() => {});
    } catch { /* best-effort */ }
  }
  return shipment;
}

/* ----------------------------------------------- verify (warehouse receipt) */

/**
 * Verify a TRANSFER receipt at the destination warehouse — this IS the proof
 * of delivery for warehouse-to-warehouse shipments. Enforces:
 *   - manifest barcode/QR HMAC matches (barcode scan)
 *   - WAREHOUSE VALIDATION: the verifier must belong to the destination.
 *     `allowedWarehouseIds` (the caller's warehouse scope, null = unscoped
 *     admin) must contain toWarehouseId, and any explicitly supplied
 *     warehouseId must equal the destination — the source warehouse is
 *     rejected with "Access denied — wrong warehouse".
 *   - the verifier is NOT the driver (two-party attestation)
 *   - the device GPS is inside the destination warehouse geofence
 * Then lands received qty at the destination (in_transit_in). Any shortage
 * creates a Discrepancy and marks the shipment "partially_received"; a full
 * receipt marks it "received" (stock updated). Lots stay in transit until
 * this runs. Every step lands in statusHistory with user/time/warehouse.
 */
/**
 * MOVE THE PHYSICAL CARTONS that the just-landed units came in.
 *
 * WHY BOTH FIELDS. `lot_id` is what a reader follows to find a box's parent lot
 * (pickScanService.scanBulkPackage), `warehouse_id` is where the carton is
 * booked (assertBoxOnShelf). Updating only one leaves the two disagreeing: with
 * `warehouse_id` alone the location check passes and the lot check then refuses
 * the same scan, because `lot_id` still resolves the source row.
 *
 * WHY MAIN BOXES ARE HANDLED SEPARATELY. On a three-level lot the units hang off
 * the INNER boxes; a main box holds no units of its own, so it never appears in
 * the unit set and would be stranded in the source warehouse while the boxes
 * inside it moved. It is carried across only when EVERY inner box it holds has
 * moved — a carton half of which is still at the source has not gone anywhere.
 *
 * Writes nothing else: `bulk_packaging_id`, `box_serial`, `box_level`,
 * `parent_box_id`, `lot_number` and the receive history are all untouched, and a
 * lot with no bulk packaging is a no-op.
 */
async function moveBoxesWithUnits({ companyId, units, toLotId, toWarehouseId, session }) {
  const movedIds = [...new Set(
    units.map((u) => u.bulk_packaging_record_id).filter(Boolean).map(String)
  )];
  if (!movedIds.length) return;

  // The main boxes above the inner boxes that moved, and how many inner boxes
  // each of them actually holds — a parent travels only when all of them did.
  const moved = await BulkPackage.find({ _id: { $in: movedIds }, company_id: companyId })
    .select("parent_box_id")
    .session(session)
    .lean();
  const parentIds = [...new Set(moved.map((b) => b.parent_box_id).filter(Boolean).map(String))];

  const wholeParents = [];
  if (parentIds.length) {
    const movedSet = new Set(movedIds);
    const children = await BulkPackage.find({ parent_box_id: { $in: parentIds }, company_id: companyId })
      .select("parent_box_id")
      .session(session)
      .lean();
    const byParent = new Map();
    for (const c of children) {
      const key = String(c.parent_box_id);
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(String(c._id));
    }
    for (const [parent, kids] of byParent) {
      if (kids.every((id) => movedSet.has(id))) wholeParents.push(parent);
    }
  }

  await BulkPackage.updateMany(
    { _id: { $in: [...movedIds, ...wholeParents] }, company_id: companyId },
    { $set: { lot_id: toLotId, warehouse_id: toWarehouseId } },
    { session }
  );
}

async function verifyReceipt(ownerArg, shipmentId, { verifierId, qr, warehouseId, allowedWarehouseIds = null, lat, lng, lines = [], performedBy }) {
  const owner = normalizeOwner(ownerArg);
  const companyId = owner.ownerType === "company" ? owner.ownerId : undefined;
  const shipment = await Shipment.findOne({ _id: shipmentId, ...ownerScope(owner) });
  if (!shipment) throw httpErr("Shipment not found", 404);
  if (!["warehouse", "seller"].includes(shipment.toType)) throw httpErr("Use the delivery flow for customer shipments", 400);
  if (!["in_transit", "arrived", "verifying"].includes(shipment.status)) throw httpErr(`Cannot verify a ${shipment.status} shipment`, 409);

  // Where the received stock lands: the company (warehouse transfer) or the
  // seller (supply shipment OR seller→seller transfer). Falls back to the
  // shipment's owner for legacy rows.
  const landOwnerType = shipment.toOwnerType || shipment.ownerType || "company";
  const landOwnerId = shipment.toOwnerId || shipment.ownerId || companyId;
  const toSeller = landOwnerType === "seller";
  const isSupply = shipment.refType === "SupplyOrder";

  // QR / HMAC integrity (barcode scan)
  const expectedQr = `${shipment._id}.${shipment.qrToken}`;
  if (!qr || qr !== expectedQr) throw httpErr("Manifest barcode does not match this shipment", 409);

  // Warehouse validation — the core receiving control:
  // scanned lot destination must equal the verifier's warehouse.
  if (Array.isArray(allowedWarehouseIds) && !allowedWarehouseIds.map(String).includes(String(shipment.toWarehouseId))) {
    throw httpErr("Access denied — wrong warehouse", 403);
  }
  if (warehouseId) {
    if (shipment.fromWarehouseId && String(warehouseId) === String(shipment.fromWarehouseId)) {
      throw httpErr("Access denied — wrong warehouse (source cannot complete the receipt)", 403);
    }
    if (String(warehouseId) !== String(shipment.toWarehouseId)) {
      throw httpErr("Access denied — wrong warehouse", 403);
    }
  }

  // Driver cannot self-verify
  if (verifierId && shipment.driverId && String(verifierId) === String(shipment.driverId)) {
    throw httpErr("The driver cannot verify their own delivery", 403);
  }

  // Destination warehouse — owner-aware (company transfer vs seller supply).
  const dest = await Warehouse.findOne(
    toSeller ? { _id: shipment.toWarehouseId, sellerId: landOwnerId } : { _id: shipment.toWarehouseId, companyId }
  );
  if (!dest) throw httpErr("Destination warehouse not found", 404);
  // Geofence is enforced for company warehouse receipts (GPS-attested). Seller
  // receipts are validated by warehouse ownership + manifest QR instead.
  if (!toSeller) {
    const fence = withinGeofence(dest, lat, lng);
    if (!fence.ok) throw httpErr(`Outside warehouse geofence (${fence.distance}m > ${fence.radius}m)`, 409);
  }

  // Lifecycle trace: barcode scanned at the destination (user/time/warehouse).
  pushStatus(shipment, "verifying", { byUserId: verifierId, warehouseId: shipment.toWarehouseId, lat, lng, note: "Manifest barcode scanned — warehouse validated" });

  const received = new Map((lines || []).map((l) => [Number(l.lineIndex), l]));
  let shortages = 0;

  await withTransaction(async (session) => {
    for (let i = 0; i < shipment.lines.length; i++) {
      const line = shipment.lines[i];
      const r = received.get(i);
      const recvQty = r && r.receivedQty != null ? Number(r.receivedQty) : line.qty;
      line.receivedQty = recvQty;

      if (recvQty > 0 && toSeller && isSupply) {
        // SELLER LANDING (supply): mirror the lot identity into the seller's
        // warehouse, preserving lotNumber/expiry/mfg from the source lot.
        const srcLot = await Inventory.findById(line.inventoryId).select("expiryDate mfgDate").session(session);
        const sellerLot = await Inventory.findOneAndUpdate(
          { productId: line.productId, ownerType: "seller", ownerId: landOwnerId, warehouseId: shipment.toWarehouseId, batchNumber: line.batchNumber },
          {
            $inc: { offlineStock: recvQty, availableStock: recvQty },
            $setOnInsert: { lotNumber: line.lotNumber, expiryDate: srcLot?.expiryDate || null, mfgDate: srcLot?.mfgDate || null },
          },
          { new: true, upsert: true, session }
        );
        await StockMovement.create([{ inventoryId: sellerLot._id, productId: line.productId, ownerType: "seller", ownerId: landOwnerId, type: "supply_in", channel: "internal", quantity: recvQty, balanceAfter: sellerLot.availableStock, refType: "SupplyOrder", refId: shipment.refId, performedBy, note: `Supply received (shipment ${shipment._id})` }], { session });

        // Path A: the in-transit (shipped) units of this lot become seller-owned.
        // Narrowed to the line's recorded serials so ONLY units this shipment
        // actually dispatched can ever become seller stock — a second guard on
        // the same invariant dispatch enforces above.
        const landSerials = (line.serials || []).filter(Boolean);
        const units = await UnitSerial.find({
          ownerType: "company", ownerId: companyId, inventoryId: line.inventoryId,
          status: "shipped", currentShipmentId: shipment._id,
          ...(landSerials.length && { serial: { $in: landSerials } }),
        }).limit(recvQty).session(session);
        if (units.length) {
          await UnitSerial.updateMany(
            { _id: { $in: units.map((u) => u._id) } },
            { $set: { ownerType: "seller", ownerId: landOwnerId, inventoryId: sellerLot._id, status: "in_stock", currentShipmentId: null } },
            { session }
          );
          await UnitEvent.insertMany(
            units.map((u) => ({ companyId: u.companyId, serial: u.serial, event: "supplied_to_seller", fromStatus: "shipped", toStatus: "in_stock", refType: "SupplyOrder", refId: shipment.refId, actorId: verifierId })),
            { session }
          );
        }
      } else if (recvQty > 0 && toSeller) {
        // SELLER → SELLER TRANSFER LANDING: land the in-transit stock into the
        // destination seller warehouse (transfer_in), mirroring the company
        // warehouse-transfer landing but owner-scoped to the seller.
        const srcLot = await Inventory.findById(line.inventoryId).select("expiryDate mfgDate").session(session);
        const landLot = await Inventory.findOneAndUpdate(
          { productId: line.productId, ownerType: "seller", ownerId: landOwnerId, warehouseId: shipment.toWarehouseId, batchNumber: line.batchNumber },
          { $inc: { offlineStock: recvQty, availableStock: recvQty }, $set: { lotNumber: line.lotNumber }, $setOnInsert: { expiryDate: srcLot?.expiryDate || null, mfgDate: srcLot?.mfgDate || null } },
          { new: true, upsert: true, session }
        );
        await StockMovement.create([{ inventoryId: landLot._id, productId: line.productId, ownerType: "seller", ownerId: landOwnerId, type: "in_transit_in", channel: "internal", quantity: recvQty, balanceAfter: landLot.availableStock, refType: "Transfer", refId: shipment._id, performedBy, note: `Transfer in (shipment ${shipment._id})` }], { session });
      } else if (recvQty > 0) {
        // Carry the source lot's IMMUTABLE metadata onto the destination row.
        // A warehouse→warehouse transfer moves quantity + location only — it must
        // never lose the lot identity the Company entered once at creation.
        // $setOnInsert (not $set) so a merge into an existing destination row
        // never overwrites metadata that is already there.
        // NB: product-level attributes (MRP, SKU, category, brand, packing) are
        // NOT copied — they live on the Product and are resolved through
        // productId, so the destination row inherits them automatically.
        const srcLot = await Inventory.findById(line.inventoryId).select("expiryDate mfgDate mfgBatchNo").session(session);
        const inv = await Inventory.findOneAndUpdate(
          { productId: line.productId, ownerType: "company", ownerId: companyId, warehouseId: shipment.toWarehouseId, batchNumber: line.batchNumber },
          {
            $inc: { offlineStock: recvQty, availableStock: recvQty },
            $set: { lotNumber: line.lotNumber },
            $setOnInsert: {
              expiryDate: srcLot?.expiryDate || null,
              mfgDate: srcLot?.mfgDate || null,
              mfgBatchNo: srcLot?.mfgBatchNo || null,
            },
          },
          { new: true, upsert: true, session }
        );
        await StockMovement.create([{ inventoryId: inv._id, productId: line.productId, ownerType: "company", ownerId: companyId, type: "in_transit_in", channel: "internal", quantity: recvQty, balanceAfter: inv.availableStock, refType: "Transfer", refId: shipment._id, performedBy, note: `In-transit in (shipment ${shipment._id})` }], { session });

        // Child units FOLLOW THEIR PARENT LOT into the receiving warehouse.
        // A "lot" is one Inventory row per (product, owner, warehouse, batch), so
        // the SAME parent lot (lotNumber) has a row per warehouse. Repointing a
        // unit's inventoryId to the destination row is exactly how its warehouse
        // moves (warehouse is derived via inventoryId → Inventory.warehouseId) —
        // the identical rule the seller-supply landing above already uses.
        //
        // PRESERVED verbatim: serial, lotNumber/batchNumber (the parent lot
        // identity), productId, companyId, printed/printedAt, mfgBatchNo. Nothing
        // is created, duplicated or deleted; no serial is regenerated. Runs in
        // THIS transaction, so stock + units land together or not at all. No-op
        // for non-serialized lots.
        const units = await UnitSerial.find({
          ownerType: "company", ownerId: companyId, inventoryId: line.inventoryId,
          status: "shipped", currentShipmentId: shipment._id,
        }).limit(recvQty).session(session);
        if (units.length) {
          await UnitSerial.updateMany(
            { _id: { $in: units.map((u) => u._id) } },
            { $set: { inventoryId: inv._id, status: "in_stock", currentShipmentId: null } },
            { session }
          );
          await UnitEvent.insertMany(
            units.map((u) => ({ companyId: u.companyId, serial: u.serial, event: "transferred_in", fromStatus: "shipped", toStatus: "in_stock", refType: "Transfer", refId: shipment._id, actorId: verifierId })),
            { session }
          );
        }

        // BOXES FOLLOW THEIR UNITS, for the same reason the units follow their
        // lot — and they were the one thing this landing left behind.
        //
        // A BulkPackage row states its location TWICE: `lot_id` (the Inventory
        // row the carton belongs to) and `warehouse_id` (where it is booked).
        // Neither was touched here, so after a warehouse->warehouse transfer the
        // quantity and the unit labels sat in the destination while every carton
        // still pointed at the SOURCE row in the SOURCE warehouse.
        //
        // That is exactly what a pick scan reads: assertBoxOnShelf takes the
        // carton's location from `box.warehouse_id || lot.warehouseId`, and
        // scanBulkPackage resolves its parent lot through `box.lot_id`
        // (services/pickScanService.js). So scanning a BOX at the destination was
        // refused with "... is currently at <source>, not <destination>", while
        // scanning the parent LOT NUMBER resolved the destination Inventory row
        // and reported the opposite — two answers to one question, from two
        // records that had stopped agreeing.
        //
        // Derived from the units that actually landed, so a PARTIAL transfer
        // moves only the cartons that travelled. Nothing is created or deleted
        // and no `bulk_packaging_id` is rewritten — that identity is printed on
        // the physical carton and never changes; only where the carton IS does.
        await moveBoxesWithUnits({
          companyId, units, toLotId: inv._id, toWarehouseId: shipment.toWarehouseId, session,
        });
      }

      const shortageQty = line.qty - recvQty;
      if (shortageQty !== 0) {
        shortages += 1;
        // Discrepancy rows are company-scoped today; record them for company
        // receipts. (Seller transfer shortage tracking can be added later.)
        if (companyId) {
          await Discrepancy.create([{ companyId, shipmentId: shipment._id, productId: line.productId, lotNumber: line.lotNumber, expectedQty: line.qty, receivedQty: recvQty, shortageQty, reason: shortageQty > 0 ? "shortage" : "excess", status: "open" }], { session });
        }
      }
    }
  });

  shipment.pod = { ...shipment.pod, verifiedBy: verifierId, verifiedAt: new Date(), warehouseId: shipment.toWarehouseId, method: "scan" };
  pushStatus(shipment, shortages ? "partially_received" : "received", { byUserId: verifierId, warehouseId: shipment.toWarehouseId, lat, lng, note: shortages ? `${shortages} discrepancy line(s)` : "received in full — stock updated" });
  shipment.deliveredAt = new Date();
  await shipment.save();
  if (shipment.vehicleId) await Vehicle.updateOne({ _id: shipment.vehicleId, companyId }, { $set: { status: "available" } });
  emit(shipment);

  // Live stock update for the seller: the supply just landed into their
  // warehouse — tell their socket room so the Warehouses view refreshes its
  // occupancy in real time (no manual refresh).
  if (toSeller) {
    for (const line of shipment.lines) {
      if ((line.receivedQty ?? 0) > 0) {
        try { emitToSeller(landOwnerId, "seller:inventory:update", { warehouseId: String(shipment.toWarehouseId), productId: String(line.productId), lotNumber: line.lotNumber }); } catch { /* noop */ }
      }
    }
  }
  return { shipment, shortages };
}

/* ------------------------------------------------ customer delivery (POD) */

async function completeDelivery(ownerArg, shipmentId, { verifierId, signedBy, photoUrls = [], lat, lng }) {
  const owner = normalizeOwner(ownerArg);
  const companyId = owner.ownerType === "company" ? owner.ownerId : undefined;
  const shipment = await Shipment.findOne({ _id: shipmentId, ...ownerScope(owner) });
  if (!shipment) throw httpErr("Shipment not found", 404);
  if (!["in_transit", "arrived", "verifying"].includes(shipment.status)) throw httpErr(`Cannot deliver a ${shipment.status} shipment`, 409);

  const podOk = photoUrls.length > 0 || signedBy;
  if (!podOk) throw httpErr("Provide a proof-of-delivery (photo or signed-by name)", 409);

  // Mark the order's shipped serials as sold.
  if (shipment.refType === "Order" && shipment.refId) {
    const order = await Order.findOne({ _id: shipment.refId, companyId });
    if (order) {
      const pkgs = await Package.find({ companyId, orderId: order._id });
      const serials = pkgs.flatMap((p) => p.items.flatMap((i) => i.serials || []));
      if (serials.length) {
        await barcodeService.transitionUnits(companyId, serials, { toStatus: "sold", event: "sold", refType: "Shipment", refId: shipment._id, actorId: verifierId, set: { customerId: order.customerId }, force: true });
      }
      if (["shipped", "packed", "confirmed"].includes(order.status)) { order.status = "delivered"; await order.save(); }
    }
  }

  shipment.pod = { ...shipment.pod, signedBy, photoUrls, verifiedBy: verifierId, verifiedAt: new Date(), method: "scan" };
  pushStatus(shipment, "delivered", { byUserId: verifierId, lat, lng });
  shipment.deliveredAt = new Date();
  await shipment.save();
  if (shipment.vehicleId) await Vehicle.updateOne({ _id: shipment.vehicleId, companyId }, { $set: { status: "available" } });
  emit(shipment);
  return shipment;
}

async function reportException(ownerArg, shipmentId, { byUserId, note, lat, lng }) {
  const owner = normalizeOwner(ownerArg);
  const shipment = await Shipment.findOne({ _id: shipmentId, ...ownerScope(owner) });
  if (!shipment) throw httpErr("Shipment not found", 404);
  pushStatus(shipment, "exception", { byUserId, lat, lng, note });
  await shipment.save();
  emit(shipment);
  return shipment;
}

/* --------------------------------------------------------------- queries */

/* ------------------------------------------------- receive-by-lot lookup */

// A transfer can only be received in these states (mirrors verifyReceipt).
const RECEIVABLE = ["in_transit", "arrived", "verifying"];
const ALREADY_RECEIVED = ["received", "delivered", "partially_received"];

/**
 * Resolve an EXACT parent lot number to the incoming warehouse transfer that is
 * awaiting THIS receiver, for the Inventory → "Receive Lot" scan.
 *
 * READ-ONLY: moves no stock and changes no status. The caller confirms through
 * the normal POST /shipments/:id/verify, so the atomic stock + unit move stays
 * in verifyReceipt (single source of truth). Matching is exact (trim + upper
 * only) — never partial/prefix.
 */
async function findIncomingByLot(ownerArg, { lotNumber, allowedWarehouseIds = null }) {
  const owner = normalizeOwner(ownerArg);
  const lot = String(lotNumber || "").trim().toUpperCase();
  if (!lot) throw httpErr("Lot not found.", 404);

  // 1) Does this exact lot exist for this owner at all?
  const lotExists = await Inventory.exists({
    ownerType: owner.ownerType, ownerId: owner.ownerId,
    $or: [{ lotNumber: lot }, { batchNumber: lot }],
  });
  if (!lotExists) throw httpErr("Lot not found.", 404);

  // 2) Warehouse transfers carrying this exact lot, newest first.
  const all = await Shipment.find({
    ...ownerScope(owner),
    toType: "warehouse",
    $or: [{ "lines.lotNumber": lot }, { "lines.batchNumber": lot }],
  })
    .sort({ createdAt: -1 })
    .populate("fromWarehouseId", "name code")
    .populate("toWarehouseId", "name code")
    .populate("lines.productId", "productName skuNumber");
  if (!all.length) throw httpErr("No incoming transfer found for this lot.", 404);

  // 3) Only transfers destined to a warehouse this user actually receives for.
  const mine = Array.isArray(allowedWarehouseIds)
    ? all.filter((s) => allowedWarehouseIds.map(String).includes(String(s.toWarehouseId?._id || s.toWarehouseId)))
    : all;
  if (!mine.length) throw httpErr("This lot is not assigned to your warehouse.", 403);

  const ready = mine.find((s) => RECEIVABLE.includes(s.status));
  if (!ready) {
    if (mine.some((s) => ALREADY_RECEIVED.includes(s.status))) throw httpErr("This transfer has already been received.", 409);
    throw httpErr("This transfer is not ready to receive.", 409);
  }

  // 4) Enrich the matching line(s) with lot metadata for the confirm screen.
  const lines = [];
  for (const l of ready.lines || []) {
    const matches = String(l.lotNumber || "").toUpperCase() === lot || String(l.batchNumber || "").toUpperCase() === lot;
    if (!matches) continue;
    const src = await Inventory.findById(l.inventoryId).select("mfgBatchNo mfgDate expiryDate").lean();
    lines.push({
      productId: l.productId?._id || l.productId,
      productName: l.productId?.productName || "—",
      lotNumber: l.lotNumber, batchNumber: l.batchNumber,
      mfgBatchNo: src?.mfgBatchNo || null,
      mfgDate: src?.mfgDate || null,
      expiryDate: src?.expiryDate || null,
      qty: l.qty,
    });
  }

  return {
    shipmentId: ready._id,
    ref: shipmentRef(ready),
    status: ready.status,
    // The manifest token is NOT secret (the sender can re-display it at will) and
    // this caller is the authenticated, warehouse-scoped DESTINATION — so hand it
    // back, letting Confirm Receive go through the normal verify endpoint.
    qr: `${ready._id}.${ready.qrToken}`,
    toWarehouseId: ready.toWarehouseId?._id || ready.toWarehouseId,
    destination: ready.toWarehouseId?.name || "—",
    source: ready.fromWarehouseId?.name || ready.fromLabel || "—",
    dispatchedAt: ready.dispatchedAt || null,
    lines,
    totalQty: lines.reduce((s, l) => s + (l.qty || 0), 0),
  };
}

/**
 * READ-ONLY detail for ONE shipment/transfer: summary, the PARENT LOTS on its
 * lines, and the EXACT child serials it moved. Writes nothing.
 *
 * Serials are resolved from the append-only UnitEvent log (refId = this
 * shipment), NOT from UnitSerial.currentShipmentId — receipt clears that field,
 * so the event log is the only record that survives the full lifecycle. No
 * serial is ever synthesised: if the transfer hasn't been picked, the list is
 * simply empty.
 */
async function shipmentDetails(ownerArg, shipmentId, { allowedWarehouseIds = null } = {}) {
  const owner = normalizeOwner(ownerArg);
  const shipment = await Shipment.findOne({ _id: shipmentId, ...ownerScope(owner) })
    .populate("fromWarehouseId", "name code")
    .populate("toWarehouseId", "name code")
    // ADDITIVE: `category` joins the existing projection so Transfer History →
    // View can show Product Information without a second request. No existing
    // field is removed, so every current consumer is unaffected.
    .populate("lines.productId", "productName skuNumber mrp category")
    .lean();
  if (!shipment) throw httpErr("Shipment not found", 404);

  // Warehouse scoping: a scoped user may only open a movement their own
  // warehouse took part in (source or destination).
  if (Array.isArray(allowedWarehouseIds) && allowedWarehouseIds.length) {
    const mine = allowedWarehouseIds.map(String);
    const from = String(shipment.fromWarehouseId?._id || shipment.fromWarehouseId || "");
    const to = String(shipment.toWarehouseId?._id || shipment.toWarehouseId || "");
    if (!mine.includes(from) && !mine.includes(to)) throw httpErr("Access denied — wrong warehouse", 403);
  }

  // Every serial this shipment actually moved, from the audit trail.
  const evs = await UnitEvent.find({ refId: shipment._id }).select("serial event at").sort({ at: 1 }).lean();
  const stamps = new Map();
  for (const e of evs) {
    const s = stamps.get(e.serial) || {};
    if (e.event === "picked") s.pickedAt = e.at;
    if (e.event === "in_transit") s.dispatchedAt = e.at;
    if (["supplied_to_seller", "transferred_in"].includes(e.event)) s.receivedAt = e.at;
    stamps.set(e.serial, s);
  }
  const serials = [...stamps.keys()];
  const units = serials.length
    // ADDITIVE projection: unit_code is the spec's name for the printed code and
    // bulk_packaging_* is how a unit knows which physical box it travelled in —
    // both are needed to group this transfer's serials under their Bulk
    // Packaging IDs below. The pre-existing fields are all still selected.
    ? await UnitSerial.find({ serial: { $in: serials } })
        .select("serial lotNumber status ownerType inventoryId unit_code bulk_packaging_id bulk_packaging_record_id box_serial")
        .lean()
    : [];
  const bySerial = new Map(units.map((u) => [u.serial, u]));

  // Lot metadata for each line's parent lot.
  const invIds = [...new Set((shipment.lines || []).map((l) => String(l.inventoryId)).filter(Boolean))];
  const invRows = invIds.length
    // ADDITIVE fields: warehouseId + the has_bulk_packaging/number_of_boxes/
    // units_per_box trio let the View page state how the source lot was packed.
    ? await Inventory.find({ _id: { $in: invIds } })
        .select("mfgBatchNo mfgDate expiryDate lotNumber batchNumber warehouseId has_bulk_packaging number_of_boxes units_per_box")
        .populate("warehouseId", "name code")
        .lean()
    : [];
  const byInv = new Map(invRows.map((r) => [String(r._id), r]));

  // BULK PACKAGING for this transfer. The BulkPackage rows are the physical
  // boxes of the SOURCE lot; the serials above are what this shipment actually
  // moved. Joining the two gives "which box each transferred unit came out of"
  // WITHOUT inventing anything: a box only appears if this transfer carried at
  // least one unit from it. Read-only — nothing is written.
  const boxIds = [...new Set(units.map((u) => String(u.bulk_packaging_record_id || "")).filter(Boolean))];
  const boxRows = boxIds.length
    ? await BulkPackage.find({ _id: { $in: boxIds } })
        .select("bulk_packaging_id box_serial units_in_box status received_at lot_id")
        .sort({ box_serial: 1 })
        .lean()
    : [];
  const byBox = new Map(boxRows.map((b) => [String(b._id), b]));

  const parentLots = (shipment.lines || []).map((l) => {
    const meta = byInv.get(String(l.inventoryId)) || {};
    const lot = l.lotNumber || l.batchNumber || meta.lotNumber || "—";
    const mine = serials.filter((s) => {
      const u = bySerial.get(s);
      return u && (String(u.lotNumber || "") === String(lot) || String(u.inventoryId) === String(l.inventoryId));
    });
    return {
      lotNumber: lot,
      batchNumber: l.batchNumber || null,
      mfgBatchNo: meta.mfgBatchNo || null,
      productName: l.productId?.productName || "—",
      // ADDITIVE — Product Information on the read-only View page.
      category: l.productId?.category || null,
      // ADDITIVE — Product Details on the Company Transfer Details page. Both
      // values are already in the projection above; they were only being used to
      // compute the shipment `value` and were never surfaced per line.
      productCode: l.productId?.skuNumber || null,
      mrp: l.productId?.mrp ?? null,
      warehouse: meta.warehouseId?.name || null,
      allocatedQty: Number(l.qty || 0),
      receivedQty: l.receivedQty ?? null,
      mfgDate: meta.mfgDate || null,
      expiryDate: meta.expiryDate || null,
      status: shipment.status,
      // ADDITIVE — how the SOURCE lot was packed, so the page can say
      // "single package" vs "N boxes" without a second request.
      hasBulkPackaging: !!meta.has_bulk_packaging,
      numberOfBoxes: meta.number_of_boxes ?? null,
      unitsPerBox: meta.units_per_box ?? null,
      // ADDITIVE — the Bulk Packaging IDs this transfer drew units from, each
      // carrying ONLY the unit codes this transfer actually moved out of it.
      bulkPackages: mine
        .reduce((acc, s) => {
          const u = bySerial.get(s) || {};
          const key = String(u.bulk_packaging_record_id || "");
          if (!key) return acc; // unit not packed into a box — listed below
          let entry = acc.find((b) => b.key === key);
          if (!entry) {
            const box = byBox.get(key) || {};
            entry = {
              key,
              bulkPackagingId: box.bulk_packaging_id || u.bulk_packaging_id || "—",
              boxSerial: box.box_serial ?? u.box_serial ?? null,
              unitsInBox: box.units_in_box ?? null,
              status: box.status || null,
              receivedAt: box.received_at || null,
              unitCodes: [],
            };
            acc.push(entry);
          }
          entry.unitCodes.push(u.unit_code || s);
          return acc;
        }, [])
        .sort((a, b) => (a.boxSerial || 0) - (b.boxSerial || 0))
        .map(({ key, ...rest }) => rest),
      // ADDITIVE — transferred units with no parent box (single-package lots,
      // or labels minted before the lot was packed). A transfer carrying both
      // this AND bulkPackages is the "mixed" case; the UI shows both sections.
      looseUnitCodes: mine
        .filter((s) => !(bySerial.get(s) || {}).bulk_packaging_record_id)
        .map((s) => (bySerial.get(s) || {}).unit_code || s),
      units: mine.map((s) => {
        const u = bySerial.get(s) || {};
        const t = stamps.get(s) || {};
        return {
          serial: s,
          lotNumber: u.lotNumber || lot,
          status: u.status || "—",
          owner: u.ownerType || null,
          pickedAt: t.pickedAt || null,
          dispatchedAt: t.dispatchedAt || null,
          receivedAt: t.receivedAt || null,
        };
      }),
    };
  });

  const totalQty = (shipment.lines || []).reduce((s, l) => s + Number(l.qty || 0), 0);
  const value = (shipment.lines || []).reduce(
    (s, l) => s + Number(l.qty || 0) * Number(l.productId?.mrp || 0), 0);

  // ── ADDITIVE: who approved and who received ──
  // Read straight off records that already exist — the append-only statusHistory
  // and the proof-of-delivery block. A transfer raised as a stock REQUEST carries
  // its authorisation on the TransferRequest instead (decidedBy/decidedAt), so
  // that is the fallback. Nothing is written and no existing field changes.
  const history = shipment.statusHistory || [];
  const approvedEvent = history.find((e) => e.status === "approved");
  const receivedEvent = history.find((e) => ["received", "partially_received"].includes(e.status));
  const request = await require("../model/Transport/TransferRequest")
    .findOne({ shipmentId: shipment._id })
    .select("decidedBy decidedAt")
    .lean();
  const names = await actorNames([
    approvedEvent?.byUserId, request?.decidedBy,
    shipment.pod?.verifiedBy, receivedEvent?.byUserId,
  ]);
  const nameOf = (id) => (id ? names.get(String(id)) || null : null);

  return {
    summary: {
      ref: shipmentRef(shipment),
      refType: shipment.refType,
      toType: shipment.toType,
      source: shipment.fromWarehouseId?.name || shipment.fromLabel || "—",
      destination: shipment.toWarehouseId?.name || shipment.toLabel || "—",
      fromWarehouseId: shipment.fromWarehouseId?._id || shipment.fromWarehouseId || null,
      toWarehouseId: shipment.toWarehouseId?._id || shipment.toWarehouseId || null,
      products: (shipment.lines || []).map((l) => l.productId?.productName || "Item"),
      quantity: totalQty,
      value,
      status: shipment.status,
      // ADDITIVE — the delivery challan captured when the shipment was raised.
      // The link is resolved from the stored key on every read, so it is a
      // signed, short-lived URL on S3 and the served /uploads path locally.
      deliveryChallanNumber: shipment.deliveryChallanNumber || null,
      challanDocumentName: shipment.challanDocument?.name || null,
      challanDocumentUrl: await challanUrl(shipment),
      createdAt: shipment.createdAt,
      dispatchedAt: shipment.dispatchedAt || null,
      deliveredAt: shipment.deliveredAt || null,
      pickedAt: (shipment.statusHistory || []).find((e) => e.status === "picked")?.at || null,
      receivedAt: (shipment.statusHistory || []).find((e) => ["received", "partially_received"].includes(e.status))?.at || null,
      // ADDITIVE — Transfer Summary on the read-only Company Transfer Details page.
      approvedBy: nameOf(approvedEvent?.byUserId) || nameOf(request?.decidedBy),
      approvedAt: approvedEvent?.at || request?.decidedAt || null,
      receivedBy: nameOf(shipment.pod?.verifiedBy) || nameOf(receivedEvent?.byUserId),
    },
    parentLots,
    timeline: (shipment.statusHistory || []).map((e) => ({ status: e.status, at: e.at })),
  };
}

async function listShipments(ownerArg, { status, warehouseIds } = {}) {
  const owner = normalizeOwner(ownerArg);
  const filter = { ...ownerScope(owner) };
  if (status) filter.status = status;
  // Warehouse-level access: scoped users only see shipments touching their
  // assigned warehouses (incoming OR outgoing).
  if (Array.isArray(warehouseIds) && warehouseIds.length) {
    filter.$or = [{ fromWarehouseId: { $in: warehouseIds } }, { toWarehouseId: { $in: warehouseIds } }];
  }
  const rows = await Shipment.find(filter)
    .populate("vehicleId", "regNo")
    .populate("driverId", "name phone")
    // The warehouse relations were NOT populated here, which is why this list had
    // only the denormalised *Label strings to show and printed a flow label like
    // "Warehouse (transfer)" in the To column. Transfer History populates the same
    // two refs — that is the whole difference between the two views.
    .populate("fromWarehouseId", "name code")
    .populate("toWarehouseId", "name code")
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  // ADDITIVE: surface the same `ref` every other shipment view already shows, so
  // a row can be matched against the SH-… seen in Transfer History or on a
  // Supply Request, plus the From/To resolved from the warehouse relations.
  // Every existing field is passed through untouched — this only adds keys. No
  // shipment is created, modified or filtered out here.
  //
  // The challan link is RESOLVED FROM THE STORED KEY on every read (a signed,
  // short-lived URL under the S3 driver), never persisted — see fileService.
  // Rows without a challan skip the resolver entirely.
  // ADDITIVE — HOW MANY REPACK CARTONS were packed for each row.
  //
  // Cartons are assembled in the scan-out dialog out of loose picked units and,
  // once that dialog closed, their IDs were not reachable from anywhere: there
  // was no way to print a label or look one up again. The Shipments table now
  // offers "Box Packaging (n)" on the rows that have any, so the count has to
  // come back with the list — one grouped read for the whole page rather than a
  // request per row.
  //
  // Counted over PACKED cartons only: an unpacked one is kept as an audit record
  // and no longer exists as a physical box, so it must not be offered for
  // printing. Scoped by shipment id, which is already owner-scoped by the filter
  // above, so this can never reach another tenant's boxes.
  const shipmentIds = rows.map((s) => s._id);
  const packedCounts = shipmentIds.length
    ? await RepackBox.aggregate([
      { $match: { shipment_id: { $in: shipmentIds }, status: "packed" } },
      { $group: { _id: "$shipment_id", n: { $sum: 1 } } },
    ])
    : [];
  const repackCountBy = new Map(packedCounts.map((c) => [String(c._id), c.n]));

  /* ADDITIVE — THE PRODUCT NAMES ON EACH SHIPMENT.

     The lines carry only `productId`, so the table had no name to print. Every
     product across the whole page is read in ONE query and mapped back, rather
     than a lookup per row. Nothing is filtered: a line whose product no longer
     resolves simply contributes no name. */
  const productIds = [...new Set(
    rows.flatMap((s) => (s.lines || []).map((l) => l.productId).filter(Boolean).map(String))
  )];
  const products = productIds.length
    ? await require("../model/Company/productModel").find({ _id: { $in: productIds } })
      .select("productName")
      .lean()
    : [];
  const productNameById = new Map(products.map((p) => [String(p._id), p.productName]));

  return Promise.all(rows.map(async (s) => ({
    ...s,
    ref: shipmentRef(s),
    ...shipmentRoute(s),
    repackBoxCount: repackCountBy.get(String(s._id)) || 0,
    // DISTINCT names, in line order. A transfer of one product shows one name;
    // several lots of that product still show it once.
    productNames: [...new Set(
      (s.lines || [])
        .map((l) => productNameById.get(String(l.productId)))
        .filter(Boolean)
    )],
    ...(s.challanDocument?.key ? { challanDocumentUrl: await challanUrl(s) } : {}),
    ...(s.biltyDocument?.key ? { biltyDocumentUrl: await shipmentDocUrl(s, "biltyDocument") } : {}),
    ...(s.billDocument?.key ? { billDocumentUrl: await shipmentDocUrl(s, "billDocument") } : {}),
  })));
}
async function getShipment(ownerArg, id) {
  const owner = normalizeOwner(ownerArg);
  const s = await Shipment.findOne({ _id: id, ...ownerScope(owner) }).populate("vehicleId", "regNo").populate("driverId", "name phone");
  if (!s) throw httpErr("Shipment not found", 404);
  return s;
}
/**
 * Idempotently ensure a planned shipment has its manifest token, so the
 * scannable shipping label (QR + barcode) can be printed BEFORE dispatch. The
 * token is the deterministic HMAC dispatch would set, so the printed label
 * matches what receipt validates. Owner-scoped; mirrors the supply /manifest.
 */
async function ensureManifest(ownerArg, id) {
  const owner = normalizeOwner(ownerArg);
  const shipment = await Shipment.findOne({ _id: id, ...ownerScope(owner) });
  if (!shipment) throw httpErr("Shipment not found", 404);
  if (!shipment.qrToken) { shipment.qrToken = qrFor(shipment._id); await shipment.save(); }
  return { shipment, qrPayload: `${shipment._id}.${shipment.qrToken}` };
}
async function listForDriver(companyId, driverId) {
  return Shipment.find({ companyId, driverId, status: { $in: ["planned", "loading", "dispatched", "in_transit", "arrived"] } }).sort({ createdAt: -1 });
}
async function listDiscrepancies(companyId, { status = "open" } = {}) {
  return Discrepancy.find({ companyId, ...(status ? { status } : {}) }).populate("productId", "productName").populate("shipmentId", "toLabel status").sort({ createdAt: -1 });
}

module.exports = { shipmentRef, createShipment, approveShipment, pickShipment, packShipment, dispatchShipment, markArrived, verifyReceipt, findIncomingByLot, shipmentDetails, completeDelivery, reportException, listShipments, getShipment, ensureManifest, listForDriver, listDiscrepancies, _internal: { qrFor } };