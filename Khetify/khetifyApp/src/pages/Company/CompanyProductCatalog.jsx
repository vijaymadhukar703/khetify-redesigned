import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Swal from 'sweetalert2';
import { usePermission } from '../../context/PermissionContext';
import { getProductImage } from '../../lib/productImage';

// Catalog pagination. Client-side on purpose: /api/product/all already returns
// the company's full (search + category filtered) list, and the Status filter
// below is applied in the browser — paging on the server would need a backend
// change and would slice the list BEFORE that filter runs.
const PAGE_SIZE = 10;

/**
 * The page numbers to render. Short lists show every page; long ones show a
 * window around the current page with the first/last always reachable and an
 * ellipsis ('…') standing in for the gap, so the control never overflows.
 */
const pageWindow = (current, total) => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) pages.push('start-gap');
  for (let n = from; n <= to; n += 1) pages.push(n);
  if (to < total - 1) pages.push('end-gap');
  pages.push(total);
  return pages;
};

// The catalog's search box and both dropdowns are the SAME control as every
// other filter in the app — white fill, stone border, rounded-lg, and the
// #EA2831/30 focus ring from the shared `inputCls` token in ims/ImsUi.jsx.
// Written out here rather than imported so this page keeps its own imports.
const fieldCls = 'w-full h-11 border border-stone-200 rounded-lg text-sm bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-[#EA2831]/30 focus:border-[#EA2831] transition-colors';
// `appearance-none` drops the native arrow (a Material chevron is drawn over
// it, so the control looks identical in every browser); `truncate` keeps a long
// option like "Growth Promoters" from running under that chevron.
const selectCls = `${fieldCls} pl-3.5 pr-9 min-w-0 appearance-none truncate cursor-pointer`;

const CompanyProductCatalog = () => {
  const navigate = useNavigate();
  // Products are company master data: only the company admin can edit,
  // delete or add. Managers get a read-only catalog (view only).
  const canManageProducts = usePermission('product:manage');
  
  // --- States ---
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Category');
  const [statusFilter, setStatusFilter] = useState('Status');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentImgIndex, setCurrentImgIndex] = useState(0);
  const [page, setPage] = useState(1); // 1-based catalog page

  // Base origin for this page's product API calls. (Image URL building moved to
  // the shared getProductImage helper, which also fixes legacy absolute paths.)
  //const BASE_URL = "http://localhost:5000";
  const BASE_URL = import.meta.env.VITE_API_URL;
  
  // 1. Fetch Products logic
  const fetchProducts = async () => {
    try {
      setLoading(true);

      const token = localStorage.getItem("token");
      const companyId = localStorage.getItem("companyId");

      console.log("companyId:", companyId);

      const response = await axios.get(`${BASE_URL}/api/product/all`, {
        params: {
          companyId,
          search: searchTerm,
          category:
            categoryFilter !== "Category"
              ? categoryFilter.toLowerCase()
              : undefined,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      console.log("products response:", response.data);

      if (response.data.success) {
        let filtered = response.data.data || [];

        if (statusFilter !== "Status") {
          filtered = filtered.filter(
            (p) =>
              p.productStatus?.toLowerCase() === statusFilter.toLowerCase(),
          );
        }

        setProducts(filtered);
      }
    } catch (error) {
      console.error("Fetch error:", error.response?.data || error.message);
    } finally {
      setLoading(false);
    }
  };
  //2. Delete Product logic
  const handleDelete = async (productId) => {
    try {
      const result = await Swal.fire({
        title: 'Are you sure?',
        text: "This action cannot be undone!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#EA2831',
        cancelButtonColor: '#stone-400',
        confirmButtonText: 'Yes, delete it!'
      });

      if (result.isConfirmed) {
        const token = localStorage.getItem('token');
        await axios.delete(`${BASE_URL}/api/product/delete-product/${productId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        Swal.fire('Deleted!', 'Product has been removed.', 'success');
        fetchProducts();
      }
    } catch {
      Swal.fire('Error!', 'Something went wrong during deletion.', 'error');
    }
  };

  useEffect(() => {
    fetchProducts();
    // A new search/filter result is a NEW list — start it at the top, otherwise
    // a narrower result set would land the user on an empty page 4.
    setPage(1);
  }, [searchTerm, categoryFilter, statusFilter]);

  useEffect(() => {
    const fonts = [
      "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&family=Sora:wght@400;600;700&display=swap",
      "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght@100..700&display=swap"
    ];
    fonts.forEach(url => {
      const link = document.createElement("link");
      link.href = url;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    });
  }, []);

  const nextImage = (e) => {
    e.stopPropagation();
    if (selectedProduct?.productImages) {
      setCurrentImgIndex((prev) => (prev + 1) % selectedProduct.productImages.length);
    }
  };

  const prevImage = (e) => {
    e.stopPropagation();
    if (selectedProduct?.productImages) {
      setCurrentImgIndex((prev) => (prev - 1 + selectedProduct.productImages.length) % selectedProduct.productImages.length);
    }
  };

  const getFullUnitName = (unit) => {
    const units = { 'Kilograms': 'Kilograms (kg)', 'Liters': 'Liters (L)', 'Pieces': 'Pieces (Pcs)', 'Grams': 'Grams (g)', 'Packets': 'Packets (Pkt)', 'Milliliters': 'Milliliters (ml)' };
    return units[unit] || unit;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  // ── PAGINATION (derived, never stored) ────────────────────────────────────
  // `products` stays the single source of truth — exactly the list the existing
  // fetch + filters produce. Only the SLICE rendered below changes.
  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  // Clamped, so deleting the last row of the last page can never strand the
  // table on a page that no longer exists.
  const currentPage = Math.min(page, totalPages);
  const rangeStart = products.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, products.length);
  const pagedProducts = products.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50/50 font-sora">
      <div className="max-w-7xl mx-auto space-y-5 text-left">
        
        {/* Page heading — names the screen and reports how many products the
            current search/filters matched. */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-[26px] leading-tight font-black tracking-tight text-stone-900">Product Catalog</h1>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mt-1">
              {loading ? 'Loading products…' : `${products.length} product${products.length === 1 ? '' : 's'} in your catalog`}
            </p>
          </div>
          {canManageProducts && (<button onClick={() => navigate('/upload-product')} className="bg-[#EA2831] text-white px-5 py-3 rounded-xl font-bold text-sm hover:bg-[#C91E26] transition-colors flex items-center justify-center gap-2 shadow-sm shrink-0">
            <span className="material-symbols-outlined text-lg font-bold">add</span>Add new product
          </button>)}
        </div>

        {/* ONE PANEL — filters and the table share a card, so the toolbar reads
            as the table's header instead of floating as a separate box. */}
        <div className="border border-stone-200 rounded-2xl overflow-hidden shadow-sm bg-white">

          {/* Header Actions */}
          <div className="border-b border-stone-200 bg-white px-5 py-4">
            {/* Search takes TWO of the four columns — its placeholder is far longer
                than the two dropdown labels, so an equal third was clipping it. */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 w-full">
              <div className="relative sm:col-span-2 min-w-0">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-[20px] pointer-events-none">search</span>
                <input className={`${fieldCls} pl-10 pr-3 text-ellipsis`} placeholder="Search by name or product code..." type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              </div>
              {/* The browser's default select arrow is a different shape and
                  weight in every browser, so it is hidden (appearance-none) and
                  a Material chevron is drawn in its place — matching the search
                  icon and the pagination chevrons. `pr-9` reserves its room. */}
              <div className="relative min-w-0">
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={selectCls}>
                  <option value="Category">Category</option>
                  <option value="fertilizers">Fertilizers</option>
                  <option value="pesticides">Pesticides</option>
                  <option value="seeds">Seeds</option>
                  <option value="tools">Tools</option>
                  <option value="growth_promoters">Growth Promoters</option>
                </select>
                <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 text-[20px] pointer-events-none">expand_more</span>
              </div>
              <div className="relative min-w-0">
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
                  <option value="Status">Status</option>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
                <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 text-[20px] pointer-events-none">expand_more</span>
              </div>
            </div>
          </div>

          {/* Table Section */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[880px] resp-table">
              <thead>
                {/* Column widths are fixed so the eye tracks straight down each
                    column — the product name absorbs the slack, not the gaps. */}
                <tr className="bg-stone-50/80 border-b border-stone-200">
                  <th className="px-5 py-3 text-[10px] font-black text-stone-400 uppercase tracking-widest whitespace-nowrap">Product Details</th>
                  <th className="px-5 py-3 w-[130px] text-[10px] font-black text-stone-400 uppercase tracking-widest whitespace-nowrap">Code</th>
                  <th className="px-5 py-3 w-[150px] text-[10px] font-black text-stone-400 uppercase tracking-widest whitespace-nowrap">Category</th>
                  {/* <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">SKU Number</th> */}
                  <th className="px-5 py-3 w-[110px] text-[10px] font-black text-stone-400 uppercase tracking-widest whitespace-nowrap">Status</th>
                  {/* Money right-aligns so the digits line up column-wise. */}
                  <th className="px-5 py-3 w-[120px] text-[10px] font-black text-stone-400 uppercase tracking-widest whitespace-nowrap text-right">Cost Price</th>
                  <th className="px-5 py-3 w-[120px] text-[10px] font-black text-stone-400 uppercase tracking-widest whitespace-nowrap text-right">MRP</th>
                  <th className="px-5 py-3 w-[130px] text-[10px] font-black text-stone-400 uppercase tracking-widest whitespace-nowrap text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {!loading && pagedProducts.map((product) => (
                  <tr key={product._id} className="hover:bg-stone-50/60 transition-colors">
                    <td data-label="Product Details" className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="size-11 min-w-[44px] rounded-lg bg-stone-50 border border-stone-200 overflow-hidden flex items-center justify-center">
                          {product.productImages && product.productImages[0] ? (
                            <img src={getProductImage(product.productImages[0])} className="w-full h-full object-cover" alt="product" onError={(e) => { e.target.src = "https://via.placeholder.com/150?text=No+Image"; }} />
                          ) : (
                            <span className="material-symbols-outlined text-xl text-stone-300 font-light">image</span>
                          )}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-bold text-stone-900 text-sm truncate">{product.productName}</span>
                          <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">{product.unit}</span>
                        </div>
                      </div>
                    </td>
                    <td data-label="Product Code" className="px-5 py-3">
                      {/* Server-generated, immutable identifier (3 letters + 3 digits). */}
                      <span className="inline-block font-mono text-[11px] font-bold tracking-wider text-stone-600 bg-stone-100 px-2 py-1 rounded-md">
                        {product.product_code || '---'}
                      </span>
                    </td>
                    <td data-label="Category" className="px-5 py-3">
                      <span className="text-[11px] font-bold capitalize text-stone-600">{String(product.category || '').replace(/_/g, ' ')}</span>
                    </td>
                    {/* <td data-label="SKU Number" className="px-6 py-4 text-[11px] font-bold font-mono text-stone-400 uppercase">{product.skuNumber || '---'}</td> */}
                    <td data-label="Status" className="px-5 py-3">
                      {/* A coloured dot carries the state at a glance; the word
                          stays for anyone who needs it spelled out. */}
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${product.productStatus.toLowerCase() === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                        <span className={`size-1.5 rounded-full ${product.productStatus.toLowerCase() === 'active' ? 'bg-emerald-500' : 'bg-stone-400'}`} />
                        {product.productStatus}
                      </span>
                    </td>
                    <td data-label="Cost Price (₹)" className="px-5 py-3 text-sm text-stone-600 font-bold tabular-nums text-right whitespace-nowrap">₹{product.costPrice ?? 0}</td>
                    <td data-label="MRP (₹)" className="px-5 py-3 text-sm text-stone-900 font-black tabular-nums text-right whitespace-nowrap">₹{product.mrp}</td>
                    <td className="px-5 py-3 text-right cell-actions">
                      <div className="flex justify-end gap-1">
                        <button title="View details" onClick={() => { setSelectedProduct(product); setIsModalOpen(true); setCurrentImgIndex(0); }} className="size-8 inline-flex items-center justify-center rounded-lg text-stone-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"><span className="material-symbols-outlined text-[19px]">visibility</span></button>
                        {canManageProducts && (
                          <>
                            <button title="Edit product" onClick={() => navigate(`/edit-product/${product._id}`)} className="size-8 inline-flex items-center justify-center rounded-lg text-stone-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"><span className="material-symbols-outlined text-[19px]">edit</span></button>
                            <button title="Delete product" onClick={() => handleDelete(product._id)} className="size-8 inline-flex items-center justify-center rounded-lg text-stone-400 hover:text-[#EA2831] hover:bg-red-50 transition-colors"><span className="material-symbols-outlined text-[19px]">delete</span></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {/* LOADING — skeleton rows keep the table at a steady height
                    instead of collapsing to nothing between fetches. */}
                {loading && Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="animate-pulse">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="size-11 min-w-[44px] rounded-lg bg-stone-100" />
                        <div className="flex flex-col gap-2">
                          <div className="h-3 w-40 rounded bg-stone-100" />
                          <div className="h-2 w-16 rounded bg-stone-100" />
                        </div>
                      </div>
                    </td>
                    {Array.from({ length: 6 }).map((__, c) => (
                      <td key={c} className="px-5 py-3"><div className="h-3 w-20 rounded bg-stone-100" /></td>
                    ))}
                  </tr>
                ))}

                {/* EMPTY — the filters matched nothing (or there is no catalog yet). */}
                {!loading && products.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-16 text-center">
                      <span className="material-symbols-outlined text-5xl text-stone-200 font-light">inventory_2</span>
                      <p className="text-sm font-bold text-stone-500 mt-2">No products found</p>
                      <p className="text-xs text-stone-400 mt-1">Try a different search term or clear the filters.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* PAGINATION — 10 products per page. Hidden while loading and when a
              single page holds everything, so a short catalog stays uncluttered. */}
          {!loading && products.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3.5 border-t border-stone-200 bg-stone-50/60">
              <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                Showing {rangeStart}–{rangeEnd} of {products.length} products
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((n) => Math.max(1, n - 1))}
                    disabled={currentPage <= 1}
                    className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">chevron_left</span>
                    <span className="hidden sm:inline">Previous</span>
                  </button>
                  {pageWindow(currentPage, totalPages).map((n) => (
                    typeof n === 'string' ? (
                      <span key={n} className="px-1 text-xs font-bold text-stone-300 select-none">…</span>
                    ) : (
                      <button
                        key={n}
                        onClick={() => setPage(n)}
                        className={`min-w-[36px] text-xs font-bold px-3 py-2 rounded-lg border transition-colors ${
                          n === currentPage
                            ? 'bg-[#EA2831] border-[#EA2831] text-white'
                            : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                        }`}
                      >
                        {n}
                      </button>
                    )
                  ))}
                  <button
                    onClick={() => setPage((n) => Math.min(totalPages, n + 1))}
                    disabled={currentPage >= totalPages}
                    className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <span className="hidden sm:inline">Next</span>
                    <span className="material-symbols-outlined text-base">chevron_right</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* --- View Modal: ALL INFORMATION & ARROW SLIDER --- */}
      {isModalOpen && selectedProduct && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 font-sora">
          <div className="bg-white rounded-[2.5rem] max-w-2xl w-full shadow-2xl animate-in fade-in zoom-in duration-200 border border-stone-100 flex flex-col max-h-[95vh] overflow-hidden">
            {/* Fixed Header */}
            <div className="flex justify-between items-start p-8 pb-6 shrink-0 border-b border-stone-100">
              <div>
                <h3 className="font-black text-2xl text-stone-900 tracking-tight">Full Product Details</h3>
                <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-0.5">Comprehensive Specification Record</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-stone-400 hover:text-[#EA2831] transition-colors bg-stone-50 p-2 rounded-full shadow-inner"><span className="material-symbols-outlined">close</span></button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto px-8 pt-6 custom-scrollbar">
            {/* Professional Slider with Navigation Arrows */}
            <div className="relative group w-full h-80 rounded-[2rem] mb-8 overflow-hidden bg-stone-50 border border-stone-100 shadow-inner">
              {selectedProduct.productImages && selectedProduct.productImages.length > 0 ? (
                <>
                  <img src={getProductImage(selectedProduct.productImages[currentImgIndex])} className="w-full h-full object-contain transition-all duration-500 animate__animated animate__fadeIn" alt="product" />
                  
                  {/* Navigation Arrows for Slider */}
                  {selectedProduct.productImages.length > 1 && (
                    <>
                      <div className="absolute inset-y-0 left-0 flex items-center px-4">
                        <button onClick={prevImage} className="bg-white/90 p-3 rounded-full shadow-xl hover:bg-[#EA2831] hover:text-white transition-all transform hover:scale-110 active:scale-95">
                          <span className="material-symbols-outlined text-base font-black">chevron_left</span>
                        </button>
                      </div>
                      <div className="absolute inset-y-0 right-0 flex items-center px-4">
                        <button onClick={nextImage} className="bg-white/90 p-3 rounded-full shadow-xl hover:bg-[#EA2831] hover:text-white transition-all transform hover:scale-110 active:scale-95">
                          <span className="material-symbols-outlined text-base font-black">chevron_right</span>
                        </button>
                      </div>
                    </>
                  )}
                  
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-md px-5 py-1.5 rounded-full text-[10px] text-white font-black tracking-widest">
                    {currentImgIndex + 1} / {selectedProduct.productImages.length}
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-stone-300">
                  <span className="material-symbols-outlined text-7xl font-light">image_not_supported</span>
                  <p className="text-[10px] font-bold mt-2 uppercase tracking-widest">No visual data</p>
                </div>
              )}
            </div>

            {/* Comprehensive Information Grid: Showing ALL Data */}
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 bg-stone-50/50 p-8 rounded-[2.5rem] border border-stone-100">
                
                {/* Basic Section */}
                <div className="col-span-1 md:col-span-2 border-b border-stone-200 pb-2">
                  <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Product Identity</p>
                  <p className="font-black text-lg text-stone-900 leading-tight">{selectedProduct.productName}</p>
                </div>

                <div>
                  <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1">Product Code</p>
                  <p className="font-mono font-black text-sm text-stone-900 tracking-widest">{selectedProduct.product_code || '---'}</p>
                </div>

                <div>
                  <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1">Price (MRP)</p>
                  <p className="font-black text-base text-[#EA2831]">₹{selectedProduct.mrp}</p>
                </div>

                <div>
                  <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1">Category</p>
                  <p className="font-bold text-sm text-stone-700 uppercase">{selectedProduct.category}</p>
                </div>

                {/* Identification Section */}
                {/* <div>
                  <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1">SKU Number</p>
                  <p className="font-mono font-bold text-sm text-stone-900 uppercase">{selectedProduct.skuNumber || '---'}</p>
                </div> */}

                <div>
                  <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1">HSN Code</p>
                  <p className="font-bold text-sm text-stone-900">{selectedProduct.hsnCode || 'N/A'}</p>
                </div>

                <div>
                  <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1">Stock Level</p>
                  <p className="font-black text-sm text-emerald-600">{selectedProduct.availableStock || '0'} {getFullUnitName(selectedProduct.unit)}</p>
                </div>

                {/* Compliance Section */}
                <div>
                  <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1">Mfg Date</p>
                  <p className="font-bold text-sm text-stone-900">{formatDate(selectedProduct.manufacturingDate)}</p>
                </div>

                <div>
                  <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1">Expiry Date</p>
                  <p className="font-bold text-sm text-[#EA2831]">{formatDate(selectedProduct.expiryDate)}</p>
                </div>

                <div>
                  <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1">Shelf Life</p>
                  <p className="font-bold text-sm text-stone-900">{selectedProduct.shelfLife || 'N/A'}</p>
                </div>

                <div>
                  <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1">Country of Origin</p>
                  <p className="font-bold text-sm text-stone-900">{selectedProduct.countryOrigin || 'India'}</p>
                </div>

                {/* Logistics & Handling */}
                {/* <div>
                  <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1">Dispatch Location</p>
                  <p className="font-bold text-sm text-stone-900">{selectedProduct.dispatchLocation || 'N/A'}</p>
                </div> */}

                <div>
                  <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1">Packaging Type</p>
                  <p className="font-bold text-sm text-stone-900">{selectedProduct.packagingType || 'N/A'}</p>
                </div>

                <div className="col-span-1 md:col-span-2 border-t border-stone-200 pt-4 mt-2">
                  <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-2">Description & Benefits</p>
                  <p className="text-[11px] text-stone-600 leading-relaxed font-medium">{selectedProduct.description || 'No detailed description available.'}</p>
                </div>

                <div className="col-span-1 md:col-span-2 bg-stone-100/50 p-4 rounded-2xl">
                  <p className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-2">Storage & Safety Instructions</p>
                  <p className="text-[11px] text-stone-600 leading-relaxed font-medium">
                    <span className="block mb-1"><strong>Storage:</strong> {selectedProduct.storageInstructions || 'Standard Conditions'}</span>
                    <span><strong>Safety:</strong> {selectedProduct.safetyInstructions || 'Handle with care'}</span>
                  </p>
                </div>
              </div>
            </div>
            </div>

            {/* Fixed Footer */}
            <div className="shrink-0 p-8 pt-5 border-t border-stone-100 bg-white">
              <button onClick={() => setIsModalOpen(false)} className="w-full bg-stone-900 text-white py-5 rounded-3xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-xl active:scale-[0.98]">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompanyProductCatalog;