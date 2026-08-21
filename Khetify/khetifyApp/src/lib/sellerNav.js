// Seller portal modules. `feature` (when set) marks a PAID module — gated by the
// seller's subscription (config/plans.js SELLER_PLANS). Untagged modules are free
// (Warehouses is free; its plan LIMIT, not the module, is what's enforced).
// `cap` (when set) is the RBAC capability required to see/use the module —
// gated via the seller member's role (context/SellerPermissionContext). `feature`
// marks a PAID module gated by the subscription. Both combine with approval.
// Ordered to mirror the company sidebar sequence. `customers` is tagged
// admin (SELLER_ADMIN_MODULE_KEYS) so the sidebar nests it under the
// Administration group; it stays a normal module here (same route/gating) and
// still renders as a Hub card. Order/grouping only — nothing renamed/removed.
export const SELLER_MODULES = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard", phase: 2, desc: "KPIs, alerts and stock health at a glance.", path: "/seller/dashboard", live: true, cap: "report:read" },
  { key: "inventory", label: "Inventory", icon: "inventory", phase: 4, desc: "Stock, lots & expiry batches.", path: "/seller/inventory", live: true, feature: "inventory_view", cap: "inventory:read" },
  { key: "inbound", label: "Inbound Supply", icon: "local_shipping", phase: 3, desc: "Request & track bulk supply from your company.", path: "/seller/supply", live: true, cap: "supply:read" },
  { key: "catalog", label: "Product Catalog", icon: "inventory_2", phase: 2, desc: "Products supplied by your company.", path: "/seller/products", live: true, cap: "catalog:read" },
  { key: "listings", label: "Marketplace Listings", icon: "storefront", phase: 2, desc: "Products you've published on the Khetify storefront.", path: "/seller/listings", live: true, cap: "catalog:read" },
  { key: "warehouses", label: "Warehouses", icon: "warehouse", phase: 2, desc: "Your storage locations.", path: "/seller/warehouses", live: true, cap: "warehouse:read" },
  { key: "operations", label: "Stock Transfers", icon: "sync_alt", phase: 4, desc: "Receive, send, transfer & trace stock.", path: "/seller/operations", live: true, cap: "transfer:read" },
  { key: "labels", label: "Barcodes & Labels", icon: "qr_code_2", phase: 4, desc: "Print & scan your unit barcodes.", path: "/seller/labels", live: true, feature: "unit_labels", cap: "label:read" },
  { key: "outbound", label: "Outbound Sales", icon: "point_of_sale", phase: 5, desc: "Sell to customers and dealers.", path: "/seller/outbound", live: true, cap: "order:read" },
  { key: "analytics", label: "Stock Valuation", icon: "monitoring", phase: 4, desc: "Stock, aging, expiry & movement reports.", path: "/seller/analytics", live: true, feature: "inventory_view", cap: "report:read" },
  { key: "customers", label: "Customers & Dealers", icon: "groups", phase: 5, desc: "Your end customers and dealers.", path: "/seller/customers", live: true, cap: "customer:read" },
];

// Module keys that the sidebar nests under the Administration group (instead of
// the top-level list). They remain ordinary modules (same route + gating).
export const SELLER_ADMIN_MODULE_KEYS = ["customers"];

// Admin-only sections (seller_admin holds these caps via "*"; managers/staff do
// NOT). Each `cap` hides the nav item for non-admins via SellerPermissionContext,
// and the matching endpoints are guarded server-side with the same capability.
//
// Companies — manage supplying-company links (list + apply to new ones).
export const SELLER_COMPANIES_NAV = { key: "companies", label: "Companies", icon: "domain", path: "/seller/companies", cap: "company:manage" };
// Certifications — apply for & manage reseller authorizations (Principal Certs).
export const SELLER_CERTIFICATIONS_NAV = { key: "certifications", label: "Certifications", icon: "workspace_premium", path: "/seller/certifications", cap: "certification:manage" };
// Team & Roles — manage seller team members.
export const SELLER_TEAM_NAV = { key: "team", label: "Team & Roles", icon: "group", path: "/seller/team", cap: "user:read" };
// Billing & Usage — subscription/plan. Switching plans is admin-only.
export const SELLER_BILLING_NAV = { key: "billing", label: "Billing & Usage", icon: "workspace_premium", path: "/seller/billing", cap: "billing:manage" };

// The single "Administration" sidebar button (gear), mirroring the company's —
// it opens the Administration hub (/seller/admin) of cards below.
export const SELLER_ADMIN_NAV = { key: "admin", label: "Administration", icon: "settings", path: "/seller/admin" };

// Cards shown on the Administration hub. Each keeps its OWN route + capability
// gate; the hub just groups them (like the company ADMIN_ITEMS).
export const SELLER_ADMIN_ITEMS = [
  { key: "team", title: "Team & Roles", path: "/seller/team", icon: "group", description: "Invite members and control what they can do.", cap: "user:read" },
  { key: "certifications", title: "Certifications", path: "/seller/certifications", icon: "workspace_premium", description: "Apply for & manage reseller authorizations.", cap: "certification:manage" },
  { key: "billing", title: "Billing & Usage", path: "/seller/billing", icon: "credit_card", description: "Your subscription and plan.", cap: "billing:manage" },
  { key: "customers", title: "Customers & Dealers", path: "/seller/customers", icon: "groups", description: "Your end customers and dealers.", cap: "customer:read" },
  { key: "companies", title: "Companies", path: "/seller/companies", icon: "domain", description: "Your supplying companies & applications.", cap: "company:manage" },
];
