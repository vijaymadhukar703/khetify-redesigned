import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWishlist } from "../../context/WishlistContext";
import { useT } from "../../context/ShopLanguageContext";
import { useCart } from "../../context/CartContext";
import { getProductImage } from "../../lib/productImage";
import { rupee } from "../../Components/shop/ProductCard";

/* Khetify wishlist — wired to the real client-side wishlist (useWishlist) and
   cart (useCart). No business logic here: "Add to cart" reuses addItem,
   "Remove" uses removeItem, and membership is read from the cart. Rendered
   inside ShopLayout, so the header and footer are already provided.

   ── STYLED AS THE HOME PAGE, NOT AS ITS OWN THING ──
   This page carried twelve colours the rest of the storefront does not use —
   its own ink (#14201A against the home page's #16191B), its own greys, its
   own greens, its own borders. Three near-identical off-blacks is not a theme,
   it is three people guessing. Everything below now draws from the same short
   palette the home page uses: #EA2831 / #C91E26 for action, #FDECEC and
   #F5F4EF for tinted surfaces, #16191B for ink, and Tailwind's stone ramp for
   everything muted. The card is deliberately the same shape as the home
   page's, down to the 4:3 crop, so a product looks like itself wherever the
   shopper meets it. */

/* Inline icons — self-contained, no icon-font dependency for the critical few. */
const Icon = {
  Heart: ({ filled, ...p }) => (
    <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  ),
  Cart: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
    </svg>
  ),
  Check: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 6L9 17l-5-5" /></svg>
  ),
  CheckCircle: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>
  ),
  ArrowLeft: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M15 18l-6-6 6-6" /></svg>
  ),
};

function WishlistCard({ product, inCart, onAddToCart, onRemove }) {
  const t = useT();
  /* THE SAVED VARIANT WINS. The shopper saved Red, so the card must show Red's
     picture and Red's price — the product's defaults would be a different item
     from the one they saved. All three fall back to the product when nothing
     variant-specific was stored, which is every pre-existing entry. */
  const img = getProductImage(product.variantImage || product.images?.[0]);
  const price = product.variantPrice != null ? product.variantPrice : product.price;
  // The link carries the variant, so opening it reopens the saved option.
  const href = `/customer-shop/product/${product.listingId}${product.variantId ? `?variant=${product.variantId}` : ""}`;
  const seller = product.seller?.name || product.sellerName;
  const inStock = product.inStock;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-stone-200/80 bg-white transition-all duration-500 hover:border-[#F3C6C8] hover:shadow-[0_22px_42px_-26px_rgba(22,25,27,0.45)] motion-safe:hover:-translate-y-1">
      {/* 4:3, matching the home page's cards — a square crop is the tallest
          thing in the tile and buys no extra legibility at this width. */}
      <Link to={href} className="relative block aspect-[4/3] overflow-hidden bg-stone-100">
        {img ? (
          <img
            src={img}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-[850ms] ease-[cubic-bezier(.22,1,.36,1)] motion-safe:group-hover:scale-[1.08]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-stone-300">
            <span className="material-symbols-outlined text-5xl font-light">eco</span>
          </span>
        )}
        {!inStock && (
          <span className="absolute inset-x-0 bottom-0 bg-[#16191B]/85 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-white">
            {t("wishlist.unavailable")}
          </span>
        )}
      </Link>

      {/* The heart REMOVES here — it is not a toggle. Everything on this page is
          already saved, so a hollow/filled state would be a control with one
          reachable value. Filled red, and pressing it takes the item away. */}
      <button
        type="button"
        aria-label={t("wishlist.remove")}
        title={t("wishlist.remove")}
        onClick={() => onRemove(product.wishId || product.listingId)}
        className="absolute right-2.5 top-2.5 z-10 flex size-[30px] items-center justify-center rounded-full border border-stone-200 bg-white/95 text-[#EA2831] transition-all duration-300 hover:scale-110 hover:border-[#F3C6C8] hover:bg-[#FDECEC] active:scale-90"
      >
        <Icon.Heart filled className="h-[15px] w-[15px]" />
      </button>

      <div className="flex flex-1 flex-col gap-1 p-2.5">
        {product.category && (
          <span className="truncate text-[10px] font-extrabold uppercase tracking-[0.13em] text-stone-400">
            {product.category}
          </span>
        )}

        <Link to={href} className="block">
          <h3 className="line-clamp-2 min-h-[32px] text-[12.5px] font-semibold leading-[1.3] text-stone-900 transition-colors group-hover:text-[#EA2831]">
            {product.name}
          </h3>
        </Link>

        {product.variantLabel && (
          <span className="w-fit rounded bg-[#F5F4EF] px-2 py-0.5 text-[10.5px] font-semibold text-stone-600">
            {product.variantLabel}
          </span>
        )}

        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-heading text-[15.5px] font-bold text-stone-900">{rupee(price)}</span>
          {product.unit && <span className="text-[10.5px] text-stone-400">/ {product.unit}</span>}
        </div>

        <div className="flex h-[15px] items-center gap-2 overflow-hidden text-[10.5px] text-stone-500">
          {inStock ? (
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-bold text-emerald-700">
              <Icon.CheckCircle className="h-3 w-3" /> {t("wishlist.inStock")}
            </span>
          ) : (
            <span className="shrink-0 whitespace-nowrap text-stone-400">{t("wishlist.unavailable")}</span>
          )}
          {/* The seller NAME is data — interpolated, never translated. */}
          {seller && <span className="truncate">{t("wishlist.soldBy", { seller })}</span>}
        </div>

        <div className="mt-auto pt-1.5">
          {inCart ? (
            <span className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#F3C6C8] bg-[#FDECEC] px-2.5 py-[9px] text-[11.5px] font-bold text-[#B3121A]">
              <Icon.Check className="h-3.5 w-3.5" />
              {t("wishlist.alreadyInCart")}
            </span>
          ) : inStock ? (
            <button
              type="button"
              onClick={() => onAddToCart(product)}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#EA2831] bg-[#EA2831] px-2.5 py-[9px] text-[11.5px] font-bold text-white transition-all duration-300 hover:border-[#C91E26] hover:bg-[#C91E26] active:scale-[0.97]"
            >
              <Icon.Cart className="h-3.5 w-3.5" />
              {t("wishlist.addToCart")}
            </button>
          ) : (
            <span className="inline-flex w-full items-center justify-center rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-[9px] text-[11.5px] font-bold text-stone-400">
              {t("common.soldOut")}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function EmptyWishlist() {
  const t = useT();
  return (
    <div className="rounded-[20px] bg-[#F5F4EF] px-6 py-16 text-center">
      <span className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-white text-[#EA2831]">
        <Icon.Heart className="h-7 w-7" />
      </span>
      <h2 className="font-heading text-xl font-bold tracking-tight text-stone-900 sm:text-2xl">{t("wishlist.empty")}</h2>
      <p className="mx-auto mt-2 max-w-[46ch] text-[13.5px] leading-relaxed text-stone-500">{t("wishlist.emptySub")}</p>
      <Link
        to="/customer-shop/products"
        className="mt-6 inline-flex items-center gap-1.5 rounded-[10px] bg-[#EA2831] px-5 py-2.5 text-[13px] font-bold text-white transition-colors duration-300 hover:bg-[#C91E26]"
      >
        {t("wishlist.browse")}
        <span className="material-symbols-outlined text-[17px]">arrow_forward</span>
      </Link>
    </div>
  );
}

export default function ShopWishlist() {
  const { items, removeItem } = useWishlist();
  const t = useT();
  const { addItem, items: cartItems } = useCart();
  const navigate = useNavigate();

  /* A wishlist entry maps to ONE cart line — the same variant, at the same key
     the cart uses. Saving Red must not report "already in cart" because Green
     happens to be in there. */
  const lineIdOf = (p) => (p.variantId ? `${p.listingId}::${p.variantId}` : String(p.listingId));
  const inCart = (p) => cartItems.some((c) => (c.lineId || c.listingId) === lineIdOf(p));
  // Rebuild the variant from the snapshot stored on the entry, so the cart line
  // gets its price, image and attributes — not the product's defaults.
  const variantOf = (p) => (p.variantId
    ? { id: p.variantId, label: p.variantLabel, attributes: p.variantAttributes, image: p.variantImage, mrp: p.variantPrice }
    : null);
  const addToCart = (product) => addItem(product, 1, variantOf(product));
  const addAllToCart = () => {
    items.forEach((p) => { if (p.inStock && !inCart(p)) addItem(p, 1, variantOf(p)); });
    navigate("/customer-shop/cart");
  };

  return (
    <div className="mx-auto w-full max-w-[1360px] px-3 py-6 sm:px-6 lg:px-8 lg:py-10">

      {/* Page head — eyebrow, heading, count on the left; the two actions on
          the right, where they were.

          The back control is an icon button INSIDE the row rather than the
          absolutely-positioned one that used to hang at -left-9: at that offset
          it sat outside the page gutter and was the first thing to be clipped
          on a narrow window. Here it simply sits before the badge. */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4 sm:mb-7">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label={t("wishlist.continueShopping")}
              className="hidden size-7 shrink-0 items-center justify-center rounded-full text-stone-500 transition-colors duration-150 hover:bg-stone-100 hover:text-[#EA2831] sm:inline-flex"
            >
              <Icon.ArrowLeft className="h-[17px] w-[17px]" />
            </button>
            <p className="inline-flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.2em] text-[#EA2831]">
              <Icon.Heart filled className="h-3 w-3" />
              {t("wishlist.badge")}
            </p>
          </div>

          <h1 className="mt-1.5 font-heading text-[22px] font-bold -tracking-[0.022em] text-stone-900 sm:text-2xl lg:text-[30px]">
            {t("wishlist.title")}
          </h1>
          <p className="mt-1.5 text-[13px] text-stone-500">
            {t(items.length === 1 ? "wishlist.savedCount" : "wishlist.savedCountPlural", { count: items.length })}
          </p>
        </div>

        {items.length > 0 && (
          <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:flex-wrap">
            <Link
              to="/customer-shop/products"
              className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-stone-200 bg-white px-5 py-3 text-[12.5px] font-bold text-stone-900 transition-colors duration-300 hover:border-[#EA2831] hover:text-[#EA2831] sm:w-auto"
            >
              <Icon.ArrowLeft className="h-[15px] w-[15px]" />
              {t("wishlist.continueShopping")}
            </Link>
            <button
              type="button"
              onClick={addAllToCart}
              className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-[#16191B] px-5 py-3 text-[12.5px] font-bold text-white transition-colors duration-300 hover:bg-[#EA2831] sm:w-auto"
            >
              <Icon.Cart className="h-[15px] w-[15px]" />
              {t("wishlist.addAll")}
            </button>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyWishlist />
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 lg:gap-3.5">
          {items.map((product) => (
            <WishlistCard
              key={product.wishId || product.listingId}
              product={product}
              inCart={inCart(product)}
              onAddToCart={addToCart}
              onRemove={removeItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}