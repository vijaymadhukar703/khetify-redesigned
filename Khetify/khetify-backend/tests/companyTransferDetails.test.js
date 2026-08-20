/**
 * The read-only payload behind Company → Transfer History → View.
 *
 * The page adds NO endpoint of its own: it renders GET /shipments/:id/details.
 * These tests pin the fields that page depends on — including the ADDITIVE ones
 * (approvedBy / receivedBy / productCode / mrp) — and check that the existing
 * shape every other consumer reads is untouched.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const User = require("../model/User/User");
const BulkPackage = require("../model/Inventory/BulkPackage");
const UnitSerial = require("../model/Barcode/UnitSerial");
const svc = require("../services/shipmentService");
const lotService = require("../services/lotService");
const barcodeService = require("../services/barcodeService");
const notificationService = require("../services/notificationService");

let companyId, srcWh, destWh, productId, lot, approver, receiver;

beforeEach(() => {
  jest.spyOn(notificationService, "notifyWarehouseTeam").mockResolvedValue();
  jest.spyOn(notificationService, "notifyAdmin").mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Owner", email: `ctd-${new mongoose.Types.ObjectId()}@x.com`, password: "x",
    companyInfo: { companyName: "Bhoomi AgriTech" },
  });
  companyId = c._id;
  srcWh = await Warehouse.create({ companyId, name: "Khargone", code: "KHA" });
  destWh = await Warehouse.create({ companyId, name: "Indore", code: "IND" });
  productId = (await Product.create({
    companyId, productName: "Premium Basmati Rice", skuNumber: "PBR-01",
    category: "Grains", mrp: 250,
  }))._id;
  approver = await User.create({ companyId, name: "Asha Verma", role: "operations_manager", email: `a-${new mongoose.Types.ObjectId()}@x.com` });
  receiver = await User.create({ companyId, name: "Ravi Kumar", role: "warehouse_manager", email: `r-${new mongoose.Types.ObjectId()}@x.com` });

  // A bulk-packaged lot on the books at the source warehouse: 2 boxes × 3 units.
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId: srcWh._id, qty: 6,
    lotOrigin: "company", pendingReceipt: true,
    hasBulkPackaging: true, numberOfBoxes: 2, unitsPerBox: 3,
  });
  await Inventory.updateOne({ _id: inv._id }, { $set: { inTransitStock: 0, offlineStock: 6, availableStock: 6 } });
  await barcodeService.generateUnits(companyId, inv._id, 6, {});
  await UnitSerial.updateMany({ inventoryId: inv._id }, { $set: { status: "in_stock" } });
  lot = await Inventory.findById(inv._id);
});

const makeTransfer = (qty) => svc.createShipment(companyId, {
  refType: "Transfer", toType: "warehouse",
  fromWarehouseId: srcWh._id, toWarehouseId: destWh._id, toLabel: "Indore",
  lines: [{ inventoryId: lot._id, qty }],
});

describe("Transfer Details payload", () => {
  test("Section 1 — summary carries the reference, route, dates and actors", async () => {
    const ship = await makeTransfer(3);
    await svc.approveShipment(companyId, ship._id, { performedBy: approver._id });
    const { qrPayload } = await svc.dispatchShipment(companyId, ship._id, { performedBy: approver._id });
    await svc.verifyReceipt(companyId, ship._id, { qr: qrPayload, warehouseId: destWh._id, verifierId: receiver._id, performedBy: receiver._id });

    const { summary } = await svc.shipmentDetails(companyId, ship._id);
    expect(summary.ref).toBe(`SH-${String(ship._id).slice(-6).toUpperCase()}`);
    expect(summary.toType).toBe("warehouse");        // drives "Warehouse → Warehouse"
    expect(summary.source).toBe("Khargone");
    expect(summary.destination).toBe("Indore");
    expect(summary.status).toBe("received");
    expect(summary.quantity).toBe(3);
    expect(summary.createdAt).toBeTruthy();
    expect(summary.dispatchedAt).toBeTruthy();
    expect(summary.receivedAt).toBeTruthy();
    // ADDITIVE — resolved to real user names, never raw ids.
    expect(summary.approvedBy).toBe("Asha Verma");
    expect(summary.approvedAt).toBeTruthy();
    expect(summary.receivedBy).toBe("Ravi Kumar");
  });

  test("an actor who is the company owner resolves to the company name", async () => {
    // Company-owner tokens are signed with id === companyId, so the id lands in
    // the Company collection rather than User.
    const ship = await makeTransfer(3);
    await svc.approveShipment(companyId, ship._id, { performedBy: companyId });
    const { summary } = await svc.shipmentDetails(companyId, ship._id);
    expect(summary.approvedBy).toBe("Bhoomi AgriTech");
  });

  test("unreached steps leave their actor null rather than guessing", async () => {
    const ship = await makeTransfer(3);
    const { summary, timeline } = await svc.shipmentDetails(companyId, ship._id);
    expect(summary.approvedBy).toBeNull();
    expect(summary.receivedBy).toBeNull();
    expect(summary.dispatchedAt).toBeNull();
    expect(summary.receivedAt).toBeNull();
    // Section 5 marks Planned done and everything after it "Not reached".
    expect(timeline.map((t) => t.status)).toEqual(["planned"]);
  });

  test("Section 2 — product details include code, category and MRP", async () => {
    const ship = await makeTransfer(3);
    const { parentLots } = await svc.shipmentDetails(companyId, ship._id);
    expect(parentLots).toHaveLength(1);
    const l = parentLots[0];
    expect(l.productName).toBe("Premium Basmati Rice");
    expect(l.productCode).toBe("PBR-01");   // ADDITIVE
    expect(l.mrp).toBe(250);                // ADDITIVE
    expect(l.category).toBe("Grains");
    expect(l.lotNumber).toBe(lot.lotNumber);
    expect(l.allocatedQty).toBe(3);
    expect(l.expiryDate !== undefined).toBe(true);
  });

  test("Section 3 — only the Bulk Packaging IDs THIS transfer moved are listed", async () => {
    const [box1] = await BulkPackage.find({ lot_id: lot._id }).sort({ box_serial: 1 });
    const box1Codes = (await UnitSerial.find({ inventoryId: lot._id, box_serial: 1 }).sort({ unit_serial: 1 }).lean())
      .map((u) => u.serial);

    // Dispatch a 3-unit transfer carrying exactly BP-001's units.
    const ship = await makeTransfer(3);
    await svc.dispatchShipment(companyId, ship._id, { performedBy: approver._id });

    const { parentLots } = await svc.shipmentDetails(companyId, ship._id);
    const boxes = parentLots[0].bulkPackages;
    expect(boxes).toHaveLength(1);
    expect(boxes[0].bulkPackagingId).toBe(box1.bulk_packaging_id);
    expect(boxes[0].unitsInBox).toBe(3);               // original package quantity
    expect(boxes[0].unitCodes).toHaveLength(3);        // quantity transferred
    expect(boxes[0].status).toBeTruthy();              // current status
    expect(boxes[0].unitCodes.sort()).toEqual([...box1Codes].sort());
    // BP-002 never moved, so it is absent — not listed with a zero count.
    expect(boxes.some((b) => b.bulkPackagingId.endsWith("BP-002"))).toBe(false);
  });

  test("a transfer with no labelled units reports no packages and no unit codes", async () => {
    const plain = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: srcWh._id, qty: 5,
      lotOrigin: "company", batchNumber: "PLAIN-1",
    });
    await Inventory.updateOne({ _id: plain._id }, { $set: { inTransitStock: 0, offlineStock: 5, availableStock: 5 } });
    const ship = await svc.createShipment(companyId, {
      refType: "Transfer", toType: "warehouse",
      fromWarehouseId: srcWh._id, toWarehouseId: destWh._id, toLabel: "Indore",
      lines: [{ inventoryId: plain._id, qty: 2 }],
    });
    await svc.dispatchShipment(companyId, ship._id, { performedBy: approver._id });

    const { parentLots } = await svc.shipmentDetails(companyId, ship._id);
    expect(parentLots[0].bulkPackages).toEqual([]);
    expect(parentLots[0].looseUnitCodes).toEqual([]);
    expect(parentLots[0].allocatedQty).toBe(2);
  });

  test("Section 5 — the timeline is the shipment's real status history, in order", async () => {
    const ship = await makeTransfer(3);
    await svc.approveShipment(companyId, ship._id, { performedBy: approver._id });
    const { qrPayload } = await svc.dispatchShipment(companyId, ship._id, { performedBy: approver._id });
    await svc.verifyReceipt(companyId, ship._id, { qr: qrPayload, warehouseId: destWh._id, verifierId: receiver._id, performedBy: receiver._id });

    const { timeline } = await svc.shipmentDetails(companyId, ship._id);
    const statuses = timeline.map((t) => t.status);
    expect(statuses[0]).toBe("planned");
    expect(statuses).toContain("approved");
    expect(statuses).toContain("in_transit");
    expect(statuses[statuses.length - 1]).toBe("received");
    expect(timeline.every((t) => t.at)).toBe(true);
  });

  test("reads nothing it may not — a foreign company's transfer is a 404", async () => {
    const ship = await makeTransfer(3);
    const other = await Company.create({ fullName: "Rival", email: `x-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
    await expect(svc.shipmentDetails(other._id, ship._id)).rejects.toThrow("Shipment not found");
  });
});
