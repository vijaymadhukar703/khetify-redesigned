/**
 * Unit labels for a BOXED lot — one label set per box, minted at creation.
 *
 * The bug: labels were only ever minted when an operator pressed Generate, for
 * whatever quantity they typed. Generation fills the boxes IN ORDER, so a lot of
 * 4 × 250 generated at 250 left box 1 fully labelled and boxes 2-4 with none.
 * Lot Details then read "No unit labels generated for this box yet" against a
 * box that was received and holds 250 units.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const UnitSerial = require("../model/Barcode/UnitSerial");
const BulkPackage = require("../model/Inventory/BulkPackage");
const Counter = require("../model/Counter");
const lotService = require("../services/lotService");
const barcodeService = require("../services/barcodeService");

let companyId, productId, bhopal;

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Khetify Co", email: `bl-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Khetify Agro" },
  });
  companyId = c._id;
  bhopal = await Warehouse.create({ companyId, name: "Bhopal Warehouse", code: "BHO" });
  productId = (await Product.create({ companyId, productName: "Urea", skuNumber: "URE494" }))._id;
});

/** The reported lot: 4 boxes × 250, its number declaring SKU0001~SKU1000. */
async function reportedLot() {
  return lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: bhopal._id, qty: 1000,
    lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
    hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 250,
    lotSegments: [
      { key: "company", type: "value", value: "BHO" },
      { key: "sku", type: "range", mode: "variable", prefix: "SKU", digits: 4 },
    ],
  });
}

/** The unit codes of one box, in unit order. */
const codesInBox = async (lotId, boxSerial) => {
  const [box] = await BulkPackage.find({ lot_id: lotId, box_serial: boxSerial });
  const units = await UnitSerial.find({ bulk_packaging_record_id: box._id }).sort({ unit_serial: 1 });
  return units.map((u) => u.unit_code || u.serial);
};

describe("every box is labelled at lot creation", () => {
  test("all four boxes get their labels, without anyone pressing Generate", async () => {
    const inv = await reportedLot();

    expect(await UnitSerial.countDocuments({ inventoryId: inv._id })).toBe(1000);
    for (const serial of [1, 2, 3, 4]) {
      expect(await codesInBox(inv._id, serial)).toHaveLength(250);
    }
  });

  test("numbering runs continuously across the lot, never restarting per box", async () => {
    // The lot number declares ONE range (…-SKU0001~SKU1000), so the units have
    // to actually run 1…1000 across the whole lot.
    const inv = await reportedLot();

    const box1 = await codesInBox(inv._id, 1);
    const box3 = await codesInBox(inv._id, 3);

    expect(box1[0]).toContain("SKU0001");
    expect(box1[249]).toContain("SKU0250");
    expect(box3[0]).toContain("SKU0501");
    expect(box3[249]).toContain("SKU0750");

    // …and every number 1…1000 exists exactly once.
    const serials = await UnitSerial.find({ inventoryId: inv._id }).select("unit_serial").lean();
    const seen = new Set(serials.map((u) => u.unit_serial));
    expect(seen.size).toBe(1000);
    expect(Math.min(...seen)).toBe(1);
    expect(Math.max(...seen)).toBe(1000);
  });

  test("a SINGLE-PACKAGE lot is labelled at creation too", async () => {
    // This used to assert the opposite. Minting was gated on the packaging
    // object — null when bulk packaging is off — so a single-package lot came
    // out of Create Lot with no codes and the Labels page opened on "0 of 40".
    // Nothing about how a lot is packed decides whether its units get an
    // identity; see tests/singlePackageUnitLabels.test.js for the full rule.
    const inv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: bhopal._id, qty: 40,
      lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
    });
    expect(await UnitSerial.countDocuments({ inventoryId: inv._id })).toBe(40);
    // No boxes, so nothing points at one.
    expect(await BulkPackage.countDocuments({ lot_id: inv._id })).toBe(0);
  });

  test("a caller that does not opt in keeps the on-demand flow too", async () => {
    // GRN postings, the seeder and internal callers must be unaffected.
    const inv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: bhopal._id, qty: 500,
      lotOrigin: "company", pendingReceipt: true,
      hasBulkPackaging: true, numberOfBoxes: 2, unitsPerBox: 250,
    });
    expect(await UnitSerial.countDocuments({ inventoryId: inv._id })).toBe(0);
  });
});

describe("repairing a lot that was only partly labelled", () => {
  test("the shortfall lands in the boxes that lack labels, continuing the numbering", async () => {
    // Reproduce a LEGACY lot exactly: nothing minted at creation, then an
    // operator generated 250 — which filled box 1 and stopped. Both the labels
    // and the counter are rewound, because that is the real state on disk: a
    // lot that never minted 1000 never advanced its counter past 250 either.
    const inv = await reportedLot();
    await UnitSerial.deleteMany({ inventoryId: inv._id });
    await Counter.deleteMany({ companyId });
    await barcodeService.generateUnits(companyId, inv._id, 250, {});
    expect(await UnitSerial.countDocuments({ inventoryId: inv._id })).toBe(250);
    const box1 = await codesInBox(inv._id, 1);
    expect(await codesInBox(inv._id, 3)).toHaveLength(0);

    const r = await barcodeService.ensureLotUnitLabels(companyId, inv._id, {});
    expect(r.generated).toBe(750);

    // Box 1 untouched; the rest filled in, still continuing 251…1000.
    expect(await codesInBox(inv._id, 1)).toEqual(box1);
    expect(await codesInBox(inv._id, 3)).toHaveLength(250);
    const box3 = await codesInBox(inv._id, 3);
    expect(box3[0]).toContain("SKU0501");
    expect(box3[249]).toContain("SKU0750");
  });

  test("running the repair on a complete lot mints nothing", async () => {
    const inv = await reportedLot();
    const before = await UnitSerial.countDocuments({ inventoryId: inv._id });

    const r = await barcodeService.ensureLotUnitLabels(companyId, inv._id, {});
    expect(r.generated).toBe(0);
    expect(await UnitSerial.countDocuments({ inventoryId: inv._id })).toBe(before);
  });

  test("Unit Labels equals what was actually minted", async () => {
    const inv = await reportedLot();
    const minted = await UnitSerial.countDocuments({ companyId, inventoryId: inv._id });
    const fresh = await Inventory.findById(inv._id);
    // Packaging Summary's Unit Labels is the count of real UnitSerial rows, so
    // once every box is minted it equals the lot's created quantity.
    expect(minted).toBe(fresh.originalQuantity);
  });
});
