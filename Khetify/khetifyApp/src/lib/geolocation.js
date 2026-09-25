// ─────────────────────────────────────────────────────────────
// BROWSER GEOLOCATION — a small, promise-shaped wrapper.
//
// navigator.geolocation is callback-based, throws nothing on failure, and
// reports every problem through one error object with a numeric code. Every
// caller would otherwise have to re-derive "the user said no" from
// err.code === 1. It is done once, here.
//
// NOTHING HERE THROWS FOR A DENIAL. A refusal is an ordinary outcome of asking,
// not a fault, so it is returned as a value ({ ok: false, denied: true }) and
// the caller carries on. That is what keeps a denied prompt from ever blocking
// a dashboard.
// ─────────────────────────────────────────────────────────────

export const isGeolocationSupported = () =>
  typeof navigator !== "undefined" && !!navigator.geolocation;

/**
 * OPT-IN TRACE. Silent unless someone turns it on from the console:
 *
 *   localStorage.setItem("khetify:locDebug", "1")   // then reload
 *   localStorage.removeItem("khetify:locDebug")     // off again
 *
 * The prompt decides across two components and four inputs (route, stored
 * account answer, session marker, browser permission), and when it does not
 * appear there is otherwise nothing on screen to say which of them turned it
 * away. Left in permanently because it costs one localStorage read and turns a
 * guessing game into a single line of output — but off by default, so nothing
 * is logged in production unless it is asked for.
 */
export const locDebug = (...args) => {
  try {
    if (localStorage.getItem("khetify:locDebug") === "1") console.log("[khetify:loc]", ...args);
  } catch { /* private mode */ }
};

/**
 * What the BROWSER currently thinks, if it will say.
 *
 * Only a hint — the Permissions API is missing in some browsers and blocked in
 * some embedded webviews, hence "unknown". The account-level answer stored on
 * the server is the real source of truth; this exists so that a browser which
 * has ALREADY granted permission can be read silently, with no second prompt.
 *
 * @returns {Promise<"granted"|"denied"|"prompt"|"unknown">}
 */
export async function getBrowserPermissionState() {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    const result = await navigator.permissions.query({ name: "geolocation" });
    return result?.state || "unknown";
  } catch {
    // Firefox historically threw on unsupported descriptors; Safari in some
    // versions rejects "geolocation" outright. Neither is worth surfacing.
    return "unknown";
  }
}

const ERROR_MESSAGES = {
  1: "Location permission was blocked. You can enable it from your browser's site settings.",
  2: "Your location could not be determined right now. Please try again.",
  3: "Getting your location took too long. Please try again.",
};

/**
 * Ask the browser for one position fix.
 *
 * Resolves — never rejects — with either:
 *   { ok: true,  coords: { latitude, longitude, accuracy } }
 *   { ok: false, denied: boolean, message: string }
 *
 * `denied` is true ONLY for a real permission refusal (code 1). A timeout or an
 * unavailable fix is a failure to READ the location, not a refusal to share it,
 * and the two must not be recorded the same way: treating a timeout as a denial
 * would mean the account is asked again forever.
 */
export function requestCurrentPosition({ timeout = 15000, maximumAge = 60000 } = {}) {
  return new Promise((resolve) => {
    if (!isGeolocationSupported()) {
      resolve({ ok: false, denied: false, message: "This browser does not support location access." });
      return;
    }

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const c = position?.coords || {};
        if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) {
          finish({ ok: false, denied: false, message: ERROR_MESSAGES[2] });
          return;
        }
        finish({
          ok: true,
          coords: {
            latitude: c.latitude,
            longitude: c.longitude,
            // Some devices report null accuracy; send nothing rather than null.
            accuracy: Number.isFinite(c.accuracy) ? c.accuracy : undefined,
          },
        });
      },
      (error) => {
        const code = error?.code;
        finish({
          ok: false,
          denied: code === 1,
          message: ERROR_MESSAGES[code] || "Location could not be fetched.",
        });
      },
      { enableHighAccuracy: true, timeout, maximumAge }
    );
  });
}