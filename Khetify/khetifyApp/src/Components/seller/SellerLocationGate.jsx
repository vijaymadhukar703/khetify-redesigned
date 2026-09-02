import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import LocationPermissionGate from "../common/LocationPermissionGate";
import { getSellerMe, saveSellerLocation, previewSellerLocation, SELLER_LOCATION_PROMPT_KEY } from "../../lib/sellerApi";
import { locDebug } from "../../lib/geolocation";

/* WHERE THE SELLER IS ASKED.
 *
 * The landing screens only — where a seller arrives straight after registering
 * (/seller/onboarding) or logging in (/seller/hub, and /seller/dashboard for
 * anyone whose menu opens there). Deliberately NOT every guarded route: a
 * dialog appearing halfway through Send Stock or an order approval would be an
 * interruption, not a request. */
const PROMPT_PATHS = ["/seller/onboarding", "/seller/hub", "/seller/dashboard"];

/**
 * Wraps the seller portal's guarded routes. Children render immediately and
 * unconditionally — this only decides whether a prompt is laid over them.
 *
 * The stored answer is read from /seller/me, which already carries
 * `locationAccess`. The call is made ONLY when a prompt is actually possible
 * (right path, not already asked this session), so the common case — moving
 * around the portal after answering — costs nothing.
 */
export default function SellerLocationGate({ children }) {
  const { pathname } = useLocation();
  const onPromptPath = PROMPT_PATHS.includes(pathname);

  // null = not resolved yet. Nothing is asked until the server has answered,
  // so a seller who granted long ago is never briefly re-prompted.
  const [me, setMe] = useState(null);
  const asked = useRef(false);

  useEffect(() => {
    if (!onPromptPath || asked.current) {
      locDebug("seller: not a prompt route", { pathname, onPromptPath, alreadyAsked: asked.current });
      return;
    }
    try {
      if (sessionStorage.getItem(SELLER_LOCATION_PROMPT_KEY) === "1") {
        locDebug("seller: session marker already set");
        return;
      }
    } catch { /* private mode: fall through and just ask */ }

    // NO "cancelled" flag here, deliberately. React StrictMode runs an effect
    // twice in development: the first pass would set the flag in its cleanup
    // and the second pass would be turned away by `asked`, so the in-flight
    // response was discarded and `me` stayed null forever — the prompt then
    // never opened in dev. The ref alone is the right guard: it dedupes the
    // request, and a setState after a real unmount is a harmless no-op in
    // React 18.
    asked.current = true;
    getSellerMe()
      .then((r) => {
        locDebug("seller: /me", {
          isMember: r?.data?.isMember,
          locationAccess: r?.data?.locationAccess,
        });
        setMe(r?.data || null);
      })
      // A failed /me must not surface anything: the portal's own guards already
      // handle a dead session, and a location prompt is not worth an error.
      .catch((e) => { locDebug("seller: /me failed", e?.message); setMe(null); });
  }, [onPromptPath]);

  // A seller TEAM MEMBER (manager / warehouse staff) shares the seller's scope
  // but is a different person somewhere else; their handset's position is not
  // the business's location, so they are never asked. The server refuses the
  // write for the same reason.
  const isMember = !!me?.isMember;
  // "granted" and "revoked" are both SETTLED answers — the first is sharing, the
  // second is a deliberate switch-off in settings. Neither should reopen the
  // prompt. Only "denied" (a dismissed dialog) and a blank record do.
  const settled = ["granted", "revoked"].includes(me?.locationAccess?.status);

  return (
    <LocationPermissionGate
      active={onPromptPath && !!me && !isMember}
      alreadyGranted={settled}
      sessionKey={SELLER_LOCATION_PROMPT_KEY}
      onDecision={saveSellerLocation}
      onPreview={previewSellerLocation}
      text={{
        title: "Share your live location",
        body: "Allow location access so Khetify can suggest the nearest warehouses, speed up delivery details and show what is available around you. You can change this later in your browser settings.",
        allow: "Allow location",
        deny: "Not now",
        working: "Getting your location…",
        blocked: "Location is blocked for this site in your browser. Enable it from the lock icon in the address bar, then try again.",
        retry: "Try again",
        locating: "Finding your location\u2026",
        confirmTitle: "Is this your location?",
        confirmBody: "We detected the place below from your device. Confirm to save it to your seller account.",
        confirm: "Yes, save this",
        cancel: "Cancel",
      }}
    >
      {children}
    </LocationPermissionGate>
  );
}