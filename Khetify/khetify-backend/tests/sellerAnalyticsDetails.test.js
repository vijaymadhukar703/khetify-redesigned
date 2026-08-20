/**
 * Seller → Analytics → View (and Seller Warehouse → Analytics → View, which is
 * the same page, warehouse-scoped from the token).
 *
 * The View action needs the seller Stock on Hand row to carry the lot it came
 * from, and the seller lot endpoints to answer every field the details page
 * renders — including the FULL Unit IDs behind the available quantity, scoped to
 * the SELLER as owner.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const Seller = require("../model/Seller/Seller");
// Seller team members are User rows scoped by ownerType/ownerId (see sellerReports.test).
const User = require("../model/User/User");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const sellerReportService = require("../services/sellerReportService");
const reportService = require("../services/reportService");
const ctrl = require("../controller/Seller/sellerInventoryController");

let companyId, productId, sellerId, whA, whB;

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const adminReq = () => ({ user: { sellerId, principalType: "seller", role: "seller_admin" } });

const details = async (lotId, user = adminReq().user) => {
  const res = mockRes();
  await ctrl.getLotDetails({ params: { lotId }, user, query: {} }, res);
  return res;
};
const availableUnits = async (lotId, user = adminReq().user) => {
  const res = mockRes();
  await ctrl.getAvailableUnits({ params: { lotId }, user, query: {} }, res);
  return res;
};
const listed = (body) => (body.data.groups || []).flatMap((g) => g.unitIds);

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Owner", email: `sad-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  productId = (await Product.create({
    companyId, productName: "Premium Basmati Rice", skuNumber: "PBR-01",
    product_code: "PBR-01", category: "Grains", mrp: 250,
  }))._id;
  const seller = await Seller.create({
    passwordHash: "x", sellerInfo: { businessName: "Krishna Agro" },
    supplyingCompanyId: companyId, linkStatus: "approved", status: "active",
  });
  sellerId = seller._id;
  whA = await Warehouse.create({
    sellerId, name: "Krishna WH A", code: "KWA",
    address: { line1: "Main Road", city: "Bhopal", state: "MP", pincode: "462011" },
  });
  whB = await Warehouse.create({ sellerId, name: "Krishna WH B", code: "KWB" });
  await BulkPackage.syncIndexes();
  await UnitSerial.syncIndexes();
});

/**
 * A seller-owned lot with seller-owned unit labels — the state a supply receipt
 * leaves behind (shipmentService repoints ownerType/ownerId and inventoryId).
 */
async function makeSellerLot({ qty, warehouse = whA, boxed = false, lotNumber = "KH-BHO-ABC102-2026-07-0001" } = {}) {
  const lot = await Inventory.create({
    productId, ownerType: "seller", ownerId: sellerId, warehouseId: warehouse._id,
    batchNumber: lotNumber, lotNumber,
    offlineStock: qty, availableStock: qty,
    lowStockThreshold: 10, receiving_status: "received",
    mfgDate: new Date("2026-01-01"), expiryDate: new Date("2027-01-01"),
  });
  let box = null;
  if (boxed) {
    box = await BulkPackage.create({
      company_id: companyId, product_id: productId, lot_id: lot._id,
      lot_number: lot.lotNumber, bulk_packaging_id: `${lot.lotNumber}-BP-001`,
      box_serial: 1, units_in_box: qty, status: "received", warehouse_id: warehouse._id,
    });
  }
  await UnitSerial.insertMany(Array.from({ length: qty }, (_, i) => {
    const n = String(i + 1).padStart(3, "0");
    const code = boxed ? `${box.bulk_packaging_id}-${n}` : `${lot.lotNumber}-${n}`;
    return {
      companyId, ownerType: "seller", ownerId: sellerId,
      serial: code, unit_code: code, productId, inventoryId: lot._id,
      lotNumber: lot.lotNumber, batchNumber: lot.batchNumber,
      unit_serial: i + 1, status: "in_stock",
      ...(boxed && { bulk_packaging_record_id: box._id, bulk_packaging_id: box.bulk_packaging_id, box_serial: 1 }),
    };
  }));
  return { lot, box };
}

describe("the seller Stock on Hand row carries its lot", () => {
  test("_inventoryId points at the seller Inventory row", async () => {
    const { lot } = await makeSellerLot({ qty: 20 });
    const [row] = await sellerReportService.runReport("stock-on-hand", sellerId, {});
    expect(String(row._inventoryId)).toBe(String(lot._id));
  });

  test("no visible report column is added", async () => {
    await makeSellerLot({ qty: 20 });
    const [row] = await sellerReportService.runReport("stock-on-hand", sellerId, {});
    expect(Object.keys(row).filter((k) => !k.startsWith("_")))
      .toEqual(["product", "sku", "warehouse", "lot", "batch", "qty", "mrp", "value", "expiry"]);
  });

  test("the seller CSV export drops internal keys", async () => {
    await makeSellerLot({ qty: 20 });
    const rows = await sellerReportService.runReport("stock-on-hand", sellerId, {});
    const chunks = [];
    const res = { setHeader() {}, write: (s) => chunks.push(s), end: (s) => { if (s) chunks.push(s); } };
    reportService.streamCsv(res, "stock-on-hand", rows);
    expect(chunks.join("").split("\n")[0]).toBe("product,sku,warehouse,lot,batch,qty,mrp,value,expiry");
    expect(chunks.join("")).not.toContain(String(rows[0]._inventoryId));
  });
});

describe("the seller details endpoint answers every section", () => {
  test("Product Summary, Inventory Information and Stock Summary fields", async () => {
    const { lot } = await makeSellerLot({ qty: 20 });
    const { body } = await details(lot._id);
    const d = body.data;

    // 1 · Product Summary
    expect(d.lot.productName).toBe("Premium Basmati Rice");
    expect(d.lot.productCode).toBe("PBR-01");
    expect(d.lot.category).toBe("Grains");
    expect(d.lot.mrp).toBe(250);
    expect(d.lot.lotNumber).toBe("KH-BHO-ABC102-2026-07-0001");
    expect(d.lot.mfgDate).toBeTruthy();
    expect(d.lot.expiryDate).toBeTruthy();

    // 2 · Inventory Information — the ADDITIVE fields this page needed.
    expect(d.lot.sellerWarehouse).toBe("Krishna WH A");
    expect(d.stock.currentQuantity).toBe(20);
    expect(d.lot.receivingStatus).toBe("received");
    expect(d.lot.lowStockThreshold).toBe(10);

    // 3 · Stock Summary — the warehouse location parts the page flattens.
    expect(d.lot.sellerWarehouseCode).toBe("KWA");
    expect(d.lot.sellerWarehouseAddress).toMatchObject({ line1: "Main Road", city: "Bhopal" });
  });

  test("the fields Seller Lot Details already rendered are untouched", async () => {
    const { lot } = await makeSellerLot({ qty: 20 });
    const { body } = await details(lot._id);
    // Everything the existing page destructures still arrives.
    expect(body.data).toHaveProperty("lot.lotId");
    expect(body.data).toHaveProperty("lot.packagingType");
    expect(body.data).toHaveProperty("stock.totalUnitsReceived");
    expect(body.data).toHaveProperty("bulkPackages");
  });
});

describe("seller available Unit IDs", () => {
  test("lists the seller's own full Unit IDs", async () => {
    const { lot } = await makeSellerLot({ qty: 5 });
    const { body } = await availableUnits(lot._id);

    expect(body.data.availableStock).toBe(5);
    expect(body.data.labelledCount).toBe(5);
    expect(listed(body)).toEqual([
      "KH-BHO-ABC102-2026-07-0001-001",
      "KH-BHO-ABC102-2026-07-0001-002",
      "KH-BHO-ABC102-2026-07-0001-003",
      "KH-BHO-ABC102-2026-07-0001-004",
      "KH-BHO-ABC102-2026-07-0001-005",
    ]);
  });

  test("a boxed seller lot groups under its Bulk Packaging ID", async () => {
    const { lot, box } = await makeSellerLot({ qty: 4, boxed: true });
    const { body } = await availableUnits(lot._id);
    expect(body.data.boxed).toBe(true);
    expect(body.data.groups).toHaveLength(1);
    expect(body.data.groups[0].bulkPackagingId).toBe(box.bulk_packaging_id);
    expect(listed(body)).toEqual([
      "KH-BHO-ABC102-2026-07-0001-BP-001-001",
      "KH-BHO-ABC102-2026-07-0001-BP-001-002",
      "KH-BHO-ABC102-2026-07-0001-BP-001-003",
      "KH-BHO-ABC102-2026-07-0001-BP-001-004",
    ]);
  });

  test("sold and damaged units are absent", async () => {
    const { lot } = await makeSellerLot({ qty: 6 });
    await UnitSerial.updateMany({ inventoryId: lot._id, unit_serial: 2 }, { $set: { status: "sold" } });
    await UnitSerial.updateMany({ inventoryId: lot._id, unit_serial: 5 }, { $set: { status: "damaged" } });

    const shown = listed((await availableUnits(lot._id)).body);
    expect(shown).toHaveLength(4);
    expect(shown).not.toContain("KH-BHO-ABC102-2026-07-0001-002");
    expect(shown).not.toContain("KH-BHO-ABC102-2026-07-0001-005");
  });

  test("units still owned by the COMPANY are not the seller's to list", async () => {
    const { lot } = await makeSellerLot({ qty: 4 });
    // Two units never actually landed — still company-owned on the same row.
    await UnitSerial.updateMany(
      { inventoryId: lot._id, unit_serial: { $gte: 3 } },
      { $set: { ownerType: "company", ownerId: companyId } }
    );
    expect(listed((await availableUnits(lot._id)).body)).toHaveLength(2);
  });

  test("another seller's lot is refused", async () => {
    const { lot } = await makeSellerLot({ qty: 4 });
    const stranger = new mongoose.Types.ObjectId();
    const res = await availableUnits(lot._id, { sellerId: stranger, principalType: "seller", role: "seller_admin" });
    expect(res.statusCode).toBe(403);
  });

  test("a warehouse-scoped seller manager cannot open a lot outside their warehouse", async () => {
    const { lot } = await makeSellerLot({ qty: 4, warehouse: whB });
    const manager = await User.create({
      ownerType: "seller", ownerId: sellerId, name: "Mgr",
      role: "seller_manager", status: "active", warehouseIds: [whA._id],
    });
    const user = { id: manager._id, sellerId, principalType: "seller", role: "seller_manager" };

    expect((await availableUnits(lot._id, user)).statusCode).toBe(403);
    expect((await details(lot._id, user)).statusCode).toBe(403);

    // …and CAN open one in their own warehouse. (Its own lot number: unit
    // serials are globally unique, so two lots can't share a code.)
    const mine = await makeSellerLot({ qty: 3, warehouse: whA, lotNumber: "KH-BHO-ABC102-2026-07-0002" });
    expect((await availableUnits(mine.lot._id, user)).statusCode).toBe(200);
  });
});
