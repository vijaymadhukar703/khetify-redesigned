/**
 * 🧾 The handoff between ShopCheckout and the COD confirmation screen.
 *
 * The COD twin of lib/pendingPayment.js, and deliberately the same shape — the
 * two lanes now have the same number of screens, so they should have the same
 * plumbing rather than one lane growing its own private mechanism.
 *
 * ONE IMPORTANT DIFFERENCE. An online payment has a server-side ShopPayment row
 * holding the frozen basket, so pendingPayment only carries two local facts. COD
 * has no such row — nothing is written until the shopper confirms — so the
 * basket ITSELF has to survive the hop, and it lives here.
 *
 * That is safe, but only because of where the numbers come from: the confirm
 * screen prices this basket by POSTing it to /checkout/review, and the order is
 * placed by POSTing it to /checkout, and BOTH are priced server-side from the
 * listing ids. A tampered `items` here can change WHAT is ordered — which the
 * shopper could do on the cart page anyway — but never what it COSTS.
 *
 * sessionStorage, like lib/buyNow.js: survives a refresh on the confirm screen,
 * dies with the tab so an abandoned checkout never resurfaces days later.
 */

const KEY = "khetify:pendingOrder";

export function setPendingOrder(info) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...info, at: Date.now() }));
    return true;
  } catch {
    return false; // private mode / quota — caller falls back to direct order
  }
}

/** Read the pending COD order, or null if there isn't a usable one. */
export function getPendingOrder() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const info = JSON.parse(raw);
    if (!info?.items?.length || !info?.shippingAddressId) return null;
    return info;
  } catch {
    return null;
  }
}

export function clearPendingOrder() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}