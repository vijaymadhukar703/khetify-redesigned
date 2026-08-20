/**
 * stuck-transfer-audit.js — TRANSFERS WHOSE STOCK LEFT BUT NEVER FULLY ARRIVED.
 *
 * Reports only. Read-only, writes nothing, no --fix.
 *
 * A warehouse transfer deducts the source the moment it is dispatched and only
 * credits the destination when it is received, so between those two events the
 * quantity sits in NO warehouse's stock counters. That is not lost data — every
 * unit still carries `status: "shipped"` and `currentShipmentId`, which is what
 * makes it findable and receivable — but it IS invisible to every stock figure,
 * and a transfer that stalls there stays invisible indefinitely.
 *
 * Listed here when a transfer has left and is not fully received:
 *   dispatched / in_transit / arrived / verifying — nothing received yet
 *   partially_received                            — some cartons landed
 *
 * Run:  node scripts/reports/stuck-transfer-audit.js
 *       node scripts/reports/stuck-transfer-audit.js --json
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Shipment = require("../../model/Transport/Shipment");
const UnitSerial = require("../../model/Barcode/UnitSerial");
require("../../model/Warehouse/Warehouse");

const asJson = process.argv.includes("--json");

/** Left the source, not yet fully received. */
const STUCK = ["dispatched", "in_transit", "arrived", "verifying", "partially_received"];

const refOf = (s) => s.lrNumber || `SH-${String(s._id).slice(-6).toUpperCase()}`;
const days = (d) => (d ? Math.floor((Date.now() - new Date(d)) / 86400000) : null);

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set");
  await mongoose.connect(uri);

  const rows = await Shipment.find({ toType: "warehouse", status: { $in: STUCK } })
    .populate("fromWarehouseId", "name")
    .populate("toWarehouseId", "name")
    .sort({ dispatchedAt: 1 })
    .lean();

  // The units still on the road, per shipment — the honest measure of what is
  // in limbo, independent of whatever the lines claim.
  const inTransitBy = new Map();
  if (rows.length) {
    const counts = await UnitSerial.aggregate([
      { $match: { status: "shipped", currentShipmentId: { $in: rows.map((r) => r._id) } } },
      { $group: { _id: "$currentShipmentId", n: { $sum: 1 } } },
    ]);
    for (const c of counts) inTransitBy.set(String(c._id), c.n);
  }

  const stuck = rows.map((s) => {
    const sent = (s.lines || []).reduce((n, l) => n + Number(l.qty || 0), 0);
    const got = (s.lines || []).reduce((n, l) => n + Number(l.receivedQty || 0), 0);
    return {
      ref: refOf(s),
      _id: String(s._id),
      status: s.status,
      from: s.fromWarehouseId?.name || "—",
      to: s.toWarehouseId?.name || "—",
      dispatchedAt: s.dispatchedAt || null,
      daysOut: days(s.dispatchedAt),
      sentQty: sent,
      receivedQty: got,
      // Units still flagged shipped on this shipment. Where this disagrees with
      // sent − received, the LINES are the stale side: they are totals, the
      // units are the physical record.
      unitsInLimbo: inTransitBy.get(String(s._id)) || 0,
    };
  });

  const limbo = stuck.reduce((n, s) => n + s.unitsInLimbo, 0);

  if (asJson) {
    console.log(JSON.stringify({ count: stuck.length, unitsInLimbo: limbo, stuck }, null, 2));
  } else {
    console.log(`Transfers dispatched but NOT fully received : ${stuck.length}`);
    console.log(`Units in limbo (off both warehouses' books)  : ${limbo}\n`);
    for (const s of stuck) {
      console.log(`  ${s.ref}  [${s.status}]`);
      console.log(`    route     : ${s.from} → ${s.to}`);
      console.log(`    quantity  : ${s.receivedQty} received of ${s.sentQty} sent · ${s.unitsInLimbo} unit(s) still in transit`);
      console.log(`    dispatched: ${s.dispatchedAt ? new Date(s.dispatchedAt).toISOString().slice(0, 10) : "—"}${s.daysOut != null ? ` (${s.daysOut} day(s) ago)` : ""}`);
      console.log(`    _id       : ${s._id}\n`);
    }
    if (!stuck.length) console.log("  none\n");
    console.log("Nothing was changed. Each of these is receivable from Stock Transfers → Receive Lot.");
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
