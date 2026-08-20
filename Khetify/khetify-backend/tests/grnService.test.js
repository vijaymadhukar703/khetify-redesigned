const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const GRN = require("../model/Inventory/GRN");
const PutawayTask = require("../model/Inventory/PutawayTask");
const InventoryBin = require("../model/Inventory/InventoryBin");
const grnService = require("../services/grnService");
const putawayService = require("../services/putawayService");
const locationService = require("../services/locationService");

let companyId, warehouseId, productId, productCode;

beforeEach(async () => {
  const company = await Company.create({
    fullName: "Test Co",
    email: `t-${new mongoose.Types.ObjectId()}@x.com`,
    password: "x",
    companyInfo: { companyName: "Test Agri" },
  });
  companyId = company._id;
  const wh = await Warehouse.create({ companyId, name: "Main", code: "WH1" });
  warehouseId = wh._id;
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "FERT-UREA-01", category: "Fertilizers" });
  productId = p._id;
  productCode = p.product_code;
});

async function makeReceivedGRN(lines) {
  const grn = await grnService.createGRN(companyId, { refType: "Manual", warehouseId, lines: lines.map((l) => ({ productId, expectedQty: l.expectedQty })) });
  await grnService.receiveGRN(companyId, grn._id, {
    lines: lines.map((l) => ({
      productId,
      receivedQty: l.receivedQty,
      rejectedQty: l.rejectedQty || 0,
      rejectReason: l.rejectReason,
      batchNumber: l.batchNumber,
      expiryDate: l.expiryDate,
    })),
  });
  return grn;
}

describe("postGRN() stock math", () => {
  test("accepted qty becomes sellable stock with a supply_in ledger row", async () => {
    const grn = await makeReceivedGRN([{ expectedQty: 100, receivedQty: 100, batchNumber: "B1" }]);
    const { putawayTasks } = await grnService.postGRN(companyId, grn._id, {});

    const inv = await Inventory.findOne({ ownerId: companyId, productId, batchNumber: "B1" });
    expect(inv.availableStock).toBe(100);
    expect(inv.offlineStock).toBe(100);
    expect(inv.damagedStock).toBe(0);

    const ledger = await StockMovement.find({ inventoryId: inv._id, type: "supply_in" });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].refType).toBe("GRN");

    expect(putawayTasks).toBe(1); // one accepted line → one putaway task
    const posted = await GRN.findById(grn._id);
    expect(posted.status).toBe("putaway_pending");
  });

  test("rejected qty goes to damagedStock (not sellable) with a damage ledger row", async () => {
    const grn = await makeReceivedGRN([
      { expectedQty: 100, receivedQty: 100, rejectedQty: 30, rejectReason: "torn bags", batchNumber: "B2" },
    ]);
    await grnService.postGRN(companyId, grn._id, {});

    const inv = await Inventory.findOne({ ownerId: companyId, productId, batchNumber: "B2" });
    expect(inv.availableStock).toBe(70); // 100 received − 30 rejected accepted
    expect(inv.damagedStock).toBe(30);

    const damage = await StockMovement.find({ inventoryId: inv._id, type: "damage" });
    expect(damage).toHaveLength(1);
    expect(damage[0].quantity).toBe(30);
  });

  test("auto-generates a Khetify lot code when the line has no batch number", async () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const grn = await grnService.createGRN(companyId, { warehouseId, lines: [{ productId, expectedQty: 10 }] });
    await grnService.receiveGRN(companyId, grn._id, { lines: [{ productId, receivedQty: 10 }] });
    await grnService.postGRN(companyId, grn._id, {});

    const inv = await Inventory.findOne({ ownerId: companyId, productId });
    // The generated date now carries the day. A GRN asks for a code without
    // stating a box count or a quantity, so neither range appears.
    expect(inv.batchNumber).toBe(`KH-TES-${productCode}-${year}-${month}-${day}-0001`);
    expect(inv.lotNumber).toBe(inv.batchNumber);
  });

  test("falls back to the legacy lot code when the Khetify number can't be built", async () => {
    // A GRN posting must never fail just because the company name (or the
    // product's product_code) is missing — it degrades to LOT-<sku>-<yymmdd>-<seq>.
    await Company.updateOne({ _id: companyId }, { $unset: { "companyInfo.companyName": "" } });
    const grn = await grnService.createGRN(companyId, { warehouseId, lines: [{ productId, expectedQty: 10 }] });
    await grnService.receiveGRN(companyId, grn._id, { lines: [{ productId, receivedQty: 10 }] });
    await grnService.postGRN(companyId, grn._id, {});

    const inv = await Inventory.findOne({ ownerId: companyId, productId });
    expect(inv.batchNumber).toMatch(/^LOT-FERT-UREA-01-\d{6}-\d{3}$/);
  });

  test("a received line's manufacturing date survives onto the posted lot", async () => {
    const mfg = new Date("2026-05-15");
    const grn = await grnService.createGRN(companyId, { warehouseId, lines: [{ productId, expectedQty: 10 }] });
    await grnService.receiveGRN(companyId, grn._id, { lines: [{ productId, receivedQty: 10, batchNumber: "MFG-B1", mfgDate: mfg }] });
    await grnService.postGRN(companyId, grn._id, {});

    const inv = await Inventory.findOne({ ownerId: companyId, productId, batchNumber: "MFG-B1" });
    expect(inv.mfgDate).toBeTruthy();
    expect(new Date(inv.mfgDate).toISOString()).toBe(mfg.toISOString());
  });

  test("refuses to post a GRN that is still a draft", async () => {
    const grn = await grnService.createGRN(companyId, { warehouseId, lines: [{ productId, expectedQty: 10 }] });
    await expect(grnService.postGRN(companyId, grn._id, {})).rejects.toMatchObject({ status: 409 });
  });

  test("grnNumber is gapless per month", async () => {
    const a = await grnService.createGRN(companyId, { warehouseId, lines: [] });
    const b = await grnService.createGRN(companyId, { warehouseId, lines: [] });
    const [, , seqA] = a.grnNumber.split("-");
    const [, , seqB] = b.grnNumber.split("-");
    expect(Number(seqB)).toBe(Number(seqA) + 1);
  });
});

describe("createGRN() does NOT cap expectedQty against availableStock", () => {
  // A GRN receives (adds) stock, so its expected quantity is intentionally not
  // limited by the product's current availableStock. Only the warehouse
  // capacity guard (tested separately below) constrains a GRN.
  test("allows a line whose expectedQty exceeds the product's availableStock", async () => {
    const capped = await Product.create({ companyId, productName: "Basmati", skuNumber: "PBR-01", category: "Seeds", availableStock: 500 });
    const grn = await grnService.createGRN(companyId, { warehouseId, lines: [{ productId: capped._id, expectedQty: 1000 }] });
    expect(grn.grnNumber).toBeTruthy();
  });

  test("allows a second GRN even after earlier GRNs committed the full stock", async () => {
    const capped = await Product.create({ companyId, productName: "Basmati", skuNumber: "PBR-03", category: "Seeds", availableStock: 5000 });
    await grnService.createGRN(companyId, { warehouseId, lines: [{ productId: capped._id, expectedQty: 5000 }] });
    // second GRN is no longer blocked by a "remaining stock" cap
    const second = await grnService.createGRN(companyId, { warehouseId, lines: [{ productId: capped._id, expectedQty: 5000 }] });
    expect(second.grnNumber).toBeTruthy();
    expect(await GRN.countDocuments({ companyId })).toBe(2);
  });

  test("allows any qty for products that don't track stock (availableStock unset)", async () => {
    const grn = await grnService.createGRN(companyId, { warehouseId, lines: [{ productId, expectedQty: 99999 }] });
    expect(grn.grnNumber).toBeTruthy();
  });
});

describe("postGRN() enforces the warehouse capacity cap", () => {
  async function makeReceivedGRNIn(whId, lines) {
    const grn = await grnService.createGRN(companyId, { refType: "Manual", warehouseId: whId, lines: lines.map((l) => ({ productId, expectedQty: l.expectedQty })) });
    await grnService.receiveGRN(companyId, grn._id, {
      lines: lines.map((l) => ({ productId, receivedQty: l.receivedQty, batchNumber: l.batchNumber })),
    });
    return grn;
  }

  test("refuses to CREATE a GRN whose expected qty would overflow the warehouse", async () => {
    const small = await Warehouse.create({ companyId, name: "Tiny", code: "TW0", capacityUnits: 100 });
    // fill it to capacity first (via a posted GRN)
    const g1 = await makeReceivedGRNIn(small._id, [{ expectedQty: 100, receivedQty: 100, batchNumber: "F1" }]);
    await grnService.postGRN(companyId, g1._id, {});
    // now a new GRN for even 1 unit must be refused at creation
    await expect(
      grnService.createGRN(companyId, { warehouseId: small._id, lines: [{ productId, expectedQty: 1 }] }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test("post-time backstop: two GRNs that individually fit cannot BOTH post past capacity", async () => {
    // Each GRN of 60 fits an empty 100-cap warehouse at CREATE time (create only
    // sees committed occupancy, not other unposted GRNs). The second POST is the
    // authoritative block once the first has landed 60/100.
    const small = await Warehouse.create({ companyId, name: "Tiny", code: "TW1", capacityUnits: 100 });
    const a = await makeReceivedGRNIn(small._id, [{ expectedQty: 60, receivedQty: 60, batchNumber: "C1a" }]);
    const b = await makeReceivedGRNIn(small._id, [{ expectedQty: 60, receivedQty: 60, batchNumber: "C1b" }]);
    await grnService.postGRN(companyId, a._id, {}); // 60/100
    await expect(grnService.postGRN(companyId, b._id, {})).rejects.toMatchObject({ status: 409 });
    // only the first GRN's stock landed
    expect(await Inventory.countDocuments({ ownerId: companyId, warehouseId: small._id })).toBe(1);
  });

  test("counts existing occupancy: a second GRN cannot be created once the warehouse is full", async () => {
    const small = await Warehouse.create({ companyId, name: "Tiny", code: "TW2", capacityUnits: 100 });
    const first = await makeReceivedGRNIn(small._id, [{ expectedQty: 80, receivedQty: 80, batchNumber: "C2" }]);
    await grnService.postGRN(companyId, first._id, {}); // 80/100 used
    // a second GRN for 40 (80 + 40 > 100) is refused at creation
    await expect(
      grnService.createGRN(companyId, { warehouseId: small._id, lines: [{ productId, expectedQty: 40 }] }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test("allows posting up to exactly the capacity", async () => {
    const small = await Warehouse.create({ companyId, name: "Tiny", code: "TW3", capacityUnits: 100 });
    const grn = await makeReceivedGRNIn(small._id, [{ expectedQty: 100, receivedQty: 100, batchNumber: "C4" }]);
    await grnService.postGRN(companyId, grn._id, {});
    const inv = await Inventory.findOne({ ownerId: companyId, warehouseId: small._id, batchNumber: "C4" });
    expect(inv.availableStock).toBe(100);
  });

  test("uncapped warehouse (no capacityUnits) accepts any quantity", async () => {
    // warehouseId from beforeEach has no capacityUnits
    const grn = await makeReceivedGRNIn(warehouseId, [{ expectedQty: 99999, receivedQty: 99999, batchNumber: "C5" }]);
    await grnService.postGRN(companyId, grn._id, {});
    const inv = await Inventory.findOne({ ownerId: companyId, warehouseId, batchNumber: "C5" });
    expect(inv.availableStock).toBe(99999);
  });
});

describe("putaway completes into a bin (bin-sum invariant)", () => {
  test("completing a putaway task moves stock from pool into the chosen bin", async () => {
    const grn = await makeReceivedGRN([{ expectedQty: 50, receivedQty: 50, batchNumber: "B3" }]);
    await grnService.postGRN(companyId, grn._id, {});

    const bin = await locationService.createLocation(companyId, { warehouseId, type: "bin", code: "A1" });
    const [task] = await putawayService.listTasks(companyId, {});
    expect(task).toBeTruthy();

    const inv = await Inventory.findOne({ ownerId: companyId, productId, batchNumber: "B3" });
    expect(await locationService.binnedQty(inv._id)).toBe(0); // nothing binned yet

    await putawayService.completeTask(companyId, task._id, { locationId: bin._id });

    expect(await locationService.binnedQty(inv._id)).toBe(50); // now fully binned
    const binRow = await InventoryBin.findOne({ inventoryId: inv._id, locationId: bin._id });
    expect(binRow.qty).toBe(50);

    const done = await PutawayTask.findById(task._id);
    expect(done.status).toBe("completed");
    const closedGrn = await GRN.findById(grn._id);
    expect(closedGrn.status).toBe("completed"); // no open tasks left
  });
});
