import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useCart } from "../../context/CartContext";
import { useT } from "../../context/ShopLanguageContext";
import { useShopAuth } from "../../context/ShopAuthContext";
import {
  getShopAddresses, addShopAddress, updateShopAddress,
  setDefaultShopAddress, deleteShopAddress, shopCheckout,
  // 💳 ONLINE PAYMENT: a separate lane from shopCheckout — it opens a payment
  //    session and creates NO order until the payment succeeds.
  initiateShopPayment,
} from "../../lib/shopApi";
import { PAYMENT_METHODS, PAYMENT_OPTIONS } from "../../lib/paymentMethods";
import { setPendingPayment } from "../../lib/pendingPayment";
import { setPendingOrder } from "../../lib/pendingOrder";
import { rupee } from "../../Components/shop/ProductCard";
import { getProductImage } from "../../lib/productImage";
import { getBuyNowItem, clearBuyNowItem } from "../../lib/buyNow";
import { lookupPincode } from "../../lib/pincodeLookup";

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
 * PAYMENT (two lanes, deliberately separate — see lib/paymentMethods.js):
 *   • Cash on Delivery → hands off to /customer-shop/confirm, which shows a
 *                        final review and places the order itself. Nothing is
 *                        created here; the order is still POST /checkout with
 *                        payment { cod, pending }, just one screen later.
 *   • Online Payment   → POST /payments/initiate, then this page hands off to
 *                        /customer-shop/payment/:id. NO order is created here;
 *                        the server creates it only once the payment succeeds,
 *                        so the cart is NOT cleared on this path.
 *   Swapping the mock gateway for a real one changes neither branch below.
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

// Module scope has no t(): labels are KEYS, resolved inside <Stepper>.
const STEPS = [
  { key: "address", labelKey: "co.stepAddress", icon: "location_on" },
  { key: "payment", labelKey: "co.stepPayment", icon: "payments" },
  { key: "review",  labelKey: "co.stepReview",  icon: "task_alt" },
];

/* ─────────────── Stepper ─────────────── */

function Stepper({ current }) {
  const t = useT();
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
                {t(s.labelKey)}
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
  const t = useT();
  const [form, setForm] = useState({ ...EMPTY_ADDR, ...initial });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Digits-only guards — previously maxLength alone let letters through.
  const onPhone = (e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }));
  // Changing the pincode invalidates whatever district/state came from the
  // PREVIOUS one — clearing them here means a stale auto-filled value can
  // never survive under a pincode it no longer matches, whether the new one
  // resolves to something different or doesn't resolve at all.
  const onPin = (e) => setForm((f) => ({ ...f, pincode: e.target.value.replace(/\D/g, "").slice(0, 6), district: "", state: "" }));

  const [err, setErr] = useState("");
  // idle → nothing typed yet | loading → checking the PIN | done → district/state
  // filled from the lookup | not_found / error → PIN not recognised, falls back
  // to the person typing district/state themselves.
  const [pinLookup, setPinLookup] = useState({ status: "idle" });

  // The moment a valid 6-digit PIN is typed, resolve its district/state — see
  // lib/pincodeLookup.js for the two sources and why there are two. City is
  // filled ONLY if the person hasn't already typed one; district and state are
  // always taken from the PIN once it resolves, since those two are exactly
  // what a PIN code determines and shouldn't be typed by hand.
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
        // City is intentionally left alone — the pincode lookup no longer
        // suggests one, only district and state.
        city: f.city,
      }));
      setPinLookup({ status: "done" });
    });
    return () => { alive = false; };
  }, [form.pincode]);

  const districtStateLocked = pinLookup.status === "done";

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

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-wide text-stone-500">Full name</span>
        <input required value={form.fullName} onChange={set("fullName")} placeholder={t("co.fullName")} className={inputCls} autoComplete="name" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-wide text-stone-500">Phone number</span>
        <input required value={form.phone} onChange={onPhone} placeholder={t("co.phone")} className={inputCls} inputMode="numeric" maxLength={10} autoComplete="tel" />
      </label>
      <label className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="text-xs font-bold uppercase tracking-wide text-stone-500">Address</span>
        <input required value={form.line1} onChange={set("line1")} placeholder={t("co.line1")} className={inputCls} />
      </label>
      <label className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="text-xs font-bold uppercase tracking-wide text-stone-500">Landmark</span>
        <input value={form.line2} onChange={set("line2")} placeholder={t("co.line2")} className={inputCls} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-wide text-stone-500">Pincode</span>
        <input required value={form.pincode} onChange={onPin} placeholder={t("co.pincode")} className={inputCls} inputMode="numeric" maxLength={6} autoComplete="postal-code" />
        {pinLookup.status === "loading" && <p className="mt-1 text-xs text-stone-400">Checking pincode…</p>}
        {pinLookup.status === "done" && <p className="mt-1 text-xs text-emerald-600">District and state filled automatically.</p>}
        {pinLookup.status === "not_found" && (
          <p className="mt-1 text-xs text-amber-600">Couldn't auto-fill for this pincode — please enter district and state manually.</p>
        )}
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-wide text-stone-500">City</span>
        <input required value={form.city} onChange={set("city")} placeholder={t("co.city")} className={inputCls} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-wide text-stone-500">District</span>
        <input
          value={form.district}
          onChange={set("district")}
          placeholder={t("co.district")}
          className={`${inputCls} ${districtStateLocked ? "cursor-not-allowed bg-stone-100 text-stone-500" : ""}`}
          readOnly={districtStateLocked}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-wide text-stone-500">State</span>
        <input
          value={form.state}
          onChange={set("state")}
          placeholder={t("co.state")}
          className={`${inputCls} ${districtStateLocked ? "cursor-not-allowed bg-stone-100 text-stone-500" : ""}`}
          readOnly={districtStateLocked}
        />
      </label>

      <div className="flex items-center gap-2.5 pt-2 sm:col-span-2">
        <button
          disabled={busy}
          className="rounded-xl bg-[#EA2831] px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-md shadow-red-600/5 transition-colors hover:bg-[#c91e26] disabled:opacity-60"
        >
          {busy ? t("co.saving") : t("co.saveAddress")}
        </button>
        {canCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-stone-200 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-stone-500 transition-colors hover:bg-stone-50 disabled:opacity-60"
          >
            {t("co.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}

/* ─────────────── Address card ─────────────── */

function AddressCard({ a, selected, onSelect, onEdit, onDefault, onDelete, busy, consumerName }) {
  const t = useT();
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
                {t("co.default")}
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
            <span className="px-1 text-xs font-bold text-stone-700">{t("co.deleteConfirm")}</span>
            <button
              onClick={() => { setConfirming(false); onDelete(); }}
              disabled={busy}
              className="rounded-lg bg-[#EA2831] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white disabled:opacity-60"
            >
              {t("co.delete")}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-stone-500 hover:bg-stone-50"
            >
              {t("co.cancel")}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onEdit}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-sm">edit</span> {t("co.edit")}
            </button>
            {!a.isDefault && (
              <button
                onClick={onDefault}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-sm">star</span> {t("co.setDefault")}
              </button>
            )}
            <button
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#EA2831] transition-colors hover:bg-red-50 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-sm">delete</span> {t("co.delete")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Summary line item (editable) ─────────────── */

function SummaryItem({ i, onQty, onRemove, flagged }) {
  const t = useT();
  const img = getProductImage(i.image);
  const cap = Number.isFinite(i.availableStock) && i.availableStock > 0 ? i.availableStock : Infinity;
  const atCap = i.qty >= cap;

  return (
    <div className={`flex gap-3 py-3 ${flagged ? "-mx-2 rounded-xl bg-[#FDECEC] px-2 ring-1 ring-[#F3C6C8]" : ""}`}>
      <Link to={`/customer-shop/product/${i.listingId}${i.variantId ? `?variant=${i.variantId}` : ""}`} className="size-14 shrink-0 overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
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
          to={`/customer-shop/product/${i.listingId}${i.variantId ? `?variant=${i.variantId}` : ""}`}
          className="line-clamp-2 text-[13px] font-semibold leading-snug text-stone-800 hover:text-[#EA2831]"
        >
          {i.name}
        </Link>
        {i.variantLabel && (
          <span className="mt-0.5 inline-block rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold text-stone-600">
            {i.variantLabel}
          </span>
        )}
        {i.unit && <p className="mt-0.5 text-[11px] text-stone-400">{i.unit}</p>}

        <div className="mt-1.5 flex items-center gap-2">
          {/* Qty is editable HERE so a shopper never has to bounce back to /cart. */}
          <div className="inline-flex items-center rounded-lg border border-stone-200 bg-white">
            <button
              onClick={() => onQty(i.qty - 1)}
              disabled={i.qty <= 1}
              aria-label={t("co.decreaseQty")}
              className="flex size-7 items-center justify-center rounded-l-lg text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-30"
            >
              <span className="material-symbols-outlined text-sm">remove</span>
            </button>
            <span className="w-7 text-center text-xs font-bold text-stone-900">{i.qty}</span>
            <button
              onClick={() => onQty(i.qty + 1)}
              disabled={atCap}
              aria-label={t("co.increaseQty")}
              className="flex size-7 items-center justify-center rounded-r-lg text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-30"
            >
              <span className="material-symbols-outlined text-sm">add</span>
            </button>
          </div>

          <button
            onClick={onRemove}
            className="text-[11px] font-bold uppercase tracking-wide text-stone-400 transition-colors hover:text-[#EA2831]"
          >
            {t("co.remove")}
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
  const t = useT();
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

  const setQty = (lineId, qty) => {
    if (!isBuyNow) return cart.setQty(lineId, qty);
    setBuyNowItem((it) => {
      if (!it) return it;
      const cap = Number.isFinite(it.availableStock) && it.availableStock > 0 ? it.availableStock : Infinity;
      return { ...it, qty: Math.min(Math.max(1, qty), cap) };
    });
  };

  const removeItem = (lineId) => {
    if (!isBuyNow) return cart.removeItem(lineId);
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
  /* 💳 Which lane. Defaults to COD, so a shopper who changes nothing gets the
     exact flow they had before this option existed. */
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS.COD);
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

  /* The Order document stores ownerId (the seller's _id) but NOT the seller's
     NAME — and by the time the success page renders, the cart that had the name
     is already cleared. So the id→name map is handed over explicitly. Lifted out
     of placeOrder() because BOTH payment lanes need it now. */
  const sellerNameMap = () => {
    const sellerNames = {};
    for (const i of items) {
      if (i.sellerId) sellerNames[String(i.sellerId)] = i.sellerName || "Khetify seller";
    }
    return sellerNames;
  };

  /* The checkout payload. IDENTICAL to what was sent before, plus the chosen
     paymentMethod — and it is the same body both lanes post, so the server
     prices the basket the same way whichever one is used. */
  const checkoutPayload = () => ({
    // variantId travels with the line so the server prices and snapshots
    // the option the shopper actually chose. Undefined for a product with
    // no variants, which is the exact payload sent before.
    items: items.map((i) => ({ listingId: i.listingId, qty: i.qty, variantId: i.variantId || undefined })),
    shippingAddressId: selectedId,
    paymentMethod,
  });

  /* ── LANE 1: Cash on Delivery ──
     Hands off to the confirmation screen. NOTHING is ordered here and the cart
     is NOT cleared — if the shopper backs out of the review, their basket is
     exactly where they left it.

     This mirrors startOnlinePayment() below on purpose: both lanes now end with
     a final "this is what you're about to do" screen, and neither commits
     anything from this page. The actual POST /checkout still happens, unchanged
     — it just lives on ShopConfirmOrder now. */
  const startCodConfirmation = () => {
    const stored = setPendingOrder({
      items: checkoutPayload().items,
      shippingAddressId: selectedId,
      isBuyNow,
      sellerNames: sellerNameMap(),
    });
    // sessionStorage can fail (private mode, quota). Rather than dead-end the
    // shopper on a screen that will find nothing, fall back to the old direct
    // path — an order placed is better than a checkout that silently refuses.
    if (!stored) return placeCodOrderDirect();

    navigate("/customer-shop/confirm", { replace: true });
    return undefined;
  };

  /* The pre-review behaviour, kept ONLY as the fallback above. */
  const placeCodOrderDirect = async () => {
    const res = await shopCheckout(checkoutPayload());
    // Buy-now never touched the cart, so it must not clear it either — the
    // shopper's saved cart survives an express purchase untouched.
    if (isBuyNow) clearBuyNowItem();
    else cart.clearCart();

    navigate("/customer-shop/order-success", {
      replace: true,
      state: { orders: res.data, sellerNames: sellerNameMap() },
    });
  };

  /* ── LANE 2: Online Payment ──
     Opens a payment session and hands off. NOTHING is ordered here and the cart
     is deliberately NOT cleared: if the shopper abandons or the payment fails,
     their basket is still exactly where they left it.

     This is also the seam for a real gateway. When Razorpay/Stripe is wired up,
     the server swaps its adapter and this function does not change at all. */
  const startOnlinePayment = async () => {
    const res = await initiateShopPayment(checkoutPayload());
    const paymentId = res?.data?.payment?._id;
    if (!paymentId) throw new Error("Could not start the payment");

    // Two purely local facts the server has no reason to know — see
    // lib/pendingPayment.js.
    setPendingPayment({ paymentId, isBuyNow, sellerNames: sellerNameMap() });

    // replace: true — the back button from the payment screen should return to
    // the cart/product, not bounce through a half-submitted checkout.
    navigate(`/customer-shop/payment/${paymentId}`, { replace: true });
  };

  const placeOrder = async () => {
    setError("");
    if (!selectedId) { setError(t("co.selectAddressError")); return; }
    setPlacing(true);
    try {
      if (paymentMethod === PAYMENT_METHODS.ONLINE) await startOnlinePayment();
      else await startCodConfirmation();
      // Both branches navigate away, so `placing` is intentionally left true —
      // it keeps the button disabled during the transition.
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Could not place order");
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
          <h1 className="font-heading text-xl font-extrabold text-stone-900">{t("co.emptyTitle")}</h1>
          <p className="mb-6 mt-1 text-sm text-stone-500">{t("co.emptySub")}</p>
          <Link
            to="/customer-shop/products"
            className="inline-flex items-center gap-2 rounded-xl bg-[#EA2831] px-6 py-3 font-bold text-white shadow-md shadow-red-600/10 transition-colors hover:bg-[#c91e26]"
          >
            {t("co.browseProducts")} <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-28 lg:pb-10">
      <div className="mx-auto w-full max-w-[1360px] px-3 py-6 sm:px-6 lg:px-8 lg:py-10">

        {/* ── Header ──
            REBUILT. The markup here had drifted: the back button opened a flex
            row that then wrapped the badge in a nested div, and the </div> that
            closed it left the <h1> outside the block it was meant to sit in.
            It rendered, but the indentation no longer described the structure,
            which is how the next edit goes wrong.

            The button is also the inline arrow the cart and wishlist use,
            rather than an 44px bordered card — one back control across the
            storefront, not three. */}
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label={t("co.goBack")}
              className="hidden size-8 shrink-0 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-stone-100 hover:text-[#EA2831] sm:inline-flex"
            >
              <span className="material-symbols-outlined text-[22px]">arrow_back</span>
            </button>

            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.2em] text-[#EA2831]">
              <span className="material-symbols-outlined text-sm">lock</span>
              {t("co.secureCheckout")}
            </span>

            {isBuyNow && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#FDECEC] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#B3121A]">
                <span className="material-symbols-outlined text-sm">bolt</span>
                {t("co.buyingNow")}
              </span>
            )}
          </div>

          <h1 className="mt-1.5 font-heading text-[22px] font-bold -tracking-[0.022em] text-stone-900 sm:text-2xl lg:text-[30px]">
            {t("co.title")}
          </h1>

          {isBuyNow && (
            <p className="mt-1.5 text-[13px] text-stone-500">
              {t("co.buyNowNote")}{" "}
              <Link to="/customer-shop/cart" className="font-bold text-[#EA2831] hover:underline">
                {t("co.checkoutCartInstead")}
              </Link>.
            </p>
          )}
        </div>

        <Stepper current={step} />

        <div className="grid items-start gap-6 lg:grid-cols-3">

          {/* ══════════ LEFT ══════════ */}
          <div className="space-y-5 lg:col-span-2">

            {/* ── 1. Delivery address ── */}
            <section className="rounded-2xl border border-stone-200/80 bg-white p-5 sm:p-6">
              <div className="mb-4 flex items-center justify-between border-b border-stone-100 pb-4">
                <h2 className="flex items-center gap-2.5 font-heading text-base font-extrabold text-stone-900">
                  <span className="flex size-8 items-center justify-center rounded-xl bg-[#FDECEC] text-[#EA2831]">
                    <span className="material-symbols-outlined text-lg font-bold">location_on</span>
                  </span>
                  {t("co.deliveryAddress")}
                </h2>
                {mode === null && (
                  <button
                    onClick={() => setMode("add")}
                    className="inline-flex items-center gap-1 rounded-xl border border-[#F3C6C8] bg-[#FDECEC] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#B3121A] transition-colors hover:bg-[#F3C6C8]"
                  >
                    {t("co.addNew")}
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
            <section className="rounded-2xl border border-stone-200/80 bg-white p-5 sm:p-6">
              <h2 className="mb-4 flex items-center gap-2.5 border-b border-stone-100 pb-4 font-heading text-base font-extrabold text-stone-900">
                <span className="flex size-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                  <span className="material-symbols-outlined text-lg font-bold">payments</span>
                </span>
                {t("co.paymentMethod")}
              </h2>

              {/* Both lanes rendered from ONE list (lib/paymentMethods.js) so a
                  third method later is a data change, not a UI rewrite. The
                  selected-card styling mirrors AddressCard above, in the
                  storefront red — the same visual language as the rest of the
                  page rather than a second, payment-only look. */}
              <div className="space-y-3">
                {PAYMENT_OPTIONS.map((opt) => {
                  const active = paymentMethod === opt.id;
                  return (
                    <label
                      key={opt.id}
                      className={`flex cursor-pointer gap-3.5 rounded-2xl border p-4 transition-all ${
                        active
                          ? "border-[#EA2831] bg-[#FDECEC]"
                          : "border-stone-200 bg-white hover:border-stone-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="paymentMethod"
                        value={opt.id}
                        checked={active}
                        onChange={() => setPaymentMethod(opt.id)}
                        className="mt-0.5 size-4 shrink-0 accent-[#EA2831]"
                      />
                      <span
                        className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
                          active ? "bg-white text-[#EA2831]" : "bg-stone-100 text-stone-500"
                        }`}
                      >
                        <span className="material-symbols-outlined text-lg">{opt.icon}</span>
                      </span>
                      <span className="min-w-0 text-sm">
                        <span className="flex flex-wrap items-center gap-1.5 font-bold text-stone-900">
                          {t(opt.labelKey)}
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              active ? "bg-white text-[#B3121A]" : "bg-stone-100 text-stone-500"
                            }`}
                          >
                            {t(opt.badgeKey)}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[13px] text-stone-500">{t(opt.subKey)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>

              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-normal text-stone-400">
                <span className="material-symbols-outlined text-sm">info</span>
                {t("co.paymentNote")}
              </p>

              {/* No real gateway is connected yet. Saying so on the page itself
                  is honest, and it is the ONE line to delete when one is. */}
              {paymentMethod === PAYMENT_METHODS.ONLINE && (
                <p className="mt-2 flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] font-medium leading-normal text-amber-900">
                  <span className="material-symbols-outlined text-base">science</span>
                  {t("co.testModeNote")}
                </p>
              )}
            </section>

            {/* ── 3. Items, grouped by seller (this is how they'll actually be ordered) ── */}
            <section className="rounded-2xl border border-stone-200/80 bg-white p-5 sm:p-6">
              <h2 className="mb-4 flex items-center gap-2.5 border-b border-stone-100 pb-4 font-heading text-base font-extrabold text-stone-900">
                <span className="flex size-8 items-center justify-center rounded-xl bg-stone-100 text-stone-700">
                  <span className="material-symbols-outlined text-lg font-bold">inventory_2</span>
                </span>
                {t("co.yourItems")}
                <span className="ml-auto rounded-full bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-600">
                  {t(count === 1 ? "co.itemCount" : "co.itemCountPlural", { count })}
                </span>
              </h2>

              {/* The server splits the cart by seller — say so BEFORE they pay, not after. */}
              {sellerGroups.length > 1 && (
                <p className="mb-4 flex items-start gap-2 rounded-xl border border-[#F3C6C8] bg-[#FDECEC] px-3.5 py-2.5 text-[12.5px] font-medium leading-relaxed text-[#B3121A]">
                  <span className="material-symbols-outlined text-base">local_shipping</span>
                  <span>
                    {t(
                      paymentMethod === PAYMENT_METHODS.ONLINE
                        ? "co.multiSellerNoteOnline"
                        : "co.multiSellerNote",
                      { count: sellerGroups.length }
                    )}
                  </span>
                </p>
              )}

              <div className="space-y-4">
                {sellerGroups.map((g, gi) => (
                  <div key={gi} className={gi > 0 ? "border-t border-stone-100 pt-4" : ""}>
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-stone-400">
                      <span className="material-symbols-outlined text-sm">storefront</span>
                      {/* The seller NAME is data — interpolated, never translated. */}
                      {t("co.soldBy", { seller: g.sellerName })}
                      {sellerGroups.length > 1 && (
                        <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">{t("co.orderNumber", { n: gi + 1 })}</span>
                      )}
                    </p>
                    <div className="divide-y divide-stone-100">
                      {g.items.map((i) => (
                        <SummaryItem
                          key={i.lineId || i.listingId}
                          i={i}
                          flagged={!!flaggedName && i.name === flaggedName}
                          onQty={(q) => setQty(i.lineId || i.listingId, q)}
                          onRemove={() => removeItem(i.lineId || i.listingId)}
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
            <div className="sticky top-20 rounded-2xl border border-stone-200/80 bg-white p-5 sm:p-6">
              <h2 className="mb-4 font-heading text-base font-extrabold text-stone-900">{t("co.orderSummary")}</h2>

              <div className="space-y-2 border-b border-stone-100 pb-3.5 text-sm">
                <div className="flex justify-between text-stone-500">
                  <span>{t(count === 1 ? "co.subtotal" : "co.subtotalPlural", { count })}</span>
                  <span className="font-medium text-stone-700">{rupee(subtotal)}</span>
                </div>
                <div className="flex justify-between text-stone-500">
                  <span>{t("co.deliveryFee")}</span>
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-700">{t("co.free")}</span>
                </div>
                {sellerGroups.length > 1 && (
                  <div className="flex justify-between text-stone-500">
                    <span>{t("co.ordersCreated")}</span>
                    <span className="font-medium text-stone-700">{sellerGroups.length}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-baseline justify-between">
                <span className="font-heading text-base font-bold text-stone-900">{t("co.grandTotal")}</span>
                <span className="font-heading text-[22px] font-extrabold tracking-tight text-stone-900">{rupee(subtotal)}</span>
              </div>
              <p className="mt-1 text-[11px] leading-normal text-stone-400">
                {t("co.taxNote")}
              </p>

              {/* Where the order is going — a plain confirmation before they commit. */}
              {selected && (
                <div className="mt-4 rounded-xl border border-stone-100 bg-stone-50/60 p-3">
                  <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-stone-400">
                    <span className="material-symbols-outlined text-sm">local_shipping</span> {t("co.deliveringTo")}
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
                  className="mt-4 flex items-start gap-1.5 rounded-xl border border-[#F3C6C8] bg-[#FDECEC] px-3.5 py-2.5 text-xs font-semibold text-[#B3121A]"
                >
                  <span className="material-symbols-outlined shrink-0 text-base">error</span>
                  <span>{error}</span>
                </div>
              )}

              <button
                onClick={placeOrder}
                disabled={placing || busy || !selectedId}
                className="mt-5 hidden w-full rounded-xl bg-[#EA2831] py-3.5 text-[13.5px] font-bold uppercase tracking-wide text-white transition-colors duration-300 hover:bg-[#C91E26] active:scale-[0.99] disabled:pointer-events-none disabled:bg-stone-200 disabled:text-stone-400 lg:block"
              >
                {/* The CTA must say what the tap DOES. "Confirm Order (COD)"
                    on a card payment would be a small lie. */}
                {/* The CTA must say what the tap DOES. Neither lane places an
                    order from this page any more — both open a review. */}
                {placing
                  ? (paymentMethod === PAYMENT_METHODS.ONLINE ? t("co.openingPayment") : t("co.openingReview"))
                  : paymentMethod === PAYMENT_METHODS.ONLINE
                    ? t("co.proceedToPay", { amount: rupee(subtotal) })
                    : t("co.reviewOrder")}
              </button>

              {!selectedId && !loadingAddr && (
                <p className="mt-2 hidden text-center text-[11px] font-semibold text-stone-400 lg:block">
                  {t("co.selectAddressHint")}
                </p>
              )}

              <p className="mt-3 hidden items-center justify-center gap-1 text-[11px] text-stone-400 lg:flex">
                <span className="material-symbols-outlined text-sm">verified_user</span>
                {t("co.verifiedNote")}
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
            <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("co.grandTotal")}</p>
            <p className="font-heading text-lg font-extrabold leading-tight text-stone-900">{rupee(subtotal)}</p>
          </div>
          <button
            onClick={placeOrder}
            disabled={placing || busy || !selectedId}
            className="ml-auto flex-1 rounded-xl bg-[#EA2831] py-3 text-xs font-bold uppercase tracking-wide text-white transition-colors duration-300 active:scale-[0.99] disabled:pointer-events-none disabled:bg-stone-200 disabled:text-stone-400"
          >
            {placing
              ? (paymentMethod === PAYMENT_METHODS.ONLINE ? t("co.openingPayment") : t("co.openingReview"))
              : !selectedId
                ? t("co.selectAnAddress")
                : paymentMethod === PAYMENT_METHODS.ONLINE
                  ? t("co.payShort", { amount: rupee(subtotal) })
                  : t("co.reviewOrder")}
          </button>
        </div>
      </div>
    </div>
  );
}