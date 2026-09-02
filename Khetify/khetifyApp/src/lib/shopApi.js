// ─────────────────────────────────────────────────────────────
// Customer storefront (/customer-shop) API layer.
// Public GETs need no token; the consumer Bearer token (localStorage
// "shopToken") is attached when present. Mirrors imsApi/sellerApi patterns.
// ─────────────────────────────────────────────────────────────
import axios from "axios";
import config from "../../config/config";

const SHOP_TOKEN_KEY = "shopToken";
export const getShopToken = () => localStorage.getItem(SHOP_TOKEN_KEY);
/* The "already asked about live location this session" marker. Cleared on every
   fresh sign-in so a shopper who DENIED is asked again after their next login,
   while one who ALLOWED is never re-prompted (that answer lives on the account,
   server-side, and arrives with the consumer on login / me). */
export const SHOP_LOCATION_PROMPT_KEY = "khetify:locationPrompt:shop";

export const setShopToken = (t) => {
  localStorage.setItem(SHOP_TOKEN_KEY, t);
  try { sessionStorage.removeItem(SHOP_LOCATION_PROMPT_KEY); } catch { /* private mode */ }
};
export const clearShopToken = () => localStorage.removeItem(SHOP_TOKEN_KEY);

/* Multi-select filters (?brand=A&brand=B) must survive the trip to the server.
   Axios's default array format is `brand[]=A&brand[]=B`, but Express 5 ships the
   "simple" query parser, which reads that as a literal key called "brand[]" —
   the filter silently does nothing. So serialise arrays as REPEATED PLAIN KEYS
   (`brand=A&brand=B`), which every query parser turns into an array.
   Empty values are dropped so the URL never carries `?category=&brand=`. */
const paramsSerializer = (params) => {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === "" || value === false) continue;
    if (Array.isArray(value)) {
      value.filter((v) => v !== "" && v != null).forEach((v) => sp.append(key, String(v)));
    } else {
      sp.append(key, String(value));
    }
  }
  return sp.toString();
};

const api = axios.create({ baseURL: `${config.BASE_URL}shop/`, paramsSerializer });

/* The storefront language, read from the SAME localStorage key the language
   context owns (context/ShopLanguageContext.jsx). Read here rather than passed
   in by every caller: it is a device preference, not an argument, and putting
   it in the interceptor means no call site can forget it. */
const SHOP_LANG_KEY = "khetify:shopLang";
const currentLang = () => {
  try { return localStorage.getItem(SHOP_LANG_KEY) || "en"; } catch { return "en"; }
};

api.interceptors.request.use((req) => {
  const token = getShopToken();
  if (token) req.headers.Authorization = `Bearer ${token}`;

  /* Tell the API which language to return DATABASE text in. Sent on every GET;
     the server ignores it for anything untranslatable and falls back to English
     for anything it has no translation for, so this can never break a call.
     Never sent on writes — a POST body must not depend on the UI language. */
  const lang = currentLang();
  if (lang && lang !== "en" && (req.method || "get").toLowerCase() === "get") {
    req.params = { ...(req.params || {}), lang };
  }
  return req;
});

const data = (p) => p.then((r) => r.data);

/* ---- Public catalog (no login) ---- */
export const getShopProducts = (params = {}) => data(api.get("products", { params }));
export const getShopProduct = (listingId) => data(api.get(`products/${listingId}`));
export const getShopCategories = () => data(api.get("categories"));
// 🔍 Autocomplete for the header search box. Do NOT use getShopProducts() for
//    this — that endpoint builds full product cards (seller, company, live
//    stock) and the dropdown only renders a name + a link. This one returns
//    just { listingId, name }.
export const getShopSuggestions = (q, limit = 8, config = {}) =>
  data(api.get("search/suggest", { params: { q, limit }, ...config }));

/* ---- Consumer auth ---- */
export const shopRegister = (body) => data(api.post("auth/register", body));
export const shopLogin = (body) => data(api.post("auth/login", body));
export const shopVerifyOtp = (code) => data(api.post("auth/verify-otp", { code }));
export const shopResendOtp = () => data(api.post("auth/resend-otp"));
export const shopMe = () => data(api.get("auth/me"));

/* ---- 👤 Profile (self-service) ---- */
// Partial update of the shopper's own name / phone. Email is intentionally NOT
// editable here — it is the login identifier, so changing it needs its own
// verify-first flow.
export const updateShopProfile = (body) => data(api.patch("auth/me", body));
// 📍 Live location consent. { status: "granted" | "denied", latitude?, longitude?, accuracy? }
// Returns the updated consumer in the same shape as /auth/me.
export const saveShopLocation = (body) => data(api.patch("auth/location", body));
// Resolve coordinates to a readable address WITHOUT saving — confirmation step.
export const previewShopLocation = (body) => data(api.post("auth/location/preview", body));
// Changes the account password (current password required).
export const changeShopPassword = (body) => data(api.post("auth/change-password", body));

/* ---- Addresses ---- */
export const getShopAddresses = () => data(api.get("addresses"));
export const addShopAddress = (body) => data(api.post("addresses", body));
// 👤 PROFILE: the address book needs edit + default, not just add/delete.
export const updateShopAddress = (id, body) => data(api.put(`addresses/${id}`, body));
export const setDefaultShopAddress = (id) => data(api.patch(`addresses/${id}/default`));
export const deleteShopAddress = (id) => data(api.delete(`addresses/${id}`));

/* ---- Checkout & orders ---- */
// Prices the basket for the COD confirmation screen. Places NOTHING — the COD
// twin of initiateShopPayment(). Same body as shopCheckout below, so the review
// and the real order are priced by identical server code.
export const reviewShopCheckout = (body) => data(api.post("checkout/review", body));

export const shopCheckout = (body) => data(api.post("checkout", body));
export const getShopOrders = () => data(api.get("orders"));
export const getShopOrder = (id) => data(api.get(`orders/${id}`));
// 🛒 Cancel your own order, with a reason. The server only permits this while
//    the order is still "pending" — after that the seller has reserved stock
//    against it. The reason rides in the POST body.
export const cancelShopOrder = (id, reason) =>
  data(api.post(`orders/${id}/cancel`, { reason }));

/* ---- 💳 Online payment (mock gateway) ----
   A SEPARATE lane from shopCheckout() above, on purpose. COD still posts to
   /checkout and gets its orders back immediately; online payment opens a
   payment session first and the orders are created by the server only after
   the gateway confirms.

   When a real gateway is integrated, `initiateShopPayment` stays exactly as it
   is (the server swaps its adapter) and only `completeMockShopPayment` is
   replaced by a call that hands the gateway's own { paymentId, signature }
   back for verification. */

// Prices the basket server-side and opens a payment session. Creates NO order.
// Same body as shopCheckout: { items, shippingAddressId }.
export const initiateShopPayment = (body) => data(api.post("payments/initiate", body));

// The shopper's own payment session (amount, status, seller-wise quote).
export const getShopPayment = (paymentId) => data(api.get(`payments/${paymentId}`));

// Which gateway is live + its PUBLISHABLE key id: { provider, isMock, mode, keyId }.
// Served by the API rather than a VITE_ env var so the key can never disagree
// with the account the server verifies signatures against.
export const getShopPaymentConfig = () => data(api.get("payments/config"));

// The REAL return leg: hand back what Razorpay Checkout gave the browser.
// Untrusted until the server verifies the signature AND re-reads the payment,
// so this is a claim, not a confirmation. Returns { payment, orders }.
export const verifyShopPayment = (paymentId, body) =>
  data(api.post(`payments/${paymentId}/verify`, body));

// Shopper closed the gateway window without paying. Reopens the session so the
// retry button works. Nothing was charged and nothing was ordered.
export const dismissShopPayment = (paymentId) =>
  data(api.post(`payments/${paymentId}/dismiss`));

// ⛔ MOCK GATEWAY ONLY — the server refuses this whenever Razorpay is active.
//    outcome: "success" | "failure".  Returns { payment, orders } on success,
//    where `orders` is the SAME array shape shopCheckout() returns.
export const completeMockShopPayment = (paymentId, body) =>
  data(api.post(`payments/${paymentId}/mock/complete`, body));

// The shopper backed out of the payment screen. Nothing was ordered.
export const cancelShopPayment = (paymentId) =>
  data(api.post(`payments/${paymentId}/cancel`));

export default api;