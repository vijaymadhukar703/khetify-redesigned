// Khetify — shared customer-auth UI (React + Tailwind).
// Visual language adapted from the reference design: cream surfaces, dark
// brand panel, rounded inputs with an inline-SVG icon, pill primary button.
// No icon-font dependency here (all icons are inline SVG) and no business
// logic — these are presentational building blocks used by the Login and
// Register pages, which own all the auth calls.
//
// Palette: red #EA2831 (hover #c91e26) · ink #14201A · cream #F5F4EF
//          border #E2E0D6 · muted #6B6A62 · faint #9B9A92 · gold #F0B429

import { useState } from "react";
import { Link } from "react-router-dom";

/* ---------- Icons (inline SVG) ---------- */
export const Icon = {
  Store: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 9l1.5-5h15L21 9" /><path d="M3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0" /><path d="M5 12v8h14v-8" />
    </svg>
  ),
  Mail: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><path d="M22 6l-10 7L2 6" />
    </svg>
  ),
  Phone: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  ),
  User: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
  Lock: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  ),
  Eye: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  EyeOff: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" /><path d="M14.12 14.12a3 3 0 11-4.24-4.24" /><path d="M1 1l22 22" />
    </svg>
  ),
  Check: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 6L9 17l-5-5" /></svg>
  ),
  Shield: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
  ),
  Info: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
  ),
  Alert: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>
  ),
  MailCheck: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v7" /><path d="M22 6l-10 7L2 6" /><path d="M2 6v12c0 1.1.9 2 2 2h9" /><path d="M16 19l2 2 4-4" /></svg>
  ),
  ArrowLeft: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
  ),
  ArrowRight: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12h14" /><path d="M12 5l7 7-7 7" /></svg>
  ),

  /* 🔵 GOOGLE — the official four-colour "G" mark. Reproduced exactly (no
     recolouring / no currentColor) because Google's branding guidelines require
     the logo to keep its own colours on a light surface. */
  Google: (p) => (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" {...p}>
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  ),

  /* 🔵 GOOGLE — spinner shown while the popup / token exchange is in flight. */
  Spinner: (p) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  ),
};

/* ---------- Logo (red tile + wordmark, reference style) ---------- */
export function KhetifyLogo({ light = false, to = "/customer-shop" }) {
  return (
    <Link to={to} className={`flex items-center gap-2.5 ${light ? "text-[#F5F4EF]" : "text-[#14201A]"}`}>
      <span className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#EA2831]">
        <Icon.Store className="h-[18px] w-[18px] text-white" />
      </span>
      <span className="font-heading text-2xl font-extrabold tracking-tight">Khetify</span>
    </Link>
  );
}

/* ---------- Fields ---------- */
const inputBase =
  "h-[52px] w-full rounded-[14px] border-[1.5px] border-[#E2E0D6] bg-white pl-[46px] pr-4 " +
  "text-[15px] text-[#14201A] placeholder:text-[#9B9A92] outline-none transition-all duration-150 " +
  "hover:border-[#c9c7bb] focus:border-[#EA2831] focus:ring-4 focus:ring-[#EA2831]/10";

export function TextField({ label, icon: IconCmp, labelRight, className = "", inputClassName = "", ...inputProps }) {
  return (
    <label className={`flex flex-col gap-2 ${className}`}>
      {label && (
        <span className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[#14201A]">{label}</span>
          {labelRight}
        </span>
      )}
      <span className="relative block">
        {IconCmp && <IconCmp className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#9B9A92]" />}
        <input className={`${inputBase} ${inputClassName}`} {...inputProps} />
      </span>
    </label>
  );
}

export function PasswordField({ label = "Password", labelRight, ...inputProps }) {
  const [show, setShow] = useState(false);
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[#14201A]">{label}</span>
        {labelRight}
      </span>
      <span className="relative block">
        <Icon.Lock className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#9B9A92]" />
        <input type={show ? "text" : "password"} className={`${inputBase} pr-12`} {...inputProps} />
        <button
          type="button"
          aria-label={show ? "Hide password" : "Show password"}
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 inline-flex h-[38px] w-[38px] -translate-y-1/2 items-center justify-center rounded-[10px] text-[#6B6A62] transition-colors hover:bg-[#F0EFE8]"
        >
          {show ? <Icon.EyeOff className="h-[19px] w-[19px]" /> : <Icon.Eye className="h-[19px] w-[19px]" />}
        </button>
      </span>
    </label>
  );
}



/* ---------- Primary button ---------- */
export function PrimaryButton({ children, className = "", ...props }) {
  return (
    <button
      className={`flex h-[54px] items-center justify-center gap-2 rounded-full bg-[#EA2831] text-base font-bold text-white
                  shadow-[0_8px_20px_rgba(234,40,49,0.28)] transition-all duration-150
                  hover:-translate-y-px hover:bg-[#c91e26] hover:shadow-[0_10px_24px_rgba(234,40,49,0.34)]
                  active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/* ---------- 🔵 GOOGLE: "or continue with" divider ----------
   Hairline rules either side of a small caps label. Sits between the primary
   form and the social button on both Login and Register so the two pages read
   as one flow. Presentational only. */
export function AuthDivider({ label = "or continue with", className = "" }) {
  return (
    <div className={`flex items-center gap-3.5 ${className}`} role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#E2E0D6]" />
      <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.14em] text-[#9B9A92]">
        {label}
      </span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[#E2E0D6]" />
    </div>
  );
}

/* ---------- Inline error banner ---------- */
export function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <div className="flex items-center gap-2 rounded-[14px] bg-[#FDECEC] px-3.5 py-2.5 text-sm font-medium text-[#EA2831]">
      <Icon.Alert className="h-[18px] w-[18px] shrink-0" />
      {children}
    </div>
  );
}

/* ---------- Full-height split shell (brand panel + form) ---------- */
// Fills the viewport on desktop (dark brand column left, form right) and stacks
// into a clean single column on mobile/tablet — no empty voids. Shared by the
// Login and Register pages so both feel like one cohesive marketplace flow.
const HERO_IMG =
  "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80";

const TRUST_POINTS = [
  "Verified sellers — vetted before they can list",
  "Farm-grade quality, sourced for Indian farms",
  "Delivered pan-India, with buyer support on every order",
];

export function AuthShell({ children }) {
  return (
<div className="grid min-h-screen w-full bg-[#F5F4EF] lg:grid-cols-2">
        {/* Professional orchestrated entrance — soft fade, cinematic hero zoom,
          staggered content rise. Premium ease-out; respects reduced-motion. */}
  

      {/* Brand panel (desktop) */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-b from-[#14201A] to-[#0f1912] p-10 text-[#F5F4EF] lg:flex xl:p-14">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#F0B429]/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-16 h-72 w-72 rounded-full bg-[#EA2831]/10 blur-2xl" />

        <KhetifyLogo light />

        <div className="relative flex flex-col gap-8">
          <h2 className="max-w-[15ch] font-heading text-4xl font-extrabold leading-[1.12] tracking-tight xl:text-[42px]">
            Everything your <span className="text-[#EA2831]">farm needs</span> to grow.
          </h2>
          <div className="overflow-hidden rounded-[20px] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.6)]">
            <img
              src={HERO_IMG}
              alt="Indian farmland"
              className="h-[220px] w-full max-w-[480px] object-cover xl:h-[260px]"
            />
          </div>
          <ul className="flex flex-col gap-4">
            {TRUST_POINTS.map((point) => (
              <li key={point} className="flex items-center gap-3">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EA2831]/15">
                  <Icon.Check className="h-3.5 w-3.5 text-[#EA2831]" />
                </span>
                <span className="text-[15px] text-[#F5F4EF]/85">{point}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[13px] text-[#F5F4EF]/50">© {new Date().getFullYear()} Khetify — India's farming marketplace</p>
      </aside>

      {/* Form column */}
      <main className="flex items-center justify-center px-5 py-10 sm:px-10 sm:py-14 lg:px-12">
        <div className="w-full max-w-[440px]">
          <div className="mb-8 lg:hidden">
            <KhetifyLogo />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}