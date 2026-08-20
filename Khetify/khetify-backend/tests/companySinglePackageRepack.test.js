/**
 * A REPACK CARTON IS NOT THE COMPANY'S PACKAGING.
 *
 * Repack cartons are assembled by a WAREHOUSE at dispatch, out of loose picked
 * units. The company's Lot Details page rendered them as packaging groups, so a
 * lot the company had shipped as a SINGLE PACKAGE grew a "Bulk Packaging IDs"
 * section out of nowhere — and the units inside those cartons left the Unit
 * Codes list to sit in it (35 of 40 shown for a 40-unit lot with no boxes).
 *
 * On a lot the company DID package there is a real packaging level to show them
 * at, so that stays. Either way the trace survives: a plain-listed unit carries
 * the carton it travelled in.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const lotService = require("../services/lotService");
const shipmentService = require("../services/shipmentService");
const repackService = require("../services/repackService");
const lotCtrl = require("../controller/Inventory/lotController");
const notificationService = require("../services/notificationService");

let companyId, bhopal, indore, productId, actor;

beforeEach(() => {
  jest.spyOn(notificationService, "notifyWarehouseTeam").mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `csr-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  actor = new mongoose.Types.ObjectId();
  bhopal = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  indore = await Warehouse.create({ companyId, name: "Indore", code: "IND" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const asCompany = () => ({ id: companyId, companyId, role: "company_admin" });

const detailsOf = async (lotRowId) => {
  const res = mockRes();
  await lotCtrl.lotDetails({ params: { id: lotRowId }, user: asCompany() }, res);
  return res.body.data;
};

/** A lot at Bhopal, boxed or not, fully on the shelf and labelled. */
async function lotAtBhopal({ qty, boxes, perBox } = {}) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: bhopal._id, qty,
    lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
    ...(boxes ? { hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox } : {}),
  });
  await Inventory.updateOne(
    { _id: inv._id },
    { $set: { inTransitStock: 0, offlineStock: qty, availableStock: qty } }
  );
  await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { status: "received", warehouse_id: bhopal._id } });
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

/**
 * Bhopal packs `sizes` repack cartons out of loose units and transfers them all
 * to Indore — the sequence that produced the report.
 */
async function repackAndTransfer(src, sizes) {
  const total = sizes.reduce((a, b) => a + b, 0);
  const ship = await shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", toLabel: "Indore",
    fromWarehouseId: bhopal._id, toWarehouseId: indore._id,
    lines: [{ inventoryId: src._id, qty: total }],
  });
  const serials = (await UnitSerial.find({ inventoryId: src._id }).sort({ unit_serial: 1 }).limit(total).lean())
    .map((u) => u.serial);

  let at = 0;
  const boxIds = [];
  for (const n of sizes) {
    const box = await repackService.packUnits(companyId, {
      shipmentId: ship._id, serials: serials.slice(at, at + n), performedBy: actor,
    });
    boxIds.push(box.repackBoxId);
    at += n;
  }
  await shipmentService.dispatchShipment(companyId, ship._id, { scannedCodes: serials, performedBy: actor });
  await shipmentService.verifyReceipt(companyId, ship._id, {
    qr: `${ship._id}.${(await require("../model/Transport/Shipment").findById(ship._id)).qrToken}`,
    warehouseId: String(indore._id), verifierId: actor, performedBy: actor,
  });
  return boxIds;
}

/* ------------------------------------------------------ single package */

describe("a SINGLE-PACKAGE lot the warehouse repacked", () => {
  test("NO packaging section — the company packed no boxes", async () => {
    const src = await lotAtBhopal({ qty: 40 });
    await repackAndTransfer(src, [3, 2]);

    const d = await detailsOf(src._id);
    expect(d.bulkPackages).toHaveLength(0);
    // A repack carton must not appear as a packaging group either — that is
    // what made the panel draw "Bulk Packaging IDs" at all.
    expect(d.looseUnitGroups.filter((g) => g.bulkPackagingId)).toHaveLength(0);
  });

  test("ALL 40 units are in the unit list — none pulled out into a box", async () => {
    const src = await lotAtBhopal({ qty: 40 });
    await repackAndTransfer(src, [3, 2]);

    const d = await detailsOf(src._id);
    expect(d.looseUnitCodes).toHaveLength(40);
    expect(new Set(d.looseUnitCodes).size).toBe(40);
    expect(d.unitTotal).toBe(40);
  });

  /**
   * A FLAT LIST, whatever the warehouses did with the stock.
   *
   * These three used to assert per-warehouse groups and a repack-carton badge
   * on each travelled unit. Both describe what a WAREHOUSE later did; this page
   * answers what the COMPANY created and sent, so the codes read as they did the
   * day the lot was labelled. Where the stock physically sits is still on the
   * page (Stock by Warehouse), and the per-unit journey is still the
   * Traceability page's job.
   */
  test("ONE FLAT LIST — no per-warehouse grouping, even across two warehouses", async () => {
    const src = await lotAtBhopal({ qty: 40 });
    await repackAndTransfer(src, [3, 2]);

    const d = await detailsOf(src._id);
    // The lot really does span two warehouses…
    expect(d.warehouseCount).toBe(2);
    // …and the unit list says nothing about it.
    expect(d.looseUnitGroups).toHaveLength(0);
    expect(d.looseUnitCodes).toHaveLength(40);
  });

  test("no repack carton is named beside any unit", async () => {
    const src = await lotAtBhopal({ qty: 40 });
    await repackAndTransfer(src, [3, 2]);

    const d = await detailsOf(src._id);
    expect(d.looseUnitCodeMeta).toBeUndefined();
    expect(d.looseUnitGroups.some((g) => g.codeMeta)).toBe(false);
  });

  test("the codes are the lot's own, in one list, none missing", async () => {
    const src = await lotAtBhopal({ qty: 40 });
    await repackAndTransfer(src, [3, 2]);

    const d = await detailsOf(src._id);
    const minted = (await UnitSerial.find({ lotNumber: src.lotNumber }).lean())
      .map((u) => u.unit_code || u.serial);
    expect(d.looseUnitCodes.slice().sort()).toEqual(minted.slice().sort());
  });

  test("a single-package lot with no repack at all is untouched", async () => {
    const src = await lotAtBhopal({ qty: 10 });

    const d = await detailsOf(src._id);
    expect(d.bulkPackages).toHaveLength(0);
    expect(d.looseUnitGroups).toHaveLength(0);
    expect(d.looseUnitCodes).toHaveLength(10);
  });
});

/* --------------------------------------------------- company-packaged lot */

describe("a lot the COMPANY packaged is unaffected", () => {
  test("its boxes still render, and a repack carton still gets its own group", async () => {
    const src = await lotAtBhopal({ qty: 20, boxes: 4, perBox: 5 });
    const [boxA] = await repackAndTransfer(src, [3]);

    const d = await detailsOf(src._id);
    // The company's own four boxes are still there…
    expect(d.bulkPackages).toHaveLength(4);
    // …and the warehouse's carton is shown at that packaging level, as before.
    const repackGroups = d.looseUnitGroups.filter((g) => g.kind === "repack");
    expect(repackGroups).toHaveLength(1);
    expect(repackGroups[0].bulkPackagingId).toBe(boxA);
    expect(repackGroups[0].codes).toHaveLength(3);
  });

  test("every unit is still listed exactly once", async () => {
    const src = await lotAtBhopal({ qty: 20, boxes: 4, perBox: 5 });
    await repackAndTransfer(src, [3]);

    const d = await detailsOf(src._id);
    const inCards = d.bulkPackages.flatMap((b) =>
      d.units.filter((u) => String(u.bulk_packaging_record_id) === String(b._id))
        .map((u) => u.unit_code || u.serial));
    const inGroups = d.looseUnitGroups.flatMap((g) => g.codes);
    const all = [...inCards, ...inGroups, ...d.looseUnitCodes];
    expect(new Set(all).size).toBe(20);
  });
});
