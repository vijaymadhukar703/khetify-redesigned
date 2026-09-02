import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useShopAuth } from "../../context/ShopAuthContext";
import { useT } from "../../context/ShopLanguageContext";
import LocationPermissionGate from "../common/LocationPermissionGate";
import { saveShopLocation, previewShopLocation, SHOP_LOCATION_PROMPT_KEY } from "../../lib/shopApi";
import { locDebug } from "../../lib/geolocation";

/* WHERE THE SHOPPER IS ASKED.
 *
 * The customer dashboard only — where a shopper lands straight after
 * registering and after logging in. Deliberately NOT checkout, payment or the
 * order screens: a permission dialog on top of a payment is an interruption at
 * the worst possible moment, and this guard wraps those routes too. */
const PROMPT_PATHS = ["/customer-shop/home"];

// Gate for storefront routes that need a logged-in shopper (checkout, orders).
// Unauthed shoppers are bounced to the shop login with a redirect back.
//
// Logged-in shoppers additionally pass through LocationPermissionGate, which
// asks for live location on the dashboard. It never blocks — children render
// exactly as before, and the prompt is only an overlay — so denying it leaves
// the dashboard, cart and checkout fully usable.
export default function RequireConsumer({ children }) {
  const { isAuthed, loading, consumer, refresh } = useShopAuth();
  const location = useLocation();
  const t = useT();

  if (loading) {
    return <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">{t("common.loading")}</div>;
  }
  if (!isAuthed) {
    return <Navigate to={`/customer-shop/login?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  // The stored answer already travels with the consumer (register / login /
  // me), so nothing extra is fetched. `refresh()` afterwards keeps the context
  // in step with what was just saved.
  locDebug("shop: guard", {
    pathname: location.pathname,
    onPromptPath: PROMPT_PATHS.includes(location.pathname),
    locationAccess: consumer?.locationAccess,
  });

  const onDecision = async (payload) => {
    await saveShopLocation(payload);
    await refresh();
  };

  return (
    <LocationPermissionGate
      active={PROMPT_PATHS.includes(location.pathname)}
      // "revoked" (switched off in settings) is as settled as "granted" — see
      // the note in SellerLocationGate.
      alreadyGranted={["granted", "revoked"].includes(consumer?.locationAccess?.status)}
      sessionKey={SHOP_LOCATION_PROMPT_KEY}
      onDecision={onDecision}
      onPreview={previewShopLocation}
      text={{
        title: t("location.title"),
        body: t("location.body"),
        allow: t("location.allow"),
        deny: t("location.deny"),
        working: t("location.working"),
        blocked: t("location.blocked"),
        retry: t("location.retry"),
        locating: t("location.locating"),
        confirmTitle: t("location.confirmTitle"),
        confirmBody: t("location.confirmBody"),
        confirm: t("location.confirm"),
        cancel: t("location.cancel"),
        panel: {
          state: t("loc.state"),
          district: t("loc.district"),
          city: t("loc.city"),
          pincode: t("loc.pincode"),
          country: t("loc.country"),
          coordinates: t("loc.coordinates"),
          accuracy: t("loc.accuracy"),
          capturedAt: t("loc.capturedAt"),
          viewOnMap: t("loc.viewOnMap"),
          unresolved: t("loc.unresolved"),
        },
      }}
    >
      {children}
    </LocationPermissionGate>
  );
}