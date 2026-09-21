import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { sendSellerOtp, verifySellerOtp, setSellerToken } from "../../lib/sellerApi";
import AuthBackground from "../../Components/AuthBackground";

/**
 * Seller registration — 2-step OTP flow.
 *
 * Step 1: Fill form → "Send OTP" → backend validates & emails OTP
 * Step 2: Enter 6-digit OTP → "Verify & Create Account" → account created
 */
const SellerRegister = () => {
  const navigate = useNavigate();

  // Step: 'form' | 'otp'
  const [step, setStep] = useState("form");

  const [form, setForm] = useState({ businessName: "", email: "", phone: "", password: "" });
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);

  // OTP step
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

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

  // Step 1 — send OTP
  const handleSendOtp = async (e) => {
    e.preventDefault();
    setServerError("");
    const errs = getErrors();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    if (loading) return;
    try {
      setLoading(true);
      await sendSellerOtp({
        businessName: form.businessName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
      });
      setStep("otp");
    } catch (err) {
      setServerError(err.response?.data?.message || "Could not send OTP. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2 — verify OTP and create account
  const handleVerify = async (e) => {
    e.preventDefault();
    setOtpError("");
    if (!otp.trim() || otp.trim().length !== 6) {
      setOtpError("Enter the 6-digit OTP sent to your email");
      return;
    }
    if (loading) return;
    try {
      setLoading(true);
      const res = await verifySellerOtp({ email: form.email.trim(), otp: otp.trim() });
      setSellerToken(res.token);
      navigate("/seller/onboarding");
    } catch (err) {
      setOtpError(err.response?.data?.message || "Verification failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP
  const handleResend = async () => {
    setResendMsg("");
    setOtpError("");
    setResendLoading(true);
    try {
      await sendSellerOtp({
        businessName: form.businessName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
      });
      setResendMsg("A new OTP has been sent to your email.");
      setOtp("");
    } catch (err) {
      setOtpError(err.response?.data?.message || "Could not resend OTP.");
    } finally {
      setResendLoading(false);
    }
  };

  const field = "block w-full h-12 px-4 py-3 rounded-lg border border-gray-300 outline-none focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/10";

  return (
    <AuthBackground>
      <div className="w-full max-w-[460px] bg-white rounded-xl shadow-lg p-8 sm:p-10 border border-gray-100">
        <div className="mb-6 text-center">
          <h1 className="text-[#EA2831] text-4xl font-bold tracking-tight">Khettify</h1>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-stone-400">Seller Portal</p>
        </div>

        {step === "form" ? (
          <>
            <div className="mb-6 text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Create your seller account</h2>
              <p className="text-sm text-gray-500 font-medium">Become a Khettify distributor</p>
            </div>

            <form className="space-y-4" onSubmit={handleSendOtp}>
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

              {serverError && <p className="text-center text-sm font-medium text-red-600">⚠ {serverError}</p>}

              <button
                className="w-full rounded-lg bg-[#EA2831] py-3.5 text-base font-bold text-white shadow-lg hover:bg-red-600 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                type="submit"
                disabled={loading || !isValid}
              >
                {loading ? "Sending OTP..." : "Send OTP"}
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
          </>
        ) : (
          <>
            <div className="mb-6 text-center">
              <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
                <span className="material-symbols-outlined text-[#EA2831] text-3xl">mark_email_read</span>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Check your email</h2>
              <p className="text-sm text-gray-500">
                We sent a 6-digit OTP to<br />
                <span className="font-semibold text-gray-800">{form.email}</span>
              </p>
            </div>

            <form className="space-y-4" onSubmit={handleVerify}>
              <div className="space-y-1">
                <label className="block text-sm font-semibold text-gray-700 text-center">Enter OTP</label>
                <input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className={`${field} text-center text-2xl font-bold tracking-[0.5em] letter-spacing`}
                  placeholder="_ _ _ _ _ _"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                />
                {otpError && <p className="text-red-500 text-xs font-medium text-center">⚠ {otpError}</p>}
                {resendMsg && <p className="text-green-600 text-xs font-medium text-center">{resendMsg}</p>}
              </div>

              <p className="text-xs text-gray-400 text-center">OTP expires in 10 minutes</p>

              <button
                className="w-full rounded-lg bg-[#EA2831] py-3.5 text-base font-bold text-white shadow-lg hover:bg-red-600 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                type="submit"
                disabled={loading || otp.length !== 6}
              >
                {loading ? "Verifying..." : "Verify & Create Account"}
              </button>

              <div className="flex items-center justify-between text-sm pt-1">
                <button
                  type="button"
                  onClick={() => { setStep("form"); setOtp(""); setOtpError(""); setResendMsg(""); }}
                  className="text-gray-500 hover:text-gray-700 font-medium"
                >
                  ← Change email
                </button>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendLoading}
                  className="text-[#EA2831] font-semibold hover:underline disabled:opacity-50"
                >
                  {resendLoading ? "Sending..." : "Resend OTP"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </AuthBackground>
  );
};

export default SellerRegister;