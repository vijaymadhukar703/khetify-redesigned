import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import config from "../../../config/config";
import { useSubscription } from "../../context/SubscriptionContext";
import { usePermission } from "../../context/PermissionContext";

const CompanyLogin = () => {
  const navigate = useNavigate();
  const { refresh } = useSubscription();
  const { refresh: refreshPermissions } = usePermission();

  const [emailOrPhone, setEmailOrPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);

  const validateForm = () => {
    const newErrors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^[0-9]{10}$/;

    if (!emailOrPhone.trim()) {
      newErrors.emailOrPhone = "Email or Phone is required";
    } else {
      const val = emailOrPhone.trim();
      const isPhone = phoneRegex.test(val);
      const isEmailFormat = emailRegex.test(val);
      const looksLikeEmail = /[a-zA-Z]/.test(val) || val.includes(".") || val.includes("@");

      if (isPhone) {
        // ok
      } else if (isEmailFormat) {
        // ok
      } else {
        if (looksLikeEmail) {
          newErrors.emailOrPhone = "Please enter a valid email";
        } else {
          newErrors.emailOrPhone = "Phone number must be 10 digits";
        }
      }
    }

    if (!password) {
      newErrors.password = "Password is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setServerError("");

    if (!validateForm()) return;

    try {
      setLoading(true);

      const loginValue = emailOrPhone.trim();

      let payload = {
        password: password.trim(),
      };

      if (loginValue.includes("@")) {
        payload.email = loginValue.toLowerCase();
      } else {
        payload.number = loginValue;
      }

      console.log("LOGIN PAYLOAD:", payload);

      let token, displayName, companyId, status;
      try {
        // 1) Company-owner login (unchanged behaviour, tried first)
        const response = await axios.post(
          `${config.BASE_URL}company/login`,
          payload,
        );
        ({ token, status } = response.data);
        displayName = response.data.company.fullName;
        companyId = response.data.company.id;
        localStorage.setItem("companyEmail", response.data.company.email || "");
        localStorage.setItem("companyNumber", response.data.company.number || "");
      } catch (companyErr) {
        // 2) Team-member login (operations_manager / sales_manager / ...).
        //    Only fall through on bad credentials — rethrow server errors.
        if (companyErr.response?.status >= 500) throw companyErr;
        const teamPayload = { password: password.trim() };
        if (loginValue.includes("@")) teamPayload.email = loginValue.toLowerCase();
        else teamPayload.phone = loginValue;
        const teamRes = await axios.post(`${config.BASE_URL}users/login`, teamPayload);
        token = teamRes.data.token;
        displayName = teamRes.data.user.name;
        companyId = teamRes.data.user.companyId;
        status = "approved"; // team accounts exist only under an approved company
      }

      localStorage.setItem("token", token);
      localStorage.setItem("companyId", companyId);
      localStorage.setItem("userName", displayName);
      localStorage.setItem("companyStatus", status);

      // 🔄 Re-pull the subscription AND role/capabilities for THIS account so
      // feature- and role-gating reflect the new login (not whoever was
      // logged in before).
      await Promise.all([refresh(), refreshPermissions()]);

      navigate("/hub");
    } catch (error) {
      console.error("Login Error:", error);

      setServerError(
        error.response?.data?.message || "Login failed. Try again.",
      );
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
            <h1 className="text-[#ea2a33] text-4xl font-bold tracking-tight">
              Khettify
            </h1>
          </div>

          <div className="mb-6 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Login to your account
            </h2>
            <p className="text-sm text-gray-500 font-medium">
              Welcome back to Khettify
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleLogin}>
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">
                Email or Phone<span className="text-[#EA2831] ml-0.5">*</span>
              </label>

              <input
                value={emailOrPhone}
                onChange={(e) => setEmailOrPhone(e.target.value)}
                className={`block w-full h-12 px-4 py-3 rounded-lg border outline-none focus:ring-2 focus:ring-[#ea2a33]/10 ${
                  errors.emailOrPhone
                    ? "border-red-500"
                    : "border-gray-300 focus:border-[#ea2a33]"
                }`}
                placeholder="Enter email or 10-digit phone"
                type="text"
              />

              {errors.emailOrPhone && (
                <p className="text-red-500 text-xs font-medium mt-1">
                  ⚠ {errors.emailOrPhone}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">
                Password<span className="text-[#EA2831] ml-0.5">*</span>
              </label>

              <div className="relative">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`block w-full h-12 px-4 py-3 pr-11 rounded-lg border outline-none focus:ring-2 focus:ring-[#ea2a33]/10 ${
                    errors.password
                      ? "border-red-500"
                      : "border-gray-300 focus:border-[#ea2a33]"
                  }`}
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

              {errors.password && (
                <p className="text-red-500 text-xs font-medium mt-1">
                  ⚠ {errors.password}
                </p>
              )}

              <div className="text-right pt-1">
                <span
                  onClick={() => navigate("/forgot-password")}
                  className="text-sm text-[#ea2a33] font-semibold cursor-pointer hover:underline"
                >
                  Forgot password?
                </span>
              </div>
            </div>

            <div className="pt-2">
              <button
                className="w-full rounded-lg bg-[#ea2a33] py-3.5 text-base font-bold text-white shadow-lg hover:bg-red-600 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                type="submit"
                disabled={loading}
              >
                {loading ? "Logging in..." : "Login"}
              </button>
            </div>
            <div className="text-center mt-5">
              <p className="text-sm text-gray-600">
                Don't have an account?{" "}
                <span
                  onClick={() => navigate("/register")}
                  className="text-[#ea2a33] font-semibold cursor-pointer hover:underline"
                >
                  Create Account
                </span>
              </p>
            </div>
          </form>
        </div>

        {serverError && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-[400px] bg-[#333] text-white p-3 rounded-lg flex items-center gap-3 shadow-2xl animate-fade-in-up">
            <div className="bg-red-500 rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shadow-md">
              !
            </div>
            <p className="text-sm font-medium">{serverError}</p>
            <button
              onClick={() => setServerError("")}
              className="ml-auto text-gray-400 text-lg hover:text-white"
            >
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CompanyLogin;
