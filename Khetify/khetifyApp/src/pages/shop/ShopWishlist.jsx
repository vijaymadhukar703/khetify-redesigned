import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWishlist } from "../../context/WishlistContext";
import { useCart } from "../../context/CartContext";
import { getProductImage } from "../../lib/productImage";
import { rupee } from "../../Components/shop/ProductCard";

/* Khetify wishlist page — UI matches the shared reference design, wired to the
   real client-side wishlist (useWishlist) and cart (useCart). No new business
   logic: "Add to cart" reuses cart.addItem(product, 1); "Remove" uses
   wishlist.removeItem; membership ("Already in cart") is read from the cart.
   This page renders inside ShopLayout, so the storefront header/footer are
   already provided — we only render the page body. */

/* Inline icons (self-contained, no icon-font dependency) */
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
  ArrowUpRight: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" {...p}><path d="M7 17L17 7" /><path d="M8 7h9v9" /></svg>
  ),
};

function WishlistCard({ product, inCart, onAddToCart, onRemove }) {
  const img = getProductImage(product.images?.[0]);
  const href = `/customer-shop/product/${product.listingId}`;
  const seller = product.seller?.name || product.sellerName;
  const inStock = product.inStock;

  return (
    <article className="flex flex-col overflow-hidden rounded-[20px] border border-[#ECEAE1] bg-white transition-all duration-200 hover:-translate-y-[3px] hover:shadow-[0_16px_36px_rgba(20,32,26,0.10)]">
      <div className="relative h-[190px] bg-[#F0EFE8]">
        <Link to={href} className="block h-full w-full">
          {img ? (
            <img src={img} alt={product.name} className="h-full w-full object-contain p-3" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-stone-300">
              <span className="material-symbols-outlined text-5xl font-light">eco</span>
            </span>
          )}
        </Link>
        <button
          type="button"
          aria-label="Remove from wishlist"
          title="Remove from wishlist"
          onClick={() => onRemove(product.listingId)}
          className="absolute right-3 top-3 inline-flex h-[38px] w-[38px] items-center justify-center rounded-full bg-white/95 text-[#EA2831] shadow-[0_4px_12px_rgba(20,32,26,0.14)] transition-all hover:scale-110 hover:bg-[#FFF1F2]"
        >
          <Icon.Heart filled className="h-[17px] w-[17px]" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-[18px] pb-5">
        {product.category && (
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#EA2831]">
            <Icon.ArrowUpRight className="h-2.5 w-2.5" />
            {product.category}
          </p>
        )}
        <Link to={href}>
          <h3 className="font-heading text-lg font-bold leading-tight tracking-tight text-[#14201A] line-clamp-2 hover:text-[#EA2831]">
            {product.name}
          </h3>
        </Link>
        <div className="flex items-baseline gap-2">
          <span className="font-heading text-[21px] font-extrabold text-[#14201A]">{rupee(product.price)}</span>
          {product.unit && <span className="text-[13px] text-[#9B9A92]">/ {product.unit}</span>}
        </div>
        <p className="flex items-center gap-1.5 text-[13px] font-semibold">
          {inStock ? (
            <span className="flex items-center gap-1.5 text-[#2E6B3E]">
              <Icon.CheckCircle className="h-[13px] w-[13px]" /> In stock
            </span>
          ) : (
            <span className="text-stone-400">Currently unavailable</span>
          )}
          {seller && <span className="font-normal text-[#9B9A92]">· sold by {seller}</span>}
        </p>

        <div className="mt-auto pt-2.5">
          {inCart ? (
            <span className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#E9F2EA] text-sm font-bold text-[#2E6B3E]">
              <Icon.Check className="h-[15px] w-[15px]" />
              Already in cart
            </span>
          ) : inStock ? (
            <button
              type="button"
              onClick={() => onAddToCart(product)}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#EA2831] text-sm font-bold text-white transition-all hover:-translate-y-px hover:bg-[#c91e26] hover:shadow-[0_8px_18px_rgba(234,40,49,0.25)] active:translate-y-0"
            >
              <Icon.Cart className="h-[15px] w-[15px]" />
              Add to cart
            </button>
          ) : (
            <span className="inline-flex h-11 w-full items-center justify-center rounded-full bg-stone-100 text-sm font-bold text-stone-400">
              Sold out
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function EmptyWishlist() {
  return (
    <div className="rounded-3xl border-[1.5px] border-dashed border-[#E2E0D6] bg-white px-6 py-[72px] text-center">
      <span className="mb-[18px] inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#FFF1F2]">
        <Icon.Heart className="h-7 w-7 text-[#EA2831]" />
      </span>
      <h2 className="mb-2 font-heading text-2xl font-bold text-[#14201A]">Your wishlist is empty</h2>
      <p className="mb-6 text-[15px] text-[#6B6A62]">Tap the heart on any product to save it here for later.</p>
      <Link to="/customer-shop/products" className="inline-flex h-12 items-center rounded-full bg-[#EA2831] px-7 text-[15px] font-bold text-white transition-colors hover:bg-[#c91e26]">
        Browse products
      </Link>
    </div>
  );
}

export default function ShopWishlist() {
  const { items, removeItem } = useWishlist();
  const { addItem, items: cartItems } = useCart();
  const navigate = useNavigate();

  const inCart = (listingId) => cartItems.some((c) => c.listingId === listingId);
  const addToCart = (product) => addItem(product, 1);
  const addAllToCart = () => {
    items.forEach((p) => { if (p.inStock && !inCart(p.listingId)) addItem(p, 1); });
    navigate("/customer-shop/cart");
  };

  return (
    <div className="min-h-[70vh] bg-[#F5F4EF]">
      <main className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-8 sm:py-12">
        
        {/* Page head */}
        {/* Page head */}
<div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
  
  {/* 🛠️ Consistent Header Container (sm:pl-36) */}
  <div className="min-w-0 pt-2 sm:pl-2">
    
    {/* Saved For Later Badge + Back Arrow */}
    <div className="relative flex items-center gap-2">
      
      {/* 1. Back Arrow Button: Icon-only, textless, absolute floating at -left-9 */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Go back"
        className="no-print hidden sm:inline-flex absolute -left-9 shrink-0 items-center justify-center text-[#14201A] transition-colors duration-150 hover:text-[#EA2831]"
      >
        <span className="material-symbols-outlined text-[24px] font-bold leading-none">
          arrow_back
        </span>
      </button>

      {/* Badge Text */}
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[#EA2831]">
        <Icon.Heart filled className="h-[13px] w-[13px]" />
        Saved for later
      </p>
    </div>
            <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-[#14201A] sm:text-[40px]">
              Your wishlist
            </h1>
            <p className="mt-2 text-[15px] text-[#6B6A62]">
              {items.length} {items.length === 1 ? "item" : "items"} saved — add them to your cart before they sell out.
            </p>
          </div>

          {items.length > 0 && (
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap">
              <Link
                to="/customer-shop/products"
                className="inline-flex h-[46px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-full border-[1.5px] border-[#E2E0D6] bg-white px-[22px] text-sm font-bold text-[#14201A] transition-colors hover:border-[#C9C7BB] hover:bg-[#FBFAF6] sm:w-auto"
              >
                <Icon.ArrowLeft className="h-[15px] w-[15px]" />
                Continue shopping
              </Link>
              <button
                type="button"
                onClick={addAllToCart}
                className="inline-flex h-[46px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#14201A] px-6 text-sm font-bold text-white transition-all hover:-translate-y-px hover:bg-[#223528] active:translate-y-0 sm:w-auto"
              >
                <Icon.Cart className="h-[15px] w-[15px]" />
                Add all to cart
              </button>
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <EmptyWishlist />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-[22px] xl:grid-cols-4">
            {items.map((product) => (
              <WishlistCard
                key={product.listingId}
                product={product}
                inCart={inCart(product.listingId)}
                onAddToCart={addToCart}
                onRemove={removeItem}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}