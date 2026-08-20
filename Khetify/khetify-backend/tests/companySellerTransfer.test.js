/**
 * COMPANY WAREHOUSE → SELLER transfer (warehouse-initiated, scan-verified).
 * Exercises the new service + controller end to end, and then hands the result
 * to the EXISTING seller receive flow to prove the two halves meet.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const Seller = require("../model/Seller/Seller");
const UnitSerial = require("../model/Barcode/UnitSerial");
const BulkPackage = require("../model/Inventory/BulkPackage");
const SupplyOrder = require("../model/Supply/SupplyOrder");
const Shipment = require("../model/Transport/Shipment");
const StockMovement = require("../model/Inventory/StockMovement");
const PrincipalCertificate = require("../model/PC/PrincipalCertificate");
const lotService = require("../services/lotService");
const barcodeService = require("../services/barcodeService");
const svc = require("../services/companySellerTransferService");
const ctrl = require("../controller/Company/companySellerTransferController");
const sellerSupply = require("../controller/Seller/sellerSupplyController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

let companyId, productId, companyWh, otherWh, sellerId, sellerWh, lot, serials;

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Supplier", email: `t-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    status: "approved", companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  productId = (await Product.create({ companyId, productName: "Urea", skuNumber: "UR", mrp: 270 }))._id;
  companyWh = await Warehouse.create({ companyId, name: "Bhopal WH", code: "BHO" });
  otherWh = await Warehouse.create({ companyId, name: "Indore WH", code: "IND" });

  const seller = await Seller.create({ passwordHash: "x", sellerInfo: { businessName: "Krishna Agro" }, status: "active" });
  sellerId = seller._id;
  sellerWh = await Warehouse.create({ sellerId, name: "Krishna WH" });
  await PrincipalCertificate.create({
    pcNumber: `PC-${new mongoose.Types.ObjectId()}`, sellerId, companyId, status: "active",
  });

  // A plain (unboxed) lot of 10, on the shelf, with 5 labeled units in stock.
  lot = await Inventory.create({
    productId, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id,
    batchNumber: "L1", lotNumber: "L1", expiryDate: new Date("2027-01-01"), mfgDate: new Date("2026-01-01"),
    offlineStock: 10, availableStock: 10,
  });
  await barcodeService.generateUnits(companyId, lot._id, 5);
  serials = (await UnitSerial.find({ ownerId: companyId, inventoryId: lot._id }).sort({ serial: 1 })).map((u) => u.serial);
  await barcodeService.transitionUnits(companyId, serials, { toStatus: "in_stock", event: "in_stock", force: true });
});

// Challan / Bill / Bilty numbers are MANDATORY on a transfer, so every confirm
// carries them. Supplied as defaults here (an individual test can still override
// or blank one) to keep each case focused on what it is actually asserting.
const DOC_NUMBERS = { challanNumber: "CH/T/1", billNumber: "BILL/T/1", biltyNumber: "BLT/T/1" };
// A scanned copy of each document is mandatory as well as the number, so every
// confirm carries one. `fakeDoc` mirrors multer's memoryStorage output.
const fakeDoc = (name = "doc.pdf", mimetype = "application/pdf", bytes = 512) => ([
  { originalname: name, mimetype, size: bytes, buffer: Buffer.alloc(bytes, 1) },
]);
const DOC_FILES = () => ({
  challanDocument: fakeDoc("challan.pdf"),
  billDocument: fakeDoc("bill.pdf"),
  biltyDocument: fakeDoc("bilty.pdf"),
});
const req = (body, query) => ({
  user: { companyId, id: companyId, role: "operations_manager" },
  body: { ...DOC_NUMBERS, ...body },
  files: DOC_FILES(),
  query: query || {},
});

/* ───────────────────────────────────────────────────────────── options */

describe("transfer options", () => {
  test("lists the company's source warehouses and its PC-authorized sellers with their own warehouses", async () => {
    const res = mockRes();
    await ctrl.getTransferOptions(req({}), res);
    expect(res.statusCode).toBe(200);
    const { sourceWarehouses, sellers } = res.body.data;
    expect(sourceWarehouses.map((w) => w.name).sort()).toEqual(["Bhopal WH", "Indore WH"]);
    expect(sellers).toHaveLength(1);
    expect(sellers[0].businessName).toBe("Krishna Agro");
    expect(sellers[0].warehouses.map((w) => w.name)).toEqual(["Krishna WH"]);
  });

  test("a seller without an active PC is not offered", async () => {
    await PrincipalCertificate.updateMany({ companyId }, { $set: { status: "revoked" } });
    const res = mockRes();
    await ctrl.getTransferOptions(req({}), res);
    expect(res.body.data.sellers).toHaveLength(0);
  });
});

/* ──────────────────────────────────────────────────────────────── scan */

describe("scanning identifies the item and guards what may be added", () => {
  test("a LOT NUMBER on an unboxed lot adds every available unit", async () => {
    const r = await svc.resolveTransferScan(companyId, { code: "L1", fromWarehouseId: companyWh._id, selectedCodes: [] });
    expect(r.scanType).toBe("lot");
    expect(r.productName).toBe("Urea");
    expect(r.addedQuantity).toBe(5);
    expect(r.addedUnitCodes.sort()).toEqual([...serials].sort());
  });

  test("a UNIT CODE adds exactly that one unit", async () => {
    const unit = await UnitSerial.findOne({ inventoryId: lot._id });
    const r = await svc.resolveTransferScan(companyId, { code: unit.unit_code, fromWarehouseId: companyWh._id });
    expect(r.scanType).toBe("unit");
    expect(r.addedUnitCodes).toEqual([unit.serial]);
  });

  test("re-scanning what is already in the transfer is refused as a duplicate", async () => {
    await expect(
      svc.resolveTransferScan(companyId, { code: "L1", fromWarehouseId: companyWh._id, selectedCodes: serials })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("already been added") });
  });

  test("an unknown code is refused", async () => {
    await expect(
      svc.resolveTransferScan(companyId, { code: "NOPE-123", fromWarehouseId: companyWh._id })
    ).rejects.toMatchObject({ status: 404 });
  });

  test("stock sitting in ANOTHER warehouse cannot be added", async () => {
    await expect(
      svc.resolveTransferScan(companyId, { code: "L1", fromWarehouseId: otherWh._id })
    ).rejects.toMatchObject({ status: 403, message: expect.stringContaining("Bhopal WH") });
  });

  test("a warehouse-scoped operator may not send from a warehouse they are not assigned to", async () => {
    await expect(
      svc.resolveTransferScan(companyId, {
        code: "L1", fromWarehouseId: companyWh._id, allowedWarehouseIds: [String(otherWh._id)],
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  test("a unit already transferred out (not in_stock) is refused", async () => {
    await barcodeService.transitionUnits(companyId, [serials[0]], { toStatus: "shipped", event: "in_transit", force: true });
    const unit = await UnitSerial.findOne({ serial: serials[0] });
    await expect(
      svc.resolveTransferScan(companyId, { code: unit.unit_code, fromWarehouseId: companyWh._id })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("not available") });
  });
});

describe("a lot packed into boxes is scanned by Bulk Packaging ID", () => {
  let boxedInv, boxes;

  beforeEach(async () => {
    boxedInv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: companyWh._id,
      qty: 10, lotOrigin: "company", hasBulkPackaging: true, numberOfBoxes: 2, unitsPerBox: 5,
    });
    await barcodeService.generateUnits(companyId, boxedInv._id, 10);
    const mint = await UnitSerial.find({ inventoryId: boxedInv._id });
    await barcodeService.transitionUnits(companyId, mint.map((u) => u.serial), { toStatus: "in_stock", event: "in_stock", force: true });
    boxes = await BulkPackage.find({ lot_id: boxedInv._id }).sort({ box_serial: 1 });
  });

  test("the Bulk Packaging ID adds that box's units and no others", async () => {
    const r = await svc.resolveTransferScan(companyId, { code: boxes[0].bulk_packaging_id, fromWarehouseId: companyWh._id });
    expect(r.scanType).toBe("bulk_package");
    expect(r.bulkPackagingId).toBe(boxes[0].bulk_packaging_id);
    expect(r.addedQuantity).toBe(5);
    const inBox = await UnitSerial.find({ bulk_packaging_record_id: boxes[0]._id }).select("serial").lean();
    expect(r.addedUnitCodes.sort()).toEqual(inBox.map((u) => u.serial).sort());
  });

  test("its LOT NUMBER is refused — the box is the shipping identity", async () => {
    await expect(
      svc.resolveTransferScan(companyId, { code: boxedInv.lotNumber, fromWarehouseId: companyWh._id })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Bulk Packaging ID") });
  });

  test("a single unit inside a box may still be transferred on its own", async () => {
    const unit = await UnitSerial.findOne({ bulk_packaging_record_id: boxes[1]._id });
    const r = await svc.resolveTransferScan(companyId, { code: unit.unit_code, fromWarehouseId: companyWh._id });
    expect(r.addedQuantity).toBe(1);
    expect(r.bulkPackagingId).toBe(boxes[1].bulk_packaging_id);
  });

  test("confirming a boxed transfer keeps the unit → box → lot relationship", async () => {
    const scan = await svc.resolveTransferScan(companyId, { code: boxes[0].bulk_packaging_id, fromWarehouseId: companyWh._id });
    const out = await svc.confirmTransfer(companyId, {
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      codes: scan.addedUnitCodes, performedBy: companyId, ...DOC_NUMBERS,
      documentFiles: DOC_FILES(),
    });
    expect(out.totalUnits).toBe(5);
    const moved = await UnitSerial.find({ serial: { $in: scan.addedUnitCodes } }).lean();
    expect(moved.every((u) => u.status === "shipped")).toBe(true);
    // The box identity travels with the units — nothing is rewritten.
    expect(moved.every((u) => String(u.bulk_packaging_record_id) === String(boxes[0]._id))).toBe(true);
    expect(moved.every((u) => u.bulk_packaging_id === boxes[0].bulk_packaging_id)).toBe(true);
  });
});

/* ───────────────────────────────────────────────────────────── confirm */

async function confirm(codes = serials.slice(0, 3), extra = {}) {
  const res = mockRes();
  await ctrl.confirmTransfer(req({
    sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id, codes, ...extra,
  }), res);
  return res;
}

describe("confirming the transfer", () => {
  test("records it, takes the stock out of the company warehouse and puts the units in transit", async () => {
    const res = await confirm();
    expect(res.statusCode).toBe(201);
    const data = res.body.data;
    expect(data.status).toBe("dispatched");
    expect(data.totalUnits).toBe(3);
    expect(data.qrPayload).toContain(data.shipmentId);
    expect(data.items[0]).toMatchObject({ productName: "Urea", quantity: 3 });

    // Company warehouse: 10 → 7 available, nothing left reserved.
    const after = await Inventory.findById(lot._id);
    expect(after.availableStock).toBe(7);
    expect(after.reservedStock).toBe(0);
    expect(after.offlineStock).toBe(7);

    // The scanned units — and only those — are in transit on this shipment.
    const moved = await UnitSerial.find({ serial: { $in: serials.slice(0, 3) } }).lean();
    expect(moved.every((u) => u.status === "shipped")).toBe(true);
    expect(moved.every((u) => String(u.currentShipmentId) === data.shipmentId)).toBe(true);
    const untouched = await UnitSerial.find({ serial: { $in: serials.slice(3) } }).lean();
    expect(untouched.every((u) => u.status === "in_stock")).toBe(true);

    // Recorded as a company-initiated supply order, carrying the exact serials.
    const order = await SupplyOrder.findById(data.supplyOrderId);
    expect(order.initiatedBy).toBe("company");
    expect(order.status).toBe("dispatched");
    expect(order.sourceWarehouseId.toString()).toBe(companyWh._id.toString());
    expect(order.warehouseId.toString()).toBe(sellerWh._id.toString());
    expect(order.items[0].allocations[0].serials.sort()).toEqual(serials.slice(0, 3).sort());

    // Cross-owner shipment, in transit to the seller.
    const ship = await Shipment.findById(data.shipmentId);
    expect(ship.status).toBe("in_transit");
    expect(ship.toType).toBe("seller");
    expect(ship.toOwnerType).toBe("seller");
    expect(ship.toOwnerId.toString()).toBe(sellerId.toString());
    expect(ship.lines[0].serials.sort()).toEqual(serials.slice(0, 3).sort());

    // Ledger: one supply_out for the quantity that left.
    const out = await StockMovement.find({ inventoryId: lot._id, type: "supply_out" });
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(-3);
  });

  test("the SAME units cannot be transferred twice", async () => {
    await confirm();
    const second = await confirm();
    expect(second.statusCode).toBe(409);
    // Still exactly one deduction.
    const after = await Inventory.findById(lot._id);
    expect(after.availableStock).toBe(7);
    expect(await SupplyOrder.countDocuments({ companyId, initiatedBy: "company" })).toBe(1);
  });

  test("nothing scanned is refused", async () => {
    const res = await confirm([]);
    expect(res.statusCode).toBe(400);
  });

  test("a seller without an active PC is refused", async () => {
    await PrincipalCertificate.updateMany({ companyId }, { $set: { status: "revoked" } });
    const res = await confirm();
    expect(res.statusCode).toBe(403);
    expect(await SupplyOrder.countDocuments({})).toBe(0);
  });

  test("a warehouse that does not belong to the chosen seller is refused", async () => {
    const otherSeller = await Seller.create({ passwordHash: "x", sellerInfo: { businessName: "Other" }, status: "active" });
    const foreignWh = await Warehouse.create({ sellerId: otherSeller._id, name: "Foreign WH" });
    const res = await confirm(serials.slice(0, 2), { destinationWarehouseId: foreignWh._id });
    expect(res.statusCode).toBe(403);
    expect(await SupplyOrder.countDocuments({})).toBe(0);
  });

  test("a stray code that is not a unit of this company is refused", async () => {
    const res = await confirm(["MADE-UP-CODE"]);
    expect(res.statusCode).toBe(409);
    expect(await SupplyOrder.countDocuments({})).toBe(0);
  });

  test("a failure part-way rolls everything back — no reservation, no order, units back on the shelf", async () => {
    // The lot's quantity is gone (sold elsewhere) while its labels still exist,
    // so the reservation must fail. Nothing may be left half-done.
    await Inventory.updateOne({ _id: lot._id }, { $set: { availableStock: 0, offlineStock: 0 } });
    const res = await confirm();
    expect(res.statusCode).toBe(409);
    expect(await SupplyOrder.countDocuments({})).toBe(0);
    expect(await Shipment.countDocuments({})).toBe(0);
    const after = await Inventory.findById(lot._id);
    expect(after.reservedStock).toBe(0);
    const units = await UnitSerial.find({ serial: { $in: serials } }).lean();
    expect(units.every((u) => u.status === "in_stock")).toBe(true);
  });

  test("units from several lots land as separate allocations under one product", async () => {
    const lot2 = await Inventory.create({
      productId, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id,
      batchNumber: "L2", lotNumber: "L2", offlineStock: 4, availableStock: 4,
    });
    await barcodeService.generateUnits(companyId, lot2._id, 2);
    const s2 = (await UnitSerial.find({ inventoryId: lot2._id })).map((u) => u.serial);
    await barcodeService.transitionUnits(companyId, s2, { toStatus: "in_stock", event: "in_stock", force: true });

    const res = await confirm([...serials.slice(0, 2), ...s2]);
    expect(res.statusCode).toBe(201);
    const order = await SupplyOrder.findById(res.body.data.supplyOrderId);
    expect(order.items).toHaveLength(1);            // one product
    expect(order.items[0].quantity).toBe(4);
    expect(order.items[0].allocations).toHaveLength(2); // two source lots
    expect(order.items[0].allocations.map((a) => a.lotNumber).sort()).toEqual(["L1", "L2"]);
  });
});

/* ─────────────────────────────────────── the seller side (existing flow) */

describe("the seller receives it through the existing scan-to-receive flow", () => {
  test("stock lands in the seller's warehouse with the lot identity and unit ownership moved", async () => {
    const res = await confirm();
    const { supplyOrderId, qrPayload } = res.body.data;

    const recv = mockRes();
    await sellerSupply.receiveSupply({
      user: { sellerId }, params: { id: supplyOrderId }, body: { qr: qrPayload },
    }, recv);
    expect(recv.statusCode).toBe(200);
    expect(recv.body.data.status).toBe("received");

    // Seller inventory row, same lot identity, correct quantity.
    const sellerLot = await Inventory.findOne({ ownerType: "seller", ownerId: sellerId, warehouseId: sellerWh._id });
    expect(sellerLot).toBeTruthy();
    expect(sellerLot.lotNumber).toBe("L1");
    expect(sellerLot.availableStock).toBe(3);
    expect(sellerLot.productId.toString()).toBe(productId.toString());

    // The units are now the seller's, back in stock, on the seller's lot row.
    const landed = await UnitSerial.find({ serial: { $in: serials.slice(0, 3) } }).lean();
    expect(landed.every((u) => u.ownerType === "seller")).toBe(true);
    expect(landed.every((u) => String(u.ownerId) === String(sellerId))).toBe(true);
    expect(landed.every((u) => u.status === "in_stock")).toBe(true);
    expect(landed.every((u) => String(u.inventoryId) === String(sellerLot._id))).toBe(true);

    // And it is gone from the company warehouse.
    const companyLot = await Inventory.findById(lot._id);
    expect(companyLot.availableStock).toBe(7);
    expect(await UnitSerial.countDocuments({ ownerType: "company", ownerId: companyId, inventoryId: lot._id, status: "in_stock" })).toBe(2);
  });
});

/* ───────────────────────────────────────────────────────────── history */

describe("transfer history", () => {
  test("lists this warehouse's company-initiated transfers with their live status", async () => {
    const res = await confirm();
    const hist = mockRes();
    await ctrl.getTransferHistory(req({}, {}), hist);
    expect(hist.body.count).toBe(1);
    expect(hist.body.data[0]).toMatchObject({
      seller: "Krishna Agro", status: "dispatched", shipmentStatus: "in_transit",
      totalUnits: 3, sourceWarehouse: "Bhopal WH", destinationWarehouse: "Krishna WH",
    });
    expect(hist.body.data[0].qrPayload).toContain(res.body.data.shipmentId);
  });

  test("a seller-initiated supply request is NOT listed as a transfer", async () => {
    await SupplyOrder.create({ sellerId, companyId, items: [{ productId, quantity: 1 }], warehouseId: sellerWh._id, status: "requested" });
    const hist = mockRes();
    await ctrl.getTransferHistory(req({}, {}), hist);
    expect(hist.body.count).toBe(0);
  });
});

/* ───────────────────────── product list + quantity contract (the form) */

describe("the product list the form offers", () => {
  test("only stock this warehouse holds, with the available and labelled counts", async () => {
    const res = mockRes();
    await ctrl.getWarehouseProducts({ ...req({}), query: { warehouseId: String(companyWh._id) } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      productName: "Urea",
      availableQty: 10,      // Inventory availableStock
      unitsAvailable: 5,     // labelled units on the shelf
      transferableQty: 5,    // min(available, labelled) — the real ceiling
      transferable: true,
    });
    expect(res.body.data[0].lots[0]).toMatchObject({ lotNumber: "L1", unitsAvailable: 5 });
  });

  test("a product whose stock is fully RESERVED is still listed, marked not transferable", async () => {
    await Inventory.updateOne({ _id: lot._id }, { $set: { availableStock: 0, reservedStock: 10 } });
    const list = await svc.warehouseProducts(companyId, { warehouseId: companyWh._id });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ productName: "Urea", transferable: false, blockedReason: "reserved", reservedQty: 10 });
  });

  test("an EXPIRED lot no longer hides the product — it is listed and explained", async () => {
    await Inventory.updateOne({ _id: lot._id }, { $set: { expiryDate: new Date("2020-01-01") } });
    const list = await svc.warehouseProducts(companyId, { warehouseId: companyWh._id });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ transferable: false, blockedReason: "expired", availableQty: 0, expiredQty: 10 });
  });

  test("stock still AWAITING RECEIPT is listed as such rather than vanishing", async () => {
    const pending = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: companyWh._id,
      qty: 20, lotOrigin: "company", pendingReceipt: true,
    });
    expect(pending.inTransitStock).toBe(20);
    const list = await svc.warehouseProducts(companyId, { warehouseId: companyWh._id });
    expect(list).toHaveLength(1);              // same product, one row
    expect(list[0].pendingQty).toBe(20);
    expect(list[0].availableQty).toBe(10);     // the received lot is still transferable
    expect(list[0].transferable).toBe(true);
  });

  test("a product with stock but NO unit labels is listed and explained", async () => {
    const bare = await Product.create({ companyId, productName: "Zinc" });
    await Inventory.create({
      productId: bare._id, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id,
      batchNumber: "Z1", lotNumber: "Z1", offlineStock: 6, availableStock: 6,
    });
    const list = await svc.warehouseProducts(companyId, { warehouseId: companyWh._id });
    expect(list.map((p) => p.productName).sort()).toEqual(["Urea", "Zinc"]);
    const zinc = list.find((p) => p.productName === "Zinc");
    expect(zinc).toMatchObject({ availableQty: 6, unitsAvailable: 0, transferable: false, blockedReason: "no unit labels" });
  });

  test("transferable products are offered first", async () => {
    const blocked = await Product.create({ companyId, productName: "AAA Blocked" });
    await Inventory.create({
      productId: blocked._id, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id,
      batchNumber: "B1", lotNumber: "B1", offlineStock: 3, availableStock: 3,
    });
    const list = await svc.warehouseProducts(companyId, { warehouseId: companyWh._id });
    expect(list[0].productName).toBe("Urea");            // transferable, despite "AAA" sorting first
    expect(list[0].transferableQty).toBe(5);
  });

  test("an empty warehouse offers nothing", async () => {
    const res = mockRes();
    await ctrl.getWarehouseProducts({ ...req({}), query: { warehouseId: String(otherWh._id) } }, res);
    expect(res.body.count).toBe(0);
  });

  test("a warehouse the operator is not assigned to is refused", async () => {
    await expect(
      svc.warehouseProducts(companyId, { warehouseId: companyWh._id, allowedWarehouseIds: [String(otherWh._id)] })
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("the entered quantity caps the scanning", () => {
  test("a lot holding more units than the quantity is refused — scan single units instead", async () => {
    await expect(
      svc.resolveTransferScan(companyId, {
        code: "L1", fromWarehouseId: companyWh._id, productId, requiredQty: 2,
      })
    ).rejects.toMatchObject({ status: 409, message: "This transfer needs 2 of 5 units from L1. Scan the individual unit codes instead." });
  });

  test("a lot matching the quantity exactly is accepted", async () => {
    const r = await svc.resolveTransferScan(companyId, {
      code: "L1", fromWarehouseId: companyWh._id, productId, requiredQty: 5,
    });
    expect(r.addedQuantity).toBe(5);
    expect(r.remainingRequired).toBe(0);
  });

  test("scanning past the quantity is refused", async () => {
    const first = await svc.resolveTransferScan(companyId, {
      code: (await UnitSerial.findOne({ serial: serials[0] })).unit_code,
      fromWarehouseId: companyWh._id, productId, requiredQty: 1,
    });
    expect(first.remainingRequired).toBe(0);
    const next = await UnitSerial.findOne({ serial: serials[1] });
    await expect(
      svc.resolveTransferScan(companyId, {
        code: next.unit_code, fromWarehouseId: companyWh._id, productId, requiredQty: 1,
        selectedCodes: first.addedUnitCodes,
      })
    ).rejects.toMatchObject({ status: 409, message: "Every unit this transfer requires has already been scanned." });
  });

  test("a unit of a DIFFERENT product than the one selected is refused", async () => {
    const other = await Product.create({ companyId, productName: "DAP" });
    const otherLot = await Inventory.create({
      productId: other._id, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id,
      batchNumber: "D1", lotNumber: "D1", offlineStock: 5, availableStock: 5,
    });
    await barcodeService.generateUnits(companyId, otherLot._id, 2);
    const u = await UnitSerial.findOne({ inventoryId: otherLot._id });
    await barcodeService.transitionUnits(companyId, [u.serial], { toStatus: "in_stock", event: "in_stock", force: true });

    await expect(
      svc.resolveTransferScan(companyId, {
        code: u.unit_code, fromWarehouseId: companyWh._id, productId, requiredQty: 3,
      })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("different product") });
  });

  test("confirming with FEWER units than the quantity is refused", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 3, codes: serials.slice(0, 2),
    }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe("Scan every unit before transferring — 2 of 3 scanned.");
    expect(await SupplyOrder.countDocuments({})).toBe(0);
  });

  test("confirming with MORE units than the quantity is refused", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 2, codes: serials.slice(0, 4),
    }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain("Only 2 unit(s) were requested");
    expect(await SupplyOrder.countDocuments({})).toBe(0);
  });

  test("quantity and scan agreeing goes through, and the vehicle/driver are stored", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 3, codes: serials.slice(0, 3),
      vehicleNo: "MP09 AB 1234", driverName: "Ramesh", driverPhone: "9876543210",
    }), res);
    expect(res.statusCode).toBe(201);
    const ship = await Shipment.findById(res.body.data.shipmentId);
    expect(ship.vehicleNo).toBe("MP09 AB 1234");
    expect(ship.driverName).toBe("Ramesh");
    expect(ship.driverPhone).toBe("9876543210");
    expect((await Inventory.findById(lot._id)).availableStock).toBe(7);
  });
});

/* ──────────────────────────────── shipment boxes (logistics-only cartons) */

const ShipmentBox = require("../model/Transport/ShipmentBox");
const boxSvc = require("../services/shipmentBoxService");

describe("shipment boxes for individually scanned units", () => {
  const confirmWithBoxes = async (groups, codes = serials.slice(0, 4)) => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: codes.length, codes, boxes: groups,
    }), res);
    return res;
  };

  test("the manager's own grouping is what gets packed, and each box gets a unique label", async () => {
    const res = await confirmWithBoxes([
      { units: [serials[0], serials[1]] },
      { units: [serials[2], serials[3]] },
    ]);
    expect(res.statusCode).toBe(201);
    const boxes = res.body.data.boxes;
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toMatchObject({ boxNumber: 1, totalBoxes: 2, totalUnits: 2 });
    expect(boxes[1]).toMatchObject({ boxNumber: 2, totalUnits: 2 });
    expect(new Set(boxes.map((b) => b.shipmentBoxId)).size).toBe(2);
    // The label payload is signed, exactly like the manifest.
    expect(boxes[0].qrPayload).toBe(`${boxes[0].shipmentBoxId}.${(await ShipmentBox.findOne({ shipmentBoxId: boxes[0].shipmentBoxId })).qrToken}`);
    // Traceability: box → unit → lot → product → transfer.
    const stored = await ShipmentBox.findOne({ shipmentBoxId: boxes[0].shipmentBoxId });
    expect(stored.units.map((u) => u.serial).sort()).toEqual(serials.slice(0, 2).sort());
    expect(stored.units.every((u) => u.lotNumber === "L1")).toBe(true);
    expect(stored.units.every((u) => String(u.productId) === String(productId))).toBe(true);
    expect(String(stored.supplyOrderId)).toBe(res.body.data.supplyOrderId);
    expect(String(stored.shipmentId)).toBe(res.body.data.shipmentId);
    expect(stored.status).toBe("dispatched");
  });

  test("an uneven grouping is honoured exactly as entered", async () => {
    const res = await confirmWithBoxes([
      { units: [serials[0], serials[1], serials[2]] },
      { units: [serials[3]] },
    ]);
    expect(res.body.data.boxes.map((b) => b.totalUnits)).toEqual([3, 1]);
  });

  test("boxes are optional — a transfer without them still works", async () => {
    const res = await confirmWithBoxes([]);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.boxes).toEqual([]);
    expect(await ShipmentBox.countDocuments({})).toBe(0);
  });

  test("leaving a scanned unit out of every box is refused", async () => {
    const res = await confirmWithBoxes([{ units: [serials[0], serials[1]] }]);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("not put into any shipment box");
    expect(await ShipmentBox.countDocuments({})).toBe(0);
    expect(await SupplyOrder.countDocuments({})).toBe(0);   // rolled back
    expect((await Inventory.findById(lot._id)).availableStock).toBe(10);
  });

  test("the same unit in two boxes is refused", async () => {
    const res = await confirmWithBoxes([
      { units: [serials[0], serials[1]] },
      { units: [serials[1], serials[2], serials[3]] },
    ]);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain("more than one box");
  });

  test("a unit that is not part of the transfer cannot be boxed", async () => {
    const res = await confirmWithBoxes([
      { units: [serials[0], serials[1]] },
      { units: [serials[2], serials[3], serials[4]] },
    ], serials.slice(0, 4));
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain("not part of this transfer");
  });
});

describe("units already in a Bulk Package are never re-boxed", () => {
  let boxedInv, bulkBoxes, bulkSerials;

  beforeEach(async () => {
    boxedInv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: companyWh._id,
      qty: 4, lotOrigin: "company", hasBulkPackaging: true, numberOfBoxes: 1, unitsPerBox: 4,
    });
    await barcodeService.generateUnits(companyId, boxedInv._id, 4);
    const mint = await UnitSerial.find({ inventoryId: boxedInv._id });
    bulkSerials = mint.map((u) => u.serial);
    await barcodeService.transitionUnits(companyId, bulkSerials, { toStatus: "in_stock", event: "in_stock", force: true });
    bulkBoxes = await BulkPackage.find({ lot_id: boxedInv._id });
  });

  test("putting a bulk-packaged unit into a shipment box is refused, naming its existing label", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 4, codes: bulkSerials,
      boxes: [{ units: bulkSerials }],
    }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain(bulkBoxes[0].bulk_packaging_id);
    expect(res.body.message).toContain("keep using that label");
    expect(await ShipmentBox.countDocuments({})).toBe(0);
  });

  test("a bulk-packaged transfer needs no shipment boxes at all", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 4, codes: bulkSerials,
    }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.boxes).toEqual([]);
    // The Bulk Package itself is untouched by any of this.
    const bp = await BulkPackage.findById(bulkBoxes[0]._id);
    expect(bp.bulk_packaging_id).toBe(bulkBoxes[0].bulk_packaging_id);
    expect(bp.units_in_box).toBe(bulkBoxes[0].units_in_box);
  });
});

describe("the seller receives by scanning box labels instead of units", () => {
  const dispatchTwoBoxes = async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 4, codes: serials.slice(0, 4),
      boxes: [{ units: serials.slice(0, 2) }, { units: serials.slice(2, 4) }],
    }), res);
    expect(res.statusCode).toBe(201);
    return res.body.data;
  };

  const sellerReq = (id, body) => ({ user: { sellerId }, params: { id }, body });

  test("scanning ONE box label loads every unit inside it, with product and quantity", async () => {
    const out = await dispatchTwoBoxes();
    const scan = mockRes();
    await sellerSupply.scanReceiveBox(sellerReq(out.supplyOrderId, { code: out.boxes[0].qrPayload }), scan);
    expect(scan.statusCode).toBe(200);
    expect(scan.body.data).toMatchObject({ kind: "shipment_box", boxNumber: 1, totalUnits: 2 });
    expect(scan.body.data.products[0]).toMatchObject({ productName: "Urea", quantity: 2 });
    expect(scan.body.data.serials.sort()).toEqual(serials.slice(0, 2).sort());
    // Coverage is reported live: half the shipment so far.
    expect(scan.body.data.coverage).toMatchObject({ total: 4, covered: 2, missing: 2, complete: false });
  });

  test("receiving is refused until every carton is scanned", async () => {
    const out = await dispatchTwoBoxes();
    const res = mockRes();
    await sellerSupply.receiveSupply(sellerReq(out.supplyOrderId, { boxCodes: [out.boxes[0].shipmentBoxId] }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain("not accounted for yet");
    expect((await SupplyOrder.findById(out.supplyOrderId)).status).toBe("dispatched");
  });

  test("scanning ALL the boxes receives the stock into seller inventory", async () => {
    const out = await dispatchTwoBoxes();
    const res = mockRes();
    await sellerSupply.receiveSupply(
      sellerReq(out.supplyOrderId, { boxCodes: out.boxes.map((b) => b.qrPayload) }), res
    );
    expect(res.statusCode).toBe(200);
    expect((await SupplyOrder.findById(out.supplyOrderId)).status).toBe("received");

    const sellerLot = await Inventory.findOne({ ownerType: "seller", ownerId: sellerId });
    expect(sellerLot.lotNumber).toBe("L1");
    expect(sellerLot.availableStock).toBe(4);
    const landed = await UnitSerial.find({ serial: { $in: serials.slice(0, 4) } }).lean();
    expect(landed.every((u) => u.ownerType === "seller" && u.status === "in_stock")).toBe(true);
    expect((await ShipmentBox.find({ shipmentId: out.shipmentId })).every((b) => b.status === "received")).toBe(true);
  });

  test("the manifest still receives everything in one scan — the old path is untouched", async () => {
    const out = await dispatchTwoBoxes();
    const res = mockRes();
    await sellerSupply.receiveSupply(sellerReq(out.supplyOrderId, { qr: out.qrPayload }), res);
    expect(res.statusCode).toBe(200);
    expect((await SupplyOrder.findById(out.supplyOrderId)).status).toBe("received");
  });

  test("a box from another shipment is refused", async () => {
    const first = await dispatchTwoBoxes();
    // A second, independent transfer.
    const second = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 1, codes: [serials[4]], boxes: [{ units: [serials[4]] }],
    }), second);
    const foreign = second.body.data.boxes[0].shipmentBoxId;

    const scan = mockRes();
    await sellerSupply.scanReceiveBox(sellerReq(first.supplyOrderId, { code: foreign }), scan);
    expect(scan.statusCode).toBe(409);
    expect(scan.body.message).toContain("different shipment");
  });

  test("a tampered label token is refused", async () => {
    const out = await dispatchTwoBoxes();
    const scan = mockRes();
    await sellerSupply.scanReceiveBox(
      sellerReq(out.supplyOrderId, { code: `${out.boxes[0].shipmentBoxId}.deadbeefdeadbeef` }), scan
    );
    expect(scan.statusCode).toBe(409);
    expect(scan.body.message).toContain("could not be verified");
  });

  test("an unknown label is refused", async () => {
    const out = await dispatchTwoBoxes();
    const scan = mockRes();
    await sellerSupply.scanReceiveBox(sellerReq(out.supplyOrderId, { code: "SB-NOPE-001" }), scan);
    expect(scan.statusCode).toBe(404);
  });

  test("receiving with no proof at all is still refused", async () => {
    const out = await dispatchTwoBoxes();
    const res = mockRes();
    await sellerSupply.receiveSupply(sellerReq(out.supplyOrderId, {}), res);
    expect(res.statusCode).toBe(400);
  });

  test("box labels can be re-printed from history", async () => {
    const out = await dispatchTwoBoxes();
    const list = await svc.transferBoxes(companyId, out.supplyOrderId);
    expect(list).toHaveLength(2);
    expect(list[0].qrPayload).toBe(out.boxes[0].qrPayload);
    const hist = mockRes();
    await ctrl.getTransferHistory(req({}, {}), hist);
    expect(hist.body.data[0].boxCount).toBe(2);
  });
});


/* ── units taken OUT of a carton are loose; a whole carton is not ── */

describe("part of a Bulk Package versus the whole of one", () => {
  let carton, cartonSerials;

  beforeEach(async () => {
    const inv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: companyWh._id,
      qty: 10, lotOrigin: "company", hasBulkPackaging: true, numberOfBoxes: 1, unitsPerBox: 10,
    });
    await barcodeService.generateUnits(companyId, inv._id, 10);
    cartonSerials = (await UnitSerial.find({ inventoryId: inv._id }).sort({ serial: 1 })).map((u) => u.serial);
    await barcodeService.transitionUnits(companyId, cartonSerials, { toStatus: "in_stock", event: "in_stock", force: true });
    carton = await BulkPackage.findOne({ lot_id: inv._id });
  });

  test("a unit scan reports its carton's size so the screen can tell part from whole", async () => {
    const unit = await UnitSerial.findOne({ serial: cartonSerials[0] });
    const r = await svc.resolveTransferScan(companyId, {
      code: unit.unit_code, fromWarehouseId: companyWh._id, productId, requiredQty: 3,
    });
    expect(r).toMatchObject({
      scanType: "unit",
      boxable: true,                                   // a single unit is not a carton
      bulkPackagingId: carton.bulk_packaging_id,
      bulkPackageUnitsAvailable: 10,                   // …out of ten
    });
  });

  test("THREE units taken out of a ten-unit carton CAN be grouped into shipment boxes", async () => {
    const three = cartonSerials.slice(0, 3);
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 3, codes: three,
      boxes: [{ units: [three[0], three[2]] }, { units: [three[1]] }],
    }), res);

    expect(res.statusCode).toBe(201);
    expect(res.body.data.boxes).toHaveLength(2);
    expect(res.body.data.boxes[0].unitCodes.sort()).toEqual([three[0], three[2]].sort());
    expect(res.body.data.boxes[1].unitCodes).toEqual([three[1]]);
    // The carton itself stayed behind, with its remaining seven units.
    const bp = await BulkPackage.findById(carton._id);
    expect(bp.bulk_packaging_id).toBe(carton.bulk_packaging_id);
    expect(await UnitSerial.countDocuments({ bulk_packaging_record_id: carton._id, status: "in_stock" })).toBe(7);
  });

  test("the WHOLE carton scanned unit by unit still may not be re-boxed", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 10, codes: cartonSerials,
      boxes: [{ units: cartonSerials }],
    }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain("on this transfer in full");
    expect(res.body.message).toContain(carton.bulk_packaging_id);
  });

  test("the whole carton scanned by its Bulk Packaging ID needs no shipment box", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 10, codes: cartonSerials,
    }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.boxes).toEqual([]);
  });
});

/* ─────────── the reported scenario: 200 bulk-packaged + 4 loose in 2 boxes */

describe("a mixed transfer: one existing Bulk Package plus individually scanned units", () => {
  let bulkLot, bulkBox, bulkSerials, looseLot, looseSerials;

  beforeEach(async () => {
    // 200 units in ONE existing Bulk Package.
    bulkLot = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: companyWh._id,
      qty: 200, lotOrigin: "company", hasBulkPackaging: true, numberOfBoxes: 1, unitsPerBox: 200,
    });
    await barcodeService.generateUnits(companyId, bulkLot._id, 200);
    bulkSerials = (await UnitSerial.find({ inventoryId: bulkLot._id })).map((u) => u.serial);
    await barcodeService.transitionUnits(companyId, bulkSerials, { toStatus: "in_stock", event: "in_stock", force: true });
    bulkBox = await BulkPackage.findOne({ lot_id: bulkLot._id });

    // 4 loose units of the same product.
    looseLot = await Inventory.create({
      productId, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id,
      batchNumber: "LOOSE-LOT", lotNumber: "LOOSE-LOT", offlineStock: 4, availableStock: 4,
    });
    await barcodeService.generateUnits(companyId, looseLot._id, 4);
    looseSerials = (await UnitSerial.find({ inventoryId: looseLot._id }).sort({ serial: 1 })).map((u) => u.serial);
    await barcodeService.transitionUnits(companyId, looseSerials, { toStatus: "in_stock", event: "in_stock", force: true });
  });

  test("the scan tells the screen which units may be boxed, from the unit's own bulk-package link", async () => {
    // Scanning the Bulk Packaging ID → not boxable.
    const viaBox = await svc.resolveTransferScan(companyId, {
      code: bulkBox.bulk_packaging_id, fromWarehouseId: companyWh._id, productId, requiredQty: 204,
    });
    expect(viaBox).toMatchObject({ boxable: false, bulkPackagingId: bulkBox.bulk_packaging_id, addedQuantity: 200 });

    // Scanning ONE unit code out of that carton → boxable, and the carton's size
    // comes with it so the screen can tell "5 units out of 200" from "the whole
    // carton". Only when the count reaches the carton's size does the Bulk
    // Packaging Label take over.
    const inside = await UnitSerial.findOne({ bulk_packaging_record_id: bulkBox._id });
    const viaUnit = await svc.resolveTransferScan(companyId, {
      code: inside.unit_code, fromWarehouseId: companyWh._id, productId, requiredQty: 204,
    });
    expect(viaUnit).toMatchObject({
      boxable: true, bulkPackagingId: bulkBox.bulk_packaging_id, bulkPackageUnitsAvailable: 200,
    });

    // A genuinely loose unit → boxable.
    const loose = await UnitSerial.findOne({ inventoryId: looseLot._id });
    const viaLoose = await svc.resolveTransferScan(companyId, {
      code: loose.unit_code, fromWarehouseId: companyWh._id, productId, requiredQty: 204,
    });
    expect(viaLoose).toMatchObject({ boxable: true, bulkPackagingId: null });
  });

  test("204 units transfer: 200 in the Bulk Package + Box 1 (1,3) and Box 2 (2,4)", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 204,
      codes: [...bulkSerials, ...looseSerials],
      boxes: [
        { units: [looseSerials[0], looseSerials[2]] },  // Box 1 → units 1 & 3
        { units: [looseSerials[1], looseSerials[3]] },  // Box 2 → units 2 & 4
      ],
      vehicleNo: "MP09 AB 1234", driverName: "Ramesh", driverPhone: "9876543210",
    }), res);

    expect(res.statusCode).toBe(201);
    const data = res.body.data;
    expect(data.totalUnits).toBe(204);

    // TWO shipment boxes, holding the exact grouping that was entered.
    expect(data.boxes).toHaveLength(2);
    expect(data.boxes[0].unitCodes.sort()).toEqual([looseSerials[0], looseSerials[2]].sort());
    expect(data.boxes[1].unitCodes.sort()).toEqual([looseSerials[1], looseSerials[3]].sort());
    // …and NO shipment box was made for the bulk-packaged units.
    const boxedSerials = (await ShipmentBox.find({ shipmentId: data.shipmentId })).flatMap((b) => b.units.map((u) => u.serial));
    expect(boxedSerials).toHaveLength(4);
    expect(boxedSerials.some((s) => bulkSerials.includes(s))).toBe(false);

    // The existing Bulk Package is untouched — same ID, same contents.
    const bp = await BulkPackage.findById(bulkBox._id);
    expect(bp.bulk_packaging_id).toBe(bulkBox.bulk_packaging_id);
    expect(bp.units_in_box).toBe(200);
    const stillInBox = await UnitSerial.countDocuments({ bulk_packaging_record_id: bulkBox._id });
    expect(stillInBox).toBe(200);

    // Stock left both lots correctly.
    expect((await Inventory.findById(bulkLot._id)).availableStock).toBe(0);
    expect((await Inventory.findById(looseLot._id)).availableStock).toBe(0);

    // The transfer record carries both lots under the one product.
    const order = await SupplyOrder.findById(data.supplyOrderId);
    expect(order.items).toHaveLength(1);
    expect(order.items[0].quantity).toBe(204);
    expect(order.items[0].allocations.map((a) => a.qty).sort((x, y) => x - y)).toEqual([4, 200]);

    // Transport details rode along.
    const ship = await Shipment.findById(data.shipmentId);
    expect(ship.vehicleNo).toBe("MP09 AB 1234");
    expect(ship.driverName).toBe("Ramesh");
  });

  test("the seller receives it with three scans: the Bulk Packaging label and the two Shipment Boxes", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 204,
      codes: [...bulkSerials, ...looseSerials],
      boxes: [
        { units: [looseSerials[0], looseSerials[2]] },
        { units: [looseSerials[1], looseSerials[3]] },
      ],
    }), res);
    const out = res.body.data;
    const sellerReq = (body) => ({ user: { sellerId }, params: { id: out.supplyOrderId }, body });

    // 1. the existing Bulk Packaging label — 200 units at once
    const s1 = mockRes();
    await sellerSupply.scanReceiveBox(sellerReq({ code: bulkBox.bulk_packaging_id, scanned: [] }), s1);
    expect(s1.body.data).toMatchObject({ kind: "bulk_package", totalUnits: 200 });
    expect(s1.body.data.coverage).toMatchObject({ total: 204, covered: 200, complete: false });

    // 2 + 3. the two shipment boxes
    const s2 = mockRes();
    await sellerSupply.scanReceiveBox(
      sellerReq({ code: out.boxes[0].qrPayload, scanned: [bulkBox.bulk_packaging_id] }), s2
    );
    expect(s2.body.data.coverage).toMatchObject({ covered: 202, complete: false });

    const s3 = mockRes();
    await sellerSupply.scanReceiveBox(
      sellerReq({ code: out.boxes[1].qrPayload, scanned: [bulkBox.bulk_packaging_id, out.boxes[0].shipmentBoxId] }), s3
    );
    expect(s3.body.data.coverage).toMatchObject({ covered: 204, missing: 0, complete: true });

    // everything accounted for → receive
    const recv = mockRes();
    await sellerSupply.receiveSupply(sellerReq({
      boxCodes: [bulkBox.bulk_packaging_id, out.boxes[0].shipmentBoxId, out.boxes[1].shipmentBoxId],
    }), recv);
    expect(recv.statusCode).toBe(200);
    expect((await SupplyOrder.findById(out.supplyOrderId)).status).toBe("received");

    // Both lots landed on the seller side, units re-owned, box link intact.
    const sellerLots = await Inventory.find({ ownerType: "seller", ownerId: sellerId });
    expect(sellerLots.map((l) => l.lotNumber).sort()).toEqual([bulkLot.lotNumber, "LOOSE-LOT"].sort());
    const landed = await UnitSerial.find({ serial: { $in: [...bulkSerials, ...looseSerials] } }).lean();
    expect(landed).toHaveLength(204);
    expect(landed.every((u) => u.ownerType === "seller" && u.status === "in_stock")).toBe(true);
    expect(landed.filter((u) => String(u.bulk_packaging_record_id) === String(bulkBox._id))).toHaveLength(200);
  });
});

/* ─────────── transfer paperwork + labels on the tracking table */

const tmsCtrl = require("../controller/Transport/tmsController");

describe("challan / bill / bilty numbers", () => {
  test("are saved on the transfer record and returned to the screen", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 2, codes: serials.slice(0, 2),
      challanNumber: "CH/2026/0142", billNumber: "INV-2026-0088", biltyNumber: "BLT-77120",
    }), res);

    expect(res.statusCode).toBe(201);
    expect(res.body.data).toMatchObject({
      challanNumber: "CH/2026/0142", billNumber: "INV-2026-0088", biltyNumber: "BLT-77120",
    });
    const order = await SupplyOrder.findById(res.body.data.supplyOrderId);
    expect(order.challanNumber).toBe("CH/2026/0142");
    expect(order.billNumber).toBe("INV-2026-0088");
    expect(order.biltyNumber).toBe("BLT-77120");
  });

  test("a transfer without them is refused, and nothing moves", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 1, codes: [serials[0]],
      challanNumber: "   ", billNumber: "",          // blank / whitespace only
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Enter the Challan, Bill number before transferring");
    expect(await SupplyOrder.countDocuments({})).toBe(0);
    expect((await Inventory.findById(lot._id)).availableStock).toBe(10);
  });

  test("all three missing is reported in one message", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 1, codes: [serials[0]],
      challanNumber: "", billNumber: "", biltyNumber: "",
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Enter the Challan, Bill, Bilty numbers before transferring");
  });

  test("they are trimmed before saving", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 1, codes: [serials[0]],
      challanNumber: "  CH/9  ",
    }), res);
    expect(res.statusCode).toBe(201);
    expect((await SupplyOrder.findById(res.body.data.supplyOrderId)).challanNumber).toBe("CH/9");
  });
});

describe("shipment box labels on the Shipment Tracking table", () => {
  const dispatchWithBoxes = async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 4, codes: serials.slice(0, 4),
      boxes: [{ units: [serials[0], serials[2]] }, { units: [serials[1], serials[3]] }],
    }), res);
    expect(res.statusCode).toBe(201);
    return res.body.data;
  };
  const tmsReq = (extra = {}) => ({
    user: { companyId, id: companyId, role: "operations_manager" }, query: {}, params: {}, ...extra,
  });

  test("the shipment list reports how many boxes each consignment carries", async () => {
    const out = await dispatchWithBoxes();
    const res = mockRes();
    await tmsCtrl.listShipments(tmsReq(), res);
    const row = res.body.data.find((s) => String(s._id) === out.shipmentId);
    expect(row.boxCount).toBe(2);
    // Existing fields still come through untouched.
    expect(row.ref).toBeTruthy();
    expect(row.status).toBe("in_transit");
  });

  test("a shipment with no boxes reports zero rather than breaking the list", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 1, codes: [serials[0]],
    }), res);
    const list = mockRes();
    await tmsCtrl.listShipments(tmsReq(), list);
    expect(list.body.data.every((s) => typeof s.boxCount === "number")).toBe(true);
    expect(list.body.data[0].boxCount).toBe(0);
  });

  test("every box label of a multi-box transfer is fetched, in order", async () => {
    const out = await dispatchWithBoxes();
    const res = mockRes();
    await tmsCtrl.shipmentBoxes(tmsReq({ params: { id: out.shipmentId } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.data.map((b) => b.boxNumber)).toEqual([1, 2]);
    // Linked to the right transfer, with printable payloads.
    expect(res.body.data[0].shipmentId).toBe(out.shipmentId);
    expect(res.body.data[0].qrPayload).toBe(out.boxes[0].qrPayload);
    expect(res.body.data[1].qrPayload).toBe(out.boxes[1].qrPayload);
    expect(res.body.data[0].unitCodes.sort()).toEqual([serials[0], serials[2]].sort());
  });

  test("a warehouse-scoped user cannot pull labels for a shipment that is not theirs", async () => {
    const out = await dispatchWithBoxes();
    const res = mockRes();
    await tmsCtrl.shipmentBoxes({
      user: { companyId, id: companyId, role: "warehouse_manager", warehouseIds: [String(otherWh._id)] },
      params: { id: out.shipmentId }, query: {},
    }, res);
    expect([403, 404]).toContain(res.statusCode);
  });

  test("a failing box-count lookup can never break the shipments table", async () => {
    const svcPath = require.resolve("../services/shipmentBoxService");
    const real = require("../services/shipmentBoxService").boxCountsForShipments;
    require.cache[svcPath].exports.boxCountsForShipments = async () => { throw new Error("db down"); };
    try {
      await dispatchWithBoxes();
      const res = mockRes();
      await tmsCtrl.listShipments(tmsReq(), res);
      expect(res.statusCode).toBe(200);          // NOT a 500
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].boxCount).toBe(0); // degrades, does not explode
    } finally {
      require.cache[svcPath].exports.boxCountsForShipments = real;
    }
  });

  test("an unknown shipment is a 404", async () => {
    const res = mockRes();
    await tmsCtrl.shipmentBoxes(tmsReq({ params: { id: new mongoose.Types.ObjectId() } }), res);
    expect(res.statusCode).toBe(404);
  });
});

/* ─────────────────────── transfer document uploads */

const fs = require("fs");
const pathMod = require("path");
const fileService = require("../services/fileService");

const fakeFile = (name, mimetype, bytes = 2048) => ({
  originalname: name, mimetype, size: bytes, buffer: Buffer.alloc(bytes, 1),
});

describe("challan / bill / bilty document uploads", () => {
  // All three copies are mandatory, so `files` OVERRIDES individual slots on top
  // of a complete set rather than replacing it.
  const confirmWithDocs = async (files, extra = {}) => {
    const res = mockRes();
    const base = req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 2, codes: serials.slice(0, 2),
      challanNumber: "CH/2026/0142", ...extra,
    });
    await ctrl.confirmTransfer(
      { ...base, files: files === null ? null : { ...base.files, ...files } },
      res,
    );
    return res;
  };

  test("a PDF and an image are stored with the transfer and read back with a URL", async () => {
    const res = await confirmWithDocs({
      challanDocument: [fakeFile("challan.pdf", "application/pdf")],
      billDocument: [fakeFile("bill.jpg", "image/jpeg")],
    });
    expect(res.statusCode).toBe(201);

    const stored = await SupplyOrder.findById(res.body.data.supplyOrderId);
    expect(stored.challanDocument.fileName).toBe("challan.pdf");
    expect(stored.challanDocument.mimeType).toBe("application/pdf");
    expect(stored.challanDocument.fileKey).toContain("transfers/");
    expect(stored.billDocument.fileName).toBe("bill.jpg");
    expect(stored.biltyDocument.fileName).toBe("bilty.pdf");   // the mandatory third

    // Only the KEY is persisted; the URL is resolved at read time.
    expect(stored.challanDocument.fileKey).not.toMatch(/^https?:/);
    const docs = res.body.data.documents;
    expect(docs.challanDocument).toMatchObject({ fileName: "challan.pdf" });
    expect(docs.challanDocument.url).toBeTruthy();
    expect(docs.biltyDocument.url).toBeTruthy();
  });

  test("a transfer with NO document copies is refused", async () => {
    const a = await confirmWithDocs(null);
    expect(a.statusCode).toBe(400);
    expect(a.body.message).toBe("Attach the Challan, Bill, Bilty documents (PDF or image) before transferring");
    expect(await SupplyOrder.countDocuments({})).toBe(0);
    expect((await Inventory.findById(lot._id)).availableStock).toBe(10);
  });

  test("a MISSING single copy is named, and nothing moves", async () => {
    const a = await confirmWithDocs({ biltyDocument: undefined });
    expect(a.statusCode).toBe(400);
    expect(a.body.message).toBe("Attach the Bilty document (PDF or image) before transferring");
    expect(await SupplyOrder.countDocuments({})).toBe(0);
  });

  test("a disallowed file type is refused and the transfer is rolled back", async () => {
    const res = await confirmWithDocs({ challanDocument: [fakeFile("notes.txt", "text/plain")] });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("PDF or an image");
    // Nothing was dispatched, and the stock never moved.
    expect(await SupplyOrder.countDocuments({})).toBe(0);
    expect((await Inventory.findById(lot._id)).availableStock).toBe(10);
  });

  test("an oversized file is refused", async () => {
    const res = await confirmWithDocs({
      billDocument: [fakeFile("huge.pdf", "application/pdf", 11 * 1024 * 1024)],
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("smaller than 10MB");
    expect(await SupplyOrder.countDocuments({})).toBe(0);
  });

  test("all three copies stored when supplied", async () => {
    const res = await confirmWithDocs({});
    expect(res.statusCode).toBe(201);
    const docs = res.body.data.documents;
    expect(docs.challanDocument.fileName).toBe("challan.pdf");
    expect(docs.billDocument.fileName).toBe("bill.pdf");
    expect(docs.biltyDocument.fileName).toBe("bilty.pdf");
  });

  test("the documents endpoint returns the numbers and fresh URLs for View / Download", async () => {
    const created = await confirmWithDocs({
      challanDocument: [fakeFile("challan.pdf", "application/pdf")],
    }, { billNumber: "INV-9", biltyNumber: "BLT-3" });

    const res = mockRes();
    await ctrl.getTransferDocuments({ ...req({}), params: { id: created.body.data.supplyOrderId } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      challanNumber: "CH/2026/0142", billNumber: "INV-9", biltyNumber: "BLT-3",
    });
    expect(res.body.data.documents.challanDocument.url).toBeTruthy();
    expect(res.body.data.documents.challanDocument.fileName).toBe("challan.pdf");
    expect(res.body.data.documents.billDocument.url).toBeTruthy();
  });

  test("a warehouse-scoped operator cannot read another warehouse's paperwork", async () => {
    const created = await confirmWithDocs(null);
    await expect(
      svc.transferDocuments(companyId, created.body.data.supplyOrderId, {
        allowedWarehouseIds: [String(otherWh._id)],
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  test("multipart sends everything as strings — quantity and codes still validate", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer({
      ...req({
        sellerId: String(sellerId), destinationWarehouseId: String(sellerWh._id),
        fromWarehouseId: String(companyWh._id), productId: String(productId),
        quantity: "2",                                   // string, as multipart sends it
        codes: JSON.stringify(serials.slice(0, 2)),      // JSON string
        boxes: JSON.stringify([{ units: serials.slice(0, 2) }]),
      }),
      files: { ...DOC_FILES(), challanDocument: [fakeFile("c.png", "image/png")] },
    }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.totalUnits).toBe(2);
    expect(res.body.data.boxes).toHaveLength(1);
  });

  test("a string quantity that disagrees with the scan is still caught", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer({
      ...req({
        sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
        productId, quantity: "3", codes: JSON.stringify(serials.slice(0, 2)),
      }),
      files: DOC_FILES(),
    }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain("2 of 3 scanned");
  });
});

/* ─────────── "Dispatch to Seller": prefill from an approved request */

describe("prefill from an approved seller request", () => {
  const makeRequest = async (overrides = {}) => SupplyOrder.create({
    sellerId, companyId,
    items: [{
      productId, quantity: 10,
      allocations: [{ inventoryId: lot._id, lotNumber: "L1", warehouseId: companyWh._id, qty: 8 }],
    }],
    warehouseId: sellerWh._id,
    sourceWarehouseId: companyWh._id,
    status: "approved",
    ...overrides,
  });

  test("returns everything the transfer form needs, with approved qty from the allocation", async () => {
    const order = await makeRequest();
    const data = await svc.transferPrefill(companyId, order._id);

    expect(data.requestNumber).toBe(`SR-${String(order._id).slice(-6).toUpperCase()}`);
    expect(data.status).toBe("approved");
    expect(data.seller).toMatchObject({ _id: String(sellerId), businessName: "Krishna Agro" });
    expect(data.destinationWarehouse).toMatchObject({ name: "Krishna WH" });
    expect(data.sourceWarehouse).toMatchObject({ name: "Bhopal WH" });
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      productId: String(productId), productName: "Urea",
      requestedQty: 10,      // what the seller asked for
      approvedQty: 8,        // what the company allocated
    });
    expect(data.totalApprovedQty).toBe(8);
  });

  test("falls back to the requested quantity when approval recorded no allocation", async () => {
    const order = await makeRequest({ items: [{ productId, quantity: 6 }] });
    const data = await svc.transferPrefill(companyId, order._id);
    expect(data.items[0]).toMatchObject({ requestedQty: 6, approvedQty: 6 });
  });

  test("a request that is not approved yet is refused", async () => {
    const order = await makeRequest({ status: "requested" });
    await expect(svc.transferPrefill(companyId, order._id))
      .rejects.toMatchObject({ status: 409, message: "This request has not been approved yet" });
  });

  test("a request already on its way cannot be dispatched again", async () => {
    const order = await makeRequest({ status: "dispatched" });
    await expect(svc.transferPrefill(companyId, order._id))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("already dispatched") });
  });

  test("another warehouse's request is invisible — 404, not 403", async () => {
    const order = await makeRequest();
    await expect(
      svc.transferPrefill(companyId, order._id, { allowedWarehouseIds: [String(otherWh._id)] })
    ).rejects.toMatchObject({ status: 404 });
  });

  test("an unknown or malformed id is a 404", async () => {
    await expect(svc.transferPrefill(companyId, new mongoose.Types.ObjectId()))
      .rejects.toMatchObject({ status: 404 });
    await expect(svc.transferPrefill(companyId, "not-an-id"))
      .rejects.toMatchObject({ status: 404 });
  });

  test("the controller serves it, and the request itself is left untouched", async () => {
    const order = await makeRequest();
    const res = mockRes();
    await ctrl.getTransferPrefill({ ...req({}), params: { id: String(order._id) } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.requestNumber).toBeTruthy();

    // Read-only: nothing about the approval changed.
    const after = await SupplyOrder.findById(order._id);
    expect(after.status).toBe("approved");
    expect(after.items[0].pickedQty).toBe(0);
    expect(after.items[0].allocations[0].reservedQty).toBe(0);
    expect((await Inventory.findById(lot._id)).availableStock).toBe(10);
  });
});

/* ─────────── a seller request with SEVERAL products */

describe("multi-product seller request", () => {
  let productB, lotB, serialsB;

  beforeEach(async () => {
    productB = (await Product.create({ companyId, productName: "DAP", skuNumber: "DAP" }))._id;
    lotB = await Inventory.create({
      productId: productB, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id,
      batchNumber: "L2", lotNumber: "L2", offlineStock: 8, availableStock: 8,
    });
    await barcodeService.generateUnits(companyId, lotB._id, 4);
    serialsB = (await UnitSerial.find({ inventoryId: lotB._id }).sort({ serial: 1 })).map((u) => u.serial);
    await barcodeService.transitionUnits(companyId, serialsB, { toStatus: "in_stock", event: "in_stock", force: true });
  });

  // Urea 3 + DAP 2, exactly as a two-line request would arrive.
  const LINES = () => [
    { productId: String(productId), requiredQty: 3 },
    { productId: String(productB), requiredQty: 2 },
  ];

  test("prefill returns every requested line", async () => {
    const order = await SupplyOrder.create({
      sellerId, companyId, warehouseId: sellerWh._id, sourceWarehouseId: companyWh._id, status: "approved",
      items: [
        { productId, quantity: 5, allocations: [{ inventoryId: lot._id, qty: 3 }] },
        { productId: productB, quantity: 2, allocations: [{ inventoryId: lotB._id, qty: 2 }] },
      ],
    });
    const data = await svc.transferPrefill(companyId, order._id);
    expect(data.items).toHaveLength(2);
    expect(data.items.map((i) => i.productName).sort()).toEqual(["DAP", "Urea"]);
    expect(data.items.find((i) => i.productName === "Urea")).toMatchObject({ requestedQty: 5, approvedQty: 3 });
    expect(data.totalApprovedQty).toBe(5);
  });

  test("the scan finds its own product line and reports that line's remainder", async () => {
    const a = await svc.resolveTransferScan(companyId, {
      code: (await UnitSerial.findOne({ serial: serials[0] })).unit_code,
      fromWarehouseId: companyWh._id, lines: LINES(),
    });
    expect(a.productName).toBe("Urea");
    expect(a.lineRequiredQty).toBe(3);
    expect(a.remainingRequired).toBe(2);          // 3 required − 1 scanned

    // A different product on the same request resolves to ITS line.
    const b = await svc.resolveTransferScan(companyId, {
      code: (await UnitSerial.findOne({ serial: serialsB[0] })).unit_code,
      fromWarehouseId: companyWh._id, lines: LINES(), selectedCodes: [serials[0]],
    });
    expect(b.productName).toBe("DAP");
    expect(b.lineRequiredQty).toBe(2);
    expect(b.remainingRequired).toBe(1);
  });

  test("remaining is counted per product, from the database not the client", async () => {
    // Two Urea units already in; DAP is untouched.
    const r = await svc.resolveTransferScan(companyId, {
      code: (await UnitSerial.findOne({ serial: serialsB[0] })).unit_code,
      fromWarehouseId: companyWh._id, lines: LINES(), selectedCodes: serials.slice(0, 2),
    });
    expect(r.remainingRequired).toBe(1);          // DAP: 2 − 1 just scanned
  });

  test("a product that is not on the request is refused", async () => {
    const other = await Product.create({ companyId, productName: "Zinc" });
    const otherLot = await Inventory.create({
      productId: other._id, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id,
      batchNumber: "Z1", lotNumber: "Z1", offlineStock: 4, availableStock: 4,
    });
    await barcodeService.generateUnits(companyId, otherLot._id, 1);
    const u = await UnitSerial.findOne({ inventoryId: otherLot._id });
    await barcodeService.transitionUnits(companyId, [u.serial], { toStatus: "in_stock", event: "in_stock", force: true });

    await expect(
      svc.resolveTransferScan(companyId, { code: u.unit_code, fromWarehouseId: companyWh._id, lines: LINES() })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("different product") });
  });

  test("scanning past ONE line's quantity is refused while the other is still open", async () => {
    await expect(
      svc.resolveTransferScan(companyId, {
        code: (await UnitSerial.findOne({ serial: serialsB[2] })).unit_code,
        fromWarehouseId: companyWh._id, lines: LINES(),
        selectedCodes: serialsB.slice(0, 2),      // DAP already full at 2
      })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("already been scanned") });
  });

  const confirmLines = async (codes) => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      lines: LINES(), codes,
    }), res);
    return res;
  };

  test("all lines complete → the transfer goes, with both products on it", async () => {
    const res = await confirmLines([...serials.slice(0, 3), ...serialsB.slice(0, 2)]);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.totalUnits).toBe(5);
    expect(res.body.data.items.map((i) => i.productName).sort()).toEqual(["DAP", "Urea"]);

    const order = await SupplyOrder.findById(res.body.data.supplyOrderId);
    expect(order.items).toHaveLength(2);
    expect(order.items.map((i) => i.quantity).sort()).toEqual([2, 3]);
    // Both lots deducted independently.
    expect((await Inventory.findById(lot._id)).availableStock).toBe(7);
    expect((await Inventory.findById(lotB._id)).availableStock).toBe(6);
  });

  test("one line short → refused, and nothing moves", async () => {
    const res = await confirmLines([...serials.slice(0, 3), serialsB[0]]);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain("Scan every requested unit");
    expect(res.body.message).toContain("DAP 1/2");
    expect(await SupplyOrder.countDocuments({})).toBe(0);
    expect((await Inventory.findById(lot._id)).availableStock).toBe(10);
    expect((await Inventory.findById(lotB._id)).availableStock).toBe(8);
  });

  test("one line over-scanned → refused", async () => {
    const res = await confirmLines([...serials.slice(0, 4), ...serialsB.slice(0, 2)]);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain("More units were scanned");
    expect(res.body.message).toContain("Urea 4/3");
    expect(await SupplyOrder.countDocuments({})).toBe(0);
  });

  test("a unit outside the request cannot slip through at confirm", async () => {
    const other = await Product.create({ companyId, productName: "Zinc" });
    const otherLot = await Inventory.create({
      productId: other._id, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id,
      batchNumber: "Z2", lotNumber: "Z2", offlineStock: 4, availableStock: 4,
    });
    await barcodeService.generateUnits(companyId, otherLot._id, 1);
    const u = await UnitSerial.findOne({ inventoryId: otherLot._id });
    await barcodeService.transitionUnits(companyId, [u.serial], { toStatus: "in_stock", event: "in_stock", force: true });

    const res = await confirmLines([...serials.slice(0, 3), ...serialsB.slice(0, 2), u.serial]);
    expect(res.statusCode).toBe(409);
    expect(await SupplyOrder.countDocuments({})).toBe(0);
  });

  test("shipment boxes still work across products in one request", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      lines: LINES(), codes: [...serials.slice(0, 3), ...serialsB.slice(0, 2)],
      boxes: [
        { units: [serials[0], serialsB[0]] },      // a box may mix products
        { units: [serials[1], serials[2], serialsB[1]] },
      ],
    }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.boxes).toHaveLength(2);
    const box = await ShipmentBox.findOne({ shipmentBoxId: res.body.data.boxes[0].shipmentBoxId });
    expect(new Set(box.units.map((u) => String(u.productId))).size).toBe(2);
  });

  test("the single-product path is untouched by any of this", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 2, codes: serials.slice(0, 2),
    }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.totalUnits).toBe(2);
  });
});

/* ─────────── one serial across Send Stock and Shipment Tracking */

describe("the seller request's serial follows its shipment", () => {
  test("a transfer records the request it fulfils, and the shipment reports that serial", async () => {
    const request = await SupplyOrder.create({
      sellerId, companyId, warehouseId: sellerWh._id, sourceWarehouseId: companyWh._id, status: "approved",
      items: [{ productId, quantity: 2, allocations: [{ inventoryId: lot._id, qty: 2 }] }],
    });
    const expected = `SR-${String(request._id).slice(-6).toUpperCase()}`;

    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 2, codes: serials.slice(0, 2),
      supplyOrderId: String(request._id),
    }), res);
    expect(res.statusCode).toBe(201);

    // The transfer points back at the request…
    const transfer = await SupplyOrder.findById(res.body.data.supplyOrderId);
    expect(String(transfer.sourceRequestId)).toBe(String(request._id));

    // …so the tracking table shows the SAME serial the Send Stock list shows.
    const list = mockRes();
    await tmsCtrl.listShipments({
      user: { companyId, id: companyId, role: "operations_manager" }, query: {}, params: {},
    }, list);
    const row = list.body.data.find((x) => String(x._id) === res.body.data.shipmentId);
    expect(row.requestRef).toBe(expected);
  });

  test("a hand-built transfer falls back to its own serial, never null", async () => {
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 1, codes: [serials[0]],
    }), res);
    const transfer = await SupplyOrder.findById(res.body.data.supplyOrderId);
    expect(transfer.sourceRequestId).toBeNull();

    const list = mockRes();
    await tmsCtrl.listShipments({
      user: { companyId, id: companyId, role: "operations_manager" }, query: {}, params: {},
    }, list);
    const row = list.body.data.find((x) => String(x._id) === res.body.data.shipmentId);
    expect(row.requestRef).toBe(`SR-${res.body.data.supplyOrderId.slice(-6).toUpperCase()}`);
  });
});

/* ─────────── the request leaves Send Stock only on a completed transfer */

describe("closing the seller request", () => {
  const makeRequest = () => SupplyOrder.create({
    sellerId, companyId, warehouseId: sellerWh._id, sourceWarehouseId: companyWh._id, status: "approved",
    items: [{ productId, quantity: 2, allocations: [{ inventoryId: lot._id, qty: 2 }] }],
  });
  // What the Send Stock page lists.
  const onSendStock = async () =>
    (await SupplyOrder.find({ companyId, status: "approved" }).lean()).map((o) => String(o._id));

  test("merely opening the transfer page leaves the request untouched", async () => {
    const request = await makeRequest();
    await svc.transferPrefill(companyId, request._id);          // page opened
    expect(await onSendStock()).toContain(String(request._id)); // still listed
    expect((await SupplyOrder.findById(request._id)).status).toBe("approved");
  });

  test("a FAILED transfer leaves the request on the list", async () => {
    const request = await makeRequest();
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 2, codes: ["GHOST-CODE"], supplyOrderId: String(request._id),
    }), res);
    expect(res.statusCode).toBe(409);
    expect(await onSendStock()).toContain(String(request._id));
    expect((await SupplyOrder.findById(request._id)).status).toBe("approved");
  });

  test("a transfer that fails validation part-way also leaves it", async () => {
    const request = await makeRequest();
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 2, codes: serials.slice(0, 2),
      supplyOrderId: String(request._id),
      challanNumber: "",                                        // required → 400
    }), res);
    expect(res.statusCode).toBe(400);
    expect((await SupplyOrder.findById(request._id)).status).toBe("approved");
    expect((await Inventory.findById(lot._id)).availableStock).toBe(10);
  });

  test("a SUCCESSFUL transfer removes it and carries the shipment", async () => {
    const request = await makeRequest();
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 2, codes: serials.slice(0, 2), supplyOrderId: String(request._id),
    }), res);
    expect(res.statusCode).toBe(201);

    const closed = await SupplyOrder.findById(request._id);
    expect(closed.status).toBe("dispatched");                   // no new status
    expect(String(closed.shipmentId)).toBe(res.body.data.shipmentId);
    expect(closed.shipment.dispatchedAt).toBeTruthy();
    expect(await onSendStock()).not.toContain(String(request._id));

    // …and re-opening it from a stale link is refused rather than double-sent.
    await expect(svc.transferPrefill(companyId, request._id))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("already dispatched") });
  });

  test("it appears on the shipment tracking list with the right serial", async () => {
    const request = await makeRequest();
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 2, codes: serials.slice(0, 2), supplyOrderId: String(request._id),
    }), res);

    const list = mockRes();
    await tmsCtrl.listShipments({
      user: { companyId, id: companyId, role: "operations_manager" }, query: {}, params: {},
    }, list);
    const row = list.body.data.find((x) => String(x._id) === res.body.data.shipmentId);
    expect(row).toBeTruthy();
    expect(row.requestRef).toBe(`SR-${String(request._id).slice(-6).toUpperCase()}`);
    expect(row.status).toBe("in_transit");
  });

  test("receiving settles BOTH the request and its transfer", async () => {
    const request = await makeRequest();
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 2, codes: serials.slice(0, 2), supplyOrderId: String(request._id),
    }), res);

    const recv = mockRes();
    await sellerSupply.receiveSupply({
      user: { sellerId }, params: { id: res.body.data.supplyOrderId }, body: { qr: res.body.data.qrPayload },
    }, recv);
    expect(recv.statusCode).toBe(200);

    expect((await SupplyOrder.findById(res.body.data.supplyOrderId)).status).toBe("received");
    expect((await SupplyOrder.findById(request._id)).status).toBe("received");   // kept in step
  });

  test("a hand-built transfer closes no request", async () => {
    const before = await SupplyOrder.countDocuments({});
    const res = mockRes();
    await ctrl.confirmTransfer(req({
      sellerId, destinationWarehouseId: sellerWh._id, fromWarehouseId: companyWh._id,
      productId, quantity: 1, codes: [serials[0]],
    }), res);
    expect(res.statusCode).toBe(201);
    expect(await SupplyOrder.countDocuments({})).toBe(before + 1);
  });
});