const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Product = require("../model/Company/productModel");
const AdminProduct = require("../model/Admin/AdminProduct");
const adminProductRoutes = require("../routes/Admin/adminProductRoutes");

/**
 * ADMIN PRODUCT LIBRARY — /api/admin/products.
 *
 * Drives the real router (requireAdmin → multer → applyUploadedImages → zod →
 * handler) through a minimal express app, so Server.js's DB/socket bootstrap is
 * not needed. Products land in "admin_products"; the Product collection must
 * stay untouched.
 */

const app = express();
app.use(express.json());
app.use("/api/admin/products", adminProductRoutes);

const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });
const adminId = new mongoose.Types.ObjectId();
const adminToken = () => sign({ id: String(adminId), principalType: "admin", role: "super_admin" });
const sellerToken = () => {
  const id = String(new mongoose.Types.ObjectId());
  return sign({ id, sellerId: id, principalType: "seller", role: "seller_admin" });
};
const companyToken = () =>
  sign({ id: String(new mongoose.Types.ObjectId()), companyId: String(new mongoose.Types.ObjectId()), role: "company_admin" });

const validBody = (over = {}) => ({
  productName: "Premium Basmati Rice",
  brandName: "Khet Gold",
  category: "Grains",
  shelfLifeDays: 365,
  companyName: "Khet Foods",
  legalName: "Khet Foods Private Limited",
  licNo: "LIC-123",
  cinNo: "u01100mh2020ptc123456",
  ...over,
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe("access control", () => {
  test("no token → 401", async () => {
    const res = await request(app).get("/api/admin/products");
    expect(res.status).toBe(401);
  });

  test("seller token → 403", async () => {
    const res = await request(app).get("/api/admin/products").set(auth(sellerToken()));
    expect(res.status).toBe(403);
  });

  test("company token → 403", async () => {
    const res = await request(app).post("/api/admin/products").set(auth(companyToken())).send(validBody());
    expect(res.status).toBe(403);
    expect(await AdminProduct.countDocuments()).toBe(0);
  });
});

describe("create", () => {
  test("missing companyName / legalName → 400", async () => {
    const { companyName, legalName, ...rest } = validBody();
    const res = await request(app).post("/api/admin/products").set(auth(adminToken())).send(rest);
    expect(res.status).toBe(400);
    const messages = res.body.errors.map((e) => e.message);
    expect(messages).toContain("Company Name is required");
    expect(messages).toContain("Legal Name is required");
  });

  test("invalid CIN → 400", async () => {
    const res = await request(app).post("/api/admin/products").set(auth(adminToken())).send(validBody({ cinNo: "BAD" }));
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e) => e.message)).toContain("Enter a valid 21-character CIN");
  });

  test("valid body → 201 with a product_code, stored in admin_products only", async () => {
    const res = await request(app).post("/api/admin/products").set(auth(adminToken())).send(validBody());
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const p = res.body.data;
    expect(p.product_code).toMatch(/^PRE\d{3}$/);
    expect(p.companyName).toBe("Khet Foods");
    expect(p.cinNo).toBe("U01100MH2020PTC123456");
    expect(p.shelfLife).toBe("365 Days");
    expect(p.productStatus).toBe("active");
    expect(p.productUpload).toBe("uploaded");
    expect(String(p.createdByAdmin)).toBe(String(adminId));
    expect(p.companyId).toBeUndefined();
    expect(p.ownerType).toBeUndefined();

    expect(await AdminProduct.countDocuments()).toBe(1);
    expect(await Product.countDocuments()).toBe(0);
  });

  test("blank CIN is allowed", async () => {
    const res = await request(app).post("/api/admin/products").set(auth(adminToken())).send(validBody({ cinNo: "" }));
    expect(res.status).toBe(201);
  });
});

describe("list / get / update / duplicate-check", () => {
  let created;
  beforeEach(async () => {
    const res = await request(app).post("/api/admin/products").set(auth(adminToken())).send(validBody());
    created = res.body.data;
    await request(app)
      .post("/api/admin/products")
      .set(auth(adminToken()))
      .send(validBody({ productName: "Urea Fertilizer", brandName: "Agro", category: "Fertilizer", productStatus: "inactive" }));
  });

  test("list returns data + pagination, and filters by search/category/status", async () => {
    const all = await request(app).get("/api/admin/products").set(auth(adminToken()));
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.pagination).toEqual({ page: 1, limit: 10, total: 2, totalPages: 1 });

    const search = await request(app).get("/api/admin/products?search=basmati").set(auth(adminToken()));
    expect(search.body.data.map((p) => p.productName)).toEqual(["Premium Basmati Rice"]);

    const regexSafe = await request(app).get("/api/admin/products?search=(").set(auth(adminToken()));
    expect(regexSafe.status).toBe(200);
    expect(regexSafe.body.data).toHaveLength(0);

    const cat = await request(app).get("/api/admin/products?category=fertilizer").set(auth(adminToken()));
    expect(cat.body.data.map((p) => p.productName)).toEqual(["Urea Fertilizer"]);

    const inactive = await request(app).get("/api/admin/products?status=inactive").set(auth(adminToken()));
    expect(inactive.body.data.map((p) => p.productName)).toEqual(["Urea Fertilizer"]);

    const paged = await request(app).get("/api/admin/products?page=2&limit=1").set(auth(adminToken()));
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
  });

  test("get by id; invalid or unknown id → 404", async () => {
    const res = await request(app).get(`/api/admin/products/${created._id}`).set(auth(adminToken()));
    expect(res.status).toBe(200);
    expect(res.body.data.productName).toBe("Premium Basmati Rice");

    expect((await request(app).get("/api/admin/products/not-an-id").set(auth(adminToken()))).status).toBe(404);
    const unknown = new mongoose.Types.ObjectId();
    expect((await request(app).get(`/api/admin/products/${unknown}`).set(auth(adminToken()))).status).toBe(404);
  });

  test("update changes fields but never product_code", async () => {
    const res = await request(app)
      .put(`/api/admin/products/${created._id}`)
      .set(auth(adminToken()))
      .send({ productName: "Renamed Rice", companyName: "New Co", shelfLifeDays: 1, product_code: "HAX999" });
    expect(res.status).toBe(200);
    expect(res.body.data.productName).toBe("Renamed Rice");
    expect(res.body.data.companyName).toBe("New Co");
    expect(res.body.data.shelfLife).toBe("1 Day");
    expect(res.body.data.product_code).toBe(created.product_code);
  });

  test("update rejects a blank companyName; unknown id → 404", async () => {
    const blank = await request(app)
      .put(`/api/admin/products/${created._id}`)
      .set(auth(adminToken()))
      .send({ companyName: "   " });
    expect(blank.status).toBe(400);

    const unknown = new mongoose.Types.ObjectId();
    const res = await request(app).put(`/api/admin/products/${unknown}`).set(auth(adminToken())).send({ productName: "X" });
    expect(res.status).toBe(404);
  });

  test("duplicate-check matches case-insensitively and is not treated as an :id", async () => {
    const res = await request(app).get("/api/admin/products/duplicate-check?name=BASMATI").set(auth(adminToken()));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].product_code).toBe(created.product_code);

    const empty = await request(app).get("/api/admin/products/duplicate-check").set(auth(adminToken()));
    expect(empty.body).toEqual({ success: true, count: 0, data: [] });
  });
});


describe('admin variant measurements', () => {
  const measurements = { packagingType: 'Bottle', unit: 'Liters', unitValue: 2, length: 10, width: 8, height: 20, dimensionUnit: 'cm', weight: 2.5, weightUnit: 'kg' };
  test('multipart Add, Edit and reload preserve independent measurements and product fields', async () => {
    const variants = [{ label: 'Small', sku: 'SM', measurements }, { label: 'Large', sku: 'LG', measurements: { ...measurements, unitValue: 5, weight: 6 } }];
    let req = request(app).post('/api/admin/products').set(auth(adminToken()));
    for (const [key, value] of Object.entries(validBody({ unit: 'Kilograms', unitValue: 25 }))) req = req.field(key, String(value));
    const added = await req.field('variants', JSON.stringify(variants));
    expect(added.status).toBe(201);
    expect(added.body.data.variants[0].measurements).toEqual(measurements);
    expect(added.body.data.variants[1].measurements.unitValue).toBe(5);
    variants[0].measurements = { ...measurements, length: 12 };
    const edited = await request(app).put('/api/admin/products/' + added.body.data._id).set(auth(adminToken())).field('variants', JSON.stringify(variants));
    expect(edited.status).toBe(200);
    const loaded = await request(app).get('/api/admin/products/' + added.body.data._id).set(auth(adminToken()));
    expect(loaded.body.data.variants[0].measurements.length).toBe(12);
    expect(loaded.body.data.variants[1].measurements.unitValue).toBe(5);
    expect(loaded.body.data.unitValue).toBe(25);
    expect(Product.schema.path('variants').schema.path('measurements').options.default).toBeUndefined();
    expect(Product.schema.path('variants').schema).not.toBe(AdminProduct.schema.path('variants').schema);
    expect(await Product.countDocuments()).toBe(0);
  });
  test.each([
    { ...measurements, length: 0 }, { ...measurements, weight: -1 },
    { ...measurements, width: undefined }, { ...measurements, unitValue: '' },
    { ...measurements, unit: 'Pieces', unitValue: 1.5 },
    { ...measurements, dimensionUnit: 'bad' }, {},
  ])('rejects invalid measurements on Add and Edit: %j', async (bad) => {
    const created = await request(app).post('/api/admin/products').set(auth(adminToken())).send(validBody());
    const body = validBody({ variants: [{ label: 'Bad', measurements: bad }] });
    const added = await request(app).post('/api/admin/products').set(auth(adminToken())).send(body);
    expect(added.status).toBe(400);
    expect(added.body.errors.length).toBeGreaterThan(0);
    const edited = await request(app).put('/api/admin/products/' + created.body.data._id).set(auth(adminToken())).send(body);
    expect(edited.status).toBe(400);
  });
  test('legacy variant can be edited without measurements', async () => {
    const added = await request(app).post('/api/admin/products').set(auth(adminToken())).send(validBody({ variants: [{ label: 'Legacy', sku: 'OLD' }] }));
    expect(added.status).toBe(201);
    const edited = await request(app).put('/api/admin/products/' + added.body.data._id).set(auth(adminToken())).send({ variants: [{ label: 'Legacy', sku: 'NEW' }] });
    expect(edited.status).toBe(200);
    expect(edited.body.data.variants[0].measurements).toBeUndefined();
  });
});
