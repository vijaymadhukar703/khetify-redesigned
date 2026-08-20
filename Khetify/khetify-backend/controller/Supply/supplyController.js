const mongoose = require("mongoose");
const SupplyOrder = require("../../model/Supply/SupplyOrder");
const UnitSerial = require("../../model/Barcode/UnitSerial");
const UnitEvent = require("../../model/Barcode/UnitEvent");
const Location = require("../../model/Warehouse/Location");
const Warehouse = require("../../model/Warehouse/Warehouse");
const Inventory = require("../../model/Inventory/Inventory");
const Shipment = require("../../model/Transport/Shipment");
const lotService = require("../../services/lotService");
const barcodeService = require("../../services/barcodeService");
const shipmentService = require("../../services/shipmentService");
const locationService = require("../../services/locationService");
const { assertCompanyWarehouse } = require("../../services/warehouseOwnershipService");
const { notify, notifyWarehouseTeam } = require("../../services/notificationService");
const { warehouseScope } = require("../../services/warehouseScope");
const { validateConfirmPick } = require("../../services/pickScanService");

// Stage → the supply-order statuses that belong in each Send Stock tab.
const STAGE_STATUSES = {
  pick: ["approved", "picking"],
  pack: ["picked", "packing"],
  dispatch: ["packed"],
};

/** POST /api/supply-order  — seller (or company on behalf) requests bulk supply. */
exports.createSupplyOrder = async (req, res) => {
  try {
    const { sellerId, items, notes } = req.body;
    if (!sellerId || !Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "sellerId and non-empty items[] are required" });
    }
    const order = await SupplyOrder.create({
      sellerId,
      companyId: req.user.companyId,
      items,
      notes,
      status: "requested",
    });
    await notify({
      recipientType: "company",
      recipientId: req.user.id,
      type: "supply_status",
      title: "New supply request",
      body: "A seller has requested bulk supply.",
      payload: { supplyOrderId: order._id },
    });
    res.status(201).json({ success: true, message: "Supply order created", data: order });
  } catch (err) {
    console.error("createSupplyOrder error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /api/supply-order — company sees its own incoming requests, enriched
 * with seller business name, product names and warehouses for the UI. Includes
 * `pendingCount` (status "requested") for the Home widget.
 *
 * `?stage=pick|pack|dispatch` narrows to the Send Stock tab's statuses so the
 * warehouse picks/packs/dispatches APPROVED SUPPLY directly (no wave). */
exports.getSupplyOrders = async (req, res) => {
  try {
    const filter = { companyId: req.user.companyId };
    const stageStatuses = STAGE_STATUSES[req.query.stage];
    if (stageStatuses) filter.status = { $in: stageStatuses };

    // Warehouse-level access: a scoped warehouse user only sees the supply the
    // company ASSIGNED to their warehouse (sourceWarehouseId in their warehouses).
    // Unscoped roles (company_admin holds "*") are untouched and still see every
    // request in pending/approved/assigned/history, so the company manages all.
    const scope = await warehouseScope(req.user);
    if (scope) filter.sourceWarehouseId = { $in: scope };

    const rows = await SupplyOrder.find(filter)
      .sort({ createdAt: -1 })
      // ADDITIVE: contact.ownerName so the Send Stock table can show the seller's
      // contact person alongside their company name. Nothing else changes.
      .populate({ path: "sellerId", model: "Seller", select: "sellerInfo.businessName contact.ownerName" })
      // trackSerial lets the Pick UI drive serial-tracked rows by scanning only
      // (read-only qty) while non-serialized rows keep their manual qty input.
      .populate({ path: "items.productId", select: "productName skuNumber unit trackSerial" })
      .populate({ path: "warehouseId", select: "name code address" })
      .populate({ path: "sourceWarehouseId", select: "name code" });
    const pendingCount = rows.filter((r) => r.status === "requested").length;
    res.json({ success: true, count: rows.length, pendingCount, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * GET /api/supply-order/:id/source-options
 * Per (company) warehouse availability for THIS order's items, so "Assign a
 * source warehouse" can show how much of each requested product a warehouse
 * actually has and block ones that can't fulfill. `availableQty` sums
 * availableStock across NON-EXPIRED lots — exactly what approval FEFO-reserves.
 */
exports.getSourceOptions = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await SupplyOrder.findOne({ _id: req.params.id, companyId })
      .populate({ path: "items.productId", select: "productName" });
    if (!order) return res.status(404).json({ success: false, message: "Supply order not found" });

    const now = new Date();
    const productIds = (order.items || []).map((it) => new mongoose.Types.ObjectId(String(it.productId?._id || it.productId)));
    const warehouses = await Warehouse.find({ companyId }).select("name code").sort({ name: 1 });

    // Sum available, non-expired stock per (warehouse, product) in one pass.
    const agg = await Inventory.aggregate([
      {
        $match: {
          ownerType: "company",
          ownerId: new mongoose.Types.ObjectId(String(companyId)),
          productId: { $in: productIds },
          $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
        },
      },
      { $group: { _id: { wh: "$warehouseId", product: "$productId" }, available: { $sum: "$availableStock" } } },
    ]);
    const key = (wh, prod) => `${wh}|${prod}`;
    const avail = new Map(agg.map((r) => [key(r._id.wh, r._id.product), r.available]));

    const data = warehouses.map((w) => {
      const items = (order.items || []).map((it) => {
        const pid = String(it.productId?._id || it.productId);
        return {
          productId: pid,
          productName: it.productId?.productName || "Item",
          requiredQty: it.quantity,
          availableQty: avail.get(key(w._id, pid)) || 0,
        };
      });
      return { warehouseId: w._id, name: w.name, code: w.code || null, items, canFulfill: items.every((i) => i.availableQty >= i.requiredQty) };
    });
    // Fulfilling warehouses first, then by name.
    data.sort((a, b) => (b.canFulfill ? 1 : 0) - (a.canFulfill ? 1 : 0) || String(a.name).localeCompare(String(b.name)));

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

/** GET /api/supply-order/pending-count — number of requests awaiting action
 * (drives the company Home "Supply requests" banner). */
exports.getPendingCount = async (req, res) => {
  try {
    // Pending approvals belong to the COMPANY — unassigned requests have no
    // source warehouse yet, so a scoped warehouse user has none to see.
    const scope = await warehouseScope(req.user);
    const pendingFilter = { companyId: req.user.companyId, status: "requested" };
    if (scope) pendingFilter.sourceWarehouseId = { $in: scope };
    const pendingCount = await SupplyOrder.countDocuments(pendingFilter);
    res.json({ success: true, data: { pendingCount } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * PUT /api/supply-order/:id/status  { status, shipment? }
 * On "approved": runs the two-sided transfer (company stock out, seller stock in)
 * inside a transaction so a partial failure rolls back.
 */
exports.updateSupplyStatus = async (req, res) => {
  try {
    const { status, shipment, sourceWarehouseId } = req.body;
    const order = await SupplyOrder.findOne({
      _id: req.params.id,
      companyId: req.user.companyId,
    });
    if (!order) return res.status(404).json({ success: false, message: "Supply order not found" });

    if (status === "approved" && order.status !== "approved") {
      // Approval ASSIGNS A SOURCE WAREHOUSE and ALLOCATES (reserves) stock from
      // it — exactly like confirming a customer order. The reserved supply then
      // surfaces in SEND STOCK, where Operations picks, packs and prints a
      // shipping label. The cross-owner shipment is created at DISPATCH (after
      // the label), not here. Nothing physically leaves the warehouse yet.
      if (!order.warehouseId) {
        return res.status(400).json({ success: false, message: "Destination warehouse missing on the supply order" });
      }
      const src = sourceWarehouseId || order.sourceWarehouseId;
      if (!src) {
        return res.status(400).json({ success: false, message: "Assign a source warehouse to approve this supply" });
      }
      await assertCompanyWarehouse(order.companyId, src);

      // APPROVAL IS AUTHORIZATION ONLY — it records WHICH lot(s) will fulfil
      // each item (FEFO order) but MOVES NO STOCK. The warehouse's available
      // quantity must stay untouched until it actually PICKS (pickSupplyOrder
      // reserves; dispatch commits). Throws 409 INSUFFICIENT_STOCK as an
      // advisory pre-check only.
      //
      // NO LOT IS CHOSEN HERE. Approval assigns the SOURCE WAREHOUSE and
      // nothing else; which lot / batch / boxes / units actually go out is the
      // source warehouse manager's decision at Pick, Pack and Dispatch. These
      // allocations are the FEFO plan the warehouse starts from, exactly as
      // before — this is the same code path that ran whenever the operator left
      // the old (now removed) lot dropdown on "Auto".
      for (const item of order.items) {
        item.allocations = await lotService.planAllocation({
          ownerType: "company", ownerId: order.companyId, warehouseId: src,
          productId: item.productId, qty: item.quantity,
        });
      }
      order.markModified("items");
      order.sourceWarehouseId = src;
      order.status = "approved";
      await order.save();

      // Tell the source warehouse's operations team to pick/pack in Send Stock.
      await notifyWarehouseTeam(order.companyId, src, {
        type: "supply_status", title: "Supply ready to pick in Send Stock",
        body: "An approved seller supply is assigned — pick, pack and dispatch it from Send Stock.",
        payload: { supplyOrderId: order._id, kind: "supply_ready" },
      }).catch(() => {});
      await notify({
        recipientType: "seller", recipientId: order.sellerId, type: "supply_status",
        title: "Request accepted", body: "Your supply request was accepted and is being prepared for dispatch.",
        payload: { supplyOrderId: order._id, status: "approved" },
      }).catch(() => {});

      return res.json({ success: true, message: "Approved — source assigned, ready to pick in Send Stock", data: order });
    }

    // CANCEL / REJECT safety. Approval reserves nothing, so a request killed
    // before pick needs no stock change at all. If the warehouse already PICKED
    // (reservedQty > 0) but has NOT dispatched (committed), give those units back
    // to available. Once committed (dispatched) the goods have physically left —
    // never auto-restore; that's the return flow's job.
    const KILL = ["rejected", "cancelled"];
    if (KILL.includes(status) && !KILL.includes(order.status)) {
      const dispatched = ["dispatched", "in_transit", "arrived", "partially_received", "received", "delivered"].includes(order.status);
      if (!dispatched) {
        for (const it of order.items || []) {
          for (const a of it.allocations || []) {
            if (a.committed) continue;
            const qty = Number(a.reservedQty || 0);
            if (qty <= 0) continue;
            await lotService.releaseLotQty({
              ownerType: "company", ownerId: order.companyId, inventoryId: a.inventoryId, qty,
              refType: "SupplyOrder", refId: order._id, performedBy: req.user.id,
            });
            a.reservedQty = 0;
          }
          it.pickedQty = 0;
          it.packedQty = 0;
        }
        // Picked units go back on the shelf.
        const serials = (order.items || []).flatMap((it) => (it.allocations || []).flatMap((a) => a.serials || []));
        if (serials.length) {
          await barcodeService.transitionUnits(order.companyId, serials, {
            toStatus: "in_stock", event: "released", refType: "SupplyOrder", refId: order._id, actorId: req.user.id, force: true,
          }).catch(() => {});
          for (const it of order.items || []) for (const a of it.allocations || []) a.serials = [];
        }
        order.markModified("items");
      }
    }

    order.status = status || order.status;
    if (shipment) order.shipment = { ...order.shipment, ...shipment };
    await order.save();

    await notify({
      recipientType: "seller",
      recipientId: order.sellerId,
      type: "supply_status",
      title: "Supply order updated",
      body: `Your supply order is now: ${order.status}.`,
      payload: { supplyOrderId: order._id, status: order.status },
    });

    res.json({ success: true, message: "Status updated", data: order });
  } catch (err) {
    console.error("updateSupplyStatus error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });

/**
 * GET /api/supply-order/:id/details
 * READ-ONLY detail view for one supply request: summary, the PARENT LOTS it was
 * allocated from, and the EXACT child unit serials picked from each parent lot.
 *
 * Writes nothing and changes no quantity/status. Everything is read from the
 * existing model — items[].allocations[] (inventoryId / lotNumber / qty /
 * reservedQty / committed / serials), UnitSerial for each serial's live state,
 * UnitEvent for its picked/dispatched/received timestamps, and the linked
 * Shipment for the reference, received qty and status history. Kept off the
 * list endpoint so the list stays lightweight.
 */
exports.getSupplyOrderDetails = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await SupplyOrder.findOne({ _id: req.params.id, companyId })
      .populate({ path: "sellerId", model: "Seller", select: "sellerInfo.businessName" })
      .populate({ path: "items.productId", select: "productName skuNumber unit trackSerial" })
      .populate({ path: "warehouseId", select: "name code" })
      .populate({ path: "sourceWarehouseId", select: "name code" })
      .lean();
    if (!order) return res.status(404).json({ success: false, message: "Supply order not found" });

    // Warehouse-level access: only the ASSIGNED warehouse may open this request.
    // 404 (not 403) so the id cannot be used to probe which requests exist.
    const scope = await warehouseScope(req.user);
    if (scope && !scope.includes(String(order.sourceWarehouseId?._id || order.sourceWarehouseId || ""))) {
      return res.status(404).json({ success: false, message: "Supply order not found" });
    }

    const shipment = order.shipmentId
      ? await Shipment.findOne({ _id: order.shipmentId, companyId }).lean()
      : null;

    // The EXACT serials this transfer picked — straight off the allocations.
    const allSerials = (order.items || []).flatMap((it) => (it.allocations || []).flatMap((a) => a.serials || []));
    const units = allSerials.length
      ? await UnitSerial.find({ companyId, serial: { $in: allSerials } })
          .select("serial lotNumber status ownerType printed inventoryId").lean()
      : [];
    const bySerial = new Map(units.map((u) => [u.serial, u]));

    // Movement timestamps come from the append-only unit event log.
    const events = allSerials.length
      ? await UnitEvent.find({ serial: { $in: allSerials }, event: { $in: ["picked", "in_transit", "supplied_to_seller"] } })
          .select("serial event at").sort({ at: 1 }).lean()
      : [];
    const stamps = new Map();
    for (const e of events) {
      const s = stamps.get(e.serial) || {};
      if (e.event === "picked") s.pickedAt = e.at;
      if (e.event === "in_transit") s.dispatchedAt = e.at;
      if (e.event === "supplied_to_seller") s.receivedAt = e.at;
      stamps.set(e.serial, s);
    }

    // Lot metadata (batch no / mfg / expiry) from the source lot rows.
    const invIds = [...new Set((order.items || []).flatMap((it) => (it.allocations || []).map((a) => String(a.inventoryId))))];
    const invRows = invIds.length
      ? await Inventory.find({ _id: { $in: invIds } })
          .select("mfgBatchNo mfgDate expiryDate lotNumber batchNumber warehouseId")
          .populate("warehouseId", "name").lean()
      : [];
    const byInv = new Map(invRows.map((r) => [String(r._id), r]));

    const parentLots = [];
    for (const it of order.items || []) {
      for (const a of it.allocations || []) {
        const meta = byInv.get(String(a.inventoryId)) || {};
        const line = (shipment?.lines || []).find((l) => String(l.inventoryId) === String(a.inventoryId));
        parentLots.push({
          lotNumber: a.lotNumber || a.batchNumber || meta.lotNumber || "—",
          batchNumber: a.batchNumber || null,
          mfgBatchNo: meta.mfgBatchNo || null,
          productName: it.productId?.productName || "—",
          sourceWarehouse: meta.warehouseId?.name || order.sourceWarehouseId?.name || "—",
          plannedQty: Number(a.qty || 0),
          allocatedQty: Number(a.reservedQty || 0) || Number(a.qty || 0),
          receivedQty: line?.receivedQty ?? null,
          mfgDate: meta.mfgDate || null,
          expiryDate: meta.expiryDate || null,
          status: a.committed ? "dispatched" : ((a.serials || []).length ? "picked" : "awaiting pick"),
          units: (a.serials || []).map((s) => {
            const u = bySerial.get(s) || {};
            const t = stamps.get(s) || {};
            return {
              serial: s,
              lotNumber: u.lotNumber || a.lotNumber || null,
              status: u.status || "—",
              printed: u.printed === true,
              owner: u.ownerType || null,
              pickedAt: t.pickedAt || null,
              dispatchedAt: t.dispatchedAt || null,
              receivedAt: t.receivedAt || null,
            };
          }),
        });
      }
    }

    const sum = (f) => (order.items || []).reduce((s, it) => s + Number(it[f] || 0), 0);
    const dispatchedQty = (order.items || []).reduce(
      (s, it) => s + (it.allocations || []).reduce((n, a) => n + (a.committed ? Number(a.reservedQty || a.qty || 0) : 0), 0), 0);
    const receivedQty = (shipment?.lines || []).reduce((s, l) => s + Number(l.receivedQty || 0), 0);
    const authorized = !["requested", "under_review", "rejected", "cancelled"].includes(order.status);

    res.json({
      success: true,
      data: {
        summary: {
          seller: order.sellerId?.sellerInfo?.businessName || "—",
          sourceWarehouse: order.sourceWarehouseId?.name || "—",
          destination: order.warehouseId?.name || "—",
          products: (order.items || []).map((it) => it.productId?.productName || "Item"),
          requestedQty: sum("quantity"),
          approvedQty: authorized ? sum("quantity") : 0,
          pickedQty: sum("pickedQty"),
          packedQty: sum("packedQty"),
          dispatchedQty,
          receivedQty,
          requestDate: order.createdAt,
          status: order.status,
          shipmentRef: shipmentService.shipmentRef(shipment),
        },
        parentLots,
        timeline: (shipment?.statusHistory || []).map((e) => ({ status: e.status, at: e.at })),
      },
    });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/supply-order/:id/pick  { picks: [{ productId, qty, serials?, binCode? }] }
 * Direct scan-pick straight against the order's reserved allocations — NO
 * PickList, NO wave. Labeled units transition in_stock → picked and are recorded
 * on their allocation (lot-accurate). Owned stock is NOT deducted here; it stays
 * reserved until dispatch commits it.
 */
exports.pickSupplyOrder = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const performedBy = req.user.id;
    const { picks } = req.body;
    if (!Array.isArray(picks) || !picks.length) return res.status(400).json({ success: false, message: "picks[] are required" });

    const order = await SupplyOrder.findOne({ _id: req.params.id, companyId });
    if (!order) return res.status(404).json({ success: false, message: "Supply order not found" });
    if (!["approved", "picking"].includes(order.status)) return res.status(409).json({ success: false, message: `Cannot pick a ${order.status} supply order` });
    // A warehouse-scoped picker may only pick stock from their own warehouse.
    const allowedWarehouseIds = await warehouseScope(req.user);

    for (const pick of picks) {
      const item = (order.items || []).find((it) => String(it.productId) === String(pick.productId));
      if (!item) return res.status(400).json({ success: false, message: `Product ${pick.productId} is not on this supply order` });
      const allocByInv = new Map((item.allocations || []).map((a) => [String(a.inventoryId), a]));

      let pickQty;
      if (Array.isArray(pick.serials) && pick.serials.length) {
        // SERVER-SIDE re-validation of the whole payload: duplicates, ownership,
        // reserved-lot membership, warehouse and status, plus the quantity cap.
        // The Pick modal's counts are never trusted.
        // A SUPPLY request may be fulfilled from a lot that did not exist when
        // it was approved: the company produces it, ships it to the warehouse,
        // the warehouse receives it, and picks it here. `newLots` are exactly
        // those — validated to be the requested product, in this warehouse, and
        // on the books.
        const { serials, newLots } = await validateConfirmPick(companyId, {
          serials: pick.serials,
          allocByInv,
          remainingRequired: Math.max(0, Number(item.quantity || 0) - Number(item.pickedQty || 0)),
          allowedWarehouseIds,
          allowDynamicAllocation: true,
          productId: item.productId,
        });

        // Create the missing allocations BEFORE any stock moves, so the reserve
        // below has a lot row to record itself against. `qty` is the allocated
        // quantity; `reservedQty` fills in as units are reserved just below.
        for (const nl of newLots) {
          const alloc = {
            inventoryId: nl.inventoryId,
            lotNumber: nl.lotNumber,
            batchNumber: nl.batchNumber,
            warehouseId: nl.warehouseId,
            qty: nl.count,
            reservedQty: 0,
            committed: false,
            serials: [],
            allocatedAt: new Date(),
            allocatedBy: performedBy || null,
          };
          item.allocations = item.allocations || [];
          item.allocations.push(alloc);
          // Point at the pushed subdocument so the reserve/serial writes below
          // land on the stored copy, not on this detached literal.
          allocByInv.set(String(nl.inventoryId), item.allocations[item.allocations.length - 1]);
        }

        const units = await UnitSerial.find({ companyId, serial: { $in: serials } });
        const bySerial = new Map(units.map((u) => [u.serial, u]));
        // RESERVE the picked units on their own lot FIRST — this is where the
        // warehouse's available stock drops (approval no longer touches it).
        // Atomic + conditional, so the same units can't be picked twice.
        const byLot = new Map();
        for (const s of serials) {
          const invId = String(bySerial.get(s).inventoryId);
          byLot.set(invId, (byLot.get(invId) || 0) + 1);
        }
        for (const [invId, n] of byLot) {
          await lotService.reserveLotQty({
            ownerType: "company", ownerId: companyId, inventoryId: invId, qty: n,
            refType: "SupplyOrder", refId: order._id, performedBy,
          });
          const a = allocByInv.get(invId);
          a.reservedQty = (a.reservedQty || 0) + n;
        }
        // Compare-and-swap per unit, so a unit another picker took between the
        // check above and here is REPORTED rather than double-picked.
        const { moved } = await barcodeService.transitionUnits(companyId, serials, { toStatus: "picked", event: "picked", refType: "SupplyOrder", refId: order._id, actorId: performedBy });
        if (moved.length !== serials.length) {
          return res.status(409).json({ success: false, message: "Some units were picked by another user just now — rescan and try again" });
        }
        // Record each serial on its lot's allocation so dispatch can ship it.
        for (const s of serials) {
          const a = allocByInv.get(String(bySerial.get(s).inventoryId));
          a.serials = a.serials || [];
          if (!a.serials.includes(s)) a.serials.push(s);
        }
        pickQty = serials.length;
      } else {
        pickQty = Number(pick.qty);
        if (!pickQty || pickQty <= 0) return res.status(400).json({ success: false, message: "Each pick needs serials or a positive qty" });
        // Non-serialized: reserve the picked qty across this item's planned lots.
        let remaining = pickQty;
        for (const a of item.allocations || []) {
          if (remaining <= 0) break;
          const room = Math.max(0, Number(a.qty || 0) - Number(a.reservedQty || 0));
          const take = Math.min(room, remaining);
          if (take <= 0) continue;
          await lotService.reserveLotQty({
            ownerType: "company", ownerId: companyId, inventoryId: a.inventoryId, qty: take,
            refType: "SupplyOrder", refId: order._id, performedBy,
          });
          a.reservedQty = Number(a.reservedQty || 0) + take;
          remaining -= take;
        }
        if (remaining > 0) return res.status(409).json({ success: false, message: "Picked quantity exceeds the approved quantity for this item" });
      }

      // Optional: decrement the physical pick-face bin (stock leaves the bin into
      // staging; owned Inventory totals stay reserved until dispatch commits).
      if (pick.binCode) {
        const loc = await Location.findOne({ companyId, fullCode: String(pick.binCode).toUpperCase() });
        const inventoryId = item.allocations?.[0]?.inventoryId;
        if (loc && inventoryId) {
          await locationService.moveBinStock({ companyId, fromLocationId: loc._id, toLocationId: null, inventoryId, qty: pickQty, performedBy }).catch(() => {});
        }
      }

      item.pickedQty = Math.min(item.quantity, (item.pickedQty || 0) + pickQty);
    }

    order.markModified("items");
    order.status = (order.items || []).every((it) => (it.pickedQty || 0) >= it.quantity) ? "picked" : "picking";
    await order.save();
    res.json({ success: true, message: order.status === "picked" ? "Picked in full" : "Picked", data: order });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/supply-order/:id/pack
 * Pack the picked units: transition the order's picked serials → packed and set
 * packedQty. status → "packed" when every item is fully packed, else "packing".
 */
exports.packSupplyOrder = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const performedBy = req.user.id;
    const order = await SupplyOrder.findOne({ _id: req.params.id, companyId });
    if (!order) return res.status(404).json({ success: false, message: "Supply order not found" });
    if (!["picked", "picking", "packing"].includes(order.status)) return res.status(409).json({ success: false, message: `Cannot pack a ${order.status} supply order` });

    const serials = (order.items || []).flatMap((it) => (it.allocations || []).flatMap((a) => a.serials || []));
    if (serials.length) {
      await barcodeService.transitionUnits(companyId, serials, { toStatus: "packed", event: "packed", refType: "SupplyOrder", refId: order._id, actorId: performedBy, force: true });
    }
    for (const it of order.items || []) it.packedQty = it.pickedQty || 0;
    order.markModified("items");
    order.status = (order.items || []).every((it) => (it.packedQty || 0) >= it.quantity) ? "packed" : "packing";
    await order.save();
    res.json({ success: true, message: order.status === "packed" ? "Packed in full" : "Packed", data: order });
  } catch (err) { fail(res, err); }
};

/**
 * Build the cross-owner shipment lines from what the warehouse ACTUALLY reserved
 * at pick (`reservedQty`) — never the approval-time plan (`qty`). Dispatch then
 * commits exactly the reserved quantity, so the source can't be deducted for
 * stock that was never picked, and can't be deducted twice. A planned lot the
 * picker didn't use (reservedQty 0) contributes no line.
 *
 * The line also carries the EXACT unit serials the picker scanned and packed
 * (`a.serials`), so dispatch ships those units and no others. Without them
 * dispatch fell back to "any `line.qty` units of this lot", which could send a
 * Bulk Packaging ID whose scan was REJECTED — never picked, never packed, but
 * still sitting `in_stock` on the same lot — all the way into seller inventory.
 * Empty for non-serialized stock, which keeps the quantity-only path.
 *
 * NOTE: supply orders approved BEFORE reserve-at-pick shipped reserved at
 * approval with reservedQty 0 — run scripts/backfillSupplyReservedQty.js once so
 * those in-flight orders can still dispatch.
 */
function manifestLines(order) {
  const lines = [];
  for (const it of order.items || []) {
    for (const a of it.allocations || []) {
      const qty = Number(a.reservedQty || 0);
      if (qty <= 0) continue;
      lines.push({
        inventoryId: a.inventoryId, productId: it.productId?._id || it.productId,
        lotNumber: a.lotNumber, batchNumber: a.batchNumber, qty,
        serials: [...new Set((a.serials || []).filter(Boolean))],
      });
    }
  }
  return lines;
}

/**
 * GET /api/supply-order/:id/manifest
 * Idempotently ensure a PLANNED cross-owner Shipment (with a stable manifest
 * token) exists for this supply order, so the printed Shipping Label can carry
 * a REAL scannable barcode of the payload BEFORE dispatch. Reuses the existing
 * shipment if already created (token stays stable through dispatch & receipt).
 */
exports.getManifest = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await SupplyOrder.findOne({ _id: req.params.id, companyId })
      .populate({ path: "sellerId", model: "Seller", select: "sellerInfo.businessName" })
      .populate({ path: "warehouseId", select: "name code" })
      .populate({ path: "items.productId", select: "productName skuNumber" });
    if (!order) return res.status(404).json({ success: false, message: "Supply order not found" });

    let shipment = order.shipmentId ? await Shipment.findOne({ _id: order.shipmentId, companyId }) : null;
    if (!shipment) {
      if (!order.sourceWarehouseId) return res.status(400).json({ success: false, message: "Approve & assign a source warehouse first" });
      const lines = manifestLines(order);
      if (!lines.length) return res.status(400).json({ success: false, message: "Nothing reserved — approve to allocate first" });
      shipment = await shipmentService.createShipment(companyId, {
        refType: "SupplyOrder", refId: order._id,
        fromWarehouseId: order.sourceWarehouseId, toType: "seller", toOwnerType: "seller", toOwnerId: order.sellerId,
        toWarehouseId: order.warehouseId, toLabel: `${order.sellerId?.sellerInfo?.businessName || "Seller"} (supply)`,
        lines, performedBy: req.user.id,
      });
      shipment.qrToken = shipmentService._internal.qrFor(shipment._id);
      await shipment.save();
      order.shipmentId = shipment._id;
      await order.save();
    } else if (!shipment.qrToken) {
      shipment.qrToken = shipmentService._internal.qrFor(shipment._id);
      await shipment.save();
    }

    res.json({
      success: true,
      data: {
        shipmentId: shipment._id,
        qrPayload: `${shipment._id}.${shipment.qrToken}`,
        seller: order.sellerId?.sellerInfo?.businessName || "Seller",
        destinationWarehouse: order.warehouseId?.name || null,
        items: (order.items || []).map((it) => ({ productName: it.productId?.productName || "Item", quantity: it.quantity })),
      },
    });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/supply-order/:id/dispatch  { labelPrinted, vehicleNo?, transporter?, driver?, driverPhone? }
 * Requires the label to have been printed and a planned shipment to exist (from
 * /manifest). Persists the transport details, then finalizes the shipment via
 * shipmentService.dispatchShipment — which commits the reservation (source
 * stock leaves, supply_out ledger), keeps the SAME manifest token, sends the
 * units in-transit, sets the shipment in_transit and notifies the seller.
 */
exports.dispatchSupplyOrder = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      labelPrinted, vehicleNo, transporter, driver, driverName, driverPhone,
      bulkPackingNumber, deliveryChallanNumber, invoiceChallanNumber, gatePassNumber,
    } = req.body;
    // Optional despatch paperwork — trimmed; blank/absent leaves the field unset.
    const docs = {};
    for (const [k, v] of Object.entries({ bulkPackingNumber, deliveryChallanNumber, invoiceChallanNumber, gatePassNumber })) {
      if (typeof v === "string" && v.trim()) docs[k] = v.trim();
    }
    const order = await SupplyOrder.findOne({ _id: req.params.id, companyId });
    if (!order) return res.status(404).json({ success: false, message: "Supply order not found" });
    if (["dispatched", "in_transit", "arrived", "received", "partially_received", "delivered"].includes(order.status)) {
      return res.status(409).json({ success: false, message: `Supply order already ${order.status}` });
    }
    if (labelPrinted !== true) return res.status(409).json({ success: false, message: "Print the shipping label before dispatch" });
    if (!order.shipmentId) return res.status(409).json({ success: false, message: "Print the shipping label first to create the manifest" });

    // Persist transport details (+ any despatch paperwork) onto the planned shipment.
    await Shipment.updateOne(
      { _id: order.shipmentId, companyId },
      { $set: { vehicleNo, transporter, driverName: driver || driverName, driverPhone, ...docs } }
    );

    // Commit + finalize: deducts source, keeps token, units → in-transit.
    await shipmentService.dispatchShipment(companyId, order.shipmentId, { performedBy: req.user.id });

    order.status = "dispatched";
    await order.save();
    res.json({ success: true, message: "Dispatched — supply in transit", data: { shipmentId: order.shipmentId } });
  } catch (err) { fail(res, err); }
};