import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { getMyProducts, getMyStock } from '../../lib/sellerMyProductApi';
// The SAME publish/unpublish calls the company-product catalog uses. The only
// difference is the body: no companyId, because a seller's own product has no
// company — which is exactly what tells the API this is a My Products listing.
import { getMyListings, publishListing, unpublishListing } from '../../lib/sellerApi';
import { getProductImage } from '../../lib/productImage';
import SellerMyProductForm from './SellerMyProductForm';
import SellerAddStockModal from './SellerAddStockModal';

// MY PRODUCTS — the seller's OWN products and their own (existing) stock.
//
// NO APPROVAL GATE, deliberately. SellerProductCatalog and SellerInventory both
// open with an `if (!approved)` lock screen because they show a supplying
// COMPANY's goods, which only exist once that company approves the seller. This
// page shows what the SELLER uploaded themselves — it belongs to no company, so
// there is nothing to be approved for. A brand-new seller must be able to use it
// on day one; that is the whole point of the module. getSellerLink() is
// therefore never called here.
//
// The backend agrees: /api/seller/my-products carries no requireApprovedSeller,
// no loadSubscription and no requireFeature.
//
// ONE gate does apply, and it is a different kind: the seller must have their
// GST certificate, PAN and Agriculture certificate ON FILE. That is enforced by
// middlewares/requireSellerProductDocs on every my-products route — the lock
// card below is only what the seller SEES when the API says no, never the
// control itself. The sidebar entry and the route stay untouched: the page
// always opens, it is the content that waits on the paperwork.

// The three documents the backend's gate requires, in the order the lock card
// lists them. LABELS ONLY — whether each one is present is never recomputed
// here; it comes from the API's `missing` array, so the card and the gate can
// never disagree.
const REQUIRED_DOCS = [
  { key: 'gst', label: 'GST certificate' },
  { key: 'pan', label: 'PAN card' },
  { key: 'agriculture', label: 'Agriculture certificate' },
];

const TABS = [
  { key: 'products', label: 'Products', icon: 'inventory_2' },
  { key: 'stock', label: 'Stock', icon: 'inventory' },
];

// Same category list the seller catalog filter offers, so the two screens stay
// consistent for a seller switching between them.
const CATEGORY_OPTIONS = [
  { value: 'fertilizers', label: 'Fertilizers' },
  { value: 'pesticides', label: 'Pesticides' },
  { value: 'seeds', label: 'Seeds' },
  { value: 'tools', label: 'Tools' },
  { value: 'growth_promoters', label: 'Growth Promoters' },
];

// A product is "multi-variant" when the schema says so AND it actually carries
// variants — variantType alone can be set on a product whose variant list was
// later emptied, and a bare count would then read "· 0 variants".
const variantCount = (p) => (Array.isArray(p?.variants) ? p.variants.length : 0);

// Stock tab filter chips. The value goes straight into the query the backend
// already understands (`expiring` / `expired`), so the chip IS the filter.
const STOCK_FILTERS = [
  { key: 'all', label: 'All', params: {} },
  { key: 'expiring', label: 'Expiring ≤ 90d', params: { expiring: 'true' } },
  { key: 'expired', label: 'Expired', params: { expired: 'true' } },
];

const DAY = 86400000;

/**
 * The product's Unit of Measurement, or nothing.
 *
 * Reads ONE field — `unit`, which is what the upload form's "Unit of
 * Measurement" writes. Returns '' (render nothing) when it is missing or blank
 * rather than falling back to `unitType`, `weightUnit` or `dimensionUnit`:
 * those describe other measurements (packaging class, shipping weight, box
 * dimensions) and the last two carry schema defaults of "kg" and "cm", so a
 * fallback would confidently print a unit the seller never picked. Showing
 * nothing beats showing the wrong unit.
 */
const unitLabel = (product) => String(product?.unit || '').trim();

// Date as dd Mon yyyy, or an em dash when there is none.
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * The expiry pill. Three states, decided off ONE clock read passed in by the
 * caller, so every row on a render agrees on what "today" is:
 *   expired   (red)   — the date has passed
 *   ≤ 90 days (amber) — the same 90-day horizon the backend's `expiring` filter
 *                       uses, so the chip and the pill can never disagree
 *   otherwise (green)
 */
const ExpiryCell = ({ date, now }) => {
  if (!date) return <span className="text-stone-400">{'—'}</span>;
  const dt = new Date(date);
  if (Number.isNaN(dt.getTime())) return <span className="text-stone-400">{'—'}</span>;

  const days = Math.ceil((dt.getTime() - now) / DAY);
  const tone = days < 0
    ? { cls: 'bg-red-50 text-red-700 border-red-200', label: 'Expired' }
    : days <= 90
      ? { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: `${days}d left` }
      : { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Valid' };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-stone-700 tabular-nums">{fmtDate(date)}</span>
      <span className={`inline-flex items-center w-fit text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap ${tone.cls}`}>
        {tone.label}
      </span>
    </div>
  );
};

/**
 * TOTAL sellable stock for one product, the way the company-product catalog
 * shows it: the number, its unit, and a badge only when something is wrong.
 *
 * `totalStock` from the API already EXCLUDES expired lots, so this number is
 * what the seller can actually sell. `expiredStock` is reported beside it
 * rather than folded in — "0 in stock" next to a full warehouse would otherwise
 * be baffling, and adding the two together is what let expired agricultural
 * input look sellable.
 *
 * Lot-by-lot detail stays on the Stock tab; this is the roll-up.
 */
const StockCell = ({ product }) => {
  const qty = Number(product?.totalStock) || 0;
  const expired = Number(product?.expiredStock) || 0;
  const threshold = Number(product?.lowStockThreshold) || 0;

  // No badge for healthy stock — a row only speaks up when it needs attention.
  const badge = qty <= 0
    ? { cls: 'bg-stone-100 text-stone-500 border-stone-200', label: 'Out of stock' }
    : (threshold > 0 && qty <= threshold)
      ? { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Low stock' }
      : null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-bold text-stone-900 tabular-nums">
        {qty}{' '}
        {/* The product's own Unit of Measurement, or nothing — never a
            fallback to weightUnit/dimensionUnit, which carry defaults of "kg"
            and "cm" and would print a unit the seller never chose. */}
        {unitLabel(product) ? (
          <span className="text-[10px] font-medium text-stone-400 uppercase">{unitLabel(product)}</span>
        ) : null}
      </span>
      {badge && (
        <span className={`inline-flex items-center w-fit text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap ${badge.cls}`}>
          {badge.label}
        </span>
      )}
      {expired > 0 && (
        <span className="text-[10px] font-semibold text-red-600">{expired} expired</span>
      )}
    </div>
  );
};

const StatusPill = ({ status }) => {
  const active = status === 'active';
  return (
    <span
      className={`inline-flex items-center w-fit text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border whitespace-nowrap ${
        active
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-stone-100 text-stone-500 border-stone-200'
      }`}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  );
};

const SellerMyProducts = () => {
  // Active tab lives in the URL (?tab=products / ?tab=stock) so the view is
  // linkable and survives a refresh. A hand-typed unknown value falls back to
  // the first tab rather than rendering nothing.
  const [params, setParams] = useSearchParams();
  const active = TABS.find((t) => t.key === params.get('tab')) || TABS[0];

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Document gate, as reported by the API.
  //   null            — not known yet (first load in flight)
  //   false           — cleared, render the module normally
  //   { missing: [] } — 403 DOCS_REQUIRED, render the lock card
  // A non-403 failure leaves it false: a flaky network must not look like
  // missing paperwork.
  const [docsGate, setDocsGate] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Category');

  // The upload/edit form takes over the whole panel (it is a full form, not a
  // modal): null = closed, { productId: null } = new, { productId } = edit.
  const [editing, setEditing] = useState(null);

  // Marketplace. `listings` is keyed by productId for O(1) lookups while
  // rendering the table, the same shape the company catalog builds.
  const [listings, setListings] = useState(new Map());
  const [publishTarget, setPublishTarget] = useState(null); // product being published
  const [publishPrice, setPublishPrice] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishingId, setPublishingId] = useState(null);   // productId of the in-flight publish
  const [publishError, setPublishError] = useState(null);
  const [unpublishingId, setUnpublishingId] = useState(null); // listingId being pulled

  // Stock tab.
  const [stockRows, setStockRows] = useState([]);
  // "Now" as of the moment these rows were fetched. Stamped alongside them so
  // every expiry pill on a render is judged against ONE reading, and so no
  // impure clock call happens during render.
  const [stockAsOf, setStockAsOf] = useState(() => Date.now());
  const [stockLoading, setStockLoading] = useState(true);
  const [stockFilter, setStockFilter] = useState('all');
  const [addingStock, setAddingStock] = useState(false);

  // setState only in async callbacks (not synchronously in the effect body) to
  // satisfy react-hooks/set-state-in-effect.
  const fetchProducts = useCallback(() => {
    getMyProducts({
      search: searchTerm || undefined,
      category: categoryFilter !== 'Category' ? categoryFilter : undefined,
    })
      .then((r) => { if (r?.success) setProducts(r.data || []); setDocsGate(false); })
      .catch((err) => {
        const body = err?.response?.data;
        setDocsGate(body?.code === 'DOCS_REQUIRED' ? { missing: body.missing || [] } : false);
        setProducts([]);
      })
      .finally(() => setLoading(false));
  }, [searchTerm, categoryFilter]);

  // setState only in async callbacks (not synchronously in the effect body) to
  // satisfy react-hooks/set-state-in-effect — the spinner is raised by the
  // event that asks for the refetch (a chip click, a successful add), never
  // here.
  const fetchStock = useCallback(() => {
    const chip = STOCK_FILTERS.find((c) => c.key === stockFilter) || STOCK_FILTERS[0];
    getMyStock(chip.params)
      .then((r) => { if (r?.success) { setStockRows(r.data || []); setStockAsOf(Date.now()); } })
      .catch(() => setStockRows([]))
      .finally(() => setStockLoading(false));
  }, [stockFilter]);

  // The seller's listings → Map keyed by productId. The endpoint returns BOTH
  // kinds (company-product and own-product listings); keying by product is all
  // this table needs, and a product shown here is by definition one of the
  // seller's own.
  const fetchListings = useCallback(() => {
    getMyListings()
      .then((r) => {
        const map = new Map();
        for (const row of r?.data || []) {
          const pid = String(row.productId?._id || row.productId);
          map.set(pid, { listingId: row._id, price: row.price, status: row.status });
        }
        setListings(map);
      })
      .catch(() => setListings(new Map()));
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { fetchListings(); }, [fetchListings]);

  const openPublish = async (product) => {
    // NOT A BLOCK — just make sure the seller knows. A published product with no
    // stock is legitimate (stock can be added straight after), it simply shows
    // as out of stock to shoppers, so this warns and lets them decide.
    if (!(Number(product.totalStock) > 0)) {
      const { isConfirmed } = await Swal.fire({
        title: 'No stock for this product',
        text: 'This product has no stock. Customers will see it as out of stock.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#EA2831',
        confirmButtonText: 'Publish anyway',
      });
      if (!isConfirmed) return;
    }
    setPublishTarget(product);
    setPublishPrice(product?.mrp != null ? String(product.mrp) : '');
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
    setPublishing(true);
    setPublishingId(publishTarget._id);
    setPublishError(null);
    try {
      // NO companyId. Its absence is the signal: the API then proves the product
      // is this seller's own before listing it, and skips the Principal
      // Certificate gate, which has no company to certify here.
      await publishListing({ productId: publishTarget._id, price });
      closePublish();
      fetchListings();
    } catch (err) {
      setPublishError(err?.response?.data?.message || 'Could not publish. Please try again.');
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
  // Only fetch stock while that tab is actually open — switching to Products
  // shouldn't keep the stock endpoint warm.
  useEffect(() => { if (active.key === 'stock') fetchStock(); }, [active.key, fetchStock]);

  const hasProducts = products.length > 0;

  // Shared by the Products toolbar and the empty state, so the two never drift.
  const uploadButton = useMemo(
    () => (
      <button
        type="button"
        onClick={() => setEditing({ productId: null })}
        className="inline-flex items-center gap-1.5 bg-[#EA2831] text-white text-sm font-bold px-4 py-2.5 rounded-xl hover:bg-[#d0232b] transition-colors whitespace-nowrap"
      >
        <span className="material-symbols-outlined text-[18px]">add</span>
        Upload product
      </button>
    ),
    []
  );

  // Shared by the Stock toolbar and the empty state, so the two never drift.
  const addStockButton = (
    <button
      type="button"
      onClick={() => setAddingStock(true)}
      className="inline-flex items-center gap-1.5 bg-[#EA2831] text-white text-sm font-bold px-4 py-2.5 rounded-xl hover:bg-[#d0232b] transition-colors whitespace-nowrap"
    >
      <span className="material-symbols-outlined text-[18px]">add</span>
      Add stock
    </button>
  );

  // Nothing is rendered until the gate is known, so the tabs never flash into
  // view for a second and then get pulled away.
  if (docsGate === null) {
    return <div className="flex-1 p-8 text-center text-stone-400 font-sora">Loading…</div>;
  }

  /* PAPERWORK LOCK — same treatment as the approval lock screens on
     SellerInventory and SellerProductCatalog (amber card, lock glyph), with the
     per-document checklist added because here the seller can actually fix it.
     The tabs, the tables, Upload product and Add stock are all behind this. */
  if (docsGate) {
    const missing = new Set(docsGate.missing || []);
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">lock</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">My Products is locked</h2>
          <p className="text-sm text-amber-700 mt-1">
            My Products manage karne ke liye pehle profile me jaakar GST certificate,
            PAN card aur Agriculture certificate upload karein.
          </p>

          <ul className="mt-5 text-left space-y-2 max-w-xs mx-auto">
            {REQUIRED_DOCS.map((d) => {
              const isMissing = missing.has(d.key);
              return (
                <li key={d.key} className="flex items-center gap-2 text-sm">
                  <span className={`material-symbols-outlined text-[18px] ${isMissing ? 'text-red-500' : 'text-emerald-600'}`}>
                    {isMissing ? 'close' : 'check_circle'}
                  </span>
                  <span className={isMissing ? 'text-red-700 font-semibold' : 'text-emerald-700'}>
                    {d.label}
                  </span>
                  <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-stone-400">
                    {isMissing ? 'Missing' : 'Uploaded'}
                  </span>
                </li>
              );
            })}
          </ul>

          <Link
            to="/seller/profile"
            className="inline-flex items-center gap-1.5 mt-6 bg-[#EA2831] text-white text-sm font-bold px-4 py-2.5 rounded-xl hover:bg-[#d0232b] transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">badge</span>
            Go to Profile
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50/50 font-sora">
      <div className="max-w-7xl mx-auto space-y-6 text-left">
        <div>
          <h1 className="text-xl font-bold text-stone-900">My Products</h1>
          <p className="text-sm text-stone-500">Products you uploaded yourself.</p>
        </div>

        {/* Tabs — same treatment as Seller Operations: active tab is brand red
            with a red bottom border sitting on the divider. */}
        <div className="flex gap-1 border-b border-stone-200 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setParams({ tab: t.key })}
              aria-current={active.key === t.key ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px whitespace-nowrap transition-colors ${
                active.key === t.key
                  ? 'border-[#EA2831] text-[#EA2831]'
                  : 'border-transparent text-stone-400 hover:text-stone-700'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* THE FORM TAKES OVER THE PANEL when open — the tabs and the toolbar
            would otherwise sit above a long form and invite a half-filled
            product to be abandoned by a stray tab click. */}
        {editing && (
          <SellerMyProductForm
            productId={editing.productId}
            onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); fetchProducts(); }}
          />
        )}

        {!editing && active.key === 'products' && (
          <>
            {/* Toolbar — filters on the left, the primary action on the right. */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 max-w-2xl">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xl">search</span>
                  <input
                    className="pl-10 w-full border border-stone-200 rounded-xl focus:ring-[#EA2831] focus:border-[#EA2831] text-sm py-2.5 outline-none"
                    placeholder="Search product or brand"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="border border-stone-200 rounded-xl text-sm py-2.5 bg-white outline-none"
                >
                  <option>Category</option>
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="lg:ml-auto">{uploadButton}</div>
            </div>

            <div className="border border-stone-200 rounded-3xl overflow-hidden shadow-sm bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[900px] resp-table">
                  <thead>
                    <tr className="bg-stone-50/50 border-b border-stone-200">
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Product Details</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Category</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Brand</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">MRP (₹)</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Stock</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Status</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Marketplace</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest text-right">Edit</th>
                    </tr>
                  </thead>
                  {/* NO stock/quantity column here on purpose — stock lives on
                      the Stock tab, so this table stays the catalog view. */}
                  <tbody className="divide-y divide-stone-100">
                    {!loading && products.map((p) => {
                      const variants = variantCount(p);
                      return (
                        <tr key={p._id} className="hover:bg-stone-50/30 transition-colors">
                          <td data-label="Product Details" className="px-6 py-4">
                            <div className="flex items-center gap-4">
                              <div className="size-12 min-w-[48px] rounded-xl bg-stone-100 border border-stone-200 overflow-hidden flex items-center justify-center">
                                {p.productImages && p.productImages[0] ? (
                                  <img
                                    src={getProductImage(p.productImages[0])}
                                    className="w-full h-full object-cover"
                                    alt="product"
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                  />
                                ) : (
                                  <span className="material-symbols-outlined text-2xl text-stone-300 font-light">image</span>
                                )}
                              </div>
                              <div className="flex flex-col">
                                <span className="font-bold text-stone-900 text-sm">{p.productName}</span>
                                <span className="text-[10px] text-stone-400 font-medium uppercase tracking-tighter">
                                  {p.unit || '—'}
                                  {variants > 0 ? ` · ${variants} variant${variants === 1 ? '' : 's'}` : ''}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td data-label="Category" className="px-6 py-4 text-xs text-stone-500 font-bold uppercase">{p.category || '—'}</td>
                          <td data-label="Brand" className="px-6 py-4 text-sm text-stone-700">{p.brandName || '—'}</td>
                          <td data-label="MRP (₹)" className="px-6 py-4 text-sm text-stone-900 font-black">₹{p.mrp ?? '—'}</td>
                          <td data-label="Stock" className="px-6 py-4"><StockCell product={p} /></td>
                          <td data-label="Status" className="px-6 py-4"><StatusPill status={p.productStatus} /></td>
                          <td data-label="Marketplace" className="px-6 py-4">
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
                          </td>
                          <td className="px-6 py-4 text-right cell-actions">
                            <button
                              type="button"
                              onClick={() => setEditing({ productId: p._id })}
                              title="Edit product"
                              className="p-2 text-stone-400 hover:text-[#EA2831] transition-colors"
                            >
                              <span className="material-symbols-outlined text-xl">edit</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}

                    {!loading && !hasProducts && (
                      <tr>
                        <td colSpan={8} className="px-6 py-16 text-center">
                          <div className="flex flex-col items-center gap-3">
                            <span className="material-symbols-outlined text-4xl text-stone-300 font-light">shopping_bag</span>
                            <p className="text-sm font-bold text-stone-600">No products yet</p>
                            <p className="text-xs text-stone-400 max-w-xs">
                              Add the products you sell, then record the stock you already hold.
                            </p>
                            <div className="mt-1">{uploadButton}</div>
                          </div>
                        </td>
                      </tr>
                    )}

                    {loading && (
                      <tr><td colSpan={8} className="px-6 py-12 text-center text-sm text-stone-400">Loading…</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {!editing && active.key === 'stock' && (
          <>
            {/* Toolbar — filter chips left, the primary action right. */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex gap-2 flex-wrap">
                {STOCK_FILTERS.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => { setStockLoading(true); setStockFilter(chip.key); }}
                    aria-pressed={stockFilter === chip.key}
                    className={`px-4 py-2 text-xs font-bold rounded-full border transition-colors whitespace-nowrap ${
                      stockFilter === chip.key
                        ? 'bg-stone-900 text-white border-stone-900'
                        : 'bg-white text-stone-500 border-stone-200 hover:text-stone-800 hover:border-stone-300'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              <div className="sm:ml-auto">{addStockButton}</div>
            </div>

            <div className="border border-stone-200 rounded-3xl overflow-hidden shadow-sm bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[900px] resp-table">
                  <thead>
                    <tr className="bg-stone-50/50 border-b border-stone-200">
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Product</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Variant</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Lot No.</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Warehouse</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Mfg</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Expiry</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {!stockLoading && stockRows.map((row) => (
                      <tr key={row._id} className="hover:bg-stone-50/30 transition-colors">
                        <td data-label="Product" className="px-6 py-4">
                          <span className="font-bold text-stone-900 text-sm">
                            {row.productId?.productName || '—'}
                          </span>
                          {row.productId?.product_code && (
                            <span className="block text-[10px] text-stone-400 font-mono uppercase tracking-tighter">
                              {row.productId.product_code}
                            </span>
                          )}
                        </td>
                        {/* The row's OWN variant, stored on the Inventory row
                            (not derived from the product), so two variants of
                            one product read as the two separate lots they are.
                            An em dash for a single-variant product. */}
                        <td data-label="Variant" className="px-6 py-4 text-sm text-stone-600">
                          {row.variantSku || '—'}
                        </td>
                        <td data-label="Lot No." className="px-6 py-4 text-xs font-mono font-bold text-stone-700 uppercase">
                          {row.lotNumber || row.batchNumber || '—'}
                        </td>
                        <td data-label="Warehouse" className="px-6 py-4 text-sm text-stone-600">
                          {row.warehouseId?.name || '—'}
                        </td>
                        <td data-label="Mfg" className="px-6 py-4 text-sm text-stone-700 tabular-nums">{fmtDate(row.mfgDate)}</td>
                        <td data-label="Expiry" className="px-6 py-4"><ExpiryCell date={row.expiryDate} now={stockAsOf} /></td>
                        <td data-label="Qty" className="px-6 py-4 text-right">
                          <span className="text-sm font-black text-stone-900 tabular-nums">
                            {Number(row.availableStock) || 0}
                          </span>
                          {/* THE PRODUCT'S OWN Unit of Measurement — the
                              `unit` field the upload form writes — and nothing
                              else. No default and no fallback to another unit
                              field: `weightUnit` (shipping, defaults "kg") and
                              `dimensionUnit` (defaults "cm") are different
                              measurements entirely, and borrowing one of them
                              when `unit` is blank would label the quantity with
                              a unit the seller never chose. A product with no
                              unit set therefore shows NOTHING, which is the
                              honest answer. */}
                          {unitLabel(row.productId) && (
                            <span className="block text-[10px] font-medium text-stone-400 uppercase">
                              {unitLabel(row.productId)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}

                    {!stockLoading && stockRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-6 py-16 text-center">
                          <div className="flex flex-col items-center gap-3">
                            <span className="material-symbols-outlined text-4xl text-stone-300 font-light">inventory</span>
                            <p className="text-sm font-bold text-stone-600">No stock yet</p>
                            <p className="text-xs text-stone-400 max-w-xs">
                              {stockFilter === 'all'
                                ? 'Record the stock you already hold and it will show up here as a traceable lot.'
                                : 'Nothing matches this filter. Try All.'}
                            </p>
                            <div className="mt-1">{addStockButton}</div>
                          </div>
                        </td>
                      </tr>
                    )}

                    {stockLoading && (
                      <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-stone-400">Loading…</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

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
                Heads up: that&rsquo;s more than 1.5× the MRP (₹{publishTarget.mrp}). You can still publish.
              </p>
            )}

            {/* No PC_INACTIVE branch here: a seller's own product has no company,
                so the Principal Certificate gate does not apply and that error
                cannot come back from this call. */}
            {publishError && <p className="text-red-600 text-sm mt-2">{publishError}</p>}

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

      {addingStock && (
        <SellerAddStockModal
          onClose={() => setAddingStock(false)}
          onDone={() => {
            setAddingStock(false);
            setStockLoading(true);
            fetchStock();
            // Adding stock changes each product's totalStock, so the Products
            // tab is refreshed too rather than left showing a stale number.
            fetchProducts();
          }}
        />
      )}
    </div>
  );
};

export default SellerMyProducts;
