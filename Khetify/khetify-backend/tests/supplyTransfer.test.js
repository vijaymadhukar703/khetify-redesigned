const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const Seller = require("../model/Seller/Seller");
const PrincipalCertificate = require("../model/PC/PrincipalCertificate");
const pcService = require("../services/pcService");
const lotService = require("../services/lotService");
const sellerSupply = require("../controller/Seller/sellerSupplyController");

// An active PC (the authorization) for (seller, company).
async function mintPc(sellerId, companyId) {
  const until = new Date(); until.setFullYear(until.getFullYear() + 1);
  await PrincipalCertificate.create({
    pcNumber: `KH-PC-${String(companyId).slice(-4)}-${Date.now()}-${Math.round(Math.random() * 1e6)}`, sellerId, companyId,
    validFrom: new Date(), validUntil: until, status: "active",
    govt: { required: false, status: "not_required" }, issuedAt: new Date(),
  });
  await pcService.reconcileLink(sellerId, companyId);
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const inv = (sum) => (sum.onlineStock || 0) + (sum.offlineStock || 0) - (sum.reservedStock || 0);

// FEFO only draws on lots that have NOT expired, so every expiry here is
// relative to today (fixed dates silently expire and change the scenario).
// Order is the point: OTHER expires soonest, then EARLY, then LATE.
const DAY = 86400000;
const daysFromNow = (n) => new Date(Date.now() + n * DAY);
const OTHER_EXPIRY = daysFromNow(30);
const EARLY_EXPIRY = daysFromNow(60);
const LATE_EXPIRY = daysFromNow(240);
const EARLY_MFG = new Date("2026-01-01");

let companyId, productId, companyWh, sellerId, sellerWh;
const performedBy = new mongoose.Types.ObjectId();

beforeEach(async () => {
  const c = await Company.create({ fullName: "Supplier", email: `s-${new mongoose.Types.ObjectId()}@x.com`, password: "x", status: "approved", companyInfo: { companyName: "Supplier Co" } });
  companyId = c._id;
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "UR", productStatus: "active", productUpload: "uploaded" });
  productId = p._id;
  companyWh = await Warehouse.create({ companyId, name: "Co WH", code: "CWH" });

  const seller = await Seller.create({ passwordHash: "x", sellerInfo: { businessName: "Krishna" }, supplyingCompanyId: companyId, status: "active" });
  sellerId = seller._id;
  // Supply requests now target a company that ISSUED this seller an active PC.
  await mintPc(sellerId, companyId);
  sellerWh = await Warehouse.create({ sellerId, name: "Seller WH", code: "SWH" });

  // two company lots, FEFO order: EARLY (20, sooner) then LATE (40, later)
  await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id, batchNumber: "EARLY", lotNumber: "EARLY", expiryDate: EARLY_EXPIRY, mfgDate: EARLY_MFG, offlineStock: 20, availableStock: 20 });
  await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id, batchNumber: "LATE", lotNumber: "LATE", expiryDate: LATE_EXPIRY, mfgDate: new Date("2026-02-01"), offlineStock: 40, availableStock: 40 });
});

describe("lotService.supplyTransfer (company → seller)", () => {
  test("FEFO-depletes company lots, mirrors lot identity to the seller, writes supply_out/in", async () => {
    const refId = new mongoose.Types.ObjectId();
    const summary = await lotService.supplyTransfer({
      companyId, sellerId, sourceWarehouseId: companyWh._id, destWarehouseId: sellerWh._id,
      items: [{ productId, quantity: 30 }], refId, performedBy,
    });

    // EARLY (20) consumed first, then LATE (10)
    const early = await Inventory.findOne({ ownerType: "company", ownerId: companyId, batchNumber: "EARLY" });
    const late = await Inventory.findOne({ ownerType: "company", ownerId: companyId, batchNumber: "LATE" });
    expect(early.availableStock).toBe(0);
    expect(late.availableStock).toBe(30);

    // seller lots mirror identity (same lotNumber/expiry/mfg) in the seller warehouse
    const sEarly = await Inventory.findOne({ ownerType: "seller", ownerId: sellerId, batchNumber: "EARLY" });
    const sLate = await Inventory.findOne({ ownerType: "seller", ownerId: sellerId, batchNumber: "LATE" });
    expect(sEarly.availableStock).toBe(20);
    expect(sLate.availableStock).toBe(10);
    expect(String(sEarly.warehouseId)).toBe(String(sellerWh._id));
    expect(sEarly.lotNumber).toBe("EARLY");
    expect(new Date(sEarly.expiryDate).toISOString()).toBe(EARLY_EXPIRY.toISOString());
    expect(new Date(sEarly.mfgDate).toISOString()).toBe(EARLY_MFG.toISOString());

    // ledger: supply_out on company, supply_in on seller, refType SupplyOrder, NO sale_*
    const outs = await StockMovement.find({ ownerType: "company", ownerId: companyId, type: "supply_out" });
    const ins = await StockMovement.find({ ownerType: "seller", ownerId: sellerId, type: "supply_in" });
    expect(outs.length).toBe(2);
    expect(ins.length).toBe(2);
    expect(outs.every((m) => m.refType === "SupplyOrder")).toBe(true);
    expect(ins.every((m) => m.refType === "SupplyOrder")).toBe(true);
    const sales = await StockMovement.find({ type: { $in: ["sale_online", "sale_offline"] } });
    expect(sales.length).toBe(0);

    // summary shape
    expect(summary[0].productId).toBeTruthy();
    expect(summary[0].lots).toEqual([{ lotNumber: "EARLY", qty: 20 }, { lotNumber: "LATE", qty: 10 }]);

    // availableStock = online + offline − reserved on both sides
    for (const row of [early, late, sEarly, sLate]) expect(row.availableStock).toBe(inv(row));
  });

  test("insufficient company stock → 409 and nothing is written (atomic)", async () => {
    const before = await StockMovement.countDocuments({});
    await expect(lotService.supplyTransfer({
      companyId, sellerId, sourceWarehouseId: companyWh._id, destWarehouseId: sellerWh._id,
      items: [{ productId, quantity: 1000 }], refId: new mongoose.Types.ObjectId(), performedBy,
    })).rejects.toMatchObject({ status: 409 });

    // company lots untouched, no seller rows, no ledger rows
    const early = await Inventory.findOne({ ownerType: "company", ownerId: companyId, batchNumber: "EARLY" });
    expect(early.availableStock).toBe(20);
    expect(await Inventory.countDocuments({ ownerType: "seller", ownerId: sellerId })).toBe(0);
    expect(await StockMovement.countDocuments({})).toBe(before);
  });

  test("FEFO is scoped to the ASSIGNED source warehouse only (other warehouses untouched)", async () => {
    // a SECOND company warehouse with stock for the same product
    const companyWh2 = await Warehouse.create({ companyId, name: "Co WH2", code: "CW2" });
    await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId: companyWh2._id, batchNumber: "OTHER", lotNumber: "OTHER", expiryDate: OTHER_EXPIRY, offlineStock: 100, availableStock: 100 });

    const summary = await lotService.supplyTransfer({
      companyId, sellerId, sourceWarehouseId: companyWh._id, destWarehouseId: sellerWh._id,
      items: [{ productId, quantity: 30 }], refId: new mongoose.Types.ObjectId(), performedBy,
    });

    // OTHER (in companyWh2) is NOT touched even though it expires soonest
    const other = await Inventory.findOne({ ownerType: "company", ownerId: companyId, batchNumber: "OTHER" });
    expect(other.availableStock).toBe(100);
    expect(summary[0].lots.map((l) => l.lotNumber)).toEqual(["EARLY", "LATE"]);
    // only the source warehouse's lots were consumed
    const early = await Inventory.findOne({ ownerType: "company", ownerId: companyId, batchNumber: "EARLY" });
    expect(early.availableStock).toBe(0);
  });

  test("approving without a source warehouse → 400, nothing written", async () => {
    const before = await StockMovement.countDocuments({});
    await expect(lotService.supplyTransfer({
      companyId, sellerId, destWarehouseId: sellerWh._id, // no sourceWarehouseId
      items: [{ productId, quantity: 5 }], refId: new mongoose.Types.ObjectId(), performedBy,
    })).rejects.toMatchObject({ status: 400 });
    expect(await StockMovement.countDocuments({})).toBe(before);
    expect(await Inventory.countDocuments({ ownerType: "seller", ownerId: sellerId })).toBe(0);
  });

  test("rejects a destination warehouse the seller does not own (403)", async () => {
    await expect(lotService.supplyTransfer({
      companyId, sellerId, sourceWarehouseId: companyWh._id, destWarehouseId: companyWh._id, // company's WH, not the seller's
      items: [{ productId, quantity: 5 }], refId: new mongoose.Types.ObjectId(), performedBy,
    })).rejects.toMatchObject({ status: 403 });
  });
});

describe("seller supply request validation", () => {
  const asSeller = (sid, body) => ({ user: { sellerId: sid, principalType: "seller" }, body });

  test("creates a requested order into the seller's own warehouse", async () => {
    const res = mockRes();
    await sellerSupply.createSellerSupplyOrder(asSeller(sellerId, { items: [{ productId, quantity: 5 }], warehouseId: sellerWh._id }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.status).toBe("requested");
    expect(String(res.body.data.companyId)).toBe(String(companyId));
  });

  test("rejects a warehouse the seller doesn't own (403)", async () => {
    const res = mockRes();
    await sellerSupply.createSellerSupplyOrder(asSeller(sellerId, { items: [{ productId, quantity: 5 }], warehouseId: companyWh._id }), res);
    expect(res.statusCode).toBe(403);
  });

  test("rejects a product outside the supplying company (400)", async () => {
    const otherCompany = await Company.create({ fullName: "Other", email: `o-${new mongoose.Types.ObjectId()}@x.com`, password: "x", status: "approved" });
    const foreignProduct = await Product.create({ companyId: otherCompany._id, productName: "Foreign", skuNumber: "FX" });
    const res = mockRes();
    await sellerSupply.createSellerSupplyOrder(asSeller(sellerId, { items: [{ productId: foreignProduct._id, quantity: 5 }], warehouseId: sellerWh._id }), res);
    expect(res.statusCode).toBe(400);
  });

  test("an unapproved seller is blocked (403)", async () => {
    const pending = await Seller.create({ passwordHash: "x", sellerInfo: { businessName: "Pending" }, supplyingCompanyId: companyId, linkStatus: "pending" });
    const res = mockRes();
    await sellerSupply.createSellerSupplyOrder(asSeller(pending._id, { items: [{ productId, quantity: 5 }], warehouseId: sellerWh._id }), res);
    expect(res.statusCode).toBe(403);
  });
});
