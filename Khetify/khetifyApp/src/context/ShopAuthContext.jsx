import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import {
  getShopToken,
  setShopToken,
  clearShopToken,
  shopLogin,
  shopRegister,
  shopSendRegisterOtp,
  shopVerifyRegisterOtp,
  shopResendRegisterOtp,
  shopSendResetOtp,
  shopResendResetOtp,
  shopResetPassword,
  shopMe,
  updateShopProfile,
} from "../lib/shopApi";

// Storefront consumer auth. Kept fully separate from the company/seller auth so
// a shopper session never collides with an admin/seller session in the same
// browser (distinct localStorage keys: "shopToken" vs "token"/seller token).
const ShopAuthContext = createContext(null);

export function ShopAuthProvider({ children }) {
  const [consumer, setConsumer] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount, if a token exists, resolve the current consumer.
  useEffect(() => {
    let alive = true;
    (async () => {
      // ✅ CHECK FOR GOOGLE OAUTH TOKEN IN URL
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get('token');
      const success = params.get('success');

      if (urlToken && success === 'true') {
        console.log('✅ Google OAuth token found in URL, setting up...');
        setShopToken(urlToken); // Token को localStorage में set करो
        // Clean up URL
        window.history.replaceState({}, document.title, '/customer-shop/register');
      }

      if (!getShopToken()) {
        setLoading(false);
        return;
      }
      try {
        const res = await shopMe();
        if (alive) setConsumer(res.data);
      } catch {
        clearShopToken();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (identifier, password) => {
    const res = await shopLogin({ identifier, password });
    setShopToken(res.token);
    setConsumer(res.consumer);
    return res;
  }, []);

  // पुराना एक-झटके वाला register — /auth/register को call करता है, जो अब भी
  // account तुरंत बना देता है. OTP-first रास्ता नीचे वाले तीन के ज़रिए चलता है;
  // यह सिर्फ़ इसलिए रखा है कि कोई पुरानी जगह इसे call कर रही हो तो न टूटे.
  const register = useCallback(async (body) => {
    const res = await shopRegister(body);
    if (res?.token) {
      setShopToken(res.token);
      setConsumer(res.consumer);
    }
    return res;
  }, []);

  /* 📱 OTP-FIRST REGISTRATION — दो कदम, phone के ज़रिए (pendingId नहीं).
   *
   * STEP 1: सिर्फ़ details validate होती हैं और OTP जाता है. यहाँ न account
   * बनता है, न token मिलता है — इसलिए shopToken / consumer को हाथ नहीं लगता. */
  const sendRegisterOtp = useCallback(async (body) => {
    return shopSendRegisterOtp(body);
  }, []);

  /* STEP 2: OTP verify. यही वो call है जो server पर असली account बनाती है और
   * shopper को log in करती है — बिलकुल वैसे ही जैसे login() करता है. */
  const verifyRegisterOtp = useCallback(async (phone, code) => {
    const res = await shopVerifyRegisterOtp({ phone, code });
    setShopToken(res.token);
    setConsumer(res.consumer);
    return res;
  }, []);

  /* उसी pending registration के लिए नया OTP. Server 60s cooldown लगाता है. */
  const resendRegisterOtp = useCallback(async (phone) => {
    return shopResendRegisterOtp(phone);
  }, []);

  /* 🔑 FORGOT PASSWORD — तीनों logged-out चलते हैं, इसलिए यहाँ न token छुआ
   * जाता है न consumer. Reset होने के बाद shopper login screen पर जाकर नया
   * password खुद डालता है. */
  const sendResetOtp = useCallback(
    async (phone) => shopSendResetOtp(phone),
    [],
  );
  const resendResetOtp = useCallback(
    async (phone) => shopResendResetOtp(phone),
    [],
  );
  const resetPassword = useCallback(
    async (phone, code, newPassword) =>
      shopResetPassword({ phone, code, newPassword }),
    [],
  );

  // 👤 PROFILE: patch the shopper's own name / phone. The server returns the
  //    full updated consumer, so we drop it straight into state — the header
  //    greeting and account menu re-render with the new name instantly, with no
  //    extra /auth/me round-trip.
  const updateProfile = useCallback(async (patch) => {
    const res = await updateShopProfile(patch);
    setConsumer(res.data);
    return res.data;
  }, []);

  const logout = useCallback(() => {
    clearShopToken();
    setConsumer(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await shopMe();
      setConsumer(res.data);
      return res.data;
    } catch {
      return null;
    }
  }, []);

  return (
    <ShopAuthContext.Provider
      value={{
        consumer,
        loading,
        isAuthed: !!consumer,
        login,
        register,
        sendRegisterOtp,
        verifyRegisterOtp,
        resendRegisterOtp,
        sendResetOtp,
        resendResetOtp,
        resetPassword,
        updateProfile,
        logout,
        refresh,
      }}
    >
      {children}
    </ShopAuthContext.Provider>
  );
}

export function useShopAuth() {
  const ctx = useContext(ShopAuthContext);
  if (!ctx) throw new Error("useShopAuth must be used within ShopAuthProvider");
  return ctx;
}
