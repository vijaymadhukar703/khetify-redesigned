/**
 * unlabelled-lot-audit.js — LOTS WHOSE UNITS HAVE NO CODES YET.
 *
 * Reports only. Read-only, writes nothing, no --fix: whether to mint labels for
 * a lot created before auto-generation is a business call, and pressing Generate
 * on the Labels page already does it one lot at a time.
 *
 * A lot is listed when it holds fewer unit codes than its created quantity. The
 * shortfall is what barcodeService.ensureLotUnitLabels would mint — the same
 * figure the manual button and scripts/backfillBoxUnitLabels.js work from.
 *
 * Run:  node scripts/reports/unlabelled-lot-audit.js
 *       node scripts/reports/unlabelled-lot-audit.js --json
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Inventory = require("../../model/Inventory/Inventory");
const UnitSerial = require("../../model/Barcode/UnitSerial");
const BulkPackage = require("../../model/Inventory/BulkPackage");
require("../../model/Company/productModel");
require("../../model/Warehouse/Warehouse");

const asJson = process.argv.includes("--json");

/** What may be labelled — the created quantity, never live stock. */
const capOf = (inv) => (typeof inv.originalQuantity === "number"
  ? inv.originalQuantity
  : Number(inv.availableStock || 0) + Number(inv.inTransitStock || 0));

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set");
  await mongoose.connect(uri);

  const lots = await Inventory.find({ ownerType: "company" })
    .populate("productId", "productName")
    .populate("warehouseId", "name")
    .sort({ createdAt: 1 })
    .lean();

  const counts = await UnitSerial.aggregate([
    { $match: { ownerType: "company" } },
    { $group: { _id: "$inventoryId", n: { $sum: 1 } } },
  ]);
  const labelledBy = new Map(counts.map((c) => [String(c._id), c.n]));

  const boxed = new Set(
    (await BulkPackage.find({}).select("lot_id").lean()).map((b) => String(b.lot_id))
  );

  const short = [];
  for (const inv of lots) {
    const cap = capOf(inv);
    const have = labelledBy.get(String(inv._id)) || 0;
    if (cap <= 0 || have >= cap) continue;
    short.push({
      lotNumber: inv.lotNumber || inv.batchNumber,
      _id: String(inv._id),
      packaging: boxed.has(String(inv._id)) ? "bulk packaging" : "single package",
      product: inv.productId?.productName || "—",
      warehouse: inv.warehouseId?.name || "—",
      created: cap,
      labelled: have,
      missing: cap - have,
      availableStock: Number(inv.availableStock || 0),
      // Insert-only, so a row that never carried it was created by a path that
      // does not record one — which is also why `cap` falls back to stock.
      hasOriginalQuantity: typeof inv.originalQuantity === "number",
      createdAt: inv.createdAt,
    });
  }

  const single = short.filter((s) => s.packaging === "single package");

  if (asJson) {
    console.log(JSON.stringify({ scanned: lots.length, short }, null, 2));
  } else {
    console.log(`Company lots scanned            : ${lots.length}`);
    console.log(`Lots missing some unit codes    : ${short.length}`);
    console.log(`  …of which SINGLE PACKAGE      : ${single.length}`);
    console.log(`Unit codes missing in total     : ${short.reduce((n, s) => n + s.missing, 0)}\n`);
    for (const s of short) {
      console.log(`  ${s.lotNumber}   [${s.packaging}]`);
      console.log(`    labelled  : ${s.labelled} of ${s.created}  → ${s.missing} missing`);
      console.log(`    product   : ${s.product} · ${s.warehouse} · avail ${s.availableStock}`);
      console.log(`    createdQty: ${s.hasOriginalQuantity ? "from originalQuantity" : "DERIVED from stock (originalQuantity not set on this row)"}`);
      console.log(`    _id       : ${s._id}\n`);
    }
    if (!short.length) console.log("  none\n");
    console.log("Nothing was changed. Press Generate on Barcodes & Labels to mint a lot's shortfall.");
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
