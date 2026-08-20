/**
 * companySellerTransferController.js — COMPANY WAREHOUSE → SELLER transfer.
 *
 * Thin HTTP layer over companySellerTransferService. Every handler resolves the
 * caller's WAREHOUSE SCOPE (services/warehouseScope) and hands it down, so a
 * warehouse-assigned operator can only see and send their own warehouse's stock;
 * an unscoped role (operations manager without assignments) is unrestricted, as
 * everywhere else in the app.
 *
 * WHO MAY CALL THIS is decided by the route guard — authorize("inventory:transfer"),
 * the same capability the warehouse→warehouse lot transfer uses. company_admin is
 * explicitly DENIED that capability (config/permissions.js ROLE_DENIED): stock is
 * moved by the warehouse that physically holds it, and the main company oversees.
 */

const transferService = require("../../services/companySellerTransferService");
const { warehouseScope } = require("../../services/warehouseScope");

const fail = (res, err) =>
  res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });

/**
 * GET /api/supply-order/transfer/options
 * The screen's pickers: source warehouses this operator may send from, and the
 * PC-authorized sellers (with their own warehouses) they may send to.
 */
exports.getTransferOptions = async (req, res) => {
  try {
    const allowedWarehouseIds = await warehouseScope(req.user);
    const data = await transferService.transferOptions(req.user.companyId, { allowedWarehouseIds });
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};

/**
 * GET /api/supply-order/transfer/products?warehouseId=...
 * The products this warehouse currently holds, with the available quantity and
 * the number of labeled units on the shelf — the "select the product" list and
 * the ceiling for the quantity field.
 */
exports.getWarehouseProducts = async (req, res) => {
  try {
    const allowedWarehouseIds = await warehouseScope(req.user);
    const data = await transferService.warehouseProducts(req.user.companyId, {
      warehouseId: req.query.warehouseId,
      allowedWarehouseIds,
    });
    res.json({ success: true, count: data.length, data });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/supply-order/transfer/scan
 * { code, fromWarehouseId, selectedCodes[] }
 * Resolve ONE scanned Lot Number / Bulk Packaging ID / Unit Code into the units
 * it adds to the transfer. Read-only — reserves nothing, moves nothing.
 */
exports.scanTransferItem = async (req, res) => {
  try {
    const allowedWarehouseIds = await warehouseScope(req.user);
    const { code, fromWarehouseId, selectedCodes, productId, requiredQty, lines } = req.body || {};
    const data = await transferService.resolveTransferScan(req.user.companyId, {
      code,
      fromWarehouseId,
      selectedCodes: Array.isArray(selectedCodes) ? selectedCodes : [],
      allowedWarehouseIds,
      // The product/quantity the form declared — the scan is capped by them.
      productId: productId || null,
      requiredQty: requiredQty ?? null,
      // MULTI-PRODUCT: every requested line, so the scan finds its own product.
      lines: Array.isArray(lines) ? lines : null,
    });
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};

/**
 * GET /api/supply-order/transfer/history?limit=20
 * Recent transfers this warehouse pushed to sellers, with live status.
 */
exports.getTransferHistory = async (req, res) => {
  try {
    const allowedWarehouseIds = await warehouseScope(req.user);
    const data = await transferService.transferHistory(req.user.companyId, {
      allowedWarehouseIds,
      limit: req.query.limit,
    });
    res.json({ success: true, count: data.length, data });
  } catch (err) { fail(res, err); }
};

/**
 * GET /api/supply-order/transfer/:id/boxes
 * The Shipment Box labels of one transfer, so they can be re-printed later.
 */
exports.getTransferBoxes = async (req, res) => {
  try {
    const allowedWarehouseIds = await warehouseScope(req.user);
    const data = await transferService.transferBoxes(req.user.companyId, req.params.id, { allowedWarehouseIds });
    res.json({ success: true, count: data.length, data });
  } catch (err) { fail(res, err); }
};

/**
 * GET /api/supply-order/transfer/:id/documents
 * The transfer's challan / bill / bilty numbers and their uploaded copies, with
 * freshly resolved URLs for View and Download.
 */
exports.getTransferDocuments = async (req, res) => {
  try {
    const allowedWarehouseIds = await warehouseScope(req.user);
    const data = await transferService.transferDocuments(req.user.companyId, req.params.id, { allowedWarehouseIds });
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};

/**
 * GET /api/supply-order/transfer/:id/prefill
 * Turn an APPROVED seller supply request into the transfer form's starting
 * values (seller, their warehouse, product, approved quantity). Read-only.
 */
exports.getTransferPrefill = async (req, res) => {
  try {
    const allowedWarehouseIds = await warehouseScope(req.user);
    const data = await transferService.transferPrefill(req.user.companyId, req.params.id, { allowedWarehouseIds });
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/supply-order/transfer
 * { sellerId, destinationWarehouseId, fromWarehouseId, productId?, quantity?, codes[],
 *   boxes?: [{ units: [serial, …] }],   ← road cartons for the loose units
 *   notes?,
 *   vehicleNo?, transporter?, driverName?, driverPhone?, lrNumber? }
 *
 * The single write: re-validates the whole scan server-side, then records,
 * reserves, packs, ships and dispatches it on the existing supply rails. On
 * success the stock has left the company warehouse and is in transit to the
 * seller, who receives it with the returned manifest code.
 */
exports.confirmTransfer = async (req, res) => {
  try {
    const allowedWarehouseIds = await warehouseScope(req.user);
    const {
      sellerId, destinationWarehouseId, fromWarehouseId, productId, quantity, notes,
      supplyOrderId,
      vehicleNo, transporter, driverName, driverPhone, lrNumber,
      challanNumber, billNumber, biltyNumber,
    } = req.body || {};

    // With document uploads the request is multipart/form-data, so arrays and
    // objects arrive as JSON strings. Parsed here, once, before anything else
    // sees them; a plain JSON request (no files) passes through untouched.
    const parseList = (v) => {
      if (Array.isArray(v)) return v;
      if (typeof v !== "string" || !v.trim()) return [];
      try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
    };
    const codes = parseList(req.body?.codes);
    const boxes = parseList(req.body?.boxes);
    // [{ productId, requiredQty }] — present when fulfilling a seller request.
    const lines = parseList(req.body?.lines);

    const data = await transferService.confirmTransfer(req.user.companyId, {
      sellerId,
      destinationWarehouseId,
      fromWarehouseId,
      productId: productId || null,
      // Multipart sends every field as a STRING, and the service's quantity
      // check uses Number.isFinite — "204" would fail it and silently skip the
      // scanned-equals-quantity guard. Coerce here so both request shapes behave
      // identically.
      quantity: quantity === undefined || quantity === null || quantity === "" ? null : Number(quantity),
      codes,
      boxes,
      lines: lines.length ? lines : null,
      supplyOrderId: supplyOrderId || null,
      notes,
      challanNumber, billNumber, biltyNumber,
      // multer (upload.fields) puts the scanned copies here.
      documentFiles: req.files || null,
      vehicleNo, transporter, driverName, driverPhone, lrNumber,
      performedBy: req.user.id,
      allowedWarehouseIds,
    });

    res.status(201).json({
      success: true,
      message: `Transfer dispatched to ${data.seller} — ${data.totalUnits} unit(s) on the way`,
      data,
    });
  } catch (err) { fail(res, err); }
};