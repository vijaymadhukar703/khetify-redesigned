/**
 * Bulk Packaging IDs — every RECEIVED box lists its own units.
 *
 * The bug: the section was rendered by grouping the page's `units` array, which
 * is the row's IN-STOCK units. receiveBox activates the first `units_in_box`
 * units of the LOT rather than the units of the box being received, so the most
 * recently received box routinely held none that were in_stock and its list came
 * out empty — while Packaging Summary, which counts boxes, still reported it
 * received. A box's contents are now read from the units' own link to it.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const UnitSerial = require("../model/Barcode/UnitSerial");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const User = require("../model/User/User");
const lotService = require("../services/lotService");
const bulkPackageService = require("../services/bulkPackageService");
const lotCtrl = require("../controller/Inventory/lotController");

let companyId, productId, bhopal, user, lotSeq;

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `dg-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Khetify Agro" },
  });
  companyId = c._id;
  bhopal = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  productId = (await Product.create({ companyId, productName: "Urea" }))._id;
  const u = await User.create({
    companyId, name: "WM", email: `wm-${new mongoose.Types.ObjectId()}@x.com`,
    password: "x", role: "warehouse_manager", warehouseIds: [bhopal._id],
  });
  user = { id: u._id, companyId, role: "warehouse_manager" };
  lotSeq = 0;
});

/** 4 boxes × 250, composed number declaring GP001~GP004 / SKU0001~SKU1000. */
const makeLot = () => {
  lotSeq += 1;
  return lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: bhopal._id, qty: 1000,
    lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
    hasBulkPackaging: true, numberOfBoxes: 4, unitsPerBox: 250,
    lotSegments: [
      // A composed number carries no serial, so each lot needs its own value.
      { key: "company", type: "value", value: `BHO${lotSeq}` },
      { key: "bulk", type: "range", mode: "variable", prefix: "GP", digits: 3 },
      { key: "sku", type: "range", mode: "variable", prefix: "SKU", digits: 4 },
    ],
  });
};

const receive = async (inv, serials) => {
  const boxes = await BulkPackage.find({ lot_id: inv._id }).sort({ box_serial: 1 });
  for (const s of serials) {
    await bulkPackageService.receiveBox(companyId, boxes[s - 1].bulk_packaging_id, { performedBy: companyId });
  }
};

const view = async (inv) => {
  const res = mockRes();
  await lotCtrl.lotDetails({ params: { id: inv._id }, user }, res);
  return res.body.data;
};

describe("Lot Summary", () => {
  test("Original Lot Quantity is the LOT's, not this warehouse's share", async () => {
    // 3 units of a 1,000-unit lot held here — the figure must still read 1,000.
    const inv = await makeLot();
    await receive(inv, [1]);
    const [box1] = await BulkPackage.find({ lot_id: inv._id }).sort({ box_serial: 1 });
    const keep = await UnitSerial.find({ bulk_packaging_record_id: box1._id }).limit(3);
    await UnitSerial.updateMany(
      { bulk_packaging_record_id: box1._id, _id: { $nin: keep.map((u) => u._id) } },
      { $set: { ownerType: "seller", ownerId: new mongoose.Types.ObjectId(), inventoryId: new mongoose.Types.ObjectId() } }
    );
    await Inventory.updateOne({ _id: inv._id }, { $set: { availableStock: 3, inTransitStock: 750 } });

    const { lotOriginalQuantity, lot } = await view(inv);
    expect(lotOriginalQuantity).toBe(1000);
    // Units at this warehouse is the row's own figure, kept separate.
    expect(Number(lot.availableStock) + Number(lot.inTransitStock)).toBe(753);
  });

  test("a transfer-destination row still reports the lot's created quantity", async () => {
    // Such a row carries no originalQuantity of its own — reading it there is
    // what reported this warehouse's holding as the lot's size.
    const inv = await makeLot();
    await Inventory.updateOne({ _id: inv._id }, { $set: { originalQuantity: null, availableStock: 3 } });

    const { lotOriginalQuantity } = await view(inv);
    // Falls back to the packaging the lot declares: 4 boxes × 250.
    expect(lotOriginalQuantity).toBe(1000);
  });
});

describe("every received box lists its units", () => {
  for (const n of [1, 2, 3, 4]) {
    test(`${n} box(es) received, in order`, async () => {
      const inv = await makeLot();
      const order = Array.from({ length: n }, (_, i) => i + 1);
      await receive(inv, order);

      const { bulkPackages, packaging } = await view(inv);
      expect(bulkPackages.map((b) => b.box_serial)).toEqual(order);
      for (const box of bulkPackages) {
        expect(box.unit_codes).toHaveLength(250);
      }
      // Packaging Summary is untouched by this change.
      expect(packaging.receivedBoxes).toBe(n);
      expect(packaging.receivedUnits).toBe(n * 250);
    });
  }

  test("the reported case — the LAST received box lists its units too", async () => {
    const inv = await makeLot();
    await receive(inv, [1, 2, 3]);

    const { bulkPackages } = await view(inv);
    const last = bulkPackages[bulkPackages.length - 1];
    expect(last.box_serial).toBe(3);
    expect(last.unit_codes).toHaveLength(250);
    // …and it is box 3's own range, not a slice off the front of the lot.
    expect(last.unit_codes[0]).toContain("SKU0501");
    expect(last.unit_codes[249]).toContain("SKU0750");
  });

  test("a box received OUT OF ORDER lists its own units", async () => {
    // The sharpest form of the bug: receiving box 2 first activated box 1's
    // units, so box 2 — the only one listed — rendered empty.
    const inv = await makeLot();
    await receive(inv, [2]);

    const { bulkPackages } = await view(inv);
    expect(bulkPackages.map((b) => b.box_serial)).toEqual([2]);
    expect(bulkPackages[0].unit_codes).toHaveLength(250);
    expect(bulkPackages[0].unit_codes[0]).toContain("SKU0251");
  });

  test("a box supplied onward to a seller disappears entirely", async () => {
    // BP002 was received here and later sent to a seller: its status stays
    // "received" forever, so receive history cannot answer whether it is still
    // on this shelf. Its units moved owner and row — that is what decides.
    const inv = await makeLot();
    await receive(inv, [1, 2, 3]);
    const [, box2] = await BulkPackage.find({ lot_id: inv._id }).sort({ box_serial: 1 });
    const sellerId = new mongoose.Types.ObjectId();
    const sellerLot = new mongoose.Types.ObjectId();
    await UnitSerial.updateMany(
      { bulk_packaging_record_id: box2._id },
      { $set: { ownerType: "seller", ownerId: sellerId, inventoryId: sellerLot, status: "in_stock" } }
    );

    const { bulkPackages } = await view(inv);
    expect(bulkPackages.map((b) => b.box_serial)).toEqual([1, 3]);
    // No card at all — not a card with an empty list.
    expect(bulkPackages.find((b) => String(b._id) === String(box2._id))).toBeUndefined();
    for (const box of bulkPackages) expect(box.unit_codes).toHaveLength(250);
  });

  test("a box moved to another WAREHOUSE of the same company disappears too", async () => {
    const inv = await makeLot();
    await receive(inv, [1, 2]);
    const [, box2] = await BulkPackage.find({ lot_id: inv._id }).sort({ box_serial: 1 });
    await UnitSerial.updateMany(
      { bulk_packaging_record_id: box2._id },
      { $set: { inventoryId: new mongoose.Types.ObjectId() } }
    );

    const { bulkPackages } = await view(inv);
    expect(bulkPackages.map((b) => b.box_serial)).toEqual([1]);
  });

  test("a received box that was never labelled still shows, with the empty-list message", async () => {
    // The message must mean what it says — a box that is here and genuinely has
    // no unit records — rather than being the symptom of a filtering mismatch.
    const inv = await makeLot();
    await receive(inv, [1, 2]);
    const [, box2] = await BulkPackage.find({ lot_id: inv._id }).sort({ box_serial: 1 });
    await UnitSerial.deleteMany({ bulk_packaging_record_id: box2._id });

    const { bulkPackages } = await view(inv);
    expect(bulkPackages.map((b) => b.box_serial)).toEqual([1, 2]);
    expect(bulkPackages[1].unit_codes).toHaveLength(0);
  });

  test("loose units are grouped under their parent box, not dumped in one list", async () => {
    // The reported lot: 3 units of BOX 1 held here, the box itself elsewhere.
    const inv = await makeLot();
    await receive(inv, [1]);
    const [box1] = await BulkPackage.find({ lot_id: inv._id }).sort({ box_serial: 1 });
    const mine = await UnitSerial.find({ bulk_packaging_record_id: box1._id }).limit(3);
    // The rest of box 1 goes to a seller — the box is no longer here in full.
    await UnitSerial.updateMany(
      { bulk_packaging_record_id: box1._id, _id: { $nin: mine.map((u) => u._id) } },
      { $set: { ownerType: "seller", ownerId: new mongoose.Types.ObjectId(), inventoryId: new mongoose.Types.ObjectId() } }
    );

    const { bulkPackages, looseUnitGroups, looseUnitCodes } = await view(inv);
    // No box card — the carton is not here.
    expect(bulkPackages).toHaveLength(0);
    // …but the units are attributed to it by name and position.
    expect(looseUnitGroups).toHaveLength(1);
    expect(looseUnitGroups[0]).toMatchObject({
      bulkPackagingId: box1.bulk_packaging_id,
      boxSerial: 1,
      unitsInBox: 250,
    });
    expect(looseUnitGroups[0].codes).toHaveLength(3);
    expect(looseUnitCodes).toHaveLength(0);
  });

  test("units from two different boxes stay distinguishable", async () => {
    const inv = await makeLot();
    await receive(inv, [1, 2]);
    const [box1, box2] = await BulkPackage.find({ lot_id: inv._id }).sort({ box_serial: 1 });
    const away = { ownerType: "seller", ownerId: new mongoose.Types.ObjectId(), inventoryId: new mongoose.Types.ObjectId() };
    for (const b of [box1, box2]) {
      const keep = await UnitSerial.find({ bulk_packaging_record_id: b._id }).limit(2);
      await UnitSerial.updateMany(
        { bulk_packaging_record_id: b._id, _id: { $nin: keep.map((u) => u._id) } },
        { $set: away }
      );
    }

    const { looseUnitGroups } = await view(inv);
    expect(looseUnitGroups.map((g) => g.boxSerial)).toEqual([1, 2]);
    expect(looseUnitGroups.every((g) => g.codes.length === 2)).toBe(true);
  });

  test("a unit is in EXACTLY one place — a box card or a loose group", async () => {
    // Box 1 whole and here; 3 units of box 2 here, the rest gone.
    const inv = await makeLot();
    await receive(inv, [1, 2]);
    const [, box2] = await BulkPackage.find({ lot_id: inv._id }).sort({ box_serial: 1 });
    const keep = await UnitSerial.find({ bulk_packaging_record_id: box2._id }).limit(3);
    await UnitSerial.updateMany(
      { bulk_packaging_record_id: box2._id, _id: { $nin: keep.map((u) => u._id) } },
      { $set: { ownerType: "seller", ownerId: new mongoose.Types.ObjectId(), inventoryId: new mongoose.Types.ObjectId() } }
    );

    const { bulkPackages, looseUnitGroups, looseUnitCodes } = await view(inv);
    expect(bulkPackages.map((b) => b.box_serial)).toEqual([1]);
    expect(looseUnitGroups.map((g) => g.boxSerial)).toEqual([2]);

    const all = [
      ...bulkPackages.flatMap((b) => b.unit_codes),
      ...looseUnitGroups.flatMap((g) => g.codes),
      ...looseUnitCodes,
    ];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(253);
  });

  test("each box lists ITS OWN units, never another box's", async () => {
    const inv = await makeLot();
    await receive(inv, [1, 2, 3, 4]);

    const { bulkPackages } = await view(inv);
    const seen = new Set();
    for (const box of bulkPackages) {
      for (const code of box.unit_codes) {
        expect(seen.has(code)).toBe(false);
        seen.add(code);
      }
    }
    expect(seen.size).toBe(1000);
  });
});
