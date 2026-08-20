// ─────────────────────────────────────────────────────────────
// Customer storefront (/customer-shop) API layer.
// Public GETs need no token; the consumer Bearer token (localStorage
// "shopToken") is attached when present. Mirrors imsApi/sellerApi patterns.
// ─────────────────────────────────────────────────────────────
import axios from "axios";
import config from "../../config/config";

const SHOP_TOKEN_KEY = "shopToken";
export const getShopToken = () => localStorage.getItem(SHOP_TOKEN_KEY);
export const setShopToken = (t) => localStorage.setItem(SHOP_TOKEN_KEY, t);
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

api.interceptors.request.use((req) => {
  const token = getShopToken();
  if (token) req.headers.Authorization = `Bearer ${token}`;
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
export const shopCheckout = (body) => data(api.post("checkout", body));
export const getShopOrders = () => data(api.get("orders"));
export const getShopOrder = (id) => data(api.get(`orders/${id}`));
// 🛒 Cancel your own order, with a reason. The server only permits this while
//    the order is still "pending" — after that the seller has reserved stock
//    against it. The reason rides in the POST body.
export const cancelShopOrder = (id, reason) =>
  data(api.post(`orders/${id}/cancel`, { reason }));

export default api;