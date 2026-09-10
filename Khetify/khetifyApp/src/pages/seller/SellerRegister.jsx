import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { registerSeller, setSellerToken } from "../../lib/sellerApi";
import AuthBackground from "../../Components/AuthBackground";

// Seller portal registration. Creates a pending seller, stores the seller
// token, and lands in the onboarding wizard. Branded like the company side.
const SellerRegister = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({ businessName: "", email: "", phone: "", password: "" });
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Every field required: business name, a valid email, a 10-digit phone, and a
  // password of at least 6 characters.
  const getErrors = () => {
    const e = {};
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!form.businessName.trim()) e.businessName = "Business name is required";
    if (!form.email.trim()) e.email = "Email is required";
    else if (!emailRe.test(form.email.trim())) e.email = "Enter a valid email";
    if (!form.phone.trim()) e.phone = "Phone is required";
    else if (!/^[0-9]{10}$/.test(form.phone.trim())) e.phone = "Phone must be 10 digits";
    if (!form.password) e.password = "Password is required";
    else if (form.password.length < 6) e.password = "Must be at least 6 characters";
    if (!agreeTerms) e.terms = "You must agree to the terms and conditions";
    return e;
  };
  const isValid = Object.keys(getErrors()).length === 0;

  const handleRegister = async (e) => {
    e.preventDefault();
    setServerError("");
    
    // Prevent duplicate submissions while one is in progress
    if (loading) return;
    
    const errs = getErrors();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    try {
      setLoading(true);
      const res = await registerSeller({
        businessName: form.businessName.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        password: form.password.trim(),
      });
      setSellerToken(res.token);
      navigate("/seller/onboarding");
    } catch (error) {
      setServerError(error.response?.data?.message || "Registration failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const field = "block w-full h-12 px-4 py-3 rounded-lg border border-gray-300 outline-none focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/10";

  return (
    <AuthBackground>
      <div className="w-full max-w-[460px] bg-white rounded-xl shadow-lg p-8 sm:p-10 border border-gray-100">
        <div className="mb-6 text-center">
          <h1 className="text-[#EA2831] text-4xl font-bold tracking-tight">Khetify</h1>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-stone-400">Seller Portal</p>
        </div>
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Create your seller account</h2>
          <p className="text-sm text-gray-500 font-medium">Become a Khetify distributor</p>
        </div>

        <form className="space-y-4" onSubmit={handleRegister}>
          <div className="space-y-1">
            <label className="block text-sm font-semibold text-gray-700">Business name<span className="text-[#EA2831] ml-0.5">*</span></label>
            <input value={form.businessName} onChange={set("businessName")} className={field} placeholder="e.g. Krishna Distributors" type="text" />
            {errors.businessName && <p className="text-red-500 text-xs font-medium">⚠ {errors.businessName}</p>}
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-semibold text-gray-700">Email<span className="text-[#EA2831] ml-0.5">*</span></label>
            <input value={form.email} onChange={set("email")} className={field} placeholder="you@business.com" type="email" />
            {errors.email && <p className="text-red-500 text-xs font-medium">⚠ {errors.email}</p>}
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-semibold text-gray-700">Phone<span className="text-[#EA2831] ml-0.5">*</span></label>
            <input value={form.phone} onChange={set("phone")} className={field} placeholder="10-digit phone" type="tel" />
            {errors.phone && <p className="text-red-500 text-xs font-medium">⚠ {errors.phone}</p>}
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-semibold text-gray-700">Password<span className="text-[#EA2831] ml-0.5">*</span></label>
            <input value={form.password} onChange={set("password")} className={field} placeholder="••••••••" type="password" />
            {errors.password && <p className="text-red-500 text-xs font-medium">⚠ {errors.password}</p>}
          </div>

          {/* Terms & Privacy — required (mirrors the company register) */}
          <div className="space-y-1 pt-1">
            <div className="flex items-start space-x-3">
              <input
                id="seller-terms"
                type="checkbox"
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-[#ea2a33] focus:ring-[#ea2a33] cursor-pointer"
              />
              <label htmlFor="seller-terms" className="text-sm text-gray-600 font-medium cursor-pointer">
                I agree to the <span className="text-[#ea2a33] font-bold">Terms</span> &{" "}
                <span className="text-[#ea2a33] font-bold">Privacy Policy</span><span className="text-[#EA2831] ml-0.5">*</span>
              </label>
            </div>
            {errors.terms && <p className="text-red-500 text-xs font-medium mt-1">⚠ {errors.terms}</p>}
          </div>

          <button
            className="w-full rounded-lg bg-[#EA2831] py-3.5 text-base font-bold text-white shadow-lg hover:bg-red-600 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            type="submit"
            disabled={loading || !isValid || !agreeTerms}
          >
            {loading ? "Creating..." : "Create Account"}
          </button>

          <div className="text-center mt-5">
            <p className="text-sm text-gray-600">
              Already have an account?{" "}
              <span onClick={() => navigate("/seller/login")} className="text-[#EA2831] font-semibold cursor-pointer hover:underline">
                Login
              </span>
            </p>
          </div>
        </form>

        {serverError && <p className="mt-4 text-center text-sm font-medium text-red-600">⚠ {serverError}</p>}
      </div>
    </AuthBackground>
  );
};

export default SellerRegister;