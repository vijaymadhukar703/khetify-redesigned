/**
 * RECEIVING A TRANSFER BY SCANNING ITS CARTONS.
 *
 * One shipping label is minted per shipment, so a transfer that arrives as five
 * cartons had one barcode between them — nothing to stick it on, and no way to
 * take three today and two tomorrow. Every carton already carries its own
 * printed ID; these cover receiving by those.
 *
 * The rules that matter: a code means the same thing at both ends of the journey
 * (the resolver is shared with the dispatch scan), only units IN TRANSIT ON THIS
 * SHIPMENT can land, nothing lands twice however it is scanned, and the shipping
 * label keeps working exactly as it did.
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
const barcodeService = require("../services/barcodeService");
const shipmentService = require("../services/shipmentService");
const repackService = require("../services/repackService");
const svc = require("../services/receiveScanService");
const notificationService = require("../services/notificationService");

let companyId, srcWh, destWh, otherWh, productId, actor;

beforeEach(() => {
  jest.spyOn(notificationService, "notifyWarehouseTeam").mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `rs-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  actor = new mongoose.Types.ObjectId();
  srcWh = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  destWh = await Warehouse.create({ companyId, name: "Indore", code: "IND" });
  otherWh = await Warehouse.create({ companyId, name: "Nagpur", code: "NAG" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

/** A received, labelled lot on the source shelf. */
async function makeLot({ qty, boxes, perBox, mainBoxes, boxesPerMain } = {}) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: srcWh._id, qty,
    lotOrigin: "company", pendingReceipt: true,
    ...(boxes ? { hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox } : {}),
    ...(mainBoxes ? { mainBoxes, boxesPerMain } : {}),
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

const transferOf = (lot, qty) =>
  shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", toLabel: "Indore",
    fromWarehouseId: srcWh._id, toWarehouseId: destWh._id,
    lines: [{ inventoryId: lot._id, qty }],
  });

const serialsOf = (lot) =>
  UnitSerial.find({ inventoryId: lot._id }).sort({ unit_serial: 1 }).lean()
    .then((u) => u.map((x) => x.serial));

/** Dispatch the whole lot so it is in transit toward the destination. */
async function dispatched({ qty = 20, boxes, perBox, mainBoxes, boxesPerMain } = {}) {
  const lot = await makeLot({ qty, boxes, perBox, mainBoxes, boxesPerMain });
  const ship = await transferOf(lot, qty);
  const serials = await serialsOf(lot);
  await shipmentService.dispatchShipment(companyId, ship._id, { scannedCodes: serials, performedBy: actor });
  return { lot, ship: await Shipment.findById(ship._id), serials };
}

const scan = (ship, code, selectedCodes = []) =>
  svc.resolveReceiveScan(companyId, ship._id, { code, selectedCodes });

const land = (ship, serials) =>
  svc.receiveScannedUnits(companyId, ship._id, { serials, verifierId: actor, performedBy: actor });

const boxOf = (lot, level, boxSerial) =>
  BulkPackage.findOne({ lot_id: lot._id, ...(level ? { box_level: level } : {}), box_serial: boxSerial });

const inTransit = (ship) =>
  UnitSerial.countDocuments({ companyId, status: "shipped", currentShipmentId: ship._id });

const atDest = (lot) =>
  Inventory.findOne({ ownerId: companyId, warehouseId: destWh._id, batchNumber: lot.batchNumber }).lean();

/* --------------------------------------------------- every code resolves */

describe("the resolver accepts every level", () => {
  test("SHIPPING LABEL selects everything still in transit", async () => {
    const { ship } = await dispatched({ qty: 20 });

    const r = await scan(ship, `${ship._id}.${ship.qrToken}`);
    expect(r.scanType).toBe("shipment");
    expect(r.addedQuantity).toBe(20);
  });

  test("LOT NUMBER selects that lot's share of the transfer", async () => {
    const { lot, ship } = await dispatched({ qty: 20 });

    const r = await scan(ship, lot.lotNumber);
    expect(r.scanType).toBe("lot");
    expect(r.addedQuantity).toBe(20);
    expect(r.lotNumber).toBe(lot.lotNumber);
  });

  test("BULK PACKAGING (main) cascades through its inner boxes", async () => {
    // 2 cartons × 2 inner × 5 units.
    const { lot, ship } = await dispatched({ qty: 20, boxes: 4, perBox: 5, mainBoxes: 2, boxesPerMain: 2 });
    const main = await boxOf(lot, "main", 1);

    const r = await scan(ship, main.bulk_packaging_id);
    expect(r.scanType).toBe("bulk_package");
    expect(r.boxLevel).toBe("main");
    // THE CASCADE: a main carton owns no units of its own — all 10 come from
    // the two inner boxes inside it.
    expect(r.addedQuantity).toBe(10);
  });

  test("INNER BOX selects only its own units", async () => {
    const { lot, ship } = await dispatched({ qty: 20, boxes: 4, perBox: 5, mainBoxes: 2, boxesPerMain: 2 });
    const inner = await boxOf(lot, "inner", 1);

    const r = await scan(ship, inner.bulk_packaging_id);
    expect(r.boxLevel).toBe("inner");
    expect(r.addedQuantity).toBe(5);
  });

  test("FLAT BULK PACKAGING selects its box's units", async () => {
    const { lot, ship } = await dispatched({ qty: 20, boxes: 4, perBox: 5 });
    const box = await boxOf(lot, "main", 2);

    const r = await scan(ship, box.bulk_packaging_id);
    expect(r.addedQuantity).toBe(5);
  });

  test("REPACK BOX ID selects the carton packed at dispatch", async () => {
    const lot = await makeLot({ qty: 20 });
    const ship = await transferOf(lot, 20);
    const serials = await serialsOf(lot);
    const box = await repackService.packUnits(companyId, {
      shipmentId: ship._id, serials: serials.slice(0, 6), performedBy: actor,
    });
    await shipmentService.dispatchShipment(companyId, ship._id, { scannedCodes: serials, performedBy: actor });

    const r = await scan(await Shipment.findById(ship._id), box.repackBoxId);
    expect(r.scanType).toBe("repack");
    expect(r.repackBoxId).toBe(box.repackBoxId);
    expect(r.addedQuantity).toBe(6);
  });

  test("UNIT CODE selects one", async () => {
    const { ship, serials } = await dispatched({ qty: 20 });

    const r = await scan(ship, serials[0]);
    expect(r.scanType).toBe("unit");
    expect(r.addedQuantity).toBe(1);
  });
});

/* ------------------------------------------------------------ landing */

describe("landing what was scanned", () => {
  test("a single carton lands, and the transfer stays PARTIALLY RECEIVED", async () => {
    const { lot, ship } = await dispatched({ qty: 20, boxes: 4, perBox: 5 });
    const box = await boxOf(lot, "main", 1);

    const r = await scan(ship, box.bulk_packaging_id);
    const out = await land(ship, r.addedUnitCodes);

    expect(out.receivedNow).toBe(5);
    expect(out.status).toBe("partially_received");
    expect(out.stillInTransit).toBe(15);
    expect((await atDest(lot)).availableStock).toBe(5);
    expect(await inTransit(ship)).toBe(15);
  });

  test("PARTIAL RECEIVE CONTINUES — the rest lands on a later visit", async () => {
    const { lot, ship } = await dispatched({ qty: 20, boxes: 4, perBox: 5 });

    for (const serial of [1, 2, 3]) {
      const b = await boxOf(lot, "main", serial);
      const r = await scan(await Shipment.findById(ship._id), b.bulk_packaging_id);
      await land(await Shipment.findById(ship._id), r.addedUnitCodes);
    }
    expect((await Shipment.findById(ship._id)).status).toBe("partially_received");

    const last = await boxOf(lot, "main", 4);
    const r = await scan(await Shipment.findById(ship._id), last.bulk_packaging_id);
    const out = await land(await Shipment.findById(ship._id), r.addedUnitCodes);

    expect(out.status).toBe("received");
    expect(out.stillInTransit).toBe(0);
    expect((await atDest(lot)).availableStock).toBe(20);
  });

  test("units keep their serial and lot identity, and land in the DESTINATION row", async () => {
    const { lot, ship, serials } = await dispatched({ qty: 6 });

    const r = await scan(ship, lot.lotNumber);
    await land(ship, r.addedUnitCodes);

    const dest = await atDest(lot);
    const landed = await UnitSerial.find({ serial: { $in: serials } }).lean();
    expect(landed).toHaveLength(6);
    expect(landed.every((u) => u.status === "in_stock")).toBe(true);
    expect(landed.every((u) => String(u.inventoryId) === String(dest._id))).toBe(true);
    expect(landed.every((u) => u.currentShipmentId === null)).toBe(true);
    expect(landed.map((u) => u.serial).sort()).toEqual([...serials].sort());
  });

  test("a MAIN carton lands all 10 of its inner boxes' units in one go", async () => {
    const { lot, ship } = await dispatched({ qty: 20, boxes: 4, perBox: 5, mainBoxes: 2, boxesPerMain: 2 });
    const main = await boxOf(lot, "main", 1);

    const r = await scan(ship, main.bulk_packaging_id);
    const out = await land(ship, r.addedUnitCodes);

    expect(out.receivedNow).toBe(10);
    expect((await atDest(lot)).availableStock).toBe(10);
  });
});

/* --------------------------------------------------------- validations */

describe("what receiving refuses", () => {
  test("an item never dispatched on this transfer is refused BY NAME", async () => {
    const { ship } = await dispatched({ qty: 10 });
    // A second lot that stayed on the source shelf.
    const stranger = await makeLot({ qty: 5, boxes: 1, perBox: 5 });
    const strangerBox = await boxOf(stranger, "main", 1);

    await expect(scan(ship, strangerBox.bulk_packaging_id)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("is not part of transfer SH-"),
    });
  });

  test("ALREADY RECEIVED — a second scan of the same carton does not double count", async () => {
    const { lot, ship } = await dispatched({ qty: 20, boxes: 4, perBox: 5 });
    const box = await boxOf(lot, "main", 1);

    const r = await scan(ship, box.bulk_packaging_id);
    await land(ship, r.addedUnitCodes);

    await expect(scan(await Shipment.findById(ship._id), box.bulk_packaging_id))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("already received") });
    expect((await atDest(lot)).availableStock).toBe(5);
  });

  test("re-landing the same serials moves no stock", async () => {
    const { lot, ship } = await dispatched({ qty: 6 });
    const r = await scan(ship, lot.lotNumber);
    await land(ship, r.addedUnitCodes);

    await expect(land(await Shipment.findById(ship._id), r.addedUnitCodes))
      .rejects.toMatchObject({ status: 409 });
    expect((await atDest(lot)).availableStock).toBe(6);
  });

  test("SHIPPING LABEL FIRST, then a carton — no double receive", async () => {
    const { lot, ship } = await dispatched({ qty: 20, boxes: 4, perBox: 5 });

    const all = await scan(ship, `${ship._id}.${ship.qrToken}`);
    const out = await land(ship, all.addedUnitCodes);
    expect(out.status).toBe("received");

    const box = await boxOf(lot, "main", 1);
    await expect(scan(await Shipment.findById(ship._id), box.bulk_packaging_id))
      .rejects.toMatchObject({ status: 409 });
    expect((await atDest(lot)).availableStock).toBe(20);
  });

  test("a unit already in the dialog is not added twice", async () => {
    const { lot, ship } = await dispatched({ qty: 20, boxes: 4, perBox: 5 });
    const box = await boxOf(lot, "main", 1);

    const r = await scan(ship, box.bulk_packaging_id);
    // The whole carton is already held, so scanning one of its units adds nothing.
    await expect(scan(ship, r.addedUnitCodes[0], r.addedUnitCodes))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("already received") });
  });

  test("WRONG WAREHOUSE — a user scoped elsewhere cannot receive", async () => {
    const { lot, ship } = await dispatched({ qty: 6 });
    const r = await scan(ship, lot.lotNumber);

    await expect(svc.receiveScannedUnits(companyId, ship._id, {
      serials: r.addedUnitCodes, verifierId: actor, allowedWarehouseIds: [String(otherWh._id)],
    })).rejects.toMatchObject({ status: 403, message: expect.stringContaining("wrong warehouse") });
  });

  test("THE SOURCE cannot complete its own receipt", async () => {
    const { lot, ship } = await dispatched({ qty: 6 });
    const r = await scan(ship, lot.lotNumber);

    await expect(svc.receiveScannedUnits(companyId, ship._id, {
      serials: r.addedUnitCodes, verifierId: actor, warehouseId: String(srcWh._id),
    })).rejects.toMatchObject({ status: 403 });
  });

  test("an unknown code is refused as unknown", async () => {
    const { ship } = await dispatched({ qty: 6 });
    await expect(scan(ship, "NOT-A-REAL-CODE-0001")).rejects.toMatchObject({ status: 404 });
  });

  test("a shipment that has not been dispatched cannot be scanned in", async () => {
    const lot = await makeLot({ qty: 6 });
    const ship = await transferOf(lot, 6);
    await expect(scan(ship, lot.lotNumber)).rejects.toMatchObject({ status: 409 });
  });
});

/* ------------------------------------------------------------ progress */

describe("the progress the dialog shows", () => {
  test("the checklist counts expected, received and still-in-transit", async () => {
    const { lot, ship } = await dispatched({ qty: 20, boxes: 4, perBox: 5 });

    let list = await svc.receiveChecklist(companyId, ship._id);
    expect(list.expectedTotal).toBe(20);
    expect(list.receivedTotal).toBe(0);
    expect(list.stillInTransit).toBe(20);
    expect(list.receivable).toBe(true);
    expect(list.items[0].name).toBe("abc");

    const box = await boxOf(lot, "main", 1);
    const r = await scan(ship, box.bulk_packaging_id);
    await land(ship, r.addedUnitCodes);

    list = await svc.receiveChecklist(companyId, ship._id);
    expect(list.receivedTotal).toBe(5);
    expect(list.stillInTransit).toBe(15);
    expect(list.status).toBe("partially_received");
    expect(list.receivable).toBe(true);
  });
});

/* ------------------------------- resuming a partly-received transfer */

describe("a transfer received over two visits", () => {
  /** The reported case: 50 out, 40 in, then the operator comes back. */
  async function fortyOfFifty() {
    const { lot, ship } = await dispatched({ qty: 50, boxes: 10, perBox: 5 });
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const b = await boxOf(lot, "main", n);
      const r = await scan(await Shipment.findById(ship._id), b.bulk_packaging_id);
      await land(await Shipment.findById(ship._id), r.addedUnitCodes);
    }
    return { lot, ship: await Shipment.findById(ship._id) };
  }

  test("the transfer stays RECEIVABLE, which is what keeps the button on screen", async () => {
    const { ship } = await fortyOfFifty();

    const list = await svc.receiveChecklist(companyId, ship._id);
    expect(list.status).toBe("partially_received");
    // The one flag the Actions column reads. It said false, and the row went
    // blank with 10 units still on the road.
    expect(list.receivable).toBe(true);
  });

  test("the counter HYDRATES at 40 / 50 rather than starting from zero", async () => {
    const { ship } = await fortyOfFifty();

    const list = await svc.receiveChecklist(companyId, ship._id);
    expect(list.receivedTotal).toBe(40);
    expect(list.expectedTotal).toBe(50);
    expect(list.stillInTransit).toBe(10);
    expect(list.items[0].receivedQty).toBe(40);
    expect(list.items[0].expectedQty).toBe(50);
  });

  test("the earlier visit's stock is listed, with the date it landed", async () => {
    const { lot, ship } = await fortyOfFifty();

    const list = await svc.receiveChecklist(companyId, ship._id);
    expect(list.alreadyReceived).toHaveLength(1);
    expect(list.alreadyReceived[0]).toMatchObject({ lotNumber: lot.lotNumber, qty: 40, name: "abc" });
    expect(list.alreadyReceived[0].receivedAt).toBeTruthy();
  });

  test("the REMAINING 10 receive, and the transfer closes", async () => {
    const { lot, ship } = await fortyOfFifty();

    for (const n of [9, 10]) {
      const b = await boxOf(lot, "main", n);
      const r = await scan(await Shipment.findById(ship._id), b.bulk_packaging_id);
      await land(await Shipment.findById(ship._id), r.addedUnitCodes);
    }

    const list = await svc.receiveChecklist(companyId, ship._id);
    expect(list.status).toBe("received");
    expect(list.receivedTotal).toBe(50);
    expect(list.stillInTransit).toBe(0);
    // Only now does the row stop offering to receive.
    expect(list.receivable).toBe(false);
    expect((await atDest(lot)).availableStock).toBe(50);
  });

  test("a carton from the FIRST visit says when it was received", async () => {
    const { lot, ship } = await fortyOfFifty();
    const first = await boxOf(lot, "main", 1);

    await expect(scan(ship, first.bulk_packaging_id)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/already received on \d+ \w+ \d{4}\./),
    });
    // …and nothing is counted twice.
    expect((await atDest(lot)).availableStock).toBe(40);
  });

  test("a UNIT from the first visit says so too", async () => {
    const { lot, ship } = await fortyOfFifty();
    const box = await boxOf(lot, "main", 1);
    const [unit] = await UnitSerial.find({ bulk_packaging_record_id: box._id }).limit(1).lean();

    await expect(scan(ship, unit.serial)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("already received on"),
    });
  });
});

/* ------------------------------- the shipping-label path is untouched */

describe("the existing shipping-label flow still works", () => {
  test("verifyReceipt receives the whole transfer exactly as before", async () => {
    const { lot, ship } = await dispatched({ qty: 12 });

    const r = await shipmentService.verifyReceipt(companyId, ship._id, {
      qr: `${ship._id}.${ship.qrToken}`,
      warehouseId: String(destWh._id),
      verifierId: actor,
      performedBy: actor,
    });

    expect(r.shipment.status).toBe("received");
    expect((await atDest(lot)).availableStock).toBe(12);
  });

  test("a wrong shipping label is still refused", async () => {
    const { ship } = await dispatched({ qty: 6 });
    await expect(shipmentService.verifyReceipt(companyId, ship._id, {
      qr: "nonsense", warehouseId: String(destWh._id), verifierId: actor,
    })).rejects.toMatchObject({ status: 409 });
  });
});
