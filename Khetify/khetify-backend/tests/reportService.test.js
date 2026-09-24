const mongoose = require("mongoose");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const Order = require("../model/Order/Order");
const reportService = require("../services/reportService");
const lotService = require("../services/lotService");

const companyId = new mongoose.Types.ObjectId();
let warehouseId, productId;

beforeEach(async () => {
  const wh = await Warehouse.create({ companyId, name: "Main", code: "WH1" });
  warehouseId = wh._id;
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "U1", hsnCode: "3102", mrp: 100 });
  productId = p._id;
});

describe("weighted-average cost + the stock-on-hand row's price columns", () => {
  test("receiving at different unit costs blends the weighted-average cost", async () => {
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId, batchNumber: "B1", qty: 10, unitCost: 100 });
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId, batchNumber: "B1", qty: 10, unitCost: 200 });
    const inv = await Inventory.findOne({ ownerId: companyId, batchNumber: "B1" });
    expect(inv.costPrice).toBe(150); // (10*100 + 10*200)/20

    const rows = await reportService.runReport("stock-on-hand", companyId, {});
    const row = rows.find((r) => r.lot === "B1");
    // Each column of this report, spelled out — `value` is the product's MRP per
    // unit (the UI labels the column "MRP"), NOT a stock valuation. The stock
    // worth is `amount`, at selling price. Cost stays per unit in `costPrice`.
    expect(row.qty).toBe(20);
    expect(row.costPrice).toBe(150); // weighted average, per unit
    expect(row.value).toBe(100);     // product MRP, per unit
    expect(row.amount).toBe(2000);   // 20 × 100, at selling price (MRP here)
  });
});

describe("stock-aging buckets", () => {
  test("a freshly-received lot lands in the 0-30 bucket", async () => {
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId, batchNumber: "B2", qty: 5, unitCost: 10 });
    const rows = await reportService.runReport("stock-aging", companyId, {});
    expect(rows[0].bucket).toBe("0-30");
  });
});

describe("fast/slow movers + dead stock", () => {
  test("a product with on-hand and no sales is flagged dead", async () => {
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId, batchNumber: "B3", qty: 50, unitCost: 10 });
    const rows = await reportService.runReport("fast-slow-movers", companyId, {});
    const row = rows.find((r) => r.product === "Urea");
    expect(row.onHand).toBe(50);
    expect(row.outQty).toBe(0);
    expect(row.dead).toBe(true);
  });
});

describe("GST sales register + HSN summary", () => {
  test("aggregates invoice tax and HSN totals", async () => {
    await Order.create({
      companyId, invoiceNumber: "INV-2627-0001", customerName: "Ramesh", status: "delivered", placedAt: new Date(),
      items: [{ productId, name: "Urea", qty: 10, price: 100, taxes: { hsnCode: "3102", gstRate: 5, taxable: 1000, cgst: 25, sgst: 25, igst: 0 } }],
      totalAmount: 1000, totalTax: 50,
    });
    const reg = await reportService.runReport("gst-sales-register", companyId, {});
    expect(reg).toHaveLength(1);
    expect(reg[0].taxable).toBe(1000);
    expect(reg[0].total).toBe(1050);

    const hsn = await reportService.runReport("gst-hsn-summary", companyId, {});
    expect(hsn[0].hsn).toBe("3102");
    expect(hsn[0].totalTax).toBe(50);
  });
});

describe("CSV streaming", () => {
  test("streamCsv writes a header row and escapes commas/quotes", () => {
    const chunks = [];
    const res = { setHeader() {}, write: (s) => chunks.push(s), end: (s) => { if (s) chunks.push(s); } };
    reportService.streamCsv(res, "t", [{ a: 1, b: "x,y" }, { a: 2, b: 'he said "hi"' }]);
    const out = chunks.join("");
    expect(out.split("\n")[0]).toBe("a,b");
    expect(out).toContain('"x,y"');
    expect(out).toContain('"he said ""hi"""');
  });
});

describe("report registry", () => {
  test("advanced reports are flagged for plan gating", () => {
    expect(reportService.ADVANCED.has("expiry-risk")).toBe(true);
    expect(reportService.ADVANCED.has("stock-on-hand")).toBe(false); // basic
  });
});
