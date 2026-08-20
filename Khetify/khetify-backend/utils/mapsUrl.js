/**
 * GOOGLE MAPS LINK → GeoJSON POINT
 *
 * Best-effort: read [longitude, latitude] out of a Google Maps link.
 *
 * Lifted VERBATIM (behaviour-identical) from the company flow in
 * controller/Warehouse/warehouseController.js so the seller warehouse flow
 * derives coordinates by exactly the same rules. The company controller keeps
 * its own private copy untouched — nothing on the company side changes.
 *
 * The Maps link is a human-openable pointer to the site, but when it happens to
 * carry coordinates we use them to fill Warehouse.location — the field that
 * backs the 2dsphere index, the nearest-warehouse lookup and the delivery
 * geofence. That keeps those features working without putting a latitude /
 * longitude box back on the form.
 *
 * Recognised: the `!3dlat!4dlng` pair Google appends (the PLACE PIN), a
 * `?q=lat,lng` / `?ll=lat,lng` query, and the `@lat,lng,zoom` segment of a
 * /maps/place/… URL. A short maps.app.goo.gl link carries no coordinates until
 * it is followed, so it simply yields null — the URL is still stored, nothing
 * fails.
 *
 * Returns a GeoJSON Point, or null when nothing trustworthy is found.
 */
function locationFromMapsUrl(url) {
  if (!url || typeof url !== "string") return null;

  // Order matters: !3d!4d is the PLACE PIN, while @lat,lng is only the map
  // viewport centre — so the pin is preferred when a URL carries both.
  const patterns = [
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,     // …!3d23.8343!4d80.3897 (place pin)
    /[?&](?:q|ll|center|daddr)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/i, // ?q=23.8343,80.3897
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,        // /maps/place/…/@23.8343,80.3897,17z
  ];

  for (const re of patterns) {
    const m = url.match(re);
    if (!m) continue;
    // Every recognised pattern above yields LATITUDE first, then longitude.
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    const sane =
      Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
      !(lat === 0 && lng === 0);
    if (sane) return { type: "Point", coordinates: [lng, lat] };
  }
  return null;
}

module.exports = { locationFromMapsUrl };