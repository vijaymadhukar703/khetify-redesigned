import React, { useEffect, useMemo, useRef, useState } from "react";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useCart } from "../../context/CartContext";
import { useWishlist } from "../../context/WishlistContext";
import { useShopAuth } from "../../context/ShopAuthContext";
import { getShopProducts } from "../../lib/shopApi";
import CartDrawer from "./CartDrawer";
import SearchSuggestions from "./SearchSuggestions";
import { useShopLanguage, useT } from "../../context/ShopLanguageContext";

// Shared chrome for the customer storefront. HEADER + mobile bottom-nav only —
// footer, layout wrapper, contexts, auth state, cart state, search handler, and
// every route/link are unchanged. Design: solid white surfaces, stone palette,
// field-green ink (#14201A) + Khetify red (#EA2831) accents, Sora headings /
// Manrope body, Material Symbols icons.

// Login and Register are SEPARATE pages with their own routes, so these links
// point straight at them. (The old "/customer-shop/login?mode=register" hop is
// gone — that pattern is what made Sign up / Login open the wrong page.)
const LOGIN_PATH = "/customer-shop/login";
const REGISTER_PATH = "/customer-shop/register";
const WISHLIST_PATH = "/customer-shop/wishlist";
const PROFILE_PATH = "/customer-shop/profile";

// Stable search component (defined outside the layout so the input is NOT
// remounted on every keystroke — that would drop focus).
// `placeholder` no longer defaults to a literal: a default parameter is
// evaluated OUTSIDE any component that could call t(). Callers pass the
// translated string; the ?? keeps a sane value if one ever forgets.
function SearchForm({ id, value, onChange, onSubmit, compact = false, onFocus, onBlur, inputRef, placeholder }) {
  return (
    <form onSubmit={onSubmit} className="relative w-full">
      <div className="group flex items-center overflow-hidden rounded-full border border-stone-200 bg-stone-50/70 transition-all focus-within:border-[#EA2831] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#EA2831]/15">
        <span className="material-symbols-outlined pl-3.5 text-xl text-stone-400 transition-colors group-focus-within:text-[#EA2831]">search</span>
        <input
          id={id}
          ref={inputRef}
          value={value}
          onChange={onChange}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder ?? ""}
          className="flex-1 bg-transparent px-2.5 py-2.5 text-sm text-stone-800 outline-none placeholder:text-stone-400"
          aria-label="Search products"
        />
        
      </div>
    </form>
  );
}

/**
 * LANGUAGE SELECTOR.
 *
 * A custom dropdown rather than a native <select>, so it can wear the SAME card
 * as the account menu — rounded-2xl, hairline divider, hover rows, ticked
 * current choice. A native select cannot be styled to match, which is why the
 * two controls looked like they came from different products.
 *
 * Still keyboard- and screen-reader-correct: real <button>s, aria-expanded on
 * the trigger, aria-checked on the options, Escape to close, and an invisible
 * full-screen layer that closes it on an outside click (the same pattern the
 * account menu uses).
 */
function LanguageSelect({ compact = false }) {
  const { lang, setLang, languages } = useShopLanguage();
  const t = useT();
  const [open, setOpen] = useState(false);
  const current = languages.find((l) => l.code === lang) || languages[0];

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t("nav.language")}
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-100"
      >
        <span className="material-symbols-outlined text-[20px] text-stone-500">language</span>
        <span className={compact ? "" : "hidden lg:block"}>{compact ? current.short : current.label}</span>
        <span className={`material-symbols-outlined text-base text-stone-400 transition-transform ${open ? "rotate-180" : ""}`}>expand_more</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Centred on the trigger, same card as AccountMenu. */}
          <div
            role="listbox"
            className="absolute left-1/2 z-50 mt-2 w-44 -translate-x-1/2 overflow-hidden rounded-2xl border border-stone-200 bg-white py-1 text-sm text-stone-700 shadow-xl"
          >
            <div className="border-b border-stone-100 px-4 py-3">
              <p className="font-heading text-sm font-bold text-stone-900">{t("nav.language")}</p>
            </div>
            {languages.map((l) => {
              const on = l.code === lang;
              return (
                <button
                  key={l.code}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => { setLang(l.code); setOpen(false); }}
                  className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-stone-50 ${on ? "font-bold text-[#EA2831]" : ""}`}
                >
                  <span className={`material-symbols-outlined text-lg ${on ? "text-[#EA2831]" : "text-transparent"}`}>check</span>
                  {l.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Account dropdown panel. `className` positions it (differs desktop vs mobile).
function AccountMenu({ isAuthed, consumer, redirectPath, onClose, onLogout, className = "" }) {
  const t = useT();
  const item = "flex items-center gap-2.5 px-4 py-2.5 hover:bg-stone-50";
  return (
    <div className={`overflow-hidden rounded-2xl border border-stone-200 bg-white py-1 text-sm text-stone-700 shadow-xl ${className}`}>
      {isAuthed ? (
        <>
          <div className="border-b border-stone-100 px-4 py-3">
            {/* The NAME is data — interpolated, never translated. */}
            <p className="font-heading text-sm font-bold text-stone-900">
              {t("account.greeting", { name: consumer?.name?.split(" ")[0] || t("account.fallbackName") })} <span aria-hidden>👋</span>
            </p>
            <p className="truncate text-xs text-stone-400">{consumer?.name}</p>
          </div>
          <Link to={PROFILE_PATH} className={item} onClick={onClose}>
            <span className="material-symbols-outlined text-lg text-stone-400">person</span> {t("account.myProfile")}
          </Link>
          <Link to="/customer-shop/orders" className={item} onClick={onClose}>
            <span className="material-symbols-outlined text-lg text-stone-400">receipt_long</span> {t("account.myOrders")}
          </Link>
          <Link to={WISHLIST_PATH} className={item} onClick={onClose}>
            <span className="material-symbols-outlined text-lg text-stone-400">favorite</span> {t("account.wishlist")}
          </Link>
          <Link to="/customer-shop/cart" className={item} onClick={onClose}>
            <span className="material-symbols-outlined text-lg text-stone-400">shopping_cart</span> {t("account.myCart")}
          </Link>
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-2.5 border-t border-stone-100 px-4 py-2.5 text-left text-[#EA2831] hover:bg-red-50"
          >
            <span className="material-symbols-outlined text-lg">logout</span> {t("account.logout")}
          </button>
        </>
      ) : (
        <>
          <div className="border-b border-stone-100 px-4 py-3">
            <p className="font-heading text-sm font-bold text-stone-900">{t("account.welcome")}</p>
            <p className="text-xs text-stone-400">{t("account.welcomeSub")}</p>
          </div>
          <Link to={LOGIN_PATH} className={item} onClick={onClose}>
            <span className="material-symbols-outlined text-lg text-stone-400">login</span> {t("account.loginLink")}
          </Link>
          <Link to={REGISTER_PATH} className={item} onClick={onClose}>
            <span className="material-symbols-outlined text-lg text-stone-400">person_add</span> {t("account.registerLink")}
          </Link>
        </>
      )}
    </div>
  );
}

export default function ShopLayout() {
  const { count } = useCart();
  const { count: wishlistCount } = useWishlist();
  const { isAuthed, consumer, logout } = useShopAuth();
  const navigate = useNavigate();
  const t = useT();
  const location = useLocation();
  const [q, setQ] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState("");
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const desktopRef = useRef(null);
  const mobileOverlayRef = useRef(null);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const submitSearch = (e) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setSuggestionsOpen(false);
    setIsMobileSearchOpen(false);
    navigate(`/customer-shop/products?search=${encodeURIComponent(term)}`);
  };

  const onLogout = () => { logout(); setMenuOpen(false); navigate("/customer-shop"); };
  const onQ = (e) => {
    const nextValue = e.target.value;
    setQ(nextValue);
    setSuggestionsError("");
    setSuggestionsOpen(true);
    if (!nextValue.trim()) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const res = await getShopProducts({ search: nextValue.trim(), limit: 8 });
        const items = Array.isArray(res?.data) ? res.data : [];
        setSuggestions(items.map((item) => ({ name: item.name, listingId: item.listingId })));
        setSuggestionsError("");
      } catch (error) {
        setSuggestions([]);
        setSuggestionsError(error?.response?.data?.message || "Could not load suggestions");
      } finally {
        setSuggestionsLoading(false);
      }
    }, 350);
  };

  const handleSelectSuggestion = (value) => {
    const term = value.trim();
    if (!term) return;
    setQ(term);
    setSuggestions([]);
    setSuggestionsOpen(false);
    setIsMobileSearchOpen(false);
    navigate(`/customer-shop/products?search=${encodeURIComponent(term)}`);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (desktopRef.current && !desktopRef.current.contains(event.target)) {
        setSuggestionsOpen(false);
      }
      if (isMobileSearchOpen && mobileOverlayRef.current && !mobileOverlayRef.current.contains(event.target)) {
        setIsMobileSearchOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.body.style.overflow = isMobileSearchOpen ? "hidden" : "";

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.body.style.overflow = "";
    };
  }, [isMobileSearchOpen]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const desktopSearch = useMemo(() => (
    <div className="relative" ref={desktopRef}>
      <SearchForm
        id="shop-search-desktop"
        value={q}
        onChange={onQ}
        onSubmit={submitSearch}
        onFocus={() => setSuggestionsOpen(true)}
        onBlur={() => setTimeout(() => setSuggestionsOpen(false), 120)}
        inputRef={inputRef}
        placeholder={t("nav.searchPlaceholder")}
      />
      <SearchSuggestions
        open={suggestionsOpen}
        query={q}
        suggestions={suggestions}
        loading={suggestionsLoading}
        error={suggestionsError}
        onSelect={handleSelectSuggestion}
        onClose={() => setSuggestionsOpen(false)}
        onInputChange={onQ}
        onInputFocus={() => setSuggestionsOpen(true)}
        inputId="shop-search-desktop"
      />
    </div>
  ), [q, suggestions, suggestionsOpen, suggestionsLoading, suggestionsError, t]);

  const mobileSearch = useMemo(() => (
    <div className="relative min-w-0 flex-1">
      <SearchForm
        id="shop-search-mobile"
        value={q}
        onChange={onQ}
        onSubmit={submitSearch}
        compact
        onFocus={() => setIsMobileSearchOpen(true)}
        onBlur={() => setTimeout(() => setSuggestionsOpen(false), 120)}
        inputRef={inputRef}
        placeholder={t("nav.searchPlaceholder")}
      />
      {isMobileSearchOpen && (
        <SearchSuggestions
          open={isMobileSearchOpen}
          query={q}
          suggestions={suggestions}
          loading={suggestionsLoading}
          error={suggestionsError}
          onSelect={handleSelectSuggestion}
          onClose={() => setIsMobileSearchOpen(false)}
          onInputChange={onQ}
          onInputFocus={() => setIsMobileSearchOpen(true)}
          inputId="shop-search-mobile"
          isMobile
          overlayRef={mobileOverlayRef}
          onSubmit={submitSearch}
        />
      )}
    </div>
  ), [q, suggestions, isMobileSearchOpen, suggestionsLoading, suggestionsError, t]);

  const badge = (n, mobile = false) =>
    n > 0 ? (
      <span className={`absolute flex items-center justify-center rounded-full border-2 border-white bg-[#EA2831] font-bold text-white ${mobile ? "-right-2 -top-1.5 h-4 min-w-[16px] px-1 text-[9px]" : "-right-2 -top-2 h-[18px] min-w-[18px] px-1 text-[10px]"}`}>
        {n}
      </span>
    ) : null;

  return (
    <div className="flex min-h-screen flex-col bg-stone-50/50 pb-20 font-heading text-stone-900 md:pb-0">
      {/* ── Header (solid white) ── */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-stone-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          {/* ===== Desktop / tablet: Logo | Search | Account | Wishlist | Cart ===== */}
          <div className="hidden items-center gap-6 py-3.5 md:flex">
            <Link to="/customer-shop" title={t("common.home")} className="flex shrink-0 items-center gap-2">
              <span className="text-xl font-bold tracking-tight text-[#EA2831] transition-opacity hover:opacity-80">
                Khetify
              </span>
            </Link>

            <div className="min-w-0 flex-1">
              <div className="mx-auto max-w-2xl">
                {desktopSearch}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {/* Language sits first in the actions row, left of Account — a
                  site-wide preference rather than an account action. */}
              <LanguageSelect />

              {isAuthed ? (
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen((v) => !v)}
                    className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-100"
                  >
                    <span className="material-symbols-outlined text-[22px] text-stone-500">account_circle</span>
                    <span className="hidden text-left leading-tight lg:block">
                      <span className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">{t("nav.account")}</span>
                      <span className="block max-w-[90px] truncate text-[13px] font-bold text-stone-800">
                        {consumer?.name?.split(" ")[0] || t("nav.account")}
                      </span>
                    </span>
                    <span className="material-symbols-outlined hidden text-base text-stone-400 lg:block">expand_more</span>
                  </button>
                  {menuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                      {/* CENTRED on the trigger (left-1/2 + -translate-x-1/2) rather than
                          anchored to its right edge — the panel is much wider than
                          the button, so right-0 hung the whole card off to the left. */}
                      <AccountMenu isAuthed consumer={consumer} redirectPath={location.pathname} onClose={() => setMenuOpen(false)} onLogout={onLogout} className="absolute left-1/2 z-50 mt-2 w-60 -translate-x-1/2" />
                    </>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link
                    to={LOGIN_PATH}
                    className="rounded-xl px-4 py-2 text-sm font-bold text-stone-700 transition-colors hover:bg-stone-100"
                  >
                    {t("nav.login")}
                  </Link>
                  <Link
                    to={REGISTER_PATH}
                    className="rounded-xl bg-[#14201A] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#20362a]"
                  >
                    {t("nav.signup")}
                  </Link>
                </div>
              )}

              <Link to={WISHLIST_PATH} aria-label="Wishlist" className="relative flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-100">
                <span className="relative">
                  <span className="material-symbols-outlined text-[22px] text-stone-600">favorite</span>
                  {badge(wishlistCount)}
                </span>
                <span className="hidden lg:block">{t("nav.wishlist")}</span>
              </Link>

              <button type="button" onClick={() => setCartOpen(true)} aria-label="Cart" className="relative flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-100">
                <span className="relative">
                  <span className="material-symbols-outlined text-[22px] text-stone-600">shopping_cart</span>
                  {badge(count)}
                </span>
                <span className="hidden lg:block">{t("nav.cart")}</span>
              </button>
            </div>
          </div>

          {/* ===== Mobile: Khetify wordmark + search (actions moved to bottom bar) ===== */}
          <div className="flex items-center gap-2.5 py-2.5 md:hidden">
            <Link to="/customer-shop" aria-label="Khetify home" title={t("common.home")} className="flex shrink-0 items-center gap-2">
              <span className="whitespace-nowrap text-xl font-bold tracking-tight text-[#EA2831] transition-opacity hover:opacity-80">
                Khetify
              </span>
            </Link>
            <div className="min-w-0 flex-1">
              {mobileSearch}
            </div>
          </div>
        </div>
      </header>

      {/* Slide-in cart drawer (opens from the cart icon; "View cart" opens the full page) */}
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />

      {/* ShopLayout.jsx ke andar Outlet ko badal kar state share karein */}
      <main className="w-full flex-1 pt-[56px] md:pt-[64px]">
        <Outlet context={{ setQ }} />
      </main>

      {/* ── Mobile bottom navigation (Account · Wishlist · Cart · Shop) ── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white shadow-[0_-4px_16px_-8px_rgba(20,32,26,0.15)] md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="relative mx-auto max-w-7xl">
          <div className="grid grid-cols-4">
            {/* Account */}
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Account"
              className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold transition-colors ${menuOpen ? "text-[#EA2831]" : "text-stone-600"}`}
            >
              <span className="material-symbols-outlined text-[24px]">account_circle</span>
              <span className="max-w-full truncate px-1">
                {isAuthed ? (consumer?.name?.split(" ")[0] || t("nav.account")) : t("nav.account")}
              </span>
            </button>

            {/* Wishlist */}
            <Link to={WISHLIST_PATH} aria-label="Wishlist" className="flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold text-stone-600 transition-colors hover:text-[#EA2831]">
              <span className="relative">
                <span className="material-symbols-outlined text-[24px]">favorite</span>
                {badge(wishlistCount, true)}
              </span>
              {t("nav.wishlist")}
            </Link>

            {/* Cart */}
            <button type="button" onClick={() => setCartOpen(true)} aria-label="Cart" className="flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold text-stone-600 transition-colors hover:text-[#EA2831]">
              <span className="relative">
                <span className="material-symbols-outlined text-[24px]">shopping_cart</span>
                {badge(count, true)}
              </span>
              {t("nav.cart")}
            </button>

            {/* Shop */}
            <Link to="/customer-shop/products" aria-label="Shop all products" className="flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold text-stone-600 transition-colors hover:text-[#EA2831]">
              <span className="material-symbols-outlined text-[24px]">storefront</span>
              {t("nav.shop")}
            </Link>
          </div>

          {/* Account dropdown — opens upward, spans the bar width */}
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <AccountMenu
                isAuthed={isAuthed}
                consumer={consumer}
                redirectPath={location.pathname}
                onClose={() => setMenuOpen(false)}
                onLogout={onLogout}
                className="absolute bottom-full left-2 right-2 z-50 mb-2"
              />
            </>
          )}
        </div>
      </nav>

      {/* ── Footer (unchanged) ── */}
      <footer className="mt-auto border-t border-stone-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <Link to="/customer-shop" title={t("common.home")} className="flex items-center gap-2">
                <span className="text-xl font-bold tracking-tight text-[#EA2831] transition-opacity hover:opacity-80">
                  Khetify
                </span>
              </Link>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-stone-500">
                {t("footer.tagline")}
              </p>
            </div>

            <div>
              <h4 className="text-sm font-bold text-stone-900">{t("footer.shop")}</h4>
              <ul className="mt-3 space-y-2 text-sm text-stone-500">
                <li><Link to="/customer-shop/products" className="hover:text-[#EA2831]">{t("footer.allProducts")}</Link></li>
                <li><Link to="/customer-shop/products?sort=newest" className="hover:text-[#EA2831]">{t("footer.newArrivals")}</Link></li>
                <li><Link to="/customer-shop/cart" className="hover:text-[#EA2831]">{t("footer.yourCart")}</Link></li>
                <li><Link to="/customer-shop/orders" className="hover:text-[#EA2831]">{t("footer.yourOrders")}</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-bold text-stone-900">{t("footer.account")}</h4>
              <ul className="mt-3 space-y-2 text-sm text-stone-500">
                <li><Link to={LOGIN_PATH} className="hover:text-[#EA2831]">{t("account.loginLink")}</Link></li>
                <li><Link to={REGISTER_PATH} className="hover:text-[#EA2831]">{t("footer.createAccount")}</Link></li>
                <li><Link to="/customer-shop" className="hover:text-[#EA2831]">{t("footer.backToStore")}</Link></li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-stone-100 pt-6 text-sm text-stone-400 sm:flex-row">
            {/* The YEAR is data — interpolated, never translated. */}
            <span>{t("footer.copyright", { year: new Date().getFullYear() })}</span>
            <Link to="/customer-shop" className="font-medium hover:text-stone-700">{t("footer.backToStore")}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}