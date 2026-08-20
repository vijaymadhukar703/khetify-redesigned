const mongoose = require("mongoose");

/**
 * SELLER REPACK BOX — a carton assembled at DISPATCH out of loose units that
 * were scanned for one SELLER warehouse → warehouse transfer.
 *
 * ── WHY THIS IS A SEPARATE COLLECTION ──
 * model/Inventory/RepackBox is the COMPANY equivalent and is deliberately left
 * untouched. Every one of its fields and every query in services/repackService
 * is hard-scoped to a company:
 *
 *     RepackBox.findOne({ company_id: companyId, repack_box_id })
 *     RepackBox.find({ company_id: companyId, shipment_id })
 *
 * `company_id` is REQUIRED there, so a seller carton would have to borrow the
 * originating company's id — which would put it inside the company's own
 * unpack / discard / contents routes. A company user could then break open a
 * seller's carton simply by knowing its ID. The brief is that company behaviour
 * stays exactly as it is, so this is a seller-only mirror that no company code
 * path can reach. The RULES are identical to RepackBox — same shape, same
 * status set, same "contents are read from the units, never stored here" — only
 * the ownership key differs.
 *
 * IT IS A LAYER, NOT A REPLACEMENT. A unit keeps `inventoryId` (its original
 * lot) and `bulk_packaging_record_id` (the original bulk packaging box it was
 * minted into) exactly as they were; repacking only sets
 * `UnitSerial.seller_repack_box_id` on top. So the receiving warehouse still
 * lands every unit in its own original lot, and the trace chain reads:
 * original lot → original box → seller box → shipment.
 *
 * The CONTENTS are never stored here — they are always read back from
 * `UnitSerial.seller_repack_box_id`, so a box and its units can never disagree.
 */
const sellerRepackBoxSchema = new mongoose.Schema(
  {
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, index: true },

    // The warehouse the units were picked at — a box may only ever draw on
    // units that are physically here.
    warehouse_id: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", default: null },

    // ONE product per carton. The scan-out list is per product and the label
    // prints a product name, so a mixed-product box could not be labelled.
    // Mixed LOTS of that product are expressly allowed.
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },

    // The ORIGINATING company of the units inside (UnitSerial.companyId).
    // Recorded for traceability only — it is NEVER used to scope a query, so a
    // company can not reach a seller carton through it.
    company_id: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },

    // "KH-<WAREHOUSE>-<PRODUCT>-SBX-<YYYYMMDD>-<SERIAL>",
    // e.g. KH-BHO-ABC711-SBX-20260811-0001. GLOBALLY unique — see the index
    // below. The "SBX" marker is deliberately different from the company
    // carton's "BX"/"RP", so a scanned ID can never be mistaken for one.
    seller_repack_box_id: { type: String, required: true, uppercase: true, trim: true },

    // The shipment this carton was packed for. Repacking is a dispatch-time
    // action, so a box always has one.
    shipment_id: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", required: true, index: true },

    /**
     * THE BOX LIFECYCLE. A carton is not a permanent fact until the goods leave.
     *
     *   draft    — assembled in the scan-out dialog, NOTHING has shipped yet.
     *              The operator is still deciding how to split the consignment,
     *              so this is a working note, not a record. A draft box may be
     *              undone, and is DELETED OUTRIGHT if the transfer is closed
     *              without dispatching.
     *   packed   — the transfer dispatched. The carton physically exists, has a
     *              printed label on it and is on a vehicle. From here it is a
     *              permanent record and is never deleted.
     *   received — landed at the destination warehouse.
     *
     * The draft state is what stops an abandoned box from holding units hostage:
     * membership only becomes binding at dispatch, which is the moment the split
     * stops being reversible in the real world.
     */
    status: { type: String, enum: ["draft", "packed", "received"], default: "draft", index: true },

    // How many units were in it when it was packed. The live count is always
    // derived from UnitSerial; this is the as-packed figure for the audit trail.
    unit_count: { type: Number, required: true, min: 1 },

    packed_by: { type: mongoose.Schema.Types.ObjectId, default: null },
    received_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

// GLOBAL uniqueness, matching RepackBox: the ID embeds the warehouse and
// product codes, so a scanned seller box ID is unambiguous system-wide.
sellerRepackBoxSchema.index({ seller_repack_box_id: 1 }, { unique: true });
sellerRepackBoxSchema.index({ seller_id: 1, shipment_id: 1 });

module.exports = mongoose.model("SellerRepackBox", sellerRepackBoxSchema);