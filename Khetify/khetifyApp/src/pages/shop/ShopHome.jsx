import React, { useCallback, useEffect, useRef, useState, memo } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { getShopProducts, getShopCategories } from "../../lib/shopApi";
import { getProductImage } from "../../lib/productImage";
import { useCart } from "../../context/CartContext";
import { useWishlist } from "../../context/WishlistContext";

/* ────────────────────────────────────────────────────────────────
   Khetify Bazaar storefront home — a farming marketplace.
   Data flow is UNCHANGED: on mount it fetches the latest products +
   categories via Promise.all into the same four pieces of state.
   Everything below the useEffect is presentation only; add-to-cart
   uses the same useCart().addItem the shared ProductCard uses.
   System: field-green ink (#14201A) + Khetify red (#EA2831) accents,
   fresh emerald cues, Sora display / Manrope body, Material Symbols.
──────────────────────────────────────────────────────────────── */

const HERO_IMG =
  "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1600&q=80";

const rupee = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export const catIcon = (name = "") => {
  const k = String(name).toLowerCase();
  if (k.includes("seed")) return "grass";
  if (k.includes("fertil") || k.includes("manure") || k.includes("compost")) return "science";
  if (k.includes("pest") || k.includes("insect") || k.includes("herbi")) return "pest_control";
  if (k.includes("tool") || k.includes("equip") || k.includes("machine")) return "handyman";
  if (k.includes("irrigat") || k.includes("water") || k.includes("pump")) return "water_drop";
  if (k.includes("fruit") || k.includes("veg") || k.includes("produce")) return "nutrition";
  if (k.includes("dairy") || k.includes("cattle") || k.includes("live")) return "pets";
  if (k.includes("grain") || k.includes("crop") || k.includes("harvest")) return "agriculture";
  return "eco";
};

/* ── Add-to-cart button with success feedback + "already in cart" state.
   UI-only wrapper around the SAME useCart().addItem(product, 1) call — no
   cart logic changes. Membership is derived by reading the existing cart
   `items` (keyed by listingId). States: add → added (transient flash) →
   already-in-cart (disabled); plus sold-out. Smooth colour/scale transition. ── */
const AddToCartButton = memo(function AddToCartButton({ product, size = "md", className = "" }) {
  const { addItem, items } = useCart();
  const [justAdded, setJustAdded] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const inStock = product.inStock;
  const inCart = items.some((i) => i.listingId === product.listingId);
  const state = justAdded ? "added" : !inStock ? "sold" : inCart ? "incart" : "add";

  const handleAdd = () => {
    addItem(product, 1); // unchanged cart call
    setJustAdded(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setJustAdded(false), 1600);
  };

  const styles = {
    add: "bg-[#EA2831] text-white hover:bg-[#c91e26] active:scale-[0.98]",
    added: "bg-emerald-600 text-white shadow-sm scale-[1.02]",
    incart: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    sold: "bg-stone-100 text-stone-400",
  };
  const content = {
    add: ["add_shopping_cart", "Add to cart"],
    added: ["check_circle", "Added to cart"],
    incart: ["check_circle", "Already in cart"],
    sold: ["block", "Sold out"],
  }[state];
  const pad = size === "lg" ? "px-6 py-3" : "py-2.5";

  return (
    <button
      type="button"
      onClick={state === "add" ? handleAdd : undefined}
      disabled={state !== "add"}
      aria-label={content[1]}
      aria-live="polite"
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl text-sm font-bold transition-all duration-300 ${pad} ${styles[state]} ${state !== "add" ? "cursor-default" : ""} ${className}`}
    >
      <span className="material-symbols-outlined text-lg">{content[0]}</span>
      {content[1]}
    </button>
  );
});

/* ── Home-only product tile (premium look, same cart behaviour) ── */
export const HomeProductCard = memo(function HomeProductCard({ product }) {
  const img = getProductImage(product.images?.[0]);
  const off =
    product.mrp && product.mrp > product.price
      ? Math.round(((product.mrp - product.price) / product.mrp) * 100)
      : 0;
  const save = off > 0 ? Number(product.mrp) - Number(product.price) : 0;
  const inStock = product.inStock;
  const href = `/customer-shop/product/${product.listingId}`;

  const { toggleItem, isWishlisted: inWishlist } = useWishlist();
  const wished = inWishlist(product.listingId);

  const handleWishlistClick = (e) => {
    e.preventDefault(); // Yeh Link par click hone se rokega taaki product page open na ho jaye
    e.stopPropagation();
    toggleItem(product);
  };


  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200/70 transition-all duration-300 hover:ring-stone-300 hover:shadow-[0_20px_45px_-20px_rgba(20,32,26,0.4)] motion-safe:hover:-translate-y-1">
      <Link to={href} className="relative block">
        <div className="flex aspect-square items-center justify-center overflow-hidden bg-gradient-to-br from-emerald-50/40 via-stone-50 to-stone-100/70">
          {img ? (
            <img
              src={img}
              alt={product.name}
              loading="lazy"
              className="h-full w-full object-contain p-4 transition-transform duration-500 motion-safe:group-hover:scale-110"
            />
          ) : (
            <span className="material-symbols-outlined text-6xl font-light text-stone-300">eco</span>
          )}
        </div>
        {/* ── NEW: WISHLIST HEART BUTTON (Top Right Corner) ── */}
        <button
          type="button"
          onClick={handleWishlistClick}
          className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full bg-white/80 shadow-sm backdrop-blur transition-all hover:scale-110 active:scale-90"
          aria-label="Add to wishlist"
        >
          <span 
            className={`material-symbols-outlined text-xl transition-colors ${
              wished 
                ? "text-[#EA2831] fill-[1]" // Clicked: Red filled heart (fill-[1] works with variable fonts)
                : "text-stone-400 hover:text-[#EA2831]" // Normal: Grey outline heart
            }`}
            style={{ fontVariationSettings: wished ? "'FILL' 1" : "'FILL' 0" }}
          >
            favorite
          </span>
        </button>
        {off > 0 && (
          <span className="absolute left-3 top-3 rounded-full bg-[#EA2831] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-sm">
            {off}% off
          </span>
        )}
        {!inStock && (
          <span className="absolute right-3 top-3 rounded-full bg-[#14201A]/85 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">
            Sold out
          </span>
        )}
        {/* Quick view — navigates to the real product page */}
        <span className="pointer-events-none absolute inset-x-3 bottom-3 flex translate-y-2 items-center justify-center gap-1.5 rounded-xl bg-white/95 py-2 text-xs font-bold text-stone-800 opacity-0 shadow-md backdrop-blur transition-all duration-300 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100">
          <span className="material-symbols-outlined text-base">visibility</span> Quick view
        </span>
      </Link>

      <div className="flex flex-1 flex-col p-4">
        {(product.category || product.seller?.name) && (
          <p className="mb-1.5 inline-flex items-center gap-1 truncate text-[11px] font-bold uppercase tracking-wider text-[#EA2831]/80">
            <span className="material-symbols-outlined text-[13px]">eco</span>
            <span className="truncate">{product.category || product.seller?.name}</span>
          </p>
        )}
        <Link to={href} className="block">
          <h3 className="min-h-[2.5rem] font-heading text-sm font-bold leading-snug text-stone-900 line-clamp-2 transition-colors group-hover:text-[#EA2831]">
            {product.name}
          </h3>
        </Link>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-lg font-extrabold text-stone-900">{rupee(product.price)}</span>
          {product.unit && <span className="text-[11px] font-medium text-stone-400">/ {product.unit}</span>}
          {off > 0 && <span className="text-xs text-stone-400 line-through">{rupee(product.mrp)}</span>}
        </div>
        {save > 0 && <p className="mt-0.5 text-[11px] font-bold text-emerald-700">You save {rupee(save)}</p>}

        <div className="mt-2 flex items-center gap-2 text-[11px] font-semibold">
          {inStock ? (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <span className="material-symbols-outlined text-sm">check_circle</span>In stock
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-stone-400">
              <span className="material-symbols-outlined text-sm">block</span>Unavailable
            </span>
          )}
          {product.seller?.name && (
            <span className="inline-flex min-w-0 items-center gap-0.5 text-stone-400">
              <span className="material-symbols-outlined text-sm text-emerald-600">verified</span>
              <span className="truncate">{product.seller.name}</span>
            </span>
          )}
        </div>

        <AddToCartButton product={product} className="mt-4 w-full" />
      </div>
    </div>
  );
});

/* ── Featured spotlight (newest product) ── */
const FeaturedProduct = memo(function FeaturedProduct({ product }) {
  const img = getProductImage(product.images?.[0]);
  const off =
    product.mrp && product.mrp > product.price
      ? Math.round(((product.mrp - product.price) / product.mrp) * 100)
      : 0;
  const inStock = product.inStock;
  const href = `/customer-shop/product/${product.listingId}`;

  return (
    <div className="grid overflow-hidden rounded-3xl bg-white ring-1 ring-stone-200/70 lg:grid-cols-2">
      <Link to={href} className="relative block bg-gradient-to-br from-emerald-50/50 via-stone-50 to-stone-100/70">
        <div className="flex aspect-[4/3] items-center justify-center overflow-hidden lg:aspect-auto lg:h-full">
          {img ? (
            <img src={img} alt={product.name} className="h-full w-full object-contain p-8 transition-transform duration-500 motion-safe:hover:scale-105" />
          ) : (
            <span className="material-symbols-outlined text-7xl font-light text-stone-300">eco</span>
          )}
        </div>
        {off > 0 && (
          <span className="absolute left-5 top-5 rounded-full bg-[#EA2831] px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-white">
            {off}% off
          </span>
        )}
      </Link>

      <div className="flex flex-col justify-center gap-4 p-7 sm:p-10">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-[#EA2831]">
          <span className="material-symbols-outlined text-sm">bolt</span> Just listed
        </span>
        {product.category && (
          <p className="text-xs font-bold uppercase tracking-widest text-stone-400">{product.category}</p>
        )}
        <h3 className="font-heading text-2xl font-extrabold leading-tight text-stone-900 sm:text-3xl">{product.name}</h3>
        {product.description && (
          <p className="line-clamp-3 text-sm leading-relaxed text-stone-500">{product.description}</p>
        )}

        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-extrabold text-stone-900">{rupee(product.price)}</span>
          {off > 0 && <span className="text-lg text-stone-400 line-through">{rupee(product.mrp)}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {inStock ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
              <span className="material-symbols-outlined text-lg">check_circle</span>
              In stock
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-semibold text-stone-400">
              <span className="material-symbols-outlined text-lg">block</span>Currently unavailable
            </span>
          )}
          {product.seller?.name && (
            <span className="inline-flex items-center gap-1 text-stone-400">
              <span className="material-symbols-outlined text-base text-emerald-600">verified</span>
              Sold by {product.seller.name}
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <AddToCartButton product={product} size="lg" />
          <Link
            to={href}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-stone-100 px-6 py-3 text-sm font-bold text-stone-700 transition-colors hover:bg-stone-200"
          >
            View details <span className="material-symbols-outlined text-lg">arrow_forward</span>
          </Link>
        </div>
      </div>
    </div>
  );
});

/* ── Loading skeleton ── */
export const CardSkeleton = () => (
  <div className="animate-pulse overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200/70">
    <div className="aspect-square bg-stone-100" />
    <div className="space-y-2 p-4">
      <div className="h-2.5 w-1/3 rounded bg-stone-100" />
      <div className="h-3.5 w-full rounded bg-stone-100" />
      <div className="h-3.5 w-2/3 rounded bg-stone-100" />
      <div className="mt-2 h-5 w-1/2 rounded bg-stone-100" />
      <div className="mt-3 h-9 w-full rounded-xl bg-stone-100" />
    </div>
  </div>
);

/* ── Section heading ── */
export const SectionHead = ({ eyebrow, title, action }) => (
  <div className="mb-6 flex items-end justify-between gap-4">
    <div>
      <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-[#EA2831]">
        <span className="material-symbols-outlined text-sm">eco</span> {eyebrow}
      </p>
      <h2 className="mt-1 font-heading text-2xl font-extrabold tracking-tight text-stone-900 sm:text-3xl">{title}</h2>
    </div>
    {action}
  </div>
);

const PROMISES = [
  { icon: "verified_user", title: "Verified sellers", sub: "Vetted before they can list" },
  { icon: "local_shipping", title: "Delivered pan-India", sub: "Shipped to your doorstep" },
  { icon: "eco", title: "Farm-grade quality", sub: "Sourced for Indian farms" },
  { icon: "support_agent", title: "Buyer support", sub: "Help through every order" },
];

/* Explore Products is a FIXED, newest-first feed — not a paginated one:
   1 featured tile + 12 cards (4 per row x 3 rows on desktop). Anything older
   lives on /customer-shop/products, which keeps its own pagination.
   Module scope so the fetch callback can stay dependency-free. */
const FEED_SIZE = 13;
const GRID_SIZE = FEED_SIZE - 1; // 12 below the featured tile

export default function ShopHome() {
  // ShopLayout shares its header search state via <Outlet context={{ setQ }} />.
  const { setQ } = useOutletContext() || {};
  const navigate = useNavigate();

  const openCategory = (c) => {
    const term = String(c).trim();
    if (typeof setQ === "function") setQ("");
    navigate(`/customer-shop/products?category=${encodeURIComponent(term)}`);
  };

  // ── Categories (loaded once) ──
  const [categories, setCategories] = useState([]);

  // ── Product feed (fixed newest-first window; see FEED_SIZE above) ──
  const CATEGORY_PREVIEW = 4;
  const [products, setProducts] = useState([]);
  const [loadingFirst, setLoadingFirst] = useState(true);
  const [error, setError] = useState("");

  const fetchingRef = useRef(false);

  const loadFeed = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoadingFirst(true);
    setError("");
    try {
      // Same endpoint and the same param shape — only the size changed.
      // sort:"newest" is the server's publishedAt-descending ordering, so this
      // is genuinely the latest listings, not just the first page of them.
      const res = await getShopProducts({ limit: FEED_SIZE, page: 1, sort: "newest" });
      // Defensive slice: render at most FEED_SIZE even if the API ever returns
      // more than it was asked for.
      setProducts((res.data || []).slice(0, FEED_SIZE));
    } catch (e) {
      setError(e?.response?.data?.message || "Could not load products");
    } finally {
      fetchingRef.current = false;
      setLoadingFirst(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const catRes = await getShopCategories();
        if (alive) setCategories(catRes.data || []);
      } catch { /* categories are secondary; the feed still works */ }
    })();
    loadFeed();
    return () => { alive = false; };
  }, [loadFeed]);


  const categoryPreview = categories.slice(0, CATEGORY_PREVIEW);
  const featured = products[0];
  const rest = products.slice(1, FEED_SIZE); // 12 cards → 4 x 3 on desktop

  return (
    <div className="bg-stone-50/40">
      <div className="mx-auto max-w-7xl px-3 sm:px-6">

        {/* ── Hero (guest / marketing — the ONLY real difference from the dashboard) ── */}
        <section className="relative mt-4 overflow-hidden rounded-3xl bg-[#14201A] sm:mt-6 sm:rounded-[2rem]">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(100deg, rgba(20,32,26,0.95) 0%, rgba(20,32,26,0.85) 45%, rgba(20,32,26,0.45) 100%), url('${HERO_IMG}')`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-[#EA2831]/15 blur-3xl" />

          <div className="relative px-5 py-10 sm:px-10 sm:py-14 lg:px-14">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white/85 ring-1 ring-white/15 backdrop-blur">
              <span className="material-symbols-outlined text-sm text-[#EA2831]">agriculture</span> India's farming marketplace
            </span>
            <h1 className="mt-4 font-heading text-2xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-5xl">
              Everything your <span className="text-[#EA2831]">farm needs to grow.</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/75 sm:text-base">
              Seeds, fertilisers, tools and more — from verified Khetify sellers across India.
              Browse freely and build your cart; sign in only when you check out.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3 sm:mt-7">
              <a href="#products" className="inline-flex items-center gap-2 rounded-xl bg-[#EA2831] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-black/20 transition-colors hover:bg-[#c91e26] sm:px-7 sm:py-3.5">
                Shop all products <span className="material-symbols-outlined text-lg">arrow_forward</span>
              </a>
              <Link to="/customer-shop/categories" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-6 py-3 text-sm font-bold text-white ring-1 ring-white/25 backdrop-blur transition-colors hover:bg-white/20 sm:px-7 sm:py-3.5">
                <span className="material-symbols-outlined text-lg">grid_view</span> Browse categories
              </Link>
            </div>

            {/* Popular category chips */}
            {categoryPreview.length > 0 && (
              <div className="mt-6 flex flex-wrap items-center gap-2 sm:mt-8">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-white/40">Popular</span>
                {categoryPreview.map((c) => (
                  <button
                    key={c}
                    onClick={() => openCategory(c)}
                    className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold capitalize text-white/90 ring-1 ring-white/15 transition-colors hover:bg-[#EA2831] hover:ring-[#EA2831]"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Trust strip ── */}
        <section className="mt-5 sm:mt-6">
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4 lg:gap-4">
            {PROMISES.map((p) => (
              <div key={p.title} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-stone-200/70 sm:p-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-[#EA2831] sm:size-11">
                  <span className="material-symbols-outlined text-xl sm:text-2xl">{p.icon}</span>
                </span>
                <span className="min-w-0">
                  <span className="block font-heading text-[13px] font-bold text-stone-900 sm:text-sm">{p.title}</span>
                  <span className="hidden truncate text-xs text-stone-500 sm:block">{p.sub}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Categories (one row of 4 + button) ── */}
        {categories.length > 0 && (
          <section id="categories" className="scroll-mt-24 pt-12 sm:pt-16">
            <SectionHead
              eyebrow="Shop by category"
              title="Find what your farm needs"
              action={
                <Link to="/customer-shop/categories" className="hidden shrink-0 items-center gap-1 self-center text-sm font-bold text-[#EA2831] hover:underline sm:inline-flex">
                  View all <span className="material-symbols-outlined text-base">arrow_forward</span>
                </Link>
              }
            />
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {categoryPreview.map((c, i) => (
                <button
                  key={c}
                  onClick={() => openCategory(c)}
                  className={`group relative flex min-h-[120px] flex-col justify-between overflow-hidden rounded-2xl p-4 text-left ring-1 transition-all duration-300 hover:-translate-y-1 sm:min-h-[150px] sm:p-5 ${
                    i % 3 === 0
                      ? "bg-[#14201A] text-white ring-[#14201A] hover:shadow-[0_18px_40px_-18px_rgba(20,32,26,0.6)]"
                      : "bg-white text-stone-900 ring-stone-200/70 hover:ring-[#EA2831] hover:shadow-md"
                  }`}
                >
                  <span className={`flex size-10 items-center justify-center rounded-2xl transition-colors sm:size-12 ${i % 3 === 0 ? "bg-white/10 text-white group-hover:bg-[#EA2831]" : "bg-red-50 text-[#EA2831]"}`}>
                    <span className="material-symbols-outlined text-xl sm:text-2xl">{catIcon(c)}</span>
                  </span>
                  <div>
                    <p className="font-heading text-sm font-bold capitalize leading-tight sm:text-base">{c}</p>
                    <span className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${i % 3 === 0 ? "text-white/60" : "text-[#EA2831]"}`}>
                      Shop now <span className="material-symbols-outlined text-sm transition-transform group-hover:translate-x-0.5">arrow_forward</span>
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-4 sm:hidden">
              <Link to="/customer-shop/categories" className="flex items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white py-2.5 text-sm font-bold text-stone-700">
                View all categories <span className="material-symbols-outlined text-base">arrow_forward</span>
              </Link>
            </div>
          </section>
        )}

        {/* ── Product feed (featured + infinite scroll) ── */}
        <section id="products" className="scroll-mt-24 pb-14 pt-12 sm:pt-16">
          <SectionHead
            eyebrow="Fresh on the marketplace"
            title="Explore products"
            action={
              <Link to="/customer-shop/products" className="inline-flex shrink-0 items-center gap-1 self-center text-sm font-bold text-[#EA2831] hover:underline">
                View all <span className="material-symbols-outlined text-base">arrow_forward</span>
              </Link>
            }
          />

          {loadingFirst ? (
            <div className="space-y-6">
              <div className="h-64 animate-pulse rounded-3xl bg-white ring-1 ring-stone-200/70 sm:h-72" />
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                {Array.from({ length: GRID_SIZE }).map((_, i) => <CardSkeleton key={i} />)}
              </div>
            </div>
          ) : error && products.length === 0 ? (
            <div className="rounded-3xl bg-white p-12 text-center ring-1 ring-stone-200/70 sm:p-14">
              <span className="material-symbols-outlined text-5xl font-light text-[#EA2831]">wifi_off</span>
              <h3 className="mt-3 font-heading text-lg font-bold text-stone-900">{error}</h3>
              <button onClick={loadFeed} className="mt-4 rounded-xl bg-[#EA2831] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#c91e26]">
                Try again
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="rounded-3xl bg-white p-12 text-center ring-1 ring-stone-200/70 sm:p-14">
              <span className="material-symbols-outlined text-5xl font-light text-stone-300">storefront</span>
              <h3 className="mt-3 font-heading text-lg font-bold text-stone-900">No products yet</h3>
              <p className="mt-1 text-sm text-stone-500">Listings appear here as soon as sellers publish them.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {featured && <FeaturedProduct product={featured} />}

              {rest.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                  {rest.map((p) => <HomeProductCard key={p.listingId} product={p} />)}
                </div>
              )}

              {/* No pagination here by design — the full, paginated catalogue is
                  one tap away via the "View all" link in the section heading. */}
            </div>
          )}
        </section>

        {/* ── Closing CTA ── */}
        <section className="pb-14 sm:pb-16">
          <div className="relative overflow-hidden rounded-3xl bg-[#EA2831] px-6 py-10 text-center sm:px-12 sm:py-14">
            <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-white/10" />
            <div className="pointer-events-none absolute -bottom-20 -left-16 size-64 rounded-full bg-black/10" />
            <div className="relative">
              <h2 className="font-heading text-xl font-extrabold text-white sm:text-3xl">Ready to fill your cart?</h2>
              <p className="mx-auto mt-3 max-w-lg text-sm text-white/85 sm:text-base">
                Browse the full catalog of agri products from verified Khetify sellers. No account needed until you check out.
              </p>
              <Link to="/customer-shop/products" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-7 py-3.5 text-sm font-bold text-[#EA2831] shadow-lg shadow-black/10 transition-colors hover:bg-stone-100 sm:mt-7">
                Start shopping <span className="material-symbols-outlined text-lg">arrow_forward</span>
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}