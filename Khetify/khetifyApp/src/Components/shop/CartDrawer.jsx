import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "../../context/CartContext";
import { getProductImage } from "../../lib/productImage";
import { rupee } from "./ProductCard";

/* Slide-in cart drawer (softly animates from the right). UI ONLY — it reads
   and calls the SAME cart context: useCart() → { items, setQty, removeItem,
   subtotal, count }. It changes nothing about cart logic; it just gives a
   quick "peek" of the bag with a "View cart" button that opens the existing
   full cart page, plus a checkout action. Kept mounted so both open and close
   animate; controlled via `open` / `onClose`. */
export default function CartDrawer({ open, onClose }) {
  const { items, setQty, removeItem, subtotal, count } = useCart();
  const navigate = useNavigate();

  // Guarded savings — only from real line mrp (never fabricated).
  const savings = items.reduce(
    (s, it) => s + (it.mrp && it.mrp > it.price ? (it.mrp - it.price) * it.qty : 0),
    0
  );

  // Lock background scroll + close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const go = (path) => { onClose(); navigate(path); };

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-[#14201A]/40 backdrop-blur-[1px] transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Your cart"
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-stone-200 px-4 py-3.5 sm:px-5">
          <button onClick={onClose} aria-label="Close cart" className="flex size-9 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-stone-100">
            <span className="material-symbols-outlined text-2xl">close</span>
          </button>
          <h2 className="font-heading text-lg font-extrabold tracking-tight text-stone-900">
            Cart <span className="ml-1 text-sm font-semibold text-stone-400">{count} {count === 1 ? "item" : "items"}</span>
          </h2>
        </div>

        {items.length === 0 ? (
          /* Empty */
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-stone-50 text-stone-300">
              <span className="material-symbols-outlined text-4xl font-light">shopping_cart</span>
            </span>
            <p className="mt-4 font-heading text-base font-bold text-stone-900">Your cart is empty</p>
            <p className="mt-1 text-sm text-stone-500">Add products to see them here.</p>
            <button onClick={() => go("/customer-shop/products")} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#EA2831] px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-[#c91e26]">
              <span className="material-symbols-outlined text-lg">storefront</span> Browse products
            </button>
          </div>
        ) : (
          <>
            {/* Items (scrollable) */}
            <div className="flex-1 divide-y divide-stone-100 overflow-y-auto px-4 sm:px-5">
              {items.map((it) => {
                const img = getProductImage(it.image);
                const href = `/customer-shop/product/${it.listingId}`;
                const off = it.mrp && it.mrp > it.price ? Math.round(((it.mrp - it.price) / it.mrp) * 100) : 0;
                const atMax = Number.isFinite(it.availableStock) && it.availableStock > 0 && it.qty >= it.availableStock;
                return (
                  <div key={it.listingId} className="flex gap-3 py-4">
                    <button onClick={() => go(href)} className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-emerald-50/40 via-stone-50 to-stone-100/70 ring-1 ring-stone-100">
                      {img ? <img src={img} alt={it.name} className="h-full w-full object-contain p-1.5" /> : <span className="material-symbols-outlined text-3xl font-light text-stone-300">eco</span>}
                    </button>

                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => go(href)} className="text-left font-heading text-sm font-bold leading-snug text-stone-900 line-clamp-2 hover:text-[#EA2831]">
                          {it.name}
                        </button>
                        <button onClick={() => removeItem(it.listingId)} aria-label="Remove" className="flex size-7 shrink-0 items-center justify-center rounded-md text-stone-300 transition-colors hover:bg-red-50 hover:text-[#EA2831]">
                          <span className="material-symbols-outlined text-lg">close</span>
                        </button>
                      </div>

                      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-bold text-stone-900">{rupee(it.price * it.qty)}</span>
                        {off > 0 && <span className="text-[11px] text-stone-400 line-through">{rupee(it.mrp * it.qty)}</span>}
                        {off > 0 && <span className="text-[11px] font-bold text-emerald-600">{off}% off</span>}
                      </div>

                      <div className="mt-auto pt-2">
                        <div className="inline-flex items-center overflow-hidden rounded-lg border border-stone-200 bg-white">
                          <button onClick={() => setQty(it.listingId, it.qty - 1)} aria-label="Decrease" className="flex size-7 items-center justify-center text-stone-600 transition-colors hover:bg-stone-100 hover:text-[#EA2831]">
                            <span className="material-symbols-outlined text-base">remove</span>
                          </button>
                          <span className="w-8 text-center text-xs font-bold text-stone-900">{it.qty}</span>
                          <button onClick={() => setQty(it.listingId, it.qty + 1)} disabled={atMax} aria-label="Increase" className="flex size-7 items-center justify-center text-stone-600 transition-colors hover:bg-stone-100 hover:text-[#EA2831] disabled:text-stone-300">
                            <span className="material-symbols-outlined text-base">add</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-stone-200 bg-white px-4 py-4 sm:px-5">
              {savings > 0 && (
                <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
                  <span className="material-symbols-outlined text-base">check_circle</span>
                  You saved {rupee(savings)} on this order
                </p>
              )}
              <div className="mb-3 flex items-baseline justify-between">
                <span className="font-heading text-sm font-bold text-stone-900">You pay</span>
                <span className="font-heading text-xl font-extrabold text-stone-900">{rupee(subtotal)}</span>
              </div>
              <button
                onClick={() => go("/customer-shop/checkout")}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#EA2831] py-3.5 text-sm font-bold text-white shadow-lg shadow-[#EA2831]/20 transition-all hover:bg-[#c91e26] active:scale-[0.99]"
              >
                <span className="material-symbols-outlined text-lg">lock</span> Proceed to checkout
              </button>
              <button
                onClick={() => go("/customer-shop/cart")}
                className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 py-3 text-sm font-bold text-stone-700 transition-colors hover:border-[#EA2831] hover:text-[#EA2831]"
              >
                View cart
                <span className="material-symbols-outlined text-lg">arrow_forward</span>
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}