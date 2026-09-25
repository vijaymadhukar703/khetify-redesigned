const mongoose = require("mongoose");
const Product = require("../model/Company/productModel");
const SellerListing = require("../model/PC/SellerListing");
const shop = require("../services/shopCatalogService");
const pc = require("../controller/Seller/sellerPcController");
const ctrl = require("../controller/Seller/sellerMyProductController");
const { createMyProductBody, updateMyProductBody } = require("../validators/sellerMyProductValidators");

/**
 * SEVERAL PHOTOS PER VARIANT — seller products only.
 *
 * The company flow writes the single `image` field and is not touched. These
 * tests pin both halves: the new `images` array works, AND every shape that
 * existed before (a lone `image`, no image at all) still behaves as it did.
 */

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const asSeller = (sellerId, body = {}, files = undefined) => ({
  user: { sellerId, principalType: "seller", role: "seller_admin", id: sellerId },
  body, files, params: {}, query: {},
});
const file = (filename) => ({ filename });

/** Run applyUploadedImages the way the route does. */
function normalise(body, files) {
  const req = asSeller(new mongoose.Types.ObjectId(), body, files);
  let err = null;
  ctrl.applyUploadedImages(req, mockRes(), (e) => { err = e || null; });
  expect(err).toBeNull();
  return req.body;
}

let sellerId, companyId;
beforeEach(() => {
  sellerId = new mongoose.Types.ObjectId();
  companyId = new mongoose.Types.ObjectId();
});

describe("each variant's files land on the right variant", () => {
  test("red gets 3 photos and yellow 2, from ONE combined upload list", async () => {
    const body = normalise(
      {
        variants: JSON.stringify([
          { label: "red", sku: "R", images: [], imageIndexes: [0, 1, 2] },
          { label: "yellow", sku: "Y", images: [], imageIndexes: [3, 4] },
        ]),
      },
      {
        variantImages: [
          file("r1.jpg"), file("r2.jpg"), file("r3.jpg"),
          file("y1.jpg"), file("y2.jpg"),
        ],
      }
    );

    expect(body.variants[0].images).toEqual([
      "uploads/products/r1.jpg", "uploads/products/r2.jpg", "uploads/products/r3.jpg",
    ]);
    expect(body.variants[1].images).toEqual([
      "uploads/products/y1.jpg", "uploads/products/y2.jpg",
    ]);
    // images[0] mirrors into `image` so the storefront's colour swatch — which
    // reads the single field — keeps working for a multi-image variant.
    expect(body.variants[0].image).toBe("uploads/products/r1.jpg");
    expect(body.variants[1].image).toBe("uploads/products/y1.jpg");
    // Transport artefacts never reach the document.
    expect(body.variants[0].imageIndexes).toBeUndefined();
  });

  test("editing ADDS to a variant rather than replacing its photos", () => {
    const body = normalise(
      {
        variants: JSON.stringify([
          { label: "red", sku: "R", images: ["uploads/products/old1.jpg", "uploads/products/old2.jpg"], imageIndexes: [0] },
        ]),
      },
      { variantImages: [file("new.jpg")] }
    );

    expect(body.variants[0].images).toEqual([
      "uploads/products/old1.jpg", "uploads/products/old2.jpg", "uploads/products/new.jpg",
    ]);
  });

  test("a photo the seller removed is simply not re-sent, so it drops off", () => {
    const body = normalise(
      { variants: JSON.stringify([{ label: "red", sku: "R", images: ["uploads/products/keep.jpg"], imageIndexes: [] }]) },
      {}
    );
    expect(body.variants[0].images).toEqual(["uploads/products/keep.jpg"]);
  });

  test("removing ALL of them leaves an empty list", () => {
    const body = normalise(
      { variants: JSON.stringify([{ label: "red", sku: "R", images: [], imageIndexes: [] }]) },
      {}
    );
    expect(body.variants[0].images).toEqual([]);
  });
});

describe("everything that existed before still behaves the same", () => {
  test("a single `imageIndex` (older client shape) still works", () => {
    const body = normalise(
      { variants: JSON.stringify([{ label: "red", sku: "R", imageIndex: 0 }]) },
      { variantImages: [file("one.jpg")] }
    );
    expect(body.variants[0].image).toBe("uploads/products/one.jpg");
    expect(body.variants[0].images).toEqual(["uploads/products/one.jpg"]);
  });

  test("a variant carrying only the legacy single `image` keeps it", () => {
    const body = normalise(
      { variants: JSON.stringify([{ label: "red", sku: "R", image: "uploads/products/legacy.jpg" }]) },
      {}
    );
    expect(body.variants[0].image).toBe("uploads/products/legacy.jpg");
    // Surfaced through the new array too, so the page has one thing to read.
    expect(body.variants[0].images).toEqual(["uploads/products/legacy.jpg"]);
  });

  test("a variant with no photo at all stays without one", () => {
    const body = normalise({ variants: JSON.stringify([{ label: "red", sku: "R" }]) }, {});
    expect(body.variants[0].image).toBeUndefined();
    expect(body.variants[0].images).toEqual([]);
  });
});

describe("the storefront receives the gallery", () => {
  test("create → publish → each variant's images arrive in order", async () => {
    const normalised = normalise(
      {
        productName: "Urea Test", mrp: "100", shelfLifeDays: "365",
        variants: JSON.stringify([
          { label: "red", attributes: { Color: "red" }, sku: "UREA-RED", images: [], imageIndexes: [0, 1, 2] },
          { label: "yellow", attributes: { Color: "yellow" }, sku: "UREA-YELLO", images: [], imageIndexes: [3, 4] },
        ]),
      },
      { variantImages: [file("r1.jpg"), file("r2.jpg"), file("r3.jpg"), file("y1.jpg"), file("y2.jpg")] }
    );

    const cRes = mockRes();
    await ctrl.createMyProduct(asSeller(sellerId, createMyProductBody.parse(normalised)), cRes);
    expect(cRes.statusCode).toBe(201);

    const pRes = mockRes();
    await pc.publishListing(asSeller(sellerId, { productId: String(cRes.body.data._id), price: 250 }), pRes);

    const shown = await shop.getProduct(String(pRes.body.data._id));
    const red = shown.variants.find((v) => v.sku === "UREA-RED");
    const yellow = shown.variants.find((v) => v.sku === "UREA-YELLO");
    expect(red.images).toHaveLength(3);
    expect(yellow.images).toHaveLength(2);
    expect(red.images[0]).toBe("uploads/products/r1.jpg");
    // The swatch field is still populated, so the colour chips keep their photo.
    expect(red.image).toBe("uploads/products/r1.jpg");
  });

  test("an edit swaps one variant's gallery and leaves the other's alone", async () => {
    const created = normalise(
      {
        productName: "Urea Test", mrp: "100", shelfLifeDays: "365",
        variants: JSON.stringify([
          { label: "red", sku: "R", images: [], imageIndexes: [0, 1] },
          { label: "yellow", sku: "Y", images: [], imageIndexes: [2] },
        ]),
      },
      { variantImages: [file("r1.jpg"), file("r2.jpg"), file("y1.jpg")] }
    );
    const cRes = mockRes();
    await ctrl.createMyProduct(asSeller(sellerId, createMyProductBody.parse(created)), cRes);

    const edited = normalise(
      {
        variants: JSON.stringify([
          // red drops r2 and adds a new one
          { label: "red", sku: "R", images: ["uploads/products/r1.jpg"], imageIndexes: [0] },
          // yellow untouched
          { label: "yellow", sku: "Y", images: ["uploads/products/y1.jpg"], imageIndexes: [] },
        ]),
      },
      { variantImages: [file("r3.jpg")] }
    );
    const req = asSeller(sellerId, updateMyProductBody.parse(edited));
    req.params = { id: String(cRes.body.data._id) };
    const uRes = mockRes();
    await ctrl.updateMyProduct(req, uRes);

    const [red, yellow] = uRes.body.data.variants;
    expect(red.images).toEqual(["uploads/products/r1.jpg", "uploads/products/r3.jpg"]);
    expect(yellow.images).toEqual(["uploads/products/y1.jpg"]);
  });
});

describe("company products are untouched", () => {
  test("a company variant with only `image` reports images: [] and keeps its photo", async () => {
    // Written the way controller/Company/productController.js writes it — the
    // storefront must show it exactly as before, with no gallery.
    const product = await Product.create({
      productName: "Soil Testing Kit", companyId, productStatus: "active", mrp: 500,
      variants: [
        { label: "red", attributes: { Color: "red" }, sku: "SOIL-RED", mrp: 500, image: "uploads/products/soil-red.jpg" },
      ],
    });
    const listing = await SellerListing.create({
      sellerId, companyId, productId: product._id, price: 500, status: "published",
    });

    const shown = await shop.getProduct(String(listing._id));
    expect(shown.variants[0].image).toBe("uploads/products/soil-red.jpg");
    // Empty, so the page falls back to the single image: one photo, no arrows.
    expect(shown.variants[0].images).toEqual([]);
  });

  test("the variantSchema still accepts a company variant with no `images` key", async () => {
    const product = await Product.create({
      productName: "Legacy", companyId, productStatus: "active",
      variants: [{ label: "old", image: "uploads/products/old.jpg" }],
    });
    // The new field defaults rather than failing validation, so no migration is
    // needed for the existing catalogue.
    expect(product.variants[0].images).toEqual([]);
    expect(product.variants[0].image).toBe("uploads/products/old.jpg");
  });
});
