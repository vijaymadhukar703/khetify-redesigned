// ─────────────────────────────────────────────────────────────
// MY PRODUCTS API — the seller's OWN catalog and their own stock.
//
// A separate module from lib/sellerApi.js because this module hangs off its own
// mount (/api/seller/my-products) and is deliberately UNGATED on the backend:
// no approval, no subscription, no feature flag. Keeping it here means
// sellerApi.js is never edited to add it.
//
// The SESSION is shared, not duplicated: the token comes from sellerApi's
// getSellerToken(), so a seller logs in once and both layers use that same
// "sellerToken" key. Only the axios instance (and its baseURL) is local.
// ─────────────────────────────────────────────────────────────
import axios from "axios";
import config from "../../config/config";
import { getSellerToken } from "./sellerApi";

const api = axios.create({ baseURL: `${config.BASE_URL}seller/my-products/` });

api.interceptors.request.use((req) => {
  const token = getSellerToken();
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

const data = (p) => p.then((r) => r.data);

/* ---- catalog ---- */
// params: { search, category, status } — each optional.
// Every row carries `totalStock`, summed by the backend across the seller's own
// inventory rows for that product.
export const getMyProducts = (params = {}) => data(api.get("", { params }));
export const getMyProduct = (id) => data(api.get(`${id}`));
// MULTIPART — the write routes run through multer (middlewares/upload.js), so
// product and variant images travel as real files. Callers pass a FormData.
// The header is set explicitly rather than left to axios so a caller that
// hands over a plain object fails loudly instead of silently dropping images.
const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };
export const createMyProduct = (formData) => data(api.post("", formData, MULTIPART));
export const updateMyProduct = (id, formData) => data(api.put(`${id}`, formData, MULTIPART));

// Advisory only — never blocks a create. Returns up to 5 of the seller's own
// products with a similar name, so they can spot one they already added.
export const checkDuplicateName = (name) => data(api.get("duplicate-check", { params: { name } }));

/* ---- own stock ---- */
// params: { productId, warehouseId, expiring, expired } — each optional.
export const getMyStock = (params = {}) => data(api.get("stock", { params }));
// body: { productId, warehouseId, variantSku?, lotNumber?, mfgDate?, expiryDate?, qty, lowStockThreshold? }
export const addMyStock = (body) => data(api.post("stock", body));

/* ---- GST rate master (read-only) ----
 * The SAME master the company upload form reads, on the seller-namespaced
 * mount. It has to be that mount: middlewares/principalRouteGuard refuses a
 * seller token on any path outside /api/seller, so calling /api/hsn from the
 * seller portal 403s ("Company access only") on every keystroke.
 *
 * Its own axios instance because the baseURL differs from my-products; the
 * token comes from the same getSellerToken(), so it is one session either way.
 */
const hsnApi = axios.create({ baseURL: `${config.BASE_URL}seller/hsn/` });

hsnApi.interceptors.request.use((req) => {
  const token = getSellerToken();
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

// Autocomplete feed: codes starting with `q`, each with its description and
// GST rate(s). Returns 200 with an empty list for a too-short query.
export const searchHsn = (q, limit = 20) => data(hsnApi.get("search", { params: { q, limit } }));

// The rate for ONE code. status: "single" | "multiple" | "not_found" | "invalid".
// A 404 (code absent from the master) is a normal outcome, so callers should
// read the error body rather than treat it as a failure.
export const getGstByHsn = (code) => data(hsnApi.get(`${code}`));
