const mongoose = require("mongoose");
const Order = require("../model/Order/Order");
const Customer = require("../model/Sales/Customer");
const Consumer = require("../model/Shop/Consumer");
const Seller = require("../model/Seller/Seller");
const Product = require("../model/Company/productModel");
const catalog = require("./shopCatalogService");
const customerService = require("./customerService");
const tax = require("./taxService");
const { nextSeq } = require("./counterService");

/**
 * Storefront (customer-shop) checkout + order history.
 *
 * A single cart may contain listings from several sellers, so checkout SPLITS
 * the cart into one Order per seller (Amazon/Flipkart style). Each order is
 * created under that seller's owner scope (ownerType "seller", ownerId), with
 * salesChannel "website" and status "pending" — it lands in the seller's
 * existing outbound-orders queue for them to accept and fulfil. We do NOT
 * reserve FEFO stock at checkout (that is the seller's accept step); this keeps
 * checkout from failing on a listing whose lot inventory isn't synced yet.
 *
 * For each (consumer, seller) pair we upsert a Sales/Customer CRM record so the
 * seller sees a real customer with contact + shipping details.
 */

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Gapless website order number per seller: WEB-<sellerSeq>. */
async function nextWebOrderNumber(sellerId) {
  const seq = await nextSeq(sellerId, "web-order");
  return `WEB-${String(seq).padStart(5, "0")}`;
}

/** Find-or-create the seller-scoped Customer for this consumer (dedup on phone,
 * else email, else create a phone-less record). Keeps the shipping address fresh. */
async function upsertSellerCustomer(sellerId, consumer, shipAddr) {
  const ownerType = "seller";
  const ownerId = sellerId;
  const phone = consumer.phone || shipAddr?.phone;

  let customer = null;
  if (phone) customer = await Customer.findOne({ ownerType, ownerId, phone });
  if (!customer && consumer.email) customer = await Customer.findOne({ ownerType, ownerId, email: consumer.email });

  const crmAddress = shipAddr
    ? [{
        label: shipAddr.label || "Shipping",
        line1: [shipAddr.line1, shipAddr.line2].filter(Boolean).join(", "),
        city: shipAddr.city,
        district: shipAddr.district,
        state: shipAddr.state,
        stateCode: shipAddr.stateCode,
        pincode: shipAddr.pincode,
        isDefault: true,
      }]
    : [];

  if (customer) {
    if (crmAddress.length) customer.addresses = crmAddress;
    customer.email = customer.email || consumer.email;
    await customer.save();
    return customer;
  }

  // Reuse the shared customer service so the seller's CUST-#### numbering stays
  // consistent with customers they create themselves (key "cust-seller").
  return customerService.createCustomer(
    { ownerType, ownerId },
    {
      name: shipAddr?.fullName || consumer.name,
      type: "retail",
      phone,
      email: consumer.email,
      addresses: crmAddress,
    }
  );
}

/** Compute priced/taxed line items for one seller's slice of the cart. */
function buildLines(cartItems, resolved) {
  const lines = [];
  let totalUnits = 0, totalAmount = 0;
  for (const ci of cartItems) {
    const r = resolved.get(String(ci.listingId));
    if (!r) throw httpErr("A product in your cart is no longer available", 409);
    const qty = Math.max(1, Number(ci.qty) || 1);
    // Only published + in-stock products may be ordered.
    if (!(r.availableStock > 0)) throw httpErr(`"${r.name}" is out of stock`, 409);
    if (qty > r.availableStock) throw httpErr(`Only ${r.availableStock} unit(s) of "${r.name}" are available`, 409);
    const price = r.price;
    // The customer total is price × qty ONLY — the marketplace price (MRP) is
    // treated as tax-inclusive, so no GST is ADDED on top. This keeps cart,
    // checkout, order-success and order-history totals identical. We record the
    // gstRate/hsn on the line (informational, zero added amounts) so the seller
    // can still show an inclusive-GST breakup on their own invoice.
    const taxable = qty * price;
    totalUnits += qty;
    totalAmount += taxable;
    lines.push({
      productId: r.productId,
      // 🛒 Keep the listing on the line so "Buy it again" can resolve a real,
      //    purchasable listing later (a product may be sold by many sellers).
      listingId: r.listingId,
      name: r.name,
      // 🖼️ what the shopper actually saw when they bought it
      image: r.image || null,
      qty,
      price,
      taxes: { hsnCode: r.hsnCode, gstRate: r.gstPercentage || 0, taxable, cgst: 0, sgst: 0, igst: 0 },
      allocations: [],
    });
  }
  // totalTax is 0 for storefront orders: nothing is added to what the customer pays.
  return { lines, totalUnits, totalAmount, totalTax: 0 };
}

/**
 * Place order(s) from a cart.
 * @param {string} consumerId
 * @param {object} body { items:[{listingId, qty}], shippingAddressId?, shippingAddress?, paymentMode }
 * @returns {Promise<Array>} the created orders
 */
async function checkout(consumerId, { items = [], shippingAddressId, shippingAddress } = {}) {
  if (!Array.isArray(items) || !items.length) throw httpErr("Your cart is empty");

  const consumer = await Consumer.findById(consumerId);
  if (!consumer) throw httpErr("Account not found", 404);

  // Resolve the shipping address: an existing saved address id, an inline
  // address, or the consumer's default.
  let shipAddr = null;
  if (shippingAddressId) {
    shipAddr = consumer.addresses.id(shippingAddressId);
    if (!shipAddr) throw httpErr("Selected address not found", 404);
    shipAddr = shipAddr.toObject();
  } else if (shippingAddress && (shippingAddress.line1 || shippingAddress.pincode)) {
    shipAddr = shippingAddress;
  } else {
    const def = consumer.addresses.find((a) => a.isDefault) || consumer.addresses[0];
    shipAddr = def ? def.toObject() : null;
  }
  if (!shipAddr || !shipAddr.line1 || !shipAddr.pincode) {
    throw httpErr("A shipping address (with pincode) is required");
  }

  // Trust the server for prices/sellers — never the client.
  const resolved = await catalog.resolveForCheckout(items.map((i) => i.listingId));
  if (!resolved.size) throw httpErr("None of the products in your cart are available", 409);

  // Group cart items by seller.
  const bySeller = new Map();
  for (const ci of items) {
    const r = resolved.get(String(ci.listingId));
    if (!r) throw httpErr("A product in your cart is no longer available", 409);
    if (!bySeller.has(r.sellerId)) bySeller.set(r.sellerId, []);
    bySeller.get(r.sellerId).push(ci);
  }

  const orderShipAddress = {
    label: shipAddr.label,
    name: shipAddr.fullName || consumer.name,
    phone: shipAddr.phone || consumer.phone,
    line1: shipAddr.line1,
    line2: shipAddr.line2,
    city: shipAddr.city,
    district: shipAddr.district,
    state: shipAddr.state,
    stateCode: shipAddr.stateCode,
    pincode: shipAddr.pincode,
  };

  const created = [];
  for (const [sellerId, cartItems] of bySeller) {
    const customer = await upsertSellerCustomer(sellerId, consumer, shipAddr);
    const { lines, totalUnits, totalAmount, totalTax } = buildLines(cartItems, resolved);
    const orderNumber = await nextWebOrderNumber(sellerId);

    const order = await Order.create({
      ownerType: "seller",
      ownerId: new mongoose.Types.ObjectId(sellerId),
      orderNumber,
      consumerId: consumer._id,
      customerId: customer._id,
      customerName: customer.name,
      shippingAddress: orderShipAddress,
      billingAddress: orderShipAddress,
      items: lines,
      totalUnits,
      totalAmount: tax.round2(totalAmount),
      totalTax: tax.round2(totalTax),
      channel: "online",
      salesChannel: "website",
      payment: { mode: "cod", status: "pending" },
      status: "pending",
    });
    created.push(order);
  }

  return created;
}

/* An Order stores ownerId (the seller's _id) but never the seller's NAME, so
   every shopper-facing order screen used to say nothing about who they bought
   from. Resolve it here, in ONE batched query, and attach it as `sellerName`.
   Purely additive: existing consumers of these functions ignore the extra key. */
async function attachSellerNames(orders) {
  if (!orders.length) return orders;
  const ids = [...new Set(orders.map((o) => String(o.ownerId)).filter(Boolean))];
  const sellers = await Seller.find({ _id: { $in: ids } })
    .select("sellerInfo.businessName contact.ownerName")
    .lean();
  const nameById = new Map(
    sellers.map((sl) => [
      String(sl._id),
      sl.sellerInfo?.businessName || sl.contact?.ownerName || "Khetify seller",
    ])
  );
  for (const o of orders) {
    o.sellerName = nameById.get(String(o.ownerId)) || "Khetify seller";
  }
  return orders;
}

/* Orders placed BEFORE items[].image existed have no picture on the line. Rather
   than showing them as a blank grey box forever, look the image up from the
   Product — in ONE batched query for the whole page, never per row.

   New orders skip this entirely (their line already carries the snapshot), so
   this quietly becomes a no-op as the old orders age out. */
async function attachLineImages(orders) {
  const needed = new Set();
  for (const o of orders) {
    for (const line of o.items || []) {
      if (!line.image && line.productId) needed.add(String(line.productId));
    }
  }
  if (!needed.size) return orders;

  const products = await Product.find({ _id: { $in: [...needed] } })
    .select("productImages")
    .lean();
  const imageById = new Map(
    products.map((p) => [String(p._id), p.productImages?.[0] || null])
  );

  for (const o of orders) {
    for (const line of o.items || []) {
      if (!line.image && line.productId) {
        line.image = imageById.get(String(line.productId)) || null;
      }
    }
  }
  return orders;
}

/** A shopper's own orders, most recent first. */
async function listOrders(consumerId) {
  const orders = await Order.find({ consumerId }).sort({ placedAt: -1 }).limit(200).lean();
  await attachSellerNames(orders);
  return attachLineImages(orders);
}

/** One of the shopper's orders (ownership enforced by consumerId). */
async function getOrder(consumerId, orderId) {
  if (!mongoose.isValidObjectId(orderId)) throw httpErr("Order not found", 404);
  const order = await Order.findOne({ _id: orderId, consumerId }).lean();
  if (!order) throw httpErr("Order not found", 404);
  const [withName] = await attachSellerNames([order]);
  const [withImages] = await attachLineImages([withName]);
  return withImages;
}

/**
 * 🛒 Let a shopper cancel their OWN order.
 *
 * ONLY while status === "pending". That is not a arbitrary restriction — it is
 * the exact window in which cancelling is safe:
 *
 *   pending    → the seller has not accepted yet, NO stock is reserved and no
 *                FEFO allocations exist. Cancelling is a pure status flip.
 *   confirmed+ → the seller has reserved stock against this order (allocations
 *                are written on confirm). Cancelling here would have to release
 *                that inventory, which is the seller's flow, not the shopper's.
 *
 * So past "pending" we refuse and tell the shopper to contact the seller, rather
 * than silently leaving reserved stock stranded.
 *
 * Ownership is enforced by consumerId — a shopper can never cancel anyone
 * else's order, even with a guessed id.
 */
async function cancelOrder(consumerId, orderId, reason) {
  if (!mongoose.isValidObjectId(orderId)) throw httpErr("Order not found", 404);

  const order = await Order.findOne({ _id: orderId, consumerId });
  if (!order) throw httpErr("Order not found", 404);

  if (order.status === "cancelled") throw httpErr("This order is already cancelled", 409);
  if (order.status !== "pending") {
    throw httpErr(
      `This order is already ${order.status} and can no longer be cancelled online. Please contact the seller.`,
      409
    );
  }

  order.status = "cancelled";
  order.cancelledAt = new Date();
  // Store the shopper's cancellation reason (trimmed + capped).
  if (reason) order.cancelReason = String(reason).trim().slice(0, 200);
  await order.save();

  const [withName] = await attachSellerNames([order.toObject()]);
  return withName;
}

/* ── Consumer saved addresses ── */

async function listAddresses(consumerId) {
  const c = await Consumer.findById(consumerId).select("addresses");
  if (!c) throw httpErr("Account not found", 404);
  return c.addresses;
}

async function addAddress(consumerId, addr) {
  const c = await Consumer.findById(consumerId);
  if (!c) throw httpErr("Account not found", 404);
  if (!addr || !addr.line1 || !addr.pincode) throw httpErr("Address line and pincode are required");
  // First address (or an explicit default) becomes the default.
  const makeDefault = addr.isDefault || c.addresses.length === 0;
  if (makeDefault) c.addresses.forEach((a) => (a.isDefault = false));
  c.addresses.push({ ...addr, isDefault: makeDefault });
  await c.save();
  return c.addresses;
}

async function deleteAddress(consumerId, addressId) {
  const c = await Consumer.findById(consumerId);
  if (!c) throw httpErr("Account not found", 404);
  const addr = c.addresses.id(addressId);
  if (!addr) throw httpErr("Address not found", 404);
  const wasDefault = addr.isDefault;
  addr.deleteOne();
  if (wasDefault && c.addresses.length) c.addresses[0].isDefault = true;
  await c.save();
  return c.addresses;
}

/* ── 👤 PROFILE: address editing (new) ── */

// Only these keys may ever be written from the client. Whitelisting (rather
// than spreading req.body) keeps `_id` and `isDefault` out of the patch —
// isDefault is handled explicitly below so the "exactly one default" invariant
// can't be broken by sending isDefault:true on two addresses.
const ADDRESS_FIELDS = [
  "label", "fullName", "phone", "line1", "line2",
  "city", "district", "state", "stateCode", "pincode",
];

/**
 * Edit one of the shopper's saved addresses in place.
 * @param {object} patch any subset of ADDRESS_FIELDS, plus optional isDefault:true
 */
async function updateAddress(consumerId, addressId, patch = {}) {
  const c = await Consumer.findById(consumerId);
  if (!c) throw httpErr("Account not found", 404);
  const addr = c.addresses.id(addressId);
  if (!addr) throw httpErr("Address not found", 404);

  // Validate the RESULT of the merge, not just the patch — so clearing line1
  // by sending line1:"" is rejected, same as addAddress() requires.
  const merged = { ...addr.toObject(), ...patch };
  if (!merged.line1 || !merged.pincode) throw httpErr("Address line and pincode are required");

  for (const key of ADDRESS_FIELDS) {
    if (patch[key] !== undefined) addr[key] = patch[key];
  }

  // Promoting to default here is a convenience so the UI can "save + make
  // default" in one call. Demotion is never implicit — an address is only
  // un-defaulted by another one being promoted.
  if (patch.isDefault === true) {
    c.addresses.forEach((a) => (a.isDefault = false));
    addr.isDefault = true;
  }

  await c.save();
  return c.addresses;
}

/** Promote one address to be the default; all others are demoted. */
async function setDefaultAddress(consumerId, addressId) {
  const c = await Consumer.findById(consumerId);
  if (!c) throw httpErr("Account not found", 404);
  const addr = c.addresses.id(addressId);
  if (!addr) throw httpErr("Address not found", 404);

  c.addresses.forEach((a) => (a.isDefault = false));
  addr.isDefault = true;

  await c.save();
  return c.addresses;
}

module.exports = {
  checkout,
  listOrders,
  getOrder,
  cancelOrder, // 🛒 STOREFRONT
  listAddresses,
  addAddress,
  updateAddress, // 👤 PROFILE
  setDefaultAddress, // 👤 PROFILE
  deleteAddress,
};