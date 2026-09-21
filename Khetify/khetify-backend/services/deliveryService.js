/**
 * deliveryService.js
 *
 * Bridges Khetify's warehouse stock with the logistics ServiceArea (branch)
 * pincode mapping to determine delivery eligibility.
 *
 * HOW IT WORKS
 * ─────────────
 * 1. Customer has a pincode → find which logistics branch serves that pincode
 *    (query khetify_logistics.serviceareas).
 * 2. That branch has a list of pincodes it delivers to.
 * 3. Seller warehouse has address.pincode — if it falls in the branch's pincode
 *    list, stock from that warehouse IS deliverable to the customer.
 * 4. listProducts / getProduct tag each listing with deliveryEligible: true/false.
 * 5. Checkout enforces: a non-deliverable listing cannot be ordered.
 *
 * SINGLE MONGOOSE CONNECTION
 * Both khetify and khetify_logistics live on the same mongod (127.0.0.1:27017).
 * We use mongoose.createConnection() for the logistics DB so the main Khetify
 * connection is untouched. The logistics ServiceArea model is registered only
 * on that secondary connection.
 */

const mongoose = require("mongoose");
const Inventory  = require("../model/Inventory/Inventory");
const Warehouse  = require("../model/Warehouse/Warehouse");

// ── LOGISTICS DB CONNECTION ───────────────────────────────────────────────────
// Lazily created once, reused. Matches the logistics-backend .env MONGO_URI.
const LOGISTICS_URI =
  process.env.LOGISTICS_MONGO_URI ||
  "mongodb://localhost:27017/khetify_logistics";

let _logisticsConn = null;
let _ServiceArea   = null;

function getServiceAreaModel() {
  if (_ServiceArea) return _ServiceArea;

  if (!_logisticsConn) {
    _logisticsConn = mongoose.createConnection(LOGISTICS_URI);
    _logisticsConn.on("error", (err) =>
      console.error("[deliveryService] logistics DB error:", err.message)
    );
  }

  // Minimal schema — we only read pincodes and basic fields.
  const schema = new mongoose.Schema(
    {
      name:         String,
      code:         String,
      mainPincode:  String,
      pincodes:     [String],
      city:         String,
      state:        String,
      baseFreight:  { type: Number, default: 45 },
      codEnabled:   { type: Boolean, default: true },
      active:       { type: Boolean, default: true },
    },
    { collection: "serviceareas", timestamps: true }
  );

  _ServiceArea = _logisticsConn.model("LogisticsServiceArea", schema);
  return _ServiceArea;
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Given a customer pincode, return the set of warehouse pincodes that can
 * deliver to it (i.e. the branch's full pincode list).
 *
 * Returns null when no branch serves the pincode — caller treats every
 * warehouse as non-deliverable in that case.
 */
async function getDeliverableWarehousePincodes(customerPincode) {
  if (!customerPincode || !/^[1-9]\d{5}$/.test(String(customerPincode).trim())) {
    return null;
  }

  try {
    const SA = getServiceAreaModel();
    const area = await SA.findOne({
      active:   true,
      pincodes: String(customerPincode).trim(),
    })
      .sort({ createdAt: 1 })
      .lean();

    if (!area) return null;

    // The branch's full serviceable pincode set (includes mainPincode by
    // convention, see logistics ServiceArea model comments).
    return new Set(area.pincodes.map(String));
  } catch (err) {
    console.error("[deliveryService] getDeliverableWarehousePincodes:", err.message);
    return null; // fail open for listing; checkout enforces separately
  }
}

/**
 * Build a Map<sellerId:productId → deliveryEligible: boolean> for a set of
 * (sellerId, productId) pairs, given the set of deliverable warehouse pincodes.
 *
 * A listing is eligible when at least ONE inventory row for that (seller,
 * product) pair belongs to a warehouse whose pincode is in deliverablePincodes.
 *
 * @param {Array<{sellerId, productId}>} pairs
 * @param {Set<string>|null} deliverablePincodes  null = no branch found
 * @returns {Map<string, boolean>}  key = `${sellerId}:${productId}`
 */
async function buildDeliveryEligibilityMap(pairs, deliverablePincodes) {
  const map = new Map();
  if (!pairs.length) return map;

  // No branch → every product is non-deliverable.
  if (!deliverablePincodes) {
    for (const p of pairs) {
      map.set(`${p.sellerId}:${p.productId}`, false);
    }
    return map;
  }

  // Pull inventory rows for all pairs, joining with their warehouse pincode.
  const sellerIds  = [...new Set(pairs.map((p) => String(p.sellerId)))].map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  const productIds = [...new Set(pairs.map((p) => String(p.productId)))].map(
    (id) => new mongoose.Types.ObjectId(id)
  );

  const rows = await Inventory.aggregate([
    {
      $match: {
        ownerType: "seller",
        ownerId:   { $in: sellerIds },
        productId: { $in: productIds },
        warehouseId: { $ne: null },
      },
    },
    {
      $lookup: {
        from:         Warehouse.collection.name,
        localField:   "warehouseId",
        foreignField: "_id",
        as:           "_wh",
      },
    },
    { $unwind: { path: "$_wh", preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: { ownerId: "$ownerId", productId: "$productId" },
        pincodes: { $addToSet: "$_wh.address.pincode" },
      },
    },
  ]);

  // Index: key → set of warehouse pincodes
  const invPincodes = new Map();
  for (const r of rows) {
    invPincodes.set(
      `${r._id.ownerId}:${r._id.productId}`,
      new Set((r.pincodes || []).filter(Boolean).map(String))
    );
  }

  for (const p of pairs) {
    const key     = `${p.sellerId}:${p.productId}`;
    const wPins   = invPincodes.get(key) || new Set();
    // Eligible if any warehouse pincode is in the branch's serviceable set.
    const eligible = [...wPins].some((pin) => deliverablePincodes.has(pin));
    map.set(key, eligible);
  }

  return map;
}

/**
 * Single-listing eligibility check — used by getProduct() and checkout.
 *
 * Returns true | false | null (null = no pincode provided, caller decides).
 */
async function isListingDeliverable(sellerId, productId, customerPincode) {
  if (!customerPincode) return null;

  const deliverablePins = await getDeliverableWarehousePincodes(customerPincode);
  if (!deliverablePins) return false;

  const map = await buildDeliveryEligibilityMap(
    [{ sellerId, productId }],
    deliverablePins
  );
  return map.get(`${sellerId}:${productId}`) ?? false;
}

/**
 * Serviceability check for a pincode — wraps the logistics query.
 * Used by the frontend "Check delivery" API.
 */
async function checkPincodeServiceability(customerPincode) {
  if (!customerPincode || !/^[1-9]\d{5}$/.test(String(customerPincode).trim())) {
    return { serviceable: false, reason: "invalid_pincode" };
  }

  try {
    const SA   = getServiceAreaModel();
    const area = await SA.findOne({
      active:   true,
      pincodes: String(customerPincode).trim(),
    }).lean();

    if (!area) {
      return { serviceable: false, reason: "pincode_not_served" };
    }

    return {
      serviceable:     true,
      pincode:         String(customerPincode).trim(),
      serviceAreaId:   String(area._id),
      serviceAreaName: area.name,
      serviceAreaCode: area.code,
      codAvailable:    area.codEnabled,
      freightAmount:   area.baseFreight,
    };
  } catch (err) {
    console.error("[deliveryService] checkPincodeServiceability:", err.message);
    return { serviceable: false, reason: "service_unavailable" };
  }
}

module.exports = {
  getDeliverableWarehousePincodes,
  buildDeliveryEligibilityMap,
  isListingDeliverable,
  checkPincodeServiceability,
};