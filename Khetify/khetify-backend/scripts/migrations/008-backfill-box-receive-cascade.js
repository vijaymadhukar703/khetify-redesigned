/**
 * 008-backfill-box-receive-cascade.js
 *
 * REPAIRS LOTS RECEIVED BY SCANNING A BULK PACKAGING (MAIN) ID BEFORE THE
 * CASCADE EXISTED.
 *
 * THE BUG (fixed in services/bulkPackageService.receiveBox). Scanning a main
 * carton claimed only that row. The inner boxes nailed inside it stayed
 * "created", and every derived figure is counted over the INNER boxes:
 *
 *   Boxes Received 0 / Boxes Pending 8      (summaryForLot)
 *   Units Received 0 / Units Pending 40
 *   Receiving Status: PARTIALLY RECEIVED    (pendingBoxCount never hit zero)
 *
 * …on a lot whose 40 units were all on the shelf. receiveBox now cascades both
 * ways, so no NEW receive can leave this behind. Rows already written keep the
 * wrong state until this runs.
 *
 * WHAT IT REPAIRS, and nothing else:
 *   A) inner boxes whose PARENT is received but which are still "created"
 *      → received, stamped with the parent's own received_at / received_by
 *   B) main cartons still "created" whose every inner box is received
 *      → received, stamped from the latest inner box (the upward cascade)
 *   C) each repaired lot's Inventory.receiving_status, recomputed from the
 *      inner boxes exactly as receiveBox does
 *
 * A cancelled box is never touched. NO STOCK MOVES: the quantities were already
 * booked when the carton was scanned — only the box rows disagreed with them —
 * so this writes no ledger row and changes no Inventory quantity.
 *
 * DRY RUN BY DEFAULT — it reports the affected lots and changes nothing.
 *   node scripts/migrations/008-backfill-box-receive-cascade.js
 *   node scripts/migrations/008-backfill-box-receive-cascade.js --apply
 *   node scripts/migrations/008-backfill-box-receive-cascade.js --apply --company=<companyId>
 */

require("dotenv").config();
const mongoose = require("mongoose");

const BulkPackage = require("../../model/Inventory/BulkPackage");
const Inventory = require("../../model/Inventory/Inventory");

const APPLY = process.argv.includes("--apply");
const companyArg = (process.argv.find((a) => a.startsWith("--company=")) || "").split("=")[1];

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI is not set");
  await mongoose.connect(uri);
  console.log(`\n008 receive-cascade backfill — ${APPLY ? "APPLY" : "DRY RUN (nothing will be written)"}\n`);

  const scope = companyArg ? { company_id: companyArg } : {};

  // Every three-level lot: the ones that actually have inner boxes.
  const lotIds = await BulkPackage.distinct("lot_id", { ...scope, box_level: "inner" });
  const report = [];

  for (const lotId of lotIds) {
    const boxes = await BulkPackage.find({ ...scope, lot_id: lotId })
      .select("_id bulk_packaging_id box_level parent_box_id status received_at received_by lot_number")
      .lean();
    const mains = boxes.filter((b) => b.box_level === "main");
    const inners = boxes.filter((b) => b.box_level === "inner");
    if (!mains.length || !inners.length) continue;

    const innersOf = (m) => inners.filter((b) => String(b.parent_box_id) === String(m._id));

    // A) inner boxes under a RECEIVED parent that never got the cascade.
    const orphanInners = mains
      .filter((m) => m.status === "received")
      .flatMap((m) => innersOf(m).filter((b) => b.status === "created").map((b) => ({ box: b, from: m })));

    // B) main cartons whose inner boxes are all received but which are still open.
    const staleMains = mains.filter((m) => {
      if (m.status !== "created") return false;
      const kids = innersOf(m).filter((b) => b.status !== "cancelled");
      return kids.length > 0 && kids.every((b) => b.status === "received");
    });

    if (!orphanInners.length && !staleMains.length) continue;

    report.push({
      lotId,
      lotNumber: boxes[0]?.lot_number || String(lotId),
      orphanInners,
      staleMains,
    });
  }

  if (!report.length) {
    console.log("No lot is missing the cascade. Nothing to repair.\n");
    return;
  }

  console.log(`${report.length} lot(s) affected:\n`);
  let innerTotal = 0;
  let mainTotal = 0;
  for (const r of report) {
    innerTotal += r.orphanInners.length;
    mainTotal += r.staleMains.length;
    console.log(
      `  ${r.lotNumber}`
      + `  inner boxes to receive: ${r.orphanInners.length}`
      + `  main cartons to close: ${r.staleMains.length}`
    );
  }
  console.log(`\n  → ${innerTotal} inner box(es) and ${mainTotal} main carton(s) in total.`);

  if (!APPLY) {
    console.log("\nDry run — re-run with --apply to repair these rows.\n");
    return;
  }

  let lotsFixed = 0;
  for (const r of report) {
    for (const { box, from } of r.orphanInners) {
      await BulkPackage.updateOne(
        { _id: box._id, status: "created" },
        { $set: { status: "received", received_at: from.received_at || new Date(), received_by: from.received_by || null } }
      );
    }
    for (const m of r.staleMains) {
      const kids = await BulkPackage.find({ parent_box_id: m._id, status: "received" })
        .select("received_at received_by")
        .sort({ received_at: -1 })
        .limit(1)
        .lean();
      await BulkPackage.updateOne(
        { _id: m._id, status: "created" },
        { $set: { status: "received", received_at: kids[0]?.received_at || new Date(), received_by: kids[0]?.received_by || null } }
      );
    }

    // C) the lot's own status, recomputed the way receiveBox does it.
    const pending = await BulkPackage.countDocuments({ lot_id: r.lotId, box_level: "inner", status: "created" });
    await Inventory.updateOne(
      { _id: r.lotId },
      { $set: { receiving_status: pending === 0 ? "received" : "partially_received" } }
    );
    lotsFixed += 1;
  }
  console.log(`\nRepaired ${lotsFixed} lot(s). No stock was moved and no ledger row was written.\n`);
}

main()
  .catch((e) => { console.error("\n008 backfill failed:", e.message, "\n"); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
