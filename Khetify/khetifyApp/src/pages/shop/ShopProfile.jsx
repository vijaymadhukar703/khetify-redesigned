import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useShopAuth } from "../../context/ShopAuthContext";
import { useCart } from "../../context/CartContext";
import { useWishlist } from "../../context/WishlistContext";
import {
  getShopAddresses, addShopAddress, updateShopAddress,
  setDefaultShopAddress, deleteShopAddress,
  changeShopPassword, shopVerifyOtp, shopResendOtp, getShopOrders,
} from "../../lib/shopApi";
import { getProductImage } from "../../lib/productImage";
import { rupee } from "../../Components/shop/ProductCard";

/* ─────────────────────────────────────────────────────────────────────────────
 * Khetify — Customer Profile hub  (/customer-shop/profile)
 *
 * The account home a real marketplace needs: personal info, a proper address
 * book (add / edit / delete / set-default), recent orders, wishlist and
 * security — all behind RequireConsumer.
 *
 * Every call here goes through the existing shopApi layer. Nothing about the
 * catalog, cart, checkout or seller/company/admin side is touched.
 *
 * Design language is lifted straight from the auth pages so the whole customer
 * journey feels like one product:
 *   cream #F5F4EF · ink #14201A · red #EA2831 · border #E2E0D6
 *   muted #6B6A62 · faint #9B9A92 · Sora headings (font-heading) / Manrope body
 * ───────────────────────────────────────────────────────────────────────────── */

const TABS = [
  { key: "profile",   label: "Personal information", short: "Profile",   icon: "person" },
  { key: "addresses", label: "Manage addresses",     short: "Addresses", icon: "location_on" },
  { key: "orders",    label: "My orders",            short: "Orders",    icon: "receipt_long" },
  { key: "wishlist",  label: "My wishlist",          short: "Wishlist",  icon: "favorite" },
  { key: "security",  label: "Login & security",     short: "Security",  icon: "lock" },
];

const EMPTY_ADDR = {
  label: "Home", fullName: "", phone: "", line1: "", line2: "",
  city: "", district: "", state: "", pincode: "",
};

const ORDER_STEPS = ["pending", "confirmed", "packed", "shipped", "delivered"];
const STATUS_LABEL = {
  pending: "Order placed", confirmed: "Confirmed", packed: "Packed",
  shipped: "Shipped", delivered: "Delivered", returned: "Returned", cancelled: "Cancelled",
};

/* ─────────────── Small presentational helpers ─────────────── */

const field =
  "h-[48px] w-full rounded-[12px] border-[1.5px] border-[#E2E0D6] bg-white px-3.5 " +
  "text-[15px] text-[#14201A] placeholder:text-[#9B9A92] outline-none transition-all duration-150 " +
  "hover:border-[#c9c7bb] focus:border-[#EA2831] focus:ring-4 focus:ring-[#EA2831]/10 " +
  "disabled:cursor-not-allowed disabled:bg-[#F5F4EF] disabled:text-[#6B6A62]";

function Note({ tone = "error", children }) {
  if (!children) return null;
  const map = {
    error:   "bg-[#FDECEC] text-[#EA2831]",
    success: "bg-[#E9F2EA] text-[#2E6B3E]",
    info:    "bg-[#F5F4EF] text-[#6B6A62]",
  };
  const icon = { error: "error", success: "check_circle", info: "info" }[tone];
  return (
    <div className={`flex items-center gap-2 rounded-[12px] px-3.5 py-2.5 text-sm font-medium ${map[tone]}`}>
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function Card({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={`rounded-[20px] border border-[#E2E0D6] bg-white p-5 sm:p-6 ${className}`}>
      {(title || action) && (
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-extrabold tracking-tight text-[#14201A] sm:text-xl">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-[#6B6A62]">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

// Shared as CLASS STRINGS, not just components, so a react-router <Link> can
// wear the exact same skin without us nesting a <button> inside an <a> (invalid
// HTML, and it breaks keyboard nav).
const GHOST_CLS =
  "inline-flex h-[42px] items-center justify-center gap-1.5 rounded-full border-[1.5px] border-[#E2E0D6] " +
  "bg-white px-4 text-sm font-bold text-[#14201A] transition-all duration-150 " +
  "hover:border-[#c9c7bb] hover:bg-[#FCFCFA] disabled:cursor-not-allowed disabled:opacity-60";

const SOLID_CLS =
  "inline-flex h-[46px] items-center justify-center gap-2 rounded-full bg-[#EA2831] px-6 " +
  "text-sm font-bold text-white shadow-[0_8px_20px_rgba(234,40,49,0.24)] transition-all duration-150 " +
  "hover:-translate-y-px hover:bg-[#c91e26] active:translate-y-0 " +
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0";

function GhostButton({ children, className = "", ...p }) {
  return <button className={`${GHOST_CLS} ${className}`} {...p}>{children}</button>;
}

function SolidButton({ children, className = "", ...p }) {
  return <button className={`${SOLID_CLS} ${className}`} {...p}>{children}</button>;
}

function EmptyState({ icon, title, body, cta }) {
  return (
    <div className="flex flex-col items-center rounded-[16px] border border-dashed border-[#E2E0D6] bg-[#FAFAF7] px-6 py-12 text-center">
      <span className="material-symbols-outlined text-[40px] font-light text-[#C9C7BB]">{icon}</span>
      <h3 className="mt-3 font-heading text-base font-bold text-[#14201A]">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-[#6B6A62]">{body}</p>}
      {cta}
    </div>
  );
}

const initialsOf = (name = "") =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "K";

/* ─────────────── Personal information ─────────────── */

function PersonalInfo({ consumer, updateProfile, refresh }) {
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
    if (!form.name.trim()) { setError("Name cannot be empty."); return; }
    if (form.phone && form.phone.length !== 10) { setError("Please enter a valid 10-digit phone number."); return; }
    setBusy(true);
    try {
      await updateProfile({ name: form.name.trim(), phone: form.phone });
      setOk("Profile updated.");
      setEditing(false);
    } catch (err) {
      setError(err?.response?.data?.message || "Could not update your profile.");
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
        ? `We sent a 6-digit code to ${consumer.email}.`
        : "Code generated — email isn't configured, so check the server console.");
    } catch (err) {
      setError(err?.response?.data?.message || "Could not send the code.");
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
      setOk("Email verified.");
    } catch (err) {
      setError(err?.response?.data?.message || "Incorrect code.");
    } finally {
      setOtpBusy(false);
    }
  };

  return (
    <Card
      title="Personal information"
      subtitle="This is how sellers reach you about your orders."
      action={!editing && (
        <GhostButton onClick={() => { setEditing(true); setOk(""); }}>
          <span className="material-symbols-outlined text-[18px]">edit</span> Edit
        </GhostButton>
      )}
    >
      <div className="flex flex-col gap-4">
        {error && <Note tone="error">{error}</Note>}
        {ok && <Note tone="success">{ok}</Note>}

        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-[#14201A]">Full name</span>
            <input
              className={field}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              disabled={!editing}
              placeholder="Your name"
              autoComplete="name"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-[#14201A]">Phone</span>
            <input
              className={field}
              value={form.phone}
              onChange={onPhone}
              disabled={!editing}
              placeholder="10-digit mobile number"
              inputMode="numeric"
              maxLength={10}
              autoComplete="tel"
            />
          </label>

          {/* Email is READ-ONLY on purpose: it is the login identifier, so
              changing it needs its own verify-first flow rather than a plain save. */}
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[#14201A]">Email</span>
              {consumer.emailVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#E9F2EA] px-2.5 py-1 text-[11px] font-bold text-[#2E6B3E]">
                  <span className="material-symbols-outlined text-[14px]">verified</span> Verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#FEF3E2] px-2.5 py-1 text-[11px] font-bold text-[#9A6700]">
                  <span className="material-symbols-outlined text-[14px]">error</span> Not verified
                </span>
              )}
            </span>
            <input className={field} value={consumer.email || "—"} disabled />
            <span className="text-[13px] text-[#9B9A92]">
              Your email is your sign-in ID, so it can't be changed here.
            </span>
          </label>

          {editing && (
            <div className="flex flex-wrap gap-2.5 sm:col-span-2">
              <SolidButton type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</SolidButton>
              <GhostButton type="button" onClick={cancel} disabled={busy}>Cancel</GhostButton>
            </div>
          )}
        </form>

        {/* Verify email — only when there is an unverified email on the account. */}
        {consumer.email && !consumer.emailVerified && (
          <div className="rounded-[16px] border border-[#E2E0D6] bg-[#FAFAF7] p-4">
            {!otpOpen ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[#6B6A62]">
                  Verify your email so we can send order updates and receipts.
                </p>
                <GhostButton onClick={sendOtp} disabled={otpBusy}>
                  {otpBusy ? "Sending…" : "Verify now"}
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
                    aria-label="6-digit code"
                    className="h-[48px] w-[160px] rounded-[12px] border-[1.5px] border-[#E2E0D6] bg-white px-3 text-center text-lg tracking-[0.4em] text-[#14201A] outline-none focus:border-[#EA2831] focus:ring-4 focus:ring-[#EA2831]/10"
                  />
                  <SolidButton type="submit" disabled={otpBusy || otp.length < 4}>
                    {otpBusy ? "Verifying…" : "Verify"}
                  </SolidButton>
                  <GhostButton type="button" onClick={sendOtp} disabled={otpBusy}>Resend</GhostButton>
                  <button
                    type="button"
                    onClick={() => { setOtpOpen(false); setOtp(""); setOtpNote(""); }}
                    className="text-sm font-semibold text-[#9B9A92] hover:text-[#6B6A62]"
                  >
                    Cancel
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

function AddressForm({ initial, onSave, onCancel, busy }) {
  const [form, setForm] = useState({ ...EMPTY_ADDR, ...initial });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const onPhone = (e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }));

  const submit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <form onSubmit={submit} className="grid gap-3.5 rounded-[16px] border border-[#E2E0D6] bg-[#FAFAF7] p-4 sm:grid-cols-2 sm:p-5">
      <div className="sm:col-span-2">
        <div className="flex flex-wrap gap-2">
          {["Home", "Work", "Other"].map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setForm((f) => ({ ...f, label: l }))}
              className={`h-[34px] rounded-full border-[1.5px] px-4 text-[13px] font-bold transition-colors ${
                form.label === l
                  ? "border-[#EA2831] bg-[#FDECEC] text-[#EA2831]"
                  : "border-[#E2E0D6] bg-white text-[#6B6A62] hover:border-[#c9c7bb]"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <input required className={field} value={form.fullName} onChange={set("fullName")} placeholder="Full name" autoComplete="name" />
      <input required className={field} value={form.phone} onChange={onPhone} placeholder="10-digit phone" inputMode="numeric" maxLength={10} autoComplete="tel" />
      <input required className={`${field} sm:col-span-2`} value={form.line1} onChange={set("line1")} placeholder="House / street / area" />
      <input className={`${field} sm:col-span-2`} value={form.line2} onChange={set("line2")} placeholder="Landmark (optional)" />
      <input required className={field} value={form.city} onChange={set("city")} placeholder="City" />
      <input className={field} value={form.district} onChange={set("district")} placeholder="District" />
      <input className={field} value={form.state} onChange={set("state")} placeholder="State" />
      <input required className={field} value={form.pincode} onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) }))} placeholder="Pincode" inputMode="numeric" maxLength={6} />

      <div className="flex flex-wrap gap-2.5 sm:col-span-2">
        <SolidButton type="submit" disabled={busy}>{busy ? "Saving…" : "Save address"}</SolidButton>
        <GhostButton type="button" onClick={onCancel} disabled={busy}>Cancel</GhostButton>
      </div>
    </form>
  );
}

function AddressBook({ addresses, setAddresses, consumer }) {
  const [mode, setMode] = useState(null);   // null | "add" | addressId (editing)
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const run = async (fn, successMsg) => {
    setError(""); setOk(""); setBusy(true);
    try {
      const res = await fn();
      setAddresses(res.data || []);
      setOk(successMsg);
      setMode(null);
      setConfirmId("");
    } catch (err) {
      setError(err?.response?.data?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const editing = addresses.find((a) => a._id === mode);

  return (
    <Card
      title="Manage addresses"
      subtitle="Saved addresses show up at checkout so you can order in one tap."
      action={mode === null && (
        <GhostButton onClick={() => { setMode("add"); setOk(""); }}>
          <span className="material-symbols-outlined text-[18px]">add</span> Add new
        </GhostButton>
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
            onSave={(form) => run(() => addShopAddress(form), "Address saved.")}
          />
        )}

        {editing && (
          <AddressForm
            initial={editing}
            busy={busy}
            onCancel={() => setMode(null)}
            onSave={(form) => run(() => updateShopAddress(editing._id, form), "Address updated.")}
          />
        )}

        {addresses.length === 0 && mode === null ? (
          <EmptyState
            icon="location_off"
            title="No addresses saved yet"
            body="Add a delivery address now and checkout becomes a single tap."
            cta={<SolidButton className="mt-4" onClick={() => setMode("add")}>Add your first address</SolidButton>}
          />
        ) : (
          <div className="grid gap-3.5 md:grid-cols-2">
            {addresses.map((a) => (
              <article
                key={a._id}
                className={`relative flex flex-col rounded-[16px] border-[1.5px] p-4 transition-colors ${
                  a.isDefault ? "border-[#EA2831] bg-[#FDECEC]/40" : "border-[#E2E0D6] bg-white"
                }`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#F5F4EF] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#6B6A62]">
                    {a.label || "Address"}
                  </span>
                  {a.isDefault && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#EA2831] px-2.5 py-1 text-[11px] font-bold text-white">
                      <span className="material-symbols-outlined text-[13px]">check</span> Default
                    </span>
                  )}
                </div>

                <p className="font-heading text-[15px] font-bold text-[#14201A]">{a.fullName || consumer.name}</p>
                <p className="mt-1 text-sm leading-relaxed text-[#6B6A62]">
                  {[a.line1, a.line2, a.city, a.district, a.state, a.pincode].filter(Boolean).join(", ")}
                </p>
                {a.phone && (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-[#6B6A62]">
                    <span className="material-symbols-outlined text-[16px] text-[#9B9A92]">call</span> {a.phone}
                  </p>
                )}

                {confirmId === a._id ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#E2E0D6] pt-3">
                    <span className="text-sm font-semibold text-[#14201A]">Delete this address?</span>
                    <button
                      onClick={() => run(() => deleteShopAddress(a._id), "Address removed.")}
                      disabled={busy}
                      className="h-[34px] rounded-full bg-[#EA2831] px-4 text-[13px] font-bold text-white disabled:opacity-60"
                    >
                      Yes, delete
                    </button>
                    <button
                      onClick={() => setConfirmId("")}
                      className="h-[34px] rounded-full px-3 text-[13px] font-bold text-[#6B6A62] hover:text-[#14201A]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-[#E2E0D6] pt-3">
                    <button
                      onClick={() => { setMode(a._id); setOk(""); }}
                      disabled={busy}
                      className="inline-flex h-[34px] items-center gap-1 rounded-full px-3 text-[13px] font-bold text-[#14201A] hover:bg-[#F5F4EF] disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-[16px]">edit</span> Edit
                    </button>
                    {!a.isDefault && (
                      <button
                        onClick={() => run(() => setDefaultShopAddress(a._id), "Default address updated.")}
                        disabled={busy}
                        className="inline-flex h-[34px] items-center gap-1 rounded-full px-3 text-[13px] font-bold text-[#14201A] hover:bg-[#F5F4EF] disabled:opacity-60"
                      >
                        <span className="material-symbols-outlined text-[16px]">star</span> Set default
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmId(a._id)}
                      disabled={busy}
                      className="inline-flex h-[34px] items-center gap-1 rounded-full px-3 text-[13px] font-bold text-[#EA2831] hover:bg-[#FDECEC] disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span> Delete
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

function OrderTracker({ status }) {
  if (status === "cancelled" || status === "returned") {
    return <span className="text-[13px] font-bold text-[#EA2831]">{STATUS_LABEL[status]}</span>;
  }
  const active = ORDER_STEPS.indexOf(status);
  return (
    <div className="mt-2 flex items-center gap-1">
      {ORDER_STEPS.map((s, i) => (
        <React.Fragment key={s}>
          <div
            className={`h-2 w-2 shrink-0 rounded-full ${i <= active ? "bg-[#2E6B3E]" : "bg-[#E2E0D6]"}`}
            title={STATUS_LABEL[s]}
          />
          {/* {i < ORDER_STEPS.length - 1 && (
            <div className={`h-0.5 flex-1 ${i < active ? "bg-[#2E6B3E]" : "bg-[#E2E0D6]"}`} />
          )} */}
        </React.Fragment>
      ))}
    </div>
  );
}

function OrdersPanel({ orders, loading }) {
  const recent = orders.slice(0, 3);
  return (
    <Card
      title="My orders"
      subtitle={orders.length ? `${orders.length} order${orders.length === 1 ? "" : "s"} so far.` : undefined}
      action={orders.length > 0 && (
        <Link to="/customer-shop/orders" className={GHOST_CLS}>View all</Link>
      )}
    >
      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-[16px] bg-[#F5F4EF]" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <EmptyState
          icon="receipt_long"
          title="No orders yet"
          body="Your orders will show up here once you check out."
          cta={
            <Link to="/customer-shop/products" className={`${SOLID_CLS} mt-4`}>Start shopping</Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3.5">
          {recent.map((o) => (
            <article key={o._id} className="rounded-[16px] border border-[#E2E0D6] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-heading text-[15px] font-bold text-[#14201A]">{o.orderNumber}</p>
                  <p className="text-[13px] text-[#9B9A92]">
                    {new Date(o.placedAt || o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    {" · "}
                    {o.totalUnits} item{o.totalUnits === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-heading text-[15px] font-bold text-[#14201A]">{rupee(o.totalAmount || 0)}</p>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[#9B9A92]">{o.payment?.mode || "cod"}</p>
                </div>
              </div>
              <p className="mt-3 text-[13px] font-bold text-[#6B6A62]">{STATUS_LABEL[o.status] || o.status}</p>
              {/* <OrderTracker status={o.status} /> */}
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ─────────────── Wishlist ─────────────── */

function WishlistPanel({ items }) {
  const { addItem } = useCart();
  const preview = items.slice(0, 4);

  return (
    <Card
      title="My wishlist"
      subtitle={items.length ? `${items.length} item${items.length === 1 ? "" : "s"} saved.` : undefined}
      action={items.length > 0 && (
        <Link to="/customer-shop/wishlist" className={GHOST_CLS}>View all</Link>
      )}
    >
      {preview.length === 0 ? (
        <EmptyState
          icon="favorite_border"
          title="Nothing saved yet"
          body="Tap the heart on any product to keep it here for later."
          cta={
            <Link to="/customer-shop/products" className={`${SOLID_CLS} mt-4`}>Browse products</Link>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
          {preview.map((p) => {
            const img = getProductImage(p.images?.[0] || p.image);
            return (
              <article key={p.listingId} className="flex flex-col overflow-hidden rounded-[14px] border border-[#E2E0D6] bg-white">
                <Link to={`/customer-shop/product/${p.listingId}`} className="block aspect-square bg-[#FAFAF7]">
                  {img ? (
                    <img src={img} alt={p.name} className="h-full w-full object-contain" loading="lazy" />
                  ) : (
                    <span className="flex h-full items-center justify-center">
                      <span className="material-symbols-outlined text-[32px] font-light text-[#C9C7BB]">inventory_2</span>
                    </span>
                  )}
                </Link>
                <div className="flex flex-1 flex-col p-2.5">
                  <Link to={`/customer-shop/product/${p.listingId}`} className="line-clamp-2 text-[13px] font-semibold text-[#14201A] hover:text-[#EA2831]">
                    {p.name}
                  </Link>
                  <p className="mt-1 font-heading text-sm font-bold text-[#14201A]">{rupee(p.price)}</p>
                  <button
                    onClick={() => addItem(p, 1)}
                    className="mt-2 h-[32px] rounded-full bg-[#EA2831] text-[12px] font-bold text-white transition-colors hover:bg-[#c91e26]"
                  >
                    Add to cart
                  </button>
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

function Security({ refresh }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setOk("");
    if (form.newPassword.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (form.newPassword !== form.confirm) { setError("The two passwords don't match."); return; }
    setBusy(true);
    try {
      await changeShopPassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      await refresh();
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      setOk("Password updated.");
    } catch (err) {
      setError(err?.response?.data?.message || "Could not update your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Change password" subtitle="Use at least 6 characters.">
      <form onSubmit={submit} className="grid max-w-md gap-4">
        {error && <Note tone="error">{error}</Note>}
        {ok && <Note tone="success">{ok}</Note>}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-[#14201A]">Current password</span>
          <input
            type="password" required className={field}
            value={form.currentPassword} onChange={set("currentPassword")}
            placeholder="Enter your current password" autoComplete="current-password"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-[#14201A]">New password</span>
          <input
            type="password" required className={field}
            value={form.newPassword} onChange={set("newPassword")}
            placeholder="At least 6 characters" autoComplete="new-password"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-[#14201A]">Confirm new password</span>
          <input
            type="password" required className={field}
            value={form.confirm} onChange={set("confirm")}
            placeholder="Re-enter the new password" autoComplete="new-password"
          />
        </label>

        <SolidButton type="submit" disabled={busy} className="justify-self-start">
          {busy ? "Saving…" : "Update password"}
        </SolidButton>
      </form>
    </Card>
  );
}

/* ─────────────── Page ─────────────── */

export default function ShopProfile() {
  const { consumer, logout, refresh, updateProfile } = useShopAuth();
  const { count: cartCount } = useCart();
  const { items: wishlistItems, count: wishlistCount } = useWishlist();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "profile";
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
        if (alive) setLoadError(err?.response?.data?.message || "Could not load your account.");
      } finally {
        if (alive) setLoadingOrders(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const counts = useMemo(() => ({
    addresses: addresses.length,
    orders: orders.length,
    wishlist: wishlistCount,
  }), [addresses.length, orders.length, wishlistCount]);

  const onLogout = () => { logout(); navigate("/customer-shop"); };

  // RequireConsumer guarantees a consumer, but guard anyway so a mid-flight
  // refresh can never blank-screen the page.
  if (!consumer) return null;

  return (
    <div className="min-h-screen bg-[#F5F4EF]">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">


       <div className="relative">

    {/* 1. LEFT SIDE: Back Button (Transparent, custom inline SVG aur extreme left layout grid balanced) */}
    <div className="no-print hidden sm:block absolute shrink-0 sm:-ml-[140px] sm:w-100px] sm:mr-[25px] top-1">
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Go back"
        className="inline-flex h-[48px] w-full items-center justify-start gap-2 border-0 bg-transparent px-0 text-[15px] font-bold text-[#14201A] transition-colors duration-150 hover:text-[#EA2831] group-hover:-translate-x-1"
      >
        <svg 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2.5" 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          className="h-[22px] w-[22px] shrink-0"
        >
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        <span className="leading-none">Back</span>
      </button>
    </div>


        {/* ── Identity header ── */}
        <header className="mb-6 flex flex-col gap-4 rounded-[20px] border border-[#E2E0D6] bg-white p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-6">
          <div className="flex items-center gap-4">
              <span className="flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-full bg-[#14201A] font-heading text-xl font-extrabold text-[#F5F4EF]">
                {initialsOf(consumer.name)}
              </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[#9B9A92]">Hello 👋</p>
              <h1 className="truncate font-heading text-2xl font-extrabold tracking-tight text-[#14201A]">
                {consumer.name}
              </h1>
              <p className="truncate text-sm text-[#6B6A62]">{consumer.email || consumer.phone}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <Link to="/customer-shop/cart" className={GHOST_CLS}>
              <span className="material-symbols-outlined text-[18px]">shopping_cart</span>
              Cart {cartCount > 0 && <span className="text-[#EA2831]">({cartCount})</span>}
            </Link>
            <GhostButton onClick={onLogout} className="!border-[#F3C6C8] !text-[#EA2831] hover:!bg-[#FDECEC]">
              <span className="material-symbols-outlined text-[18px]">logout</span> Logout
            </GhostButton>
          </div>
        </header>
        </div>

        {loadError && <div className="mb-5"><Note tone="error">{loadError}</Note></div>}

        <div className="grid gap-5 md:grid-cols-[220px_1fr] md:gap-6 lg:grid-cols-[248px_1fr]">

          {/* ── Nav: sidebar on desktop, scrollable chip row on mobile ── */}
          <nav className="md:sticky md:top-24 md:self-start">
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:flex md:flex-col md:gap-1.5">
              {TABS.map((t) => {
                const active = t.key === tab;
                const n = counts[t.key];
                return (
                  <li key={t.key} className="shrink-0 lg:shrink">
                    <button
                      onClick={() => setTab(t.key)}
                      aria-current={active ? "page" : undefined}
                      className={`flex w-full flex-col items-center gap-1 rounded-[14px] px-2 py-2.5 text-xs font-bold transition-colors md:flex-row md:gap-2.5 md:px-4 md:py-3 md:text-sm ${
                        active
                          ? "bg-[#14201A] text-white"
                          : "border-[1.5px] border-[#E2E0D6] bg-white text-[#6B6A62] hover:border-[#c9c7bb] hover:text-[#14201A] md:border-transparent md:bg-transparent md:hover:bg-white"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[20px]">{t.icon}</span>
                      <span className="text-center leading-tight md:hidden">{t.short}</span>
                      <span className="hidden whitespace-nowrap md:inline">{t.label}</span>
                      {n > 0 && (
                        <span className={`ml-auto hidden rounded-full px-2 py-0.5 text-[11px] font-bold md:inline ${
                          active ? "bg-white/15 text-white" : "bg-[#F5F4EF] text-[#6B6A62]"
                        }`}>
                          {n}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* ── Panel ── */}
          <div className="min-w-0">
            {tab === "profile" && (
              <PersonalInfo consumer={consumer} updateProfile={updateProfile} refresh={refresh} />
            )}
            {tab === "addresses" && (
              <AddressBook addresses={addresses} setAddresses={setAddresses} consumer={consumer} />
            )}
            {tab === "orders" && <OrdersPanel orders={orders} loading={loadingOrders} />}
            {tab === "wishlist" && <WishlistPanel items={wishlistItems} />}
            {tab === "security" && <Security refresh={refresh} />}
          </div>
        </div>
      </div>
    </div>
  );
}