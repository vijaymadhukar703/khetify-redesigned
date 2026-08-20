const mongoose = require("mongoose");

/**
 * BULK PACKAGE — one document per PHYSICAL OUTER BOX of a lot.
 *
 * Three distinct identities exist in this system; do not conflate them:
 *   Lot Number        — the complete lot's identity (Inventory.lotNumber)
 *   Bulk Packaging ID — ONE physical outer box of that lot (this collection)
 *   Unit barcode      — ONE sellable unit inside a box (model/Barcode/UnitSerial)
 *
 * A box carries its own receiving state and scan history, which is exactly why
 * this is a separate collection rather than an array on the Inventory row: the
 * warehouse scans boxes one at a time and each scan must be an independent,
 * atomic, once-only state transition.
 *
 * Field names are snake_case here to match the Bulk Packaging feature spec
 * (has_bulk_packaging / number_of_boxes / units_per_box on Inventory).
 */
const bulkPackageSchema = new mongoose.Schema(
  {
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    // The Inventory row this box belongs to (the lot).
    lot_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      required: true,
      index: true,
    },
    // Denormalised so a scan can resolve the box without a join, and so the
    // label prints the parent lot even if the Inventory row moves.
    lot_number: { type: String, required: true },

    // "<LOT NUMBER>-BP-<SERIAL>", e.g. KH-BHO-PRE482-2026-07-0001-BP-001.
    // GLOBALLY unique — see the index below.
    // (The unique index is declared once via schema.index() below — declaring it
    // here too makes mongoose warn about a duplicate index definition.)
    bulk_packaging_id: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },

    // 1-based position of this box within the lot ("Box 3 of 4").
    box_serial: { type: Number, required: true, min: 1 },

    // ── PACKAGING LEVEL ───────────────────────────────────────────────────
    // 'main'  — an outer bulk packaging box; parent_box_id is null.
    // 'inner' — a box INSIDE a main box; parent_box_id points at it.
    //
    // A two-level lot (no "Inside bulk packaging") creates a single flat list of
    // 'main' rows with no children, which is what every pre-existing row is —
    // hence the default, so untouched documents read correctly.
    box_level: { type: String, enum: ["main", "inner"], default: "main", index: true },
    parent_box_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BulkPackage",
      default: null,
      index: true,
    },

    // How many base units this box holds. The ONLY quantity a single scan may
    // move onto the books.
    units_in_box: { type: Number, required: true, min: 1 },

    //   created   — minted with the lot, not yet received anywhere
    //   received  — scanned and booked into its destination warehouse
    //   cancelled — voided; may never be received
    status: {
      type: String,
      enum: ["created", "received", "cancelled"],
      default: "created",
      index: true,
    },

    // Where the box physically sits (a bin/location inside the warehouse).
    // Optional — set when the warehouse uses locations.
    current_location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      default: null,
    },

    // The destination warehouse this box is booked to. A box may ONLY be
    // received at this warehouse.
    warehouse_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      default: null,
    },

    received_at: { type: Date, default: null },
    received_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  // The spec asks for created_at / updated_at, so name the timestamps that way
  // rather than the mongoose defaults.
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

// GLOBAL uniqueness of the Bulk Packaging ID (not company-scoped): the ID
// already embeds the lot number, which embeds the company code, so a global
// index costs nothing and makes a scanned ID unambiguous system-wide.
bulkPackageSchema.index({ bulk_packaging_id: 1 }, { unique: true });

/**
 * A box is numbered once WITHIN ITS PLACE IN THE HIERARCHY.
 *
 * The level and the parent both belong in the key. `{ lot_id, box_serial }` — what
 * this was before three-level packaging — rejected a legitimate insert: serial 1
 * now occurs twice in a lot, once as main box 1 and once as an inner box, and the
 * old index read that as a duplicate (E11000 on lot_id_1_box_serial_1).
 *
 * With parent_box_id null on a main box, this reads as: main box serials are
 * unique inside the lot, and inner box serials are unique inside the main box
 * that holds them — which is the rule that actually describes the cartons, and it
 * holds whether inner numbering restarts at 1 under each parent or runs 1..N
 * across the lot.
 *
 * Changing a unique index needs the old one dropped on databases that already
 * have it: scripts/migrations/006-box-level-parent.js.
 */
bulkPackageSchema.index(
  { lot_id: 1, box_level: 1, parent_box_id: 1, box_serial: 1 },
  { unique: true }
);

module.exports = mongoose.model("BulkPackage", bulkPackageSchema);
