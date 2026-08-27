import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "../../context/CartContext";
import { useT } from "../../context/ShopLanguageContext";
import { reviewShopCheckout, shopCheckout } from "../../lib/shopApi";
import { rupee } from "../../Components/shop/ProductCard";
import { PAYMENT_METHODS } from "../../lib/paymentMethods";
import { getPendingOrder, clearPendingOrder } from "../../lib/pendingOrder";
import { clearBuyNowItem } from "../../lib/buyNow";

/* ─────────────────────────────────────────────────────────────────────────────
 * Khetify — Confirm order  (/customer-shop/confirm)
 *
 * The COD twin of ShopPayment.jsx.
 *
 * Before this screen existed the two lanes were lopsided: picking Online
 * Payment gave the shopper a final "here is exactly what you are about to pay
 * for" step, while picking COD placed the order the instant they tapped —
 * no last look, no way back short of cancelling a real order. Same basket, same
 * money, very different amount of care. Now both lanes end the same way.
 *
 * WHAT MAKES IT MORE THAN DECORATION:
 *   The totals shown here are fetched from POST /checkout/review, which prices
 *   the basket with the SAME server code that will place it. A confirmation
 *   screen showing numbers the browser was already carrying would confirm a
 *   figure nobody re-checked — and would happily show a stale price if
 *   something changed since the cart page.
 *
 *   The review call is also a genuine dry run: an out-of-stock item or a
 *   deleted listing fails HERE, with the basket still intact, instead of
 *   halfway through creating orders.
 *
 * NOTHING IS ORDERED UNTIL THE BUTTON. The cart is untouched behind this screen
 * and is cleared only after the server returns the created orders.
 *
 * CHROME-LESS, like the payment and success screens.
 * ───────────────────────────────────────────────────────────────────────────── */

export default function ShopConfirmOrder() {
  const t = useT();
  const cart = useCart();
  const navigate = useNavigate();

  const pending = useMemo(() => getPendingOrder(), []);

  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");

  /* Price the basket server-side. Runs once — re-pricing on every keystroke
     would hammer the API for a screen with no inputs. */
  useEffect(() => {
    if (!pending) { setLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const res = await reviewShopCheckout({
          items: pending.items,
          shippingAddressId: pending.shippingAddressId,
          paymentMethod: PAYMENT_METHODS.COD,
        });
        if (alive) setQuote(res.data);
      } catch (err) {
        if (alive) setLoadError(err?.response?.data?.message || t("cf.reviewFailed"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [pending, t]);

  const placeOrder = async () => {
    setError("");
    setPlacing(true);
    try {
      const res = await shopCheckout({
        items: pending.items,
        shippingAddressId: pending.shippingAddressId,
        paymentMethod: PAYMENT_METHODS.COD,
      });

      // Only now. Buy-now and the cart stay strictly apart, as everywhere else.
      if (pending.isBuyNow) clearBuyNowItem();
      else cart.clearCart();
      clearPendingOrder();

      navigate("/customer-shop/order-success", {
        replace: true,
        state: { orders: res.data, sellerNames: pending.sellerNames || {} },
      });
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || t("cf.failed"));
      setPlacing(false);
    }
  };

  /* ── Nothing to confirm (direct URL, or a new tab) ── */
  if (!pending || loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F4EF] px-4">
        <div className="w-full max-w-md rounded-[24px] border border-[#E2E0D6] bg-white p-8 text-center">
          <span className="material-symbols-outlined mb-2 text-4xl text-stone-300">receipt_long</span>
          <h1 className="font-heading text-lg font-extrabold text-[#14201A]">
            {loadError || t("cf.nothingTitle")}
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#6B6A62]">{t("cf.nothingSub")}</p>
          <Link
            to="/customer-shop/checkout"
            className="mt-5 inline-flex h-[46px] items-center justify-center rounded-full bg-[#EA2831] px-6 text-[14px] font-bold text-white transition-colors hover:bg-[#c91e26]"
          >
            {t("cf.backToCheckout")}
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F4EF] px-4">
        <div className="text-center">
          <span className="mx-auto mb-3 block size-9 animate-spin rounded-full border-[3px] border-stone-200 border-t-[#EA2831]" />
          <p className="text-[13px] font-semibold text-[#6B6A62]">{t("cf.loading")}</p>
        </div>
      </div>
    );
  }

  const ship = quote?.shippingAddress || {};
  const sellers = quote?.sellers || [];
  const amount = quote?.amount || 0;
  const totalUnits = quote?.totalUnits || 0;

  return (
    <div className="min-h-screen bg-[#F5F4EF]">
      <div className="mx-auto max-w-lg px-4 py-8 sm:py-12">

        <div className="mb-6 flex justify-center">
          <span className="flex items-center gap-2.5 text-[#14201A]">
            <span className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-[#EA2831]">
              <span className="material-symbols-outlined text-[17px] text-white">storefront</span>
            </span>
            <span className="font-heading text-xl font-extrabold tracking-tight">Khetify</span>
          </span>
        </div>

        <div className="overflow-hidden rounded-[24px] border border-[#E2E0D6] bg-white shadow-[0_10px_40px_-16px_rgba(20,32,26,0.12)]">

          {/* ── Amount ── */}
          <div className="border-b border-[#E2E0D6] bg-[#FAFAF7] px-6 py-6 text-center">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#9B9A92]">{t("cf.payOnDelivery")}</p>
            <p className="mt-1 font-heading text-3xl font-black tracking-tight text-[#14201A]">{rupee(amount)}</p>
            <p className="mt-1.5 text-[12px] text-[#6B6A62]">
              {t(totalUnits === 1 ? "cf.itemCount" : "cf.itemCountPlural", { count: totalUnits })}
              {sellers.length > 1 && <> · {t("cf.ordersNote", { count: sellers.length })}</>}
            </p>
          </div>

          <div className="px-6 py-6">

            {error && (
              <div className="mb-4 rounded-[16px] border border-red-100 bg-red-50 px-4 py-3">
                <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#EA2831]">
                  <span className="material-symbols-outlined text-base">error</span>
                  {t("cf.failed")}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-[#8a2b2f]">{error}</p>
              </div>
            )}

            {/* ── What's in it ──
                The shopper is about to commit; showing the line items is the
                whole point of the screen. */}
            <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-[#9B9A92]">{t("cf.yourOrder")}</p>
            <div className="space-y-2.5">
              {sellers.map((s, si) => (
                <div key={si} className="rounded-[16px] border border-[#E2E0D6] bg-white px-4 py-3">
                  {sellers.length > 1 && (
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#9B9A92]">
                      {t("cf.orderN", { n: si + 1 })}
                    </p>
                  )}
                  {s.items.map((it, ii) => (
                    <div key={ii} className="flex items-start justify-between gap-3 py-1">
                      <span className="min-w-0 text-[13px] leading-snug text-[#14201A]">
                        {it.name}
                        {it.variantLabel && (
                          <span className="text-[#9B9A92]"> · {it.variantLabel}</span>
                        )}
                        <span className="text-[#9B9A92]"> × {it.qty}</span>
                      </span>
                      <span className="shrink-0 text-[13px] font-bold text-[#14201A]">
                        {rupee(it.price * it.qty)}
                      </span>
                    </div>
                  ))}
                  {sellers.length > 1 && (
                    <p className="mt-1.5 border-t border-[#F0EFE8] pt-1.5 text-right text-[12px] font-bold text-[#6B6A62]">
                      {rupee(s.amount)}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* ── Where it's going ── */}
            {ship.line1 && (
              <div className="mt-4 rounded-[16px] border border-[#E2E0D6] bg-[#FAFAF7] px-4 py-3">
                <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[#9B9A92]">
                  <span className="material-symbols-outlined text-sm">local_shipping</span> {t("cf.deliveringTo")}
                </p>
                <p className="mt-1 text-[13px] font-bold text-[#14201A]">{ship.name}</p>
                <p className="text-[12px] leading-snug text-[#6B6A62]">
                  {[ship.line1, ship.line2, ship.city, ship.state, ship.pincode].filter(Boolean).join(", ")}
                </p>
              </div>
            )}

            {/* ── How it's being paid ── */}
            <div className="mt-2.5 flex items-center gap-3 rounded-[16px] border border-[#E2E0D6] bg-[#FAFAF7] px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-[#EA2831]">
                <span className="material-symbols-outlined text-lg">payments</span>
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-[#14201A]">{t("co.cod")}</span>
                <span className="block text-[12px] leading-snug text-[#6B6A62]">
                  {t("cf.codNote", { amount: rupee(amount) })}
                </span>
              </span>
            </div>

            <button
              onClick={placeOrder}
              disabled={placing}
              className="mt-5 flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[#EA2831] text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(234,40,49,0.24)] transition-colors hover:bg-[#c91e26] disabled:opacity-70"
            >
              {placing ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  {t("cf.placing")}
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[19px]">check_circle</span>
                  {sellers.length > 1
                    ? t("cf.placeNOrders", { n: sellers.length })
                    : t("cf.placeOrder")}
                </>
              )}
            </button>

            <button
              onClick={() => navigate("/customer-shop/checkout", { replace: true })}
              disabled={placing}
              className="mt-3 w-full text-center text-[12px] font-bold uppercase tracking-wide text-[#9B9A92] transition-colors hover:text-[#EA2831] disabled:opacity-60"
            >
              {t("cf.back")}
            </button>
          </div>
        </div>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[11px] leading-relaxed text-[#9B9A92]">
          <span className="material-symbols-outlined text-sm">verified_user</span>
          {t("cf.secureNote")}
        </p>
      </div>
    </div>
  );
}