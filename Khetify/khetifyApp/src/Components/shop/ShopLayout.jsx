import React, { useEffect, useMemo, useRef, useState } from "react";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useCart } from "../../context/CartContext";
import { useWishlist } from "../../context/WishlistContext";
import { useShopAuth } from "../../context/ShopAuthContext";
import { getShopProducts } from "../../lib/shopApi";
import CartDrawer from "./CartDrawer";
import SearchSuggestions from "./SearchSuggestions";

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
function SearchForm({ id, value, onChange, onSubmit, compact = false, onFocus, onBlur, inputRef, placeholder = "Search seeds, fertilizers, tools, pesticides..." }) {
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
          placeholder={placeholder}
          className="flex-1 bg-transparent px-2.5 py-2.5 text-sm text-stone-800 outline-none placeholder:text-stone-400"
          aria-label="Search products"
        />
        
      </div>
    </form>
  );
}

// Account dropdown panel. `className` positions it (differs desktop vs mobile).
function AccountMenu({ isAuthed, consumer, redirectPath, onClose, onLogout, className = "" }) {
  const item = "flex items-center gap-2.5 px-4 py-2.5 hover:bg-stone-50";
  return (
    <div className={`overflow-hidden rounded-2xl border border-stone-200 bg-white py-1 text-sm text-stone-700 shadow-xl ${className}`}>
      {isAuthed ? (
        <>
          <div className="border-b border-stone-100 px-4 py-3">
            <p className="font-heading text-sm font-bold text-stone-900">
              Hello, {consumer?.name?.split(" ")[0] || "Farmer"} <span aria-hidden>👋</span>
            </p>
            <p className="truncate text-xs text-stone-400">{consumer?.name}</p>
          </div>
          <Link to={PROFILE_PATH} className={item} onClick={onClose}>
            <span className="material-symbols-outlined text-lg text-stone-400">person</span> My profile
          </Link>
          <Link to="/customer-shop/orders" className={item} onClick={onClose}>
            <span className="material-symbols-outlined text-lg text-stone-400">receipt_long</span> My orders
          </Link>
          <Link to={WISHLIST_PATH} className={item} onClick={onClose}>
            <span className="material-symbols-outlined text-lg text-stone-400">favorite</span> Wishlist
          </Link>
          <Link to="/customer-shop/cart" className={item} onClick={onClose}>
            <span className="material-symbols-outlined text-lg text-stone-400">shopping_cart</span> My cart
          </Link>
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-2.5 border-t border-stone-100 px-4 py-2.5 text-left text-[#EA2831] hover:bg-red-50"
          >
            <span className="material-symbols-outlined text-lg">logout</span> Logout
          </button>
        </>
      ) : (
        <>
          <div className="border-b border-stone-100 px-4 py-3">
            <p className="font-heading text-sm font-bold text-stone-900">Welcome to Khetify</p>
            <p className="text-xs text-stone-400">Access orders, wishlist and faster checkout.</p>
          </div>
          <Link to={LOGIN_PATH} className={item} onClick={onClose}>
            <span className="material-symbols-outlined text-lg text-stone-400">login</span> Login
          </Link>
          <Link to={REGISTER_PATH} className={item} onClick={onClose}>
            <span className="material-symbols-outlined text-lg text-stone-400">person_add</span> Register / Sign up
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
  ), [q, suggestions, suggestionsOpen, suggestionsLoading, suggestionsError]);

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
        placeholder="Search products..."
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
  ), [q, suggestions, isMobileSearchOpen, suggestionsLoading, suggestionsError]);

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
            <Link to="/customer-shop" title="Home" className="flex shrink-0 items-center gap-2">
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
              {isAuthed ? (
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen((v) => !v)}
                    className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-100"
                  >
                    <span className="material-symbols-outlined text-[22px] text-stone-500">account_circle</span>
                    <span className="hidden text-left leading-tight lg:block">
                      <span className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">Account</span>
                      <span className="block max-w-[90px] truncate text-[13px] font-bold text-stone-800">
                        {consumer?.name?.split(" ")[0] || "Account"}
                      </span>
                    </span>
                    <span className="material-symbols-outlined hidden text-base text-stone-400 lg:block">expand_more</span>
                  </button>
                  {menuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                      <AccountMenu isAuthed consumer={consumer} redirectPath={location.pathname} onClose={() => setMenuOpen(false)} onLogout={onLogout} className="absolute right-0 z-50 mt-2 w-60" />
                    </>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link
                    to={LOGIN_PATH}
                    className="rounded-xl px-4 py-2 text-sm font-bold text-stone-700 transition-colors hover:bg-stone-100"
                  >
                    Log in
                  </Link>
                  <Link
                    to={REGISTER_PATH}
                    className="rounded-xl bg-[#14201A] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#20362a]"
                  >
                    Sign up
                  </Link>
                </div>
              )}

              <Link to={WISHLIST_PATH} aria-label="Wishlist" className="relative flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-100">
                <span className="relative">
                  <span className="material-symbols-outlined text-[22px] text-stone-600">favorite</span>
                  {badge(wishlistCount)}
                </span>
                <span className="hidden lg:block">Wishlist</span>
              </Link>

              <button type="button" onClick={() => setCartOpen(true)} aria-label="Cart" className="relative flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-100">
                <span className="relative">
                  <span className="material-symbols-outlined text-[22px] text-stone-600">shopping_cart</span>
                  {badge(count)}
                </span>
                <span className="hidden lg:block">Cart</span>
              </button>
            </div>
          </div>

          {/* ===== Mobile: Khetify wordmark + search (actions moved to bottom bar) ===== */}
          <div className="flex items-center gap-2.5 py-2.5 md:hidden">
            <Link to="/customer-shop" aria-label="Khetify home" title="Home" className="flex shrink-0 items-center gap-2">
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
                {isAuthed ? (consumer?.name?.split(" ")[0] || "Account") : "Account"}
              </span>
            </button>

            {/* Wishlist */}
            <Link to={WISHLIST_PATH} aria-label="Wishlist" className="flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold text-stone-600 transition-colors hover:text-[#EA2831]">
              <span className="relative">
                <span className="material-symbols-outlined text-[24px]">favorite</span>
                {badge(wishlistCount, true)}
              </span>
              Wishlist
            </Link>

            {/* Cart */}
            <button type="button" onClick={() => setCartOpen(true)} aria-label="Cart" className="flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold text-stone-600 transition-colors hover:text-[#EA2831]">
              <span className="relative">
                <span className="material-symbols-outlined text-[24px]">shopping_cart</span>
                {badge(count, true)}
              </span>
              Cart
            </button>

            {/* Shop */}
            <Link to="/customer-shop/products" aria-label="Shop all products" className="flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold text-stone-600 transition-colors hover:text-[#EA2831]">
              <span className="material-symbols-outlined text-[24px]">storefront</span>
              Shop
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
              <Link to="/customer-shop" title="Home" className="flex items-center gap-2">
                <span className="text-xl font-bold tracking-tight text-[#EA2831] transition-opacity hover:opacity-80">
                  Khetify
                </span>
              </Link>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-stone-500">
                A farming marketplace connecting Indian growers and buyers with verified sellers of
                seeds, fertilisers, tools and more. Browse freely — sign in only when you check out.
              </p>
            </div>

            <div>
              <h4 className="text-sm font-bold text-stone-900">Shop</h4>
              <ul className="mt-3 space-y-2 text-sm text-stone-500">
                <li><Link to="/customer-shop/products" className="hover:text-[#EA2831]">All products</Link></li>
                <li><Link to="/customer-shop/products?sort=newest" className="hover:text-[#EA2831]">New arrivals</Link></li>
                <li><Link to="/customer-shop/cart" className="hover:text-[#EA2831]">Your cart</Link></li>
                <li><Link to="/customer-shop/orders" className="hover:text-[#EA2831]">Your orders</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-bold text-stone-900">Account</h4>
              <ul className="mt-3 space-y-2 text-sm text-stone-500">
                <li><Link to={LOGIN_PATH} className="hover:text-[#EA2831]">Login</Link></li>
                <li><Link to={REGISTER_PATH} className="hover:text-[#EA2831]">Create account</Link></li>
                <li><Link to="/customer-shop" className="hover:text-[#EA2831]">Back to store</Link></li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-stone-100 pt-6 text-sm text-stone-400 sm:flex-row">
            <span>© {new Date().getFullYear()} Khetify — agri-products marketplace.</span>
            <Link to="/customer-shop" className="font-medium hover:text-stone-700">Back to store</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}