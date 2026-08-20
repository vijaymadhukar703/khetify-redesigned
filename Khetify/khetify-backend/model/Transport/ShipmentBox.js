const mongoose = require("mongoose");

/**
 * SHIPMENT BOX — one physical carton packed for ONE transfer, holding units that
 * were scanned INDIVIDUALLY (i.e. units that are not already inside a Bulk
 * Package).
 *
 * THIS IS NOT BULK PACKAGING. Read this before touching either.
 *
 *   Bulk Packaging ID (model/Inventory/BulkPackage)
 *     — a permanent property of the LOT. The manufacturer packed the lot into
 *       these boxes; the identity survives every move, and a unit inside one
 *       keeps its bulk_packaging_id forever. Units that already live in a Bulk
 *       Package are NEVER put into a Shipment Box: their existing Bulk Package
 *       Label continues to be the thing that gets scanned.
 *
 *   Shipment Box ID (this collection)
 *     — a property of ONE TRANSFER, not of the stock. It exists so a warehouse
 *       manager can bundle loose units into cartons for the road, and so the
 *       receiving seller scans one label instead of every unit. It carries no
 *       stock semantics: nothing about availability, ownership or lot identity
 *       is decided here. When the shipment is received, the box has done its job.
 *
 * Identities in play, none of which this file replaces:
 *   Lot Number        → the lot
 *   Bulk Packaging ID → one manufacturer box of that lot
 *   Unit code         → one sellable unit
 *   Shipment Box ID   → one road carton of loose units, for this transfer only
 */
const shipmentBoxUnitSchema = new mongoose.Schema(
  {
    // The unit's canonical serial (UnitSerial.serial) — the key everything else
    // in the system resolves a unit by.
    serial: { type: String, required: true, uppercase: true, trim: true },
    // The human/scannable code printed on the unit label, when it differs.
    unitCode: { type: String, default: null },

    // Denormalised so a receive scan can show WHAT is in the box without
    // touching Inventory or Product, and so the record stays readable after the
    // stock has moved on.
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, default: null },
    inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory", required: true },
    lotNumber: { type: String, default: null },
  },
  { _id: false }
);

const shipmentBoxSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },

    // The transfer this carton was packed for. A Shipment Box only ever belongs
    // to one shipment — it is not reusable stock packaging.
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", required: true, index: true },
    supplyOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplyOrder", default: null, index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", default: null },

    sourceWarehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", default: null },
    destinationWarehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", default: null },

    // "SB-<8 of shipment id>-<3-digit box number>", e.g. SB-6A3F91C2-001.
    // Globally unique — see the index below.
    shipmentBoxId: { type: String, required: true, uppercase: true, trim: true },

    // 1-based position within this shipment ("Box 2 of 3").
    boxNumber: { type: Number, required: true, min: 1 },
    totalBoxes: { type: Number, required: true, min: 1 },

    // EVERY unit inside. This is the link that makes one scan stand for many
    // units at receiving, and the traceability chain
    //   Shipment Box → Unit → Lot → Product → Transfer.
    units: { type: [shipmentBoxUnitSchema], default: [] },
    totalUnits: { type: Number, required: true, min: 1 },

    // packed    — created, shipment not yet dispatched
    // dispatched— on the road
    // received  — the seller scanned it (or the manifest) and the stock landed
    status: { type: String, enum: ["packed", "dispatched", "received"], default: "packed" },

    // Signs the label, exactly like the shipment manifest: the printed payload
    // is `${shipmentBoxId}.${qrToken}`, so a forged or mistyped code cannot
    // stand in for a real carton.
    qrToken: { type: String, required: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    receivedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

shipmentBoxSchema.index({ shipmentBoxId: 1 }, { unique: true });
shipmentBoxSchema.index({ shipmentId: 1, boxNumber: 1 });
shipmentBoxSchema.index({ companyId: 1, createdAt: -1 });

module.exports = mongoose.models.ShipmentBox || mongoose.model("ShipmentBox", shipmentBoxSchema);