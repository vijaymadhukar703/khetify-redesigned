import React from 'react';
import { Routes, Route, Navigate, Outlet, useNavigate } from 'react-router-dom';// 🔥 IMS: subscription feature-gating provider
import { SubscriptionProvider } from './context/SubscriptionContext';
// 🔥 RBAC: role/capability provider (drives usePermission + <Can>)
import { PermissionProvider, usePermission } from './context/PermissionContext';
// Single source of truth for "is this a warehouse role" (mirrors the backend).
import { isWarehouseRole } from './lib/roles';
// 🔥 RBAC: page-level protection for role-gated routes
import RequireCap from './Components/ims/RequireCap';
import ErrorBoundary from './Components/ErrorBoundary';

// 1. Basic & Marketing Pages
import About from './pages/About';
import CompanyAbout from './pages/Company/CompanyAbout';
import CompanyRegister from './pages/Company/CompanyRegister';
// CompanyLogin hataya gaya
import CompanyRegisterSuccess from './pages/Company/CompanyRegisterSuccess';

// 2. Onboarding Steps (Steps 1 to 5)
import CompanySetup from './pages/Company/CompanySetup';
import CompanySetupStep2 from './pages/Company/CompanySetupStep2';
import CompanySetupStep3 from './pages/Company/CompanySetupStep3';
import CompanySetupStep4 from './pages/Company/CompanySetupStep4';
import CompanySetupStep5 from './pages/Company/CompanySetupStep5';
import CompanySubmissionComplete from './pages/Company/CompanySubmissionComplete';
import CompanyApprovalSuccess from './pages/Company/CompanyApprovalSuccess';

// 3. Dashboard Layout & Pages
import DashboardLayout from './Components/DashboardLayout';
import CompanyDashboard from './pages/Company/CompanyDashboard';
import CompanyUploadProduct from './pages/Company/CompanyUploadProduct';
import CompanyProductCatalog from './pages/Company/CompanyProductCatalog';
import CompanyReturns from './pages/Company/CompanyReturns';
import CompanySupport from './pages/Company/CompanySupport';
import CompanyFaq from './pages/Company/CompanyFaq';
import CompanyOrders from './pages/Company/CompanyOrders';

// 🔥 IMS: subscription / upgrade page
import Billing from './pages/Company/Billing';

// Edit Product Page Import
import CompanyEditProduct from './pages/Company/CompanyEditProduct';
import CompanyLogin from './pages/Company/CompanyLogin';
import CompanyForgotPassword from './pages/Company/CompanyForgotPassword';
import CompanyResetPassword from './pages/Company/CompanyResetPassword';

import ImsWarehouses from './pages/Company/ims/ImsWarehouses';
import DriverApp from './pages/Driver/DriverApp';
import ImsLabels from './pages/Company/ims/ImsLabels';
import ImsLotDetails from './pages/Company/ims/ImsLotDetails';
import ImsCustomers from './pages/Company/ims/ImsCustomers';
import ImsAnalytics from './pages/Company/ims/ImsAnalytics';
import AnalyticsProductDetails from './pages/Company/ims/AnalyticsProductDetails';
import WarehouseAnalyticsDetails from './pages/Company/ims/WarehouseAnalyticsDetails';
import ImsPurchasing from './pages/Company/ims/ImsPurchasing';
import CompanyNotifications from './pages/Company/CompanyNotifications';
import CompanyUsers from './pages/Company/CompanyUsers';
import CompanySettings from './pages/Company/CompanySettings';
import WarehouseSettings from './pages/Company/WarehouseSettings';
import CompanyProfile from './pages/Company/CompanyProfile';
import CompanySellers from './pages/Company/CompanySellers';
import CompanySupplyRequests from './pages/Company/CompanySupplyRequests';
import SupplyRequestDetail from './pages/Company/SupplyRequestDetail';
import WarehouseTransferHistory from './pages/Company/WarehouseTransferHistory';
import WarehouseTransferDetail from './pages/Company/WarehouseTransferDetail';
import CompanyPcApplications from './pages/Company/CompanyPcApplications';

// New card-based navigation + merged modules
import Hub from './pages/Company/Hub';
import Administration from './pages/Company/Administration';
import OrderHistory from './pages/Company/OrderHistory';
import CompanyTransferDetails from './pages/Company/CompanyTransferDetails';
import InventoryTracking from './pages/Company/ims/InventoryTracking';
import Operations from './pages/Company/ims/Operations';

// 🔥 Seller-side IMS portal (Phase 1: auth + shell). Self-contained under
//    /seller/*; does not touch company routes or contexts.
import SellerLayout from './Components/seller/SellerLayout';
import RequireSeller from './Components/seller/RequireSeller';
import SellerAbout from './pages/seller/SellerAbout';
import SellerRegister from './pages/seller/SellerRegister';
import SellerLogin from './pages/seller/SellerLogin';
import SellerOnboarding from './pages/seller/SellerOnboarding';
import SellerHub from './pages/seller/SellerHub';
import SellerCompanies from './pages/seller/SellerCompanies';
import SellerCertifications from './pages/seller/SellerCertifications';
import SellerWarehouses from './pages/seller/SellerWarehouses';
import SellerProductCatalog from './pages/seller/SellerProductCatalog';
import SellerListings from './pages/seller/SellerListings';
import SellerSupply from './pages/seller/SellerSupply';
import SellerInventory from './pages/seller/SellerInventory';
import SellerLotDetails from './pages/seller/SellerLotDetails';
import SellerOperations from './pages/seller/SellerOperations';
import SellerDashboard from './pages/seller/SellerDashboard';
import SellerAnalytics from './pages/seller/SellerAnalytics';
import SellerAnalyticsDetails from './pages/seller/SellerAnalyticsDetails';
import SellerLabels from './pages/seller/SellerLabels';
import SellerCustomers from './pages/seller/SellerCustomers';
import SellerOutbound from './pages/seller/SellerOutbound';
import SellerBilling from './pages/seller/SellerBilling';
import SellerTeam from './pages/seller/SellerTeam';
import SellerAdministration from './pages/seller/SellerAdministration';
import SellerProfile from './pages/seller/SellerProfile';
import SellerWarehouseSettings from './pages/seller/SellerWarehouseSettings';
import SellerFaq from './pages/seller/SellerFaq';
import { SellerSubscriptionProvider } from './context/SellerSubscriptionContext';
import { SellerPermissionProvider } from './context/SellerPermissionContext';

// 🔐 Platform admin panel (/admin/*): company review + approval. Self-contained,
//    own token ("adminToken") + guard; does not touch company/seller flows.
import RequireAdmin from './Components/admin/RequireAdmin';
import AdminLayout from './Components/admin/AdminLayout';
import AdminLogin from './pages/admin/AdminLogin';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminCompanies from './pages/admin/AdminCompanies';
import AdminCompanyDetail from './pages/admin/AdminCompanyDetail';
import AdminSupportChats from './pages/admin/AdminSupportChats';
import AdminPlaceholder from './pages/admin/AdminPlaceholder';

// 🛒 Customer storefront (/customer-shop/*): public browse + guest cart +
//    consumer auth-at-checkout + COD. Fully self-contained (own providers +
//    token "shopToken"); does not touch company/seller/admin routes.
import ShopLayout from './Components/shop/ShopLayout';
import RequireConsumer from './Components/shop/RequireConsumer';
import ShopProviders from './Components/shop/ShopProviders';
import ShopHome from './pages/shop/ShopHome';
import ShopProducts from './pages/shop/ShopProducts';
import ShopProductDetail from './pages/shop/ShopProductDetail';
import ShopCart from './pages/shop/ShopCart';
import ShopLogin from './pages/shop/ShopLogin';
import ShopRegister from './pages/shop/ShopRegister';
import ShopWishlist from './pages/shop/ShopWishlist';
import ShopDashboard from './pages/shop/ShopDashboard';
import ShopCheckout from './pages/shop/ShopCheckout';
import ShopOrderSuccess from './pages/shop/ShopOrderSuccess';
import ShopOrders from './pages/shop/ShopOrders';
import ShopOrderDetail from './pages/shop/ShopOrderDetail';
import ShopProfile from './pages/shop/ShopProfile';
import ShopCategories from './pages/shop/ShopCategories';


import { useShopAuth } from "./context/ShopAuthContext"; // Aapke auth context ka sahi path


// Yeh component check karega ki user logged in hai ya nahi
function InitialRouteWrapper() {
  const { consumer } = useShopAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    // Agar user logged in hai, toh use layout ke sath coordinate karke /customer-shop/home par redirect karo
    if (consumer) {
      navigate("/customer-shop/home", { replace: true });
    }
  }, [consumer, navigate]);

  // Yeh hamesha outlet ko active rakhega taaki dashboard ya home components beech me proper render hon
  return <Outlet />;
}

/**
 * /settings resolves by ROLE, using the same usePermission() role the rest
 * of the app gates on and lib/roles.js isWarehouseRole() — the single source
 * of truth already used for every warehouse-only branch.
 *
 *   warehouse roles  -> WarehouseSettings (Change Password + Forgot Password)
 *   everyone else    -> the EXISTING CompanySettings behind the EXISTING
 *                       RequireCap capability="company:settings"
 *
 * The company branch is byte-for-byte what the route did before, so
 * company_admin sees the same page, guarded the same way.
 */
const SettingsGate = () => {
  const { role, loading } = usePermission();
  if (loading) {
    return <div className="flex-1 p-8 bg-white font-sora"><p className="text-sm text-stone-400">Loading…</p></div>;
  }
  if (isWarehouseRole(role)) return <WarehouseSettings />;
  return (
    <RequireCap capability="company:settings">
      <CompanySettings />
    </RequireCap>
  );
};

function App() {
  return (
    // 🔥 IMS: wraps the whole app so any page can read the plan via useSubscription()
    //         and the role/capabilities via usePermission()
    <SubscriptionProvider>
      <PermissionProvider>
      <ErrorBoundary>
      <Routes>
        {/* Default Path Redirect -> About Page */}
        <Route path="/" element={<Navigate to="/about" replace />} />

        {/* Driver mobile app (standalone, phone + PIN login) */}
        <Route path="/driver" element={<DriverApp />} />

        {/* Auth & Marketing Routes */}
        <Route path="/about" element={<About />} />
        <Route path="/company-about" element={<CompanyAbout />} />
        <Route path="/seller-about" element={<SellerAbout />} />
        <Route path="/register" element={<CompanyRegister />} />
        <Route path="/login" element={<CompanyLogin />} />
        <Route path="/forgot-password" element={<CompanyForgotPassword />} />
        <Route path="/reset-password" element={<CompanyResetPassword />} />

        <Route path="/success" element={<CompanyRegisterSuccess />} />

        {/* Onboarding Flow */}
        <Route path="/company-setup" element={<CompanySetup />} />
        <Route path="/company-info" element={<CompanySetupStep2 />} />
        <Route path="/company-contact" element={<CompanySetupStep3 />} />
        <Route path="/company-verification" element={<CompanySetupStep4 />} />
        <Route path="/company-final" element={<CompanySetupStep5 />} />

        {/* Post-Submission Screens */}
        <Route
          path="/submission-complete"
          element={<CompanySubmissionComplete />}
        />
        <Route path="/approval-success" element={<CompanyApprovalSuccess />} />

        {/* Main Dashboard Section with top-nav layout (card-based Hub is home) */}
        <Route element={<DashboardLayout />}>
          {/* Card launchpad — the new home */}
          <Route path="/hub" element={<Hub />} />

          {/* The single unified dashboard */}
          <Route path="/company-dashboard" element={<CompanyDashboard />} />

          {/* Inventory Tracking (merged: stock + lots + batches + numbering) */}
          <Route path="/inventory" element={<RequireCap capability="inventory:read" ims><InventoryTracking /></RequireCap>} />

          {/* Warehouses (card → profile) */}
          <Route path="/warehouses" element={<RequireCap capability="location:read" ims><ImsWarehouses /></RequireCap>} />

          {/* Operations (merged: receive + send + transfers + tracking + trace) */}
          <Route path="/operations" element={<RequireCap capability="grn:read" ims><Operations /></RequireCap>} />

          {/* Orders + dedicated Order History */}
          <Route path="/orders" element={<RequireCap capability="order:read"><CompanyOrders /></RequireCap>} />
          <Route path="/order-history" element={<RequireCap capability="order:read"><OrderHistory /></RequireCap>} />
          {/* Main Company only — read-only detail for ONE warehouse→warehouse
              transfer, reached from Transfer History → View. */}
          <Route path="/order-history/transfer/:id" element={<RequireCap capability="order:read"><CompanyTransferDetails /></RequireCap>} />
          {/* Company Warehouse only — its own, warehouse-scoped transfer history. */}
          <Route path="/warehouse/transfer-history" element={<RequireCap capability="shipment:read"><WarehouseTransferHistory /></RequireCap>} />
          <Route path="/warehouse/transfer-history/:id" element={<RequireCap capability="shipment:read"><WarehouseTransferDetail /></RequireCap>} />

          {/* Analytics (folds in the old executive widgets) */}
          <Route path="/analytics" element={<RequireCap capability="report:read" ims><ImsAnalytics /></RequireCap>} />
          {/* Main Company only — read-only detail for ONE Analytics row,
              reached from Analytics → View. */}
          <Route path="/analytics/product/:lotId" element={<RequireCap capability="report:read" ims><AnalyticsProductDetails /></RequireCap>} />
          {/* Company Warehouse only — the same three sections, but reading the
              CURRENT state of the warehouse's own lot row. */}
          <Route path="/warehouse/analytics/product/:lotId" element={<RequireCap capability="report:read" ims><WarehouseAnalyticsDetails /></RequireCap>} />

          {/* Profile — registration details (identity, GSTIN/PAN, KYC docs) */}
          <Route path="/profile" element={<CompanyProfile />} />

          {/* Administration card hub */}
          {/* Administration is a paid module: lib/nav.js marks it feature:'ims',
              so the Hub card and the sidebar already grey it out and route to
              /billing exactly like Inventory and Analytics. This RequireCap is
              only the direct-URL fallback, and it uses the SAME default screen
              every other locked module shows. The leaf pages below carry the
              same gate so a deep link is blocked too. */}
          <Route path="/admin" element={<RequireCap ims><Administration /></RequireCap>} />

          {/* ── Administration leaf pages (reached from the Admin hub) ── */}
          <Route path="/upload-product" element={<RequireCap capability="product:manage"><CompanyUploadProduct /></RequireCap>} />
          <Route path="/product-catalog" element={<RequireCap capability="inventory:read"><CompanyProductCatalog /></RequireCap>} />
          <Route path="/ims/customers" element={<RequireCap capability="customer:read"><ImsCustomers /></RequireCap>} />
          <Route path="/ims/integrations" element={<Navigate to="/hub" replace />} />{/* Integrations / API keys removed */}
          <Route path="/ims/purchasing" element={<RequireCap capability="grn:read" ims><ImsPurchasing /></RequireCap>} />
          <Route path="/ims/labels" element={<RequireCap capability="lot:read" ims><ImsLabels /></RequireCap>} />
          {/* Read-only Lot Details — reached from Inventory → Actions → View. */}
          <Route path="/ims/lots/:lotId" element={<RequireCap capability="lot:read" ims><ImsLotDetails /></RequireCap>} />
          {/* Vendors section removed — dealers live under Sellers. Redirect stale links. */}
          <Route path="/vendors" element={<Navigate to="/sellers" replace />} />
          <Route path="/sellers" element={<RequireCap capability="inventory:read" ims><CompanySellers /></RequireCap>} />
          <Route path="/supply-requests" element={<RequireCap capability="inventory:read"><CompanySupplyRequests /></RequireCap>} />
          {/* Read-only traceability for one request: parent lots + the exact child serials picked. */}
          <Route path="/supply-requests/:id" element={<RequireCap capability="inventory:read"><SupplyRequestDetail /></RequireCap>} />
          <Route path="/pc-applications" element={<RequireCap capability="inventory:read"><CompanyPcApplications /></RequireCap>} />
          <Route path="/returns" element={<RequireCap ims><CompanyReturns /></RequireCap>} />
          <Route path="/support" element={<CompanySupport />} />
          <Route path="/faq" element={<CompanyFaq />} />
          <Route path="/notifications" element={<CompanyNotifications />} />
          <Route path="/users" element={<RequireCap capability="user:read" ims><CompanyUsers /></RequireCap>} />
          <Route path="/settings" element={<SettingsGate />} />
          <Route path="/billing" element={<RequireCap capability="billing:manage"><Billing /></RequireCap>} />
          <Route path="/edit-product/:productId" element={<RequireCap capability="product:manage"><CompanyEditProduct /></RequireCap>} />

          {/* ── Backwards-compatible redirects: old deep links → merged modules ── */}
          <Route path="/ims" element={<Navigate to="/inventory" replace />} />
          <Route path="/ims/lots" element={<Navigate to="/inventory?tab=lots" replace />} />
          <Route path="/ims/warehouses" element={<Navigate to="/warehouses" replace />} />
          <Route path="/ims/inbound" element={<Navigate to="/operations?tab=receive" replace />} />
          <Route path="/ims/outbound" element={<Navigate to="/operations?tab=send" replace />} />
          <Route path="/ims/transport" element={<Navigate to="/operations?tab=shipments" replace />} />
          <Route path="/ims/trace" element={<Navigate to="/operations?tab=trace" replace />} />
          <Route path="/ims/analytics" element={<Navigate to="/analytics" replace />} />
          <Route path="/ims/owner" element={<Navigate to="/analytics" replace />} />

          {/* ── Removed modules: Locations & Counts no longer exist ── */}
          <Route path="/ims/locations" element={<Navigate to="/hub" replace />} />
          <Route path="/ims/counts" element={<Navigate to="/hub" replace />} />
        </Route>

        {/* ───────────── Seller portal (/seller/*) ───────────── */}
        <Route path="/seller" element={<Navigate to="/seller/login" replace />} />
        <Route path="/seller/register" element={<SellerRegister />} />
        <Route path="/seller/login" element={<SellerLogin />} />
        <Route path="/seller/onboarding" element={<RequireSeller><SellerOnboarding /></RequireSeller>} />
        <Route element={<RequireSeller><SellerSubscriptionProvider><SellerPermissionProvider><SellerLayout /></SellerPermissionProvider></SellerSubscriptionProvider></RequireSeller>}>
          <Route path="/seller/hub" element={<SellerHub />} />
          <Route path="/seller/profile" element={<SellerProfile />} />
          {/* SELLER WAREHOUSE — Account Settings (Change / Forgot password).
              Inside the seller layout, so it inherits the same auth guard and
              chrome as every other seller page. The menu entry that reaches it
              is warehouse-role only; the route itself stays plain, exactly like
              the company Warehouse Settings route. */}
          <Route path="/seller/settings" element={<SellerWarehouseSettings />} />
          <Route path="/seller/admin" element={<SellerAdministration />} />
          <Route path="/seller/dashboard" element={<SellerDashboard />} />
          <Route path="/seller/analytics" element={<SellerAnalytics />} />
          {/* Seller AND Seller Warehouse — one page; the warehouse scope is
              applied server-side from the token. */}
          <Route path="/seller/analytics/product/:lotId" element={<SellerAnalyticsDetails />} />
          <Route path="/seller/companies" element={<SellerCompanies />} />
          <Route path="/seller/certifications" element={<SellerCertifications />} />
          <Route path="/seller/team" element={<SellerTeam />} />
          <Route path="/seller/warehouses" element={<SellerWarehouses />} />
          <Route path="/seller/products" element={<SellerProductCatalog />} />
          <Route path="/seller/listings" element={<SellerListings />} />
          <Route path="/seller/supply" element={<SellerSupply />} />
          <Route path="/seller/inventory" element={<SellerInventory />} />
          {/* Read-only seller Lot traceability — reached from Inventory → View. */}
          <Route path="/seller/inventory/lots/:lotId/view" element={<SellerLotDetails />} />
          <Route path="/seller/operations" element={<SellerOperations />} />
          {/* Transfers now live inside the unified Operations module. */}
          <Route path="/seller/transfers" element={<Navigate to="/seller/operations?tab=shipments" replace />} />
          <Route path="/seller/labels" element={<SellerLabels />} />
          <Route path="/seller/customers" element={<SellerCustomers />} />
          <Route path="/seller/outbound" element={<SellerOutbound />} />
          <Route path="/seller/billing" element={<SellerBilling />} />
          <Route path="/seller/faq" element={<SellerFaq />} />
        </Route>

        {/* ───────────── Platform admin panel (/admin/*) ───────────── */}
        {/* NOTE: the company "Administration" hub lives at the EXACT path
            "/admin" (inside DashboardLayout above); these are "/admin/…" child
            paths, so there is no collision. */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/companies" element={<AdminCompanies />} />
          <Route path="/admin/companies/:id" element={<AdminCompanyDetail />} />
          <Route path="/admin/support" element={<AdminSupportChats />} />
          {/* UI-only sections + quick filters — present so navigation never breaks */}
          <Route path="/admin/sellers" element={<AdminPlaceholder title="Sellers" subtitle="Review and approve registered sellers." icon="storefront" />} />
          <Route path="/admin/pending" element={<Navigate to="/admin/companies?status=pending" replace />} />
          <Route path="/admin/approved" element={<Navigate to="/admin/companies?status=approved" replace />} />
          <Route path="/admin/rejected" element={<Navigate to="/admin/companies?status=rejected" replace />} />
          <Route path="/admin/profile" element={<AdminPlaceholder title="Profile" profile />} />
          {/* Bare /admin/* under the layout → dashboard */}
          <Route path="/admin/*" element={<Navigate to="/admin/dashboard" replace />} />
        </Route>

        {/* ───────────── Customer storefront (/customer-shop/*) ───────────── */}
        {/* Self-contained: own auth (shopToken) + guest cart. Public browse; */}
        {/* login is only required at checkout / orders (RequireConsumer).      */}
        {/* ShopProviders = auth + cart + wishlist context, and NOTHING else.    */}
        {/* Keeping the providers separate from ShopLayout is what lets a page   */}
        {/* opt out of the header/footer while still using the cart and session. */}
        <Route path="/customer-shop" element={<ShopProviders />}>

          {/* ── Chrome-less: no header, no footer, no bottom nav ──
              Order confirmation is a dead end — the shopper just paid and needs
              to read their order, not be re-sold to by a nav bar. */}
          <Route path="order-success" element={<RequireConsumer><ShopOrderSuccess /></RequireConsumer>} />
          
          <Route path="orders/:id" element={<RequireConsumer><ShopOrderDetail /></RequireConsumer>} />
          <Route path="profile" element={<RequireConsumer><ShopProfile /></RequireConsumer>} />
          <Route path="checkout" element={<RequireConsumer><ShopCheckout /></RequireConsumer>} />
          <Route path="login" element={<ShopLogin />} />
          <Route path="register" element={<ShopRegister />} />
            

          {/* ── Everything else gets the full storefront chrome ── */}
          <Route element={<ShopLayout />}>
            <Route element={<InitialRouteWrapper />}>
        <Route index element={<ShopHome />} />
    </Route>
            <Route path="home" element={<RequireConsumer><ShopDashboard /></RequireConsumer>} />
            <Route path="products" element={<ShopProducts />} />
            <Route path="product/:listingId" element={<ShopProductDetail />} />
            <Route path="cart" element={<ShopCart />} />
            <Route path="wishlist" element={<ShopWishlist />} />
            <Route path="orders" element={<RequireConsumer><ShopOrders /></RequireConsumer>} />
             <Route path="categories" element={<ShopCategories />} />
           
            
            {/* Unknown /customer-shop/* → storefront home */}
            <Route path="*" element={<Navigate to="/customer-shop" replace />} />
          </Route>
        </Route>

        {/* 404 Redirect -> Ab ye seedha Register pe bhejega, Login pe nahi */}
        <Route path="*" element={<Navigate to="/register" replace />} />
      </Routes>
      </ErrorBoundary>
      </PermissionProvider>
    </SubscriptionProvider>
  );
}

export default App;