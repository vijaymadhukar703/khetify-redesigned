import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { rupee } from "../../Components/shop/ProductCard";

/* ─────────────────────────────────────────────────────────────────────────────
 * Khetify — Order confirmation  (/customer-shop/order-success)
 *
 * NO HEADER, NO FOOTER, NO BOTTOM NAV. This route now sits outside ShopLayout
 * (see App.jsx → ShopProviders). A confirmation screen is a dead end: the
 * shopper has just committed money and needs to READ their order — not be
 * offered a search bar, a cart icon and a footer sitemap. Only a small brand
 * mark stays, so the page still feels like Khetify.
 *
 * Everything shown here comes from the Order documents the server just created
 * (items, shipping address, payment, totals, placedAt). The one thing an Order
 * does NOT carry is the seller's NAME — it stores ownerId only — so ShopCheckout
 * hands over an id→name map in router state alongside the orders.
 * ───────────────────────────────────────────────────────────────────────────── */

const STATUS_LABEL = {
  pending: "Order placed", confirmed: "Confirmed", packed: "Packed",
  shipped: "Shipped", delivered: "Delivered", returned: "Returned", cancelled: "Cancelled",
};

const NEXT_STEPS = [
  { icon: "receipt_long", title: "Order placed", body: "We've sent your order to the seller.", done: true },
  { icon: "inventory",    title: "Seller confirms",  body: "The seller accepts and reserves your stock." },
  { icon: "package_2",    title: "Packed & shipped", body: "You'll be able to track it from My Orders." },
  { icon: "payments",     title: "Pay on delivery",  body: "Hand over the cash when your package arrives." },
];

const fmtDate = (d) =>
  new Date(d || Date.now()).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });

/* ── Order number + one-tap copy (people paste this into support chats) ── */
function OrderNumber({ value }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the number is still on screen to read */
    }
  };

  return (
    <button
      onClick={copy}
      title="Copy order number"
      className="group inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 font-heading text-[15px] font-extrabold text-[#14201A] transition-colors hover:bg-stone-100 print:hover:bg-transparent"
    >
      {value}
      <span
        className={`material-symbols-outlined text-[15px] transition-colors print:hidden ${
          copied ? "text-emerald-600" : "text-stone-300 group-hover:text-stone-500"
        }`}
      >
        {copied ? "check" : "content_copy"}
      </span>
    </button>
  );
}

export default function ShopOrderSuccess() {
  const { state } = useLocation();
  const navigate = useNavigate();

  const orders = useMemo(() => state?.orders || [], [state]);
  const sellerNames = state?.sellerNames || {};

  /* Landing here directly (refresh, bookmark, back-button) means there is no
     order in router state. The old page happily rendered "Order placed!" with
     nothing under it — a confusing lie. Send them to their real order list. */
  useEffect(() => {
    if (!orders.length) navigate("/customer-shop/orders", { replace: true });
  }, [orders.length, navigate]);

  if (!orders.length) return null;

  const grandTotal = orders.reduce((s, o) => s + (o.totalAmount || 0), 0);
  const totalUnits = orders.reduce((s, o) => s + (o.totalUnits || 0), 0);
  const ship = orders[0]?.shippingAddress || {};
  const placedAt = orders[0]?.placedAt || orders[0]?.createdAt;
  const multi = orders.length > 1;

  return (
    <div className="min-h-screen bg-[#F5F4EF] print:bg-white">
      {/* Print rules: strip the interactive furniture from a saved/printed copy. */}
      <style>{`
        @keyframes ringPop { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.08) } 100% { transform: scale(1); opacity: 1 } }
        @keyframes tickDraw { from { stroke-dashoffset: 30 } to { stroke-dashoffset: 0 } }
        @keyframes riseIn { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        .successRing { animation: ringPop .55s cubic-bezier(.22,1,.36,1) both }
        .successTick { stroke-dasharray: 30; animation: tickDraw .4s .35s ease-out both }
        .riseIn { animation: riseIn .5s cubic-bezier(.22,1,.36,1) both }
        @media (prefers-reduced-motion: reduce) {
          .successRing, .successTick, .riseIn { animation: none }
        }
        @media print {
          .no-print { display: none !important }
          .print-flat { box-shadow: none !important; border-color: #ddd !important }
        }
      `}</style>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">

        {/* Brand mark only — no nav, no search, no cart. */}
        <div className="mb-8 flex justify-center">
          <Link to="/customer-shop" className="flex items-center gap-2.5 text-[#14201A]">
            <span className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-[#EA2831]">
              <span className="material-symbols-outlined text-[17px] text-white">storefront</span>
            </span>
            <span className="font-heading text-xl font-extrabold tracking-tight">Khetify</span>
          </Link>
        </div>

        {/* ── Hero ── */}
        <section className="riseIn mb-5 rounded-[24px] border border-[#E2E0D6] bg-white p-8 text-center shadow-[0_10px_40px_-16px_rgba(20,32,26,0.12)] print-flat sm:p-10">
          <span className="successRing mx-auto flex h-[76px] w-[76px] items-center justify-center rounded-full bg-emerald-50 ring-8 ring-emerald-50/50">
            <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="#059669" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path className="successTick" d="M20 6L9 17l-5-5" />
            </svg>
          </span>

          <h1 className="mt-5 font-heading text-2xl font-extrabold tracking-tight text-[#14201A] sm:text-3xl">
            {multi ? "Your orders are placed!" : "Your order is placed!"}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-[#6B6A62]">
            Thank you{ship.name ? `, ${ship.name.split(" ")[0]}` : ""}. We've sent{" "}
            {multi ? `${orders.length} orders` : "your order"} to{" "}
            {multi ? "the sellers" : "the seller"} for confirmation.
          </p>

          <div className="mt-6 grid grid-cols-3 divide-x divide-[#E2E0D6] rounded-[16px] border border-[#E2E0D6] bg-[#FAFAF7] py-4">
            <div className="px-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#9B9A92]">Amount</p>
              <p className="mt-0.5 font-heading text-lg font-extrabold text-[#14201A]">{rupee(grandTotal)}</p>
            </div>
            <div className="px-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#9B9A92]">{multi ? "Orders" : "Items"}</p>
              <p className="mt-0.5 font-heading text-lg font-extrabold text-[#14201A]">
                {multi ? orders.length : totalUnits}
              </p>
            </div>
            <div className="px-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#9B9A92]">Payment</p>
              <p className="mt-0.5 font-heading text-lg font-extrabold text-emerald-700">COD</p>
            </div>
          </div>

          <p className="mt-3 text-[13px] text-[#9B9A92]">Placed on {fmtDate(placedAt)}</p>
        </section>

        {/* ── The multi-seller split, explained plainly ── */}
        {multi && (
          <p className="riseIn mb-5 flex items-start gap-2 rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-medium leading-relaxed text-amber-900">
            <span className="material-symbols-outlined text-base">local_shipping</span>
            <span>
              Your items came from <strong>{orders.length} different sellers</strong>, so they were placed as{" "}
              <strong>{orders.length} separate orders</strong>. Each ships on its own schedule and may arrive on
              different days — you pay each one on its own delivery.
            </span>
          </p>
        )}

        {/* ── Order cards ── */}
        <div className="mb-5 flex flex-col gap-4">
          {orders.map((o, idx) => {
            const seller = sellerNames[String(o.ownerId)] || "Khetify seller";
            return (
              <section
                key={o._id}
                className="riseIn overflow-hidden rounded-[20px] border border-[#E2E0D6] bg-white print-flat"
                style={{ animationDelay: `${0.06 * (idx + 1)}s` }}
              >
                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E2E0D6] bg-[#FAFAF7] px-5 py-3.5">
                  <div className="min-w-0">
                    {multi && (
                      <p className="text-[11px] font-bold uppercase tracking-wide text-[#9B9A92]">
                        Order {idx + 1} of {orders.length}
                      </p>
                    )}
                    <OrderNumber value={o.orderNumber} />
                    <p className="flex items-center gap-1 text-[13px] text-[#6B6A62]">
                      <span className="material-symbols-outlined text-[15px] text-[#9B9A92]">storefront</span>
                      Sold by {seller}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-800">
                    <span className="material-symbols-outlined text-[13px]">schedule</span>
                    {STATUS_LABEL[o.status] || o.status}
                  </span>
                </header>

                {/* Line items — the old page never showed WHAT was ordered. */}
                <div className="divide-y divide-[#F0EFE8] px-5">
                  {(o.items || []).map((line, li) => (
                    <div key={li} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold leading-snug text-[#14201A]">{line.name}</p>
                        <p className="mt-0.5 text-[12px] text-[#9B9A92]">
                          {rupee(line.price)} × {line.qty}
                        </p>
                      </div>
                      <span className="shrink-0 text-[14px] font-bold text-[#14201A]">
                        {rupee((line.price || 0) * (line.qty || 0))}
                      </span>
                    </div>
                  ))}
                </div>

                <footer className="flex items-center justify-between border-t border-[#E2E0D6] px-5 py-3.5">
                  <span className="text-[13px] font-bold text-[#6B6A62]">
                    {o.totalUnits} item{o.totalUnits === 1 ? "" : "s"} · pay on delivery
                  </span>
                  <span className="font-heading text-lg font-extrabold text-[#14201A]">
                    {rupee(o.totalAmount || 0)}
                  </span>
                </footer>
              </section>
            );
          })}
        </div>

        {/* ── Delivery + payment ── */}
        <div className="mb-5 grid gap-4 sm:grid-cols-2">
          <section className="riseIn rounded-[20px] border border-[#E2E0D6] bg-white p-5 print-flat">
            <h2 className="mb-2.5 flex items-center gap-2 font-heading text-[15px] font-extrabold text-[#14201A]">
              <span className="material-symbols-outlined text-[19px] text-[#EA2831]">location_on</span>
              Delivering to
            </h2>
            <p className="text-[14px] font-bold text-[#14201A]">
              {ship.name}
              {ship.label && (
                <span className="ml-2 rounded bg-[#F5F4EF] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#6B6A62]">
                  {ship.label}
                </span>
              )}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-[#6B6A62]">
              {[ship.line1, ship.line2, ship.city, ship.district, ship.state, ship.pincode]
                .filter(Boolean)
                .join(", ")}
            </p>
            {ship.phone && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-[#6B6A62]">
                <span className="material-symbols-outlined text-[15px] text-[#9B9A92]">call</span>
                {ship.phone}
              </p>
            )}
          </section>

          <section className="riseIn rounded-[20px] border border-[#E2E0D6] bg-white p-5 print-flat">
            <h2 className="mb-2.5 flex items-center gap-2 font-heading text-[15px] font-extrabold text-[#14201A]">
              <span className="material-symbols-outlined text-[19px] text-emerald-700">payments</span>
              Payment
            </h2>
            <p className="text-[14px] font-bold text-[#14201A]">Cash on Delivery</p>
            <p className="mt-1 text-[13px] leading-relaxed text-[#6B6A62]">
              Nothing has been charged yet. Keep{" "}
              <strong className="text-[#14201A]">{rupee(grandTotal)}</strong> ready
              {multi ? " across your deliveries." : " when your package arrives."}
            </p>
            <p className="mt-2 text-[12px] leading-normal text-[#9B9A92]">
              Inclusive of all taxes. The GST breakdown appears on each seller's invoice.
            </p>
          </section>
        </div>

        {/* ── What happens next ── */}
        <section className="riseIn mb-6 rounded-[20px] border border-[#E2E0D6] bg-white p-5 sm:p-6 print-flat">
          <h2 className="mb-4 font-heading text-[15px] font-extrabold text-[#14201A]">What happens next</h2>
          <ol className="grid gap-4 sm:grid-cols-4">
            {NEXT_STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3 sm:flex-col sm:gap-2">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    s.done ? "bg-emerald-600 text-white" : "bg-[#F5F4EF] text-[#9B9A92]"
                  }`}
                >
                  <span className="material-symbols-outlined text-[19px]">{s.icon}</span>
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-[#14201A]">
                    {i + 1}. {s.title}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-normal text-[#6B6A62]">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Actions ── */}
        <div className="no-print flex flex-col gap-2.5 sm:flex-row">
          <Link
            to={multi ? "/customer-shop/orders" : `/customer-shop/orders/${orders[0]._id}`}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[#EA2831] text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(234,40,49,0.24)] transition-colors hover:bg-[#c91e26] sm:flex-1"
          >
            <span className="material-symbols-outlined text-[19px]">receipt_long</span>
            Track my order{multi ? "s" : ""}
          </Link>
          <Link
            to="/customer-shop/products"
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-[#E2E0D6] bg-white text-[15px] font-bold text-[#14201A] transition-colors hover:border-[#c9c7bb] hover:bg-[#FCFCFA] sm:flex-1"
          >
            Continue shopping
          </Link>
          <button
            onClick={() => window.print()}
            title="Print or save as PDF"
            aria-label="Print or save this confirmation"
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-[#E2E0D6] bg-white px-5 text-[15px] font-bold text-[#6B6A62] transition-colors hover:border-[#c9c7bb] hover:text-[#14201A] sm:w-[52px] sm:px-0"
          >
            <span className="material-symbols-outlined text-[19px]">print</span>
            <span className="sm:hidden">Save a copy</span>
          </button>
        </div>

        <p className="no-print mt-6 text-center text-[12px] text-[#9B9A92]">
          Need help with this order? Reach us from{" "}
          <Link to="/customer-shop/orders" className="font-bold text-[#EA2831] hover:underline">
            My Orders
          </Link>
          .
        </p>
      </div>
    </div>
  );
}