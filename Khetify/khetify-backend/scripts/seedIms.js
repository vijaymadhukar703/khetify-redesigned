/**
 * IMS demo-data seeder — makes the IMS pages (Lot Dashboard, Lots & Batches,
 * Warehouses, Transport) look presentable with realistic agri-input data.
 *
 * Run from the backend folder:
 *   node scripts/seedIms.js                  # picks the first company
 *   node scripts/seedIms.js --email=you@x.com
 *   node scripts/seedIms.js --company=<companyId>
 *
 * Safe to re-run: products, warehouses and lots are upserted (no duplicates,
 * stock is set not incremented), and demo shipments are replaced each run.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const { generateUniqueProductCode } = require("../services/productCodeService");
const Warehouse = require("../model/Warehouse/Warehouse");
const Location = require("../model/Warehouse/Location");
const Inventory = require("../model/Inventory/Inventory");
const InventoryBin = require("../model/Inventory/InventoryBin");
const Shipment = require("../model/Transport/Shipment");
const Order = require("../model/Order/Order");
const User = require("../model/User/User");
const Vendor = require("../model/Vendor/Vendor");
const PurchaseOrder = require("../model/Purchase/PurchaseOrder");
const Payment = require("../model/Payment/Payment");
const Customer = require("../model/Sales/Customer");
const Vehicle = require("../model/Transport/Vehicle");
const DriverProfile = require("../model/Transport/DriverProfile");
const bcrypt = require("bcryptjs");
const { changePlan } = require("../services/subscriptionService");
const locationSvc = require("../services/locationService");
const barcodeSvc = require("../services/barcodeService");

// Products that are serial-tracked in the demo (5 of 6).
const SERIAL_KEYS = new Set(["TOM", "NPK", "NEEM", "ZN", "UREA"]);

// Days → Date relative to now (negative = in the past).
const DAY = 86400000;
const inDays = (n) => new Date(Date.now() + n * DAY);

const SHIPMENT_TAG = "[ims-seed]"; // marks demo shipments so re-runs replace cleanly

/* ---------------- demo dataset ---------------- */

const PRODUCTS = [
  { key: "TOM",  productName: "Hybrid Tomato Seeds",   brandName: "Khetify Seeds", category: "Seeds",         unitType: "Packet", unit: "50 g",  packagingType: "Pouch",  mrp: 120,  skuNumber: "SEED-TOM-01",  hsnCode: "1209" },
  { key: "NPK",  productName: "Organic NPK Fertilizer", brandName: "GreenGro",     category: "Fertilizers",   unitType: "Bag",    unit: "50 kg", packagingType: "Bag",    mrp: 1100, skuNumber: "FERT-NPK-01",  hsnCode: "3105" },
  { key: "NEEM", productName: "Bio Pesticide Neem 1L",  brandName: "NeemShield",   category: "Pesticides",    unitType: "Bottle", unit: "1 L",   packagingType: "Bottle", mrp: 450,  skuNumber: "PEST-NEEM-01", hsnCode: "3808" },
  { key: "ZN",   productName: "Zinc Sulphate Granules", brandName: "MicroNutri",   category: "Micronutrients",unitType: "Bag",    unit: "25 kg", packagingType: "Bag",    mrp: 600,  skuNumber: "MICRO-ZN-01",  hsnCode: "3105" },
  { key: "UREA", productName: "Urea Fertilizer",        brandName: "Kisan",        category: "Fertilizers",   unitType: "Bag",    unit: "45 kg", packagingType: "Bag",    mrp: 270,  skuNumber: "FERT-UREA-01", hsnCode: "3102" },
  { key: "SPR",  productName: "Power Sprayer 16L",      brandName: "AgriTools",    category: "Equipment",     unitType: "Piece",  unit: "1 pc",  packagingType: "Box",    mrp: 3200, skuNumber: "EQUIP-SPR-01", hsnCode: "8424" },
];

const WAREHOUSES = [
  { key: "JBP", name: "Jabalpur Central", code: "WH-JBP", city: "Jabalpur", state: "Madhya Pradesh", pincode: "482001", capacityUnits: 20000 },
  { key: "SIH", name: "Sihora Depot",     code: "WH-SIH", city: "Sihora",   state: "Madhya Pradesh", pincode: "483225", capacityUnits: 8000 },
  { key: "KAT", name: "Katni Hub",        code: "WH-KAT", city: "Katni",    state: "Madhya Pradesh", pincode: "483501", capacityUnits: 12000 },
];

// Mix of healthy / expiring(≤90d) / expired(<0) so the dashboard banner & badges populate.
const LOTS = [
  { product: "TOM",  wh: "JBP", batch: "B-TOM-2401",  lot: "UR-TOM-A",  expiry: 210,  qty: 4500, threshold: 500 },
  { product: "TOM",  wh: "SIH", batch: "B-TOM-2312",  lot: "UR-TOM-B",  expiry: 60,   qty: 800,  threshold: 500 },  // expiring
  { product: "NPK",  wh: "JBP", batch: "B-NPK-2403",  lot: "UR-NPK-A",  expiry: 400,  qty: 1200, threshold: 300 },
  { product: "NPK",  wh: "KAT", batch: "B-NPK-2310",  lot: "UR-NPK-B",  expiry: 28,   qty: 240,  threshold: 300 },  // expiring + low
  { product: "NEEM", wh: "SIH", batch: "B-NEEM-2402", lot: "UR-NEEM-A", expiry: 150,  qty: 600,  threshold: 100 },
  { product: "NEEM", wh: "JBP", batch: "B-NEEM-2208", lot: "UR-NEEM-B", expiry: -20,  qty: 90,   threshold: 100 },  // expired
  { product: "ZN",   wh: "KAT", batch: "B-ZN-2401",   lot: "UR-ZN-A",   expiry: 520,  qty: 1100, threshold: 400 },
  { product: "UREA", wh: "JBP", batch: "B-UREA-2404", lot: "UR-UREA-A", expiry: 300,  qty: 5000, threshold: 1000 },
  { product: "UREA", wh: "SIH", batch: "B-UREA-2305", lot: "UR-UREA-B", expiry: -45,  qty: 150,  threshold: 200 },  // expired
  { product: "SPR",  wh: "JBP", batch: "B-SPR-2401",  lot: "UR-SPR-A",  expiry: null, qty: 60,   threshold: 20 },   // no expiry
];

/* ---------------- helpers ---------------- */

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function resolveCompany(args) {
  if (args.company) {
    const c = await Company.findById(args.company);
    if (!c) throw new Error(`No company with _id ${args.company}`);
    return c;
  }
  if (args.email) {
    const c = await Company.findOne({ email: args.email });
    if (!c) throw new Error(`No company with email ${args.email}`);
    return c;
  }
  const c = await Company.findOne().sort({ createdAt: 1 });
  if (!c) throw new Error("No companies in the database — register one first.");
  return c;
}

/* ---------------- main ---------------- */

(async () => {
  const args = parseArgs();
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected to MongoDB");

  const company = await resolveCompany(args);
  const companyId = company._id;
  const companyName =
    company.companyInfo?.companyName || company.fullName || "Demo Agri Company";

  // Ensure a display name (the lot dashboard reads companyInfo.companyName).
  if (!company.companyInfo?.companyName) {
    await Company.updateOne(
      { _id: companyId },
      { $set: { "companyInfo.companyName": companyName } }
    );
  }
  console.log(`🏢 Seeding for: ${companyName} (${company.email || companyId})`);

  // Unlock IMS: 'pro' includes batch_expiry + multi_warehouse so the pages render.
  await changePlan(companyId, "pro");
  console.log("💳 Plan set to 'pro' (IMS features unlocked)");

  // Warehouses (upsert by company + code).
  const whByKey = {};
  for (const w of WAREHOUSES) {
    await Warehouse.updateOne(
      { companyId, code: w.code },
      {
        $set: {
          name: w.name,
          address: { city: w.city, state: w.state, pincode: w.pincode },
          capacityUnits: w.capacityUnits,
          isActive: true,
        },
      },
      { upsert: true }
    );
    whByKey[w.key] = await Warehouse.findOne({ companyId, code: w.code }).select("_id");
  }
  console.log(`🏬 ${WAREHOUSES.length} warehouses ready`);

  // Products (upsert by company + sku).
  const prodByKey = {};
  for (const p of PRODUCTS) {
    await Product.updateOne(
      { companyId, skuNumber: p.skuNumber },
      {
        $set: {
          productName: p.productName,
          brandName: p.brandName,
          category: p.category,
          unitType: p.unitType,
          unit: p.unit,
          packagingType: p.packagingType,
          mrp: p.mrp,
          hsnCode: p.hsnCode,
          variantType: "single",
          productStatus: "active",
          productUpload: "uploaded",
          trackSerial: SERIAL_KEYS.has(p.key),
        },
        // An upsert bypasses document middleware, so the schema hook can't
        // assign the code — do it here. $setOnInsert leaves an already-seeded
        // product's existing code alone.
        $setOnInsert: { product_code: await generateUniqueProductCode(p.productName) },
      },
      { upsert: true }
    );
    prodByKey[p.key] = await Product.findOne({ companyId, skuNumber: p.skuNumber }).select("_id");
  }
  console.log(`📦 ${PRODUCTS.length} products ready`);

  // Lots (upsert by the existing unique index; stock is SET, not incremented).
  for (const l of LOTS) {
    const productId = prodByKey[l.product]._id;
    const warehouseId = whByKey[l.wh]._id;
    await Inventory.updateOne(
      { productId, ownerType: "company", ownerId: companyId, warehouseId, batchNumber: l.batch },
      {
        $set: {
          lotNumber: l.lot,
          expiryDate: l.expiry === null ? null : inDays(l.expiry),
          onlineStock: 0,
          offlineStock: l.qty,
          reservedStock: 0,
          availableStock: l.qty,
          lowStockThreshold: l.threshold,
        },
      },
      { upsert: true }
    );
  }
  console.log(`🧾 ${LOTS.length} lots ready (FEFO-sorted, mixed expiry)`);

  // Storage locations — clear + regenerate a layout for the JBP warehouse,
  // then put away a couple of lots into bins so the Locations page populates.
  await InventoryBin.deleteMany({ companyId });
  await Location.deleteMany({ companyId });
  const jbpId = whByKey.JBP._id;
  const layout = await locationSvc.generateTree(companyId, {
    warehouseId: jbpId,
    zones: 2,
    racksPerZone: 3,
    shelvesPerRack: 3,
    binsPerShelf: 4,
    binCapacity: 1000,
  });
  const bins = await Location.find({ warehouseId: jbpId, type: "bin" }).sort({ fullCode: 1 }).limit(2);
  const jbpLots = await Inventory.find({ ownerId: companyId, ownerType: "company", warehouseId: jbpId, availableStock: { $gt: 0 } }).limit(2);
  for (let i = 0; i < jbpLots.length && i < bins.length; i++) {
    const putAway = Math.min(jbpLots[i].availableStock, 300);
    await locationSvc.moveBinStock({
      companyId,
      toLocationId: bins[i]._id,
      inventoryId: jbpLots[i]._id,
      qty: putAway,
    });
  }
  console.log(`🗂️  ${layout.created} locations ready (${layout.bins} bins in WH-JBP), 2 lots put away`);

  // Generate unit barcodes for the put-away lots (serialized demo).
  let unitCount = 0;
  for (let i = 0; i < jbpLots.length && i < bins.length; i++) {
    const existing = await require("../model/Barcode/UnitSerial").countDocuments({ companyId, inventoryId: jbpLots[i]._id });
    if (!existing) {
      const r = await barcodeSvc.generateUnits(companyId, jbpLots[i]._id, 25);
      unitCount += r.generated;
    }
  }
  console.log(`🏷️  ${unitCount} unit barcodes generated`);

  // Shipments — replace previous demo rows so re-runs stay clean.
  await Shipment.deleteMany({ companyId, notes: new RegExp(`^\\${SHIPMENT_TAG}`) });
  const shipments = [
    { fromKey: "JBP", toLabel: "Kisan Seva Kendra, Sihora", vehicleNo: "MP20 GA 1234", driverName: "Ramesh Yadav",  driverPhone: "9826012345", transporter: "Narmada Logistics", ewayBillNo: "EWB123456789012", status: "delivered",  dispatched: -3 },
    { fromKey: "SIH", toLabel: "Agro Mart, Katni",          vehicleNo: "MP21 CA 5678", driverName: "Suresh Patel",  driverPhone: "9826098765", transporter: "Tridev Carriers",   ewayBillNo: "EWB987654321098", status: "in_transit", dispatched: -1 },
    { fromKey: "KAT", toLabel: "Farmer Co-op, Damoh",       vehicleNo: "",             driverName: "",              driverPhone: "",           transporter: "",                  ewayBillNo: "",                status: "pending",    dispatched: null },
    { fromKey: "JBP", toLabel: "Green Valley Nursery, Jabalpur", vehicleNo: "MP20 HA 4421", driverName: "Mohan Sahu", driverPhone: "9826055544", transporter: "SelfFleet",      ewayBillNo: "EWB456789012345", status: "delivered",  dispatched: -7 },
  ];
  await Shipment.insertMany(
    shipments.map((s) => ({
      companyId,
      refType: "Manual",
      fromWarehouseId: whByKey[s.fromKey]._id,
      toLabel: s.toLabel,
      vehicleNo: s.vehicleNo || undefined,
      driverName: s.driverName || undefined,
      driverPhone: s.driverPhone || undefined,
      transporter: s.transporter || undefined,
      ewayBillNo: s.ewayBillNo || undefined,
      status: s.status,
      dispatchedAt: s.dispatched === null ? undefined : inDays(s.dispatched),
      deliveredAt: s.status === "delivered" ? inDays(s.dispatched + 1) : undefined,
      notes: `${SHIPMENT_TAG} demo dispatch`,
    }))
  );
  console.log(`🚚 ${shipments.length} shipments ready`);

  // Orders — power the dashboard's Sales overview & Total Orders. Spread across
  // the last 7 days with mixed statuses so revenue / units / returns are real.
  // Replaced each run (tagged by orderNumber).
  await Order.deleteMany({ companyId, orderNumber: /^IMS-SEED-/ });
  const STATUSES = [
    "delivered", "delivered", "shipped", "confirmed", "delivered", "returned",
    "delivered", "pending", "shipped", "delivered", "cancelled", "delivered",
    "returned", "confirmed", "delivered", "delivered",
  ];
  const customers = ["Ramesh Traders", "Sihora Agro", "Katni Krishi Kendra", "Damoh Farmers Co-op", "Green Valley Nursery", "Narmada Seeds"];
  const orderDocs = STATUSES.map((status, i) => {
    const primary = PRODUCTS[i % PRODUCTS.length];
    const qty1 = 6 + ((i * 7) % 22);
    const items = [
      { productId: prodByKey[primary.key]._id, name: primary.productName, qty: qty1, price: primary.mrp },
    ];
    if (i % 4 === 0) {
      const second = PRODUCTS[(i + 3) % PRODUCTS.length];
      items.push({ productId: prodByKey[second.key]._id, name: second.productName, qty: 3 + (i % 9), price: second.mrp });
    }
    const totalUnits = items.reduce((s, it) => s + it.qty, 0);
    const totalAmount = items.reduce((s, it) => s + it.qty * it.price, 0);
    return {
      companyId,
      ownerType: "company",
      ownerId: companyId,
      orderNumber: `IMS-SEED-${1001 + i}`,
      customerName: customers[i % customers.length],
      items,
      totalUnits,
      totalAmount,
      channel: i % 3 === 0 ? "offline" : "online",
      status,
      // Spread over the last 7 days; stagger the hour so same-day orders differ.
      placedAt: new Date(Date.now() - (i % 7) * DAY - (i % 5) * 3600000),
    };
  });
  await Order.insertMany(orderDocs);
  console.log(`🧮 ${orderDocs.length} orders ready (mixed statuses, last 7 days)`);

  // Customers (upsert by phone) + link them to the seeded orders for traceability.
  const customerDefs = [
    { name: "Ramesh Traders",       phone: "9826120001", type: "business", gstin: "23ABCDE1234F1Z5", city: "Jabalpur" },
    { name: "Sihora Agro",          phone: "9826120002", type: "business", gstin: "23PQRSX6789G2Z1", city: "Sihora" },
    { name: "Katni Krishi Kendra",  phone: "9826120003", type: "retail",   city: "Katni" },
    { name: "Damoh Farmers Co-op",  phone: "9826120004", type: "business", gstin: "23LMNOP4567H3Z9", city: "Damoh" },
    { name: "Green Valley Nursery", phone: "9826120005", type: "retail",   city: "Jabalpur" },
    { name: "Narmada Seeds",        phone: "9826120006", type: "business", gstin: "23WXYZA1234B5Z2", city: "Jabalpur" },
  ];
  let custSeq = 1;
  for (const c of customerDefs) {
    await Customer.updateOne(
      { companyId, phone: c.phone },
      {
        $set: {
          ownerType: "company", ownerId: companyId,
          name: c.name, type: c.type, gstin: c.gstin,
          addresses: [{ label: "Default", line1: `${c.city} Main Road`, city: c.city, state: "Madhya Pradesh", stateCode: "23", pincode: "482001", isDefault: true }],
          isActive: true,
        },
        $setOnInsert: { customerCode: `CUST-${String(custSeq).padStart(4, "0")}` },
      },
      { upsert: true }
    );
    custSeq += 1;
    const cust = await Customer.findOne({ companyId, phone: c.phone }).select("_id");
    await Order.updateMany({ companyId, orderNumber: /^IMS-SEED-/, customerName: c.name }, { $set: { customerId: cust._id } });
  }
  console.log(`🧑‍🌾 ${customerDefs.length} customers ready (linked to orders)`);

  // Vehicles (upsert by regNo).
  const vehicleDefs = [
    { regNo: "MP20 GA 1234", type: "truck", capacityKg: 5000 },
    { regNo: "MP21 CA 5678", type: "tempo", capacityKg: 1500 },
  ];
  for (const v of vehicleDefs) {
    await Vehicle.updateOne({ companyId, regNo: v.regNo }, { $set: { ...v, status: "available" } }, { upsert: true });
  }
  const firstVehicle = await Vehicle.findOne({ companyId, regNo: "MP20 GA 1234" }).select("_id");

  // Drivers (User role:driver + DriverProfile). Demo PIN = 1234.
  const driverPin = await bcrypt.hash("1234", 10);
  const driverDefs = [
    { name: "Ramesh Yadav", phone: "9826012345", licenseNo: "MP20-2019-0012345", vehicleId: firstVehicle._id },
    { name: "Suresh Patel", phone: "9826098765", licenseNo: "MP21-2020-0067890", vehicleId: null },
  ];
  for (const d of driverDefs) {
    await User.updateOne(
      { companyId, phone: d.phone, role: "driver" },
      { $set: { name: d.name, role: "driver", status: "active", pin: driverPin } },
      { upsert: true }
    );
    const u = await User.findOne({ companyId, phone: d.phone, role: "driver" }).select("_id");
    await DriverProfile.updateOne(
      { companyId, userId: u._id },
      { $set: { phone: d.phone, licenseNo: d.licenseNo, vehicleId: d.vehicleId } },
      { upsert: true }
    );
  }
  console.log(`🚛 ${vehicleDefs.length} vehicles, ${driverDefs.length} drivers ready (driver PIN: 1234)`);

  // Team members (upsert by email within the company).
  const pwd = await bcrypt.hash("password123", 10);
  const team = [
    { name: companyName + " Admin", email: "admin@demo.khetify", role: "company_admin" },
    { name: "Warehouse Manager", email: "warehouse@demo.khetify", role: "warehouse_manager" },
    { name: "Warehouse Operator", email: "operator@demo.khetify", role: "warehouse_operator" },
    { name: "Transport Manager", email: "transport@demo.khetify", role: "transport_manager" },
    { name: "Sales Manager", email: "sales@demo.khetify", role: "sales_manager" },
    { name: "Auditor", email: "auditor@demo.khetify", role: "auditor" },
  ];
  for (const t of team) {
    await User.updateOne(
      { companyId, email: t.email },
      { $set: { name: t.name, role: t.role, status: "active", passwordHash: pwd } },
      { upsert: true }
    );
  }
  console.log(`👥 ${team.length} team members ready`);

  // Vendors (upsert by name).
  const vendorDefs = [
    { name: "Narmada AgroChem", contactPerson: "Rakesh Verma", phone: "9826011223", gstin: "23ABCDE1234F1Z5", address: "Jabalpur, MP" },
    { name: "BioGrow Supplies", contactPerson: "Anita Rao", phone: "9826044556", gstin: "23PQRSX6789G2Z1", address: "Indore, MP" },
    { name: "Krishna Packaging", contactPerson: "Imran Khan", phone: "9826077889", gstin: "23LMNOP4567H3Z9", address: "Katni, MP" },
  ];
  const vendorByName = {};
  for (const v of vendorDefs) {
    await Vendor.updateOne({ companyId, name: v.name }, { $set: { ...v, status: "active" } }, { upsert: true });
    vendorByName[v.name] = await Vendor.findOne({ companyId, name: v.name }).select("_id");
  }
  console.log(`🤝 ${vendorDefs.length} vendors ready`);

  // Purchase orders (replaced each run).
  await PurchaseOrder.deleteMany({ companyId, poNumber: /^IMS-SEED/ });
  const poDefs = [
    { vendor: "Narmada AgroChem", items: [{ name: "Urea raw material", qty: 100, price: 200 }], status: "sent", exp: 10 },
    { vendor: "BioGrow Supplies", items: [{ name: "Neem extract (L)", qty: 50, price: 120 }], status: "received", exp: -2 },
    { vendor: "Krishna Packaging", items: [{ name: "PP woven bags", qty: 5000, price: 4 }, { name: "Labels (roll)", qty: 20, price: 150 }], status: "draft", exp: 14 },
  ];
  await PurchaseOrder.insertMany(
    poDefs.map((p, i) => ({
      companyId,
      vendorId: vendorByName[p.vendor]._id,
      poNumber: `IMS-SEED-PO-${1001 + i}`,
      items: p.items,
      totalAmount: p.items.reduce((s, it) => s + it.qty * it.price, 0),
      status: p.status,
      expectedDate: inDays(p.exp),
    }))
  );
  console.log(`📑 ${poDefs.length} purchase orders ready`);

  // Billing history (replaced each run).
  await Payment.deleteMany({ companyId, invoiceNo: /^IMS-SEED/ });
  await Payment.insertMany([
    { companyId, invoiceNo: "IMS-SEED-INV-1001", plan: "pro", amount: 1499, status: "paid", paidAt: inDays(-30) },
    { companyId, invoiceNo: "IMS-SEED-INV-1002", plan: "pro", amount: 1499, status: "paid", paidAt: inDays(-1) },
  ]);
  console.log(`💳 2 billing records ready`);

  console.log("\n🎉 IMS demo data seeded. Log in as this company and open /ims.");
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error("❌ Seed failed:", err.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
