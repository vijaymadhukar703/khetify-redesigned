const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AdminProduct = require("../model/Admin/AdminProduct");
const principalRouteGuard = require("../middlewares/principalRouteGuard");
const sellerLibraryRoutes = require("../routes/Seller/sellerLibraryRoutes");

/**
 * INBUILT LIBRARY (seller side) — /api/seller/library.
 *
 * The app mirrors Server.js: principalRouteGuard runs app-wide BEFORE the
 * mount. That guard is what turns a company token away from /api/seller/*;
 * the router's own authorize("myproduct:manage") would let company_admin
 * ("*") through on its own.
 */
const app = express();
app.use(principalRouteGuard);
app.use("/api/seller/library", sellerLibraryRoutes);

const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });
const oid = () => String(new mongoose.Types.ObjectId());
const sellerToken = (role = "seller_admin") => {
  const id = oid();
  return sign({ id, sellerId: id, principalType: "seller", role });
};
const companyToken = () => sign({ id: oid(), companyId: oid(), role: "company_admin" });
const auth = (t) => ({ Authorization: `Bearer ${t}` });

const libraryProduct = (over = {}) =>
  AdminProduct.create({
    productName: "Product",
    companyName: "Acme Agro",
    legalName: "Acme Agro Pvt Ltd",
    licNo: "LIC-1",
    cinNo: "U01100MH2020PTC123456",
    costPrice: 99,
    productStatus: "active",
    ...over,
  });

beforeEach(async () => {
  await libraryProduct({ productName: "Urea", companyName: "Acme Agro" });
  await libraryProduct({ productName: "DAP", companyName: "Acme Agro" });
  await libraryProduct({ productName: "Old Seed", companyName: "Acme Agro", productStatus: "inactive" });
  await libraryProduct({ productName: "Neem Oil", companyName: "  Bharat Crop  " });
  await libraryProduct({ productName: "Retired", companyName: "Zeta Hidden", productStatus: "inactive" });
});

describe("access control", () => {
  test("no token → 401", async () => {
    expect((await request(app).get("/api/seller/library/companies")).status).toBe(401);
  });

  test("company token → 403", async () => {
    const res = await request(app).get("/api/seller/library/companies").set(auth(companyToken()));
    expect(res.status).toBe(403);
  });

  test("seller without myproduct:manage → 403", async () => {
    const res = await request(app).get("/api/seller/library/companies").set(auth(sellerToken("seller_staff")));
    expect(res.status).toBe(403);
  });
});

describe("companies", () => {
  test("trimmed, sorted, and a company with only inactive products is absent", async () => {
    const res = await request(app).get("/api/seller/library/companies").set(auth(sellerToken()));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: ["Acme Agro", "Bharat Crop"] });
  });
});

describe("products", () => {
  test("names only for the exact company, inactive hidden, A-Z", async () => {
    const res = await request(app)
      .get("/api/seller/library/products")
      .query({ companyName: "Acme Agro" })
      .set(auth(sellerToken()));
    expect(res.status).toBe(200);
    expect(res.body.data.map((p) => p.productName)).toEqual(["DAP", "Urea"]);
    for (const p of res.body.data) {
      expect(Object.keys(p).sort()).toEqual(["_id", "productName"]);
    }
  });

  test("missing companyName → 400", async () => {
    const res = await request(app).get("/api/seller/library/products").set(auth(sellerToken()));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "companyName is required" });
  });
});

describe("product-details", () => {
  const url = "/api/seller/library/product-details";

  beforeEach(async () => {
    await libraryProduct({
      productName: "Zinc Sulphate",
      companyName: "Acme Agro",
      category: "fertilizers",
      brandName: "AcmeZn",
      mrp: 250,
      hsnCode: "28332990",
      shelfLifeDays: 730,
    });
    // Same name + company, other category — must not match.
    await libraryProduct({ productName: "Zinc Sulphate", companyName: "Acme Agro", category: "seeds" });
    // Same everything but inactive — must not match.
    await libraryProduct({ productName: "Zinc Sulphate", companyName: "Acme Agro", category: "fertilizers", productStatus: "inactive" });
  });

  test("returns the matching product's details, hiding admin-only fields", async () => {
    const res = await request(app)
      .get(url)
      .query({ companyName: "Acme Agro", productName: "Zinc Sulphate", category: "fertilizers" })
      .set(auth(sellerToken()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);

    const p = res.body.data[0];
    expect(p).toMatchObject({
      productName: "Zinc Sulphate",
      companyName: "Acme Agro",
      category: "fertilizers",
      brandName: "AcmeZn",
      mrp: 250,
      hsnCode: "28332990",
      shelfLifeDays: 730,
      productStatus: "active",
    });
    for (const hidden of ["legalName", "licNo", "cinNo", "costPrice", "product_code", "createdByAdmin", "__v"]) {
      expect(p).not.toHaveProperty(hidden);
    }
  });

  test("no match → empty list", async () => {
    const res = await request(app)
      .get(url)
      .query({ companyName: "Acme Agro", productName: "Zinc Sulphate", category: "tools" })
      .set(auth(sellerToken()));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  test.each([
    ["companyName", { productName: "Zinc Sulphate", category: "fertilizers" }],
    ["productName", { companyName: "Acme Agro", category: "fertilizers" }],
    ["category", { companyName: "Acme Agro", productName: "Zinc Sulphate" }],
  ])("missing %s → 400", async (_missing, query) => {
    const res = await request(app).get(url).query(query).set(auth(sellerToken()));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: "companyName, productName and category are required",
    });
  });

  test("company token → 403", async () => {
    const res = await request(app)
      .get(url)
      .query({ companyName: "Acme Agro", productName: "Zinc Sulphate", category: "fertilizers" })
      .set(auth(companyToken()));
    expect(res.status).toBe(403);
  });
});
