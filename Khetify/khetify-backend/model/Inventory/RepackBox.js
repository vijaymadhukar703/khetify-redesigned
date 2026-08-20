const mongoose = require("mongoose");

/**
 * REPACK BOX — a carton assembled at DISPATCH out of loose units that were
 * scanned for one shipment.
 *
 * Deliberately NOT a BulkPackage row. A BulkPackage belongs to exactly one lot
 * (`lot_id` is required, and its unique index is keyed on the lot), whereas the
 * whole point of a repack carton is that the units inside it may come from
 * SEVERAL lots — which is only safe because a repack label never prints an
 * expiry date. Forcing this into BulkPackage would mean either lying about the
 * lot or dropping that constraint for every existing box.
 *
 * IT IS A LAYER, NOT A REPLACEMENT. A unit keeps `inventoryId` (its original
 * lot) and `bulk_packaging_record_id` (the original box it was minted into)
 * exactly as they were; repacking only sets `repack_box_id` on top. So the
 * receiving warehouse still lands every unit in its own original lot, and the
 * trace chain reads: original lot → original box → repack box → shipment.
 *
 * The CONTENTS are never stored here — they are always read back from
 * `UnitSerial.repack_box_id`, so a box and its units can never disagree.
 */
const repackBoxSchema = new mongoose.Schema(
  {
    company_id: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    // The warehouse the units were picked at — a repack may only ever draw on
    // units that are physically here.
    warehouse_id: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", default: null },
    // ONE product per carton. The scan-out list is per product and the label
    // prints a product name, so a mixed-product box could not be labelled.
    // Mixed LOTS of that product are expressly allowed.
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },

    // "KH-<COMPANY>-RP-<YYYYMMDD>-<SERIAL>", e.g. KH-BHO-RP-20260801-0001.
    // GLOBALLY unique — see the index below.
    repack_box_id: { type: String, required: true, uppercase: true, trim: true },

    // The shipment this carton was packed for. Repacking is a dispatch-time
    // action, so a box always has one.
    shipment_id: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", required: true, index: true },

    //   packed   — assembled, units linked to it
    //   unpacked — broken back into loose units; kept as an audit record, and
    //              its ID is never reissued
    status: { type: String, enum: ["packed", "unpacked"], default: "packed", index: true },

    // How many units were in it when it was packed. The live count is always
    // derived from UnitSerial; this is the as-packed figure for the audit trail.
    unit_count: { type: Number, required: true, min: 1 },

    packed_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    unpacked_at: { type: Date, default: null },
    unpacked_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

// GLOBAL uniqueness, matching BulkPackage: the ID embeds the company code, so a
// scanned repack ID is unambiguous system-wide.
repackBoxSchema.index({ repack_box_id: 1 }, { unique: true });

module.exports = mongoose.model("RepackBox", repackBoxSchema);
