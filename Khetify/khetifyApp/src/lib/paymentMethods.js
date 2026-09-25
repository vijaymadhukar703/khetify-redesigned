/**
 * 💳 STOREFRONT PAYMENT METHODS — one source of truth.
 *
 * Checkout, the mock payment screen and the order-success screen all need the
 * same vocabulary. Keeping it here (the way lib/orderStatus.js already does for
 * order statuses) is what stops those three screens from drifting apart the
 * moment a third method is added.
 *
 * The ids are exactly what the API expects as `paymentMethod` and exactly what
 * comes back as `order.payment.mode`, so nothing has to be mapped in between.
 *
 * ADDING A REAL GATEWAY LATER changes nothing in this file: "online" stays
 * "online" whether the money is taken by the mock adapter or by Razorpay.
 */

export const PAYMENT_METHODS = {
  COD: "cod",
  ONLINE: "online",
};

/**
 * The options rendered on checkout, in display order.
 * Labels are KEYS (module scope has no t()) — resolved at render, exactly like
 * the STEPS array in ShopCheckout.
 */
export const PAYMENT_OPTIONS = [
  {
    id: PAYMENT_METHODS.COD,
    icon: "payments",
    labelKey: "co.cod",
    subKey: "co.codSub",
    badgeKey: "co.available",
  },
  {
    id: PAYMENT_METHODS.ONLINE,
    icon: "credit_card",
    labelKey: "co.online",
    subKey: "co.onlineSub",
    badgeKey: "co.onlineBadge",
  },
];

/** True when an order/selection is the online lane. */
export const isOnlinePayment = (mode) =>
  String(mode || "").toLowerCase() === PAYMENT_METHODS.ONLINE;

/** Translation key for a stored order.payment.mode. Unknown modes fall back. */
export function paymentModeLabelKey(mode) {
  const m = String(mode || "").toLowerCase();
  if (m === PAYMENT_METHODS.ONLINE) return "os.onlineFull";
  return "os.codFull";
}

/** Translation key for a stored order.payment.status. */
export function paymentStatusLabelKey(status) {
  const s = String(status || "").toLowerCase();
  if (s === "paid") return "os.statusPaid";
  if (s === "refunded") return "os.statusRefunded";
  if (s === "partial") return "os.statusPartial";
  return "os.statusPending";
}

/** The instruments the mock payment screen offers. */
export const MOCK_INSTRUMENTS = [
  { id: "upi", icon: "qr_code_2", labelKey: "pay.upi" },
  { id: "card", icon: "credit_card", labelKey: "pay.card" },
  { id: "netbanking", icon: "account_balance", labelKey: "pay.netbanking" },
  { id: "wallet", icon: "wallet", labelKey: "pay.wallet" },
];