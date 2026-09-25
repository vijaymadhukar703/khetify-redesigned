import React, { useState } from "react";
import Swal from "sweetalert2";
import { getShopToken, subscribeStockNotification } from "../../lib/shopApi";

/**
 * NotifyMe Button Component
 * Shows when a product is out of stock. Allows customers to subscribe to notifications.
 */
export default function NotifyMeButton({ productId, listingId, variantLabel, onSubscribe }) {
  const [loading, setLoading] = useState(false);

  const handleNotifyMe = async () => {
    try {
      setLoading(true);

      // Storefront auth stores the consumer's JWT under "shopToken" (see
      // context/ShopAuthContext.jsx + lib/shopApi.js) - NOT "consumer_token".
      // Checking the wrong key here made this button think a logged-in
      // shopper was signed out.
      if (!getShopToken()) {
        Swal.fire({
          icon: "info",
          title: "Login Required",
          text: "Please log in to subscribe to notifications.",
          confirmButtonText: "Go to Login",
          confirmButtonColor: "#EA2831",
        }).then((result) => {
          if (result.isConfirmed) {
            window.location.href = "/customer-shop/login";
          }
        });
        return;
      }

      // subscribeStockNotification() goes through the shared shop `api`
      // instance, whose request interceptor attaches the correct Bearer
      // token automatically.
      const data = await subscribeStockNotification({
        productId,
        // Ties this request to the specific seller whose listing the
        // customer was viewing — without it, the backend has no reliable way
        // to attribute a company product to a seller, and the request never
        // shows up in anyone's Demand Monitor.
        listingId,
        variantLabel,
        notificationChannels: {
          email: true,
          sms: false,
          inApp: true,
        },
      });

      await Swal.fire({
        icon: "success",
        title: "Subscribed!",
        text: "We'll notify you when this product is back in stock.",
        confirmButtonColor: "#EA2831",
      });

      if (onSubscribe) {
        onSubscribe(data.data);
      }
    } catch (error) {
      console.error("Subscribe error:", error);

      Swal.fire({
        icon: "error",
        title: "Subscription Failed",
        text: error.response?.data?.message || error.message || "Could not subscribe to notifications. Please try again.",
        confirmButtonColor: "#EA2831",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleNotifyMe}
      disabled={loading}
      className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-stone-200 bg-white py-3.5 text-sm font-bold text-stone-700 transition-all hover:border-stone-300 hover:bg-[#F5F4EF] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="material-symbols-outlined text-lg">notifications</span>
      {loading ? "Subscribing..." : "Notify Me"}
    </button>
  );
}