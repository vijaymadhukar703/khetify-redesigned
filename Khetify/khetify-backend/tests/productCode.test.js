const mongoose = require("mongoose");
const Product = require("../model/Company/productModel");
const {
  buildPrefix,
  generateUniqueProductCode,
  __resetIssuedCodes,
} = require("../services/productCodeService");
const { getAllProducts, updateProduct } = require("../controller/Company/productController");

const CODE_RE = /^[A-Z]{3}\d{3}$/;

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

// The service remembers codes it just handed out (so concurrent creates can't
// collide). That memory survives the per-test database reset, so clear it too.
beforeEach(() => __resetIssuedCodes());

describe("buildPrefix", () => {
  test("takes the first 3 alphabetic characters, uppercased", () => {
    expect(buildPrefix("Premium Basmati Rice")).toBe("PRE");
    expect(buildPrefix("Urea Fertilizer")).toBe("URE");
  });

  test("ignores spaces, digits and special characters", () => {
    expect(buildPrefix("  10-26-26 NPK Mix")).toBe("NPK");
    expect(buildPrefix("z@n#c sulphate")).toBe("ZNC");
  });

  test("pads short names and falls back when there are no letters", () => {
    expect(buildPrefix("Zn")).toBe("ZNX");
    expect(buildPrefix("12-32-16")).toBe("PRD");
    expect(buildPrefix("")).toBe("PRD");
  });
});

describe("generateUniqueProductCode", () => {
  test("returns PREFIX + 3 digits", async () => {
    const code = await generateUniqueProductCode("Premium Basmati Rice", { Model: Product });
    expect(code).toMatch(CODE_RE);
    expect(code.slice(0, 3)).toBe("PRE");
  });

  test("never returns a code that already exists", async () => {
    const companyId = new mongoose.Types.ObjectId();
    // Fill 999 of the 1000 "URE___" slots, leaving exactly one free.
    const free = "URE777";
    const rows = [];
    for (let n = 0; n < 1000; n++) {
      const code = `URE${String(n).padStart(3, "0")}`;
      if (code !== free) rows.push({ companyId, productName: "Urea", product_code: code });
    }
    await Product.insertMany(rows);

    const code = await generateUniqueProductCode("Urea Fertilizer", { Model: Product });
    expect(code).toBe(free);
  });

  test("honours codes reserved in-process but not yet persisted", async () => {
    const reserved = new Set();
    for (let i = 0; i < 20; i++) {
      const code = await generateUniqueProductCode("Urea", { Model: Product, reserved });
      expect(reserved.has(code)).toBe(false);
      reserved.add(code);
    }
    expect(reserved.size).toBe(20);
  });
});

describe("Product model", () => {
  test("assigns a product_code automatically on create", async () => {
    const p = await Product.create({
      companyId: new mongoose.Types.ObjectId(),
      productName: "Premium Basmati Rice",
    });
    expect(p.product_code).toMatch(CODE_RE);
    expect(p.product_code.slice(0, 3)).toBe("PRE");
  });

  test("codes are unique across many products with the same name", async () => {
    const companyId = new mongoose.Types.ObjectId();
    const made = await Promise.all(
      Array.from({ length: 25 }, () => Product.create({ companyId, productName: "Urea Fertilizer" })),
    );
    const codes = made.map((p) => p.product_code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("saving an existing product does NOT change its code", async () => {
    const p = await Product.create({
      companyId: new mongoose.Types.ObjectId(),
      productName: "Urea Fertilizer",
    });
    const original = p.product_code;
    p.productName = "Renamed Product";
    p.mrp = 500;
    await p.save();
    expect(p.product_code).toBe(original);
  });
});

describe("product controller", () => {
  test("search matches product code as well as product name", async () => {
    const companyId = new mongoose.Types.ObjectId();
    const rice = await Product.create({ companyId, productName: "Premium Basmati Rice" });
    await Product.create({ companyId, productName: "Urea Fertilizer" });

    const res = mockRes();
    await getAllProducts({ user: { companyId }, query: { search: rice.product_code } }, res);

    expect(res.body.count).toBe(1);
    expect(res.body.data[0].product_code).toBe(rice.product_code);
  });

  test("search input with regex metacharacters is treated literally", async () => {
    const companyId = new mongoose.Types.ObjectId();
    await Product.create({ companyId, productName: "Urea Fertilizer" });

    const res = mockRes();
    await getAllProducts({ user: { companyId }, query: { search: "Urea (" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(0);
  });

  test("update cannot change the product code, even if the client sends one", async () => {
    const companyId = new mongoose.Types.ObjectId();
    const p = await Product.create({ companyId, productName: "Urea Fertilizer" });

    const res = mockRes();
    await updateProduct(
      {
        params: { productId: String(p._id) },
        body: { productName: "Urea Gold", product_code: "HAK999" },
        files: [],
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.productName).toBe("Urea Gold");
    expect(res.body.data.product_code).toBe(p.product_code);
  });

  test("update backfills a code for a legacy product that has none", async () => {
    const companyId = new mongoose.Types.ObjectId();
    const p = await Product.create({ companyId, productName: "Legacy Item" });
    // Simulate a pre-migration row by stripping the code straight in the driver.
    await Product.collection.updateOne({ _id: p._id }, { $unset: { product_code: "" } });

    const res = mockRes();
    await updateProduct(
      { params: { productId: String(p._id) }, body: { mrp: "120" }, files: [] },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.product_code).toMatch(CODE_RE);
    expect(res.body.data.product_code.slice(0, 3)).toBe("LEG");
  });
});
