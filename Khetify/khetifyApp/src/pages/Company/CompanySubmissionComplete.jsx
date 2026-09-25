import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import config from "../../../config/config";

const CompanySubmissionComplete = () => {
  const navigate = useNavigate();
  const [userName, setUserName] = useState("User");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const companyId = localStorage.getItem("companyId");

  useEffect(() => {
    const fonts = [
      "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&family=Sora:wght@400;600;700&display=swap",
    ];

    fonts.forEach((url) => {
      const link = document.createElement("link");
      link.href = url;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    });

    // Get user name
    const storedName = localStorage.getItem("userName");
    if (storedName) {
      setUserName(storedName);
    }

    // Fetch company status
    const fetchCompanyStatus = async () => {
      try {
        const token = localStorage.getItem("token");

        const response = await axios.get(
          `${config.BASE_URL}company/${companyId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        setStatus(response.data.status);
      } catch (error) {
        console.error("Status Fetch Error:", error);
      } finally {
        setLoading(false);
      }
    };

    if (companyId) {
      fetchCompanyStatus();

      // 🔄 Auto-poll every 5s so the page updates the moment the admin approves,
      // without the user needing to refresh. Stops once a final decision is in.
      const interval = setInterval(async () => {
        try {
          const token = localStorage.getItem("token");
          const response = await axios.get(
            `${config.BASE_URL}company/${companyId}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          const next = response.data.status;
          setStatus(next);
          if (next === "approved" || next === "rejected") {
            clearInterval(interval);
          }
        } catch (err) {
          // ignore transient poll errors
        }
      }, 5000);

      return () => clearInterval(interval);
    } else {
      setLoading(false);
    }
  }, [companyId]);

  const isApproved = status === "approved";
  const isRejected = status === "rejected";

  const renderStatusBadge = () => {
    if (isApproved) {
      return (
        <span className="inline-flex items-center justify-center px-4 py-1.5 rounded-full bg-green-100 text-green-600 font-['Sora',sans-serif] font-semibold text-sm">
          Approved
        </span>
      );
    }

    if (isRejected) {
      return (
        <span className="inline-flex items-center justify-center px-4 py-1.5 rounded-full bg-red-100 text-red-600 font-['Sora',sans-serif] font-semibold text-sm">
          Rejected
        </span>
      );
    }

    // Default: pending
    return (
      <span className="inline-flex items-center justify-center px-4 py-1.5 rounded-full bg-[#f20d0d]/10 text-[#f20d0d] font-['Sora',sans-serif] font-semibold text-sm">
        Under Review
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading status...
      </div>
    );
  }

  return (
    <div className="font-['Manrope',sans-serif] bg-[#f8f5f5] min-h-screen flex flex-col text-stone-900">
      {/* Navbar */}
      <nav className="w-full bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <h1 className="text-[#f20d0d] text-xl font-bold tracking-tight">
          Khettify
        </h1>

        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-stone-600 hidden sm:block">
            {userName}
          </span>

          <div className="w-10 h-10 rounded-full bg-stone-200 border border-stone-100 flex items-center justify-center font-bold text-stone-600 uppercase">
            {userName.charAt(0)}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-[480px] bg-white rounded-xl shadow-lg border border-stone-100 flex flex-col overflow-hidden">
          <div className="p-8 sm:p-12 flex flex-col items-center justify-center text-center min-h-[400px]">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-stone-900 leading-tight font-['Sora',sans-serif]">
                {isApproved
                  ? "Your company has been approved"
                  : "Your details have been submitted"}
              </h2>
            </div>

            {/* ✅ Dynamic Status Badge */}
            <div className="mb-10">{renderStatusBadge()}</div>

            {/* Description changes with status */}
            <div className="mb-12 max-w-sm mx-auto">
              <p className="text-stone-500 font-['Sora',sans-serif] font-normal text-base leading-relaxed">
                {isApproved
                  ? "Your company profile has been verified. You can now access your dashboard and start managing products."
                  : isRejected
                  ? "Unfortunately your company details could not be verified. Please review your submission or contact support for help."
                  : "Our team is reviewing your company details. You’ll be notified once the verification process is complete. This may take some time depending on document verification."}
              </p>
            </div>

            {/* Action area */}
            <div className="mt-auto w-full">
              {!isApproved && (
                <p className="text-stone-400 font-['Sora',sans-serif] font-normal text-sm mb-6">
                  You can log out or return later to check status.
                </p>
              )}
              <button
                onClick={() => navigate("/hub")}
                className="w-full bg-[#EA2831] hover:bg-[#d61f28] text-white font-['Sora',sans-serif] font-semibold py-3.5 px-6 rounded-lg transition-all active:scale-[0.98] shadow-md"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default CompanySubmissionComplete;
