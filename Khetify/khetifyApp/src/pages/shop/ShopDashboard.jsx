import React, { useCallback, useEffect, useRef, useState, memo } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { getShopProducts, getShopCategories } from "../../lib/shopApi";
import { getProductImage } from "../../lib/productImage";
import { useShopAuth } from "../../context/ShopAuthContext";
import { useCart } from "../../context/CartContext";
import { HomeProductCard, CardSkeleton, SectionHead, catIcon } from "./ShopHome";

/* Logged-in customer home. UI ONLY: same product/category APIs, existing auth
   context. No API/auth/business logic changed. Renders inside ShopLayout.

   Brought up to the same premium look as the guest ShopHome — cinematic hero
   with popular-category chips, a featured spotlight for the newest product, the
   trust strip, and a category preview. The Explore Products feed is a FIXED
   newest-first window of 13 (1 featured + 12), not an infinite scroll — the
   full paginated catalogue lives on /customer-shop/products. Fully responsive
   for phone / tablet / desktop. */

const HERO_IMG =
  "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1600&q=80";

const rupee = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

// Explore Products is a FIXED, newest-first feed: 1 featured tile + 12 cards
// (4 per row x 3 rows on desktop). Anything older lives on the products page.
const FEED_SIZE = 13;
const GRID_SIZE = FEED_SIZE - 1; // 12 below the featured tile
const CATEGORY_PREVIEW = 4;   // categories shown before "View all" (one row)

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

const TRUST = [
  { icon: "verified", title: "Verified sellers", sub: "Every listing from a trusted seller" },
  { icon: "local_shipping", title: "Farm delivery", sub: "Straight to your doorstep" },
  { icon: "payments", title: "Cash on delivery", sub: "Pay when your order arrives" },
  { icon: "eco", title: "Fresh stock", sub: "Sourced for your season" },
];

/* Featured spotlight — the newest product, shown large. Mirrors the guest
   home's featured card (which isn't exported), using the same cart call. */
const FeaturedProduct = memo(function FeaturedProduct({ product }) {
  const { addItem, items } = useCart();
  const img = getProductImage(product.images?.[0]);
  const off =
    product.mrp && product.mrp > product.price
      ? Math.round(((product.mrp - product.price) / product.mrp) * 100)
      : 0;
  const inStock = product.inStock;
  const href = `/customer-shop/product/${product.listingId}`;
  const inCart = items.some((i) => i.listingId === product.listingId);

  return (
    <div className="grid overflow-hidden rounded-3xl bg-white ring-1 ring-stone-200/70 lg:grid-cols-2">
      <Link to={href} className="relative block bg-gradient-to-br from-emerald-50/50 via-stone-50 to-stone-100/70">
        <div className="flex aspect-[4/3] items-center justify-center overflow-hidden lg:aspect-auto lg:h-full">
          {img ? (
            <img src={img} alt={product.name} className="h-full w-full object-contain p-6 transition-transform duration-500 motion-safe:hover:scale-105 sm:p-8" />
          ) : (
            <span className="material-symbols-outlined text-7xl font-light text-stone-300">eco</span>
          )}
        </div>
        {off > 0 && (
          <span className="absolute left-4 top-4 rounded-full bg-[#EA2831] px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-white sm:left-5 sm:top-5">
            {off}% off
          </span>
        )}
      </Link>

      <div className="flex flex-col justify-center gap-3 p-6 sm:gap-4 sm:p-10">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-[#EA2831]">
          <span className="material-symbols-outlined text-sm">bolt</span> Just listed
        </span>
        {product.category && (
          <p className="text-xs font-bold uppercase tracking-widest text-stone-400">{product.category}</p>
        )}
        <h3 className="font-heading text-xl font-extrabold leading-tight text-stone-900 sm:text-2xl lg:text-3xl">{product.name}</h3>
        {product.description && (
          <p className="line-clamp-2 text-sm leading-relaxed text-stone-500 sm:line-clamp-3">{product.description}</p>
        )}

        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-extrabold text-stone-900 sm:text-3xl">{rupee(product.price)}</span>
          {off > 0 && <span className="text-base text-stone-400 line-through sm:text-lg">{rupee(product.mrp)}</span>}
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
          <button
            type="button"
            onClick={inStock && !inCart ? () => addItem(product, 1) : undefined}
            disabled={!inStock || inCart}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold transition-all ${
              !inStock ? "cursor-default bg-stone-100 text-stone-400"
                : inCart ? "cursor-default bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                : "bg-[#EA2831] text-white hover:bg-[#c91e26]"
            }`}
          >
            <span className="material-symbols-outlined text-lg">{inCart ? "check_circle" : !inStock ? "block" : "add_shopping_cart"}</span>
            {inCart ? "Already in cart" : !inStock ? "Sold out" : "Add to cart"}
          </button>
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

export default function ShopDashboard() {
  const { consumer } = useShopAuth();
  const navigate = useNavigate();
  const { setQ } = useOutletContext() || {};

  const openCategory = (c) => {
    if (typeof setQ === "function") setQ("");
    navigate(`/customer-shop/products?category=${encodeURIComponent(String(c).trim())}`);
  };

  // ── Categories (loaded once) ──
  const [categories, setCategories] = useState([]);

  // ── Product feed (fixed newest-first window; see FEED_SIZE above) ──
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


  const firstName = consumer?.name?.split(" ")[0] || "Farmer";
  const categoryPreview = categories.slice(0, CATEGORY_PREVIEW);

  // Featured = newest product; the next 12 flow into the grid below it.
  const featured = products[0];
  const rest = products.slice(1, FEED_SIZE); // 12 cards → 4 x 3 on desktop

  return (
    <div className="bg-stone-50/40">
      <div className="mx-auto max-w-7xl px-3 sm:px-6">

        {/* ── Hero ── */}
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
              <span className="size-1.5 rounded-full bg-emerald-400" /> Fresh from verified sellers
            </span>
            <h1 className="mt-4 font-heading text-2xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-5xl">
              {greeting()}, {firstName} <span className="align-middle">👋</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/75 sm:text-base">
              Everything your farm needs, in one place. Pick up where you left off or explore what's fresh on the marketplace.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3 sm:mt-7">
              <a href="#products" className="inline-flex items-center gap-2 rounded-xl bg-[#EA2831] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-black/20 transition-colors hover:bg-[#c91e26] sm:px-7 sm:py-3.5">
                Explore products <span className="material-symbols-outlined text-lg">arrow_forward</span>
              </a>
              <Link to="/customer-shop/categories" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-6 py-3 text-sm font-bold text-white ring-1 ring-white/25 backdrop-blur transition-colors hover:bg-white/20 sm:px-7 sm:py-3.5">
                <span className="material-symbols-outlined text-lg">grid_view</span> Browse categories
              </Link>
            </div>

            {/* Popular category chips (like the guest home) */}
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
            {TRUST.map((t) => (
              <div key={t.title} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-stone-200/70 sm:p-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-[#EA2831] sm:size-11">
                  <span className="material-symbols-outlined text-xl sm:text-2xl">{t.icon}</span>
                </span>
                <span className="min-w-0">
                  <span className="block font-heading text-[13px] font-bold text-stone-900 sm:text-sm">{t.title}</span>
                  <span className="hidden truncate text-xs text-stone-500 sm:block">{t.sub}</span>
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

            {/* Mobile "View all" (the header link is hidden on phones) */}
            <div className="mt-4 sm:hidden">
              <Link
                to="/customer-shop/categories"
                className="flex items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white py-2.5 text-sm font-bold text-stone-700"
              >
                View all categories <span className="material-symbols-outlined text-base">arrow_forward</span>
              </Link>
            </div>
          </section>
        )}

        {/* ── Product feed (featured + a fixed 12-card grid) ── */}
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
              <button
                onClick={loadFeed}
                className="mt-4 rounded-xl bg-[#EA2831] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#c91e26]"
              >
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
              {/* Featured spotlight */}
              {featured && <FeaturedProduct product={featured} />}

              {/* The rest of the feed */}
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
              <h2 className="font-heading text-xl font-extrabold text-white sm:text-3xl">Need something specific?</h2>
              <p className="mx-auto mt-3 max-w-lg text-sm text-white/85 sm:text-base">
                Search the full catalog of seeds, fertilisers, tools and more from verified Khetify sellers.
              </p>
              <Link to="/customer-shop/products" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-7 py-3.5 text-sm font-bold text-[#EA2831] shadow-lg shadow-black/10 transition-colors hover:bg-stone-100 sm:mt-7">
                Explore products <span className="material-symbols-outlined text-lg">arrow_forward</span>
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}