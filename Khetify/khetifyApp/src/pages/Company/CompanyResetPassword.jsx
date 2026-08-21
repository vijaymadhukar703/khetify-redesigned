import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import config from "../../../config/config";

const CompanyResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  // The reset link a TEAM MEMBER (e.g. a Warehouse Manager) receives carries
  // `type=member`, so the same page consumes the token on the member
  // endpoint. Without the param this is the company flow, exactly as before.
  //
  // A SELLER member's link carries `type=seller` and is consumed on the seller
  // endpoint — company members reset through /api/users and seller members
  // through /api/seller, because each only matches its own `ownerType`. The
  // page itself is identical for all three: same form, same rules, same
  // messages. Only the URL the token is posted to differs.
  const resetType = searchParams.get("type");
  const isMember = resetType === "member";
  const endpoint =
    resetType === "seller"
      ? "seller/reset-password"
      : isMember
        ? "users/reset-password"
        : "company/reset-password";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!token) return setError("This reset link is invalid or incomplete.");
    if (password.length < 6) return setError("Password must be at least 6 characters");
    if (password !== confirm) return setError("Passwords do not match");

    try {
      setLoading(true);
      await axios.post(`${config.BASE_URL}${endpoint}`, {
        token,
        password: password.trim(),
      });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.message || "Could not reset password. Try again.");
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

          {done ? (
            <div className="text-center space-y-4">
              <div className="mx-auto h-14 w-14 rounded-full bg-green-50 flex items-center justify-center">
                <span className="material-symbols-outlined text-green-600 text-3xl">check_circle</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Password updated</h2>
              <p className="text-sm text-gray-500 font-medium">
                Your password has been reset. You can now log in with your new password.
              </p>
              <button
                onClick={() => navigate("/login")}
                className="w-full rounded-lg bg-[#ea2a33] py-3.5 text-base font-bold text-white shadow-lg hover:bg-red-600 transition-all active:scale-[0.98]"
              >
                Go to Login
              </button>
            </div>
          ) : (
            <>
              <div className="mb-6 text-center">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Set a new password</h2>
                <p className="text-sm text-gray-500 font-medium">Choose a strong password for your account.</p>
              </div>

              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-1">
                  <label className="block text-sm font-semibold text-gray-700">
                    New password<span className="text-[#EA2831] ml-0.5">*</span>
                  </label>
                  <div className="relative">
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="block w-full h-12 px-4 py-3 pr-11 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-[#ea2a33]/10 focus:border-[#ea2a33]"
                      placeholder="At least 6 characters"
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

                <div className="space-y-1">
                  <label className="block text-sm font-semibold text-gray-700">
                    Confirm password<span className="text-[#EA2831] ml-0.5">*</span>
                  </label>
                  <input
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="block w-full h-12 px-4 py-3 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-[#ea2a33]/10 focus:border-[#ea2a33]"
                    placeholder="Re-enter new password"
                    type={showPassword ? "text" : "password"}
                  />
                </div>

                {error && <p className="text-red-500 text-xs font-medium">⚠ {error}</p>}

                <div className="pt-2">
                  <button
                    className="w-full rounded-lg bg-[#ea2a33] py-3.5 text-base font-bold text-white shadow-lg hover:bg-red-600 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                    type="submit"
                    disabled={loading}
                  >
                    {loading ? "Updating..." : "Reset password"}
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

export default CompanyResetPassword;