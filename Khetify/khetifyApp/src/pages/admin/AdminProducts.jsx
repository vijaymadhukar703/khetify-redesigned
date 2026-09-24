import React, { useCallback, useEffect, useState } from 'react';
import { getAdminProducts } from '../../lib/adminProductApi';
import { getProductImage } from '../../lib/productImage';
import AdminProductForm from './AdminProductForm';

/**
 * ADMIN → PRODUCT LIBRARY. The catalog table from pages/seller/SellerMyProducts.jsx
 * (read, not edited) without the seller-only parts: no Stock tab, no warehouses,
 * no Add stock, no marketplace publish. Rows come from /api/admin/products.
 *
 * Upload / Edit open AdminProductForm on this same page, as the seller page does.
 */

// The same list the upload form's Category dropdown offers.
const CATEGORY_OPTIONS = [
  { value: 'fertilizers', label: 'Fertilizers' },
  { value: 'pesticides', label: 'Pesticides' },
  { value: 'seeds', label: 'Seeds' },
  { value: 'tools', label: 'Equipment & Tools' },
  { value: 'growth_promoters', label: 'Growth Promoters' },
];

const ITEMS_PER_PAGE = 10;
const SEARCH_DEBOUNCE_MS = 300;

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

/** Pagination footer — same control as the seller My Products page. `total` is
 *  the server's filtered count, not the rows on screen. */
const Pagination = ({ page, total, onPage, noun }) => {
  const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));
  const goToPage = (p) => onPage(Math.min(Math.max(1, p), totalPages));

  // Compact page list with ellipses, e.g. [1, '…', 4, 5, 6, '…', 12].
  const getPageNumbers = () => {
    const pages = [];
    const windowSize = 1;
    const add = (p) => pages.push(p);

    add(1);
    const start = Math.max(2, page - windowSize);
    const end = Math.min(totalPages - 1, page + windowSize);

    if (start > 2) add('ellipsis-start');
    for (let p = start; p <= end; p++) add(p);
    if (end < totalPages - 1) add('ellipsis-end');
    if (totalPages > 1) add(totalPages);

    return pages;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 border-t border-stone-200 bg-stone-50/50">
      <p className="text-xs text-stone-500">
        Showing{' '}
        <span className="font-semibold text-stone-700">
          {(page - 1) * ITEMS_PER_PAGE + 1}
          {'–'}
          {Math.min(page * ITEMS_PER_PAGE, total)}
        </span>{' '}
        of <span className="font-semibold text-stone-700">{total}</span> {noun}
      </p>

      <div className="flex items-center gap-1">
        <button
          onClick={() => goToPage(page - 1)}
          disabled={page === 1}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-stone-600 border border-stone-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-sm">chevron_left</span>
          Previous
        </button>

        <div className="flex items-center gap-1 mx-1">
          {getPageNumbers().map((p, idx) =>
            typeof p === 'number' ? (
              <button
                key={p}
                onClick={() => goToPage(p)}
                aria-current={p === page ? 'page' : undefined}
                className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-semibold transition-colors ${
                  p === page
                    ? 'bg-stone-900 text-white'
                    : 'text-stone-600 hover:bg-white border border-transparent hover:border-stone-200'
                }`}
              >
                {p}
              </button>
            ) : (
              <span key={`${p}-${idx}`} className="px-1 text-stone-400 text-xs select-none">…</span>
            )
          )}
        </div>

        <button
          onClick={() => goToPage(page + 1)}
          disabled={page === totalPages}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-stone-600 border border-stone-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
          <span className="material-symbols-outlined text-sm">chevron_right</span>
        </button>
      </div>
    </div>
  );
};

const AdminProducts = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // What the admin is typing, and the debounced value the list is fetched with.
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Category');
  // null = the list; { productId: null } = upload; { productId } = edit.
  const [editing, setEditing] = useState(null);

  // setState only in async callbacks (not synchronously in an effect body) to
  // satisfy react-hooks/set-state-in-effect — the spinner is raised by the
  // event that asks for the refetch.
  const fetchProducts = useCallback(() => {
    getAdminProducts({
      search: searchTerm || undefined,
      category: categoryFilter !== 'Category' ? categoryFilter : undefined,
      page,
      limit: ITEMS_PER_PAGE,
    })
      .then((r) => {
        if (!r?.success) return;
        const count = Number(r.pagination?.total) || 0;
        setProducts(r.data || []);
        setTotal(count);
        // The filtered set can shrink under the current page; land on the last
        // real page rather than an empty table.
        const last = Math.max(1, Math.ceil(count / ITEMS_PER_PAGE));
        if (page > last) setPage(last);
      })
      .catch(() => {
        setProducts([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [searchTerm, categoryFilter, page]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // 300ms debounce: only the settled value reaches the API.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput.trim() === searchTerm) return;
      setLoading(true);
      setPage(1);
      setSearchTerm(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, searchTerm]);

  const changePage = (p) => {
    if (p === page) return;
    setLoading(true);
    setPage(p);
  };

  const hasProducts = products.length > 0;

  const uploadButton = (
    <button
      type="button"
      onClick={() => setEditing({ productId: null })}
      className="inline-flex items-center gap-1.5 bg-[#EA2831] text-white text-sm font-bold px-4 py-2.5 rounded-xl hover:bg-[#d0232b] transition-colors whitespace-nowrap"
    >
      <span className="material-symbols-outlined text-[18px]">add</span>
      Upload product
    </button>
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50/50 font-sora">
      <div className="max-w-7xl mx-auto space-y-6 text-left">
        <div>
          <h1 className="text-xl font-bold text-stone-900">Product Library</h1>
        </div>

        {/* The form takes over the panel when open, as on the seller page. */}
        {editing && (
          <AdminProductForm
            productId={editing.productId}
            onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); setLoading(true); fetchProducts(); }}
          />
        )}

        {!editing && (
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
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                  />
                </div>
                <select
                  value={categoryFilter}
                  onChange={(e) => { setLoading(true); setCategoryFilter(e.target.value); setPage(1); }}
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
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Product Code</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">MRP (₹)</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Status</th>
                      <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {!loading && products.map((p) => (
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
                                {p.companyName || '—'}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td data-label="Category" className="px-6 py-4 text-xs text-stone-500 font-bold uppercase">{p.category || '—'}</td>
                        <td data-label="Brand" className="px-6 py-4 text-sm text-stone-700">{p.brandName || '—'}</td>
                        <td data-label="Product Code" className="px-6 py-4 text-xs font-bold font-mono text-stone-700 uppercase">{p.product_code || '—'}</td>
                        <td data-label="MRP (₹)" className="px-6 py-4 text-sm text-stone-900 font-black">₹{p.mrp ?? '—'}</td>
                        <td data-label="Status" className="px-6 py-4"><StatusPill status={p.productStatus} /></td>
                        <td data-label="Actions" className="px-6 py-4 text-right">
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
                    ))}

                    {!loading && !hasProducts && (
                      <tr>
                        <td colSpan={7} className="px-6 py-16 text-center">
                          <div className="flex flex-col items-center gap-3">
                            <span className="material-symbols-outlined text-4xl text-stone-300 font-light">shopping_bag</span>
                            <p className="text-sm font-bold text-stone-600">No products yet</p>
                            <div className="mt-1">{uploadButton}</div>
                          </div>
                        </td>
                      </tr>
                    )}

                    {loading && (
                      <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-stone-400">Loading…</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Hidden while loading and when there is nothing to page through. */}
              {!loading && total > 0 && (
                <Pagination page={page} total={total} onPage={changePage} noun="products" />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdminProducts;
