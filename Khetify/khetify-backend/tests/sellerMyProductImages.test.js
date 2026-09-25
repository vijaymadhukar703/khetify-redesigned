const mongoose = require("mongoose");
const shop = require("../services/shopCatalogService");
const pc = require("../controller/Seller/sellerPcController");
const ctrl = require("../controller/Seller/sellerMyProductController");
const { createMyProductBody, updateMyProductBody } = require("../validators/sellerMyProductValidators");

/**
 * IMAGE UPLOAD for the seller's own product.
 *
 * `applyUploadedImages` is the middleware that sits between multer and the zod
 * validator on POST / and PUT /:id. These tests drive it with the exact shapes
 * multer produces, then push the result through the real validator and handler,
 * so the whole chain — files → relative paths → document → storefront — is
 * covered without needing an HTTP server.
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
// What multer hands over for one saved upload.
const file = (filename) => ({ filename, path: `C:\\\\app\\\\uploads\\\\products\\\\${filename}` });

/** Run the middleware the way the route does, then return the mutated body. */
function normalise(body, files) {
  const req = asSeller(new mongoose.Types.ObjectId(), body, files);
  let err = null;
  ctrl.applyUploadedImages(req, mockRes(), (e) => { err = e || null; });
  expect(err).toBeNull();
  return req.body;
}

let sellerId;
beforeEach(() => { sellerId = new mongoose.Types.ObjectId(); });

describe("uploaded files become URL-safe relative paths", () => {
  test("product images land as uploads/products/<filename>", () => {
    const body = normalise({ productName: "X" }, { productImages: [file("a.jpg"), file("b.png")] });
    // The company controller's exact shape. NOT file.path — that is an absolute
    // Windows path with backslashes and breaks every downstream URL builder.
    expect(body.productImages).toEqual(["uploads/products/a.jpg", "uploads/products/b.png"]);
  });

  test("a variant's imageIndex maps to its file and the index is dropped", () => {
    const body = normalise(
      {
        variants: JSON.stringify([
          { label: "red", sku: "R", imageIndex: 0 },
          { label: "yellow", sku: "Y", imageIndex: 1 },
        ]),
      },
      { variantImages: [file("red.jpg"), file("yellow.jpg")] }
    );
    // `images` (the multi-photo array) now rides alongside the single `image`,
    // which still holds images[0] for the storefront swatch — so this asserts
    // the fields rather than an exact object shape.
    expect(body.variants[0]).toMatchObject({ label: "red", sku: "R", image: "uploads/products/red.jpg" });
    expect(body.variants[0].images).toEqual(["uploads/products/red.jpg"]);
    expect(body.variants[1]).toMatchObject({ label: "yellow", sku: "Y", image: "uploads/products/yellow.jpg" });
    expect(body.variants[1].images).toEqual(["uploads/products/yellow.jpg"]);
    // imageIndex is a transport artefact and must never reach the document.
    expect(body.variants[0].imageIndex).toBeUndefined();
  });

  test("only the variants that HAVE a photo consume a file slot", () => {
    // Rows without a photo send no imageIndex, so index 0 belongs to the second
    // row here. Getting this wrong would put the wrong photo on the wrong colour.
    const body = normalise(
      {
        variants: JSON.stringify([
          { label: "red", sku: "R" },
          { label: "yellow", sku: "Y", imageIndex: 0 },
        ]),
      },
      { variantImages: [file("yellow.jpg")] }
    );
    expect(body.variants[0].image).toBeUndefined();
    expect(body.variants[1].image).toBe("uploads/products/yellow.jpg");
  });
});

describe("editing keeps what the user kept", () => {
  test("kept_images + new uploads merge, and kept_images never reaches the document", () => {
    const body = normalise(
      { kept_images: ["uploads/products/old.jpg"] },
      { productImages: [file("new.jpg")] }
    );
    expect(body.productImages).toEqual(["uploads/products/old.jpg", "uploads/products/new.jpg"]);
    expect(body.kept_images).toBeUndefined();
  });

  test("a removed image simply is not in kept_images, so it drops off", () => {
    const body = normalise({ kept_images: ["uploads/products/keep.jpg"] }, {});
    expect(body.productImages).toEqual(["uploads/products/keep.jpg"]);
  });

  test("one kept image arrives as a bare STRING and is still handled", () => {
    // Multipart sends a single repeated field as a string, not an array.
    const body = normalise({ kept_images: "uploads/products/only.jpg" }, {});
    expect(body.productImages).toEqual(["uploads/products/only.jpg"]);
  });

  test("a legacy absolute path is normalised to the uploads/ tail", () => {
    const body = normalise({ kept_images: ["C:\\app\\uploads\\products\\legacy.jpg"] }, {});
    expect(body.productImages).toEqual(["uploads/products/legacy.jpg"]);
  });

  test("an edit that sends NO images leaves the stored gallery alone", () => {
    // The key must be absent, not [] — an empty array would wipe the gallery.
    const body = normalise({ productName: "X" }, {});
    expect(body.productImages).toBeUndefined();
  });

  test("a variant keeps its existing photo when no new file is sent", () => {
    const body = normalise(
      { variants: JSON.stringify([{ label: "red", sku: "R", image: "uploads/products/old-red.jpg" }]) },
      {}
    );
    expect(body.variants[0].image).toBe("uploads/products/old-red.jpg");
  });

  test("unparseable variants are DROPPED, not allowed to clobber the stored value", () => {
    const body = normalise({ variants: "[object Object]" }, {});
    expect(body.variants).toBeUndefined();
  });
});

describe("the images reach the document and the storefront", () => {
  test("create → My Products list thumbnail → published storefront images", async () => {
    const normalised = normalise(
      {
        productName: "Urea Test",
        mrp: "100",
        shelfLifeDays: "365",
        variants: JSON.stringify([
          { label: "red", attributes: { Color: "red" }, sku: "UREA-RED", imageIndex: 0 },
          { label: "yellow", attributes: { Color: "yellow" }, sku: "UREA-YELLO", imageIndex: 1 },
        ]),
      },
      {
        productImages: [file("hero.jpg")],
        variantImages: [file("red.jpg"), file("yellow.jpg")],
      }
    );

    const cRes = mockRes();
    await ctrl.createMyProduct(asSeller(sellerId, createMyProductBody.parse(normalised)), cRes);
    expect(cRes.statusCode).toBe(201);
    expect(cRes.body.data.productImages).toEqual(["uploads/products/hero.jpg"]);

    // The My Products table reads productImages[0] for its thumbnail.
    const listRes = mockRes();
    await ctrl.listMyProducts(asSeller(sellerId, {}, undefined), listRes);
    expect(listRes.body.data[0].productImages[0]).toBe("uploads/products/hero.jpg");

    // Published → the storefront gets the gallery AND a photo per variant,
    // which is what turns the colour chips into photo swatches.
    const pRes = mockRes();
    await pc.publishListing(
      { user: { sellerId, principalType: "seller", role: "seller_admin", id: sellerId },
        body: { productId: String(cRes.body.data._id), price: 250 }, params: {}, query: {} },
      pRes
    );
    const shown = await shop.getProduct(String(pRes.body.data._id));
    expect(shown.images).toEqual(["uploads/products/hero.jpg"]);
    expect(shown.variants.map((v) => v.image)).toEqual([
      "uploads/products/red.jpg",
      "uploads/products/yellow.jpg",
    ]);
  });

  test("edit replaces one variant photo and leaves the other's alone", async () => {
    const created = normalise(
      {
        productName: "Urea Test", mrp: "100", shelfLifeDays: "365",
        variants: JSON.stringify([
          { label: "red", sku: "R", imageIndex: 0 },
          { label: "yellow", sku: "Y", imageIndex: 1 },
        ]),
      },
      { variantImages: [file("red.jpg"), file("yellow.jpg")] }
    );
    const cRes = mockRes();
    await ctrl.createMyProduct(asSeller(sellerId, createMyProductBody.parse(created)), cRes);
    const id = String(cRes.body.data._id);

    // Only "red" gets a new file; "yellow" re-sends the path it already had.
    const edited = normalise(
      {
        variants: JSON.stringify([
          { label: "red", sku: "R", imageIndex: 0 },
          { label: "yellow", sku: "Y", image: "uploads/products/yellow.jpg" },
        ]),
      },
      { variantImages: [file("red-v2.jpg")] }
    );
    const req = asSeller(sellerId, updateMyProductBody.parse(edited));
    req.params = { id };
    const uRes = mockRes();
    await ctrl.updateMyProduct(req, uRes);

    expect(uRes.statusCode).toBe(200);
    expect(uRes.body.data.variants.map((v) => v.image)).toEqual([
      "uploads/products/red-v2.jpg",
      "uploads/products/yellow.jpg",
    ]);
  });
});
