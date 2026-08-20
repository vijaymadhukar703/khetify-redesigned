/**
 * diagnose-lot-creation.js — why a MANUALLY ENTERED lot number is refused with
 * "This lot would create a Bulk Packaging ID that already exists".
 *
 * That sentence is controller/Inventory/lotController.js → duplicateKeyMessage,
 * and it is produced from a raw Mongo E11000 on the `bulkpackages` collection.
 * It is NOT the guard in services/lotService.js (firstTakenBoxId), which names
 * the offending box and the lot that owns it. Seeing the raw text therefore
 * means the guard found nothing and the INSERT still collided — so the state
 * that blocks the insert is invisible to a read of the live lots.
 *
 * There are exactly three ways that happens, and this script tells you which:
 *
 *   1. ORPHANED BOXES. Lot creation runs through services/txn.js →
 *      withTransaction, which on a STANDALONE mongod (mongodb://localhost, the
 *      normal local dev deployment) runs WITHOUT a session and therefore cannot
 *      roll back. A creation that failed after createBulkPackages leaves its
 *      BulkPackage rows behind with no surviving Inventory row. Retyping the
 *      same lot number mints the same box IDs and dies on the unique index.
 *
 *   2. A STALE UNIQUE INDEX. `{ lot_id, box_serial }` was correct when a lot had
 *      one flat level of boxes. A three-level lot ("Inside bulk packaging")
 *      legitimately uses serial 1 twice — once as main box 1, once as an inner
 *      box — so the old key rejects the second insert. Fixed by
 *      scripts/migrations/006-box-level-parent.js, which must be RUN AGAINST
 *      THE DATABASE; it does not travel with the code.
 *
 *   3. A GENUINE CLASH with a live lot. A box ID is the lot number MINUS the SKU
 *      range, so two lots differing only in quantity mint identical box IDs.
 *      This one is real and the fix is to change a part that is in the box ID.
 *
 * READ-ONLY by default. Nothing is written unless you pass --fix, and --fix
 * touches ONLY case 1 and case 2 — orphaned rows and the stale index. It never
 * deletes a box that belongs to a live lot, never renumbers, and never rewrites
 * a bulk_packaging_id (those are printed on physical cartons).
 *
 * Run from khetify-backend (needs .env with MONGO_URI):
 *   node scripts/diagnose-lot-creation.js
 *   node scripts/diagnose-lot-creation.js --fix
 */

require("dotenv").config();
const mongoose = require("mongoose");

const BulkPackage = require("../model/Inventory/BulkPackage");
const Inventory = require("../model/Inventory/Inventory");

const FIX = process.argv.includes("--fix");

/** The unique key model/Inventory/BulkPackage.js declares, in order. */
const WANTED_KEY = { lot_id: 1, box_level: 1, parent_box_id: 1, box_serial: 1 };

const line = (s = "") => console.log(s);
const head = (n, t) => line(`\n${"─".repeat(64)}\n${n}. ${t}\n${"─".repeat(64)}`);

/**
 * Unique indexes on bulkpackages whose key is not the one the model declares.
 * `_id_` is never unique-by-declaration here and is skipped, as is the intended
 * key and the single-field bulk_packaging_id index, which is still correct.
 */
function staleUniqueIndexes(indexes) {
  const wanted = JSON.stringify(WANTED_KEY);
  const bpId = JSON.stringify({ bulk_packaging_id: 1 });
  return indexes.filter(
    (ix) =>
      ix.unique &&
      ix.name !== "_id_" &&
      JSON.stringify(ix.key) !== wanted &&
      JSON.stringify(ix.key) !== bpId
  );
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set — run this from khetify-backend with its .env.");
  await mongoose.connect(uri);
  line(`Connected: ${uri.replace(/\/\/[^@]*@/, "//***@")}`);

  /* ── 0. Deployment: can this database roll back at all? ─────────────── */
  head(0, "Deployment");
  const topology = mongoose.connection.client?.topology?.description?.type || "unknown";
  const txns = /ReplicaSet|Sharded/.test(topology);
  line(`Topology: ${topology}`);
  line(
    txns
      ? "Transactions ARE available — a failed lot creation rolls back cleanly."
      : "Transactions are NOT available (standalone mongod). A lot creation that\n" +
        "fails partway CANNOT roll back, so it can leave BulkPackage rows behind.\n" +
        "This is the precondition for finding 1 below."
  );

  /* ── 1. Orphaned boxes ──────────────────────────────────────────────── */
  head(1, "Orphaned Bulk Packaging rows (boxes whose lot no longer exists)");
  const lotIds = await BulkPackage.distinct("lot_id");
  const liveIds = await Inventory.find({ _id: { $in: lotIds } }).distinct("_id");
  const live = new Set(liveIds.map(String));
  const deadIds = lotIds.filter((id) => !live.has(String(id)));

  let orphans = [];
  if (deadIds.length) {
    orphans = await BulkPackage.find({ lot_id: { $in: deadIds } })
      .select("bulk_packaging_id lot_number lot_id status created_at")
      .sort({ created_at: 1 })
      .lean();
  }

  if (!orphans.length) {
    line("None. Every box belongs to a live Inventory row.");
  } else {
    const received = orphans.filter((b) => b.status === "received");
    line(`${orphans.length} orphaned box row(s) across ${deadIds.length} dead lot id(s).`);
    line("These are invisible on every screen but still hold their IDs on the");
    line("unique index, which is what refuses the new lot.\n");
    for (const b of orphans.slice(0, 40)) {
      line(`  ${b.bulk_packaging_id}   lot ${b.lot_number}   status ${b.status}   created ${b.created_at ? new Date(b.created_at).toISOString().slice(0, 19) : "?"}`);
    }
    if (orphans.length > 40) line(`  … and ${orphans.length - 40} more`);
    if (received.length) {
      line(`\n  ⚠ ${received.length} of these are status "received" — they were scanned into`);
      line("    stock at some point. --fix will NOT delete those; check them by hand.");
    }
  }

  /* ── 2. Stale unique index ──────────────────────────────────────────── */
  head(2, "Unique indexes on bulkpackages");
  const indexes = await BulkPackage.collection.indexes();
  for (const ix of indexes) line(`  ${ix.name}${ix.unique ? "  [unique]" : ""}  ${JSON.stringify(ix.key)}`);
  const stale = staleUniqueIndexes(indexes);
  if (!stale.length) {
    line("\nNo stale unique index. Migration 006 has been applied (or was never needed).");
  } else {
    line(`\n${stale.length} stale unique index(es): ${stale.map((i) => i.name).join(", ")}`);
    line("A three-level lot (\"Inside bulk packaging\") cannot be created while these");
    line("exist. Run: node scripts/migrations/006-box-level-parent.js");
  }

  /* ── 3. Genuine duplicate box IDs among live lots ───────────────────── */
  head(3, "Duplicate Bulk Packaging IDs among live lots");
  const dupes = await BulkPackage.aggregate([
    { $group: { _id: "$bulk_packaging_id", n: { $sum: 1 }, lots: { $addToSet: "$lot_number" } } },
    { $match: { n: { $gt: 1 } } },
    { $limit: 25 },
  ]);
  if (!dupes.length) {
    line("None — the global unique index is intact, as expected.");
    line("(A genuine clash is not stored twice; it is REFUSED. If your lot is being");
    line("refused and findings 1 and 2 are clean, the ID really is taken by a live");
    line("lot: see the list below.)");
  } else {
    for (const d of dupes) line(`  ${d._id} used by lots: ${d.lots.join(", ")}`);
  }

  /* ── 4. What the box IDs in use actually look like ──────────────────── */
  head(4, "Most recent Bulk Packaging IDs in use (for comparison with yours)");
  const recent = await BulkPackage.find({})
    .select("bulk_packaging_id lot_number box_level created_at")
    .sort({ created_at: -1 })
    .limit(15)
    .lean();
  if (!recent.length) line("The collection is empty.");
  for (const b of recent) {
    line(`  ${b.bulk_packaging_id}   (${b.box_level})   lot ${b.lot_number}`);
  }
  line("\nA box ID drops the SKU range. If the ID you are about to mint appears");
  line("above, change the Bulk Packaging prefix, the Batch or the date — changing");
  line("quantity or the SKU range cannot help, because neither is in a box ID.");

  /* ── REPAIR ─────────────────────────────────────────────────────────── */
  head(5, FIX ? "Repair" : "Repair (not run — pass --fix to apply)");
  const deletable = orphans.filter((b) => b.status !== "received");

  if (!FIX) {
    line(`Would delete ${deletable.length} orphaned box row(s) (status ≠ received).`);
    line(`Would drop ${stale.length} stale unique index(es).`);
    line("\nRe-run with --fix to apply.");
  } else {
    if (deletable.length) {
      const res = await BulkPackage.deleteMany({
        _id: { $in: deletable.map((b) => b._id) },
      });
      line(`Deleted ${res.deletedCount} orphaned box row(s).`);
    } else {
      line("No orphaned rows to delete.");
    }
    if (stale.length) {
      for (const ix of stale) {
        await BulkPackage.collection.dropIndex(ix.name);
        line(`Dropped stale unique index ${ix.name}.`);
      }
      await BulkPackage.collection.createIndex(WANTED_KEY, { unique: true });
      line("Rebuilt { lot_id, box_level, parent_box_id, box_serial } unique.");
    } else {
      line("No stale index to drop.");
    }
  }

  await mongoose.disconnect();
  line("\nDone.");
}

main().catch(async (err) => {
  console.error("\nFAILED:", err.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* already down */
  }
  process.exit(1);
});