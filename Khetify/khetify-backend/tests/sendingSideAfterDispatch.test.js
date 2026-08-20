/**
 * THE SENDING WAREHOUSE'S VIEW, THE MOMENT STOCK LEAVES.
 *
 * Dispatch drops the source's Inventory quantity straight away, but it keeps
 * each moved unit's `inventoryId` pointing at the sending row until the far end
 * receives it — that link is what makes the receipt possible. Three places read
 * "still points at this row" as "is still here", so a warehouse that had sent
 * six of its ten units went on showing all ten, all five boxes, and every label:
 *
 *   Lot Details → Bulk Packaging IDs   (the box cards' unit codes)
 *   Barcodes & Labels                  (the printable list)
 *   Packaging Summary                  (the counts)
 *
 * The receiving side and the company are deliberately NOT affected: the goods
 * are still the company's, and the destination row is a separate question.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const Shipment = require("../model/Transport/Shipment");
const lotService = require("../services/lotService");
const shipmentService = require("../services/shipmentService");
const barcodeService = require("../services/barcodeService");
const bulkPackageService = require("../services/bulkPackageService");
const lotCtrl = require("../controller/Inventory/lotController");
const barcodeCtrl = require("../controller/Barcode/barcodeController");
const notificationService = require("../services/notificationService");

let companyId, bhopal, indore, productId, actor;

beforeEach(() => {
  jest.spyOn(notificationService, "notifyWarehouseTeam").mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `ssd-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
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
const whUser = () => ({ id: companyId, companyId, role: "warehouse_manager" });
const coUser = () => ({ id: companyId, companyId, role: "company_admin" });

const detailsOf = async (lotRowId, user = whUser()) => {
  const res = mockRes();
  await lotCtrl.lotDetails({ params: { id: lotRowId }, user }, res);
  return res.body.data;
};
const labelsOf = async (lotRowId, user = whUser()) => {
  const res = mockRes();
  await barcodeCtrl.list({ query: { inventoryId: String(lotRowId), limit: 10000 }, user }, res);
  return res.body.data;
};

/** The reported lot: 5 boxes × 2 units = 10 at Bhopal, received and labelled. */
async function lotAtBhopal({ qty = 10, boxes = 5, perBox = 2 } = {}) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: bhopal._id, qty,
    lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
    ...(boxes ? { hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox } : {}),
  });
  await Inventory.updateOne(
    { _id: inv._id },
    { $set: { inTransitStock: 0, offlineStock: qty, availableStock: qty } }
  );
  await BulkPackage.updateMany(
    { lot_id: inv._id },
    { $set: { status: "received", warehouse_id: bhopal._id } }
  );
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

/** Dispatch `n` units of this lot to Indore. Nothing is received. */
async function dispatch(lot, n) {
  const ship = await shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", toLabel: "Indore",
    fromWarehouseId: bhopal._id, toWarehouseId: indore._id,
    lines: [{ inventoryId: lot._id, qty: n }],
  });
  const serials = (await UnitSerial.find({ inventoryId: lot._id }).sort({ unit_serial: 1 }).limit(n).lean())
    .map((u) => u.serial);
  await shipmentService.dispatchShipment(companyId, ship._id, { scannedCodes: serials, performedBy: actor });
  return { ship: await Shipment.findById(ship._id), serials };
}

const receiveAll = async (ship) =>
  shipmentService.verifyReceipt(companyId, ship._id, {
    qr: `${ship._id}.${ship.qrToken}`, warehouseId: String(indore._id),
    verifierId: actor, performedBy: actor,
  });

const codesOn = (d) => [
  ...d.bulkPackages.flatMap((b) => b.unit_codes || []),
  ...(d.looseUnitGroups || []).flatMap((g) => g.codes),
  ...(d.looseUnitCodes || []),
];

/* ---------------------------------------------------- Lot Details */

describe("Lot Details drops what has left", () => {
  test("before dispatch it shows all 5 boxes and 10 units", async () => {
    const lot = await lotAtBhopal();

    const d = await detailsOf(lot._id);
    expect(d.bulkPackages).toHaveLength(5);
    expect(codesOn(d)).toHaveLength(10);
  });

  test("6 units dispatched — 2 whole boxes and 4 units remain", async () => {
    const lot = await lotAtBhopal();
    await dispatch(lot, 6);

    const d = await detailsOf(lot._id);
    expect(d.bulkPackages).toHaveLength(2);
    expect(codesOn(d)).toHaveLength(4);
    // …and it agrees with the Inventory quantity, which already dropped.
    expect((await Inventory.findById(lot._id)).availableStock).toBe(4);
  });

  test("a dispatched unit's code appears nowhere on the page", async () => {
    const lot = await lotAtBhopal();
    const { serials } = await dispatch(lot, 6);

    const shown = new Set(codesOn(await detailsOf(lot._id)));
    for (const s of serials) expect(shown.has(s)).toBe(false);
  });

  test("PARTIAL BOX — it stays, with only the units still here", async () => {
    const lot = await lotAtBhopal();
    await dispatch(lot, 5);   // 2 whole boxes + half of the third

    const d = await detailsOf(lot._id);
    expect(codesOn(d)).toHaveLength(5);
    // The half-empty carton is still named, as a group carrying its box id and
    // the one unit it still holds — never as a whole-carton card.
    const half = (d.looseUnitGroups || []).find((g) => g.codes.length === 1);
    expect(half).toBeTruthy();
    expect(half.bulkPackagingId).toBeTruthy();
    expect(half.unitsInBox).toBe(2);
  });

  test("dispatching everything empties the page", async () => {
    const lot = await lotAtBhopal();
    await dispatch(lot, 10);

    const d = await detailsOf(lot._id);
    expect(d.bulkPackages).toHaveLength(0);
    expect(codesOn(d)).toHaveLength(0);
  });
});

/* --------------------------------------------------- Barcodes & Labels */

describe("the Labels page drops what has left", () => {
  test("10 before, 4 after", async () => {
    const lot = await lotAtBhopal();
    expect(await labelsOf(lot._id)).toHaveLength(10);

    await dispatch(lot, 6);
    expect(await labelsOf(lot._id)).toHaveLength(4);
  });

  test("the COMPANY still sees every label of the lot", async () => {
    const lot = await lotAtBhopal();
    await dispatch(lot, 6);

    // Identity-scoped: the goods are still the company's, just elsewhere.
    expect(await labelsOf(lot._id, coUser())).toHaveLength(10);
  });
});

/* -------------------------------------------------- Packaging Summary */

describe("Packaging Summary follows the shelf", () => {
  /**
   * ONLY UNIT LABELS MOVES.
   *
   * The box figures record what this warehouse RECEIVED, and sending stock
   * onward does not change that. These briefly asserted the opposite — every
   * count falling with the stock — which rewrote the receipt history and left
   * nothing saying what had arrived. What is physically still here is the Bulk
   * Packaging IDs section's answer, asserted above.
   */
  test("the receipt figures hold; only UNIT LABELS falls", async () => {
    const lot = await lotAtBhopal();
    const before = await bulkPackageService.summaryForLot(companyId, lot._id, { warehouseId: bhopal._id });
    expect(before).toMatchObject({
      totalBoxes: 5, receivedBoxes: 5, pendingBoxes: 0,
      receivedUnits: 10, pendingUnits: 0, unitLabels: 10, unitsPerBox: 2,
    });

    await dispatch(lot, 6);

    const after = await bulkPackageService.summaryForLot(companyId, lot._id, { warehouseId: bhopal._id });
    expect(after).toMatchObject({
      totalBoxes: 5, receivedBoxes: 5, pendingBoxes: 0,
      receivedUnits: 10, pendingUnits: 0, unitsPerBox: 2,
      // The one live figure — what is on the shelf now.
      unitLabels: 4,
    });
  });

  test("a PARTIAL box leaves the receipt figures alone too", async () => {
    const lot = await lotAtBhopal();
    await dispatch(lot, 5);

    const s = await bulkPackageService.summaryForLot(companyId, lot._id, { warehouseId: bhopal._id });
    expect(s).toMatchObject({ totalBoxes: 5, receivedBoxes: 5, receivedUnits: 10 });
    expect(s.unitLabels).toBe(5);
  });

  test("dispatching everything still reports the full receipt", async () => {
    const lot = await lotAtBhopal();
    await dispatch(lot, 10);

    const s = await bulkPackageService.summaryForLot(companyId, lot._id, { warehouseId: bhopal._id });
    expect(s).toMatchObject({ totalBoxes: 5, receivedBoxes: 5, receivedUnits: 10 });
    expect(s.unitLabels).toBe(0);
  });

  test("an UNRECEIVED lot still reports everything pending", async () => {
    const inv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: bhopal._id, qty: 10,
      lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
      hasBulkPackaging: true, numberOfBoxes: 5, unitsPerBox: 2,
    });
    await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { warehouse_id: bhopal._id } });

    const s = await bulkPackageService.summaryForLot(companyId, inv._id, { warehouseId: bhopal._id });
    expect(s).toMatchObject({ totalBoxes: 5, receivedBoxes: 0, pendingBoxes: 5, pendingUnits: 10 });
    // Their labels exist here even though nothing has been received.
    expect(s.unitLabels).toBe(10);
  });

  test("the lot-wide roll-up (receiveBox / incoming box) is unchanged", async () => {
    const lot = await lotAtBhopal();
    await dispatch(lot, 6);

    // No warehouseId — the receiving-progress figure, still on capacity.
    const s = await bulkPackageService.summaryForLot(companyId, lot._id);
    expect(s).toMatchObject({ totalBoxes: 5, receivedBoxes: 5, receivedUnits: 10 });
  });
});

/* ------------------------------------------- the far end, and coming back */

describe("the receiving side and the round trip", () => {
  test("after receipt the stock shows at INDORE and not at Bhopal", async () => {
    const lot = await lotAtBhopal();
    const { ship } = await dispatch(lot, 6);
    await receiveAll(ship);

    const dest = await Inventory.findOne({ ownerId: companyId, warehouseId: indore._id, batchNumber: lot.batchNumber });
    expect(codesOn(await detailsOf(dest._id))).toHaveLength(6);
    expect(codesOn(await detailsOf(lot._id))).toHaveLength(4);
    expect(await labelsOf(dest._id)).toHaveLength(6);
  });

  test("the COMPANY still reads one whole lot of 10 across both", async () => {
    const lot = await lotAtBhopal();
    const { ship } = await dispatch(lot, 6);
    await receiveAll(ship);

    const s = await bulkPackageService.summaryForLot(companyId, lot._id, { identityScope: true });
    expect(s.unitLabels).toBe(10);
    expect(s.totalBoxes).toBe(5);
  });

  test("ROLLBACK — units flagged back from shipped reappear at Bhopal", async () => {
    const lot = await lotAtBhopal();
    const { serials } = await dispatch(lot, 6);

    expect(codesOn(await detailsOf(lot._id))).toHaveLength(4);

    // There is no cancel/reject flow today (see the summary), so this is the
    // state such a flow would have to restore: the units never left the row, so
    // clearing `shipped` is all it takes for them to be here again.
    await UnitSerial.updateMany(
      { serial: { $in: serials } },
      { $set: { status: "in_stock", currentShipmentId: null } }
    );
    await Inventory.updateOne({ _id: lot._id }, { $inc: { offlineStock: 6, availableStock: 6 } });

    const d = await detailsOf(lot._id);
    expect(codesOn(d)).toHaveLength(10);
    expect(d.bulkPackages).toHaveLength(5);
    expect(await labelsOf(lot._id)).toHaveLength(10);
  });
});
