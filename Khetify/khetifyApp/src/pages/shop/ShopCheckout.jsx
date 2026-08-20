import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useCart } from "../../context/CartContext";
import { useShopAuth } from "../../context/ShopAuthContext";
import {
  getShopAddresses, addShopAddress, updateShopAddress,
  setDefaultShopAddress, deleteShopAddress, shopCheckout,
} from "../../lib/shopApi";
import { rupee } from "../../Components/shop/ProductCard";
import { getProductImage } from "../../lib/productImage";
import { getBuyNowItem, clearBuyNowItem } from "../../lib/buyNow";

/* ─────────────────────────────────────────────────────────────────────────────
 * Khetify — Checkout  (/customer-shop/checkout)
 *
 * WHAT THE BACKEND ACTUALLY DOES (and what this page now finally shows):
 *   • checkout() re-resolves EVERY price and stock level server-side. The cart's
 *     prices are only a display cache — the server is the source of truth.
 *   • It then SPLITS the cart by seller: 2 sellers = 2 separate orders, each
 *     with its own order number, going into that seller's own queue. Until now
 *     the customer had no idea this happened. It is surfaced explicitly below.
 *   • Prices are TAX-INCLUSIVE (totalTax is always 0) and delivery is free, so
 *     Grand Total === subtotal. No invented fees are added here — whatever this
 *     page shows is exactly what the order is created with.
 *
 * TWO SOURCES, ONE PAGE:
 *   • /checkout               → the CART (all items)
 *   • /checkout?mode=buynow   → ONE product, handed over from the product page
 *                               via lib/buyNow.js. The cart is not read, not
 *                               written, and not cleared on success.
 *
 * PRESERVED VERBATIM from the previous version:
 *   getShopAddresses / addShopAddress on mount + default auto-select,
 *   shopCheckout({ items:[{listingId, qty}], shippingAddressId }),
 *   clearCart() → navigate("/customer-shop/order-success", { state:{ orders } }).
 * ───────────────────────────────────────────────────────────────────────────── */

const EMPTY_ADDR = {
  label: "Home", fullName: "", phone: "", line1: "", line2: "",
  city: "", district: "", state: "", stateCode: "", pincode: "",
};

const inputCls =
  "w-full border border-stone-200 rounded-xl px-4 py-2.5 text-sm bg-stone-50/50 text-stone-800 transition-all " +
  "focus:border-[#EA2831] focus:bg-white focus:ring-4 focus:ring-[#EA2831]/10 outline-none placeholder:text-stone-400";

const STEPS = [
  { key: "address", label: "Address", icon: "location_on" },
  { key: "payment", label: "Payment", icon: "payments" },
  { key: "review",  label: "Review",  icon: "task_alt" },
];

/* ─────────────── Stepper ─────────────── */

function Stepper({ current }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="mb-6 flex items-center gap-1.5 sm:gap-3">
      {STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <React.Fragment key={s.key}>
            <li className="flex items-center gap-2">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-black transition-colors sm:size-8 ${
                  done ? "bg-emerald-600 text-white"
                    : active ? "bg-[#EA2831] text-white"
                    : "bg-stone-200 text-stone-500"
                }`}
              >
                {done
                  ? <span className="material-symbols-outlined text-base">check</span>
                  : <span className="material-symbols-outlined text-base">{s.icon}</span>}
              </span>
              <span className={`hidden text-xs font-bold uppercase tracking-wider sm:inline ${
                active ? "text-stone-900" : done ? "text-emerald-700" : "text-stone-400"
              }`}>
                {s.label}
              </span>
            </li>
            {i < STEPS.length - 1 && (
              <li aria-hidden className={`h-0.5 flex-1 rounded-full ${i < idx ? "bg-emerald-600" : "bg-stone-200"}`} />
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

/* ─────────────── Address form ─────────────── */

function AddressForm({ initial, onSave, onCancel, busy, canCancel }) {
  const [form, setForm] = useState({ ...EMPTY_ADDR, ...initial });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Digits-only guards — previously maxLength alone let letters through.
  const onPhone = (e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }));
  const onPin = (e) => setForm((f) => ({ ...f, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) }));

  const [err, setErr] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (form.phone.length !== 10) { setErr("Please enter a valid 10-digit phone number."); return; }
    if (form.pincode.length !== 6) { setErr("Please enter a valid 6-digit pincode."); return; }
    setErr("");
    onSave(form);
  };

  return (
    <form onSubmit={submit} className="mt-2 grid gap-3.5 sm:grid-cols-2">
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        {["Home", "Work", "Other"].map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setForm((f) => ({ ...f, label: l }))}
            className={`h-8 rounded-lg border px-3.5 text-xs font-bold uppercase tracking-wide transition-colors ${
              form.label === l
                ? "border-[#EA2831] bg-red-50 text-[#EA2831]"
                : "border-stone-200 bg-white text-stone-500 hover:border-stone-300"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {err && (
        <p className="flex items-center gap-1.5 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2 text-xs font-semibold text-[#EA2831] sm:col-span-2">
          <span className="material-symbols-outlined text-base">error</span> {err}
        </p>
      )}

      <input required value={form.fullName} onChange={set("fullName")} placeholder="Full Name" className={inputCls} autoComplete="name" />
      <input required value={form.phone} onChange={onPhone} placeholder="10-Digit Phone" className={inputCls} inputMode="numeric" maxLength={10} autoComplete="tel" />
      <input required value={form.line1} onChange={set("line1")} placeholder="Flat, House no., Building, Company" className={`${inputCls} sm:col-span-2`} />
      <input value={form.line2} onChange={set("line2")} placeholder="Area, Street, Sector, Village (optional)" className={`${inputCls} sm:col-span-2`} />
      <input required value={form.city} onChange={set("city")} placeholder="Town / City" className={inputCls} />
      <input value={form.district} onChange={set("district")} placeholder="District" className={inputCls} />
      <input value={form.state} onChange={set("state")} placeholder="State" className={inputCls} />
      <input required value={form.pincode} onChange={onPin} placeholder="Pincode (6 digits)" className={inputCls} inputMode="numeric" maxLength={6} />

      <div className="flex items-center gap-2.5 pt-2 sm:col-span-2">
        <button
          disabled={busy}
          className="rounded-xl bg-[#EA2831] px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-md shadow-red-600/5 transition-colors hover:bg-[#c91e26] disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save Address"}
        </button>
        {canCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-stone-200 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-stone-500 transition-colors hover:bg-stone-50 disabled:opacity-60"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/* ─────────────── Address card ─────────────── */

function AddressCard({ a, selected, onSelect, onEdit, onDefault, onDelete, busy, consumerName }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      className={`rounded-2xl border transition-all ${
        selected ? "border-[#EA2831] bg-red-50/20 ring-1 ring-[#EA2831]" : "border-stone-200 bg-white shadow-sm hover:border-stone-300"
      }`}
    >
      <label className="flex cursor-pointer gap-3.5 p-4">
        <input
          type="radio"
          name="addr"
          checked={selected}
          onChange={onSelect}
          className="mt-0.5 size-4 shrink-0 accent-[#EA2831]"
        />
        <div className="min-w-0 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-stone-900">{a.fullName || consumerName}</p>
            {a.label && (
              <span className="rounded bg-stone-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stone-500">
                {a.label}
              </span>
            )}
            {a.isDefault && (
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                Default
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-stone-600">
            {[a.line1, a.line2, a.city, a.district, a.state, a.pincode].filter(Boolean).join(", ")}
          </p>
          {a.phone && (
            <p className="mt-2 flex items-center gap-1 text-xs font-medium text-stone-400">
              <span className="material-symbols-outlined text-sm text-stone-400">call</span>
              {a.phone}
            </p>
          )}
        </div>
      </label>

      {/* Row actions — an address book you can't edit isn't an address book. */}
      <div className="flex flex-wrap items-center gap-1 border-t border-stone-100 px-3 py-2">
        {confirming ? (
          <>
            <span className="px-1 text-xs font-bold text-stone-700">Delete this address?</span>
            <button
              onClick={() => { setConfirming(false); onDelete(); }}
              disabled={busy}
              className="rounded-lg bg-[#EA2831] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white disabled:opacity-60"
            >
              Yes, delete
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-stone-500 hover:bg-stone-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onEdit}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-sm">edit</span> Edit
            </button>
            {!a.isDefault && (
              <button
                onClick={onDefault}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-sm">star</span> Set default
              </button>
            )}
            <button
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#EA2831] transition-colors hover:bg-red-50 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-sm">delete</span> Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Summary line item (editable) ─────────────── */

function SummaryItem({ i, onQty, onRemove, flagged }) {
  const img = getProductImage(i.image);
  const cap = Number.isFinite(i.availableStock) && i.availableStock > 0 ? i.availableStock : Infinity;
  const atCap = i.qty >= cap;

  return (
    <div className={`flex gap-3 py-3 ${flagged ? "-mx-2 rounded-xl bg-red-50/60 px-2 ring-1 ring-red-200" : ""}`}>
      <Link to={`/customer-shop/product/${i.listingId}`} className="size-14 shrink-0 overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
        {img ? (
          <img src={img} alt={i.name} className="size-full object-contain" loading="lazy" />
        ) : (
          <span className="flex size-full items-center justify-center">
            <span className="material-symbols-outlined text-lg text-stone-300">inventory_2</span>
          </span>
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          to={`/customer-shop/product/${i.listingId}`}
          className="line-clamp-2 text-[13px] font-semibold leading-snug text-stone-800 hover:text-[#EA2831]"
        >
          {i.name}
        </Link>
        {i.unit && <p className="mt-0.5 text-[11px] text-stone-400">{i.unit}</p>}

        <div className="mt-1.5 flex items-center gap-2">
          {/* Qty is editable HERE so a shopper never has to bounce back to /cart. */}
          <div className="inline-flex items-center rounded-lg border border-stone-200 bg-white">
            <button
              onClick={() => onQty(i.qty - 1)}
              disabled={i.qty <= 1}
              aria-label="Decrease quantity"
              className="flex size-7 items-center justify-center rounded-l-lg text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-30"
            >
              <span className="material-symbols-outlined text-sm">remove</span>
            </button>
            <span className="w-7 text-center text-xs font-bold text-stone-900">{i.qty}</span>
            <button
              onClick={() => onQty(i.qty + 1)}
              disabled={atCap}
              aria-label="Increase quantity"
              className="flex size-7 items-center justify-center rounded-r-lg text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-30"
            >
              <span className="material-symbols-outlined text-sm">add</span>
            </button>
          </div>

          <button
            onClick={onRemove}
            className="text-[11px] font-bold uppercase tracking-wide text-stone-400 transition-colors hover:text-[#EA2831]"
          >
            Remove
          </button>
        </div>

        {atCap && cap !== Infinity && (
          <p className="mt-1 text-[11px] font-semibold text-amber-700">Only {cap} left in stock</p>
        )}
      </div>

      <span className="shrink-0 text-[13px] font-bold text-stone-900">{rupee(i.price * i.qty)}</span>
    </div>
  );
}

/* ─────────────── Page ─────────────── */

export default function ShopCheckout() {
  const cart = useCart();
  const { consumer } = useShopAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  /* ── Which basket are we checking out? ──
     ?mode=buynow  → the single product handed over by ShopProductDetail.
     anything else → the cart.
     The flag lives in the URL (not router state) so a page refresh keeps the
     shopper on the item they chose instead of dumping them into their cart. */
  const isBuyNow = searchParams.get("mode") === "buynow";

  // Buy-now qty is local state: it must not write through to the cart.
  const [buyNowItem, setBuyNowItem] = useState(() => (isBuyNow ? getBuyNowItem() : null));

  // A stale ?mode=buynow with nothing stored (bookmarked URL, cleared session)
  // would otherwise render an empty checkout. Send them to their cart instead.
  useEffect(() => {
    if (isBuyNow && !buyNowItem) navigate("/customer-shop/cart", { replace: true });
  }, [isBuyNow, buyNowItem, navigate]);

  // Leaving buy-now behind (i.e. a normal cart checkout) drops any stale item.
  useEffect(() => {
    if (!isBuyNow) clearBuyNowItem();
  }, [isBuyNow]);

  /* From here down, the page works off ONE list regardless of the source. */
  const items = isBuyNow ? (buyNowItem ? [buyNowItem] : []) : cart.items;
  const subtotal = isBuyNow
    ? (buyNowItem ? buyNowItem.price * buyNowItem.qty : 0)
    : cart.subtotal;
  const count = isBuyNow ? (buyNowItem?.qty || 0) : cart.count;

  const setQty = (listingId, qty) => {
    if (!isBuyNow) return cart.setQty(listingId, qty);
    setBuyNowItem((it) => {
      if (!it) return it;
      const cap = Number.isFinite(it.availableStock) && it.availableStock > 0 ? it.availableStock : Infinity;
      return { ...it, qty: Math.min(Math.max(1, qty), cap) };
    });
  };

  const removeItem = (listingId) => {
    if (!isBuyNow) return cart.removeItem(listingId);
    // Removing the only buy-now item = abandoning the flow.
    clearBuyNowItem();
    navigate("/customer-shop/products");
  };

  const [addresses, setAddresses] = useState([]);
  const [loadingAddr, setLoadingAddr] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState(null);      // null | "add" | <addressId> (editing)
  const [busy, setBusy] = useState(false);     // address mutations
  const [placing, setPlacing] = useState(false); // order submit
  const [error, setError] = useState("");
  const errorRef = useRef(null);

  /* Load addresses. UNCHANGED behaviour: default → first → else open the form. */
  useEffect(() => {
    (async () => {
      try {
        const res = await getShopAddresses();
        const list = res.data || [];
        setAddresses(list);
        const def = list.find((a) => a.isDefault) || list[0];
        if (def) setSelectedId(def._id); else setMode("add");
      } catch {
        setMode("add");
      } finally {
        setLoadingAddr(false);
      }
    })();
  }, []);

  /* Any stock/availability error from the server names the product — highlight it. */
  const flaggedName = useMemo(() => {
    const m = error.match(/"([^"]+)"/);
    return m ? m[1] : "";
  }, [error]);

  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [error]);

  /* The backend groups the cart by sellerId and creates ONE ORDER PER SELLER.
     Mirror that grouping here so the total order count is never a surprise. */
  const sellerGroups = useMemo(() => {
    const map = new Map();
    for (const i of items) {
      const key = i.sellerId || "unknown";
      if (!map.has(key)) map.set(key, { sellerName: i.sellerName || "Khetify seller", items: [] });
      map.get(key).items.push(i);
    }
    return [...map.values()];
  }, [items]);

  const selected = addresses.find((a) => a._id === selectedId) || null;
  const editing = addresses.find((a) => a._id === mode) || null;
  const step = !selected ? "address" : "review";

  /* Shared runner for the address mutations — all four endpoints return the
     FULL updated list, so state is replaced, never patched by hand. */
  const runAddr = async (fn, keepSelected) => {
    setError(""); setBusy(true);
    try {
      const res = await fn();
      const list = res.data || [];
      setAddresses(list);
      if (keepSelected === "newest") {
        setSelectedId(list[list.length - 1]?._id || "");
      } else if (!list.some((a) => a._id === selectedId)) {
        // The selected address was deleted — fall back to the default / first.
        const def = list.find((a) => a.isDefault) || list[0];
        setSelectedId(def?._id || "");
      }
      setMode(null);
      if (!list.length) setMode("add");
    } catch (err) {
      setError(err?.response?.data?.message || "Could not save the address.");
    } finally {
      setBusy(false);
    }
  };

  /* UNCHANGED: same payload, same clearCart, same success navigation + state. */
  const placeOrder = async () => {
    setError("");
    if (!selectedId) { setError("Please select or add a delivery address."); return; }
    setPlacing(true);
    try {
      const res = await shopCheckout({
        items: items.map((i) => ({ listingId: i.listingId, qty: i.qty })),
        shippingAddressId: selectedId,
      });
      // Buy-now never touched the cart, so it must not clear it either — the
      // shopper's saved cart survives an express purchase untouched.
      if (isBuyNow) clearBuyNowItem();
      else cart.clearCart();

      // The Order document stores ownerId (the seller's _id) but NOT the seller's
      // NAME — and by the time the success page renders, the cart that had the
      // name is already cleared. So hand the id→name map over explicitly.
      const sellerNames = {};
      for (const i of items) {
        if (i.sellerId) sellerNames[String(i.sellerId)] = i.sellerName || "Khetify seller";
      }

      navigate("/customer-shop/order-success", {
        replace: true,
        state: { orders: res.data, sellerNames },
      });
    } catch (err) {
      setError(err?.response?.data?.message || "Could not place order");
      setPlacing(false);
    }
  };

  // Redirecting (stale ?mode=buynow) — render nothing rather than flashing the
  // "empty basket" screen at someone whose cart isn't actually empty.
  if (isBuyNow && !buyNowItem) return null;

  /* ── Empty cart ── */
  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <div className="rounded-3xl border border-stone-200/80 bg-white p-12 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <span className="material-symbols-outlined mb-3 text-5xl text-stone-300">shopping_basket</span>
          <h1 className="font-heading text-xl font-extrabold text-stone-900">Your basket is empty</h1>
          <p className="mb-6 mt-1 text-sm text-stone-500">Add farm essentials to your basket to check out.</p>
          <Link
            to="/customer-shop/products"
            className="inline-flex items-center gap-2 rounded-xl bg-[#EA2831] px-6 py-3 font-bold text-white shadow-md shadow-red-600/10 transition-colors hover:bg-[#c91e26]"
          >
            Browse products <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50/40 pb-28 pt-8 lg:pb-8">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">

        {/* ── Header ── */}
        <div className="mb-6">
         
          {/* ── 🛠️ FIXED: Premium Screenshot-Matching Arrow Button inline with Secure Checkout ── */}
<div className="mb-4 flex items-center gap-3">
  {/* Button par hidden sm:flex laga diya */}
  <button
    type="button"
    onClick={() => navigate(-1)}
    aria-label="Go back"
    className="hidden sm:flex size-11 shrink-0 items-center justify-center rounded-2xl border border-stone-200 bg-white text-stone-700 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-200 hover:border-stone-300 hover:bg-stone-50 hover:text-[#EA2831]"
  >
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2.2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className="h-[18px] w-[18px]"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  </button>

          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-[#EA2831]">
              <span className="material-symbols-outlined text-sm">lock</span> Secure Checkout
            </span>
            {isBuyNow && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                <span className="material-symbols-outlined text-sm">bolt</span> Buying now
              </span>
            )}
          </div>
          </div>
          <h1 className="font-heading text-2xl font-black tracking-tight text-stone-900 sm:text-3xl">Review &amp; Pay</h1>
          {isBuyNow && (
            <p className="mt-1 text-[13px] text-stone-500">
              You're buying this one item. Your cart is untouched —{" "}
              <Link to="/customer-shop/cart" className="font-bold text-[#EA2831] hover:underline">check out your cart instead</Link>.
            </p>
          )}
        </div>

        <Stepper current={step} />

        <div className="grid items-start gap-6 lg:grid-cols-3">

          {/* ══════════ LEFT ══════════ */}
          <div className="space-y-5 lg:col-span-2">

            {/* ── 1. Delivery address ── */}
            <section className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-[0_4px_20px_-4px_rgba(20,32,26,0.02)] sm:p-6">
              <div className="mb-4 flex items-center justify-between border-b border-stone-100 pb-4">
                <h2 className="flex items-center gap-2.5 font-heading text-base font-extrabold text-stone-900">
                  <span className="flex size-8 items-center justify-center rounded-xl bg-red-50 text-[#EA2831]">
                    <span className="material-symbols-outlined text-lg font-bold">location_on</span>
                  </span>
                  Delivery Address
                </h2>
                {mode === null && (
                  <button
                    onClick={() => setMode("add")}
                    className="inline-flex items-center gap-1 rounded-xl border border-red-100 bg-red-50/30 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-[#EA2831] transition-colors hover:bg-red-50"
                  >
                    + Add New
                  </button>
                )}
              </div>

              {loadingAddr ? (
                <div className="space-y-3">
                  {[0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-stone-100" />)}
                </div>
              ) : (
                <>
                  {mode === "add" && (
                    <AddressForm
                      initial={{ fullName: consumer?.name || "", phone: consumer?.phone || "" }}
                      busy={busy}
                      canCancel={addresses.length > 0}
                      onCancel={() => setMode(null)}
                      onSave={(form) => runAddr(() => addShopAddress(form), "newest")}
                    />
                  )}

                  {editing && (
                    <AddressForm
                      initial={editing}
                      busy={busy}
                      canCancel
                      onCancel={() => setMode(null)}
                      onSave={(form) => runAddr(() => updateShopAddress(editing._id, form))}
                    />
                  )}

                  {mode === null && addresses.length > 0 && (
                    <div className="space-y-3">
                      {addresses.map((a) => (
                        <AddressCard
                          key={a._id}
                          a={a}
                          selected={selectedId === a._id}
                          busy={busy}
                          consumerName={consumer?.name}
                          onSelect={() => setSelectedId(a._id)}
                          onEdit={() => setMode(a._id)}
                          onDefault={() => runAddr(() => setDefaultShopAddress(a._id))}
                          onDelete={() => runAddr(() => deleteShopAddress(a._id))}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>

            {/* ── 2. Payment ── */}
            <section className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-[0_4px_20px_-4px_rgba(20,32,26,0.02)] sm:p-6">
              <h2 className="mb-4 flex items-center gap-2.5 border-b border-stone-100 pb-4 font-heading text-base font-extrabold text-stone-900">
                <span className="flex size-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                  <span className="material-symbols-outlined text-lg font-bold">payments</span>
                </span>
                Payment Method
              </h2>

              <label className="flex cursor-pointer gap-3.5 rounded-2xl border border-emerald-600 bg-emerald-50/10 p-4 shadow-sm ring-1 ring-emerald-600">
                <input type="radio" checked readOnly className="mt-0.5 size-4 shrink-0 accent-emerald-700" />
                <div className="text-sm">
                  <p className="flex items-center gap-1.5 font-bold text-stone-900">
                    Cash on Delivery (COD)
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                      Available
                    </span>
                  </p>
                  <p className="mt-0.5 text-[13px] text-stone-500">Pay with cash at your doorstep when the package arrives.</p>
                </div>
              </label>

              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-normal text-stone-400">
                <span className="material-symbols-outlined text-sm">info</span>
                Cash on Delivery is currently the only payment method on Khetify.
              </p>
            </section>

            {/* ── 3. Items, grouped by seller (this is how they'll actually be ordered) ── */}
            <section className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-[0_4px_20px_-4px_rgba(20,32,26,0.02)] sm:p-6">
              <h2 className="mb-4 flex items-center gap-2.5 border-b border-stone-100 pb-4 font-heading text-base font-extrabold text-stone-900">
                <span className="flex size-8 items-center justify-center rounded-xl bg-stone-100 text-stone-700">
                  <span className="material-symbols-outlined text-lg font-bold">inventory_2</span>
                </span>
                Your Items
                <span className="ml-auto rounded-full bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-600">
                  {count} {count === 1 ? "item" : "items"}
                </span>
              </h2>

              {/* The server splits the cart by seller — say so BEFORE they pay, not after. */}
              {sellerGroups.length > 1 && (
                <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] font-medium leading-normal text-amber-900">
                  <span className="material-symbols-outlined text-base">local_shipping</span>
                  <span>
                    These items come from <strong>{sellerGroups.length} different sellers</strong>, so they'll be placed as{" "}
                    <strong>{sellerGroups.length} separate orders</strong> and may arrive at different times. You'll pay once, on delivery.
                  </span>
                </p>
              )}

              <div className="space-y-4">
                {sellerGroups.map((g, gi) => (
                  <div key={gi} className={gi > 0 ? "border-t border-stone-100 pt-4" : ""}>
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-stone-400">
                      <span className="material-symbols-outlined text-sm">storefront</span>
                      Sold by {g.sellerName}
                      {sellerGroups.length > 1 && (
                        <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">Order {gi + 1}</span>
                      )}
                    </p>
                    <div className="divide-y divide-stone-100">
                      {g.items.map((i) => (
                        <SummaryItem
                          key={i.listingId}
                          i={i}
                          flagged={!!flaggedName && i.name === flaggedName}
                          onQty={(q) => setQty(i.listingId, q)}
                          onRemove={() => removeItem(i.listingId)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* ══════════ RIGHT: sticky summary ══════════ */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 rounded-2xl border border-stone-200/80 bg-white p-5 shadow-[0_10px_35px_-10px_rgba(20,32,26,0.06)] sm:p-6">
              <h2 className="mb-4 font-heading text-base font-extrabold text-stone-900">Order Summary</h2>

              <div className="space-y-2 border-b border-stone-100 pb-3.5 text-sm">
                <div className="flex justify-between text-stone-500">
                  <span>Subtotal ({count} {count === 1 ? "item" : "items"})</span>
                  <span className="font-medium text-stone-700">{rupee(subtotal)}</span>
                </div>
                <div className="flex justify-between text-stone-500">
                  <span>Delivery fee</span>
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-700">Free</span>
                </div>
                {sellerGroups.length > 1 && (
                  <div className="flex justify-between text-stone-500">
                    <span>Orders created</span>
                    <span className="font-medium text-stone-700">{sellerGroups.length}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-baseline justify-between">
                <span className="font-heading text-base font-bold text-stone-900">Grand Total</span>
                <span className="font-heading text-2xl font-black tracking-tight text-stone-900">{rupee(subtotal)}</span>
              </div>
              <p className="mt-1 text-[11px] leading-normal text-stone-400">
                Inclusive of all taxes. The GST breakdown appears on each seller's invoice.
              </p>

              {/* Where the order is going — a plain confirmation before they commit. */}
              {selected && (
                <div className="mt-4 rounded-xl border border-stone-100 bg-stone-50/60 p-3">
                  <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-stone-400">
                    <span className="material-symbols-outlined text-sm">local_shipping</span> Delivering to
                  </p>
                  <p className="mt-1 text-[13px] font-bold text-stone-800">{selected.fullName || consumer?.name}</p>
                  <p className="text-[12px] leading-snug text-stone-500">
                    {[selected.line1, selected.city, selected.pincode].filter(Boolean).join(", ")}
                  </p>
                </div>
              )}

              {error && (
                <div
                  ref={errorRef}
                  className="mt-4 flex items-start gap-1.5 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-[#EA2831]"
                >
                  <span className="material-symbols-outlined shrink-0 text-base">error</span>
                  <span>{error}</span>
                </div>
              )}

              <button
                onClick={placeOrder}
                disabled={placing || busy || !selectedId}
                className="mt-5 hidden w-full rounded-xl bg-[#EA2831] py-3.5 text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-red-600/10 transition-all hover:bg-[#c91e26] hover:shadow-red-600/20 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60 lg:block"
              >
                {placing
                  ? "Placing Order…"
                  : sellerGroups.length > 1
                    ? `Place ${sellerGroups.length} Orders (COD)`
                    : "Confirm Order (COD)"}
              </button>

              {!selectedId && !loadingAddr && (
                <p className="mt-2 hidden text-center text-[11px] font-semibold text-stone-400 lg:block">
                  Select a delivery address to continue
                </p>
              )}

              <p className="mt-3 hidden items-center justify-center gap-1 text-[11px] text-stone-400 lg:flex">
                <span className="material-symbols-outlined text-sm">verified_user</span>
                Verified Khetify sellers · Buyer support on every order
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile: sticky pay bar. On a phone the summary is a full scroll away,
             so the total + CTA follow the shopper down the page. ── */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 px-4 py-3 shadow-[0_-4px_20px_rgba(20,32,26,0.06)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-[1240px] items-center gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Grand Total</p>
            <p className="font-heading text-lg font-black leading-tight text-stone-900">{rupee(subtotal)}</p>
          </div>
          <button
            onClick={placeOrder}
            disabled={placing || busy || !selectedId}
            className="ml-auto flex-1 rounded-xl bg-[#EA2831] py-3 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-red-600/10 transition-all active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
          >
            {placing
              ? "Placing…"
              : !selectedId
                ? "Select an address"
                : sellerGroups.length > 1
                  ? `Place ${sellerGroups.length} Orders`
                  : "Confirm Order (COD)"}
          </button>
        </div>
      </div>
    </div>
  );
}