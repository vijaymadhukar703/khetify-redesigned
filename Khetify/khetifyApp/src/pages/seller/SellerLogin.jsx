import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { loginSeller, setSellerToken } from "../../lib/sellerApi";
import AuthBackground from "../../Components/AuthBackground";

// Seller portal login. Mirrors the company login UX (Khettify brand, #EA2831)
// but authenticates against /api/seller/login and stores the distinct
// sellerToken so it never collides with a company session.
const SellerLogin = () => {
  const navigate = useNavigate();
  const [emailOrPhone, setEmailOrPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setServerError("");
    const value = emailOrPhone.trim();
    if (!value || !password) {
      setServerError("Email/Phone and password are required");
      return;
    }
    const payload = { password: password.trim() };
    if (value.includes("@")) payload.email = value.toLowerCase();
    else payload.phone = value;

    try {
      setLoading(true);
      const res = await loginSeller(payload);
      setSellerToken(res.token);
      navigate("/seller/hub");
    } catch (error) {
      setServerError(error.response?.data?.message || "Login failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthBackground>
      <div className="w-full max-w-[440px] bg-white rounded-xl shadow-lg p-8 sm:p-10 border border-gray-100">
        <div className="mb-6 text-center">
          <h1 className="text-[#EA2831] text-4xl font-bold tracking-tight">Khettify</h1>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-stone-400">Seller Portal</p>
        </div>
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Login to your account</h2>
          <p className="text-sm text-gray-500 font-medium">Welcome back</p>
        </div>

        <form className="space-y-4" onSubmit={handleLogin}>
          <div className="space-y-1">
            <label className="block text-sm font-semibold text-gray-700">Email or Phone<span className="text-[#EA2831] ml-0.5">*</span></label>
            <input
              value={emailOrPhone}
              onChange={(e) => setEmailOrPhone(e.target.value)}
              className="block w-full h-12 px-4 py-3 rounded-lg border border-gray-300 outline-none focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/10"
              placeholder="Enter email or 10-digit phone"
              type="text"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-semibold text-gray-700">Password<span className="text-[#EA2831] ml-0.5">*</span></label>
            <div className="relative">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full h-12 px-4 py-3 pr-11 rounded-lg border border-gray-300 outline-none focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/10"
                placeholder="••••••••"
                type={showPassword ? "text" : "password"}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400"
                onClick={() => setShowPassword(!showPassword)}
              >
                <span className="material-symbols-outlined text-[20px]">
                  {showPassword ? "visibility_off" : "visibility"}
                </span>
              </button>
            </div>
          </div>

          <button
            className="w-full rounded-lg bg-[#EA2831] py-3.5 text-base font-bold text-white shadow-lg hover:bg-red-600 transition-all active:scale-[0.98] disabled:opacity-60"
            type="submit"
            disabled={loading}
          >
            {loading ? "Logging in..." : "Login"}
          </button>

          <div className="text-center mt-5">
            <p className="text-sm text-gray-600">
              Don't have a seller account?{" "}
              <span
                onClick={() => navigate("/seller/register")}
                className="text-[#EA2831] font-semibold cursor-pointer hover:underline"
              >
                Create Account
              </span>
            </p>
          </div>
        </form>

        {serverError && (
          <p className="mt-4 text-center text-sm font-medium text-red-600">⚠ {serverError}</p>
        )}
      </div>
    </AuthBackground>
  );
};

export default SellerLogin;
