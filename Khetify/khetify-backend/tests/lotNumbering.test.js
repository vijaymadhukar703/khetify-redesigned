const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const lotService = require("../services/lotService");

let companyId, warehouseId, productId, productCode;

// Current period, as the generator formats it.
const period = () => {
  const now = new Date();
  return { year: now.getFullYear(), month: String(now.getMonth() + 1).padStart(2, "0") };
};

beforeEach(async () => {
  const company = await Company.create({
    fullName: "Lot Co",
    email: `lot-${new mongoose.Types.ObjectId()}@x.com`,
    password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = company._id;
  const wh = await Warehouse.create({ companyId, name: "Khargone", code: "KHA" });
  warehouseId = wh._id;
  const p = await Product.create({ companyId, productName: "Urea Fertilizer", skuNumber: "UR" });
  productId = p._id;
  productCode = p.product_code; // server-generated, e.g. URE105
});

describe("lot numbering modes", () => {
  test("with no lot number supplied, the system auto-generates a Khetify number", async () => {
    const { year, month } = period();
    const day = String(new Date().getDate()).padStart(2, "0");
    const inv = await lotService.receiveLot({ ownerId: companyId, productId, warehouseId, qty: 10 });
    // The generated shape now carries the day and a SKU range over the quantity.
    expect(inv.batchNumber).toBe(`KH-BHO-${productCode}-${year}-${month}-${day}-SKU01~SKU10-0001`);
    expect(inv.lotNumber).toBe(inv.batchNumber);
  });

  test("company-defined lot numbers are stored as given", async () => {
    const inv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId,
      lotNumber: "UR-2026-JUN-001", batchNumber: "UR-2026-JUN-001", qty: 50,
    });
    expect(inv.lotNumber).toBe("UR-2026-JUN-001");
    expect(inv.batchNumber).toBe("UR-2026-JUN-001");
  });

  test("khetify_generated mode increments the serial per lot", async () => {
    await Company.updateOne({ _id: companyId }, { $set: { "imsSettings.lotNumberingMethod": "khetify_generated" } });
    const { year, month } = period();
    const day = String(new Date().getDate()).padStart(2, "0");

    const inv1 = await lotService.receiveLot({ ownerId: companyId, productId, warehouseId, qty: 10 });
    expect(inv1.batchNumber).toBe(`KH-BHO-${productCode}-${year}-${month}-${day}-SKU01~SKU10-0001`);
    expect(inv1.lotNumber).toBe(inv1.batchNumber);

    const inv2 = await lotService.receiveLot({ ownerId: companyId, productId, warehouseId, qty: 5 });
    expect(inv2.batchNumber).toBe(`KH-BHO-${productCode}-${year}-${month}-${day}-SKU01~SKU05-0002`);
  });

  test("khetify_generated mode still honours an explicitly supplied lot number", async () => {
    await Company.updateOne({ _id: companyId }, { $set: { "imsSettings.lotNumberingMethod": "khetify_generated" } });
    const inv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId,
      lotNumber: "UR-2026-JUN-009", batchNumber: "UR-2026-JUN-009", qty: 5,
    });
    expect(inv.batchNumber).toBe("UR-2026-JUN-009"); // existing records & manual lots untouched
  });

  test("batchNumber always shadows the lot number (a divergent client batch is ignored)", async () => {
    // Only a lot number → batch mirrors it.
    const a = await lotService.receiveLot({ ownerId: companyId, productId, warehouseId, lotNumber: "LOT-A", qty: 5 });
    expect(a.lotNumber).toBe("LOT-A");
    expect(a.batchNumber).toBe("LOT-A");

    // A client-supplied batchNumber that differs from the lot is ignored —
    // the lot number wins and the batch is forced equal to it.
    const b = await lotService.receiveLot({ ownerId: companyId, productId, warehouseId, lotNumber: "LOT-B", batchNumber: "DIFFERENT-B", qty: 5 });
    expect(b.lotNumber).toBe("LOT-B");
    expect(b.batchNumber).toBe("LOT-B");
  });

  test("receiveLot persists the lot's manufacturing date on the Inventory row", async () => {
    const mfg = new Date("2026-06-01");
    const inv = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId,
      lotNumber: "UR-MFG-001", batchNumber: "UR-MFG-001", mfgDate: mfg, qty: 10,
    });
    expect(inv.mfgDate).toBeTruthy();
    expect(new Date(inv.mfgDate).toISOString()).toBe(mfg.toISOString());
  });

  test("company_defined: the chosen lot number is used even if only the Lot Number field is filled", async () => {
    // company_defined is the default; operator types their own lot, no batchNumber
    const inv = await lotService.receiveLot({ ownerId: companyId, productId, warehouseId, lotNumber: "UR-2026-JUN-001", qty: 50 });
    expect(inv.lotNumber).toBe("UR-2026-JUN-001");
    expect(inv.batchNumber).toBe("UR-2026-JUN-001"); // chosen lot becomes the batch identity
  });
});
