const mongoose = require("mongoose");
const SellerListing = require("../model/PC/SellerListing");
const Product = require("../model/Company/productModel");
const pc = require("../controller/Seller/sellerPcController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const asSeller = (sellerId, body = {}) => ({
  user: { sellerId, principalType: "seller", role: "seller_admin", id: sellerId },
  body, params: {}, query: {},
});

let sellerA, sellerB, companyId;

const ownProduct = (sellerId, name = "My Own Product") =>
  Product.create({ productName: name, ownerType: "seller", sellerId, companyId: null });

const companyProduct = (name = "Company Product") =>
  Product.create({ productName: name, companyId });

beforeEach(() => {
  sellerA = new mongoose.Types.ObjectId();
  sellerB = new mongoose.Types.ObjectId();
  companyId = new mongoose.Types.ObjectId();
});

describe("SellerListing accepts a seller-own listing and still demands a company otherwise", () => {
  test("a company listing with NO companyId is still rejected", async () => {
    await expect(
      SellerListing.create({ sellerId: sellerA, productId: new mongoose.Types.ObjectId() })
    ).rejects.toBeTruthy();
  });

  test("a seller-own listing saves with companyId null", async () => {
    const l = await SellerListing.create({
      sellerId: sellerA, productId: new mongoose.Types.ObjectId(), ownerType: "seller",
    });
    expect(l.companyId).toBeNull();
    expect(l.ownerType).toBe("seller");
  });

  test("one listing per (seller, product) still holds for seller-own rows", async () => {
    // The unique index is (sellerId, companyId, productId) and is NOT changed by
    // this work. This proves the claim that it keeps doing its job with
    // companyId null: Mongo indexes null as a real value, so two seller-own
    // listings of the same product still collide. syncIndexes() is needed
    // because mongoose builds indexes in the background and the in-memory
    // server would otherwise race the assertion.
    await SellerListing.syncIndexes();
    const productId = new mongoose.Types.ObjectId();
    await SellerListing.create({ sellerId: sellerA, productId, ownerType: "seller" });
    await expect(
      SellerListing.create({ sellerId: sellerA, productId, ownerType: "seller" })
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe("publishListing — the seller's OWN product", () => {
  test("publishes with no companyId, marked ownerType seller", async () => {
    const p = await ownProduct(sellerA);
    const res = mockRes();
    await pc.publishListing(asSeller(sellerA, { productId: String(p._id), price: 250 }), res);

    expect(res.statusCode).toBe(201);
    expect(res.body.data.ownerType).toBe("seller");
    expect(res.body.data.companyId).toBeNull();
    expect(res.body.data.price).toBe(250);
    expect(res.body.data.status).toBe("published");
  });

  test("re-publishing updates the SAME listing rather than making a second", async () => {
    const p = await ownProduct(sellerA);
    await pc.publishListing(asSeller(sellerA, { productId: String(p._id), price: 100 }), mockRes());
    const res = mockRes();
    await pc.publishListing(asSeller(sellerA, { productId: String(p._id), price: 175 }), res);

    expect(res.statusCode).toBe(201);
    expect(await SellerListing.countDocuments({ sellerId: sellerA })).toBe(1);
    expect(res.body.data.price).toBe(175);
  });

  test("ANOTHER seller's own product is refused (403) — the check the PC gate no longer makes", async () => {
    const p = await ownProduct(sellerB, "Someone Else's");
    const res = mockRes();
    await pc.publishListing(asSeller(sellerA, { productId: String(p._id), price: 10 }), res);

    expect(res.statusCode).toBe(403);
    expect(await SellerListing.countDocuments({})).toBe(0);
  });

  test("a COMPANY product cannot be published by omitting companyId", async () => {
    const p = await companyProduct();
    const res = mockRes();
    await pc.publishListing(asSeller(sellerA, { productId: String(p._id), price: 10 }), res);

    expect(res.statusCode).toBe(403);
    expect(await SellerListing.countDocuments({})).toBe(0);
  });

  test("publishing an own product does NOT hijack an existing company listing of the same product", async () => {
    // A seller-own publish must not resolve to { sellerId, productId } and
    // convert a company listing that happens to share the product id.
    const p = await ownProduct(sellerA);
    const companyListing = await SellerListing.create({
      sellerId: sellerA, companyId, productId: p._id, price: 999,
    });

    const res = mockRes();
    await pc.publishListing(asSeller(sellerA, { productId: String(p._id), price: 111 }), res);
    expect(res.statusCode).toBe(201);

    const untouched = await SellerListing.findById(companyListing._id).lean();
    expect(untouched.price).toBe(999);
    expect(String(untouched.companyId)).toBe(String(companyId));
    expect(await SellerListing.countDocuments({ sellerId: sellerA })).toBe(2);
  });
});

describe("the COMPANY publish path is unchanged", () => {
  test("publishing with a companyId writes a company listing exactly as before", async () => {
    const p = await companyProduct();
    const res = mockRes();
    await pc.publishListing(
      asSeller(sellerA, { companyId: String(companyId), productId: String(p._id), price: 500 }),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(String(res.body.data.companyId)).toBe(String(companyId));
    expect(res.body.data.ownerType).toBe("company");
    expect(res.body.data.price).toBe(500);
  });

  test("legacy listings written WITHOUT ownerType are still found by the listings query", async () => {
    // The reading rule: never filter on ownerType "company". Simulate a
    // pre-existing row by stripping the field the way an old document looks.
    const p = await companyProduct();
    const l = await SellerListing.create({ sellerId: sellerA, companyId, productId: p._id, price: 5 });
    await SellerListing.collection.updateOne({ _id: l._id }, { $unset: { ownerType: "" } });

    const res = mockRes();
    await pc.listListings(asSeller(sellerA), res);
    expect(res.body.count).toBe(1);
    expect(String(res.body.data[0]._id)).toBe(String(l._id));
  });
});

describe("unpublish still works for a seller-own listing", () => {
  test("pulls the listing without any PC or company involved", async () => {
    const p = await ownProduct(sellerA);
    const pubRes = mockRes();
    await pc.publishListing(asSeller(sellerA, { productId: String(p._id), price: 20 }), pubRes);

    const res = mockRes();
    const req = asSeller(sellerA);
    req.params = { id: String(pubRes.body.data._id) };
    await pc.unpublishListing(req, res);

    expect(res.body.data.status).toBe("unpublished");
  });
});
