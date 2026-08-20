import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { getSellerLink, getSellerProducts, getMyListings, publishListing, unpublishListing } from '../../lib/sellerApi';
import { getProductImage } from '../../lib/productImage';

// Read-only clone of the company Product Catalog. A seller has NO catalog of
// their own — this is a view of their linked company's products. No
// upload/edit/delete, MRP only (the backend never sends costPrice).
const getFullUnitName = (unit) => {
  const units = { Kilograms: 'Kilograms (kg)', Liters: 'Liters (L)', Pieces: 'Pieces (Pcs)', Grams: 'Grams (g)', Packets: 'Packets (Pkt)', Milliliters: 'Milliliters (ml)' };
  return units[unit] || unit || '—';
};

// Newest-first ordering key. The seller catalog endpoint returns an explicit
// allow-list of fields that does NOT include createdAt, so we fall back to the
// Mongo ObjectId: its leading 4 bytes are the creation timestamp and the trailing
// counter breaks ties within the same second, making a plain descending compare
// of the hex string equal to insertion order. createdAt is still preferred if the
// payload ever starts carrying it.
const recencyKey = (p) => {
  const ts = p?.createdAt ? Date.parse(p.createdAt) : NaN;
  if (!Number.isNaN(ts)) return { time: ts, id: String(p?._id || '') };
  return { time: null, id: String(p?._id || '') };
};

const byNewestFirst = (a, b) => {
  const ka = recencyKey(a);
  const kb = recencyKey(b);
  if (ka.time !== null && kb.time !== null && ka.time !== kb.time) return kb.time - ka.time;
  if (ka.id === kb.id) return 0;
  return ka.id < kb.id ? 1 : -1;
};

const SellerProductCatalog = () => {
  const navigate = useNavigate();
  const [approved, setApproved] = useState(null); // null = loading
  const [companyName, setCompanyName] = useState('');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Category');
  const [selected, setSelected] = useState(null);
  const [imgIndex, setImgIndex] = useState(0);

  // companyId is required to publish — resolved from the seller→company link.
  const [companyId, setCompanyId] = useState(null);
  // Existing listings keyed by productId → { listingId, price, status, publishedAt }
  // for O(1) lookups while rendering the table.
  const [listings, setListings] = useState(new Map());

  // Publish modal state.
  const [publishTarget, setPublishTarget] = useState(null); // product being published
  const [publishPrice, setPublishPrice] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishingId, setPublishingId] = useState(null); // productId of in-flight publish (for the row button)
  const [publishError, setPublishError] = useState(null);
  const [unpublishingId, setUnpublishingId] = useState(null); // listingId of in-flight unpublish

  // setState only in async callbacks (not synchronously in the effect body) to
  // satisfy react-hooks/set-state-in-effect.
  const fetchProducts = useCallback(() => {
    getSellerProducts({
      search: searchTerm || undefined,
      category: categoryFilter !== 'Category' ? categoryFilter : undefined,
    })
      .then((r) => { if (r?.success) setProducts(r.data || []); })
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [searchTerm, categoryFilter]);

  // Load the seller's own marketplace listings → Map keyed by productId. The
  // list endpoint populates productId as an object, so key by its _id.
  const fetchListings = useCallback(() => {
    getMyListings()
      .then((r) => {
        const map = new Map();
        for (const row of r?.data || []) {
          const pid = String(row.productId?._id || row.productId);
          map.set(pid, {
            listingId: row._id,
            price: row.price,
            status: row.status,
            publishedAt: row.publishedAt,
          });
        }
        setListings(map);
      })
      .catch(() => setListings(new Map()));
  }, []);

  // Resolve approval + linked-company name + companyId once.
  const loadLink = useCallback(() => {
    getSellerLink()
      .then((r) => {
        const ok = r?.data?.linkStatus === 'approved';
        setApproved(ok);
        setCompanyName(r?.data?.company?.businessName || '');
        setCompanyId(r?.data?.company?._id || null);
      })
      .catch(() => setApproved(false));
  }, []);
  useEffect(() => { loadLink(); }, [loadLink]);
  useEffect(() => { if (approved) fetchProducts(); }, [approved, fetchProducts]);
  useEffect(() => { if (approved) fetchListings(); }, [approved, fetchListings]);

  // Display order only — the fetched `products` state is left untouched so search,
  // category filtering and every existing handler keep working exactly as before.
  const orderedProducts = useMemo(() => [...products].sort(byNewestFirst), [products]);

  const openPublish = (p) => {
    setPublishTarget(p);
    setPublishPrice(p?.mrp != null ? String(p.mrp) : '');
    setPublishError(null);
  };
  const closePublish = () => {
    setPublishTarget(null);
    setPublishPrice('');
    setPublishError(null);
  };
  const submitPublish = async () => {
    const price = Number(publishPrice);
    if (!publishPrice || Number.isNaN(price) || price <= 0) {
      setPublishError('Enter a valid selling price greater than 0.');
      return;
    }
    if (!companyId) {
      setPublishError('No linked company found — cannot publish.');
      return;
    }
    setPublishing(true);
    setPublishingId(publishTarget._id);
    setPublishError(null);
    try {
      await publishListing({ companyId, productId: publishTarget._id, price });
      closePublish();
      fetchListings();
      console.log('Listing published on the marketplace.');
    } catch (err) {
      if (err?.response?.status === 403) {
        setPublishError('PC_INACTIVE');
      } else {
        setPublishError(err?.response?.data?.message || 'Could not publish. Please try again.');
      }
    } finally {
      setPublishing(false);
      setPublishingId(null);
    }
  };

  const handleUnpublish = async (listingId) => {
    const { isConfirmed } = await Swal.fire({
      title: 'Unpublish from marketplace?',
      text: 'Customers will no longer see this product on the storefront.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#EA2831',
      confirmButtonText: 'Yes, unpublish',
    });
    if (!isConfirmed) return;
    setUnpublishingId(listingId);
    try {
      await unpublishListing(listingId);
      fetchListings();
      Swal.fire({ icon: 'success', title: 'Unpublished', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Could not unpublish', text: err?.response?.data?.message || 'Please try again.' });
    } finally {
      setUnpublishingId(null);
    }
  };

  if (approved === null) {
    return <div className="flex-1 p-8 text-center text-stone-400 font-sora">Loading…</div>;
  }
  if (!approved) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">lock</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Product catalog is locked</h2>
          <p className="text-sm text-amber-700 mt-1">Available after your supplying company approves you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50/50 font-sora">
      <div className="max-w-7xl mx-auto space-y-6 text-left">
        <div>
          <h1 className="text-xl font-bold text-stone-900">Product Catalog</h1>
          <p className="text-sm text-stone-500">
            Products available from <b className="text-stone-700">{companyName || 'your supplying company'}</b> — view only.
          </p>
        </div>

        {/* Filters (no Upload button — read-only) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xl">search</span>
            <input className="pl-10 w-full border border-stone-200 rounded-xl focus:ring-[#EA2831] focus:border-[#EA2831] text-sm py-2.5 outline-none" placeholder="Search products..." type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="border border-stone-200 rounded-xl text-sm py-2.5 bg-white outline-none">
            <option>Category</option>
            <option value="fertilizers">Fertilizers</option>
            <option value="pesticides">Pesticides</option>
            <option value="seeds">Seeds</option>
            <option value="tools">Tools</option>
            <option value="growth_promoters">Growth Promoters</option>
          </select>
        </div>

        <div className="border border-stone-200 rounded-3xl overflow-hidden shadow-sm bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[760px] resp-table">
              <thead>
                <tr className="bg-stone-50/50 border-b border-stone-200">
                  <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Product Details</th>
                  <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Category</th>
                  {/* <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">SKU Number</th> */}
                  <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">MRP (₹)</th>
                  <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Stock</th>
                  <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Marketplace</th>
                  <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest text-right">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {!loading && orderedProducts.map((p) => (
                  <tr key={p._id} className="hover:bg-stone-50/30 transition-colors">
                    <td data-label="Product Details" className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        <div className="size-12 min-w-[48px] rounded-xl bg-stone-100 border border-stone-200 overflow-hidden flex items-center justify-center">
                          {p.productImages && p.productImages[0] ? (
                            <img src={getProductImage(p.productImages[0])} className="w-full h-full object-cover" alt="product" onError={(e) => { e.target.style.display = 'none'; }} />
                          ) : (
                            <span className="material-symbols-outlined text-2xl text-stone-300 font-light">image</span>
                          )}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-stone-900 text-sm">{p.productName}</span>
                          <span className="text-[10px] text-stone-400 font-medium uppercase tracking-tighter">{p.brandName || p.unit}</span>
                        </div>
                      </div>
                    </td>
                    <td data-label="Category" className="px-6 py-4 text-xs text-stone-500 font-bold uppercase">{p.category}</td>
                    {/* <td data-label="SKU Number" className="px-6 py-4 text-[11px] font-bold font-mono text-stone-400 uppercase">{p.skuNumber || '---'}</td> */}
                    <td data-label="MRP (₹)" className="px-6 py-4 text-sm text-stone-900 font-black">₹{p.mrp ?? '—'}</td>
                    <td data-label="Stock" className="px-6 py-4">
                      {(() => {
                        const qty = Number(p.availableStock) || 0;
                        const status = qty <= 0 ? 'out' : (p.lowStock ? 'low' : 'in');
                        const badgeCls = {
                          in: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                          low: 'bg-amber-50 text-amber-700 border-amber-200',
                          out: 'bg-stone-100 text-stone-500 border-stone-200',
                        }[status];
                        const label = { in: 'In stock', low: 'Low stock', out: 'Out of stock' }[status];
                        return (
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-bold text-stone-900 tabular-nums">{qty} {p.unit ? <span className="text-[10px] font-medium text-stone-400 uppercase">{p.unit}</span> : null}</span>
                            <span className={`inline-flex items-center w-fit text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap ${badgeCls}`}>
                              {label}
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                    <td data-label="Marketplace" className="px-6 py-4">
                      <div className="flex items-center gap-2 flex-wrap">
                      {(() => {
                        const listed = listings.get(String(p._id));
                        if (listed && listed.status === 'published') {
                          return (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap">
                                Listed at ₹{listed.price}
                              </span>
                              <button
                                onClick={() => handleUnpublish(listed.listingId)}
                                disabled={unpublishingId === listed.listingId}
                                title="Remove this product from the marketplace"
                                className="text-[11px] font-semibold text-stone-500 hover:text-[#EA2831] disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {unpublishingId === listed.listingId ? 'Unpublishing…' : 'Unpublish'}
                              </button>
                            </div>
                          );
                        }
                        // Can only publish a product the seller actually holds in
                        // stock. Otherwise prompt them to request supply first.
                        const inStock = Number(p.availableStock) > 0;
                        if (!inStock) {
                          return (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-400 whitespace-nowrap"
                              title="You don't hold this product in stock yet — request supply first, then you can publish it."
                            >
                              <span className="material-symbols-outlined text-sm">inventory_2</span> Not in your stock
                            </span>
                          );
                        }
                        const isPublishing = publishingId === p._id;
                        return (
                          <button
                            onClick={() => openPublish(p)}
                            disabled={isPublishing}
                            className="bg-stone-900 text-white hover:bg-stone-700 text-xs font-semibold px-3 py-1.5 rounded-md disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
                          >
                            {isPublishing ? 'Publishing…' : 'Publish on marketplace'}
                          </button>
                        );
                      })()}
                        <button
                          onClick={() => navigate(`/seller/supply?product=${p._id}`)}
                          title="Request bulk supply of this product from your company"
                          className="inline-flex items-center gap-1 border border-stone-200 text-stone-700 hover:bg-stone-50 hover:border-stone-300 text-xs font-semibold px-3 py-1.5 rounded-md whitespace-nowrap"
                        >
                          <span className="material-symbols-outlined text-sm">local_shipping</span> Request supply
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right cell-actions">
                      <button onClick={() => { setSelected(p); setImgIndex(0); }} className="p-2 text-stone-400 hover:text-blue-500 transition-colors"><span className="material-symbols-outlined text-xl">visibility</span></button>
                    </td>
                  </tr>
                ))}
                {!loading && orderedProducts.length === 0 && (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-stone-400">No products available yet.</td></tr>
                )}
                {loading && (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-stone-400">Loading…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 font-sora">
          <div className="bg-white rounded-[2.5rem] max-w-2xl w-full shadow-2xl animate-in fade-in zoom-in duration-200 border border-stone-100 flex flex-col max-h-[95vh] overflow-hidden">
            <div className="flex justify-between items-start p-8 pb-6 shrink-0 border-b border-stone-100">
              <div>
                <h3 className="font-black text-2xl text-stone-900 tracking-tight">Product Details</h3>
                <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-0.5">From {companyName || 'your supplying company'}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-stone-400 hover:text-[#EA2831] transition-colors bg-stone-50 p-2 rounded-full flex items-center justify-center"><span className="material-symbols-outlined">close</span></button>
            </div>

            <div className="flex-1 overflow-y-auto px-8 pt-6 custom-scrollbar">
              <div className="relative w-full h-72 rounded-[2rem] mb-8 overflow-hidden bg-stone-50 border border-stone-100">
              {selected.productImages && selected.productImages.length > 0 ? (
                <>
                  <img src={getProductImage(selected.productImages[imgIndex])} className="w-full h-full object-contain" alt="product" />
                  {selected.productImages.length > 1 && (
                    <>
                      <div className="absolute inset-y-0 left-0 flex items-center px-4">
                        <button onClick={() => setImgIndex((i) => (i - 1 + selected.productImages.length) % selected.productImages.length)} className="bg-white/90 p-3 rounded-full shadow-xl hover:bg-[#EA2831] hover:text-white transition-all"><span className="material-symbols-outlined text-base font-black">chevron_left</span></button>
                      </div>
                      <div className="absolute inset-y-0 right-0 flex items-center px-4">
                        <button onClick={() => setImgIndex((i) => (i + 1) % selected.productImages.length)} className="bg-white/90 p-3 rounded-full shadow-xl hover:bg-[#EA2831] hover:text-white transition-all"><span className="material-symbols-outlined text-base font-black">chevron_right</span></button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-stone-300">
                  <span className="material-symbols-outlined text-7xl font-light">image_not_supported</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 bg-stone-50/50 p-8 rounded-[2.5rem] border border-stone-100">
              <div className="col-span-1 md:col-span-2 border-b border-stone-200 pb-2">
                <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Product Identity</p>
                <p className="font-black text-lg text-stone-900 leading-tight">{selected.productName}</p>
              </div>
              <Detail label="Price (MRP)" value={`₹${selected.mrp ?? '—'}`} accent />
              <Detail label="Category" value={(selected.category || '—').toUpperCase()} />
              {/* <Detail label="SKU Number" value={selected.skuNumber || '---'} mono /> */}
              <Detail label="HSN Code" value={selected.hsnCode || 'N/A'} />
              <Detail label="Brand" value={selected.brandName || 'N/A'} />
              <Detail label="Packaging" value={selected.packagingType || 'N/A'} />
              <Detail label="Unit" value={getFullUnitName(selected.unit)} />
              <Detail label="Unit Type" value={selected.unitType || 'N/A'} />
            </div>

            <div className="mt-8 flex gap-3 pb-8">
              <button onClick={() => navigate(`/seller/supply?product=${selected._id}`)} className="flex-1 bg-[#EA2831] text-white py-4 rounded-3xl font-black text-xs uppercase tracking-widest hover:bg-red-600 transition-all active:scale-[0.98]">Request supply</button>
              <button onClick={() => setSelected(null)} className="flex-1 bg-stone-900 text-white py-4 rounded-3xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all active:scale-[0.98]">Done</button>
            </div>
          </div>
        </div>
      </div>
      )}

      {publishTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 overflow-y-auto p-4 font-sora">
          <div className="mx-auto bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl overflow-y-auto max-h-[calc(100vh-4rem)]">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-bold text-stone-900">Publish on marketplace</h3>
              <button onClick={closePublish} className="text-stone-400 hover:text-stone-600" aria-label="Close">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="flex items-center gap-3 mb-5">
              <div className="size-14 min-w-[56px] rounded-xl bg-stone-100 border border-stone-200 overflow-hidden flex items-center justify-center">
                {publishTarget.productImages && publishTarget.productImages[0] ? (
                  <img src={getProductImage(publishTarget.productImages[0])} className="w-full h-full object-cover" alt="product" onError={(e) => { e.target.style.display = 'none'; }} />
                ) : (
                  <span className="material-symbols-outlined text-2xl text-stone-300 font-light">image</span>
                )}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-stone-900 text-sm leading-tight">{publishTarget.productName}</p>
                <p className="text-[11px] text-stone-400 font-medium uppercase tracking-tight">{publishTarget.brandName || publishTarget.category}</p>
              </div>
            </div>

            <label className="block text-xs font-bold text-stone-500 uppercase tracking-widest mb-1">Your selling price (₹)</label>
            <input
              type="number"
              min="1"
              value={publishPrice}
              onChange={(e) => setPublishPrice(e.target.value)}
              className="w-full border border-stone-200 rounded-xl focus:ring-[#EA2831] focus:border-[#EA2831] text-sm py-2.5 px-3 outline-none"
              placeholder="0"
              autoFocus
            />
            <p className="text-[11px] italic text-stone-400 mt-1.5">
              This is the price customers will see. You can change it later.
            </p>

            {publishTarget.mrp != null && Number(publishPrice) > 1.5 * Number(publishTarget.mrp) && (
              <p className="text-amber-600 text-xs mt-2">
                Heads up: that's more than 1.5× the MRP (₹{publishTarget.mrp}). You can still publish.
              </p>
            )}

            {publishError === 'PC_INACTIVE' ? (
              <p className="text-red-600 text-sm mt-2">
                You need an active Principal Certificate to publish.{' '}
                <button
                  onClick={() => navigate('/seller/certifications')}
                  className="underline font-semibold hover:text-red-700"
                >
                  Apply via Certifications
                </button>.
              </p>
            ) : publishError ? (
              <p className="text-red-600 text-sm mt-2">{publishError}</p>
            ) : null}

            <div className="mt-6 flex gap-3">
              <button
                onClick={submitPublish}
                disabled={publishing}
                className="flex-1 bg-stone-900 text-white py-3 rounded-xl font-bold text-sm hover:bg-stone-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {publishing ? 'Publishing…' : 'Publish'}
              </button>
              <button
                onClick={closePublish}
                disabled={publishing}
                className="flex-1 bg-transparent text-stone-600 py-3 rounded-xl font-bold text-sm hover:bg-stone-100 transition-all disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Detail = ({ label, value, accent, mono }) => (
  <div>
    <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1">{label}</p>
    <p className={`font-bold text-sm ${accent ? 'text-[#EA2831] font-black text-base' : 'text-stone-900'} ${mono ? 'font-mono uppercase' : ''}`}>{value}</p>
  </div>
);

export default SellerProductCatalog;