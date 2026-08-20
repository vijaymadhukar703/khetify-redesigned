const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const svc = require("../services/sellerTraceService");
const { NO_ACCESS } = require("../services/sellerTraceService");

let companyId, sellerId, otherSellerId, productId, sellerWh, companyWh;

/**
 * A seller lot with `sellerUnits` units the seller holds. When `boxes` is set,
 * the units carry the company Bulk Packaging references — exactly as
 * supplyTransfer leaves them (owner re-pointed to the seller, box refs kept).
 */
async function makeSellerLot({ sellerUnits, boxes, perBox, companyUnitsPerBox } = {}) {
  const lot = await Inventory.create({
    productId, ownerType: "seller", ownerId: sellerId, warehouseId: sellerWh._id,
    lotNumber: "KH-BHO-PRE785-2026-07-0004", batchNumber: "KH-BHO-PRE785-2026-07-0004",
    mfgBatchNo: "MB-77", mfgDate: new Date("2026-06-01"), expiryDate: new Date("2028-06-01"),
    offlineStock: sellerUnits, availableStock: sellerUnits, has_bulk_packaging: !!boxes,
    number_of_boxes: boxes || null, units_per_box: perBox || null,
  });

  if (boxes) {
    // The COMPANY's boxes (company-owned records), each originally holding
    // `companyUnitsPerBox` units — the seller only receives some of them.
    let received = 0;
    for (let b = 1; b <= boxes; b++) {
      const box = await BulkPackage.create({
        company_id: companyId, product_id: productId,
        lot_id: new mongoose.Types.ObjectId(), // the company lot (not needed here)
        lot_number: lot.lotNumber,
        bulk_packaging_id: `${lot.lotNumber}-BP-${String(b).padStart(3, "0")}`,
        box_serial: b, units_in_box: companyUnitsPerBox, status: "received",
        warehouse_id: companyWh._id,
      });
      for (let u = 1; u <= perBox && received < sellerUnits; u++, received++) {
        const code = `${box.bulk_packaging_id}-${String(u).padStart(3, "0")}`;
        await UnitSerial.create({
          companyId, ownerType: "seller", ownerId: sellerId,
          serial: code, unit_code: code, unit_serial: u, box_serial: b,
          bulk_packaging_id: box.bulk_packaging_id, bulk_packaging_record_id: box._id,
          productId, inventoryId: lot._id, lotNumber: lot.lotNumber, status: "in_stock",
        });
        await UnitEvent.create({ companyId, serial: code, event: "supplied_to_seller", toStatus: "in_stock", refType: "SupplyOrder", refId: new mongoose.Types.ObjectId(), at: new Date("2026-07-05") });
      }
    }
  } else {
    for (let u = 1; u <= sellerUnits; u++) {
      const code = `${lot.lotNumber}-${String(u).padStart(3, "0")}`;
      await UnitSerial.create({
        companyId, ownerType: "seller", ownerId: sellerId,
        serial: code, unit_code: code, unit_serial: u,
        productId, inventoryId: lot._id, lotNumber: lot.lotNumber, status: "in_stock",
      });
      await UnitEvent.create({ companyId, serial: code, event: "supplied_to_seller", toStatus: "in_stock", refType: "SupplyOrder", refId: new mongoose.Types.ObjectId(), at: new Date("2026-07-05") });
    }
  }
  return lot;
}

beforeEach(async () => {
  const co = await Company.create({ fullName: "Owner", email: `st-${new mongoose.Types.ObjectId()}@x.com`, password: "x", companyInfo: { companyName: "Bhoomi AgriTech" } });
  companyId = co._id;
  sellerId = new mongoose.Types.ObjectId();
  otherSellerId = new mongoose.Types.ObjectId();
  productId = (await Product.create({ companyId, productName: "Premium Basmati Rice", category: "Seeds", mrp: 270 }))._id;
  companyWh = await Warehouse.create({ companyId, name: "Khargone", code: "KHA" });
  sellerWh = await Warehouse.create({ sellerId, name: "Seller WH", code: "SWH" });
  await UnitSerial.syncIndexes();
  await BulkPackage.syncIndexes();
});

describe("access control", () => {
  test("a seller can open their OWN lot", async () => {
    const lot = await makeSellerLot({ sellerUnits: 5 });
    const d = await svc.getLotDetails(sellerId, lot._id);
    expect(d.lot.lotNumber).toBe(lot.lotNumber);
  });

  test("a seller cannot open ANOTHER seller's lot", async () => {
    const lot = await makeSellerLot({ sellerUnits: 5 });
    await expect(svc.getLotDetails(otherSellerId, lot._id)).rejects.toThrow(NO_ACCESS);
  });

  test("a company inventory row is NOT reachable through the seller endpoint", async () => {
    const companyLot = await Inventory.create({
      productId, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id,
      lotNumber: "CO-1", batchNumber: "CO-1", availableStock: 100,
    });
    await expect(svc.getLotDetails(sellerId, companyLot._id)).rejects.toThrow(NO_ACCESS);
  });

  test("a bad id is a 403, not a 500", async () => {
    await expect(svc.getLotDetails(sellerId, "not-an-id")).rejects.toMatchObject({ status: 403 });
  });

  test("a warehouse-scoped manager cannot open a lot outside their warehouses", async () => {
    const lot = await makeSellerLot({ sellerUnits: 5 });
    await expect(svc.getLotDetails(sellerId, lot._id, { allowedWarehouseIds: [new mongoose.Types.ObjectId()] }))
      .rejects.toThrow(NO_ACCESS);
  });
});

describe("lot + stock summary", () => {
  test("summary reflects the seller's own product/lot data", async () => {
    const lot = await makeSellerLot({ sellerUnits: 30 });
    const d = await svc.getLotDetails(sellerId, lot._id);
    expect(d.lot.productName).toBe("Premium Basmati Rice");
    expect(d.lot.productCode).toBeTruthy();
    expect(d.lot.category).toBe("Seeds");
    expect(d.lot.batchNumber).toBe("MB-77");
    expect(d.lot.supplyingCompany).toBe("Bhoomi AgriTech");
    expect(d.lot.receivedAt).toBeTruthy();
    expect(d.lot.packagingType).toBe("Single Package / Direct Lot Units");
    expect(d.lot.isBulk).toBe(false);
  });

  test("received vs current are separate; sold/damaged drop out of current", async () => {
    const lot = await makeSellerLot({ sellerUnits: 50 });
    // 20 leave the seller (sold / damaged); 30 remain.
    const codes = await UnitSerial.find({ inventoryId: lot._id }).limit(20).lean();
    await UnitSerial.updateMany({ _id: { $in: codes.slice(0, 15).map((c) => c._id) } }, { $set: { status: "sold" } });
    await UnitSerial.updateMany({ _id: { $in: codes.slice(15, 20).map((c) => c._id) } }, { $set: { status: "damaged" } });

    const d = await svc.getLotDetails(sellerId, lot._id);
    expect(d.stock.totalUnitsReceived).toBe(50);
    expect(d.stock.currentUnits).toBe(30);
  });

  test("current quantity is the seller's, NEVER the company original quantity", async () => {
    const lot = await makeSellerLot({ sellerUnits: 30 });
    const d = await svc.getLotDetails(sellerId, lot._id);
    // The lot's availableStock is 30 — nothing here reads a company-wide number.
    expect(d.stock.currentQuantity).toBe(30);
    expect(d).not.toHaveProperty("companyAvailable");
  });
});

describe("bulk packaging — seller sees only their own units", () => {
  test("a box originally 50, seller received 10 → counts are the seller's 10", async () => {
    // 1 box, seller got 10 of the 50 that box originally held.
    const lot = await makeSellerLot({ sellerUnits: 10, boxes: 1, perBox: 10, companyUnitsPerBox: 50 });
    const d = await svc.getLotDetails(sellerId, lot._id);

    expect(d.lot.isBulk).toBe(true);
    expect(d.bulkPackages).toHaveLength(1);
    const box = d.bulkPackages[0];
    expect(box.unitsOriginallyInPackage).toBe(50);
    expect(box.unitsReceivedBySeller).toBe(10);
    expect(box.currentUnitsWithSeller).toBe(10);
    expect(box.sourceWarehouse).toBe("Khargone");
  });

  test("a box the seller received NO units from is not shown", async () => {
    // 2 boxes exist but the seller only got units from box 1.
    const lot = await makeSellerLot({ sellerUnits: 5, boxes: 2, perBox: 5, companyUnitsPerBox: 5 });
    // Above put 5 units into box 1 only (sellerUnits stops at 5).
    const d = await svc.getLotDetails(sellerId, lot._id);
    expect(d.bulkPackages).toHaveLength(1);
    expect(d.bulkPackages[0].boxSerial).toBe(1);
  });

  test("package units endpoint returns ONLY the seller's units of that box", async () => {
    const lot = await makeSellerLot({ sellerUnits: 10, boxes: 1, perBox: 10, companyUnitsPerBox: 50 });
    const d = await svc.getLotDetails(sellerId, lot._id);
    const box = d.bulkPackages[0];

    const r = await svc.getPackageUnits(sellerId, lot._id, box.bulkPackageId, { page: 1, limit: 50 });
    expect(r.total).toBe(10);            // never the 50 the box originally held
    expect(r.data).toHaveLength(10);
    expect(r.data.every((u) => u.bulkPackagingId === box.bulkPackagingId)).toBe(true);
  });

  test("another seller cannot read this seller's package units", async () => {
    const lot = await makeSellerLot({ sellerUnits: 10, boxes: 1, perBox: 10, companyUnitsPerBox: 50 });
    const d = await svc.getLotDetails(sellerId, lot._id);
    await expect(svc.getPackageUnits(otherSellerId, lot._id, d.bulkPackages[0].bulkPackageId, {}))
      .rejects.toThrow(NO_ACCESS);
  });
});

describe("non-bulk lot units", () => {
  test("units endpoint paginates the seller's lot units", async () => {
    const lot = await makeSellerLot({ sellerUnits: 60 });
    const p1 = await svc.getLotUnits(sellerId, lot._id, { page: 1, limit: 25 });
    expect(p1.total).toBe(60);
    expect(p1.data).toHaveLength(25);
    expect(p1.totalPages).toBe(3);

    const p3 = await svc.getLotUnits(sellerId, lot._id, { page: 3, limit: 25 });
    expect(p3.data).toHaveLength(10);
  });

  test("search narrows by unit code", async () => {
    const lot = await makeSellerLot({ sellerUnits: 30 });
    const r = await svc.getLotUnits(sellerId, lot._id, { page: 1, limit: 50, search: "-001" });
    expect(r.data.length).toBe(1);
    expect(r.data[0].unitCode.endsWith("-001")).toBe(true);
  });

  test("units carry received + current status", async () => {
    const lot = await makeSellerLot({ sellerUnits: 3 });
    const r = await svc.getLotUnits(sellerId, lot._id, {});
    expect(r.data[0].receivedStatus).toBe("received");
    expect(r.data[0].currentStatus).toBe("in_stock");
  });
});

describe("traceability history", () => {
  test("shows the seller's received event and hides internal ones", async () => {
    const lot = await makeSellerLot({ sellerUnits: 5 });
    // An internal company event that must NOT surface for the seller.
    const someSerial = (await UnitSerial.findOne({ inventoryId: lot._id })).serial;
    await UnitEvent.create({ companyId, serial: someSerial, event: "picked", toStatus: "picked", at: new Date("2026-07-04") });

    const hist = await svc.getHistory(sellerId, lot._id);
    const labels = hist.map((h) => h.event);
    expect(labels).toContain("Received by Seller");
    expect(labels).not.toContain("picked");
  });

  test("sold and returned events surface for the seller", async () => {
    const lot = await makeSellerLot({ sellerUnits: 4 });
    const serials = (await UnitSerial.find({ inventoryId: lot._id }).lean()).map((u) => u.serial);
    await UnitEvent.create({ companyId, serial: serials[0], event: "sold", toStatus: "sold", at: new Date("2026-07-06") });
    await UnitEvent.create({ companyId, serial: serials[1], event: "returned", toStatus: "returned", at: new Date("2026-07-07") });

    const hist = await svc.getHistory(sellerId, lot._id);
    const labels = hist.map((h) => h.event);
    expect(labels).toContain("Unit Sold");
    expect(labels).toContain("Unit Returned");
  });

  test("another seller gets no history for this lot", async () => {
    const lot = await makeSellerLot({ sellerUnits: 5 });
    await expect(svc.getHistory(otherSellerId, lot._id)).rejects.toThrow(NO_ACCESS);
  });
});
