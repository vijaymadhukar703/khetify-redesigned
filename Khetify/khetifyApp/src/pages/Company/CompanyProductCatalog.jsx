import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Swal from 'sweetalert2';
import { usePermission } from '../../context/PermissionContext';
import { getProductImage } from '../../lib/productImage';

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

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50/50 font-sora">
      <div className="max-w-7xl mx-auto space-y-6 text-left">
        
        {/* Header Actions */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1 max-w-3xl">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xl">search</span>
              <input className="pl-10 w-full border-stone-200 rounded-xl focus:ring-[#EA2831] focus:border-[#EA2831] text-sm py-2.5 outline-none" placeholder="Search by name or product code..." type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="border-stone-200 rounded-xl text-sm py-2.5 bg-white outline-none">
              <option>Category</option>
              <option value="fertilizers">Fertilizers</option>
              <option value="pesticides">Pesticides</option>
              <option value="seeds">Seeds</option>
              <option value="tools">Tools</option>
              <option value="growth_promoters">Growth Promoters</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border-stone-200 rounded-xl text-sm py-2.5 bg-white outline-none">
              <option>Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
          {canManageProducts && (<button onClick={() => navigate('/upload-product')} className="bg-[#EA2831] text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-black transition-all flex items-center justify-center gap-2 shadow-md">
            <span className="material-symbols-outlined text-lg font-bold">add</span>Add new product
          </button>)}
        </div>

        {/* Table Section */}
        <div className="border border-stone-200 rounded-3xl overflow-hidden shadow-sm bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px] resp-table">
              <thead>
                <tr className="bg-stone-50/50 border-b border-stone-200">
                  <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Product Details</th>
                  <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Product Code</th>
                  <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Category</th>
                  {/* <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">SKU Number</th> */}
                  <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Status</th>
                  <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">Cost Price (₹)</th>
                  <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest">MRP (₹)</th>
                  <th className="px-6 py-5 text-[11px] font-bold text-stone-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {!loading && products.map((product) => (
                  <tr key={product._id} className="hover:bg-stone-50/30 transition-colors">
                    <td data-label="Product Details" className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        <div className="size-12 min-w-[48px] rounded-xl bg-stone-100 border border-stone-200 overflow-hidden flex items-center justify-center">
                          {product.productImages && product.productImages[0] ? (
                            <img src={getProductImage(product.productImages[0])} className="w-full h-full object-cover" alt="product" onError={(e) => { e.target.src = "https://via.placeholder.com/150?text=No+Image"; }} />
                          ) : (
                            <span className="material-symbols-outlined text-2xl text-stone-300 font-light">image</span>
                          )}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-stone-900 text-sm">{product.productName}</span>
                          <span className="text-[10px] text-stone-400 font-medium uppercase tracking-tighter">{product.unit}</span>
                        </div>
                      </div>
                    </td>
                    <td data-label="Product Code" className="px-6 py-4">
                      {/* Server-generated, immutable identifier (3 letters + 3 digits). */}
                      <span className="inline-block font-mono text-[11px] font-black tracking-widest text-stone-700 bg-stone-100 px-2.5 py-1 rounded-lg">
                        {product.product_code || '---'}
                      </span>
                    </td>
                    <td data-label="Category" className="px-6 py-4 text-xs text-stone-500 font-bold uppercase">{product.category}</td>
                    {/* <td data-label="SKU Number" className="px-6 py-4 text-[11px] font-bold font-mono text-stone-400 uppercase">{product.skuNumber || '---'}</td> */}
                    <td data-label="Status" className="px-6 py-4">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${product.productStatus.toLowerCase() === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-stone-100 text-stone-400'}`}>{product.productStatus}</span>
                    </td>
                    <td data-label="Cost Price (₹)" className="px-6 py-4 text-sm text-stone-900 font-black">₹{product.costPrice ?? 0}</td>
                    <td data-label="MRP (₹)" className="px-6 py-4 text-sm text-stone-900 font-black">₹{product.mrp}</td>
                    <td className="px-6 py-4 text-right cell-actions">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => { setSelectedProduct(product); setIsModalOpen(true); setCurrentImgIndex(0); }} className="p-2 text-stone-400 hover:text-blue-500 transition-colors"><span className="material-symbols-outlined text-xl">visibility</span></button>
                        {canManageProducts && (
                          <>
                            <button onClick={() => navigate(`/edit-product/${product._id}`)} className="p-2 text-stone-400 hover:text-amber-500 transition-colors"><span className="material-symbols-outlined text-xl">edit</span></button>
                            <button onClick={() => handleDelete(product._id)} className="p-2 text-stone-400 hover:text-[#EA2831] transition-colors"><span className="material-symbols-outlined text-xl">delete</span></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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