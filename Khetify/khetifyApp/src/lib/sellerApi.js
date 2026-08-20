// ─────────────────────────────────────────────────────────────
// SELLER API layer — every seller-portal page calls the backend through here.
// Mirrors lib/imsApi.js, but uses a DISTINCT storage key ("sellerToken") so a
// seller session and a company session can coexist without colliding.
// ─────────────────────────────────────────────────────────────
import axios from "axios";
import config from "../../config/config";

const SELLER_TOKEN_KEY = "sellerToken";

export const getSellerToken = () => localStorage.getItem(SELLER_TOKEN_KEY);
export const setSellerToken = (t) => localStorage.setItem(SELLER_TOKEN_KEY, t);
export const clearSellerToken = () => localStorage.removeItem(SELLER_TOKEN_KEY);
export const isSellerAuthed = () => !!getSellerToken();

const api = axios.create({ baseURL: `${config.BASE_URL}seller/` });

api.interceptors.request.use((req) => {
  const token = getSellerToken();
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

const data = (p) => p.then((r) => r.data);

/* ---- auth ---- */
export const registerSeller = (body) => data(api.post("register", body));
export const loginSeller = (body) => data(api.post("login", body));
export const getSellerMe = () => data(api.get("me"));
// Registration profile (identity + GSTIN/PAN + KYC docs as signed URLs),
// resolved from the seller token — mirrors the company /company/profile.
export const getSellerProfile = () => data(api.get("profile"));
// Edit own profile — multipart (identity/compliance fields + replacement docs).
export const updateSellerProfile = (formData) => data(api.patch("profile", formData));

/* ---- onboarding wizard ---- */
export const saveSellerInfo = (body) => data(api.put("onboarding/info", body));
export const saveSellerContact = (body) => data(api.put("onboarding/contact", body));
export const saveSellerVerification = (body) => data(api.put("onboarding/verification", body));
export const submitSellerOnboarding = () => data(api.post("onboarding/submit", {}));

/* ---- companies (derived from PC issuance) ---- */
// The seller's companies with their PC status (active = certificate issued, or an
// in-progress / rejected application). `status=active` narrows to issued PCs.
export const getSellerCompanies = (status) => data(api.get("companies", { params: status ? { status } : {} }));
// Approved companies the seller isn't engaged with yet — candidates to apply to for a PC.
export const searchSellerCompanies = (q = "") => data(api.get("companies/search", { params: { q } }));
// Recommended companies to apply to — IMS-subscribed companies ranked first.
export const getRecommendedCompanies = () => data(api.get("companies/recommended"));

/* ---- team / roles (seller RBAC) ---- */
export const SELLER_TEAM_ROLES = [
  { value: "seller_admin", label: "Admin (full access)" },
  { value: "seller_manager", label: "Manager (operate, no team/billing)" },
  { value: "seller_staff", label: "Staff (read-mostly)" },
];
export const getSellerTeam = () => data(api.get("team"));
export const createSellerMember = (body) => data(api.post("team", body));
export const updateSellerMember = (id, body) => data(api.patch(`team/${id}`, body));
export const deleteSellerMember = (id) => data(api.delete(`team/${id}`));

/* ---- authorization status (read-only; now PC-derived) ---- */
/* ---- ACCOUNT SECURITY -------------------------------------------------- */
// CHANGE PASSWORD is seller-namespaced. The shared /api/users/change-password
// would have suited it, but middlewares/principalRouteGuard refuses a seller
// token on any route outside /api/seller ("Company access only"), so the seller
// portal has its own endpoint with the identical rules.
export const changeMySellerPassword = (body) => data(api.post("change-password", body));
// FORGOT PASSWORD is seller-specific: /api/users/forgot-password only matches
// company members, so the seller portal has its own public endpoint.
export const requestSellerPasswordReset = (body) => data(api.post("forgot-password", body));

export const getSellerLink = () => data(api.get("link"));
export const ackSellerApproval = () => data(api.post("ack-approval"));

/* ---- Principal Certificate: documents ---- */
export const getSellerDocuments = () => data(api.get("documents"));
export const uploadSellerDocuments = (formData) => data(api.post("documents", formData));
export const deleteSellerDocument = (id) => data(api.delete(`documents/${id}`));

/* ---- Principal Certificate: applications + agreement ---- */
// The company's PC application form + profile autofill + the profile-prereq state.
export const getPcApplyForm = (companyId) => data(api.get(`pc-applications/form/${companyId}`));
export const getPcApplications = () => data(api.get("pc-applications"));
export const getPcApplication = (id) => data(api.get(`pc-applications/${id}`));
export const createPcApplication = (body) => data(api.post("pc-applications", body));
export const attachPcDocuments = (id, documentIds) => data(api.post(`pc-applications/${id}/documents`, { documentIds }));
export const getPcAgreement = (id) => data(api.get(`pc-applications/${id}/agreement`));
export const signPcAgreement = (id, body) => data(api.post(`pc-applications/${id}/agreement/sign`, body)); // {signedName,consent} OR FormData

/* ---- Principal Certificate: issued certificates + govt ---- */
export const getSellerCertificates = () => data(api.get("certificates"));
export const getSellerCertificate = (id) => data(api.get(`certificates/${id}`));
export const downloadSellerCertificate = (id) => data(api.get(`certificates/${id}/download`));

/* ---- seller notifications (same system as company, scoped to the seller) ---- */
export const getSellerNotifications = () => data(api.get("notifications"));
export const markSellerNotificationRead = (id) => data(api.put(`notifications/${id}/read`));
export const markAllSellerNotificationsRead = () => data(api.put("notifications/read-all"));

/* ---- seller-owned warehouses (Phase 2b) ---- */
export const getSellerWarehouses = () => data(api.get("warehouses"));
export const getSellerWarehouseStockSummary = (id) => data(api.get(`warehouses/${id}/stock-summary`));
export const createSellerWarehouse = (body) => data(api.post("warehouses", body));
export const updateSellerWarehouse = (id, body) => data(api.put(`warehouses/${id}`, body));
export const deactivateSellerWarehouse = (id) => data(api.patch(`warehouses/${id}/deactivate`));

/* ---- read-only catalog of the linked company's products (Phase 2c) ---- */
export const getSellerProducts = (params = {}) => data(api.get("products", { params }));
export const getSellerProduct = (id) => data(api.get(`products/${id}`));

/* ---- marketplace listings (publish a company's product to the customer
   storefront — reads/writes the `sellerlistings` collection; publish is gated
   server-side by requireActivePC(companyId) + certification:manage) ---- */
export const getMyListings = () => data(api.get("listings"));
export const publishListing = ({ companyId, productId, price }) =>
  data(api.post("listings/publish", { companyId, productId, price }));
export const unpublishListing = (listingId) =>
  data(api.patch(`listings/${listingId}/unpublish`));

/* ---- inbound supply requests (Phase 3) ---- */
export const createSellerSupplyOrder = (body) => data(api.post("supply-orders", body));
export const getSellerSupplyOrders = () => data(api.get("supply-orders"));
// Resolve ONE label scanned while receiving (shipment manifest / Shipment Box /
// Bulk Packaging) and report live coverage of the shipment's units. Read-only.
export const scanSellerReceiveBox = (id, body) => data(api.post(`supply-orders/${id}/scan-box`, body));
export const receiveSellerSupply = (id, body) => data(api.post(`supply-orders/${id}/receive`, body));

/* ---- read-only inventory / lots (Phase 4a) ---- */
export const getSellerLots = (params = {}) => data(api.get("lots", { params }));

/* ---- Seller Lot Traceability (read-only) ---- */
// The whole details page: lot + product summary, seller stock counts, packaging
// summary and the seller-visible Bulk Packaging IDs.
export const getSellerLotDetails = (lotId) => data(api.get(`lots/${lotId}/details`));
// WHICH Unit IDs make up a seller lot's available quantity right now
// (Seller → Analytics → View → View Available Units).
export const getSellerLotAvailableUnits = (lotId) => data(api.get(`lots/${lotId}/available-units`));
// Seller-visible traceability history for the lot.
export const getSellerLotHistory = (lotId) => data(api.get(`lots/${lotId}/history`));
// A non-bulk lot's units — paginated + searchable.
export const getSellerLotUnits = (lotId, params = {}) => data(api.get(`lots/${lotId}/units`, { params }));
// The seller's own units inside one received Bulk Packaging box — paginated.
export const getSellerPackageUnits = (lotId, packageId, params = {}) =>
  data(api.get(`lots/${lotId}/bulk-packages/${packageId}/units`, { params }));

/* ---- inter-warehouse transfers (request → accept → shipment lifecycle) ---- */
export const getSellerTransfers = (params = {}) => data(api.get("transfers", { params }));
// Request a transfer A→B: { fromWarehouseId, toWarehouseId, productId, qty, note }
export const createSellerTransfer = (body) => data(api.post("transfers", body));
// DIRECT transfer — no prior request. Same downstream pipeline as an accepted
// request (planned shipment → Send Stock → scan → box → dispatch → receive);
// only the entry point differs. Backend: POST /api/seller/transfers/direct.
//
// Accepts a FormData so the DELIVERY CHALLAN (image or PDF) travels with the
// fields — axios sets the multipart boundary itself, so no Content-Type is set
// here. A plain object still works: the route's multer middleware ignores a
// JSON body, so any caller posting JSON is unaffected.
export const directSellerTransfer = (body) => data(api.post("transfers/direct", body));
export const acceptSellerTransfer = (id, body = {}) => data(api.post(`transfers/${id}/accept`, body));
// Products the seller HOLDS in a warehouse (in-stock lots, grouped) — fills the
// transfer Product picker. Pass { forRequest: 1 } to read ANOTHER of your
// warehouses' stock (the holder you're pulling from), bypassing manager scope.
export const getSellerTransferStock = (warehouseId, opts = {}) => data(api.get('transfers/stock', { params: { warehouseId, ...opts } }));
// ALL warehouses owned by the seller ACCOUNT (not manager-scoped) — for the transfer DESTINATION picker.
export const getSellerTransferWarehouses = () => data(api.get('transfers/warehouses'));
export const rejectSellerTransfer = (id, body = {}) => data(api.post(`transfers/${id}/reject`, body));

/* ---- shipments (supply + transfers): dispatch + scan-receive ---- */
export const getSellerShipments = (params = {}) => data(api.get("shipments", { params }));
export const getSellerShipment = (id) => data(api.get(`shipments/${id}`));
// Send Stock pipeline: scan-to-pick → pack → (label) → dispatch, like the company.
export const pickSellerShipment = (id, body) => data(api.post(`shipments/${id}/pick`, body));
// Seller scan validation (Phase 3). `scan` resolves ONE label against the
// database; `scanPick` confirms a pick from validated tokens. Neither takes a
// quantity, warehouse or product from the client — all are derived server-side.
export const scanSellerShipment = (id, body) => data(api.post(`shipments/${id}/scan`, body));
export const getSellerScanState = (id) => data(api.get(`shipments/${id}/scan-state`));
export const scanPickSellerShipment = (id, body) => data(api.post(`shipments/${id}/scan-pick`, body));
// SELLER ORDER PROCESSING. Scanning and box building save NOTHING;
// `previewSellerBoxLabel` only renders a label from validated contents.
// `dispatchSellerOrder` is the single call that commits the whole operation.
export const getSellerShipmentBox = (id) => data(api.get(`shipments/${id}/box`));
export const previewSellerBoxLabel = (id, body) => data(api.post(`shipments/${id}/box-label`, body));
export const getSellerDeliveryLabel = (id, packageId) =>
  data(api.get(`shipments/${id}/delivery-label`, packageId ? { params: { packageId } } : undefined));
export const dispatchSellerOrder = (id, body) => data(api.post(`shipments/${id}/dispatch-order`, body));
export const receiveSellerShipment = (id, body) => data(api.post(`shipments/${id}/receive`, body));

/* ---- SELLER WAREHOUSE → WAREHOUSE TRANSFER ----------------------------- */
// The seller mirror of the COMPANY warehouse-transfer endpoints. Entirely
// separate from the SELLER → CUSTOMER order calls above (scanSellerShipment /
// previewSellerBoxLabel / dispatchSellerOrder / getSellerDeliveryLabel), which
// are untouched: a warehouse transfer carries no customer, address or delivery
// label, so it uses the simple transfer box + box label flow instead.
//
// What must be scanned, per product.
export const getSellerTransferChecklist = (id) => data(api.get(`shipments/${id}/transfer-checklist`));
// Resolve ONE label (lot / bulk package / main box / inner box / unit). Saves
// nothing — the server derives the product, warehouse and quantity itself.
export const sellerTransferScan = (id, body) => data(api.post(`shipments/${id}/transfer-scan`, body));
// Pack the ticked scanned units into a NEW transfer box, and undo one.
export const packSellerTransferBox = (id, body) => data(api.post(`shipments/${id}/transfer-box`, body));
export const discardSellerTransferBox = (id, sellerBoxId) =>
  data(api.post(`shipments/${id}/transfer-box/discard`, { sellerBoxId }));
// Closing the transfer without dispatching — every DRAFT box is discarded and
// its units become loose stock again. Idempotent, and harmless once dispatched.
export const abandonSellerTransferBoxes = (id) => data(api.post(`shipments/${id}/transfer-abandon`, {}));
// Every box packed for this transfer, with the contents each label prints.
export const getSellerTransferBoxes = (id) => data(api.get(`shipments/${id}/transfer-boxes`));
// THE ONLY CALL THAT MOVES STOCK — it re-validates every scanned code first,
// and refuses unless the transfer carries BOTH a challan number and a challan
// document. Accepts a FormData so that document (image or PDF) can travel with
// the dispatch; axios sets the multipart boundary itself.
export const dispatchSellerTransfer = (id, body) => data(api.post(`shipments/${id}/transfer-dispatch`, body));
// The shipping label, re-printable by the source warehouse after dispatch.
export const getSellerTransferManifest = (id) => data(api.get(`shipments/${id}/transfer-manifest`));
// Receiving at the destination, box label by box label. Partial is fine.
export const getSellerTransferReceiveChecklist = (id) => data(api.get(`shipments/${id}/transfer-receive-checklist`));
export const sellerTransferReceiveScan = (id, body) => data(api.post(`shipments/${id}/transfer-receive-scan`, body));
export const receiveSellerTransfer = (id, body) => data(api.post(`shipments/${id}/transfer-receive`, body));

/* ---- traceability (owner-aware) ---- */
export const sellerTraceUnit = (serial) => data(api.get(`trace/unit/${encodeURIComponent(serial)}`));
export const sellerTraceLot = (lotNumber) => data(api.get(`trace/lot/${encodeURIComponent(lotNumber)}`));

/* ---- analytics / dashboard (owner + warehouse-scoped) ---- */
export const getSellerDashboardSummary = () => data(api.get("reports/dashboard"));
export const getSellerReportList = () => data(api.get("reports"));
export const runSellerReport = (name, params = {}) => data(api.get(`reports/${name}`, { params }));
export const downloadSellerReportCsv = async (name, params = {}) => {
  const res = await api.get(`reports/${name}`, { params: { ...params, format: "csv" }, responseType: "blob" });
  const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${name}.csv`; document.body.appendChild(a); a.click(); a.remove();
  window.URL.revokeObjectURL(url);
};

/* ---- unit labels: view / (re)print / scan / history (Phase 4b) ---- */
export const getSellerUnits = (params = {}) => data(api.get("units", { params }));
export const printSellerUnits = (serials) => data(api.post("units/print", { serials }));
export const sellerScan = (code) => data(api.post("scan", { code }));
export const sellerUnitHistory = (serial) => data(api.get(`units/${serial}/history`));

/* ---- customers & dealers (Phase 5a) ---- */
export const getSellerCustomers = (params = {}) => data(api.get("customers", { params }));
export const createSellerCustomer = (body) => data(api.post("customers", body));
export const updateSellerCustomer = (id, body) => data(api.put(`customers/${id}`, body));
export const getSellerCustomerHistory = (id) => data(api.get(`customers/${id}/history`));

/* ---- outbound sales / orders (Phase 5b) ---- */
export const getSellerOrders = (params = {}) => data(api.get("orders", { params }));
export const getSellerOrder = (id) => data(api.get(`orders/${id}`));
export const getSellerOrderPicklist = (id) => data(api.get(`orders/${id}/picklist`));
export const createSellerOrder = (body) => data(api.post("orders", body));
export const getSellerOrderSourceOptions = (id) => data(api.get(`orders/${id}/source-options`));
// `body` carries the status plus, on "confirmed", the sourceWarehouseId the
// seller picked. Callers that pass a bare status string keep working.
export const updateSellerOrderStatus = (id, statusOrBody) =>
  data(api.patch(`orders/${id}/status`, typeof statusOrBody === "string" ? { status: statusOrBody } : statusOrBody));

/* ---- subscription / billing ---- */
export const getSellerSubscription = () => data(api.get("subscription/me"));
export const getSellerPlans = () => data(api.get("subscription/plans"));
export const changeSellerPlan = (plan) => data(api.post("subscription/change", { plan }));

// Seller feature keys (mirror config/plans.js). Tag premium SELLER_MODULES with these.
export const SELLER_FEATURES = {
  INVENTORY_VIEW: "inventory_view",
  UNIT_LABELS: "unit_labels",
  MULTI_WAREHOUSE: "multi_warehouse",
  ADVANCED_ANALYTICS: "advanced_analytics",
};

/* ---- RBAC stub (Phase 1): seller_admin holds everything within its scope.
   Real gating (capabilities / subscription) is wired in later phases. ---- */
export const sellerCan = () => true;