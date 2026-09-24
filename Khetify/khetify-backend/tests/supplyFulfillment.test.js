const mongoose = require("mongoose");
require("../model/Company/Company");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const Seller = require("../model/Seller/Seller");
const User = require("../model/User/User");
const UnitSerial = require("../model/Barcode/UnitSerial");
const StockMovement = require("../model/Inventory/StockMovement");
const Discrepancy = require("../model/Transport/Discrepancy");
const SupplyOrder = require("../model/Supply/SupplyOrder");
const Order = require("../model/Order/Order");
const Shipment = require("../model/Transport/Shipment");
const PickList = require("../model/Outbound/PickList");
const shipmentService = require("../services/shipmentService");
const barcodeService = require("../services/barcodeService");
const lotService = require("../services/lotService");
const pickService = require("../services/pickService");
const supplyCtrl = require("../controller/Supply/supplyController");
const sellerSupply = require("../controller/Seller/sellerSupplyController");
const sellerWarehouseCtrl = require("../controller/Seller/sellerWarehouseController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const invSum = (r) => (r.onlineStock || 0) + (r.offlineStock || 0) - (r.reservedStock || 0);

let companyId, productId, companyWh, sellerId, sellerWh, lot, serials, receiver;

// RECEIVING IS WAREHOUSE WORK: the seller account itself may track an inbound
// supply but never receive it. Receipts are made as a seller_manager assigned
// to the destination warehouse — a real User row, which is where the warehouse
// scope is read from.
const receivingUser = () => ({ id: receiver._id, sellerId, principalType: "seller", role: "seller_manager" });

beforeEach(async () => {
  const c = await Company.create({ fullName: "Supplier", email: `s-${new mongoose.Types.ObjectId()}@x.com`, password: "x", status: "approved", companyInfo: { companyName: "Supplier Co" } });
  companyId = c._id;
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "UR", mrp: 270 });
  productId = p._id;
  companyWh = await Warehouse.create({ companyId, name: "Co WH", code: "CWH" });
  const seller = await Seller.create({ passwordHash: "x", sellerInfo: { businessName: "Krishna" }, supplyingCompanyId: companyId, linkStatus: "approved", status: "active" });
  sellerId = seller._id;
  sellerWh = await Warehouse.create({ sellerId, name: "Seller WH" });
  receiver = await User.create({
    ownerType: "seller", ownerId: sellerId, name: "Seller WH manager",
    role: "seller_manager", status: "active", warehouseIds: [sellerWh._id],
  });
  lot = await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id, batchNumber: "L1", lotNumber: "L1", expiryDate: new Date("2027-01-01"), mfgDate: new Date("2026-01-01"), offlineStock: 10, availableStock: 10 });
  await barcodeService.generateUnits(companyId, lot._id, 5);
  // The labeled units are received into stock (as a GRN would leave them).
  serials = (await UnitSerial.find({ ownerId: companyId, inventoryId: lot._id }).sort({ serial: 1 })).map((u) => u.serial);
  await barcodeService.transitionUnits(companyId, serials, { toStatus: "in_stock", event: "in_stock", force: true });
});

const companyReq = (body, id, query) => ({ user: { companyId, id: companyId }, params: { id }, body, query: query || {} });

/** requested → approved (FEFO-reserve from the assigned source warehouse). */
async function approvedOrder(qty = 3) {
  const order = await SupplyOrder.create({ sellerId, companyId, items: [{ productId, quantity: qty }], warehouseId: sellerWh._id, status: "requested" });
  await supplyCtrl.updateSupplyStatus(companyReq({ status: "approved", sourceWarehouseId: companyWh._id }, order._id), mockRes());
  return SupplyOrder.findById(order._id);
}

/** approved → picked (scan-pick directly, no wave). */
async function pickedOrder(qty = 3) {
  const order = await approvedOrder(qty);
  const take = serials.slice(0, qty);
  await supplyCtrl.pickSupplyOrder(companyReq({ picks: [{ productId, serials: take }] }, order._id), mockRes());
  return SupplyOrder.findById(order._id);
}

/** picked → packed. */
async function packedOrder(qty = 3) {
  const order = await pickedOrder(qty);
  await supplyCtrl.packSupplyOrder(companyReq({}, order._id), mockRes());
  return SupplyOrder.findById(order._id);
}

/** packed → manifest (label) → dispatched. Returns { order, qrPayload, shipmentId }. */
async function manifested(qty = 3) {
  const order = await packedOrder(qty);
  const res = mockRes();
  await supplyCtrl.getManifest(companyReq(null, order._id), res);
  return { order, qrPayload: res.body.data.qrPayload, shipmentId: res.body.data.shipmentId };
}
async function dispatched(qty = 3) {
  const { order, qrPayload, shipmentId } = await manifested(qty);
  await supplyCtrl.dispatchSupplyOrder(companyReq({ labelPrinted: true }, order._id), mockRes());
  return { order: await SupplyOrder.findById(order._id), qrPayload, shipmentId };
}

describe("approved supply is pickable directly (stage=pick), NO wave", () => {
  test("approve plans FEFO WITHOUT reserving, and the order appears under stage=pick", async () => {
    const order = await approvedOrder(3);
    expect(order.status).toBe("approved");
    expect(order.items[0].allocations.length).toBe(1);
    // Approval is authorization only: it records the lot the warehouse will pick
    // from, but reserves nothing — stock is reserved at pick (see "direct /pick").
    expect(order.items[0].allocations[0].qty).toBe(3);
    expect(order.items[0].allocations[0].reservedQty).toBe(0);

    const co = await Inventory.findById(lot._id);
    expect(co.reservedStock).toBe(0);
    expect(co.offlineStock).toBe(10);
    expect(co.availableStock).toBe(10);
    expect(invSum(co)).toBe(co.availableStock);

    const res = mockRes();
    await supplyCtrl.getSupplyOrders(companyReq(null, null, { stage: "pick" }), res);
    expect(res.body.data.some((o) => String(o._id) === String(order._id))).toBe(true);
  });

  test("supply does NOT use the wave engine — generateWave rejects supplyOrderIds-only", async () => {
    await expect(pickService.generateWave(companyId, { supplyOrderIds: [new mongoose.Types.ObjectId()] }))
      .rejects.toThrow(/orderIds are required/);
  });
});

describe("direct /pick", () => {
  test("scanned units in_stock → picked, pickedQty updated, owned stock NOT deducted", async () => {
    const order = await pickedOrder(3);
    expect(order.status).toBe("picked");
    expect(order.items[0].pickedQty).toBe(3);
    expect(order.items[0].allocations[0].serials.length).toBe(3);

    const picked = await UnitSerial.find({ ownerId: companyId, status: "picked" });
    expect(picked.length).toBe(3);

    // still reserved, nothing deducted from owned stock yet
    const co = await Inventory.findById(lot._id);
    expect(co.reservedStock).toBe(3);
    expect(co.offlineStock).toBe(10);
    expect(co.availableStock).toBe(7);
    expect(invSum(co)).toBe(co.availableStock);

    // appears under stage=pack now (status picked)
    const res = mockRes();
    await supplyCtrl.getSupplyOrders(companyReq(null, null, { stage: "pack" }), res);
    expect(res.body.data.some((o) => String(o._id) === String(order._id))).toBe(true);
  });

  test("a partial pick keeps the order in 'picking'", async () => {
    const order = await approvedOrder(3);
    await supplyCtrl.pickSupplyOrder(companyReq({ picks: [{ productId, serials: serials.slice(0, 2) }] }, order._id), mockRes());
    const fresh = await SupplyOrder.findById(order._id);
    expect(fresh.status).toBe("picking");
    expect(fresh.items[0].pickedQty).toBe(2);
  });
});

describe("direct /pack", () => {
  test("picked → packed; packedQty set; status packed", async () => {
    const order = await packedOrder(3);
    expect(order.status).toBe("packed");
    expect(order.items[0].packedQty).toBe(3);
    const packed = await UnitSerial.find({ ownerId: companyId, status: "packed" });
    expect(packed.length).toBe(3);
  });
});

describe("/manifest — label-time planned shipment + stable token", () => {
  test("creates a planned seller shipment with a non-empty qrPayload; idempotent", async () => {
    const order = await packedOrder(3);
    const res1 = mockRes();
    await supplyCtrl.getManifest(companyReq(null, order._id), res1);
    const { shipmentId, qrPayload } = res1.body.data;
    expect(qrPayload).toMatch(/^[a-f0-9]{24}\.[a-f0-9]+$/i);
    expect(qrPayload).toBe(`${shipmentId}.${(await Shipment.findById(shipmentId)).qrToken}`);

    const ship = await Shipment.findById(shipmentId);
    expect(ship.refType).toBe("SupplyOrder");
    expect(ship.toType).toBe("seller");
    expect(ship.status).toBe("planned"); // not dispatched yet — label only
    expect(ship.qrToken).toBeTruthy();

    // idempotent: a second call reuses the same shipment + token
    const res2 = mockRes();
    await supplyCtrl.getManifest(companyReq(null, order._id), res2);
    expect(String(res2.body.data.shipmentId)).toBe(String(shipmentId));
    expect(res2.body.data.qrPayload).toBe(qrPayload);
    expect(await Shipment.countDocuments({ refType: "SupplyOrder", refId: order._id })).toBe(1);
  });
});

describe("/dispatch", () => {
  test("label gate: labelPrinted false → 409, nothing committed", async () => {
    const order = await packedOrder(3);
    const res = mockRes();
    await supplyCtrl.dispatchSupplyOrder(companyReq({ labelPrinted: false }, order._id), res);
    expect(res.statusCode).toBe(409);
    expect((await Inventory.findById(lot._id)).reservedStock).toBe(3);
  });

  test("no manifest yet → 409 (print the label first)", async () => {
    const order = await packedOrder(3);
    const res = mockRes();
    await supplyCtrl.dispatchSupplyOrder(companyReq({ labelPrinted: true }, order._id), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/shipping label/i);
  });

  test("with label → commits source (supply_out), units in-transit, shipment in_transit, SAME token", async () => {
    const { order, qrPayload, shipmentId } = await manifested(3);
    const tokenBefore = (await Shipment.findById(shipmentId)).qrToken;

    const res = mockRes();
    await supplyCtrl.dispatchSupplyOrder(companyReq({ labelPrinted: true, vehicleNo: "MP20 GA 1" }, order._id), res);
    expect(res.body.success).toBe(true);

    const co = await Inventory.findById(lot._id);
    expect(co.offlineStock).toBe(7); // 10 − 3 left the building
    expect(co.reservedStock).toBe(0); // reservation committed
    expect(co.availableStock).toBe(7);
    expect(invSum(co)).toBe(co.availableStock); // online+offline−reserved holds

    expect(await StockMovement.countDocuments({ type: "supply_out", refType: "SupplyOrder", refId: shipmentId })).toBe(1);

    const ship = await Shipment.findById(shipmentId);
    expect(ship.status).toBe("in_transit");
    expect(ship.qrToken).toBe(tokenBefore); // token UNCHANGED → printed barcode still valid
    expect(`${ship._id}.${ship.qrToken}`).toBe(qrPayload);
    expect(ship.vehicleNo).toBe("MP20 GA 1");

    const shipped = await UnitSerial.find({ ownerType: "company", ownerId: companyId, status: "shipped" });
    expect(shipped.length).toBe(3);
    expect(shipped.every((u) => String(u.currentShipmentId) === String(shipmentId))).toBe(true);

    expect((await SupplyOrder.findById(order._id)).status).toBe("dispatched");
  });
});

describe("seller scan-verify receives into seller stock (unchanged)", () => {
  const sellerReq = (orderId, body) => ({ user: receivingUser(), params: { id: orderId }, body });

  test("full receipt lands seller stock with the original lot + seller-owned units", async () => {
    const { order, qrPayload } = await dispatched(3);
    const res = mockRes();
    await sellerSupply.receiveSupply(sellerReq(order._id, { qr: qrPayload }), res);
    expect(res.body.data.status).toBe("received");

    const sLot = await Inventory.findOne({ ownerType: "seller", ownerId: sellerId, batchNumber: "L1" });
    expect(sLot.availableStock).toBe(3);
    expect(String(sLot.warehouseId)).toBe(String(sellerWh._id));
    expect(sLot.lotNumber).toBe("L1");
    expect(invSum(sLot)).toBe(sLot.availableStock);
    expect(await StockMovement.countDocuments({ ownerType: "seller", ownerId: sellerId, type: "supply_in" })).toBe(1);

    const sUnits = await UnitSerial.find({ ownerType: "seller", ownerId: sellerId });
    expect(sUnits.length).toBe(3);
    expect(sUnits.every((u) => u.status === "in_stock")).toBe(true);
    expect(sUnits.every((u) => String(u.companyId) === String(companyId))).toBe(true);
  });

  test("a shortage yields partially_received + a Discrepancy", async () => {
    const { order, qrPayload } = await dispatched(3);
    const res = mockRes();
    await sellerSupply.receiveSupply(sellerReq(order._id, { qr: qrPayload, lines: [{ lineIndex: 0, receivedQty: 2 }] }), res);
    expect(res.body.data.status).toBe("partially_received");
    const sLot = await Inventory.findOne({ ownerType: "seller", ownerId: sellerId, batchNumber: "L1" });
    expect(sLot.availableStock).toBe(2);
    expect(await Discrepancy.countDocuments({ shipmentId: (await SupplyOrder.findById(order._id)).shipmentId })).toBe(1);
  });

  test("receive WITHOUT scanning the manifest QR → 400, nothing landed", async () => {
    const { order } = await dispatched(3);
    const res = mockRes();
    await sellerSupply.receiveSupply(sellerReq(order._id, {}), res);
    expect(res.statusCode).toBe(400);
    expect(await Inventory.countDocuments({ ownerType: "seller", ownerId: sellerId })).toBe(0);
  });

  test("a forged manifest QR is rejected (409), nothing landed", async () => {
    const { order } = await dispatched(3);
    const res = mockRes();
    await sellerSupply.receiveSupply(sellerReq(order._id, { qr: "deadbeef.0000" }), res);
    expect(res.statusCode).toBe(409);
    expect(await Inventory.countDocuments({ ownerType: "seller", ownerId: sellerId })).toBe(0);
  });
});

describe("seller warehouse stock summary (real, owner-scoped)", () => {
  const sellerReq = (orderId, body) => ({ user: receivingUser(), params: { id: orderId }, body });

  test("reflects landed stock and is scoped to the seller's own inventory", async () => {
    // before any receive: empty
    const empty = mockRes();
    await sellerWarehouseCtrl.getSellerWarehouseStockSummary({ user: { sellerId }, params: { id: sellerWh._id } }, empty);
    expect(empty.body.data.totalUnits).toBe(0);
    expect(empty.body.data.lotCount).toBe(0);

    // dispatch + seller scan-receive 3 units
    const { order, qrPayload } = await dispatched(3);
    await sellerSupply.receiveSupply(sellerReq(order._id, { qr: qrPayload }), mockRes());

    const res = mockRes();
    await sellerWarehouseCtrl.getSellerWarehouseStockSummary({ user: { sellerId }, params: { id: sellerWh._id } }, res);
    expect(res.body.success).toBe(true);
    expect(String(res.body.data.warehouseId)).toBe(String(sellerWh._id));
    expect(res.body.data.totalUnits).toBe(3); // landed units only
    expect(res.body.data.lotCount).toBe(1);
    // owner-scoped: the company's 10 units in its own warehouse are NOT counted
  });

  test("the warehouse list includes per-warehouse fill (usedUnits/lotCount)", async () => {
    const { order, qrPayload } = await dispatched(3);
    await sellerSupply.receiveSupply(sellerReq(order._id, { qr: qrPayload }), mockRes());

    const res = mockRes();
    await sellerWarehouseCtrl.getSellerWarehouses({ user: { sellerId } }, res);
    const row = res.body.data.find((w) => String(w._id) === String(sellerWh._id));
    expect(row.usedUnits).toBe(3);
    expect(row.lotCount).toBe(1);
  });
});

describe("confirmed-ORDER wave flow is UNCHANGED", () => {
  test("generateWave still builds a PickList from a confirmed order", async () => {
    const ord = await Order.create({ companyId, orderNumber: "O-1", invoiceNumber: "INV-1", customerName: "Ramesh", channel: "offline", status: "confirmed", items: [{ productId, name: "Urea", qty: 2, price: 100, allocations: [] }] });
    ord.items[0].allocations = await lotService.allocateFEFO({ ownerId: companyId, productId, qty: 2 });
    ord.markModified("items"); await ord.save();

    const wave = await pickService.generateWave(companyId, { warehouseId: companyWh._id, orderIds: [ord._id] });
    expect(wave.lines.length).toBe(1);
    expect(wave.lines[0].qty).toBe(2);
    expect(String(wave.orderIds[0])).toBe(String(ord._id));
    expect(await PickList.countDocuments({ companyId })).toBe(1);
  });
});
