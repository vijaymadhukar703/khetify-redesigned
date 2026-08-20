import React, { memo, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "../../context/CartContext";
import { getProductImage } from "../../lib/productImage";
import { rupee } from "../../Components/shop/ProductCard";

/* ── Configurable values (dynamic-ready; change here or wire to API later) ── */
const DELIVERY_ETA_DAYS = 3;      // estimated delivery = today + N days


// Dynamic estimated-delivery label (recomputed from today's date).
const estimatedDeliveryLabel = (days = DELIVERY_ETA_DAYS) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

/* ── STEPPER COMPONENT ── */
const QtyStepper = memo(function QtyStepper({ item, setQty }) {
  const atMax = Number.isFinite(item.availableStock) && item.availableStock > 0 && item.qty >= item.availableStock;
  return (
    <div className="inline-flex items-center rounded border border-stone-300 bg-white">
      <button
        onClick={() => setQty(item.listingId, item.qty - 1)}
        className="flex size-7 items-center justify-center font-bold text-stone-600 hover:bg-stone-50"
      >
        <span className="material-symbols-outlined text-sm">remove</span>
      </button>
      <span className="w-8 text-center text-xs font-bold text-stone-900">{item.qty}</span>
      <button
        onClick={() => setQty(item.listingId, item.qty + 1)}
        disabled={atMax}
        className="flex size-7 items-center justify-center font-bold text-stone-600 hover:bg-stone-50 disabled:opacity-30"
      >
        <span className="material-symbols-outlined text-sm">add</span>
      </button>
    </div>
  );
});

/* ── INDIVIDUAL ITEM CARD (Separated Boxes Style) ── */
const CartLine = memo(function CartLine({ item, setQty, removeItem }) {
  const img = getProductImage(item.image);
  const href = `/customer-shop/product/${item.listingId}`;
  const hasDiscount = item.mrp && item.mrp > item.price;
  const offPercentage = hasDiscount ? Math.round(((item.mrp - item.price) / item.mrp) * 100) : 0;

  return (
    <div className="bg-white border border-stone-200 shadow-sm rounded-sm p-4 sm:p-6">
      <div className="flex gap-4 items-start">
        {/* Product Visual Container */}
        <div className="flex flex-col items-center shrink-0 gap-3">
          <Link to={href} className="flex size-20 items-center justify-center border border-stone-100 rounded bg-white">
            {img ? <img src={img} alt={item.name} className="h-full w-full object-contain p-1" /> : <span className="material-symbols-outlined text-2xl text-stone-300">eco</span>}
          </Link>
          <QtyStepper item={item} setQty={setQty} />
        </div>

        {/* Info & Details */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
            <Link to={href} className="text-sm text-stone-900 hover:text-[#EA2831] line-clamp-2 leading-tight pr-2 font-normal">
              {item.name}
            </Link>
            <span className="text-xs text-stone-500 whitespace-nowrap mt-1 sm:mt-0">Delivery by {estimatedDeliveryLabel()}</span>
          </div>

          {item.sellerName && (
            <p className="text-xs text-stone-400 mt-1 flex items-center gap-1">
              Seller: <span className="text-stone-700">{item.sellerName}</span>
              <span className="bg-emerald-600 text-white rounded px-1 py-0.2 text-[8px] font-bold uppercase scale-90 origin-left">K-Assured</span>
            </p>
          )}

          <div className="mt-2 flex items-baseline gap-2">
            {hasDiscount && <span className="text-xs text-stone-400 line-through">{rupee(item.mrp * item.qty)}</span>}
            <span className="text-base font-bold text-stone-900">{rupee(item.price * item.qty)}</span>
            {hasDiscount && <span className="text-xs text-emerald-600 font-semibold">{offPercentage}% Off</span>}
          </div>
        </div>
      </div>

      {/* Footer Actions inside Card */}
      <div className="mt-4 pt-3 border-t border-stone-100 flex gap-6 items-center">
        <button className="text-xs font-bold text-stone-700 uppercase tracking-wide hover:text-[#EA2831]">SAVE FOR LATER</button>
        <button onClick={() => removeItem(item.listingId)} className="text-xs font-bold text-stone-700 uppercase tracking-wide hover:text-[#EA2831]">REMOVE</button>
      </div>
    </div>
  );
});

/* ── MAIN SHOP CART FUNCTION ── */
export default function ShopCart() {
  const { items, setQty, removeItem, subtotal, count } = useCart();
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // Price Calculations
  const totalMrp = items.reduce((sum, it) => sum + (it.mrp || it.price) * it.qty, 0);
  const totalSavings = totalMrp - subtotal;
  
  const grandTotal = subtotal;

  /* ── DYNAMIC API CALL FOR RELATED SUGGESTIONS ── */
  useEffect(() => {
    if (items.length === 0) return;

    // Cart me jo items hain unki unique categories nikalna (e.g., ['Seeds', 'Fertilizer'])
    const categoriesInCart = [...new Set(items.map(item => item.category).filter(Boolean))];

    if (categoriesInCart.length === 0) return;

    const fetchRelatedProducts = async () => {
      setLoadingSuggestions(true);
      try {
        // Aapki Backend API URL jahan category wise products filter hote hon
        // Example: /api/products?categories=Seeds,Fertilizer
        const queryParams = categoriesInCart.join(",");
        const response = await fetch(`/api/products?categories=${queryParams}`);
        if (response.ok) {
          const data = await response.json();
          
          // Cart me already added products ko suggestions list se remove karna
          const cartItemIds = items.map(item => item.listingId);
          const filteredSuggestions = data.filter(prod => !cartItemIds.includes(prod.listingId));
          
          // Max 4 suggestions hi show karenge layout ke hissab se
          setSuggestions(filteredSuggestions.slice(0, 4));
        }
      } catch (error) {
        console.error("Error fetching related products suggestions:", error);
      } finally {
        setLoadingSuggestions(false);
      }
    };

    fetchRelatedProducts();
  }, [items]); // Jab bhi cart items change honge, suggestions update honge

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 text-center">
        <div className="bg-white border border-stone-200 rounded p-8 shadow-sm">
          <h1 className="text-lg font-medium text-stone-800">Your Cart is Empty</h1>
          <Link to="/customer-shop/products" className="mt-4 inline-block bg-[#EA2831] text-white text-xs font-bold tracking-wide uppercase px-8 py-3 rounded">Shop Now</Link>
        </div>
      </div>
    );
  }

  return (
<div className="bg-stone-100 min-h-[50vh] pb-6">
        <div className="mx-auto max-w-6xl px-2 py-6 sm:px-4">
        
        {/* Top Header Block — With Integrated Back Button */}
{/* ── ⚡ FIXED ROW: Cart page ke liye button extreme left aur heading fixed ── */}
{/* Top Header Block — Standardized Icon-Only Back Button */}
<div className="mb-4 flex items-center">
  
  {/* 🛠️ sm:pl-28 Container: Right side shift + 100% vertical alignment */}
  <div className="min-w-0 sm:pl-1">
    <div className="relative flex items-center gap-2.5">
      
      {/* Back Arrow Icon: Textless, floating at -left-9 before 'M' */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Go back"
        className="no-print hidden sm:inline-flex absolute -left-9 shrink-0 items-center justify-center text-stone-800 transition-colors duration-150 hover:text-[#EA2831]"
      >
        <span className="material-symbols-outlined text-[24px] sm:text-[26px] font-bold leading-none">
          arrow_back
        </span>
      </button>

      {/* Main Heading Content */}
      <h1 className="text-lg font-bold text-stone-800 sm:text-xl leading-none">
        My Cart ({count})
      </h1>
      
    </div>
  </div>

</div>

        <div className="grid gap-4 lg:grid-cols-3 items-start">
          
          {/* LEFT CONTAINER LAYER */}
          <div className="lg:col-span-2 space-y-4">
            
            

            {/* PRODUCT BOXES WITH SEPARATED SPACING */}
            <div className="space-y-4">
              {items.map((it) => (
                <CartLine key={it.listingId} item={it} setQty={setQty} removeItem={removeItem} />
              ))}
              
              {/* PLACE ORDER Button Inside Left Section at the exact Bottom */}
              {/* <div className="flex justify-end p-4 border border-stone-200 rounded-sm bg-white shadow-sm">
                <button
                  onClick={() => navigate("/customer-shop/checkout")}
                  className="bg-[#EA2831] text-white text-sm font-bold uppercase tracking-wider px-12 py-3 rounded-sm shadow-md hover:bg-[#c91e26] transition-all active:scale-95"
                >
                  PLACE ORDER
                </button>
              </div> */}
            </div>

            {/* DYNAMIC SUGGESTION SECTION (Items you may have missed) */}
            {suggestions.length > 0 && !loadingSuggestions && (
              <div className="bg-white border border-stone-200 rounded-sm shadow-sm p-4 mt-6">
                <h2 className="text-sm font-semibold text-stone-800 mb-4">Items you may have missed</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {suggestions.map((prod) => {
                    const sImg = getProductImage(prod.image);
                    const sHasDiscount = prod.mrp && prod.mrp > prod.price;
                    const sDisc = sHasDiscount ? Math.round(((prod.mrp - prod.price) / prod.mrp) * 100) : 0;
                    
                    return (
                      <div key={prod.listingId} className="border border-stone-200 rounded p-3 flex flex-col justify-between bg-white text-center group">
                        <div className="size-24 mx-auto flex items-center justify-center bg-stone-50 rounded mb-2 overflow-hidden">
                          {sImg ? <img src={sImg} alt={prod.name} className="h-full w-full object-contain p-1" /> : <span className="material-symbols-outlined text-3xl text-stone-300">eco</span>}
                        </div>
                        <div>
                          <p className="text-xs text-stone-800 font-medium line-clamp-2 text-left leading-tight h-8">{prod.name}</p>
                          <div className="mt-2 flex items-center gap-1 justify-start flex-wrap">
                            <span className="text-xs font-bold text-stone-900">{rupee(prod.price)}</span>
                            {sHasDiscount && <span className="text-[10px] text-stone-400 line-through">{rupee(prod.mrp)}</span>}
                            {sHasDiscount && <span className="text-[10px] text-emerald-600 font-bold">{sDisc}% off</span>}
                          </div>
                        </div>
                        {/* Add To Cart functionality can be wired up with your custom context handler */}
                        <button className="mt-3 w-full border border-stone-200 py-1.5 rounded text-xs font-bold text-stone-700 bg-white hover:bg-stone-50 transition-colors">
                          Add to cart
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>

          {/* RIGHT COLUMN PANEL */}
          <div className="lg:col-span-1 lg:sticky lg:top-4 space-y-4">
            <div className="bg-white border border-stone-200 rounded-sm shadow-sm p-4">
              <h2 className="text-xs font-bold text-stone-400 tracking-wider uppercase border-b border-stone-100 pb-3">PRICE DETAILS</h2>
              
              <div className="mt-4 space-y-4 text-sm border-b border-stone-100 pb-4">
                <div className="flex justify-between text-stone-700">
                  <span>Price ({count} items)</span>
                  <span>{rupee(totalMrp)}</span>
                </div>
                {totalSavings > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Discount</span>
                    <span>− {rupee(totalSavings)}</span>
                  </div>
                )}
               
                <div className="flex justify-between text-stone-700">
                  <span>Delivery Charges</span>
                  <span className="text-emerald-600">FREE</span>
                </div>
              </div>

              <div className="mt-4 flex justify-between items-center text-base font-bold text-stone-900 border-b border-stone-100 border-dashed pb-4">
                <span>Total Amount</span>
                <span className="text-lg">{rupee(grandTotal)}</span>
              </div>

              {totalSavings > 0 && (
                <p className="mt-3 text-xs text-emerald-600 font-bold tracking-wide">
                  You will save {rupee(totalSavings)} on this order
                </p>
              )}
              
            </div>

            <button
    onClick={() => navigate("/customer-shop/checkout")}
    className="w-full bg-[#EA2831] text-white text-sm font-bold uppercase tracking-wider py-3.5 rounded-sm shadow-md hover:bg-[#c91e26] transition-all text-center block"
  >
    PLACE ORDER
  </button>

  
          </div>

        </div>
      </div>
    </div>
  );
}