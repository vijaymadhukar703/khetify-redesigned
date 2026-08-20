import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import config from "../../../config/config";

const CompanyForgotPassword = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) return setError("Email is required");
    if (!emailRegex.test(email.trim())) return setError("Please enter a valid email");

    try {
      setLoading(true);
      const body = { email: email.trim().toLowerCase() };
      // One login screen serves BOTH principals: the company OWNER (a Company
      // document) and TEAM MEMBERS such as Warehouse Managers (User documents).
      // The address alone can't tell them apart, so ask both endpoints and let
      // whichever owns the account send the link. Both are enumeration-safe —
      // they answer identically whether or not the account exists — so this
      // leaks nothing and the company request is byte-identical to before.
      // allSettled: one side having no such account must not fail the other.
      const results = await Promise.allSettled([
        axios.post(`${config.BASE_URL}company/forgot-password`, body),
        axios.post(`${config.BASE_URL}users/forgot-password`, body),
      ]);
      if (results.every((r) => r.status === 'rejected')) throw results[0].reason;
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#f8f6f6] min-h-screen flex flex-col relative overflow-y-auto font-['Sora',sans-serif] antialiased">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-black/30 z-10"></div>
        <div
          className="w-full h-full bg-cover bg-center"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1500382017468-9049fed747ef?ixlib=rb-4.0.3&auto=format&fit=crop&w=2400&q=80')",
          }}
        ></div>
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen p-4 py-12">
        <div className="w-full max-w-[440px] bg-white rounded-xl shadow-lg p-8 sm:p-10 border border-gray-100">
          <div className="mb-6 text-center">
            <h1 className="text-[#ea2a33] text-4xl font-bold tracking-tight">Khetify</h1>
          </div>

          {sent ? (
            <div className="text-center space-y-4">
              <div className="mx-auto h-14 w-14 rounded-full bg-green-50 flex items-center justify-center">
                <span className="material-symbols-outlined text-green-600 text-3xl">mark_email_read</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Check your email</h2>
              <p className="text-sm text-gray-500 font-medium">
                If an account exists for <span className="font-semibold text-gray-700">{email.trim()}</span>, we've sent a
                password reset link. It is valid for 1 hour.
              </p>
              <button
                onClick={() => navigate("/login")}
                className="w-full rounded-lg bg-[#ea2a33] py-3.5 text-base font-bold text-white shadow-lg hover:bg-red-600 transition-all active:scale-[0.98]"
              >
                Back to Login
              </button>
            </div>
          ) : (
            <>
              <div className="mb-6 text-center">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Forgot password?</h2>
                <p className="text-sm text-gray-500 font-medium">
                  Enter your account email and we'll send you a reset link.
                </p>
              </div>

              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-1">
                  <label className="block text-sm font-semibold text-gray-700">
                    Email<span className="text-[#EA2831] ml-0.5">*</span>
                  </label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`block w-full h-12 px-4 py-3 rounded-lg border outline-none focus:ring-2 focus:ring-[#ea2a33]/10 ${
                      error ? "border-red-500" : "border-gray-300 focus:border-[#ea2a33]"
                    }`}
                    placeholder="Enter your registered email"
                    type="email"
                  />
                  {error && <p className="text-red-500 text-xs font-medium mt-1">⚠ {error}</p>}
                </div>

                <div className="pt-2">
                  <button
                    className="w-full rounded-lg bg-[#ea2a33] py-3.5 text-base font-bold text-white shadow-lg hover:bg-red-600 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                    type="submit"
                    disabled={loading}
                  >
                    {loading ? "Sending..." : "Send reset link"}
                  </button>
                </div>

                <div className="text-center mt-5">
                  <span
                    onClick={() => navigate("/login")}
                    className="text-sm text-[#ea2a33] font-semibold cursor-pointer hover:underline"
                  >
                    Back to Login
                  </span>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CompanyForgotPassword;