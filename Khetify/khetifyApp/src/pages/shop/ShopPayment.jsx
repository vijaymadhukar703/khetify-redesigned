import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCart } from "../../context/CartContext";
import { useT } from "../../context/ShopLanguageContext";
import {
  getShopPayment, getShopPaymentConfig, verifyShopPayment,
  dismissShopPayment, completeMockShopPayment, cancelShopPayment,
} from "../../lib/shopApi";
import { rupee } from "../../Components/shop/ProductCard";
import { MOCK_INSTRUMENTS } from "../../lib/paymentMethods";
import { openRazorpayCheckout } from "../../lib/razorpay";
import { getPendingPayment, clearPendingPayment } from "../../lib/pendingPayment";
import { clearBuyNowItem } from "../../lib/buyNow";

/* ─────────────────────────────────────────────────────────────────────────────
 * Khetify — Payment  (/customer-shop/payment/:paymentId)
 *
 * Was ShopMockPayment.jsx. Renamed because it is no longer only a mock: the
 * server decides which gateway is live (Razorpay when its keys are in .env,
 * the built-in mock otherwise) and this screen renders whichever answered.
 *
 * TWO PATHS, ONE ENDING:
 *   Razorpay → opens Razorpay Checkout (their hosted modal, their card form,
 *              their PCI scope) → the browser gets back a payment id and a
 *              signature → POST /payments/:id/verify.
 *   Mock     → the built-in instrument picker and a simulated verdict.
 * Both end at POST-verified orders and the SAME order-success screen COD uses.
 *
 * WHAT THIS SCREEN IS NOT TRUSTED WITH:
 *   Nothing here proves a payment happened. Razorpay hands the BROWSER a
 *   signature, and a browser can say anything. The server re-derives that
 *   signature with a secret this bundle has never seen, then re-reads the
 *   payment from Razorpay to confirm it captured for the right amount. Only
 *   then do orders exist. So the worst a tampered client can do is fail.
 *
 * NOTHING IS ORDERED UNTIL THE SERVER SAYS SO. The cart is still intact behind
 * this screen and is cleared only after the orders come back — which is why
 * closing the Razorpay modal, a declined card and a refresh are all harmless.
 *
 * CHROME-LESS, like order-success: a payment screen with a search bar and a
 * cart icon on it invites the shopper to wander off mid-transaction.
 * ───────────────────────────────────────────────────────────────────────────── */

/* Mock only. A slow-ish fake settle — instant success reads as "nothing
   happened" and hides the processing state a real gateway definitely has. */
const FAKE_SETTLE_MS = 1400;

export default function ShopPayment() {
  const t = useT();
  const cart = useCart();
  const navigate = useNavigate();
  const { paymentId } = useParams();

  const [payment, setPayment] = useState(null);
  const [gateway, setGateway] = useState(null); // { provider, isMock, mode, keyId }
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [instrument, setInstrument] = useState(MOCK_INSTRUMENTS[0].id);
  const [processing, setProcessing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");

  /* The two local facts checkout handed over (which basket to clear, and the
     sellerId → name map the success screen needs). Missing after a refresh in a
     new tab — the flow still completes, only the seller names fall back. */
  const handoff = useMemo(() => getPendingPayment(paymentId) || {}, [paymentId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Both in one trip: which gateway, and what am I paying.
        const [cfg, res] = await Promise.all([
          getShopPaymentConfig(),
          getShopPayment(paymentId),
        ]);
        if (!alive) return;
        setGateway(cfg.data);
        setPayment(res.data);
      } catch (err) {
        if (!alive) return;
        setLoadError(err?.response?.data?.message || t("pay.notFound"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // t is stable per language; re-running on a language switch is harmless.
  }, [paymentId, t]);

  const quote = payment?.quote || {};
  const amount = payment?.amount || 0;
  const orderCount = quote.orderCount || 1;
  const totalUnits = quote.totalUnits || 0;
  const ship = quote.shippingAddress || {};
  const isMock = gateway?.isMock !== false; // assume mock until told otherwise
  const isTestMode = isMock || gateway?.mode === "test";

  /* Success is the ONLY place the basket is cleared — after the server has
     confirmed the orders exist. Buy-now and the cart are kept strictly apart,
     exactly as ShopCheckout does it. */
  const finish = (orders) => {
    if (handoff.isBuyNow) clearBuyNowItem();
    else cart.clearCart();
    clearPendingPayment();
    navigate("/customer-shop/order-success", {
      replace: true,
      state: { orders, sellerNames: handoff.sellerNames || {} },
    });
  };

  /** Re-read the session so attempts / status stay honest after a failure. */
  const refresh = async () => {
    try {
      const res = await getShopPayment(paymentId);
      setPayment(res.data);
    } catch { /* the error already on screen is the useful one */ }
  };

  const failWith = async (message) => {
    setError(message);
    setProcessing(false);
    await refresh();
  };

  /* ── REAL: Razorpay Checkout ── */
  const payWithRazorpay = async () => {
    setError("");
    setProcessing(true);
    try {
      // The `checkout` block is built SERVER-SIDE and passed through untouched.
      // Rebuilding it here would mean the amount and the order id could drift
      // from what the server will verify.
      const res = await getShopPayment(paymentId);
      setPayment(res.data);

      await openRazorpayCheckout(
        {
          keyId: gateway.keyId,
          orderId: res.data.gatewayOrderId,
          amount: Math.round((res.data.amount || 0) * 100),
          currency: res.data.currency || "INR",
          name: "Khetify",
          description: t("pay.description"),
          prefill: {},
          theme: { color: "#EA2831" },
        },
        {
          onSuccess: async ({ gatewayPaymentId, signature }) => {
            try {
              const done = await verifyShopPayment(paymentId, { gatewayPaymentId, signature });
              const orders = done?.data?.orders || [];
              if (!orders.length) throw new Error(t("pay.failedTitle"));
              finish(orders);
            } catch (err) {
              await failWith(
                err?.response?.data?.message || err?.message || t("pay.failedTitle")
              );
            }
          },
          onFailure: async (message) => { await failWith(message); },
          onDismiss: async () => {
            // Not an error: nothing was charged, nothing was ordered.
            setProcessing(false);
            try { await dismissShopPayment(paymentId); } catch { /* best effort */ }
            await refresh();
          },
        }
      );
    } catch (err) {
      await failWith(err?.response?.data?.message || err?.message || t("pay.failedTitle"));
    }
  };

  /**
   * ⛔ MOCK GATEWAY ONLY.
   * @param {"success"|"failure"} outcome
   */
  const payWithMock = async (outcome) => {
    setError("");
    setProcessing(true);
    try {
      // Purely cosmetic: gives the "processing" state something to be.
      await new Promise((r) => setTimeout(r, FAKE_SETTLE_MS));
      const res = await completeMockShopPayment(paymentId, { outcome, instrument });
      const orders = res?.data?.orders || [];
      if (!orders.length) throw new Error(t("pay.failedTitle"));
      finish(orders);
    } catch (err) {
      await failWith(err?.response?.data?.message || err?.message || t("pay.failedTitle"));
    }
  };

  const abandon = async () => {
    setCancelling(true);
    try {
      await cancelShopPayment(paymentId);
    } catch {
      /* Cancelling is best-effort — an uncancelled session just expires. */
    }
    clearPendingPayment();
    // Back to checkout with the cart still intact: nothing was ordered.
    navigate("/customer-shop/checkout", { replace: true });
  };

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F4EF] px-4">
        <div className="text-center">
          <span className="mx-auto mb-3 block size-9 animate-spin rounded-full border-[3px] border-stone-200 border-t-[#EA2831]" />
          <p className="text-[13px] font-semibold text-[#6B6A62]">{t("pay.loading")}</p>
        </div>
      </div>
    );
  }

  /* ── Session gone / expired / cancelled ── */
  const dead = loadError || ["cancelled", "expired"].includes(payment?.status);
  if (dead) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F4EF] px-4">
        <div className="w-full max-w-md rounded-[24px] border border-[#E2E0D6] bg-white p-8 text-center">
          <span className="material-symbols-outlined mb-2 text-4xl text-stone-300">timer_off</span>
          <h1 className="font-heading text-lg font-extrabold text-[#14201A]">
            {loadError || t("pay.expiredTitle")}
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#6B6A62]">{t("pay.expiredSub")}</p>
          <Link
            to="/customer-shop/checkout"
            className="mt-5 inline-flex h-[46px] items-center justify-center rounded-full bg-[#EA2831] px-6 text-[14px] font-bold text-white transition-colors hover:bg-[#c91e26]"
          >
            {t("pay.backToCheckout")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F4EF]">
      <div className="mx-auto max-w-lg px-4 py-8 sm:py-12">

        {/* Brand mark only — no nav, no search, no cart. */}
        <div className="mb-6 flex justify-center">
          <span className="flex items-center gap-2.5 text-[#14201A]">
            <span className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-[#EA2831]">
              <span className="material-symbols-outlined text-[17px] text-white">storefront</span>
            </span>
            <span className="font-heading text-xl font-extrabold tracking-tight">Khetify</span>
          </span>
        </div>

        {/* Test mode is never hidden from the person paying — whether that is
            the mock gateway or a Razorpay TEST key. In live mode this banner
            disappears on its own; there is no flag to remember to flip. */}
        {isTestMode && (
          <p className="mb-4 flex items-start gap-2 rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-medium leading-relaxed text-amber-900">
            <span className="material-symbols-outlined text-base">science</span>
            <span>
              <strong className="uppercase tracking-wide">{t("pay.testMode")}</strong> —{" "}
              {isMock ? t("pay.testModeNote") : t("pay.razorpayTestNote")}
            </span>
          </p>
        )}

        <div className="overflow-hidden rounded-[24px] border border-[#E2E0D6] bg-white shadow-[0_10px_40px_-16px_rgba(20,32,26,0.12)]">

          {/* ── Amount ── */}
          <div className="border-b border-[#E2E0D6] bg-[#FAFAF7] px-6 py-6 text-center">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#9B9A92]">{t("pay.amountDue")}</p>
            <p className="mt-1 font-heading text-3xl font-black tracking-tight text-[#14201A]">{rupee(amount)}</p>
            <p className="mt-1.5 text-[12px] text-[#6B6A62]">
              {t(totalUnits === 1 ? "pay.itemCount" : "pay.itemCountPlural", { count: totalUnits })}
              {orderCount > 1 && <> · {t("pay.ordersNote", { count: orderCount })}</>}
            </p>
          </div>

          {processing ? (
            <div className="px-6 py-12 text-center">
              <span className="mx-auto mb-4 block size-10 animate-spin rounded-full border-[3px] border-stone-200 border-t-[#EA2831]" />
              <p className="font-heading text-[15px] font-extrabold text-[#14201A]">{t("pay.processing")}</p>
              <p className="mt-1 text-[12px] text-[#9B9A92]">{t("pay.doNotClose")}</p>
            </div>
          ) : (
            <div className="px-6 py-6">

              {error && (
                <div className="mb-4 rounded-[16px] border border-red-100 bg-red-50 px-4 py-3">
                  <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#EA2831]">
                    <span className="material-symbols-outlined text-base">error</span>
                    {t("pay.failedTitle")}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-[#8a2b2f]">{error}</p>
                  {payment?.attempts > 0 && (
                    <p className="mt-1 text-[11px] text-[#9B9A92]">{t("pay.attempts", { n: payment.attempts })}</p>
                  )}
                </div>
              )}

              {isMock ? (
                <>
                  {/* ── ⛔ MOCK: instrument picker + simulated verdict ── */}
                  <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-[#9B9A92]">{t("pay.choose")}</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {MOCK_INSTRUMENTS.map((ins) => {
                      const active = instrument === ins.id;
                      return (
                        <button
                          key={ins.id}
                          type="button"
                          onClick={() => setInstrument(ins.id)}
                          className={`flex items-center gap-2.5 rounded-[16px] border px-3.5 py-3 text-left transition-all ${
                            active
                              ? "border-[#EA2831] bg-red-50/30 ring-1 ring-[#EA2831]"
                              : "border-[#E2E0D6] bg-white hover:border-[#c9c7bb]"
                          }`}
                        >
                          <span className={`material-symbols-outlined text-[20px] ${active ? "text-[#EA2831]" : "text-[#9B9A92]"}`}>
                            {ins.icon}
                          </span>
                          <span className={`text-[13px] font-bold ${active ? "text-[#14201A]" : "text-[#6B6A62]"}`}>
                            {t(ins.labelKey)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                /* ── REAL: Razorpay owns the instrument choice and the card
                       form. Duplicating a picker here would be theatre — and a
                       card field on OUR origin is exactly what using a hosted
                       checkout is meant to avoid. ── */
                <div className="rounded-[16px] border border-[#E2E0D6] bg-[#FAFAF7] px-4 py-3.5">
                  <p className="flex items-center gap-2 text-[13px] font-bold text-[#14201A]">
                    <span className="material-symbols-outlined text-[19px] text-[#EA2831]">shield_lock</span>
                    {t("pay.razorpayTitle")}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-[#6B6A62]">{t("pay.razorpaySub")}</p>
                </div>
              )}

              {/* ── Where it's going ── */}
              {ship.line1 && (
                <div className="mt-5 rounded-[16px] border border-[#E2E0D6] bg-[#FAFAF7] px-4 py-3">
                  <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[#9B9A92]">
                    <span className="material-symbols-outlined text-sm">local_shipping</span> {t("pay.deliveringTo")}
                  </p>
                  <p className="mt-1 text-[13px] font-bold text-[#14201A]">{ship.name}</p>
                  <p className="text-[12px] leading-snug text-[#6B6A62]">
                    {[ship.line1, ship.city, ship.pincode].filter(Boolean).join(", ")}
                  </p>
                </div>
              )}

              {/* ── Pay ── */}
              <button
                onClick={() => (isMock ? payWithMock("success") : payWithRazorpay())}
                className="mt-5 flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[#EA2831] text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(234,40,49,0.24)] transition-colors hover:bg-[#c91e26]"
              >
                <span className="material-symbols-outlined text-[19px]">lock</span>
                {t("pay.payNow", { amount: rupee(amount) })}
              </button>

              {/* ⛔ MOCK ONLY. A real gateway produces its own failures; you
                  don't get to ask for one. Hidden the moment Razorpay is live. */}
              {isMock && (
                <button
                  onClick={() => payWithMock("failure")}
                  className="mt-2.5 flex h-[44px] w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-dashed border-[#E2E0D6] bg-white text-[13px] font-bold text-[#9B9A92] transition-colors hover:border-[#c9c7bb] hover:text-[#6B6A62]"
                >
                  <span className="material-symbols-outlined text-[17px]">bug_report</span>
                  {t("pay.simulateFailure")}
                </button>
              )}

              <button
                onClick={abandon}
                disabled={cancelling}
                className="mt-3 w-full text-center text-[12px] font-bold uppercase tracking-wide text-[#9B9A92] transition-colors hover:text-[#EA2831] disabled:opacity-60"
              >
                {cancelling ? t("pay.cancelling") : t("pay.cancel")}
              </button>
            </div>
          )}
        </div>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[11px] leading-relaxed text-[#9B9A92]">
          <span className="material-symbols-outlined text-sm">verified_user</span>
          {isMock ? t("pay.secureNote") : t("pay.poweredByRazorpay")}
        </p>
      </div>
    </div>
  );
}