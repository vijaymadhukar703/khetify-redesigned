import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useShopAuth } from "../../context/ShopAuthContext";
import { shopVerifyOtp, shopResendOtp } from "../../lib/shopApi";
import { Icon, TextField, PasswordField, PrimaryButton, ErrorNote, AuthShell } from "../../Components/shop/authUi";

/* Customer REGISTER page (separate from Login). UI recreated in the reference
   style with the shared full-height split shell; auth logic UNCHANGED:
   register({ name, email, phone, password }) → email-OTP step
   (shopVerifyOtp / shopResendOtp / skip) or a direct redirect. */

export default function ShopRegister() {
  const navigate = useNavigate();
  const { register } = useShopAuth();
  // Always land on the customer dashboard after registering / verifying — never
  // a previous page. The ?redirect= param is intentionally ignored.
  const HOME = "/customer-shop/home";
  const loginHref = "/customer-shop/login";

  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState("");
  const [notice, setNotice] = useState("");
  const [agree, setAgree] = useState(false); // Terms & Conditions gate (UI)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Phone: digits only, capped at 10 (blocks alphabets / extra digits as typed).
  const onPhone = (e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }));

  const submit = async (e) => {
    e.preventDefault();
    if (!agree) { setError("Please accept the Terms & Conditions to continue."); return; }
    // ⚡ CORRECTION: Check phone validation explicitly since it's mandatory now
    if (!form.name || !form.email || !form.phone) { setError("All fields (Name, Email, and Phone) are required."); return; }
    if (form.phone.length !== 10) { setError("Please enter a valid 10-digit phone number."); return; }
    setError(""); setBusy(true);
    try {
      const res = await register({ name: form.name, email: form.email, phone: form.phone, password: form.password });
      if (form.email) {
        setOtpStep(true);
        setNotice(res.otpSent
          ? `We sent a 6-digit code to ${form.email}.`
          : "Account created. (Email sending isn't configured — check the server console for your code, or skip verification.)");
      } else {
        navigate(HOME, { replace: true });
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await shopVerifyOtp(otp);
      navigate(HOME, { replace: true });
    } catch (err) {
      setError(err?.response?.data?.message || "Invalid code");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(""); setNotice("");
    try {
      const res = await shopResendOtp();
      setNotice(res.otpSent ? "A new code has been sent." : "Code generated — check the server console (email not configured).");
    } catch (err) {
      setError(err?.response?.data?.message || "Could not resend code");
    }
  };

  const skip = () => navigate(HOME, { replace: true });

  if (otpStep) {
    return (
      <AuthShell variant="register">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FDECEC] text-[#EA2831]">
          <Icon.MailCheck className="h-6 w-6" />
        </div>
        <h1 className="mb-1.5 font-heading text-2xl font-extrabold tracking-tight text-[#14201A] sm:text-3xl">Verify your email</h1>
        {notice && <p className="mb-6 text-[14px] leading-normal text-[#6B6A62] sm:text-[15px]">{notice}</p>}

        <form onSubmit={verify} className="flex flex-col gap-[18px]">
          {error && <ErrorNote>{error}</ErrorNote>}
          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder="______"
            maxLength={6}
            inputMode="numeric"
            aria-label="6-digit code"
            className="h-[54px] w-full rounded-[14px] border-[1.5px] border-[#E2E0D6] bg-white px-4 text-center text-lg tracking-[0.4em] text-[#14201A] outline-none transition-all focus:border-[#EA2831] focus:ring-4 focus:ring-[#EA2831]/10 sm:h-[56px] sm:text-xl sm:tracking-[0.5em]"
          />
          <PrimaryButton type="submit" disabled={busy || otp.length < 4}>
            {busy ? "Verifying…" : "Verify & continue"}
          </PrimaryButton>
        </form>

        <div className="mt-5 flex justify-between text-sm">
          <button onClick={resend} className="font-semibold text-[#EA2831] hover:text-[#c91e26]">Resend code</button>
          {/* <button onClick={skip} className="text-[#6B6A62] hover:text-[#14201A]">Skip for now →</button> */}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell variant="register">
      <h1 className="mb-2 font-heading text-2xl font-extrabold tracking-tight text-[#14201A] sm:text-3xl md:text-4xl">
        Create your account
      </h1>
      <p className="mb-6 text-[15px] leading-normal text-[#6B6A62] sm:mb-7 sm:text-base">
        Join thousands of Indian growers and buyers. Sign up to place your order.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-[18px]">
        {error && <ErrorNote>{error}</ErrorNote>}

        <TextField
          label="Full name" icon={Icon.User} type="text" required
          value={form.name} onChange={set("name")}
          placeholder="Enter your name" autoComplete="name"
        />

        {/* Email + phone: each on its own line. */}
        <TextField
          label="Email" icon={Icon.Mail} type="email" required
          value={form.email} onChange={set("email")}
          placeholder="Enter your email" autoComplete="email"
        />
        <TextField
          label="Phone" icon={Icon.Phone} type="tel" required
          value={form.phone} onChange={onPhone}
          placeholder="Enter your phone number" autoComplete="tel"
          inputMode="numeric" maxLength={10}
        />

        <p className="-mt-2 flex items-center gap-1.5 text-[13px] text-[#9B9A92]">
          <Icon.Info className="h-[13px] w-[13px] shrink-0" /> Please provide both a valid email and phone number.
        </p>

        <PasswordField
          required value={form.password} onChange={set("password")}
          placeholder="Enter your password" autoComplete="new-password"
        />

        <label className="flex cursor-pointer select-none items-start gap-2.5">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer accent-[#EA2831]"
          />
          <span className="text-sm leading-normal text-[#6B6A62]">
            I agree to Khetify's <span className="font-semibold text-[#EA2831]">Terms &amp; Conditions</span> and{" "}
            <span className="font-semibold text-[#EA2831]">Privacy Policy</span>.
          </span>
        </label>

        <PrimaryButton type="submit" disabled={busy || !agree}>
          {busy ? "Please wait…" : "Create account"}
        </PrimaryButton>
      </form>

      <p className="mt-6 text-center text-[15px] text-[#6B6A62]">
        Already have an account?{" "}
        <Link to={loginHref} className="font-bold text-[#EA2831] hover:text-[#c91e26]">Login</Link>
      </p>
    </AuthShell>
  );
}