/**
 * three-level-lot-number-audit.js — WHICH LOTS CARRY A NUMBER THE OLD SPAN BUG
 * PRODUCED. Reports only. It opens the database read-only, writes nothing, and
 * has no --fix: these numbers are printed on physical cartons and are the row's
 * identity, so they are never rewritten.
 *
 * A lot is AFFECTED when it was built from segments and the number stored on it
 * differs from the one today's rule would produce from those same segments —
 * which, for a three-level lot, is the Bulk Packaging range spanning the inner
 * boxes instead of the cartons, and the Inner Box part missing entirely:
 *
 *   stored    BHO-PRO-BP001~BP004-BAT-2026-08-01-SKU001~SKU020
 *   today     BHO-PRO-BP001~BP002-INNER001~INNER002-BAT-2026-08-01-SKU001~SKU020
 *
 * Run:  node scripts/reports/three-level-lot-number-audit.js
 *       node scripts/reports/three-level-lot-number-audit.js --json
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Inventory = require("../../model/Inventory/Inventory");
const { buildLotNumber, normalizeSegments, packagingSpans, serialOf } = require("../../services/lotNumberSegmentService");

const asJson = process.argv.includes("--json");

/** The number today's code would mint for this row, or null if it cannot say. */
function expectedNumber(lot) {
  const segments = normalizeSegments(lot.lot_number_segments);
  if (!segments) return null;   // no recipe stored — never assembled from parts

  const body = buildLotNumber(segments, packagingSpans({
    qty: lot.originalQuantity || lot.number_of_boxes * lot.units_per_box || 0,
    numberOfBoxes: lot.number_of_boxes || 0,
    mainBoxes: lot.packaging_main_boxes || 0,
    boxesPerMain: lot.packaging_boxes_per_main || 0,
  }));
  if (!body) return null;

  // A generated number is closed by its serial; a hand-composed one is not.
  const serial = serialOf(lot);
  return serial ? `${body}-${serial}` : body;
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set");
  await mongoose.connect(uri);

  // Only lots that were assembled from segments can be affected — every other
  // lot number (GRN, scanner-captured, legacy) was never built by this rule.
  const lots = await Inventory.find({ lot_number_segments: { $exists: true, $ne: [] } })
    .select([
      "lotNumber batchNumber ownerId ownerType warehouseId productId createdAt",
      "originalQuantity number_of_boxes units_per_box",
      "packaging_main_boxes packaging_boxes_per_main",
      "lot_number_segments lot_number_serial",
    ].join(" "))
    .lean();

  const affected = [];
  for (const lot of lots) {
    const expected = expectedNumber(lot);
    if (!expected || expected === lot.lotNumber) continue;
    affected.push({
      _id: String(lot._id),
      lotNumber: lot.lotNumber,
      wouldNowBe: expected,
      companyId: String(lot.ownerId),
      mainBoxes: lot.packaging_main_boxes || null,
      boxesPerMain: lot.packaging_boxes_per_main || null,
      innerBoxes: lot.number_of_boxes || null,
      unitsPerBox: lot.units_per_box || null,
      qty: lot.originalQuantity || null,
      createdAt: lot.createdAt,
    });
  }
  affected.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (asJson) {
    console.log(JSON.stringify({ scanned: lots.length, affected }, null, 2));
  } else {
    const threeLevel = lots.filter((l) => l.packaging_main_boxes > 0 && l.packaging_boxes_per_main > 0);
    console.log(`Segment-built lots scanned : ${lots.length}`);
    console.log(`  …of which three-level     : ${threeLevel.length}`);
    console.log(`AFFECTED (number differs)  : ${affected.length}\n`);
    for (const a of affected) {
      console.log(`  ${a.lotNumber}`);
      console.log(`    would now be : ${a.wouldNowBe}`);
      console.log(`    packaging    : ${a.mainBoxes ?? "—"} main × ${a.boxesPerMain ?? "—"} inner × ${a.unitsPerBox ?? "—"} units (qty ${a.qty ?? "—"})`);
      console.log(`    _id          : ${a._id}   created ${a.createdAt ? new Date(a.createdAt).toISOString().slice(0, 10) : "—"}\n`);
    }
    if (!affected.length) console.log("  none\n");
    console.log("Nothing was changed — these numbers are printed on the cartons and stay as they are.");
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
