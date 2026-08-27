/**
 * 💳 The handoff between ShopCheckout and the payment screen.
 *
 * WHAT IT CARRIES — and, just as importantly, what it does NOT.
 *
 * Everything that MATTERS about a payment (the basket, the prices, the address,
 * the amount) is frozen SERVER-SIDE in the ShopPayment row the moment the
 * session is created. None of it is here, and none of it is trusted from here.
 *
 * What is left are two purely local facts the server has no reason to know:
 *
 *   isBuyNow     — whether this purchase came from "Buy now" (sessionStorage)
 *                  or from the cart, so the right one is cleared on success and
 *                  the other is left completely untouched.
 *   sellerNames  — the sellerId → name map. An Order stores ownerId but never
 *                  the seller's NAME, and by the time the success screen renders
 *                  the cart that had the names is already cleared. ShopCheckout
 *                  passes this map today via router state; the payment screen is
 *                  simply one more hop, so the map has to survive the hop.
 *
 * Why sessionStorage rather than router state: a shopper who refreshes on the
 * payment screen (or comes back to it) must not lose the flow. Same reasoning,
 * and the same storage, as lib/buyNow.js — and like that file it dies with the
 * tab, so a pending payment never lingers into a future visit.
 */

const KEY = "khetify:pendingPayment";

export function setPendingPayment(info) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(info));
    return true;
  } catch {
    return false; // private mode / quota — the screen falls back to defaults
  }
}

/**
 * Read the handoff for a SPECIFIC payment id. The id check matters: a stale
 * record from an abandoned payment must not clear the cart of a new one.
 */
export function getPendingPayment(paymentId) {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const info = JSON.parse(raw);
    if (!info || (paymentId && String(info.paymentId) !== String(paymentId))) return null;
    return info;
  } catch {
    return null;
  }
}

export function clearPendingPayment() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}