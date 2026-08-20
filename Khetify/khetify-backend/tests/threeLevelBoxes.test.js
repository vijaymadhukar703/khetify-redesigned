/**
 * Three-level packaging: MAIN bulk packaging boxes own inner boxes.
 *
 * The bug: Create Lot sent numberOfBoxes = main × per-main, so a 2 × 5 lot
 * created 10 flat rows with no parent and NO main box records at all — which is
 * why main box labels could not exist.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const lotService = require("../services/lotService");
const bulkPackageService = require("../services/bulkPackageService");
const lotCtrl = require("../controller/Inventory/lotController");
const { migrate, NEW_KEY } = require("../scripts/migrations/006-box-level-parent");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

/** GET /api/lots/:id/bulk-packages — exactly what the Labels page reads. */
async function labelsPayload(lotId) {
  const res = mockRes();
  await lotCtrl.listBulkPackages({ params: { id: String(lotId) }, user: { companyId } }, res);
  return res.body;
}

/**
 * The Barcodes & Labels page's own grouping rule, replicated: top-level cards
 * are the main boxes, and every other box is nested under its parent_box_id.
 */
function topLevelCards(payload) {
  return payload.mainBoxes.map((m) => ({
    id: m.bulk_packaging_id,
    serial: m.main_serial,
    inners: payload.data.filter((b) => String(b.parent_box_id) === String(m._id)),
  }));
}

let companyId, productId, bhopal;

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `tl-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  bhopal = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  productId = (await Product.create({ companyId, productName: "Urea" }))._id;
  await BulkPackage.syncIndexes();
});

/** The reported lot: 2 main × 5 inner × 10 units = 100. */
const threeLevelLot = () => lotService.receiveLot({
  ownerId: companyId, productId, warehouseId: bhopal._id, qty: 100,
  lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
  hasBulkPackaging: true, numberOfBoxes: 10, unitsPerBox: 10,
  mainBoxes: 2, boxesPerMain: 5,
});

/** MAIN BOXES 2, BOXES PER MAIN 5, UNITS PER BOX 2, quantity 20. */
const smallThreeLevelLot = () => lotService.receiveLot({
  ownerId: companyId, productId, warehouseId: bhopal._id, qty: 20,
  lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
  hasBulkPackaging: true, numberOfBoxes: 10, unitsPerBox: 2,
  mainBoxes: 2, boxesPerMain: 5,
});

/** A two-level lot: 4 boxes × 5 units, no "Inside bulk packaging". */
const twoLevelLot = () => lotService.receiveLot({
  ownerId: companyId, productId, warehouseId: bhopal._id, qty: 20,
  lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
  hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 5,
});

/**
 * The unique index. `{ lot_id, box_serial }` was correct for one flat level and is
 * wrong now: serial 1 occurs twice in a lot, once as main box 1 and once as an
 * inner box, and the old index rejected the second insert —
 *
 *   E11000 ... index: lot_id_1_box_serial_1 dup key: { lot_id: ..., box_serial: 1 }
 *
 * so lot creation failed outright on any database still carrying it.
 */
describe("the unique index accounts for the level and the parent", () => {
  const keyOf = async (name) =>
    (await BulkPackage.collection.indexes()).find((i) => i.name === name)?.key;

  test("the collection carries { lot_id, box_level, parent_box_id, box_serial } and NOT the old key", async () => {
    const indexes = await BulkPackage.collection.indexes();
    const serialIndexes = indexes.filter((i) => "box_serial" in i.key);

    expect(serialIndexes).toHaveLength(1);
    expect(serialIndexes[0].unique).toBe(true);
    expect(Object.keys(serialIndexes[0].key)).toEqual([
      "lot_id", "box_level", "parent_box_id", "box_serial",
    ]);
    expect(await keyOf("lot_id_1_box_serial_1")).toBeUndefined();
  });

  test("main box 1 and inner box 1 of the same lot both insert", async () => {
    const lotId = new mongoose.Types.ObjectId();
    const row = (extra) => ({
      company_id: companyId, product_id: productId, lot_id: lotId,
      lot_number: "IX-1", units_in_box: 1, status: "created", ...extra,
    });

    const main = await BulkPackage.create(row({
      bulk_packaging_id: "IX-1-MAIN-01", box_level: "main", parent_box_id: null, box_serial: 1,
    }));
    await expect(BulkPackage.create(row({
      bulk_packaging_id: "IX-1-INNER-01", box_level: "inner", parent_box_id: main._id, box_serial: 1,
    }))).resolves.toBeTruthy();
  });

  test("inner box 1 may repeat under a DIFFERENT main box, but not under the same one", async () => {
    const lotId = new mongoose.Types.ObjectId();
    const row = (extra) => ({
      company_id: companyId, product_id: productId, lot_id: lotId,
      lot_number: "IX-2", units_in_box: 1, status: "created", ...extra,
    });
    const m1 = await BulkPackage.create(row({ bulk_packaging_id: "IX-2-M1", box_level: "main", parent_box_id: null, box_serial: 1 }));
    const m2 = await BulkPackage.create(row({ bulk_packaging_id: "IX-2-M2", box_level: "main", parent_box_id: null, box_serial: 2 }));

    await BulkPackage.create(row({ bulk_packaging_id: "IX-2-M1-I1", box_level: "inner", parent_box_id: m1._id, box_serial: 1 }));
    // Inner numbering restarts inside each main box, so this is legitimate.
    await expect(BulkPackage.create(row({
      bulk_packaging_id: "IX-2-M2-I1", box_level: "inner", parent_box_id: m2._id, box_serial: 1,
    }))).resolves.toBeTruthy();

    // Twice in the SAME main box is still a duplicate.
    await expect(BulkPackage.create(row({
      bulk_packaging_id: "IX-2-M1-I1-DUP", box_level: "inner", parent_box_id: m1._id, box_serial: 1,
    }))).rejects.toThrow(/E11000|duplicate key/i);
  });

  test("two main boxes still cannot share a serial", async () => {
    const lotId = new mongoose.Types.ObjectId();
    const row = (id) => ({
      company_id: companyId, product_id: productId, lot_id: lotId, lot_number: "IX-3",
      units_in_box: 1, status: "created", bulk_packaging_id: id,
      box_level: "main", parent_box_id: null, box_serial: 1,
    });
    await BulkPackage.create(row("IX-3-M1"));
    await expect(BulkPackage.create(row("IX-3-M1-DUP"))).rejects.toThrow(/E11000|duplicate key/i);
  });
});

describe("migration 006 — the index swap", () => {
  const names = async () => (await BulkPackage.collection.indexes()).map((i) => i.name);

  /** Put the collection back into the state a production database is in. */
  async function installOldIndex() {
    for (const n of await names()) {
      if (n !== "_id_" && n !== "bulk_packaging_id_1") await BulkPackage.collection.dropIndex(n);
    }
    await BulkPackage.collection.createIndex({ lot_id: 1, box_serial: 1 }, { unique: true });
  }

  afterEach(async () => { await BulkPackage.syncIndexes(); });

  test("drops lot_id_1_box_serial_1 and creates the new key", async () => {
    await installOldIndex();
    expect(await names()).toContain("lot_id_1_box_serial_1");

    await migrate();

    expect(await names()).not.toContain("lot_id_1_box_serial_1");
    const swapped = (await BulkPackage.collection.indexes())
      .find((i) => JSON.stringify(i.key) === JSON.stringify(NEW_KEY));
    expect(swapped).toBeDefined();
    expect(swapped.unique).toBe(true);
  });

  test("stamps existing rows as 'main' with no parent, and leaves their IDs alone", async () => {
    await installOldIndex();
    // A row as it exists today: no box_level, no parent_box_id at all.
    await BulkPackage.collection.insertOne({
      company_id: companyId, product_id: productId, lot_id: new mongoose.Types.ObjectId(),
      lot_number: "OLD-1", bulk_packaging_id: "OLD-1-BP001", box_serial: 1,
      units_in_box: 5, status: "created",
    });

    await migrate();

    const row = await BulkPackage.collection.findOne({ bulk_packaging_id: "OLD-1-BP001" });
    expect(row.box_level).toBe("main");
    expect(row.parent_box_id).toBeNull();
    expect(row.bulk_packaging_id).toBe("OLD-1-BP001"); // never rewritten
    expect(row.box_serial).toBe(1);                    // never renumbered
  });

  test("runs clean when the old index does not exist, and is idempotent", async () => {
    await BulkPackage.syncIndexes();               // already on the new key
    await expect(migrate()).resolves.not.toThrow();
    await expect(migrate()).resolves.not.toThrow(); // second run is a no-op

    const serialIndexes = (await BulkPackage.collection.indexes()).filter((i) => "box_serial" in i.key);
    expect(serialIndexes).toHaveLength(1);
    expect(JSON.stringify(serialIndexes[0].key)).toBe(JSON.stringify(NEW_KEY));
  });

  test("--dry-run changes nothing", async () => {
    await installOldIndex();
    await migrate({ dryRun: true });
    expect(await names()).toContain("lot_id_1_box_serial_1");
  });

  test("a lot created after the migration saves without an E11000", async () => {
    await installOldIndex();
    await migrate();
    await expect(smallThreeLevelLot()).resolves.toBeTruthy();
  });
});

describe("CHANGE 2 — both levels are created", () => {
  test("2 main × 5 inner produces 12 records: 2 main + 10 inner", async () => {
    const inv = await threeLevelLot();
    const rows = await BulkPackage.find({ lot_id: inv._id });

    expect(rows).toHaveLength(12);
    expect(rows.filter((b) => b.box_level === "main")).toHaveLength(2);
    expect(rows.filter((b) => b.box_level === "inner")).toHaveLength(10);
  });

  test("main boxes have no parent; every inner box points at its own main box", async () => {
    const inv = await threeLevelLot();
    const mains = await BulkPackage.find({ lot_id: inv._id, box_level: "main" }).sort({ box_serial: 1 });
    const inners = await BulkPackage.find({ lot_id: inv._id, box_level: "inner" }).sort({ box_serial: 1 });

    expect(mains.every((m) => m.parent_box_id === null)).toBe(true);
    // Inner 1-5 belong to main 1, inner 6-10 to main 2.
    for (const b of inners) {
      const expected = b.box_serial <= 5 ? mains[0]._id : mains[1]._id;
      expect(String(b.parent_box_id)).toBe(String(expected));
    }
    expect(inners.filter((b) => String(b.parent_box_id) === String(mains[0]._id))).toHaveLength(5);
    expect(inners.filter((b) => String(b.parent_box_id) === String(mains[1]._id))).toHaveLength(5);
  });

  test("units attach to their INNER box, as before", async () => {
    const inv = await threeLevelLot();
    const inners = await BulkPackage.find({ lot_id: inv._id, box_level: "inner" });
    const innerIds = new Set(inners.map((b) => String(b._id)));

    const units = await UnitSerial.find({ inventoryId: inv._id });
    expect(units).toHaveLength(100);
    expect(units.every((u) => innerIds.has(String(u.bulk_packaging_record_id)))).toBe(true);
    // 10 units in each inner box.
    for (const b of inners) {
      expect(await UnitSerial.countDocuments({ bulk_packaging_record_id: b._id })).toBe(10);
    }
  });

  test("a TWO-level lot still creates one flat list of 'main' rows, no children", async () => {
    const inv = await twoLevelLot();
    const rows = await BulkPackage.find({ lot_id: inv._id });

    expect(rows).toHaveLength(4);
    expect(rows.every((b) => b.box_level === "main")).toBe(true);
    expect(rows.every((b) => b.parent_box_id === null)).toBe(true);
  });
});

describe("CHANGE 3 — main box IDs", () => {
  test("own main box value plus the inner range it holds, and no SKU segment", async () => {
    const inv = await threeLevelLot();
    const mains = await BulkPackage.find({ lot_id: inv._id, box_level: "main" }).sort({ box_serial: 1 });

    for (const m of mains) {
      expect(m.bulk_packaging_id).toMatch(/-BP0\d-BPINNER01~BPINNER05-/);
      expect(m.bulk_packaging_id).not.toContain("SKU");
    }
    expect(mains[0].bulk_packaging_id).toContain("-BP01-");
    expect(mains[1].bulk_packaging_id).toContain("-BP02-");
  });
});

describe("existing readers are unaffected", () => {
  test("listByLot returns the 10 unit-holding boxes, not 12", async () => {
    // Receive, dispatch, pick and the packaging roll-up all read this. Counting
    // the outer cartons too would double every figure.
    const inv = await threeLevelLot();
    const boxes = await bulkPackageService.listByLot(companyId, inv._id);

    expect(boxes).toHaveLength(10);
    expect(boxes.every((b) => b.box_level === "inner")).toBe(true);
  });

  test("listMainBoxes returns the 2 outer cartons", async () => {
    const inv = await threeLevelLot();
    const mains = await bulkPackageService.listMainBoxes(companyId, inv._id);
    expect(mains.map((m) => m.box_serial)).toEqual([1, 2]);
  });

  test("listByLot on a two-level lot returns its boxes, and listMainBoxes none", async () => {
    const inv = await twoLevelLot();
    expect(await bulkPackageService.listByLot(companyId, inv._id)).toHaveLength(4);
    expect(await bulkPackageService.listMainBoxes(companyId, inv._id)).toHaveLength(0);
  });

  test("the packaging roll-up still counts only unit-holding boxes", async () => {
    const inv = await threeLevelLot();
    const summary = await bulkPackageService.summaryForLot(companyId, inv._id);
    // 12 rows exist, but the lot is packed into 10 boxes of 10.
    expect(summary.totalBoxes).toBe(10);
  });
});

describe("receiving a three-level lot", () => {
  /**
   * The LOT's status is still counted over the inner boxes — the outer cartons
   * are not separate arrivals, and counting both levels would leave the lot
   * stuck on "partially_received" after the last inner box landed.
   *
   * The cartons themselves are no longer left behind, though: a carton whose
   * every inner box has been received IS here, and saying "created" made it
   * read as still awaiting a receipt that had already happened. receiveBox
   * closes it upwards on the last inner box (and downwards when the carton
   * itself is the thing scanned).
   */
  test("the lot reaches 'received' once all 10 INNER boxes are in", async () => {
    const inv = await smallThreeLevelLot();
    const inners = await BulkPackage.find({ lot_id: inv._id, box_level: "inner" }).sort({ box_serial: 1 });

    for (const [i, box] of inners.entries()) {
      await bulkPackageService.receiveBox(companyId, box.bulk_packaging_id, {});
      const row = await Inventory.findById(inv._id).select("receiving_status");
      expect(row.receiving_status).toBe(i === inners.length - 1 ? "received" : "partially_received");
    }

    // Every carton is closed too, now that everything inside it has landed.
    const mains = await BulkPackage.find({ lot_id: inv._id, box_level: "main" });
    expect(mains.every((m) => m.status === "received")).toBe(true);
    expect(mains.every((m) => !!m.received_at)).toBe(true);
  });

  test("a TWO-level lot still becomes 'received' on its last box", async () => {
    const inv = await twoLevelLot();
    const boxes = await BulkPackage.find({ lot_id: inv._id }).sort({ box_serial: 1 });

    for (const [i, box] of boxes.entries()) {
      await bulkPackageService.receiveBox(companyId, box.bulk_packaging_id, {});
      const row = await Inventory.findById(inv._id).select("receiving_status");
      expect(row.receiving_status).toBe(i === boxes.length - 1 ? "received" : "partially_received");
    }
  });
});

describe("CHANGE 4 — what the Barcodes & Labels page reads", () => {
  test("MAIN BOXES 2 × BOXES PER MAIN 5 × UNITS PER BOX 10 → 2 top-level cards, not 10", async () => {
    const inv = await threeLevelLot();
    const payload = await labelsPayload(inv._id);
    const cards = topLevelCards(payload);

    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.serial)).toEqual([1, 2]);
    // Every inner box is nested, so none can be drawn at the top level.
    expect(payload.data.every((b) => b.parent_box_id)).toBe(true);
    for (const c of cards) expect(c.inners).toHaveLength(5);
  });

  test("inner boxes are numbered 1-5 inside EACH main box, not 1-10 across the lot", async () => {
    const inv = await threeLevelLot();
    const cards = topLevelCards(await labelsPayload(inv._id));

    for (const c of cards) {
      expect(c.inners.map((b) => b.inner_index)).toEqual([1, 2, 3, 4, 5]);
      // The stored serial stays lot-wide — the per-parent position is derived.
      expect(c.inners.map((b) => b.box_serial)).toEqual(
        c.serial === 1 ? [1, 2, 3, 4, 5] : [6, 7, 8, 9, 10]
      );
    }
  });

  test("each of the 10 inner boxes owns 10 unit labels", async () => {
    const inv = await threeLevelLot();
    const cards = topLevelCards(await labelsPayload(inv._id));

    for (const c of cards) {
      for (const inner of c.inners) {
        expect(await UnitSerial.countDocuments({ bulk_packaging_record_id: inner._id })).toBe(10);
      }
    }
  });

  test("every level has its own barcode value, and the three are distinct", async () => {
    const inv = await threeLevelLot();
    const payload = await labelsPayload(inv._id);
    const [main] = payload.mainBoxes;
    const inner = payload.data[0];
    const unit = await UnitSerial.findOne({ bulk_packaging_record_id: inner._id });

    for (const code of [main.bulk_packaging_id, inner.bulk_packaging_id, unit.serial]) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
    expect(new Set([main.bulk_packaging_id, inner.bulk_packaging_id, unit.serial]).size).toBe(3);
  });

  test("MAIN BOXES 2 × BOXES PER MAIN 5 × UNITS PER BOX 2, qty 20 → 2 cards of 5 inner boxes", async () => {
    const inv = await smallThreeLevelLot();
    const payload = await labelsPayload(inv._id);
    const cards = topLevelCards(payload);

    expect(cards).toHaveLength(2);
    for (const c of cards) {
      expect(c.inners).toHaveLength(5);
      expect(c.inners.map((b) => b.inner_index)).toEqual([1, 2, 3, 4, 5]);
      for (const inner of c.inners) {
        expect(await UnitSerial.countDocuments({ bulk_packaging_record_id: inner._id })).toBe(2);
      }
    }
  });

  test("a TWO-level lot returns no main boxes, so the page keeps its flat list", async () => {
    const inv = await twoLevelLot();
    const payload = await labelsPayload(inv._id);

    expect(payload.mainBoxes).toEqual([]);
    expect(payload.data).toHaveLength(4);
    expect(payload.data.every((b) => !b.parent_box_id)).toBe(true);
  });
});
