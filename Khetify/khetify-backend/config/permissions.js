/**
 * Capability-based RBAC matrix.
 *
 * authorize() (middlewares/authorize.js) accepts capability strings of the
 * form "<entity>:<action>" (e.g. "grn:post"). This file maps each role to the
 * concrete capabilities it holds. Keep capabilities coarse and stable — UI
 * gating (usePermission) reads the same list via GET /api/auth/me.
 *
 * Conventions:
 *  - "*"            → role holds every capability (super_admin, company_admin).
 *  - "<entity>:*"   → role holds every action on that entity.
 *  - auditor        → read-only: only ":read"/":view"/":export" capabilities.
 *
 * Adding a new feature: add its capability strings here for the roles that
 * should hold them, then guard the write routes with authorize("entity:action").
 */

// All known roles. Mirrors model/User/User.js role enum.
//
// OPERATIONAL ROLE CONSOLIDATION: the three roles offered for assignment are
// company_admin, operations_manager and sales_manager (see ASSIGNABLE_ROLES).
// The legacy roles below them are KEPT in the enum so existing user records
// and JWTs keep working — they just can't be assigned to new/updated users.
// scripts/migrations/004-consolidate-roles.js maps legacy users onto the new
// structure when you're ready.
const ROLES = [
  "super_admin",
  "company_admin",
  "operations_manager",
  "warehouse_manager",
  "warehouse_operator",
  "inventory_manager",
  "transport_manager",
  "driver",
  "sales_manager",
  "pos_operator",
  "support",
  "auditor",
  "seller_admin",
  "seller_manager",
  "seller_staff",
];

// The COMPANY WAREHOUSE roles — the people who physically hold and move stock,
// as opposed to the main company (company_admin). Mirrors the frontend's
// src/lib/roles.js WAREHOUSE_ROLES. This is a role identity, NOT a capability:
// use it only where a rule is about "who you are" rather than "what you may do"
// (e.g. only the main company mints child unit serials, while warehouse roles
// keep the lot:receive they need for GRN/receive).
const WAREHOUSE_ROLES = new Set([
  "operations_manager", // active consolidated warehouse/operations role
  "warehouse_manager",  // legacy warehouse manager
  "warehouse_operator", // legacy warehouse operator
  "inventory_manager",  // legacy inventory manager
]);

/** Is `role` a company-warehouse role? */
const isWarehouseRole = (role) => WAREHOUSE_ROLES.has(role);

/**
 * Role → capabilities. A capability is granted if the role list contains the
 * exact string, "<entity>:*", or "*". See hasCapability() for resolution.
 */
const ROLE_CAPABILITIES = {
  super_admin: ["*"],
  company_admin: ["*"],

  // ── SELLER principal roles (downstream distributor portal). All data is
  // scoped by sellerId; these capabilities gate seller modules/actions exactly
  // like the company roles gate company ones. ──
  // Owner: full access within the seller's own scope (mirrors company_admin).
  seller_admin: ["*"],
  // A full WAREHOUSE operator: manage warehouses/inventory/labels/supply/
  // customers/orders and move stock between warehouses (transfer:*) — but NOT
  // the team (user:*), the product catalog (catalog:*), billing (billing:manage),
  // the supplying-company links (company:manage) or certifications
  // (certification:manage). Those are seller_admin-only (held via "*").
  // Warehouses: a manager may VIEW and edit/deactivate their warehouse(s)
  // (warehouse:read + warehouse:manage) but CREATING a warehouse is an org-level
  // action reserved for the seller_admin (warehouse:create, via "*" only) — note
  // the explicit list instead of "warehouse:*" so the wildcard can't grant
  // create. Warehouse + inventory views are also SCOPED to the manager's
  // assigned warehouse(s) — see services/warehouseScope.js.
  seller_manager: [
    "warehouse:read",
    "warehouse:manage",
    "supply:*",
    "inventory:read",
    "transfer:*",
    "label:*",
    "customer:*",
    "order:*",
    "report:read",
  ],
  // Read-mostly staff: can view operational data (catalog/inventory/transfers)
  // and take front-line create actions (record a customer, place an order) but
  // cannot manage warehouses, the team, billing, companies, or certifications.
  seller_staff: [
    "warehouse:read",
    "catalog:read",
    "supply:read",
    "inventory:read",
    "transfer:read",
    "label:read",
    "label:print",
    "customer:read",
    "customer:create",
    "order:read",
    "order:create",
  ],

  /**
   * Consolidated operations role: warehouses, locations, inventory, inbound
   * (GRN/putaway), outbound (pick/pack/dispatch), counts & adjustments,
   * labels/barcodes, transport (incl. transfer receipt verification) and
   * traceability. Deliberately NO user:*, order:*, customer:* or
   * executive:view — those belong to company_admin / sales_manager.
   */
  operations_manager: [
    "inventory:*",
    "lot:*",
    "location:*",
    "grn:*",
    "putaway:*",
    "pick:*",
    "pack:*",
    "dispatch:*",
    "adjustment:*",
    "count:*",
    "return:*",
    "shipment:*",
    "vehicle:*",
    "driver:*",
    "route:*",
    "report:read",
  ],

  warehouse_manager: [
    "location:*",
    "grn:*",
    "putaway:*",
    "pick:*",
    "pack:*",
    "dispatch:*",
    "adjustment:*", // includes adjustment:approve
    "count:*",
    "inventory:read",
    "inventory:transfer",
    "lot:*",
    "return:*",
    "shipment:receive",
    "shipment:read",
    "report:read",
    "user:read",
  ],

  warehouse_operator: [
    "location:read",
    "grn:read",
    "grn:create",
    "grn:receive",
    "putaway:execute",
    "putaway:read",
    "pick:execute",
    "pick:read",
    "pack:execute",
    "pack:read",
    "count:execute",
    "count:read",
    "adjustment:create", // propose only — not approve
    "inventory:read",
    "lot:read",
    "lot:receive",
    "return:read",
    "shipment:receive",
    "shipment:read",
  ],

  inventory_manager: [
    "inventory:*",
    "lot:*",
    "adjustment:*",
    "count:*",
    "pick:*",
    "pack:*",
    "location:read",
    "grn:read",
    "report:read",
    "cost:read",
    "cost:request",
  ],

  transport_manager: [
    "shipment:*",
    "vehicle:*",
    "driver:*",
    "route:*",
    "dispatch:*",
    "pick:read",
    "pack:read",
    "report:read",
    "inventory:read",
  ],

  driver: [
    "shipment:read_own",
    "shipment:update_own", // start trip / arrived / POD on assigned shipments
    "pod:upload",
  ],

  sales_manager: [
    "order:*",
    "customer:*",
    "invoice:*",
    "return:*",
    "lot:read",
    "inventory:read",
    "report:read",
    "shipment:read",
    "pick:read",
    "pack:read",
    "dispatch:read",
    "cost:read",
    "cost:request",
  ],

  pos_operator: [
    "order:create",
    "order:read",
    "customer:create",
    "customer:read",
    "inventory:read",
  ],

  support: [
    "order:read",
    "customer:read",
    "customer:update",
    "shipment:read",
    "inventory:read",
    "return:read",
    "return:create",
  ],

  // Read-only across the board. Resolved by the ":read"/":view"/":export" rule
  // in hasCapability(), plus explicit audit-log access.
  auditor: ["audit:read", "report:read", "report:export", "cost:read", "executive:view"],
};

/**
 * Roles that can be assigned to team members going forward. Legacy roles stay
 * valid on existing users (they remain in ROLES / the User enum) but are no
 * longer offered for new assignments. driver is provisioned via the dedicated
 * /api/drivers endpoint, not the team API.
 */
const ASSIGNABLE_ROLES = ["company_admin", "operations_manager", "sales_manager"];

/** Seller team roles a seller_admin may assign (separate from the company set). */
const SELLER_ASSIGNABLE_ROLES = ["seller_admin", "seller_manager", "seller_staff"];

const READONLY_SUFFIXES = [":read", ":view", ":export", ":read_own"];

/**
 * Capabilities explicitly DENIED to a role, overriding any wildcard it holds.
 * company_admin keeps "*" (every read + non-transfer write) but is barred from
 * initiating warehouse-to-warehouse transfers — admins oversee transfers but
 * do not perform them (operations managers do, via inventory:*). The deny is
 * checked FIRST in hasCapability(), so it beats "*".
 *
 * shipment:create follows the same rule: goods are shipped by the warehouse that
 * physically holds them, so the company admin's Shipment Tracking view is
 * read-only oversight. This blocks POST /api/shipments for company_admin (the
 * hidden "New Shipment" button alone would not stop a direct API call).
 * Operations/warehouse managers keep shipment:* and are unaffected. The supply
 * dispatch manifest is created service-side (shipmentService.ensureManifest),
 * not through that route, so it keeps working.
 */
const ROLE_DENIED = {
  company_admin: ["inventory:transfer", "shipment:create"],

  // The SELLER mirror of the rule above, and for the same reason: stock is
  // moved by the warehouse that physically holds it, not by the head office.
  //
  // seller_admin reviews and APPROVES customer orders and supply requests, and
  // sees every shipment — but the picking, packing and dispatching is the
  // seller_manager's job (their "transfer:*" is untouched). Without this deny,
  // seller_admin's "*" would silently grant it back.
  //
  // Deliberately NOT denied: transfer:read (they still see everything) and
  // order:* / supply:* (approving is theirs).
  seller_admin: ["transfer:create"],
};

/** Capabilities denied to `role` (empty array if none). */
function deniedForRole(role) {
  return ROLE_DENIED[role] || [];
}

/**
 * Does `role` hold `capability`?
 * Resolution order: explicit deny → super/admin wildcard → exact →
 * entity wildcard → auditor read-only rule.
 */
function hasCapability(role, capability) {
  if (!role || !capability) return false;
  const caps = ROLE_CAPABILITIES[role];
  if (!caps) return false;

  // An explicit deny overrides everything, including the "*" wildcard.
  if (deniedForRole(role).includes(capability)) return false;

  if (caps.includes("*")) return true;
  if (caps.includes(capability)) return true;

  const entity = capability.split(":")[0];
  if (caps.includes(`${entity}:*`)) return true;

  // Auditor (or any role) is allowed inherently-read-only capabilities it lists,
  // but auditor must never get write capabilities even if mis-listed.
  if (role === "auditor") {
    return READONLY_SUFFIXES.some((s) => capability.endsWith(s)) && caps.includes(capability);
  }

  return false;
}

/** Flatten a role's capabilities for the frontend usePermission() map. */
function capabilitiesForRole(role) {
  return ROLE_CAPABILITIES[role] || [];
}

module.exports = { ROLES, ASSIGNABLE_ROLES, SELLER_ASSIGNABLE_ROLES, WAREHOUSE_ROLES, ROLE_CAPABILITIES, ROLE_DENIED, hasCapability, capabilitiesForRole, deniedForRole, isWarehouseRole };