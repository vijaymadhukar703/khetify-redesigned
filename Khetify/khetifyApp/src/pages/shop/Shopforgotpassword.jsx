import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useShopAuth } from "../../context/ShopAuthContext";
import {
  Icon,
  TextField,
  PasswordField,
  PrimaryButton,
  ErrorNote,
  AuthShell,
} from "../../Components/shop/authUi";

/* Customer FORGOT PASSWORD — दो कदम, एक ही page पर (ShopRegister की तरह).
 *
 *   step 1  phone डालो         → OTP जाता है
 *   step 2  OTP + नया password → password बदल जाता है → login screen
 *
 * यह उन shoppers के लिए है जो log in ही नहीं कर सकते, इसलिए यहाँ कोई token
 * नहीं चलता. Reset के बाद भी token नहीं मिलता — shopper नया password डालकर
 * खुद log in करता है, जिससे पक्का होता है कि उसे वो याद है. */

const PHONE_RE = /^[0-9]{10}$/;

export default function ShopForgotPassword() {
  const navigate = useNavigate();
  const { sendResetOtp, resendResetOtp, resetPassword } = useShopAuth();
  const loginHref = "/customer-shop/login";

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [phoneMasked, setPhoneMasked] = useState("");

  const [step, setStep] = useState(1); // 1 = phone, 2 = code + new password
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [done, setDone] = useState(false);
  // Resend cooldown — server 60s enforce करता है, यह उसी का UI mirror है.
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const onPhone = (e) =>
    setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
  const onOtp = (e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));

  /* STEP 1 — number भेजो, code माँगो. */
  const submitPhone = async (e) => {
    e.preventDefault();
    if (!PHONE_RE.test(phone)) {
      setError("Enter a valid 10-digit phone number");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const res = await sendResetOtp(phone);
      setPhoneMasked(res.phoneMasked || phone);
      setStep(2);
      setCooldown(60);
      setNotice(
        res.otpSent
          ? `We sent a 6-digit code to ${res.phoneMasked || phone}.`
          : "Couldn't send the SMS — check the server console for your code.",
      );
    } catch (err) {
      // Number registered न हो तो server साफ़ 404 + message लौटाता है.
      setError(err?.response?.data?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  /* STEP 2 — code + नया password. यहीं password बदलता है. */
  const submitReset = async (e) => {
    e.preventDefault();
    if (otp.length < 6) {
      setError("Enter the 6-digit code");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await resetPassword(phone, otp, password);
      setDone(true);
      // Shopper को बदलाव पढ़ने का पल दो, फिर login screen.
      setTimeout(() => navigate(loginHref, { replace: true }), 2000);
    } catch (err) {
      setError(err?.response?.data?.message || "Could not reset password");
      setBusy(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0) return;
    setError("");
    setNotice("");
    try {
      const res = await resendResetOtp(phone);
      setCooldown(60);
      setNotice(
        res.otpSent
          ? "A new code has been sent to your phone."
          : "Couldn't send the SMS — check the server console for your code.",
      );
    } catch (err) {
      setError(err?.response?.data?.message || "Could not resend code");
    }
  };

  /* वापस step 1 — number गलत टाइप हो गया हो तो सुधारने का रास्ता. */
  const changeNumber = () => {
    setStep(1);
    setOtp("");
    setPassword("");
    setConfirm("");
    setError("");
    setNotice("");
    setCooldown(0);
  };

  /* ── Password बदल गया ── */
  if (done) {
    return (
      <AuthShell variant="login">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E9F2EA] text-[#2E6B3E]">
          <Icon.Check className="h-6 w-6" />
        </div>
        <h1 className="mb-1.5 font-heading text-2xl font-extrabold tracking-tight text-[#14201A] sm:text-3xl">
          Password changed
        </h1>
        <p className="mb-6 text-[15px] leading-normal text-[#6B6A62]">
          You can now sign in with your new password. Taking you to the login
          page…
        </p>
        <Link
          to={loginHref}
          className="font-bold text-[#EA2831] hover:text-[#c91e26]"
        >
          Go to login &rarr;
        </Link>
      </AuthShell>
    );
  }

  /* ── STEP 2: code + नया password ── */
  if (step === 2) {
    return (
      <AuthShell variant="login">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FDECEC] text-[#EA2831]">
          <Icon.Phone className="h-6 w-6" />
        </div>
        <h1 className="mb-1.5 font-heading text-2xl font-extrabold tracking-tight text-[#14201A] sm:text-3xl">
          Enter the code
        </h1>
        {notice && (
          <p className="mb-6 text-[14px] leading-normal text-[#6B6A62] sm:text-[15px]">
            {notice}
          </p>
        )}

        <form onSubmit={submitReset} className="flex flex-col gap-[18px]">
          {error && <ErrorNote>{error}</ErrorNote>}

          <input
            value={otp}
            onChange={onOtp}
            placeholder="______"
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="6-digit verification code"
            className="h-[54px] w-full rounded-[14px] border-[1.5px] border-[#E2E0D6] bg-white px-4 text-center text-lg tracking-[0.4em] text-[#14201A] outline-none transition-all focus:border-[#EA2831] focus:ring-4 focus:ring-[#EA2831]/10 sm:h-[56px] sm:text-xl sm:tracking-[0.5em]"
          />

          <PasswordField
            label="New password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            autoComplete="new-password"
          />
          <PasswordField
            label="Confirm new password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter your new password"
            autoComplete="new-password"
          />

          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Please wait…" : "Reset password"}
          </PrimaryButton>
        </form>

        <div className="mt-5 flex justify-between text-sm">
          <button
            onClick={resend}
            disabled={cooldown > 0}
            className="font-semibold text-[#EA2831] hover:text-[#c91e26] disabled:cursor-not-allowed disabled:text-[#9B9A92]"
          >
            {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
          </button>
          <button
            onClick={changeNumber}
            className="text-[#6B6A62] hover:text-[#14201A]"
          >
            &larr; {phoneMasked || phone}
          </button>
        </div>
      </AuthShell>
    );
  }

  /* ── STEP 1: phone number ── */
  return (
    <AuthShell variant="login">
      <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FDECEC] text-[#EA2831]">
        <Icon.Lock className="h-6 w-6" />
      </div>
      <h1 className="mb-2 font-heading text-2xl font-extrabold tracking-tight text-[#14201A] sm:text-3xl">
        Forgot your password?
      </h1>
      <p className="mb-6 text-[15px] leading-normal text-[#6B6A62] sm:mb-7 sm:text-base">
        Enter the phone number on your account and we&rsquo;ll send you a code
        to set a new password.
      </p>

      <form onSubmit={submitPhone} className="flex flex-col gap-[18px]">
        {error && <ErrorNote>{error}</ErrorNote>}

        <TextField
          label="Phone number"
          icon={Icon.Phone}
          type="tel"
          required
          value={phone}
          onChange={onPhone}
          placeholder="10-digit mobile number"
          autoComplete="tel"
          inputMode="numeric"
          maxLength={10}
        />

        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Please wait…" : "Send code"}
        </PrimaryButton>
      </form>

      <p className="mt-6 text-center text-[15px] text-[#6B6A62]">
        Remembered it?{" "}
        <Link
          to={loginHref}
          className="font-bold text-[#EA2831] hover:text-[#c91e26]"
        >
          Back to login
        </Link>
      </p>
    </AuthShell>
  );
}
