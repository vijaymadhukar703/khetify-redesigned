/**
 * backfillProductCode.js — one-off migration that gives every EXISTING product a
 * unique `product_code` (3 letters from the product name + 3 random digits).
 *
 * Why: product_code is `required` on the schema from now on, but rows created
 * before the field existed have nothing. This fills them in so the unique index
 * can be built and every catalog screen has a code to show.
 *
 * Safety:
 *   • Touches ONLY product_code, and only on products that don't already have
 *     one. Names, pricing, images, category, stock and status are untouched.
 *   • Uses updateOne($set) — no full-document validation, so a half-filled
 *     legacy product can't fail the migration.
 *   • Idempotent: re-running it is a no-op once every product has a code.
 *   • Codes handed out during the run are held in memory AND checked against
 *     the DB, so one run can never issue the same code twice. A stray
 *     duplicate-key error is retried with fresh digits.
 *
 * Run from the backend folder (needs .env with MONGO_URI):
 *   node scripts/backfillProductCode.js            # apply
 *   node scripts/backfillProductCode.js --dry-run  # report only, write nothing
 *
 * Recommended order on deploy:
 *   1. node scripts/backfillProductCode.js
 *   2. node scripts/ensureIndexes.js               # builds the unique index
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Product = require("../model/Company/productModel");
const { generateUniqueProductCode } = require("../services/productCodeService");

const DRY_RUN = process.argv.includes("--dry-run");
const MAX_RETRIES = 5;

// Products with no usable code: field absent, null, or an empty/blank string.
const MISSING_CODE = {
  $or: [
    { product_code: { $exists: false } },
    { product_code: null },
    { product_code: "" },
  ],
};

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const total = await Product.countDocuments({});
    const pending = await Product.countDocuments(MISSING_CODE);
    console.log(`🔎 ${pending} of ${total} product(s) need a product code.`);
    if (!pending) {
      console.log("✅ Nothing to do — every product already has a code.");
      return;
    }
    if (DRY_RUN) console.log("🧪 DRY RUN — no writes will be made.");

    // Every code already in use, so the generator never collides with a live row.
    const existing = await Product.find({ product_code: { $nin: [null, ""] } })
      .select("product_code")
      .lean();
    const reserved = new Set(existing.map((p) => p.product_code).filter(Boolean));

    let updated = 0;
    let failed = 0;

    const cursor = Product.find(MISSING_CODE)
      .select("_id productName")
      .lean()
      .cursor();

    for await (const doc of cursor) {
      let done = false;
      for (let attempt = 1; attempt <= MAX_RETRIES && !done; attempt++) {
        const code = await generateUniqueProductCode(doc.productName, { reserved });
        if (DRY_RUN) {
          console.log(`  • ${doc._id} "${doc.productName || "(unnamed)"}" → ${code}`);
          reserved.add(code);
          updated++;
          done = true;
          break;
        }
        try {
          await Product.updateOne({ _id: doc._id }, { $set: { product_code: code } });
          reserved.add(code);
          updated++;
          done = true;
        } catch (err) {
          // Unique index rejected it (another process grabbed the code) — retry.
          if (err?.code === 11000 && attempt < MAX_RETRIES) {
            reserved.add(code);
            continue;
          }
          console.error(`  ✗ ${doc._id}: ${err.message}`);
          failed++;
          done = true;
        }
      }
    }

    console.log(
      DRY_RUN
        ? `🧪 Would assign ${updated} product code(s). ${failed} failure(s).`
        : `✅ Assigned ${updated} product code(s). ${failed} failure(s). Nothing else was modified.`,
    );
    if (!DRY_RUN && updated) {
      console.log("👉 Next: node scripts/ensureIndexes.js  (builds the unique index)");
    }
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ backfillProductCode failed:", err.message);
    process.exit(1);
  });
