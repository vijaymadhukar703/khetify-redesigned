const { distanceMeters } = require("./geoService");

/**
 * WAREHOUSE PROXIMITY
 *
 * Rank warehouses by how geographically close they are to a delivery address,
 * so "Assign a warehouse" can RECOMMEND the nearest one instead of leaving the
 * operator to guess from a list sorted by name.
 *
 * The ranking is built ONLY from real location data — coordinates and postal
 * geography. A warehouse is never favoured for being named "Main", for being
 * created first, or for any other incidental ordering.
 *
 * WHY THERE ARE TIERS
 * Coordinates are the honest answer, but we rarely have them for BOTH ends:
 * Warehouse.location is filled from the Google Maps link (and is [0,0] when
 * that link carried none), while a delivery address is captured as text —
 * line1 / city / district / state / pincode, with no lat-lng anywhere in the
 * checkout or customer flows. So a coordinate-only implementation would
 * silently recommend nothing in the common case.
 *
 * Instead we fall back to POSTAL geography, which is genuinely spatial. Indian
 * PIN codes are hierarchical, and each leading digit narrows the area:
 *
 *   4 6 2 0 1 1
 *   │ │ │ └─┴─┴─ delivery post office
 *   │ │ └─────── sorting district
 *   │ └───────── circle (roughly a state / sub-region)
 *   └─────────── postal region / zone
 *
 * So the number of shared leading digits between two PINs is a real measure of
 * how close they are — 462011 vs 462043 (4 shared) is the same city, while
 * 462011 vs 411001 (0 shared) is a different corner of the country. This is
 * coarser than a distance in kilometres and is never presented as one; the
 * caller gets a `basis` telling it which tier produced the answer, so the UI
 * can say "Nearest · 12 km" or "Same city" and never invent a precision it
 * doesn't have.
 *
 * TIERS, best first:
 *   1 "distance" — both ends have usable coordinates → true haversine metres.
 *   2 "pincode"  — shared leading PIN digits (3+ ≈ same sorting district).
 *   3 "district" / "city" / "state" — administrative match.
 *   4 "unknown"  — nothing comparable; ranks last, never recommended.
 */

const clean = (v) => String(v == null ? "" : v).trim();
const norm = (v) => clean(v).toLowerCase();
const pinOf = (a) => (clean(a?.pincode).match(/^\d{6}$/) ? clean(a.pincode) : "");

/** Usable [lat, lng], or null. GeoJSON is [lng, lat]; [0,0] means "never set". */
function coordsOfWarehouse(w) {
  const c = w?.location?.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  const [lng, lat] = c.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null; // schema default, not a real place
  return [lat, lng];
}

/**
 * Usable [lat, lng] from a delivery address, or null.
 *
 * No current flow writes coordinates onto an address, so this returns null
 * today. It reads several shapes anyway so that the moment checkout or the
 * customer form starts capturing a pin-drop, the exact tier switches on with
 * no change here.
 */
function coordsOfAddress(a) {
  if (!a) return null;
  const c = a.location?.coordinates;
  if (Array.isArray(c) && c.length >= 2) {
    const [lng, lat] = c.map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) return [lat, lng];
  }
  const lat = Number(a.lat ?? a.latitude);
  const lng = Number(a.lng ?? a.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) return [lat, lng];
  return null;
}

/** How many leading digits two 6-digit PINs share (0–6). */
function sharedPinDigits(a, b) {
  if (!a || !b) return 0;
  let n = 0;
  while (n < 6 && a[n] === b[n]) n += 1;
  return n;
}

/**
 * Score ONE warehouse against ONE delivery address.
 *
 * Returns { rank, basis, distanceKm, label } where a LOWER rank is closer.
 * `rank` is only ever compared between warehouses scored against the same
 * address, so its absolute value carries no meaning outside this module.
 */
function scoreWarehouse(warehouse, address) {
  const wAddr = warehouse?.address || {};

  // TIER 1 — true distance.
  const wc = coordsOfWarehouse(warehouse);
  const ac = coordsOfAddress(address);
  if (wc && ac) {
    const metres = distanceMeters(ac[0], ac[1], wc[0], wc[1]);
    const km = metres / 1000;
    return {
      rank: km, // 0…~3000, always beats every fallback below
      basis: "distance",
      distanceKm: Math.round(km * 10) / 10,
      label: km < 1 ? "Nearest · under 1 km" : `Nearest · ${Math.round(km)} km`,
    };
  }

  // TIER 2 — postal proximity. Offset past any real distance so a coordinate
  // match always outranks a PIN match.
  const shared = sharedPinDigits(pinOf(wAddr), pinOf(address));
  if (shared >= 2) {
    const LABEL = {
      6: "Same PIN code",
      5: "Same delivery area",
      4: "Same locality",
      3: "Same sorting district",
      2: "Same postal circle",
    };
    return { rank: 100000 + (6 - shared), basis: "pincode", distanceKm: null, label: LABEL[shared] };
  }

  // TIER 3 — administrative match.
  if (norm(wAddr.district) && norm(wAddr.district) === norm(address?.district)) {
    return { rank: 200001, basis: "district", distanceKm: null, label: "Same district" };
  }
  if (norm(wAddr.city) && norm(wAddr.city) === norm(address?.city)) {
    return { rank: 200002, basis: "city", distanceKm: null, label: "Same city" };
  }
  if (norm(wAddr.state) && norm(wAddr.state) === norm(address?.state)) {
    return { rank: 200003, basis: "state", distanceKm: null, label: "Same state" };
  }

  // TIER 4 — nothing comparable.
  return { rank: Number.MAX_SAFE_INTEGER, basis: "unknown", distanceKm: null, label: null };
}

/**
 * Rank `warehouses` against `address`, closest first.
 *
 * Returns the same objects with `proximity` attached, and `recommended: true`
 * on exactly one — the closest, and ONLY when we actually had something to
 * compare (basis !== "unknown"). With no usable address, or warehouses with no
 * address of their own, nothing is marked: an arbitrary pick dressed up as a
 * recommendation is worse than no recommendation at all.
 *
 * Ties break on name purely for a stable, repeatable order — never to decide
 * which warehouse is nearer.
 */
function rankByProximity(warehouses = [], address = null) {
  const scored = warehouses.map((w) => ({ ...w, proximity: scoreWarehouse(w, address) }));

  scored.sort(
    (a, b) => a.proximity.rank - b.proximity.rank ||
      String(a.name || "").localeCompare(String(b.name || ""))
  );

  const best = scored[0];
  if (best && best.proximity.basis !== "unknown") best.recommended = true;
  return scored;
}

/**
 * PLAN A PRODUCT → WAREHOUSE ALLOCATION for one order.
 *
 * `warehouses` are proximity-ranked rows (the output of rankByProximity), each
 * carrying `items: [{ productId, requiredQty, availableQty }]`. Returns a map of
 * productId → warehouseId covering every product that CAN be covered.
 *
 * Two goals pull against each other:
 *   • pick warehouses near the customer, and
 *   • use as FEW warehouses as possible, since each extra one is another
 *     physical parcel, another pick/pack cycle and another tracking number.
 *
 * Fewest-warehouses wins the tie, because a split is a real operational cost
 * while second-nearest is usually a marginal one. So this is a greedy set
 * cover: repeatedly take the warehouse that covers the MOST still-unassigned
 * products, breaking ties by proximity rank. When one warehouse holds the whole
 * basket that first pass takes it outright and the order never splits — which
 * is the common case and the one the spec calls out.
 *
 * A warehouse is only ever a candidate for a product it can cover IN FULL
 * (availableQty >= requiredQty), so a plan never proposes a short pick. A
 * product no warehouse can cover is simply absent from the returned map; the
 * caller reports it as unfulfillable rather than silently under-allocating.
 *
 * Greedy set cover is not guaranteed optimal, but the optimum here is over a
 * handful of warehouses and a handful of products, and the failure mode is one
 * extra parcel — never a wrong or short allocation.
 */
function planAllocation(warehouses = []) {
  const plan = {};

  // Which warehouses can fully cover each product, in proximity order (the
  // input is already sorted, so index order IS proximity order).
  const candidates = new Map(); // productId -> [warehouse row]
  for (const w of warehouses) {
    for (const it of w.items || []) {
      if ((it.availableQty || 0) < it.requiredQty) continue;
      const pid = String(it.productId);
      if (!candidates.has(pid)) candidates.set(pid, []);
      candidates.get(pid).push(w);
    }
  }

  const remaining = new Set([...candidates.keys()].filter((pid) => candidates.get(pid).length));

  while (remaining.size) {
    let best = null;
    let bestCovered = [];
    // `warehouses` is proximity-sorted, so scanning in order and keeping only a
    // STRICTLY larger cover means ties resolve to the nearer warehouse.
    for (const w of warehouses) {
      const covered = [...remaining].filter((pid) =>
        (candidates.get(pid) || []).some((c) => String(c.warehouseId) === String(w.warehouseId))
      );
      if (covered.length > bestCovered.length) { best = w; bestCovered = covered; }
    }
    if (!best) break; // nothing left that any warehouse can cover
    for (const pid of bestCovered) {
      plan[pid] = String(best.warehouseId);
      remaining.delete(pid);
    }
  }

  return plan;
}

module.exports = { rankByProximity, planAllocation, scoreWarehouse, coordsOfWarehouse, coordsOfAddress, sharedPinDigits };