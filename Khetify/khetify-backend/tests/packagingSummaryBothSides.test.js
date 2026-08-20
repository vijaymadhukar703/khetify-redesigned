/**
 * THE PACKAGING SUMMARY, on both sides of a transfer.
 *
 * One shared calculation (bulkPackageService.summaryForLot) feeds the Lot
 * Details panel at the sending AND the receiving warehouse. Two things were
 * wrong with it:
 *
 *   SENDING   — "Unit Labels" was read off an IN-STOCK-only count, so a
 *               warehouse holding units that were minted but not yet put away
 *               (or already dispatched) showed 0 while the box cards below it
 *               listed every one of their codes.
 *   RECEIVING — the boxes were looked up by `lot_id`, which belongs to the
 *               SENDING row, so the whole summary came back null: "0 boxes",
 *               "Total Boxes 0", and no Received / Pending figures at all,
 *               beside a Bulk Packaging IDs list showing the real cartons.
 *
 * Counts are per WAREHOUSE ROW, not per lot: Indore holding 10 of 20 reads 10.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const lotService = require("../services/lotService");
const bulkPackageService = require("../services/bulkPackageService");

let companyId, bhopal, indore, productId;

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `pks-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  bhopal = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  indore = await Warehouse.create({ companyId, name: "Indore", code: "IND" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

/** The reported lot: 2 cartons × 2 inner boxes × 5 units, received at Bhopal. */
async function lotAtBhopal() {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: bhopal._id, qty: 20,
    lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
    hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 5,
    mainBoxes: 2, boxesPerMain: 2,
  });
  await Inventory.updateOne(
    { _id: inv._id },
    { $set: { inTransitStock: 0, offlineStock: 20, availableStock: 20 } }
  );
  await BulkPackage.updateMany(
    { lot_id: inv._id },
    { $set: { status: "received", warehouse_id: bhopal._id } }
  );
  return Inventory.findById(inv._id);
}

/** Move whole inner boxes to Indore, as the receipt path does. */
async function moveBoxesToIndore(src, boxSerials) {
  const boxes = await BulkPackage.find({
    lot_id: src._id, box_level: "inner", box_serial: { $in: boxSerials },
  });
  const moving = await UnitSerial.find({
    inventoryId: src._id, bulk_packaging_record_id: { $in: boxes.map((b) => b._id) },
  });
  const dest = await Inventory.findOneAndUpdate(
    { productId, ownerType: "company", ownerId: companyId, warehouseId: indore._id, batchNumber: src.batchNumber },
    { $inc: { offlineStock: moving.length, availableStock: moving.length }, $set: { lotNumber: src.lotNumber } },
    { new: true, upsert: true }
  );
  await UnitSerial.updateMany(
    { _id: { $in: moving.map((u) => u._id) } },
    { $set: { inventoryId: dest._id, status: "in_stock" } }
  );
  await Inventory.updateOne(
    { _id: src._id },
    { $inc: { offlineStock: -moving.length, availableStock: -moving.length } }
  );
  return dest;
}

const summaryAt = (lotRowId, warehouseId) =>
  bulkPackageService.summaryForLot(companyId, lotRowId, { warehouseId });

/* -------------------------------------------------------------- bug 1 */

describe("BUG 1 — the sending side's Unit Labels", () => {
  test("counts the codes that EXIST here, whatever state the units are in", async () => {
    const src = await lotAtBhopal();
    // Minted but never put away — the state that read 0.
    expect(await UnitSerial.countDocuments({ inventoryId: src._id, status: "in_stock" })).toBe(0);

    const s = await summaryAt(src._id, bhopal._id);
    expect(s.unitLabels).toBe(20);
  });

  test("…and still does once the units are in stock", async () => {
    const src = await lotAtBhopal();
    await UnitSerial.updateMany({ inventoryId: src._id }, { $set: { status: "in_stock" } });

    const s = await summaryAt(src._id, bhopal._id);
    expect(s.unitLabels).toBe(20);
  });

  test("it drops to what is LEFT here after a transfer, not the whole lot", async () => {
    const src = await lotAtBhopal();
    await UnitSerial.updateMany({ inventoryId: src._id }, { $set: { status: "in_stock" } });
    await moveBoxesToIndore(src, [1, 2]);

    const s = await summaryAt(src._id, bhopal._id);
    expect(s.unitLabels).toBe(10);
  });

  test("every other sending-side figure is unchanged", async () => {
    const src = await lotAtBhopal();

    const s = await summaryAt(src._id, bhopal._id);
    expect(s).toMatchObject({
      totalBoxes: 4, receivedBoxes: 4, pendingBoxes: 0,
      receivedUnits: 20, pendingUnits: 0, cancelledBoxes: 0,
      unitsPerBox: 5,
    });
  });
});

/* -------------------------------------------------------------- bug 2 */

describe("BUG 2 — the receiving side gets a summary at all", () => {
  test("it is no longer null — the cartons on its shelf are counted", async () => {
    const src = await lotAtBhopal();
    await UnitSerial.updateMany({ inventoryId: src._id }, { $set: { status: "in_stock" } });
    const dest = await moveBoxesToIndore(src, [1, 2]);

    const s = await summaryAt(dest._id, indore._id);
    expect(s).not.toBeNull();
    // Two of the lot's four inner boxes arrived — the row's own scope, not 4.
    expect(s.totalBoxes).toBe(2);
    expect(s.unitsPerBox).toBe(5);
  });

  test("Boxes / Units Received and Pending all render with real values", async () => {
    const src = await lotAtBhopal();
    await UnitSerial.updateMany({ inventoryId: src._id }, { $set: { status: "in_stock" } });
    const dest = await moveBoxesToIndore(src, [1, 2]);

    const s = await summaryAt(dest._id, indore._id);
    // The cartons are physically here, so nothing is pending — their records are
    // booked to the SENDER, which is why the booked-warehouse test rejected them.
    expect(s.receivedBoxes).toBe(2);
    expect(s.pendingBoxes).toBe(0);
    expect(s.receivedUnits).toBe(10);
    expect(s.pendingUnits).toBe(0);
  });

  test("Unit Labels is the receiving warehouse's own count", async () => {
    const src = await lotAtBhopal();
    await UnitSerial.updateMany({ inventoryId: src._id }, { $set: { status: "in_stock" } });
    const dest = await moveBoxesToIndore(src, [1, 2]);

    const s = await summaryAt(dest._id, indore._id);
    expect(s.unitLabels).toBe(10);
  });

  test("UNIT LABELS is what splits between the two sides", async () => {
    const src = await lotAtBhopal();
    await UnitSerial.updateMany({ inventoryId: src._id }, { $set: { status: "in_stock" } });
    const dest = await moveBoxesToIndore(src, [1, 2]);

    const a = await summaryAt(src._id, bhopal._id);
    const b = await summaryAt(dest._id, indore._id);
    // The codes follow the goods, so the two sides add up to the lot.
    expect(a.unitLabels + b.unitLabels).toBe(20);
    expect([a.unitLabels, b.unitLabels]).toEqual([10, 10]);
  });

  /**
   * THE BOX FIGURES ARE A RECEIPT RECORD; ONLY UNIT LABELS IS LIVE.
   *
   * The sending side keeps "4 boxes, all received, 20 units received" — that is
   * what it took in from the company, and sending some onward does not change
   * it. Its UNIT LABELS follows the goods, because that answers what is on the
   * shelf now. The receiving row has no records of its own, so its figures are
   * necessarily the cartons whose units it holds.
   */
  test("receipt figures hold on the sending side; labels follow the goods", async () => {
    const src = await lotAtBhopal();
    await UnitSerial.updateMany({ inventoryId: src._id }, { $set: { status: "in_stock" } });
    const dest = await moveBoxesToIndore(src, [1]);

    const a = await summaryAt(src._id, bhopal._id);
    expect(a.totalBoxes).toBe(4);
    expect(a.receivedBoxes).toBe(4);
    expect(a.receivedUnits).toBe(20);
    expect(a.unitLabels).toBe(15);

    const b = await summaryAt(dest._id, indore._id);
    expect(b.totalBoxes).toBe(1);
    expect(b.receivedUnits).toBe(5);
    expect(b.unitLabels).toBe(5);

    // The LABELS split between the two; the receipt record does not.
    expect(a.unitLabels + b.unitLabels).toBe(20);
  });
});

/* ------------------------------------------------- shapes that must not move */

describe("shapes the summary must keep answering the same way", () => {
  test("a SINGLE-PACKAGE lot still returns null, so the page says 'Single package'", async () => {
    const inv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: bhopal._id, qty: 10,
      lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
    });

    expect(await summaryAt(inv._id, bhopal._id)).toBeNull();
  });

  test("an UNRECEIVED boxed lot still reports everything pending", async () => {
    const inv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: bhopal._id, qty: 20,
      lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
      hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 5,
    });
    await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { warehouse_id: bhopal._id } });

    const s = await summaryAt(inv._id, bhopal._id);
    expect(s).toMatchObject({ totalBoxes: 4, receivedBoxes: 0, pendingBoxes: 4, pendingUnits: 20 });
    // The labels exist even though nothing has been received.
    expect(s.unitLabels).toBe(20);
  });

  test("the lot-wide roll-up (no warehouse given) is unchanged", async () => {
    const src = await lotAtBhopal();

    const s = await bulkPackageService.summaryForLot(companyId, src._id);
    expect(s).toMatchObject({ totalBoxes: 4, receivedBoxes: 4, pendingBoxes: 0, receivedUnits: 20 });
  });
});
