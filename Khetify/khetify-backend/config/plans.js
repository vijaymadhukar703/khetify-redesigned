/**
 * Single source of truth for subscription gating.
 * Imported by backend middleware AND exposed to the frontend via /api/subscription/me.
 */

const FEATURES = {
  BASIC_CATALOG: "basic_catalog",
  ORDER_DEDUCTION: "order_deduction",
  LOW_STOCK_ALERTS: "low_stock_alerts",
  MULTI_WAREHOUSE: "multi_warehouse",
  RESERVED_STOCK: "reserved_stock",
  SUPPLY_WORKFLOW: "supply_workflow",
  BATCH_EXPIRY: "batch_expiry",
  ADVANCED_ANALYTICS: "advanced_analytics",
  REGIONAL_ANALYTICS: "regional_analytics",
  REALTIME_SYNC: "realtime_sync",
  AI_FORECASTING: "ai_forecasting",
  API_ACCESS: "api_access",
  UNIT_LABELS: "unit_labels",
  INVENTORY_VIEW: "inventory_view",
  // The Administration hub (Sellers, Team & Roles, Returns, …). Paid-only:
  // absent from `free` below, so requireFeature() locks it exactly the way
  // ADVANCED_ANALYTICS locks Analytics.
  ADMINISTRATION: "administration",
};

const ALL_FEATURES = Object.values(FEATURES);

const PLANS = {
  free: {
    label: "Free",
    features: [
      FEATURES.BASIC_CATALOG,
      FEATURES.ORDER_DEDUCTION,
      FEATURES.LOW_STOCK_ALERTS,
    ],
    limits: { warehouses: 1, products: 50, sellers: 5 },
  },
  pro: {
    label: "Pro",
    features: [
      FEATURES.BASIC_CATALOG,
      FEATURES.ORDER_DEDUCTION,
      FEATURES.LOW_STOCK_ALERTS,
      FEATURES.MULTI_WAREHOUSE,
      FEATURES.RESERVED_STOCK,
      FEATURES.SUPPLY_WORKFLOW,
      FEATURES.BATCH_EXPIRY,
      FEATURES.ADVANCED_ANALYTICS,
      FEATURES.REALTIME_SYNC,
      FEATURES.ADMINISTRATION,
    ],
    limits: { warehouses: 5, products: 5000, sellers: 100 },
  },
  enterprise: {
    label: "Enterprise",
    features: "ALL",
    limits: {
      warehouses: Infinity,
      products: Infinity,
      sellers: Infinity,
    },
  },
};

/**
 * SELLER plans — a separate free/paid split from the company PLANS above. This
 * is the ONLY place the seller free-vs-paid rule lives; move features between
 * the arrays to re-tier. Free: catalog view, request supply, customers (≤50),
 * basic outbound, and exactly 1 warehouse. Paid: Inventory views, unlimited
 * warehouses, unit Labels, batch/expiry, reserved stock, Analytics.
 */
const SELLER_PLANS = {
  free: {
    label: "Free",
    features: [
      FEATURES.BASIC_CATALOG,
      FEATURES.SUPPLY_WORKFLOW,
      FEATURES.ORDER_DEDUCTION,
      FEATURES.LOW_STOCK_ALERTS,
    ],
    limits: { warehouses: 1, customers: 50 },
  },
  pro: {
    label: "Pro",
    features: [
      FEATURES.BASIC_CATALOG,
      FEATURES.SUPPLY_WORKFLOW,
      FEATURES.ORDER_DEDUCTION,
      FEATURES.LOW_STOCK_ALERTS,
      FEATURES.INVENTORY_VIEW,
      FEATURES.MULTI_WAREHOUSE,
      FEATURES.UNIT_LABELS,
      FEATURES.BATCH_EXPIRY,
      FEATURES.RESERVED_STOCK,
      FEATURES.ADVANCED_ANALYTICS,
    ],
    limits: { warehouses: Infinity, customers: Infinity },
  },
  enterprise: {
    label: "Enterprise",
    features: "ALL",
    limits: { warehouses: Infinity, customers: Infinity },
  },
};

/** Resolve a plan key into its concrete feature list. */
function resolveFeatures(planKey) {
  const plan = PLANS[planKey] || PLANS.free;
  return plan.features === "ALL" ? ALL_FEATURES : plan.features;
}

/** Resolve a plan key into its limits object. */
function resolveLimits(planKey) {
  const plan = PLANS[planKey] || PLANS.free;
  return plan.limits;
}

/** Resolve a SELLER plan key into its concrete feature list. */
function resolveSellerFeatures(planKey) {
  const plan = SELLER_PLANS[planKey] || SELLER_PLANS.free;
  return plan.features === "ALL" ? ALL_FEATURES : plan.features;
}

/** Resolve a SELLER plan key into its limits object. */
function resolveSellerLimits(planKey) {
  const plan = SELLER_PLANS[planKey] || SELLER_PLANS.free;
  return plan.limits;
}

module.exports = { FEATURES, ALL_FEATURES, PLANS, SELLER_PLANS, resolveFeatures, resolveLimits, resolveSellerFeatures, resolveSellerLimits };