/**
 * 007-recalc-lot-stock-after-misdeduction.js
 *
 * REPAIRS LOTS WHOSE STOCK WAS DEBITED AGAINST THE WRONG LOT AT DISPATCH.
 *
 * THE BUG (fixed in services/shipmentService.dispatchShipment). A transfer's
 * lines are an ALLOCATION made when it is raised — earliest expiry first —
 * before anything is picked. Dispatch deducted per line, so it debited the lots
 * the PLAN named rather than the lots the operator actually scanned out. With
 * two lots of one product (100 + 10) and a scan of 100 from the first and 4 from
 * the second, the plan's split (10 + 94) emptied the wrong lot and left 6 in the
 * other. Dispatch now rewrites the lines from the verified scan first, so no NEW
 * dispatch can do this. Rows already written keep the wrong figures until this
 * runs.
 *
 * THE TRUTH IT RECALCULATES AGAINST. For a SERIALISED lot the unit rows are the
 * physical record: a unit that left is "shipped"/"sold", a unit still on the
 * shelf is "in_stock". So the shelf quantity of such a lot is exactly the number
 * of its in-stock units. Non-serialised lots (no unit labels at all) are left
 * ALONE — there is nothing to recount them against, and guessing would be worse
 * than the current figure.
 *
 * WHAT IT WRITES. Nothing is deleted and no ledger row is ever modified — the
 * ledger is append-only (invariant 1). A correction appends ONE "adjustment"
 * row per fixed lot, alongside the corrected Inventory figures, so the repair
 * itself is auditable.
 *
 * Reads availableStock = onlineStock + offlineStock - reservedStock (invariant
 * 2) and keeps it holding: the delta is applied to offlineStock, which is where
 * warehouse-held stock sits.
 *
 * DRY RUN BY DEFAULT — it prints the affected lots and changes nothing.
 *   node scripts/migrations/007-recalc-lot-stock-after-misdeduction.js
 *   node scripts/migrations/007-recalc-lot-stock-after-misdeduction.js --apply
 *   node scripts/migrations/007-recalc-lot-stock-after-misdeduction.js --apply --company=<companyId>
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Inventory = require("../../model/Inventory/Inventory");
const UnitSerial = require("../../model/Barcode/UnitSerial");
const StockMovement = require("../../model/Inventory/StockMovement");

const APPLY = process.argv.includes("--apply");
const companyArg = (process.argv.find((a) => a.startsWith("--company=")) || "").split("=")[1];

/** A unit that is physically on this warehouse's shelf. */
const ON_SHELF = ["in_stock", "picked", "packed"];

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI is not set");
  await mongoose.connect(uri);
  console.log(`\n007 recalc — ${APPLY ? "APPLY" : "DRY RUN (nothing will be written)"}\n`);

  const filter = { ownerType: "company", ...(companyArg ? { ownerId: companyArg } : {}) };
  const lots = await Inventory.find(filter)
    .select("lotNumber batchNumber productId ownerId ownerType warehouseId onlineStock offlineStock reservedStock availableStock inTransitStock")
    .lean();

  const affected = [];
  for (const lot of lots) {
    // Serialised? A lot with no unit rows at all is skipped entirely.
    const total = await UnitSerial.countDocuments({ inventoryId: lot._id });
    if (!total) continue;

    const onShelf = await UnitSerial.countDocuments({ inventoryId: lot._id, status: { $in: ON_SHELF } });
    const current = Number(lot.availableStock || 0);
    if (onShelf === current) continue;

    affected.push({ lot, current, onShelf, delta: onShelf - current });
  }

  if (!affected.length) {
    console.log("No lot disagrees with its unit records. Nothing to repair.\n");
    return;
  }

  console.log(`${affected.length} lot(s) disagree with their unit records:\n`);
  for (const a of affected) {
    console.log(
      `  ${a.lot.lotNumber || a.lot.batchNumber}`
      + `  warehouse=${a.lot.warehouseId}`
      + `  availableStock=${a.current} → ${a.onShelf}`
      + `  (${a.delta > 0 ? "+" : ""}${a.delta})`
    );
  }

  if (!APPLY) {
    console.log("\nDry run — re-run with --apply to correct these rows.\n");
    return;
  }

  let fixed = 0;
  for (const a of affected) {
    const { lot, onShelf, delta } = a;
    // Keep availableStock = online + offline - reserved by moving the delta
    // through offlineStock, which is the warehouse-held bucket.
    const newOffline = Number(lot.offlineStock || 0) + delta;
    if (newOffline < 0) {
      console.log(`  ! skipped ${lot.lotNumber || lot.batchNumber} — correction would make offlineStock negative`);
      continue;
    }
    await Inventory.updateOne(
      { _id: lot._id },
      { $set: { offlineStock: newOffline, availableStock: onShelf } }
    );
    // APPEND-ONLY: one new ledger row recording the correction. No existing row
    // is touched.
    await StockMovement.create({
      inventoryId: lot._id,
      productId: lot.productId,
      ownerType: lot.ownerType,
      ownerId: lot.ownerId,
      type: "adjustment",
      channel: "internal",
      quantity: delta,
      balanceAfter: onShelf,
      note: "007 recalc: stock re-derived from unit records after wrong-lot dispatch deduction",
    });
    fixed += 1;
  }
  console.log(`\nCorrected ${fixed} lot(s); ${affected.length - fixed} skipped.\n`);
}

main()
  .catch((e) => { console.error("\n007 recalc failed:", e.message, "\n"); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
