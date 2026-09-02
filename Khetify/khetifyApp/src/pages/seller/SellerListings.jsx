import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMyListings } from '../../lib/sellerApi';
// Tolerates the two shapes productImages[] is stored in — see the helper.
import { getProductImage } from '../../lib/productImage';

const fmtDate = (d) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return '—'; }
};

const StatusPill = ({ status }) => {
  const published = status === 'published';
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap border ${
      published ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-stone-100 text-stone-500 border-stone-200'
    }`}>
      {published ? 'Published' : 'Unpublished'}
    </span>
  );
};

/* Live sellable stock, from the SAME Inventory aggregate the storefront reads.
   Colour-coded because the number alone buries the one case that needs acting
   on: a PUBLISHED listing with nothing behind it is a shopper hitting
   "out of stock" on a product the seller believes is live. */
const StockPill = ({ qty }) => {
  const n = Number(qty) || 0;
  const tone = n === 0
    ? 'bg-red-50 text-red-700 border-red-200'
    : n <= 10
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-stone-50 text-stone-700 border-stone-200';
  return (
    <span className={`inline-flex items-baseline gap-1 text-xs font-bold px-2.5 py-1 rounded-full border whitespace-nowrap ${tone}`}>
      {n}
      <span className="text-[10px] font-semibold opacity-70">{n === 1 ? 'unit' : 'units'}</span>
    </span>
  );
};

/* The product photo, with the placeholder kept as the fallback rather than the
   default — a broken/absent image must not leave an empty box. */
const ProductThumb = ({ src, alt }) => {
  const [failed, setFailed] = useState(false);
  const url = failed ? null : getProductImage(src);
  return (
    <div className="size-12 min-w-[48px] rounded-xl bg-stone-100 border border-stone-200 overflow-hidden flex items-center justify-center">
      {url ? (
        <img
          src={url}
          alt={alt || 'Product'}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="material-symbols-outlined text-2xl text-stone-300 font-light">inventory_2</span>
      )}
    </div>
  );
};

const SellerListings = () => {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchListings = useCallback(() => {
    getMyListings()
      .then((r) => { if (r?.success) setListings(r.data || []); })
      .catch(() => setListings([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { fetchListings(); }, [fetchListings]);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50/50 font-sora">
      <div className="max-w-7xl mx-auto space-y-6 text-left">
        <div>
          <h1 className="text-xl font-bold text-stone-900">Marketplace listings</h1>
          <p className="text-sm text-stone-500">Products you've published on the Khetify storefront.</p>
        </div>

        {!loading && listings.length === 0 ? (
          <div className="max-w-xl mx-auto mt-10 bg-white border border-stone-200 rounded-3xl p-10 text-center shadow-sm">
            <span className="material-symbols-outlined text-stone-300 text-5xl font-light">storefront</span>
            <h2 className="text-lg font-bold text-stone-800 mt-3">No listings yet</h2>
            <p className="text-sm text-stone-500 mt-1">Publish products from your catalog to sell them on the storefront.</p>
            <Link
              to="/seller/products"
              className="inline-block mt-5 bg-stone-900 text-white hover:bg-stone-700 text-xs font-semibold px-4 py-2.5 rounded-md"
            >
              Browse your catalog to publish products
            </Link>
          </div>
        ) : (
          <div className="border border-stone-200 rounded-3xl overflow-hidden shadow-sm bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[760px] resp-table">
                <thead>
                  <tr className="bg-stone-50/50 border-b border-stone-200">
                    <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Product</th>
                    <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Price (₹)</th>
                    <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Quantity</th>
                    <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Status</th>
                    <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Published</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {!loading && listings.map((l) => {
                    const product = l.productId && typeof l.productId === 'object' ? l.productId : null;
                    return (
                      <tr key={l._id} className="hover:bg-stone-50/30 transition-colors">
                        <td data-label="Product" className="px-6 py-4">
                          <div className="flex items-center gap-4">
                            <ProductThumb
                              src={(product?.productImages || [])[0]}
                              alt={product?.productName}
                            />
                            <div className="flex flex-col">
                              <span className="font-bold text-stone-900 text-sm">{product?.productName || 'Product'}</span>
                              <span className="text-[10px] text-stone-400 font-medium font-mono uppercase tracking-tighter">{product?.skuNumber || '---'}</span>
                            </div>
                          </div>
                        </td>
                        <td data-label="Price (₹)" className="px-6 py-4 text-sm text-stone-900 font-black">₹{l.price ?? '—'}</td>
                        <td data-label="Quantity" className="px-6 py-4"><StockPill qty={l.availableStock} /></td>
                        <td data-label="Status" className="px-6 py-4"><StatusPill status={l.status} /></td>
                        <td data-label="Published" className="px-6 py-4 text-xs text-stone-500 font-semibold">{fmtDate(l.publishedAt)}</td>
                      </tr>
                    );
                  })}
                  {loading && (
                    <tr><td colSpan={5} className="px-6 py-12 text-center text-sm text-stone-400">Loading…</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SellerListings;