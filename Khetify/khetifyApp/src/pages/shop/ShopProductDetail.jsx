import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { getShopProduct, getShopProducts } from "../../lib/shopApi";
import { getProductImage } from "../../lib/productImage";
import { toBuyNowItem, setBuyNowItem } from "../../lib/buyNow";
import { useCart } from "../../context/CartContext";
import { useWishlist } from "../../context/WishlistContext";
import { useT, useShopLanguage } from "../../context/ShopLanguageContext";
import { rupee } from "../../Components/shop/ProductCard";
import NotifyMeButton from "../../Components/shop/NotifyMeButton";
import { HomeProductCard } from "./ShopHome";


/* Product detail — real-marketplace UI. UI ONLY. Every existing action and data
   flow is preserved: getShopProduct(listingId) → product; quantity clamp
   [1, availableStock]; addItem(product, qty); Buy Now = buyNow item → checkout;
   image gallery (activeImg); back button; wishlist toggle (useWishlist);
   related products via getShopProducts({ category }). No API/business logic
   changed, and nothing is fabricated — every field is guarded. */

/**
 * The heading above a variant strip, derived from the DATA rather than assumed.
 * When every variant varies on one attribute the page says "Colour" or "Size";
 * when they combine several (Size + Colour) it falls back to a neutral word.
 * Nothing is hardcoded to colour — the Company form allows any attribute.
 */
const variantLabelFor = (list = []) => {
  const keys = new Set();
  // Guard against a null/undefined entry in the list — e.g. the sold-out
  // "Notify Me" button calls this with [selectedVariant] where selectedVariant
  // is null for a product that has no variants at all, which used to crash
  // the whole product page instead of just falling back to "Options".
  list.forEach((v) => v && Object.keys(v.attributes || {}).forEach((k) => keys.add(k)));
  return keys.size === 1 ? [...keys][0] : "Options";
};

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
  { icon: "local_shipping", titleKey: "pdTrust.panIndia", subKey: "pdTrust.panIndiaSub" },
  { icon: "verified_user", titleKey: "pdTrust.verifiedSeller", subKey: "pdTrust.verifiedSellerSub" },
  { icon: "lock", titleKey: "pdTrust.secureCheckout", subKey: "pdTrust.secureCheckoutSub" },
  { icon: "eco", titleKey: "pdTrust.quality", subKey: "pdTrust.qualitySub" },
];

export default function ShopProductDetail() {
  const t = useT();
  // The API returns catalogue text already localised, so the fetch effects
  // below depend on `lang` — a language switch must refetch, not just re-render.
  const { lang } = useShopLanguage();

  // Catalogue data. lf/ll read Hindi FREE TEXT off the record (falling back to
  // English); tt/tc/ta map ENUMERABLE values through the shared dictionary.
  const { listingId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { addItem, items } = useCart();
  const { isWishlisted, toggleItem } = useWishlist();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [qty, setQty] = useState(1);
  // Which of the selected variant's photos is showing.
  const [variantSlide, setVariantSlide] = useState(0);
  const swipeRef = useRef(null);
  const [activeImg, setActiveImg] = useState(0);
  // Cursor position over the main image, 0–1 on each axis. null = not hovering,
  // which is also what a touch device always reports (it fires no mousemove).
  const [zoomAt, setZoomAt] = useState(null);
  const thumbRailRef = useRef(null);
  // SELECTED VARIANT id, or null for "no variant chosen" — the page then looks
  // exactly as it does today. Never pre-selected, so the main product image and
  // the product price stay in charge until the customer picks something.
  // Seeded from ?variant= so a link from the cart or the wishlist reopens the
  // exact option that was saved, not the product's default.
  const [variantId, setVariantId] = useState(() => searchParams.get("variant") || null);
  const [related, setRelated] = useState([]);
  const [justAdded, setJustAdded] = useState(false); // add-to-cart feedback (UI)
  const addedTimer = useRef(null);
  const railRef = useRef(null);

  useEffect(() => () => clearTimeout(addedTimer.current), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setActiveImg(0);
    // A different product means the previous product's variant id is meaningless.
    setVariantId(searchParams.get("variant") || null);
    setJustAdded(false);
    window.scrollTo({ top: 0, behavior: "auto" });
    (async () => {
      try {
        const res = await getShopProduct(listingId);
        if (!alive) return;
        setProduct(res.data);
        setQty(1); // default cart quantity is always 1
      } catch (e) {
        // The SERVER's message passes through untouched; only the fallback is translated.
        if (alive) setError(e?.response?.data?.message || t("pd.notFound"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // `lang` too: the product text arrives from the API already localised.
  }, [listingId, searchParams, lang]);

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
      <Link to="/customer-shop/products" className="mt-3 inline-block font-medium text-stone-700 hover:text-[#EA2831]">{t("pd.backToProducts")}</Link>
    </div>
  );

  const images = (product.images || []).map(getProductImage).filter(Boolean);

  /* ── VARIANTS (read-only, straight from the Company upload) ───────────────
     The ROWS decide, not `variantType`: the upload form appends `variants` but
     never appends `variantType`, so a product saved with variants still carries
     the schema default "single". A product with no rows gets an empty array and
     renders precisely as before — no empty selector, no extra markup. */
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const hasVariants = variants.length > 0;
  const selectedVariant = hasVariants ? variants.find((v) => v.id === variantId) || null : null;
  // Variants that carry their own picture become thumbnails; ones that do not
  // (a size or a weight, say) become labelled chips. Same data, two affordances.
  const variantThumbs = variants.filter((v) => v.image);
  const variantChips = variants.filter((v) => !v.image);
  /* Picking a different variant resets the quantity to 1 AND rewinds its photo
     gallery to the first image. Each variant has its own stock now, so a qty of
     40 carried over from a well-stocked colour would sit above the next one's
     maximum. Done in the click handler rather than an effect — it is a user
     action, not a synchronisation. */
  const chooseVariant = (id) => { setVariantId(id); setQty(1); setVariantSlide(0); };

  const stepVariantSlide = (delta) =>
    setVariantSlide((i) => {
      const n = variantGallery.length;
      if (n <= 1) return 0;
      // Wraps, so the arrows never dead-end.
      return (i + delta + n) % n;
    });

  /* Swipe, for touch. A horizontal drag past the threshold moves one photo;
     anything shorter, or mostly vertical, is left alone so the page can still
     be scrolled with a finger on the image. */
  const onGalleryTouchStart = (e) => {
    const t = e.touches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY };
  };
  const onGalleryTouchEnd = (e) => {
    const start = swipeRef.current;
    if (!start || variantGallery.length <= 1) return;
    swipeRef.current = null;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    stepVariantSlide(dx < 0 ? 1 : -1);
  };
  /* THE SELECTED VARIANT'S PHOTOS.

     Three cases, in order, and the last two are what keep every existing
     product working:
       `images` has entries  → gallery, with arrows and thumbnails
       only the single `image` → that one photo, no arrows, no thumbnails
       no variant selected     → the product's own photos, untouched

     A COMPANY product only ever has `image`, so it lands in the middle case
     and looks exactly as it did before multi-image existed. Same for any
     seller variant saved back when one photo was the limit. */
  const variantGallery = selectedVariant
    ? (selectedVariant.images?.length
        ? selectedVariant.images
        : (selectedVariant.image ? [selectedVariant.image] : []))
      .filter(Boolean)
      .map(getProductImage)
    : [];
  const hasVariantGallery = variantGallery.length > 0;
  // Which one of them is on screen. Clamped, because switching from a variant
  // with 3 photos to one with 2 would otherwise leave the index out of range.
  const variantImg = hasVariantGallery
    ? variantGallery[Math.min(variantSlide, variantGallery.length - 1)]
    : null;
  const selectedVariantImg = variantImg;
  // Both halves translated: { Color: "Red" } → { "रंग": "लाल" }.
  const attrEntries = Object.entries(selectedVariant?.attributes || {}).filter(([, val]) => val);

  // The variant's own price when it has one; otherwise the product price is
  // still what applies. NOTE: this is display only — cart, checkout and order
  // totals are untouched and keep using the listing price.
  const shownPrice = selectedVariant?.mrp != null ? Number(selectedVariant.mrp) : Number(product.price);
  // The strike-through/discount only makes sense against the product's own MRP,
  // so it is suppressed while a variant sets its own price.
  const off = !selectedVariant && product.mrp && product.mrp > product.price
    ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0;
  const save = off > 0 ? Number(product.mrp) - Number(product.price) : 0;
  /* THE STOCK THIS PAGE SHOWS.

     When the API sends `variantStock` AND a variant is selected, the number is
     that VARIANT's — picking Yellow used to show the whole product's total, so
     Yellow and Red read identically however different their shelves were.

     `variantStock` is NULL for a product whose stock is not tracked per
     variant — every company product, and any seller product whose lots predate
     variant tracking. Null must mean "use the product total", never "zero":
     reading it as zero would mark the entire company catalogue out of stock.
     Hence the explicit null check rather than `product.variantStock?.[...] ?? 0`.

     A variant that IS tracked but has no entry genuinely has none left, so 0 is
     the right answer there. The key is the variant's SKU, falling back to its
     label — the same value the seller's Add Stock flow writes to the lot. */
  const variantStock = product.variantStock || null;
  const trackedByVariant = !!variantStock && !!selectedVariant;
  const shownStock = trackedByVariant
    ? (variantStock[selectedVariant.sku] ?? variantStock[selectedVariant.label] ?? 0)
    : (Number(product.availableStock) || 0);

  const inStock = trackedByVariant ? shownStock > 0 : product.inStock;
  const maxQty = inStock ? shownStock : 0;
  const lowStock = inStock && shownStock > 0 && shownStock <= 5;
  // Per VARIANT, not per product: saving Red must not light up the heart on Green.
  const wished = isWishlisted(product.listingId, variantId);

  // Cart membership is read from the existing cart state (keyed by listingId).
  // Per LINE, not per product: Red in the cart must not make Green look added.
  const cartLineId = variantId ? `${product.listingId}::${variantId}` : String(product.listingId);
  const inCart = items.some((i) => (i.lineId || i.listingId) === cartLineId);
  const cartQty = items.find((i) => (i.lineId || i.listingId) === cartLineId)?.qty || 0;

  const rating = typeof product.rating === "number" ? product.rating
    : typeof product.averageRating === "number" ? product.averageRating : null;
  const reviewCount = product.reviewCount || product.numReviews || product.reviewsCount || 0;
  const reviews = Array.isArray(product.reviews) ? product.reviews : [];

  const name = product.name;
  const description = product.description || "";
  // The FIRST of these three that is an array is the feature list; the Hindi
  // copy is looked up under that same field name.
  const featureField = ["features", "keyFeatures", "highlights"].find((f) => Array.isArray(product[f]));
  const features = featureField ? (product[featureField] || []) : [];
  const usageField = ["usage", "usageInstructions", "howToUse"].find((f) => product[f]);
  const usage = usageField ? (product[usageField] || "") : "";

  /* THE SELECTED VARIANT BELONGS IN SPECIFICATIONS, not in a separate card
     above the price. Its attributes are product details like any other, so they
     are prepended to the existing spec rows and inherit that table's layout for
     free. `variantSpecs` is empty when nothing is selected, so the table looks
     exactly as it does today. */
  const variantSpecs = selectedVariant
    ? [
        [variantLabelFor(variants), selectedVariant.label],
        ...attrEntries.filter(([key]) => key !== variantLabelFor(variants)),
        ...(selectedVariant.sku ? [[t("pd.specVariantSku"), selectedVariant.sku]] : []),
      ]
    : [];

  const specs = [
    ...variantSpecs,
    [t("pd.specCategory"), product.category],
    [t("pd.specBrand"), product.brand],
    [t("pd.specBrandOwner"), product.companyName],
    [t("pd.specUnit"), product.unit],
    // The variant carries its own SKU (shown above), so the product-level one
    // would read as a contradiction next to it.
    [t("pd.specSku"), selectedVariant ? null : product.sku],
    [t("pd.specAvailableStock"), inStock && shownStock ? `${shownStock} ${product.unit || t("pd.units")}` : null],
    [t("pd.specGst"), product.gstPercentage ? `${product.gstPercentage}%` : null],
    [t("pd.specSoldBy"), product.seller?.name],
    [t("pd.specLocation"), product.seller?.city ? `${product.seller.city}${product.seller.state ? ", " + product.seller.state : ""}` : null],
  ].filter(([, v]) => v != null && v !== "");

  // Same cart calls as before — only visual feedback is added around them.
  const addToCart = () => {
    // The SELECTED variant goes into the cart — its price, its image, its
    // attributes. Null when none is chosen, which is the original behaviour.
    addItem(product, qty, selectedVariant);
    setJustAdded(true);
    clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setJustAdded(false), 1800);
  };
  // 🔧 Buy Now no longer pushes the product into the cart. It hands ONLY this
  //    product to checkout, so a shopper who wanted one item is charged for one
  //    item — and their existing cart is left completely untouched.
  const buyNow = () => {
    const stored = setBuyNowItem(toBuyNowItem(product, qty, selectedVariant));
    if (stored) {
      navigate("/customer-shop/checkout?mode=buynow");
    } else {
      // sessionStorage unavailable (private mode) — fall back to the old
      // cart-based flow rather than dead-ending the shopper.
      addItem(product, qty, selectedVariant);
      navigate("/customer-shop/checkout");
    }
  };

  // Add-to-cart button states: sold out → added (flash) → already in cart → add.
  const cartState = !inStock ? "sold" : justAdded ? "added" : inCart ? "incart" : "add";
  /* ONE PRIMARY, ONE QUIET.
     Add to cart and Buy now were a red outline beside a solid — two buttons of
     equal weight competing, so neither read as the main path. Buy now keeps
     the brand red; Add to cart is the neutral secondary, and only turns red
     once it has something to confirm. */
  const cartBtn = {
    add: { icon: "add_shopping_cart", label: t("pd.addToCart"), cls: "border-2 border-stone-200 bg-white text-[#16191B] hover:border-stone-300 hover:bg-[#F5F4EF]" },
    added: { icon: "check_circle", label: t("pd.addedToCart"), cls: "border-2 border-[#F3C6C8] bg-[#FDECEC] text-[#B3121A]" },
    incart: { icon: "check_circle", label: t("pd.alreadyInCart"), cls: "border-2 border-[#F3C6C8] bg-[#FDECEC] text-[#B3121A]" },
    sold: { icon: "block", label: t("pd.soldOut"), cls: "border-2 border-stone-200 bg-white text-stone-400" },
  }[cartState];

  // Lines ~358-376 - ACTION BUTTONS SECTION:
const actionButtons = (
  <>
    {!inStock ? (
      <NotifyMeButton
        productId={product?.productId}
        listingId={product?.listingId}
        variantLabel={selectedVariant?.label || variantLabelFor([selectedVariant]).toLowerCase()}
      />
    ) : (
      <>
        <button
          onClick={cartState === "add" || cartState === "incart" ? addToCart : undefined}
          disabled={cartState === "sold"}
          aria-live="polite"
          className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-all duration-300 disabled:cursor-not-allowed ${cartBtn.cls}`}
        >
          <span className="material-symbols-outlined text-lg">{cartBtn.icon}</span> {cartBtn.label}
        </button>
      </>
    )}
    <button
      onClick={buyNow}
      disabled={!inStock}
      className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-[#EA2831] bg-[#EA2831] py-3.5 text-sm font-bold text-white shadow-lg shadow-[#EA2831]/25 transition-all hover:border-[#C91E26] hover:bg-[#C91E26] active:scale-[0.99] disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none"
    >
      <span className="material-symbols-outlined text-lg">bolt</span> {t("pd.buyNow")}
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

  /* THUMBNAIL RAIL SOURCE.

     One rail, not two stacked ones. When a variant with its own photos is
     selected the rail shows THAT variant's gallery; otherwise it shows the
     product's own images. The page used to render both rows at once, which
     put two "selected" outlines on screen and left the reader guessing which
     strip drove the big picture. */
  const railImages = hasVariantGallery ? variantGallery : images;
  // Exactly what the frame renders, so the magnifier can never show a
  // different photograph from the one under the cursor.
  const mainSrc = selectedVariantImg || images[activeImg] || null;
  const railActive = hasVariantGallery
    ? Math.min(variantSlide, variantGallery.length - 1)
    : activeImg;
  const pickRailImage = (idx) => {
    if (hasVariantGallery) setVariantSlide(idx);
    else { setActiveImg(idx); setVariantId(null); }
  };

  /* ── HOVER MAGNIFIER ─────────────────────────────────────────────────────
     A lens over the photograph and a magnified panel beside it, the way the
     large fashion storefronts do it. The alternative — swapping the main image
     for a scaled one — loses the reader's place: they can no longer see WHICH
     part they are looking at.

     THE MATHS IS DONE BY THE BROWSER, not by hand. With `background-size` at
     ZOOM×100% and `background-position` given as the SAME percentage as the
     cursor, CSS aligns "this fraction of the image" with "this fraction of the
     box" for us. That identity only holds while the panel and the image frame
     share an aspect ratio, so both are square — hand-rolled pixel offsets are
     where this effect usually goes subtly wrong on the edges.

     The lens is 1/ZOOM of the frame, because that is exactly how much of the
     photograph fits in the panel. Clamped so it never hangs over an edge and
     shows the reader an area that is not in the panel. */
  const ZOOM = 2.5;
  const lensSize = 100 / ZOOM;
  const clampLens = (pct) => Math.min(Math.max(pct * 100 - lensSize / 2, 0), 100 - lensSize);

  const onZoomMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setZoomAt({
      x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
      y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
    });
  };

  const nudgeThumbs = (dir) => {
    const el = thumbRailRef.current;
    if (el) el.scrollBy({ top: dir * 140, behavior: "smooth" });
  };

  const Thumbs = ({ vertical }) => (
    <div
      ref={vertical ? thumbRailRef : undefined}
      className={
        vertical
          ? "hidden w-[64px] shrink-0 flex-col gap-2 overflow-y-auto pr-1 lg:flex lg:max-h-[460px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "mt-3 flex gap-2.5 overflow-x-auto pb-1 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      }
    >
      {railImages.map((src, idx) => (
        <button
          key={`${src}-${idx}`}
          type="button"
          onClick={() => pickRailImage(idx)}
          aria-current={idx === railActive}
          className={`shrink-0 overflow-hidden rounded-xl border-2 bg-white transition-all ${
            vertical ? "size-[60px]" : "size-16 sm:size-[72px]"
          } ${idx === railActive ? "border-[#EA2831]" : "border-stone-200 hover:border-stone-300"}`}
        >
          <img src={src} alt="" loading="lazy" className="h-full w-full object-contain p-1.5" />
        </button>
      ))}
    </div>
  );

  /* THE VARIANT PICKER, ONE CONTROL.

     Thumbnails and chips used to live in different columns — pictures beside
     the gallery, sizes beside the price — so a product with both split its
     options across the page and neither group announced what it was choosing.
     They are one labelled group here, the way every large storefront does it:
     "Colour: Misty Grey", then the swatches. */
  const VariantPicker = () => {
    if (!hasVariants) return null;
    return (
      <div className="mt-5">
        <p className="text-[13px] font-semibold text-stone-500">
          {variantLabelFor(variants)}:{" "}
          <span className="font-bold text-stone-900">
            {selectedVariant?.label || "—"}
          </span>
        </p>

        {variantThumbs.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2.5">
            {variantThumbs.map((v) => {
              const on = v.id === variantId;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => chooseVariant(on ? null : v.id)}
                  title={v.label}
                  aria-pressed={on}
                  className={`size-[68px] shrink-0 overflow-hidden rounded-xl border-2 bg-white transition-all ${
                    on ? "border-[#EA2831]" : "border-stone-200 hover:border-stone-300"
                  }`}
                >
                  <img src={getProductImage(v.image)} alt={v.label} className="h-full w-full object-contain p-1.5" />
                </button>
              );
            })}
          </div>
        )}

        {variantChips.length > 0 && (
          <div className={`flex flex-wrap gap-2 ${variantThumbs.length ? "mt-2.5" : "mt-2.5"}`}>
            {variantChips.map((v) => {
              const on = v.id === variantId;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => chooseVariant(on ? null : v.id)}
                  aria-pressed={on}
                  className={`rounded-xl px-3.5 py-2 text-sm font-semibold ring-1 transition-all ${
                    on ? "bg-[#EA2831] text-white ring-[#EA2831]" : "bg-white text-stone-700 ring-stone-200 hover:ring-stone-300"
                  }`}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-28 pt-5 sm:px-6 lg:pb-14">
      {/* Back — text + arrow, matches the rest of the customer app */}
      {/* <div className="mb-5 hidden sm:block">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={t("pd.goBack")}
          className="group inline-flex h-[42px] items-center gap-2 rounded-full border-[1.5px] border-stone-200 bg-white px-4 text-sm font-bold text-stone-800 transition-colors duration-150 hover:border-stone-300 hover:bg-stone-50 hover:text-[#EA2831]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-[19px] w-[19px] shrink-0 transition-transform duration-150 group-hover:-translate-x-0.5">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span className="leading-none">{t("pd.back")}</span>
        </button>
      </div> */}

      {/* ── THE PRODUCT, IN ONE CARD ──
          The gallery used to sit in a rounded panel while the details floated
          on the page background, so the top of the page read as a picture with
          text beside it rather than as one product. Everything above the
          description now shares a single surface.

          NOT `overflow-hidden`: the hover magnifier is positioned `left-full`
          and has to escape this box to sit over the column beside it. */}
      <div className="rounded-[24px] bg-white p-4 ring-1 ring-stone-200/80 sm:p-6 lg:p-8">
        <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">

        {/* ── Gallery ── */}
        <div className="relative lg:col-span-5 lg:sticky lg:top-24 lg:self-start">
          {/* ABOVE the photograph, not on it. Floated over the image it had to
              carry its own white pill and blur to stay legible against whatever
              the picture happened to be — a control fighting the content it
              sits on. Out here it needs none of that, and it stops covering the
              corner of every product image. */}
          <div className="mb-2 flex justify-end">
            <button
              onClick={() => toggleItem(product, selectedVariant)}
              aria-label={wished ? t("pd.removeFromWishlist") : t("pd.addToWishlist")}
              className="flex size-11 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95"
            >
              <span
                className={`material-symbols-outlined text-[26px] transition-colors ${wished ? "text-[#EA2831]" : "text-stone-300 hover:text-[#EA2831]"}`}
                style={{ fontVariationSettings: wished ? "'FILL' 1" : "'FILL' 0" }}
              >
                favorite
              </span>
            </button>
          </div>

          <div className="relative flex gap-3">
            <Thumbs vertical />

            <div
              className="relative flex aspect-square flex-1 items-center justify-center overflow-hidden rounded-3xl bg-white"
              onMouseMove={mainSrc ? onZoomMove : undefined}
              onMouseLeave={() => setZoomAt(null)}
            >
              {selectedVariantImg ? (
                <img
                  src={selectedVariantImg}
                  alt={`${name} — ${selectedVariant.label}`}
                  className="h-full w-full object-contain p-6 sm:p-8"
                  onTouchStart={onGalleryTouchStart}
                  onTouchEnd={onGalleryTouchEnd}
                />
              ) : images.length ? (
                <img src={images[activeImg]} alt={name} className="h-full w-full object-contain p-6 sm:p-8" />
              ) : (
                <span className="material-symbols-outlined text-7xl font-light text-stone-300">inventory_2</span>
              )}

              {/* No arrows over the photograph. The thumbnail rail beside it
                  already steps through the images, and a swipe still does on
                  touch (stepVariantSlide is kept for that) — a third control
                  for the same job only sat on top of the picture. */}

              {off > 0 && (
                <span className="absolute left-4 top-4 rounded-full bg-[#EA2831] px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-white shadow-sm">
                  {t("pd.percentOff", { percent: off })}
                </span>
              )}

              {/* THE LENS. pointer-events-none, or it would sit between the
                  cursor and the frame and kill the mousemove that draws it. */}
              {zoomAt && mainSrc && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute z-10 hidden rounded-sm bg-[#16191B]/15 ring-1 ring-white/70 lg:block"
                  style={{
                    width: `${lensSize}%`,
                    height: `${lensSize}%`,
                    left: `${clampLens(zoomAt.x)}%`,
                    top: `${clampLens(zoomAt.y)}%`,
                  }}
                />
              )}
            </div>

            {/* THE MAGNIFIED PANEL, floated over the columns to its right — the
                only way to show a 2.5x crop without shrinking the page's own
                content. Desktop only: a phone has no hover, and pinch-zoom. */}
            {zoomAt && mainSrc && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-full top-0 z-30 ml-5 hidden aspect-square w-[520px] overflow-hidden rounded-2xl bg-white shadow-[0_30px_60px_-30px_rgba(22,25,27,0.5)] ring-1 ring-stone-200 lg:block"
                style={{
                  backgroundImage: `url('${mainSrc}')`,
                  backgroundRepeat: "no-repeat",
                  backgroundSize: `${ZOOM * 100}%`,
                  backgroundPosition: `${zoomAt.x * 100}% ${zoomAt.y * 100}%`,
                }}
              />
            )}
          </div>

          {/* Up / down for the thumbnail rail, as in the reference. Only when
              the rail actually overflows — otherwise two buttons that do
              nothing. */}
          {railImages.length > 6 && (
            <div className="mt-2 hidden w-[64px] justify-center gap-2 lg:flex">
              <button
                type="button"
                onClick={() => nudgeThumbs(-1)}
                aria-label={t("pd.scrollLeft")}
                className="flex size-8 items-center justify-center rounded-full text-stone-500 ring-1 ring-stone-200 transition-colors hover:bg-[#EA2831] hover:text-white hover:ring-[#EA2831]"
              >
                <span className="material-symbols-outlined text-[18px]">expand_less</span>
              </button>
              <button
                type="button"
                onClick={() => nudgeThumbs(1)}
                aria-label={t("pd.scrollRight")}
                className="flex size-8 items-center justify-center rounded-full text-stone-500 ring-1 ring-stone-200 transition-colors hover:bg-[#EA2831] hover:text-white hover:ring-[#EA2831]"
              >
                <span className="material-symbols-outlined text-[18px]">expand_more</span>
              </button>
            </div>
          )}

          <Thumbs vertical={false} />
        </div>

        {/* ── Details ──
            ORDER: name, rating, price, options, buy, then the seller strip.

            The description is NOT here any more. It moved to a full-width
            section under this block, which is where the reference puts it and
            where it belongs: a paragraph of prose between the price and the
            size selector pushes the one control the shopper came for below the
            fold. Short facts above the button, long reading below it. */}
        <div className="lg:col-span-7">
          {product.category && (
            <p className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#EA2831]">
              <span className="material-symbols-outlined text-sm">eco</span> {product.category}
            </p>
          )}
          <h1 className="mt-2 font-heading text-2xl font-extrabold leading-tight tracking-tight text-stone-900 sm:text-[30px]">{name}</h1>
          {selectedVariant?.label && (
            <p className="mt-1 text-[15px] text-stone-500">({selectedVariant.label})</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {rating != null ? (
              <span className="inline-flex items-center gap-1.5">
                <Stars value={rating} size="text-base" />
                <span className="font-semibold text-stone-700">{rating.toFixed(1)}</span>
                {reviewCount > 0 && <span className="text-stone-400">({reviewCount})</span>}
              </span>
            ) : (
              <span className="text-xs text-stone-400">{t("pd.noRatings")}</span>
            )}
            {product.sku && !selectedVariant && (
              <span className="font-mono text-xs uppercase text-stone-400">{t("pd.skuInline", { sku: product.sku })}</span>
            )}
          </div>

          {/* Straight under the name: what the thing IS, before what it costs.
              It had its own full-width panel below the fold, which needed a
              heading — and that heading was the one string on this page with no
              entry in the dictionary, so it rendered as `pd.productDescription`.
              Here it needs no heading at all: it sits under the title, which is
              the label. One less key, one less section, and the reader learns
              what they are looking at before being asked to buy it. */}
          {description && (
            <p className="mt-3.5 max-w-prose whitespace-pre-line text-[14px] leading-relaxed text-stone-600">
              {description}
            </p>
          )}

          {/* Price, high and plain — struck MRP, live price, the discount. */}
          <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {off > 0 && <span className="text-lg text-stone-400 line-through">{rupee(product.mrp)}</span>}
            <span className="font-heading text-3xl font-extrabold text-stone-900 sm:text-4xl">{rupee(shownPrice)}</span>
            {off > 0 && (
              <span className="text-lg font-bold text-emerald-700">{t("pd.percentOff", { percent: off })}</span>
            )}
            {product.unit && <span className="text-sm text-stone-400">/ {product.unit}</span>}
          </div>
          {save > 0 && <p className="mt-1 text-sm font-semibold text-emerald-700">{t("pd.youSave", { amount: rupee(save) })}</p>}
          {product.gstPercentage > 0 && (
            <p className="mt-1 text-[13px] text-stone-500">{t("pd.gstAtCheckout", { percent: product.gstPercentage })}</p>
          )}

          <VariantPicker />

          <div className="mt-6 text-sm">
            {inStock ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                <span className="material-symbols-outlined text-lg">check_circle</span>
                {t("common.inStock")}
                {lowStock && (
                  <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">
                    {t("pd.onlyLeft", { count: shownStock })}
                  </span>
                )}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#EA2831]">
                <span className="material-symbols-outlined text-lg">block</span> {t("pd.outOfStock")}
              </span>
            )}
          </div>

          {inStock && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-stone-700">{t("pd.quantity")}</span>
              <div className="inline-flex items-center overflow-hidden rounded-xl border border-stone-200 bg-white">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label={t("pd.decrease")} className="flex size-10 items-center justify-center text-stone-600 transition-colors hover:bg-stone-100 hover:text-[#EA2831]">
                  <span className="material-symbols-outlined">remove</span>
                </button>
                <span className="w-12 text-center text-base font-bold text-stone-900">{qty}</span>
                <button onClick={() => setQty((q) => Math.min(maxQty, q + 1))} disabled={qty >= maxQty} aria-label={t("pd.increase")} className="flex size-10 items-center justify-center text-stone-600 transition-colors hover:bg-stone-100 hover:text-[#EA2831] disabled:text-stone-300 disabled:hover:bg-transparent">
                  <span className="material-symbols-outlined">add</span>
                </button>
              </div>
            </div>
          )}

          {inCart && (
            <p className="mt-3 inline-flex flex-wrap items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-[#EA2831]">
              <span className="material-symbols-outlined text-base">shopping_cart</span>
              {t(cartQty === 1 ? "pd.unitsInCart" : "pd.unitsInCartPlural", { count: cartQty })}
              <Link to="/customer-shop/cart" className="underline underline-offset-2 hover:text-[#c91e26]">{t("pd.viewCart")}</Link>
            </p>
          )}

          <div className="mt-5 hidden max-w-[560px] gap-3 lg:flex">{actionButtons}</div>

          {/* SELLER STRIP — the quiet grey band the reference closes this block
              with. Promises plus who is actually shipping it, on one line. */}
          <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-3 rounded-xl border border-stone-200 px-4 py-3.5">
            {TRUST.slice(0, 2).map((item) => (
              <span key={item.titleKey} className="inline-flex items-center gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#FDECEC] text-[#EA2831]">
                  <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                </span>
                <span className="text-[13px] font-semibold text-stone-700">{t(item.titleKey)}</span>
              </span>
            ))}
            {product.seller?.name && (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-stone-500">
                <span className="material-symbols-outlined text-base text-[#EA2831]">verified</span>
                {t("pd.soldByInline")}
                <span className="truncate font-semibold text-stone-700">{product.seller.name}</span>
              </span>
            )}
          </div>
        </div>
      </div>
      </div>

      {/* ── Specifications and features ──
          SPECIFICATIONS RUN IN TWO COLUMNS AGAIN. The single-column list I
          replaced them with turned a dozen short label/value pairs into a
          column of half-empty rows a screen tall; side by side they read in
          one glance, which is all a spec table is for. */}
      {(specs.length > 0 || features.length > 0 || usage) && (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {specs.length > 0 && (
            <Panel title={t("pd.specifications")} icon="list_alt" className={features.length === 0 ? "lg:col-span-2" : ""}>
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

          {features.length > 0 && (
            <Panel title={t("pd.keyFeatures")} icon="checklist" className={specs.length === 0 ? "lg:col-span-2" : ""}>
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

          {usage && (
            <Panel title={t("pd.usageInformation")} icon="menu_book" className="lg:col-span-2">
              <p className="whitespace-pre-line text-sm leading-relaxed text-stone-600">{usage}</p>
            </Panel>
          )}
        </div>
      )}

      {/* ── Reviews ── */}
      <div className="mt-5">
        <Panel title={t("pd.ratingsReviews")} icon="reviews">
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
              <p className="text-sm text-stone-500">{t("pd.noReviews")}</p>
            </div>
          )}
        </Panel>
      </div>

      {/* ── Similar products ──
          Arrows OVERLAID on the rail's edges rather than parked in the header.
          In the header they are a control you have to find; on the edges they
          sit exactly where the row runs out, which is where the hand already
          is. Hidden below `sm`, where the rail is swiped instead. */}
      {related.length > 0 && (
        <section className="mt-12">
          <div className="mb-5">
            <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-[#EA2831]">
              <span className="material-symbols-outlined text-sm">eco</span> {t("pd.youMayAlsoLike")}
            </p>
            <h2 className="mt-1 font-heading text-2xl font-extrabold tracking-tight text-stone-900 sm:text-3xl">
              {t("pd.similarProducts")}
            </h2>
          </div>

          <div className="relative">
            <div
              ref={railRef}
              className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {railItems.map((p) => (
                <div key={p.listingId} className="w-[46%] shrink-0 snap-start sm:w-[31%] lg:w-[19%]">
                  <HomeProductCard product={p} />
                </div>
              ))}
            </div>

            {railItems.length > 4 && (
              <>
                <button
                  onClick={() => scrollRail(-1)}
                  aria-label={t("pd.scrollLeft")}
                  className="absolute -left-3 top-[38%] hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white text-stone-700 shadow-[0_10px_26px_-12px_rgba(22,25,27,0.55)] ring-1 ring-stone-200 transition-colors hover:bg-[#EA2831] hover:text-white sm:flex"
                >
                  <span className="material-symbols-outlined">chevron_left</span>
                </button>
                <button
                  onClick={() => scrollRail(1)}
                  aria-label={t("pd.scrollRight")}
                  className="absolute -right-3 top-[38%] hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white text-stone-700 shadow-[0_10px_26px_-12px_rgba(22,25,27,0.55)] ring-1 ring-stone-200 transition-colors hover:bg-[#EA2831] hover:text-white sm:flex"
                >
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
              </>
            )}
          </div>

          {gridItems.length > 0 && (
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
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