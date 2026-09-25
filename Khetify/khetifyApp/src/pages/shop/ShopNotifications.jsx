import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import {
  getShopToken,
  getShopNotificationsInbox,
  getStockNotifications,
  markShopNotificationRead,
  deleteShopNotification,
  cancelStockNotification,
  getCustomerQuantityRequests,
  deleteQuantityRequest,
} from "../../lib/shopApi";

/**
 * Customer Notifications Inbox
 * Displays in-app notifications about out-of-stock products becoming available
 * and quantity requests submitted by the customer
 */
export default function ShopNotifications() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [quantityRequests, setQuantityRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("inbox"); // inbox | subscriptions | requests
  const [page, setPage] = useState(1);
  const limit = 20;

  // Fetch notifications from API
  const fetchNotifications = async (pageNum = 1) => {
    try {
      // Storefront auth stores the consumer's JWT under "shopToken" (see
      // context/ShopAuthContext.jsx + lib/shopApi.js) - checking a
      // "consumer_token" key that's never set was sending logged-in
      // shoppers back to the login page.
      if (!getShopToken()) {
        navigate("/customer-shop/login");
        return;
      }

      // Routed through the shared shop `api` instance so the Bearer token is
      // attached automatically and always matches the one auth actually uses.
      const data = await getShopNotificationsInbox({ page: pageNum, limit });
      setNotifications(data.data.notifications || []);
    } catch (error) {
      console.error("Fetch error:", error);
      Swal.fire({ icon: "error", title: "Error", text: error.response?.data?.message || error.message });
    }
  };

  // Fetch stock subscriptions
  const fetchSubscriptions = async (pageNum = 1) => {
    try {
      if (!getShopToken()) return;

      const data = await getStockNotifications({ page: pageNum, limit });
      setSubscriptions(data.data.notifications || []);
    } catch (error) {
      console.error("Fetch error:", error);
    }
  };

  // Fetch quantity requests
  const fetchQuantityRequests = async (pageNum = 1) => {
    try {
      if (!getShopToken()) return;

      const data = await getCustomerQuantityRequests({ page: pageNum, limit });
      setQuantityRequests(data.data || []);
    } catch (error) {
      console.error("Fetch error:", error);
    }
  };

  useEffect(() => {
    setLoading(true);
    if (activeTab === "inbox") {
      fetchNotifications(page).finally(() => setLoading(false));
    } else if (activeTab === "subscriptions") {
      fetchSubscriptions(page).finally(() => setLoading(false));
    } else if (activeTab === "requests") {
      fetchQuantityRequests(page).finally(() => setLoading(false));
    }
  }, [activeTab, page]);

  // Mark notification as read
  const handleMarkRead = async (notificationId) => {
    try {
      await markShopNotificationRead(notificationId);
      fetchNotifications(page);
    } catch (error) {
      Swal.fire({ icon: "error", title: "Error", text: error.response?.data?.message || error.message });
    }
  };

  // Delete notification
  const handleDeleteNotification = async (notificationId) => {
    try {
      await deleteShopNotification(notificationId);
      fetchNotifications(page);
    } catch (error) {
      Swal.fire({ icon: "error", title: "Error", text: error.response?.data?.message || error.message });
    }
  };

  // Cancel subscription
  const handleCancelSubscription = async (subscriptionId) => {
    Swal.fire({
      icon: "question",
      title: "Cancel Subscription?",
      text: "You won't be notified when this product is back in stock.",
      showCancelButton: true,
      confirmButtonText: "Cancel Subscription",
      confirmButtonColor: "#EA2831",
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          await cancelStockNotification(subscriptionId);
          await Swal.fire({
            icon: "success",
            title: "Cancelled",
            text: "Subscription removed.",
            confirmButtonColor: "#EA2831",
          });
          fetchSubscriptions(page);
        } catch (error) {
          Swal.fire({ icon: "error", title: "Error", text: error.response?.data?.message || error.message });
        }
      }
    });
  };

  // Delete quantity request
  const handleDeleteRequest = async (requestId) => {
    Swal.fire({
      icon: "question",
      title: "Delete Request?",
      text: "This action cannot be undone.",
      showCancelButton: true,
      confirmButtonText: "Delete",
      confirmButtonColor: "#EA2831",
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          await deleteQuantityRequest(requestId);
          await Swal.fire({
            icon: "success",
            title: "Deleted",
            text: "Request removed.",
            confirmButtonColor: "#EA2831",
          });
          fetchQuantityRequests(page);
        } catch (error) {
          Swal.fire({ icon: "error", title: "Error", text: error.response?.data?.message || error.message });
        }
      }
    });
  };

  // Navigate to product. The storefront route is /customer-shop/product/
  // :listingId (a SellerListing id), NOT the raw Product id — passing
  // payload.productId here was sending shoppers to a URL that could never
  // resolve to a product.
  const goToProduct = (listingId) => {
    navigate(`/customer-shop/product/${listingId}`);
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "fulfilled":
        return "bg-green-100 text-green-800";
      case "rejected":
        return "bg-red-100 text-red-800";
      case "partially_fulfilled":
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-stone-100 text-stone-800";
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      {/* Header */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
          <h1 className="text-3xl font-bold text-stone-900">Notifications</h1>
          <p className="text-stone-600 mt-1">Stay updated on your favorite products and requests</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="flex gap-6 overflow-x-auto">
            <button
              onClick={() => { setActiveTab("inbox"); setPage(1); }}
              className={`py-4 px-1 border-b-2 font-semibold text-sm transition-colors whitespace-nowrap ${
                activeTab === "inbox"
                  ? "border-[#EA2831] text-[#EA2831]"
                  : "border-transparent text-stone-600 hover:text-stone-900"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined">inbox</span>
                Inbox
              </span>
            </button>
            <button
              onClick={() => { setActiveTab("subscriptions"); setPage(1); }}
              className={`py-4 px-1 border-b-2 font-semibold text-sm transition-colors whitespace-nowrap ${
                activeTab === "subscriptions"
                  ? "border-[#EA2831] text-[#EA2831]"
                  : "border-transparent text-stone-600 hover:text-stone-900"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined">notifications_active</span>
                My Subscriptions
              </span>
            </button>
            <button
              onClick={() => { setActiveTab("requests"); setPage(1); }}
              className={`py-4 px-1 border-b-2 font-semibold text-sm transition-colors whitespace-nowrap ${
                activeTab === "requests"
                  ? "border-[#EA2831] text-[#EA2831]"
                  : "border-transparent text-stone-600 hover:text-stone-900"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined">mail</span>
                Requests
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="text-stone-500 flex items-center gap-2">
              <span className="material-symbols-outlined animate-spin">refresh</span>
              Loading...
            </div>
          </div>
        ) : activeTab === "inbox" ? (
          <div className="space-y-3">
            {notifications.length === 0 ? (
              <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
                <div className="flex justify-center mb-3">
                  <span className="material-symbols-outlined text-4xl text-stone-300">inbox</span>
                </div>
                <p className="text-stone-600">No notifications yet</p>
              </div>
            ) : (
              notifications.map((notif) => (
                <div key={notif._id} className="bg-white rounded-xl border border-stone-200 p-4 hover:shadow-md transition-shadow">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <div className="flex items-start gap-2">
                        <span className="material-symbols-outlined text-[#EA2831] text-xl flex-shrink-0">notifications_active</span>
                        <div className="flex-1">
                          <h3 className="font-bold text-stone-900">{notif.title}</h3>
                          <p className="text-sm text-stone-600 mt-1">{notif.body}</p>
                          {notif.payload?.listingId && (
                            <button
                              onClick={() => goToProduct(notif.payload.listingId)}
                              className="text-[#EA2831] font-semibold text-sm mt-2 hover:underline"
                            >
                              View Product →
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      {!notif.read && (
                        <button
                          onClick={() => handleMarkRead(notif._id)}
                          className="p-2 hover:bg-stone-100 rounded-lg transition-colors"
                          title="Mark as read"
                        >
                          <span className="material-symbols-outlined text-stone-500">check</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteNotification(notif._id)}
                        className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <span className="material-symbols-outlined text-stone-500">close</span>
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-stone-500 mt-3 ml-8">
                    {new Date(notif.createdAt).toLocaleDateString()} at {new Date(notif.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : activeTab === "subscriptions" ? (
          <div className="space-y-3">
            {subscriptions.length === 0 ? (
              <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
                <div className="flex justify-center mb-3">
                  <span className="material-symbols-outlined text-4xl text-stone-300">notifications_none</span>
                </div>
                <p className="text-stone-600">You haven't subscribed to any notifications yet</p>
                <p className="text-sm text-stone-500 mt-2">Visit out-of-stock products to subscribe</p>
              </div>
            ) : (
              subscriptions.map((sub) => (
                <div key={sub._id} className="bg-white rounded-xl border border-stone-200 p-4 hover:shadow-md transition-shadow">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <h3 className="font-bold text-stone-900">{sub.productId?.productName || "Product"}</h3>
                      {sub.variantLabel && <p className="text-sm text-stone-600 mt-1">Variant: {sub.variantLabel}</p>}
                      <div className="flex items-center gap-2 mt-3">
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                          sub.status === "active" ? "bg-green-100 text-green-800" : 
                          sub.status === "notified" ? "bg-blue-100 text-blue-800" :
                          "bg-stone-100 text-stone-800"
                        }`}>
                          {sub.status === "active" ? "Subscribed" : sub.status === "notified" ? "Notified" : "Inactive"}
                        </span>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <button
                        onClick={() => handleCancelSubscription(sub._id)}
                        className="px-3 py-2 hover:bg-red-50 text-red-600 font-semibold text-sm rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-stone-500 mt-3">
                    Subscribed {new Date(sub.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          // Requests tab
          <div className="space-y-3">
            {quantityRequests.length === 0 ? (
              <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
                <div className="flex justify-center mb-3">
                  <span className="material-symbols-outlined text-4xl text-stone-300">mail</span>
                </div>
                <p className="text-stone-600">No quantity requests yet</p>
                <p className="text-sm text-stone-500 mt-2">When product stock runs out, request more quantity</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b border-stone-200 bg-stone-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-bold text-stone-900">Product</th>
                        <th className="px-4 py-3 text-center text-sm font-bold text-stone-900">Qty</th>
                        <th className="px-4 py-3 text-center text-sm font-bold text-stone-900">Status</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-stone-900">Date</th>
                        <th className="px-4 py-3 text-center text-sm font-bold text-stone-900">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quantityRequests.map((request) => (
                        <tr key={request._id} className="border-b border-stone-200 hover:bg-stone-50">
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-semibold text-stone-900">{request.productName}</p>
                              {request.variantDetails?.label && (
                                <p className="text-xs text-stone-500">{request.variantDetails.label}</p>
                              )}
                              {request.isUrgent && (
                                <span className="inline-block mt-1 text-xs font-bold text-red-600">
                                  🚨 Urgent
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center text-stone-900 font-semibold">
                            {request.requestedQuantity}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap ${getStatusBadge(request.status)}`}>
                              {request.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-stone-600 whitespace-nowrap">
                            {new Date(request.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {request.status === "pending" && (
                              <button
                                onClick={() => handleDeleteRequest(request._id)}
                                className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded transition-colors"
                                title="Delete request"
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}