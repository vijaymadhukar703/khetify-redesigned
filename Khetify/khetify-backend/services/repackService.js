/**
 * repackService.js — packing loose picked units into a new carton at DISPATCH,
 * and breaking that carton back open.
 *
 * WHAT A REPACK IS. The scan-out dialog resolves codes into individual units.
 * Some arrive as whole cartons (a Bulk Packaging ID) and some as loose units (a
 * unit code, or a lot). The loose ones physically have to travel in something,
 * so the operator selects them and the system mints ONE carton ID for the set.
 *
 * WHAT IT IS NOT. It moves no stock, changes no quantity and re-labels no unit:
 *   · the picked count is identical before and after — only the grouping changes
 *   · `inventoryId` (original lot) is untouched, so receipt still lands every
 *     unit in its own lot and two lots never merge
 *   · `bulk_packaging_record_id` (original box) is untouched, so the original
 *     carton is still part of the unit's history
 * Only `UnitSerial.repack_box_id` is written — one extra layer on top.
 *
 * MULTI-LOT IS DELIBERATE. A repack label prints the box ID, a barcode, the
 * product name and a unit count — never an expiry — so there is nothing on it
 * that a mixed-lot carton could make wrong. Lot and expiry come from scanning
 * the box, which reads them back per lot (see boxContents).
 */

const mongoose = require("mongoose");
const RepackBox = require("../model/Inventory/RepackBox");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const Inventory = require("../model/Inventory/Inventory");
const Product = require("../model/Company/productModel");
const Shipment = require("../model/Transport/Shipment");
const Warehouse = require("../model/Warehouse/Warehouse");
const User = require("../model/User/User");
const Company = require("../model/Company/Company");
const { nextSeq } = require("./counterService");
const { withTransaction } = require("./txn");
// Which lots this dispatch may draw on — the SAME authority the scan resolver
// used when it accepted these units. See packUnits.
const { eligibleLotIds } = require("./dispatchScanService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const MSG = {
  noUnits: "Select at least one unit to pack.",
  notOnShipment: (code) => `${code} is not one of this shipment's picked units.`,
  alreadyPacked: (code) => `${code} is already in a repack box.`,
  mixedProducts: "All units in a box must be the same product.",
  notFound: "Repack box not found",
  alreadyUnpacked: "This box has already been unpacked.",
  // DISCARD — refused once the goods are gone. Naming the status is what tells
  // the operator this is not a retry-able hiccup.
  alreadyDispatched: (status) =>
    `This shipment has already been dispatched (${status}). A box that has left the warehouse cannot be removed.`,
  discardRace: "This box is no longer available — it may have just been removed or unpacked.",
  companyName: "Set your company name before generating a box ID.",
  productCode: "This product has no product code, so a box ID cannot be generated.",
};

/* ------------------------------------------------------------------- id */

/**
 * THE REPACK CARTON ID:
 *   "KH-<WAREHOUSE>-<PRODUCT>-BX-<YYYYMMDD>-<SERIAL>"
 *   e.g. KH-BHO-ABC711-BX-20260801-0002
 *
 * Reads like the lot numbers it sits alongside — same "KH-" head, the same
 * stored product code (`Product.product_code`, the very code a lot number
 * carries), and "BX" where a lot number puts "BP", so the level is readable at
 * a glance. A lot-derived ID is impossible here (a carton has no single lot), so
 * the pack DATE takes that slot. Never the expiry: a repack label carries none.
 *
 * SERIAL SCOPE: per warehouse, per product, per DAY — so the first carton of a
 * different product on the same day starts again at 0001. The counter key
 * encodes all three; nextSeq is a single atomic $inc + upsert, so two operators
 * packing the same product at the same instant get 0001 and 0002 and never the
 * same number. Combined with the unique index on repack_box_id, a duplicate is
 * impossible rather than merely unlikely.
 *
 * A serial is never reissued: an ID may already be printed and stuck on a
 * carton, and two physical boxes sharing an ID is precisely what that index
 * exists to prevent.
 *
 * No "~" (reserved for ranges) and no "/" — both are unsafe in the symbologies
 * these labels are printed in, and the whole string stays inside Code 128's
 * character set.
 */
const SERIAL_PAD = 4;
const BOX_MARKER = "BX";
// The marker minted before this format. Old IDs are NEVER rewritten — they stay
// valid, scannable and resolvable, so both are recognised on the way in.
const LEGACY_BOX_MARKER = "RP";

const buildCompanyCode = (name) =>
  String(name || "").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3);

/** Strip anything that is not safe in an identifier, and upper-case it. */
const codePart = (v) => String(v || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

const yyyymmdd = (d) => {
  const dt = d instanceof Date ? d : new Date();
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
};

/**
 * Does this string look like a repack carton ID? Accepts BOTH markers, so a
 * carton packed under the old format still resolves everywhere.
 */
const REPACK_ID_RE = new RegExp(`^KH-[A-Z0-9]+-(?:[A-Z0-9]+-)?(?:${BOX_MARKER}|${LEGACY_BOX_MARKER})-\\d{8}-\\d+$`, "i");
const isRepackBoxId = (v) => REPACK_ID_RE.test(String(v || "").trim());

async function nextRepackBoxId(companyId, { warehouseId, productId } = {}, session) {
  // WAREHOUSE code — the box is packed at a warehouse, which is also what the
  // serial is scoped to. A warehouse with no code set falls back to the company
  // code, so an ID can always be minted.
  const wh = warehouseId
    ? await Warehouse.findOne({ _id: warehouseId, companyId }).select("code name").session(session || null)
    : null;
  let head = codePart(wh?.code);
  if (!head) {
    const company = await Company.findById(companyId).select("companyInfo.companyName").session(session || null);
    head = buildCompanyCode(company?.companyInfo?.companyName);
  }
  if (!head) throw httpErr(MSG.companyName, 400);

  // PRODUCT code — read from the product exactly as stored, the same value a lot
  // number carries. Never re-derived from the product name.
  const product = await Product.findOne({ _id: productId, companyId })
    .select("product_code")
    .session(session || null);
  const prodCode = codePart(product?.product_code);
  if (!prodCode) throw httpErr(MSG.productCode, 400);

  const day = yyyymmdd();
  // One counter per warehouse + product + day — that IS the stated scope.
  const key = `kh-repack-${warehouseId || "nowh"}-${productId}-${day}`;
  const serial = await nextSeq(companyId, key, session);

  return `KH-${head}-${prodCode}-${BOX_MARKER}-${day}-${String(serial).padStart(SERIAL_PAD, "0")}`;
}

/* ------------------------------------------------------------------ pack */

/**
 * Pack the given unit serials into a NEW carton.
 *
 * Every unit must be: this company's, one of the lots THIS shipment carries
 * (a repack may never reach into the rest of the warehouse's stock), not
 * already in another repack box, and of one product.
 */
async function packUnits(companyId, { shipmentId, serials = [], performedBy } = {}) {
  const codes = [...new Set(serials.map((s) => String(s || "").trim()).filter(Boolean))];
  if (!codes.length) throw httpErr(MSG.noUnits, 400);

  const shipment = await Shipment.findOne({ _id: shipmentId, companyId })
    .select("lines fromWarehouseId toType toWarehouseId");
  if (!shipment) throw httpErr("Shipment not found", 404);

  // THE LOTS THIS DISPATCH MAY DRAW ON — asked of dispatchScanService, which is
  // the same authority the scan itself consulted when it accepted these units.
  //
  // This used to read `shipment.lines` directly. Those lines are an
  // earliest-expiry ALLOCATION made before anyone walked to a shelf, and the
  // scan resolver has long been allowed to pick the product out of whichever of
  // its lots is actually to hand. So a unit the dialog had accepted, listed and
  // counted ("Picked 6 / 6") was refused the moment it was packed into a carton,
  // because packing was still checking the plan. Nothing about the lot's number
  // format was involved — a manually-composed lot simply happened to be the one
  // the plan had not named.
  const eligibleLots = await eligibleLotIds(companyId, shipment);

  // Matched on the unit's own identity, by EITHER of the two codes it is known
  // by — the same pair packagingScanService resolves a scan through.
  const units = await UnitSerial.find({
    companyId,
    $or: [{ serial: { $in: codes } }, { unit_code: { $in: codes } }],
  }).select("serial unit_code productId inventoryId repack_box_id");

  const byCode = new Map();
  for (const u of units) {
    byCode.set(u.serial, u);
    if (u.unit_code) byCode.set(u.unit_code, u);
  }

  const missing = codes.find((c) => !byCode.has(c));
  if (missing) throw httpErr(MSG.notOnShipment(missing), 409);

  for (const u of units) {
    if (!eligibleLots.has(String(u.inventoryId))) {
      throw httpErr(MSG.notOnShipment(u.unit_code || u.serial), 409);
    }
    if (u.repack_box_id) throw httpErr(MSG.alreadyPacked(u.unit_code || u.serial), 409);
  }

  const productIds = new Set(units.map((u) => String(u.productId)));
  if (productIds.size > 1) throw httpErr(MSG.mixedProducts, 400);

  let box;
  await withTransaction(async (session) => {
    // Scoped to the warehouse the goods are leaving and the product being
    // packed — both are part of the ID and of the serial's scope.
    const repackBoxId = await nextRepackBoxId(
      companyId,
      { warehouseId: shipment.fromWarehouseId, productId: units[0].productId },
      session,
    );
    [box] = await RepackBox.create(
      [{
        company_id: companyId,
        warehouse_id: shipment.fromWarehouseId || null,
        product_id: units[0].productId,
        repack_box_id: repackBoxId,
        shipment_id: shipment._id,
        status: "packed",
        unit_count: units.length,
        packed_by: performedBy || null,
      }],
      { session }
    );

    await UnitSerial.updateMany(
      { _id: { $in: units.map((u) => u._id) } },
      { $set: { repack_box_id: box._id } },
      { session }
    );

    // AUDIT — one row per unit: when, who, which unit, which box. The unit's
    // stock status is deliberately unchanged; a repack is a grouping, not a
    // movement, so fromStatus/toStatus are left out.
    await UnitEvent.insertMany(
      units.map((u) => ({
        companyId,
        serial: u.serial,
        event: "repacked",
        refType: "RepackBox",
        refId: box._id,
        actorId: performedBy || null,
        note: `Packed into ${repackBoxId}`,
      })),
      { session }
    );
  });

  return boxContents(companyId, box.repack_box_id);
}

/* ---------------------------------------------------------------- unpack */

/** Break a carton back into loose units. The box row survives as an audit record. */
async function unpackBox(companyId, repackBoxId, { performedBy } = {}) {
  const box = await RepackBox.findOne({ company_id: companyId, repack_box_id: String(repackBoxId).trim().toUpperCase() });
  if (!box) throw httpErr(MSG.notFound, 404);
  if (box.status === "unpacked") throw httpErr(MSG.alreadyUnpacked, 409);

  const units = await UnitSerial.find({ companyId, repack_box_id: box._id }).select("serial");

  await withTransaction(async (session) => {
    await UnitSerial.updateMany(
      { companyId, repack_box_id: box._id },
      { $set: { repack_box_id: null } },
      { session }
    );
    await RepackBox.updateOne(
      { _id: box._id },
      { $set: { status: "unpacked", unpacked_at: new Date(), unpacked_by: performedBy || null } },
      { session }
    );
    await UnitEvent.insertMany(
      units.map((u) => ({
        companyId,
        serial: u.serial,
        event: "unpacked",
        refType: "RepackBox",
        refId: box._id,
        actorId: performedBy || null,
        note: `Unpacked from ${box.repack_box_id}`,
      })),
      { session }
    );
  });

  return { repackBoxId: box.repack_box_id, unitCodes: units.map((u) => u.serial), status: "unpacked" };
}

/* -------------------------------------------------------------- contents */

/**
 * WHAT IS IN THIS CARTON, grouped by the units' ORIGINAL LOTS.
 *
 * Read live from the units themselves, so a box can never claim to hold
 * something it does not. Each group carries the lot's own mfg and expiry — the
 * dates that are NOT on the label, which is the whole reason this view exists.
 */
async function boxContents(companyId, repackBoxId) {
  const box = await RepackBox.findOne({
    company_id: companyId,
    repack_box_id: String(repackBoxId || "").trim().toUpperCase(),
  })
    .populate("product_id", "productName skuNumber")
    .populate("warehouse_id", "name code")
    .lean();
  if (!box) throw httpErr(MSG.notFound, 404);

  const units = await UnitSerial.find({ companyId, repack_box_id: box._id })
    .select("serial unit_code inventoryId lotNumber batchNumber bulk_packaging_id status")
    .sort({ lotNumber: 1, unit_serial: 1 })
    .lean();

  // The lots those units came from — mfg/expiry are read from the lot row, never
  // copied onto the box.
  const lotIds = [...new Set(units.map((u) => String(u.inventoryId)).filter(Boolean))];
  const lots = lotIds.length
    ? await Inventory.find({ _id: { $in: lotIds } })
        .select("lotNumber batchNumber mfgDate expiryDate")
        .lean()
    : [];
  const lotById = new Map(lots.map((l) => [String(l._id), l]));

  const groups = [];
  const byLot = new Map();
  for (const u of units) {
    const key = String(u.inventoryId);
    let g = byLot.get(key);
    if (!g) {
      const lot = lotById.get(key) || {};
      g = {
        inventoryId: key,
        lotNumber: u.lotNumber || lot.lotNumber || lot.batchNumber || "—",
        mfgDate: lot.mfgDate || null,
        expiryDate: lot.expiryDate || null,
        unitCount: 0,
        units: [],
      };
      byLot.set(key, g);
      groups.push(g);
    }
    g.unitCount += 1;
    g.units.push({
      unitCode: u.unit_code || u.serial,
      serial: u.serial,
      status: u.status,
      // The carton this unit was originally minted into, if any — the repack
      // sits on top of it rather than replacing it.
      originalBulkPackagingId: u.bulk_packaging_id || null,
    });
  }

  const packedBy = box.packed_by ? await User.findById(box.packed_by).select("name").lean() : null;
  const shipment = await Shipment.findById(box.shipment_id).select("lrNumber").lean();

  return {
    repackBoxId: box.repack_box_id,
    status: box.status,
    productName: box.product_id?.productName || "Item",
    warehouse: box.warehouse_id?.name || null,
    unitCount: units.length,
    // As-packed figure, so a partially unpacked/short box is visible.
    packedUnitCount: box.unit_count,
    lotCount: groups.length,
    createdAt: box.created_at,
    createdBy: packedBy?.name || null,
    shipmentId: String(box.shipment_id),
    shipmentRef: shipment?.lrNumber || `SH-${String(box.shipment_id).slice(-6).toUpperCase()}`,
    unpackedAt: box.unpacked_at || null,
    lotGroups: groups,
  };
}

/* --------------------------------------------------------------- discard */

/**
 * THE SHIPMENT STATES IN WHICH THE GOODS ARE STILL ON THE SHELF.
 *
 * The same set dispatchShipment accepts, which is the point: while a shipment
 * can still be dispatched, nothing has physically moved, so a carton packed for
 * it can still be un-made. The moment it leaves ("dispatched", "in_transit", …)
 * the box is on a truck and its ID is on a printed label.
 */
const PRE_DISPATCH = new Set(["draft", "planned", "picking", "picked", "packed", "approved", "loading", "pending"]);

/**
 * REMOVE A CARTON THAT WAS NEVER DISPATCHED — a hard delete, not an unpack.
 *
 * UNPACK AND DISCARD ARE DIFFERENT ANSWERS TO DIFFERENT QUESTIONS. Unpacking
 * says "this box existed and was opened again", and keeps the row so the ID is
 * never reissued and the history reads true. Discard is the operator taking back
 * a mis-click in the scan-out dialog: the carton was assembled a moment ago, no
 * label was printed, nothing left the building. Keeping a row for it would leave
 * an ID that names no physical box and never will.
 *
 * So this deletes the row and the per-unit "repacked" events with it — those
 * describe a unit's own history, and the unit's history is that it was never
 * boxed. The OPERATOR-ACTION audit log is deliberately NOT touched: that records
 * who did what and when, and is answered by writing a `repack.discarded` entry
 * (see repackController) rather than by erasing the `repack.packed` one.
 *
 * The units are simply unlinked. Their stock status, lot and original bulk
 * packaging box were never changed by the repack — it is a grouping, not a
 * movement — so there is nothing else to put back.
 *
 * CONCURRENCY. Two things must not interleave with this: a second discard of the
 * same box, and the dispatch of its shipment. Both are closed inside the
 * transaction — the shipment's status is re-read there rather than trusted from
 * the check above, and the row is claimed with a conditional delete, so exactly
 * one caller can win.
 */
async function discardBox(companyId, repackBoxId, { performedBy } = {}) {
  const box = await RepackBox.findOne({
    company_id: companyId,
    repack_box_id: String(repackBoxId || "").trim().toUpperCase(),
  });
  if (!box) throw httpErr(MSG.notFound, 404);
  if (box.status !== "packed") throw httpErr(MSG.alreadyUnpacked, 409);

  // Read the units BEFORE the delete — they are found through the box, so once
  // it is gone there is nothing left to find them by.
  const units = await UnitSerial.find({ companyId, repack_box_id: box._id })
    .select("serial unit_code inventoryId lotNumber batchNumber bulk_packaging_id productId")
    .sort({ lotNumber: 1, unit_serial: 1 })
    .lean();

  await withTransaction(async (session) => {
    // THE DISPATCH GUARD, read inside the transaction. Checked here and not
    // before it so a dispatch that commits while this call is in flight cannot
    // slip past a stale read.
    const shipment = await Shipment.findById(box.shipment_id).select("status").session(session);
    const status = shipment?.status || "unknown";
    if (!PRE_DISPATCH.has(status)) throw httpErr(MSG.alreadyDispatched(status), 409);

    // CLAIM IT. Conditional on the row still being packed, so a simultaneous
    // discard or unpack loses here and changes nothing.
    const claimed = await RepackBox.findOneAndDelete(
      { _id: box._id, status: "packed" },
      { session }
    );
    if (!claimed) throw httpErr(MSG.discardRace, 409);

    await UnitSerial.updateMany(
      { companyId, repack_box_id: box._id },
      { $set: { repack_box_id: null } },
      { session }
    );

    // The box never existed, so neither did the units' membership of it.
    await UnitEvent.deleteMany(
      { companyId, refType: "RepackBox", refId: box._id },
      { session }
    );
  });

  return {
    repackBoxId: box.repack_box_id,
    shipmentId: String(box.shipment_id),
    unitCount: units.length,
    unitCodes: units.map((u) => u.serial),
    // Enough for the dialog to put each unit back as its OWN loose row — the
    // lot it belongs to and the box it was originally minted into, which is
    // exactly what a unit row shows.
    units: units.map((u) => ({
      serial: u.serial,
      unitCode: u.unit_code || u.serial,
      productId: String(u.productId),
      inventoryId: String(u.inventoryId),
      lotNumber: u.lotNumber || u.batchNumber || "—",
      bulkPackagingId: u.bulk_packaging_id || null,
    })),
  };
}

/** Every repack carton packed for one shipment (the dispatch dialog's list). */
async function listForShipment(companyId, shipmentId) {
  const boxes = await RepackBox.find({ company_id: companyId, shipment_id: shipmentId, status: "packed" })
    .sort({ created_at: 1 })
    .lean();
  return Promise.all(boxes.map((b) => boxContents(companyId, b.repack_box_id)));
}

module.exports = {
  packUnits, unpackBox, discardBox, boxContents, listForShipment, nextRepackBoxId,
  // Both markers are recognised, so a carton minted under the old "RP" format
  // still parses and resolves.
  isRepackBoxId, BOX_MARKER, LEGACY_BOX_MARKER, MSG,
};
