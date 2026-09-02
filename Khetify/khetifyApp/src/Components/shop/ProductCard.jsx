import React from "react";
import { Link } from "react-router-dom";
import { useT } from "../../context/ShopLanguageContext";
import { getProductImage } from "../../lib/productImage";
import { useCart } from "../../context/CartContext";

const rupee = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

// A single storefront product tile, styled to match the Khetify app (white
// card, stone palette, red accent). Keyed by listingId (the same product from
// two sellers is two tiles). Out-of-stock tiles cannot be added to the cart.
export default function ProductCard({ product }) {
  const { addItem } = useCart();
  const t = useT();
  const img = getProductImage(product.images?.[0]);
  const off = product.mrp && product.mrp > product.price
    ? Math.round(((product.mrp - product.price) / product.mrp) * 100)
    : 0;
  const inStock = product.inStock;

  return (
    <div className="group bg-white rounded-2xl border border-stone-200 hover:shadow-md transition-shadow overflow-hidden flex flex-col">
      <Link to={`/customer-shop/product/${product.listingId}`} className="block relative">
        <div className="aspect-square bg-stone-50 flex items-center justify-center overflow-hidden">
          {img ? (
            <img src={img} alt={product.name} className="w-full h-full object-contain group-hover:scale-105 transition-transform" loading="lazy" />
          ) : (
            <span className="material-symbols-outlined text-stone-300 text-5xl font-light">inventory_2</span>
          )}
        </div>
        {off > 0 && (
          <span className="absolute top-2 left-2 bg-[#EA2831] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{t("common.percentOffCaps", { percent: off })}</span>
        )}
        {!inStock && (
          <span className="absolute top-2 right-2 bg-stone-800/80 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{t("product.outOfStock")}</span>
        )}
      </Link>

      <div className="p-3 flex flex-col flex-1">
        <Link to={`/customer-shop/product/${product.listingId}`} className="block">
          <h3 className="text-sm font-semibold text-stone-900 line-clamp-2 min-h-[2.5rem] group-hover:text-[#EA2831] transition-colors">
            {product.name}
          </h3>
        </Link>
        {product.sku && <p className="text-[10px] text-stone-400 font-mono uppercase tracking-tight mt-0.5">{product.sku}</p>}

        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-lg font-bold text-stone-900">{rupee(product.price)}</span>
          {off > 0 && <span className="text-xs text-stone-400 line-through">{rupee(product.mrp)}</span>}
        </div>

        <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
          {inStock ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><span className="material-symbols-outlined text-sm">check_circle</span>{t("product.inStock")}</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-stone-400 font-semibold"><span className="material-symbols-outlined text-sm">block</span>{t("product.unavailable")}</span>
          )}
        </div>

        {product.seller?.name && (
          <p className="text-[11px] text-stone-400 mt-1 truncate">by {product.seller.name}</p>
        )}

        <button
          onClick={() => addItem(product, 1)}
          disabled={!inStock}
          className="mt-3 w-full py-2 rounded-lg bg-[#EA2831] text-white text-sm font-semibold hover:bg-[#d21f27] transition-colors disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed"
        >
          {inStock ? "Add to Cart" : "Out of stock"}
        </button>
      </div>
    </div>
  );
}

export { rupee };