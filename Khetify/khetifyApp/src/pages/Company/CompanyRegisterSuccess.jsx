import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const CompanyRegisterSuccess = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Fonts load karne ke liye
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }, []);

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center font-['Sora',sans-serif]">
      {/* Background Image with Overlay */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-black/30 z-10"></div>
        <div 
          className="w-full h-full bg-cover bg-center" 
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1500382017468-9049fed747ef?ixlib=rb-4.0.3&auto=format&fit=crop&w=1920&q=80')" }}
        ></div>
      </div>

      {/* Success Card */}
      <div className="relative z-10 w-full max-w-[440px] p-4">
        <div className="bg-white rounded-xl shadow-2xl p-8 sm:p-10 text-center">
          
          {/* Success Icon */}
          <div className="mb-6 flex justify-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
              <span className="material-symbols-outlined text-5xl text-green-600">
                check_circle
              </span>
            </div>
          </div>

          <h1 className="text-[#ea2a33] text-3xl font-bold mb-2">Success!</h1>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Your account is ready</h2>
          
          <p className="text-gray-600 mb-8">
            Your Khettify account has been created successfully. You can now log in and start exploring the platform.
          </p>

          {/* Action Button */}
          <button
            onClick={() => navigate("/login")}
            className="w-full bg-[#ea2a33] hover:bg-red-600 text-white font-bold py-3.5 rounded-lg shadow-md transition-all active:scale-[0.98]"
          >
            Go to Login
          </button>

          <div className="mt-6">
            <p className="text-sm text-gray-500">
              Need help? <a href="#" className="text-[#ea2a33] font-semibold hover:underline">Contact Support</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanyRegisterSuccess;