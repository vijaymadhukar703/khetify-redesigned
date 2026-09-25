import React from "react";
import { useShopAuth } from "../../context/ShopAuthContext";
import { useT } from "../../context/ShopLanguageContext";
import ShopHome from "./ShopHome";

/* ────────────────────────────────────────────────────────────────
   Khetify Bazaar — signed-in home (/customer-shop/home).

   THE PAGE IS ShopHome. It is not a copy of it.

   This file used to be a second, parallel storefront: its own hero, its own
   trust strip, its own four-category preview, its own featured tile and
   twelve-card grid, its own closing CTA. Every change to the shop had to be
   made twice — and the two had already drifted, because the visitor page was
   redesigned while this one was not. A signed-in shopper was being shown an
   older shop than a signed-out one.

   So the sections are not duplicated here. <ShopHome /> renders the whole page
   — categories, banners, product rail, sponsored slots, brands — and this file
   adds the ONE thing that genuinely differs when you are signed in: your name.
   Anything that should appear on both pages now only has to be written once.

   WHAT WAS DELIBERATELY DROPPED
   · The dark greeting hero, the trust strip and the closing CTA. Each was this
     page's version of a band ShopHome already has; keeping them would have put
     two heroes and two CTAs on one screen.
   · FeaturedProduct, TRUST, HERO_IMG, CATEGORY_PREVIEW and all the feed state.
     They existed only to render those bands, and ShopHome fetches its own
     data, so none of it has a caller any more.

   The greeting keys (dash.goodMorning / goodAfternoon / goodEvening) are
   unchanged and still resolved at render — module scope has no t().
──────────────────────────────────────────────────────────────── */

const greetingKey = () => {
  const h = new Date().getHours();
  if (h < 12) return "dash.goodMorning";
  if (h < 17) return "dash.goodAfternoon";
  return "dash.goodEvening";
};

export default function ShopDashboard() {
  const t = useT();
  const { consumer } = useShopAuth();

  const firstName = consumer?.name?.trim().split(/\s+/)[0] || "";

  return (
    <div className="bg-white">
      {/* A LINE, NOT A BANNER. The slider sits directly beneath this, and a
          second full-width band above it would push the storefront off the
          first screen for the sake of a name. Rendered only when there IS a
          name — "Good afternoon," on its own is worse than nothing. */}
      {firstName && (
        <div className="mx-auto max-w-[1360px] px-3 pt-5 sm:px-6 lg:px-8 lg:pt-7">
          <p className="font-heading text-[17px] font-bold -tracking-[0.02em] text-stone-900 sm:text-[19px]">
            {t(greetingKey())}, <span className="text-[#EA2831]">{firstName}</span>
          </p>
        </div>
      )}

      <ShopHome />
    </div>
  );
}