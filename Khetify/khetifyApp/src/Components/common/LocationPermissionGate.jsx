import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  isGeolocationSupported,
  getBrowserPermissionState,
  requestCurrentPosition,
  locDebug,
} from "../../lib/geolocation";
import LocationAddressPanel from "./LocationAddressPanel";

/**
 * LIVE-LOCATION PERMISSION GATE — shared by the Seller portal and the Customer
 * storefront. Renders `children` ALWAYS and lays the prompt over the top.
 *
 * ── WHY AN OVERLAY AND NOT A BLOCKING SCREEN ──
 * The requirement is to ask before the dashboard is usable, and to let a
 * refusal through. An overlay does both: the prompt is the first thing on
 * screen, and dismissing it reveals a dashboard that was already mounted and
 * already loading. Nothing waits on the answer, so a browser that never returns
 * one (permission prompt left open in a background tab, geolocation blocked by
 * policy) cannot strand anyone.
 *
 * ── WHEN IT ASKS ──
 *   alreadyGranted  → never. This is the account-level answer from the server,
 *                     which is what makes "granted once, never asked again"
 *                     hold across devices and browsers.
 *   browser says granted → captures silently, no prompt. The browser has the
 *                     permission already; putting a dialog in front of a fix it
 *                     will hand over without one is pure friction.
 *   otherwise       → prompts, once per session (see `sessionKey`).
 *
 * ── ONCE PER SESSION ──
 * `sessionKey` is written to sessionStorage as soon as the prompt is answered
 * or dismissed, so moving between guarded routes does not re-open it. The key
 * is cleared on login/register (in the api layer's setToken), which is exactly
 * what "ask again after their next login" means.
 *
 * ── TEXT IS INJECTED ──
 * The storefront is translated (EN/HI) and the seller portal is not, so no copy
 * is hardcoded here. Each caller passes the strings it already has.
 */
export default function LocationPermissionGate({
  children,
  // Only consider prompting when true — callers use this to limit the ask to
  // the landing/dashboard route rather than every guarded page.
  active = false,
  // The account-level answer already stored on the server.
  alreadyGranted = false,
  // Distinct per portal so a seller session and a shopper session in the same
  // browser do not silence each other.
  sessionKey,
  // (payload) => Promise — persists { status, latitude?, longitude?, accuracy? }
  onDecision,
  // ({latitude, longitude}) => Promise<{address}> — resolves a readable address
  // WITHOUT saving. Optional: with no preview the prompt saves straight from
  // Allow, exactly as it did before the confirmation step existed.
  onPreview,
  text = {},
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The site is hard-blocked in the browser. The prompt is still shown — a
  // silent nothing leaves the person with no idea why location never works —
  // but it says so, and offers a retry instead of an Allow that cannot fire.
  const [blocked, setBlocked] = useState(false);
  // The resolved place, held while the person decides whether it is right.
  // NOTHING IS SAVED until they confirm — backing out here leaves no trace.
  const [preview, setPreview] = useState(null);
  // Guards against a second pass in React 18 StrictMode double-mount, and
  // against the effect re-running when props settle.
  const handled = useRef(false);

  const t = {
    title: "Share your live location",
    body: "Allow location access so we can show you what is nearby and speed up delivery details. You can change this later in your browser settings.",
    allow: "Allow location",
    deny: "Not now",
    working: "Getting your location…",
    blocked: "Location is blocked for this site in your browser. Enable it from the lock icon in the address bar, then try again.",
    retry: "Try again",
    locating: "Finding your location…",
    confirmTitle: "Is this your location?",
    confirmBody: "We detected the place below from your device. Confirm to save it to your account.",
    confirm: "Yes, save this",
    cancel: "Cancel",
    ...text,
  };

  const remember = useCallback(() => {
    try { sessionStorage.setItem(sessionKey, "1"); } catch { /* private mode */ }
  }, [sessionKey]);

  const askedThisSession = useCallback(() => {
    try { return sessionStorage.getItem(sessionKey) === "1"; } catch { return false; }
  }, [sessionKey]);

  // Persisting must never break the page. A failed save simply means the
  // account is asked again next time, which is the safe direction to fail in.
  const save = useCallback(async (payload) => {
    try { await onDecision?.(payload); } catch { /* keep the session usable */ }
  }, [onDecision]);

  useEffect(() => {
    if (!active || alreadyGranted || handled.current) {
      locDebug("gate: skipped", {
        active,
        alreadyGranted,
        alreadyHandled: handled.current,
        sessionKey,
      });
      return;
    }
    if (!sessionKey || askedThisSession()) {
      locDebug("gate: already asked this session", { sessionKey });
      return;
    }
    if (!isGeolocationSupported()) {
      locDebug("gate: browser has no geolocation");
      return;
    }

    // NO "cancelled" flag here, deliberately — see the same note in
    // SellerLocationGate. Under React StrictMode the effect runs twice in
    // development; a cleanup flag would cancel the first pass while `handled`
    // turned the second away, and the prompt would never open in dev. The ref
    // alone dedupes, and a setState after a real unmount is a no-op.
    handled.current = true;

    (async () => {
      const state = await getBrowserPermissionState();
      locDebug("gate: opening prompt", { browserPermission: state, sessionKey });

      // Blocked at the browser level. The refusal is recorded straight away —
      // it is already true, and recording it is what makes the next login ask
      // again. The prompt is STILL opened, in its blocked form: saying nothing
      // would leave someone who wants to share their location with no way to
      // find out that the browser, not the app, is refusing.
      if (state === "denied") {
        remember();
        await save({ status: "denied" });
        setBlocked(true);
      }

      // EVERY OTHER STATE OPENS THE PROMPT — "granted" included.
      //
      // A browser permission belongs to the ORIGIN, not to the account. The
      // first seller who allows localhost:5173 grants it for every seller who
      // signs in on that browser afterwards. Reading the position silently in
      // that case would mean the second, third and fourth account are never
      // asked at all — their location would just be taken. Consent is per
      // account, so the prompt is shown until THAT account has answered.
      //
      // Asking costs nothing here: when the browser has already granted it,
      // pressing Allow resolves at once with no second native dialog.
      setOpen(true);
    })();
  }, [active, alreadyGranted, sessionKey, askedThisSession, remember, save]);

  const allow = async () => {
    setBusy(true);
    setError("");
    const result = await requestCurrentPosition();

    if (result.ok) {
      // NO onPreview supplied — save immediately, the original behaviour.
      if (!onPreview) {
        remember();
        await save({ status: "granted", ...result.coords });
        setBusy(false);
        setOpen(false);
        return;
      }

      // Resolve the place and SHOW IT before writing anything. A failed lookup
      // is not a failed capture: the panel falls back to the coordinates and
      // the person can still confirm, because the fix itself is good.
      let address = null;
      try {
        const r = await onPreview({ latitude: result.coords.latitude, longitude: result.coords.longitude });
        address = r?.data?.address || r?.address || null;
      } catch {
        address = null;
      }

      setPreview({ ...result.coords, address });
      setBusy(false);
      return;
    }

    setBusy(false);

    // A real refusal is recorded. The prompt stays open in its blocked form
    // rather than vanishing: the browser will not show its dialog again, so
    // the only way forward is the site setting, and that has to be said.
    if (result.denied) {
      remember();
      await save({ status: "denied" });
      setBlocked(true);
      return;
    }

    // Timeout / position unavailable: NOT a refusal. Nothing is recorded, the
    // prompt stays open, and "Allow" can be tried again.
    setError(result.message);
  };

  // Confirming is the ONLY path that writes a location from this prompt.
  const confirm = async () => {
    setBusy(true);
    setError("");
    remember();
    await save({
      status: "granted",
      latitude: preview.latitude,
      longitude: preview.longitude,
      accuracy: preview.accuracy,
    });
    setBusy(false);
    setOpen(false);
  };

  // Backing out at the confirmation step. Recorded as "denied", not "revoked":
  // they never agreed to share it, so this is a refusal in the moment and the
  // next login may reasonably ask again. Nothing about the place is stored.
  const cancelPreview = async () => {
    setPreview(null);
    remember();
    setOpen(false);
    await save({ status: "denied" });
  };

  const deny = async () => {
    remember();
    setOpen(false);
    await save({ status: "denied" });
  };

  return (
    <>
      {children}

      {open && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t.title}
            className="w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-2xl border border-gray-100"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EA2831]/10">
              <span className="material-symbols-outlined text-[26px] text-[#EA2831]">my_location</span>
            </div>

            <h2 className="mt-4 text-lg font-bold text-gray-900">
              {preview ? t.confirmTitle : t.title}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
              {preview ? t.confirmBody : t.body}
            </p>

            {/* CONFIRMATION STEP — the resolved place, shown before anything is
                saved. Same panel the settings card uses, so what is confirmed
                here looks identical to what is seen later. */}
            {preview && (
              <div className="mt-4">
                <LocationAddressPanel
                  address={preview.address}
                  latitude={preview.latitude}
                  longitude={preview.longitude}
                  accuracy={preview.accuracy}
                  text={t.panel}
                />
              </div>
            )}

            {blocked && !preview && (
              <p className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm font-medium text-amber-800">
                {t.blocked}
              </p>
            )}
            {error && <p className="mt-3 text-sm font-medium text-red-600">⚠ {error}</p>}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={preview ? cancelPreview : deny}
                disabled={busy}
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60"
              >
                {preview ? t.cancel : t.deny}
              </button>
              <button
                type="button"
                onClick={preview ? confirm : allow}
                disabled={busy}
                className="rounded-lg bg-[#EA2831] px-4 py-2.5 text-sm font-bold text-white shadow hover:bg-red-600 disabled:opacity-60"
              >
                {busy
                  ? (preview ? t.working : t.locating)
                  : (preview ? t.confirm : (blocked ? t.retry : t.allow))}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}