import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { getShopProducts, getShopCategories } from "../../lib/shopApi";
import { getProductImage } from "../../lib/productImage";
import { useCart } from "../../context/CartContext";
import { useT, useShopLanguage } from "../../context/ShopLanguageContext";
import { useWishlist } from "../../context/WishlistContext";

/* ────────────────────────────────────────────────────────────────
   Khetify Bazaar — customer home / dashboard.

   DATA FLOW IS UNCHANGED from the previous version:
   • one Promise-free effect fetches getShopCategories()
   • loadFeed() calls getShopProducts({ limit: FEED_SIZE, page: 1, sort: "newest" })
   • the same four pieces of state (categories, products, loadingFirst, error)
   • add-to-cart still calls useCart().addItem(product, 1)
   • wishlist still calls useWishlist().toggleItem(product)
   • language switch still refetches (effect depends on `lang`)

   Everything else is presentation. Deals / best sellers / biggest savings are
   DERIVED from the same fetched array — no new endpoints.

   Theme: Khetify red #EA2831 (+ #B3121A depth) on white, near-black #16191B
   for text and image veils. Sora display (font-heading) / Manrope body.

   LAYOUT: offer bar → full-width slider → categories → advertisements, then
   the product sections. The narrow ads that sat to the right of the slider and
   the coupon / bank-offer strips are gone; the slider runs edge to edge and the
   advertising lives in one place (AD_BANNERS) instead of three.

   The ad banners are STATIC DEMO CONTENT (see PROMO_SLIDES, AD_BANNERS).
   Replace the image + copy fields with your ads API when ready.
──────────────────────────────────────────────────────────────── */

/* ── Demo imagery. Swap these for your own CDN banners. ──
   Every key is in use again — the brand rail took the last spare. Add a URL
   here before adding a banner that needs one. */
const U = (id, w = 900) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=75`;

const IMG = {
  field: U("1500382017468-9049fed747ef", 1400),
  seedlings: U("1523348837708-15d4a09cfac2", 1200),
  farmers: U("1574943320219-553eb213f72d", 1400),
  veggies: U("1464226184884-fa280b87c399", 1100),
  soil: U("1416879595882-3373a0480b5b", 1000),
  maize: U("1625246333195-78d9c38ad449", 1200),
  potatoes: U("1518977676601-b53f82aba655", 900),
  wheat: U("1592982537447-7440770cbfc9", 1400),
  harvest: U("1470072768013-bf9532016c10", 900),
  rows: U("1523741543316-beb7fc7023d8", 1200),
  market: U("1533900298318-6b8da08a523e", 1200),
};

/* ── Static demo ads ── */
const PROMO_SLIDES = [
  {
    id: "s1",
    img: IMG.farmers,
    pos: "center 42%",
    to: "/customer-shop/products",
  },
  {
    id: "s2",
    img: IMG.seedlings,
    pos: "center",
    to: "/customer-shop/products?category=Seeds",
  },
  {
    id: "s3",
    img: IMG.rows,
    pos: "center 60%",
    to: "/customer-shop/products?category=Irrigation",
  },
  {
    id: "s4",
    img: IMG.market,
    pos: "center",
    to: "/customer-shop/products",
  },
];

/* COMPANY ADVERTISEMENTS.

   Sold slots — each entry is one company's banner. The rail below pages through
   them two at a time on desktop and one at a time on a phone, so the list can
   grow to any length without the section growing taller: adding a seventh
   company is one more object here and nothing else.

   `tone` alternates cream / red so consecutive slots never look like one wide
   block. Swap img + copy for your ads API when it exists. */
const AD_BANNERS = [
  {
    id: "b1",
    company: "Kisan Agro",
    img: IMG.veggies,
    tone: "cream",
    to: "/customer-shop/products",
  },
  {
    id: "b2",
    company: "Harit Farms",
    img: IMG.harvest,
    tone: "red",
    to: "/customer-shop/products",
  },
  {
    id: "b3",
    company: "Annadata Seeds",
    img: IMG.seedlings,
    tone: "cream",
    to: "/customer-shop/products?category=Seeds",
  },
  {
    id: "b4",
    company: "Bhoomi Nutrients",
    img: IMG.soil,
    tone: "red",
    to: "/customer-shop/products?category=Fertilizers",
  },
  {
    id: "b5",
    company: "AquaGrow",
    img: IMG.rows,
    tone: "cream",
    to: "/customer-shop/products?category=Irrigation",
  },
  {
    id: "b6",
    company: "KrishiTech",
    img: IMG.market,
    tone: "red",
    to: "/customer-shop/products?category=Tools",
  },
];

const rupee = (n) => `\u20B9${Number(n || 0).toLocaleString("en-IN")}`;

/* Unchanged export — other pages import this. */
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

/* Category art for the circles.

   MATCHES BOTH SCRIPTS. The catalogue returns category names in the reader's
   language, so English-only keywords meant every Hindi name missed and fell
   through to the same field photograph. The Devanagari terms sit beside the
   English ones rather than in a separate table: one line per subject means a
   new category is covered in both languages at once, and the two can never
   drift apart.

   ONE PHOTOGRAPH PER SUBJECT. Several subjects used to share an image — seeds,
   saplings and growth promoters all resolved to the seed trays — which put the
   same picture under four different names and made the row look broken. Each
   entry now points somewhere of its own.

   Order matters: the first keyword that appears wins, so narrower subjects
   come before broader ones ("fruit plants" is saplings, not produce). */
const CATEGORY_ART = [
  [["sapling", "nursery", "plant", "पौध", "नर्सरी"], "harvest"],
  [["seed", "बीज"], "seedlings"],
  [["fertil", "manure", "compost", "nutrient", "उर्वरक", "खाद", "पोषक"], "soil"],
  [["pest", "insect", "herbi", "protect", "कीट", "कीटनाशक", "सुरक्षा"], "maize"],
  [["tool", "equip", "machine", "implement", "उपकरण", "औज़ार", "औजार", "यंत्र"], "market"],
  [["irrigat", "water", "pump", "drip", "सिंचाई", "पानी", "पंप"], "rows"],
  [["fruit", "veg", "produce", "फल", "सब्ज़ी", "सब्जी", "उपज"], "veggies"],
  [["dairy", "cattle", "live", "डेयरी", "पशु", "मवेशी"], "farmers"],
  [["grain", "pulse", "अनाज", "दाल"], "potatoes"],
  [["growth", "booster", "promoter", "वृद्धि", "वर्धक"], "wheat"],
  [["smart", "tech", "स्मार्ट", "तकनीक"], "field"],
];

/* The preferred photograph for one name, or null when nothing matches. */
const categoryArtKey = (name = "") => {
  // Lower-casing is a no-op for Devanagari, which has no case; it is here for
  // the English half and harmless to the other.
  const k = String(name).toLowerCase();
  const hit = CATEGORY_ART.find(([words]) => words.some((w) => k.includes(w)));
  return hit ? hit[1] : null;
};

/* ASSIGNS THE WHOLE ROW AT ONCE, so no two circles repeat.

   Keyword matching alone cannot do this: "Seeds" and "Special Seeds" are both
   genuinely seeds and both resolve to the same tray photograph, which is
   correct in isolation and looks like a bug in a row. Resolving the list
   together lets a second claimant fall through to the next unused image, and
   the result is stable because the catalogue returns categories in a fixed
   order. */
const IMG_POOL = ["seedlings", "soil", "rows", "veggies", "market", "maize", "harvest", "potatoes", "wheat", "farmers", "field"];

const categoryArtFor = (names = []) => {
  const used = new Set();
  const out = {};
  for (const name of names) {
    let key = categoryArtKey(name);
    if (!key || used.has(key)) key = IMG_POOL.find((k) => !used.has(k)) || key || "field";
    used.add(key);
    out[name] = IMG[key];
  }
  return out;
};

const discountOf = (p) =>
  p?.mrp && p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;

/* ── Scroll entrance. The hidden state is applied by the effect, so if JS is
   slow or disabled the content is simply visible — never stuck invisible. ── */
function useReveal(deps = []) {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const els = Array.from(root.querySelectorAll("[data-reveal]"));
    els.forEach((el) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(22px)";
      el.style.transition =
        "opacity .8s cubic-bezier(.22,1,.36,1), transform .8s cubic-bezier(.22,1,.36,1)";
      el.style.willChange = "opacity, transform";
    });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.style.opacity = "1";
          e.target.style.transform = "none";
          io.unobserve(e.target);
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -60px 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/* ── Horizontal rail with arrow controls ── */
function useRail() {
  const ref = useRef(null);
  const nudge = (dir) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(230, el.clientWidth * 0.8), behavior: "smooth" });
  };
  return [ref, () => nudge(-1), () => nudge(1)];
}

/* ── Section heading (kept as an export; restyled) ── */
export const SectionHead = ({ eyebrow, title, action }) => (
  <div className="mb-4 flex flex-wrap items-end justify-between gap-4 sm:mb-5">
    <div>
      {eyebrow && (
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.2em] text-[#EA2831]">
          {eyebrow}
        </p>
      )}
      <h2 className="mt-1.5 font-heading text-[19px] font-bold -tracking-[0.022em] text-stone-900 sm:text-2xl lg:text-[27px]">
        {title}
      </h2>
    </div>
    {action}
  </div>
);

/* ── Add-to-cart button. Same useCart().addItem(product, 1) call, same states. ── */
const AddToCartButton = memo(function AddToCartButton({ product, size = "sm", className = "" }) {
  const { addItem, items } = useCart();
  const t = useT();
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
    add: "border-[#EA2831] bg-[#EA2831] text-white hover:border-[#C91E26] hover:bg-[#C91E26] active:scale-[0.97]",
    added: "border-[#F3C6C8] bg-[#FDECEC] text-[#B3121A]",
    incart: "border-[#F3C6C8] bg-[#FDECEC] text-[#B3121A]",
    sold: "border-stone-200 bg-stone-50 text-stone-400",
  };
  const content = {
    add: ["add_shopping_cart", t("home.addToCart")],
    added: ["check_circle", t("home.addedToCart")],
    incart: ["check_circle", t("home.alreadyInCart")],
    sold: ["block", t("home.soldOut")],
  }[state];
  const pad = size === "lg" ? "px-[22px] py-[13px] text-[13.5px]" : "px-2.5 py-[9px] text-[11.5px]";

  return (
    <button
      type="button"
      onClick={state === "add" ? handleAdd : undefined}
      disabled={state !== "add"}
      aria-label={content[1]}
      aria-live="polite"
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border font-bold transition-all duration-300 ${pad} ${styles[state]} ${state !== "add" ? "cursor-default" : ""} ${className}`}
    >
      <span className="material-symbols-outlined text-[15px]">{content[0]}</span>
      {content[1]}
    </button>
  );
});

/* ── Product tile (exported — used by the grid and by other pages) ── */
export const HomeProductCard = memo(function HomeProductCard({ product }) {
  const t = useT();
  const img = getProductImage(product.images?.[0]);
  const off = discountOf(product);
  const inStock = product.inStock;
  const href = `/customer-shop/product/${product.listingId}`;

  const { toggleItem, isWishlisted } = useWishlist();
  const wished = isWishlisted(product.listingId);

  const handleWishlistClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleItem(product);
  };

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-stone-200/80 bg-white transition-all duration-500 hover:border-[#F3C6C8] hover:shadow-[0_22px_42px_-26px_rgba(22,25,27,0.45)] motion-safe:hover:-translate-y-1">
      {/* 4:3, not square. A square photo is the single tallest thing in the
          card, and at this width it costs ~50px of height for no extra
          legibility — a trowel reads exactly as well in a landscape crop. */}
      <Link to={href} className="relative block aspect-[4/3] overflow-hidden bg-stone-100">
        {img ? (
          <img
            src={img}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-[850ms] ease-[cubic-bezier(.22,1,.36,1)] motion-safe:group-hover:scale-[1.08]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-stone-100 text-5xl font-light text-stone-300">
            <span className="material-symbols-outlined text-5xl">eco</span>
          </span>
        )}
        {off > 0 && (
          <span className="absolute left-0 top-2.5 rounded-r bg-[#EA2831] px-2 py-[3px] text-[10px] font-extrabold uppercase text-white">
            {t("common.percentOff", { percent: off })}
          </span>
        )}
        {!inStock && (
          <span className="absolute inset-x-0 bottom-0 bg-[#16191B]/85 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-white">
            {t("common.soldOut")}
          </span>
        )}
      </Link>

      <button
        type="button"
        onClick={handleWishlistClick}
        aria-label={t("home.addToWishlist")}
        className="absolute right-2 top-2 z-10 flex size-[30px] items-center justify-center rounded-full border border-stone-200 bg-white/95 transition-all duration-300 hover:scale-110 hover:border-[#F3C6C8] active:scale-90"
      >
        <span
          className={`material-symbols-outlined text-[17px] transition-colors ${wished ? "text-[#EA2831]" : "text-stone-400"}`}
          style={{ fontVariationSettings: wished ? "'FILL' 1" : "'FILL' 0" }}
        >
          favorite
        </span>
      </button>

      <div className="flex flex-1 flex-col gap-1 p-2.5">
        {(product.category || product.seller?.name) && (
          <span className="truncate text-[10px] font-extrabold uppercase tracking-[0.13em] text-stone-400">
            {product.category ? product.category : product.seller?.name}
          </span>
        )}
        <Link to={href} className="block">
          <h3 className="line-clamp-2 min-h-[32px] text-[12.5px] font-semibold leading-[1.3] text-stone-900 transition-colors group-hover:text-[#EA2831]">
            {product.name}
          </h3>
        </Link>

        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-heading text-[15.5px] font-bold text-stone-900">{rupee(product.price)}</span>
          {product.unit && <span className="text-[10.5px] text-stone-400">/ {product.unit}</span>}
          {off > 0 && <span className="text-[10.5px] text-stone-400 line-through">{rupee(product.mrp)}</span>}
        </div>

        <div className="flex h-[15px] items-center gap-2 overflow-hidden text-[10.5px] text-stone-500">
          {inStock ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap font-bold text-emerald-700">
              <span className="material-symbols-outlined text-[13px]">check_circle</span>
              {t("home.inStock")}
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-stone-400">
              <span className="material-symbols-outlined text-[13px]">block</span>
              {t("home.unavailable")}
            </span>
          )}
          {product.seller?.name && (
            <span className="inline-flex min-w-0 items-center gap-0.5">
              <span className="material-symbols-outlined text-[13px] text-emerald-600">verified</span>
              <span className="truncate">{product.seller.name}</span>
            </span>
          )}
        </div>

        <AddToCartButton product={product} className="mt-auto w-full" />
      </div>
    </div>
  );
});

/* ── Loading skeleton (kept as an export) ── */
export const CardSkeleton = () => (
  <div className="animate-pulse overflow-hidden rounded-2xl border border-stone-200/80 bg-white">
    <div className="aspect-square bg-stone-100" />
    <div className="space-y-2 p-3">
      <div className="h-2 w-1/3 rounded bg-stone-100" />
      <div className="h-3 w-full rounded bg-stone-100" />
      <div className="h-3 w-2/3 rounded bg-stone-100" />
      <div className="mt-2 h-4 w-1/2 rounded bg-stone-100" />
      <div className="mt-2 h-8 w-full rounded-lg bg-stone-100" />
    </div>
  </div>
);

/* ── Promotional advertisement carousel (static demo ads) ── */
function PromoCarousel() {
  const t = useT();
  const [i, setI] = useState(0);
  const n = PROMO_SLIDES.length;
  const hover = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      if (!hover.current) setI((v) => (v + 1) % n);
    }, 6000);
    return () => clearInterval(id);
  }, [n]);

  return (
    <div
      className="relative w-full overflow-hidden rounded-[18px] bg-[#16191B]"
      onMouseEnter={() => { hover.current = true; }}
      onMouseLeave={() => { hover.current = false; }}
    >
      <div
        className="flex transition-transform duration-[850ms] ease-[cubic-bezier(.3,1,.32,1)]"
        style={{ transform: `translateX(-${i * 100}%)` }}
      >
        {PROMO_SLIDES.map((s, n2) => (
          <div key={s.id} className="relative flex min-h-[280px] flex-[0_0_100%] sm:min-h-[340px] lg:min-h-[404px]">
            <span
              className="absolute inset-0 transition-transform duration-[1400ms] ease-[cubic-bezier(.22,1,.36,1)]"
              style={{
                backgroundImage: `url('${s.img}')`,
                backgroundSize: "cover",
                backgroundPosition: s.pos,
                transform: n2 === i ? "scale(1.06)" : "scale(1)",
              }}
            />
            <span className="absolute inset-0 bg-[linear-gradient(92deg,rgba(15,12,12,.9)_0%,rgba(22,10,11,.72)_40%,rgba(30,12,13,.18)_78%,rgba(0,0,0,0)_100%)]" />
            <div className="relative flex max-w-[min(94%,600px)] flex-col justify-center gap-3 p-6 pb-[78px] sm:p-8 sm:pb-[86px] lg:p-[46px] lg:pb-[92px]">
              <span className="w-fit whitespace-nowrap rounded-[5px] bg-[#EA2831] px-3 py-[5px] text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-white">
                {t(`promo.${s.id}.kicker`)}
              </span>
              <h2 className="max-w-[18ch] font-heading text-[25px] font-bold leading-[1.06] -tracking-[0.025em] text-white text-pretty sm:text-[34px] lg:text-[44px]">
                {t(`promo.${s.id}.title`)}
              </h2>
              <p className="max-w-[36ch] text-[13px] leading-[1.55] text-white/75 sm:text-[15.5px]">{t(`promo.${s.id}.body`)}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <Link
                  to={s.to}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[9px] bg-[#EA2831] px-[22px] py-3 text-[13.5px] font-bold text-white shadow-[0_12px_26px_-14px_rgba(234,40,49,0.9)] transition-all duration-300 hover:bg-white hover:text-[#EA2831] motion-safe:hover:-translate-y-0.5"
                >
                  {t(`promo.${s.id}.cta`)}
                  <span className="material-symbols-outlined text-[17px]">arrow_forward</span>
                </Link>
                <span className="whitespace-nowrap text-xs font-semibold text-white/55">{t(`promo.${s.id}.note`)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="absolute bottom-6 left-6 z-[2] flex items-center gap-[7px] lg:left-[46px] lg:bottom-8">
        {PROMO_SLIDES.map((s, n2) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setI(n2)}
            aria-label={t("home.gotoAd", { n: n2 + 1 })}
            className={`h-[3px] rounded-sm transition-all duration-[600ms] ease-[cubic-bezier(.3,1,.32,1)] ${n2 === i ? "w-[34px] bg-[#EA2831]" : "w-[14px] bg-white/50"}`}
          />
        ))}
      </div>
      <div className="absolute bottom-[18px] right-4 z-[2] flex gap-2 lg:bottom-[26px] lg:right-[26px]">
        <button
          type="button"
          onClick={() => setI((v) => (v - 1 + n) % n)}
          aria-label={t("home.prevAd")}
          className="flex size-[38px] items-center justify-center rounded-full border border-white/30 bg-white/15 text-white backdrop-blur transition-colors duration-300 hover:bg-white hover:text-[#16191B]"
        >
          <span className="material-symbols-outlined text-xl">chevron_left</span>
        </button>
        <button
          type="button"
          onClick={() => setI((v) => (v + 1) % n)}
          aria-label={t("home.nextAd")}
          className="flex size-[38px] items-center justify-center rounded-full border border-white/30 bg-white/15 text-white backdrop-blur transition-colors duration-300 hover:bg-white hover:text-[#16191B]"
        >
          <span className="material-symbols-outlined text-xl">chevron_right</span>
        </button>
      </div>
    </div>
  );
}

/* ── ONE ADVERTISEMENT CARD, TWO PLACEMENTS ──────────────────────────────
   The same banner is rendered as a static pair high on the page and inside the
   scrolling rail lower down, so it lives here once and takes its sizing from
   the caller. Duplicating fifty lines of markup for the two placements would
   guarantee they drifted apart the first time a company asked for a change. */
const AdBannerCard = ({ ad: a, className = "", decorative = false }) => {
  const t = useT();
  return (
  <Link
    to={a.to}
    aria-hidden={decorative || undefined}
    tabIndex={decorative ? -1 : undefined}
    aria-label={`${a.company} — ${t(`ads.${a.id}.kicker`)}`}
    className={`group/ad relative flex items-center overflow-hidden rounded-[20px] transition-shadow duration-500 hover:shadow-[0_24px_44px_-26px_rgba(22,25,27,0.5)] ${
      a.tone === "red" ? "bg-[#EA2831]" : "bg-[#F5F4EF]"
    } ${className}`}
  >
    {/* Photo on the RIGHT half, veil fading out across it so the copy never
        lands on busy pixels whatever the banner image is. */}
    <span
      className="absolute inset-y-0 right-0 w-[54%] transition-transform duration-[900ms] ease-[cubic-bezier(.22,1,.36,1)] motion-safe:group-hover/ad:scale-105"
      style={{ backgroundImage: `url('${a.img}')`, backgroundSize: "cover", backgroundPosition: "center" }}
    />
    <span
      className={`absolute inset-0 ${
        a.tone === "red"
          ? "bg-[linear-gradient(90deg,rgba(234,40,49,.97)_0%,rgba(234,40,49,.94)_44%,rgba(234,40,49,0)_86%)]"
          : "bg-[linear-gradient(90deg,rgba(245,244,239,.97)_0%,rgba(245,244,239,.94)_44%,rgba(245,244,239,0)_86%)]"
      }`}
    />
    <span className="relative flex max-w-[58%] flex-col gap-2 p-5 sm:p-7 lg:p-8">
      <span
        className={`w-fit whitespace-nowrap rounded-[5px] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] ${
          a.tone === "red" ? "bg-white text-[#EA2831]" : "bg-[#EA2831] text-white"
        }`}
      >
        {t(`ads.${a.id}.kicker`)}
      </span>
      <span
        className={`whitespace-pre-line font-heading text-[19px] font-bold leading-[1.14] -tracking-[0.02em] lg:text-[27px] ${
          a.tone === "red" ? "text-white" : "text-stone-900"
        }`}
      >
        {t(`ads.${a.id}.title`)}
      </span>
      <span className={`max-w-[26ch] text-[12.5px] leading-[1.55] ${a.tone === "red" ? "text-white/80" : "text-stone-500"}`}>
        {t(`ads.${a.id}.body`)}
      </span>
      <span
        className={`mt-1 inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-[9px] px-4 py-2.5 text-[12.5px] font-bold transition-colors duration-300 ${
          a.tone === "red"
            ? "bg-[#16191B] text-white group-hover/ad:bg-white group-hover/ad:text-[#EA2831]"
            : "bg-[#EA2831] text-white group-hover/ad:bg-[#C91E26]"
        }`}
      >
        {t(`ads.${a.id}.cta`)}
        <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
      </span>
      {/* Whose slot this is — an ad the reader cannot attribute is just
          decoration. */}
      <span className={`text-[10px] font-bold uppercase tracking-[0.16em] ${a.tone === "red" ? "text-white/55" : "text-stone-400"}`}>
        {a.company}
      </span>
    </span>
  </Link>
  );
};

/* ONE PLACEMENT, TWO SLOTS FILLED.

   There is a single advertisement position on this page — the static pair under
   the categories — so only the first two entries render. The rest of
   AD_BANNERS is a QUEUE, not dead weight: rotating a company into the live
   slot is a matter of moving it up the list, and a second placement can read
   further down it without the data changing shape. */
const FEATURED_AD_COUNT = 2;
const FEATURED_ADS = AD_BANNERS.slice(0, FEATURED_AD_COUNT);

/* ── WHY KHETIFY ─────────────────────────────────────────────────────────
   This slot briefly held customer testimonials. It does not any more: the
   marketplace is still being built, so there are no customers to quote, and a
   storefront that opens with invented praise misleads the people reading it —
   quite apart from the CCPA's rules on fake reviews. When real feedback exists
   it belongs here. Until then the same space says what the platform actually
   is, which is the honest version of the same job.

   THE THREE POINTS ARE FACTS ABOUT THE SYSTEM, not marketing adjectives.
   Principal Certificates, lot/unit labelling and FEFO dating are things
   Khetify genuinely does — which is why they can be printed flatly, and why
   they will still be true a year from now. */
const WHY_KHETIFY = [
  { id: "w1", icon: "verified" },
  { id: "w2", icon: "qr_code_2" },
  { id: "w3", icon: "event_available" },
];

function WhyKhetify() {
  const t = useT();
  return (
    <div className="overflow-hidden rounded-[20px] bg-[#F5F4EF] px-5 py-6 sm:px-8 lg:px-12 lg:py-7">
      <div className="mx-auto max-w-[58ch] text-center">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.2em] text-[#EA2831]">
          {t("why.eyebrow")}
        </p>
        <h2 className="mt-1 font-heading text-[17px] font-bold leading-[1.2] -tracking-[0.022em] text-stone-900 sm:text-[20px] lg:text-[22px]">
          {t("why.titlePre")}{" "}
          <span className="text-[#EA2831]">{t("why.titleAccent")}</span>
        </h2>
      </div>

      {/* A ROW OF LINES, NOT A ROW OF CARDS — and now a tighter one.
          These were three tall white panels with centred icons, which made this
          band as heavy as the product sections around it for content that is
          really three sentences. Smaller disc, tighter leading, less air above
          and below: the same three facts in noticeably less height. */}
      <div className="mt-5 grid gap-3.5 sm:grid-cols-3 lg:mt-6 lg:gap-7">
        {WHY_KHETIFY.map((f) => (
          <div key={f.id} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-[#EA2831]">
              <span className="material-symbols-outlined text-[17px]">{f.icon}</span>
            </span>
            <span className="min-w-0">
              <span className="block font-heading text-[13px] font-bold text-stone-900">{t(`why.${f.id}.title`)}</span>
              <span className="mt-0.5 block text-[11.5px] leading-[1.55] text-stone-500">{t(`why.${f.id}.body`)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── SPONSORED TILES ─────────────────────────────────────────────────────
   The SECOND advertisement placement, and deliberately a different shape from
   the wide pair under the categories: portrait tiles, image-led, copy at the
   foot. The same banner drawn the same way twice on one page reads as a repeat
   and both stop being looked at.

   This is also what the rest of AD_BANNERS is for. The first two entries hold
   the premium slot up top; everything after them renders here, so a company
   added to the list appears on the page instead of sitting in a queue nothing
   reads. */
const SPONSORED_ADS = AD_BANNERS.slice(FEATURED_AD_COUNT);

function SponsoredTiles() {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3.5">
      {SPONSORED_ADS.map((a) => (
        <Link
          key={a.id}
          to={a.to}
          aria-label={`${a.company} — ${t(`ads.${a.id}.kicker`)}`}
          className="group relative flex min-h-[230px] items-end overflow-hidden rounded-[16px] bg-[#16191B] transition-shadow duration-500 hover:shadow-[0_24px_44px_-26px_rgba(22,25,27,0.55)] lg:min-h-[268px]"
        >
          <span
            className="absolute inset-0 transition-transform duration-[1000ms] ease-[cubic-bezier(.22,1,.36,1)] motion-safe:group-hover:scale-105"
            style={{ backgroundImage: `url('${a.img}')`, backgroundSize: "cover", backgroundPosition: "center" }}
          />
          {/* Dark at the foot, clear at the head — the copy sits on the veil,
              the photograph stays legible above it. */}
          <span className="absolute inset-0 bg-[linear-gradient(0deg,rgba(15,12,12,.94)_0%,rgba(15,12,12,.55)_46%,rgba(15,12,12,.08)_100%)]" />

          <span className="relative flex flex-col gap-1.5 p-4 lg:p-5">
            <span className="w-fit whitespace-nowrap rounded-[4px] bg-[#EA2831] px-2 py-[3px] text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-white">
              {t(`ads.${a.id}.kicker`)}
            </span>
            <span className="whitespace-pre-line font-heading text-[15px] font-bold leading-[1.2] text-white lg:text-[17px]">
              {t(`ads.${a.id}.title`)}
            </span>
            <span className="line-clamp-2 text-[11.5px] leading-[1.5] text-white/70">{t(`ads.${a.id}.body`)}</span>
            <span className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-bold text-white">
              {t(`ads.${a.id}.cta`)}
              <span className="material-symbols-outlined text-[14px] transition-transform duration-300 motion-safe:group-hover:translate-x-0.5">
                arrow_forward
              </span>
            </span>
            {/* Whose slot this is — an ad the reader cannot attribute is just
                decoration. */}
            <span className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-white/45">
              {a.company}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/* ── BRANDS ON KHETIFY ───────────────────────────────────────────────────
   ⚠ STATIC DEMO CONTENT, like the ad banners. These are placeholder company
   names and stock photography; wire the rail to the real brand list before
   this page is public. Real manufacturer names must not appear here until
   those manufacturers are actually selling on the platform.

   ONE CARD SHAPE, SQUARE, NAME IN THE SAME CORNER. A brand rail earns its
   place by being scannable — the eye runs along it hunting for a name it
   knows. Vary the shape or move the label and it stops being a list and
   becomes a gallery nobody reads. */
const BRANDS = [
  { id: "br1", name: "Kisan Agro", img: IMG.soil },
  { id: "br2", name: "Annadata Seeds", img: IMG.seedlings },
  { id: "br3", name: "AquaGrow", img: IMG.rows },
  { id: "br4", name: "KrishiTech", img: IMG.market },
  { id: "br5", name: "Harit Farms", img: IMG.harvest },
  { id: "br6", name: "Bhoomi Nutrients", img: IMG.wheat },
  { id: "br7", name: "Surya Crop Care", img: IMG.maize },
];

/* ── PART 1 of 2: the announcement band ──
   Just the "Straight from the makers" headline + subtitle, on its own soft
   wash. Split out so it can sit as its own section — with its own top/bottom
   spacing — instead of being glued to the wordmark + rail underneath it.
   Kept as a named export in case another page ever wants the banner without
   the rail (or vice versa). */
export function MakersBanner() {
  const t = useT();
  return (
    <div className="overflow-hidden rounded-[20px] bg-[linear-gradient(104deg,#FDECEC_0%,#FBF1E9_30%,#F7F5F0_58%,#FCEDEC_82%,#FDECEC_100%)] px-5 py-8 text-center lg:py-11">
      <h2 className="font-heading text-[22px] font-extrabold -tracking-[0.028em] text-[#16191B] sm:text-[28px] lg:text-[34px]">
        {t("makers.title")}
      </h2>
      <p className="mt-1.5 text-[13px] text-stone-600 sm:text-[15px]">
        {t("makers.sub")}
      </p>
    </div>
  );
}

/* ── PART 2 of 2: wordmark + brand rail ──
   Its own rounded card on the cream background, independent of the banner
   above so the two can be spaced, reordered, or reused separately. */
export function BrandShowcase() {
  const t = useT();
  const [railRef, prev, next] = useRail();

  return (
    <div className="overflow-hidden rounded-[20px] bg-[#F5F4EF] px-4 pb-8 pt-7 sm:px-7 lg:px-10 lg:pb-10">
      {/* A wordmark lockup, not a logo wall: real marks belong to real
          partners, and printing one before an agreement exists is a claim
          about that company rather than about us. */}
      <div className="flex flex-col items-center">
        <span className="font-heading text-[24px] font-extrabold -tracking-[0.035em] text-[#16191B] sm:text-[30px]">
          Khetify<span className="text-[#EA2831]">Direct</span>
        </span>
        <span className="mt-1 text-[9.5px] font-extrabold uppercase tracking-[0.26em] text-stone-500 sm:text-[10.5px]">
          {t("brands.tagline")}
        </span>
      </div>

      <div className="relative mt-6 lg:mt-8">
        <div
          ref={railRef}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 lg:gap-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {BRANDS.map((b) => (
            <Link
              key={b.id}
              to={`/customer-shop/products?q=${encodeURIComponent(b.name)}`}
              aria-label={t("home.shopBrand", { brand: b.name })}
              className="group relative aspect-[4/5] w-[172px] shrink-0 snap-start overflow-hidden rounded-[14px] bg-stone-200 transition-shadow duration-500 hover:shadow-[0_24px_44px_-26px_rgba(22,25,27,0.5)] sm:w-[212px] lg:w-[248px]"
            >
              <img
                src={b.img}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-[850ms] ease-[cubic-bezier(.22,1,.36,1)] motion-safe:group-hover:scale-[1.07]"
              />
              {/* Name tab in the SAME corner on every card — the thing the eye
                  is actually running along the rail to find. */}
              <span className="absolute bottom-0 left-0 max-w-[88%] rounded-tr-[14px] bg-white/95 px-4 py-3 backdrop-blur">
                <span className="block truncate font-heading text-[13px] font-extrabold uppercase tracking-[0.06em] text-[#16191B] lg:text-[14px]">
                  {b.name}
                </span>
                <span className="mt-0.5 block truncate text-[10.5px] text-stone-500">{t(`brands.${b.id}.line`)}</span>
              </span>
            </Link>
          ))}
        </div>

        {/* Floated over the rail's edges and vertically centred, so they clear
            the name tabs sitting along the bottom of every card. */}
        <button
          type="button"
          onClick={prev}
          aria-label={t("home.prevBrands")}
          className="absolute -left-1 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[#16191B] shadow-[0_12px_28px_-14px_rgba(22,25,27,0.6)] transition-colors duration-300 hover:bg-[#EA2831] hover:text-white sm:flex"
        >
          <span className="material-symbols-outlined text-[21px]">chevron_left</span>
        </button>
        <button
          type="button"
          onClick={next}
          aria-label={t("home.nextBrands")}
          className="absolute -right-1 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[#16191B] shadow-[0_12px_28px_-14px_rgba(22,25,27,0.6)] transition-colors duration-300 hover:bg-[#EA2831] hover:text-white sm:flex"
        >
          <span className="material-symbols-outlined text-[21px]">chevron_right</span>
        </button>
      </div>
    </div>
  );
}

/* Explore feed stays a fixed newest-first window; the paginated catalogue
   lives on /customer-shop/products. */
const FEED_SIZE = 13;
/* Card width for the product rail. Shared by the skeletons and the real cards
   so the loading state is exactly the size of what replaces it — a rail that
   resizes the moment it loads is the sort of jump this page has already been
   fixed for once. */
const PRODUCT_RAIL_CARD = "w-[164px] shrink-0 sm:w-[196px] lg:w-[214px]";
// One skeleton per product now that none is held back for a spotlight.
/* HOW MANY THE RAIL SHOWS.
   A rail carrying the whole feed is a scroll with no end in sight — the reader
   cannot tell whether they have seen everything. Eight is about two screens of
   swiping, after which the see-all tile takes over; the full grid is what
   /customer-shop/products is for.

   ONE constant, used for both the cards and the loading skeletons. Two numbers
   that have to agree eventually stop agreeing, and the row would be 13 cards
   wide while loading and 8 after. */
const RAIL_LIMIT = 8;
const GRID_SIZE = RAIL_LIMIT;

/* And the same for the category row. A row that carries every category is a
   scroll with no end in sight; capped, it ends in a tile that opens the full
   list — so the row visibly STOPS somewhere and the thing it stops at is the
   way to see the rest. */
const CATEGORY_LIMIT = 8;

export default function ShopHome() {
  const t = useT();
  const { lang } = useShopLanguage();
  const { setQ } = useOutletContext() || {};
  const navigate = useNavigate();

  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [loadingFirst, setLoadingFirst] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("new");

  const fetchingRef = useRef(false);
  // Only the ref: the rail is swiped and ends in the see-all tile, so the
  // arrow controls that used prev/next no longer exist.
  const [prodRef] = useRail();

  const openCategory = (c) => {
    const term = String(c).trim();
    if (typeof setQ === "function") setQ("");
    navigate(`/customer-shop/products?category=${encodeURIComponent(term)}`);
  };

  const loadFeed = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoadingFirst(true);
    setError("");
    try {
      const res = await getShopProducts({ limit: FEED_SIZE, page: 1, sort: "newest" });
      setProducts((res.data || []).slice(0, FEED_SIZE));
    } catch (e) {
      setError(e?.response?.data?.message || t("home.loadError"));
    } finally {
      fetchingRef.current = false;
      setLoadingFirst(false);
    }
    // `t` is a dependency now that the fallback message is translated. With an
    // empty array the callback would close over whichever language was current
    // when the page mounted, so switching mid-session would leave the error in
    // the old one. The load effect already re-runs on `lang`, so this is free.
  }, [t]);

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
  }, [loadFeed, lang]);

  /* Derived views over the SAME fetched array — no extra requests. */
  // From 0, not 1. The first product used to be pulled out as the spotlight;
  // now that the spotlight is gone it belongs back in the rail, or the newest
  // listing would silently never appear.
  const rest = useMemo(() => products.slice(0, FEED_SIZE), [products]);
  const gridItems = useMemo(() => {
    if (tab === "value") return rest.slice().sort((a, b) => discountOf(b) - discountOf(a));
    if (tab === "top") return rest.slice().reverse();
    return rest;
  }, [rest, tab]);

  const railItems = useMemo(() => gridItems.slice(0, RAIL_LIMIT), [gridItems]);
  const hasMore = gridItems.length > RAIL_LIMIT;

  // Computed for the whole list so the circles cannot repeat a photograph;
  // recomputed only when the categories themselves change.
  const categoryArt = useMemo(() => categoryArtFor(categories), [categories]);

  const revealRef = useReveal([loadingFirst, products.length, categories.length]);

  const TABS = [
    { key: "new", label: t("home.sectionProductsTitle") || "New arrivals" },
    { key: "top", label: t("home.tabBestSellers") },
    { key: "value", label: t("home.tabBiggestSavings") },
  ];

  return (
    <div ref={revealRef} className="bg-white">
      <div className="mx-auto max-w-[1360px] px-3 sm:px-6 lg:px-8">

        {/* ── Advertisement carousel, full width ── */}
        <section className="mt-5 lg:mt-7">
          <PromoCarousel />
        </section>

        {/* ── Featured categories ──
            Circular tiles under a centred heading, which is the shape this
            wants: a category is a destination, and a round mark reads as one
            far faster than a rectangle does.

            The circles carry an ICON, not a photograph. Photographs here were
            what made the top of the page feel heavy — the hero and the
            advertisement band below are both full-bleed imagery, and a third
            photographic row between them turned three distinct sections into
            one long slab. Icons on cream keep this row quiet, so it separates
            the two image bands instead of joining them.

            `id` is kept so /customer-shop#categories still lands here. */}
        {categories.length > 0 && (
          <section id="categories" data-reveal className="mt-9 scroll-mt-20 sm:mt-12 lg:mt-14">
            <div className="text-center">
              <p className="text-[10.5px] font-extrabold uppercase tracking-[0.2em] text-[#EA2831]">
                {t("home.viewAllCategories")}
              </p>
              <h2 className="mt-1.5 font-heading text-[19px] font-bold -tracking-[0.022em] text-stone-900 sm:text-2xl lg:text-[27px]">
                {t("home.featuredCategories")}
              </h2>
            </div>

            {/* The first CATEGORY_LIMIT, scrolled horizontally, closing with a
                tile that opens the full list. Showing every category made the
                row run off the screen with nothing to say how far it went. */}
            <div className="mt-5 flex items-start justify-start gap-4 overflow-x-auto px-0.5 pb-2 sm:gap-8 lg:mt-7 lg:gap-12 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {categories.slice(0, CATEGORY_LIMIT).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => openCategory(c)}
                  className="group flex w-[84px] shrink-0 flex-col items-center gap-3 lg:w-[110px]"
                >
                  <span className="block size-[78px] overflow-hidden rounded-full bg-[#F5F4EF] p-[5px] shadow-[0_12px_28px_-18px_rgba(22,25,27,0.55)] transition-all duration-500 group-hover:bg-[#EA2831] motion-safe:group-hover:-translate-y-1.5 lg:size-[98px] lg:p-1.5">
                    <img
                      src={categoryArt[c]}
                      alt=""
                      loading="lazy"
                      className="h-full w-full rounded-full object-cover transition-transform duration-[850ms] ease-[cubic-bezier(.22,1,.36,1)] motion-safe:group-hover:scale-[1.08]"
                    />
                  </span>
                  <span className="text-center font-heading text-[12.5px] font-semibold capitalize leading-tight text-stone-900 transition-colors duration-300 group-hover:text-[#EA2831] lg:text-[13.5px]">
                    {c}
                  </span>
                </button>
              ))}

              {/* Only when something was actually held back. */}
              {categories.length > CATEGORY_LIMIT && (
                <Link
                  to="/customer-shop/categories"
                  className="group flex w-[84px] shrink-0 flex-col items-center gap-3 lg:w-[110px]"
                >
                  <span className="flex size-[78px] items-center justify-center rounded-full border border-dashed border-stone-300 bg-white text-[#EA2831] transition-all duration-500 group-hover:border-[#EA2831] group-hover:bg-[#FDECEC] motion-safe:group-hover:-translate-y-1.5 lg:size-[98px]">
                    <span className="material-symbols-outlined text-[28px] transition-transform duration-300 group-hover:translate-x-0.5 lg:text-[32px]">
                      arrow_forward
                    </span>
                  </span>
                  <span className="text-center font-heading text-[12.5px] font-semibold leading-tight text-stone-900 transition-colors duration-300 group-hover:text-[#EA2831] lg:text-[13.5px]">
                    {t("home.viewAll")}
                  </span>
                </Link>
              )}
            </div>
          </section>
        )}

        {/* ── Featured company banners ──
            STATIC, because the hero slider is directly above this: two moving
            bands stacked make the top of the page restless and neither gets
            read properly. See FEATURED_ADS. */}
        <section data-reveal className="mt-6 grid gap-3 lg:mt-8 lg:grid-cols-2 lg:gap-4">
          {FEATURED_ADS.map((a) => (
            <AdBannerCard key={a.id} ad={a} className="h-[190px] w-full lg:h-[228px]" />
          ))}
        </section>

        {/* ── Recommended products ── */}
        <section id="products" data-reveal className="mt-9 scroll-mt-20 sm:mt-12 lg:mt-14">
          <SectionHead
            eyebrow={t("home.sectionProductsEyebrow")}
            title={t("home.recommendedTitle")}
          />

          {!loadingFirst && rest.length > 0 && (
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {TABS.map((tb) => (
                <button
                  key={tb.key}
                  type="button"
                  onClick={() => setTab(tb.key)}
                  className={`shrink-0 whitespace-nowrap rounded-lg border px-4 py-2 text-[12.5px] font-bold transition-all duration-300 ${
                    tab === tb.key
                      ? "border-[#16191B] bg-[#16191B] text-white"
                      : "border-stone-200 bg-white text-stone-600 hover:border-stone-300"
                  }`}
                >
                  {tb.label}
                </button>
              ))}
            </div>
          )}

          {loadingFirst ? (
            <div className="flex gap-2.5 overflow-hidden lg:gap-3.5">
              {Array.from({ length: GRID_SIZE }).map((_, i) => (
                <div key={i} className={PRODUCT_RAIL_CARD}><CardSkeleton /></div>
              ))}
            </div>
          ) : error && products.length === 0 ? (
            <div className="rounded-[20px] border border-stone-200/80 bg-white p-12 text-center">
              <span className="material-symbols-outlined text-5xl font-light text-[#EA2831]">wifi_off</span>
              <h3 className="mt-3 font-heading text-lg font-bold text-stone-900">{error}</h3>
              <button
                onClick={loadFeed}
                className="mt-4 rounded-[10px] bg-[#EA2831] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#C91E26]"
              >
                {t("common.tryAgain")}
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="rounded-[20px] border border-stone-200/80 bg-white p-12 text-center">
              <span className="material-symbols-outlined text-5xl font-light text-stone-300">storefront</span>
              <h3 className="mt-3 font-heading text-lg font-bold text-stone-900">{t("home.noProducts")}</h3>
              <p className="mt-1 text-sm text-stone-500">{t("home.noProductsSub")}</p>
            </div>
          ) : (
            /* A RAIL, NOT A GRID.
               A five-across grid of thirteen products is four rows tall and
               pushes everything below it off the first two screens. A rail
               shows the same products, keeps the section one card high, and —
               because the next card is visibly clipped at the edge — tells the
               reader there is more without a word of copy. The full grid is
               what /customer-shop/products is for. */
            <div
              ref={prodRef}
              className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-1 lg:gap-3.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {railItems.map((p) => (
                <div key={p.listingId} className={`${PRODUCT_RAIL_CARD} snap-start`}>
                  <HomeProductCard product={p} />
                </div>
              ))}

              {/* THE LAST TILE IS THE WAY OUT.
                  The rail used to run to the end of the feed and simply stop,
                  which tells the reader nothing about whether that was all of
                  it. Capping it and closing with this tile does both jobs at
                  once: the row visibly ENDS somewhere, and the thing it ends
                  with is the door to the full catalogue. It only appears when
                  something was actually held back. */}
              {hasMore && (
                <Link
                  to="/customer-shop/products"
                  className={`${PRODUCT_RAIL_CARD} group flex snap-start flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-stone-300 bg-[#F5F4EF] transition-colors duration-300 hover:border-[#EA2831] hover:bg-[#FDECEC]`}
                >
                  <span className="flex size-12 items-center justify-center rounded-full bg-white text-[#EA2831] transition-transform duration-300 group-hover:translate-x-0.5">
                    <span className="material-symbols-outlined text-[26px]">arrow_forward</span>
                  </span>
                  <span className="px-3 text-center text-[12.5px] font-bold leading-tight text-stone-900">
                    {t("home.viewAll")}
                  </span>
                </Link>
              )}
            </div>
          )}
        </section>

        {/* ── Why Khetify ── */}
        <section data-reveal className="mt-9 sm:mt-12 lg:mt-14">
          <WhyKhetify />
        </section>

        {/* ── Sponsored ── */}
        <section data-reveal className="mt-9 sm:mt-12 lg:mt-14">
          {/* No action link: these are paid slots, not a catalogue view — a
              "view all" beside them would promise a page of advertisements. */}
          <SectionHead eyebrow={t("home.sponsoredEyebrow")} title={t("home.sponsoredTitle")} />
          <SponsoredTiles />
        </section>

        {/* ── Straight from the makers — now TWO separate sections/parts ──
            Part 1: the "Straight from the makers" announcement banner.
            Part 2: the KhetifyDirect wordmark + brand rail.
            Each is its own rounded card with its own top margin, instead of
            being fused into one tall block — so they can be spaced, reordered
            or reused independently. */}
        <section data-reveal className="mt-9 sm:mt-12 lg:mt-14">
          <MakersBanner />
        </section>

        <section data-reveal className="mt-3 pb-10 sm:mt-4 lg:pb-14">
          <BrandShowcase />
        </section>
      </div>
    </div>
  );
}