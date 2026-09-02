// Single source of truth for the new card-based Information Architecture.
// The Hub launchpad, the TopNav breadcrumb, and the route guards all read from
// this list so navigation can never drift out of sync.
//
// Each module declares:
//   key         stable id
//   title       business-language name shown on the card / breadcrumb
//   path        route it links to
//   icon        material-symbols-outlined name
//   description one short line for the card
//   capability  RBAC capability required to SEE the card (null = everyone)
//   feature     subscription feature required (null = all plans); 'ims' marks
//               modules that need the IMS module (any paid plan) — handled in UI
//
// NOTE: gating logic (can()/has()) lives in the components; this file only
// declares the requirement so the rules stay declarative and in one place.

export const MODULES = [
  {
    key: 'dashboard',
    title: 'Dashboard',
    path: '/company-dashboard',
    icon: 'dashboard',
    description: 'KPIs, trends and alerts at a glance',
    capability: null,
    feature: null,
  },
  {
    key: 'inventory',
    title: 'Inventory',
    path: '/inventory',
    icon: 'inventory_2',
    description: 'Stock, lots, batches and numbering',
    capability: 'inventory:read',
    feature: 'ims',
  },
  {
    key: 'upload-product',
    title: 'Upload Product',
    path: '/upload-product',
    icon: 'upload_file',
    description: 'Add a product to the catalog',
    capability: 'product:manage',
    feature: null,
  },
  {
    key: 'product-catalog',
    title: 'Product Catalog',
    path: '/product-catalog',
    icon: 'grid_view',
    description: 'Browse and edit products',
    capability: 'inventory:read',
    feature: null,
  },
  {
    key: 'warehouses',
    title: 'Warehouses',
    path: '/warehouses',
    icon: 'warehouse',
    description: 'Sites, capacity and profiles',
    capability: 'location:read',
    feature: 'ims',
  },
  {
    key: 'operations',
    // DISPLAY LABEL ONLY — the sidebar entry and the breadcrumb both read this.
    // `key` and `path` are deliberately untouched: they are what the router and
    // every existing /operations link resolve against.
    title: 'Stock Transfers',
    path: '/operations',
    icon: 'sync_alt',
    description: 'Receive, send, transfer and track stock',
    capability: 'grn:read',
    feature: 'ims',
  },
  {
    key: 'labels',
    title: 'Barcodes & Labels',
    path: '/ims/labels',
    icon: 'qr_code_2',
    description: 'Generate and print unit barcodes per lot',
    capability: 'lot:read',
    feature: 'ims',
  },
  {
    key: 'orders',
    title: 'Orders',
    path: '/orders',
    icon: 'shopping_cart',
    description: 'Create and fulfil customer orders',
    capability: 'order:read',
    // Hidden from the MAIN COMPANY only. It holds "*" so a capability check
    // can't hide it, and an allow-list would be brittle — every other role that
    // holds order:read (sales_manager, pos_operator, support, …) keeps Orders.
    // The module, its route and its APIs are untouched.
    hideForRoles: ['company_admin'],
    feature: null,
  },
  {
    key: 'order-history',
    title: 'Transfer History',
    path: '/order-history',
    icon: 'history',
    description: 'All orders, transfers and shipments',
    capability: 'order:read',
    feature: null,
  },
  {
    // COMPANY WAREHOUSE ONLY — the warehouse's own Transfer History. `roles`
    // pins it to those roles so the main Company (which holds every capability
    // via "*") never sees a second history entry. Warehouse roles can't see the
    // module above because they don't hold order:read.
    key: 'warehouse-transfer-history',
    title: 'Transfer History',
    path: '/warehouse/transfer-history',
    icon: 'history',
    description: 'Transfers sent from or received by your warehouse',
    capability: 'shipment:read',
    roles: ['operations_manager', 'warehouse_manager', 'warehouse_operator'],
    feature: null,
  },
  {
    key: 'analytics',
    title: 'Stock Valuation',
    path: '/analytics',
    icon: 'monitoring',
    description: 'Reports and business insights',
    capability: 'report:read',
    feature: 'ims',
  },
  {
    key: 'pc-applications',
    title: 'PC Applications',
    path: '/pc-applications',
    icon: 'workspace_premium',
    description: 'Review reseller authorizations & issue Principal Certificates',
    capability: 'inventory:read',
    feature: null,
  },
  {
    key: 'admin',
    title: 'Administration',
    path: '/admin',
    icon: 'settings',
    description: 'Products, sellers, team and settings',
    capability: null,
    // Paid module: the SAME 'ims' flag Inventory, Warehouses, Operations,
    // Barcodes and Analytics carry. Hub + Sidebar already read it, so
    // Administration now locks, greys, shows the PRO badge and routes to
    // /billing identically — no separate gate UI anywhere.
    feature: 'ims',
  },
];

// Lookup helpers ----------------------------------------------------------
export const moduleByKey = (key) => MODULES.find((m) => m.key === key);

// Resolve the active module for a given pathname (longest-prefix match) so the
// TopNav can show a correct breadcrumb on nested/merged pages.
export function activeModule(pathname) {
  // exact match first
  const exact = MODULES.find((m) => m.path === pathname);
  if (exact) return exact;
  // prefix match (e.g. /operations?tab=receive, /warehouses/:id)
  const sorted = [...MODULES].sort((a, b) => b.path.length - a.path.length);
  return sorted.find((m) => pathname.startsWith(m.path)) || null;
}

// Administration sub-items (rendered as cards inside /admin).
export const ADMIN_ITEMS = [
  // The standalone "Vendors" page was a non-functional mock. Upstream suppliers
  // are managed under Purchasing; downstream dealers live under Sellers below.
  { title: 'Sellers', path: '/sellers', icon: 'storefront', description: 'Approve & manage the dealers you supply', capability: 'inventory:read' },
  { title: 'Supply Requests', path: '/supply-requests', icon: 'inventory', description: 'Approve bulk-supply requests from your dealers', capability: 'inventory:read' },
  { title: 'PC Applications', path: '/pc-applications', icon: 'workspace_premium', description: 'Review reseller authorizations & issue Principal Certificates', capability: 'inventory:read' },
  { title: 'Customers', path: '/ims/customers', icon: 'contacts', description: 'Customer directory and history', capability: 'customer:read' },
  { title: 'Returns', path: '/returns', icon: 'assignment_return', description: 'Handle return orders', capability: 'order:read' },
  { title: 'Team & Roles', path: '/users', icon: 'group', description: 'Users, roles and permissions', capability: 'user:read' },
  { title: 'Settings', path: '/settings', icon: 'tune', description: 'Company and IMS settings', capability: 'company:settings' },
  { title: 'Billing & Plans', path: '/billing', icon: 'credit_card', description: 'Subscription and invoices', capability: 'billing:manage' },
  { title: 'Support', path: '/support', icon: 'support_agent', description: 'Help and contact', capability: null },
];