/**
 * A Bulk Packaging ID whose Pick Supply scan was REJECTED must leave no trace
 * anywhere downstream: no shipment line, no unit in transit, no seller
 * inventory, no row in Seller Lot Details.
 *
 * The reported failure: dispatch selected the units to send by LOT + QUANTITY
 * (`.limit(line.qty)`) instead of by the serials the picker actually accepted.
 * A rejected box is still `in_stock` on the same lot and — minted first — sorted
 * ahead of the box that was really picked, so it shipped, landed at the seller's
 * receipt and appeared in Seller Lot Details alongside the legitimate box.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const Seller = require("../model/Seller/Seller");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const SupplyOrder = require("../model/Supply/SupplyOrder");
const Shipment = require("../model/Transport/Shipment");
const lotService = require("../services/lotService");
const barcodeService = require("../services/barcodeService");
const sellerTraceService = require("../services/sellerTraceService");
const { resolvePickScan, MSG } = require("../services/pickScanService");
const supplyCtrl = require("../controller/Supply/supplyController");
const sellerSupply = require("../controller/Seller/sellerSupplyController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

let companyId, productId, companyWh, sellerId, sellerWh, lot, box1, box2;

const companyReq = (body, id, query) => ({ user: { companyId, id: companyId }, params: { id }, body, query: query || {} });
const sellerReq = (id, body) => ({ user: { sellerId, principalType: "seller" }, params: { id }, body });

/** Unit codes of one box, in print order. */
const codesOf = (boxSerial) =>
  UnitSerial.find({ inventoryId: lot._id, box_serial: boxSerial })
    .sort({ unit_serial: 1 }).lean().then((r) => r.map((u) => u.serial));

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Supplier", email: `rbp-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    status: "approved", companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  productId = (await Product.create({ companyId, productName: "Urea", skuNumber: "UR", mrp: 270 }))._id;
  companyWh = await Warehouse.create({ companyId, name: "Co WH", code: "CWH" });
  const seller = await Seller.create({
    passwordHash: "x", sellerInfo: { businessName: "Krishna" },
    supplyingCompanyId: companyId, linkStatus: "approved", status: "active",
  });
  sellerId = seller._id;
  sellerWh = await Warehouse.create({ sellerId, name: "Seller WH" });

  // BP-001 and BP-002, 3 units each, on the books in the company warehouse.
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: companyWh._id, qty: 6,
    lotOrigin: "company", pendingReceipt: true,
    hasBulkPackaging: true, numberOfBoxes: 2, unitsPerBox: 3,
  });
  await Inventory.updateOne({ _id: inv._id }, { $set: { inTransitStock: 0, offlineStock: 6, availableStock: 6 } });
  await barcodeService.generateUnits(companyId, inv._id, 6, {});
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  lot = await Inventory.findById(inv._id);
  [box1, box2] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });
});

/** requested → approved, source warehouse assigned. */
async function approvedOrder(qty) {
  const order = await SupplyOrder.create({
    sellerId, companyId, items: [{ productId, quantity: qty }],
    warehouseId: sellerWh._id, status: "requested",
  });
  await supplyCtrl.updateSupplyStatus(companyReq({ status: "approved", sourceWarehouseId: companyWh._id }, order._id), mockRes());
  return SupplyOrder.findById(order._id);
}

test("a REJECTED Bulk Packaging ID never reaches the seller", async () => {
  // Seller needs 2 units. BP-001 holds 3, so its scan is refused outright.
  const order = await approvedOrder(2);

  await expect(resolvePickScan(companyId, {
    code: box1.bulk_packaging_id, orderType: "supply", orderId: order._id, selectedCodes: [],
  })).rejects.toThrow(MSG.packageQtyMismatch(3, 2));

  // The picker takes 2 individual units out of BP-002 instead.
  const box2Codes = await codesOf(2);
  const taken = box2Codes.slice(0, 2);
  await supplyCtrl.pickSupplyOrder(companyReq({ picks: [{ productId, serials: taken }] }, order._id), mockRes());
  await supplyCtrl.packSupplyOrder(companyReq({}, order._id), mockRes());

  // ── the manifest carries the picked serials, and ONLY those ──
  const manifest = mockRes();
  await supplyCtrl.getManifest(companyReq(null, order._id), manifest);
  const { qrPayload, shipmentId } = manifest.body.data;
  const ship = await Shipment.findById(shipmentId);
  expect(ship.lines).toHaveLength(1);
  expect([...ship.lines[0].serials].sort()).toEqual([...taken].sort());

  await supplyCtrl.dispatchSupplyOrder(companyReq({ labelPrinted: true }, order._id), mockRes());

  // ── only the picked units went in transit ──
  const shipped = await UnitSerial.find({ status: "shipped" }).select("serial").lean();
  expect(shipped.map((u) => u.serial).sort()).toEqual([...taken].sort());

  const rejectedBoxUnits = await UnitSerial.find({ bulk_packaging_record_id: box1._id }).lean();
  expect(rejectedBoxUnits).toHaveLength(3);
  expect(rejectedBoxUnits.every((u) => u.status === "in_stock")).toBe(true);
  expect(rejectedBoxUnits.every((u) => u.ownerType === "company")).toBe(true);
  expect(rejectedBoxUnits.every((u) => String(u.inventoryId) === String(lot._id))).toBe(true);

  // ── seller receives ──
  const recv = mockRes();
  await sellerSupply.receiveSupply(sellerReq(order._id, { qr: qrPayload }), recv);
  expect(recv.body.data.status).toBe("received");

  const sellerLot = await Inventory.findOne({ ownerType: "seller", ownerId: sellerId });
  expect(sellerLot.availableStock).toBe(2);

  const sellerUnits = await UnitSerial.find({ ownerType: "seller", ownerId: sellerId }).lean();
  expect(sellerUnits.map((u) => u.serial).sort()).toEqual([...taken].sort());
  // Every seller-owned unit came from BP-002. None from the rejected BP-001.
  expect(sellerUnits.every((u) => String(u.bulk_packaging_record_id) === String(box2._id))).toBe(true);

  // ── Seller Lot Details lists BP-002 and nothing else ──
  const details = await sellerTraceService.getLotDetails(sellerId, sellerLot._id);
  expect(details.bulkPackages).toHaveLength(1);
  expect(details.bulkPackages[0].bulkPackagingId).toBe(box2.bulk_packaging_id);
  expect(details.bulkPackages[0].unitsReceivedBySeller).toBe(2);
  expect(details.bulkPackages.some((b) => b.bulkPackagingId === box1.bulk_packaging_id)).toBe(false);
});

test("a whole accepted box transfers, and only that box", async () => {
  // Seller needs 3 — BP-002 matches exactly, so the box is scanned whole.
  const order = await approvedOrder(3);
  const scan = await resolvePickScan(companyId, {
    code: box2.bulk_packaging_id, orderType: "supply", orderId: order._id, selectedCodes: [],
  });
  expect(scan.addedQuantity).toBe(3);

  await supplyCtrl.pickSupplyOrder(companyReq({ picks: [{ productId, serials: scan.addedUnitCodes }] }, order._id), mockRes());
  await supplyCtrl.packSupplyOrder(companyReq({}, order._id), mockRes());
  const manifest = mockRes();
  await supplyCtrl.getManifest(companyReq(null, order._id), manifest);
  await supplyCtrl.dispatchSupplyOrder(companyReq({ labelPrinted: true }, order._id), mockRes());
  await sellerSupply.receiveSupply(sellerReq(order._id, { qr: manifest.body.data.qrPayload }), mockRes());

  const sellerLot = await Inventory.findOne({ ownerType: "seller", ownerId: sellerId });
  const details = await sellerTraceService.getLotDetails(sellerId, sellerLot._id);
  expect(details.bulkPackages).toHaveLength(1);
  expect(details.bulkPackages[0].bulkPackagingId).toBe(box2.bulk_packaging_id);
  expect(details.bulkPackages[0].unitsReceivedBySeller).toBe(3);

  // BP-001 stayed put, in full.
  const stayed = await UnitSerial.find({ bulk_packaging_record_id: box1._id }).lean();
  expect(stayed).toHaveLength(3);
  expect(stayed.every((u) => u.ownerType === "company" && u.status === "in_stock")).toBe(true);
});

test("non-serialized supply still dispatches on quantity alone", async () => {
  // No serials on the allocation → the line carries none and dispatch keeps the
  // original quantity-only path. Guards the fallback for non-labelled stock.
  const plain = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: companyWh._id, qty: 5,
    lotOrigin: "company", batchNumber: "PLAIN-1",
  });
  await Inventory.updateOne({ _id: plain._id }, { $set: { inTransitStock: 0, offlineStock: 5, availableStock: 5 } });

  const order = await SupplyOrder.create({
    sellerId, companyId, items: [{ productId, quantity: 2 }],
    warehouseId: sellerWh._id, status: "requested",
  });
  await supplyCtrl.updateSupplyStatus(companyReq({ status: "approved", sourceWarehouseId: companyWh._id }, order._id), mockRes());
  await supplyCtrl.pickSupplyOrder(companyReq({ picks: [{ productId, qty: 2 }] }, order._id), mockRes());
  await supplyCtrl.packSupplyOrder(companyReq({}, order._id), mockRes());

  const manifest = mockRes();
  await supplyCtrl.getManifest(companyReq(null, order._id), manifest);
  const dispatch = mockRes();
  await supplyCtrl.dispatchSupplyOrder(companyReq({ labelPrinted: true }, order._id), dispatch);
  expect(dispatch.statusCode).toBe(200);
  expect((await SupplyOrder.findById(order._id)).status).toBe("dispatched");
});
