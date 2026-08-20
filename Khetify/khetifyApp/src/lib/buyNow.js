/**
 * "Buy now" — a one-product checkout that DOES NOT touch the cart.
 *
 * The bug this fixes: Buy Now used to call addItem(product, qty) and then
 * navigate to /checkout. That pushed the product into the cart, so checkout
 * showed the ENTIRE cart — the shopper wanted to buy one thing and was shown
 * five. It also silently mutated the cart just because they looked at a
 * product page.
 *
 * How it works now:
 *   ShopProductDetail → setBuyNowItem(item) → /customer-shop/checkout?mode=buynow
 *   ShopCheckout      → sees ?mode=buynow → reads THIS item → renders only it
 *   after the order   → clearBuyNow()  (the cart is never cleared)
 *
 * Why sessionStorage and not router state: router state is lost on refresh, so
 * a shopper who reloads the checkout page would suddenly see their whole cart
 * instead of the one item they meant to buy. The ?mode=buynow query param
 * survives a refresh, and this key holds the item to go with it.
 *
 * sessionStorage (not localStorage) on purpose: a pending buy-now should die
 * with the tab, never linger into a future visit.
 */

const KEY = "khetify:buyNow";

/** Shape a catalog product into a cart-style line. Mirrors CartContext.addItem
 *  exactly, so ShopCheckout can render either source with the same code. */
export function toBuyNowItem(product, qty = 1) {
  const max =
    Number.isFinite(product.availableStock) && product.availableStock > 0
      ? product.availableStock
      : Infinity;
  const n = Math.max(1, Math.floor(Number(qty) || 1));

  return {
    listingId: product.listingId,
    productId: product.productId,
    sellerId: product.sellerId,
    name: product.name,
    price: product.price,
    image: product.images?.[0] || null,
    unit: product.unit,
    sellerName: product.seller?.name,
    availableStock: Number.isFinite(product.availableStock) ? product.availableStock : null,
    qty: Math.min(n, max),
  };
}

export function setBuyNowItem(item) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(item));
    return true;
  } catch {
    return false; // private mode / quota — the caller falls back to the cart flow
  }
}

export function getBuyNowItem() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const item = JSON.parse(raw);
    return item && item.listingId ? item : null;
  } catch {
    return null;
  }
}

export function clearBuyNowItem() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}