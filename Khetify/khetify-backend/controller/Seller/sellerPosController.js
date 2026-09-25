const Order = require("../../model/Order/Order");
const Customer = require("../../model/Sales/Customer");
const salesService = require("../../services/salesService");
const orderCtrl = require("./sellerOrderController");
const Seller = require("../../model/Seller/Seller");
const { posInvoicePdf } = require("../../services/posInvoicePdfService");

// Same helper shapes the seller order controller uses.
const sellerOwner = (req) => ({ ownerType: "seller", ownerId: req.user.sellerId });
const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
const httpErr = (message, status = 400) => Object.assign(new Error(message), { status });

const PAYMENT_MODES = ["cash", "upi", "card", "credit"];

/**
 * Resolve the buyer for a counter sale.
 *
 * Deliberately talks to the Customer model directly rather than going through
 * sellerCustomerController / the customers route: that path runs
 * enforceLimit("customers"), which would let a busy counter hit the free-plan
 * cap in the middle of a sale.
 */
async function resolveCustomerId({ customerId, customerPhone, customerName }, sellerId) {
  // salesService already scopes customerId to this seller, so don't re-query.
  if (customerId) return customerId;

  const phone = String(customerPhone || "").trim();
  if (!phone) return undefined; // walk-in with no record — a valid sale.

  const scope = { ownerType: "seller", ownerId: sellerId, phone };

  // Reuse an existing buyer as-is; never overwrite the stored name from a bill.
  const existing = await Customer.findOne(scope);
  if (existing) return existing._id;

  try {
    const created = await Customer.create({ ...scope, name: String(customerName || "").trim() || "Walk-in customer" });
    return created._id;
  } catch (err) {
    // Customer.js has a UNIQUE sparse index on (ownerType, ownerId, phone), so
    // two fast bills on the same phone can race here. Re-read instead of 500ing.
    if (err && (err.code === 11000 || err.code === "11000")) {
      const raced = await Customer.findOne(scope);
      if (raced) return raced._id;
    }
    throw err;
  }
}

/**
 * POST /api/seller/pos/sale — counter sale.
 *
 * The goods are handed over across the counter, so there is no ship step: the
 * bill is saved and the stock leaves in the same request. That is the normal
 * two-stage seller flow run back to back — salesService.createOrder reserves
 * FEFO, then sellerOrderController.shipOrder commits those allocations. Both
 * are composed here, never reimplemented.
 */
exports.createSale = async (req, res) => {
  try {
    const { items = [], payment = {}, customerId, customerPhone, customerName } = req.body || {};

    // Validate up front — never silently coerce a bad line into a bill.
    if (!Array.isArray(items) || items.length === 0) throw httpErr("At least one line item is required");
    for (const it of items) {
      const qty = Number(it?.qty);
      if (!Number.isFinite(qty) || qty <= 0) throw httpErr("Each line needs a positive qty");
    }
    if (!PAYMENT_MODES.includes(payment.mode)) {
      throw httpErr(`Payment mode must be one of: ${PAYMENT_MODES.join(", ")}`);
    }

    const buyerId = await resolveCustomerId({ customerId, customerPhone, customerName }, req.user.sellerId);

    const order = await salesService.createOrder(sellerOwner(req), {
      customerId: buyerId,
      items,
      salesChannel: "pos",
      channel: "offline",
      // "credit" means the buyer has not paid yet; every other mode is settled
      // at the counter. Both values are already in the Order payment enum.
      payment: { mode: payment.mode, status: payment.mode === "credit" ? "pending" : "paid" },
      performedBy: req.user.sellerId,
    });

    try {
      await orderCtrl.shipOrder(order._id, req.user.sellerId);
    } catch (err) {
      // createOrder already RESERVED stock. If the commit fails we must not
      // leave a phantom order sitting on that reservation: reserved-but-never-
      // committed stock is invisible to the seller and is the worst failure
      // mode here. Cancel the order, then rethrow the original error.
      order.status = "cancelled";
      await order.save();
      throw err;
    }

    // Re-read so the response carries the COMMITTED status and allocations
    // rather than the pre-ship snapshot held in `order`.
    const saved = await Order.findById(order._id);
    res.status(201).json({ success: true, message: `Sale complete · ${saved.invoiceNumber}`, data: saved });
  } catch (err) { fail(res, err); }
};

/**
 * GET /api/seller/pos/sale/:id/invoice — the GST tax invoice for a POS sale.
 *
 * Read-only: every figure is taken from the saved Order, nothing is
 * recomputed and nothing is written back.
 */
exports.invoicePdf = async (req, res) => {
  try {
    // Scoped to THIS seller — without the owner filter any seller could pull
    // another seller's invoice by guessing an id.
    const order = await Order.findOne({ _id: req.params.id, ownerType: "seller", ownerId: req.user.sellerId })
      .populate("items.productId", "productName hsnCode")
      .populate("customerId", "name phone");
    if (!order) throw httpErr("Sale not found", 404);

    const seller = await Seller.findById(req.user.sellerId).select("sellerInfo contact verification");
    const pdf = await posInvoicePdf(order, seller);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="invoice-${order.invoiceNumber || order._id}.pdf"`);
    res.send(pdf);
  } catch (err) { fail(res, err); }
};
