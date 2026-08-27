const crypto = require("crypto");

/* ─────────────────────────────────────────────────────────────────────────────
 * 💳 PAYMENT GATEWAY ADAPTER — MOCK IMPLEMENTATION
 *
 * ★★ THIS IS THE ONLY FILE THAT PRETENDS. ★★
 *
 * IT IS NO LONGER THE DEFAULT. services/shopPaymentGateway.js picks an adapter
 * at boot: Razorpay when RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET are set, this
 * one otherwise. Keeping it means a developer with no keys (and CI, and the
 * test suite) can still walk the entire online-payment flow end to end.
 *
 * Everything else in the online-payment flow (the ShopPayment model, the
 * payment service, the controller, the routes, the checkout page, the payment
 * screen) is real, permanent code. When a real gateway is integrated, the ONLY
 * file that must change is this one — plus, optionally, a webhook route that
 * calls the same shopPaymentService.markPaid() this adapter's verdict feeds.
 *
 * THE CONTRACT (keep these four functions and their shapes):
 *
 *   createSession({ amount, currency, receipt, customer })
 *       → { provider, gatewayOrderId, expiresAt, checkout }
 *     Razorpay  : POST /v1/orders                → order.id
 *     Stripe    : PaymentIntents.create()        → intent.id / client_secret
 *     PayU      : txnid + hash generation        → txnid
 *
 *   authorize({ gatewayOrderId, amount, instrument, outcome })
 *       → { success, gatewayPaymentId, signature, failureReason }
 *     Real gateways NEVER call this — the shopper authorises on the gateway's
 *     own page/SDK and the result comes back to verify(). It exists only so the
 *     mock has something to stand in for the shopper tapping "Pay".
 *     ⛔ DELETE THIS FUNCTION when a real gateway lands.
 *
 *   verify({ gatewayOrderId, gatewayPaymentId, signature })
 *       → boolean
 *     Razorpay  : HMAC-SHA256(order_id|payment_id, KEY_SECRET) === signature
 *     Stripe    : constructEvent() with the webhook secret
 *     This is the security boundary. It stays.
 *
 *   refund({ gatewayPaymentId, amount }) → { refundId, status }
 *     Stubbed for the return/refund flow that comes later.
 *
 * NO CREDENTIALS ARE READ HERE. No key, no secret, no env var, no network call.
 * The "signature" below is an HMAC over a constant dev string purely so the
 * verify() code path is exercised end-to-end and does not have to be written
 * from scratch later.
 * ───────────────────────────────────────────────────────────────────────────── */

const PROVIDER = "mock";

// NOT a credential. A fixed dev-only string so the mock's HMAC round-trip works
// offline. A real integration reads its secret from process.env instead.
const MOCK_SIGNING_STRING = "khetify-mock-gateway-not-a-secret";

// How long a payment session stays valid. Razorpay orders live ~15 min by
// default; matching that keeps the abandoned-session behaviour familiar.
const SESSION_TTL_MS = 15 * 60 * 1000;

/** Gateway-ish opaque id: prefix + 20 hex chars (Razorpay-shaped: order_XXXX). */
function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

/**
 * Open a payment session for an amount.
 *
 * @param {object} p
 * @param {number} p.amount    rupees (the caller's own currency unit)
 * @param {string} [p.currency]
 * @param {string} [p.receipt] our own reference (the ShopPayment _id)
 * @param {object} [p.customer] { name, email, phone } — prefill only
 */
/* async purely to match razorpayGateway's contract — a real gateway must make a
   network call here, so every caller awaits. */
async function createSession({ amount, currency = "INR", receipt, customer } = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("A payment session needs a positive amount");
  }

  return {
    provider: PROVIDER,
    gatewayOrderId: makeId("mockorder"),
    // Gateways bill in the minor unit (paise). Carried so the switch to a real
    // one is not the moment someone discovers a ×100 bug.
    amountInMinorUnit: Math.round(value * 100),
    currency,
    receipt: receipt ? String(receipt) : undefined,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    // What the client needs to open the payment UI. A real adapter puts the
    // publishable key / client_secret / hosted URL here — never the secret.
    checkout: {
      mode: "mock",
      prefill: {
        name: customer?.name || "",
        email: customer?.email || "",
        contact: customer?.phone || "",
      },
      // The instruments the mock screen offers. A real gateway returns its own.
      instruments: ["upi", "card", "netbanking", "wallet"],
    },
  };
}

/**
 * ⛔ MOCK ONLY — stands in for the shopper authorising on the gateway's screen.
 *
 * @param {object} p
 * @param {"success"|"failure"} [p.outcome] which verdict to simulate
 * @returns {{success:boolean, gatewayPaymentId?:string, signature?:string, failureReason?:string}}
 */
function authorize({ gatewayOrderId, instrument, outcome = "success" } = {}) {
  if (!gatewayOrderId) throw new Error("gatewayOrderId is required");

  if (outcome === "failure") {
    return {
      success: false,
      // Deliberately generic, the way a real decline reads to a shopper.
      failureReason: "The payment was declined by your bank. No money was deducted.",
    };
  }

  const gatewayPaymentId = makeId("mockpay");
  return {
    success: true,
    gatewayPaymentId,
    signature: sign(gatewayOrderId, gatewayPaymentId),
    instrument: instrument || "upi",
  };
}

/** HMAC over "<orderId>|<paymentId>" — the exact shape Razorpay uses. */
function sign(gatewayOrderId, gatewayPaymentId) {
  return crypto
    .createHmac("sha256", MOCK_SIGNING_STRING)
    .update(`${gatewayOrderId}|${gatewayPaymentId}`)
    .digest("hex");
}

/**
 * The security boundary: prove the success we were handed came from the
 * gateway and was not fabricated by the client. Kept as-is for a real gateway —
 * only the secret and the digest algorithm change.
 */
function verify({ gatewayOrderId, gatewayPaymentId, signature } = {}) {
  if (!gatewayOrderId || !gatewayPaymentId || !signature) return false;
  const expected = sign(gatewayOrderId, gatewayPaymentId);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  // Constant-time compare — a plain === leaks the signature one byte at a time.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Stub for the (not-yet-built) return/refund flow. */
function refund({ gatewayPaymentId, amount } = {}) {
  if (!gatewayPaymentId) throw new Error("gatewayPaymentId is required");
  return {
    provider: PROVIDER,
    refundId: makeId("mockrfnd"),
    gatewayPaymentId,
    amount: Number(amount) || 0,
    status: "processed",
  };
}

/** What the browser may know. The mock has no key to publish. */
function publicConfig() {
  return { provider: PROVIDER, isMock: true, mode: "mock", keyId: null };
}

/**
 * Real gateways can be re-read after the fact ("did this payment really settle,
 * and for how much?"). The mock has no such source of truth, so it returns null
 * and shopPaymentService skips the cross-check.
 */
async function fetchPayment() {
  return null;
}

module.exports = {
  PROVIDER,
  publicConfig,
  fetchPayment,
  SESSION_TTL_MS,
  createSession,
  authorize, // ⛔ mock only — delete when a real gateway is integrated
  verify,
  refund,
};