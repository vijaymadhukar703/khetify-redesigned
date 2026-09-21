import React, { useState, useEffect } from "react";
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
  const [loading, setLoading] = useState(false);

  /* OTP-FIRST: submit करने पर account नहीं बनता. पहले email पर code जाता है
     और form का data server पर PendingCompanyRegistration में रुका रहता है.
     Account तभी बनता है जब सही code डाला जाए — तभी token मिलता है.
     यानी एक भी account ऐसा नहीं बन सकता जिसका email verified न हो. */
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState("");
  const [emailMasked, setEmailMasked] = useState("");
  const [notice, setNotice] = useState("");
  // Success toast — serverError वाले dark toast का हरा जुड़वाँ. दोनों एक ही
  // जगह (ऊपर-बीच) दिखते हैं, इसलिए एक बार में एक ही रखा जाता है.
  const [successToast, setSuccessToast] = useState("");
  // Resend cooldown — server 60s enforce करता है, यह उसी का UI mirror है.
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Toasts खुद हट जाते हैं. Error को ज़्यादा वक़्त मिलता है क्योंकि उसमें
  // पढ़ने और समझने लायक कुछ होता है; success सिर्फ़ पुष्टि है.
  useEffect(() => {
    if (!successToast) return;
    const id = setTimeout(() => setSuccessToast(""), 3000);
    return () => clearTimeout(id);
  }, [successToast]);

  useEffect(() => {
    if (!serverError) return;
    const id = setTimeout(() => setServerError(""), 5000);
    return () => clearTimeout(id);
  }, [serverError]);

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
    setSuccessToast("");

    // Prevent duplicate submissions while one is in progress
    if (loading) return;

    if (!validateForm()) return;

    try {
      setLoading(true);
      // Email and Phone are mapped directly to the existing backend fields
      // (`email` and `number`) — the API/DB shape is unchanged, only the UI
      // now collects them as two separate, mandatory inputs.
      const payload = {
        fullName,
        email: email.trim(),
        number: phone.trim(),
        password,
      };

      // STEP 1 — सिर्फ़ code भेजता है. यहाँ कोई account नहीं बनता और
      // कोई token नहीं आता.
      const response = await axios.post(
        `${config.BASE_URL}company/register/send-otp`,
        payload,
      );

      setEmailMasked(response.data.emailMasked || email.trim());
      setOtpStep(true);
      setCooldown(60);
      setSuccessToast(
        response.data.otpSent
          ? "Verification code sent to your email"
          : "Code generated — check the server console",
      );
      setNotice(
        response.data.otpSent
          ? `We sent a 6-digit code to ${response.data.emailMasked || email.trim()}.`
          : "Couldn't send the email — check the server console for your code.",
      );
    } catch (error) {
      console.error("Registration Error:", error);
      setServerError(
        error.response?.data?.message || "Registration failed. Try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  /* STEP 2 — code verify. सफल होने पर ही account बनता है और token मिलता है,
     इसलिए localStorage यहीं भरा जाता है — वही तीन keys जो पहले register के
     जवाब से भरी जाती थीं. */
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setServerError("");
    setSuccessToast("");
    if (loading) return;

    if (otp.length < 6) {
      setServerError("Enter the 6-digit code");
      return;
    }

    try {
      setLoading(true);
      const response = await axios.post(
        `${config.BASE_URL}company/register/verify-otp`,
        { email: email.trim(), code: otp },
      );

      if (response.status === 201) {
        const { token, company } = response.data;

        localStorage.setItem("token", token);
        localStorage.setItem("companyId", company._id);
        localStorage.setItem("userName", company.fullName);

        setSuccessToast("Email verified — account created");
        // Toast पढ़ने भर का वक़्त, फिर setup. loading true ही रहता है ताकि
        // इस बीच button दोबारा न दबे.
        setTimeout(() => navigate("/company-setup"), 1200);
        return;
      }
    } catch (error) {
      console.error("OTP Verify Error:", error);
      // Server का message जस का तस — "Incorrect code", "Code expired" और
      // "Too many attempts" तीनों अलग बातें हैं और तीनों काम की हैं.
      setServerError(error.response?.data?.message || "Invalid code");
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (cooldown > 0) return;
    setServerError("");
    setSuccessToast("");
    setNotice("");
    try {
      const response = await axios.post(
        `${config.BASE_URL}company/register/resend-otp`,
        { email: email.trim() },
      );
      setCooldown(60);
      setSuccessToast(
        response.data.otpSent
          ? "A new code has been sent"
          : "Code generated — check the server console",
      );
      setNotice(
        response.data.otpSent
          ? "A new code has been sent to your email."
          : "Couldn't send the email — check the server console for your code.",
      );
    } catch (error) {
      setServerError(error.response?.data?.message || "Could not resend code");
    }
  };

  /* वापस form पर — email गलत टाइप हो गया हो तो सुधारने का रास्ता. */
  const handleChangeEmail = () => {
    setOtpStep(false);
    setOtp("");
    setServerError("");
    setNotice("");
    setCooldown(0);
  };

  /* ── OTP screen. वही background और card, सिर्फ़ अंदर का content अलग —
        ताकि लगे कि registrant उसी पन्ने पर आगे बढ़ा है, कहीं और नहीं गया. ── */
  if (otpStep) {
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
                Verify your email
              </h2>
              {notice && <p className="text-sm text-gray-600">{notice}</p>}
            </div>

            <form className="space-y-4" onSubmit={handleVerifyOtp}>
              <div className="space-y-1">
                <label className="block text-sm font-semibold text-gray-700">
                  Verification code
                  <span className="text-[#EA2831] ml-0.5">*</span>
                </label>
                <input
                  value={otp}
                  onChange={(e) =>
                    setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  className="block w-full h-14 px-4 rounded-lg border border-gray-300 text-center text-xl tracking-[0.5em] outline-none focus:border-[#ea2a33] focus:ring-2 focus:ring-[#ea2a33]/10"
                  placeholder="______"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                />
              </div>

              <div className="pt-2">
                <button
                  className="w-full rounded-lg bg-[#ea2a33] py-3.5 text-base font-bold text-white shadow-lg hover:bg-red-600 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                  type="submit"
                  disabled={loading || otp.length < 6}
                >
                  {loading ? "Verifying..." : "Verify & continue"}
                </button>
              </div>

              <div className="flex items-center justify-between pt-1 text-sm">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={cooldown > 0}
                  className="font-semibold text-[#ea2a33] hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline"
                >
                  {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
                </button>
                <button
                  type="button"
                  onClick={handleChangeEmail}
                  className="text-gray-600 hover:text-gray-900"
                >
                  &larr; {emailMasked || email}
                </button>
              </div>
            </form>
          </div>

          {successToast && (
            <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-[400px] bg-[#1b4d2e] text-white p-3 rounded-lg flex items-center gap-3 shadow-2xl animate-fade-in-up">
              <div className="bg-green-500 rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shadow-md">
                ✓
              </div>
              <p className="text-sm font-medium">{successToast}</p>
              <button
                onClick={() => setSuccessToast("")}
                className="ml-auto text-gray-300 text-lg hover:text-white"
              >
                ×
              </button>
            </div>
          )}

          {serverError && (
            <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-[400px] bg-[#333] text-white p-3 rounded-lg flex items-center gap-3 shadow-2xl animate-fade-in-up">
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
  }

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
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              Create your Khettify account
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
                  errors.fullName
                    ? "border-red-500"
                    : "border-gray-300 focus:border-[#ea2a33]"
                }`}
                placeholder="Enter fullname"
                type="text"
                required
              />
              {errors.fullName && (
                <p className="text-red-500 text-xs font-medium mt-1">
                  ⚠ {errors.fullName}
                </p>
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
                  const digitsOnly = e.target.value
                    .replace(/\D/g, "")
                    .slice(0, 10);
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
                className="w-full rounded-lg bg-[#ea2a33] py-3.5 text-base font-bold text-white shadow-lg hover:bg-red-600 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                type="submit"
                disabled={loading}
              >
                {loading ? "Sending code..." : "Create account"}
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
        {successToast && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-[400px] bg-[#1b4d2e] text-white p-3 rounded-lg flex items-center gap-3 shadow-2xl animate-fade-in-up">
            <div className="bg-green-500 rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shadow-md">
              ✓
            </div>
            <p className="text-sm font-medium">{successToast}</p>
            <button
              onClick={() => setSuccessToast("")}
              className="ml-auto text-gray-300 text-lg hover:text-white"
            >
              ×
            </button>
          </div>
        )}

        {serverError && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-[400px] bg-[#333] text-white p-3 rounded-lg flex items-center gap-3 shadow-2xl animate-fade-in-up">
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
