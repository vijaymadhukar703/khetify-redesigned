import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useShopAuth } from "../../context/ShopAuthContext";
import { useT } from "../../context/ShopLanguageContext";
import {
  Icon,
  TextField,
  PasswordField,
  PrimaryButton,
  ErrorNote,
  AuthShell,
} from "../../Components/shop/authUi";

/* Customer REGISTER page (separate from Login) — OTP-FIRST.
 *
 * पुराने flow से फ़र्क़ सिर्फ़ इतना है कि submit करने पर account नहीं बनता:
 * phone पर OTP जाता है और form का data server पर PendingRegistration में रुका
 * रहता है. सही OTP डालने पर ही account बनता है और तभी token मिलता है.
 *
 * यानी एक भी account ऐसा नहीं बन सकता जिसका phone verified न हो. */

// The SAME shapes the backend checks (services/shopAuthService.js, which in
// turn matches validators/customerValidators.js).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9]{10}$/;

export default function ShopRegister() {
  const navigate = useNavigate();
  const t = useT();
  const { sendRegisterOtp, verifyRegisterOtp, resendRegisterOtp } =
    useShopAuth();
  // Always land on the customer dashboard after verifying — never a previous
  // page. The ?redirect= param is intentionally ignored.
  const HOME = "/customer-shop/home";
  const loginHref = "/customer-shop/login";

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState("");
  const [notice, setNotice] = useState("");
  const [agree, setAgree] = useState(false); // Terms & Conditions gate (UI)
  // Resend cooldown — server 60s enforce करता है, यह उसी का UI mirror है.
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Phone: digits only, capped at 10 (blocks alphabets / extra digits as typed).
  const onPhone = (e) =>
    setForm((f) => ({
      ...f,
      phone: e.target.value.replace(/\D/g, "").slice(0, 10),
    }));
  // OTP box: digits only, capped at 6.
  const onOtp = (e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));

  /* STEP 1 — validate + OTP भेजो. यहाँ कोई account नहीं बनता. */
  const submit = async (e) => {
    e.preventDefault();
    if (!agree) {
      setError(t("register.errAgree"));
      return;
    }
    // PHONE IS THE REQUIRED IDENTIFIER, EMAIL IS OPTIONAL. The same shapes the
    // backend enforces (services/shopAuthService.js), so anything accepted here
    // is never rejected on submit.
    if (!form.name.trim()) {
      setError(t("register.errName"));
      return;
    }
    if (!form.phone.trim()) {
      setError(t("register.errPhoneRequired"));
      return;
    }
    if (!PHONE_RE.test(form.phone.trim())) {
      setError(t("register.errPhoneInvalid"));
      return;
    }
    // Only validated when something was actually typed — an empty box is fine.
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) {
      setError(t("register.errEmail"));
      return;
    }
    setError("");
    setBusy(true);
    try {
      const res = await sendRegisterOtp({
        name: form.name,
        email: form.email,
        phone: form.phone,
        password: form.password,
      });
      setOtpStep(true);
      setCooldown(60);
      setNotice(
        res.otpSent
          ? `We sent a 6-digit code to ${form.phone}.`
          : "Couldn't send the SMS — check the server console for your code.",
      );
    } catch (err) {
      setError(err?.response?.data?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  /* STEP 2 — OTP verify. सफल होने पर ही account बनता है और token मिलता है. */
  const verify = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // यही call account बनाती है; context token + consumer खुद set कर देता है,
      // इसलिए यहाँ reload की ज़रूरत नहीं — सीधा dashboard पर.
      await verifyRegisterOtp(form.phone, otp);
      navigate(HOME, { replace: true });
    } catch (err) {
      setError(err?.response?.data?.message || "Invalid code");
      setBusy(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0) return;
    setError("");
    setNotice("");
    try {
      const res = await resendRegisterOtp(form.phone);
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

  /* वापस form पर — number गलत टाइप हो गया हो तो सुधारने का रास्ता. */
  const changeNumber = () => {
    setOtpStep(false);
    setOtp("");
    setError("");
    setNotice("");
    setCooldown(0);
  };

  if (otpStep) {
    return (
      <AuthShell variant="register">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FDECEC] text-[#EA2831]">
          <Icon.Phone className="h-6 w-6" />
        </div>
        <h1 className="mb-1.5 font-heading text-2xl font-extrabold tracking-tight text-[#14201A] sm:text-3xl">
          {t("register.verifyTitle")}
        </h1>
        {notice && (
          <p className="mb-6 text-[14px] leading-normal text-[#6B6A62] sm:text-[15px]">
            {notice}
          </p>
        )}

        <form onSubmit={verify} className="flex flex-col gap-[18px]">
          {error && <ErrorNote>{error}</ErrorNote>}
          <input
            value={otp}
            onChange={onOtp}
            placeholder="______"
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={t("register.otpAria")}
            className="h-[54px] w-full rounded-[14px] border-[1.5px] border-[#E2E0D6] bg-white px-4 text-center text-lg tracking-[0.4em] text-[#14201A] outline-none transition-all focus:border-[#EA2831] focus:ring-4 focus:ring-[#EA2831]/10 sm:h-[56px] sm:text-xl sm:tracking-[0.5em]"
          />
          <PrimaryButton type="submit" disabled={busy || otp.length < 6}>
            {busy ? t("register.verifying") : t("register.verify")}
          </PrimaryButton>
        </form>

        <div className="mt-5 flex justify-between text-sm">
          <button
            onClick={resend}
            disabled={cooldown > 0}
            className="font-semibold text-[#EA2831] hover:text-[#c91e26] disabled:cursor-not-allowed disabled:text-[#9B9A92]"
          >
            {cooldown > 0
              ? `${t("register.resend")} (${cooldown}s)`
              : t("register.resend")}
          </button>
          <button
            onClick={changeNumber}
            className="text-[#6B6A62] hover:text-[#14201A]"
          >
            &larr; {form.phone}
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell variant="register">
      <h1 className="mb-2 font-heading text-2xl font-extrabold tracking-tight text-[#14201A] sm:text-3xl md:text-4xl">
        {t("register.title")}
      </h1>
      <p className="mb-6 text-[15px] leading-normal text-[#6B6A62] sm:mb-7 sm:text-base">
        {t("register.subtitle")}
      </p>

      <form onSubmit={submit} className="flex flex-col gap-[18px]">
        {error && <ErrorNote>{error}</ErrorNote>}

        <TextField
          label={t("register.nameLabel")}
          icon={Icon.User}
          type="text"
          required
          value={form.name}
          onChange={set("name")}
          placeholder={t("register.namePlaceholder")}
          autoComplete="name"
        />

        {/* Phone + email: each on its own line. Phone leads because it is the
            required identifier; `required` is dropped from Email so the browser
            stops blocking submit on an empty box. */}
        <TextField
          label={t("register.phoneLabel")}
          icon={Icon.Phone}
          type="tel"
          required
          value={form.phone}
          onChange={onPhone}
          placeholder={t("register.phonePlaceholder")}
          autoComplete="tel"
          inputMode="numeric"
          maxLength={10}
        />
        <TextField
          label={t("register.emailLabel")}
          icon={Icon.Mail}
          type="email"
          value={form.email}
          onChange={set("email")}
          placeholder={t("register.emailPlaceholder")}
          autoComplete="email"
        />

        <p className="-mt-2 flex items-center gap-1.5 text-[13px] text-[#9B9A92]">
          <Icon.Info className="h-[13px] w-[13px] shrink-0" />{" "}
          {t("register.phoneEmailNote")}
        </p>

        <PasswordField
          required
          value={form.password}
          onChange={set("password")}
          placeholder={t("register.passwordPlaceholder")}
          autoComplete="new-password"
        />

        <label className="flex cursor-pointer select-none items-start gap-2.5">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer accent-[#EA2831]"
          />
          <span className="text-sm leading-normal text-[#6B6A62]">
            {t("register.agreePrefix")}{" "}
            <span className="font-semibold text-[#EA2831]">
              {t("register.terms")}
            </span>{" "}
            {t("register.and")}{" "}
            <span className="font-semibold text-[#EA2831]">
              {t("register.privacy")}
            </span>
            .
          </span>
        </label>

        <PrimaryButton type="submit" disabled={busy || !agree}>
          {busy ? t("register.pleaseWait") : t("register.submit")}
        </PrimaryButton>
      </form>

      <p className="mt-6 text-center text-[15px] text-[#6B6A62]">
        {t("register.haveAccount")}{" "}
        <Link
          to={loginHref}
          className="font-bold text-[#EA2831] hover:text-[#c91e26]"
        >
          {t("register.login")}
        </Link>
      </p>
    </AuthShell>
  );
}
