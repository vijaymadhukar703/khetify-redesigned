const express = require('express');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');
const { load: loadEnv } = require('./config/env');
const env = loadEnv(); // fail-fast on missing required vars (after dotenv)
require('newrelic');
const logger = require('./services/logger');
const requestId = require('./middlewares/requestId');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

const app = express();
app.set('trust proxy', 1); // correct client IPs behind a proxy (rate-limit/logs)

/* ----- existing marketplace routes (stay under routes/Company/) ----- */
const companyRoutes = require("./routes/Company/companyRoutes");
const productRoutes = require("./routes/Company/productRoutes");
const hsnRoutes = require("./routes/Master/hsnRoutes");

/* ----- NEW: IMS routes (siblings of Company, NOT inside it) ----- */
const subscriptionRoutes = require("./routes/Subscription/subscriptionRoutes");
const inventoryRoutes = require("./routes/Inventory/inventoryRoutes");
const warehouseRoutes = require("./routes/Warehouse/warehouseRoutes");
const supplyRoutes = require("./routes/Supply/supplyRoutes");
const notificationRoutes = require("./routes/Notification/notificationRoutes");
const supportRoutes = require("./routes/Support/supportRoutes");
const chatRoutes = require("./routes/Support/chatRoutes"); // company↔admin live support chat (company side)
const adminChatRoutes = require("./routes/Support/adminChatRoutes"); // live support chat (admin side)
const lotRoutes = require("./routes/Inventory/lotRoutes");
// Repack cartons assembled at dispatch out of loose picked units.
const repackRoutes = require("./routes/Inventory/repackRoutes");
const transportRoutes = require("./routes/Transport/transportRoutes");
const orderRoutes = require("./routes/Order/orderRoutes");
const analyticsRoutes = require("./routes/Analytics/analyticsRoutes");
const userRoutes = require("./routes/User/userRoutes");
const purchasingRoutes = require("./routes/Purchase/purchasingRoutes");
const authRoutes = require("./routes/Auth/authRoutes");
const adminRoutes = require("./routes/Admin/adminRoutes"); // Platform admin (company review/approval)
const locationRoutes = require("./routes/Warehouse/locationRoutes"); // data API retained: Operations (Receive Stock) uses storage bins
const grnRoutes = require("./routes/Inventory/grnRoutes");
const putawayRoutes = require("./routes/Inventory/putawayRoutes");
const returnRoutes = require("./routes/Order/returnRoutes");
const adjustmentRoutes = require("./routes/Inventory/adjustmentRoutes");
// REMOVED MODULE (Counts): routes no longer mounted. Model/service kept for data integrity.
// const cycleCountRoutes = require("./routes/Inventory/cycleCountRoutes");
const { units: unitRoutes, scan: scanRoutes, recall: recallRoutes } = require("./routes/Barcode/barcodeRoutes");
const customerRoutes = require("./routes/Sales/customerRoutes");
const traceRoutes = require("./routes/Sales/traceRoutes");
const { picklists: pickListRoutes, packages: packageRoutes, dispatch: dispatchRoutes } = require("./routes/Outbound/outboundRoutes");
const { vehicles: vehicleRoutes, drivers: driverMgmtRoutes, shipments: shipmentRoutes, driver: driverMobileRoutes, transferRequests: transferRequestRoutes } = require("./routes/Transport/tmsRoutes");
const { mgmt: integrationMgmtRoutes, pos: integrationPosRoutes } = require("./routes/Integration/integrationRoutes");
const reportRoutes = require("./routes/Analytics/reportRoutes");
const costingRoutes = require("./routes/Costing/costingRoutes");
const shipmentCostRoutes = require("./routes/Transport/shipmentCostRoutes");
const ownerRoutes = require("./routes/Analytics/ownerRoutes");
const auditRoutes = require("./routes/Audit/auditRoutes");
const shopRoutes = require("./routes/Shop/shopRoutes"); // Public customer storefront (/customer-shop) — browse + consumer auth + checkout
const sellerRoutes = require("./routes/Seller/sellerRoutes"); // Seller-side IMS (Phase 1: auth + portal)
const sellerWarehouseRoutes = require("./routes/Seller/sellerWarehouseRoutes"); // Seller warehouses (Phase 2b)
const sellerCatalogRoutes = require("./routes/Seller/sellerCatalogRoutes"); // Seller read-only catalog (Phase 2c)
const sellerSupplyRoutes = require("./routes/Seller/sellerSupplyRoutes"); // Seller-initiated supply requests (Phase 3)
const sellerInventoryRoutes = require("./routes/Seller/sellerInventoryRoutes"); // Seller read-only inventory/lots (Phase 4a)
const sellerTransferRoutes = require("./routes/Seller/sellerTransferRoutes"); // Seller inter-warehouse transfers
const sellerShipmentRoutes = require("./routes/Seller/sellerShipmentRoutes"); // Seller shipments (dispatch + scan-receive)
const sellerTraceRoutes = require("./routes/Seller/sellerTraceRoutes"); // Seller traceability
const sellerReportRoutes = require("./routes/Seller/sellerReportRoutes"); // Seller analytics / dashboard
const { units: sellerUnitRoutes, scan: sellerScanRoutes } = require("./routes/Seller/sellerBarcodeRoutes"); // Seller labels/scan (Phase 4b)
const sellerCustomerRoutes = require("./routes/Seller/sellerCustomerRoutes"); // Seller customers & dealers (Phase 5a)
const sellerOrderRoutes = require("./routes/Seller/sellerOrderRoutes"); // Seller outbound sales (Phase 5b)
const sellerSubscriptionRoutes = require("./routes/Seller/sellerSubscriptionRoutes"); // Seller subscription/billing
const sellerTeamRoutes = require("./routes/Seller/sellerTeamRoutes"); // Seller team / roles (RBAC)
const { documents: sellerDocumentsRoutes, applications: sellerPcAppRoutes, certificates: sellerCertRoutes, listings: sellerListingRoutes } = require("./routes/Seller/sellerPcRoutes"); // Principal Certificate (seller side)
const { form: companyPcFormRoutes, applications: companyPcAppRoutes, certificates: companyCertRoutes, sellerDocuments: companySellerDocRoutes } = require("./routes/Company/companyPcRoutes"); // Principal Certificate (company side)
const { startJobs } = require("./jobs");
const principalRouteGuard = require("./middlewares/principalRouteGuard"); // seller↔company route isolation

/* ----- NEW: realtime ----- */
const { initSocket } = require("./sockets");

// Absolute path so local-served file URLs (/uploads/<key>) resolve regardless
// of the process working directory — matches where services/storage.js writes.
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* =========================
   Middlewares
========================= */
app.use(helmet());
// CORS allowlist from env (CORS_ORIGINS=comma,separated). "*" allows all.
const corsAllow = env.corsOrigins;
app.use(cors({
  origin: corsAllow.includes("*") ? true : corsAllow,
}));
app.use(express.json({ limit: "2mb" }));
app.use(requestId);
app.use(pinoHttp({ logger, customProps: (req) => ({ reqId: req.id }), autoLogging: { ignore: (req) => req.url === "/healthz" } }));

// Rate limiting — global, with a stricter limiter on auth/login routes.
const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many attempts, try again later" } });
app.use("/api", globalLimiter);
app.use(["/api/company/login", "/api/company/register", "/api/company/forgot-password", "/api/company/reset-password", "/api/driver/login", "/api/seller/login", "/api/seller/register", "/api/admin/login", "/api/shop/auth/login", "/api/shop/auth/register"], authLimiter);

// Defence in depth: a seller token may only reach /api/seller/*, and no other
// principal may. Runs before every route mount; no-ops for tokenless/public
// requests. The primary fix is at the login layer (owner-scoped lookups).
app.use(principalRouteGuard);

// Healthcheck (DB ping) — before routes, excluded from auth.
app.get("/healthz", (req, res) => {
  const up = mongoose.connection.readyState === 1;
  res.status(up ? 200 : 503).json({ status: up ? "ok" : "degraded", db: up ? "connected" : "down" });
});

app.use("/api/lots", lotRoutes);
app.use("/api/repack-boxes", repackRoutes);
app.use("/api/transport", transportRoutes);

/* =========================
   PORT
========================= */
const PORT = env.port;

/* =========================
   MongoDB Connection
========================= */
// Drop legacy indexes left over from earlier schema versions. The subscriptions
// collection once had a UNIQUE index on companyId (when a subscription belonged
// only to a company). Subscriptions are now owner-polymorphic (ownerType/
// ownerId), so SELLER subscriptions carry companyId:null — a unique index can't
// hold two nulls, throwing "E11000 … companyId: null". Drop it if present.
async function dropLegacyIndexes() {
  try {
    const coll = mongoose.connection.collection('subscriptions');
    const idx = await coll.indexes();
    if (idx.some((i) => i.name === 'companyId_1')) {
      await coll.dropIndex('companyId_1');
      logger.info('🧹 Dropped legacy subscriptions.companyId_1 unique index');
    }
  } catch (err) {
    logger.warn({ err }, 'legacy index cleanup skipped');
  }
}

mongoose
  .connect(env.mongoUri)
  .then(async () => {
    logger.info('✅ MongoDB Connected');
    await dropLegacyIndexes(); // self-heal stale unique indexes before serving
    startJobs(); // schedule background jobs (ABC classification, outbox) after DB is up
  })
  .catch(err => logger.error({ err }, '❌ MongoDB Error'));

/* =========================
   Routes
========================= */
app.get('/api', (req, res) => {
  res.send('🚀 Khetify Backend Running');
});

// Marketplace
// PC company routes BEFORE the /api/company catch-all, whose GET /:id would
// otherwise capture "pc-applications"/"certificates" as a company id.
app.use("/api/company/pc-form", companyPcFormRoutes); // PC: company-configurable application form
app.use("/api/company/pc-applications", companyPcAppRoutes); // PC: company review queue
app.use("/api/company/certificates", companyCertRoutes); // PC: company certificate management
app.use("/api/company/seller-documents", companySellerDocRoutes); // PC: verify/reject seller docs
app.use("/api/company", companyRoutes);
app.use("/api/product", productRoutes);
app.use("/api/hsn", hsnRoutes); // GST rate master lookup (read-only)

// Auth (identity + capabilities for the frontend)
app.use("/api/auth", authRoutes);
app.use("/api/admin/chats", adminChatRoutes); // live support chat (admin) — before /api/admin so the specific path wins
app.use("/api/admin", adminRoutes); // platform admin: company review/approval + dashboard

// IMS
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/warehouse", warehouseRoutes);
app.use("/api/locations", locationRoutes); // Locations management UI removed; bin/location data API retained for Operations
app.use("/api/grn", grnRoutes);
app.use("/api/putaway", putawayRoutes);
app.use("/api/returns", returnRoutes);
app.use("/api/adjustments", adjustmentRoutes);
// app.use("/api/cycle-counts", cycleCountRoutes); // Counts module removed
app.use("/api/units", unitRoutes);
app.use("/api/scan", scanRoutes);
app.use("/api/recall", recallRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/trace", traceRoutes);
app.use("/api/picklists", pickListRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/dispatch", dispatchRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/drivers", driverMgmtRoutes);
app.use("/api/shipments", shipmentRoutes);
app.use("/api/transfer-requests", transferRequestRoutes);
app.use("/api/driver", driverMobileRoutes);
app.use("/api/integrations/pos", integrationPosRoutes); // API-key (machine) plane
app.use("/api/integrations", integrationMgmtRoutes); // JWT (admin) plane
app.use("/api/reports", reportRoutes);
app.use("/api/costing", costingRoutes);
app.use("/api/transport-costs", shipmentCostRoutes);
app.use("/api/owner", ownerRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/supply-order", supplyRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/chat", chatRoutes); // company↔admin live support chat (company side)
app.use("/api/orders", orderRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/users", userRoutes);
app.use("/api/purchasing", purchasingRoutes);
app.use("/api/shop", shopRoutes); // public customer storefront (browse + consumer auth + checkout)
app.use("/api/seller/warehouses", sellerWarehouseRoutes); // before /api/seller so the specific path wins
app.use("/api/seller/products", sellerCatalogRoutes); // read-only catalog of the linked company
app.use("/api/seller/supply-orders", sellerSupplyRoutes); // seller-initiated supply requests
app.use("/api/seller/lots", sellerInventoryRoutes); // read-only seller inventory/lots
app.use("/api/seller/transfers", sellerTransferRoutes); // seller inter-warehouse transfer requests
app.use("/api/seller/shipments", sellerShipmentRoutes); // seller shipments (dispatch + scan-receive)
app.use("/api/seller/trace", sellerTraceRoutes); // seller traceability
app.use("/api/seller/reports", sellerReportRoutes); // seller analytics / dashboard
app.use("/api/seller/units", sellerUnitRoutes); // seller unit labels (view/print/history)
app.use("/api/seller/scan", sellerScanRoutes); // seller unit scan
app.use("/api/seller/customers", sellerCustomerRoutes); // seller customers & dealers
app.use("/api/seller/orders", sellerOrderRoutes); // seller outbound sales
app.use("/api/seller/subscription", sellerSubscriptionRoutes); // seller subscription/billing
app.use("/api/seller/team", sellerTeamRoutes); // seller team / roles (RBAC)
app.use("/api/seller/documents", sellerDocumentsRoutes); // PC: KYC/business documents
app.use("/api/seller/pc-applications", sellerPcAppRoutes); // PC: applications + agreement
app.use("/api/seller/certificates", sellerCertRoutes); // PC: issued certificates + govt
app.use("/api/seller/listings", sellerListingRoutes); // PC-gated marketplace listings
app.use("/api/seller", sellerRoutes); // Seller-side IMS portal (additive; company mounts untouched)

/* ----- 404 + central error handler (must be last) ----- */
app.use("/api", notFound);
app.use(errorHandler);

/* =========================
   Server + Socket.IO Start
========================= */
const server = http.createServer(app);
initSocket(server); // attaches Socket.IO to the same HTTP server

server.listen(PORT, () => {
  logger.info(`🔥 Server running on port ${PORT}`);
});

/* ----- Graceful shutdown ----- */
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down`);
  server.close(async () => {
    try { await mongoose.connection.close(); } catch { /* ignore */ }
    process.exit(0);
  });
  // Force-exit if connections hang.
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));