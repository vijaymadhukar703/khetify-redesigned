/**
 * Centralised, fail-fast environment config. Required vars are validated at
 * boot so the process exits immediately with a clear message instead of
 * failing later at runtime. Import this once from Server.js (after dotenv).
 */
require("dotenv").config();

const REQUIRED = ["MONGO_URI", "JWT_SECRET"];

function load() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(`❌ Missing required env var(s): ${missing.join(", ")}. See .env.example.`);
    process.exit(1);
  }

  // Warn (don't fail) on recommended-but-optional secrets.
  if (!process.env.MASTER_KEY) {
    // eslint-disable-next-line no-console
    console.warn("⚠️  MASTER_KEY not set — channel credentials use a dev default. Set it in production.");
  }

  /* 💳 Razorpay: intentionally OPTIONAL, so a developer with no credentials can
     still run the whole storefront (the mock gateway takes over — see
     services/shopPaymentGateway.js). But HALF a key pair is always a mistake:
     it means someone pasted one line and missed the other, and the silent
     fallback to mock would look like the integration simply didn't work. */
  const rzpId = process.env.RAZORPAY_KEY_ID;
  const rzpSecret = process.env.RAZORPAY_KEY_SECRET;
  if (Boolean(rzpId) !== Boolean(rzpSecret)) {
    // eslint-disable-next-line no-console
    console.error(
      "❌ Razorpay is half-configured: set BOTH RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET, or neither."
    );
    process.exit(1);
  }
  // A live key on a dev box is how real money gets taken by accident.
  if (rzpId && rzpId.startsWith("rzp_live_") && (process.env.NODE_ENV || "development") !== "production") {
    // eslint-disable-next-line no-console
    console.warn("⚠️  A LIVE Razorpay key is set while NODE_ENV is not production. Real money will move.");
  }

  /* 🔔 Without a webhook secret the webhook route rejects everything (it fails
     closed), which means a shopper who pays and closes the tab gets no order.
     Survivable in test; in LIVE it is a customer who paid and received nothing,
     so refuse to boot rather than run a shop that can silently eat payments. */
  if (rzpId && !process.env.RAZORPAY_WEBHOOK_SECRET) {
    const live = rzpId.startsWith("rzp_live_");
    if (live) {
      // eslint-disable-next-line no-console
      console.error(
        "❌ RAZORPAY_WEBHOOK_SECRET is required with a LIVE key. Without it, a customer who pays and closes the tab never gets an order."
      );
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.warn("⚠️  RAZORPAY_WEBHOOK_SECRET not set — webhooks are rejected. Fine for local testing, required before going live.");
  }

  return {
    port: Number(process.env.PORT) || 5000,
    mongoUri: process.env.MONGO_URI,
    jwtSecret: process.env.JWT_SECRET,
    corsOrigins: (process.env.CORS_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean),
    nodeEnv: process.env.NODE_ENV || "development",
    storageDriver: process.env.STORAGE_DRIVER || "local",
    logLevel: process.env.LOG_LEVEL || "info",

    /* 💳 Exposed for diagnostics only. Nothing reads the SECRET from here —
       services/payments/razorpayGateway.js reads process.env directly so the
       secret is never copied into a shared, loggable config object. */
    payments: {
      gateway: process.env.PAYMENT_GATEWAY || (rzpId ? "razorpay" : "mock"),
      razorpayKeyId: rzpId || null, // publishable half only
      razorpayMode: rzpId && rzpId.startsWith("rzp_live_") ? "live" : "test",
      webhookConfigured: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
    },
  };
}

module.exports = { load, REQUIRED };