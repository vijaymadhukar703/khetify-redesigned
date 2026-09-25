const mongoose = require("mongoose");

/**
 * 💳 STOREFRONT PAYMENT ATTEMPT (customer-shop only).
 *
 * WHY A SEPARATE MODEL (and not model/Payment/Payment.js):
 *   model/Payment/Payment.js is the COMPANY SUBSCRIPTION billing ledger
 *   (companyId + plan + invoiceNo). It has nothing to do with a shopper paying
 *   for a basket, and bending it to carry both would couple two unrelated
 *   money flows into one collection. This model is scoped to the storefront,
 *   exactly like model/Shop/Consumer.js is.
 *
 * WHAT IT IS FOR:
 *   An "online payment" is not a single instant — it is an ATTEMPT that can be
 *   created, retried, abandoned, fail, or succeed. The Order document only ever
 *   records the FINAL outcome (order.payment.mode / .status / .txnRef), so the
 *   attempt itself needs its own row.
 *
 * THE ORDER-AFTER-PAYMENT RULE:
 *   Orders are NOT created when the shopper picks "Online Payment". They are
 *   created only after the gateway confirms the money, from `checkoutSnapshot`
 *   below — the server's own frozen copy of what was being bought. That is why
 *   the snapshot is stored here and never re-read from the client: nothing
 *   between "pay" and "order placed" can change the basket or the price.
 *
 *   Consequence: an unpaid online order never reaches the seller's queue, so
 *   the Seller / Warehouse modules see exactly what they saw before.
 *
 * REPLACING THE MOCK WITH A REAL GATEWAY:
 *   Only `provider`, `gatewayOrderId`, `gatewayPaymentId` and `gatewaySignature`
 *   speak the gateway's language, and they are deliberately generic names, not
 *   `razorpayOrderId`. Razorpay/Stripe/PayU all map onto these four fields, so
 *   integrating for real means changing services/shopPaymentGateway.js and
 *   NOTHING in this schema.
 */

const shopPaymentSchema = new mongoose.Schema(
  {
    // Who is paying. Every read is scoped by this — a shopper can never open,
    // complete or cancel someone else's payment, even with a guessed id.
    consumerId: { type: mongoose.Schema.Types.ObjectId, ref: "Consumer", required: true },

    // "online" is the only method that gets a row. COD never creates one: there
    // is no attempt to track, the money moves at the door.
    method: { type: String, enum: ["online"], default: "online" },

    // Which adapter handled it. "mock" today; "razorpay" / "stripe" / "payu"
    // later, written by the adapter itself, never hardcoded by a caller.
    provider: { type: String, default: "mock" },

    // Amount is computed SERVER-SIDE from the snapshot and is the amount the
    // orders will be created with. A client-sent amount is never trusted.
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },

    /**
     * created   → session opened, shopper is on the payment screen
     * processing→ handed to the gateway, awaiting its verdict
     * finalizing→ proven paid; orders are being created RIGHT NOW. A lock, not
     *             a resting state: the browser return leg and the webhook race
     *             each other routinely, and only the one that wins this claim
     *             may create orders. See shopPaymentService.finalizePaid().
     * paid      → gateway confirmed; orders have been created (see orderIds)
     * failed    → gateway declined; the shopper may retry the SAME payment
     * cancelled → shopper backed out
     * expired   → session aged out (expiresAt)
     */
    status: {
      type: String,
      enum: ["created", "processing", "finalizing", "paid", "failed", "cancelled", "expired"],
      default: "created",
    },

    // Gateway-side identifiers. Generic on purpose — see the header note.
    gatewayOrderId: { type: String },
    gatewayPaymentId: { type: String },
    gatewaySignature: { type: String },

    // What the shopper chose to pay WITH (upi | card | netbanking | wallet).
    // Informational only; the gateway owns the real instrument.
    instrument: { type: String },

    /**
     * The server's frozen copy of the checkout request:
     *   { items: [{ listingId, qty, variantId }], shippingAddressId | shippingAddress }
     * Orders are built from THIS, not from whatever the client posts back after
     * paying.
     */
    checkoutSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },

    // A read-only summary shown on the payment screen (seller-wise split +
    // totals) so the page never has to re-price the basket to render itself.
    quote: { type: mongoose.Schema.Types.Mixed, default: {} },

    // The orders this payment produced. Empty until status === "paid". Also
    // what makes completion IDEMPOTENT: a double-submit returns these instead
    // of charging and creating a second set of orders.
    orderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],

    attempts: { type: Number, default: 0 },
    failureReason: { type: String },
    paidAt: { type: Date },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

// A shopper's own payment history, most recent first.
shopPaymentSchema.index({ consumerId: 1, createdAt: -1 });
// Reconciliation lookups when a real gateway starts sending webhooks.
shopPaymentSchema.index({ gatewayOrderId: 1 });
shopPaymentSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("ShopPayment", shopPaymentSchema);