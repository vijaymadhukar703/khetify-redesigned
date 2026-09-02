const mongoose = require("mongoose");

/**
 * HSN → GST RATE MASTER.
 *
 * Source: Notification No. 9/2025-Integrated Tax (Rate) dated 17-09-2025.
 * Every rate is copied verbatim from that notification; nothing is inferred.
 *
 * ── WHY hsnCode IS NOT UNIQUE ON ITS OWN ──
 * The notification is NOT an HSN→rate table. It is seven SCHEDULES (5%, 18%,
 * 40%, 3%, 0.25%, 1.50%, 28%) and the rate is decided by the DESCRIPTION of the
 * goods, not by the code alone. The same code therefore appears in more than one
 * schedule at different rates — 102 codes do, including ones that matter here:
 *
 *   3105 → 5%  "…other than those which are clearly not to be used as fertilizers"
 *   3105 → 18% "…which are clearly not to be used as fertilizers"
 *   2401 → 5%  "Tobacco leave"        2401 → 28% "Unmanufactured tobacco…"
 *   2710 → 5%  "Kerosene oil PDS…"    2710 → 18% "Petroleum oils…"
 *
 * A unique index on `hsnCode` would force one of those to be thrown away, and a
 * fertiliser would silently get the wrong GST. So the collection deliberately
 * holds ONE ROW PER (code, rate, description) and the lookup reports every
 * applicable rate when there is more than one.
 *
 * UNIQUENESS is on the combination instead, which is what actually has to be
 * unique: the same rate for the same code under the same description is one
 * fact, and re-running the seed must not duplicate it.
 */
const hsnGstRateSchema = new mongoose.Schema(
  {
    // 2, 4, 6 or 8 digits, exactly as printed in column (2). Stored as a STRING
    // so leading zeros survive — 0804 is not 804.
    hsnCode: { type: String, required: true, trim: true, index: true },

    // The schedule's rate as a percentage: 5, 18, 40, 3, 0.25, 1.5 or 28.
    gstRate: { type: Number, required: true },

    // Column (3) of the notification — the CONDITION that makes this rate apply.
    // This is what the operator reads when a code carries more than one rate,
    // so it is stored in full rather than truncated.
    description: { type: String, required: true },

    // Column (2) verbatim, e.g. "0910 [other than 0910 11 10, 0910 30 10]".
    // Kept because the exclusions in brackets are part of the legal text and are
    // deliberately NOT encoded as data — a human decides those.
    appliesTo: { type: String },

    // Roman numeral of the schedule the row came from (I…VII).
    schedule: { type: String },

    // Provenance, so a later notification can be told apart from this one.
    source: { type: String, default: "Notification No. 9/2025-Integrated Tax (Rate) dated 17-09-2025" },
  },
  { timestamps: true }
);

/**
 * The real uniqueness key. Re-running the seeder upserts on exactly this, so it
 * is idempotent: no duplicates, and a corrected description updates in place.
 */
hsnGstRateSchema.index({ hsnCode: 1, gstRate: 1, description: 1 }, { unique: true });

module.exports = mongoose.model("HsnGstRate", hsnGstRateSchema);