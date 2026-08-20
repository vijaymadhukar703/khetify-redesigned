const mongoose = require("mongoose");

/**
 * One uploaded transfer document (challan / bill / bilty). Mirrors the shape the
 * seller-document flow already stores, so the same fileService helpers resolve it.
 */
const transferDocumentSchema = new mongoose.Schema(
  {
    fileKey: { type: String, required: true },   // storage key — the source of truth
    fileName: { type: String },                  // original name, shown in the UI
    mimeType: { type: String },
    size: { type: Number },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { _id: false }
);

const supplyOrderSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // WHO STARTED IT. "seller" (the default, and every existing row) is a seller
    // supply REQUEST that the company approves, picks and dispatches. "company"
    // is a warehouse-initiated PUSH transfer: the warehouse manager scans the
    // stock and sends it straight to the seller, so it is created already
    // approved/packed and goes to "dispatched" in one action. Everything
    // downstream — dispatch, the seller's scan-to-receive, the status history —
    // is the same flow for both.
    initiatedBy: { type: String, enum: ["seller", "company"], default: "seller" },

    // The seller request this company-initiated transfer fulfils, when it was
    // started from "Dispatch to Seller". It is what lets the shipment show the
    // SAME SR-… serial the Send Stock list shows, instead of a second number for
    // the same piece of work. Null for a hand-built transfer.
    sourceRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplyOrder", default: null, index: true },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    items: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        quantity: { type: Number, required: true },
        unitPrice: { type: Number },
        // Direct pick/pack progress (Send Stock picks straight against the
        // reserved allocations — no PickList/wave for supply).
        pickedQty: { type: Number, default: 0 },
        packedQty: { type: Number, default: 0 },
        // Source-lot PLAN recorded at approval, from the assigned SOURCE
        // warehouse. Approval is AUTHORIZATION ONLY — it records which lot(s)
        // will fulfil the request but does NOT touch stock. Stock becomes
        // unavailable at PICK (available → reserved, tracked per lot in
        // `reservedQty`) and is committed out at DISPATCH.
        // `serials` records the labeled units picked for this order (lot-accurate).
        allocations: [
          {
            inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory" },
            lotNumber: { type: String },
            batchNumber: { type: String },
            warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse" },
            // Planned qty from this lot (set at approval — no stock moved).
            qty: { type: Number },
            // Qty ACTUALLY reserved from this lot at pick. Drives the dispatch
            // commit and the release-on-cancel, so it can never double-deduct.
            reservedQty: { type: Number, default: 0 },
            committed: { type: Boolean, default: false },
            serials: { type: [String], default: [] },

            // ── DYNAMIC (PICK-TIME) ALLOCATION ─────────────────────────────
            // A lot does NOT have to exist when the request is approved. If the
            // company produces and ships a lot to the warehouse afterwards, the
            // warehouse can pick it straight against this request and the
            // allocation is created HERE, at pick. These two fields record that
            // it happened and who did it; an allocation planned at approval
            // simply leaves them null.
            //
            // Field mapping to the spec's names:
            //   lot_id → inventoryId   lot_number → lotNumber
            //   warehouse_id → warehouseId
            //   allocated_quantity → qty   picked_quantity → reservedQty
            // (kept as-is so Pack/Dispatch, which already read them, are
            // untouched — CLAUDE.md invariant #7.)
            allocatedAt: { type: Date, default: null },
            allocatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          },
        ],
      },
    ],
    status: {
      type: String,
      default: "requested",
      enum: [
        "requested",
        "under_review",
        "approved",
        "picking",
        "picked",
        "packing",
        "packed",
        "rejected",
        "dispatched",
        "in_transit",
        "arrived",
        "partially_received",
        "received",
        "delivered",
        "cancelled",
      ],
    },
    shipment: {
      carrier: String,
      trackingNo: String,
      dispatchedAt: Date,
      deliveredAt: Date,
    },
    // DESTINATION (the seller's warehouse the stock lands in).
    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse" },
    // SOURCE (the COMPANY warehouse the company assigns at approval to fulfil from).
    sourceWarehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", default: null },
    // The fulfilment shipment created at approval (company → seller, scan-verified receipt).
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", default: null },
    notes: { type: String },

    // TRANSFER PAPERWORK. Kept on the transfer record (not on Shipment, which is
    // shared by every movement type and must not grow flow-specific fields).
    // Free text on purpose: formats vary by state and transporter.
    challanNumber: { type: String, trim: true },
    billNumber: { type: String, trim: true },
    biltyNumber: { type: String, trim: true },

    // The scanned/photographed copy of each document, stored through
    // services/fileService (local disk or S3, per STORAGE_DRIVER) exactly like
    // seller KYC documents. Only the KEY is persisted — a reachable URL is
    // resolved at READ time via fileService.signedUrl, so a private bucket keeps
    // working and no stale public link is ever baked into the database.
    challanDocument: { type: transferDocumentSchema, default: null },
    billDocument: { type: transferDocumentSchema, default: null },
    biltyDocument: { type: transferDocumentSchema, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SupplyOrder", supplyOrderSchema);