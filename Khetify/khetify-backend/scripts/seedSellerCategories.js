/**
 * SELLER PRODUCT CATEGORY SEEDER
 *
 * Loads the four system categories into the `sellercategories` collection —
 * the dropdown behind "Primary product categories" in seller onboarding.
 *
 * Run from the backend folder:
 *   npm run seed:seller-categories
 *   node scripts/seedSellerCategories.js            # same thing
 *   node scripts/seedSellerCategories.js --dry-run  # report only, writes nothing
 *
 * SAFE TO RE-RUN. Every row is upserted on `nameKey` — the collection's unique
 * key — so a second run inserts nothing and changes nothing. It never touches
 * categories sellers added themselves (those carry isSeeded: false) and never
 * deletes anything.
 *
 * "Other" IS DELIBERATELY NOT SEEDED: it is the UI option that opens the
 * free-text box, not a category anyone sells.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const SellerCategory = require("../model/Master/SellerCategory");

const CATEGORIES = ["Seed", "Pesticide", "Fertilizer", "Machinery"];

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");

async function main() {
  console.log(`Categories: ${CATEGORIES.join(", ")}`);

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing was written.");
    return;
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("\nConnected to MongoDB.");

  // The unique index has to exist before the upserts, or a concurrent run could
  // slip a duplicate through.
  await SellerCategory.syncIndexes();

  const ops = CATEGORIES.map((name) => ({
    updateOne: {
      // nameKey is the case-insensitive identity, so re-running never adds a
      // second "Seed" — and a seller who happened to type one of these first
      // simply gets their row marked as the system one.
      filter: { nameKey: name.toLowerCase().trim() },
      update: {
        $set: { isSeeded: true, isActive: true },
        $setOnInsert: { name, nameKey: name.toLowerCase().trim(), createdBySellerId: null },
      },
      upsert: true,
    },
  }));

  const res = await SellerCategory.bulkWrite(ops, { ordered: false });
  console.log(`Inserted  : ${res.upsertedCount}`);
  console.log(`Updated   : ${res.modifiedCount}`);
  console.log(`Unchanged : ${CATEGORIES.length - res.upsertedCount - res.modifiedCount}`);

  console.log(`\nTotal in collection: ${await SellerCategory.countDocuments()}`);
}

main()
  .catch((err) => { console.error("\nSeed failed:", err.message); process.exitCode = 1; })
  .finally(async () => { try { await mongoose.connection.close(); } catch { /* ignore */ } });
