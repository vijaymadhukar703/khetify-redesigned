import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getShopCategories } from "../../lib/shopApi";
import { catIcon } from "./ShopHome";

/* ─────────────────────────────────────────────────────────────────────────────
 * Khetify — All categories  (/customer-shop/categories)
 * ───────────────────────────────────────────────────────────────────────────── */

export default function ShopCategories() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getShopCategories();
      setCategories(res.data || []);
    } catch (e) {
      setError(e?.response?.data?.message || "Could not load categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCategory = (c) =>
    navigate(`/customer-shop/products?category=${encodeURIComponent(String(c).trim())}`);

  return (
    <div className="min-h-screen bg-stone-50/40">
      
      {/* ── Main Content Container ── */}
      {/* Header pinned to the left edge (full width), not the centered grid. */}
      <div className="px-4 pt-6 sm:px-6">
        {/* ── ⚡ FIXED ROW: Back Button aur Heading ab same line mein hain ── */}
      <header className="mb-6 flex items-center">
  {/* sm:pl-28 se poora grid align rahega */}
  <div className="min-w-0 pt-5 sm:pl-36">
    
    {/* 🛠️ Heading + Arrow wrapper */}
    <div className="relative flex items-center gap-2.5">
      
      {/* Arrow ko absolute position diya taaki wo h1 aur p ki left line ko disturb na kare */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Go back"
        className="no-print hidden sm:inline-flex absolute -left-9 shrink-0 items-center justify-center text-stone-900 transition-colors duration-150 hover:text-[#EA2831]"
      >
        <span className="material-symbols-outlined text-[26px] font-bold leading-none">
          arrow_back
        </span>
      </button>

      {/* Main Title */}
      <h1 className="font-heading text-2xl font-black tracking-tight text-stone-900 sm:text-3xl leading-none">
        Shop by category
      </h1>
    </div>

    {/* Subtitle Text: Ab ye 'Shop' ke 'S' ke 100% exact niche aligned aayega */}
    <p className="mt-1.5 text-xs text-stone-500 sm:text-sm">
      {loading ? "Loading…" : `${categories.length} categor${categories.length === 1 ? "y" : "ies"} to explore`}
    </p>

  </div>
</header>
      </div>

      {/* ── Main Content Container ── */}
      <div className="mx-auto max-w-7xl px-4 pb-6 sm:px-6">
        

        {/* ── Error State ── */}
        {error && (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-8 text-center">
            <span className="material-symbols-outlined text-3xl text-[#EA2831]">error</span>
            <p className="mt-2 text-sm font-semibold text-[#EA2831]">{error}</p>
            <button
              onClick={load}
              className="mt-4 rounded-xl bg-[#EA2831] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-[#c91e26]"
            >
              Try again
            </button>
          </div>
        )}

        {/* ── Loading State ── */}
        {loading && !error && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex min-h-[130px] flex-col items-center justify-center gap-3 rounded-2xl bg-white p-5 ring-1 ring-stone-200/70">
                <div className="size-14 animate-pulse rounded-2xl bg-stone-100" />
                <div className="h-3 w-16 animate-pulse rounded bg-stone-100" />
              </div>
            ))}
          </div>
        )}

        {/* ── Empty State ── */}
        {!loading && !error && categories.length === 0 && (
          <div className="rounded-3xl border border-stone-200 bg-white p-14 text-center">
            <span className="material-symbols-outlined text-5xl font-light text-stone-300">category</span>
            <h3 className="mt-3 font-heading text-lg font-bold text-stone-900">No categories yet</h3>
            <p className="mt-1 text-sm text-stone-500">Categories appear here as sellers publish products.</p>
            <Link
              to="/customer-shop/products"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#EA2831] px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-[#c91e26]"
            >
              Browse all products <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </Link>
          </div>
        )}

        {/* ── Category Grid ── */}
        {!loading && !error && categories.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
            {categories.map((c, i) => (
              <button
                key={c}
                onClick={() => openCategory(c)}
                className={`group relative flex min-h-[130px] flex-col justify-between overflow-hidden rounded-2xl p-4 text-left ring-1 transition-all duration-300 hover:-translate-y-1 ${
                  i % 2 === 0
                    ? "bg-[#14201A] text-white ring-[#14201A] hover:shadow-[0_18px_40px_-18px_rgba(20,32,26,0.6)]"
                    : "bg-white text-stone-900 ring-stone-200/70 hover:ring-[#EA2831] hover:shadow-md"
                }`}
              >
                <span className={`flex size-11 items-center justify-center rounded-xl transition-colors ${i % 2 === 0 ? "bg-white/10 text-white group-hover:bg-[#EA2831]" : "bg-red-50 text-[#EA2831]"}`}>
                  <span className="material-symbols-outlined text-2xl">{catIcon(c)}</span>
                </span>
                <div>
                  <p className="font-heading text-sm font-bold capitalize leading-tight">{c}</p>
                  <span className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${i % 2 === 0 ? "text-white/60" : "text-[#EA2831]"}`}>
                    Shop now <span className="material-symbols-outlined text-sm transition-transform group-hover:translate-x-0.5">arrow_forward</span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}