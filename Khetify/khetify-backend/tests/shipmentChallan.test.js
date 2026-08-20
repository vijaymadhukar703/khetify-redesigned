/**
 * DELIVERY CHALLAN on a warehouse shipment.
 *
 * The warehouse "New Shipment" form posts the challan number plus a scan of the
 * document; the scan goes through the SAME storage service every other upload
 * uses and only its KEY is persisted, with the reachable link resolved on read.
 *
 * Local storage driver so the upload writes to uploads/ instead of S3 — the
 * same choice the PC/certificate suites make.
 */
process.env.STORAGE_DRIVER = "local";

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const Shipment = require("../model/Transport/Shipment");
const ctrl = require("../controller/Transport/tmsController");
const svc = require("../services/shipmentService");

let companyId, srcWh, destWh, inv;
const UPLOAD_ROOT = path.join(__dirname, "../uploads/shipments");

// warehouse_manager holds inventory:transfer + shipment:create; company_admin is
// denied both (config/permissions ROLE_DENIED), which is why the form is a
// warehouse control.
const user = () => ({ id: new mongoose.Types.ObjectId(), companyId, role: "warehouse_manager" });

/** Minimal res double — records what the controller replied with. */
const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const pdf = (name = "challan.pdf") => ({
  buffer: Buffer.from("%PDF-1.4 fake"), originalname: name, mimetype: "application/pdf", size: 13,
});

beforeEach(async () => {
  const c = await Company.create({ fullName: "Co", email: `c-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
  companyId = c._id;
  srcWh = await Warehouse.create({ companyId, name: "Source", code: "WH1" });
  destWh = await Warehouse.create({ companyId, name: "Dest", code: "WH2" });
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "U1" });
  inv = await Inventory.create({
    productId: p._id, ownerType: "company", ownerId: companyId, warehouseId: srcWh._id,
    batchNumber: "B1", lotNumber: "B1", offlineStock: 100, availableStock: 100,
  });
});

afterAll(() => { fs.rmSync(UPLOAD_ROOT, { recursive: true, force: true }); });

/** The body the New Shipment form posts (multipart → every value a string). */
const formBody = (over = {}) => ({
  refType: "Transfer",
  toType: "warehouse",
  toLabel: "Warehouse transfer",
  fromWarehouseId: String(srcWh._id),
  toWarehouseId: String(destWh._id),
  deliveryChallanNumber: "DC-2026-0042",
  lines: [{ inventoryId: String(inv._id), qty: 10 }],
  ...over,
});

describe("createShipment — delivery challan", () => {
  test("stores the challan number and the document KEY, and records it as a warehouse transfer", async () => {
    const res = makeRes();
    await ctrl.createShipment({ user: user(), body: formBody(), file: pdf() }, res);
    expect(res.statusCode).toBe(201);

    const saved = await Shipment.findById(res.body.data._id).lean();
    expect(saved.deliveryChallanNumber).toBe("DC-2026-0042");
    // The KEY is what is persisted — never a public URL.
    expect(saved.challanDocument.key).toMatch(new RegExp(`^shipments/${companyId}/\\d+-challan\\.pdf$`));
    expect(saved.challanDocument.name).toBe("challan.pdf");
    expect(saved.challanDocument.mime).toBe("application/pdf");
    // TYPE is no longer asked for: the movement is recorded as a warehouse
    // transfer, and neither field is left unset.
    expect(saved.refType).toBe("Transfer");
    expect(saved.toType).toBe("warehouse");
    // The file really landed in storage.
    expect(fs.existsSync(path.join(__dirname, "../uploads", saved.challanDocument.key))).toBe(true);
  });

  test("accepts ANY file type — the warehouse attaches whatever paperwork it holds", async () => {
    const res = makeRes();
    await ctrl.createShipment(
      { user: user(), body: formBody(), file: { ...pdf("challan.xlsx"), mimetype: "application/vnd.ms-excel" } },
      res
    );
    expect(res.statusCode).toBe(201);
    const saved = await Shipment.findById(res.body.data._id).lean();
    expect(saved.challanDocument.name).toBe("challan.xlsx");
    expect(saved.challanDocument.mime).toBe("application/vnd.ms-excel");
  });

  test("a shipment raised without a challan is still accepted (Lots → Transfer, stock requests)", async () => {
    const res = makeRes();
    await ctrl.createShipment({ user: user(), body: formBody({ deliveryChallanNumber: undefined }) }, res);
    expect(res.statusCode).toBe(201);
    const saved = await Shipment.findById(res.body.data._id).lean();
    expect(saved.deliveryChallanNumber).toBeUndefined();
    expect(saved.challanDocument?.key).toBeUndefined();
  });
});

describe("challan is retrievable afterwards", () => {
  test("the list row and the detail summary both carry the number and a resolvable link", async () => {
    const res = makeRes();
    await ctrl.createShipment({ user: user(), body: formBody(), file: pdf() }, res);
    const id = res.body.data._id;

    const [row] = await svc.listShipments(companyId);
    expect(row.deliveryChallanNumber).toBe("DC-2026-0042");
    expect(row.challanDocumentUrl).toBe(`/uploads/${row.challanDocument.key}`);

    const details = await svc.shipmentDetails(companyId, id);
    expect(details.summary.deliveryChallanNumber).toBe("DC-2026-0042");
    expect(details.summary.challanDocumentName).toBe("challan.pdf");
    expect(details.summary.challanDocumentUrl).toMatch(/^\/uploads\/shipments\//);
  });

  test("a shipment with no challan reports null rather than a broken link", async () => {
    const res = makeRes();
    await ctrl.createShipment({ user: user(), body: formBody({ deliveryChallanNumber: undefined }) }, res);
    const details = await svc.shipmentDetails(companyId, res.body.data._id);
    expect(details.summary.deliveryChallanNumber).toBeNull();
    expect(details.summary.challanDocumentUrl).toBeNull();
    const [row] = await svc.listShipments(companyId);
    expect(row.challanDocumentUrl).toBeUndefined();
  });
});
