const crypto = require("crypto");

/* ─────────────────────────────────────────────────────────────────────────────
 * 💳 RAZORPAY GATEWAY ADAPTER (real — test or live, decided by the key)
 *
 * Implements the SAME contract as services/payments/mockGateway.js, so
 * shopPaymentService.js does not know or care which one is loaded:
 *
 *   createSession()  → opens a Razorpay Order          (POST /v1/orders)
 *   verify()         → HMAC signature check            (no network)
 *   fetchPayment()   → re-reads the payment            (GET  /v1/payments/:id)
 *   refund()         → refunds it                      (POST /v1/payments/:id/refund)
 *   publicConfig()   → what the browser may know       (key_id only)
 *
 * NO SDK DEPENDENCY, ON PURPOSE.
 *   Razorpay's REST API is four endpoints and HTTP Basic auth. Node 22 has
 *   global fetch, and the signature is a stdlib HMAC. Adding the `razorpay`
 *   package would mean a new dependency, a new lockfile entry and a new upgrade
 *   path for roughly forty lines of code we can read. If the SDK is ever
 *   wanted, only this file changes.
 *
 * CREDENTIALS COME FROM THE ENVIRONMENT AND NEVER LEAVE THIS PROCESS.
 *   RAZORPAY_KEY_ID     — publishable. Sent to the browser (it has to be).
 *   RAZORPAY_KEY_SECRET — NEVER sent anywhere. Used only to sign the Basic auth
 *                         header and to verify signatures, both server-side.
 *   Nothing here is logged: errors deliberately quote Razorpay's message and
 *   never the request headers.
 *
 * TEST vs LIVE is not a setting in this codebase — it is which key you put in
 * .env. `rzp_test_…` hits Razorpay's test mode (no real money, test cards);
 * `rzp_live_…` moves real money. publicConfig() reports which, so the UI can
 * show a test banner without a second flag to keep in sync.
 * ───────────────────────────────────────────────────────────────────────────── */

const PROVIDER = "razorpay";
const API_BASE = "https://api.razorpay.com/v1";

// Razorpay orders expire after ~15 min of inactivity on the checkout. Matching
// it keeps our own session-expiry behaviour honest rather than optimistic.
const SESSION_TTL_MS = 15 * 60 * 1000;

// A hung payment call must not hold a request open forever.
const TIMEOUT_MS = 20000;

function keyId() {
  return process.env.RAZORPAY_KEY_ID || "";
}
function keySecret() {
  return process.env.RAZORPAY_KEY_SECRET || "";
}

/** True when both halves of the key are present. The selector checks this. */
function isConfigured() {
  return Boolean(keyId() && keySecret());
}

/** "test" | "live", read off the key itself so it can never disagree. */
function mode() {
  return keyId().startsWith("rzp_live_") ? "live" : "test";
}

function authHeader() {
  return `Basic ${Buffer.from(`${keyId()}:${keySecret()}`).toString("base64")}`;
}

/**
 * One place for every Razorpay call: auth, timeout, JSON, and error shaping.
 *
 * Razorpay reports failures as { error: { code, description, reason } }. We
 * surface `description` because it is written for humans ("Order amount must be
 * at least INR 1.00"), and swallow everything else — a stack trace from a
 * payment provider is not something to hand a shopper.
 */
async function call(path, { method = "GET", body } = {}) {
  if (!isConfigured()) {
    throw new Error("Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)");
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Network down, DNS, or our own timeout — never the caller's fault.
    throw new Error(
      err?.name === "TimeoutError"
        ? "The payment provider did not respond in time. Please try again."
        : "Could not reach the payment provider. Please try again."
    );
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }

  if (!res.ok) {
    const description = json?.error?.description;
    throw new Error(description || `Payment provider error (HTTP ${res.status})`);
  }
  return json;
}

/**
 * Open a Razorpay Order for an amount.
 *
 * ⚠️ THE ×100. Razorpay bills in PAISE, our whole app prices in RUPEES. This
 *    conversion happens HERE and nowhere else, so there is exactly one line in
 *    the codebase that can get it wrong.
 *
 * @param {object} p
 * @param {number} p.amount    rupees
 * @param {string} [p.receipt] our ShopPayment _id (Razorpay caps this at 40 chars)
 */
async function createSession({ amount, currency = "INR", receipt, customer } = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("A payment session needs a positive amount");
  }

  const amountInMinorUnit = Math.round(value * 100);

  const order = await call("/orders", {
    method: "POST",
    body: {
      amount: amountInMinorUnit,
      currency,
      receipt: receipt ? String(receipt).slice(0, 40) : undefined,
      // Razorpay auto-captures when the account is set to. We ALSO capture
      // explicitly in fetchPayment()'s caller if a payment lands "authorized",
      // so money is never left merely held.
      payment_capture: 1,
      notes: { source: "khetify-storefront" },
    },
  });

  return {
    provider: PROVIDER,
    gatewayOrderId: order.id, // order_XXXXXXXX
    amountInMinorUnit,
    currency,
    receipt: order.receipt,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    // Everything the browser needs to open Razorpay Checkout. The SECRET is
    // conspicuously absent and must stay that way.
    checkout: {
      mode: PROVIDER,
      keyId: keyId(),
      orderId: order.id,
      amount: amountInMinorUnit,
      currency,
      name: "Khetify",
      description: "Order payment",
      prefill: {
        name: customer?.name || "",
        email: customer?.email || "",
        contact: customer?.phone || "",
      },
      theme: { color: "#EA2831" },
    },
  };
}

/**
 * THE SECURITY BOUNDARY.
 *
 * Razorpay Checkout hands the BROWSER a payment id and a signature, and the
 * browser hands them to us — so both are attacker-controlled until this check
 * passes. The signature is HMAC-SHA256("<order_id>|<payment_id>") keyed with
 * the secret, which only our server has. Without this, anyone could POST a
 * made-up payment id and get a free order.
 */
function verify({ gatewayOrderId, gatewayPaymentId, signature } = {}) {
  if (!gatewayOrderId || !gatewayPaymentId || !signature) return false;
  if (!isConfigured()) return false;

  const expected = crypto
    .createHmac("sha256", keySecret())
    .update(`${gatewayOrderId}|${gatewayPaymentId}`)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  // Constant-time — a plain === leaks the signature one byte at a time.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Re-read a payment from Razorpay: the server's OWN answer to "did this really
 * settle, and for how much?".
 *
 * A valid signature proves the browser is not lying about WHICH payment. It
 * does not prove the payment succeeded or that the amount matches. This does.
 *
 * If the payment is merely "authorized" (money held, not taken) we capture it
 * here, so a mis-set account-level auto-capture cannot leave orders shipped
 * against money that was never collected.
 *
 * @returns {{status:string, amount:number, currency:string, method:string}|null}
 *          amount is in RUPEES — converted back here, the mirror of the ×100.
 */
async function fetchPayment(gatewayPaymentId) {
  if (!gatewayPaymentId) return null;

  let payment = await call(`/payments/${gatewayPaymentId}`);

  if (payment?.status === "authorized") {
    try {
      payment = await call(`/payments/${gatewayPaymentId}/capture`, {
        method: "POST",
        body: { amount: payment.amount, currency: payment.currency },
      });
    } catch {
      // Capture failed — fall through with status "authorized". The caller
      // treats anything that is not "captured" as not-yet-paid, which is the
      // safe reading: no order is created.
    }
  }

  return {
    status: payment?.status, // created | authorized | captured | refunded | failed
    amount: (Number(payment?.amount) || 0) / 100,
    currency: payment?.currency,
    method: payment?.method, // upi | card | netbanking | wallet
    orderId: payment?.order_id,
    errorDescription: payment?.error_description || null,
  };
}

/**
 * 🔔 WEBHOOK AUTHENTICITY.
 *
 * Anyone on the internet can POST to a webhook URL. This is the only thing
 * standing between "Razorpay told us the money arrived" and "a stranger told us
 * the money arrived", so it must run before the payload is trusted at all.
 *
 * Razorpay signs the RAW REQUEST BODY with the WEBHOOK secret — which is a
 * DIFFERENT secret from the API key secret, set separately in the dashboard
 * when the webhook is created.
 *
 * ⚠️ RAW BODY, not the parsed object. JSON.stringify(req.body) re-orders keys
 *    and drops whitespace, so the HMAC would never match. Server.js captures the
 *    original buffer for this one route.
 *
 * @param {Buffer|string} rawBody  the untouched request body
 * @param {string} signature       the x-razorpay-signature header
 */
function verifyWebhook(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
  if (!secret || !rawBody || !signature) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody)))
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Whether a webhook secret is configured at all. */
function webhookConfigured() {
  return Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
}

/** For the return/refund flow. Amount in rupees; converted to paise here. */
async function refund({ gatewayPaymentId, amount } = {}) {
  if (!gatewayPaymentId) throw new Error("gatewayPaymentId is required");
  const body = {};
  if (amount != null) body.amount = Math.round(Number(amount) * 100); // partial
  const r = await call(`/payments/${gatewayPaymentId}/refund`, { method: "POST", body });
  return {
    provider: PROVIDER,
    refundId: r.id,
    gatewayPaymentId,
    amount: (Number(r.amount) || 0) / 100,
    status: r.status,
  };
}

/** What the browser may know: the PUBLISHABLE key and the mode. Never more. */
function publicConfig() {
  return {
    provider: PROVIDER,
    isMock: false,
    mode: mode(), // "test" | "live"
    keyId: keyId(),
  };
}

module.exports = {
  PROVIDER,
  SESSION_TTL_MS,
  isConfigured,
  mode,
  publicConfig,
  createSession,
  verify,
  verifyWebhook,
  webhookConfigured,
  fetchPayment,
  refund,
  // NOTE: no authorize(). Only the mock can decide its own outcome; a real
  // gateway is asked, never told. shopPaymentService checks for its absence.
};