// ─────────────────────────────────────────────────────────────
// INBUILT LIBRARY API — read-only NAMES from the admin Product Library, for the
// "Inbuilt Library" tab of My Products → Upload product.
// (/api/seller/library — see controller/Seller/sellerLibraryController.js)
//
// Same pattern as lib/sellerMyProductApi.js: the session is sellerApi's
// getSellerToken() ("sellerToken"), only the axios instance is local.
// ─────────────────────────────────────────────────────────────
import axios from "axios";
import config from "../../config/config";
import { getSellerToken } from "./sellerApi";

const api = axios.create({ baseURL: `${config.BASE_URL}seller/library/` });

api.interceptors.request.use((req) => {
  const token = getSellerToken();
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

const data = (p) => p.then((r) => r.data);

// { success, data: ["Company A", "Company B"] }
export const getLibraryCompanies = () => data(api.get("companies"));

// { success, data: [{ _id, productName }] } for ONE company (exact name).
export const getLibraryProducts = (companyName) => data(api.get("products", { params: { companyName } }));

// { success, data: [ ...full catalog details ] } — every active library product
// matching all three exactly, newest first. Admin-only fields are stripped
// server-side.
export const getLibraryProductDetails = (companyName, productName, category) =>
  data(api.get("product-details", { params: { companyName, productName, category } }));
