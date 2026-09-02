/**
 * REVERSE GEOCODING — coordinates in, a readable Indian address out.
 *
 * ── PROVIDER-AGNOSTIC, LIKE THE PAYMENT ADAPTER ──
 * Google when GOOGLE_MAPS_API_KEY is set, OpenStreetMap's Nominatim otherwise.
 * The two return completely different shapes; both are normalised to the same
 * six fields here so nothing downstream knows or cares which one answered.
 *
 * ── IT NEVER THROWS ──
 * A lookup that fails returns null. Reverse geocoding is a NICETY: it turns a
 * pair of numbers into something a person can check. If the provider is down,
 * rate-limiting us, or simply does not know the place, the coordinates are
 * still perfectly good and consent still works — the confirmation screen just
 * shows the numbers instead of a village name. Letting a geocoder outage block
 * a login prompt would be absurd.
 *
 * ── WHY THE SERVER DOES THIS AND NOT THE BROWSER ──
 * The address is STORED, so it has to be trustworthy. If the browser resolved
 * it and posted the text, anyone could save whatever address they liked against
 * their account. The client sends coordinates; the server decides what those
 * coordinates are called.
 *
 * ── NOMINATIM USAGE POLICY ──
 * Max one request per second, and a real User-Agent identifying the app, or the
 * IP gets blocked. Both are honoured below. It is fine for this workload —
 * consent is captured roughly once per account — but a bulk backfill would need
 * Google or a self-hosted instance instead.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;
const NOMINATIM_MIN_GAP_MS = 1100; // their policy is 1/sec; leave headroom

// Rounded to ~11 m. The preview call and the save that follows it are the same
// place, so the second one is served from here and the provider sees one hit.
const cache = new Map();
const cacheKey = (lat, lng) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value) {
  // Bounded so a long-running process cannot grow this without limit.
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), value });
}

/** Fetch with a hard timeout — a hung provider must not hold a request open. */
async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // network error, timeout, malformed JSON — all the same here
  } finally {
    clearTimeout(timer);
  }
}

const clean = (v) => {
  const s = String(v == null ? "" : v).trim();
  return s || null;
};

/* ─────────────── Nominatim (default, no key needed) ─────────────── */

let lastNominatimAt = 0;

async function nominatim(lat, lng) {
  const wait = NOMINATIM_MIN_GAP_MS - (Date.now() - lastNominatimAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimAt = Date.now();

  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}` +
    `&zoom=18&addressdetails=1&accept-language=en`;

  const json = await fetchJson(url, {
    // Required by their policy. Without it requests are refused outright.
    "User-Agent": process.env.NOMINATIM_USER_AGENT || "Khetify/1.0 (support@khetify.com)",
    Accept: "application/json",
  });
  if (!json || !json.address) return null;

  const a = json.address;

  return {
    // OSM tags Indian states as `state`, districts as `state_district` and
    // sometimes `county`. Settlements land on whichever of city / town /
    // village / suburb fits the place's size, so all four are tried in
    // descending order.
    state: clean(a.state),
    district: clean(a.state_district || a.county || a.district),
    city: clean(a.city || a.town || a.village || a.suburb || a.hamlet),
    pincode: clean(a.postcode),
    country: clean(a.country),
    formatted: clean(json.display_name),
    provider: "nominatim",
  };
}

/* ─────────────── Google (used when a key is configured) ─────────────── */

function googleComponent(components, type) {
  const hit = (components || []).find((c) => (c.types || []).includes(type));
  return hit ? clean(hit.long_name) : null;
}

async function google(lat, lng, key) {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?latlng=${encodeURIComponent(`${lat},${lng}`)}&language=en&key=${encodeURIComponent(key)}`;

  const json = await fetchJson(url);
  if (!json || json.status !== "OK" || !json.results?.length) return null;

  const result = json.results[0];
  const c = result.address_components;

  return {
    state: googleComponent(c, "administrative_area_level_1"),
    district: googleComponent(c, "administrative_area_level_2"),
    city:
      googleComponent(c, "locality") ||
      googleComponent(c, "sublocality") ||
      googleComponent(c, "administrative_area_level_3"),
    pincode: googleComponent(c, "postal_code"),
    country: googleComponent(c, "country"),
    formatted: clean(result.formatted_address),
    provider: "google",
  };
}

/* ─────────────── Public API ─────────────── */

/**
 * Resolve coordinates to a readable address.
 *
 * @returns {Promise<object|null>} normalised address, or null if unresolvable
 */
async function reverseGeocode(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const key = cacheKey(lat, lng);
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  let address = null;
  try {
    address = googleKey ? await google(lat, lng, googleKey) : await nominatim(lat, lng);
  } catch {
    address = null; // see "IT NEVER THROWS" above
  }

  // A result with nothing recognisable in it is worse than none — it would show
  // the user an empty confirmation panel and imply we know where they are.
  if (address && !address.state && !address.district && !address.city && !address.pincode) {
    address = null;
  }

  cacheSet(key, address);
  return address;
}

module.exports = { reverseGeocode };