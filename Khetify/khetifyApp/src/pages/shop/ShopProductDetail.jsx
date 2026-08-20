import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getShopProduct, getShopProducts } from "../../lib/shopApi";
import { getProductImage } from "../../lib/productImage";
import { toBuyNowItem, setBuyNowItem } from "../../lib/buyNow";
import { useCart } from "../../context/CartContext";
import { useWishlist } from "../../context/WishlistContext";
import { rupee } from "../../Components/shop/ProductCard";
import { HomeProductCard } from "./ShopHome";

/* Product detail — real-marketplace UI. UI ONLY. Every existing action and data
   flow is preserved: getShopProduct(listingId) → product; quantity clamp
   [1, availableStock]; addItem(product, qty); Buy Now = buyNow item → checkout;
   image gallery (activeImg); back button; wishlist toggle (useWishlist);
   related products via getShopProducts({ category }). No API/business logic
   changed, and nothing is fabricated — every field is guarded. */

const Stars = ({ value = 0, size = "text-lg" }) => (
  <span className="inline-flex items-center gap-0.5 text-[#F0B429]">
    {[1, 2, 3, 4, 5].map((n) => (
      <span key={n} className={`material-symbols-outlined ${size}`} style={{ fontVariationSettings: n <= Math.round(value) ? "'FILL' 1" : "'FILL' 0" }}>
        star
      </span>
    ))}
  </span>
);

const Panel = ({ title, icon, children, className = "" }) => (
  <section className={`rounded-2xl bg-white p-5 ring-1 ring-stone-200/70 sm:p-6 ${className}`}>
    <h2 className="flex items-center gap-2 font-heading text-lg font-extrabold tracking-tight text-stone-900">
      {icon && <span className="material-symbols-outlined text-xl text-[#EA2831]">{icon}</span>}
      {title}
    </h2>
    <div className="mt-4">{children}</div>
  </section>
);

/* Compact trust strip — refined from the old four boxes. Used under the gallery
   on desktop (fills the empty space) and as a full-width band on smaller screens. */
const TRUST = [
  { icon: "local_shipping", title: "Delivered pan-India", sub: "To your doorstep" },
  { icon: "verified_user", title: "Verified seller", sub: "Vetted before listing" },
  { icon: "lock", title: "Secure checkout", sub: "Encrypted & protected" },
  { icon: "eco", title: "Farm-grade quality", sub: "Sourced for Indian farms" },
];

const TrustStrip = ({ className = "", variant = "grid" }) => {
  const list = variant === "list";
  return (
    <div className={`grid gap-px overflow-hidden rounded-2xl bg-stone-200/70 ring-1 ring-stone-200/70 ${list ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4"} ${className}`}>
      {TRUST.map((t) => (
        <div key={t.title} className={`bg-white p-3.5 ${list ? "flex items-center gap-3" : "flex flex-col items-start gap-2"}`}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-[#EA2831]">
            <span className="material-symbols-outlined text-[20px]">{t.icon}</span>
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-bold leading-tight text-stone-900">{t.title}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-stone-500">{t.sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default function ShopProductDetail() {
  const { listingId } = useParams();
  const navigate = useNavigate();
  const { addItem, items } = useCart();
  const { isWishlisted, toggleItem } = useWishlist();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [qty, setQty] = useState(1);
  const [activeImg, setActiveImg] = useState(0);
  const [descOpen, setDescOpen] = useState(false); // mobile "read more" (UI)
  const [related, setRelated] = useState([]);
  const [justAdded, setJustAdded] = useState(false); // add-to-cart feedback (UI)
  const addedTimer = useRef(null);
  const railRef = useRef(null);

  useEffect(() => () => clearTimeout(addedTimer.current), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setActiveImg(0);
    setJustAdded(false);
    window.scrollTo({ top: 0, behavior: "auto" });
    (async () => {
      try {
        const res = await getShopProduct(listingId);
        if (!alive) return;
        setProduct(res.data);
        setQty(1); // default cart quantity is always 1
      } catch (e) {
        if (alive) setError(e?.response?.data?.message || "Product not found");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [listingId]);

  // Similar products by category (existing API; additive, never blocks the page).
  useEffect(() => {
    if (!product?.category) { setRelated([]); return; }
    let alive = true;
    (async () => {
      try {
        const res = await getShopProducts({ category: product.category, limit: 20 });
        if (!alive) return;
        setRelated((res.data || []).filter((p) => p.listingId !== product.listingId));
      } catch { /* related is optional */ }
    })();
    return () => { alive = false; };
  }, [product?.category, product?.listingId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 pb-12 pt-5 sm:px-6">
        <div className="h-10 w-24 animate-pulse rounded-full bg-stone-100" />
        <div className="mt-5 grid gap-6 lg:grid-cols-2 lg:gap-10">
          <div className="aspect-square animate-pulse rounded-3xl bg-stone-100" />
          <div className="space-y-4">
            <div className="h-4 w-28 animate-pulse rounded bg-stone-100" />
            <div className="h-9 w-3/4 animate-pulse rounded bg-stone-100" />
            <div className="h-20 w-full animate-pulse rounded bg-stone-100" />
            <div className="h-24 w-full animate-pulse rounded-2xl bg-stone-100" />
            <div className="h-12 w-full animate-pulse rounded-xl bg-stone-100" />
          </div>
        </div>
      </div>
    );
  }
  if (error) return (
    <div className="py-20 text-center">
      <p className="font-heading text-[#EA2831]">{error}</p>
      <Link to="/customer-shop/products" className="mt-3 inline-block font-medium text-stone-700 hover:text-[#EA2831]">← Back to products</Link>
    </div>
  );

  const images = (product.images || []).map(getProductImage).filter(Boolean);
  const off = product.mrp && product.mrp > product.price
    ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0;
  const save = off > 0 ? Number(product.mrp) - Number(product.price) : 0;
  const inStock = product.inStock;
  const maxQty = inStock ? product.availableStock : 0;
  const lowStock = inStock && product.availableStock > 0 && product.availableStock <= 5;
  const wished = isWishlisted(product.listingId);

  // Cart membership is read from the existing cart state (keyed by listingId).
  const inCart = items.some((i) => i.listingId === product.listingId);
  const cartQty = items.find((i) => i.listingId === product.listingId)?.qty || 0;

  const rating = typeof product.rating === "number" ? product.rating
    : typeof product.averageRating === "number" ? product.averageRating : null;
  const reviewCount = product.reviewCount || product.numReviews || product.reviewsCount || 0;
  const reviews = Array.isArray(product.reviews) ? product.reviews : [];

  const descLong = (product.description || "").length > 90; // gate the mobile "Read more"
  const features = [product.features, product.keyFeatures, product.highlights].find(Array.isArray) || [];
  const usage = product.usage || product.usageInstructions || product.howToUse || "";

  const specs = [
    ["Category", product.category],
    ["Brand", product.brand],
    ["Brand owner", product.companyName],
    ["Unit", product.unit],
    ["SKU", product.sku],
    ["Available stock", inStock && product.availableStock ? `${product.availableStock} ${product.unit || "units"}` : null],
    ["GST", product.gstPercentage ? `${product.gstPercentage}%` : null],
    ["Sold by", product.seller?.name],
    ["Location", product.seller?.city ? `${product.seller.city}${product.seller.state ? ", " + product.seller.state : ""}` : null],
  ].filter(([, v]) => v != null && v !== "");

  // Same cart calls as before — only visual feedback is added around them.
  const addToCart = () => {
    addItem(product, qty);
    setJustAdded(true);
    clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setJustAdded(false), 1800);
  };
  // 🔧 Buy Now no longer pushes the product into the cart. It hands ONLY this
  //    product to checkout, so a shopper who wanted one item is charged for one
  //    item — and their existing cart is left completely untouched.
  const buyNow = () => {
    const stored = setBuyNowItem(toBuyNowItem(product, qty));
    if (stored) {
      navigate("/customer-shop/checkout?mode=buynow");
    } else {
      // sessionStorage unavailable (private mode) — fall back to the old
      // cart-based flow rather than dead-ending the shopper.
      addItem(product, qty);
      navigate("/customer-shop/checkout");
    }
  };

  // Add-to-cart button states: sold out → added (flash) → already in cart → add.
  const cartState = !inStock ? "sold" : justAdded ? "added" : inCart ? "incart" : "add";
  const cartBtn = {
    add: { icon: "add_shopping_cart", label: "Add to cart", cls: "border-2 border-[#EA2831] bg-white text-[#EA2831] hover:bg-red-50" },
    added: { icon: "check_circle", label: "Added to cart", cls: "border-2 border-[#EA2831] bg-[#EA2831] text-white" },
    incart: { icon: "check_circle", label: "Already in cart", cls: "border-2 border-red-200 bg-red-50 text-[#EA2831]" },
    sold: { icon: "block", label: "Sold out", cls: "border-2 border-stone-200 bg-white text-stone-400" },
  }[cartState];

  const actionButtons = (
    <>
      <button
        onClick={cartState === "add" || cartState === "incart" ? addToCart : undefined}
        disabled={cartState === "sold"}
        aria-live="polite"
        className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-all duration-300 disabled:cursor-not-allowed ${cartBtn.cls}`}
      >
        <span className="material-symbols-outlined text-lg">{cartBtn.icon}</span> {cartBtn.label}
      </button>
      <button
        onClick={buyNow}
        disabled={!inStock}
        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#EA2831] py-3.5 text-sm font-bold text-white shadow-lg shadow-[#EA2831]/20 transition-all hover:bg-[#c91e26] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none"
      >
        <span className="material-symbols-outlined text-lg">bolt</span> Buy now
      </button>
    </>
  );

  const scrollRail = (dir) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 240), behavior: "smooth" });
  };

  // First 10 similar products scroll horizontally; anything beyond that flows
  // into a normal grid underneath.
  const railItems = related.slice(0, 10);
  const gridItems = related.slice(10);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-6 lg:pb-14">
      {/* Back — text + arrow, matches the rest of the customer app */}
      <div className="mb-5 hidden sm:block">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="group inline-flex h-[42px] items-center gap-2 rounded-full border-[1.5px] border-stone-200 bg-white px-4 text-sm font-bold text-stone-800 transition-colors duration-150 hover:border-stone-300 hover:bg-stone-50 hover:text-[#EA2831]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-[19px] w-[19px] shrink-0 transition-transform duration-150 group-hover:-translate-x-0.5">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span className="leading-none">Back</span>
        </button>
      </div>

      {/* ── Top section ── */}
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
        {/* Gallery */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-3xl bg-transparent ring-0 sm:bg-stone-50 sm:ring-1 sm:ring-stone-200/70">
            {images.length ? (
              <img src={images[activeImg]} alt={product.name} className="h-full w-full object-contain p-6 sm:p-8" />
            ) : (
              <span className="material-symbols-outlined text-7xl font-light text-stone-300">inventory_2</span>
            )}
            {off > 0 && (
              <span className="absolute left-4 top-4 rounded-full bg-[#EA2831] px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-white shadow-sm">{off}% off</span>
            )}
            <button
              onClick={() => toggleItem(product)}
              aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
              className="absolute right-4 top-4 flex size-11 items-center justify-center rounded-full bg-white/90 shadow-sm ring-1 ring-stone-200/70 backdrop-blur transition-all hover:scale-110 active:scale-95"
            >
              <span className={`material-symbols-outlined text-2xl transition-colors ${wished ? "text-[#EA2831]" : "text-stone-400 hover:text-[#EA2831]"}`} style={{ fontVariationSettings: wished ? "'FILL' 1" : "'FILL' 0" }}>favorite</span>
            </button>
          </div>
          {images.length > 1 && (
            <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {images.map((src, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImg(i)}
                  className={`size-16 shrink-0 overflow-hidden rounded-xl bg-stone-50 ring-2 transition-all sm:size-[72px] ${i === activeImg ? "ring-[#EA2831]" : "ring-stone-200 hover:ring-stone-300"}`}
                >
                  <img src={src} alt="" className="h-full w-full object-contain p-1.5" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div>
          {product.category && (
            <p className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#EA2831]">
              <span className="material-symbols-outlined text-sm">eco</span> {product.category}
            </p>
          )}
          <h1 className="mt-2 font-heading text-2xl font-extrabold leading-tight tracking-tight text-stone-900 sm:text-[32px]">{product.name}</h1>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {rating != null ? (
              <span className="inline-flex items-center gap-1.5">
                <Stars value={rating} size="text-base" />
                <span className="font-semibold text-stone-700">{rating.toFixed(1)}</span>
                {reviewCount > 0 && <span className="text-stone-400">({reviewCount})</span>}
              </span>
            ) : (
              <span className="text-xs text-stone-400">No ratings yet</span>
            )}
            {product.sku && <span className="font-mono text-xs uppercase text-stone-400">SKU: {product.sku}</span>}
          </div>

          {product.description && (
            <div className="mt-3 max-w-prose">
              {/* Mobile: clamp to ~2 lines with Read more; desktop shows it all.
                  The toggle only appears when the text is actually long. */}
              <p className={`whitespace-pre-line text-[14px] leading-relaxed text-stone-600 sm:line-clamp-none ${descLong && !descOpen ? "line-clamp-2" : ""}`}>
                {product.description}
              </p>
              {descLong && (
                <button
                  type="button"
                  onClick={() => setDescOpen((o) => !o)}
                  className="mt-1 text-xs font-bold text-[#EA2831] hover:underline sm:hidden"
                >
                  {descOpen ? "Read less" : "Read more"}
                </button>
              )}
            </div>
          )}

          {/* Price */}
          <div className="mt-5 rounded-2xl bg-stone-50 p-4 ring-1 ring-stone-200/60 sm:p-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-heading text-3xl font-extrabold text-stone-900 sm:text-4xl">{rupee(product.price)}</span>
              {off > 0 && <span className="text-lg text-stone-400 line-through">{rupee(product.mrp)}</span>}
              {off > 0 && <span className="rounded-md bg-red-100 px-2 py-0.5 text-sm font-bold text-[#EA2831]">{off}% off</span>}
              {product.unit && <span className="text-sm text-stone-400">/ {product.unit}</span>}
            </div>
            {save > 0 && <p className="mt-1.5 text-sm font-semibold text-emerald-700">You save {rupee(save)}</p>}
            {product.gstPercentage > 0 && <p className="mt-1 text-xs text-stone-400">+ {product.gstPercentage}% GST at checkout</p>}
          </div>

          {/* Stock + seller + brand */}
          <div className="mt-4 space-y-2 text-sm">
            {inStock ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                <span className="material-symbols-outlined text-lg">check_circle</span>
                In stock
                {lowStock && <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">Only {product.availableStock} left</span>}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#EA2831]">
                <span className="material-symbols-outlined text-lg">block</span> Out of stock
              </span>
            )}
            {product.seller?.name && (
              <p className="flex flex-wrap items-center gap-1.5 text-stone-500">
                <span className="material-symbols-outlined text-base text-[#023020]">verified</span>
                Sold by <span className="font-semibold text-stone-700">{product.seller.name}</span>
                {product.seller.city ? ` · ${product.seller.city}${product.seller.state ? ", " + product.seller.state : ""}` : ""}
              </p>
            )}
            {product.brand && <p className="text-stone-500">Brand: <span className="font-medium text-stone-700">{product.brand}</span></p>}
          </div>

          {/* Quantity */}
          {inStock && (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-stone-700">Quantity</span>
              <div className="inline-flex items-center overflow-hidden rounded-xl border border-stone-200 bg-white">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease" className="flex size-10 items-center justify-center text-stone-600 transition-colors hover:bg-stone-100 hover:text-[#EA2831]">
                  <span className="material-symbols-outlined">remove</span>
                </button>
                <span className="w-12 text-center text-base font-bold text-stone-900">{qty}</span>
                <button onClick={() => setQty((q) => Math.min(maxQty, q + 1))} disabled={qty >= maxQty} aria-label="Increase" className="flex size-10 items-center justify-center text-stone-600 transition-colors hover:bg-stone-100 hover:text-[#EA2831] disabled:text-stone-300 disabled:hover:bg-transparent">
                  <span className="material-symbols-outlined">add</span>
                </button>
              </div>
              {/* {maxQty > 0 && <span className="text-xs text-stone-400">Max {maxQty} per order</span>} */}
            </div>
          )}

          {/* Cart status line — tells the shopper what's already in their cart */}
          {inCart && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-[#EA2831]">
              <span className="material-symbols-outlined text-base">shopping_cart</span>
              {cartQty} {cartQty === 1 ? "unit" : "units"} already in your cart
              <Link to="/customer-shop/cart" className="underline underline-offset-2 hover:text-[#c91e26]">View cart</Link>
            </p>
          )}

          {/* Actions (desktop inline; mobile uses the sticky bar below) */}
          <div className="mt-6 hidden gap-3 lg:flex">{actionButtons}</div>
        </div>
      </div>

      {/* Trust band — full width across the page, under the product section. */}
      <TrustStrip className="mt-8" />

      {/* ── Detailed information ── */}
      {(features.length > 0 || specs.length > 0 || usage) && (
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {features.length > 0 && (
            <Panel title="Key features" icon="checklist" className={specs.length === 0 ? "lg:col-span-2" : ""}>
              <ul className="space-y-2.5">
                {features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-stone-600">
                    <span className="material-symbols-outlined mt-0.5 text-base text-emerald-600">check_circle</span>
                    <span>{typeof f === "string" ? f : f?.label || f?.name}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {specs.length > 0 && (
            <Panel title="Specifications" icon="list_alt" className={features.length === 0 ? "lg:col-span-2" : ""}>
              <dl className={features.length === 0 ? "grid gap-x-10 sm:grid-cols-2" : ""}>
                {specs.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 border-b border-stone-100 py-2.5 text-sm last:border-0">
                    <dt className="text-stone-500">{label}</dt>
                    <dd className="text-right font-semibold capitalize text-stone-800">{value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          )}

          {usage && (
            <Panel title="Usage information" icon="menu_book" className="lg:col-span-2">
              <p className="whitespace-pre-line text-sm leading-relaxed text-stone-600">{usage}</p>
            </Panel>
          )}
        </div>
      )}

      {/* ── Reviews ── */}
      <div className="mt-5">
        <Panel title="Ratings & reviews" icon="reviews">
          {rating != null ? (
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div className="text-center">
                <p className="font-heading text-4xl font-extrabold text-stone-900">{rating.toFixed(1)}</p>
                <Stars value={rating} />
                {reviewCount > 0 && <p className="mt-1 text-xs text-stone-400">{reviewCount} rating{reviewCount === 1 ? "" : "s"}</p>}
              </div>
              {reviews.length > 0 && (
                <ul className="min-w-0 flex-1 space-y-3 sm:border-l sm:border-stone-100 sm:pl-8">
                  {reviews.slice(0, 4).map((r, i) => (
                    <li key={i}>
                      <div className="flex items-center gap-2">
                        <Stars value={r.rating || 0} size="text-base" />
                        {r.author || r.name ? <span className="text-sm font-semibold text-stone-800">{r.author || r.name}</span> : null}
                      </div>
                      {(r.comment || r.text) && <p className="mt-1 text-sm text-stone-600">{r.comment || r.text}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-stone-50 text-stone-300">
                <span className="material-symbols-outlined text-2xl">reviews</span>
              </span>
              <p className="text-sm text-stone-500">No reviews yet — be the first to try this product.</p>
            </div>
          )}
        </Panel>
      </div>

      {/* ── Similar products: 10 in a horizontal rail, the rest flow below ── */}
      {related.length > 0 && (
        <section className="mt-12">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-[#EA2831]">
                <span className="material-symbols-outlined text-sm">eco</span> You may also like
              </p>
              <h2 className="mt-1 font-heading text-2xl font-extrabold tracking-tight text-stone-900 sm:text-3xl">Similar products</h2>
            </div>
            {/* Rail arrows — only when the rail actually overflows (more items
                than fit in one view). Otherwise they'd do nothing. */}
            {railItems.length > 4 && (
            <div className="hidden shrink-0 gap-2 sm:flex">
              <button onClick={() => scrollRail(-1)} aria-label="Scroll left" className="flex size-10 items-center justify-center rounded-full bg-white text-stone-600 ring-1 ring-stone-200 transition-colors hover:text-[#EA2831] hover:ring-[#EA2831]">
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <button onClick={() => scrollRail(1)} aria-label="Scroll right" className="flex size-10 items-center justify-center rounded-full bg-white text-stone-600 ring-1 ring-stone-200 transition-colors hover:text-[#EA2831] hover:ring-[#EA2831]">
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>
            )}
          </div>

          <div
            ref={railRef}
            className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {railItems.map((p) => (
              <div key={p.listingId} className="w-[46%] shrink-0 snap-start sm:w-[31%] lg:w-[23%]">
                <HomeProductCard product={p} />
              </div>
            ))}
          </div>

          {gridItems.length > 0 && (
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {gridItems.map((p) => <HomeProductCard key={p.listingId} product={p} />)}
            </div>
          )}
        </section>
      )}

      {/* ── Sticky action bar (phone/tablet). On phones it sits ABOVE the app's
             bottom navigation bar so the buttons are never hidden behind it. ── */}
      <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 flex gap-3 border-t border-stone-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-16px_rgba(20,32,26,0.4)] backdrop-blur md:bottom-0 lg:hidden">
        {actionButtons}
      </div>
    </div>
  );
}