/**
 * REPACK CARTONS — loose picked units packed into a new box at dispatch.
 *
 * The invariants that matter:
 *   · the picked SET does not change — repack is grouping, not movement
 *   · a unit keeps its original lot (`inventoryId`) and its original box
 *     (`bulk_packaging_record_id`); the repack ID is an extra layer on top
 *   · MULTI-LOT cartons are allowed (the label prints no expiry), and their
 *     contents read back grouped by lot, each with its own mfg/expiry
 *   · only THIS shipment's picked units may be packed
 *   · pack / unpack leave an audit trail
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const RepackBox = require("../model/Inventory/RepackBox");
const lotService = require("../services/lotService");
const barcodeService = require("../services/barcodeService");
const shipmentService = require("../services/shipmentService");
const svc = require("../services/repackService");

let companyId, srcWh, destWh, productId, actor;

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `rp-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  actor = new mongoose.Types.ObjectId();
  // The ID's second segment is the SOURCE WAREHOUSE's code.
  srcWh = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  destWh = await Warehouse.create({ companyId, name: "Dest", code: "WH2" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

/** A received, labelled lot on the source shelf. */
async function makeLot({ qty, boxes, perBox, lotNumber, mfgDate, expiryDate, productId: pid } = {}) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId: pid || productId, warehouseId: srcWh._id, qty,
    lotOrigin: "company", pendingReceipt: true, mfgDate, expiryDate,
    ...(boxes ? { hasBulkPackaging: true, numberOfBoxes: boxes, unitsPerBox: perBox } : {}),
  });
  await Inventory.updateOne(
    { _id: inv._id },
    { $set: { inTransitStock: 0, offlineStock: qty, availableStock: qty, ...(lotNumber ? { lotNumber, batchNumber: lotNumber } : {}) } }
  );
  await BulkPackage.updateMany({ lot_id: inv._id }, { $set: { status: "received" } });
  await barcodeService.generateUnits(companyId, inv._id, qty, {});
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

const shipmentFor = (lines) =>
  shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", toLabel: "Dest",
    fromWarehouseId: srcWh._id, toWarehouseId: destWh._id, lines,
  });

const serialsOf = (lot, n) =>
  UnitSerial.find({ inventoryId: lot._id }).limit(n).lean().then((u) => u.map((x) => x.serial));

/** Today as the ID spells it. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};

describe("packing", () => {
  test("mints a unique ID in the house format and links the units", async () => {
    const lot = await makeLot({ qty: 10 });
    const ship = await shipmentFor([{ inventoryId: lot._id, qty: 10 }]);
    const serials = await serialsOf(lot, 4);

    const box = await svc.packUnits(companyId, { shipmentId: ship._id, serials, performedBy: actor });

    // KH-<WAREHOUSE>-<PRODUCT>-BX-<YYYYMMDD>-<SERIAL>
    const product = await Product.findById(productId).select("product_code").lean();
    expect(box.repackBoxId).toBe(`KH-BHO-${product.product_code}-BX-${today()}-0001`);
    expect(box.unitCount).toBe(4);
    expect(await UnitSerial.countDocuments({ repack_box_id: (await RepackBox.findOne({ repack_box_id: box.repackBoxId }))._id })).toBe(4);
  });

  test("the serial restarts at 0001 for a DIFFERENT product on the same day", async () => {
    const other = await Product.create({ companyId, productName: "xyz" });
    const a = await makeLot({ qty: 4 });
    const b = await makeLot({ qty: 4, productId: other._id });
    const ship = await shipmentFor([{ inventoryId: a._id, qty: 4 }, { inventoryId: b._id, qty: 4 }]);

    const a1 = await svc.packUnits(companyId, { shipmentId: ship._id, serials: await serialsOf(a, 1), performedBy: actor });
    const a2 = await svc.packUnits(companyId, { shipmentId: ship._id, serials: (await serialsOf(a, 2)).slice(1), performedBy: actor });
    const b1 = await svc.packUnits(companyId, { shipmentId: ship._id, serials: await serialsOf(b, 1), performedBy: actor });

    expect(a1.repackBoxId).toMatch(/-0001$/);
    expect(a2.repackBoxId).toMatch(/-0002$/);   // same product, next serial
    expect(b1.repackBoxId).toMatch(/-0001$/);   // other product, back to 0001
    expect(b1.repackBoxId).toContain(String((await Product.findById(other._id).lean()).product_code));
  });

  test("concurrent packs of the same product never collide", async () => {
    const lot = await makeLot({ qty: 20 });
    const ship = await shipmentFor([{ inventoryId: lot._id, qty: 20 }]);
    const all = await serialsOf(lot, 6);

    // Three packs fired together — the counter is a single atomic $inc, so the
    // serials must come out distinct.
    const boxes = await Promise.all([
      svc.packUnits(companyId, { shipmentId: ship._id, serials: all.slice(0, 2), performedBy: actor }),
      svc.packUnits(companyId, { shipmentId: ship._id, serials: all.slice(2, 4), performedBy: actor }),
      svc.packUnits(companyId, { shipmentId: ship._id, serials: all.slice(4, 6), performedBy: actor }),
    ]);
    expect(new Set(boxes.map((b) => b.repackBoxId)).size).toBe(3);
  });

  test("the ID is globally unique — a duplicate insert is rejected by the index", async () => {
    const lot = await makeLot({ qty: 4 });
    const ship = await shipmentFor([{ inventoryId: lot._id, qty: 4 }]);
    const box = await svc.packUnits(companyId, { shipmentId: ship._id, serials: await serialsOf(lot, 2), performedBy: actor });

    await expect(RepackBox.create({
      company_id: companyId, product_id: productId, repack_box_id: box.repackBoxId,
      shipment_id: ship._id, unit_count: 1,
    })).rejects.toThrow(/E11000|duplicate key/i);
  });

  test("two cartons from one set of loose units — 40 units split 20 + 20", async () => {
    const lot = await makeLot({ qty: 40 });
    const ship = await shipmentFor([{ inventoryId: lot._id, qty: 40 }]);
    const all = await serialsOf(lot, 40);

    const a = await svc.packUnits(companyId, { shipmentId: ship._id, serials: all.slice(0, 20), performedBy: actor });
    const b = await svc.packUnits(companyId, { shipmentId: ship._id, serials: all.slice(20), performedBy: actor });

    expect(a.repackBoxId).not.toBe(b.repackBoxId);
    expect(a.unitCount).toBe(20);
    expect(b.unitCount).toBe(20);
    // The picked SET is unchanged — 40 units, still 40, just in two cartons.
    expect(await UnitSerial.countDocuments({ inventoryId: lot._id, repack_box_id: { $ne: null } })).toBe(40);
  });

  test("a unit already in a carton cannot be packed again", async () => {
    const lot = await makeLot({ qty: 6 });
    const ship = await shipmentFor([{ inventoryId: lot._id, qty: 6 }]);
    const serials = await serialsOf(lot, 3);
    await svc.packUnits(companyId, { shipmentId: ship._id, serials, performedBy: actor });

    await expect(svc.packUnits(companyId, { shipmentId: ship._id, serials, performedBy: actor }))
      .rejects.toThrow(/already in a repack box/);
  });

  /**
   * ANOTHER LOT OF THE SAME PRODUCT, on the same shelf, is packable.
   *
   * This test used to assert the opposite. The shipment's lines are an
   * earliest-expiry ALLOCATION, and the scan resolver has long let the operator
   * take the product out of whichever of its lots is actually to hand — so a
   * unit the dialog had accepted and counted was then refused the moment it was
   * packed into a carton. Packing now asks the same authority the scan did
   * (dispatchScanService.eligibleLotIds).
   */
  test("another lot of the SAME product on this shelf is allowed", async () => {
    const onShipment = await makeLot({ qty: 5 });
    const sibling = await makeLot({ qty: 5 });   // same product, same warehouse
    const ship = await shipmentFor([{ inventoryId: onShipment._id, qty: 5 }]);

    const box = await svc.packUnits(companyId, {
      shipmentId: ship._id, serials: await serialsOf(sibling, 2), performedBy: actor,
    });
    expect(box.unitCount).toBe(2);
  });

  test("stock of ANOTHER PRODUCT is refused", async () => {
    const onShipment = await makeLot({ qty: 5 });
    const other = await Product.create({ companyId, productName: "xyz" });
    const foreign = await makeLot({ qty: 5, productId: other._id });
    const ship = await shipmentFor([{ inventoryId: onShipment._id, qty: 5 }]);

    await expect(svc.packUnits(companyId, {
      shipmentId: ship._id, serials: await serialsOf(foreign, 2), performedBy: actor,
    })).rejects.toThrow(/not one of this shipment's picked units/);
  });

  test("a unit that does not exist at all is refused", async () => {
    const onShipment = await makeLot({ qty: 5 });
    const ship = await shipmentFor([{ inventoryId: onShipment._id, qty: 5 }]);

    await expect(svc.packUnits(companyId, {
      shipmentId: ship._id, serials: ["NO-SUCH-UNIT-0001"], performedBy: actor,
    })).rejects.toThrow(/not one of this shipment's picked units/);
  });

  test("two products in one carton is refused — a label names one product", async () => {
    const other = (await Product.create({ companyId, productName: "xyz" }))._id;
    const a = await makeLot({ qty: 4 });
    const b = await makeLot({ qty: 4, productId: other });
    const ship = await shipmentFor([{ inventoryId: a._id, qty: 4 }, { inventoryId: b._id, qty: 4 }]);

    await expect(svc.packUnits(companyId, {
      shipmentId: ship._id,
      serials: [...(await serialsOf(a, 1)), ...(await serialsOf(b, 1))],
      performedBy: actor,
    })).rejects.toThrow(/same product/);
  });
});

describe("older RP cartons stay valid", () => {
  test("both markers are recognised as a repack box ID", () => {
    expect(svc.isRepackBoxId("KH-BHO-ABC711-BX-20260801-0002")).toBe(true);
    expect(svc.isRepackBoxId("KH-BHO-RP-20260801-0002")).toBe(true);   // legacy
    expect(svc.isRepackBoxId("KH-BHO-ABC711-BP01-2026-08-01-0001")).toBe(false);
    expect(svc.isRepackBoxId("nonsense")).toBe(false);
  });

  test("a carton minted under the old format still resolves, views and unpacks", async () => {
    const lot = await makeLot({ qty: 5 });
    const ship = await shipmentFor([{ inventoryId: lot._id, qty: 5 }]);
    const serials = await serialsOf(lot, 3);

    // A row exactly as the previous format wrote it — never rewritten.
    const legacyId = "KH-BHO-RP-20260801-0002";
    const legacy = await RepackBox.create({
      company_id: companyId, warehouse_id: srcWh._id, product_id: productId,
      repack_box_id: legacyId, shipment_id: ship._id, status: "packed", unit_count: 3,
      packed_by: actor,
    });
    await UnitSerial.updateMany({ serial: { $in: serials } }, { $set: { repack_box_id: legacy._id } });

    const view = await svc.boxContents(companyId, legacyId);
    expect(view.repackBoxId).toBe(legacyId);
    expect(view.unitCount).toBe(3);
    expect(view.lotGroups).toHaveLength(1);

    const out = await svc.unpackBox(companyId, legacyId, { performedBy: actor });
    expect(out.unitCodes).toHaveLength(3);
  });
});

describe("MULTI-LOT carton", () => {
  test("units from two lots pack together and read back grouped by lot, with each lot's dates", async () => {
    const lotA = await makeLot({
      qty: 10, lotNumber: "LOT-A",
      mfgDate: new Date("2026-01-10"), expiryDate: new Date("2027-01-10"),
    });
    const lotB = await makeLot({
      qty: 10, lotNumber: "LOT-B",
      mfgDate: new Date("2026-05-20"), expiryDate: new Date("2027-05-20"),
    });
    const ship = await shipmentFor([
      { inventoryId: lotA._id, qty: 10 },
      { inventoryId: lotB._id, qty: 10 },
    ]);

    const box = await svc.packUnits(companyId, {
      shipmentId: ship._id,
      serials: [...(await serialsOf(lotA, 3)), ...(await serialsOf(lotB, 2))],
      performedBy: actor,
    });

    expect(box.unitCount).toBe(5);
    expect(box.lotCount).toBe(2);

    const byLot = Object.fromEntries(box.lotGroups.map((g) => [g.lotNumber, g]));
    expect(byLot["LOT-A"].unitCount).toBe(3);
    expect(byLot["LOT-B"].unitCount).toBe(2);
    // Each group carries ITS OWN dates — the ones the label deliberately omits.
    expect(new Date(byLot["LOT-A"].expiryDate).toISOString().slice(0, 10)).toBe("2027-01-10");
    expect(new Date(byLot["LOT-B"].expiryDate).toISOString().slice(0, 10)).toBe("2027-05-20");
    // …and every unit code is listed under its own lot.
    expect(byLot["LOT-A"].units).toHaveLength(3);
    expect(byLot["LOT-B"].units).toHaveLength(2);
  });

  test("the units keep their ORIGINAL lot and original box — nothing is merged", async () => {
    const lotA = await makeLot({ qty: 10, boxes: 2, perBox: 5, lotNumber: "LOT-A" });
    const lotB = await makeLot({ qty: 10, lotNumber: "LOT-B" });
    const ship = await shipmentFor([
      { inventoryId: lotA._id, qty: 10 },
      { inventoryId: lotB._id, qty: 10 },
    ]);
    const fromA = await serialsOf(lotA, 2);
    const fromB = await serialsOf(lotB, 2);

    await svc.packUnits(companyId, { shipmentId: ship._id, serials: [...fromA, ...fromB], performedBy: actor });

    const a = await UnitSerial.findOne({ serial: fromA[0] });
    const b = await UnitSerial.findOne({ serial: fromB[0] });
    // Original lot link — this is what makes receiving land them separately.
    expect(String(a.inventoryId)).toBe(String(lotA._id));
    expect(String(b.inventoryId)).toBe(String(lotB._id));
    expect(String(a.inventoryId)).not.toBe(String(b.inventoryId));
    // Original box link survives too — the repack sits on top of it.
    expect(a.bulk_packaging_record_id).not.toBeNull();
    expect(a.bulk_packaging_id).toBeTruthy();
    // …and both now also carry the repack layer.
    expect(String(a.repack_box_id)).toBe(String(b.repack_box_id));
  });
});

describe("unpacking", () => {
  test("returns the units to loose and keeps the box as an audit record", async () => {
    const lot = await makeLot({ qty: 8 });
    const ship = await shipmentFor([{ inventoryId: lot._id, qty: 8 }]);
    const serials = await serialsOf(lot, 5);
    const box = await svc.packUnits(companyId, { shipmentId: ship._id, serials, performedBy: actor });

    const out = await svc.unpackBox(companyId, box.repackBoxId, { performedBy: actor });
    expect(out.unitCodes).toHaveLength(5);

    expect(await UnitSerial.countDocuments({ serial: { $in: serials }, repack_box_id: { $ne: null } })).toBe(0);
    const row = await RepackBox.findOne({ repack_box_id: box.repackBoxId });
    expect(row.status).toBe("unpacked");           // the ID is never reissued
    expect(row.unpacked_at).toBeTruthy();

    // Those units can be packed into a NEW carton afterwards.
    const again = await svc.packUnits(companyId, { shipmentId: ship._id, serials, performedBy: actor });
    expect(again.repackBoxId).not.toBe(box.repackBoxId);
  });

  test("unpacking twice is refused", async () => {
    const lot = await makeLot({ qty: 4 });
    const ship = await shipmentFor([{ inventoryId: lot._id, qty: 4 }]);
    const box = await svc.packUnits(companyId, { shipmentId: ship._id, serials: await serialsOf(lot, 2), performedBy: actor });
    await svc.unpackBox(companyId, box.repackBoxId, { performedBy: actor });
    await expect(svc.unpackBox(companyId, box.repackBoxId, { performedBy: actor })).rejects.toThrow(/already been unpacked/);
  });
});

describe("audit trail", () => {
  test("pack and unpack each leave one row per unit — when, who, which box", async () => {
    const lot = await makeLot({ qty: 6 });
    const ship = await shipmentFor([{ inventoryId: lot._id, qty: 6 }]);
    const serials = await serialsOf(lot, 3);
    const box = await svc.packUnits(companyId, { shipmentId: ship._id, serials, performedBy: actor });

    const packed = await UnitEvent.find({ companyId, event: "repacked" }).lean();
    expect(packed).toHaveLength(3);
    expect(String(packed[0].actorId)).toBe(String(actor));
    expect(packed[0].refType).toBe("RepackBox");
    expect(packed[0].note).toContain(box.repackBoxId);
    expect(packed[0].at).toBeTruthy();

    await svc.unpackBox(companyId, box.repackBoxId, { performedBy: actor });
    expect(await UnitEvent.countDocuments({ companyId, event: "unpacked" })).toBe(3);
  });

  test("a unit's stock status is untouched — repack is grouping, not movement", async () => {
    const lot = await makeLot({ qty: 5 });
    const ship = await shipmentFor([{ inventoryId: lot._id, qty: 5 }]);
    const serials = await serialsOf(lot, 3);
    await svc.packUnits(companyId, { shipmentId: ship._id, serials, performedBy: actor });

    const units = await UnitSerial.find({ serial: { $in: serials } }).lean();
    expect(units.every((u) => u.status === "in_stock")).toBe(true);
    // …and the lot's stock is exactly where it was.
    const after = await Inventory.findById(lot._id);
    expect(after.availableStock).toBe(5);
  });
});
