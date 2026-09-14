import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import config from "../../../config/config";

const CompanySetupStep5 = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [companyData, setCompanyData] = useState(null);

  useEffect(() => {
    const fetchCompanyDetails = async () => {
      const companyId = localStorage.getItem("companyId");
      const token = localStorage.getItem("token");

      try {
        const response = await axios.get(`${config.BASE_URL}company/${companyId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setCompanyData(response.data);
      } catch (error) {
        console.error("Fetch Error:", error);
        toast.error("Failed to load review data.");
      }
    };

    fetchCompanyDetails();
  }, []);

  // Helper function to extract filename from path
  const getFileName = (path) => {
    if (!path) return null;
    return path.split(/[\\/]/).pop();
  };

  const handleFinalSubmit = async (e) => {
    if (e) e.preventDefault();
    if (loading) return;

    setLoading(true);
    const companyId = localStorage.getItem("companyId");
    const token = localStorage.getItem("token");

    try {
      const response = await axios.put(
        `${config.BASE_URL}company/update/${companyId}`,
        { status: "pending" }, 
        { 
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json' 
          } 
        }
      );

      if (response.status === 200) {
        toast.success("Application submitted successfully!");
        setTimeout(() => {
          navigate("/submission-complete");
        }, 1000);
      }
    } catch (error) {
      console.error("Submission Error:", error);
      toast.error("Submission failed. Check your connection.");
      setLoading(false);
    }
  };

  if (!companyData) return <div className="min-h-screen flex items-center justify-center font-sora text-stone-500">Loading details...</div>;

  return (
    <div className="font-['Manrope',sans-serif] bg-[#f8f5f5] min-h-screen flex flex-col text-stone-900">
      <ToastContainer position="top-right" autoClose={2000} />

      <nav className="w-full bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <h1 className="text-[#f20d0d] text-xl font-bold tracking-tight">
          Khettify
        </h1>
      </nav>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        <div className="w-full max-w-[480px] bg-white rounded-xl shadow-lg border border-stone-100 flex flex-col overflow-hidden my-8">
          <div className="p-8 sm:p-10 flex flex-col h-full">
            <div className="w-full flex justify-center mb-6">
              <span className="text-stone-500 text-sm font-medium bg-stone-50 px-3 py-1 rounded-full border border-stone-100">
                Step 5 of 5
              </span>
            </div>

            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-stone-900 leading-tight font-['Sora',sans-serif]">
                Review your company details
              </h2>
            </div>

            <div className="space-y-8 mb-8">
              {/* Section: Company Info */}
              <div className="space-y-4">
                <h3 className="text-base font-bold text-stone-900 font-['Sora',sans-serif] border-b border-stone-100 pb-2">
                  Company Information
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-4 text-sm">
                  <div>
                    <p className="text-stone-500 text-xs mb-1">Legal Name</p>
                    <p className="font-medium">
                      {companyData.companyInfo?.companyName || "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-stone-500 text-xs mb-1">Business Type</p>
                    <p className="font-medium">
                      {companyData.companyInfo?.businessType || "N/A"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Section: Contact Details */}
              <div className="space-y-4">
                <h3 className="text-base font-bold text-stone-900 font-['Sora',sans-serif] border-b border-stone-100 pb-2">
                  Business & Contact Details
                </h3>
                <div className="space-y-4 text-sm">
                  <div>
                    <p className="text-stone-500 text-xs mb-1">
                      Registered Address
                    </p>
                    <p className="font-medium leading-relaxed">
                      {companyData.businessContact?.address || "N/A"}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                    <div>
                      <p className="text-stone-500 text-xs mb-1">
                        Contact Person
                      </p>
                      <p className="font-medium">
                        {companyData.businessContact?.authorizedPerson || "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-stone-500 text-xs mb-1">Phone</p>
                      <p className="font-medium">
                        {companyData.businessContact?.businessNumber || "N/A"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section: Verification & Documents */}
              <div className="space-y-4">
                <h3 className="text-base font-bold text-stone-900 font-['Sora',sans-serif] border-b border-stone-100 pb-2">
                  Verification Details
                </h3>

                {/* Updated Grid to include PAN Number */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-4 text-sm mb-4">
                  <div>
                    <p className="text-stone-500 text-xs mb-1">GSTIN</p>
                    <p className="font-medium">
                      {companyData.companyDocument?.gstinNumber || "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-stone-500 text-xs mb-1">
                      Registration No.
                    </p>
                    <p className="font-medium">
                      {companyData.companyDocument?.udyamIncorporationNumber ||
                        "N/A"}
                    </p>
                  </div>
                  {/* --- NEW: PAN Number Added Here --- */}
                  <div>
                    <p className="text-stone-500 text-xs mb-1">PAN Number</p>
                    <p className="font-medium uppercase">
                      {companyData.companyDocument?.panNumber || "N/A"}
                    </p>
                  </div>
                </div>

                {/* Uploaded Documents View Section */}
                <div className="space-y-2">
                  <p className="text-stone-500 text-xs mb-2">
                    Uploaded Documents
                  </p>

                  {/* GST Certificate Row */}
                  <div className="flex items-center justify-between p-3 bg-stone-50 border border-stone-100 rounded-lg text-sm">
                    <div className="flex items-center gap-2 truncate">
                      <span className="material-symbols-outlined text-stone-400 text-lg">
                        description
                      </span>
                      <span className="font-medium truncate">
                        {getFileName(
                          companyData.companyDocument?.gstCertificate,
                        ) || "GST Certificate Not Found"}
                      </span>
                    </div>
                    {companyData.companyDocument?.gstCertificate && (
                      <span className="text-green-600 text-xs font-bold uppercase">
                        Uploaded
                      </span>
                    )}
                  </div>

                  {/* Registration Certificate Row */}
                  <div className="flex items-center justify-between p-3 bg-stone-50 border border-stone-100 rounded-lg text-sm">
                    <div className="flex items-center gap-2 truncate">
                      <span className="material-symbols-outlined text-stone-400 text-lg">
                        description
                      </span>
                      <span className="font-medium truncate">
                        {getFileName(
                          companyData.companyDocument
                            ?.udyamIncorporationCertificate,
                        ) || "Reg. Certificate Not Found"}
                      </span>
                    </div>
                    {companyData.companyDocument
                      ?.udyamIncorporationCertificate && (
                      <span className="text-green-600 text-xs font-bold uppercase">
                        Uploaded
                      </span>
                    )}
                  </div>

                  {/* PAN Card Row */}
                  <div className="flex items-center justify-between p-3 bg-stone-50 border border-stone-100 rounded-lg text-sm">
                    <div className="flex items-center gap-2 truncate">
                      <span className="material-symbols-outlined text-stone-400 text-lg">
                        badge
                      </span>
                      <span className="font-medium truncate">
                        {getFileName(companyData.companyDocument?.panFile) ||
                          "PAN Card Not Found"}
                      </span>
                    </div>
                    {companyData.companyDocument?.panFile && (
                      <span className="text-green-600 text-xs font-bold uppercase">
                        Uploaded
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-auto">
              <button
                type="button"
                onClick={handleFinalSubmit}
                disabled={loading}
                className={`w-full flex items-center justify-center text-white font-bold h-12 rounded-lg transition-all active:scale-[0.98] shadow-md ${loading ? "bg-stone-400 cursor-not-allowed" : "bg-[#f20d0d] hover:bg-red-700"}`}
              >
                {loading ? "Processing..." : "Submit for review"}
              </button>
              <p className="text-center text-xs text-stone-500 mt-3">
                You can edit details before submission.
              </p>
            </div>
          </div>
          <div className="h-1 w-full bg-[#f20d0d]"></div>
        </div>
      </main>
    </div>
  );
};

export default CompanySetupStep5;