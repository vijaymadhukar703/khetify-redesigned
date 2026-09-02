import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import config from "../../../config/config"; 

const CompanyRegister = () => {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // In-line error states
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");

 const validateForm = () => {
   let newErrors = {};

   const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
   const phoneRegex = /^[0-9]{10}$/;

   if (!fullName.trim()) {
     newErrors.fullName = "Full name is required";
   }

   // Email and Phone are two separate, independently required fields — both
   // must be present and valid before the form can be submitted.
   if (!email.trim()) {
     newErrors.email = "Email is required";
   } else if (!emailRegex.test(email.trim())) {
     newErrors.email = "Please enter a valid email";
   }

   if (!phone.trim()) {
     newErrors.phone = "Phone number is required";
   } else if (!phoneRegex.test(phone.trim())) {
     newErrors.phone = "Phone number must be exactly 10 digits";
   }

   if (!password) {
     newErrors.password = "Password is required";
   } else if (password.length < 6) {
     newErrors.password = "Must be at least 6 characters";
   }

   if (password !== confirmPassword) {
     newErrors.confirmPassword = "Passwords do not match";
   }

   if (!agreeTerms) {
     newErrors.terms = "You must agree to the terms and conditions";
   }

   setErrors(newErrors);
   return Object.keys(newErrors).length === 0;
 };


  const handleRegister = async (e) => {
    e.preventDefault();
    setServerError("");

    if (!validateForm()) return;

    try {
      // Email and Phone are mapped directly to the existing backend fields
      // (`email` and `number`) — the API/DB shape is unchanged, only the UI
      // now collects them as two separate, mandatory inputs.
      const payload = {
        fullName,
        email: email.trim(),
        number: phone.trim(),
        password,
      };

      const response = await axios.post(
        `${config.BASE_URL}company/register`,
        payload,
      );

      if (response.status === 201) {
        const { token, company } = response.data;

        localStorage.setItem("token", token);
        localStorage.setItem("companyId", company._id);
        localStorage.setItem("userName", company.fullName);

        navigate("/company-setup");
      }
    } catch (error) {
      console.error("Registration Error:", error);
      setServerError(
        error.response?.data?.message || "Registration failed. Try again.",
      );
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
              Khetify
            </h1>
          </div>
          <div className="mb-6 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              Create your Khetify account
            </h2>
          </div>

          <form className="space-y-4" onSubmit={handleRegister}>
            {/* Full Name */}
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">
                Full name<span className="text-[#EA2831] ml-0.5">*</span>
              </label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={`block w-full h-12 px-4 py-3 rounded-lg border outline-none focus:ring-2 focus:ring-[#ea2a33]/10 ${
                  errors.fullName ? "border-red-500" : "border-gray-300 focus:border-[#ea2a33]"
                }`}
                placeholder="Enter fullname"
                type="text"
                required
              />
              {errors.fullName && (
                <p className="text-red-500 text-xs font-medium mt-1">⚠ {errors.fullName}</p>
              )}
            </div>

            {/* Email Address */}
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">
                Email Address<span className="text-[#EA2831] ml-0.5">*</span>
              </label>

              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`block w-full h-12 px-4 py-3 rounded-lg border outline-none focus:ring-2 focus:ring-[#ea2a33]/10 ${
                  errors.email
                    ? "border-red-500"
                    : "border-gray-300 focus:border-[#ea2a33]"
                }`}
                placeholder="Enter email address"
                type="email"
                autoComplete="email"
                required
              />

              {errors.email && (
                <p className="text-red-500 text-xs font-medium mt-1">
                  ⚠ {errors.email}
                </p>
              )}
            </div>

            {/* Phone Number */}
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">
                Phone Number<span className="text-[#EA2831] ml-0.5">*</span>
              </label>

              <input
                value={phone}
                onChange={(e) => {
                  // Strip anything that isn't a digit and cap length at 10 so
                  // invalid characters / extra digits can never be entered.
                  const digitsOnly = e.target.value.replace(/\D/g, "").slice(0, 10);
                  setPhone(digitsOnly);
                }}
                className={`block w-full h-12 px-4 py-3 rounded-lg border outline-none focus:ring-2 focus:ring-[#ea2a33]/10 ${
                  errors.phone
                    ? "border-red-500"
                    : "border-gray-300 focus:border-[#ea2a33]"
                }`}
                placeholder="Enter 10-digit phone number"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]{10}"
                maxLength={10}
                autoComplete="tel"
                required
              />

              {errors.phone && (
                <p className="text-red-500 text-xs font-medium mt-1">
                  ⚠ {errors.phone}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">
                Password<span className="text-[#EA2831] ml-0.5">*</span>
              </label>
              <div className="relative">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`block w-full h-12 px-4 py-3 rounded-lg border outline-none focus:ring-2 focus:ring-[#ea2a33]/10 ${errors.password ? "border-red-500" : "border-gray-300 focus:border-[#ea2a33]"}`}
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
            </div>

            {/* Confirm Password */}
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">
                Confirm password<span className="text-[#EA2831] ml-0.5">*</span>
              </label>
              <div className="relative">
                <input
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`block w-full h-12 px-4 py-3 rounded-lg border outline-none focus:ring-2 focus:ring-[#ea2a33]/10 ${errors.confirmPassword ? "border-red-500" : "border-gray-300 focus:border-[#ea2a33]"}`}
                  placeholder="••••••••"
                  type={showConfirmPassword ? "text" : "password"}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {showConfirmPassword ? "visibility_off" : "visibility"}
                  </span>
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-red-500 text-xs font-medium mt-1">
                  ⚠ {errors.confirmPassword}
                </p>
              )}
            </div>

            {/* Terms */}
            <div className="space-y-1 pt-1">
              <div className="flex items-start space-x-3">
                <input
                  id="terms"
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-[#ea2a33] focus:ring-[#ea2a33] cursor-pointer"
                />
                <label
                  htmlFor="terms"
                  className="text-sm text-gray-600 font-medium cursor-pointer"
                >
                  I agree to the{" "}
                  <span className="text-[#ea2a33] font-bold">Terms</span> &{" "}
                  <span className="text-[#ea2a33] font-bold">
                    Privacy Policy
                  </span>
                  <span className="text-[#EA2831] ml-0.5">*</span>
                </label>
              </div>
              {errors.terms && (
                <p className="text-red-500 text-xs font-medium mt-1">
                  ⚠ {errors.terms}
                </p>
              )}
            </div>

            <div className="pt-2">
              <button
                className="w-full rounded-lg bg-[#ea2a33] py-3.5 text-base font-bold text-white shadow-lg hover:bg-red-600 transition-all active:scale-[0.98]"
                type="submit"
              >
                Create account
              </button>
            </div>
            <div className="text-center mt-5">
              <p className="text-sm text-gray-600">
                Already have an account?{" "}
                <span
                  onClick={() => navigate("/login")}
                  className="text-[#ea2a33] font-semibold cursor-pointer hover:underline"
                >
                  Login
                </span>
              </p>
            </div>
          </form>

          {/* Login Link Poori Tarah Hata Diya Gaya Hai */}
        </div>

        {/* Server side error (Company already exists etc.) */}
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

export default CompanyRegister;