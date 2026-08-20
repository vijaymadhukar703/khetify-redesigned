/**
 * 006-box-level-parent.js — three-level packaging: a MAIN bulk packaging box owns
 * inner boxes. Adds the two hierarchy columns and, the part that actually blocks
 * lot creation, SWAPS THE UNIQUE INDEX.
 *
 *   box_level      'main' | 'inner'   (default 'main')
 *   parent_box_id  the owning main box, null on a main box
 *
 * THE INDEX. Creation fails on any database still carrying the old key:
 *
 *   E11000 duplicate key error collection: khetify.bulkpackages
 *   index: lot_id_1_box_serial_1 dup key: { lot_id: ..., box_serial: 1 }
 *
 * `{ lot_id, box_serial }` was right when a lot had one flat level. It is wrong
 * now: serial 1 legitimately occurs twice in a lot — once as main box 1, once as
 * an inner box — and the index reads the second insert as a duplicate. The key
 * becomes
 *
 *   { lot_id, box_level, parent_box_id, box_serial }
 *
 * so main box serials are unique inside the lot and inner box serials are unique
 * inside the main box that holds them (parent_box_id is null on a main box).
 *
 * EXISTING LOTS ARE NOT RESTRUCTURED. Every current row is a box that holds units
 * directly, which is exactly what box_level 'main' with no parent means — so they
 * are stamped, not reorganised, and they keep rendering as they do now. No
 * main-box records are invented for them.
 *
 * Safety:
 *   • Writes ONLY the two new columns, and only where box_level is absent.
 *   • Idempotent — every step checks the current state first, so a second run is
 *     a no-op. A missing old index is normal, not an error.
 *   • Refuses to build the new index if the data would violate it, printing the
 *     offending groups instead of throwing a bare E11000.
 *   • Never deletes, never renumbers, never rewrites a bulk_packaging_id — those
 *     are printed on physical cartons.
 *
 * Run from the backend folder (needs .env with MONGO_URI):
 *   node scripts/migrations/006-box-level-parent.js            # apply
 *   node scripts/migrations/006-box-level-parent.js --dry-run  # report only
 */

require("dotenv").config();
const mongoose = require("mongoose");

const BulkPackage = require("../../model/Inventory/BulkPackage");

const DRY_RUN = process.argv.includes("--dry-run");

/** The key this migration installs, in order. */
const NEW_KEY = { lot_id: 1, box_level: 1, parent_box_id: 1, box_serial: 1 };

/**
 * Every unique index on the collection whose key is NOT the one we want. That is
 * `{ lot_id, box_serial }` on a production database, and on a database that ran
 * an earlier build of this file the interim `{ lot_id, box_level, box_serial }`
 * — which is also wrong, since it cannot hold two main boxes' inner box 1.
 */
function staleUniqueIndexes(indexes) {
  const wanted = JSON.stringify(NEW_KEY);
  return indexes.filter(
    (i) =>
      i.unique &&
      i.name !== "_id_" &&
      JSON.stringify(i.key) !== wanted &&
      // The Bulk Packaging ID is unique in its own right and stays untouched.
      !("bulk_packaging_id" in i.key) &&
      "box_serial" in i.key
  );
}

/** Groups that would collide under NEW_KEY — must be empty before it is built. */
async function violations() {
  return BulkPackage.collection
    .aggregate([
      {
        $group: {
          _id: {
            lot_id: "$lot_id",
            box_level: { $ifNull: ["$box_level", "main"] },
            parent_box_id: { $ifNull: ["$parent_box_id", null] },
            box_serial: "$box_serial",
          },
          n: { $sum: 1 },
          ids: { $push: "$bulk_packaging_id" },
        },
      },
      { $match: { n: { $gt: 1 } } },
      { $limit: 20 },
    ])
    .toArray();
}

/**
 * The migration itself, on an ALREADY-CONNECTED mongoose. Separate from main() so
 * it can be run against a test database — an index swap is exactly the kind of
 * step that must be proven to work both on a database carrying the old index and
 * on one that never had it.
 */
async function migrate({ dryRun = false } = {}) {
  const DRY_RUN = dryRun;
  {
    if (DRY_RUN) console.log("🧪 DRY RUN — no writes, no index changes.\n");

    /* ---- 1. stamp the two columns ------------------------------------- */
    const total = await BulkPackage.countDocuments({});
    const pending = await BulkPackage.countDocuments({ box_level: { $exists: false } });
    console.log(`🔎 ${pending} of ${total} box record(s) need a level.`);

    if (pending && !DRY_RUN) {
      // Stamp only. An existing box holds units directly → 'main', no parent.
      const r = await BulkPackage.collection.updateMany(
        { box_level: { $exists: false } },
        { $set: { box_level: "main", parent_box_id: null } }
      );
      console.log(`✅ Stamped ${r.modifiedCount} row(s) as box_level "main".`);
    }

    /* ---- 2. would the new index hold? --------------------------------- */
    const bad = await violations();
    if (bad.length) {
      console.error(
        `\n❌ ${bad.length} group(s) already share { lot_id, box_level, parent_box_id, box_serial }.`
      );
      console.error("   The new unique index cannot be built until these are resolved:");
      for (const g of bad) {
        console.error(
          `   lot ${g._id.lot_id} · ${g._id.box_level} · parent ${g._id.parent_box_id} · serial ${g._id.box_serial}`
          + `  ×${g.n}  →  ${g.ids.join(", ")}`
        );
      }
      // Nothing has been broken: the old index is still in place at this point.
      throw new Error("duplicate box serials — index not swapped");
    }
    console.log("✅ No duplicate box serials — the new index will hold.");

    /* ---- 3. swap the index ------------------------------------------- */
    const before = await BulkPackage.collection.indexes();
    const stale = staleUniqueIndexes(before);
    const already = before.some((i) => JSON.stringify(i.key) === JSON.stringify(NEW_KEY));

    if (!stale.length) {
      // Expected on a fresh database, and on any second run.
      console.log("ℹ️  No stale unique index on box_serial — nothing to drop.");
    }
    for (const i of stale) {
      console.log(`   stale unique index: ${i.name} ${JSON.stringify(i.key)}`);
      if (DRY_RUN) continue;
      try {
        await BulkPackage.collection.dropIndex(i.name);
        console.log(`   ↳ dropped ${i.name}`);
      } catch (err) {
        // IndexNotFound (27) — someone else dropped it first. Not a failure.
        if (err.code === 27 || /index not found/i.test(err.message)) {
          console.log(`   ↳ ${i.name} was already gone`);
        } else throw err;
      }
    }

    if (already) {
      console.log("ℹ️  { lot_id, box_level, parent_box_id, box_serial } already exists.");
    } else if (!DRY_RUN) {
      await BulkPackage.collection.createIndex(NEW_KEY, { unique: true });
      console.log("✅ Created unique { lot_id, box_level, parent_box_id, box_serial }.");
    } else {
      console.log("   would create unique { lot_id, box_level, parent_box_id, box_serial }");
    }

    // Additive: brings up anything else the schema declares (bulk_packaging_id,
    // the box_level and parent_box_id lookups). Deliberately NOT syncIndexes(),
    // which drops whatever is not in the schema — a migration should only touch
    // the indexes it names.
    if (!DRY_RUN) {
      await BulkPackage.createIndexes();
      console.log("✅ Remaining schema indexes ensured.");

      const after = await BulkPackage.collection.indexes();
      console.log("\n   indexes now:");
      for (const i of after) {
        console.log(`   ${i.unique ? "UNIQUE " : "       "}${i.name} ${JSON.stringify(i.key)}`);
      }
    }

    console.log(
      DRY_RUN
        ? "\n🧪 Would stamp the rows above and swap the unique index."
        : "\n✅ Done. Existing lots are unchanged; three-level lots can now be created."
    );
  }
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    await migrate({ dryRun: DRY_RUN });
  } finally {
    await mongoose.connection.close();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ 006-box-level-parent failed:", err.message);
      process.exit(1);
    });
}

module.exports = { migrate, NEW_KEY, staleUniqueIndexes, violations };
