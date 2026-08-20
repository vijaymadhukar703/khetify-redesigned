import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Swal from 'sweetalert2';
import { getProductCosts, formatINR } from '../../lib/imsApi';
import SelectWithOther from '../../Components/ims/SelectWithOther';
import { getProductImage } from '../../lib/productImage';

const CompanyEditProduct = () => {
  const { productId } = useParams();
  const navigate = useNavigate();
  const BASE_URL = "http://localhost:5000";

  // --- States ---
  const [loading, setLoading] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState([]); // Sirf Nayi Images (Files)
  const [previews, setPreviews] = useState([]); // UI Previews (Old URLs + New Blobs)
  const [currentImgIndex, setCurrentImgIndex] = useState(0); // Slider Index
  
  const [formData, setFormData] = useState({
    productName: '', category: '', unit: '', description: '',
    skuNumber: '', hsnCode: '', manufactureLicenseNo: '',
    countryOrigin: 'India', mrp: '', costPrice: '', gstPercentage: '0',
    availableStock: '', minimumOrderQuantity: '', monthlyProductionCapacity: '',
    packagingType: '', dispatchLocation: '',
    shelfLife: '', qualityGrade: 'standard',
    storageInstructions: '', safetyInstructions: '', productStatus: 'active'
  });

  // Approved costing for this product (purchase + transport → total). Read-only
  // here; changes go through the cost-approval flow on the Executive dashboard.
  const [costing, setCosting] = useState(null);
  useEffect(() => {
    getProductCosts()
      .then((r) => {
        const rows = Array.isArray(r) ? r : r?.data || [];
        setCosting(rows.find((c) => String(c.productId?._id || c.productId) === String(productId)) || null);
      })
      .catch(() => {});
  }, [productId]);

  // 1. Fetch Existing Data
  useEffect(() => {
    const fetchProductDetails = async () => {
      try {
        setLoading(true);
        const token = localStorage.getItem('token');
        const response = await axios.get(`${BASE_URL}/api/product/${productId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        
        if (response.data.success) {
          const data = response.data.data;
          
          // Date Fix (YYYY-MM-DD for input fields)
          
          setFormData(data);

          // Purani Images ko Preview mein dikhana. Shared helper tolerates clean
          // relative paths, legacy absolute Windows paths, and http(s) URLs.
          if (data.productImages && data.productImages.length > 0) {
            setPreviews(data.productImages.map((img) => getProductImage(img)));
          }
        }
      } catch {
        Swal.fire({ title: 'Error!', text: 'Could not load product data.', icon: 'error' });
      } finally {
        setLoading(false);
      }
    };
    fetchProductDetails();
  }, [productId]);

  // 2. Slider Logic (Previous/Next)
  const nextImage = (e) => {
    e.preventDefault();
    if (previews.length > 0) setCurrentImgIndex((prev) => (prev + 1) % previews.length);
  };

  const prevImage = (e) => {
    e.preventDefault();
    if (previews.length > 0) setCurrentImgIndex((prev) => (prev - 1 + previews.length) % previews.length);
  };

  // 3. Image Handlers (Add & Smart Remove)
  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length + previews.length > 5) {
      return Swal.fire({ title: 'Limit!', text: 'Only 5 images allowed', icon: 'warning' });
    }
    
    // Nayi files ko add karo
    setSelectedFiles(prev => [...prev, ...files]);
    
    // Previews update karo
    const newPreviews = files.map(file => URL.createObjectURL(file));
    setPreviews(prev => [...prev, ...newPreviews]);
    setCurrentImgIndex(previews.length); // Focus on newly added image
  };

  const removeImage = (index) => {
    const targetUrl = previews[index];

    // Agar ye nayi image hai (blob URL), to ise 'selectedFiles' array se bhi hatana padega
    if (targetUrl.startsWith('blob:')) {
        // Calculate karo ki ye 'selectedFiles' mein kaunse number par hai
        // Logic: Is index se pehle kitne blobs (nayi images) hain?
        let newFileIndex = 0;
        for (let i = 0; i < index; i++) {
            if (previews[i].startsWith('blob:')) newFileIndex++;
        }
        setSelectedFiles(prev => prev.filter((_, i) => i !== newFileIndex));
    }

    // Preview se hata do (chahe nayi ho ya purani)
    setPreviews(prev => prev.filter((_, i) => i !== index));
    
    // Slider adjustment
    if (currentImgIndex >= previews.length - 1) setCurrentImgIndex(0);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // 4. Update Logic (Database Sync)
  const handleUpdate = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const data = new FormData();
      
      // Saari Text Fields append karo. Manufacturing & expiry dates are now
      // captured per lot at stock-receive, so we no longer send them here.
      // product_code is server-owned and immutable — never send it back (the
      // backend drops it too, this just keeps the payload honest).
      const SKIP_KEYS = ['productImages', '_id', '__v', 'createdAt', 'updatedAt', 'manufacturingDate', 'expiryDate', 'batchNumber', 'product_code'];
      Object.keys(formData).forEach(key => {
        if (!SKIP_KEYS.includes(key)) {
             data.append(key, formData[key] || '');
        }
      });

      // 🔥 CRITICAL: Purani Images (Jo user ne delete NAHI ki)
      const keptImages = previews
        .filter(url => !url.startsWith('blob:')) // Jo blob nahi hai wo purani hai
        .map(url => url.replace(`${BASE_URL}/`, '')); // Base URL hata kar relative path bhejo

      keptImages.forEach(path => data.append('kept_images', path));

      // 🔥 CRITICAL: Nayi Images
      selectedFiles.forEach(file => data.append('productImages', file));

      const response = await axios.put(`${BASE_URL}/api/product/${productId}`, data, {
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.data.success) {
        Swal.fire({ title: 'Updated!', text: 'Product details & images updated successfully.', icon: 'success', confirmButtonColor: '#EA2831' });
        navigate('/product-catalog');
      }
    } catch (error) {
      console.error("Update Error:", error);
      Swal.fire({ title: 'Update Failed', text: error.response?.data?.message || 'Server error', icon: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full border border-stone-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-[#EA2831]/20 focus:border-[#EA2831] outline-none transition-all bg-white text-sm font-semibold";
  const labelClass = "text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1 mb-1 block";

  if (loading) return <div className="flex items-center justify-center h-screen animate-pulse text-stone-400 font-bold">Syncing Database...</div>;

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50/50 font-sora">
      <div className="max-w-5xl mx-auto text-left">
        
        <div className="flex items-center gap-4 mb-8">
           <button onClick={() => navigate(-1)} className="p-2 hover:bg-white rounded-full transition-all text-stone-400 hover:text-[#EA2831] shadow-sm">
              <span className="material-symbols-outlined">arrow_back</span>
           </button>
           <div>
              <h2 className="text-2xl font-black text-stone-900 tracking-tight uppercase">Edit Product Details</h2>
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mt-1">
                Code: <span className="font-mono text-stone-600">{formData.product_code || 'N/A'}</span> · SKU: {formData.skuNumber || 'N/A'}
              </p>
           </div>
        </div>

        <form onSubmit={handleUpdate} className="space-y-10 bg-white p-6 sm:p-10 rounded-[2.5rem] border border-stone-100 shadow-sm mb-10">
          
          {/* Section 1: Image Slider & Basic Info */}
          <section className="space-y-6">
            <h3 className="text-sm font-black text-stone-900 uppercase tracking-wider border-l-4 border-[#EA2831] pl-3">Image Management & Basic Info</h3>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
                {/* Image Slider Editor */}
                <div className="space-y-4">
                    <div className="relative group aspect-square rounded-[2rem] overflow-hidden bg-stone-50 border border-stone-100 shadow-inner">
                        {previews.length > 0 ? (
                            <>
                                <img src={previews[currentImgIndex]} className="w-full h-full object-cover animate__animated animate__fadeIn" alt="Main Preview" />
                                {previews.length > 1 && (
                                    <div className="absolute inset-0 flex items-center justify-between px-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={prevImage} className="bg-white/90 p-2.5 rounded-full shadow-xl hover:bg-[#EA2831] hover:text-white transition-all transform hover:scale-110">
                                            <span className="material-symbols-outlined text-base font-black">chevron_left</span>
                                        </button>
                                        <button onClick={nextImage} className="bg-white/90 p-2.5 rounded-full shadow-xl hover:bg-[#EA2831] hover:text-white transition-all transform hover:scale-110">
                                            <span className="material-symbols-outlined text-base font-black">chevron_right</span>
                                        </button>
                                    </div>
                                )}
                                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-md px-4 py-1.5 rounded-full text-[10px] text-white font-black tracking-widest">
                                    {currentImgIndex + 1} / {previews.length}
                                </div>
                            </>
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-stone-300">
                                <span className="material-symbols-outlined text-6xl">image_not_supported</span>
                                <p className="text-[10px] font-bold uppercase mt-2">No Images</p>
                            </div>
                        )}
                    </div>
                    {/* Thumbnail Grid */}
                    <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                        {previews.map((src, idx) => (
                            <div key={idx} className="relative min-w-[60px] h-[60px]">
                                <img 
                                    src={src} 
                                    onClick={() => setCurrentImgIndex(idx)}
                                    className={`w-full h-full object-cover rounded-xl cursor-pointer border-2 transition-all ${currentImgIndex === idx ? 'border-[#EA2831] scale-95' : 'border-transparent opacity-60'}`} 
                                    alt="thumb" 
                                />
                                <button type="button" onClick={() => removeImage(idx)} className="absolute -top-1 -right-1 bg-black text-white rounded-full p-0.5 shadow-md hover:bg-[#EA2831]">
                                    <span className="material-symbols-outlined text-[10px] block font-bold">close</span>
                                </button>
                            </div>
                        ))}
                        <label className="min-w-[60px] h-[60px] border-2 border-dashed border-stone-200 rounded-xl flex items-center justify-center cursor-pointer hover:bg-stone-50 text-stone-300 hover:text-[#EA2831] transition-all">
                            <input type="file" multiple onChange={handleImageChange} className="hidden" />
                            <span className="material-symbols-outlined">add</span>
                        </label>
                    </div>
                </div>

                <div className="space-y-6">
                    <div>
                        <label className={labelClass}>Product Code</label>
                        {/* Read-only: generated once on the server and fixed for the
                            life of the product — renaming the product never changes it. */}
                        <input
                          name="product_code"
                          value={formData.product_code || ''}
                          readOnly
                          disabled
                          className={`${inputClass} bg-stone-50 text-stone-500 font-mono tracking-widest cursor-not-allowed`}
                        />
                        <p className="text-[10px] text-stone-400 font-medium ml-1 mt-1">Auto-generated · cannot be edited</p>
                    </div>
                    <div>
                        <label className={labelClass}>Product Name<span className="text-[#EA2831] ml-0.5">*</span></label>
                        <input name="productName" value={formData.productName} onChange={handleChange} className={inputClass} required />
                    </div>
                    <div>
                        <label className={labelClass}>Category</label>
                        <SelectWithOther
                            name="category" value={formData.category} className={inputClass}
                            onChange={(v) => setFormData(prev => ({ ...prev, category: v }))}
                            placeholder="Select Category" otherPlaceholder="Enter category name"
                            options={[
                                { value: 'fertilizers', label: 'Fertilizers' },
                                { value: 'pesticides', label: 'Pesticides' },
                                { value: 'seeds', label: 'Seeds' },
                                { value: 'tools', label: 'Equipment & Tools' },
                                { value: 'growth_promoters', label: 'Growth Promoters' },
                            ]}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Measurement Unit</label>
                        <SelectWithOther
                            name="unit" value={formData.unit} className={inputClass}
                            onChange={(v) => setFormData(prev => ({ ...prev, unit: v }))}
                            placeholder="Select Unit" otherPlaceholder="Enter measurement unit"
                            options={[
                                { value: 'Kilograms', label: 'Kilograms (kg)' },
                                { value: 'Liters', label: 'Liters (L)' },
                                { value: 'Pieces', label: 'Pieces (Pcs)' },
                                { value: 'Milliliters', label: 'Milliliters (ml)' },
                                { value: 'Grams', label: 'Grams (g)' },
                                { value: 'Packets', label: 'Packets (Pkt)' },
                            ]}
                        />
                    </div>
                </div>
            </div>
            
            <div className="md:col-span-2">
                <label className={labelClass}>Detailed Description</label>
                <textarea name="description" value={formData.description} onChange={handleChange} rows="4" className={inputClass}></textarea>
            </div>
          </section>

          {/* Section 2: Identification & Pricing */}
          <section className="space-y-6 pt-6 border-t border-stone-50">
            <h3 className="text-sm font-black text-stone-900 uppercase tracking-wider border-l-4 border-[#EA2831] pl-3">Pricing & Identification</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div><label className={labelClass}>MRP (₹)</label><input name="mrp" type="number" value={formData.mrp} onChange={handleChange} className={inputClass} /></div>
              <div><label className={labelClass}>Cost Price (₹)</label><input name="costPrice" type="number" value={formData.costPrice} onChange={handleChange} className={inputClass} /></div>
              <div><label className={labelClass}>GST (%)</label>
                <select name="gstPercentage" value={formData.gstPercentage} onChange={handleChange} className={inputClass}>
                  <option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option>
                </select>
              </div>
              {/* <div><label className={labelClass}>SKU Number</label><input name="skuNumber" value={formData.skuNumber} onChange={handleChange} className={inputClass} /></div> */}
              <div><label className={labelClass}>HSN Code</label><input name="hsnCode" value={formData.hsnCode} onChange={handleChange} className={inputClass} /></div>
            </div>
            {costing && (
              <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Purchase Cost</p>
                  <p className="font-bold text-stone-900">{formatINR(costing.purchaseCost)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Transport Cost</p>
                  <p className="font-bold text-stone-900">{formatINR(costing.transportCost)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Total Cost</p>
                  <p className="font-bold text-[#EA2831]">{formatINR(costing.totalCost)}</p>
                </div>
                <p className="col-span-3 text-[10px] text-stone-400">
                  Total Cost = Purchase Cost + Transport Cost (managed via the cost-approval workflow on the Executive dashboard).
                </p>
              </div>
            )}
          </section>

          {/* Section 3: Compliance & Logistics */}
          <section className="space-y-6 pt-6 border-t border-stone-50">
            <h3 className="text-sm font-black text-stone-900 uppercase tracking-wider border-l-4 border-[#EA2831] pl-3">Compliance & Validity</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div><label className={labelClass}>Stock Available</label><input name="availableStock" type="number" value={formData.availableStock} onChange={handleChange} className={inputClass} /></div>
              <div><label className={labelClass}>MOQ</label><input name="minimumOrderQuantity" type="number" value={formData.minimumOrderQuantity} onChange={handleChange} className={inputClass} /></div>
              <div><label className={labelClass}>Country of Origin</label>
                 <SelectWithOther
                    name="countryOrigin" value={formData.countryOrigin} className={inputClass}
                    onChange={(v) => setFormData(prev => ({ ...prev, countryOrigin: v }))}
                    otherPlaceholder="Enter country of origin"
                    options={['India', 'USA', 'Germany', 'China']}
                 />
              </div>
              <div><label className={labelClass}>Shelf Life<span className="text-[#EA2831] ml-0.5">*</span></label><input name="shelfLife" value={formData.shelfLife} onChange={handleChange} className={inputClass} placeholder="e.g., 24 Months" required /></div>
              <div><label className={labelClass}>Dispatch Location</label><input name="dispatchLocation" value={formData.dispatchLocation} onChange={handleChange} className={inputClass} /></div>
              <div><label className={labelClass}>Packaging</label><input name="packagingType" value={formData.packagingType} onChange={handleChange} className={inputClass} /></div>
              <div><label className={labelClass}>Status</label>
                <select name="productStatus" value={formData.productStatus} onChange={handleChange} className={inputClass}>
                  <option value="active">Active</option><option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
               <div><label className={labelClass}>Storage Instructions</label><input name="storageInstructions" value={formData.storageInstructions} onChange={handleChange} className={inputClass} /></div>
               <div><label className={labelClass}>Safety Instructions</label><input name="safetyInstructions" value={formData.safetyInstructions} onChange={handleChange} className={inputClass} /></div>
            </div>
          </section>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 pt-10 border-t border-stone-50">
            <button type="submit" className="flex-1 bg-stone-900 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black shadow-lg transition-all active:scale-[0.98]">
              Update Database
            </button>
            <button type="button" onClick={() => navigate('/product-catalog')} className="flex-1 bg-white border border-stone-200 text-stone-400 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-stone-50 transition-all">
              Discard Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CompanyEditProduct;