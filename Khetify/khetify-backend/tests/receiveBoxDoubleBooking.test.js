/**
 * RECEIVING A CARTON WHOSE INNER BOXES ARE ALREADY IN.
 *
 * A main carton's `units_in_box` is a ROLL-UP of the inner boxes inside it, and
 * receiveBox booked that figure wholesale. So an operator who scanned inner box
 * 1 (5 units) and then its parent carton (10) booked 15 units for 10 physical
 * ones: the lot's stock ran ahead of reality and `inTransitStock` stuck above
 * zero with nothing left to receive — the reported "10 units, 15 booked, 5
 * stranded in transit".
 *
 * The quantity now comes from the boxes a scan ACTUALLY FLIPS, so it is right
 * whichever order the cartons are scanned in.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const StockMovement = require("../model/Inventory/StockMovement");
const lotService = require("../services/lotService");
const svc = require("../services/bulkPackageService");

let companyId, warehouseId, productId;

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `rbd-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  warehouseId = (await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" }))._id;
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

/**
 * The reported lot, awaiting receipt: 2 cartons × 2 inner boxes × 5 units = 20,
 * all 20 still in transit.
 */
async function pendingLot({ qty = 20, boxes = 4, perBox = 5, mainBoxes = 2, boxesPerMain = 2 } = {}) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId, qty,
    lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
    hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox,
    ...(mainBoxes ? { mainBoxes, boxesPerMain } : {}),
  });
  await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { warehouse_id: warehouseId } });
  return Inventory.findById(inv._id);
}

const idOf = async (lot, level, serial) =>
  (await BulkPackage.findOne({ lot_id: lot._id, box_level: level, box_serial: serial })).bulk_packaging_id;

const stock = async (lot) => {
  const r = await Inventory.findById(lot._id).lean();
  return { avail: r.availableStock, offline: r.offlineStock, inTransit: r.inTransitStock };
};

const booked = async (lot) => {
  const rows = await StockMovement.find({ inventoryId: lot._id, type: "supply_in" }).lean();
  return rows.reduce((n, m) => n + Number(m.quantity || 0), 0);
};

/* ------------------------------------------------- the reported sequence */

describe("inner box first, then its parent carton", () => {
  test("books 10 for a 10-unit carton, not 15", async () => {
    const lot = await pendingLot();

    await svc.receiveBox(companyId, await idOf(lot, "inner", 1), {});   // 5
    const second = await svc.receiveBox(companyId, await idOf(lot, "main", 1), {});

    // The carton's OTHER inner box is all that is left to land.
    expect(second.receivedUnits).toBe(5);
    expect(await booked(lot)).toBe(10);
    expect(await stock(lot)).toEqual({ avail: 10, offline: 10, inTransit: 10 });
  });

  test("the whole lot lands on exactly 20, with nothing stranded", async () => {
    const lot = await pendingLot();

    await svc.receiveBox(companyId, await idOf(lot, "inner", 1), {});
    await svc.receiveBox(companyId, await idOf(lot, "main", 1), {});
    await svc.receiveBox(companyId, await idOf(lot, "inner", 3), {});
    await svc.receiveBox(companyId, await idOf(lot, "main", 2), {});

    expect(await booked(lot)).toBe(20);
    // inTransitStock reaching 0 is the thing that used to stick at 5.
    expect(await stock(lot)).toEqual({ avail: 20, offline: 20, inTransit: 0 });
  });

  test("BOTH inner boxes first, then the carton — the carton books nothing", async () => {
    const lot = await pendingLot();

    await svc.receiveBox(companyId, await idOf(lot, "inner", 1), {});
    await svc.receiveBox(companyId, await idOf(lot, "inner", 2), {});
    // Its inner boxes flipped it to "received" on the way up (step 1c), so the
    // carton can no longer be claimed at all — which is also correct.
    await expect(svc.receiveBox(companyId, await idOf(lot, "main", 1), {}))
      .rejects.toMatchObject({ status: 409 });

    expect(await booked(lot)).toBe(10);
    expect((await stock(lot)).inTransit).toBe(10);
  });

  test("no ledger row is written for a scan that lands nothing", async () => {
    const lot = await pendingLot();
    await svc.receiveBox(companyId, await idOf(lot, "inner", 1), {});
    const before = await StockMovement.countDocuments({ inventoryId: lot._id });

    await svc.receiveBox(companyId, await idOf(lot, "main", 1), {});
    // One carton scan, one ledger row — for the 5 it actually landed.
    expect(await StockMovement.countDocuments({ inventoryId: lot._id })).toBe(before + 1);
  });
});

/* ----------------------------------------------------- the other order */

describe("carton first, then its inner boxes", () => {
  test("the carton books its full 10 and the inner boxes are refused", async () => {
    const lot = await pendingLot();

    const first = await svc.receiveBox(companyId, await idOf(lot, "main", 1), {});
    expect(first.receivedUnits).toBe(10);

    // The cascade already received them, so neither can be claimed again.
    await expect(svc.receiveBox(companyId, await idOf(lot, "inner", 1), {}))
      .rejects.toMatchObject({ status: 409 });
    await expect(svc.receiveBox(companyId, await idOf(lot, "inner", 2), {}))
      .rejects.toMatchObject({ status: 409 });

    expect(await booked(lot)).toBe(10);
    expect((await stock(lot)).inTransit).toBe(10);
  });

  test("both cartons scanned — the lot lands on 20", async () => {
    const lot = await pendingLot();

    await svc.receiveBox(companyId, await idOf(lot, "main", 1), {});
    await svc.receiveBox(companyId, await idOf(lot, "main", 2), {});

    expect(await booked(lot)).toBe(20);
    expect(await stock(lot)).toEqual({ avail: 20, offline: 20, inTransit: 0 });
  });
});

/* --------------------------------------------------- shapes not to break */

describe("the shapes that must keep working", () => {
  test("a TWO-LEVEL lot's box still books its own units", async () => {
    // Every row is a 'main' box with no children — it holds its units directly.
    const lot = await pendingLot({ qty: 20, boxes: 4, perBox: 5, mainBoxes: null });

    const r = await svc.receiveBox(companyId, await idOf(lot, "main", 1), {});
    expect(r.receivedUnits).toBe(5);
    expect(await stock(lot)).toEqual({ avail: 5, offline: 5, inTransit: 15 });
  });

  test("…and all four of them land the whole lot", async () => {
    const lot = await pendingLot({ qty: 20, boxes: 4, perBox: 5, mainBoxes: null });

    for (const n of [1, 2, 3, 4]) await svc.receiveBox(companyId, await idOf(lot, "main", n), {});

    expect(await booked(lot)).toBe(20);
    expect(await stock(lot)).toEqual({ avail: 20, offline: 20, inTransit: 0 });
  });

  test("a unit is activated once, and only its own box's units", async () => {
    const lot = await pendingLot();

    await svc.receiveBox(companyId, await idOf(lot, "inner", 1), {});
    await svc.receiveBox(companyId, await idOf(lot, "main", 1), {});

    // Carton 1 holds inner boxes 1 and 2 — ten units, all in stock.
    const inStock = await UnitSerial.countDocuments({ inventoryId: lot._id, status: "in_stock" });
    expect(inStock).toBe(10);
    // Carton 2's units are untouched.
    expect(await UnitSerial.countDocuments({ inventoryId: lot._id, status: "generated" })).toBe(10);
  });

  test("receiving every box marks the lot received", async () => {
    const lot = await pendingLot();

    await svc.receiveBox(companyId, await idOf(lot, "inner", 1), {});
    await svc.receiveBox(companyId, await idOf(lot, "main", 1), {});
    await svc.receiveBox(companyId, await idOf(lot, "main", 2), {});

    const r = await Inventory.findById(lot._id).lean();
    expect(r.receiving_status).toBe("received");
    expect(r.inTransitStock).toBe(0);
  });
});
