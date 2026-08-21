/**
 * HSN → GST RATE MASTER SEEDER
 *
 * Loads scripts/data/hsn-gst.json into the `hsngstrates` collection.
 *
 * Run from the backend folder:
 *   npm run seed:hsn
 *   node scripts/seedHsnGst.js            # same thing
 *   node scripts/seedHsnGst.js --dry-run  # report only, writes nothing
 *   node scripts/seedHsnGst.js --prune    # also delete rows no longer in the file
 *
 * SAFE TO RE-RUN. Every row is upserted on (hsnCode, gstRate, description) —
 * the collection's unique key — so a second run inserts nothing and updates
 * nothing that has not changed. It does not touch any other collection.
 *
 * WHY A DATA FILE AND NOT THOUSANDS OF INSERTS: the JSON is generated from the
 * notification PDF, so it can be regenerated when a new notification lands and
 * diffed in review. Rates are copied verbatim; none are inferred, rounded or
 * filled in.
 */

require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");

const HsnGstRate = require("../model/Master/HsnGstRate");

const DATA_FILE = path.join(__dirname, "data", "hsn-gst.json");
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const PRUNE = argv.includes("--prune");

const pct = (n) => `${n}%`;

async function main() {
  const raw = require(DATA_FILE);
  const records = Array.isArray(raw) ? raw : raw.records;

  if (!Array.isArray(records) || !records.length) {
    throw new Error(`No records found in ${DATA_FILE}`);
  }

  /* ---- VALIDATE BEFORE WRITING ANYTHING -------------------------------
     A malformed master is worse than no master: it would quietly put a wrong
     GST rate on real products. So the whole file is checked first and the run
     aborts on the first bad row rather than half-loading. */
  const seen = new Set();
  records.forEach((r, i) => {
    const at = `record #${i + 1} (${r.hsnCode})`;
    if (!/^\d{2,8}$/.test(String(r.hsnCode || ""))) throw new Error(`${at}: hsnCode must be 2-8 digits`);
    if (!(typeof r.gstRate === "number" && r.gstRate >= 0)) throw new Error(`${at}: gstRate must be a number`);
    if (!String(r.description || "").trim()) throw new Error(`${at}: description is required`);
    const key = `${r.hsnCode}|${r.gstRate}|${r.description}`;
    if (seen.has(key)) throw new Error(`${at}: duplicated (hsnCode, gstRate, description) in the data file`);
    seen.add(key);
  });

  /* ---- REPORT WHAT IS AMBIGUOUS ---------------------------------------
     Codes carrying more than one rate are not an error — they are the
     notification's own structure — but they ARE the rows the app will refuse to
     auto-fill, so the operator should see how many there are. */
  const byCode = new Map();
  for (const r of records) {
    if (!byCode.has(r.hsnCode)) byCode.set(r.hsnCode, new Set());
    byCode.get(r.hsnCode).add(r.gstRate);
  }
  const multi = [...byCode.entries()].filter(([, s]) => s.size > 1);

  console.log(`Data file : ${DATA_FILE}`);
  if (raw.source) console.log(`Source    : ${raw.source}`);
  console.log(`Records   : ${records.length}`);
  console.log(`HSN codes : ${byCode.size}`);
  console.log(`  single-rate (auto-fill) : ${byCode.size - multi.length}`);
  console.log(`  multi-rate  (ask user)  : ${multi.length}`);
  if (multi.length) {
    console.log("  e.g. " + multi.slice(0, 5)
      .map(([c, s]) => `${c} → ${[...s].sort((a, b) => a - b).map(pct).join(" / ")}`).join(", "));
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing was written.");
    return;
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("\nConnected to MongoDB.");

  // The unique index has to exist before the upserts, or a concurrent run could
  // slip a duplicate through.
  await HsnGstRate.syncIndexes();

  const ops = records.map((r) => ({
    updateOne: {
      filter: { hsnCode: r.hsnCode, gstRate: r.gstRate, description: r.description },
      update: {
        $set: {
          appliesTo: r.appliesTo || null,
          schedule: r.schedule || null,
          ...(raw.source ? { source: raw.source } : {}),
        },
        $setOnInsert: { hsnCode: r.hsnCode, gstRate: r.gstRate, description: r.description },
      },
      upsert: true,
    },
  }));

  const res = await HsnGstRate.bulkWrite(ops, { ordered: false });
  console.log(`Inserted  : ${res.upsertedCount}`);
  console.log(`Updated   : ${res.modifiedCount}`);
  console.log(`Unchanged : ${records.length - res.upsertedCount - res.modifiedCount}`);

  if (PRUNE) {
    // Only ever removes rows of THIS master that the current file no longer
    // contains. Off by default: deleting rate history is not something a seed
    // run should do unless it was asked for.
    const keys = records.map((r) => ({ hsnCode: r.hsnCode, gstRate: r.gstRate, description: r.description }));
    const all = await HsnGstRate.find().select("hsnCode gstRate description").lean();
    const want = new Set(keys.map((k) => `${k.hsnCode}|${k.gstRate}|${k.description}`));
    const stale = all.filter((d) => !want.has(`${d.hsnCode}|${d.gstRate}|${d.description}`));
    if (stale.length) {
      await HsnGstRate.deleteMany({ _id: { $in: stale.map((d) => d._id) } });
      console.log(`Pruned    : ${stale.length} row(s) no longer in the data file`);
    } else {
      console.log("Pruned    : 0 (nothing stale)");
    }
  }

  console.log(`\nTotal in collection: ${await HsnGstRate.countDocuments()}`);
}

main()
  .catch((err) => { console.error("\nSeed failed:", err.message); process.exitCode = 1; })
  .finally(async () => { try { await mongoose.connection.close(); } catch { /* ignore */ } });