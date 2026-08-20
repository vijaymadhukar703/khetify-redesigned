import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useShopAuth } from "./ShopAuthContext";

// Guest cart lives in localStorage so a shopper can browse and add to cart
// WITHOUT logging in. Login is only required at checkout.
//
// IMPORTANT (user-data isolation): storage is scoped PER USER. Each logged-in
// consumer has their own slot "shopCart:<id>"; guests use "shopCart:guest".
// When the logged-in identity changes we load that identity's own cart, so one
// account can never see another account's items. On login the guest cart is
// folded into the user's cart once, then the guest slot is cleared.
const KEY_PREFIX = "shopCart:";
const LEGACY_KEY = "shopCart"; // pre-scoping (shared) key — migrated once.
const CartContext = createContext(null);

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

// One-time: fold any legacy unscoped cart into the guest slot so an in-progress
// guest shopper doesn't lose their cart on upgrade. Idempotent.
function migrateLegacy() {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy != null) {
      if (localStorage.getItem(keyFor(null)) == null) localStorage.setItem(keyFor(null), legacy);
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch { /* ignore */ }
}

// Merge two carts: sum quantities for the same line, clamp to available stock.
function mergeCarts(base, extra) {
  const map = new Map(base.map((i) => [i.listingId, { ...i }]));
  for (const g of extra) {
    const ex = map.get(g.listingId);
    if (ex) {
      const cap = Number.isFinite(ex.availableStock) && ex.availableStock > 0 ? ex.availableStock : Infinity;
      ex.qty = Math.min((ex.qty || 0) + (g.qty || 0), cap);
    } else {
      map.set(g.listingId, { ...g });
    }
  }
  return [...map.values()];
}

export function CartProvider({ children }) {
  const { consumer } = useShopAuth();
  const userId = consumer?._id || consumer?.id || consumer?.email || consumer?.phone || null;

  const [items, setItems] = useState(() => { migrateLegacy(); return read(keyFor(userId)); });
  const keyRef = useRef(keyFor(userId));
  const prevIdRef = useRef(userId);

  // React to identity changes: login (guest -> user), logout, or account switch.
  useEffect(() => {
    if (prevIdRef.current === userId) return;
    const prevId = prevIdRef.current;
    const newKey = keyFor(userId);

    if (!prevId && userId) {
      // Guest -> logged in: fold the guest cart into this user's own cart once,
      // then clear the guest slot so it can't leak into a future account.
      const merged = mergeCarts(read(newKey), read(keyFor(null)));
      write(newKey, merged);
      localStorage.removeItem(keyFor(null));
      keyRef.current = newKey;
      setItems(merged);
    } else {
      // Logout or switch to another identity: load ONLY that identity's cart.
      keyRef.current = newKey;
      setItems(read(newKey));
    }
    prevIdRef.current = userId;
  }, [userId]);

  // Persist to the currently active (scoped) key.
  useEffect(() => { write(keyRef.current, items); }, [items]);

  // Sync across tabs — only for the active key.
  useEffect(() => {
    const onStorage = (e) => { if (e.key === keyRef.current) setItems(read(keyRef.current)); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ── Public API (unchanged behaviour) ──
  const addItem = useCallback((product, addQty = 1) => {
    const inc = Math.max(1, Math.floor(Number(addQty) || 1));
    const max = Number.isFinite(product.availableStock) && product.availableStock > 0
      ? product.availableStock
      : Infinity;

    setItems((prev) => {
      const idx = prev.findIndex((i) => i.listingId === product.listingId);
      if (idx >= 0) {
        const next = [...prev];
        const cap = Number.isFinite(next[idx].availableStock) && next[idx].availableStock > 0
          ? next[idx].availableStock
          : max;
        next[idx] = { ...next[idx], qty: Math.min(next[idx].qty + inc, cap) };
        return next;
      }
      return [...prev, {
        listingId: product.listingId,
        productId: product.productId,
        sellerId: product.sellerId,
        name: product.name,
        price: product.price,
        image: product.images?.[0] || null,
        unit: product.unit,
        sellerName: product.seller?.name,
        availableStock: Number.isFinite(product.availableStock) ? product.availableStock : null,
        qty: Math.min(inc, max),
      }];
    });
  }, []);

  const setQty = useCallback((listingId, qty) => {
    setItems((prev) =>
      prev.flatMap((i) => {
        if (i.listingId !== listingId) return [i];
        const cap = Number.isFinite(i.availableStock) && i.availableStock > 0 ? i.availableStock : Infinity;
        const n = Math.min(Math.max(0, Math.floor(Number(qty) || 0)), cap);
        return n <= 0 ? [] : [{ ...i, qty: n }];
      })
    );
  }, []);

  const removeItem = useCallback((listingId) => {
    setItems((prev) => prev.filter((i) => i.listingId !== listingId));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const { count, subtotal } = useMemo(() => ({
    count: items.reduce((s, i) => s + i.qty, 0),
    subtotal: items.reduce((s, i) => s + i.qty * (i.price || 0), 0),
  }), [items]);

  return (
    <CartContext.Provider value={{ items, addItem, setQty, removeItem, clearCart, count, subtotal }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}