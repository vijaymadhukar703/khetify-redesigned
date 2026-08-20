/**
 * Scan-out for WAREHOUSE→WAREHOUSE transfers.
 *
 * The sending warehouse used to press Dispatch with no verification. These cover
 * what it must now scan — in particular the WHOLE-CARTON rule: a Bulk Packaging
 * ID may only stand for its box when the shipment needs every unit in it — and
 * that the DISPATCH ITSELF re-checks the scan server-side, so a stale client or
 * a second operator cannot talk their way past it.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const shipmentService = require("../services/shipmentService");
const lotService = require("../services/lotService");
const barcodeService = require("../services/barcodeService");
const scanSvc = require("../services/dispatchScanService");
const notificationService = require("../services/notificationService");

let companyId, srcWh, destWh, productId;
const driverId = new mongoose.Types.ObjectId();

beforeEach(() => {
  jest.spyOn(notificationService, "notifyWarehouseTeam").mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

beforeEach(async () => {
  // companyName is required to mint a Khetify lot number, which makeLot does.
  const c = await Company.create({
    fullName: "Co", email: `ds-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  srcWh = await Warehouse.create({ companyId, name: "Source", code: "WH1" });
  destWh = await Warehouse.create({ companyId, name: "Dest", code: "WH2" });
  productId = (await Product.create({ companyId, productName: "Urea" }))._id;
});

/** A labelled lot on the SOURCE warehouse's shelf, optionally packed in boxes. */
async function makeLot({ qty, boxes, perBox, received = true, productId: pid }) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId: pid || productId, warehouseId: srcWh._id, qty,
    lotOrigin: "company", pendingReceipt: true,
    ...(boxes ? { hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox } : {}),
  });
  if (received) {
    await Inventory.updateOne(
      { _id: inv._id },
      { $set: { inTransitStock: 0, offlineStock: qty, availableStock: qty } }
    );
    await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { status: "received", received_at: new Date() } });
  }
  await barcodeService.generateUnits(companyId, inv._id, qty, {});
  await UnitSerial.updateMany(
    { inventoryId: inv._id },
    { $set: { status: received ? "in_stock" : "generated" } }
  );
  return Inventory.findById(inv._id);
}

const makeTransfer = (lines) =>
  shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", fromWarehouseId: srcWh._id, toWarehouseId: destWh._id,
    toLabel: "Dest", driverId, lines,
  });

const transferOf = (lot, qty) => makeTransfer([{ inventoryId: lot._id, qty }]);

const scan = (ship, code, selectedCodes = []) =>
  scanSvc.resolveDispatchScan(companyId, ship._id, { code, selectedCodes });

const boxesOf = (lot) => BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });
const codesOf = (lot, boxSerial) =>
  UnitSerial.find({ inventoryId: lot._id, ...(boxSerial ? { box_serial: boxSerial } : {}) })
    .sort({ unit_serial: 1 })
    .then((u) => u.map((x) => x.serial));

describe("what the shipment requires", () => {
  test("one row per product, carrying the quantity it must send", async () => {
    const lot = await makeLot({ qty: 10, boxes: 2, perBox: 5 });
    const ship = await transferOf(lot, 10);

    const { items, ref } = await scanSvc.dispatchChecklist(companyId, ship._id);
    expect(ref).toMatch(/^SH-/);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ productId: String(productId), name: "Urea", requiredQty: 10 });
  });

  test("two lots of the same product roll up into one row", async () => {
    const a = await makeLot({ qty: 6 });
    const b = await makeLot({ qty: 4 });
    const ship = await makeTransfer([
      { inventoryId: a._id, qty: 6 },
      { inventoryId: b._id, qty: 4 },
    ]);

    const { items } = await scanSvc.dispatchChecklist(companyId, ship._id);
    expect(items).toHaveLength(1);
    expect(items[0].requiredQty).toBe(10);
  });
});

describe("a Bulk Packaging ID is all-or-nothing", () => {
  test("a box the shipment needs in full adds every unit in it", async () => {
    const lot = await makeLot({ qty: 6, boxes: 2, perBox: 3 });
    const ship = await transferOf(lot, 6);
    const [box1] = await boxesOf(lot);

    const r = await scan(ship, box1.bulk_packaging_id);
    expect(r.scanType).toBe("bulk_package");
    expect(r.addedQuantity).toBe(3);
    expect(r.remainingRequired).toBe(3);
  });

  test("a 3-unit box against a 1-unit requirement is REFUSED", async () => {
    // The reported bug: the whole carton is not going out, so its ID must not
    // tick the line off.
    const lot = await makeLot({ qty: 3, boxes: 1, perBox: 3 });
    const ship = await transferOf(lot, 1);
    const [box1] = await boxesOf(lot);

    await expect(scan(ship, box1.bulk_packaging_id)).rejects.toThrow(
      `This shipment needs 1 of 3 units from ${box1.bulk_packaging_id}. Scan the individual unit codes instead.`
    );
  });

  test("…and the individual unit codes are accepted one at a time", async () => {
    const lot = await makeLot({ qty: 3, boxes: 1, perBox: 3 });
    const ship = await transferOf(lot, 1);
    const codes = await codesOf(lot, 1);

    const r = await scan(ship, codes[2]);
    expect(r.scanType).toBe("unit");
    expect(r.addedQuantity).toBe(1);
    expect(r.remainingRequired).toBe(0);
  });

  test("a box is refused once the remaining requirement is smaller than it", async () => {
    // 4 required from 2 boxes of 3: the first box fits, the second does not.
    const lot = await makeLot({ qty: 6, boxes: 2, perBox: 3 });
    const ship = await transferOf(lot, 4);
    const [box1, box2] = await boxesOf(lot);

    const first = await scan(ship, box1.bulk_packaging_id);
    expect(first.addedQuantity).toBe(3);

    await expect(scan(ship, box2.bulk_packaging_id, first.addedUnitCodes))
      .rejects.toThrow(/needs 1 of 3 units/);
  });
});

describe("unit scans are validated too", () => {
  test("a unit of ANOTHER PRODUCT is refused", async () => {
    // The stock this shipment may draw on is every lot of ITS OWN products on
    // the source shelf (see dispatchScanService.shipmentContext) — so what makes
    // a code foreign is the product, not which lot the plan happened to name.
    const lot = await makeLot({ qty: 3, boxes: 1, perBox: 3 });
    const otherProductId = (await Product.create({ companyId, productName: "Potash" }))._id;
    const stranger = await makeLot({ qty: 3, boxes: 1, perBox: 3, productId: otherProductId });
    const ship = await transferOf(lot, 3);
    const foreign = await codesOf(stranger, 1);

    await expect(scan(ship, foreign[0]))
      .rejects.toThrow(new RegExp(`${foreign[0]} is not on shipment SH-`));
  });

  test("a unit from ANOTHER LOT OF THE SAME PRODUCT on this shelf is accepted", async () => {
    // The planned lines are an earliest-expiry allocation, not a picking list.
    // The operator may take the product out of whichever of its lots is actually
    // to hand; the dispatch then deducts from the lot the units came out of.
    const lot = await makeLot({ qty: 3, boxes: 1, perBox: 3 });
    const sibling = await makeLot({ qty: 3, boxes: 1, perBox: 3 });
    const ship = await transferOf(lot, 3);
    const other = await codesOf(sibling, 1);

    const r = await scan(ship, other[0]);
    expect(r.scanType).toBe("unit");
    expect(r.addedQuantity).toBe(1);
    expect(r.lotId).toBe(String(sibling._id));
  });

  test("the same unit twice is refused", async () => {
    const lot = await makeLot({ qty: 3, boxes: 1, perBox: 3 });
    const ship = await transferOf(lot, 3);
    const codes = await codesOf(lot, 1);

    const first = await scan(ship, codes[0]);
    await expect(scan(ship, codes[0], first.addedUnitCodes)).rejects.toThrow(/has already been scanned/);
  });

  test("a unit in a box the warehouse never received is refused", async () => {
    const lot = await makeLot({ qty: 3, boxes: 1, perBox: 3, received: false });
    const ship = await transferOf(lot, 3);
    const codes = await codesOf(lot, 1);

    await expect(scan(ship, codes[0])).rejects.toThrow(/has not been received yet/);
  });

  test("a unit that is not in stock is refused", async () => {
    const lot = await makeLot({ qty: 3, boxes: 1, perBox: 3 });
    const ship = await transferOf(lot, 3);
    const codes = await codesOf(lot, 1);
    await UnitSerial.updateOne({ serial: codes[0] }, { $set: { status: "damaged" } });

    await expect(scan(ship, codes[0])).rejects.toThrow(/is not available \(damaged\)/);
  });

  test("scanning past the requirement is refused", async () => {
    const lot = await makeLot({ qty: 3, boxes: 1, perBox: 3 });
    const ship = await transferOf(lot, 1);
    const codes = await codesOf(lot, 1);

    const first = await scan(ship, codes[0]);
    await expect(scan(ship, codes[1], first.addedUnitCodes)).rejects.toThrow(/already been scanned/);
  });
});

describe("dispatch re-checks the scan server-side", () => {
  test("an incomplete scan is refused and nothing moves", async () => {
    const lot = await makeLot({ qty: 6, boxes: 2, perBox: 3 });
    const ship = await transferOf(lot, 6);
    const codes = await codesOf(lot, 1);

    await expect(shipmentService.dispatchShipment(companyId, ship._id, { scannedCodes: codes }))
      .rejects.toThrow(/3 of 6 scanned/);

    const after = await Inventory.findById(lot._id);
    expect(after.availableStock).toBe(6);
  });

  test("a unit that is not on the shipment cannot make up the count", async () => {
    const lot = await makeLot({ qty: 3, boxes: 1, perBox: 3 });
    const otherProductId = (await Product.create({ companyId, productName: "Potash" }))._id;
    const stranger = await makeLot({ qty: 3, boxes: 1, perBox: 3, productId: otherProductId });
    const ship = await transferOf(lot, 3);
    const mine = await codesOf(lot, 1);
    const foreign = await codesOf(stranger, 1);

    await expect(shipmentService.dispatchShipment(companyId, ship._id, {
      scannedCodes: [mine[0], mine[1], foreign[0]],
    })).rejects.toThrow(/is not on shipment SH-/);
  });

  test("a partial-quantity transfer dispatches on the units actually scanned", async () => {
    const lot = await makeLot({ qty: 3, boxes: 1, perBox: 3 });
    const ship = await transferOf(lot, 1);
    const codes = await codesOf(lot, 1);

    const r = await shipmentService.dispatchShipment(companyId, ship._id, { scannedCodes: [codes[2]] });
    expect(r.shipment.status).toBe("in_transit");

    const after = await Inventory.findById(lot._id);
    expect(after.availableStock).toBe(2);
  });

  test("a complete scan dispatches exactly as before", async () => {
    const lot = await makeLot({ qty: 6, boxes: 2, perBox: 3 });
    const ship = await transferOf(lot, 6);
    const codes = await codesOf(lot);

    const r = await shipmentService.dispatchShipment(companyId, ship._id, { scannedCodes: codes });
    expect(r.shipment.status).toBe("in_transit");
    expect(r.qrPayload).toMatch(new RegExp(`^${ship._id}\\.`));

    // Deducted from the source exactly as an unscanned dispatch always did —
    // the destination row appears only at receipt.
    const after = await Inventory.findById(lot._id);
    expect(after.availableStock).toBe(0);
    expect(await Inventory.findOne({ ownerId: companyId, warehouseId: destWh._id, productId })).toBeNull();
  });

  test("callers that send no scan keep their previous behaviour", async () => {
    // The "dispatch immediately on create" paths never scan; they must not
    // start failing because this step exists.
    const lot = await makeLot({ qty: 6, boxes: 2, perBox: 3 });
    const ship = await transferOf(lot, 6);

    const r = await shipmentService.dispatchShipment(companyId, ship._id, {});
    expect(r.shipment.status).toBe("in_transit");
  });
});
