/**
 * sellerRepackService.js — packing loose scanned units into a TRANSFER BOX at
 * dispatch, and breaking that box back open.
 *
 * The seller mirror of services/repackService.js, rule for rule. See
 * model/Seller/SellerRepackBox.js for why the collection is separate rather
 * than shared with the company's RepackBox.
 *
 * WHAT A TRANSFER BOX IS. The scan-out dialog resolves codes into individual
 * units. Some arrive as whole cartons (a Bulk Packaging ID) and some as loose
 * units (a unit code, or a lot). The loose ones physically have to travel in
 * something, so the manager ticks them and the system mints ONE box ID for the
 * set. Five units can therefore leave as Box 1 = units 1,2,3 and Box 2 =
 * units 4,5, each with its own printed barcode.
 *
 * WHAT IT IS NOT. It moves no stock, changes no quantity and re-labels no unit:
 *   · the scanned count is identical before and after — only the grouping changes
 *   · `inventoryId` (original lot) is untouched, so receipt still lands every
 *     unit in its own lot and two lots never merge
 *   · `bulk_packaging_record_id` (original box) is untouched
 * Only `UnitSerial.seller_repack_box_id` is written — one extra layer on top.
 *
 * MULTI-LOT IS DELIBERATE. A transfer box label prints the box ID, a barcode,
 * the product name and a unit count — never an expiry — so there is nothing on
 * it a mixed-lot carton could make wrong. Lot and expiry are read back per lot
 * from the box contents.
 *
 * A BOX IS A DRAFT UNTIL THE TRANSFER DISPATCHES. Packing writes real rows —
 * the ID has to exist before it can be printed — but those rows are marked
 * `draft` and mean nothing outside the dialog that made them. Abandon the
 * transfer and they are deleted and the units come straight back as loose
 * stock; dispatch it and they become `packed`, which is permanent. Membership
 * becomes binding at exactly the moment the split stops being reversible in the
 * real world.
 *
 * NO CUSTOMER INFORMATION IS INVOLVED anywhere in this file. A warehouse
 * transfer box carries no address, city, state, PIN or phone; that belongs to
 * services/sellerPackService.js, which is untouched.
 */

const SellerRepackBox = require("../model/Seller/SellerRepackBox");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const Inventory = require("../model/Inventory/Inventory");
const Product = require("../model/Company/productModel");
const Shipment = require("../model/Transport/Shipment");
const Warehouse = require("../model/Warehouse/Warehouse");
const { nextSeq } = require("./counterService");
const { withTransaction } = require("./txn");
const { eligibleLotIds, refOf, isSellerWarehouseTransfer } = require("./sellerDispatchScanService");

function httpErr(message, status = 400, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

const MSG = {
  noUnits: "Select at least one unit to put in the box.",
  notOnShipment: (code) => `${code} is not one of this transfer's scanned units.`,
  alreadyPacked: (code) => `${code} is already in a box on this transfer.`,
  notAvailable: (code, status) => `${code} is not available to box (${status}).`,
  mixedProducts: "All units in a box must be the same product.",
  notFound: "Transfer box not found",
  alreadyDispatched: (status) =>
    `This transfer has already been dispatched (${status}). A box that has left the warehouse cannot be removed.`,
  discardRace: "This box is no longer available — it may have just been removed.",
  cannotDiscardShipped: "This box has already been dispatched and cannot be removed.",
};

/* ------------------------------------------------------------------- id */

/**
 * THE TRANSFER BOX ID:
 *   "KH-<WAREHOUSE>-<PRODUCT>-SBX-<YYYYMMDD>-<SERIAL>"
 *   e.g. KH-BHO-ABC711-SBX-20260811-0002
 *
 * Reads like the lot numbers it sits alongside — same "KH-" head, the same
 * stored product code, and "SBX" where a lot number puts "BP", so the level is
 * readable at a glance and can never be confused with the COMPANY carton's
 * "BX"/"RP". A lot-derived ID is impossible here (a box has no single lot), so
 * the pack DATE takes that slot. Never the expiry: this label carries none.
 *
 * SERIAL SCOPE: per warehouse, per product, per DAY. nextSeq is a single atomic
 * $inc + upsert, so two managers packing the same product at the same instant
 * get 0001 and 0002 and never the same number. Combined with the unique index
 * on seller_repack_box_id, a duplicate is impossible rather than merely
 * unlikely, and a serial is never reissued.
 */
const SERIAL_PAD = 4;
const BOX_MARKER = "SBX";

/** Strip anything that is not safe in an identifier, and upper-case it. */
const codePart = (v) => String(v || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

const yyyymmdd = (d) => {
  const dt = d instanceof Date ? d : new Date();
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
};

/** Does this string look like a seller transfer box ID? */
const SELLER_BOX_ID_RE = new RegExp(`^KH-[A-Z0-9]+-(?:[A-Z0-9]+-)?${BOX_MARKER}-\\d{8}-\\d+$`, "i");
const isSellerRepackBoxId = (v) => SELLER_BOX_ID_RE.test(String(v || "").trim());

async function nextSellerBoxId(sellerId, { warehouseId, productId } = {}, session) {
  // WAREHOUSE code — the box is packed at a warehouse, which is also what the
  // serial is scoped to. A warehouse with no code set falls back to letters of
  // its name, so an ID can always be minted.
  const wh = warehouseId
    ? await Warehouse.findOne({ _id: warehouseId, sellerId }).select("code name").session(session || null)
    : null;
  let head = codePart(wh?.code);
  if (!head) head = codePart(wh?.name).slice(0, 3);
  if (!head) head = "WH";

  // PRODUCT code — read as stored, the same value a lot number carries.
  const product = await Product.findById(productId).select("product_code skuNumber").session(session || null);
  const prodCode = codePart(product?.product_code) || codePart(product?.skuNumber) || "PRD";

  const day = yyyymmdd();
  const key = `kh-seller-box-${warehouseId || "nowh"}-${productId}-${day}`;
  const serial = await nextSeq(sellerId, key, session);

  return `KH-${head}-${prodCode}-${BOX_MARKER}-${day}-${String(serial).padStart(SERIAL_PAD, "0")}`;
}

/* ------------------------------------------------------------------ pack */

/** The shipment statuses in which the goods are still on the shelf. */
const PRE_DISPATCH = new Set(["draft", "planned", "picking", "picked", "packed", "approved", "loading", "pending"]);

async function loadTransfer(sellerId, shipmentId, select) {
  const shipment = await Shipment.findOne({ _id: shipmentId, ownerType: "seller", ownerId: sellerId })
    .select(select || "lines fromWarehouseId toWarehouseId toType ownerType status lrNumber");
  if (!shipment) throw httpErr("Shipment not found", 404);
  if (!isSellerWarehouseTransfer(shipment)) throw httpErr("This shipment is not a warehouse transfer", 400);
  return shipment;
}

/**
 * Pack the given unit serials into a NEW transfer box.
 *
 * Every unit must be: this seller's, one of the lots THIS transfer may draw on
 * (a box may never reach into the rest of the warehouse's stock), still in
 * stock, not already in another transfer box, and of one product.
 */
async function packUnits(sellerId, { shipmentId, serials = [], performedBy } = {}) {
  const codes = [...new Set((serials || []).map((s) => String(s || "").trim()).filter(Boolean))];
  if (!codes.length) throw httpErr(MSG.noUnits, 400, { code: "EMPTY_BOX" });

  const shipment = await loadTransfer(sellerId, shipmentId);
  if (!PRE_DISPATCH.has(shipment.status)) {
    throw httpErr(MSG.alreadyDispatched(shipment.status), 409, { code: "ALREADY_DISPATCHED" });
  }

  // THE LOTS THIS DISPATCH MAY DRAW ON — asked of sellerDispatchScanService,
  // the same authority the scan itself consulted when it accepted these units.
  // Asking the shipment's planned lines instead would refuse a unit the dialog
  // had already accepted, listed and counted.
  const eligible = await eligibleLotIds(sellerId, shipment);

  const units = await UnitSerial.find({
    ownerType: "seller",
    ownerId: sellerId,
    $or: [{ serial: { $in: codes } }, { unit_code: { $in: codes } }],
  }).select("serial unit_code productId inventoryId status seller_repack_box_id companyId");

  const byCode = new Map();
  for (const u of units) {
    byCode.set(u.serial, u);
    if (u.unit_code) byCode.set(u.unit_code, u);
  }
  const missing = codes.find((c) => !byCode.has(c));
  if (missing) throw httpErr(MSG.notOnShipment(missing), 409, { code: "NOT_ON_SHIPMENT" });

  /**
   * WHICH BOXES DO THESE UNITS CURRENTLY POINT AT, and do those boxes belong to
   * THIS transfer or to a finished one?
   *
   * THE DISTINCTION IS THE WHOLE FIX. `seller_repack_box_id` used to be read as
   * "this unit is boxed, refuse it", which was only ever true for the transfer
   * being packed right now. A unit that ARRIVED here inside a box — Warehouse 1
   * sent units 1,2,3 in Box 1 and Warehouse 2 received them — still carried that
   * pointer, so Warehouse 2 could scan unit 1 on its own, watch it validate, and
   * then be told it was "already in a box" the moment it tried to put it in a
   * new one. The box it named was a box that had already completed its journey
   * and no longer describes how the unit is stored: the carton was opened when
   * the goods were put away.
   *
   * So the refusal now applies to exactly one case — a unit already boxed FOR
   * THIS SHIPMENT, which is a genuine double-box and stays refused. A pointer at
   * any other box is stale packaging, and the unit is detached from it below.
   */
  const priorBoxIds = [...new Set(
    units.map((u) => u.seller_repack_box_id).filter(Boolean).map(String)
  )];
  const priorBoxes = priorBoxIds.length
    ? await SellerRepackBox.find({ _id: { $in: priorBoxIds }, seller_id: sellerId })
      .select("seller_repack_box_id shipment_id status")
      .lean()
    : [];
  const priorById = new Map(priorBoxes.map((b) => [String(b._id), b]));

  for (const u of units) {
    if (!eligible.has(String(u.inventoryId))) {
      throw httpErr(MSG.notOnShipment(u.unit_code || u.serial), 409, { code: "NOT_ON_SHIPMENT" });
    }
    const prior = u.seller_repack_box_id ? priorById.get(String(u.seller_repack_box_id)) : null;
    // Already in a box on THIS transfer — a real double-box, refused. Note this
    // can only be a live box from the dialog currently open: any leftover draft
    // for this shipment was swept when that dialog loaded (discardDraftBoxes).
    if (prior && prior.status !== "draft" && String(prior.shipment_id) === String(shipment._id)) {
      throw httpErr(MSG.alreadyPacked(u.unit_code || u.serial), 409, { code: "ALREADY_PACKED" });
    }
    if (prior && prior.status === "draft" && String(prior.shipment_id) === String(shipment._id)) {
      throw httpErr(MSG.alreadyPacked(u.unit_code || u.serial), 409, { code: "ALREADY_PACKED" });
    }
    if (u.status !== "in_stock") {
      throw httpErr(MSG.notAvailable(u.unit_code || u.serial, u.status), 409, { code: "NOT_AVAILABLE" });
    }
  }

  // The units being taken OUT of a previous transfer's box, so the detachment
  // can be written to their history rather than happening silently.
  const detaching = units.filter((u) => {
    const prior = u.seller_repack_box_id ? priorById.get(String(u.seller_repack_box_id)) : null;
    return prior && String(prior.shipment_id) !== String(shipment._id);
  });

  // ABANDONED DRAFTS BELONGING TO SOME OTHER TRANSFER. A draft that never
  // dispatched describes a carton that was never taped shut, so a unit is simply
  // taken out of it — and the empty shell is removed below rather than left
  // behind naming a box that does not exist. Belt and braces: the sweep at
  // dialog-open normally removes these first, but a unit can reach here through
  // a transfer whose dialog was never reopened.
  const staleDraftIds = [...new Set(
    detaching
      .map((u) => priorById.get(String(u.seller_repack_box_id)))
      .filter((b) => b && b.status === "draft")
      .map((b) => String(b._id))
  )];

  const productIds = new Set(units.map((u) => String(u.productId)));
  if (productIds.size > 1) throw httpErr(MSG.mixedProducts, 400, { code: "MIXED_PRODUCTS" });

  let box;
  await withTransaction(async (session) => {
    const boxId = await nextSellerBoxId(
      sellerId,
      { warehouseId: shipment.fromWarehouseId, productId: units[0].productId },
      session,
    );
    [box] = await SellerRepackBox.create(
      [{
        seller_id: sellerId,
        warehouse_id: shipment.fromWarehouseId || null,
        product_id: units[0].productId,
        company_id: units[0].companyId || null,
        seller_repack_box_id: boxId,
        shipment_id: shipment._id,
        // DRAFT until dispatch — see the status field on the model. Nothing has
        // left the warehouse yet, so nothing here is binding.
        status: "draft",
        unit_count: units.length,
        packed_by: performedBy || null,
      }],
      { session }
    );

    /**
     * THE UNIT'S CURRENT PACKAGING MOVES TO THE NEW BOX.
     *
     * `seller_repack_box_id` is a pointer to where a unit IS packed right now,
     * not a log of every carton it has ever sat in, so repointing it is exactly
     * the detach-and-repack the operator physically performed. The OLD BOX ROW
     * IS DELIBERATELY LEFT ALONE — not deleted, not edited, not marked unpacked.
     * It keeps its ID, its shipment link and its as-packed `unit_count`, so the
     * record of what shipped in it stays true, and units 2 and 3 keep pointing
     * at it and stay exactly where they are.
     */
    await UnitSerial.updateMany(
      { _id: { $in: units.map((u) => u._id) } },
      { $set: { seller_repack_box_id: box._id } },
      { session }
    );

    // WHERE A UNIT CAME OUT OF, written before the new membership is claimed —
    // otherwise a unit's history would show it in two cartons at once with
    // nothing to say it ever left the first.
    if (detaching.length) {
      await UnitEvent.insertMany(
        detaching.map((u) => ({
          companyId: u.companyId,
          serial: u.serial,
          event: "unpacked",
          refType: "SellerRepackBox",
          refId: u.seller_repack_box_id,
          actorId: performedBy || null,
          note: `Removed from ${priorById.get(String(u.seller_repack_box_id))?.seller_repack_box_id || "its previous box"} to be repacked`,
        })),
        { session }
      );
    }

    // AUDIT — one row per unit. The unit's stock status is deliberately
    // unchanged; boxing is a grouping, not a movement.
    await UnitEvent.insertMany(
      units.map((u) => ({
        companyId: u.companyId,
        serial: u.serial,
        event: "repacked",
        refType: "SellerRepackBox",
        refId: box._id,
        actorId: performedBy || null,
        note: `Packed into ${boxId}`,
      })),
      { session }
    );

    // Any abandoned draft left with nothing in it is removed, so no ID survives
    // naming a carton that was never taped shut. A draft that still holds other
    // units is left alone — only the emptied shells go.
    for (const staleId of staleDraftIds) {
      const left = await UnitSerial.countDocuments({ seller_repack_box_id: staleId }).session(session);
      if (!left) {
        await SellerRepackBox.deleteOne({ _id: staleId, status: "draft" }, { session });
        await UnitEvent.deleteMany({ refType: "SellerRepackBox", refId: staleId }, { session });
      }
    }
  });

  return boxContents(sellerId, box.seller_repack_box_id);
}

/* -------------------------------------------------------------- contents */

/**
 * WHAT IS IN THIS BOX, grouped by the units' ORIGINAL LOTS.
 *
 * Read live from the units themselves, so a box can never claim to hold
 * something it does not. Each group carries the lot's own mfg and expiry — the
 * dates that are NOT on the label, which is the whole reason this view exists.
 */
async function boxContents(sellerId, boxId) {
  const box = await SellerRepackBox.findOne({
    seller_id: sellerId,
    seller_repack_box_id: String(boxId || "").trim().toUpperCase(),
  })
    .populate("product_id", "productName skuNumber")
    .populate("warehouse_id", "name code")
    .lean();
  if (!box) throw httpErr(MSG.notFound, 404);

  const units = await UnitSerial.find({
    ownerType: "seller", ownerId: sellerId, seller_repack_box_id: box._id,
  })
    .select("serial unit_code inventoryId lotNumber batchNumber bulk_packaging_id status")
    .sort({ lotNumber: 1, unit_serial: 1 })
    .lean();

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
      originalBulkPackagingId: u.bulk_packaging_id || null,
    });
  }

  const shipment = await Shipment.findById(box.shipment_id).select("lrNumber fromLabel toLabel").lean();

  return {
    // Named `repackBoxId` as well so the shared label / view components can be
    // fed this payload unchanged.
    sellerBoxId: box.seller_repack_box_id,
    repackBoxId: box.seller_repack_box_id,
    status: box.status,
    productName: box.product_id?.productName || "Item",
    warehouse: box.warehouse_id?.name || null,
    unitCount: units.length,
    packedUnitCount: box.unit_count,
    lotCount: groups.length,
    createdAt: box.created_at,
    shipmentId: String(box.shipment_id),
    shipmentRef: shipment ? refOf({ _id: box.shipment_id, lrNumber: shipment.lrNumber }) : null,
    fromLabel: shipment?.fromLabel || null,
    toLabel: shipment?.toLabel || null,
    unitCodes: units.map((u) => u.unit_code || u.serial),
    lotGroups: groups,
  };
}

/** Every transfer box packed for one shipment, in packing order. */
async function listForShipment(sellerId, shipmentId) {
  const boxes = await SellerRepackBox.find({ seller_id: sellerId, shipment_id: shipmentId })
    .sort({ created_at: 1 })
    .lean();
  const rows = [];
  for (let i = 0; i < boxes.length; i += 1) {
    const full = await boxContents(sellerId, boxes[i].seller_repack_box_id);
    rows.push({ ...full, boxNumber: i + 1, totalBoxes: boxes.length });
  }
  return rows;
}

/* --------------------------------------------------------------- discard */

/**
 * REMOVE A BOX THAT WAS NEVER DISPATCHED — a hard delete, not an unpack.
 *
 * The box was assembled a moment ago in the scan-out dialog, no label was
 * printed and nothing left the building. Keeping a row for it would leave an ID
 * that names no physical box and never will, so the row and the per-unit
 * "repacked" events go with it.
 *
 * The units are simply unlinked. Their stock status, lot and original bulk
 * packaging box were never changed by the boxing — it is a grouping, not a
 * movement — so there is nothing else to put back.
 *
 * CONCURRENCY. The shipment's status is re-read inside the transaction rather
 * than trusted from the check above, and the row is claimed with a conditional
 * delete, so a dispatch committing in flight cannot slip past a stale read and
 * exactly one caller can win.
 */
async function discardBox(sellerId, boxId, { performedBy } = {}) {
  const box = await SellerRepackBox.findOne({
    seller_id: sellerId,
    seller_repack_box_id: String(boxId || "").trim().toUpperCase(),
  });
  if (!box) throw httpErr(MSG.notFound, 404);

  // Read the units BEFORE the delete — they are found through the box.
  const units = await UnitSerial.find({
    ownerType: "seller", ownerId: sellerId, seller_repack_box_id: box._id,
  })
    .select("serial unit_code inventoryId lotNumber batchNumber bulk_packaging_id productId companyId")
    .sort({ lotNumber: 1, unit_serial: 1 })
    .lean();

  await withTransaction(async (session) => {
    const shipment = await Shipment.findById(box.shipment_id).select("status").session(session);
    const status = shipment?.status || "unknown";
    if (!PRE_DISPATCH.has(status)) {
      throw httpErr(MSG.alreadyDispatched(status), 409, { code: "ALREADY_DISPATCHED" });
    }

    // ONLY A DRAFT MAY BE REMOVED. A `packed` box has a printed label on a real
    // carton that has left the building, so it is a permanent record.
    const claimed = await SellerRepackBox.findOneAndDelete(
      { _id: box._id, status: "draft" },
      { session }
    );
    if (!claimed) {
      throw httpErr(
        box.status === "draft" ? MSG.discardRace : MSG.cannotDiscardShipped,
        409,
      );
    }

    await UnitSerial.updateMany(
      { ownerType: "seller", ownerId: sellerId, seller_repack_box_id: box._id },
      { $set: { seller_repack_box_id: null } },
      { session }
    );

    await UnitEvent.deleteMany(
      { refType: "SellerRepackBox", refId: box._id },
      { session }
    );
  });

  return {
    sellerBoxId: box.seller_repack_box_id,
    repackBoxId: box.seller_repack_box_id,
    shipmentId: String(box.shipment_id),
    unitCount: units.length,
    unitCodes: units.map((u) => u.serial),
    // Enough for the dialog to put each unit back as its OWN loose row.
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

/**
 * THROW AWAY EVERY DRAFT BOX ON A TRANSFER and give its units back.
 *
 * This is what makes "a box is only permanent once dispatched" true rather than
 * merely intended. It runs in two places:
 *
 *   · when the operator CLOSES the transfer dialog without dispatching, and
 *   · when the dialog is OPENED, sweeping anything a previous session left
 *     behind — a closed laptop, a lost connection, a browser crash. Without the
 *     sweep an abandoned draft would keep its units hostage forever, which is
 *     exactly the bug this fixes.
 *
 * The units are simply unlinked. Their stock status, lot and original bulk
 * packaging box were never changed by the boxing — it is a grouping, not a
 * movement — so there is nothing else to put back, and they are immediately
 * available as loose stock for any other transfer.
 *
 * A `packed` or `received` box is NEVER touched: those describe cartons that
 * physically shipped. So a transfer that dispatched keeps every box it left
 * with, and a dispatched box's units stay packed and unavailable at the source.
 *
 * Safe to call at any time — with no drafts it does nothing and returns 0.
 */
async function discardDraftBoxes(sellerId, shipmentId, { performedBy } = {}) {
  const drafts = await SellerRepackBox.find({
    seller_id: sellerId, shipment_id: shipmentId, status: "draft",
  }).select("_id seller_repack_box_id").lean();
  if (!drafts.length) return { discarded: 0, unitCount: 0, boxIds: [] };

  const ids = drafts.map((b) => b._id);
  let unitCount = 0;

  await withTransaction(async (session) => {
    // Claim the rows FIRST, conditional on them still being drafts, so a
    // dispatch committing in flight cannot have its boxes deleted underneath it.
    const claimed = await SellerRepackBox.deleteMany(
      { _id: { $in: ids }, status: "draft" },
      { session }
    );
    if (!claimed.deletedCount) return;

    const res = await UnitSerial.updateMany(
      { ownerType: "seller", ownerId: sellerId, seller_repack_box_id: { $in: ids } },
      { $set: { seller_repack_box_id: null } },
      { session }
    );
    unitCount = res.modifiedCount || 0;

    // The "repacked" events go too — they recorded a carton that turned out
    // never to have existed.
    await UnitEvent.deleteMany(
      { refType: "SellerRepackBox", refId: { $in: ids } },
      { session }
    );
  });

  return {
    discarded: drafts.length,
    unitCount,
    boxIds: drafts.map((b) => b.seller_repack_box_id),
  };
}

/**
 * MAKE THE DRAFT BOXES PERMANENT — called once the dispatch has succeeded and
 * the goods are genuinely on their way.
 *
 * This is the single point at which box membership stops being reversible. It
 * is deliberately the LAST step of dispatch: if anything before it refuses, the
 * boxes are still drafts and the whole transfer can be abandoned cleanly.
 */
async function commitBoxes(sellerId, shipmentId, session) {
  const res = await SellerRepackBox.updateMany(
    { seller_id: sellerId, shipment_id: shipmentId, status: "draft" },
    { $set: { status: "packed" } },
    session ? { session } : {}
  );
  return res.modifiedCount || 0;
}

/** Mark a transfer's boxes received. Never touches stock. */
async function markReceived(sellerId, shipmentId, session) {
  await SellerRepackBox.updateMany(
    { seller_id: sellerId, shipment_id: shipmentId, status: "packed" },
    { $set: { status: "received", received_at: new Date() } },
    session ? { session } : {}
  );
}

module.exports = {
  packUnits,
  discardDraftBoxes,
  commitBoxes,
  boxContents,
  listForShipment,
  discardBox,
  markReceived,
  nextSellerBoxId,
  isSellerRepackBoxId,
  BOX_MARKER,
  MSG,
};