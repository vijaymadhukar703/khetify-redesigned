const paymentService = require("../../services/shopPaymentService");
// 🔔 Only for webhook signature verification — no gateway calls are made here.
const gateway = require("../../services/shopPaymentGateway");

/* ─────────────────────────────────────────────────────────────────────────────
 * 💳 /api/shop/payments/*  — storefront ONLINE payment (consumerAuth-scoped).
 *
 * Same response envelope as every other shop controller:
 *   { success, message?, data }
 * and the same `err.status || 500` mapping, so the frontend error handling that
 * already exists needs no special case.
 *
 * COD does not come through here at all — it goes straight to
 * POST /api/shop/checkout, exactly as it always did.
 *
 * WHICH GATEWAY answers these is decided by .env (Razorpay when its keys are
 * present, mock otherwise) — see services/shopPaymentGateway.js. The routes and
 * their shapes are identical either way; only `config` reports the difference.
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/shop/payments/config
 *
 * What the browser needs to open the gateway: the PUBLISHABLE key id and the
 * mode ("test" | "live" | "mock"). The secret is never part of this response —
 * it never leaves the server process at all.
 *
 * Serving the key from here rather than a VITE_ env var means there is ONE
 * place the key lives. A frontend build can never be pointing at a different
 * Razorpay account than the server verifying its signatures.
 */
exports.config = async (req, res) => {
  try {
    res.json({ success: true, data: paymentService.publicConfig() });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * POST /api/shop/payments/initiate
 * Body: { items:[{listingId, qty, variantId}], shippingAddressId? | shippingAddress? }
 *
 * Prices the basket, freezes it, opens a gateway session. Creates NO order.
 */
exports.initiate = async (req, res) => {
  try {
    const result = await paymentService.initiate(req.consumer.id, req.body);
    res.status(201).json({ success: true, message: "Payment session created", data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** GET /api/shop/payments/:paymentId — the shopper's own payment session. */
exports.getPayment = async (req, res) => {
  try {
    const payment = await paymentService.getPayment(req.consumer.id, req.params.paymentId);
    res.json({ success: true, data: payment });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * POST /api/shop/payments/:paymentId/verify
 * Body: { gatewayPaymentId, signature }
 *
 * The REAL return leg: the shopper has come back from Razorpay Checkout and the
 * browser is handing us what it was given. Both values are untrusted until the
 * service verifies the signature and re-reads the payment from Razorpay.
 *
 * Returns the SAME { orders } array POST /api/shop/checkout returns, so the
 * order-success screen is shared with COD.
 */
exports.verify = async (req, res) => {
  try {
    const { payment, orders } = await paymentService.verifyAndComplete(
      req.consumer.id,
      req.params.paymentId,
      { gatewayPaymentId: req.body?.gatewayPaymentId, signature: req.body?.signature }
    );
    res.json({
      success: true,
      message: orders.length > 1 ? `${orders.length} orders placed` : "Order placed",
      data: { payment, orders },
      count: orders.length,
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * POST /api/shop/payments/:paymentId/dismiss
 * The shopper closed the gateway window without paying. Reopens the session so
 * "Try again" works; nothing was charged and nothing was ordered.
 */
exports.dismiss = async (req, res) => {
  try {
    const payment = await paymentService.markDismissed(req.consumer.id, req.params.paymentId);
    res.json({ success: true, data: payment });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * POST /api/shop/payments/webhook
 *
 * 🔔 Razorpay calling US, server to server. NOT a customer route: there is no
 * consumerAuth, no session and no cookie — the whole internet can reach it. Its
 * only defence is the signature over the raw body, checked FIRST, before the
 * payload is looked at at all.
 *
 * ALWAYS ANSWER 200 ONCE THE SIGNATURE PASSES. Razorpay retries any non-2xx for
 * hours, so returning 500 because a product was out of stock would mean being
 * hammered for a problem retrying cannot fix. The payment row records what went
 * wrong; the HTTP response only says "received".
 */
exports.webhook = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    // req.rawBody is captured in Server.js for THIS route only — the parsed
    // req.body cannot be re-serialised to the exact bytes Razorpay signed.
    const ok = gateway.verifyWebhook(req.rawBody, signature);
    if (!ok) {
      // Deliberately terse. An attacker probing this endpoint learns nothing.
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    // Past this line the payload is genuinely Razorpay's.
    let result;
    try {
      result = await paymentService.handleWebhookEvent(req.body);
    } catch (err) {
      // Logged for reconciliation, then acknowledged — see the note above.
      // eslint-disable-next-line no-console
      console.error("🔔 Webhook handling failed:", err.message);
      return res.json({ success: true, handled: false });
    }

    res.json({ success: true, ...result });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("🔔 Webhook error:", err.message);
    res.status(400).json({ success: false });
  }
};

/**
 * POST /api/shop/payments/:paymentId/mock/complete
 * Body: { outcome: "success" | "failure", instrument?: "upi"|"card"|... }
 *
 * ⛔ MOCK-GATEWAY-ONLY ENDPOINT. The service REFUSES it outright whenever a
 *    real gateway is active, so it cannot be used to mint a paid order without
 *    paying. It stays because it is what lets the whole flow be walked on a
 *    machine with no Razorpay credentials at all.
 *
 * On success the orders are created and returned — the SAME array shape
 * POST /api/shop/checkout returns, so the order-success screen is shared.
 */
exports.completeMock = async (req, res) => {
  try {
    const { payment, orders } = await paymentService.completeMock(
      req.consumer.id,
      req.params.paymentId,
      { outcome: req.body?.outcome, instrument: req.body?.instrument }
    );
    res.json({
      success: true,
      message: orders.length > 1 ? `${orders.length} orders placed` : "Order placed",
      data: { payment, orders },
      count: orders.length,
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** POST /api/shop/payments/:paymentId/cancel — shopper backed out. */
exports.cancel = async (req, res) => {
  try {
    const payment = await paymentService.cancel(req.consumer.id, req.params.paymentId);
    res.json({ success: true, message: "Payment cancelled", data: payment });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};