const mockGateway = require("./payments/mockGateway");
const razorpayGateway = require("./payments/razorpayGateway");

/* ─────────────────────────────────────────────────────────────────────────────
 * 💳 GATEWAY SELECTOR
 *
 * This file used to BE the mock. It is now the seam the mock was always meant
 * to be swapped at: it picks an adapter once, at boot, and re-exports the same
 * contract either way. services/shopPaymentService.js is unchanged in shape —
 * it still calls createSession / verify / refund and has no idea who answers.
 *
 * HOW THE CHOICE IS MADE:
 *   1. PAYMENT_GATEWAY=mock|razorpay      — explicit override, wins outright
 *   2. RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET both set → Razorpay
 *   3. otherwise                          → mock
 *
 * Rule 2 is the important one: adding the keys to .env is the ENTIRE
 * integration step. There is no code change, no feature flag to remember and no
 * second place to keep in sync. Remove the keys and the mock comes back, which
 * is what makes a developer's machine (and CI, and the test suite) work with no
 * credentials at all.
 *
 * WHY DECIDE ONCE, AT BOOT, rather than per request: a gateway that changes
 * identity mid-flight would let a session be opened by one provider and
 * verified by another. Fixing the choice at startup makes that impossible, and
 * the boot log says plainly which one is live.
 *
 * TEST vs LIVE is not decided here. It is whichever Razorpay key is in .env —
 * see razorpayGateway.mode().
 * ───────────────────────────────────────────────────────────────────────────── */

function pick() {
  const override = String(process.env.PAYMENT_GATEWAY || "").trim().toLowerCase();

  if (override === "mock") return mockGateway;
  if (override === "razorpay") {
    if (!razorpayGateway.isConfigured()) {
      // Failing loudly beats silently taking mock money in production.
      // eslint-disable-next-line no-console
      console.error(
        "❌ PAYMENT_GATEWAY=razorpay but RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are missing."
      );
      process.exit(1);
    }
    return razorpayGateway;
  }

  return razorpayGateway.isConfigured() ? razorpayGateway : mockGateway;
}

const active = pick();

// One line at boot so nobody has to guess which gateway a running server is on.
// The key id is publishable; the secret is never touched here.
if (active === razorpayGateway) {
  // eslint-disable-next-line no-console
  console.log(
    `💳 Payments: Razorpay (${razorpayGateway.mode()} mode, key ${process.env.RAZORPAY_KEY_ID})`
  );
} else {
  // eslint-disable-next-line no-console
  console.warn(
    "⚠️  Payments: MOCK gateway — no money moves. Set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET to use Razorpay."
  );
}

/** True while the mock is in charge. Guards the mock-only endpoint. */
const isMock = active === mockGateway;

module.exports = {
  PROVIDER: active.PROVIDER,
  SESSION_TTL_MS: active.SESSION_TTL_MS,
  isMock,

  // Shared contract — identical signatures on both adapters.
  publicConfig: (...a) => active.publicConfig(...a),
  createSession: (...a) => active.createSession(...a),
  verify: (...a) => active.verify(...a),
  /* 🔔 Webhook authenticity. The mock has no webhook (nothing calls it), so it
     returns false — which makes the webhook route reject everything rather
     than accept anything while the mock is active. Failing closed is the only
     safe default for an endpoint the whole internet can reach. */
  verifyWebhook: (...a) => (active.verifyWebhook ? active.verifyWebhook(...a) : false),
  webhookConfigured: () => (active.webhookConfigured ? active.webhookConfigured() : false),
  fetchPayment: (...a) => active.fetchPayment(...a),
  refund: (...a) => active.refund(...a),

  /**
   * ⛔ MOCK ONLY. Undefined when Razorpay is active — a real gateway is asked
   *    for its verdict, never told what it should be. shopPaymentService checks
   *    `isMock` before ever reaching for this.
   */
  authorize: isMock ? mockGateway.authorize : undefined,
};