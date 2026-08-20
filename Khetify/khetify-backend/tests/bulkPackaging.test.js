const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const StockMovement = require("../model/Inventory/StockMovement");
const lotService = require("../services/lotService");
const bulkPackageService = require("../services/bulkPackageService");
const {
  ALREADY_RECEIVED,
  SCAN_BOXES_SEPARATELY,
  PACKAGING_MISMATCH,
} = require("../services/bulkPackageService");

let companyId, warehouseId, otherWarehouseId, productId;

beforeEach(async () => {
  const company = await Company.create({
    fullName: "Owner",
    email: `bp-${new mongoose.Types.ObjectId()}@x.com`,
    password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = company._id;
  warehouseId = (await Warehouse.create({ companyId, name: "Khargone", code: "KHA" }))._id;
  otherWarehouseId = (await Warehouse.create({ companyId, name: "Indore", code: "IND" }))._id;
  productId = (await Product.create({ companyId, productName: "Premium Basmati Rice" }))._id;
  await BulkPackage.syncIndexes();
});

/** Create a lot the way the Company "Create Lot" screen does (booked to a warehouse). */
// Box IDs here are the FALLBACK "<LOT>-BP<serial>" format, which governs a lot
// whose number the system did not compose (a GRN's supplier code, a legacy row,
// or one created with an explicit number). A Khetify-GENERATED number is now
// composed from segments and its boxes descend from it — covered by
// tests/lotDetailsBoxUnits.test.js — so each lot here gets its own number.
let lotSeq = 0;

const createLot = (opts = {}) =>
  lotService.receiveLot({
    ownerId: companyId,
    productId,
    warehouseId,
    lotNumber: `LEGACY-LOT-${++lotSeq}`,
    qty: 2000,
    lotOrigin: "company",
    pendingReceipt: true,
    ...opts,
  });

const boxesOf = (lotId) => BulkPackage.find({ lot_id: lotId }).sort({ box_serial: 1 }).lean();

describe("validation: boxes × units per box must equal the quantity", () => {
  test("4 × 500 = 2000 is accepted", async () => {
    const inv = await createLot({ hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 500 });
    expect(inv.has_bulk_packaging).toBe(true);
    expect(inv.number_of_boxes).toBe(4);
    expect(inv.units_per_box).toBe(500);
  });

  test("3 × 500 ≠ 2000 is rejected with the exact message", async () => {
    await expect(
      createLot({ hasBulkPackaging: true, numberOfBoxes: 3, unitsPerBox: 500 })
    ).rejects.toThrow(PACKAGING_MISMATCH);
  });

  test("a rejected lot writes NOTHING — no inventory, no boxes", async () => {
    await expect(
      createLot({ hasBulkPackaging: true, numberOfBoxes: 3, unitsPerBox: 500 })
    ).rejects.toThrow();
    expect(await Inventory.countDocuments({ ownerId: companyId })).toBe(0);
    expect(await BulkPackage.countDocuments({ company_id: companyId })).toBe(0);
  });

  test("non-positive / fractional values are rejected", async () => {
    for (const bad of [
      { numberOfBoxes: 0, unitsPerBox: 500 },
      { numberOfBoxes: -4, unitsPerBox: -500 },
      { numberOfBoxes: 4.5, unitsPerBox: 500 },
      { numberOfBoxes: 4, unitsPerBox: 0 },
      { numberOfBoxes: "abc", unitsPerBox: 500 },
    ]) {
      await expect(createLot({ hasBulkPackaging: true, ...bad })).rejects.toThrow(
        /positive whole numbers|must be equal to the total lot quantity/,
      );
    }
  });

  test("the rule cannot be bypassed by editing the quantity — the backend re-checks", async () => {
    // Browser says 4 × 500, but the posted quantity was tampered to 1500.
    await expect(
      createLot({ qty: 1500, hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 500 })
    ).rejects.toThrow(PACKAGING_MISMATCH);
  });
});

describe("Bulk Packaging ID generation", () => {
  test("one unique ID per box, formatted <LOT>-BP-<SERIAL>", async () => {
    const inv = await createLot({ hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 500 });
    const boxes = await boxesOf(inv._id);

    expect(boxes).toHaveLength(4);
    expect(boxes.map((b) => b.bulk_packaging_id)).toEqual([
      `${inv.lotNumber}-BP-001`,
      `${inv.lotNumber}-BP-002`,
      `${inv.lotNumber}-BP-003`,
      `${inv.lotNumber}-BP-004`,
    ]);
  });

  test("every box carries the full reference set and starts at status created", async () => {
    const inv = await createLot({ hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 500 });
    const [box] = await boxesOf(inv._id);

    expect(String(box.company_id)).toBe(String(companyId));
    expect(String(box.product_id)).toBe(String(productId));
    expect(String(box.lot_id)).toBe(String(inv._id));
    expect(String(box.warehouse_id)).toBe(String(warehouseId));
    expect(box.lot_number).toBe(inv.lotNumber);
    expect(box.box_serial).toBe(1);
    expect(box.units_in_box).toBe(500);
    expect(box.status).toBe("created");
    expect(box.received_at).toBeNull();
    expect(box.created_at).toBeTruthy();
    expect(box.updated_at).toBeTruthy();
  });

  test("Bulk Packaging IDs are globally unique at the database level", async () => {
    const inv = await createLot({ hasBulkPackaging: true, numberOfBoxes: 2, unitsPerBox: 1000 });
    const [box] = await boxesOf(inv._id);
    await expect(
      BulkPackage.create({
        company_id: companyId, product_id: productId, lot_id: inv._id,
        lot_number: inv.lotNumber, bulk_packaging_id: box.bulk_packaging_id,
        box_serial: 99, units_in_box: 1,
      })
    ).rejects.toThrow(/duplicate key/i);
  });

  test("re-receiving into the same lot does NOT mint the boxes twice", async () => {
    const inv = await createLot({ hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 500 });
    await createLot({ lotNumber: inv.lotNumber, qty: 2000, hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 500 });
    expect(await BulkPackage.countDocuments({ lot_id: inv._id })).toBe(4);
  });
});

describe("checkbox unchecked — the single-package lot is untouched", () => {
  test("no boxes are generated and the flags stay off", async () => {
    const inv = await createLot();
    expect(inv.has_bulk_packaging).toBe(false);
    expect(inv.number_of_boxes).toBeNull();
    expect(await BulkPackage.countDocuments({ lot_id: inv._id })).toBe(0);
  });

  test("the parent lot scan + confirm still receives the whole quantity", async () => {
    const inv = await createLot();
    const found = await lotService.findPendingLot(companyId, { lotNumber: inv.lotNumber });
    expect(found.qty).toBe(2000);

    const done = await lotService.confirmLotReceipt(companyId, found.inventoryId, {});
    expect(done.availableStock).toBe(2000);
    expect(done.inTransitStock).toBe(0);
    expect(done.receiving_status).toBe("received");
  });
});

describe("checkbox checked — the warehouse receives box by box", () => {
  let inv, boxes;
  beforeEach(async () => {
    inv = await createLot({ hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 500 });
    boxes = await boxesOf(inv._id);
  });

  test("scanning the PARENT lot is blocked with the exact message", async () => {
    await expect(
      lotService.findPendingLot(companyId, { lotNumber: inv.lotNumber })
    ).rejects.toThrow(SCAN_BOXES_SEPARATELY);
  });

  test("confirming the whole lot is blocked too (not just the scan)", async () => {
    await expect(lotService.confirmLotReceipt(companyId, inv._id, {})).rejects.toThrow(
      SCAN_BOXES_SEPARATELY,
    );
  });

  test("each scan receives exactly one box's units, with a running pending total", async () => {
    const expected = [
      { received: 500, pending: 1500 },
      { received: 1000, pending: 1000 },
      { received: 1500, pending: 500 },
      { received: 2000, pending: 0 },
    ];

    for (let i = 0; i < boxes.length; i++) {
      const out = await bulkPackageService.receiveBox(companyId, boxes[i].bulk_packaging_id, {});
      expect(out.receivedUnits).toBe(500);

      const row = await Inventory.findById(inv._id);
      expect(row.availableStock).toBe(expected[i].received);
      expect(row.inTransitStock).toBe(expected[i].pending);
      expect(out.packaging.receivedUnits).toBe(expected[i].received);
      expect(out.packaging.pendingUnits).toBe(expected[i].pending);
    }
  });

  test("the lot is partially_received until the LAST box lands", async () => {
    for (const b of boxes.slice(0, 3)) {
      const out = await bulkPackageService.receiveBox(companyId, b.bulk_packaging_id, {});
      expect(out.receivingStatus).toBe("partially_received");
      expect((await Inventory.findById(inv._id)).receiving_status).toBe("partially_received");
    }
    const last = await bulkPackageService.receiveBox(companyId, boxes[3].bulk_packaging_id, {});
    expect(last.receivingStatus).toBe("received");
    expect((await Inventory.findById(inv._id)).receiving_status).toBe("received");
  });

  test("one ledger row per box — quantity is added exactly once", async () => {
    for (const b of boxes) await bulkPackageService.receiveBox(companyId, b.bulk_packaging_id, {});
    const moves = await StockMovement.find({ inventoryId: inv._id, type: "supply_in" });
    expect(moves).toHaveLength(4);
    expect(moves.reduce((s, m) => s + m.quantity, 0)).toBe(2000);
  });

  test("a second scan of the same box is refused with the exact message", async () => {
    await bulkPackageService.receiveBox(companyId, boxes[0].bulk_packaging_id, {});
    await expect(
      bulkPackageService.receiveBox(companyId, boxes[0].bulk_packaging_id, {})
    ).rejects.toThrow(ALREADY_RECEIVED);

    // and nothing moved on the failed attempt
    expect((await Inventory.findById(inv._id)).availableStock).toBe(500);
  });

  test("CONCURRENT scans of one box add its quantity only once", async () => {
    const id = boxes[0].bulk_packaging_id;
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => bulkPackageService.receiveBox(companyId, id, {}))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const row = await Inventory.findById(inv._id);
    expect(row.availableStock).toBe(500);
    expect(row.inTransitStock).toBe(1500);
    expect(await StockMovement.countDocuments({ inventoryId: inv._id, type: "supply_in" })).toBe(1);
  });

  test("all four boxes scanned at once still lands exactly 2000", async () => {
    await Promise.all(
      boxes.map((b) => bulkPackageService.receiveBox(companyId, b.bulk_packaging_id, {}))
    );
    const row = await Inventory.findById(inv._id);
    expect(row.availableStock).toBe(2000);
    expect(row.inTransitStock).toBe(0);
    expect(row.receiving_status).toBe("received");
  });

  test("a box can only be received at ITS destination warehouse", async () => {
    await expect(
      bulkPackageService.receiveBox(companyId, boxes[0].bulk_packaging_id, {
        allowedWarehouseIds: [otherWarehouseId],
      })
    ).rejects.toThrow(/not assigned to your warehouse/i);
    expect((await Inventory.findById(inv._id)).availableStock).toBe(0);
  });

  test("a cancelled box is never received", async () => {
    await BulkPackage.updateOne({ _id: boxes[0]._id }, { $set: { status: "cancelled" } });
    await expect(
      bulkPackageService.receiveBox(companyId, boxes[0].bulk_packaging_id, {})
    ).rejects.toThrow(/cancelled/i);
  });

  test("an unknown Bulk Packaging ID is a 404", async () => {
    await expect(bulkPackageService.receiveBox(companyId, "NOPE-BP-001", {})).rejects.toThrow(
      /not found/i,
    );
  });

  test("another company cannot receive this company's box", async () => {
    const stranger = new mongoose.Types.ObjectId();
    await expect(
      bulkPackageService.receiveBox(stranger, boxes[0].bulk_packaging_id, {})
    ).rejects.toThrow(/not found/i);
  });
});

describe("scan lookup (read-only)", () => {
  test("resolves a box and moves nothing", async () => {
    const inv = await createLot({ hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 500 });
    const [box] = await boxesOf(inv._id);

    const found = await bulkPackageService.findIncomingBox(companyId, ` ${box.bulk_packaging_id.toLowerCase()} `);
    expect(found.bulkPackagingId).toBe(box.bulk_packaging_id);
    expect(found.boxSerial).toBe(1);
    expect(found.unitsInBox).toBe(500);
    expect(found.productName).toBe("Premium Basmati Rice");
    expect(found.packaging.totalBoxes).toBe(4);

    expect((await Inventory.findById(inv._id)).availableStock).toBe(0);
  });

  test("an already-received box is reported as such on lookup", async () => {
    const inv = await createLot({ hasBulkPackaging: true, numberOfBoxes: 2, unitsPerBox: 1000 });
    const [box] = await boxesOf(inv._id);
    await bulkPackageService.receiveBox(companyId, box.bulk_packaging_id, {});
    await expect(
      bulkPackageService.findIncomingBox(companyId, box.bulk_packaging_id)
    ).rejects.toThrow(ALREADY_RECEIVED);
  });
});

describe("backward compatibility", () => {
  test("a pre-existing lot with no packaging fields behaves as single-package", async () => {
    // A row written before this feature existed: none of the new fields set.
    const legacy = await Inventory.collection.insertOne({
      productId, ownerType: "company", ownerId: companyId, warehouseId,
      lotNumber: "OLD-LOT-1", batchNumber: "OLD-LOT-1",
      inTransitStock: 300, offlineStock: 0, availableStock: 0, reservedStock: 0,
    });
    const id = legacy.insertedId;

    const found = await lotService.findPendingLot(companyId, { lotNumber: "OLD-LOT-1" });
    expect(found.qty).toBe(300);

    const done = await lotService.confirmLotReceipt(companyId, id, {});
    expect(done.availableStock).toBe(300);
    expect(done.lotNumber).toBe("OLD-LOT-1"); // never renamed
  });

  test("bulk packaging is opt-in — omitting the flags changes nothing", async () => {
    const inv = await createLot({ numberOfBoxes: 4, unitsPerBox: 500 }); // no hasBulkPackaging
    expect(inv.has_bulk_packaging).toBe(false);
    expect(await BulkPackage.countDocuments({ lot_id: inv._id })).toBe(0);
  });
});
