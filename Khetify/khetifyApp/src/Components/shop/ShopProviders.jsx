import React from "react";
import { Outlet } from "react-router-dom";
import { ShopAuthProvider } from "../../context/ShopAuthContext";
import { CartProvider } from "../../context/CartContext";
import { WishlistProvider } from "../../context/WishlistContext";

/**
 * The storefront's context layer, with NO chrome of its own.
 *
 * Previously the three providers were bolted onto the same route element as
 * <ShopLayout />, which meant "has cart/auth context" and "has the header,
 * footer and bottom nav" were the same decision. A page could not have one
 * without the other.
 *
 * Splitting them lets a route opt out of the chrome while keeping every context:
 *
 *   /customer-shop            → ShopProviders → ShopLayout → header/footer/pages
 *   /customer-shop/order-success → ShopProviders → (bare page, no chrome)
 *
 * Order confirmation is a dead-end moment: the shopper has just paid and needs
 * to read their order, not be re-sold to by a nav bar and a footer sitemap.
 * Every major marketplace strips the chrome here for the same reason.
 */
export default function ShopProviders() {
  return (
    <ShopAuthProvider>
      <CartProvider>
        <WishlistProvider>
          <Outlet />
        </WishlistProvider>
      </CartProvider>
    </ShopAuthProvider>
  );
}