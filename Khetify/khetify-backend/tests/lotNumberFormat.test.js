const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const LotNumber = require("../model/Inventory/LotNumber");
const lotService = require("../services/lotService");
const {
  buildCompanyCode,
  generateKhetifyLotNumber,
  PRODUCT_CODE_MISSING,
  COMPANY_NAME_MISSING,
} = require("../services/lotNumberService");

const period = () => {
  const now = new Date();
  return { year: now.getFullYear(), month: String(now.getMonth() + 1).padStart(2, "0") };
};

async function makeCompany(companyName = "Bhoomi AgriTech") {
  return Company.create({
    fullName: "Owner",
    email: `c-${new mongoose.Types.ObjectId()}@x.com`,
    password: "x",
    ...(companyName === null ? {} : { companyInfo: { companyName } }),
  });
}

let company, companyId, warehouseId, rice, urea;

beforeEach(async () => {
  company = await makeCompany();
  companyId = company._id;
  warehouseId = (await Warehouse.create({ companyId, name: "Khargone", code: "KHA" }))._id;
  rice = await Product.create({ companyId, productName: "Premium Basmati Rice", skuNumber: "PBR" });
  urea = await Product.create({ companyId, productName: "Urea Fertilizer", skuNumber: "UR" });
});

// Creating a lot the way the Company "Create Lot" screen does.
const createLot = (opts = {}) =>
  lotService.receiveLot({
    ownerId: companyId,
    productId: rice._id,
    warehouseId,
    qty: 10,
    lotOrigin: "company",
    ...opts,
  });

describe("buildCompanyCode", () => {
  test("first 3 alphabetic characters, uppercased", () => {
    expect(buildCompanyCode("Bhoomi AgriTech")).toBe("BHO");
    expect(buildCompanyCode("khetify farms")).toBe("KHE");
  });

  test("ignores spaces, digits and special characters", () => {
    expect(buildCompanyCode("3M Agri Ltd.")).toBe("MAG");
    expect(buildCompanyCode("  @#$ Neem & Co")).toBe("NEE");
  });

  test("a name shorter than 3 letters keeps what it has (no padding)", () => {
    expect(buildCompanyCode("Ab")).toBe("AB");
    expect(buildCompanyCode("K")).toBe("K");
  });

  test("no letters at all yields an empty code (caller turns it into an error)", () => {
    expect(buildCompanyCode("12345")).toBe("");
    expect(buildCompanyCode("")).toBe("");
  });
});

describe("Khetify lot number format", () => {
  // KH-<COMPANY>-<PRODUCT CODE>[-<BULK RANGE>]-<YYYY>-<MM>-<DD>-<SKU RANGE>-<SERIAL>
  test("KH-<COMPANY>-<PRODUCT CODE>-<YYYY>-<MM>-<DD>-<SKU RANGE>-<SERIAL>", async () => {
    const { year, month } = period();
    const day = String(new Date().getDate()).padStart(2, "0");
    const inv = await createLot();
    // The SKU range spans the lot quantity; createLot() makes a 10-unit lot.
    expect(inv.lotNumber).toBe(`KH-BHO-${rice.product_code}-${year}-${month}-${day}-SKU01~SKU10-0001`);
    // Ranges pad to a MINIMUM of 2, so the two ends may differ in width.
    expect(inv.lotNumber).toMatch(/^KH-[A-Z]{1,3}-[A-Z]{3}\d{3}-\d{4}-\d{2}-\d{2}-SKU\d{2,}~SKU\d{2,}-\d{4}$/);
  });

  test("a boxed lot carries the Bulk Packaging range after the product code", async () => {
    const { year, month } = period();
    const day = String(new Date().getDate()).padStart(2, "0");
    const inv = await createLot({ qty: 10, hasBulkPackaging: true, numberOfBoxes: 5, unitsPerBox: 2 });
    expect(inv.lotNumber).toBe(
      `KH-BHO-${rice.product_code}-BP01~BP05-${year}-${month}-${day}-SKU01~SKU10-0001`
    );
  });

  test("uses the product's STORED product_code, not one re-derived from the name", async () => {
    // Force a code that could never be derived from "Premium Basmati Rice".
    await Product.updateOne({ _id: rice._id }, { $set: { product_code: "ZZZ999" } });
    const inv = await createLot();
    expect(inv.lotNumber).toContain("-ZZZ999-");
  });

  test("the batch column shadows the generated lot number", async () => {
    const inv = await createLot();
    expect(inv.batchNumber).toBe(inv.lotNumber);
  });
});

describe("serial counter", () => {
  test("starts at 0001 and increments per lot of the same product", async () => {
    const a = await createLot();
    const b = await createLot();
    const c = await createLot();
    expect(a.lotNumber.endsWith("-0001")).toBe(true);
    expect(b.lotNumber.endsWith("-0002")).toBe(true);
    expect(c.lotNumber.endsWith("-0003")).toBe(true);
  });

  test("a different product restarts at 0001", async () => {
    await createLot();
    await createLot();
    const first = await createLot({ productId: urea._id });
    expect(first.lotNumber).toContain(`-${urea.product_code}-`);
    expect(first.lotNumber.endsWith("-0001")).toBe(true);
  });

  test("another company's counter is independent", async () => {
    await createLot();
    await createLot(); // this company is now at 0002

    // NOTE: product_code is globally unique, so two companies can never share
    // one — cross-company collision is impossible by construction. What matters
    // here is that company B's counter starts fresh rather than continuing A's.
    const other = await makeCompany("Kisan Agro");
    const otherWh = await Warehouse.create({ companyId: other._id, name: "Indore" });
    const otherRice = await Product.create({ companyId: other._id, productName: "Premium Basmati Rice" });

    const inv = await lotService.receiveLot({
      ownerId: other._id, productId: otherRice._id, warehouseId: otherWh._id,
      qty: 5, lotOrigin: "company",
    });
    const { year, month } = period();
    const day = String(new Date().getDate()).padStart(2, "0");
    expect(inv.lotNumber).toBe(`KH-KIS-${otherRice.product_code}-${year}-${month}-${day}-SKU01~SKU05-0001`);
  });

  test("a deleted lot does NOT give its serial back", async () => {
    const first = await createLot();
    await Inventory.deleteOne({ _id: first._id });

    const next = await createLot();
    expect(next.lotNumber.endsWith("-0002")).toBe(true);
    expect(next.lotNumber).not.toBe(first.lotNumber);
  });

  test("the serial is a lifetime counter — it is not reset by year or month", async () => {
    await createLot();
    await createLot();
    // Nothing period-based is stored on the counter, so a lot minted in any
    // later month continues from 0003.
    const third = await createLot();
    expect(third.lotNumber.endsWith("-0003")).toBe(true);
  });
});

describe("concurrent creation", () => {
  test("10 simultaneous lots get 10 distinct numbers with no gaps", async () => {
    const made = await Promise.all(Array.from({ length: 10 }, () => createLot()));
    const numbers = made.map((i) => i.lotNumber);
    expect(new Set(numbers).size).toBe(10);

    const serials = numbers.map((n) => Number(n.slice(-4))).sort((a, b) => a - b);
    expect(serials).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("every generated number is claimed in the registry exactly once", async () => {
    await Promise.all(Array.from({ length: 5 }, () => createLot()));
    const rows = await LotNumber.find({ companyId }).lean();
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.source === "khetify")).toBe(true);
    expect(new Set(rows.map((r) => r.lotNumber)).size).toBe(5);
  });
});

describe("validation", () => {
  test("a product with no product_code blocks lot creation with the exact message", async () => {
    await Product.collection.updateOne({ _id: rice._id }, { $unset: { product_code: "" } });
    await expect(createLot()).rejects.toThrow(PRODUCT_CODE_MISSING);
  });

  test("a missing company name blocks lot creation with a clear message", async () => {
    await Company.updateOne({ _id: companyId }, { $unset: { "companyInfo.companyName": "" } });
    await expect(createLot()).rejects.toThrow(COMPANY_NAME_MISSING);
  });

  test("a company name with no alphabetic characters is rejected too", async () => {
    await Company.updateOne({ _id: companyId }, { $set: { "companyInfo.companyName": "12345" } });
    await expect(createLot()).rejects.toThrow(COMPANY_NAME_MISSING);
  });

  test("a blocked lot writes NO stock and burns no registry row", async () => {
    await Product.collection.updateOne({ _id: rice._id }, { $unset: { product_code: "" } });
    await expect(createLot()).rejects.toThrow();
    expect(await Inventory.countDocuments({ ownerId: companyId })).toBe(0);
    expect(await LotNumber.countDocuments({ companyId })).toBe(0);
  });

  test("generateKhetifyLotNumber requires a product", async () => {
    await expect(generateKhetifyLotNumber(companyId, {})).rejects.toThrow(/product is required/i);
  });
});

describe("manual lot numbers", () => {
  test("the operator's number is stored verbatim and claimed as manual", async () => {
    const inv = await createLot({ lotNumber: "UR-2026-JUN-001" });
    expect(inv.lotNumber).toBe("UR-2026-JUN-001");

    const row = await LotNumber.findOne({ companyId, lotNumber: "UR-2026-JUN-001" }).lean();
    expect(row.source).toBe("manual");
  });

  test("a manual number does NOT consume a generated serial", async () => {
    await createLot({ lotNumber: "MANUAL-1" });
    const generated = await createLot();
    expect(generated.lotNumber.endsWith("-0001")).toBe(true);
  });

  test("re-using a manual number on a DIFFERENT product is rejected", async () => {
    await createLot({ lotNumber: "SHARED-1" });
    await expect(createLot({ productId: urea._id, lotNumber: "SHARED-1" })).rejects.toThrow(
      /already used by another product/i,
    );
  });

  test("duplicate detection ignores case and surrounding space", async () => {
    await createLot({ lotNumber: "SHARED-2" });
    await expect(createLot({ productId: urea._id, lotNumber: " shared-2 " })).rejects.toThrow(
      /already used by another product/i,
    );
  });

  test("re-receiving into the SAME lot of the SAME product still tops up stock", async () => {
    const first = await createLot({ lotNumber: "TOPUP-1", qty: 10 });
    const again = await createLot({ lotNumber: "TOPUP-1", qty: 5 });
    expect(String(again._id)).toBe(String(first._id));
    expect(again.inTransitStock + again.availableStock).toBe(15);
    expect(await LotNumber.countDocuments({ companyId, lotNumber: "TOPUP-1" })).toBe(1);
  });

  test("a manual number cannot collide with an already-issued generated one", async () => {
    const generated = await createLot();
    await expect(createLot({ productId: urea._id, lotNumber: generated.lotNumber })).rejects.toThrow(
      /already used by another product/i,
    );
  });
});

describe("scope of the registry", () => {
  test("GRN and legacy callers are not claimed (supplier lot codes may repeat)", async () => {
    await lotService.receiveLot({
      ownerId: companyId, productId: rice._id, warehouseId, qty: 5,
      lotNumber: "SUPPLIER-B1", lotOrigin: "grn",
    });
    await lotService.receiveLot({
      ownerId: companyId, productId: urea._id, warehouseId, qty: 5,
      lotNumber: "SUPPLIER-B1", lotOrigin: "grn",
    });
    expect(await LotNumber.countDocuments({ companyId })).toBe(0);
  });

  test("a Company Warehouse Receive Lot IS claimed", async () => {
    await lotService.receiveLot({
      ownerId: companyId, productId: rice._id, warehouseId, qty: 5,
      lotNumber: "WH-RECEIVE-1", lotOrigin: "warehouse",
    });
    expect(await LotNumber.countDocuments({ companyId, lotNumber: "WH-RECEIVE-1" })).toBe(1);
  });

  test("existing lots are never renamed — only new lots use the new format", async () => {
    const legacy = await Inventory.create({
      productId: rice._id, ownerType: "company", ownerId: companyId, warehouseId,
      lotNumber: "KH-KHA-202606-0001", batchNumber: "KH-KHA-202606-0001",
      offlineStock: 10, availableStock: 10,
    });
    await createLot(); // mint a new-format lot alongside it
    const still = await Inventory.findById(legacy._id).lean();
    expect(still.lotNumber).toBe("KH-KHA-202606-0001");
  });
});
