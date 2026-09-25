import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import {
  getSellerToken,
  getSellerPendingStockRequests,
  getSellerInterestedCustomers,
  getSellerStockRequestStats,
  getSellerQuantityRequests,
  getQuantityRequestsSummary,
  updateQuantityRequestStatus,
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

  // Tab state — "notify" = existing NotifyMe view, "requests" = new quantity requests
  const [activeTab, setActiveTab] = useState("notify");

  // Quantity Requests state
  const [qRequests, setQRequests] = useState([]);
  const [qSummary, setQSummary] = useState(null);
  const [qLoading, setQLoading] = useState(false);
  const [qPage, setQPage] = useState(1);
  const [qTotalPages, setQTotalPages] = useState(1);
  const [qSortBy, setQSortBy] = useState("recent");
  const [qFilter, setQFilter] = useState("all");
  const [respondingTo, setRespondingTo] = useState(null);
  const [responseStatus, setResponseStatus] = useState("fulfilled");
  const [rejectionReason, setRejectionReason] = useState("");
  const [sellerMessage, setSellerMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  // Fetch quantity requests
  const fetchQRequests = async (pageNum = 1) => {
    try {
      setQLoading(true);
      const params = {
        page: pageNum,
        limit: 20,
        sortBy: qSortBy,
        ...(qFilter !== "all" && { status: qFilter }),
      };
      const res = await getSellerQuantityRequests(params);
      setQRequests(res.data || []);
      setQTotalPages(res.pagination?.pages || 1);
    } catch (error) {
      console.error("Fetch quantity requests error:", error);
      Swal.fire({ icon: "error", title: "Error", text: error.response?.data?.message || error.message });
    } finally {
      setQLoading(false);
    }
  };

  const fetchQSummary = async () => {
    try {
      const res = await getQuantityRequestsSummary();
      setQSummary(res.data || res);
    } catch {
      // non-critical
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

  // Quantity requests tab — refetch when tab opens or filters change
  useEffect(() => {
    if (activeTab === "requests") {
      fetchQSummary();
      fetchQRequests(1);
      setQPage(1);
    }
  }, [activeTab, qSortBy, qFilter]);

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

  // Quantity request respond handlers
  const openRespond = (req) => {
    setRespondingTo(req);
    setResponseStatus("fulfilled");
    setRejectionReason("");
    setSellerMessage("");
  };

  const submitResponse = async () => {
    if (!respondingTo) return;
    if (responseStatus === "rejected" && !rejectionReason.trim()) {
      Swal.fire({ icon: "warning", title: "Enter rejection reason", toast: true, position: "top-end", timer: 2000, showConfirmButton: false });
      return;
    }
    setSubmitting(true);
    try {
      await updateQuantityRequestStatus(respondingTo._id, {
        status: responseStatus,
        sellerMessage: sellerMessage.trim() || undefined,
        rejectionReason: responseStatus === "rejected" ? rejectionReason.trim() : undefined,
      });
      Swal.fire({ icon: "success", title: "Response submitted", toast: true, position: "top-end", timer: 2000, showConfirmButton: false });
      setRespondingTo(null);
      fetchQRequests(qPage);
      fetchQSummary();
    } catch (error) {
      Swal.fire({ icon: "error", title: "Error", text: error.response?.data?.message || error.message });
    } finally {
      setSubmitting(false);
    }
  };

  const STATUS_BADGE = {
    pending:             "bg-yellow-100 text-yellow-800",
    fulfilled:           "bg-green-100 text-green-800",
    rejected:            "bg-red-100 text-red-800",
    partially_fulfilled: "bg-blue-100 text-blue-800",
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

     

      {/* Tabs */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-8">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab("notify")}
              className={`py-4 px-1 border-b-2 font-semibold text-sm transition-colors flex items-center gap-2 ${
                activeTab === "notify"
                  ? "border-[#EA2831] text-[#EA2831]"
                  : "border-transparent text-stone-600 hover:text-stone-900"
              }`}
            >
              <span className="material-symbols-outlined text-lg">notifications_active</span>
              Notify Me Subscriptions
            </button>
            <button
              onClick={() => setActiveTab("requests")}
              className={`py-4 px-1 border-b-2 font-semibold text-sm transition-colors flex items-center gap-2 ${
                activeTab === "requests"
                  ? "border-[#EA2831] text-[#EA2831]"
                  : "border-transparent text-stone-600 hover:text-stone-900"
              }`}
            >
              <span className="material-symbols-outlined text-lg">mail</span>
              Quantity Requests
              {qSummary?.pendingRequests > 0 && (
                <span className="ml-1 bg-[#EA2831] text-white text-xs font-bold rounded-full px-2 py-0.5">
                  {qSummary.pendingRequests}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">

        {/* ── NOTIFY ME TAB ── */}
        {activeTab === "notify" && (
        <>
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="text-stone-500">Loading...</div>
          </div>
        ) : view === "products" ? (
          // Products View — Table
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            {products.length === 0 ? (
              <div className="p-12 text-center">
                <span className="material-symbols-outlined text-5xl text-stone-300 block mb-3">shopping_cart</span>
                <p className="text-stone-600 text-lg font-semibold">No pending subscriptions</p>
                <p className="text-sm text-stone-500 mt-2">When customers subscribe to out-of-stock products, they'll appear here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs font-bold uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-3">Product</th>
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Variant</th>
                      <th className="px-4 py-3 text-center">Interested</th>
                      <th className="px-4 py-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {products.map((product) => (
                      <tr key={product.productId} className="hover:bg-stone-50 transition-colors">
                        <td className="px-4 py-3 font-semibold text-stone-900">
                          {product.productName}
                        </td>
                        <td className="px-4 py-3 text-stone-500">
                          {product.productCode || "—"}
                        </td>
                        <td className="px-4 py-3 text-stone-600">
                          {product.variantLabel && product.variantLabel !== "options"
                            ? product.variantLabel
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center gap-1.5 bg-[#FDECEC] border border-[#F3C6C8] text-[#EA2831] font-bold text-sm rounded-lg px-3 py-1.5">
                            <span className="material-symbols-outlined text-base">group</span>
                            {product.interestedCustomers} Customers
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleSelectProduct(product)}
                            className="inline-flex items-center gap-1 text-[#EA2831] font-semibold text-xs hover:underline"
                          >
                            View Customers
                            <span className="material-symbols-outlined text-base">arrow_forward</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              {customers.length === 0 ? (
                <div className="p-12 text-center">
                  <span className="material-symbols-outlined text-5xl text-stone-300 block mb-3">person_off</span>
                  <p className="text-stone-600">No customers subscribed yet</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs font-bold uppercase tracking-wide text-stone-500">
                      <tr>
                        <th className="px-4 py-3">Customer</th>
                        <th className="px-4 py-3">Email</th>
                        <th className="px-4 py-3">Phone</th>
                        <th className="px-4 py-3 text-center">Status</th>
                        <th className="px-4 py-3">Subscribed On</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {customers.map((customer) => (
                        <tr key={customer._id} className="hover:bg-stone-50 transition-colors">
                          <td className="px-4 py-3 font-semibold text-stone-900">
                            {customer.customerId?.name || "Customer"}
                          </td>
                          <td className="px-4 py-3 text-stone-600">
                            {customer.customerId?.email || "—"}
                          </td>
                          <td className="px-4 py-3 text-stone-600">
                            {customer.customerId?.phone || "—"}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-block px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                              Active
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-stone-500 whitespace-nowrap">
                            {new Date(customer.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
        </> /* end notify tab */
        )}

        {/* ── QUANTITY REQUESTS TAB ── */}
        {activeTab === "requests" && (
          <div>
            {/* Summary cards */}
            {/* {qSummary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {[
                  { label: "Total",     value: qSummary.totalRequests,        icon: "list_alt",    bg: "bg-stone-100",  txt: "text-stone-700"  },
                  { label: "Pending",   value: qSummary.pendingRequests,       icon: "pending",     bg: "bg-yellow-100", txt: "text-yellow-800" },
                  { label: "Fulfilled", value: qSummary.fulfilledRequests,     icon: "check_circle",bg: "bg-green-100",  txt: "text-green-800"  },
                  { label: "Customers", value: qSummary.uniqueCustomersCount,  icon: "group",       bg: "bg-blue-100",   txt: "text-blue-800"   },
                ].map(({ label, value, icon, bg, txt }) => (
                  <div key={label} className={`${bg} rounded-xl p-4 flex items-center gap-3`}>
                    <span className={`material-symbols-outlined ${txt} text-2xl`}>{icon}</span>
                    <div>
                      <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">{label}</p>
                      <p className={`text-2xl font-extrabold ${txt}`}>{value ?? 0}</p>
                    </div>
                  </div>
                ))}
              </div>
            )} */}

            {/* Filters */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="flex gap-2 overflow-x-auto">
                {["all","pending","fulfilled","rejected"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setQFilter(f)}
                    className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition-colors capitalize ${
                      qFilter === f
                        ? "bg-[#EA2831] text-white"
                        : "bg-white text-stone-700 border border-stone-200 hover:bg-stone-50"
                    }`}
                  >
                    {f === "all" ? "All" : f.replace("_"," ")}
                  </button>
                ))}
              </div>
              <select
                value={qSortBy}
                onChange={(e) => setQSortBy(e.target.value)}
                className="ml-auto rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:outline-none"
              >
                <option value="recent">Most Recent</option>
                <option value="urgent">Urgent First</option>
                <option value="oldest">Oldest First</option>
              </select>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              {qLoading ? (
                <div className="flex items-center justify-center py-16 text-stone-500 gap-2">
                  <span className="material-symbols-outlined animate-spin">refresh</span>
                  Loading requests…
                </div>
              ) : qRequests.length === 0 ? (
                <div className="py-16 text-center">
                  <span className="material-symbols-outlined text-4xl text-stone-300">inbox</span>
                  <p className="mt-2 text-stone-500">No requests found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs font-bold uppercase tracking-wide text-stone-500">
                      <tr>
                        <th className="px-4 py-3">Product</th>
                        <th className="px-4 py-3">Customer</th>
                        <th className="px-4 py-3 text-center">Qty</th>
                        <th className="px-4 py-3 text-center">Status</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {qRequests.map((req) => (
                        <tr key={req._id} className="hover:bg-stone-50 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-semibold text-stone-900 line-clamp-1">{req.productName}</p>
                            {req.variantDetails?.label && (
                              <p className="text-xs text-stone-400">{req.variantDetails.label}</p>
                            )}
                            {req.isUrgent && (
                              <span className="text-xs font-bold text-red-600">🚨 Urgent</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-stone-900">{req.customerName}</p>
                            {req.customerPhone && (
                              <p className="text-xs text-stone-400">{req.customerPhone}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center font-bold text-stone-900">
                            {req.requestedQuantity}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${
                              STATUS_BADGE[req.status] || "bg-stone-100 text-stone-700"
                            }`}>
                              {req.status?.replace("_"," ")}
                            </span>
                            {req.status === "rejected" && req.rejectionReason && (
                              <p className="mt-1 text-xs text-red-500 line-clamp-1">{req.rejectionReason}</p>
                            )}
                            {req.sellerMessage && (
                              <p className="mt-1 text-xs text-blue-600 line-clamp-1" title={req.sellerMessage}>
                                💬 {req.sellerMessage}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-stone-500 whitespace-nowrap">
                            {new Date(req.createdAt).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" })}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {req.status === "pending" ? (
                              <button
                                onClick={() => openRespond(req)}
                                className="rounded-lg bg-[#EA2831] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#D91C22] transition-colors"
                              >
                                Respond
                              </button>
                            ) : (
                              <span className="text-xs text-stone-400">Done</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {qTotalPages > 1 && (
                <div className="flex items-center justify-between border-t border-stone-200 px-4 py-3">
                  <button onClick={() => { setQPage((p) => p - 1); fetchQRequests(qPage - 1); }} disabled={qPage <= 1}
                    className="rounded-lg px-3 py-2 text-sm font-semibold text-stone-700 border border-stone-200 hover:bg-stone-50 disabled:opacity-40">
                    Previous
                  </button>
                  <span className="text-sm text-stone-500">Page {qPage} of {qTotalPages}</span>
                  <button onClick={() => { setQPage((p) => p + 1); fetchQRequests(qPage + 1); }} disabled={qPage >= qTotalPages}
                    className="rounded-lg px-3 py-2 text-sm font-semibold text-stone-700 border border-stone-200 hover:bg-stone-50 disabled:opacity-40">
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Respond Modal ── */}
      {respondingTo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
              <h2 className="text-lg font-bold text-stone-900">Respond to Request</h2>
              <button onClick={() => setRespondingTo(null)} className="text-stone-400 hover:text-stone-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div className="rounded-lg bg-stone-50 p-4">
                <p className="font-semibold text-stone-900">{respondingTo.productName}</p>
                {respondingTo.variantDetails?.label && (
                  <p className="text-sm text-stone-500">{respondingTo.variantDetails.label}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  <span className="text-stone-600">Customer: <span className="font-semibold text-stone-900">{respondingTo.customerName}</span></span>
                  <span className="text-stone-600">Qty: <span className="font-semibold text-stone-900">{respondingTo.requestedQuantity}</span></span>
                  {respondingTo.isUrgent && <span className="text-xs font-bold text-red-600">🚨 Urgent</span>}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-bold text-stone-900">Response</label>
                <select value={responseStatus} onChange={(e) => setResponseStatus(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EA2831]/30">
                  <option value="fulfilled">Fulfilled — Stock available, customer notified</option>
                  <option value="partially_fulfilled">Partially Fulfilled — Some stock available</option>
                  <option value="rejected">Rejected — Unable to fulfil</option>
                </select>
              </div>
              {/* Message to customer */}
              <div>
                <label className="mb-1 block text-sm font-bold text-stone-900">
                  Message to Customer <span className="text-stone-400 font-normal">(optional)</span>
                </label>
                <textarea
                  rows={3}
                  value={sellerMessage}
                  onChange={(e) => setSellerMessage(e.target.value)}
                  placeholder="e.g. Stock will be available by Friday, you can visit the store or order online…"
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EA2831]/30"
                />
                <p className="mt-1 text-xs text-stone-400">This message will appear in the customer's notification.</p>
              </div>
              {responseStatus === "rejected" && (
                <div>
                  <label className="mb-1 block text-sm font-bold text-stone-900">
                    Rejection Reason <span className="text-red-500">*</span>
                  </label>
                  <textarea rows={3} value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="e.g. Product discontinued, insufficient demand…"
                    className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EA2831]/30"/>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button onClick={() => setRespondingTo(null)} disabled={submitting}
                  className="flex-1 rounded-lg border border-stone-300 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={submitResponse} disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-[#EA2831] py-2.5 text-sm font-bold text-white hover:bg-[#D91C22] disabled:opacity-50">
                  {submitting
                    ? <><span className="material-symbols-outlined animate-spin text-base">refresh</span> Submitting…</>
                    : "Submit Response"
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}