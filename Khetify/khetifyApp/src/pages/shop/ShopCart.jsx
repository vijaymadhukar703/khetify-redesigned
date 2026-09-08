import React, { memo, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "../../context/CartContext";
import { useWishlist } from "../../context/WishlistContext";
import { useT } from "../../context/ShopLanguageContext";
import { getProductImage } from "../../lib/productImage";
import { getShopProducts } from "../../lib/shopApi";
import { rupee } from "../../Components/shop/ProductCard";

/* Khetify cart.

   ── STYLED AS THE REST OF THE STOREFRONT ──
   This page had its own look: a stone-100 page background nothing else uses,
   `rounded-sm` corners against the 2xl radius everywhere else, and its own
   greys. It now draws from the same short palette as the home page and the
   wishlist — #EA2831 / #C91E26 for action, #FDECEC and #F5F4EF for tinted
   surfaces, #16191B for ink, stone for everything muted. */

/* Estimated delivery, recomputed from today. */
const DELIVERY_ETA_DAYS = 3;
const estimatedDeliveryLabel = (days = DELIVERY_ETA_DAYS) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

const QtyStepper = memo(function QtyStepper({ item, setQty }) {
  const atMax = Number.isFinite(item.availableStock) && item.availableStock > 0 && item.qty >= item.availableStock;
  return (
    <div className="inline-flex items-center overflow-hidden rounded-xl border border-stone-200 bg-white">
      <button
        onClick={() => setQty(item.lineId || item.listingId, item.qty - 1)}
        className="flex size-9 items-center justify-center text-stone-600 transition-colors hover:bg-stone-50 hover:text-[#EA2831]"
      >
        <span className="material-symbols-outlined text-[18px]">remove</span>
      </button>
      <span className="w-9 text-center text-[13px] font-bold text-stone-900">{item.qty}</span>
      <button
        onClick={() => setQty(item.lineId || item.listingId, item.qty + 1)}
        disabled={atMax}
        className="flex size-9 items-center justify-center text-stone-600 transition-colors hover:bg-stone-50 hover:text-[#EA2831] disabled:text-stone-300 disabled:hover:bg-transparent"
      >
        <span className="material-symbols-outlined text-[18px]">add</span>
      </button>
    </div>
  );
});

const CartLine = memo(function CartLine({ item, setQty, removeItem, onSaveForLater, saved }) {
  const t = useT();
  const img = getProductImage(item.image);
  // Carry the variant into the link, so clicking the name reopens the option
  // that is IN THE CART rather than the product's default.
  const href = `/customer-shop/product/${item.listingId}${item.variantId ? `?variant=${item.variantId}` : ""}`;
  const hasDiscount = item.mrp && item.mrp > item.price;
  const off = hasDiscount ? Math.round(((item.mrp - item.price) / item.mrp) * 100) : 0;

  return (
    <div className="rounded-2xl border border-stone-200/80 bg-white p-4 transition-colors hover:border-[#F3C6C8] sm:p-5">
      <div className="flex items-start gap-4">
        <Link to={href} className="size-[92px] shrink-0 overflow-hidden rounded-xl bg-stone-100 sm:size-[104px]">
          {img ? (
            <img src={img} alt={item.name} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-stone-300">
              <span className="material-symbols-outlined text-3xl">eco</span>
            </span>
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <Link to={href} className="line-clamp-2 text-[14px] font-semibold leading-snug text-stone-900 transition-colors hover:text-[#EA2831]">
              {item.name}
            </Link>
            <span className="whitespace-nowrap text-[11.5px] text-stone-400">
              {t("cart.deliveryBy", { date: estimatedDeliveryLabel() })}
            </span>
          </div>

          {/* WHICH OPTION was bought. Without it two lines of the same product
              at two prices look like a duplicate-row bug. */}
          {item.variantLabel && (
            <span className="mt-1.5 inline-block rounded bg-[#F5F4EF] px-2 py-0.5 text-[10.5px] font-semibold text-stone-600">
              {item.variantLabel}
            </span>
          )}

          {item.sellerName && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-stone-400">
              {t("cart.seller")} <span className="font-semibold text-stone-700">{item.sellerName}</span>
              <span className="rounded bg-emerald-700 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wide text-white">
                {t("cart.kAssured")}
              </span>
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2">
            <span className="font-heading text-[17px] font-bold text-stone-900">{rupee(item.price * item.qty)}</span>
            {hasDiscount && <span className="text-[12px] text-stone-400 line-through">{rupee(item.mrp * item.qty)}</span>}
            {hasDiscount && <span className="text-[12px] font-bold text-emerald-700">{t("cart.off", { percent: off })}</span>}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <QtyStepper item={item} setQty={setQty} />

            {/* SAVE FOR LATER NOW DOES SOMETHING. It was a button with no
                onClick — it looked live, changed nothing, and the shopper had
                no way to tell. It moves the line to the wishlist, which is the
                feature that already exists for exactly this. */}
            {/* <button
              type="button"
              onClick={() => onSaveForLater(item)}
              disabled={saved}
              className="text-[11.5px] font-bold uppercase tracking-wide text-stone-500 transition-colors hover:text-[#EA2831] disabled:text-stone-300 disabled:hover:text-stone-300"
            >
              {t("cart.saveForLater")}
            </button> */}

            <button
              type="button"
              onClick={() => removeItem(item.lineId || item.listingId)}
              className="text-[11.5px] font-bold uppercase tracking-wide text-stone-500 transition-colors hover:text-[#EA2831]"
            >
              {t("cart.remove")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default function ShopCart() {
  const { items, setQty, removeItem, addItem, subtotal, count } = useCart();
  const { toggleItem, isWishlisted } = useWishlist();
  const t = useT();
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState([]);

  const totalMrp = items.reduce((sum, it) => sum + (it.mrp || it.price) * it.qty, 0);
  const totalSavings = totalMrp - subtotal;
  const grandTotal = subtotal;

  /* Categories already in the cart, as a stable string. `items` is a new array
     on every render, so depending on it directly re-ran this fetch in a loop —
     the effect set state, the state re-rendered, the array changed identity,
     and round it went. */
  const cartCategories = useMemo(
    () => [...new Set(items.map((it) => it.category).filter(Boolean))].join(","),
    [items]
  );
  const cartIds = useMemo(() => items.map((it) => it.listingId), [items]);

  /* SUGGESTIONS COME FROM THE REAL CATALOGUE API.
     This used to `fetch("/api/products?categories=…")` directly — a path that
     is not the storefront's API (shopApi is mounted at BASE_URL + "shop/"),
     with a parameter the endpoint does not take and a response shape it does
     not return. It could never have loaded anything; the section simply never
     appeared. getShopProducts is the same call the rest of the storefront
     uses, so it also carries the language header. */
  useEffect(() => {
    if (!cartCategories) { setSuggestions([]); return undefined; }
    let alive = true;
    const firstCategory = cartCategories.split(",")[0];

    getShopProducts({ category: firstCategory, limit: 12 })
      .then((res) => {
        if (!alive) return;
        const rows = (res?.data || []).filter((p) => !cartIds.includes(p.listingId));
        setSuggestions(rows.slice(0, 4));
      })
      // Suggestions are a nicety; a failure leaves the section hidden rather
      // than putting an error on a page the shopper is trying to check out from.
      .catch(() => { if (alive) setSuggestions([]); });

    return () => { alive = false; };
  }, [cartCategories, cartIds]);

  const saveForLater = (item) => {
    const variant = item.variantId
      ? { id: item.variantId, label: item.variantLabel, attributes: item.variantAttributes, image: item.image, mrp: item.mrp }
      : null;
    toggleItem(item, variant);
    removeItem(item.lineId || item.listingId);
  };

  if (items.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1360px] px-3 py-10 sm:px-6 lg:px-8">
        <div className="rounded-[20px] bg-[#F5F4EF] px-6 py-16 text-center">
          <span className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-white text-[#EA2831]">
            <span className="material-symbols-outlined text-[30px]">shopping_cart</span>
          </span>
          <h1 className="font-heading text-xl font-bold tracking-tight text-stone-900 sm:text-2xl">{t("cart.empty")}</h1>
          <Link
            to="/customer-shop/products"
            className="mt-6 inline-flex items-center gap-1.5 rounded-[10px] bg-[#EA2831] px-5 py-2.5 text-[13px] font-bold text-white transition-colors duration-300 hover:bg-[#C91E26]"
          >
            {t("cart.shopNow")}
            <span className="material-symbols-outlined text-[17px]">arrow_forward</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1360px] px-3 py-6 sm:px-6 lg:px-8 lg:py-10">

      {/* Page head. The back control sits INSIDE the row — it used to be
          absolutely positioned at -left-9, outside the page gutter, where a
          narrow window clipped it first. */}
      <div className="mb-5 flex items-center gap-2 sm:mb-7">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={t("cart.goBack")}
          className="hidden size-8 shrink-0 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-stone-100 hover:text-[#EA2831] sm:inline-flex"
        >
          <span className="material-symbols-outlined text-[22px]">arrow_back</span>
        </button>
        <h1 className="font-heading text-[22px] font-bold -tracking-[0.022em] text-stone-900 sm:text-2xl lg:text-[30px]">
          {t("cart.title", { count })}
        </h1>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3 lg:gap-6">

        <div className="space-y-3.5 lg:col-span-2">
          {items.map((it) => (
            <CartLine
              key={it.lineId || it.listingId}
              item={it}
              setQty={setQty}
              removeItem={removeItem}
              onSaveForLater={saveForLater}
              saved={isWishlisted(it.listingId, it.variantId)}
            />
          ))}

          {suggestions.length > 0 && (
            <div className="rounded-2xl border border-stone-200/80 bg-white p-4 sm:p-5">
              <h2 className="font-heading text-[15px] font-bold tracking-tight text-stone-900">{t("cart.missed")}</h2>

              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:gap-3.5">
                {suggestions.map((prod) => {
                  const sImg = getProductImage(prod.images?.[0]);
                  const sOff = prod.mrp && prod.mrp > prod.price
                    ? Math.round(((prod.mrp - prod.price) / prod.mrp) * 100)
                    : 0;

                  return (
                    <div key={prod.listingId} className="group flex flex-col overflow-hidden rounded-xl border border-stone-200/80 bg-white transition-colors hover:border-[#F3C6C8]">
                      <Link to={`/customer-shop/product/${prod.listingId}`} className="block aspect-[4/3] overflow-hidden bg-stone-100">
                        {sImg ? (
                          <img src={sImg} alt={prod.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-105" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-stone-300">
                            <span className="material-symbols-outlined text-3xl">eco</span>
                          </span>
                        )}
                      </Link>

                      <div className="flex flex-1 flex-col gap-1 p-2.5">
                        <Link to={`/customer-shop/product/${prod.listingId}`}>
                          <p className="line-clamp-2 min-h-[32px] text-[12px] font-semibold leading-[1.3] text-stone-900 transition-colors group-hover:text-[#EA2831]">
                            {prod.name}
                          </p>
                        </Link>
                        <div className="flex flex-wrap items-baseline gap-x-1.5">
                          <span className="font-heading text-[14px] font-bold text-stone-900">{rupee(prod.price)}</span>
                          {sOff > 0 && <span className="text-[10.5px] text-stone-400 line-through">{rupee(prod.mrp)}</span>}
                          {sOff > 0 && <span className="text-[10.5px] font-bold text-emerald-700">{t("common.percentOff", { percent: sOff })}</span>}
                        </div>

                        {/* This button was inert too — no handler at all. It adds
                            one to the cart, the same call every other Add to
                            cart on the storefront makes. */}
                        <button
                          type="button"
                          onClick={() => addItem(prod, 1)}
                          className="mt-auto w-full rounded-lg border border-[#EA2831] bg-[#EA2831] px-2.5 py-[9px] text-[11.5px] font-bold text-white transition-colors duration-300 hover:border-[#C91E26] hover:bg-[#C91E26]"
                        >
                          {t("common.addToCart")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Summary. Sticky on desktop so the total and the button stay put
            while the shopper works down a long cart. */}
        <div className="space-y-3.5 lg:sticky lg:top-20">
          <div className="rounded-2xl border border-stone-200/80 bg-white p-4 sm:p-5">
            <h2 className="border-b border-stone-100 pb-3 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-stone-400">
              {t("cart.priceDetails")}
            </h2>

            <div className="space-y-3 border-b border-stone-100 py-4 text-[13.5px]">
              <div className="flex justify-between text-stone-600">
                <span>{t("cart.priceCount", { count })}</span>
                <span className="font-semibold text-stone-900">{rupee(totalMrp)}</span>
              </div>
              {totalSavings > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>{t("cart.discount")}</span>
                  <span className="font-semibold">− {rupee(totalSavings)}</span>
                </div>
              )}
              <div className="flex justify-between text-stone-600">
                <span>{t("cart.deliveryCharges")}</span>
                <span className="font-semibold text-emerald-700">{t("cart.free")}</span>
              </div>
            </div>

            <div className="flex items-baseline justify-between pt-4">
              <span className="text-[14px] font-bold text-stone-900">{t("cart.totalAmount")}</span>
              <span className="font-heading text-[22px] font-extrabold text-stone-900">{rupee(grandTotal)}</span>
            </div>

            {totalSavings > 0 && (
              <p className="mt-3 rounded-lg bg-[#FDECEC] px-3 py-2 text-[12px] font-bold text-[#B3121A]">
                {t("cart.savings", { amount: rupee(totalSavings) })}
              </p>
            )}
          </div>

          <button
            onClick={() => navigate("/customer-shop/checkout")}
            className="w-full rounded-xl bg-[#EA2831] py-3.5 text-[13.5px] font-bold uppercase tracking-wide text-white transition-all duration-300 hover:bg-[#C91E26] active:scale-[0.99]"
          >
            {t("cart.placeOrder")}
          </button>
        </div>
      </div>
    </div>
  );
}