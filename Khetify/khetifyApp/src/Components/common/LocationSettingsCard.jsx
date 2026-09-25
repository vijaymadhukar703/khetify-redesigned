import React, { useState } from "react";
import { requestCurrentPosition, getBrowserPermissionState } from "../../lib/geolocation";
import LocationAddressPanel from "./LocationAddressPanel";

/**
 * LOCATION SETTINGS — the standing switch, shared by the Seller profile and the
 * Customer profile.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM THE LOGIN PROMPT ──
 * The prompt asks once and moves on. Consent that cannot be WITHDRAWN in the
 * same place it was given is not really consent, so this is the other half:
 * turn it off, turn it back on, and — when it is on — SEE the position actually
 * being held, because "we have your location" means nothing if you cannot check
 * what it says.
 *
 * ── TURNING IT OFF ERASES ──
 * Off sends `revoked`, and the server drops the stored point. Off does not mean
 * "keep the old fix but stop updating it"; that would be the same data still
 * sitting there behind a switch that claims to be off.
 *
 * ── OFF IS A STANDING ANSWER ──
 * `revoked` also stops the login prompt reopening. Someone who came here to
 * switch it off should not be asked again the next time they sign in.
 */
export default function LocationSettingsCard({
  // The saved consent: { status, latitude, longitude, accuracy, capturedAt }
  value,
  // (payload) => Promise — same handler the login prompt uses
  onSave,
  // Portal chrome differs, so the wrapper is injected. Defaults to a plain box.
  Wrapper,
  text = {},
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const t = {
    title: "Live location",
    subtitle: "Used to find what is nearest to you.",
    on: "Location is on",
    off: "Location is off",
    turnOn: "Turn on",
    turnOff: "Turn off",
    update: "Update location",
    working: "Getting your location…",
    savedOn: "Location saved.",
    savedOff: "Location turned off and removed.",
    capturedAt: "Last updated",
    viewOnMap: "View on map",
    accuracy: "Accuracy",
    blocked: "Location is blocked for this site in your browser. Enable it from the lock icon in the address bar, then try again.",
    ...text,
  };

  const status = value?.status || null;
  const isOn = status === "granted";
  const hasPoint = Number.isFinite(value?.latitude) && Number.isFinite(value?.longitude);

  const run = async (fn) => {
    setBusy(true); setError(""); setOk("");
    try { await fn(); } finally { setBusy(false); }
  };

  const turnOn = () => run(async () => {
    // Checked first so a hard browser block explains itself instead of looking
    // like a button that does nothing.
    if ((await getBrowserPermissionState()) === "denied") { setError(t.blocked); return; }

    const result = await requestCurrentPosition();
    if (!result.ok) { setError(result.denied ? t.blocked : result.message); return; }

    try {
      await onSave({ status: "granted", ...result.coords });
      setOk(t.savedOn);
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || "Could not save your location.");
    }
  });

  const turnOff = () => run(async () => {
    try {
      await onSave({ status: "revoked" });
      setOk(t.savedOff);
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || "Could not update your location setting.");
    }
  });

  const mapsUrl = hasPoint
    ? `https://www.google.com/maps?q=${value.latitude},${value.longitude}`
    : null;

  const body = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`material-symbols-outlined text-[22px] ${isOn ? "text-[#2E6B3E]" : "text-[#6B6A62]"}`}
          >
            {isOn ? "my_location" : "location_disabled"}
          </span>
          <span className={`text-sm font-bold ${isOn ? "text-[#2E6B3E]" : "text-[#6B6A62]"}`}>
            {isOn ? t.on : t.off}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {isOn ? (
            <>
              <button
                type="button" onClick={turnOn} disabled={busy}
                className="inline-flex h-[38px] items-center rounded-full border-[1.5px] border-[#E2E0D6] bg-white px-4 text-sm font-bold text-[#14201A] hover:bg-[#FCFCFA] disabled:opacity-60"
              >
                {busy ? t.working : t.update}
              </button>
              <button
                type="button" onClick={turnOff} disabled={busy}
                className="inline-flex h-[38px] items-center rounded-full border-[1.5px] border-[#EA2831]/30 bg-white px-4 text-sm font-bold text-[#EA2831] hover:bg-[#FDECEC] disabled:opacity-60"
              >
                {t.turnOff}
              </button>
            </>
          ) : (
            <button
              type="button" onClick={turnOn} disabled={busy}
              className="inline-flex h-[38px] items-center rounded-full bg-[#EA2831] px-5 text-sm font-bold text-white hover:bg-[#c91e26] disabled:opacity-60"
            >
              {busy ? t.working : t.turnOn}
            </button>
          )}
        </div>
      </div>

      {/* Shown only while location is ON. After it is switched off there is
          nothing left to show — the server has dropped both the coordinates
          and the resolved address. */}
      {isOn && hasPoint && (
        <LocationAddressPanel
          address={value?.address}
          latitude={value?.latitude}
          longitude={value?.longitude}
          accuracy={value?.accuracy}
          capturedAt={value?.capturedAt}
          text={t.panel}
        />
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-[12px] bg-[#FDECEC] px-3.5 py-2.5 text-sm font-medium text-[#EA2831]">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span className="min-w-0">{error}</span>
        </div>
      )}
      {ok && (
        <div className="flex items-center gap-2 rounded-[12px] bg-[#E9F2EA] px-3.5 py-2.5 text-sm font-medium text-[#2E6B3E]">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span className="min-w-0">{ok}</span>
        </div>
      )}
    </div>
  );

  if (Wrapper) return <Wrapper title={t.title} subtitle={t.subtitle}>{body}</Wrapper>;

  return (
    <section className="rounded-[20px] border border-[#E2E0D6] bg-white p-5 sm:p-6">
      <header className="mb-5">
        <h2 className="font-heading text-lg font-extrabold tracking-tight text-[#14201A] sm:text-xl">{t.title}</h2>
        <p className="mt-0.5 text-sm text-[#6B6A62]">{t.subtitle}</p>
      </header>
      {body}
    </section>
  );
}