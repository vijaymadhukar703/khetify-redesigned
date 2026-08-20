import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import axios from "axios";
import config from "../../config/config";

const SubscriptionContext = createContext(null);

export const SubscriptionProvider = ({ children }) => {
  const [sub, setSub] = useState({ plan: "free", features: [], limits: {} });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      // No session -> always treat as free (locked). Prevents a previously
      // loaded paid plan from lingering after logout / account switch.
      setSub({ plan: "free", features: [], limits: {} });
      setLoading(false);
      return;
    }
    try {
      const { data } = await axios.get(`${config.BASE_URL}subscription/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (data?.success) setSub(data.data);
    } catch (err) {
      console.error("Subscription load failed:", err?.response?.data || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Core gate helper used across the UI.
  const has = useCallback(
    (feature) => Array.isArray(sub.features) && sub.features.includes(feature),
    [sub]
  );

  return (
    <SubscriptionContext.Provider value={{ ...sub, loading, has, refresh }}>
      {children}
    </SubscriptionContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSubscription = () => {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error("useSubscription must be used inside <SubscriptionProvider>");
  return ctx;
};

// Mirror of backend config/plans.js FEATURES — keep keys in sync.
// eslint-disable-next-line react-refresh/only-export-components
export const FEATURES = {
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
  ADMINISTRATION: "administration",
};