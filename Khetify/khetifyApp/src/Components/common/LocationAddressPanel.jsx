import React from "react";

/**
 * READABLE ADDRESS PANEL — the resolved place, shown back to the person.
 *
 * Used by the confirmation step of the login prompt AND by the settings card,
 * so the address a user confirms is laid out identically to the one they later
 * see saved. Two renderings of the same thing would eventually drift and make
 * the settings page look like it was showing something else.
 *
 * ── IT DEGRADES, IT DOES NOT DISAPPEAR ──
 * Geocoding can fail or come back partial. Rather than an empty box, the panel
 * falls back through what it does have: named fields, then the provider's
 * one-line address, then the raw coordinates. Something true is always shown —
 * an empty confirmation screen asking "is this right?" is unanswerable.
 */
export default function LocationAddressPanel({
  address,
  latitude,
  longitude,
  accuracy,
  capturedAt,
  text = {},
}) {
  const t = {
    state: "State",
    district: "District",
    city: "City / Town / Village",
    pincode: "PIN Code",
    country: "Country",
    coordinates: "Coordinates",
    accuracy: "Accuracy",
    capturedAt: "Last updated",
    viewOnMap: "View on map",
    unresolved: "We could not look up the name of this place, but your coordinates were read correctly.",
    ...text,
  };

  const hasPoint = Number.isFinite(latitude) && Number.isFinite(longitude);
  const mapsUrl = hasPoint ? `https://www.google.com/maps?q=${latitude},${longitude}` : null;

  // ONE LINE, written the way a person writes their own address:
  //   City, District, State, Country - PIN
  //
  // A label/value table is how a form collects an address, not how anyone reads
  // one back. The point of this panel is "is this you?", and that question is
  // answered fastest by the shape people already recognise.
  const line = React.useMemo(() => {
    const parts = [address?.city, address?.district, address?.state, address?.country]
      .map((v) => String(v || "").trim())
      .filter(Boolean);

    // District and city are frequently the SAME name in India — Khargone city
    // in Khargone district. Printing "Khargone, Khargone" reads as a bug, so
    // consecutive repeats collapse. Only consecutive ones: a genuine
    // city/state coincidence further apart is left alone.
    const deduped = parts.filter(
      (part, i) => i === 0 || part.toLowerCase() !== parts[i - 1].toLowerCase()
    );

    const joined = deduped.join(", ");
    const pin = String(address?.pincode || "").trim();

    // Nothing named at all — fall back to whatever one-line address the
    // provider gave us rather than showing an empty panel.
    if (!joined) return address?.formatted || null;
    return pin ? `${joined} - ${pin}` : joined;
  }, [address]);

  return (
    <div className="rounded-[14px] border border-[#E2E0D6] bg-[#FAFAF7] px-4 py-3.5">
      {line ? (
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined mt-px shrink-0 text-[18px] text-[#EA2831]">location_on</span>
          <p className="min-w-0 text-sm font-bold leading-relaxed text-[#14201A] break-words">{line}</p>
        </div>
      ) : (
        <p className="text-sm text-[#6B6A62]">{t.unresolved}</p>
      )}

      {hasPoint && (
        <div className="mt-3 border-t border-[#E2E0D6] pt-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs text-[#6B6A62]">
              {t.coordinates}: {Number(latitude).toFixed(6)}, {Number(longitude).toFixed(6)}
            </span>
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-[#EA2831] hover:underline"
              >
                {t.viewOnMap}
              </a>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-[#6B6A62]">
            {Number.isFinite(accuracy) && <span>{t.accuracy}: ±{Math.round(accuracy)} m</span>}
            {capturedAt && <span>{t.capturedAt}: {new Date(capturedAt).toLocaleString()}</span>}
          </div>
        </div>
      )}
    </div>
  );
}