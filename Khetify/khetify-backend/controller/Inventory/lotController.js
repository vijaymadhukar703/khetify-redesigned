const lotService = require("../../services/lotService");
const bulkPackageService = require("../../services/bulkPackageService");
const barcodeService = require("../../services/barcodeService");
const { warehouseScope, inScope } = require("../../services/warehouseScope");
const Inventory = require("../../model/Inventory/Inventory");
const Warehouse = require("../../model/Warehouse/Warehouse");
const UnitSerial = require("../../model/Barcode/UnitSerial");
const StockMovement = require("../../model/Inventory/StockMovement");
const RepackBox = require("../../model/Inventory/RepackBox");
const BulkPackage = require("../../model/Inventory/BulkPackage");

// Lot Details is a read-only page, not an export: cap the two unbounded lists
// so a 10,000-unit lot can't turn one page load into a multi-megabyte payload.
// The response reports the true total alongside, so the page can say so.
const MAX_DETAIL_UNITS = 2000;
const MAX_DETAIL_MOVEMENTS = 500;

/**
 * A unit that has LEFT THIS SHELF but not yet landed anywhere.
 *
 * Dispatch sets this and keeps `inventoryId` on the sending row — that link is
 * what lets the far end receive it — so "still points at this row" is not the
 * same question as "is still here". The receipt clears it.
 */
const DISPATCHED_STATUS = "shipped";

/**
 * A MONGO DUPLICATE-KEY ERROR, said in the operator's language — and never as
 * the wrong duplicate.
 *
 * Three different identities can collide when a lot is created, and they are
 * fixed in three different ways. Reporting any of them as "this lot number
 * already exists" is not just unhelpful, it is false: a box ID clash happens
 * between lots whose NUMBERS are different, and the part it tells them to
 * change (the SKU range) is not even in a box ID.
 *
 * Returns null for anything that is not a duplicate-key error, so every other
 * failure keeps its own message.
 */
function duplicateKeyMessage(err) {
  if (err?.code !== 11000) return null;
  const value = Object.values(err.keyValue || {})[0];
  const where = `${err.message || ""}`;
  const named = value ? ` (${value})` : "";

  if (/bulkpackages/i.test(where) || /bulk_packaging_id/i.test(where)) {
    return `This lot would create a Bulk Packaging ID that already exists${named}. `
      + "A box ID leaves out the SKU range, so change a part that is in it — "
      + "Bulk Packaging, Batch or the date.";
  }
  if (/unitserials/i.test(where) || /\bserial\b/i.test(where)) {
    return `This lot would create a unit code that already exists${named}. `
      + "Change a part of the lot number so its unit codes are unique.";
  }
  if (/lotnumbers/i.test(where) || /lotNumber/i.test(where)) {
    return "This lot number already exists. Change one of the parts to make it unique.";
  }
  if (/inventories/i.test(where) || /batchNumber/i.test(where)) {
    return "A lot with this number already exists in this warehouse for this product.";
  }
  return `That identity is already in use${named}. Change one of the lot number's parts.`;
}
// Exposed for its own unit tests — the mapping is the point of this function.
exports.__duplicateKeyMessage = duplicateKeyMessage;

/**
 * The ORIGINAL, immutable unit set of a lot — every unit ever minted for it,
 * regardless of where that unit sits today. This is the ONE definition of "the
 * lot as it was created", shared by every historical view (Company Inventory →
 * View and Transfer History → View) so they can never disagree.
 *
 * WHY NOT `inventoryId`: a warehouse→warehouse transfer REASSIGNS a moved unit's
 * `inventoryId` to the destination row (shipmentService, transfer receipt:
 * `UnitSerial.updateMany(..., { $set: { inventoryId: dest } })`), so a query
 * scoped by `inventoryId` silently loses transferred units and the lot appears
 * to shrink (100 → 80). Instead we match on the lot IDENTITY —
 * (companyId, productId, lotNumber/batchNumber) — which is stamped at mint
 * (barcodeService.generateUnits) and NEVER rewritten by any move or supply. A
 * unit that has since moved to another warehouse (or been supplied to a seller)
 * is still counted, because it is still part of what this lot originally was.
 *
 * The headline total is `Inventory.originalQuantity`, the write-once register
 * (the same immutable number barcodeService uses as the label cap); it falls
 * back to the full minted count for pre-register rows.
 */
async function originalLotUnits(companyId, lot) {
  const lotNo = lot.lotNumber || lot.batchNumber;
  const identity = {
    companyId,
    productId: lot.productId?._id || lot.productId,
    $or: [{ lotNumber: lotNo }, { batchNumber: lotNo }],
  };
  const [units, mintedTotal] = await Promise.all([
    UnitSerial.find(identity)
      // ADDITIVE: `inventoryId` says WHICH lot row a unit currently belongs to.
      // The set above is identity-scoped (every unit ever minted for the lot), so
      // without it a reader cannot tell a unit still held here from one a later
      // warehouse→warehouse transfer moved away — which is what Company →
      // Analytics → View needs to report a box's CURRENT quantity.
      // `repack_box_id` joins the projection for the same reason inventoryId
      // did: without it the company view cannot tell that a unit travelled in a
      // repack carton, and grouped it as a loose code instead.
      .select("serial unit_code unit_serial box_serial bulk_packaging_id bulk_packaging_record_id repack_box_id status printed printedAt createdAt inventoryId")
      .sort({ box_serial: 1, unit_serial: 1, serial: 1 })
      .limit(MAX_DETAIL_UNITS),
    UnitSerial.countDocuments(identity),
  ]);
  const unitTotal = typeof lot.originalQuantity === "number" ? lot.originalQuantity : mintedTotal;
  return { units, unitTotal, unitsTruncated: mintedTotal > units.length };
}

/**
 * The CURRENT, IN-STOCK unit set of a lot row — only the units this warehouse's
 * Inventory row actually holds as available stock right now. This is the
 * counterpart to originalLotUnits, and it is scoped so every quantity on the
 * Inventory View stays in lock-step with the Inventory LIST, whose "Stock"
 * column is `availableStock` (pages/Company/CompanyInventory.jsx).
 *
 * TWO filters, both required for that consistency:
 *   1. `inventoryId: lot._id` — units attributed to THIS row. A warehouse→
 *      warehouse transfer repoints a moved unit's inventoryId to the destination
 *      row, so transferred-out units drop out here automatically.
 *   2. `status: "in_stock"` — only put-away, available units, exactly what
 *      `availableStock` counts (barcodeService lifecycle: a unit becomes
 *      "in_stock" on receipt and LEAVES that state when picked/packed/shipped/
 *      sold/damaged/recalled). Without this, a unit still pointing at the row but
 *      no longer in available stock (e.g. one damaged unit) inflates the code
 *      count to 71 while Stock Context reads 70 — the reported drift.
 *
 * The result is that Stock Context (availableStock), Packaging Summary and Unit
 * Codes are all derived from the same current-inventory set and can never
 * disagree. (Transfer History → View is the historical snapshot and uses
 * originalLotUnits instead — every original code, no status filter — and is
 * deliberately left untouched.)
 */
async function currentLotUnits(companyId, lot) {
  const owned = { ownerType: "company", ownerId: companyId, inventoryId: lot._id, status: "in_stock" };
  const [units, unitTotal] = await Promise.all([
    UnitSerial.find(owned)
      // repack_box_id joins the projection so a unit that arrived inside a
      // repack carton can be grouped under it (additive — every other field is
      // still selected).
      .select("serial unit_code unit_serial box_serial bulk_packaging_id bulk_packaging_record_id repack_box_id status printed printedAt createdAt")
      .sort({ box_serial: 1, unit_serial: 1, serial: 1 })
      .limit(MAX_DETAIL_UNITS),
    UnitSerial.countDocuments(owned),
  ]);
  return { units, unitTotal, unitsTruncated: unitTotal > units.length };
}

/** GET /api/lots?productId=&warehouseId=&expiring=true&expired=true */
exports.getLots = async (req, res) => {
  try {
    // Warehouse-level access: scoped users only see lots in their assigned
    // warehouses; an explicit warehouseId outside the scope is rejected.
    const scope = await warehouseScope(req.user);
    if (scope && req.query.warehouseId && !inScope(scope, req.query.warehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — wrong warehouse" });
    }
    // Warehouse-scoped users must not see (or count) lots they haven't received
    // yet — those sit in inTransitStock until Confirm Receive.
    const rows = await lotService.getLots(req.user.companyId, {
      ...req.query,
      ...(scope && { warehouseIds: scope, excludePending: true }),
    });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error("getLots error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** POST /api/lots/receive  { productId, warehouseId?, lotNumber, batchNumber, expiryDate?, qty, lowStockThreshold? } */
exports.receiveLot = async (req, res) => {
  try {
    // Warehouse-level access: a scoped user can only receive into their own warehouse.
    const scope = await warehouseScope(req.user);
    if (scope && req.body.warehouseId && !inScope(scope, req.body.warehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — wrong warehouse" });
    }
    // COMPANY → COMPANY WAREHOUSE: the main Company assigning a new lot to a
    // warehouse books it as IN TRANSIT; that warehouse must scan the parent lot
    // and Confirm Receive before it becomes stock. Any other creator (and every
    // GRN posting, which IS a receipt) stocks it immediately, as before.
    const isMainCompany = req.user.role === "company_admin";
    const pendingReceipt = isMainCompany && !!req.body.warehouseId;
    const inv = await lotService.receiveLot({
      ownerId: req.user.companyId,
      performedBy: req.user.id,
      ...req.body,
      qty: Number(req.body.qty),
      pendingReceipt,
      // A lot created here gets EVERY box's unit labels straight away. Left to
      // an operator's Generate, a boxed lot was routinely labelled only as far
      // as the quantity they typed reached — box 1 full, the rest empty.
      mintUnitLabels: true,
      // Provenance for the original-lot register: only a lot the MAIN COMPANY
      // mints belongs there. Taken from the authenticated role, never the body,
      // and pinned last so a client can't spoof it through the ...req.body spread.
      lotOrigin: isMainCompany ? "company" : "warehouse",
    });
    // Bulk packaging: hand the freshly minted box IDs straight back so the
    // success modal can show the count and print the box labels without a
    // second round trip.
    const bulkPackages = inv.has_bulk_packaging
      ? await bulkPackageService.listByLot(req.user.companyId, inv._id)
      : [];

    res.json({
      success: true,
      message: pendingReceipt
        ? "Lot created — sent to the warehouse, awaiting its Receive confirmation"
        : "Lot received into stock",
      data: inv,
      bulkPackages,
    });
  } catch (err) {
    console.error("receiveLot error:", err);
    const mapped = duplicateKeyMessage(err);
    if (mapped) return res.status(409).json({ success: false, message: mapped });
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * GET /api/lots/:id/available-units
 *
 * READ-ONLY: the FULL unit IDs that make up this lot row's available quantity
 * right now. Powers Company → Analytics → Product Details → "View Available
 * Units", where a bare "Available: 100" does not say WHICH 100.
 *
 * A separate, focused endpoint rather than another field on /details: that
 * payload is the lot's ORIGINAL unit set (every label ever minted for it),
 * whereas this is only what is still on this warehouse's shelf.
 *
 * Moves no stock and writes nothing.
 */
exports.availableUnits = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const lot = await Inventory.findOne({ _id: req.params.id, ownerType: "company", ownerId: companyId })
      .select("lotNumber batchNumber warehouseId availableStock")
      .populate("warehouseId", "name code");
    if (!lot) return res.status(404).json({ success: false, message: "Lot not found" });

    // Same warehouse gate the Lot Details page uses — this endpoint can never
    // widen what a scoped session may see.
    const scope = await warehouseScope(req.user);
    if (scope && !inScope(scope, lot.warehouseId?._id || lot.warehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — wrong warehouse" });
    }

    const { boxed, labelledCount, listed, truncated, groups } =
      await barcodeService.availableUnitIds(companyId, lot._id);
    res.json({
      success: true,
      data: {
        inventoryId: lot._id,
        lotNumber: lot.lotNumber || lot.batchNumber || null,
        warehouse: lot.warehouseId?.name || null,
        // The lot row's own figure, so the page can say plainly when the labels
        // account for less than the balance instead of quietly disagreeing.
        availableStock: Number(lot.availableStock || 0),
        labelledCount,
        listed,
        truncated,
        boxed,
        groups,
      },
    });
  } catch (err) {
    console.error("availableUnits error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * GET /api/lots/:id/details
 *
 * READ-ONLY roll-up for the dedicated Lot Details page: the lot itself, where
 * its stock actually sits, how it is packed, every Bulk Packaging ID with its
 * units, and the full ledger history. Assembled here so the page needs ONE
 * request; it moves nothing and changes nothing.
 *
 * Deliberately separate from the Inventory list endpoints — the list keeps its
 * existing columns and payload exactly as they are.
 */
exports.lotDetails = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const lot = await Inventory.findOne({ _id: req.params.id, ownerType: "company", ownerId: companyId })
      // ADDITIVE `price`: the Stock on Hand report values a line at
      // (price || mrp), so Company → Analytics → View needs it to restate that
      // line's Total Amount as the same number the analytics row showed.
      .populate("productId", "productName product_code skuNumber brandName category unit unitType packagingType mrp price hsnCode")
      .populate("warehouseId", "name code address");
    if (!lot) return res.status(404).json({ success: false, message: "Lot not found" });

    // Warehouse-scoped users only see lots in their own warehouses.
    const scope = await warehouseScope(req.user);
    if (scope && !inScope(scope, lot.warehouseId?._id || lot.warehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — wrong warehouse" });
    }

    // ── COMPANY → INVENTORY → VIEW (Main Company, role "company_admin") ───────
    // The Main Company reads its Inventory as the ORIGINAL LOT REGISTER: the lots
    // it minted, at their ORIGINAL Company → Warehouse allocation. A later
    // warehouse→warehouse move is a separate, internal warehouse transaction
    // (shown in Company Warehouse → Transfer History) and must NEVER rewrite this
    // page. This branch is EXCLUSIVE to company_admin — exactly the role the
    // Inventory list flags as `originalRegister` (pages/.../InventoryTracking.jsx).
    // Warehouse-scoped users fall through to the CURRENT view below, which is
    // deliberately left untouched.
    if (req.user.role === "company_admin") {
      const lotNo = lot.lotNumber || lot.batchNumber;
      const [allocRows, boxes, packaging, original, movements] = await Promise.all([
        // Original allocation rows: the company's OWN allocations, which carry the
        // write-once `originalQuantity`. A warehouse→warehouse transfer lands a
        // DESTINATION row with no originalQuantity, so those are excluded — the
        // page shows "Bhopal : 100", never the live "Bhopal 71 / Indore 29".
        Inventory.find({
          ownerType: "company",
          ownerId: companyId,
          $and: [
            { $or: [{ lotNumber: lotNo }, { batchNumber: lotNo }] },
            { $or: [{ originalQuantity: { $ne: null } }, { _id: lot._id }] },
          ],
        }).populate("warehouseId", "name code"),
        bulkPackageService.listByLot(companyId, lot._id),
        // THE WHOLE LOT, not the row this page was opened on. The company owns
        // every warehouse, so its Packaging Summary counts every box and every
        // unit label of the lot wherever the stock now sits — matching the unit
        // list beside it, which originalLotUnits has always scoped that way.
        bulkPackageService.summaryForLot(companyId, lot._id, { identityScope: true }),
        originalLotUnits(companyId, lot),
        StockMovement.find({ inventoryId: lot._id }).sort({ createdAt: -1, _id: -1 }).limit(MAX_DETAIL_MOVEMENTS),
      ]);
      const { units, unitTotal, unitsTruncated } = original;

      /**
       * THE UNIT CODES SECTION, for the company view.
       *
       * The page renders three arrays — `bulkPackages` (box cards),
       * `looseUnitGroups` and `looseUnitCodes`. This branch returned the raw
       * `units` array and the boxes but NEITHER loose array, so a lot with no
       * bulk packaging had all three empty and the panel printed "No unit codes
       * were recorded for this stock" — while Packaging Summary still read
       * "Unit Labels: 8" from originalQuantity. The units were always there;
       * nothing shaped them for the panel.
       *
       * COMPANY SCOPE IS WIDER THAN A WAREHOUSE'S. `units` here is
       * identity-scoped (every unit ever minted for this lot number), so once a
       * transfer has moved some of them the answer to "where is this unit" is
       * per WAREHOUSE — which is what these groups carry, over and above the
       * box grouping the warehouse page shows.
       */
      /**
       * THE SAME THREE-LEVEL SHAPE THE WAREHOUSE PAGE GETS.
       *
       * Both pages are the one React page over the one panel, so "reuse the
       * warehouse component" is a question of handing this branch's boxes the
       * same fields: which carton each inner box sits in, and how many units it
       * was built to hold. Without them the company page drew inner boxes flat
       * while the warehouse page nested them.
       */
      const coMainBoxes = await bulkPackageService.listMainBoxes(companyId, lot._id);
      const coMainById = new Map(coMainBoxes.map((m) => [String(m._id), m]));
      const boxesWithParent = boxes.map((b) => {
        const raw = typeof b.toObject === "function" ? b.toObject() : b;
        const parent = coMainById.get(String(raw.parent_box_id || "")) || null;
        return {
          ...raw,
          parent_bulk_packaging_id: parent?.bulk_packaging_id || null,
          parent_box_serial: parent?.box_serial ?? null,
          parent_units_in_box: parent?.units_in_box ?? null,
          parent_status: parent?.status || null,
          parent_received_at: parent?.received_at || null,
        };
      });

      const lotNoForUnits = lot.lotNumber || lot.batchNumber;
      const rowsForUnits = await Inventory.find({
        ownerType: "company",
        ownerId: companyId,
        $or: [{ lotNumber: lotNoForUnits }, { batchNumber: lotNoForUnits }],
      })
        .select("warehouseId")
        .populate("warehouseId", "name")
        .lean();
      const warehouseOfRow = new Map(
        rowsForUnits.map((r) => [String(r._id), r.warehouseId?.name || "Unassigned"])
      );
      const warehouseCount = new Set(rowsForUnits.map((r) => String(r.warehouseId?._id || r.warehouseId || ""))).size;

      // Repack cartons any of these units travelled in.
      const cRepackIds = [...new Set(units.map((u) => String(u.repack_box_id || "")).filter(Boolean))];
      const cRepackRows = cRepackIds.length
        ? await RepackBox.find({ _id: { $in: cRepackIds }, company_id: companyId }).lean()
        : [];
      const cRepackById = new Map(cRepackRows.map((r) => [String(r._id), r]));
      // Boxes whose cards the page will draw — their units belong in the card,
      // not in a group, so a unit is never listed twice.
      const cRenderedBoxIds = new Set(boxes.map((b) => String(b._id)));

      /**
       * DID THE COMPANY PACKAGE THIS LOT AT ALL?
       *
       * Asked of the whole lot identity, not of the row this page was opened on:
       * BulkPackage records are anchored to the row the lot was created against,
       * so a lot opened through one of its destination rows would otherwise read
       * as unpackaged.
       *
       * It decides whether the page has a packaging level to show. A REPACK
       * carton is assembled by a warehouse at dispatch out of loose units — it
       * is that warehouse's own handling, not the company's packaging — so on a
       * lot the company shipped as a single package it must not conjure a "Bulk
       * Packaging IDs" section into existence. Two repack cartons did exactly
       * that, and pulled their 5 units out of the Unit Codes list on the way
       * (35 of 40 shown) for a lot with no boxes in it at all.
       */
      const companyPackaged = await BulkPackage.countDocuments({
        company_id: companyId,
        lot_id: { $in: rowsForUnits.map((r) => r._id) },
      }) > 0;

      /**
       * WHERE EACH BOX'S UNITS NOW ARE — the answer that used to be given by
       * listing the box a second time.
       *
       * Counted from the units' CURRENT rows, so a carton whose contents were
       * split by a later transfer reports the split rather than picking one
       * warehouse. The box records themselves never move: they belong to the
       * lot's original row, which is exactly why the location has to be derived
       * from the units.
       */
      const cWhOfBox = new Map();
      for (const u of units) {
        const boxKey = String(u.bulk_packaging_record_id || "");
        if (!boxKey) continue;
        const where = warehouseOfRow.get(String(u.inventoryId)) || "Unassigned";
        if (!cWhOfBox.has(boxKey)) cWhOfBox.set(boxKey, new Map());
        const m = cWhOfBox.get(boxKey);
        m.set(where, (m.get(where) || 0) + 1);
      }
      /** A box card, told where it is. One name when undivided, else the split. */
      const withLocation = (b) => {
        const spread = cWhOfBox.get(String(b._id));
        if (!spread || !spread.size) return b;
        const breakdown = [...spread.entries()].map(([warehouse, qty]) => ({ warehouse, qty }));
        return {
          ...b,
          warehouse: breakdown.length === 1 ? breakdown[0].warehouse : null,
          warehouseBreakdown: breakdown,
        };
      };

      const cGroups = new Map();
      const cLooseCodes = [];
      // A group key holds the warehouse only when the lot actually spans more
      // than one — a single-warehouse lot then reads exactly like the warehouse
      // page, with no extra labelling.
      const groupKeyFor = (u, base) => (warehouseCount > 1 ? `${base}@${String(u.inventoryId)}` : base);
      for (const u of units) {
        const code = u.unit_code || u.serial;
        const where = warehouseOfRow.get(String(u.inventoryId)) || null;
        const repackKey = String(u.repack_box_id || "");
        const boxKey = String(u.bulk_packaging_record_id || "");

        // A REPACK CARTON gets its own group ONLY on a lot the company actually
        // packaged, where the page already has a packaging level to show it at.
        // On a single-package lot it is the warehouse's own handling, so the
        // unit stays in the Unit Codes list and merely CARRIES the carton's ID
        // (`repackBoxId` below) — traceability without inventing a packaging
        // level the company never created.
        if (companyPackaged && repackKey && cRepackById.has(repackKey)) {
          const r = cRepackById.get(repackKey);
          const key = groupKeyFor(u, `rp:${repackKey}`);
          if (!cGroups.has(key)) {
            cGroups.set(key, {
              bulkPackagingId: r.repack_box_id, boxSerial: null, unitsInBox: r.unit_count,
              kind: "repack", warehouse: warehouseCount > 1 ? where : null, codes: [],
            });
          }
          cGroups.get(key).codes.push(code);
          continue;
        }
        // INSIDE A BOX THE PAGE ALREADY DRAWS AS A CARD — the card lists it,
        // and nothing else may.
        //
        // This used to emit a SECOND, `bx:`-keyed group as soon as the lot
        // spanned more than one warehouse, so every box of a transferred lot
        // appeared twice: once as its card (with the RECEIVED badge) and once as
        // a bare group underneath. A 2 × 2 lot read "2 bulk box(es) · 8 inner
        // box(es)" — four cards plus four ghosts — and every unit ID inside them
        // was printed twice.
        //
        // The intent behind that branch was sound: the company needs to know
        // WHERE each box now is. That belongs ON the card (`warehouse` /
        // `warehouseBreakdown`, set below), not in a duplicate listing of it.
        if (boxKey && cRenderedBoxIds.has(boxKey)) continue;

        // NO BOX AT ALL — a plain, flat list of the lot's unit codes.
        //
        // These used to be split into per-warehouse groups, and a unit that had
        // travelled in a repack carton carried that carton's ID beside it. Both
        // describe what a WAREHOUSE later did with the stock. This page answers
        // a different question — what the COMPANY created and sent — so the
        // codes read here exactly as they did the day the lot was labelled.
        // Where the stock physically sits is still on the page, in Stock by
        // Warehouse; a carton's own location is still on its box card.
        cLooseCodes.push(code);
      }

      return res.json({
        success: true,
        data: {
          lot,
          register: "original",
          // ADDITIVE — the two arrays the panel needs. Identical shape to the
          // warehouse branch, so the SAME component renders both.
          looseUnitGroups: [...cGroups.values()],
          looseUnitCodes: cLooseCodes,
          // How many warehouses this lot's units are spread over, so the page
          // can say so rather than implying they are all in one place.
          warehouseCount,
          stockByWarehouse: allocRows.map((r) => {
            const assigned = typeof r.originalQuantity === "number"
              ? r.originalQuantity
              : Number(r.availableStock || 0) + Number(r.inTransitStock || 0);
            return {
              inventoryId: r._id,
              warehouse: r.warehouseId?.name || "Unassigned",
              warehouseCode: r.warehouseId?.code || null,
              // Current Stock = the ORIGINAL quantity the company assigned to this
              // warehouse (the page's stock column reads availableStock). For the
              // register that IS the assigned quantity — immutable; it never drops
              // because the warehouse later receives, consumes or transfers stock.
              assignedQty: assigned,
              availableStock: assigned,
              // Awaiting Receipt = allocated − received, taken from the allocation
              // row's still-in-transit amount. inTransitStock is lowered ONLY by the
              // warehouse's Confirm Receive (never by a later consume/transfer), so
              // it is exactly the un-received portion of THIS Company → Warehouse
              // allocation — a receive-status figure, not a live-stock balance.
              inTransitStock: Number(r.inTransitStock || 0),
              onlineStock: 0,
              offlineStock: assigned,
              reservedStock: 0,
              damagedStock: 0,
              isThisRow: String(r._id) === String(lot._id),
            };
          }),
          packaging,          // original box roll-up
          // Every original box of the lot, each carrying the Bulk Packaging
          // carton it sits in so the page nests all three levels — and where its
          // units currently are, so the company can read the whole lot in one
          // place without any box being listed twice.
          bulkPackages: boxesWithParent.map(withLocation),
          units,              // every original unit code (identity-scoped)
          unitTotal,          // originalQuantity
          unitsTruncated,
          movements,
        },
      });
    }

    // INVENTORY VIEW = the CURRENT state of THIS warehouse's row, consistent
    // with the Inventory list. Everything below is scoped to units/stock that
    // still belong to this row right now; anything already transferred to another
    // warehouse has left this row and must not appear here. (The immutable
    // "original transfer" view lives in Transfer History → View, which is
    // unchanged and served by lotTransferSnapshot.)
    // ONE SOURCE OF TRUTH for "which boxes are here". The Packaging Summary's
    // received figures and the Bulk Packaging IDs list below are both computed
    // through bulkPackageService.boxesPresentAt, against this lot's warehouse —
    // so the section header and the summary cannot report different numbers.
    const lotWarehouseId = lot.warehouseId?._id || lot.warehouseId || null;
    const [ownBoxes, packaging, current, movements] = await Promise.all([
      bulkPackageService.listByLot(companyId, lot._id),
      bulkPackageService.summaryForLot(companyId, lot._id, { warehouseId: lotWarehouseId }),
      currentLotUnits(companyId, lot),
      StockMovement.find({ inventoryId: lot._id })
        .sort({ createdAt: -1, _id: -1 })
        .limit(MAX_DETAIL_MOVEMENTS),
    ]);
    const { units, unitTotal, unitsTruncated } = current;

    /**
     * THE CARTONS THIS ROW'S UNITS CAME IN — including cartons that belong to
     * ANOTHER Inventory row.
     *
     * A warehouse that RECEIVES a transfer gets a brand-new Inventory row, while
     * the BulkPackage records still point at the SENDING row's lot. So
     * listByLot (keyed on lot_id) returns nothing here, `boxById` below came out
     * empty, and every single unit fell through to the flat `looseUnitCodes`
     * list — which is why the receiving page showed 94 unit codes in one heap
     * with no box headings, while the sending page grouped them properly.
     *
     * The units themselves still know their carton, so the boxes are discovered
     * from them. Everything downstream — the box cards, the "X of Y units here"
     * groups, the shared LotPackagingPanel — is then reached by the SAME code
     * the sending side already runs; nothing here is a second implementation.
     */
    const inheritedIds = await UnitSerial.distinct("bulk_packaging_record_id", {
      companyId,
      inventoryId: lot._id,
      ownerType: "company",
      ownerId: companyId,
      bulk_packaging_record_id: { $ne: null },
    });
    /**
     * THE MAIN CARTONS, so the page can show all three levels.
     *
     * listByLot returns only the boxes that HOLD UNITS — on a three-level lot
     * that is the inner boxes, main rows excluded on purpose so nothing counts
     * twice. Nobody then fetched the main rows, so the page drew inner boxes
     * flat and the Bulk Packaging level was simply absent. They are read here
     * and attached to each inner box as its parent; the counts still come from
     * the unit-holding boxes alone, so no total changes.
     */
    const mainBoxRows = await bulkPackageService.listMainBoxes(companyId, lot._id);
    const mainById = new Map(mainBoxRows.map((m) => [String(m._id), m]));
    const parentOf = (b) => mainById.get(String(b.parent_box_id || "")) || null;

    const ownIds = new Set(ownBoxes.map((b) => String(b._id)));
    const extraIds = inheritedIds.filter((id) => id && !ownIds.has(String(id)));
    const inheritedBoxes = extraIds.length
      ? await BulkPackage.find({ _id: { $in: extraIds }, company_id: companyId }).sort({ box_serial: 1 })
      : [];
    const allBoxes = [...ownBoxes, ...inheritedBoxes];

    // Bulk Packaging IDs (the box LIST) — the SAME boxes the summary above just
    // counted as received, from the same function. Every box of the lot is
    // judged on its own state; there is no slice, take, limit or index here.
    const present = bulkPackageService.boxesPresentAt(allBoxes, lotWarehouseId);
    // Surfaces a received box whose warehouse does not match this lot's — the
    // one way the two can still differ. Silent when they agree.
    // Diagnostic over THIS lot's OWN boxes only. An inherited carton (one whose
    // record belongs to the sending row) is booked to the sending warehouse by
    // definition, so including them here would warn on every receiving-side
    // page view about something that is not a mismatch at all.
    bulkPackageService.logBoxPresenceMismatch(lot._id, lotWarehouseId, ownBoxes, present);

    // THE UNITS INSIDE EACH BOX, read from the units' own link to that box.
    //
    // This section used to be rendered by grouping the page's `units` array —
    // which is the row's IN-STOCK units. That array is not a reliable guide to
    // what is in a box, because receiveBox activates the first `units_in_box`
    // units of the LOT rather than the units of the box being received (its
    // step 4 filters on status alone). Receive a box out of order and the
    // activation lands on an earlier box's units, leaving the box that was
    // actually received holding none that are "in_stock" — so its list came out
    // empty while the summary, which counts boxes, still reported it received.
    //
    // A box's contents are simply the units that point at it and still belong
    // to this row. No status filter, no slice, no cursor walking the boxes.
    //
    // Scoped by the ORIGINATING company, not the current owner, so a unit
    // supplied onward to a seller (which rewrites ownerType/ownerId/inventoryId
    // but never companyId) is still visible here as one that HAS LEFT — which
    // is what decides whether its box is still on this shelf, below.
    const boxLinks = await UnitSerial.find({
      companyId,
      // EVERY box of the lot, not just the ones on this shelf — units of a box
      // that is not here can still be here, and they are grouped under it below.
      bulk_packaging_record_id: { $in: allBoxes.map((b) => b._id) },
    })
      .select("serial unit_code unit_serial box_serial bulk_packaging_record_id inventoryId ownerType ownerId status")
      .sort({ box_serial: 1, unit_serial: 1, serial: 1 })
      .lean();

    // Two facts per box, from that one read: what it still holds HERE, and how
    // many units it was ever given.
    const unitsInBox = new Map();
    const mintedPerBox = new Map();
    for (const u of boxLinks) {
      const k = String(u.bulk_packaging_record_id);
      mintedPerBox.set(k, (mintedPerBox.get(k) || 0) + 1);
      // The unit list's own predicate — this row, still held by this company,
      // and NOT ALREADY DISPATCHED.
      //
      // A unit that has left on a transfer keeps `inventoryId` pointing at this
      // row until the far end receives it (that is what makes the receipt
      // possible), so "belongs to this row" alone counted goods that were on a
      // truck. The sending warehouse's Bulk Packaging IDs section went on
      // listing all ten units and all five boxes while its Inventory quantity
      // had already dropped to four. `shipped` is the state dispatch sets, and
      // it is cleared the moment the stock lands somewhere.
      const here = String(u.inventoryId) === String(lot._id)
        && u.ownerType === "company"
        && String(u.ownerId) === String(companyId)
        && u.status !== DISPATCHED_STATUS;
      if (!here) continue;
      if (!unitsInBox.has(k)) unitsInBox.set(k, []);
      unitsInBox.get(k).push(u.unit_code || u.serial);
    }

    // A BOX CARD MEANS THE CARTON IS HERE, WHOLE. "received" stays true for a
    // box that was received and later sent onward, so receive history cannot
    // answer it; what decides is whether every unit it was given still belongs
    // to this row. A box holding only part of its units is not here as a carton
    // — its units are listed as loose ones below instead, so the page never
    // implies a box is on the shelf when only a handful of its units are.
    //
    // A box that was never labelled has nothing that could have moved, so it
    // stays a card — which keeps "No unit labels generated for this box yet"
    // meaning exactly that, rather than being the symptom of a filter mismatch.
    const isWholeBoxHere = (b) => {
      const k = String(b._id);
      const minted = mintedPerBox.get(k) || 0;
      if (!minted) return true;
      return (unitsInBox.get(k) || []).length === minted;
    };

    const bulkPackages = present.filter(isWholeBoxHere).map((b) => {
      const codes = unitsInBox.get(String(b._id)) || [];
      const parent = parentOf(b);
      return {
        ...(typeof b.toObject === "function" ? b.toObject() : b),
        unit_codes: codes,
        current_units: codes.length || Number(b.units_in_box || 0),
        // The Bulk Packaging carton this inner box sits in — null on a
        // two-level lot, which is what keeps those rendering flat.
        parent_bulk_packaging_id: parent?.bulk_packaging_id || null,
        parent_box_serial: parent?.box_serial ?? null,
        parent_units_in_box: parent?.units_in_box ?? null,
        parent_status: parent?.status || null,
        parent_received_at: parent?.received_at || null,
      };
    });

    // THE LOT'S CREATED QUANTITY — a property of the LOT, not of this row.
    //
    // `lot.originalQuantity` is written only on the row the company actually
    // minted; a row this warehouse received by transfer has none, so reading it
    // here reported whatever this warehouse happens to hold. The lot's own
    // figure is the sum of the original allocations under its number. For a
    // boxed lot the packaging states the same total, which covers a lot whose
    // originating row predates the register.
    const lotNo = lot.lotNumber || lot.batchNumber;
    const originalRows = await Inventory.find({
      ownerType: "company",
      ownerId: companyId,
      $or: [{ lotNumber: lotNo }, { batchNumber: lotNo }],
      originalQuantity: { $ne: null },
    })
      .select("originalQuantity")
      .lean();
    const allocated = originalRows.reduce((s, r) => s + Number(r.originalQuantity || 0), 0);
    const packedTotal = Number(lot.number_of_boxes || 0) * Number(lot.units_per_box || 0);
    const lotOriginalQuantity = allocated || packedTotal || null;

    // LOOSE UNITS — units held here whose box is NOT on this shelf in full.
    //
    // They belong to no rendered box card (that card would imply the carton
    // itself is here), but they are not anonymous either: each one knows its
    // parent box, so they are grouped by it rather than dumped into one flat
    // list where two boxes' units become indistinguishable. Grouping is by the
    // stored `bulk_packaging_record_id`, never by reading the unit code.
    //
    // A unit is in EXACTLY ONE place: units of a rendered box are skipped here,
    // and everything else lands in a group or, with no box at all, in the plain
    // list below.
    // Built from `units` — the page's existing, correct answer to "which units
    // are present at this warehouse" — so a box that has not been received here
    // contributes nothing, however its labels are stored. Units of a box that IS
    // rendered as a card are skipped, which is what keeps every unit in exactly
    // one place.
    const renderedBoxIds = new Set(bulkPackages.map((b) => String(b._id)));
    const boxById = new Map(allBoxes.map((b) => [String(b._id), b]));

    // REPACK CARTONS (BX) held here. A unit that travelled in one is grouped
    // under THAT carton rather than under the original box it was minted into —
    // the repack is the outer packaging the warehouse physically received. Its
    // original box link is untouched and still drives traceability.
    const repackIds = [...new Set(units.map((u) => String(u.repack_box_id || "")).filter(Boolean))];
    const repackRows = repackIds.length
      ? await RepackBox.find({ _id: { $in: repackIds }, company_id: companyId }).lean()
      : [];
    const repackById = new Map(repackRows.map((r) => [String(r._id), r]));

    const looseByBox = new Map();
    const repackByBox = new Map();
    const looseUnitCodes = [];
    for (const u of units) {
      const code = u.unit_code || u.serial;
      const repackKey = String(u.repack_box_id || "");
      if (repackKey && repackById.has(repackKey)) {
        if (!repackByBox.has(repackKey)) repackByBox.set(repackKey, []);
        repackByBox.get(repackKey).push(code);
        continue;
      }
      const key = String(u.bulk_packaging_record_id || "");
      if (key && renderedBoxIds.has(key)) continue;
      // No parent box at all — a single-package lot, or labels minted before
      // the lot was packed.
      if (!key || !boxById.has(key)) { looseUnitCodes.push(code); continue; }
      if (!looseByBox.has(key)) looseByBox.set(key, []);
      looseByBox.get(key).push(code);
    }
    const looseUnitGroups = [
      ...[...looseByBox.entries()].map(([key, codes]) => {
        const b = boxById.get(key);
        const parent = parentOf(b);
        return {
          bulkPackagingId: b.bulk_packaging_id,
          boxSerial: b.box_serial,
          unitsInBox: b.units_in_box,
          status: b.status || null,
          receivedAt: b.received_at || null,
          // Same parent link the box cards carry, so a partially-present inner
          // box still nests under its carton.
          parentBulkPackagingId: parent?.bulk_packaging_id || null,
          parentBoxSerial: parent?.box_serial ?? null,
          parentUnitsInBox: parent?.units_in_box ?? null,
          parentStatus: parent?.status || null,
          parentReceivedAt: parent?.received_at || null,
          codes,
        };
      }).sort((a, b) => Number(a.boxSerial || 0) - Number(b.boxSerial || 0)),
      // Repack cartons after the lot's own boxes, each under its own heading.
      ...[...repackByBox.entries()].map(([key, codes]) => {
        const r = repackById.get(key);
        return {
          bulkPackagingId: r.repack_box_id,
          boxSerial: null,
          unitsInBox: r.unit_count,
          kind: "repack",
          codes,
        };
      }),
    ];

    res.json({
      success: true,
      data: {
        lot,
        // The quantity the LOT was created with — never this warehouse's share.
        lotOriginalQuantity,
        // Units held here that came out of a box which is not here in full.
        looseUnitGroups,
        looseUnitCodes,
        // Stock Context = this warehouse's CURRENT stock for the lot (the row the
        // user opened). Other warehouses' rows are their own inventory and are not
        // this warehouse's stock, so they are not listed here.
        stockByWarehouse: [
          {
            inventoryId: lot._id,
            warehouse: lot.warehouseId?.name || "Unassigned",
            warehouseCode: lot.warehouseId?.code || null,
            onlineStock: lot.onlineStock || 0,
            offlineStock: lot.offlineStock || 0,
            reservedStock: lot.reservedStock || 0,
            damagedStock: lot.damagedStock || 0,
            availableStock: lot.availableStock || 0,
            inTransitStock: lot.inTransitStock || 0,
            isThisRow: true,
          },
        ],
        packaging,          // ORIGINAL box roll-up (structure); null when single package
        bulkPackages,       // only boxes still holding units in this warehouse
        units,              // only units currently owned by this warehouse row
        unitTotal,          // current count for this row (Unit Labels = 50)
        unitsTruncated,
        movements,
      },
    });
  } catch (err) {
    console.error("lotDetails error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * GET /api/lots/:id/transfer-snapshot
 *
 * IMMUTABLE historical view of ONE Company → Warehouse transfer, for
 * Warehouse → Transfer History → View. A Transfer History record must read the
 * same forever: it is what ARRIVED on that date, NOT what remains today.
 *
 * WHY A SEPARATE ENDPOINT FROM /details:
 *   /lots/:id/details is the LIVE Lot Details page. Its units come from
 *   `UnitSerial.find({ inventoryId: lot._id })` — the units that STILL point at
 *   this Inventory row. That is correct for "what's in this lot right now", but
 *   wrong for history: a later warehouse→warehouse transfer REASSIGNS a moved
 *   unit's `inventoryId` to the destination row (shipmentService.js, transfer
 *   receipt: `UnitSerial.updateMany(..., { $set: { inventoryId: dest } })`), so
 *   the live query silently drops it and the original transfer appears to shrink
 *   (100 → 80). Reading `availableStock` for the quantity has the same leak.
 *
 * HOW HISTORY IS RECONSTRUCTED — from anchors a movement can NEVER rewrite:
 *   • Quantity / label total  → Inventory.originalQuantity, the write-once
 *     register (same immutable number barcodeService already uses as the label
 *     cap). Falls back to the full minted-unit count for pre-register rows.
 *   • Unit Codes              → every UnitSerial ever minted for this lot,
 *     matched by (companyId, productId, lotNumber). `lotNumber` and `companyId`
 *     are stamped at mint and never touched by a transfer/supply, so a moved
 *     unit is still found here even though its `inventoryId` now points
 *     elsewhere. NOT scoped by inventoryId — that is the whole point.
 *   • Bulk Packaging IDs      → BulkPackage.find({ lot_id }) (bulkPackageService
 *     .listByLot), anchored to the source lot and unaffected by any move.
 *
 * Read-only; scoped exactly like /details. Returns the SAME response shape so
 * the View page normaliser needs no per-endpoint branch.
 */
exports.lotTransferSnapshot = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const lot = await Inventory.findOne({ _id: req.params.id, ownerType: "company", ownerId: companyId })
      .populate("productId", "productName product_code skuNumber brandName category unit unitType packagingType mrp hsnCode")
      .populate("warehouseId", "name code address");
    if (!lot) return res.status(404).json({ success: false, message: "Lot not found" });

    // Warehouse-scoped users only see lots in their own warehouses.
    const scope = await warehouseScope(req.user);
    if (scope && !inScope(scope, lot.warehouseId?._id || lot.warehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — wrong warehouse" });
    }

    // Same immutable reconstruction the Company Inventory → View uses, so both
    // historical pages read the lot identically. Boxes are anchored by lot_id and
    // are likewise unaffected by any later movement.
    const [boxes, packaging, original] = await Promise.all([
      bulkPackageService.listByLot(companyId, lot._id),
      bulkPackageService.summaryForLot(companyId, lot._id),
      originalLotUnits(companyId, lot),
    ]);
    const { units, unitTotal, unitsTruncated } = original;

    res.json({
      success: true,
      data: {
        lot,
        packaging,          // null when the lot is a single package
        bulkPackages: boxes,
        units,
        unitTotal,          // may exceed units.length — see MAX_DETAIL_UNITS
        unitsTruncated,
        snapshot: true,     // marks this as the immutable historical view
      },
    });
  } catch (err) {
    console.error("lotTransferSnapshot error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * GET /api/lots/:id/bulk-packages
 * Every Bulk Packaging ID (physical outer box) of a lot — drives the box list
 * and the printable Bulk Packaging Labels.
 */
exports.listBulkPackages = async (req, res) => {
  try {
    const lot = await Inventory.findOne({ _id: req.params.id, ownerId: req.user.companyId })
      .select("_id has_bulk_packaging number_of_boxes units_per_box lot_number_segments lot_number_serial packaging_main_boxes packaging_boxes_per_main");
    if (!lot) return res.status(404).json({ success: false, message: "Lot not found" });

    // THE BOXES THIS ROW'S UNITS ARE IN — its own, plus any carton whose record
    // belongs to the row that SENT them. Without the second kind a receiving
    // warehouse's Labels page got no boxes at all and fell back to a flat grid
    // of unit labels, with the Bulk Packaging / Inner Box levels missing.
    const rows = await bulkPackageService.boxesForRow(req.user.companyId, lot._id);
    const summary = await bulkPackageService.summaryForLot(req.user.companyId, lot._id);

    // THREE-LEVEL PACKAGING, resolved here so the Labels page never has to parse
    // an ID string to work out the hierarchy. The outer cartons are real records
    // with their own scannable IDs, and each inner box states its parent plus its
    // position INSIDE that parent (1…n, restarting under every main box).
    //
    // A lot created before the two levels existed has no main box records, so
    // `mainBoxes` comes back empty and the page keeps its flat list.
    // Read from the boxes' own parent links, so the Bulk Packaging level is
    // there on a receiving row too — listMainBoxes is keyed on lot_id and comes
    // back empty there for the same reason listByLot did.
    const mainRows = await bulkPackageService.mainBoxesFor(req.user.companyId, rows);

    const seenPerParent = new Map();
    const boxes = rows.map((b) => {
      const doc = typeof b.toObject === "function" ? b.toObject() : b;
      if (!doc.parent_box_id) return doc;
      const key = String(doc.parent_box_id);
      const index = (seenPerParent.get(key) || 0) + 1;
      seenPerParent.set(key, index);
      return { ...doc, inner_index: index };
    });

    const mainBoxes = mainRows.map((m) => {
      const doc = typeof m.toObject === "function" ? m.toObject() : m;
      return {
        ...doc,
        main_serial: doc.box_serial,
        total: mainRows.length,
        inner_total: seenPerParent.get(String(doc._id)) || 0,
      };
    });

    res.json({
      success: true,
      count: boxes.length,
      data: boxes,
      packaging: summary,
      mainBoxes,
      boxesPerMain: Number(lot.packaging_boxes_per_main) || null,
      // ADDITIVE — what "Box 2 of 4" is counted against, taken from the boxes'
      // OWN lot. A receiving row's `number_of_boxes` is unset (it was never
      // created through Create Lot), and even when it is set it describes the
      // lot rather than what arrived; the carton's printed sticker says "of 4"
      // and the screen must agree with it.
      totalBoxes: await bulkPackageService.lotBoxTotal(req.user.companyId, boxes),
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * GET /api/lots/incoming-box?code=<BULK PACKAGING ID>
 * Company Warehouse scan of ONE physical box. Read-only — moves no stock.
 */
exports.incomingBox = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const box = await bulkPackageService.findIncomingBox(req.user.companyId, req.query.code, {
      allowedWarehouseIds: scope,
    });
    res.json({ success: true, data: box });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * POST /api/lots/receive-box  { bulkPackagingId }
 * Receive ONE box: books exactly that box's units_in_box. Atomic and once-only
 * — a duplicate or concurrent scan is rejected without moving stock.
 */
exports.receiveBox = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const out = await bulkPackageService.receiveBox(req.user.companyId, req.body.bulkPackagingId, {
      performedBy: req.user.id,
      allowedWarehouseIds: scope,
    });
    res.json({
      success: true,
      message:
        out.receivingStatus === "received"
          ? "Final box received — lot fully received"
          : `Box ${out.boxSerial} received (${out.receivedUnits} units)`,
      data: out,
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * GET /api/lots/incoming?lot=<PARENT LOT NO>
 * Company Warehouse "Receive Lot" scan: resolve an EXACT parent lot to the lot
 * awaiting receipt at THIS warehouse. Read-only — moves no stock.
 */
exports.incomingLot = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const r = await lotService.findPendingLot(req.user.companyId, {
      lotNumber: req.query.lot,
      allowedWarehouseIds: scope,
    });
    res.json({ success: true, data: r });
  } catch (err) {
    // A boxed lot rejects the parent-lot scan; pass the box roll-up along so the
    // UI can tell the operator how many boxes are still outstanding.
    res.status(err.status || 500).json({
      success: false,
      message: err.message || "Server error",
      ...(err.packaging ? { packaging: err.packaging } : {}),
    });
  }
};

/**
 * POST /api/lots/:id/confirm-receipt
 * Company Warehouse Confirm Receive: the ONLY place a pending lot's quantity
 * lands on this warehouse's books. Atomic; a repeat confirm is rejected.
 */
exports.confirmLotReceipt = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const inv = await lotService.confirmLotReceipt(req.user.companyId, req.params.id, {
      performedBy: req.user.id,
      allowedWarehouseIds: scope,
    });
    res.json({ success: true, message: "Received into your warehouse", data: inv });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** POST /api/lots/transfer  { inventoryId, toWarehouseId, qty } */
exports.transferLot = async (req, res) => {
  try {
    // Tenant + warehouse-level guards:
    //  - the source lot must belong to THIS company;
    //  - a scoped operations manager can only transfer OUT of their own warehouse;
    //  - the destination must be one of the company's warehouses (any of them —
    //    sending across warehouses is exactly what transfers are for).
    const srcRow = await Inventory.findOne({ _id: req.body.inventoryId, ownerId: req.user.companyId }).select("warehouseId");
    if (!srcRow) return res.status(404).json({ success: false, message: "Lot not found" });
    const scope = await warehouseScope(req.user);
    if (scope && !inScope(scope, srcRow.warehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — wrong warehouse" });
    }
    const destOk = await Warehouse.exists({ _id: req.body.toWarehouseId, companyId: req.user.companyId });
    if (!destOk) return res.status(400).json({ success: false, message: "Destination warehouse not found" });

    const out = await lotService.transferLot({ ...req.body, performedBy: req.user.id });
    res.json({ success: true, message: "Transfer complete", data: out });
  } catch (err) {
    console.error("transferLot error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** POST /api/lots/sell-fefo  { productId, qty, channel?, refId? } */
exports.sellFefo = async (req, res) => {
  try {
    const consumed = await lotService.sellFEFO({
      ownerId: req.user.companyId,
      performedBy: req.user.id,
      ...req.body,
    });
    res.json({ success: true, message: "Stock deducted (FEFO)", data: consumed });
  } catch (err) {
    console.error("sellFefo error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};
