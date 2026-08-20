const mongoose = require("mongoose");

/**
 * One document per physical product unit, identified by a unique system
 * barcode `serial` (format K-U-<LOTNUMBER>-<seq>; see services/barcodeService.js
 * and BARCODES.md). This is the traceability backbone — it ties a scanned unit
 * to its lot, its current location/shipment, and ultimately the order/customer
 * it was sold to, enabling unit-level recall.
 *
 * Per-unit movement history is NOT embedded — it lives in UnitEvent so this
 * document stays small and writes stay cheap at scale.
 */
const UNIT_STATUSES = [
  "generated", // serial created, label not yet printed
  "printed",
  "in_stock", // put away into a bin
  "picked",
  "packed",
  "shipped",
  "sold", // delivered to / bought by a customer
  "returned",
  "damaged",
  "recalled",
];

const unitSerialSchema = new mongoose.Schema(
  {
    // ORIGINATING / manufacturing company — immutable traceability root. Stays
    // set even after a unit is supplied to a seller, so recall + full-chain
    // trace by the originating company always reach the unit.
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },

    // CURRENT owner of the physical unit. A unit moves company → seller (Phase
    // 4b) without changing its serial. Existing rows are backfilled to
    // ownerType "company", ownerId = companyId (scripts/backfillUnitOwner.js).
    ownerType: { type: String, enum: ["company", "seller"], default: "company" },
    ownerId: { type: mongoose.Schema.Types.ObjectId },

    serial: { type: String, required: true, unique: true },
    qr: { type: String }, // JSON payload string: {"t":"unit","s":<serial>}

    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory", required: true },
    lotNumber: { type: String },
    batchNumber: { type: String },

    // ── BULK PACKAGING PARENT ─────────────────────────────────────────────
    // Hierarchy: Lot → Bulk Packaging Box → Unit. When the lot is packed into
    // boxes these three identify WHICH box this unit sits in, and the unit code
    // is built from the box ID (<BULK_PACKAGING_ID>-<UNIT_SERIAL>) rather than
    // from the lot number.
    //
    // NULL for a single-package lot (Lot → Unit) and for every unit generated
    // before Bulk Packaging existed — those keep their lot-based code untouched.
    // A unit belongs to at most ONE box: these are scalars, set once at mint.
    bulk_packaging_record_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BulkPackage",
      default: null,
    },
    bulk_packaging_id: { type: String, default: null },
    box_serial: { type: Number, default: null },

    // Running number of this unit WITHIN its parent (per box when boxed,
    // per lot otherwise). Restarts at 1 in every box.
    unit_serial: { type: Number, default: null },

    // ── REPACK CARTON (a LAYER over the three fields above) ───────────────
    // Set when loose units are packed into a new carton at dispatch
    // (model/Inventory/RepackBox). Deliberately a SEPARATE field: inventoryId,
    // bulk_packaging_record_id and bulk_packaging_id are left exactly as minted,
    // so the unit's original lot and original box survive the repack and the
    // receiving warehouse still books it into its own lot.
    // Null for every unit that has never been repacked.
    repack_box_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RepackBox",
      default: null,
    },

    // ── SELLER TRANSFER BOX (the seller mirror of repack_box_id) ──────────
    // Set when a SELLER warehouse packs loose scanned units into a carton for a
    // warehouse → warehouse transfer (model/Seller/SellerRepackBox). A separate
    // field for the same reason the collection is separate: the company carton
    // and the seller carton are owned by different principals and must never be
    // resolvable through one another. Additive and nullable — every existing
    // row, and every company unit, keeps this null and is completely unaffected.
    seller_repack_box_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SellerRepackBox",
      default: null,
    },

    // The printed/scanned code. Mirrors `serial`, which stays the canonical
    // field every existing flow (resolveScan, pick, pack, ship, recall) reads —
    // renaming it would break them. `unit_code` is the spec's name for the same
    // value and carries its own unique index; it is sparse because rows minted
    // before this field existed don't have it.
    unit_code: { type: String, default: null },

    status: { type: String, enum: UNIT_STATUSES, default: "generated" },

    // LABEL print-state — INDEPENDENT of the stock `status` above. A unit can be
    // available in a warehouse (status "in_stock") yet still have an unprinted
    // label (printed:false). Set ONLY by markPrinted(), so generating serials
    // never marks them printed. The Labels page filters "Unprinted only" on this
    // flag, not on status. Defaults false (existing rows backfilled from their
    // print history — scripts/backfillUnitPrinted.js).
    printed: { type: Boolean, default: false },
    printedAt: { type: Date, default: null },

    currentLocationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },
    currentShipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", default: null },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
  },
  { timestamps: true }
);

// serial already unique via field option; add query indexes.
// unit_code carries its own unique index (sparse — pre-existing rows have none).
unitSerialSchema.index({ unit_code: 1 }, { unique: true, sparse: true });
// All the units inside one box, in print order.
unitSerialSchema.index({ bulk_packaging_record_id: 1, unit_serial: 1 });
// All the units inside one repack carton — the contents view reads this.
unitSerialSchema.index({ repack_box_id: 1 });
// All the units inside one SELLER transfer carton — same lookup, seller side.
unitSerialSchema.index({ seller_repack_box_id: 1 });
unitSerialSchema.index({ companyId: 1, productId: 1, status: 1 });
unitSerialSchema.index({ companyId: 1, lotNumber: 1 });
unitSerialSchema.index({ companyId: 1, inventoryId: 1 });
// Owner-scoped lookups (current holder: company or seller).
unitSerialSchema.index({ ownerType: 1, ownerId: 1, status: 1 });
unitSerialSchema.index({ ownerType: 1, ownerId: 1, lotNumber: 1 });

module.exports = mongoose.model("UnitSerial", unitSerialSchema);
module.exports.UNIT_STATUSES = UNIT_STATUSES;