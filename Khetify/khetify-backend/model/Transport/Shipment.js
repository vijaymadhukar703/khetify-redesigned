const mongoose = require("mongoose");

/**
 * A physical movement of goods — a sales dispatch, a supply-order delivery, or
 * an inter-warehouse transfer. Sprint 5 additions are additive; the legacy
 * fields (fromLabel/toLabel/vehicleNo/driverName/...) keep working.
 *
 * Lifecycle: draft → planned → loading → dispatched → in_transit → arrived →
 *            verifying → delivered  (exception / cancelled as side states)
 */
const shipmentLineSchema = new mongoose.Schema(
  {
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: "Package" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory" }, // transfer source row
    lotNumber: { type: String },
    batchNumber: { type: String },
    qty: { type: Number },
    // Send-Stock pick progress (transfer shipments): scan units/lots until
    // pickedQty reaches qty. Additive — company shipments never enter the
    // pick/pack states, so this stays 0 / [] for them.
    pickedQty: { type: Number, default: 0 },
    serials: { type: [String], default: [] },
    receivedQty: { type: Number, default: null },
    // NOTE: transfers are planned by product + quantity and identified by
    // SCANNING AT DISPATCH (dispatchScanService), so a line carries no
    // plan-time scan record. Shipments raised while the New Shipment form
    // scanned may still hold a `lines[].scans` array in the database; it is
    // read by nothing and is left in place deliberately — see the strict-mode
    // note below.
  },
  // strict:false so a document written with the retired `lines[].scans` array
  // still loads (and re-saves) intact instead of having the field silently
  // stripped on the next write.
  { _id: false, strict: false }
);

const statusEventSchema = new mongoose.Schema(
  { status: String, at: { type: Date, default: Date.now }, byUserId: mongoose.Schema.Types.ObjectId, warehouseId: mongoose.Schema.Types.ObjectId, lat: Number, lng: Number, note: String },
  { _id: false }
);

const shipmentSchema = new mongoose.Schema(
  {
    // Owner-polymorphic. A company shipment keeps companyId set (and ownerType
    // "company"); a SELLER inter-warehouse shipment sets ownerType "seller" +
    // ownerId = sellerId and leaves companyId unset. companyId is no longer
    // required so a seller→seller transfer (no company involved) can ride the
    // same shipment lifecycle. Legacy/company rows are unchanged.
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: false },
    ownerType: { type: String, enum: ["company", "seller"], default: "company" },
    ownerId: { type: mongoose.Schema.Types.ObjectId },

    // "TransferRequest" → shipment auto-created when a stock request is accepted
    refType: { type: String, enum: ["Order", "SupplyOrder", "Transfer", "TransferRequest", "Manual"], default: "Manual" },
    refId: { type: mongoose.Schema.Types.ObjectId, default: null },

    fromWarehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", default: null },
    fromLabel: { type: String },
    toType: { type: String, enum: ["customer", "warehouse", "vendor", "seller"], default: "customer" },
    toWarehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", default: null },
    // Cross-owner destination: which principal the received stock lands under.
    // Defaults to the shipment's own company; set to the seller for supply
    // shipments so verifyReceipt lands stock into the seller's inventory.
    toOwnerType: { type: String, enum: ["company", "seller"], default: "company" },
    toOwnerId: { type: mongoose.Schema.Types.ObjectId, default: null }, // falls back to companyId
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
    toLabel: { type: String, required: true },

    lines: { type: [shipmentLineSchema], default: [] },

    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", default: null },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // legacy free-text (kept)
    vehicleNo: { type: String },
    driverName: { type: String },
    driverPhone: { type: String },
    transporter: { type: String },
    ewayBillNo: { type: String },
    lrNumber: { type: String },
    freightCost: { type: Number },

    // Optional despatch paperwork captured at Confirm Dispatch. All free-text
    // and additive — no existing field carries these today.
    bulkPackingNumber: { type: String },
    deliveryChallanNumber: { type: String },
    invoiceChallanNumber: { type: String },
    gatePassNumber: { type: String },

    // THE SCANNED DELIVERY CHALLAN itself, captured when a warehouse raises the
    // shipment. Stored as the storage KEY (services/fileService), never as a
    // guessed public URL — the reachable link is resolved at read time, which is
    // what keeps a private S3 bucket working. `name`/`mime`/`size` are kept for
    // display and are the values multer reported for the uploaded file.
    challanDocument: {
      key: { type: String },
      name: { type: String },
      mime: { type: String },
      size: { type: Number },
    },

    /**
     * BILTY and BILL — the two other despatch papers the Transfers table shows
     * beside the challan. Named exactly as the SupplyOrder already names them
     * (`biltyNumber` / `billNumber`), so the value means the same thing on both
     * records and the mirror between them is a straight copy.
     *
     * Deliberately the SAME shape as `challanDocument` above: only the storage
     * KEY is persisted and the reachable link is re-resolved on every read, so
     * these reuse the existing upload and viewing path rather than growing a
     * second one. Both additive and optional — every existing shipment keeps
     * them unset and is completely unaffected.
     *
     * For a COMPANY → SELLER transfer these are mirrored across from the
     * SupplyOrder, which already collects a bill and a bilty at dispatch. A
     * warehouse → warehouse transfer has no capture for them yet, so its cells
     * read as empty.
     */
    biltyNumber: { type: String },
    biltyDocument: {
      key: { type: String },
      name: { type: String },
      mime: { type: String },
      size: { type: Number },
    },
    billNumber: { type: String },
    billDocument: {
      key: { type: String },
      name: { type: String },
      mime: { type: String },
      size: { type: Number },
    },

    plannedRoute: [{ stopType: String, refId: mongoose.Schema.Types.ObjectId, eta: Date }],

    status: {
      type: String,
      // "pending" → before dispatch · "in_transit" → goods on the road ·
      // "partially_received" / "received" → transfer receipt verification
      // outcomes (Sprint 6). "picking"/"picked"/"packed" → Send-Stock pick→pack
      // pipeline for transfer shipments (additive). Legacy statuses untouched.
      enum: ["draft", "planned", "picking", "picked", "packed", "approved", "loading", "pending", "dispatched", "in_transit", "arrived", "verifying", "partially_received", "received", "delivered", "exception", "cancelled"],
      default: "draft",
    },
    statusHistory: { type: [statusEventSchema], default: [] },

    qrToken: { type: String }, // HMAC printed on the manifest QR

    pod: {
      signedBy: String,
      signatureImageUrl: String,
      photoUrls: { type: [String], default: [] },
      receivedSerialsCount: Number,
      shortages: [{ productId: mongoose.Schema.Types.ObjectId, qty: Number, serials: [String] }],
      verifiedBy: mongoose.Schema.Types.ObjectId,
      verifiedAt: Date,
      // warehouse at which the receipt was verified (transfer POD)
      warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse" },
      // "scan" = manifest barcode scan + warehouse validation (transfer receipt POD)
      method: { type: String, enum: ["scan", "geo_scan"] },
    },

    dispatchedAt: { type: Date },
    deliveredAt: { type: Date },
    notes: { type: String },
  },
  { timestamps: true }
);

shipmentSchema.index({ companyId: 1, status: 1, createdAt: -1 });
shipmentSchema.index({ companyId: 1, driverId: 1, status: 1 });
shipmentSchema.index({ ownerType: 1, ownerId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Shipment", shipmentSchema);