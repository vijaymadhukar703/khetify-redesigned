/**
 * orphan-repack-box-audit.js — REPACK CARTONS THAT NEVER WENT ANYWHERE.
 *
 * Reports only. Read-only, writes nothing, and has no --fix: deciding what to do
 * with these is the operator's call, not this script's.
 *
 * Before the × on a Box Packaging row deleted its carton, dropping the row left
 * the RepackBox row behind — an ID naming a box that does not physically exist.
 * This finds them. A carton is ORPHANED when it is still "packed" and its
 * shipment never left:
 *
 *   no shipment      — the shipment row is gone entirely
 *   not dispatched   — still draft / planned / picked / … , so nothing moved
 *   cancelled        — the shipment was called off
 *   no units         — nothing points at it any more, whatever the shipment did
 *
 * A carton on a dispatched shipment is NOT an orphan however old it is: it is on
 * a truck, or on a shelf at the far end, with a printed label.
 *
 * Run:  node scripts/reports/orphan-repack-box-audit.js
 *       node scripts/reports/orphan-repack-box-audit.js --json
 */

require("dotenv").config();
const mongoose = require("mongoose");
const RepackBox = require("../../model/Inventory/RepackBox");
const Shipment = require("../../model/Transport/Shipment");
const UnitSerial = require("../../model/Barcode/UnitSerial");
// Required for their side effect: populate() needs the referenced models
// registered, and a standalone script loads no other part of the app.
require("../../model/Company/productModel");
require("../../model/Warehouse/Warehouse");

const asJson = process.argv.includes("--json");

/** The shipment states in which the goods are still on the shelf. */
const PRE_DISPATCH = new Set(["draft", "planned", "picking", "picked", "packed", "approved", "loading", "pending"]);

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set");
  await mongoose.connect(uri);

  // An unpacked box is a deliberate history record, not an orphan.
  const boxes = await RepackBox.find({ status: "packed" })
    .populate("product_id", "productName")
    .populate("warehouse_id", "name")
    .sort({ created_at: 1 })
    .lean();

  const shipmentIds = [...new Set(boxes.map((b) => String(b.shipment_id)).filter(Boolean))];
  const shipments = shipmentIds.length
    ? await Shipment.find({ _id: { $in: shipmentIds } }).select("status lrNumber dispatchedAt").lean()
    : [];
  const shipmentById = new Map(shipments.map((s) => [String(s._id), s]));

  // How many units still point at each box — a box nothing points at holds
  // nothing, whatever its unit_count claims.
  const liveCounts = boxes.length
    ? await UnitSerial.aggregate([
      { $match: { repack_box_id: { $in: boxes.map((b) => b._id) } } },
      { $group: { _id: "$repack_box_id", n: { $sum: 1 } } },
    ])
    : [];
  const liveBy = new Map(liveCounts.map((c) => [String(c._id), c.n]));

  const orphans = [];
  let dispatchedOk = 0;
  for (const b of boxes) {
    const shipment = shipmentById.get(String(b.shipment_id));
    const live = liveBy.get(String(b._id)) || 0;

    let reason = null;
    if (!shipment) reason = "no shipment row";
    else if (shipment.status === "cancelled") reason = "shipment cancelled";
    else if (PRE_DISPATCH.has(shipment.status)) reason = `shipment not dispatched (${shipment.status})`;
    else if (live === 0) reason = "no units point at it";

    if (!reason) { dispatchedOk += 1; continue; }
    orphans.push({
      repackBoxId: b.repack_box_id,
      _id: String(b._id),
      reason,
      product: b.product_id?.productName || "—",
      warehouse: b.warehouse_id?.name || "—",
      packedUnits: b.unit_count,
      liveUnits: live,
      shipmentId: String(b.shipment_id),
      shipmentRef: shipment?.lrNumber || `SH-${String(b.shipment_id).slice(-6).toUpperCase()}`,
      shipmentStatus: shipment?.status || "(missing)",
      createdAt: b.created_at,
    });
  }

  if (asJson) {
    console.log(JSON.stringify({ scanned: boxes.length, dispatched: dispatchedOk, orphans }, null, 2));
  } else {
    console.log(`Packed repack boxes scanned : ${boxes.length}`);
    console.log(`  …on dispatched shipments   : ${dispatchedOk}`);
    console.log(`ORPHANED                     : ${orphans.length}\n`);
    for (const o of orphans) {
      console.log(`  ${o.repackBoxId}`);
      console.log(`    reason    : ${o.reason}`);
      console.log(`    product   : ${o.product} · ${o.warehouse}`);
      console.log(`    units     : ${o.liveUnits} live / ${o.packedUnits} as packed`);
      console.log(`    shipment  : ${o.shipmentRef} (${o.shipmentStatus})`);
      console.log(`    created   : ${o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : "—"}   _id ${o._id}\n`);
    }
    if (!orphans.length) console.log("  none\n");
    console.log("Nothing was changed — this report deletes nothing.");
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
