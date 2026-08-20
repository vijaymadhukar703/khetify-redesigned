import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getShopOrder, cancelShopOrder, getShopProduct } from "../../lib/shopApi";
import { useCart } from "../../context/CartContext";
import { rupee } from "../../Components/shop/ProductCard";
import {
  FLOW, STATUS_LABEL, STATUS_BLURB, STATUS_ICON,
  isDead, statusTone, canCancel, fmtDateTime,
} from "../../lib/orderStatus";

/* ─────────────────────────────────────────────────────────────────────────────
 * Khetify — Order detail  (/customer-shop/orders/:id)   ★ NEW PAGE
 *
 * GET /api/shop/orders/:id already existed and was never called by anything.
 * This page finally uses it, and adds the two things an order screen is
 * actually for:
 *
 *   CANCEL      → POST /orders/:id/cancel. Only offered while the order is
 *                 still "pending". Past that the seller has reserved stock
 *                 against it (allocations are written on confirm), so releasing
 *                 it belongs to the seller's flow, not the shopper's. The
 *                 server enforces the same rule — the UI just doesn't dangle a
 *                 button that would 409.
 *
 *   BUY IT AGAIN → re-adds the lines to the cart. It re-fetches each listing
 *                 first, so the shopper gets TODAY's price and stock rather
 *                 than a stale snapshot from the order. Lines from orders
 *                 placed before listingId was recorded are skipped, and we say
 *                 so instead of silently dropping them.
 * ───────────────────────────────────────────────────────────────────────────── */

function Row({ label, value, mono }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-stone-500">{label}</span>
      <span className={`text-sm font-semibold text-stone-800 ${mono ? "font-heading" : ""}`}>{value}</span>
    </div>
  );
}

/* ── Vertical timeline. Terminal states (cancelled/returned) never render the
      pipeline — an order that died at step 1 must not look 40% shipped. ── */
function Timeline({ order }) {
  // HOOKS FIRST, ALWAYS. The cancelled/returned branch below returns early, and
  // an order can become cancelled WHILE this page is open (the Cancel button is
  // right there). If the hooks lived after that return, React would render
  // fewer hooks than the previous pass and throw. `active` is computed here for
  // the same reason — the effect depends on it.
  const active = isDead(order.status) ? -1 : FLOW.indexOf(order.status);

  /* ── PROGRESS REVEAL ────────────────────────────────────────────────────
     The order's state is NOT touched here — `active` is still whatever the
     status says, and the finished picture is identical to before. All that is
     added is the ORDER IN WHICH that finished picture arrives on screen: the
     line grows from the first step, and each circle turns green as the line
     reaches it.

     Two counters drive it, and they are deliberately separate:
       revealed — the last step that has turned green (its circle has popped)
       filled   — the last connector that has started growing
     Keeping them apart is what makes the line ARRIVE at a step before that
     step lights up. A single counter would fill and pop at the same instant,
     which reads as everything appearing at once.

     Both stop at `active`. Steps past it are never touched, so the pending
     half of the list renders exactly as it always did. */
  const REVEAL_DELAY = 140;   // beat before the first circle, so it is seen to appear
  const POP_MS = 260;         // circle scale/fade
  const FILL_MS = 420;        // one connector growing to the next step

  const [revealed, setRevealed] = useState(-1);
  const [filled, setFilled] = useState(-1);

  useEffect(() => {
    // A cancelled/returned order never renders the pipeline, so there is
    // nothing to animate — the guard above returns before this component ever
    // reaches here, but the effect is written to be safe either way.
    if (active < 0) return undefined;

    // ACCESSIBILITY: honour the OS "reduce motion" setting by jumping straight
    // to the finished state. Same end result, no movement.
    const reduced = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { setRevealed(active); setFilled(active - 1); return undefined; }

    // Replay from the start whenever the page is opened or the status changes.
    setRevealed(-1);
    setFilled(-1);

    const timers = [];
    let t = REVEAL_DELAY;
    timers.push(setTimeout(() => setRevealed(0), t));
    for (let i = 0; i < active; i += 1) {
      t += POP_MS;
      timers.push(setTimeout(() => setFilled(i), t));   // line starts growing
      t += FILL_MS;
      timers.push(setTimeout(() => setRevealed(i + 1), t)); // it arrives → circle pops
    }
    return () => timers.forEach(clearTimeout);
  }, [active, order._id]);


  if (isDead(order.status)) {
    const when = order.cancelledAt || order.updatedAt;
    return (
      <div className="flex gap-3.5 rounded-2xl border border-red-100 bg-red-50/60 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#EA2831] text-white">
          <span className="material-symbols-outlined text-lg">{STATUS_ICON[order.status]}</span>
        </span>
        <div>
          <p className="text-sm font-bold text-[#EA2831]">{STATUS_LABEL[order.status]}</p>
          <p className="mt-0.5 text-[13px] text-stone-600">{STATUS_BLURB[order.status]}</p>
          {when && <p className="mt-1 text-xs text-stone-400">{fmtDateTime(when)}</p>}
        </div>
      </div>
    );
  }

  return (
    <ol className="relative">
      {/* Scoped to this component's own class names so nothing else on the page
          can pick these up. `will-change` keeps the transform on the compositor,
          which is what keeps the pop smooth on a low-end phone. */}
      <style>{`
        @keyframes kh-step-pop {
          0%   { transform: scale(0.72); opacity: 0; }
          60%  { transform: scale(1.06); opacity: 1; }
          100% { transform: scale(1);    opacity: 1; }
        }
        .kh-step-mark { animation: kh-step-pop ${POP_MS}ms cubic-bezier(0.34, 1.2, 0.64, 1) both; will-change: transform, opacity; }
        .kh-step-dot  { transition: background-color 220ms ease, color 220ms ease, box-shadow 220ms ease; }
        .kh-step-text { transition: color 260ms ease; }
        .kh-line-fill { transition: height ${FILL_MS}ms cubic-bezier(0.4, 0, 0.2, 1); will-change: height; }
        @media (prefers-reduced-motion: reduce) {
          .kh-step-mark { animation: none; }
          .kh-line-fill { transition: none; }
        }
      `}</style>
      {FLOW.map((s, i) => {
        // `done` / `isNow` now follow the REVEAL, not `active` directly, so a
        // step stays in its pending styling until the line reaches it. Once the
        // sequence finishes, revealed === active and this is exactly the
        // original expression — the end state is unchanged.
        const done = i <= revealed;
        const isNow = i === revealed && i === active;
        const last = i === FLOW.length - 1;

        // We only have real timestamps for two moments — placedAt and
        // dispatchedAt. Anything else would be invented, so it stays blank.
        const stamp =
          (i === 0 && (order.placedAt || order.createdAt)) ||
          (s === "shipped" && order.dispatchedAt) ||
          null;

        return (
          <li key={s} className="flex gap-3.5">
            <div className="flex flex-col items-center">
              <span
                className={`kh-step-dot flex size-9 shrink-0 items-center justify-center rounded-full ${
                  isNow ? "bg-[#EA2831] text-white ring-4 ring-[#EA2831]/15"
                    : done ? "bg-emerald-600 text-white"
                    : "bg-stone-100 text-stone-400"
                }`}
              >
                {/* The `key` is what makes the pop REPLAY: when a step flips
                    from pending to done the icon also changes to a tick, so
                    keying on that flip remounts the node and restarts the
                    animation. Without it React would reuse the element and the
                    keyframes would never run a second time.

                    The icon itself, and which icon each step uses, is unchanged. */}
                <span
                  key={done ? "done" : "pending"}
                  className={`material-symbols-outlined text-lg ${done ? "kh-step-mark" : ""}`}
                >
                  {done && !isNow ? "check" : STATUS_ICON[s]}
                </span>
              </span>
              {!last && (
                /* THE CONNECTOR. The grey track is the element that was here
                   before, at the same width and the same `flex-1` height, so
                   the row measures identically and NOTHING SHIFTS while the
                   animation runs. The green fill is absolutely positioned
                   inside it and only grows in height — it is taken out of flow
                   entirely, so it cannot affect layout at any point.

                   Only connectors below the current step ever turn green
                   (`i < active`), exactly as before. */
                <span className="relative w-0.5 flex-1 bg-stone-200">
                  {i < active && (
                    <span
                      className="kh-line-fill absolute inset-x-0 top-0 block bg-emerald-500"
                      style={{ height: i <= filled ? "100%" : "0%" }}
                    />
                  )}
                </span>
              )}
            </div>

            <div className={last ? "pb-0 pt-1" : "pb-6 pt-1"}>
              {/* The label and blurb darken as their step is reached — a colour
                  transition only, so the text is present and readable from the
                  first frame and the row never changes size. */}
              <p className={`kh-step-text text-sm font-bold ${done ? "text-stone-900" : "text-stone-400"}`}>
                {STATUS_LABEL[s]}
              </p>
              <p className={`kh-step-text mt-0.5 text-[13px] leading-normal ${done ? "text-stone-600" : "text-stone-400"}`}>
                {STATUS_BLURB[s]}
              </p>
              {stamp && <p className="mt-1 text-xs text-stone-400">{fmtDateTime(stamp)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function ShopOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addItem } = useCart();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [reordering, setReordering] = useState(false);
  const [copied, setCopied] = useState(false);

  // Floating toast after "Buy it again" — a top banner scrolls out of view, so
  // this fixed toast (with a "View cart" link) makes the add obvious.
  const [toast, setToast] = useState(null); // { text, count } | null

  // Cancellation reason picker.
  const [cancelReason, setCancelReason] = useState("");
  const [otherReason, setOtherReason] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const res = await getShopOrder(id);
      setOrder(res.data);
    } catch (e) {
      setError(e?.response?.data?.message || "Could not load this order.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const items = useMemo(() => order?.items || [], [order]);
  // Orders placed before listingId was recorded on the line can't be re-added.
  const reorderable = useMemo(() => items.filter((i) => i.listingId), [items]);

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(order.orderNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — it's still readable on screen */ }
  };

  const CANCEL_REASONS = [
    "Ordered by mistake",
    "Found a better price elsewhere",
    "Delivery taking too long",
    "No longer need the item",
    "Item not required anymore",
    "Other",
  ];

  const doCancel = async () => {
    // A reason is required; "Other" needs the free-text filled in.
    const reason = cancelReason === "Other" ? otherReason.trim() : cancelReason;
    if (!cancelReason) { setActionError("Please pick a reason for cancelling."); return; }
    if (cancelReason === "Other" && !reason) { setActionError("Please describe your reason."); return; }

    setActionError(""); setCancelling(true);
    try {
      const res = await cancelShopOrder(order._id, reason);
      setOrder(res.data);
      setConfirming(false);
      setNotice("Your order has been cancelled.");
    } catch (e) {
      setActionError(e?.response?.data?.message || "Could not cancel this order.");
      setConfirming(false);
    } finally {
      setCancelling(false);
    }
  };

  /* Re-fetch each listing so the cart gets TODAY's price and stock. Reusing the
     order's snapshot would quietly re-add a product at last month's price and a
     stock number that may now be zero. */
  const buyAgain = async () => {
    setActionError(""); setNotice(""); setReordering(true);
    let added = 0, gone = 0;
    try {
      for (const line of reorderable) {
        try {
          const res = await getShopProduct(line.listingId);
          const p = res.data;
          if (!p || !(p.availableStock > 0)) { gone++; continue; }
          addItem(p, line.qty);
          added++;
        } catch {
          gone++; // delisted or no longer published
        }
      }

      const skipped = items.length - reorderable.length;
      if (!added) {
        setActionError("None of these items are available right now.");
      } else {
        const bits = [`${added} item${added === 1 ? "" : "s"} added to your cart`];
        if (gone) bits.push(`${gone} no longer available`);
        if (skipped) bits.push(`${skipped} too old to re-add`);
        setNotice(bits.join(" · ") + ".");
        // Fire the visible toast too.
        setToast({ text: `${added} item${added === 1 ? "" : "s"} added to cart`, count: added });
        setTimeout(() => setToast(null), 4000);
      }
    } finally {
      setReordering(false);
    }
  };

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50/40 py-6">
        <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-6">
          <div className="h-6 w-32 animate-pulse rounded bg-stone-100" />
          <div className="h-32 animate-pulse rounded-2xl bg-white" />
          <div className="h-64 animate-pulse rounded-2xl bg-white" />
        </div>
      </div>
    );
  }

  /* ── Not found / error ── */
  if (error || !order) {
    return (
      <div className="min-h-screen bg-stone-50/40 py-6">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="rounded-3xl border border-stone-200 bg-white p-12 text-center">
            <span className="material-symbols-outlined text-5xl font-light text-stone-300">search_off</span>
            <h1 className="mt-3 font-heading text-lg font-bold text-stone-900">Order not found</h1>
            <p className="mt-1 text-sm text-stone-500">{error || "We couldn't find this order on your account."}</p>
            <Link
              to="/customer-shop/orders"
              className="mt-5 inline-block rounded-xl bg-[#EA2831] px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-[#c91e26]"
            >
              Back to my orders
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const ship = order.shippingAddress || {};
  const subtotal = items.reduce((s, i) => s + (i.price || 0) * (i.qty || 0), 0);
  const cancellable = canCancel(order.status);

  return (
    <div className="min-h-screen bg-stone-50/40 py-6 print:bg-white">
      <style>{`@media print { .no-print { display:none !important } .print-flat { box-shadow:none !important } }`}</style>

      <div className="mx-auto max-w-3xl px-4 sm:px-6">

        {/* ── 🛠️ FIXED: Exact capsule button with text matching your previous choice ── */}
{/* ── ⚡ FIXED: Responsive parent wrapper lagaya taaki element framework desktop par collapse na ho ── */}
<div className="no-print mb-4 hidden sm:block">
  <button
    type="button"
    onClick={() => navigate(-1)} // Smoothly goes to previous history entry
    aria-label="Go back"
    // Button ke andar se dynamic clash karne wali classes ko completely standard clean kar diya hai
    className="inline-flex h-[42px] items-center justify-center gap-2 rounded-full border-[1.5px] border-[#E2E0D6] bg-white px-4 text-sm font-bold text-[#14201A] transition-all duration-150 hover:border-stone-300 hover:bg-stone-50 hover:text-[#EA2831]"
  >
    {/* Icon framework alignment fix */}
    <span className="material-symbols-outlined text-[20px] flex items-center justify-center">
      arrow_back
    </span>
    <span className="leading-none">Back</span>
  </button>
</div>

        {/* ── Header ── */}
        <section className="mb-4 rounded-2xl border border-stone-200 bg-white p-5 print-flat sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="font-heading text-xl font-black tracking-tight text-stone-900">
                  {order.orderNumber}
                </h1>
                <button
                  onClick={copyNumber}
                  title="Copy order number"
                  className="no-print rounded-lg p-1 text-stone-300 transition-colors hover:bg-stone-100 hover:text-stone-600"
                >
                  <span className={`material-symbols-outlined text-[17px] ${copied ? "text-emerald-600" : ""}`}>
                    {copied ? "check" : "content_copy"}
                  </span>
                </button>
              </div>
              <p className="mt-0.5 text-sm text-stone-500">
                Placed {fmtDateTime(order.placedAt || order.createdAt)}
              </p>
              {order.sellerName && (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-stone-600">
                  <span className="material-symbols-outlined text-base text-stone-400">storefront</span>
                  Sold by <strong className="font-semibold text-stone-800">{order.sellerName}</strong>
                </p>
              )}
            </div>

            <div className="text-right">
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${statusTone(order.status)}`}>
                {STATUS_LABEL[order.status] || order.status}
              </span>
              <p className="mt-2 font-heading text-2xl font-black text-stone-900">
                {rupee(order.totalAmount || 0)}
              </p>
              {/* <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">
                {order.payment?.mode || "cod"} · {order.payment?.status || "pending"}
              </p> */}
            </div>
          </div>

          {notice && (
            <p className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-[13px] font-semibold text-emerald-800">
              <span className="material-symbols-outlined text-base">check_circle</span> {notice}
            </p>
          )}
          {actionError && (
            <p className="mt-4 flex items-center gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-[13px] font-semibold text-[#EA2831]">
              <span className="material-symbols-outlined text-base">error</span> {actionError}
            </p>
          )}
        </section>

        {/* ── Timeline ── */}
        <section className="mb-4 rounded-2xl border border-stone-200 bg-white p-5 print-flat sm:p-6">
          <h2 className="mb-5 font-heading text-base font-extrabold text-stone-900">Order status</h2>
          <Timeline order={order} />
        </section>

        {/* ── Items ── */}
        <section className="mb-4 rounded-2xl border border-stone-200 bg-white p-5 print-flat sm:p-6">
          <h2 className="mb-1 font-heading text-base font-extrabold text-stone-900">
            Items{" "}
            <span className="text-sm font-semibold text-stone-400">
              ({order.totalUnits} unit{order.totalUnits === 1 ? "" : "s"})
            </span>
          </h2>

          <div className="divide-y divide-stone-100">
            {items.map((line, i) => (
              <div key={i} className="flex items-start justify-between gap-3 py-3.5">
                <div className="min-w-0">
                  {line.listingId ? (
                    <Link
                      to={`/customer-shop/product/${line.listingId}`}
                      className="text-[14px] font-semibold leading-snug text-stone-800 hover:text-[#EA2831]"
                    >
                      {line.name}
                    </Link>
                  ) : (
                    <p className="text-[14px] font-semibold leading-snug text-stone-800">{line.name}</p>
                  )}
                  <p className="mt-0.5 text-[12px] text-stone-400">
                    {rupee(line.price)} × {line.qty}
                    {line.taxes?.gstRate > 0 && (
                      <span className="ml-1.5 text-stone-300">· incl. {line.taxes.gstRate}% GST</span>
                    )}
                  </p>
                </div>
                <span className="shrink-0 text-[14px] font-bold text-stone-900">
                  {rupee((line.price || 0) * (line.qty || 0))}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-3 border-t border-stone-100 pt-3">
            <Row label="Subtotal" value={rupee(subtotal)} />
            <Row label="Delivery" value={<span className="text-emerald-700">Free</span>} />
            <div className="mt-1.5 flex items-baseline justify-between border-t border-stone-100 pt-3">
              <span className="font-heading text-base font-bold text-stone-900">Total</span>
              <span className="font-heading text-xl font-black text-stone-900">
                {rupee(order.totalAmount || 0)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-stone-400">
              Inclusive of all taxes. The GST breakdown appears on the seller's invoice.
            </p>
          </div>
        </section>

        {/* ── Address + payment ── */}
        <section className="mb-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-stone-200 bg-white p-5 print-flat">
            <h2 className="mb-2.5 flex items-center gap-2 font-heading text-[15px] font-extrabold text-stone-900">
              <span className="material-symbols-outlined text-[19px] text-[#EA2831]">location_on</span>
              Delivery address
            </h2>
            <p className="text-[14px] font-bold text-stone-900">
              {ship.name}
              {ship.label && (
                <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stone-500">
                  {ship.label}
                </span>
              )}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-stone-600">
              {[ship.line1, ship.line2, ship.city, ship.district, ship.state, ship.pincode]
                .filter(Boolean)
                .join(", ")}
            </p>
            {ship.phone && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-stone-600">
                <span className="material-symbols-outlined text-[15px] text-stone-400">call</span>
                {ship.phone}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white p-5 print-flat">
            <h2 className="mb-2.5 flex items-center gap-2 font-heading text-[15px] font-extrabold text-stone-900">
              <span className="material-symbols-outlined text-[19px] text-emerald-700">payments</span>
              Payment
            </h2>
            <p className="text-[14px] font-bold text-stone-900">
              {order.payment?.mode === "cod" ? "Cash on Delivery" : order.payment?.mode}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-stone-600">
              {order.payment?.status === "paid"
                ? `Paid — ${rupee(order.totalAmount || 0)}.`
                : order.status === "delivered"
                  ? `${rupee(order.totalAmount || 0)} was collected on delivery.`
                  : isDead(order.status)
                    ? "Nothing was charged for this order."
                    : `Keep ${rupee(order.totalAmount || 0)} ready when your package arrives.`}
            </p>
          </div>
        </section>

        {/* ── Actions ── */}
        <div className="no-print flex flex-col gap-2.5 sm:flex-row">
          {reorderable.length > 0 && (
            <button
              onClick={buyAgain}
              disabled={reordering}
              className="flex h-[50px] w-full items-center justify-center gap-2 rounded-full bg-[#EA2831] text-sm font-bold text-white shadow-[0_8px_20px_rgba(234,40,49,0.22)] transition-colors hover:bg-[#c91e26] disabled:cursor-not-allowed disabled:opacity-60 sm:flex-1"
            >
              <span className="material-symbols-outlined text-[19px]">refresh</span>
              {reordering ? "Adding to cart…" : "Buy it again"}
            </button>
          )}

          <button
            onClick={() => window.print()}
            className="flex h-[50px] w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-stone-200 bg-white px-6 text-sm font-bold text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-50 sm:w-auto"
          >
            <span className="material-symbols-outlined text-[19px]">print</span> Save a copy
          </button>

          {cancellable && !confirming && (
            <button
              onClick={() => setConfirming(true)}
              className="flex h-[50px] w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-red-100 bg-white px-6 text-sm font-bold text-[#EA2831] transition-colors hover:bg-red-50 sm:w-auto"
            >
              <span className="material-symbols-outlined text-[19px]">close</span> Cancel order
            </button>
          )}
        </div>

        {/* ── Cancel confirmation ── */}
        {confirming && (
          <div className="no-print mt-3 rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="font-heading text-sm font-bold text-stone-900">Cancel this order?</p>
            <p className="mt-1 text-[13px] leading-relaxed text-stone-600">
              {order.orderNumber} will be cancelled and the seller notified. Nothing has been
              charged, so there's nothing to refund. This can't be undone.
            </p>

            {/* Reason picker — required. Helps the seller and keeps a record. */}
            <p className="mt-4 text-xs font-bold uppercase tracking-wide text-stone-500">
              Why are you cancelling?
            </p>
            <div className="mt-2 space-y-1.5">
              {CANCEL_REASONS.map((r) => (
                <label
                  key={r}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                    cancelReason === r
                      ? "border-[#EA2831] bg-white font-semibold text-stone-900"
                      : "border-stone-200 bg-white/60 text-stone-600 hover:border-stone-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="cancelReason"
                    value={r}
                    checked={cancelReason === r}
                    onChange={() => { setCancelReason(r); setActionError(""); }}
                    className="size-4 accent-[#EA2831]"
                  />
                  {r}
                </label>
              ))}
            </div>

            {cancelReason === "Other" && (
              <textarea
                value={otherReason}
                onChange={(e) => setOtherReason(e.target.value)}
                rows={2}
                maxLength={200}
                placeholder="Tell us your reason…"
                className="mt-2 w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/10"
              />
            )}

            <div className="mt-4 flex flex-wrap gap-2.5">
              <button
                onClick={doCancel}
                disabled={cancelling}
                className="rounded-full bg-[#EA2831] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-[#c91e26] disabled:opacity-60"
              >
                {cancelling ? "Cancelling…" : "Yes, cancel it"}
              </button>
              <button
                onClick={() => { setConfirming(false); setActionError(""); }}
                disabled={cancelling}
                className="rounded-full border border-stone-200 bg-white px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-60"
              >
                Keep my order
              </button>
            </div>
          </div>
        )}

        {/* Why the cancel button isn't there — better than a silently missing button. */}
        {!cancellable && !isDead(order.status) && (
          <p className="no-print mt-4 flex items-start gap-1.5 text-center text-[12px] leading-normal text-stone-400 sm:text-left">
            <span className="material-symbols-outlined text-sm">info</span>
            <span>
              This order is already {STATUS_LABEL[order.status].toLowerCase()} — the seller has
              reserved your stock, so it can't be cancelled online. Please contact the seller.
            </span>
          </p>
        )}
      </div>

      {/* ── Floating "added to cart" toast ── */}
      {toast && (
        <div className="no-print fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:bottom-6">
          <div className="flex w-full max-w-sm items-center gap-3 rounded-2xl bg-stone-900 px-4 py-3 text-white shadow-2xl">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500">
              <span className="material-symbols-outlined text-lg">check</span>
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold">{toast.text}</span>
            <Link
              to="/customer-shop/cart"
              className="shrink-0 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-stone-900 transition-colors hover:bg-stone-100"
            >
              View cart
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}