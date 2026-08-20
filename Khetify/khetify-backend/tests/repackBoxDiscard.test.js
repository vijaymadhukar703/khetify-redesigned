/**
 * REMOVING A CARTON THAT WAS NEVER DISPATCHED — the × on a Box Packaging row.
 *
 * Dropping the row on screen alone left the RepackBox behind: an ID naming a
 * box that does not exist and never will. Discard deletes it outright, which is
 * a different answer from UNPACK — unpack says "this box existed and was opened
 * again" and keeps the row so its ID is never reissued and the history reads
 * true; discard says "this box was never packed".
 *
 * What must hold either way: the units come back exactly as they were (same
 * codes, same lot, same original bulk packaging box, same stock status), the
 * picked set does not change size, and a carton whose goods have left is
 * refused.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const RepackBox = require("../model/Inventory/RepackBox");
const Shipment = require("../model/Transport/Shipment");
const lotService = require("../services/lotService");
const barcodeService = require("../services/barcodeService");
const shipmentService = require("../services/shipmentService");
const svc = require("../services/repackService");

let companyId, srcWh, destWh, productId, actor;

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `rpd-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  actor = new mongoose.Types.ObjectId();
  srcWh = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  destWh = await Warehouse.create({ companyId, name: "Dest", code: "WH2" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

/** A received, labelled lot on the source shelf. */
async function makeLot({ qty, boxes, perBox } = {}) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: srcWh._id, qty,
    lotOrigin: "company", pendingReceipt: true,
    ...(boxes ? { hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox } : {}),
  });
  await Inventory.updateOne(
    { _id: inv._id },
    { $set: { inTransitStock: 0, offlineStock: qty, availableStock: qty } }
  );
  await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { status: "received" } });
  await barcodeService.generateUnits(companyId, inv._id, qty, {});
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

const shipmentFor = (lines) =>
  shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", toLabel: "Dest",
    fromWarehouseId: srcWh._id, toWarehouseId: destWh._id, lines,
  });

const serialsOf = (lot, n) =>
  UnitSerial.find({ inventoryId: lot._id }).sort({ unit_serial: 1 }).limit(n).lean()
    .then((u) => u.map((x) => x.serial));

/** A lot, a shipment and one carton packed out of `n` of its units. */
async function packed(n = 3, qty = 10) {
  const lot = await makeLot({ qty });
  const ship = await shipmentFor([{ inventoryId: lot._id, qty }]);
  const serials = await serialsOf(lot, n);
  const box = await svc.packUnits(companyId, { shipmentId: ship._id, serials, performedBy: actor });
  return { lot, ship, serials, box };
}

describe("the box is gone, not archived", () => {
  test("the RepackBox row is deleted outright", async () => {
    const { box } = await packed();
    expect(await RepackBox.countDocuments({ repack_box_id: box.repackBoxId })).toBe(1);

    await svc.discardBox(companyId, box.repackBoxId, { performedBy: actor });

    expect(await RepackBox.countDocuments({ repack_box_id: box.repackBoxId })).toBe(0);
    // …and it is no longer readable anywhere.
    await expect(svc.boxContents(companyId, box.repackBoxId)).rejects.toMatchObject({ status: 404 });
  });

  test("the units' own repack events go with it — they were never boxed", async () => {
    const { box } = await packed();
    const row = await RepackBox.findOne({ repack_box_id: box.repackBoxId }).lean();
    expect(await UnitEvent.countDocuments({ refType: "RepackBox", refId: row._id })).toBe(3);

    await svc.discardBox(companyId, box.repackBoxId, { performedBy: actor });

    expect(await UnitEvent.countDocuments({ refType: "RepackBox", refId: row._id })).toBe(0);
  });

  test("UNPACK still keeps its row — the two are different answers", async () => {
    const { box } = await packed();

    await svc.unpackBox(companyId, box.repackBoxId, { performedBy: actor });

    const row = await RepackBox.findOne({ repack_box_id: box.repackBoxId }).lean();
    expect(row).toBeTruthy();
    expect(row.status).toBe("unpacked");
  });
});

describe("the units come back exactly as they were", () => {
  test("unlinked, and handed back one by one with their lot and original box", async () => {
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const ship = await shipmentFor([{ inventoryId: lot._id, qty: 10 }]);
    const serials = await serialsOf(lot, 3);
    const box = await svc.packUnits(companyId, { shipmentId: ship._id, serials, performedBy: actor });

    const r = await svc.discardBox(companyId, box.repackBoxId, { performedBy: actor });

    expect(r.unitCount).toBe(3);
    expect(r.unitCodes.sort()).toEqual([...serials].sort());
    expect(r.units).toHaveLength(3);
    for (const u of r.units) {
      expect(u.lotNumber).toBe(lot.lotNumber);
      // The carton the unit was originally minted into is untouched by a
      // repack, so it comes back with it — that is what a unit row shows.
      expect(u.bulkPackagingId).toBeTruthy();
      expect(String(u.productId)).toBe(String(productId));
    }
    expect(await UnitSerial.countDocuments({ serial: { $in: serials }, repack_box_id: null })).toBe(3);
  });

  test("stock status, lot and original box are all untouched", async () => {
    const { lot, serials, box } = await packed(3, 10);
    const before = await UnitSerial.find({ serial: { $in: serials } })
      .select("serial status inventoryId bulk_packaging_record_id").lean();

    await svc.discardBox(companyId, box.repackBoxId, { performedBy: actor });

    const after = await UnitSerial.find({ serial: { $in: serials } })
      .select("serial status inventoryId bulk_packaging_record_id").lean();
    const key = (u) => `${u.serial}|${u.status}|${u.inventoryId}|${u.bulk_packaging_record_id}`;
    expect(after.map(key).sort()).toEqual(before.map(key).sort());
    expect(after.every((u) => u.status === "in_stock")).toBe(true);
    expect(String(after[0].inventoryId)).toBe(String(lot._id));
  });

  test("THE PICKED SET DOES NOT CHANGE — same units, loose again", async () => {
    const { ship, serials, box } = await packed(3, 10);
    // Everything the dialog holds: the boxed units plus the rest it scanned.
    const picked = await serialsOf(await Inventory.findOne({ _id: (await Shipment.findById(ship._id)).lines[0].inventoryId }), 10);
    expect(picked).toHaveLength(10);

    const r = await svc.discardBox(companyId, box.repackBoxId, { performedBy: actor });

    // The three that were in the carton are still three, and still among the ten.
    expect(r.unitCodes).toHaveLength(3);
    expect(r.unitCodes.every((c) => picked.includes(c))).toBe(true);
    expect(serials.every((c) => r.unitCodes.includes(c))).toBe(true);
  });

  test("the shipment's OTHER cartons are left alone", async () => {
    const lot = await makeLot({ qty: 10 });
    const ship = await shipmentFor([{ inventoryId: lot._id, qty: 10 }]);
    const all = await serialsOf(lot, 8);
    const a = await svc.packUnits(companyId, { shipmentId: ship._id, serials: all.slice(0, 3), performedBy: actor });
    const b = await svc.packUnits(companyId, { shipmentId: ship._id, serials: all.slice(3, 6), performedBy: actor });

    await svc.discardBox(companyId, a.repackBoxId, { performedBy: actor });

    const survivor = await svc.boxContents(companyId, b.repackBoxId);
    expect(survivor.unitCount).toBe(3);
    expect(survivor.status).toBe("packed");
    expect(await svc.listForShipment(companyId, ship._id)).toHaveLength(1);
  });
});

describe("what discard refuses", () => {
  test("a DISPATCHED shipment's carton cannot be removed", async () => {
    const { ship, box } = await packed();
    await Shipment.updateOne({ _id: ship._id }, { $set: { status: "in_transit" } });

    await expect(svc.discardBox(companyId, box.repackBoxId, { performedBy: actor }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("already been dispatched") });

    // Nothing moved.
    expect(await RepackBox.countDocuments({ repack_box_id: box.repackBoxId })).toBe(1);
    expect(await UnitSerial.countDocuments({ repack_box_id: { $ne: null } })).toBe(3);
  });

  test.each(["dispatched", "arrived", "delivered", "received"])(
    "…and the same for a shipment that is %s",
    async (status) => {
      const { ship, box } = await packed();
      await Shipment.updateOne({ _id: ship._id }, { $set: { status } });
      await expect(svc.discardBox(companyId, box.repackBoxId, { performedBy: actor }))
        .rejects.toMatchObject({ status: 409 });
    }
  );

  test("an ALREADY UNPACKED box is refused rather than deleted", async () => {
    const { box } = await packed();
    await svc.unpackBox(companyId, box.repackBoxId, { performedBy: actor });

    await expect(svc.discardBox(companyId, box.repackBoxId, { performedBy: actor }))
      .rejects.toMatchObject({ status: 409 });
    // The unpacked audit row survives.
    expect(await RepackBox.countDocuments({ repack_box_id: box.repackBoxId })).toBe(1);
  });

  test("a second discard of the same box is refused", async () => {
    const { box } = await packed();
    await svc.discardBox(companyId, box.repackBoxId, { performedBy: actor });

    await expect(svc.discardBox(companyId, box.repackBoxId, { performedBy: actor }))
      .rejects.toMatchObject({ status: 404 });
  });

  test("ANOTHER COMPANY cannot remove this one's box", async () => {
    const { box } = await packed();
    const other = await Company.create({
      fullName: "Other", email: `oth-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
      companyInfo: { companyName: "Other Agri" },
    });

    await expect(svc.discardBox(other._id, box.repackBoxId, { performedBy: actor }))
      .rejects.toMatchObject({ status: 404 });
    expect(await RepackBox.countDocuments({ repack_box_id: box.repackBoxId })).toBe(1);
  });

  test("an unknown box ID is a 404", async () => {
    await expect(svc.discardBox(companyId, "KH-BHO-ABC001-BX-20260101-0099", { performedBy: actor }))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe("dispatch still works afterwards", () => {
  test("the loosened units dispatch exactly as they would have in the box", async () => {
    const { ship, box } = await packed(3, 6);
    await svc.discardBox(companyId, box.repackBoxId, { performedBy: actor });

    const shipDoc = await Shipment.findById(ship._id);
    const all = await UnitSerial.find({ companyId }).select("serial").lean();
    const dispatched = await shipmentService.dispatchShipment(companyId, ship._id, {
      scannedCodes: all.map((u) => u.serial),
      performedBy: actor,
    });

    expect(shipDoc.status).toBe("planned");
    expect(dispatched.shipment.status).toBe("in_transit");
    // No carton is carried on a shipment whose only box was removed.
    expect(await svc.listForShipment(companyId, ship._id)).toHaveLength(0);
  });
});
