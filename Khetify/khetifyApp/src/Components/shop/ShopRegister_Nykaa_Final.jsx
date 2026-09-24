import { useState, useRef, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useShopAuth } from "../../context/ShopAuthContext";
import { shopCheckRegister } from "../../lib/shopApi";
import { AuthShell, TextField, PrimaryButton, ErrorNote, Icon } from "./authUi";

/* Customer REGISTER — Nykaa-style, OTP-first, NO PASSWORD, 5 screens:
 *   phone | email  →  name + mobile  →  otp  →  success
 *
 * Standalone: uses the existing ShopAuthContext calls as-is and changes nothing
 * in authUi / context / backend.
 *   • The OTP ALWAYS goes to the mobile number (verify is keyed by phone). The
 *     email from Screen 2 is only saved on the account, never used for OTP.
 *   • /auth/register/send-otp still requires a password (≥ 6 chars). The
 *     shopper never sees one — a strong random password is generated here so
 *     the request is accepted. They can set their own later via Forgot Password.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9]{10}$/;
const OTP_LEN = 6;
const RESEND_SECONDS = 45;
const MAX_RESENDS = 5; // mirrors MAX_RESENDS in services/shopAuthService.js
const MAX_ATTEMPTS = 5; // mirrors OTP_MAX_ATTEMPTS on the server
const REDIRECT_DELAY_MS = 3000;
const PHONE_TAKEN = "📱 Phone number already registered";
const EMAIL_TAKEN = "📧 Email already registered";

const emptyOtp = () => Array(OTP_LEN).fill("");

// Throwaway password that satisfies the backend's "≥ 6 chars" rule. Never shown.
function generateHiddenPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// axios error → user-facing message. No response at all means the request
// never reached the server (offline, CORS, server down).
function errMessage(err, fallback) {
  if (!err?.response) return "Network error. Please check your connection and try again.";
  return err.response.data?.message || fallback;
}

/* ---------- Small screen-local pieces ---------- */
function Heading({ title, subtitle, onBack }) {
  return (
    <div className="mb-7">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Go back"
          className="-ml-2 mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full text-[#14201A] transition-colors hover:bg-[#E2E0D6]/60"
        >
          <Icon.ArrowLeft className="h-5 w-5" />
        </button>
      )}
      <h1 className="mb-2 font-heading text-2xl font-extrabold tracking-tight text-[#14201A] sm:text-3xl">{title}</h1>
      {subtitle && <p className="text-[15px] leading-normal text-[#6B6A62]">{subtitle}</p>}
    </div>
  );
}

function BusyLabel({ busy, busyText, children }) {
  if (!busy) return children;
  return (
    <>
      <Icon.Spinner className="h-5 w-5 animate-spin" />
      {busyText}
    </>
  );
}

function GoogleButton({ disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-[54px] w-full items-center justify-center gap-3 rounded-full border-[1.5px] border-[#E2E0D6] bg-white text-[15px] font-semibold text-[#14201A] transition-colors hover:border-[#c9c7bb] hover:bg-[#FAFAF7] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Icon.Google className="h-5 w-5" />
      Continue With Google
    </button>
  );
}

function LinkButton({ children, ...props }) {
  return (
    <button
      type="button"
      className="mx-auto block text-[15px] font-bold text-[#EA2831] hover:text-[#c91e26] disabled:cursor-not-allowed disabled:text-[#9B9A92]"
      {...props}
    >
      {children}
    </button>
  );
}

/* ---------- Page ---------- */
// `redirectTo` defaults to the shopper dashboard (/customer-shop/home) — the app
// has no bare /dashboard route, so sending shoppers there would 404.
export default function ShopRegister({ redirectTo = "/customer-shop/home" }) {
  const navigate = useNavigate();
  const { sendRegisterOtp, verifyRegisterOtp, resendRegisterOtp, isAuthed } = useShopAuth();

  const [step, setStep] = useState("phone"); // 'phone' | 'email' | 'name' | 'otp' | 'success'
  const [method, setMethod] = useState("phone"); // 'phone' | 'email'
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState(emptyOtp);
  const [resendTimer, setResendTimer] = useState(RESEND_SECONDS);
  const [resendCount, setResendCount] = useState(0);
  const [attemptCount, setAttemptCount] = useState(0);
  const [agreeTCs, setAgreeTCs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const otpRefs = useRef([]);
  // What Screen 1 held when the shopper left it — Screen 3 pre-fills from this.
  const screen1Phone = useRef("");

  // Google OAuth: seedha backend par full-page redirect (no popup).
  // Backend Google se login karwa kar ?token=...&success=true ke saath yahin wapas bhejta hai.
  const API_URL = import.meta.env.VITE_API_URL;
  const googleLogin = () => {
    window.location.href = `${API_URL}/api/auth/google`;
  };

  const go = (next) => {
    setError("");
    setNotice("");
    setStep(next);
  };

  /* ===== Google se wapas aaye? =====
     Token ShopAuthContext save karta hai aur /auth/me se verify karta hai.
     Consumer confirm hote hi (isAuthed) home par bhejo. URL ko pehle render par
     hi padh lete hain, kyunki context use turant saaf kar deta hai. */
  const cameFromGoogle = useRef(
    new URLSearchParams(window.location.search).get("success") === "true"
  );
  useEffect(() => {
    if (cameFromGoogle.current && isAuthed) navigate(redirectTo, { replace: true });
  }, [isAuthed, navigate, redirectTo]);
  /* ===== END: Google OAuth ===== */

  /* Resend countdown — ticks only while the OTP screen is up. */
  useEffect(() => {
    if (step !== "otp" || resendTimer <= 0) return;
    const id = setTimeout(() => setResendTimer((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [step, resendTimer]);

  /* Focus the first OTP box on arrival. */
  useEffect(() => {
    if (step === "otp") otpRefs.current[0]?.focus();
  }, [step]);

  /* Success → auto-redirect (the context has already stored token + consumer). */
  useEffect(() => {
    if (step !== "success") return;
    const id = setTimeout(() => navigate(redirectTo, { replace: true }), REDIRECT_DELAY_MS);
    return () => clearTimeout(id);
  }, [step, navigate, redirectTo]);

  const onPhoneChange = (e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));

  /* ---- Screen 1 / 2 → Screen 3 ----
     Each asks /auth/register/check first (read-only, no OTP). Any error —
     taken, invalid, network — is shown on THIS screen and we stay here. */
  const isTaken = async (body) => {
    const res = await shopCheckRegister(body);
    return body.phone ? res.phoneTaken : res.emailTaken;
  };

  const submitPhone = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!phone) return setError("Enter your mobile number.");
    if (!PHONE_RE.test(phone)) return setError("Enter a valid 10-digit mobile number.");

    setError("");
    setBusy(true);
    try {
      if (await isTaken({ phone })) return setError(PHONE_TAKEN);
      screen1Phone.current = phone;
      setMethod("phone");
      go("name");
    } catch (err) {
      setError(errMessage(err, "Could not check this number. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const submitEmail = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim()) return setError("Enter your email address.");
    if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email address.");

    setError("");
    setBusy(true);
    try {
      if (await isTaken({ email: email.trim() })) return setError(EMAIL_TAKEN);
      setPhone(""); // email route: the shopper must type the mobile on Screen 3
      setMethod("email");
      go("name");
    } catch (err) {
      setError(errMessage(err, "Could not check this email. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  // After a 409 from send/verify: which of phone / email is the taken one?
  // Falls back to the route the shopper started on if the check itself fails.
  const takenMessage = async () => {
    const fallback = method === "email" ? EMAIL_TAKEN : PHONE_TAKEN;
    try {
      const res = await shopCheckRegister(method === "email" ? { phone, email: email.trim() } : { phone });
      if (res.phoneTaken) return PHONE_TAKEN;
      if (res.emailTaken) return EMAIL_TAKEN;
      return fallback;
    } catch {
      return fallback;
    }
  };

  const toPhoneScreen = () => {
    setPhone(screen1Phone.current);
    go("phone");
  };

  /* ---- Screen 3 → send OTP to the mobile (no account is created yet) ---- */
  const submitName = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("Please enter your name.");
    if (!PHONE_RE.test(phone)) return setError("Enter a valid 10-digit mobile number.");

    setError("");
    setBusy(true);
    try {
      const res = await sendRegisterOtp({
        name: name.trim(),
        phone,
        email: method === "email" ? email.trim() : "",
        password: generateHiddenPassword(),
      });
      setOtp(emptyOtp());
      setAttemptCount(0);
      setResendCount(0);
      setResendTimer(RESEND_SECONDS);
      setAgreeTCs(false);
      setStep("otp");
      setNotice(res?.otpSent === false ? "We couldn't send the SMS right now. Tap Resend OTP in a moment." : "");
    } catch (err) {
      // 409 = "An account with this email or phone already exists". Screen 1/2
      // already cleared their own field, so on the email route this is almost
      // always the mobile typed here — ask which one to name it exactly.
      if (err?.response?.status === 409) {
        setError(await takenMessage());
      } else {
        setError(errMessage(err, "Could not send OTP. Please try again."));
      }
    } finally {
      setBusy(false);
    }
  };

  /* ---- OTP boxes ---- */
  const setOtpAt = (i, digit) =>
    setOtp((prev) => {
      const next = [...prev];
      next[i] = digit;
      return next;
    });

  const fillOtpFrom = (start, digits) => {
    setOtp((prev) => {
      const next = [...prev];
      for (let k = 0; k < digits.length && start + k < OTP_LEN; k++) next[start + k] = digits[k];
      return next;
    });
    otpRefs.current[Math.min(start + digits.length, OTP_LEN - 1)]?.focus();
  };

  const onOtpChange = (i) => (e) => {
    let digits = e.target.value.replace(/\D/g, "");
    if (!digits) return setOtpAt(i, "");
    // Typing over a filled box gives "old+new" (or "new+old") — keep just the new digit.
    if (digits.length === 2 && otp[i]) digits = digits.startsWith(otp[i]) ? digits[1] : digits[0];
    // SMS autofill can drop the whole code into one box — spread it.
    if (digits.length > 1) return fillOtpFrom(i, digits);
    setOtpAt(i, digits);
    if (i < OTP_LEN - 1) otpRefs.current[i + 1]?.focus();
  };

  const onOtpKeyDown = (i) => (e) => {
    if (e.key === "Backspace") {
      if (otp[i]) return setOtpAt(i, "");
      if (i > 0) {
        e.preventDefault();
        setOtpAt(i - 1, "");
        otpRefs.current[i - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      otpRefs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < OTP_LEN - 1) {
      otpRefs.current[i + 1]?.focus();
    }
  };

  const onOtpPaste = (i) => (e) => {
    const digits = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!digits) return;
    e.preventDefault();
    fillOtpFrom(i, digits);
  };

  const otpCode = otp.join("");
  const attemptsExhausted = attemptCount >= MAX_ATTEMPTS;
  const resendsLeft = MAX_RESENDS - resendCount;

  /* ---- Screen 4 → verify (this is what creates the account + logs in) ---- */
  const submitOtp = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (attemptsExhausted) return setError("Too many incorrect attempts. Please request a new OTP.");
    if (otpCode.length < OTP_LEN) return setError("Enter the 6-digit OTP.");
    if (!agreeTCs) return setError("Please agree to Khettify's T&Cs to continue.");

    setError("");
    setNotice("");
    setBusy(true);
    try {
      await verifyRegisterOtp(phone, otpCode);
      setStep("success");
    } catch (err) {
      // Someone registered the same phone/email between Get OTP and Verify.
      // Not a wrong code, so it doesn't use up an attempt.
      if (err?.response?.status === 409) {
        setError(await takenMessage());
        return;
      }
      const attempts = attemptCount + 1;
      const left = MAX_ATTEMPTS - attempts;
      setAttemptCount(attempts);
      setOtp(emptyOtp());
      if (!err?.response) setError(errMessage(err));
      else if (left <= 0 || err.response.status === 429) {
        setAttemptCount(MAX_ATTEMPTS);
        setError("Too many incorrect attempts. Please request a new OTP.");
      } else if (err.response.status === 401) {
        setError(`Invalid OTP. ${left} attempt${left === 1 ? "" : "s"} left.`);
      } else {
        setError(errMessage(err, "Could not verify OTP. Please try again."));
      }
    } finally {
      setBusy(false);
      otpRefs.current[0]?.focus();
    }
  };

  const handleResend = async () => {
    if (busy || resendTimer > 0) return;
    if (resendsLeft <= 0) return setError("Maximum resend limit reached. Please start again.");
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const res = await resendRegisterOtp(phone);
      setResendCount((c) => c + 1);
      setAttemptCount(0); // the server resets attempts on a fresh code
      setOtp(emptyOtp());
      setResendTimer(RESEND_SECONDS);
      setNotice(res?.otpSent === false ? "We couldn't send the SMS. Please try again shortly." : "A new OTP has been sent.");
    } catch (err) {
      const msg = errMessage(err, "Could not resend OTP. Please try again.");
      // The server's cooldown (60s) is longer than ours — restart with its figure.
      const wait = /wait (\d+) seconds/i.exec(msg);
      if (wait) setResendTimer(Number(wait[1]));
      else if (err?.response?.status === 429) setResendCount(MAX_RESENDS);
      setError(msg);
    } finally {
      setBusy(false);
      otpRefs.current[0]?.focus();
    }
  };

  const backFromOtp = () => {
    setOtp(emptyOtp());
    go("name");
  };

  /* ---------- Render ---------- */
  return (
    <AuthShell>
      {(step === "phone" || step === "email") && (
        <>
          <Heading title="Signup" subtitle="Get started & grab best offers!" />

          {step === "phone" ? (
            <form onSubmit={submitPhone} noValidate className="flex flex-col gap-[18px]">
              <ErrorNote>{error}</ErrorNote>
              <TextField
                label="Mobile Number"
                icon={Icon.Phone}
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={10}
                placeholder="Enter phone number"
                value={phone}
                onChange={onPhoneChange}
                disabled={busy}
                autoFocus
              />
              <PrimaryButton type="submit" disabled={busy}>
                <BusyLabel busy={busy} busyText="Checking…">Get OTP</BusyLabel>
              </PrimaryButton>
            </form>
          ) : (
            <form onSubmit={submitEmail} noValidate className="flex flex-col gap-[18px]">
              <ErrorNote>{error}</ErrorNote>
              <TextField
                label="Email"
                icon={Icon.Mail}
                type="email"
                autoComplete="email"
                placeholder="Enter email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                autoFocus
              />
              <PrimaryButton type="submit" disabled={busy}>
                <BusyLabel busy={busy} busyText="Checking…">Proceed</BusyLabel>
              </PrimaryButton>
            </form>
          )}

          <div className="mt-4">
            <GoogleButton disabled={busy} onClick={() => googleLogin()} />
          </div>

          <div className="mt-6">
            {step === "phone" ? (
              <LinkButton onClick={() => { screen1Phone.current = phone; go("email"); }} disabled={busy}>Use Email ID</LinkButton>
            ) : (
              <LinkButton onClick={toPhoneScreen} disabled={busy}>Use Mobile Number</LinkButton>
            )}
          </div>

          {/* ✅ "Already have account? Login" link */}
          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <span style={{ color: '#666' }}>Already have an account? </span>
            <Link 
              to="/customer-shop/login"
              style={{ color: '#EA2831', textDecoration: 'none', fontWeight: 'bold', cursor: 'pointer' }}
            >
              Login
            </Link>
          </div>
        </>
      )}

      {step === "name" && (
        <>
          <Heading
            title="Help us Know You Better"
            subtitle="A step closer to shopping with exciting offers!"
            onBack={() => (method === "email" ? go("email") : toPhoneScreen())}
          />
          <form onSubmit={submitName} noValidate className="flex flex-col gap-[18px]">
            <ErrorNote>{error}</ErrorNote>
            <TextField
              label="Name"
              icon={Icon.User}
              type="text"
              autoComplete="name"
              placeholder="Enter your full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              required
              autoFocus
            />
            {/* Phone route: the Screen 1 number is kept in state and used as-is
                (edit it via Back). Email route: Screen 2 never asked for a
                mobile, and the OTP can only go by SMS — so ask for it here. */}
            {method === "email" && (
              <TextField
                label="Mobile Number"
                icon={Icon.Phone}
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={10}
                placeholder="OTP will be sent to this number"
                value={phone}
                onChange={onPhoneChange}
                disabled={busy}
                required
              />
            )}
            <PrimaryButton type="submit" disabled={busy}>
              <BusyLabel busy={busy} busyText="Sending OTP…">Get OTP</BusyLabel>
            </PrimaryButton>
          </form>
        </>
      )}

      {step === "otp" && (
        <>
          <Heading
            title="OTP Verification"
            subtitle={`Enter OTP received on ****${phone.slice(-4)}`}
            onBack={backFromOtp}
          />
          <form onSubmit={submitOtp} noValidate className="flex flex-col gap-[18px]">
            <ErrorNote>{error}</ErrorNote>
            {notice && <p className="text-sm font-medium text-[#1E9E4A]">{notice}</p>}

            <div className="flex justify-between gap-2 sm:gap-3" role="group" aria-label="One-time password">
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => (otpRefs.current[i] = el)}
                  value={digit}
                  onChange={onOtpChange(i)}
                  onKeyDown={onOtpKeyDown(i)}
                  onPaste={onOtpPaste(i)}
                  onFocus={(e) => e.target.select()}
                  type="text"
                  inputMode="numeric"
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  maxLength={OTP_LEN}
                  aria-label={`Digit ${i + 1}`}
                  disabled={busy || attemptsExhausted}
                  className="h-[54px] w-full min-w-0 rounded-[14px] border-[1.5px] border-[#E2E0D6] bg-white text-center text-xl font-bold text-[#14201A] outline-none transition-all focus:border-[#EA2831] focus:ring-4 focus:ring-[#EA2831]/10 disabled:opacity-60 sm:h-[58px]"
                />
              ))}
            </div>

            <label className="flex cursor-pointer select-none items-start gap-2.5">
              <input
                type="checkbox"
                checked={agreeTCs}
                onChange={(e) => setAgreeTCs(e.target.checked)}
                disabled={busy}
                className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer accent-[#EA2831]"
              />
              <span className="text-sm leading-normal text-[#6B6A62]">
                By continuing, I agree to Khettify&apos;s <span className="font-semibold text-[#EA2831]">T&amp;Cs</span>
              </span>
            </label>

            <PrimaryButton type="submit" disabled={busy || attemptsExhausted || otpCode.length < OTP_LEN || !agreeTCs}>
              <BusyLabel busy={busy} busyText="Verifying…">Verify</BusyLabel>
            </PrimaryButton>
          </form>

          <div className="mt-6 text-center">
            {resendsLeft <= 0 ? (
              <p className="text-sm text-[#9B9A92]">Maximum resend limit reached.</p>
            ) : resendTimer > 0 ? (
              <p className="text-[15px] text-[#6B6A62]">
                Resend OTP in <span className="font-bold text-[#14201A]">{resendTimer} Sec</span>
              </p>
            ) : (
              <LinkButton onClick={handleResend} disabled={busy}>
                Resend OTP
              </LinkButton>
            )}
          </div>
        </>
      )}

      {step === "success" && (
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 inline-flex h-24 w-24 items-center justify-center rounded-full bg-[#E8F5EC] text-[#1E9E4A]">
            <Icon.Check className="h-12 w-12" />
          </div>
          <h1 className="mb-2 font-heading text-3xl font-extrabold tracking-tight text-[#14201A]">Account Created!</h1>
          <p className="mb-8 text-[15px] leading-normal text-[#6B6A62]">Welcome to Khettify. Your account is ready.</p>
          <PrimaryButton type="button" className="w-full" onClick={() => navigate(redirectTo, { replace: true })}>
            Start Shopping
          </PrimaryButton>
          <p className="mt-4 text-[13px] text-[#9B9A92]">Taking you to your dashboard…</p>
        </div>
      )}
    </AuthShell>
  );
}