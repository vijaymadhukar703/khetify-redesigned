// ─────────────────────────────────────────────────────────────
// ADMIN PRODUCT LIBRARY API — the platform admin's own product catalog
// (/api/admin/products, stored in the separate "admin_products" collection).
//
// Same shape as lib/sellerMyProductApi.js, but authenticated with the ADMIN
// session: the token comes from the "adminToken" localStorage key that
// lib/adminApi.js owns, so an admin logs in once and both layers share it.
// ─────────────────────────────────────────────────────────────
import axios from "axios";
import config from "../../config/config";
import { ADMIN_TOKEN_KEY } from "./adminApi";

const withAdminToken = (req) => {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
};

const api = axios.create({ baseURL: `${config.BASE_URL}admin/products/` });
api.interceptors.request.use(withAdminToken);

const data = (p) => p.then((r) => r.data);

/* ---- catalog ---- */
// params: { search, category, status, page, limit } — each optional.
// Answers { success, data, pagination }.
export const getAdminProducts = (params = {}) => data(api.get("", { params }));
export const getAdminProduct = (id) => data(api.get(`${id}`));
// MULTIPART — the write routes run through multer (middlewares/upload.js), so
// product and variant images travel as real files. Callers pass a FormData.
const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };
export const createAdminProduct = (formData) => data(api.post("", formData, MULTIPART));
export const updateAdminProduct = (id, formData) => data(api.put(`${id}`, formData, MULTIPART));

// Advisory only — never blocks a create. Up to 5 library products with a
// similar name.
export const checkAdminDuplicateName = (name) => data(api.get("duplicate-check", { params: { name } }));

/* ---- GST rate master (read-only) ----
 * The plain /api/hsn mount, which accepts the admin token. NOT /api/seller/hsn:
 * middlewares/principalRouteGuard refuses any non-seller token there.
 */
const hsnApi = axios.create({ baseURL: config.BASE_URL });
hsnApi.interceptors.request.use(withAdminToken);

// Autocomplete feed: codes starting with `q`, each with its description and
// GST rate(s). Returns 200 with an empty list for a too-short query.
export const searchHsn = (q, limit = 20) => data(hsnApi.get("hsn/search", { params: { q, limit } }));

// The rate for ONE code. status: "single" | "multiple" | "not_found" | "invalid".
// A 404 (code absent from the master) is a normal outcome, so callers should
// read the error body rather than treat it as a failure.
export const getGstByHsn = (code) => data(hsnApi.get(`hsn/${code}`));
