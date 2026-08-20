import React, { useState, useEffect } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useShopAuth } from "../../context/ShopAuthContext";
import { Icon, TextField, PasswordField, PrimaryButton, ErrorNote, AuthShell } from "../../Components/shop/authUi";

/* Customer LOGIN page (separate from Register). UI recreated in the reference
   style with a full-height split shell; auth logic UNCHANGED:
   login(identifier, password) + redirect. The header's legacy
   "?mode=register" link is forwarded to the /register route. */

export default function ShopLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useShopAuth();
  // Always land on the customer dashboard after login — never the previous page
  // (cart / wishlist / etc.). The ?redirect= param is intentionally ignored so
  // the destination doesn't depend on where the user opened login from.
  const HOME = "/customer-shop/home";
  const registerHref = "/customer-shop/register";

  const [form, setForm] = useState({ identifier: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Legacy header link support: /customer-shop/login?mode=register → register page.
  useEffect(() => {
    if (params.get("mode") === "register") navigate(registerHref, { replace: true });
  }, [params, navigate, registerHref]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await login(form.identifier, form.password);
      navigate(HOME, { replace: true });
    } catch (err) {
      setError(err?.response?.data?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell variant="login">
      <span className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#E9F2EA] px-3.5 py-1.5 text-[13px] font-semibold text-[#2E6B3E]">
        <Icon.Shield className="h-[13px] w-[13px]" /> Secure sign in
      </span>

      <h1 className="mb-2 font-heading text-2xl font-extrabold tracking-tight text-[#14201A] sm:text-3xl md:text-4xl">
        Welcome back
      </h1>
      <p className="mb-6 text-[15px] leading-normal text-[#6B6A62] sm:mb-7 sm:text-base">
        Log in to track orders, manage your cart and shop from verified Khetify sellers.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-[18px]">
        {error && <ErrorNote>{error}</ErrorNote>}

        <TextField
          label="Email"
          icon={Icon.Mail}
          type="text"
          required
          value={form.identifier}
          onChange={set("identifier")}
          placeholder="Enter your email"
          autoComplete="username"
        />

        <PasswordField
          required
          value={form.password}
          onChange={set("password")}
          placeholder="Enter your password"
          autoComplete="current-password"
        />

        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Please wait…" : "Log in"}
        </PrimaryButton>
      </form>

      <p className="mt-6 text-center text-[15px] text-[#6B6A62]">
        Don't have an account?{" "}
        <Link to={registerHref} className="font-bold text-[#EA2831] hover:text-[#c91e26]">Register</Link>
      </p>
    </AuthShell>
  );
}