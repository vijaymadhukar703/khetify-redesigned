import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { getShopOrders } from "../../lib/shopApi";
import { getProductImage } from "../../lib/productImage";
import { rupee } from "../../Components/shop/ProductCard";

/* ─────────────────────────────────────────────────────────────────────────────
 * Khetify — My Orders  (/customer-shop/orders)
 *
 * ONE CARD PER ORDER (not per item). This fixes the bug where a multi-product
 * order showed the FIRST item's price as if it were the order price — each card
 * now shows the order's real total (o.totalAmount) once, with the items listed
 * beneath it.
 *
 * Per status, the card offers the right action:
 *   • cancelled / returned → NO "buy it again". Instead a clear "This order was
 *     cancelled" line, so a dead order never looks re-buyable.
 *   • delivered            → "Buy it again"
 *   • anything in flight   → "Track order"
 *
 * Fully responsive: the header (title + search + status tabs) stacks cleanly on
 * phone, and every row wraps instead of overflowing. Self-contained — no
 * external status-helper import, so it drops in without extra files.
 * ───────────────────────────────────────────────────────────────────────────── */

const FLOW = ["pending", "confirmed", "packed", "shipped", "delivered"];

const STATUS_LABEL = {
  pending: "Order placed",
  confirmed: "Confirmed",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  returned: "Returned",
  cancelled: "Cancelled",
};

const isDead = (s) => s === "cancelled" || s === "returned";

function statusTone(s) {
  if (s === "cancelled" || s === "returned") return "bg-red-50 text-[#EA2831]";
  if (s === "delivered") return "bg-emerald-100 text-emerald-800";
  if (s === "shipped") return "bg-blue-50 text-blue-700";
  return "bg-amber-50 text-amber-800";
}

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
];

const ACTIVE = ["pending", "confirmed", "packed", "shipped"];

const inTab = (o, tab) => {
  if (tab === "active") return ACTIVE.includes(o.status);
  if (tab === "delivered") return o.status === "delivered";
  if (tab === "cancelled") return o.status === "cancelled" || o.status === "returned";
  return true;
};

function Thumb({ src, alt }) {
  const url = getProductImage(src);
  return (
    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-100 bg-stone-50 sm:size-14">
      {url ? (
        <img src={url} alt={alt} loading="lazy" className="size-full object-contain p-1" />
      ) : (
        <span className="material-symbols-outlined text-xl font-light text-stone-300">inventory_2</span>
      )}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex justify-between">
        <div className="space-y-2">
          <div className="h-4 w-32 animate-pulse rounded bg-stone-100" />
          <div className="h-3 w-24 animate-pulse rounded bg-stone-100" />
        </div>
        <div className="h-5 w-20 animate-pulse rounded-full bg-stone-100" />
      </div>
      <div className="mt-4 space-y-2 border-t border-stone-100 pt-4">
        <div className="h-3 w-full animate-pulse rounded bg-stone-100" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-stone-100" />
      </div>
    </div>
  );
}

export default function ShopOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");

  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "all";
  const setTab = (key) => setParams(key === "all" ? {} : { tab: key }, { replace: true });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getShopOrders();
      setOrders(res.data || []);
    } catch (e) {
      setError(e?.response?.data?.message || "Could not load your orders.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c = { all: orders.length, active: 0, delivered: 0, cancelled: 0 };
    for (const o of orders) {
      if (inTab(o, "active")) c.active++;
      if (inTab(o, "delivered")) c.delivered++;
      if (inTab(o, "cancelled")) c.cancelled++;
    }
    return c;
  }, [orders]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return orders.filter((o) => {
      if (!inTab(o, tab)) return false;
      if (!needle) return true;
      const hay = [o.orderNumber, o.sellerName, ...(o.items || []).map((i) => i.name)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [orders, tab, q]);

  return (
    <div className="min-h-[50vh] bg-stone-50/40 py-5 sm:py-6">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">

        {/* ── Header + Back button (same as Profile: floating left, text + arrow, hover slide) ── */}
        <div className="relative">

          {/* ── Header + Back button (Standardized Icon-Only Layout) ── */}
<header className="mb-4 sm:mb-5 flex items-center">
  {/* 🛠️ sm:pl-28: Perfect right shift & grid alignment */}
  <div className="min-w-0 sm:pl-2">
    <div className="relative flex items-center gap-2.5">
      
      {/* Back Arrow Icon: Textless, floating at -left-9 before 'M' */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Go back"
        className="no-print hidden sm:inline-flex absolute -left-9 shrink-0 items-center justify-center text-stone-900 transition-colors duration-150 hover:text-[#EA2831]"
      >
        <span className="material-symbols-outlined text-[24px] sm:text-[26px] font-bold leading-none">
          arrow_back
        </span>
      </button>

      {/* Main Title */}
      <h1 className="font-heading text-xl font-black tracking-tight text-stone-900 sm:text-2xl leading-none">
        My Orders
      </h1>
    </div>

    {/* Subtitle */}
    <p className="mt-1 text-xs text-stone-500 sm:text-sm">
      {loading ? "Loading…" : `${orders.length} order${orders.length === 1 ? "" : "s"} so far`}
    </p>
  </div>
</header>
        </div>

        {/* ── Search + tabs (responsive: stack on phone) ── */}
        {!loading && !error && orders.length > 0 && (
          <div className="mb-5 flex flex-col gap-3">
            <div className="relative">
              <span className="material-symbols-outlined pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-stone-400">
                search
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search your orders"
                aria-label="Search orders"
                className="h-11 w-full rounded-xl border border-stone-200 bg-white pl-11 pr-10 text-sm text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-[#EA2831] focus:ring-4 focus:ring-[#EA2831]/10"
              />
              {q && (
                <button
                  onClick={() => setQ("")}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              )}
            </div>

            {/* Tabs scroll horizontally only WITHIN their own strip, never the page. */}
            <div className="grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center justify-center gap-1 rounded-full px-1.5 py-2 text-[10px] font-bold uppercase tracking-tight transition-colors sm:px-4 sm:text-xs sm:tracking-wide ${
                    tab === t.key
                      ? "bg-stone-900 text-white"
                      : "border border-stone-200 bg-white text-stone-500 hover:border-stone-300 hover:text-stone-800"
                  }`}
                >
                  {t.label}
                  <span className={`hidden rounded-full px-1.5 py-0.5 text-[10px] sm:inline ${tab === t.key ? "bg-white/20" : "bg-stone-100 text-stone-500"}`}>
                    {counts[t.key]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-8 text-center">
            <span className="material-symbols-outlined text-3xl text-[#EA2831]">error</span>
            <p className="mt-2 text-sm font-semibold text-[#EA2831]">{error}</p>
            <button
              onClick={load}
              className="mt-4 rounded-xl bg-[#EA2831] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-[#c91e26]"
            >
              Try again
            </button>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && !error && (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
          </div>
        )}

        {/* ── Empty (never ordered) ── */}
        {!loading && !error && orders.length === 0 && (
          <div className="rounded-3xl border border-stone-200 bg-white p-12 text-center shadow-sm">
            <span className="material-symbols-outlined text-5xl font-light text-stone-300">receipt_long</span>
            <h3 className="mt-3 font-heading text-lg font-bold text-stone-800">No orders yet</h3>
            <p className="mt-1 text-sm text-stone-500">Your orders will appear here after you check out.</p>
            <Link
              to="/customer-shop/products"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#EA2831] px-6 py-3 text-sm font-bold text-white shadow-md shadow-red-600/10 transition-colors hover:bg-[#c91e26]"
            >
              Start shopping <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </Link>
          </div>
        )}

        {/* ── Empty (filter matched nothing) ── */}
        {!loading && !error && orders.length > 0 && visible.length === 0 && (
          <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-12 text-center">
            <span className="material-symbols-outlined text-4xl font-light text-stone-300">search_off</span>
            <h3 className="mt-2 font-heading text-base font-bold text-stone-800">No matching orders</h3>
            <p className="mt-1 text-sm text-stone-500">
              {q ? `Nothing matches "${q}".` : `You have no ${tab} orders.`}
            </p>
            <button
              onClick={() => { setQ(""); setTab("all"); }}
              className="mt-4 text-sm font-bold text-[#EA2831] hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* ── Orders (one card per order) ── */}
        {!loading && !error && visible.length > 0 && (
          <div className="space-y-4">
            {visible.map((o) => {
              const items = o.items || [];
              const shown = items.slice(0, 3);
              const more = items.length - shown.length;
              const dead = isDead(o.status);
              const delivered = o.status === "delivered";

              return (
                <Link
                  key={o._id}
                  to={`/customer-shop/orders/${o._id}`}
                 className="block rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 transition-colors duration-200 hover:border-[#EA2831]"
>
                  {/* Top: order no + date (left) · TOTAL (right) — the real order
                      total, shown ONCE, never a single item's price. */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-heading text-sm font-bold text-stone-900 sm:text-base">{o.orderNumber}</p>
                      <p className="mt-0.5 text-xs text-stone-400">
                        Placed {fmtDate(o.placedAt || o.createdAt)}
                        {o.sellerName ? ` · ${o.sellerName}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-heading text-base font-black text-stone-900 sm:text-lg">
                        {rupee(o.totalAmount || 0)}
                      </p>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">
                        {o.totalUnits || items.length} item{(o.totalUnits || items.length) === 1 ? "" : "s"} · {o.payment?.mode || "cod"}
                      </p>
                    </div>
                  </div>

                  {/* Items with thumbnails */}
                  <div className="mt-3 space-y-2 border-t border-stone-100 pt-3">
                    {shown.map((it, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <Thumb src={it.image} alt={it.name} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-stone-700">{it.name}</p>
                          <p className="text-xs text-stone-400">
                            {rupee(it.price)} × {it.qty}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-stone-600">
                          {rupee((it.price || 0) * (it.qty || 0))}
                        </span>
                      </div>
                    ))}
                    {more > 0 && (
                      <p className="pl-[60px] text-xs font-semibold text-stone-400">
                        + {more} more item{more === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>

                  {/* Status + action */}
                  <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${statusTone(o.status)}`}>
                      {STATUS_LABEL[o.status] || o.status}
                    </span>

                    {/* Cancelled/returned → a clear dead-order line, NOT "buy it
                        again". Delivered → buy again. Otherwise → track. */}
                    {dead ? (
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#EA2831]">
                        <span className="material-symbols-outlined text-[15px]">cancel</span>
                        {o.status === "returned" ? "Order returned" : "Order cancelled"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#EA2831]">
                        <span className="material-symbols-outlined text-[15px]">
                          {delivered ? "refresh" : "local_shipping"}
                        </span>
                        {delivered ? "Buy it again" : "Track order"}
                        <span className="material-symbols-outlined text-[15px]">
                          chevron_right
                        </span>
                      </span>
                    )}
                  </div>

                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}