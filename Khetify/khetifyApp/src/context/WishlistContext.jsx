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

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
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

// Union by listingId (wishlist has no quantities).
function mergeLists(base, extra) {
  const map = new Map(base.map((i) => [i.listingId, i]));
  for (const g of extra) if (!map.has(g.listingId)) map.set(g.listingId, g);
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

  // ── Public API (unchanged behaviour) ──
  const isWishlisted = useCallback(
    (listingId) => items.some((i) => i.listingId === listingId),
    [items]
  );

  const addItem = useCallback((product) => {
    setItems((prev) =>
      prev.some((i) => i.listingId === product.listingId) ? prev : [...prev, product]
    );
  }, []);

  const removeItem = useCallback((listingId) => {
    setItems((prev) => prev.filter((i) => i.listingId !== listingId));
  }, []);

  const toggleItem = useCallback((product) => {
    setItems((prev) =>
      prev.some((i) => i.listingId === product.listingId)
        ? prev.filter((i) => i.listingId !== product.listingId)
        : [...prev, product]
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