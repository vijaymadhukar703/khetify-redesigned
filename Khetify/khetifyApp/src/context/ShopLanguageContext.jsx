import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LANGUAGE, LANGUAGES, translate } from "../i18n/shopTranslations";

/**
 * STOREFRONT LANGUAGE (customer side only).
 *
 * Mounted inside ShopProviders, so it wraps /customer-shop and nothing else —
 * the Company, Seller, Warehouse and Admin apps never see this provider and are
 * completely unaffected.
 *
 * No i18n library is added. The project had none, and one flat dictionary plus
 * a context is the whole requirement here; react-i18next would bring a bundle,
 * a plugin chain and an init file for a two-language string lookup.
 *
 * Persistence is localStorage, NOT the consumer's account: the choice must
 * survive a refresh for a guest too, and it is a device preference rather than
 * something worth a backend column and a migration.
 */

const STORAGE_KEY = "khetify:shopLang";
const ShopLanguageContext = createContext(null);

const isSupported = (code) => LANGUAGES.some((l) => l.code === code);

/** Read the saved choice. Anything unrecognised (or a private-mode throw)
 *  falls back to English, which is the documented default. */
function readStored() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isSupported(saved) ? saved : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function ShopLanguageProvider({ children }) {
  const [lang, setLangState] = useState(readStored);

  const setLang = useCallback((code) => {
    if (!isSupported(code)) return;
    setLangState(code);
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* private mode */ }
  }, []);

  // Keep the document in step: screen readers and the browser's own
  // translate/hyphenation behaviour key off <html lang>.
  useEffect(() => {
    const prev = document.documentElement.lang;
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = prev; };
  }, [lang]);

  // Follow the choice across tabs, the same way the cart and wishlist do.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && isSupported(e.newValue)) setLangState(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo(() => ({
    lang,
    setLang,
    languages: LANGUAGES,
    /** t("cart.title") → string; t("account.greeting", { name }) interpolates. */
    t: (key, vars) => translate(lang, key, vars),

    /* NOTE: database text (product names, categories, descriptions) is NOT
       translated here. The API returns it already localised for `lang` — see
       services/translationService.js on the server. Doing it there means one
       cache serves the whole catalogue and search can read the same rows
       backwards to understand a Hindi query. */
  }), [lang, setLang]);

  return (
    <ShopLanguageContext.Provider value={value}>
      {children}
    </ShopLanguageContext.Provider>
  );
}

export function useShopLanguage() {
  const ctx = useContext(ShopLanguageContext);
  if (!ctx) throw new Error("useShopLanguage must be used within ShopLanguageProvider");
  return ctx;
}

/** Shorthand for the common case: `const t = useT();` */
export function useT() {
  return useShopLanguage().t;
}