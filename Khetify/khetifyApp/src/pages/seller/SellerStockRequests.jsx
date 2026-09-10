import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import {
  getSellerToken,
  getSellerPendingStockRequests,
  getSellerInterestedCustomers,
  getSellerStockRequestStats,
} from "../../lib/sellerApi";

/**
 * Seller Stock Requests Page
 * Shows customers interested in products currently out of stock
 */
export default function SellerStockRequests() {
  const navigate = useNavigate();
  const { productId } = useParams();

  const [view, setView] = useState(productId ? "customers" : "products"); // products | customers
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(productId || null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const limit = 20;

  // Fetch all pending stock requests (grouped by product)
  const fetchPendingRequests = async (pageNum = 1) => {
    try {
      // Seller portal auth stores the JWT under "sellerToken" (see
      // lib/sellerApi.js) - NOT "seller_token". Checking the wrong key here
      // sent an already-logged-in seller straight back to the login page.
      if (!getSellerToken()) {
        navigate("/seller/login");
        return;
      }

      // Routed through the shared seller `api` instance so the Bearer token
      // is attached automatically and always matches the one auth actually uses.
      const data = await getSellerPendingStockRequests({ page: pageNum, limit });
      setProducts(data.data.pendingRequests || []);
    } catch (error) {
      console.error("Fetch error:", error);
      Swal.fire({ icon: "error", title: "Error", text: error.response?.data?.message || error.message });
    }
  };

  // Fetch interested customers for a specific product
  const fetchInterestedCustomers = async (pId, pageNum = 1) => {
    try {
      if (!getSellerToken()) return;

      const data = await getSellerInterestedCustomers(pId, { page: pageNum, limit });
      setCustomers(data.data.interestedCustomers || []);
    } catch (error) {
      console.error("Fetch error:", error);
    }
  };

  // Fetch stats
  const fetchStats = async () => {
    try {
      if (!getSellerToken()) return;

      const data = await getSellerStockRequestStats();
      setStats(data.data);
    } catch (error) {
      console.error("Fetch stats error:", error);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchStats();
    if (view === "products") {
      fetchPendingRequests(page).finally(() => setLoading(false));
    } else if (view === "customers" && selectedProduct) {
      // Same loading lifecycle as the products branch above — previously this
      // branch never called setLoading(false), so switching to the customers
      // view left the page stuck on the loading spinner forever even though
      // the data had already arrived.
      fetchInterestedCustomers(selectedProduct, page).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [view, page, selectedProduct]);

  const handleSelectProduct = (product) => {
    // Fetching itself is now owned by the effect above (triggered by the
    // selectedProduct/view/page change below) so the loading state stays
    // consistent and the customer list isn't fetched twice.
    setSelectedProduct(product.productId);
    setView("customers");
    setPage(1);
  };

  const backToProducts = () => {
    setView("products");
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      {/* Header */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-4xl text-[#EA2831]">monitor_heart</span>
            <div>
              <h1 className="text-3xl font-bold text-stone-900">Demand Monitor</h1>
              <p className="text-stone-600 mt-1">Customers interested in your out-of-stock products</p>
            </div>
          </div>
        </div>
      </div>

     

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="text-stone-500">Loading...</div>
          </div>
        ) : view === "products" ? (
          // Products View
          <div className="space-y-3">
            {products.length === 0 ? (
              <div className="bg-white rounded-xl border border-stone-200 p-12 text-center">
                <div className="flex justify-center mb-3">
                  <span className="material-symbols-outlined text-5xl text-stone-300">shopping_cart</span>
                </div>
                <p className="text-stone-600 text-lg font-semibold">No pending requests</p>
                <p className="text-sm text-stone-500 mt-2">When customers request notifications for out-of-stock products, they'll appear here.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {products.map((product) => (
                    <div
                      key={product.productId}
                      onClick={() => handleSelectProduct(product)}
                      className="bg-white rounded-xl border border-stone-200 p-5 hover:shadow-lg cursor-pointer transition-all group"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-bold text-stone-900 group-hover:text-[#EA2831] transition-colors">
                            {product.productName}
                          </h3>
                          <p className="text-sm text-stone-500 mt-1">Code: {product.productCode}</p>
                          {product.variantLabel && (
                            <p className="text-sm text-stone-600 mt-1">Variant: {product.variantLabel}</p>
                          )}
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <div className="bg-[#FDECEC] rounded-lg px-3 py-2 border border-[#F3C6C8]">
                            <p className="text-2xl font-bold text-[#EA2831]">{product.interestedCustomers}</p>
                            <p className="text-xs text-stone-600 font-semibold">interested</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-4 text-[#EA2831] text-sm font-semibold group-hover:gap-3 transition-all">
                        <span>View Customers</span>
                        <span className="material-symbols-outlined text-lg">arrow_forward</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          // Customers View
          <div>
            <div className="flex items-center gap-2 mb-6">
              <button
                onClick={backToProducts}
                className="flex items-center gap-1 text-[#EA2831] hover:text-[#C91E26] font-semibold text-sm"
              >
                <span className="material-symbols-outlined text-lg">arrow_back</span>
                Back to Products
              </button>
              <span className="text-stone-400">/</span>
              <span className="font-semibold text-stone-900">
                {products.find((p) => p.productId === selectedProduct)?.productName || "Product"}
              </span>
            </div>

            <div className="space-y-3">
              {customers.length === 0 ? (
                <div className="bg-white rounded-xl border border-stone-200 p-12 text-center">
                  <span className="material-symbols-outlined text-5xl text-stone-300 flex justify-center mb-3">person_off</span>
                  <p className="text-stone-600">No customers interested yet</p>
                </div>
              ) : (
                customers.map((customer) => (
                  <div key={customer._id} className="bg-white rounded-xl border border-stone-200 p-5 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-bold text-stone-900">{customer.customerId?.name || "Customer"}</h3>
                        {customer.customerId?.email && (
                          <p className="text-sm text-stone-600 mt-1 flex items-center gap-2">
                            <span className="material-symbols-outlined text-base">mail</span>
                            {customer.customerId.email}
                          </p>
                        )}
                        {customer.customerId?.phone && (
                          <p className="text-sm text-stone-600 mt-1 flex items-center gap-2">
                            <span className="material-symbols-outlined text-base">phone</span>
                            {customer.customerId.phone}
                          </p>
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        <span className="inline-block px-3 py-1.5 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                          Active
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-stone-500 mt-3">
                      Requested {new Date(customer.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}