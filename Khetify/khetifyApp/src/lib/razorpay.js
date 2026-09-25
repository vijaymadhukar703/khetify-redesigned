/**
 * 💳 Razorpay Checkout loader.
 *
 * Razorpay's checkout is a hosted script that must come from THEIR domain — it
 * cannot be bundled, npm-installed or self-hosted, because the whole point is
 * that the card form runs on their origin and not ours. So it is loaded on
 * demand, here.
 *
 * ON DEMAND, not in index.html, on purpose:
 *   • the script is ~100 kB and every visitor would pay for it, including the
 *     large majority who browse, use COD, or never reach checkout at all
 *   • it opens a third-party connection on page load for no reason
 *   • Company / Seller / Warehouse / Admin share the same index.html and have
 *     nothing to do with payments
 *
 * Loading is idempotent: concurrent callers share ONE in-flight promise and a
 * second call after success resolves immediately. Without that, a shopper who
 * taps twice gets two <script> tags and a race.
 *
 * NO KEY LIVES IN THIS FILE. The publishable key id comes from the server
 * (GET /api/shop/payments/config) so there is exactly one place it is
 * configured — see khetify-backend/services/payments/razorpayGateway.js.
 */

const SRC = "https://checkout.razorpay.com/v1/checkout.js";

let loadPromise = null;

/** @returns {Promise<any>} the global Razorpay constructor */
export function loadRazorpay() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Razorpay can only be loaded in a browser"));
  }
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    // A tag may already exist from a previous mount that hasn't finished.
    const existing = document.querySelector(`script[src="${SRC}"]`);
    const script = existing || document.createElement("script");

    const onLoad = () => {
      if (window.Razorpay) resolve(window.Razorpay);
      else fail();
    };
    const fail = () => {
      // Let a later attempt retry rather than caching the failure forever —
      // this is usually a flaky network or an ad-blocker the shopper can turn
      // off, both of which can change between taps.
      loadPromise = null;
      script.remove();
      reject(new Error("Could not load the payment gateway. Check your connection and try again."));
    };

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", fail, { once: true });

    if (!existing) {
      script.src = SRC;
      script.async = true;
      document.body.appendChild(script);
    }
  });

  return loadPromise;
}

/**
 * Open Razorpay Checkout and resolve with what it hands back.
 *
 * @param {object} checkout the `checkout` block from POST /payments/initiate —
 *        built server-side, passed through untouched. Nothing is invented here.
 * @param {object} handlers
 * @param {(p:{gatewayPaymentId:string, signature:string})=>void} handlers.onSuccess
 * @param {(message:string)=>void} handlers.onFailure
 * @param {()=>void} handlers.onDismiss  shopper closed the modal without paying
 */
export async function openRazorpayCheckout(checkout, { onSuccess, onFailure, onDismiss } = {}) {
  const Razorpay = await loadRazorpay();

  const rzp = new Razorpay({
    key: checkout.keyId,
    order_id: checkout.orderId,
    amount: checkout.amount, // paise — the server already converted
    currency: checkout.currency,
    name: checkout.name,
    description: checkout.description,
    prefill: checkout.prefill,
    theme: checkout.theme,

    /* Success. These three values are NOT proof of anything on their own — the
       server re-derives the signature and re-reads the payment from Razorpay
       before it will create an order. They are simply passed along. */
    handler: (response) => {
      onSuccess?.({
        gatewayPaymentId: response.razorpay_payment_id,
        signature: response.razorpay_signature,
        gatewayOrderId: response.razorpay_order_id,
      });
    },

    modal: {
      // Closing the modal is not a failure — nothing was charged and the
      // basket is untouched. The session is reopened so "Try again" works.
      ondismiss: () => onDismiss?.(),
      escape: true,
    },
  });

  // A declined card / failed UPI collect. Razorpay keeps the modal open for a
  // retry, so this reports the reason without ending the flow.
  rzp.on("payment.failed", (response) => {
    onFailure?.(
      response?.error?.description || "The payment failed. No money was deducted."
    );
  });

  rzp.open();
  return rzp;
}