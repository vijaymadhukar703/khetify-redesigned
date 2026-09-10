import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useShopAuth } from "../../context/ShopAuthContext";
import { useCart } from "../../context/CartContext";
import { useWishlist } from "../../context/WishlistContext";
import {
  getShopAddresses, addShopAddress, updateShopAddress,
  setDefaultShopAddress, deleteShopAddress,
  changeShopPassword, shopVerifyOtp, shopResendOtp, getShopOrders,
  saveShopLocation,
} from "../../lib/shopApi";
import LocationSettingsCard from "../../Components/common/LocationSettingsCard";
import { lookupPincode } from "../../lib/pincodeLookup";
import { getProductImage } from "../../lib/productImage";
import { rupee } from "../../Components/shop/ProductCard";
import { useT } from "../../context/ShopLanguageContext";
import { STATUS_LABEL_KEY } from "../../lib/orderStatus";

/* ─────────────────────────────────────────────────────────────────────────────
 * Khetify — Customer Profile hub  (/customer-shop/profile)
 *
 * THE REFERENCE UI, ON THIS PROJECT'S FUNCTIONALITY.
 *
 * The layout, tokens and components below are the reference design. Everything
 * it did NOT carry, but this app does, is kept and wired into it:
 *
 *   • i18n — every string goes through t(); the reference hardcoded English,
 *     which would have silently un-translated the whole page in Hindi.
 *   • Pincode lookup — the address form still resolves district/state from a
 *     6-digit PIN and locks those two fields once it does.
 *   • LocationSettingsCard — still rendered on the Personal Info tab.
 *   • STATUS_LABEL_KEY — the SHARED order vocabulary from lib/orderStatus is
 *     used, not a second copy declared here. The reference declared its own
 *     STATUS_LABEL and STEP_SHORT maps; two copies of the same vocabulary is
 *     exactly how this screen and the order detail page drift apart.
 *
 * Every shopApi call, context, validation rule and the ?tab= URL contract is
 * unchanged.
 *
 * Design tokens (inline arbitrary values, so tailwind.config stays untouched):
 *   canvas #FBFAF7 · surface #FFFFFF · hairline #EBE8E2 · softgrey #F3F1EC
 *   ink    #171412 · muted   #8A8681 · faint    #A8A49E
 *   red    #EA2831 · green   #0F8A5F · amber    #B7791F
 * ───────────────────────────────────────────────────────────────────────────── */

// Module scope has no t(): labels are KEYS, resolved where the tabs render.
const TABS = [
  { key: "profile",   labelKey: "pf.tabProfile",   shortKey: "pf.tabProfileShort",   icon: "person" },
  { key: "addresses", labelKey: "pf.tabAddresses", shortKey: "pf.tabAddressesShort", icon: "location_on" },
  { key: "orders",    labelKey: "pf.tabOrders",    shortKey: "pf.tabOrdersShort",    icon: "receipt_long" },
  { key: "wishlist",  labelKey: "pf.tabWishlist",  shortKey: "pf.tabWishlistShort",  icon: "favorite" },
  { key: "security",  labelKey: "pf.tabSecurity",  shortKey: "pf.tabSecurityShort",  icon: "lock" },
];

const EMPTY_ADDR = {
  label: "Home", fullName: "", phone: "", line1: "", line2: "",
  city: "", district: "", state: "", pincode: "",
};

const ORDER_STEPS = ["pending", "confirmed", "packed", "shipped", "delivered"];

/* Pill tone per status. The LABELS come from STATUS_LABEL_KEY; only the colour
   is decided here, so the words stay in one place. */
const STATUS_TONE = {
  pending: "grey", confirmed: "amber", packed: "amber", shipped: "amber",
  delivered: "green", returned: "amber", cancelled: "red",
};

/* ─────────────── Design primitives ─────────────── */

// Refined icon weight (fill 0, weight 300) per the reference.
const ICON = "material-symbols-outlined [font-variation-settings:'FILL'_0,'wght'_300]";

const CARD_CLS =
  "rounded-[14px] border border-[#EBE8E2] bg-white shadow-[0_1px_2px_rgba(23,20,18,0.04)]";

const field =
  "h-[44px] w-full rounded-[10px] border border-[#EBE8E2] bg-white px-3.5 " +
  "text-[14px] text-[#171412] placeholder:text-[#A8A49E] outline-none " +
  "transition-all duration-150 hover:border-[#DCD8D0] " +
  "focus:border-[#EA2831] focus:ring-4 focus:ring-[#EA2831]/10 " +
  "disabled:cursor-not-allowed disabled:border-[#EBE8E2] disabled:bg-[#FBFAF7] disabled:text-[#8A8681]";

// Shared as CLASS STRINGS, not just components, so a react-router <Link> can
// wear the exact same skin without nesting a <button> inside an <a>.
const GHOST_CLS =
  "inline-flex h-[36px] items-center justify-center gap-1.5 rounded-[10px] border border-[#EBE8E2] " +
  "bg-white px-3.5 text-[13px] font-medium text-[#171412] transition-all duration-150 " +
  "hover:border-[#DCD8D0] hover:bg-[#FBFAF7] focus-visible:outline-none " +
  "focus-visible:ring-4 focus-visible:ring-[#EA2831]/15 disabled:cursor-not-allowed disabled:opacity-50";

const SOLID_CLS =
  "inline-flex h-[36px] items-center justify-center gap-1.5 rounded-[10px] bg-[#EA2831] px-4 " +
  "text-[13px] font-medium text-white transition-all duration-150 hover:bg-[#C91E26] " +
  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#EA2831]/25 " +
  "disabled:cursor-not-allowed disabled:bg-[#F0A0A6] disabled:hover:bg-[#F0A0A6]";

const LINK_CLS =
  "inline-flex items-center gap-1.5 text-[13px] font-medium text-[#171412] " +
  "transition-colors duration-150 hover:text-[#EA2831]";

const ICONBTN_CLS =
  "inline-flex h-[36px] w-[36px] items-center justify-center rounded-[10px] border border-[#EBE8E2] " +
  "bg-white text-[#171412] transition-all duration-150 hover:border-[#DCD8D0] hover:bg-[#FBFAF7] " +
  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#EA2831]/15";

function GhostButton({ children, className = "", ...p }) {
  return <button className={`${GHOST_CLS} ${className}`} {...p}>{children}</button>;
}

function SolidButton({ children, className = "", ...p }) {
  return <button className={`${SOLID_CLS} ${className}`} {...p}>{children}</button>;
}

function Tooltip({ label, children }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-full z-40 mt-2 -translate-x-1/2 whitespace-nowrap
                   rounded-md bg-[#171412] px-2 py-1 text-[11px] font-medium text-white opacity-0
                   transition-opacity duration-150 group-hover:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

function Note({ tone = "error", children }) {
  if (!children) return null;
  const map = {
    error:   { bar: "bg-[#EA2831]", bg: "bg-[#FDECEE]", fg: "text-[#C0192A]", icon: "error" },
    success: { bar: "bg-[#0F8A5F]", bg: "bg-[#E7F4EE]", fg: "text-[#0F8A5F]", icon: "check_circle" },
    info:    { bar: "bg-[#A8A49E]", bg: "bg-[#F3F1EC]", fg: "text-[#5C5952]", icon: "info" },
  };
  // Renamed off `t` — that identifier is the translator everywhere else in
  // this file, and shadowing it here is a trap for the next edit.
  const tone_ = map[tone] || map.info;
  return (
    <div className={`flex items-stretch overflow-hidden rounded-[10px] ${tone_.bg}`}>
      <span aria-hidden="true" className={`w-[3px] shrink-0 ${tone_.bar}`} />
      <div className={`flex items-center gap-2 px-3 py-2.5 text-[13px] font-medium ${tone_.fg}`}>
        <span className={`${ICON} text-[17px]`}>{tone_.icon}</span>
        <span className="min-w-0">{children}</span>
      </div>
    </div>
  );
}

// Dot + label pill, exactly like the reference status chips.
function DotPill({ tone = "grey", children }) {
  const map = {
    grey:  { bg: "bg-[#F3F1EC]", fg: "text-[#5C5952]", dot: "bg-[#A8A49E]" },
    green: { bg: "bg-[#E7F4EE]", fg: "text-[#0F8A5F]", dot: "bg-[#0F8A5F]" },
    amber: { bg: "bg-[#FBF2E3]", fg: "text-[#B7791F]", dot: "bg-[#B7791F]" },
    red:   { bg: "bg-[#FDECEE]", fg: "text-[#EA2831]", dot: "bg-[#EA2831]" },
  };
  const tone_ = map[tone] || map.grey;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${tone_.bg} ${tone_.fg}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone_.dot}`} />
      {children}
    </span>
  );
}

// Icon + label chip (address type).
function IconChip({ icon, children }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#F3F1EC] px-2.5 py-1 text-[11.5px] font-medium text-[#5C5952]">
      {icon && <span className={`${ICON} text-[14px]`}>{icon}</span>}
      {children}
    </span>
  );
}

function Card({ title, subtitle, action, children, className = "", bodyClassName = "" }) {
  return (
    <section className={`${CARD_CLS} ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
          <div>
            <h2 className="font-heading text-[19px] font-bold leading-tight tracking-tight text-[#171412]">{title}</h2>
            {subtitle && <p className="mt-1 text-[13px] text-[#8A8681]">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={`px-5 pb-5 pt-5 sm:px-6 sm:pb-6 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

function EmptyState({ icon, title, body, cta }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#F3F1EC]">
        <span className={`${ICON} text-[26px] text-[#A8A49E]`}>{icon}</span>
      </span>
      <h3 className="font-heading mt-4 text-[16px] font-bold tracking-tight text-[#171412]">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-[#8A8681]">{body}</p>}
      {cta}
    </div>
  );
}

function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-[10px] bg-[#F3F1EC] ${className}`} />;
}

const initialsOf = (name = "") =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "K";

function Avatar({ name }) {
  return (
    <span className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#EA2831] to-[#F5842C] p-[2px]">
      <span className="flex h-full w-full items-center justify-center rounded-full bg-white text-[13px] font-semibold tracking-wide text-[#171412]">
        {initialsOf(name)}
      </span>
    </span>
  );
}

/* ─────────────── Side navigation ─────────────── */

function Tabs({ active, onChange, counts }) {
  const t = useT();
  const idx = TABS.findIndex((item) => item.key === active);

  const onKeyDown = (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = TABS[(idx + step + TABS.length) % TABS.length];
    onChange(next.key);
    document.getElementById(`profile-tab-${next.key}`)?.focus();
  };

  return (
    <nav className="md:sticky md:top-[84px] md:self-start" aria-label={t("pf.navAria")}>
      <ul
        role="tablist"
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
                   md:mx-0 md:flex-col md:gap-1 md:overflow-visible md:px-0 md:pb-0"
      >
        {/* Map param renamed off `t` — it would shadow the translator. */}
        {TABS.map((item) => {
          const on = item.key === active;
          const n = counts[item.key];
          return (
            <li key={item.key} className="relative shrink-0 snap-start md:shrink">
              {on && (
                <span
                  aria-hidden="true"
                  className="absolute -left-2.5 top-1/2 hidden h-6 w-[3px] -translate-y-1/2 rounded-full bg-[#EA2831] md:block"
                />
              )}
              <button
                id={`profile-tab-${item.key}`}
                role="tab"
                type="button"
                aria-selected={on}
                aria-controls="profile-panel"
                tabIndex={on ? 0 : -1}
                onClick={() => onChange(item.key)}
                className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-[10px] px-3.5 py-2.5 text-[14px]
                            transition-all duration-150 focus-visible:outline-none focus-visible:ring-4
                            focus-visible:ring-[#EA2831]/15 ${
                  on
                    ? "border border-[#EBE8E2] bg-white font-medium text-[#171412] shadow-[0_1px_2px_rgba(23,20,18,0.04)]"
                    : "border border-transparent text-[#8A8681] hover:bg-white/70 hover:text-[#171412]"
                }`}
              >
                <span className={`${ICON} text-[19px] ${on ? "text-[#EA2831]" : "text-[#A8A49E]"}`}>{item.icon}</span>
                <span className="md:hidden">{t(item.shortKey)}</span>
                <span className="hidden md:inline">{t(item.labelKey)}</span>
                {n > 0 && (
                  <span className={`ml-auto hidden text-[12px] tabular-nums md:inline ${on ? "text-[#EA2831]" : "text-[#A8A49E]"}`}>
                    {n}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ─────────────── Right rail (Personal Info only) ─────────────── */

// function ProfileCompleteness({ consumer, addressCount }) {
//   const t = useT();
//   /* Derived, never stored — add a phone number and the bar moves on the same
//      render. A stored percentage would be one more thing to keep in step. */
//   const checks = [
//     { key: "pf.checkName",    done: !!(consumer.name || "").trim() },
//     { key: "pf.checkPhone",   done: (consumer.phone || "").length === 10 },
//     { key: "pf.checkEmail",   done: !!consumer.emailVerified },
//     { key: "pf.checkAddress", done: addressCount > 0 },
//   ];
//   const done = checks.filter((c) => c.done).length;
//   const pct = Math.round((done / checks.length) * 100);

//   return (
//     <section className={`${CARD_CLS} p-5`}>
//       <div className="flex items-center gap-3">
//         <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#FDECEE]">
//           <span className={`${ICON} text-[19px] text-[#EA2831]`}>workspace_premium</span>
//         </span>
//         <div>
//           <p className="text-[13px] text-[#8A8681]">{t("pf.completeness")}</p>
//           <p className="font-heading text-[22px] font-extrabold leading-tight tracking-tight tabular-nums text-[#171412]">{pct}%</p>
//         </div>
//       </div>

//       <div
//         className="mt-3.5 h-[5px] w-full overflow-hidden rounded-full bg-[#EBE8E2]"
//         role="progressbar"
//         aria-valuenow={pct}
//         aria-valuemin={0}
//         aria-valuemax={100}
//       >
//         <div
//           className="h-full rounded-full bg-gradient-to-r from-[#EA2831] to-[#F5842C] transition-[width] duration-500 ease-out"
//           style={{ width: `${pct}%` }}
//         />
//       </div>

//       <ul className="mt-4 flex flex-col gap-2.5">
//         {checks.map((c) => (
//           <li key={c.key} className="flex items-center gap-2.5 text-[13px]">
//             {c.done ? (
//               <span className={`${ICON} text-[17px] text-[#0F8A5F]`}>check</span>
//             ) : (
//               <span aria-hidden="true" className="flex h-[17px] w-[17px] items-center justify-center">
//                 <span className="h-px w-2.5 bg-[#C9C5BD]" />
//               </span>
//             )}
//             <span className={c.done ? "text-[#171412]" : "text-[#A8A49E]"}>{t(c.key)}</span>
//           </li>
//         ))}
//       </ul>
//     </section>
//   );
// }

// function MemberSince({ consumer }) {
//   const t = useT();
//   // Only rendered when the account actually carries a join date — nothing is
//   // invented if the API doesn't send one.
//   const raw = consumer.createdAt || consumer.joinedAt || consumer.memberSince;
//   const d = raw ? new Date(raw) : null;
//   if (!d || Number.isNaN(d.getTime())) return null;

//   return (
//     <section className={`${CARD_CLS} p-5`}>
//       <p className="flex items-center gap-2 text-[13px] text-[#8A8681]">
//         <span className={`${ICON} text-[17px] text-[#A8A49E]`}>calendar_month</span> {t("pf.memberSince")}
//       </p>
//       <p className="font-heading mt-2 text-[17px] font-bold leading-tight tracking-tight text-[#171412]">
//         {d.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
//       </p>
//     </section>
//   );
// }

/* ─────────────── Personal information ─────────────── */

function PersonalInfo({ consumer, updateProfile, refresh }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: consumer.name || "", phone: consumer.phone || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  // Email verification (uses the OTP endpoints that already existed).
  const [otpOpen, setOtpOpen] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpNote, setOtpNote] = useState("");

  useEffect(() => {
    setForm({ name: consumer.name || "", phone: consumer.phone || "" });
  }, [consumer.name, consumer.phone]);

  const onPhone = (e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }));

  const cancel = () => {
    setForm({ name: consumer.name || "", phone: consumer.phone || "" });
    setEditing(false); setError(""); setOk("");
  };

  const save = async (e) => {
    e.preventDefault();
    setError(""); setOk("");
    if (!form.name.trim()) { setError(t("pf.errNameEmpty")); return; }
    if (form.phone && form.phone.length !== 10) { setError(t("pf.errPhone")); return; }
    setBusy(true);
    try {
      await updateProfile({ name: form.name.trim(), phone: form.phone });
      setOk(t("pf.profileUpdated"));
      setEditing(false);
    } catch (err) {
      setError(err?.response?.data?.message || t("pf.errProfileUpdate"));
    } finally {
      setBusy(false);
    }
  };

  const sendOtp = async () => {
    setError(""); setOk(""); setOtpNote(""); setOtpBusy(true);
    try {
      const res = await shopResendOtp();
      setOtpOpen(true);
      setOtpNote(res.otpSent
        ? t("pf.otpSent", { email: consumer.email })
        : t("pf.otpNotConfigured"));
    } catch (err) {
      setError(err?.response?.data?.message || t("pf.errSendCode"));
    } finally {
      setOtpBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError(""); setOtpBusy(true);
    try {
      await shopVerifyOtp(otp);
      await refresh();
      setOtpOpen(false); setOtp(""); setOtpNote("");
      setOk(t("pf.emailVerified"));
    } catch (err) {
      setError(err?.response?.data?.message || t("pf.errIncorrectCode"));
    } finally {
      setOtpBusy(false);
    }
  };

  return (
    <Card
      title={t("pf.tabProfile")}
      subtitle={t("pf.personalSubtitle")}
      action={!editing && (
        <GhostButton onClick={() => { setEditing(true); setOk(""); }}>
          <span className={`${ICON} text-[16px]`}>edit</span> {t("pf.edit")}
        </GhostButton>
      )}
    >
      <div className="flex flex-col gap-4">
        {error && <Note tone="error">{error}</Note>}
        {ok && <Note tone="success">{ok}</Note>}

        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] text-[#5C5952]">{t("pf.fullName")}</span>
            <input
              className={field}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              disabled={!editing}
              placeholder={t("pf.yourName")}
              autoComplete="name"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] text-[#5C5952]">{t("pf.phone")}</span>
            <input
              className={`${field} tabular-nums`}
              value={form.phone}
              onChange={onPhone}
              disabled={!editing}
              placeholder={t("pf.phonePlaceholder")}
              inputMode="numeric"
              maxLength={10}
              autoComplete="tel"
            />
          </label>

          {/* Email is READ-ONLY on purpose: it is the login identifier, so
              changing it needs its own verify-first flow rather than a plain save. */}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="kf-email" className="text-[13px] text-[#5C5952]">{t("pf.email")}</label>
            <div className="flex flex-wrap items-center gap-2.5">
              <input id="kf-email" className={`${field} sm:max-w-[360px]`} value={consumer.email || "—"} disabled />
              {consumer.emailVerified
                ? <DotPill tone="green">{t("pf.verified")}</DotPill>
                : <DotPill tone="amber">{t("pf.notVerified")}</DotPill>}
            </div>
            <span className="text-[12.5px] text-[#A8A49E]">
              {consumer.emailVerified ? t("pf.emailVerifiedHint") : t("pf.emailLocked")}
            </span>
          </div>

          {editing && (
            <div className="flex flex-wrap gap-2.5 sm:col-span-2">
              <SolidButton type="submit" disabled={busy}>{busy ? t("pf.saving") : t("pf.saveChanges")}</SolidButton>
              <GhostButton type="button" onClick={cancel} disabled={busy}>{t("pf.cancel")}</GhostButton>
            </div>
          )}
        </form>

        {/* Verify email — only when there is an unverified email on the account. */}
        {consumer.email && !consumer.emailVerified && (
          <div className="rounded-[12px] border border-[#EBE8E2] bg-[#FBFAF7] p-4">
            {!otpOpen ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px] text-[#8A8681]">{t("pf.verifyPrompt")}</p>
                <GhostButton onClick={sendOtp} disabled={otpBusy}>
                  {otpBusy ? t("pf.sending") : t("pf.verifyNow")}
                </GhostButton>
              </div>
            ) : (
              <form onSubmit={verify} className="flex flex-col gap-3">
                {otpNote && <Note tone="info">{otpNote}</Note>}
                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="______"
                    maxLength={6}
                    inputMode="numeric"
                    aria-label={t("pf.otpAria")}
                    className="h-[44px] w-[150px] rounded-[10px] border border-[#EBE8E2] bg-white px-3 text-center text-[17px] tabular-nums tracking-[0.4em] text-[#171412] outline-none transition-all duration-150 focus:border-[#EA2831] focus:ring-4 focus:ring-[#EA2831]/10"
                  />
                  <SolidButton type="submit" disabled={otpBusy || otp.length < 4}>
                    {otpBusy ? t("pf.verifying") : t("pf.verify")}
                  </SolidButton>
                  <GhostButton type="button" onClick={sendOtp} disabled={otpBusy}>{t("pf.resend")}</GhostButton>
                  <button
                    type="button"
                    onClick={() => { setOtpOpen(false); setOtp(""); setOtpNote(""); }}
                    className="text-[13px] font-medium text-[#A8A49E] transition-colors duration-150 hover:text-[#5C5952]"
                  >
                    {t("pf.cancel")}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ─────────────── Address book ─────────────── */

const ADDR_ICON = { Home: "home", Work: "business_center", Office: "business_center", Other: "place" };

function AddressForm({ initial, onSave, onCancel, busy }) {
  const t = useT();
  const [form, setForm] = useState({ ...EMPTY_ADDR, ...initial });
  // idle → nothing typed yet | loading → checking the PIN | done → district/state
  // filled from the lookup | not_found → PIN not recognised, so the person types
  // district/state themselves.
  const [pinLookup, setPinLookup] = useState({ status: "idle" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const onPhone = (e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }));
  // Changing the pincode invalidates whatever district/state came from the
  // PREVIOUS one — clearing them here means a stale auto-filled value can never
  // survive under a pincode it no longer matches.
  const onPincode = (e) => setForm((f) => ({
    ...f,
    pincode: e.target.value.replace(/\D/g, "").slice(0, 6),
    district: "",
    state: "",
  }));

  // The moment a valid 6-digit PIN is typed, resolve its district/state — see
  // lib/pincodeLookup.js. City is left alone; district and state are exactly
  // what a PIN determines and should not be typed by hand.
  useEffect(() => {
    if (!/^\d{6}$/.test(form.pincode)) { setPinLookup({ status: "idle" }); return undefined; }
    let alive = true;
    setPinLookup({ status: "loading" });
    lookupPincode(form.pincode).then((result) => {
      if (!alive) return;
      if (!result) { setPinLookup({ status: "not_found" }); return; }
      setForm((f) => ({
        ...f,
        state: result.state || f.state,
        district: result.district || f.district,
        city: f.city,
      }));
      setPinLookup({ status: "done" });
    });
    return () => { alive = false; };
  }, [form.pincode]);

  const districtStateLocked = pinLookup.status === "done";

  const submit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <form onSubmit={submit} className="grid gap-3.5 rounded-[12px] border border-[#EBE8E2] bg-[#FBFAF7] p-4 sm:grid-cols-2 sm:p-5">
      <div className="sm:col-span-2">
        <span className="mb-2 block text-[12px] text-[#8A8681]">{t("pf.addressType")}</span>
        <div className="flex flex-wrap gap-2">
          {["Home", "Work", "Other"].map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setForm((f) => ({ ...f, label: l }))}
              aria-pressed={form.label === l}
              className={`inline-flex h-[32px] items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-medium transition-all duration-150 ${
                form.label === l
                  ? "border-[#EA2831] bg-[#FDECEE] text-[#EA2831]"
                  : "border-[#EBE8E2] bg-white text-[#8A8681] hover:border-[#DCD8D0] hover:text-[#171412]"
              }`}
            >
              <span className={`${ICON} text-[15px]`}>{ADDR_ICON[l]}</span> {t(`pf.addrType${l}`)}
            </button>
          ))}
        </div>
      </div>

      <input required className={field} value={form.fullName} onChange={set("fullName")} placeholder={t("pf.addrFullName")} autoComplete="name" />
      <input required className={`${field} tabular-nums`} value={form.phone} onChange={onPhone} placeholder={t("pf.addrPhone")} inputMode="numeric" maxLength={10} autoComplete="tel" />
      <input required className={`${field} sm:col-span-2`} value={form.line1} onChange={set("line1")} placeholder={t("pf.addrLine1")} />
      <input className={`${field} sm:col-span-2`} value={form.line2} onChange={set("line2")} placeholder={t("pf.addrLine2")} />

      {/* Pincode first: it fills the two fields under it. */}
      <div className="flex flex-col gap-1.5">
        <input required className={`${field} tabular-nums`} value={form.pincode} onChange={onPincode} placeholder={t("pf.addrPincode")} inputMode="numeric" maxLength={6} autoComplete="postal-code" />
        {pinLookup.status === "loading" && <span className="text-[12px] text-[#A8A49E]">{t("pf.pinChecking")}</span>}
        {pinLookup.status === "done" && <span className="text-[12px] text-[#0F8A5F]">{t("pf.pinFilled")}</span>}
        {pinLookup.status === "not_found" && <span className="text-[12px] text-[#B7791F]">{t("pf.pinNotFound")}</span>}
      </div>
      <input required className={field} value={form.city} onChange={set("city")} placeholder={t("pf.addrCity")} />
      <input
        className={field}
        value={form.district}
        onChange={set("district")}
        placeholder={t("pf.addrDistrict")}
        readOnly={districtStateLocked}
        disabled={districtStateLocked}
      />
      <input
        className={field}
        value={form.state}
        onChange={set("state")}
        placeholder={t("pf.addrState")}
        readOnly={districtStateLocked}
        disabled={districtStateLocked}
      />

      <div className="flex flex-wrap gap-2.5 sm:col-span-2">
        <SolidButton type="submit" disabled={busy}>{busy ? t("pf.saving") : t("pf.saveAddress")}</SolidButton>
        <GhostButton type="button" onClick={onCancel} disabled={busy}>{t("pf.cancel")}</GhostButton>
      </div>
    </form>
  );
}

function AddressBook({ addresses, setAddresses, consumer, loading }) {
  const t = useT();
  const [mode, setMode] = useState(null);   // null | "add" | addressId (editing)
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const run = async (fn, successKey) => {
    setError(""); setOk(""); setBusy(true);
    try {
      const res = await fn();
      setAddresses(res.data || []);
      setOk(t(successKey));
      setMode(null);
      setConfirmId("");
    } catch (err) {
      setError(err?.response?.data?.message || t("pf.errGeneric"));
    } finally {
      setBusy(false);
    }
  };

  const editing = addresses.find((a) => a._id === mode);
  const n = addresses.length;

  return (
    <Card
      title={t("pf.tabAddresses")}
      subtitle={t(n === 1 ? "pf.savedAddress" : "pf.savedAddressPlural", { count: n })}
      action={mode === null && (
        <SolidButton onClick={() => { setMode("add"); setOk(""); }}>
          <span className={`${ICON} text-[16px]`}>add</span> {t("pf.addNew")}
        </SolidButton>
      )}
    >
      <div className="flex flex-col gap-4">
        {error && <Note tone="error">{error}</Note>}
        {ok && <Note tone="success">{ok}</Note>}

        {mode === "add" && (
          <AddressForm
            initial={{ fullName: consumer.name || "", phone: consumer.phone || "" }}
            busy={busy}
            onCancel={() => setMode(null)}
            onSave={(form) => run(() => addShopAddress(form), "pf.addrSaved")}
          />
        )}

        {editing && (
          <AddressForm
            initial={editing}
            busy={busy}
            onCancel={() => setMode(null)}
            onSave={(form) => run(() => updateShopAddress(editing._id, form), "pf.addrUpdated")}
          />
        )}

        {loading && n === 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map((i) => <Skeleton key={i} className="h-[186px] rounded-[12px]" />)}
          </div>
        ) : n === 0 && mode === null ? (
          <EmptyState
            icon="location_off"
            title={t("pf.noAddresses")}
            body={t("pf.noAddressesBody")}
            cta={<SolidButton className="mt-5" onClick={() => setMode("add")}>{t("pf.addFirstAddress")}</SolidButton>}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {addresses.map((a) => (
              <article
                key={a._id}
                className="group/addr relative flex flex-col rounded-[12px] border border-[#EBE8E2] bg-white p-4 transition-colors duration-150 hover:border-[#DCD8D0]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <IconChip icon={ADDR_ICON[a.label] || "place"}>
                      {a.label ? t(`pf.addrType${a.label}`) : t("pf.addrTypeOther")}
                    </IconChip>
                    {a.isDefault && <DotPill tone="red">{t("pf.default")}</DotPill>}
                  </div>

                  {/* Star = set default. Filled red when it already is. */}
                  <button
                    type="button"
                    onClick={() => { if (!a.isDefault) run(() => setDefaultShopAddress(a._id), "pf.defaultUpdated"); }}
                    disabled={busy || a.isDefault}
                    aria-label={a.isDefault ? t("pf.defaultAddress") : t("pf.setDefault")}
                    title={a.isDefault ? t("pf.defaultAddress") : t("pf.setDefault")}
                    className={`shrink-0 rounded-md p-0.5 transition-colors duration-150 disabled:cursor-default ${
                      a.isDefault ? "text-[#EA2831]" : "text-[#C9C5BD] hover:text-[#EA2831]"
                    }`}
                  >
                    <span
                      className={`material-symbols-outlined text-[20px] ${
                        a.isDefault
                          ? "[font-variation-settings:'FILL'_1,'wght'_300]"
                          : "[font-variation-settings:'FILL'_0,'wght'_300]"
                      }`}
                    >
                      star
                    </span>
                  </button>
                </div>

                <p className="mt-3 text-[14px] font-semibold text-[#171412]">{a.fullName || consumer.name}</p>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#8A8681]">
                  {[a.line1, a.line2].filter(Boolean).join(", ")}
                </p>
                <p className="text-[13.5px] leading-relaxed text-[#8A8681]">
                  {[a.city, a.district, a.state, a.pincode].filter(Boolean).join(", ")}
                </p>
                {a.phone && <p className="mt-1.5 text-[13.5px] tabular-nums text-[#8A8681]">{a.phone}</p>}

                {confirmId === a._id ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#EBE8E2] pt-3">
                    <span className="text-[13px] font-medium text-[#171412]">{t("pf.deleteConfirm")}</span>
                    <button
                      onClick={() => run(() => deleteShopAddress(a._id), "pf.addrRemoved")}
                      disabled={busy}
                      className="h-[30px] rounded-full bg-[#EA2831] px-3.5 text-[12.5px] font-medium text-white transition-colors duration-150 hover:bg-[#C91E26] disabled:opacity-50"
                    >
                      {t("common.yesDelete")}
                    </button>
                    <button
                      onClick={() => setConfirmId("")}
                      className="h-[30px] rounded-full px-2.5 text-[12.5px] font-medium text-[#8A8681] transition-colors duration-150 hover:text-[#171412]"
                    >
                      {t("pf.cancel")}
                    </button>
                  </div>
                ) : (
                  /* ALWAYS VISIBLE, not revealed on hover. These were
                     `md:opacity-0` until the pointer entered the card, so on a
                     touch laptop or tablet — which is `md` and up, and has no
                     hover — Edit and Delete were unreachable. Muted by default
                     and darkening on hover keeps the card calm without hiding
                     the only two things you can do to an address. */
                  <div className="mt-auto flex items-center gap-1 pt-4 opacity-70 transition-opacity duration-150 group-hover/addr:opacity-100 group-focus-within/addr:opacity-100">
                    <button
                      onClick={() => { setMode(a._id); setOk(""); }}
                      disabled={busy}
                      className="inline-flex h-[30px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium text-[#171412] transition-colors duration-150 hover:bg-[#F3F1EC] disabled:opacity-50"
                    >
                      <span className={`${ICON} text-[15px]`}>edit</span> {t("pf.edit")}
                    </button>
                    <button
                      onClick={() => setConfirmId(a._id)}
                      disabled={busy}
                      className="inline-flex h-[30px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium text-[#EA2831] transition-colors duration-150 hover:bg-[#FDECEE] disabled:opacity-50"
                    >
                      <span className={`${ICON} text-[15px]`}>delete</span> {t("pf.delete")}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ─────────────── Orders ─────────────── */

/* The step captions come from STATUS_LABEL_KEY — the SHARED vocabulary in
   lib/orderStatus. The reference declared its own STEP_SHORT map beside its own
   STATUS_LABEL map; two copies of the same five words is precisely how this
   screen and the order-detail screen end up disagreeing. */
function OrderTracker({ status }) {
  const t = useT();
  if (status === "cancelled" || status === "returned") {
    return (
      <p className="mt-2.5 text-[12.5px] font-medium text-[#EA2831]">
        {t(STATUS_LABEL_KEY[status])}
      </p>
    );
  }
  const active = ORDER_STEPS.indexOf(status);
  return (
    <div className="mt-2.5 flex items-center gap-2">
      {ORDER_STEPS.map((s, i) => {
        const reached = i <= active;
        return (
          <React.Fragment key={s}>
            <span className="flex shrink-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${reached ? "bg-[#EA2831]" : "bg-[#D6D2CA]"}`}
              />
              <span
                className={`hidden text-[12px] sm:inline ${
                  i === active ? "font-semibold text-[#171412]" : reached ? "text-[#5C5952]" : "text-[#A8A49E]"
                }`}
              >
                {t(STATUS_LABEL_KEY[s])}
              </span>
            </span>
            {i < ORDER_STEPS.length - 1 && (
              <span aria-hidden="true" className={`h-px min-w-[14px] flex-1 ${i < active ? "bg-[#EA2831]/45" : "bg-[#EBE8E2]"}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function OrderThumb({ order }) {
  const first = order.items?.[0] || {};
  const raw = first.images?.[0] || first.image || order.thumbnail || "";
  const src = raw ? getProductImage(raw) : "";
  return (
    <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-[#EBE8E2] bg-[#F3F1EC]">
      {src
        ? <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
        : <span className={`${ICON} text-[22px] text-[#A8A49E]`}>inventory_2</span>}
    </span>
  );
}

function OrdersPanel({ orders, loading }) {
  const t = useT();
  const recent = orders.slice(0, 3);
  return (
    <Card
      title={t("pf.recentOrders")}
      /* Names what the panel SHOWS — the last three — while the side nav
         carries the full count. "9 orders" over three rows reads as a list
         that failed to load the rest. */
      subtitle={orders.length ? t("pf.ordersRecentSub", { count: recent.length }) : undefined}
      action={orders.length > 0 && (
        <Link to="/customer-shop/orders" className={LINK_CLS}>
          {t("pf.viewAll")} <span className={`${ICON} text-[16px]`}>arrow_forward</span>
        </Link>
      )}
      bodyClassName="!pt-1"
    >
      {loading ? (
        <div className="flex flex-col">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`flex items-start gap-3.5 py-4 ${i === 0 ? "" : "border-t border-[#EBE8E2]"}`}>
              <Skeleton className="h-[52px] w-[52px]" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-52" />
                <Skeleton className="h-2 w-full max-w-[380px]" />
              </div>
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </div>
      ) : recent.length === 0 ? (
        <EmptyState
          icon="receipt_long"
          title={t("pf.noOrders")}
          body={t("pf.noOrdersBody")}
          cta={<Link to="/customer-shop/products" className={`${SOLID_CLS} mt-5`}>{t("pf.startShopping")}</Link>}
        />
      ) : (
        <div className="flex flex-col">
          {recent.map((o, i) => (
            <article
              key={o._id}
              className={`flex items-start gap-3.5 py-4 ${i === 0 ? "" : "border-t border-[#EBE8E2]"}`}
            >
              <OrderThumb order={o} />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <p className="font-heading text-[14.5px] font-bold tabular-nums tracking-wide text-[#171412]">{o.orderNumber}</p>
                  <DotPill tone={STATUS_TONE[o.status] || "grey"}>
                    {STATUS_LABEL_KEY[o.status] ? t(STATUS_LABEL_KEY[o.status]) : o.status}
                  </DotPill>
                  <span className="text-[12.5px] text-[#8A8681]">
                    {new Date(o.placedAt || o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] text-[#8A8681]">
                  {t(o.totalUnits === 1 ? "pf.orderUnits" : "pf.orderUnitsPlural", { count: o.totalUnits })}
                  {" · "}
                  {t("pf.paidVia", { mode: (o.payment?.mode || "cod").toUpperCase() })}
                </p>
                <OrderTracker status={o.status} />
              </div>

              <div className="shrink-0 text-right">
                <p className="font-heading text-[15px] font-extrabold tracking-tight tabular-nums text-[#171412]">{rupee(o.totalAmount || 0)}</p>
                {/* THIS ORDER, not the order list. It pointed at
                    /customer-shop/orders — the same place "View all" goes — so
                    a reader who tapped "Details" on the third row landed on a
                    list and had to find that row again. There is already a
                    route for the single order (orders/:id in App.jsx). */}
                <Link
                  to={`/customer-shop/orders/${o._id}`}
                  className="mt-1 inline-flex items-center gap-0.5 text-[12.5px] text-[#8A8681] transition-colors duration-150 hover:text-[#EA2831]"
                >
                  {t("pf.details")} <span className={`${ICON} text-[15px]`}>chevron_right</span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ─────────────── Wishlist ─────────────── */

function WishlistPanel({ items }) {
  const t = useT();
  const { addItem } = useCart();
  const preview = items.slice(0, 3);

  return (
    <Card
      title={t("pf.tabWishlist")}
      subtitle={items.length ? t(items.length === 1 ? "pf.savedItems" : "pf.savedItemsPlural", { count: items.length }) : undefined}
      action={items.length > 0 && (
        <Link to="/customer-shop/wishlist" className={LINK_CLS}>
          {t("pf.viewAll")} <span className={`${ICON} text-[16px]`}>arrow_forward</span>
        </Link>
      )}
    >
      {preview.length === 0 ? (
        <EmptyState
          icon="favorite"
          title={t("pf.nothingSaved")}
          body={t("pf.nothingSavedBody")}
          cta={<Link to="/customer-shop/products" className={`${SOLID_CLS} mt-5`}>{t("pf.browseProducts")}</Link>}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {preview.map((p) => {
            const img = getProductImage(p.images?.[0] || p.image);
            return (
              <article
                key={p.listingId}
                className="group/wish flex flex-col overflow-hidden rounded-[12px] border border-[#EBE8E2] bg-white transition-all duration-150 hover:border-[#DCD8D0] hover:shadow-[0_4px_14px_rgba(23,20,18,0.06)]"
              >
                <div className="relative">
                  <Link to={`/customer-shop/product/${p.listingId}`} className="block aspect-[4/5] bg-[#F3F1EC]">
                    {img ? (
                      <img src={img} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <span className="flex h-full items-center justify-center">
                        <span className={`${ICON} text-[30px] text-[#C9C5BD]`}>inventory_2</span>
                      </span>
                    )}
                  </Link>
                  <button
                    type="button"
                    onClick={() => addItem(p, 1)}
                    aria-label={t("pf.addToCartAria", { name: p.name })}
                    title={t("common.addToCart")}
                    className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full border border-[#EBE8E2]
                               bg-white text-[#171412] shadow-[0_1px_3px_rgba(23,20,18,0.10)] transition-all duration-150
                               hover:bg-[#EA2831] hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#EA2831]/25"
                  >
                    <span className={`${ICON} text-[17px]`}>add_shopping_cart</span>
                  </button>
                </div>

                <div className="flex flex-1 flex-col p-3.5">
                  <Link
                    to={`/customer-shop/product/${p.listingId}`}
                    className="line-clamp-2 text-[13.5px] leading-snug text-[#171412] transition-colors duration-150 hover:text-[#EA2831]"
                  >
                    {p.name}
                  </Link>
                  <p className="font-heading mt-1.5 text-[14.5px] font-bold tabular-nums text-[#171412]">{rupee(p.price)}</p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ─────────────── Security ─────────────── */

function PasswordInput({ label, hint, value, onChange, autoComplete }) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] text-[#5C5952]">
        {label} <span className="text-[#EA2831]">*</span>
      </span>
      <span className="relative block">
        <input
          type={show ? "text" : "password"}
          required
          className={`${field} pr-11`}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? t("pf.hidePassword") : t("pf.showPassword")}
          title={show ? t("pf.hidePassword") : t("pf.showPassword")}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[8px] text-[#A8A49E] transition-colors duration-150 hover:text-[#171412]"
        >
          <span className={`${ICON} text-[19px]`}>{show ? "visibility_off" : "visibility"}</span>
        </button>
      </span>
      {hint && <span className="text-[12.5px] text-[#A8A49E]">{hint}</span>}
    </label>
  );
}

function Security({ refresh }) {
  const t = useT();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setOk("");
    if (form.newPassword.length < 6) { setError(t("pf.errPasswordShort")); return; }
    if (form.newPassword !== form.confirm) { setError(t("pf.errPasswordMismatch")); return; }
    setBusy(true);
    try {
      await changeShopPassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      await refresh();
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      setOk(t("pf.passwordUpdated"));
    } catch (err) {
      setError(err?.response?.data?.message || t("pf.errPasswordUpdate"));
    } finally {
      setBusy(false);
    }
  };

  // Purely to grey the button out — the real gate is still the two checks in submit().
  const ready = form.currentPassword && form.newPassword && form.confirm;

  return (
    <Card
      title={t("pf.changePassword")}
      subtitle={t("pf.passwordSubtitle")}
      className="max-w-[680px]"
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Note tone="error">{error}</Note>}
        {ok && <Note tone="success">{ok}</Note>}

        <PasswordInput
          label={t("pf.currentPassword")}
          value={form.currentPassword}
          onChange={set("currentPassword")}
          autoComplete="current-password"
        />
        <PasswordInput
          label={t("pf.newPassword")}
          hint={t("pf.passwordHint")}
          value={form.newPassword}
          onChange={set("newPassword")}
          autoComplete="new-password"
        />
        <PasswordInput
          label={t("pf.confirmPassword")}
          hint={form.confirm && form.confirm !== form.newPassword ? t("pf.passwordMismatchHint") : undefined}
          value={form.confirm}
          onChange={set("confirm")}
          autoComplete="new-password"
        />

        <div className="mt-1 flex justify-end">
          <SolidButton type="submit" disabled={busy || !ready}>
            <span className={`${ICON} text-[16px]`}>{busy ? "progress_activity" : "autorenew"}</span>
            {busy ? t("pf.saving") : t("pf.updatePassword")}
          </SolidButton>
        </div>
      </form>
    </Card>
  );
}

/* ─────────────── Page ─────────────── */

export default function ShopProfile() {
  const t = useT();
  const { consumer, logout, refresh, updateProfile } = useShopAuth();
  const { count: cartCount } = useCart();
  const { items: wishlistItems, count: wishlistCount } = useWishlist();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  // Renamed off `t` — the map param here would shadow the translator.
  const tab = TABS.some((item) => item.key === params.get("tab")) ? params.get("tab") : "profile";
  const setTab = useCallback((key) => setParams({ tab: key }, { replace: true }), [setParams]);

  const [addresses, setAddresses] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadError, setLoadError] = useState("");

  // One fetch on mount — both lists are small, and having the counts up front
  // lets the side-nav show them without a second round-trip per tab.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [addrRes, orderRes] = await Promise.all([getShopAddresses(), getShopOrders()]);
        if (!alive) return;
        setAddresses(addrRes.data || []);
        setOrders(orderRes.data || []);
      } catch (err) {
        if (alive) setLoadError(err?.response?.data?.message || t("pf.errLoadAccount"));
      } finally {
        if (alive) setLoadingOrders(false);
      }
    })();
    return () => { alive = false; };
    // `t` is a dependency now that the fallback message is translated: with an
    // empty array this would close over whichever language was current on
    // mount, and a mid-session switch would leave the error in the old one.
  }, [t]);

  const counts = useMemo(() => ({
    addresses: addresses.length,
    orders: orders.length,
    wishlist: wishlistCount,
  }), [addresses.length, orders.length, wishlistCount]);

  const onLogout = () => { logout(); navigate("/customer-shop"); };

  const firstName = (consumer?.name || "").trim().split(/\s+/)[0] || "";

  // RequireConsumer guarantees a consumer, but guard anyway so a mid-flight
  // refresh can never blank-screen the page.
  if (!consumer) return null;

  return (
    <div className="flex min-h-screen flex-col bg-[#FBFAF7] text-[#171412]">
      {/* Tab-switch fade. Local so no tailwind.config keyframe is needed. */}
      <style>{`@keyframes kf-panel-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}`}</style>

      {/* ── Sticky identity bar ── */}
      <header className="sticky top-0 z-30 border-b border-[#EBE8E2] bg-[#FBFAF7]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1360px] items-center gap-3 px-4 py-3 sm:px-6">
          <Tooltip label={t("pf.back")}>
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label={t("pf.back")}
              className="no-print -ml-1 hidden h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[#8A8681] transition-colors duration-150 hover:bg-white hover:text-[#171412] sm:inline-flex"
            >
              <span className={`${ICON} text-[20px]`}>arrow_back</span>
            </button>
          </Tooltip>

          <Avatar name={consumer.name} />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-[14.5px] font-semibold text-[#171412]">{consumer.name}</p>
              {consumer.emailVerified && (
                <span
                  role="img"
                  aria-label={t("pf.verified")}
                  title={t("pf.verified")}
                  className="material-symbols-outlined shrink-0 text-[16px] text-[#EA2831] [font-variation-settings:'FILL'_1,'wght'_300]"
                >
                  verified
                </span>
              )}
            </div>
            <p className="truncate text-[12.5px] text-[#8A8681]">{consumer.email || consumer.phone}</p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link to="/customer-shop/cart" className={`${GHOST_CLS} gap-2`}>
              <span className={`${ICON} text-[18px]`}>shopping_cart</span>
              {t("pf.cart")}
              {cartCount > 0 && (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#EA2831] px-1 text-[10.5px] font-semibold tabular-nums text-white">
                  {cartCount}
                </span>
              )}
            </Link>
            <Tooltip label={t("pf.logout")}>
              <button onClick={onLogout} aria-label={t("pf.logout")} className={ICONBTN_CLS}>
                <span className={`${ICON} text-[19px]`}>logout</span>
              </button>
            </Tooltip>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 pb-12 pt-8 sm:px-6 sm:pt-10">
        {/* ── Page masthead ── */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#A8A49E]">{t("pf.eyebrow")}</p>
            <h1 className="font-heading mt-2 text-[30px] font-extrabold leading-[1.1] tracking-tight text-[#171412] sm:text-[38px]">
              {t("pf.helloName", { name: firstName })}
            </h1>
            <p className="mt-2.5 text-[14px] text-[#8A8681]">{t("pf.manageAll")}</p>
          </div>
          {/* <div className="flex flex-wrap items-center gap-2">
            {consumer.emailVerified
              ? <DotPill tone="green">{t("pf.emailVerified")}</DotPill>
              : <DotPill tone="amber">{t("pf.emailNotVerified")}</DotPill>}
            <DotPill tone="red">{t("pf.member")}</DotPill>
          </div> */}
        </div>

        {loadError && <div className="mb-5"><Note tone="error">{loadError}</Note></div>}

        <div className="grid gap-6 md:grid-cols-[196px_1fr] md:gap-9">
          {/* ── Nav: sidebar on desktop, chip scroller on mobile ── */}
          <Tabs active={tab} onChange={setTab} counts={counts} />

          {/* ── Panel ── */}
          <div
            id="profile-panel"
            role="tabpanel"
            aria-labelledby={`profile-tab-${tab}`}
            key={tab}
            className="min-w-0 [animation:kf-panel-in_180ms_ease-out]"
          >
            {tab === "profile" && (
              <div className="flex flex-col gap-6">
                {/* <div className="grid gap-6 lg:grid-cols-[1fr_300px] lg:items-start"> */}
                  <PersonalInfo consumer={consumer} updateProfile={updateProfile} refresh={refresh} />
                  {/* <div className="flex flex-col gap-5">
                    <ProfileCompleteness consumer={consumer} addressCount={addresses.length} />
                    <MemberSince consumer={consumer} />
                  </div> */}
                {/* </div> */}

                {/* Consent travels with the consumer on /me, so there is nothing
                    extra to fetch; refresh() puts the context back in step after
                    a change. Wrapped in this page's Card so it matches the
                    panels around it. */}
                <LocationSettingsCard
                  value={consumer?.locationAccess}
                  Wrapper={Card}
                  onSave={async (payload) => { await saveShopLocation(payload); await refresh(); }}
                  text={{
                    title: t("loc.title"),
                    subtitle: t("loc.subtitle"),
                    on: t("loc.on"),
                    off: t("loc.off"),
                    turnOn: t("loc.turnOn"),
                    turnOff: t("loc.turnOff"),
                    update: t("loc.update"),
                    working: t("location.working"),
                    savedOn: t("loc.savedOn"),
                    savedOff: t("loc.savedOff"),
                    capturedAt: t("loc.capturedAt"),
                    viewOnMap: t("loc.viewOnMap"),
                    accuracy: t("loc.accuracy"),
                    blocked: t("location.blocked"),
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
                />
              </div>
            )}
            {tab === "addresses" && (
              <AddressBook
                addresses={addresses}
                setAddresses={setAddresses}
                consumer={consumer}
                loading={loadingOrders}
              />
            )}
            {tab === "orders" && <OrdersPanel orders={orders} loading={loadingOrders} />}
            {tab === "wishlist" && <WishlistPanel items={wishlistItems} />}
            {tab === "security" && <Security refresh={refresh} />}
          </div>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="mx-auto w-full max-w-[1360px] px-4 sm:px-6">
        <div className="border-t border-[#EBE8E2] py-6">
          <p className="text-[12.5px] text-[#8A8681]">
            {t("pf.footer", { year: new Date().getFullYear() })}
          </p>
        </div>
      </footer>
    </div>
  );
}