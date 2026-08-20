/**
 * backfillBoxUnitLabels.js — one-off repair for BOXED lots whose unit labels
 * were never fully minted.
 *
 * Why: unit labels used to appear only when an operator pressed Generate, for
 * whatever quantity they typed. Generation fills a lot's boxes IN ORDER, so a
 * lot of 4 × 250 generated at 250 ended up with box 1 fully labelled and boxes
 * 2-4 with none — Lot Details then showed "No unit labels generated for this box
 * yet" on a box that was received and holds 250 units. New lots now mint every
 * box's labels at creation (lotService.receiveLot); this repairs the ones
 * already in the database.
 *
 * What it does: for every company-owned lot with bulk packaging, asks
 * barcodeService.ensureLotUnitLabels for the SHORTFALL against the lot's created
 * quantity. That is the same call the create path makes, so a lot repaired here
 * is identical to one created today.
 *
 * Safety:
 *   • ADDS labels only. No existing serial, status, print flag, box or stock
 *     figure is read-modified-written — nothing already minted is touched.
 *   • Never exceeds the lot's created quantity (the cap generateUnits enforces),
 *     so a fully-labelled lot is skipped and a partly-labelled one is topped up
 *     into exactly the boxes that lack labels.
 *   • Numbering continues across the lot rather than restarting per box, so the
 *     range the lot number declares (…-SKU0001~SKU1000-…) stays true.
 *   • Idempotent: re-running it is a no-op once every lot is complete.
 *   • One lot's failure is reported and the run continues.
 *
 * Run from the backend folder (needs .env with MONGO_URI):
 *   node scripts/backfillBoxUnitLabels.js            # apply
 *   node scripts/backfillBoxUnitLabels.js --dry-run  # report only, write nothing
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Inventory = require("../model/Inventory/Inventory");
const UnitSerial = require("../model/Barcode/UnitSerial");
const barcodeService = require("../services/barcodeService");

const DRY_RUN = process.argv.includes("--dry-run");

/** The quantity a lot may label — its created quantity, never live stock. */
const capOf = (inv) =>
  typeof inv.originalQuantity === "number"
    ? inv.originalQuantity
    : Number(inv.availableStock || 0) + Number(inv.inTransitStock || 0);

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const lots = await Inventory.find({
      ownerType: "company",
      has_bulk_packaging: true,
    }).select("_id ownerId lotNumber batchNumber originalQuantity availableStock inTransitStock number_of_boxes units_per_box");

    console.log(`🔎 ${lots.length} boxed lot(s) to check.`);
    if (DRY_RUN) console.log("🧪 DRY RUN — no writes will be made.");

    let repaired = 0;
    let added = 0;
    let failed = 0;

    for (const inv of lots) {
      const lotNo = inv.lotNumber || inv.batchNumber || String(inv._id);
      const cap = capOf(inv);
      const existing = await UnitSerial.countDocuments({ companyId: inv.ownerId, inventoryId: inv._id });
      const missing = cap - existing;
      if (missing <= 0) continue;

      console.log(`   ${lotNo}: ${existing} of ${cap} labelled — ${missing} missing.`);
      if (DRY_RUN) { repaired += 1; added += missing; continue; }

      try {
        const r = await barcodeService.ensureLotUnitLabels(inv.ownerId, inv._id, {});
        repaired += 1;
        added += r.generated || 0;
        console.log(`   ↳ minted ${r.generated || 0} (${r.firstSerial || "—"} … ${r.lastSerial || "—"})`);
      } catch (err) {
        failed += 1;
        console.error(`   ↳ FAILED: ${err.message}`);
      }
    }

    console.log(
      DRY_RUN
        ? `🧪 Would repair ${repaired} lot(s), minting ${added} label(s).`
        : `✅ Repaired ${repaired} lot(s), minted ${added} label(s). ${failed} failure(s). Nothing existing was modified.`
    );
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ backfillBoxUnitLabels failed:", err.message);
    process.exit(1);
  });
