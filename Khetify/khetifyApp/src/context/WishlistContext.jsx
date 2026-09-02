import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useShopAuth } from "./ShopAuthContext";

// Guest wishlist lives in localStorage (same approach as the cart).
//
// IMPORTANT (user-data isolation): storage is scoped PER USER. Each logged-in
// consumer has their own slot "shopWishlist:<id>"; guests use
// "shopWishlist:guest". The active identity's list is loaded on identity change
// so one account never sees another's saved items. On login the guest list is
// folded into the user's list once, then the guest slot is cleared.
const KEY_PREFIX = "shopWishlist:";
const LEGACY_KEY = "shopWishlist"; // pre-scoping (shared) key — migrated once.
const WishlistContext = createContext(null);

const keyFor = (id) => `${KEY_PREFIX}${id || "guest"}`;

/**
 * THE WISHLIST ENTRY KEY — the same rule the cart uses.
 *
 * A saved item must remember WHICH variant was saved: "Red" and "Green" are two
 * different things at two possible prices, so listingId alone can no longer
 * identify an entry. With no variant the key IS the listingId, so every
 * existing caller and every already-saved list keeps working untouched.
 */
export const wishKey = (listingId, variantId) =>
  (variantId ? `${listingId}::${variantId}` : String(listingId));

/** Lists saved before wishId existed; derive it on read. */
const withWishId = (i) => (i.wishId ? i : { ...i, wishId: wishKey(i.listingId, i.variantId) });

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(withWishId) : [];
  } catch { return []; }
}
function write(key, items) {
  try { localStorage.setItem(key, JSON.stringify(items)); } catch { /* ignore */ }
}

function migrateLegacy() {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy != null) {
      if (localStorage.getItem(keyFor(null)) == null) localStorage.setItem(keyFor(null), legacy);
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch { /* ignore */ }
}

// Union by wishId (wishlist has no quantities).
function mergeLists(base, extra) {
  const map = new Map(base.map((i) => [i.wishId, i]));
  for (const g of extra) if (!map.has(g.wishId)) map.set(g.wishId, g);
  return [...map.values()];
}

export function WishlistProvider({ children }) {
  const { consumer } = useShopAuth();
  const userId = consumer?._id || consumer?.id || consumer?.email || consumer?.phone || null;

  const [items, setItems] = useState(() => { migrateLegacy(); return read(keyFor(userId)); });
  const keyRef = useRef(keyFor(userId));
  const prevIdRef = useRef(userId);

  useEffect(() => {
    if (prevIdRef.current === userId) return;
    const prevId = prevIdRef.current;
    const newKey = keyFor(userId);

    if (!prevId && userId) {
      // Guest -> logged in: fold guest list into the user's list once, clear guest.
      const merged = mergeLists(read(newKey), read(keyFor(null)));
      write(newKey, merged);
      localStorage.removeItem(keyFor(null));
      keyRef.current = newKey;
      setItems(merged);
    } else {
      // Logout or account switch: load ONLY that identity's list.
      keyRef.current = newKey;
      setItems(read(newKey));
    }
    prevIdRef.current = userId;
  }, [userId]);

  useEffect(() => { write(keyRef.current, items); }, [items]);

  useEffect(() => {
    const onStorage = (e) => { if (e.key === keyRef.current) setItems(read(keyRef.current)); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /* ── Public API ──
     `variant` is OPTIONAL everywhere. Omitted (every pre-existing caller) the
     behaviour is byte-for-byte what it was: keyed on listingId alone. */

  const isWishlisted = useCallback(
    (listingId, variantId) => {
      const id = wishKey(listingId, variantId);
      return items.some((i) => (i.wishId || i.listingId) === id);
    },
    [items]
  );

  /** The saved entry: the product, plus a snapshot of the chosen variant so the
   *  wishlist card can show ITS image, ITS price and ITS label — not the
   *  product's default, which is not what the shopper saved. */
  const entryFor = (product, variant) => ({
    ...product,
    wishId: wishKey(product.listingId, variant?.id),
    variantId: variant?.id || null,
    variantLabel: variant?.label || null,
    variantAttributes: variant?.attributes || null,
    variantImage: variant?.image || null,
    variantPrice: variant?.mrp != null ? Number(variant.mrp) : null,
  });

  const addItem = useCallback((product, variant = null) => {
    const entry = entryFor(product, variant);
    setItems((prev) =>
      prev.some((i) => (i.wishId || i.listingId) === entry.wishId) ? prev : [...prev, entry]
    );
  }, []);

  // `id` is a wishId. For an item with no variant that IS its listingId, so
  // callers that still pass a listingId keep working unchanged.
  const removeItem = useCallback((id) => {
    setItems((prev) => prev.filter((i) => (i.wishId || i.listingId) !== id));
  }, []);

  const toggleItem = useCallback((product, variant = null) => {
    const entry = entryFor(product, variant);
    setItems((prev) =>
      prev.some((i) => (i.wishId || i.listingId) === entry.wishId)
        ? prev.filter((i) => (i.wishId || i.listingId) !== entry.wishId)
        : [...prev, entry]
    );
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const count = useMemo(() => items.length, [items]);

  return (
    <WishlistContext.Provider value={{ items, addItem, removeItem, toggleItem, isWishlisted, clear, count }}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used within WishlistProvider");
  return ctx;
}