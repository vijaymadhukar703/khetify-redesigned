/**
 * useDeliveryPincode
 *
 * Single source of truth for the customer's selected delivery pincode.
 *
 * Priority order:
 *   1. Explicit pincode the customer typed / selected (sessionStorage).
 *   2. The customer's default saved address pincode (from auth context).
 *   3. null — no pincode available; no delivery badge shown.
 *
 * This hook is intentionally lightweight — it does NOT call the backend.
 * The pincode is passed to getShopProducts / getShopProduct as a query
 * param and the backend resolves eligibility there.
 */
import { useMemo } from "react";
import { useShopAuth } from "../context/ShopAuthContext";

const SESSION_KEY = "shopDeliveryPincode";

/** Persist an explicit customer choice for the current tab session. */
export function setSessionPincode(pincode) {
  if (pincode) {
    sessionStorage.setItem(SESSION_KEY, String(pincode).trim());
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

export function getSessionPincode() {
  return sessionStorage.getItem(SESSION_KEY) || null;
}

/**
 * Returns the active delivery pincode, or null if none is available.
 * Components pass this as `pincode` to getShopProducts / getShopProduct.
 */
export function useDeliveryPincode() {
  const { consumer } = useShopAuth();

  return useMemo(() => {
    // 1. Explicit session choice
    const session = getSessionPincode();
    if (session) return session;

    // 2. Default saved address
    if (consumer?.addresses?.length) {
      const def =
        consumer.addresses.find((a) => a.isDefault) || consumer.addresses[0];
      if (def?.pincode) return String(def.pincode).trim();
    }

    return null;
  }, [consumer]);
}