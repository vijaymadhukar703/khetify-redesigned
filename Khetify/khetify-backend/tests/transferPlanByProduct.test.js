/**
 * PLANNING A TRANSFER BY PRODUCT + QUANTITY.
 *
 * The New Shipment form no longer scans: it says WHAT product and HOW MUCH, and
 * the server splits that across the product's lots at the source warehouse,
 * earliest expiry first. The physical lot / box / unit identity is established
 * later, by scanning at DISPATCH.
 *
 * The rules that must hold:
 *   · planning writes one line per lot, FEFO
 *   · planning NEVER touches stock — no deduction, no reservation, no ledger row
 *   · lines that name an exact lot (Lots → Transfer, stock requests, supply)
 *     keep working untouched
 *   · a shipment saved by the old scanning form still opens in the Dispatch
 *     dialog
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const Shipment = require("../model/Transport/Shipment");
const StockMovement = require("../model/Inventory/StockMovement");
const shipmentService = require("../services/shipmentService");
const dispatchScanService = require("../services/dispatchScanService");

let companyId, srcWh, destWh, productId;

const day = (n) => new Date(Date.now() + n * 86400000);

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `pp-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
  });
  companyId = c._id;
  srcWh = await Warehouse.create({ companyId, name: "Source", code: "WH1" });
  destWh = await Warehouse.create({ companyId, name: "Dest", code: "WH2" });
  productId = (await Product.create({ companyId, productName: "Urea 50kg" }))._id;
});

/** A lot of `productId` on the source shelf, expiring in `expiresInDays`. */
const makeLot = ({ qty, expiresInDays, lotNumber, warehouseId }) =>
  Inventory.create({
    productId, ownerType: "company", ownerId: companyId,
    warehouseId: warehouseId || srcWh._id,
    lotNumber, batchNumber: lotNumber,
    offlineStock: qty, availableStock: qty,
    expiryDate: day(expiresInDays),
  });

const planByProduct = (qty) =>
  shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", toLabel: "Warehouse transfer",
    fromWarehouseId: srcWh._id, toWarehouseId: destWh._id,
    lines: [{ productId, qty }],
  });

describe("product + quantity is split across lots, earliest expiry first", () => {
  test("a quantity inside one lot takes only that lot", async () => {
    await makeLot({ qty: 40, expiresInDays: 30, lotNumber: "L-SOON" });
    await makeLot({ qty: 40, expiresInDays: 90, lotNumber: "L-LATER" });

    const ship = await planByProduct(25);
    expect(ship.lines).toHaveLength(1);
    expect(ship.lines[0].lotNumber).toBe("L-SOON");
    expect(ship.lines[0].qty).toBe(25);
    expect(String(ship.lines[0].productId)).toBe(String(productId));
  });

  test("a quantity spanning lots produces one line per lot, in expiry order", async () => {
    await makeLot({ qty: 30, expiresInDays: 30, lotNumber: "L-SOON" });
    await makeLot({ qty: 30, expiresInDays: 90, lotNumber: "L-LATER" });

    const ship = await planByProduct(45);
    expect(ship.lines.map((l) => [l.lotNumber, l.qty])).toEqual([["L-SOON", 30], ["L-LATER", 15]]);
  });

  test("only the SOURCE warehouse's stock is drawn on", async () => {
    const elsewhere = await Warehouse.create({ companyId, name: "Elsewhere", code: "WH3" });
    await makeLot({ qty: 50, expiresInDays: 10, lotNumber: "L-OTHER-WH", warehouseId: elsewhere._id });
    await makeLot({ qty: 50, expiresInDays: 90, lotNumber: "L-HERE" });

    const ship = await planByProduct(20);
    expect(ship.lines).toHaveLength(1);
    expect(ship.lines[0].lotNumber).toBe("L-HERE"); // not the earlier-expiring one elsewhere
  });

  test("more than the warehouse holds is refused, and nothing is created", async () => {
    await makeLot({ qty: 10, expiresInDays: 30, lotNumber: "L-ONLY" });
    await expect(planByProduct(11)).rejects.toThrow(/INSUFFICIENT_STOCK/);
    expect(await Shipment.countDocuments({ companyId })).toBe(0);
  });
});

describe("planning moves no stock", () => {
  test("available stock is untouched and no ledger row is written", async () => {
    const lot = await makeLot({ qty: 40, expiresInDays: 30, lotNumber: "L-1" });

    await planByProduct(25);

    const after = await Inventory.findById(lot._id);
    expect(after.availableStock).toBe(40); // deduction happens at DISPATCH
    expect(after.offlineStock).toBe(40);
    expect(after.reservedStock ?? 0).toBe(0); // nor is anything reserved
    expect(await StockMovement.countDocuments({ inventoryId: lot._id })).toBe(0);
  });
});

describe("the other callers are unchanged", () => {
  test("a line naming an exact lot still ships that lot", async () => {
    const soon = await makeLot({ qty: 40, expiresInDays: 30, lotNumber: "L-SOON" });
    const later = await makeLot({ qty: 40, expiresInDays: 90, lotNumber: "L-LATER" });

    // Lots → Transfer sends the lot the operator opened, NOT the FEFO pick.
    const ship = await shipmentService.createShipment(companyId, {
      refType: "Transfer", toType: "warehouse", toLabel: "Dest",
      fromWarehouseId: srcWh._id, toWarehouseId: destWh._id,
      lines: [{ inventoryId: later._id, qty: 5 }],
    });
    expect(ship.lines).toHaveLength(1);
    expect(String(ship.lines[0].inventoryId)).toBe(String(later._id));
    expect(ship.lines[0].qty).toBe(5);
    expect(String(soon._id)).not.toBe(String(ship.lines[0].inventoryId));
  });
});

describe("shipments saved by the old scanning form", () => {
  test("a planned shipment holding lines[].scans still opens the dispatch checklist", async () => {
    const lot = await makeLot({ qty: 20, expiresInDays: 30, lotNumber: "L-OLD" });
    const ship = await planByProduct(8);

    // Exactly what the retired form wrote, injected past the schema.
    await Shipment.collection.updateOne(
      { _id: ship._id },
      {
        $set: {
          "lines.0.scans": [{
            code: "BP01", scanType: "main_box", lotNumber: "L-OLD",
            bulkPackagingId: "BP01", parentBulkPackagingId: null,
            unitCodes: ["U1", "U2"], qty: 2,
          }],
        },
      }
    );

    const checklist = await dispatchScanService.dispatchChecklist(companyId, ship._id);
    expect(checklist.items).toHaveLength(1);
    expect(checklist.items[0].requiredQty).toBe(8);
    expect(String(checklist.fromWarehouseId)).toBe(String(srcWh._id));

    // And the stale field survives a re-read rather than being stripped.
    const reread = await Shipment.findById(ship._id).lean();
    expect(reread.lines[0].scans[0].bulkPackagingId).toBe("BP01");
    expect(String(reread.lines[0].inventoryId)).toBe(String(lot._id));
  });
});
