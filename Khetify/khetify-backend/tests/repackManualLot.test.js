/**
 * REPACKING UNITS OF A MANUALLY-COMPOSED LOT.
 *
 * The report: a lot numbered by hand ("VNR-PRO-BAT-2026-07-30-SKU001~SKU060",
 * no KH- head, no BP/BPINNER segments) was scanned out fine — six codes listed,
 * "Picked 6 / 6" — and then "Pack 3 units into new box" came back with
 * "…-SKU001 is not one of this shipment's picked units."
 *
 * THE LOT NUMBER'S FORMAT HAS NOTHING TO DO WITH IT. Nothing in packUnits parses
 * a code, and a manual lot's UnitSerial rows are structurally identical to a
 * generated lot's. What differed is which LOT the units came from: the shipment's
 * lines are an earliest-expiry allocation, the scan resolver may take the product
 * out of any of its lots on that shelf, and packing was still checking the lines.
 * So the dialog accepted units it then refused to pack.
 *
 * These cover both lot-number shapes and both sides of that rule.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const UnitSerial = require("../model/Barcode/UnitSerial");
const lotService = require("../services/lotService");
const shipmentService = require("../services/shipmentService");
const scanSvc = require("../services/dispatchScanService");
const svc = require("../services/repackService");
const notificationService = require("../services/notificationService");

let companyId, srcWh, destWh, otherWh, productId, actor;

beforeEach(() => {
  jest.spyOn(notificationService, "notifyWarehouseTeam").mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Co", email: `rml-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  actor = new mongoose.Types.ObjectId();
  srcWh = await Warehouse.create({ companyId, name: "Bhopal", code: "BHO" });
  destWh = await Warehouse.create({ companyId, name: "Indore", code: "IND" });
  otherWh = await Warehouse.create({ companyId, name: "Nagpur", code: "NAG" });
  productId = (await Product.create({ companyId, productName: "abc" }))._id;
});

const V = (key, value) => ({ key, type: "value", value });
const R = (key, prefix, digits = 3) => ({ key, type: "range", mode: "variable", prefix, digits });

/** The operator's own format — no KH- head, no packaging segments. */
const MANUAL_SEGMENTS = [
  V("company", "VNR"), V("product", "PRO"), V("batch", "BAT"),
  V("year", "2026"), V("month", "07"), V("date", "30"), R("sku", "SKU"),
];

/** A single-package lot on the source shelf, labelled and in stock. */
async function makeLot({ qty, segments, warehouseId, productId: pid, expiryDate } = {}) {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId: pid || productId,
    warehouseId: warehouseId || srcWh._id, qty,
    lotOrigin: "company", pendingReceipt: true, mintUnitLabels: true,
    expiryDate, ...(segments ? { lotSegments: segments } : {}),
  });
  await Inventory.updateOne(
    { _id: inv._id },
    { $set: { inTransitStock: 0, offlineStock: qty, availableStock: qty } }
  );
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  return Inventory.findById(inv._id);
}

const transferOf = (qty, pid) =>
  shipmentService.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", toLabel: "Indore",
    fromWarehouseId: srcWh._id, toWarehouseId: destWh._id,
    lines: [{ productId: pid || productId, qty }],
  });

const serialsOf = (lot, n) =>
  UnitSerial.find({ inventoryId: lot._id }).sort({ unit_serial: 1 }).limit(n).lean()
    .then((u) => u.map((x) => x.serial));

/* ------------------------------------------------------ the reported case */

describe("the reported failure", () => {
  /**
   * Two lots of one product on the shelf. The plan names the earlier-expiring
   * one; the operator scans out of the OTHER — the manually-numbered one — which
   * is exactly what the resolver allows.
   */
  async function shelfWithTwoLots() {
    const planned = await makeLot({ qty: 60, expiryDate: new Date("2027-01-01") });
    const manual = await makeLot({
      qty: 60, segments: MANUAL_SEGMENTS, expiryDate: new Date("2027-12-01"),
    });
    const ship = await transferOf(6);
    return { planned, manual, ship };
  }

  test("the plan really does name the OTHER lot", async () => {
    const { manual, ship } = await shelfWithTwoLots();
    expect(ship.lines.map((l) => String(l.inventoryId))).not.toContain(String(manual._id));
  });

  test("the manual lot's units SCAN OUT — the dialog accepts them", async () => {
    const { manual, ship } = await shelfWithTwoLots();
    const codes = await serialsOf(manual, 6);

    const r = await scanSvc.resolveDispatchScan(companyId, ship._id, { code: codes[0] });
    expect(r.addedQuantity).toBe(1);
    expect(r.lotNumber).toBe(manual.lotNumber);
  });

  test("…and they PACK — the box is created", async () => {
    const { manual, ship } = await shelfWithTwoLots();
    const codes = await serialsOf(manual, 6);

    const box = await svc.packUnits(companyId, {
      shipmentId: ship._id, serials: codes.slice(0, 3), performedBy: actor,
    });

    expect(box.unitCount).toBe(3);
    expect(box.repackBoxId).toMatch(/-BX-\d{8}-\d+$/);
    expect(box.lotGroups[0].lotNumber).toBe(manual.lotNumber);
  });

  test("the PICKED SET does not change — the same units, grouped", async () => {
    const { manual, ship } = await shelfWithTwoLots();
    const codes = await serialsOf(manual, 6);

    const box = await svc.packUnits(companyId, {
      shipmentId: ship._id, serials: codes.slice(0, 3), performedBy: actor,
    });

    // Three in the carton, three still loose — six either way.
    expect(box.lotGroups.flatMap((g) => g.units).map((u) => u.serial).sort())
      .toEqual(codes.slice(0, 3).sort());
    const boxed = await UnitSerial.countDocuments({ serial: { $in: codes }, repack_box_id: { $ne: null } });
    expect(boxed).toBe(3);
  });

  test("a unit may be given by its unit_code as well as its serial", async () => {
    const { manual, ship } = await shelfWithTwoLots();
    const rows = await UnitSerial.find({ inventoryId: manual._id }).limit(2).lean();

    const box = await svc.packUnits(companyId, {
      shipmentId: ship._id, serials: rows.map((u) => u.unit_code), performedBy: actor,
    });
    expect(box.unitCount).toBe(2);
  });
});

/* --------------------------------------------------------- no regression */

describe("a KHETIFY-GENERATED lot packs exactly as before", () => {
  test("units of the PLANNED lot pack", async () => {
    const planned = await makeLot({ qty: 10 });
    const ship = await transferOf(6);
    const codes = await serialsOf(planned, 3);

    const box = await svc.packUnits(companyId, {
      shipmentId: ship._id, serials: codes, performedBy: actor,
    });
    expect(box.unitCount).toBe(3);
    expect(box.repackBoxId).toMatch(/^KH-BHO-[A-Z0-9]+-BX-\d{8}-\d{4}$/);
  });

  test("both shapes coexist on one shipment", async () => {
    const planned = await makeLot({ qty: 10, expiryDate: new Date("2027-01-01") });
    const manual = await makeLot({
      qty: 10, segments: MANUAL_SEGMENTS, expiryDate: new Date("2027-12-01"),
    });
    const ship = await transferOf(6);

    const a = await svc.packUnits(companyId, {
      shipmentId: ship._id, serials: await serialsOf(planned, 2), performedBy: actor,
    });
    const b = await svc.packUnits(companyId, {
      shipmentId: ship._id, serials: await serialsOf(manual, 2), performedBy: actor,
    });
    expect(a.unitCount).toBe(2);
    expect(b.unitCount).toBe(2);
    expect(a.repackBoxId).not.toBe(b.repackBoxId);
  });
});

/* ------------------------------------------------------ still refused */

describe("what packing still refuses", () => {
  test("ANOTHER PRODUCT's units", async () => {
    await makeLot({ qty: 10 });
    const other = await Product.create({ companyId, productName: "xyz" });
    const foreign = await makeLot({ qty: 10, productId: other._id });
    const ship = await transferOf(6);

    await expect(svc.packUnits(companyId, {
      shipmentId: ship._id, serials: await serialsOf(foreign, 2), performedBy: actor,
    })).rejects.toThrow(/not one of this shipment's picked units/);
  });

  test("the same product at ANOTHER WAREHOUSE", async () => {
    await makeLot({ qty: 10 });
    const elsewhere = await makeLot({ qty: 10, warehouseId: otherWh._id, segments: MANUAL_SEGMENTS });
    const ship = await transferOf(6);

    await expect(svc.packUnits(companyId, {
      shipmentId: ship._id, serials: await serialsOf(elsewhere, 2), performedBy: actor,
    })).rejects.toThrow(/not one of this shipment's picked units/);
  });

  test("a unit already in another carton", async () => {
    const lot = await makeLot({ qty: 10 });
    const ship = await transferOf(6);
    const codes = await serialsOf(lot, 2);
    await svc.packUnits(companyId, { shipmentId: ship._id, serials: codes, performedBy: actor });

    await expect(svc.packUnits(companyId, {
      shipmentId: ship._id, serials: codes, performedBy: actor,
    })).rejects.toThrow(/already in a repack box/);
  });
});
