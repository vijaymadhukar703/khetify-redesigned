const mongoose = require("mongoose");
const Subscription = require("../model/Company/Subscription/Subscription");
const Warehouse = require("../model/Warehouse/Warehouse");
const Customer = require("../model/Sales/Customer");
const { changePlan, ensureSubscription, featuresForSub } = require("../services/subscriptionService");
const { FEATURES } = require("../config/plans");
const loadSubscription = require("../middlewares/loadSubscription");
const requireFeature = require("../middlewares/requireFeature");
const enforceLimit = require("../middlewares/enforceLimit");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
// Run loadSubscription then a gate; resolve with the final res + whether next() fired.
async function runChain(user, gate) {
  const req = { user };
  const res = mockRes();
  let loaded = false;
  await new Promise((r) => loadSubscription(req, res, () => { loaded = true; r(); }));
  if (!loaded) return { res, passed: false };
  let passed = false;
  await new Promise((r) => { const ret = gate(req, res, () => { passed = true; r(); }); if (ret && ret.then) ret.then(() => r()); else if (passed) r(); else r(); });
  return { res, passed };
}

let companyId, sellerId;
beforeEach(() => {
  companyId = new mongoose.Types.ObjectId();
  sellerId = new mongoose.Types.ObjectId();
});
const sellerUser = () => ({ sellerId, principalType: "seller", role: "seller_admin" });
const companyUser = () => ({ companyId, id: companyId, role: "company_admin" });

describe("seller subscription defaults + plan resolution", () => {
  test("a new seller gets a FREE seller plan with seller limits", async () => {
    const sub = await ensureSubscription({ ownerType: "seller", ownerId: sellerId });
    expect(sub.ownerType).toBe("seller");
    expect(sub.plan).toBe("free");
    expect(sub.limits.warehouses).toBe(1);
    expect(sub.limits.customers).toBe(50);
    const feats = featuresForSub(sub);
    expect(feats).not.toContain(FEATURES.SUPPLY_WORKFLOW); // paid — requesting supply
    expect(feats).not.toContain(FEATURES.INVENTORY_VIEW); // paid
    expect(feats).not.toContain(FEATURES.UNIT_LABELS);     // paid
  });

  test("upgrading the seller to pro unlocks inventory + labels and unlimited warehouses", async () => {
    await changePlan({ ownerType: "seller", ownerId: sellerId }, "pro");
    const sub = await Subscription.findOne({ ownerType: "seller", ownerId: sellerId });
    const feats = featuresForSub(sub);
    expect(feats).toContain(FEATURES.INVENTORY_VIEW);
    expect(feats).toContain(FEATURES.UNIT_LABELS);
    expect(feats).toContain(FEATURES.MULTI_WAREHOUSE);
    // Infinity may round-trip to null in Mongo — either is treated as unlimited.
    expect([Infinity, null]).toContain(sub.limits.warehouses ?? null);
  });
});

describe("free seller is gated; pro seller is not", () => {
  test("INVENTORY_VIEW + UNIT_LABELS are locked on free, unlocked on pro", async () => {
    // free
    const invFree = await runChain(sellerUser(), requireFeature(FEATURES.INVENTORY_VIEW));
    expect(invFree.passed).toBe(false);
    expect(invFree.res.statusCode).toBe(403);
    const lblFree = await runChain(sellerUser(), requireFeature(FEATURES.UNIT_LABELS));
    expect(lblFree.passed).toBe(false);

    // pro
    await changePlan({ ownerType: "seller", ownerId: sellerId }, "pro");
    const invPro = await runChain(sellerUser(), requireFeature(FEATURES.INVENTORY_VIEW));
    expect(invPro.passed).toBe(true);
    const lblPro = await runChain(sellerUser(), requireFeature(FEATURES.UNIT_LABELS));
    expect(lblPro.passed).toBe(true);
  });

  test("SUPPLY_WORKFLOW (requesting supply) is locked on free, unlocked on pro, locked again when pro lapses", async () => {
    const free = await runChain(sellerUser(), requireFeature(FEATURES.SUPPLY_WORKFLOW));
    expect(free.passed).toBe(false);
    expect(free.res.statusCode).toBe(403);
    expect(free.res.body.code).toBe("UPGRADE_REQUIRED");

    await changePlan({ ownerType: "seller", ownerId: sellerId }, "pro");
    const pro = await runChain(sellerUser(), requireFeature(FEATURES.SUPPLY_WORKFLOW));
    expect(pro.passed).toBe(true);

    // A pro subscription whose period has ended is treated as free again.
    await Subscription.updateOne({ ownerType: "seller", ownerId: sellerId }, { $set: { currentPeriodEnd: new Date(Date.now() - 86400000) } });
    const lapsed = await runChain(sellerUser(), requireFeature(FEATURES.SUPPLY_WORKFLOW));
    expect(lapsed.passed).toBe(false);
    expect(lapsed.res.statusCode).toBe(403);
  });

  test("warehouses limit: free allows 1, blocks the 2nd; pro is unlimited", async () => {
    await Warehouse.create({ sellerId, name: "WH1" });
    const blocked = await runChain(sellerUser(), enforceLimit("warehouses"));
    expect(blocked.passed).toBe(false);
    expect(blocked.res.statusCode).toBe(403);
    expect(blocked.res.body.code).toBe("LIMIT_REACHED");

    await changePlan({ ownerType: "seller", ownerId: sellerId }, "pro");
    const ok = await runChain(sellerUser(), enforceLimit("warehouses"));
    expect(ok.passed).toBe(true);
  });

  test("customers limit blocks once the free cap (50) is reached", async () => {
    // Cheaper than inserting 50: assert below cap passes, at cap blocks.
    const one = await runChain(sellerUser(), enforceLimit("customers"));
    expect(one.passed).toBe(true); // 0 < 50

    const docs = Array.from({ length: 50 }, (_, i) => ({ ownerType: "seller", ownerId: sellerId, name: `C${i}`, phone: `7000000${String(i).padStart(3, "0")}` }));
    await Customer.insertMany(docs);
    const capped = await runChain(sellerUser(), enforceLimit("customers"));
    expect(capped.passed).toBe(false);
    expect(capped.res.statusCode).toBe(403);
  });
});

describe("company subscription is unchanged", () => {
  test("a company still defaults to the company free plan + company limits", async () => {
    const sub = await ensureSubscription({ ownerType: "company", ownerId: companyId });
    expect(sub.ownerType).toBe("company");
    expect(sub.plan).toBe("free");
    expect(sub.limits.products).toBe(50); // company limit (sellers have no products limit)
    expect(featuresForSub(sub)).not.toContain(FEATURES.INVENTORY_VIEW);
  });

  test("a company warehouse limit gate counts company warehouses (free = 1)", async () => {
    await Warehouse.create({ companyId, name: "Co WH1" });
    const blocked = await runChain(companyUser(), enforceLimit("warehouses"));
    expect(blocked.passed).toBe(false);
    expect(blocked.res.statusCode).toBe(403);
  });
});
