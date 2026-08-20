const SupplyOrder = require("../../model/Supply/SupplyOrder");
const Product = require("../../model/Company/productModel");
const Warehouse = require("../../model/Warehouse/Warehouse");
const pcService = require("../../services/pcService");
const shipmentService = require("../../services/shipmentService");
const shipmentBoxService = require("../../services/shipmentBoxService");
const Shipment = require("../../model/Transport/Shipment");
const { assertSellerWarehouse } = require("../../services/warehouseOwnershipService");
const { notify } = require("../../services/notificationService");

/**
 * POST /api/seller/supply-orders  { companyId?, items[], warehouseId, notes? }
 * A seller requests bulk supply into one of their OWN warehouses. The supplying
 * company is the one the seller CHOSE among the companies that have APPROVED
 * them (SellerCompanyLink, the source of truth) — NOT the stale single
 * Seller.supplyingCompanyId. The order is created against (and the notification
 * goes to) that approved company so it shows up on the company's side.
 */
exports.createSellerSupplyOrder = async (req, res) => {
  try {
    const { items, warehouseId, notes, companyId: bodyCompanyId } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "items[] are required" });
    }
    if (!warehouseId) {
      return res.status(400).json({ success: false, message: "Destination warehouse is required" });
    }

    // Resolve the target company from the companies that ISSUED this seller an
    // active PC (the authorization — there is no separate link approval).
    const approvedIds = (await pcService.companiesWithActivePc(req.user.sellerId)).map(String);
    if (!approvedIds.length) {
      return res.status(403).json({ success: false, message: "No active Principal Certificate yet — apply for a PC and get it issued first." });
    }
    let companyId = bodyCompanyId ? String(bodyCompanyId) : null;
    if (companyId) {
      if (!approvedIds.includes(companyId)) {
        return res.status(403).json({ success: false, message: "Choose one of the companies that issued you a PC." });
      }
    } else if (approvedIds.length === 1) {
      companyId = approvedIds[0]; // only one authorized company → no ambiguity
    } else {
      return res.status(400).json({ success: false, message: "Select a company to order from." });
    }

    // Destination must be the seller's own warehouse.
    await assertSellerWarehouse(req.user.sellerId, warehouseId);

    // Normalise + validate items: positive quantities, products belong to the
    // CHOSEN company.
    const cleanItems = [];
    for (const it of items) {
      const quantity = Number(it.quantity);
      if (!it.productId || !quantity || quantity <= 0) {
        return res.status(400).json({ success: false, message: "Each item needs a productId and a positive quantity" });
      }
      cleanItems.push({ productId: it.productId, quantity });
    }
    const productIds = cleanItems.map((i) => i.productId);
    const owned = await Product.countDocuments({ _id: { $in: productIds }, companyId });
    if (owned !== new Set(productIds.map(String)).size) {
      return res.status(400).json({ success: false, message: "One or more products are not available from the selected company" });
    }

    const order = await SupplyOrder.create({
      sellerId: req.user.sellerId,
      companyId,
      items: cleanItems,
      warehouseId,
      notes,
      status: "requested",
    });

    await notify({
      recipientType: "company",
      recipientId: companyId,
      type: "supply_status",
      title: "New supply request",
      body: "A seller has requested bulk supply of your products.",
      payload: { supplyOrderId: order._id, kind: "supply_request" },
    }).catch(() => {});

    res.status(201).json({ success: true, message: "Supply request sent", data: order });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** GET /api/seller/supply-orders — the seller's own supply orders. */
exports.getSellerSupplyOrders = async (req, res) => {
  try {
    const rows = await SupplyOrder.find({ sellerId: req.user.sellerId })
      .sort({ createdAt: -1 })
      .populate({ path: "items.productId", select: "productName skuNumber unit" })
      .populate({ path: "warehouseId", select: "name code" })
      .populate({ path: "shipmentId", select: "status qrToken statusHistory dispatchedAt" });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/seller/supply-orders/:id/receive { qr, lines? }
 * Scan-verify the manifest QR at the seller's warehouse and receive the
 * dispatched supply into seller stock (reuses the company verifyReceipt rails,
 * owner-aware landing). Validates the seller owns the destination warehouse.
 */
/**
 * POST /api/seller/supply-orders/:id/scan-box
 * { code }
 *
 * Resolve ONE label scanned while receiving, and report what it accounts for.
 * READ-ONLY — nothing is received here.
 *
 * Three labels are understood, decided by lookup and not by the shape of the
 * code: the shipment MANIFEST (the whole consignment, as before), a SHIPMENT
 * BOX (the road carton packed for this transfer — one scan stands for every
 * unit inside it), and an existing BULK PACKAGING label (unchanged; units that
 * were already boxed by the manufacturer are received by their own label).
 *
 * `scanned` is whatever the screen has accumulated so far, so the response can
 * report live coverage: how many of the shipment's units are now accounted for.
 */
exports.scanReceiveBox = async (req, res) => {
  try {
    const order = await SupplyOrder.findOne({ _id: req.params.id, sellerId: req.user.sellerId });
    if (!order) return res.status(404).json({ success: false, message: "Supply order not found" });
    if (!order.shipmentId) return res.status(409).json({ success: false, message: "This supply has no shipment to receive yet" });

    const shipment = await Shipment.findOne({ _id: order.shipmentId, companyId: order.companyId });
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" });

    const hit = await shipmentBoxService.resolveReceiveScan(shipment, req.body?.code);
    const scanned = Array.isArray(req.body?.scanned) ? req.body.scanned : [];
    const coverage = await shipmentBoxService.coverageFor(shipment, [...scanned, hit.code]);

    res.json({ success: true, data: { ...hit, coverage } });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

exports.receiveSupply = async (req, res) => {
  try {
    const order = await SupplyOrder.findOne({ _id: req.params.id, sellerId: req.user.sellerId });
    if (!order) return res.status(404).json({ success: false, message: "Supply order not found" });
    if (!order.shipmentId) return res.status(409).json({ success: false, message: "This supply has no shipment to receive yet" });
    // Receive is SCAN-ONLY. Two ways to prove the goods are physically here,
    // and BOTH are a scan of a printed label:
    //   1. the manifest QR — the original path, untouched
    //   2. every carton on board — Shipment Box and/or Bulk Packaging labels,
    //      which together must account for all of the shipment's units
    // The coverage in (2) is recomputed here from the database; the screen's
    // running total is a convenience, never the decision.
    let qr = req.body.qr;
    if (!qr) {
      const boxCodes = Array.isArray(req.body.boxCodes) ? req.body.boxCodes : [];
      if (!boxCodes.length) {
        return res.status(400).json({ success: false, message: "Scan the manifest QR or the shipment box labels to receive this supply" });
      }
      const shipment = await Shipment.findOne({ _id: order.shipmentId, companyId: order.companyId });
      if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" });

      const coverage = await shipmentBoxService.coverageFor(shipment, boxCodes);
      if (!coverage.complete) {
        return res.status(409).json({
          success: false,
          message: `${coverage.missing} unit(s) on this shipment are not accounted for yet — scan the remaining box labels.`,
        });
      }
      // Coverage proved; hand the existing verifier the manifest it expects.
      qr = `${shipment._id}.${shipment.qrToken}`;
    }

    // The seller can only receive into warehouses they own.
    const sellerWarehouseIds = (await Warehouse.find({ sellerId: req.user.sellerId }).select("_id")).map((w) => String(w._id));

    const { shipment, shortages } = await shipmentService.verifyReceipt(order.companyId, order.shipmentId, {
      verifierId: req.user.sellerId,
      qr,
      warehouseId: order.warehouseId,
      allowedWarehouseIds: sellerWarehouseIds,
      lines: req.body.lines || [],
      performedBy: req.user.sellerId,
    });

    order.status = shortages ? "partially_received" : "received";
    await order.save();

    // The cartons have done their job.
    await shipmentBoxService.setBoxStatus(shipment._id, "received").catch(() => {});

    // A "Dispatch to Seller" transfer leaves TWO rows pointing at one shipment:
    // the seller's original request and the company-initiated transfer that
    // fulfilled it. Receiving either one settles the consignment, so move the
    // sibling to the same status rather than leaving it stuck on "dispatched".
    // (verifyReceipt already refuses a second receipt, so this cannot double-land.)
    await SupplyOrder.updateMany(
      { shipmentId: order.shipmentId, _id: { $ne: order._id }, sellerId: req.user.sellerId },
      { $set: { status: order.status } },
    ).catch(() => {});

    await notify({
      recipientType: "company", recipientId: order.companyId, type: "supply_status",
      title: shortages ? "Supply received with discrepancies" : "Supply received",
      body: `${order.sellerId ? "A seller" : "Seller"} verified receipt of supply ${order._id}${shortages ? ` with ${shortages} discrepancy(ies)` : " in full"}.`,
      payload: { supplyOrderId: order._id, shipmentId: shipment._id, kind: "supply_received" },
    }).catch(() => {});

    res.json({ success: true, message: shortages ? `Received with ${shortages} discrepancy(ies)` : "Received in full", data: { status: order.status, shortages } });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};