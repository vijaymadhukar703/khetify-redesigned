import React, { useState } from "react";
import {
  ArrowLeft,
  Settings,
  Lock,
  KeyRound,
  ShieldCheck,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  CircleCheck,
} from "lucide-react";
import { changeMyPassword, requestMemberPasswordReset } from "../../lib/imsApi";
import { usePermission } from "../../context/PermissionContext";
import BackButton from "../../Components/BackButton";

const inputCls =
  "block w-full h-[52px] pl-[46px] pr-[50px] rounded-[14px] border border-stone-200 bg-stone-50 " +
  "text-sm font-medium text-stone-900 placeholder:text-stone-400 outline-none " +
  "focus:bg-white focus:border-[#EA2831] focus:ring-4 focus:ring-[#EA2831]/[0.13] transition-all";

const emailInputCls = inputCls.replace("pr-[50px]", "pr-4");

const Field = ({ label, children, error }) => (
  <div className="space-y-2 group">
    <label className="block text-[13px] font-bold text-stone-800 tracking-[-0.01em]">
      {label}
      <span className="text-[#EA2831] ml-0.5">*</span>
    </label>
    {children}
    {error && <p className="text-xs font-medium text-[#EA2831]">⚠ {error}</p>}
  </div>
);

const Note = ({ tone, children }) => {
  const styles =
    tone === "success"
      ? "bg-green-50 text-green-700 border-green-200"
      : "bg-[#EA2831]/[0.06] text-[#EA2831] border-[#EA2831]/25";
  return (
    <p className={`text-sm font-medium border rounded-xl px-4 py-3 ${styles}`}>
      {children}
    </p>
  );
};

/** Password input with its own independent visibility toggle. */
const PasswordInput = ({
  value,
  onChange,
  placeholder,
  autoComplete,
  LeadIcon,
}) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative flex items-center">
      <span className="absolute left-4 flex text-stone-400 pointer-events-none transition-colors group-focus-within:text-[#EA2831]">
        <LeadIcon size={18} strokeWidth={2} />
      </span>
      <input
        className={inputCls}
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute right-2 flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-stone-400 hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#EA2831] transition-colors"
      >
        {visible ? (
          <EyeOff size={19} strokeWidth={2} />
        ) : (
          <Eye size={19} strokeWidth={2} />
        )}
      </button>
    </div>
  );
};

const OptionCard = ({
  icon,
  iconCls,
  title,
  description,
  cta,
  ctaCls,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="group text-left flex flex-col gap-4 bg-white border border-stone-200 rounded-[22px] p-6 shadow-sm cursor-pointer transition-all duration-200 hover:-translate-y-[3px] hover:border-stone-300 hover:shadow-xl active:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#EA2831]"
  >
    <span
      className={`flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl ${iconCls}`}
    >
      {icon}
    </span>
    <span className="flex flex-col gap-1.5">
      <span className="text-[17px] font-bold text-stone-900 tracking-[-0.02em]">
        {title}
      </span>
      <span className="text-[13.5px] leading-relaxed text-stone-500">
        {description}
      </span>
    </span>
    <span
      className={`flex items-center gap-1.5 text-[12.5px] font-bold ${ctaCls}`}
    >
      <span className="whitespace-nowrap">{cta}</span>
      <ArrowRight
        size={15}
        strokeWidth={2.4}
        className="transition-transform duration-200 group-hover:translate-x-1"
      />
    </span>
  </button>
);

const SECURITY_TIPS = [
  "Use at least 8 characters",
  "Include uppercase",
  "Include lowercase",
  "Include numbers",
  "Include symbols",
];

const WarehouseSettings = () => {
  const { name } = usePermission();

  // ── UI-only section switching ──
  const [activeSection, setActiveSection] = useState(null); // null | 'change' | 'forgot'

  // ── Change password ──
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [failed, setFailed] = useState("");

  const u = (k) => (e) => {
    setF((p) => ({ ...p, [k]: e.target.value }));
    setErrors((p) => (p[k] ? { ...p, [k]: undefined } : p));
    setDone("");
    setFailed("");
  };

  // Mirrors the server rules in controller/User/userController.changePassword.
  const validate = () => {
    const e = {};
    if (!f.current) e.current = "Current password is required";
    if (!f.next) e.next = "New password is required";
    else if (f.next.trim().length < 6)
      e.next = "New password must be at least 6 characters";
    else if (f.next.trim() === f.current.trim())
      e.next = "New password must be different from the current one";
    if (!f.confirm) e.confirm = "Please re-enter the new password";
    else if (f.confirm !== f.next) e.confirm = "Passwords do not match";
    return e;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    setDone("");
    setFailed("");
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;

    try {
      setBusy(true);
      await changeMyPassword({
        currentPassword: f.current,
        newPassword: f.next.trim(),
      });
      setF({ current: "", next: "", confirm: "" });
      setDone("Your password has been updated.");
    } catch (err) {
      setFailed(
        err?.response?.data?.message ||
          "Could not update the password. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  // ── Forgot password ──
  const [resetEmail, setResetEmail] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetNote, setResetNote] = useState("");
  const [resetErr, setResetErr] = useState("");

  const sendReset = async (ev) => {
    ev.preventDefault();
    setResetNote("");
    setResetErr("");
    const email = resetEmail.trim();
    if (!email) return setResetErr("Enter the email you sign in with");

    try {
      setResetBusy(true);
      const r = await requestMemberPasswordReset({ email });
      setResetNote(
        r?.message ||
          "If an account exists for that email, a reset link has been sent.",
      );
      setResetEmail("");
    } catch (err) {
      setResetErr(
        err?.response?.data?.message ||
          "Could not send the reset email. Please try again later.",
      );
    } finally {
      setResetBusy(false);
    }
  };

  // ── UI-only strength hint for the new password (never gates submission) ──
  const strength = (() => {
    const pw = f.next;
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8) score += 1;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
    if (/\d/.test(pw)) score += 1;
    if (/[^A-Za-z0-9]/.test(pw)) score += 1;
    return Math.max(1, score);
  })();
  const strengthTones = [
    "bg-[#EA2831]",
    "bg-amber-500",
    "bg-lime-500",
    "bg-green-600",
  ];
  const strengthLabel = ["Strength", "Weak", "Fair", "Good", "Strong"][
    strength
  ];

  const pageTitle =
    activeSection === "change"
      ? "Change Password"
      : activeSection === "forgot"
        ? "Forgot Password"
        : "Account Settings";
  const pageSubtitle =
    activeSection === "change"
      ? "Update your current password to keep your account secure."
      : activeSection === "forgot"
        ? "Receive a password reset link via email."
        : name
          ? `Signed in as ${name}`
          : "Manage your sign-in credentials";

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50 font-sora">
      <div className="max-w-[760px] mx-auto space-y-5">
        {activeSection === null ? (
          <BackButton />
        ) : (
          <button
            type="button"
            onClick={() => setActiveSection(null)}
            className="group inline-flex h-[38px] items-center gap-2 rounded-full border border-stone-200 bg-white/70 pl-3 pr-4 text-sm font-semibold text-stone-500 transition-all hover:bg-white hover:border-stone-300 hover:text-stone-900 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#EA2831]"
          >
            <ArrowLeft
              size={17}
              strokeWidth={2.1}
              className="transition-transform group-hover:-translate-x-0.5"
            />
            <span className="whitespace-nowrap">Back to Account Settings</span>
          </button>
        )}

        {/* ── Page header ── */}
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#EA2831] to-[#b3121a] text-white shadow-lg shadow-[#EA2831]/30">
              {activeSection === "change" ? (
                <Lock size={25} strokeWidth={2} />
              ) : activeSection === "forgot" ? (
                <Mail size={25} strokeWidth={2} />
              ) : (
                <Settings size={25} strokeWidth={2} />
              )}
            </span>
            <div className="flex flex-col gap-1">
              <h2 className="text-[32px] leading-tight font-extrabold tracking-[-0.03em] text-stone-900">
                {pageTitle}
              </h2>
              <p className="text-sm font-medium text-stone-500">
                {pageSubtitle}
              </p>
            </div>
          </div>
          {name && (
            <span className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white py-1.5 pl-2 pr-3.5 shadow-sm">
              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#EA2831] to-[#b3121a] text-xs font-bold text-white">
                {String(name).charAt(0).toUpperCase()}
              </span>
              <span className="whitespace-nowrap text-[13px] font-semibold text-stone-600">
                Signed in as {name}
              </span>
            </span>
          )}
        </div>

        {/* ── Step 1: choose an option ── */}
        {activeSection === null && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[18px]">
            <OptionCard
              onClick={() => setActiveSection("change")}
              icon={<Lock size={24} strokeWidth={2} />}
              iconCls="bg-[#EA2831]/[0.08] text-[#EA2831]"
              title="Change Password"
              description="Update your current password to keep your account secure."
              cta="Continue"
              ctaCls="text-[#EA2831]"
            />
            <OptionCard
              onClick={() => setActiveSection("forgot")}
              icon={<Mail size={23} strokeWidth={2} />}
              iconCls="bg-stone-100 text-stone-500"
              title="Forgot Password"
              description="Receive a password reset link via email."
              cta="Continue"
              ctaCls="text-stone-600"
            />
          </div>
        )}

        {/* ── Step 2a: Change Password ── */}
        {activeSection === "change" && (
          <div className="space-y-5">
            <form
              onSubmit={submit}
              className="bg-white border border-stone-200 rounded-[22px] p-6 sm:p-8 shadow-sm space-y-6"
            >
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#EA2831]/[0.08] text-[#EA2831] ring-1 ring-inset ring-[#EA2831]/10">
                  <Lock size={22} strokeWidth={2} />
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-stone-800">
                    Password credentials
                  </span>
                  <span className="text-[13px] text-stone-500">
                    All three fields are required.
                  </span>
                </div>
              </div>

              <div className="h-px bg-stone-100" />

              <div className="space-y-[18px]">
                <Field label="Current Password" error={errors.current}>
                  <PasswordInput
                    value={f.current}
                    onChange={u("current")}
                    autoComplete="current-password"
                    placeholder="Your current password"
                    LeadIcon={Lock}
                  />
                </Field>

                <Field label="New Password" error={errors.next}>
                  <PasswordInput
                    value={f.next}
                    onChange={u("next")}
                    autoComplete="new-password"
                    placeholder="At least 6 characters"
                    LeadIcon={KeyRound}
                  />
                  <div className="flex items-center gap-2.5 pt-0.5">
                    <div className="flex flex-1 min-w-0 gap-1.5">
                      {[0, 1, 2, 3].map((i) => (
                        <span
                          key={i}
                          className={`h-[5px] flex-1 rounded-full transition-colors duration-300 ${
                            i < strength
                              ? strengthTones[strength - 1]
                              : "bg-stone-200"
                          }`}
                        />
                      ))}
                    </div>
                    <span className="whitespace-nowrap text-[11.5px] font-semibold text-stone-400">
                      {strengthLabel}
                    </span>
                  </div>
                </Field>

                <Field label="Confirm New Password" error={errors.confirm}>
                  <PasswordInput
                    value={f.confirm}
                    onChange={u("confirm")}
                    autoComplete="new-password"
                    placeholder="Re-enter the new password"
                    LeadIcon={ShieldCheck}
                  />
                </Field>
              </div>

              {done && <Note tone="success">{done}</Note>}
              {failed && <Note>{failed}</Note>}

              <div className="h-px bg-stone-100" />

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <span className="text-[12.5px] font-medium text-stone-400">
                  You&apos;ll stay signed in on this device.
                </span>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex h-[52px] w-full sm:w-auto items-center justify-center gap-2.5 rounded-[14px] bg-gradient-to-br from-[#EA2831] to-[#c2181f] px-7 text-sm font-bold tracking-[-0.01em] text-white shadow-lg shadow-[#EA2831]/25 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#EA2831]/30 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                >
                  {busy && (
                    <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-[2.4px] border-white/35 border-t-white" />
                  )}
                  <span className="whitespace-nowrap">
                    {busy ? "Updating…" : "Update Password"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Step 2b: Forgot Password ── */}
        {activeSection === "forgot" && (
          <form
            onSubmit={sendReset}
            className="bg-white border border-stone-200 rounded-[22px] p-6 sm:p-8 shadow-sm space-y-6"
          >
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500">
                <Mail size={21} strokeWidth={2} />
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-bold text-stone-800">
                  Reset link
                </span>
                <span className="text-[13px] leading-relaxed text-stone-500">
                  Sent to your login email and valid for 1 hour.
                </span>
              </div>
            </div>

            <div className="h-px bg-stone-100" />

            <Field label="Login Email" error={resetErr}>
              <div className="relative flex items-center">
                <span className="absolute left-4 flex text-stone-400 pointer-events-none transition-colors group-focus-within:text-[#EA2831]">
                  <Mail size={18} strokeWidth={2} />
                </span>
                <input
                  className={emailInputCls}
                  type="email"
                  value={resetEmail}
                  onChange={(e) => {
                    setResetEmail(e.target.value);
                    setResetErr("");
                    setResetNote("");
                  }}
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </div>
            </Field>

            {resetNote && <Note tone="success">{resetNote}</Note>}

            <button
              type="submit"
              disabled={resetBusy}
              className="inline-flex h-[50px] w-full sm:w-auto items-center justify-center gap-2.5 rounded-[14px] border-[1.5px] border-stone-200 bg-white px-6 text-sm font-bold text-stone-800 transition-all duration-200 hover:-translate-y-px hover:border-[#EA2831] hover:bg-[#EA2831]/[0.05] hover:text-[#b3121a] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              <KeyRound size={17} strokeWidth={2} />
              <span className="whitespace-nowrap">
                {resetBusy ? "Sending…" : "Send Reset Link"}
              </span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default WarehouseSettings;