// ─────────────────────────────────────────────────────────────
// IMS API layer — every IMS page calls the backend through here.
// Follows the same pattern as hooks/useInventory.js:
// BASE_URL from config + Bearer token from localStorage.
// ─────────────────────────────────────────────────────────────
import axios from "axios";
import config from "../../config/config";

const api = axios.create({ baseURL: config.BASE_URL });

api.interceptors.request.use((req) => {
  const token = localStorage.getItem("token");
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

const data = (p) => p.then((r) => r.data);

/* ---- lots & batches (NEW backend: /api/lots) ---- */
export const getLots = (params = {}) => data(api.get("lots", { params }));
export const receiveLot = (body) => data(api.post("lots/receive", body));
export const transferLot = (body) => data(api.post("lots/transfer", body));
export const sellFefo = (body) => data(api.post("lots/sell-fefo", body));

/* ---- existing inventory endpoints ---- */
export const getInventory = (params = {}) => data(api.get("inventory", { params }));
export const getMovements = (productId) => data(api.get(`inventory/${productId}/movements`));

/* ---- account self-service (team members incl. Warehouse Managers) ----
   Same team auth as the rest of the app; no separate login. change-password
   is scoped server-side to the CALLER's own account, so no id is sent. */
export const changeMyPassword = (body) => data(api.post("users/change-password", body));
export const requestMemberPasswordReset = (body) => data(api.post("users/forgot-password", body));

/* ---- downstream sellers — the company's PC-issued (authorized) resellers ---- */
export const getCompanySellers = () => data(api.get("company/sellers"));

/* ---- Principal Certificate (company side) ---- */
// The company-configurable PC application form (builder).
export const getCompanyPcForm = () => data(api.get("company/pc-form"));
export const saveCompanyPcForm = (fields) => data(api.put("company/pc-form", { fields }));
export const getCompanyPcApplications = (status) => data(api.get("company/pc-applications", { params: status ? { status } : {} }));
export const getCompanyPcApplication = (id) => data(api.get(`company/pc-applications/${id}`));
export const reviewPcApplication = (id) => data(api.post(`company/pc-applications/${id}/review`));
export const requestPcDocs = (id, body) => data(api.post(`company/pc-applications/${id}/request-docs`, body));
export const rejectPcApplication = (id, reason) => data(api.post(`company/pc-applications/${id}/reject`, { reason }));
export const approvePcApplication = (id) => data(api.post(`company/pc-applications/${id}/approve`));
export const attachPcAgreement = (id, formData) => data(api.post(`company/pc-applications/${id}/agreement/attach`, formData));
export const issuePc = (id, body) => data(api.post(`company/pc-applications/${id}/issue-pc`, body));
export const getCompanyCertificates = (status) => data(api.get("company/certificates", { params: status ? { status } : {} }));
export const revokeCertificate = (id, reason) => data(api.post(`company/certificates/${id}/revoke`, { reason }));
export const reinstateCertificate = (id) => data(api.post(`company/certificates/${id}/reinstate`));
export const verifySellerDocument = (id, note) => data(api.post(`company/seller-documents/${id}/verify`, { note }));
export const rejectSellerDocument = (id, note) => data(api.post(`company/seller-documents/${id}/reject`, { note }));

/* ---- inbound supply requests from sellers (company side, Phase 3) ---- */
// `params.stage` (pick|pack|dispatch) narrows to a Send Stock tab.
export const getSupplyOrders = (params = {}) => data(api.get("supply-order", { params }));
export const getSupplyPendingCount = () => data(api.get("supply-order/pending-count"));
// Per-warehouse availability for the order's items (drives "Assign a source warehouse").
export const getSupplySourceOptions = (id) => data(api.get(`supply-order/${id}/source-options`));
// READ-ONLY detail for one request: summary + parent lots + the exact child
// serials picked. Fetched only when opening View Details.
export const getSupplyOrderDetails = (id) => data(api.get(`supply-order/${id}/details`));
export const updateSupplyStatus = (id, body) => data(api.put(`supply-order/${id}/status`, body));
// Direct pick/pack/dispatch on the supply order (no PickList/wave).
export const pickSupplyOrder = (id, body) => data(api.post(`supply-order/${id}/pick`, body));
export const packSupplyOrder = (id, body = {}) => data(api.post(`supply-order/${id}/pack`, body));
// Ensure a planned shipment + manifest token for the label barcode (idempotent).
export const getSupplyManifest = (id) => data(api.get(`supply-order/${id}/manifest`));
export const dispatchSupplyOrder = (id, body) => data(api.post(`supply-order/${id}/dispatch`, body));

/* ---- warehouses (existing backend) ---- */
export const getWarehouses = () => data(api.get("warehouse"));
// Full company warehouse directory (names only) — for transfer/shipment
// DESTINATION pickers; unaffected by the caller's warehouse scope.
export const getWarehouseDirectory = () => data(api.get("warehouse", { params: { directory: 1 } }));
export const createWarehouse = (body) => data(api.post("warehouse", body));
export const updateWarehouse = (id, body) => data(api.put(`warehouse/${id}`, body));

/* ---- storage locations / bins (NEW backend: /api/locations) ---- */
export const getLocations = (params = {}) => data(api.get("locations", { params }));
export const getLocationBins = (params = {}) => data(api.get("locations/bins", { params }));
export const createLocation = (body) => data(api.post("locations", body));
export const generateLocations = (body) => data(api.post("locations/generate", body));
export const moveBinStock = (body) => data(api.post("locations/move", body));

/* ---- transport (legacy backend: /api/transport) ---- */
export const getShipments = (params = {}) => data(api.get("transport", { params }));
export const createShipment = (body) => data(api.post("transport", body));
export const updateShipmentStatus = (id, status) =>
  data(api.patch(`transport/${id}/status`, { status }));

/* ---- TMS: vehicles / drivers / shipments (NEW backend) ---- */
export const getVehicles = () => data(api.get("vehicles"));
export const createVehicle = (body) => data(api.post("vehicles", body));
export const getDrivers = () => data(api.get("drivers"));
export const createDriver = (body) => data(api.post("drivers", body));
export const getTmsShipments = (params = {}) => data(api.get("shipments", { params }));
// Shipment Box labels for one consignment — printed from Shipment Tracking.
export const getShipmentBoxes = (shipmentId) => data(api.get(`shipments/${shipmentId}/boxes`));
export const getTmsShipment = (id) => data(api.get(`shipments/${id}`));
export const createTmsShipment = (body) => data(api.post("shipments", body));

/* ---- repack cartons (loose picked units → one new box, at dispatch) ----
   The box is a LAYER: every unit keeps its original lot and original box, so
   receiving still lands each unit in its own lot. */
export const packRepackBox = (body) => data(api.post("repack-boxes", body));
export const getRepackBox = (id) => data(api.get(`repack-boxes/${encodeURIComponent(id)}`));
// Every carton packed for one shipment, each with its full contents — what the
// Shipments table's "Box Packaging" list is drawn from. Packed boxes only; an
// unpacked one is an audit record, not a box.
export const listRepackBoxes = (shipmentId) => data(api.get("repack-boxes", { params: { shipmentId } }));

/* ---- receiving a transfer BY SCANNING ITS CARTONS ----
   Beside the shipping-label path (verifyShipment), not instead of it: one label
   is minted per shipment, so a transfer arriving as five cartons needs the IDs
   already printed on those cartons. receiveScan resolves ONE code (shipping
   label, lot number, bulk packaging / inner box, repack box or unit) and moves
   nothing; receiveUnits lands what was scanned, and may be run again later for
   the rest. */
export const getReceiveChecklist = (id) => data(api.get(`shipments/${id}/receive-checklist`));
export const receiveScan = (id, body) => data(api.post(`shipments/${id}/receive-scan`, body));
export const receiveUnits = (id, body) => data(api.post(`shipments/${id}/receive-units`, body));
export const unpackRepackBox = (id) => data(api.post(`repack-boxes/${encodeURIComponent(id)}/unpack`));
// REMOVE a carton that was never dispatched — the box row goes, its units come
// back loose. Distinct from unpack, which keeps the box as a history record.
export const discardRepackBox = (id) => data(api.delete(`repack-boxes/${encodeURIComponent(id)}`));

/* ---- COMPANY WAREHOUSE → SELLER transfer (warehouse-initiated, scan-verified) ----
   Same supply rails as a seller's inbound request, opposite direction of
   initiative: the warehouse scans the stock and pushes it to the seller, who
   then receives it with the returned manifest code on their own Supply screen. */
// Pickers: source warehouses this operator may send from + PC-authorized sellers.
export const getSellerTransferOptions = () => data(api.get("supply-order/transfer/options"));
// What the source warehouse currently holds, per product: available quantity
// and how many LABELED units are on the shelf (the real scanning ceiling).
export const getSellerTransferProducts = (warehouseId) =>
  data(api.get("supply-order/transfer/products", { params: { warehouseId } }));
// Resolve ONE scanned Lot Number / Bulk Packaging ID / Unit Code. Read-only.
export const scanSellerTransferItem = (body) => data(api.post("supply-order/transfer/scan", body));
// The single write: reserves, packs, ships and dispatches the scanned units.
// Accepts a plain object OR a FormData (when challan/bill/bilty copies are
// attached). axios sets the multipart boundary itself when given FormData, so
// no Content-Type is forced here.
export const confirmSellerTransfer = (body) => data(api.post("supply-order/transfer", body));
// An APPROVED seller request turned into the transfer form's starting values —
// seller, their warehouse, product and approved quantity.
export const getSellerTransferPrefill = (supplyOrderId) =>
  data(api.get(`supply-order/transfer/${supplyOrderId}/prefill`));
// The transfer's paperwork and its uploaded copies, with fresh signed URLs.
export const getSellerTransferDocuments = (supplyOrderId) =>
  data(api.get(`supply-order/transfer/${supplyOrderId}/documents`));
// The Shipment Box labels of one transfer, for re-printing.
export const getSellerTransferBoxes = (supplyOrderId) =>
  data(api.get(`supply-order/transfer/${supplyOrderId}/boxes`));
// Recent transfers pushed from this warehouse, with live status.
export const getSellerTransferHistory = (params = {}) => data(api.get("supply-order/transfer/history", { params }));

/* ---- inter-warehouse stock requests (B asks A; A accepts/rejects) ---- */
export const getTransferRequests = (params = {}) => data(api.get("transfer-requests", { params }));
export const createTransferRequest = (body) => data(api.post("transfer-requests", body));
export const acceptTransferRequest = (id, body = {}) => data(api.post(`transfer-requests/${id}/accept`, body));
export const rejectTransferRequest = (id, body = {}) => data(api.post(`transfer-requests/${id}/reject`, body));

export const approveShipment = (id) => data(api.post(`shipments/${id}/approve`));
// DISPATCH. Accepts a FormData so the DELIVERY CHALLAN (image or PDF) can
// travel with the dispatch — axios sets the multipart boundary itself, so no
// Content-Type is set here. A plain object still works unchanged: the route's
// multer middleware passes a JSON body straight through.
export const dispatchShipment = (id, body = {}) => data(api.post(`shipments/${id}/dispatch`, body));
// Warehouse→warehouse transfer scan-out. The checklist is what the shipment
// should contain; dispatchScan checks ONE code against it. Both read-only — the
// dispatch call re-verifies the whole set server-side.
export const getDispatchChecklist = (id) => data(api.get(`shipments/${id}/dispatch-checklist`));
export const dispatchScan = (id, body) => data(api.post(`shipments/${id}/dispatch-scan`, body));
export const verifyShipment = (id, body) => data(api.post(`shipments/${id}/verify`, body));
// Inventory → Receive Lot: resolve an EXACT parent lot number to the incoming
// transfer awaiting this warehouse. Read-only; confirm via verifyShipment.
export const getIncomingTransferByLot = (lot) => data(api.get("shipments/incoming", { params: { lot } }));
// Company Warehouse Receive Lot: an EXACT parent lot booked to this warehouse
// but awaiting its receipt (inTransitStock). Read-only.
export const getIncomingLot = (lot) => data(api.get("lots/incoming", { params: { lot } }));
// The ONLY call that turns that pending qty into this warehouse's stock — for a
// SINGLE-PACKAGE lot. A lot packed into boxes is refused here; see below.
export const confirmLotReceipt = (id) => data(api.post(`lots/${id}/confirm-receipt`));

// Read-only Lot Details page: lot + stock context + packaging + boxes + units
// + ledger history in one request. Never used by the Inventory list. LIVE view:
// its units are the ones CURRENTLY in this Inventory row.
export const getLotDetails = (lotId) => data(api.get(`lots/${lotId}/details`));
// WHICH unit numbers make up a lot row's available quantity right now, as
// compressed ranges (Analytics → Product Details → View Available Units).
export const getLotAvailableUnits = (lotId) => data(api.get(`lots/${lotId}/available-units`));

// Read-only IMMUTABLE transfer snapshot for Warehouse → Transfer History → View.
// Returns the SAME shape as getLotDetails, but the units/quantity are the
// ORIGINAL arrival (reconstructed from originalQuantity + every unit ever minted
// for the lot), so a later warehouse→warehouse transfer never shrinks it.
export const getLotTransferSnapshot = (lotId) => data(api.get(`lots/${lotId}/transfer-snapshot`));

/* ---- Bulk Packaging (one identity per PHYSICAL OUTER BOX of a lot) ---- */
// Every box of a lot — drives the box list and the printable box labels.
export const getBulkPackages = (lotId) => data(api.get(`lots/${lotId}/bulk-packages`));
// Resolve ONE scanned Bulk Packaging ID. Read-only; moves nothing.
export const getIncomingBox = (code) => data(api.get("lots/incoming-box", { params: { code } }));
// Receive ONE box: books exactly that box's units. Atomic and once-only.
export const receiveBulkPackage = (bulkPackagingId) =>
  data(api.post("lots/receive-box", { bulkPackagingId }));
export const deliverShipment = (id, body) => data(api.post(`shipments/${id}/deliver`, body));
export const shipmentException = (id, body) => data(api.post(`shipments/${id}/exception`, body));
export const getDiscrepancies = (params = {}) => data(api.get("shipments/discrepancies", { params }));

/* ---- driver mobile (NEW backend: /api/driver) ---- */
export const driverLogin = (body) => data(api.post("driver/login", body));
export const driverShipments = () => data(api.get("driver/shipments"));
export const driverArrived = (id, body) => data(api.post(`driver/shipments/${id}/arrived`, body));
export const driverPod = (id, body) => data(api.post(`driver/shipments/${id}/pod`, body));
export const driverException = (id, body) => data(api.post(`driver/shipments/${id}/exception`, body));

/* ---- products (existing backend, for the Receive Lot dropdown) ---- */
export const getProducts = () => data(api.get("product/all"));

/* ---- customers + traceability (NEW backend: /api/customers, /api/trace) ---- */
export const getCustomers = (params = {}) => data(api.get("customers", { params }));
export const getCustomer = (id) => data(api.get(`customers/${id}`));
export const getCustomerHistory = (id) => data(api.get(`customers/${id}/history`));
export const createCustomer = (body) => data(api.post("customers", body));
export const updateCustomer = (id, body) => data(api.patch(`customers/${id}`, body));
export const traceSerial = (serial) => data(api.get(`trace/serial/${serial}`));
export const traceLot = (lot) => data(api.get(`trace/lot/${lot}`));
export const traceInvoice = (inv) => data(api.get(`trace/invoice/${inv}`));

/* ---- outbound: pick / pack / dispatch (NEW backend) ---- */
export const generateWave = (body) => data(api.post("picklists/generate", body));
export const getPickLists = (params = {}) => data(api.get("picklists", { params }));
export const getPickList = (id) => data(api.get(`picklists/${id}`));
export const pickLine = (id, body) => data(api.post(`picklists/${id}/pick`, body));
// Direct order pick (no wave): { picks: [{ productId, serials?, qty?, binCode? }] }
export const pickOrder = (id, body) => data(api.post(`picklists/order/${id}/pick`, body));
// Resolve ONE code scanned in the Pick modal. The server decides — by exact
// database lookup — whether it is a Bulk Packaging ID, a unit code or a lot
// number, and returns the unit codes that scan selects. Read-only.
export const pickScan = (body) => data(api.post('picklists/scan', body));
export const getPackages = (params = {}) => data(api.get("packages", { params }));
export const createPackage = (body) => data(api.post("packages", body));
export const dispatchOrder = (body) => data(api.post("dispatch", body));

/* ---- orders (NEW backend: /api/orders) ---- */
export const createOrder = (body) => data(api.post("orders", body));
export const getOrders = (params = {}) => data(api.get("orders", { params }));
export const getOrderSummary = (params = {}) => data(api.get("orders/summary", { params }));
export const getOrderHistory = (params = {}) => data(api.get("orders/history", { params }));
// Read-only traceability for one transfer/shipment: summary + parent lots + the
// exact child serials it moved. Warehouse-scoped server-side.
export const getShipmentDetails = (id) => data(api.get(`shipments/${id}/details`));
export const getOrder = (id) => data(api.get(`orders/${id}`));
export const getOrderPicklist = (id) => data(api.get(`orders/${id}/picklist`));
export const updateOrderStatus = (id, status) => data(api.patch(`orders/${id}/status`, { status }));

/* ---- analytics (NEW backend: /api/analytics) ---- */
export const getAnalytics = () => data(api.get("analytics/overview"));

/* ---- reports (NEW backend: /api/reports) ---- */
export const getReportList = () => data(api.get("reports"));
export const getDashboardSummary = (params = {}) => data(api.get("reports/dashboard", { params }));
export const runReport = (name, params = {}) => data(api.get(`reports/${name}`, { params }));
export const downloadReportCsv = async (name, params = {}) => {
  const res = await api.get(`reports/${name}`, { params: { ...params, format: "csv" }, responseType: "blob" });
  const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${name}.csv`; document.body.appendChild(a); a.click(); a.remove();
  window.URL.revokeObjectURL(url);
};

/* ---- company profile (existing backend: /api/company) ---- */
export const getCompany = (id) => data(api.get(`company/${id}`));
// Own registration profile (identity + GSTIN/PAN + KYC docs as signed URLs),
// resolved from the token — no id needed (fixes the "No company id" path).
export const getCompanyProfile = () => data(api.get("company/profile"));
// Edit own profile — multipart (identity/compliance fields + replacement docs).
export const updateCompanyProfile = (formData) => data(api.patch("company/profile", formData));
export const updateCompany = (id, body) => data(api.put(`company/update/${id}`, body));

/* ---- support tickets (NEW backend: /api/support) ---- */
export const getSupportTickets = () => data(api.get("support/tickets"));
export const createSupportTicket = (body) => data(api.post("support/tickets", body));

/* ---- company IMS settings (NEW backend: /api/company/settings/ims) ---- */
export const getImsSettings = () => data(api.get("company/settings/ims"));
export const updateImsSettings = (body) => data(api.put("company/settings/ims", body));

/* ---- inbound: GRN / putaway (NEW backend: /api/grn, /api/putaway) ---- */
export const getGRNs = (params = {}) => data(api.get("grn", { params }));
export const getGRN = (id) => data(api.get(`grn/${id}`));
export const createGRN = (body) => data(api.post("grn", body));
export const receiveGRN = (id, body) => data(api.patch(`grn/${id}/receive`, body));
export const postGRN = (id) => data(api.post(`grn/${id}/post`));
export const writeoffDamaged = (body) => data(api.post("grn/writeoff", body));
export const getPutawayTasks = (params = {}) => data(api.get("putaway", { params }));
export const completePutaway = (id, body) => data(api.post(`putaway/${id}/complete`, body));

/* ---- adjustments (NEW backend: /api/adjustments) ---- */
export const getAdjustments = (params = {}) => data(api.get("adjustments", { params }));
export const createAdjustment = (body) => data(api.post("adjustments", body));
export const approveAdjustment = (id) => data(api.post(`adjustments/${id}/approve`));
export const rejectAdjustment = (id) => data(api.post(`adjustments/${id}/reject`));

/* ---- cycle counts / audits (NEW backend: /api/cycle-counts) ---- */
export const getCycleCounts = (params = {}) => data(api.get("cycle-counts", { params }));
export const getCycleCount = (id) => data(api.get(`cycle-counts/${id}`));
export const generateCount = (body) => data(api.post("cycle-counts/generate", body));
export const submitCount = (id, body) => data(api.patch(`cycle-counts/${id}/submit`, body));
export const completeCount = (id) => data(api.post(`cycle-counts/${id}/complete`));
export const cancelCount = (id) => data(api.post(`cycle-counts/${id}/cancel`));

/* ---- returns (NEW backend: /api/returns) ---- */
export const getReturns = (params = {}) => data(api.get("returns", { params }));
export const createReturn = (body) => data(api.post("returns", body));
export const postReturn = (id) => data(api.post(`returns/${id}/post`));

/* ---- unit barcodes / scan / recall (NEW backend: /api/units,/scan,/recall) ---- */
export const getUnits = (params = {}) => data(api.get("units", { params }));
// Unit-label count per lot, keyed by inventoryId — one call for every lot, so
// the Labels dropdown can show each lot's remaining label capacity.
export const getUnitCounts = () => data(api.get("units/counts"));
export const generateUnits = (body) => data(api.post("units/generate", body));
export const markUnitsPrinted = (serials) => data(api.post("units/print", { serials }));
export const getUnitHistory = (serial) => data(api.get(`units/history/${serial}`));
export const scanCode = (code) => data(api.post("scan", { code }));
export const recallLot = (lotNumber) => data(api.post("recall", { lotNumber }));

/* ---- integrations (NEW backend: /api/integrations) ---- */
export const getApiKeys = () => data(api.get("integrations/keys"));
export const createApiKey = (body) => data(api.post("integrations/keys", body));
export const revokeApiKey = (id) => data(api.delete(`integrations/keys/${id}`));
export const getWebhooks = () => data(api.get("integrations/webhooks"));
export const createWebhook = (body) => data(api.post("integrations/webhooks", body));
export const updateWebhook = (id, body) => data(api.patch(`integrations/webhooks/${id}`, body));
export const deleteWebhook = (id) => data(api.delete(`integrations/webhooks/${id}`));
export const testWebhook = (id) => data(api.post(`integrations/webhooks/${id}/test`));
export const getChannels = () => data(api.get("integrations/channels"));
export const connectChannel = (body) => data(api.post("integrations/channels", body));

/* ---- enterprise: owner KPIs, costing, reconciliation (NEW backend) ---- */
export const getOwnerDashboard = (params = {}) => data(api.get("owner/dashboard", { params }));
export const getProductCosts = () => data(api.get("costing"));
export const requestCostChange = (productId, body) => data(api.post(`costing/${productId}/request`, body));
export const approveCostChange = (productId, approve) => data(api.post(`costing/${productId}/approve`, { approve }));
export const getProfitability = (params = {}) => data(api.get("costing/profitability", { params }));
export const upsertShipmentCost = (shipmentId, body) => data(api.put(`transport-costs/${shipmentId}`, body));
export const getTransportCostSummary = (params = {}) => data(api.get("transport-costs/analytics/summary", { params }));
export const runReconcile = () => data(api.post("audit/reconcile"));

/* ---- auth identity + capabilities (NEW backend: /api/auth/me) ---- */
export const getMe = () => data(api.get("auth/me"));

/* ---- team / users (NEW backend: /api/users) ---- */
export const getUsers = () => data(api.get("users"));
export const createUser = (body) => data(api.post("users", body));
export const updateUser = (id, body) => data(api.patch(`users/${id}`, body));
export const deleteUser = (id) => data(api.delete(`users/${id}`));

/* ---- purchasing (NEW backend: /api/purchasing) ---- */
export const getVendors = () => data(api.get("purchasing/vendors"));
export const createVendor = (body) => data(api.post("purchasing/vendors", body));
export const getPurchaseOrders = () => data(api.get("purchasing/purchase-orders"));
export const createPurchaseOrder = (body) => data(api.post("purchasing/purchase-orders", body));
export const updatePurchaseOrderStatus = (id, status) =>
  data(api.patch(`purchasing/purchase-orders/${id}/status`, { status }));

/* ---- billing history (existing backend: /api/subscription) ---- */
export const getBillingHistory = () => data(api.get("subscription/payments"));

/* ---- notifications (existing backend: /api/notifications) ---- */
export const getNotifications = () => data(api.get("notifications"));
export const markNotificationRead = (id) => data(api.put(`notifications/${id}/read`));
export const markAllNotificationsRead = () => data(api.put("notifications/read-all"));
export const scanAlerts = () => data(api.post("notifications/scan"));

/* ---- shared display helpers ---- */
export const formatINR = (n) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export const daysToExpiry = (d) =>
  d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null;

export const expiryBadge = (d) => {
  const days = daysToExpiry(d);
  if (days === null) return { label: "No expiry", cls: "bg-stone-100 text-stone-500" };
  if (days < 0) return { label: "Expired", cls: "bg-red-50 text-red-600" };
  if (days <= 90) return { label: `${days}d left`, cls: "bg-orange-50 text-orange-600" };
  return { label: "Good", cls: "bg-green-50 text-green-600" };
};

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";