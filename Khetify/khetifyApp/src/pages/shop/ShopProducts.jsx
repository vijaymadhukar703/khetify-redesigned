import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { getShopProducts } from "../../lib/shopApi";
import { HomeProductCard, CardSkeleton, catIcon } from "./ShopHome";

/* ─────────────────────────────────────────────────────────────────────────────
 * Khetify — Search & browse results  (/customer-shop/products)
 *
 * Modelled on how Flipkart / Amazon / Myntra actually behave. The key idea the
 * old page was missing:
 *
 *   A SEARCH RESULTS PAGE IS NOT A CATALOGUE PAGE.
 *
 * Before, searching "wheat" still showed the browse-the-catalogue furniture —
 * an "All categories" button and every category in the shop, most of which had
 * nothing to do with wheat. A real search page turns the sidebar into
 * REFINEMENTS: only the categories/brands/sellers that are actually IN these
 * results, each with a count.
 *
 *      Seeds (32)      PUMA (18)      50% off or more (7)
 *
 * So this page has two personalities, decided purely by whether ?search= is set:
 *
 *   SEARCH MODE   breadcrumb → "Showing 1–24 of 156 results for 'wheat'",
 *                 sort defaults to RELEVANCE, sidebar = refinements with counts.
 *   BROWSE MODE   sort defaults to NEWEST, sidebar = the full category nav.
 *
 * Everything is multi-select and lives in the URL, so a filtered result set is
 * shareable and survives a refresh — same as every site in the screenshots.
 * ───────────────────────────────────────────────────────────────────────────── */

const PER_PAGE = 24;

const SORTS = [
  { value: "relevance", label: "Relevance", searchOnly: true },
  { value: "price_asc", label: "Price -- Low to High" },
  { value: "price_desc", label: "Price -- High to Low" },
  { value: "newest", label: "Newest First" },
  { value: "name_asc", label: "Name: A–Z" },
];

const rupee = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

/* ── A collapsible sidebar section, like every one of the reference sites ── */
function Section({ title, children, defaultOpen = true, count }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-stone-100 py-4 last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-xs font-bold uppercase tracking-wider text-stone-500">
          {title}
          {count > 0 && <span className="ml-1.5 text-[#EA2831]">({count})</span>}
        </span>
        <span className={`material-symbols-outlined text-lg text-stone-400 transition-transform ${open ? "rotate-180" : ""}`}>
          expand_more
        </span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

/* ── Checkbox refinement list, with "show more" once it gets long ── */
function CheckList({ options, selected, onToggle, searchable, emptyNote }) {
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n
      ? options.filter((o) => String(o.label ?? o.value).toLowerCase().includes(n))
      : options;
  }, [options, q]);

  if (!options.length) {
    return <p className="text-xs text-stone-400">{emptyNote || "Nothing to refine here."}</p>;
  }

  const visible = showAll ? filtered : filtered.slice(0, 6);
  const hidden = filtered.length - visible.length;

  return (
    <>
      {searchable && options.length > 8 && (
        <div className="relative mb-2.5">
          <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-base text-stone-400">
            search
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="h-9 w-full rounded-lg border border-stone-200 pl-8 pr-2 text-xs outline-none focus:border-[#EA2831]"
          />
        </div>
      )}

      <ul className="space-y-0.5">
        {visible.map((o) => {
          const val = String(o.value);
          const on = selected.includes(val);
          return (
            <li key={val}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-stone-50">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(val)}
                  className="size-4 shrink-0 accent-[#EA2831]"
                />
                <span className={`min-w-0 flex-1 truncate text-sm capitalize ${on ? "font-bold text-stone-900" : "text-stone-600"}`}>
                  {o.label ?? o.value}
                </span>
                <span className="shrink-0 text-xs text-stone-400">({o.count})</span>
              </label>
            </li>
          );
        })}
      </ul>

      {hidden > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-1.5 text-xs font-bold text-[#EA2831] hover:underline"
        >
          {hidden} MORE
        </button>
      )}
      {showAll && filtered.length > 6 && (
        <button onClick={() => setShowAll(false)} className="mt-1.5 text-xs font-bold text-stone-400 hover:underline">
          Show less
        </button>
      )}
    </>
  );
}

/* ── Pagination ── */
function Pagination({ page, pages, onGo }) {
  // This useMemo MUST stay above the early return — a hook that runs on some
  // renders and not others throws "Rendered fewer hooks than expected".
  const nums = useMemo(() => {
    const out = new Set([1, pages]);
    for (let i = page - 1; i <= page + 1; i++) if (i > 1 && i < pages) out.add(i);
    const sorted = [...out].sort((a, b) => a - b);
    const withGaps = [];
    let prev = 0;
    for (const n of sorted) {
      if (prev && n - prev > 1) withGaps.push(`gap-${n}`);
      withGaps.push(n);
      prev = n;
    }
    return withGaps;
  }, [page, pages]);

  if (pages <= 1) return null;

  const btn = "flex h-10 min-w-10 items-center justify-center rounded-xl px-3 text-sm font-bold transition-colors";

  return (
    <nav className="mt-8 flex items-center justify-center gap-1.5" aria-label="Pagination">
      <button onClick={() => onGo(page - 1)} disabled={page <= 1} aria-label="Previous page"
        className={`${btn} border border-stone-200 bg-white text-stone-700 hover:border-stone-300 disabled:cursor-not-allowed disabled:opacity-40`}>
        <span className="material-symbols-outlined text-lg">chevron_left</span>
      </button>

      {nums.map((n) =>
        typeof n === "string"
          ? <span key={n} className="px-1 text-sm font-bold text-stone-300">…</span>
          : (
            <button key={n} onClick={() => onGo(n)} aria-current={n === page ? "page" : undefined}
              className={`${btn} ${n === page
                ? "bg-[#EA2831] text-white shadow-md shadow-red-600/20"
                : "border border-stone-200 bg-white text-stone-700 hover:border-stone-300"}`}>
              {n}
            </button>
          )
      )}

      <button onClick={() => onGo(page + 1)} disabled={page >= pages} aria-label="Next page"
        className={`${btn} border border-stone-200 bg-white text-stone-700 hover:border-stone-300 disabled:cursor-not-allowed disabled:opacity-40`}>
        <span className="material-symbols-outlined text-lg">chevron_right</span>
      </button>
    </nav>
  );
}

/* Sidebar filters — a MODULE-LEVEL component (not nested in ShopProducts), so
   its identity is stable across renders and the price inputs keep their focus.
   Everything it needs is passed in explicitly. */
function Filters({
  onPick, isSearch, hasFilters, clearAll,
  state, categories, brands, minDiscount, minPrice, maxPrice, inStockOnly,
  toggleMulti, setSingle, setSingleCategory, commit, catIcon,
  priceBuckets, priceDraft, setPriceDraft, applyPrice, rupee,
}) {
  return (
<>
      <div className="flex items-center justify-between pb-3">
        <h3 className="font-heading text-base font-bold text-stone-900">Filters</h3>
        {hasFilters && (
          <button onClick={() => { clearAll(); onPick?.(); }} className="text-xs font-bold text-[#EA2831] hover:underline">
            Clear all
          </button>
        )}
      </div>

      <Section title="Categories" count={categories.length}>
        {isSearch ? (
          <CheckList
            options={state.facets.categories}
            selected={categories}
            onToggle={(v) => setSingleCategory(v)}
            emptyNote="No categories in these results."
          />
        ) : (
          /* Browse mode: the catalogue nav, exactly as before. */
          <ul className="space-y-0.5">
            {state.allCategories.map((c) => (
              <li key={c}>
                <button
                  onClick={() => { setSingleCategory(c); onPick?.(); }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm capitalize transition-colors ${
                    categories.includes(c) ? "bg-red-50 font-bold text-[#EA2831]" : "text-stone-600 hover:bg-stone-50"
                  }`}
                >
                  <span className="material-symbols-outlined text-lg">{catIcon(c)}</span>
                  <span className="truncate">{c}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Brand" count={brands.length}>
        <CheckList
          options={state.facets.brands}
          selected={brands}
          onToggle={(v) => toggleMulti("brand", v)}
          searchable
          emptyNote="No brands in these results."
        />
      </Section>

      <Section title="Price">
        {priceBuckets.length > 0 && (
          <ul className="mb-3 space-y-0.5">
            {priceBuckets.map((b) => {
              const on = minPrice === b.min && maxPrice === b.max;
              return (
                <li key={b.label}>
                  <button
                    onClick={() =>
                      commit((n) => {
                        if (on) { n.delete("minPrice"); n.delete("maxPrice"); return; }
                        if (b.min) n.set("minPrice", b.min); else n.delete("minPrice");
                        if (b.max) n.set("maxPrice", b.max); else n.delete("maxPrice");
                      })
                    }
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                      on ? "bg-red-50 font-bold text-[#EA2831]" : "text-stone-600 hover:bg-stone-50"
                    }`}
                  >
                    <span className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-[#EA2831]" : "border-stone-300"}`}>
                      {on && <span className="size-2 rounded-full bg-[#EA2831]" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{b.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mb-2 mt-1 text-xs font-semibold text-stone-500">Custom range</p>
        <div className="flex items-center gap-2">
          <div className="flex h-10 flex-1 items-center rounded-lg border border-stone-200 px-2.5 focus-within:border-[#EA2831]">
            <span className="text-xs font-semibold text-stone-400">₹</span>
            <input
              value={priceDraft.min}
              onChange={(e) => setPriceDraft((d) => ({ ...d, min: e.target.value.replace(/\D/g, "") }))}
              onKeyDown={(e) => e.key === "Enter" && applyPrice()}
              placeholder="Min" inputMode="numeric" aria-label="Minimum price"
              className="w-full bg-transparent px-1 text-sm outline-none"
            />
          </div>
          <span className="text-stone-300">–</span>
          <div className="flex h-10 flex-1 items-center rounded-lg border border-stone-200 px-2.5 focus-within:border-[#EA2831]">
            <span className="text-xs font-semibold text-stone-400">₹</span>
            <input
              value={priceDraft.max}
              onChange={(e) => setPriceDraft((d) => ({ ...d, max: e.target.value.replace(/\D/g, "") }))}
              onKeyDown={(e) => e.key === "Enter" && applyPrice()}
              placeholder="Max" inputMode="numeric" aria-label="Maximum price"
              className="w-full bg-transparent px-1 text-sm outline-none"
            />
          </div>
        </div>
        <button
          onClick={applyPrice}
          className="mt-2.5 w-full rounded-lg bg-[#EA2831] py-2.5 text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-[#c91e26]"
        >
          Apply price
        </button>
      </Section>

      {/* Only rendered when some product actually HAS a discount. */}
      {state.facets.discounts.length > 0 && (
        <Section title="Discount" count={minDiscount ? 1 : 0}>
          <ul className="space-y-0.5">
            {state.facets.discounts.map((d) => {
              const on = String(minDiscount) === String(d.value);
              return (
                <li key={d.value}>
                  <button
                    onClick={() => setSingle("minDiscount", on ? "" : String(d.value))}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                      on ? "bg-red-50 font-bold text-[#EA2831]" : "text-stone-600 hover:bg-stone-50"
                    }`}
                  >
                    <span>{d.label}</span>
                    <span className="text-xs text-stone-400">({d.count})</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* A marketplace refinement the reference sites don't need — but Khetify does. */}
    

      <Section title="Availability">
        <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-stone-50">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={(e) => setSingle("inStockOnly", e.target.checked ? "true" : "")}
            className="size-4 accent-[#EA2831]"
          />
          <span className={`text-sm ${inStockOnly ? "font-bold text-stone-900" : "text-stone-600"}`}>
            In stock only
          </span>
        </label>
      </Section>
    </>
  );
}

function Chip({ children, onClear }) {
  return (
    <button
      onClick={onClear}
      className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold capitalize text-stone-700 transition-colors hover:border-stone-300"
    >
      {children} <span className="material-symbols-outlined text-sm text-stone-400">close</span>
    </button>
  );
}

export default function ShopProducts() {
  const navigate = useNavigate(); 
  const [params, setParams] = useSearchParams();

  const search = params.get("search") || "";
  const isSearch = Boolean(search); // ← the whole page pivots on this

  // Multi-select filters live in the URL as repeated keys: ?brand=A&brand=B
  const categories = params.getAll("category");
  const brands = params.getAll("brand");
  const sellers = params.getAll("seller");
  const minDiscount = params.get("minDiscount") || "";
  const minPrice = params.get("minPrice") || "";
  const maxPrice = params.get("maxPrice") || "";
  const inStockOnly = params.get("inStockOnly") === "true";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const sort = params.get("sort") || (isSearch ? "relevance" : "newest");

  const [state, setState] = useState({
    items: [], total: 0, pages: 1,
    facets: { categories: [], brands: [], sellers: [], discounts: [] },
    allCategories: [], priceRange: { min: 0, max: 0 },
    loading: true, error: "",
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false); // mobile custom sort dropdown
  const [fallback, setFallback] = useState([]);
  const [priceDraft, setPriceDraft] = useState({ min: minPrice, max: maxPrice });
  const topRef = useRef(null);

  useEffect(() => { setPriceDraft({ min: minPrice, max: maxPrice }); }, [minPrice, maxPrice]);

  const deps = [search, categories.join(), brands.join(), sellers.join(), minDiscount, minPrice, maxPrice, inStockOnly, sort, page];

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const res = await getShopProducts({
          search,
          category: categories,
          brand: brands,
          seller: sellers,
          minDiscount, minPrice, maxPrice, inStockOnly,
          sort, page, limit: PER_PAGE,
        });
        if (!alive) return;
        setState({
          items: res.data || [],
          total: res.total || 0,
          pages: res.pages || 1,
          facets: res.facets || { categories: [], brands: [], sellers: [], discounts: [] },
          allCategories: res.categories || [],
          priceRange: res.priceRange || { min: 0, max: 0 },
          loading: false, error: "",
        });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, loading: false, error: e?.response?.data?.message || "Could not load products" }));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Zero-results rescue — fetched only when we actually need it.
  useEffect(() => {
    if (state.loading || state.error || state.items.length || fallback.length) return;
    let alive = true;
    (async () => {
      try {
        const res = await getShopProducts({ limit: 8, sort: "newest", inStockOnly: true });
        if (alive) setFallback(res.data || []);
      } catch { /* a bonus row — never block the page on it */ }
    })();
    return () => { alive = false; };
  }, [state.loading, state.error, state.items.length, fallback.length]);

  /* ── URL helpers. Every filter change resets to page 1 — staying on page 7 of
        a set that now has 2 pages would show an empty grid. ── */
  const commit = (fn) => {
    const next = new URLSearchParams(params);
    fn(next);
    next.delete("page");
    setParams(next);
  };

  const toggleMulti = (key, value) =>
    commit((n) => {
      const current = n.getAll(key);
      n.delete(key);
      const nextVals = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      nextVals.forEach((v) => n.append(key, v));
    });

  const setSingle = (key, value) =>
    commit((n) => { if (value) n.set(key, value); else n.delete(key); });

  // Category is SINGLE-select: only one category at a time. Picking a new one
  // replaces the old; tapping the active one clears it.
  const setSingleCategory = (value) =>
    commit((n) => {
      const current = n.getAll("category");
      n.delete("category");
      if (!current.includes(value)) n.append("category", value);
    });

  const applyPrice = () =>
    commit((n) => {
      const lo = String(priceDraft.min).replace(/\D/g, "");
      const hi = String(priceDraft.max).replace(/\D/g, "");
      if (lo) n.set("minPrice", lo); else n.delete("minPrice");
      if (hi) n.set("maxPrice", hi); else n.delete("maxPrice");
      setFiltersOpen(false);
    });

  const clearAll = () =>
    commit((n) => {
      ["category", "brand", "seller", "minDiscount", "minPrice", "maxPrice", "inStockOnly"].forEach((k) => n.delete(k));
    });

  const goPage = (n) => {
    const next = new URLSearchParams(params);
    if (n <= 1) next.delete("page"); else next.set("page", String(n));
    setParams(next);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const activeCount =
    categories.length + brands.length + sellers.length +
    (minDiscount ? 1 : 0) + (minPrice || maxPrice ? 1 : 0) + (inStockOnly ? 1 : 0);
  const hasFilters = activeCount > 0;

  const from = state.total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const to = Math.min(page * PER_PAGE, state.total);

  const sortOptions = SORTS.filter((s) => !s.searchOnly || isSearch);

  /* Price buckets, derived from the live range — Amazon's "Up to ₹1,600" idea,
     but with numbers that come from THIS result set instead of being hardcoded. */
  const priceBuckets = useMemo(() => {
    const { min, max } = state.priceRange;
    if (!max || max <= min) return [];
    const step = Math.ceil((max - min) / 4 / 50) * 50 || 1;
    const cuts = [min + step, min + step * 2, min + step * 3];
    return [
      { label: `Under ${rupee(cuts[0])}`, min: "", max: String(cuts[0]) },
      { label: `${rupee(cuts[0])} – ${rupee(cuts[1])}`, min: String(cuts[0]), max: String(cuts[1]) },
      { label: `${rupee(cuts[1])} – ${rupee(cuts[2])}`, min: String(cuts[1]), max: String(cuts[2]) },
      { label: `Over ${rupee(cuts[2])}`, min: String(cuts[2]), max: "" },
    ];
  }, [state.priceRange]);

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-6 sm:py-5">
      <div className="flex gap-4 lg:gap-6">

        {/* ══════════ SIDEBAR ══════════ */}
        <aside className="hidden shrink-0 md:block md:w-56 lg:w-64">
          <div className="sticky top-20 rounded-2xl bg-white px-4 py-4 ring-1 ring-stone-200/70 lg:px-5">
            <Filters
              isSearch={isSearch}
              hasFilters={hasFilters}
              clearAll={clearAll}
              state={state}
              categories={categories}
              brands={brands}
            
              minDiscount={minDiscount}
              minPrice={minPrice}
              maxPrice={maxPrice}
              inStockOnly={inStockOnly}
              toggleMulti={toggleMulti}
              setSingleCategory={setSingleCategory}
              setSingle={setSingle}
              commit={commit}
              catIcon={catIcon}
              priceBuckets={priceBuckets}
              priceDraft={priceDraft}
              setPriceDraft={setPriceDraft}
              applyPrice={applyPrice}
              rupee={rupee}
            />
          </div>
        </aside>

        {/* ══════════ RESULTS ══════════ */}
        <div className="min-w-0 flex-1" ref={topRef}>

          {/* Breadcrumb */}
         

          
          {/* Result count line — With Integrated Back Button */}
{!state.loading && !state.error && (
  <div className="flex items-center gap-3">
    {/* 🛠️ NEW: Rounded Outline Back Button */}
    <button
      type="button"
      onClick={() => navigate(-1)}
      aria-label="Go back"
      className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700 shadow-sm transition-colors hover:bg-stone-50 hover:text-[#EA2831] sm:size-10 hidden sm:block"
    >
      <span className="material-symbols-outlined text-xl sm:text-[22px]">arrow_back</span>
    </button>

     <nav className="mb-2 flex items-center gap-1.5 text-xs text-stone-400">
           
            {categories.length === 1 && (
              <>
                <span className="material-symbols-outlined text-sm">chevron_right</span>
                <span className="font-semibold capitalize text-stone-600">{categories[0]}</span>
              </>
            )}
          </nav>

    <h1 className="font-heading text-lg font-bold text-stone-900 sm:text-xl leading-tight">
     {state.total === 0 && (
  <h1 className="font-heading text-lg font-bold text-stone-900 sm:text-xl leading-tight">
    No results{isSearch && <> for “{search}”</>}
  </h1>
)}
    </h1>
  </div>
)}

          {/* ── Sort + filter row ──
              Mobile: a Filters button + a compact Sort dropdown — the two things
              fit side by side and nothing scrolls off-screen. Desktop (sm+): the
              full Flipkart-style horizontal tabs, which have room to breathe. */}

          {/* Mobile controls */}
          <div className="mt-3 flex items-center gap-2.5 md:hidden">
            <button
              onClick={() => setFiltersOpen(true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white py-2.5 text-sm font-bold text-stone-700"
            >
              <span className="material-symbols-outlined text-lg">tune</span> Filters
              {activeCount > 0 && (
                <span className="flex size-5 items-center justify-center rounded-full bg-[#EA2831] text-[10px] font-bold text-white">
                  {activeCount}
                </span>
              )}
            </button>

            <div className="relative flex-1">
              <button
                onClick={() => setSortOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={sortOpen}
                className="flex w-full items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-semibold text-stone-700"
              >
                <span className="material-symbols-outlined text-lg text-stone-400">swap_vert</span>
                <span className="flex-1 truncate text-left">
                  {sortOptions.find((s) => s.value === sort)?.label || "Sort"}
                </span>
                <span className={`material-symbols-outlined text-lg text-stone-400 transition-transform ${sortOpen ? "rotate-180" : ""}`}>expand_more</span>
              </button>

              {sortOpen && (
                <>
                  {/* click-away backdrop */}
                  <div className="fixed inset-0 z-40" onClick={() => setSortOpen(false)} />
                  <ul
                    role="listbox"
                    className="absolute right-0 z-50 mt-1.5 w-56 max-w-[80vw] overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg shadow-stone-900/10"
                  >
                    {sortOptions.map((s) => {
                      const on = s.value === sort;
                      return (
                        <li key={s.value} role="option" aria-selected={on}>
                          <button
                            onClick={() => { setSingle("sort", s.value); setSortOpen(false); }}
                            className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition-colors ${
                              on ? "bg-red-50 font-bold text-[#EA2831]" : "font-medium text-stone-700 hover:bg-stone-50"
                            }`}
                          >
                            {s.label}
                            {on && <span className="material-symbols-outlined text-base">check</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>

          {/* Desktop tabs */}
          <div className="mt-3 hidden flex-wrap items-center gap-x-4 gap-y-1 border-b border-stone-200 md:flex">
            <span className="shrink-0 pb-2.5 text-sm font-bold text-stone-900">Sort By</span>
            {sortOptions.map((s) => (
              <button
                key={s.value}
                onClick={() => setSingle("sort", s.value)}
                className={`shrink-0 border-b-2 pb-2.5 text-sm font-medium transition-colors ${
                  sort === s.value
                    ? "border-[#EA2831] font-bold text-[#EA2831]"
                    : "border-transparent text-stone-500 hover:text-stone-800"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

         

          {/* Grid */}
          <div className="mt-5">
            {state.loading ? (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)}
              </div>
            ) : state.error ? (
              <div className="rounded-3xl bg-white p-14 text-center ring-1 ring-stone-200/70">
                <span className="material-symbols-outlined text-5xl font-light text-[#EA2831]">wifi_off</span>
                <h3 className="mt-3 font-heading text-lg font-bold text-stone-900">{state.error}</h3>
                <button
                  onClick={() => setParams(new URLSearchParams(params))}
                  className="mt-4 rounded-xl bg-[#EA2831] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#c91e26]"
                >
                  Try again
                </button>
              </div>
            ) : state.items.length === 0 ? (
              <div className="space-y-6">
                <div className="rounded-3xl bg-white p-12 text-center ring-1 ring-stone-200/70">
                  <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-stone-50 text-stone-300">
                    <span className="material-symbols-outlined text-4xl font-light">search_off</span>
                  </span>
                  <h3 className="mt-4 font-heading text-lg font-bold text-stone-900">No products found</h3>
                  <p className="mt-1 text-sm text-stone-500">
                    {isSearch ? <>We couldn't find anything for “{search}”.</> : "Nothing matches these filters."}
                  </p>
                  {hasFilters && (
                    <button onClick={clearAll} className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-[#EA2831] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#c91e26]">
                      <span className="material-symbols-outlined text-lg">restart_alt</span> Clear all filters
                    </button>
                  )}
                </div>

                {fallback.length > 0 && (
                  <div>
                    <h4 className="mb-3 font-heading text-base font-bold text-stone-900">Popular right now</h4>
                    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                      {fallback.map((p) => <HomeProductCard key={p.listingId} product={p} />)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                  {state.items.map((p) => <HomeProductCard key={p.listingId} product={p} />)}
                </div>
                <Pagination page={page} pages={state.pages} onGo={goPage} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* ══════════ Mobile filter sheet ══════════ */}
      <div className={`fixed inset-0 z-50 md:hidden ${filtersOpen ? "" : "pointer-events-none"}`} aria-hidden={!filtersOpen}>
        <div
          onClick={() => setFiltersOpen(false)}
          className={`absolute inset-0 bg-[#14201A]/40 transition-opacity duration-300 ${filtersOpen ? "opacity-100" : "opacity-0"}`}
        />
        <div className={`absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-3xl bg-white px-5 pb-5 pt-3 transition-transform duration-300 ${filtersOpen ? "translate-y-0" : "translate-y-full"}`}>
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-stone-200" />
          <Filters
            onPick={() => setFiltersOpen(false)}
            isSearch={isSearch}
              hasFilters={hasFilters}
              clearAll={clearAll}
              state={state}
              categories={categories}
              brands={brands}
             
              minDiscount={minDiscount}
              minPrice={minPrice}
              maxPrice={maxPrice}
              inStockOnly={inStockOnly}
              toggleMulti={toggleMulti}
              setSingleCategory={setSingleCategory}
              setSingle={setSingle}
              commit={commit}
              catIcon={catIcon}
              priceBuckets={priceBuckets}
              priceDraft={priceDraft}
              setPriceDraft={setPriceDraft}
              applyPrice={applyPrice}
              rupee={rupee}
          />
          <button
            onClick={() => setFiltersOpen(false)}
            className="mt-5 w-full rounded-xl bg-[#EA2831] py-3 text-sm font-bold text-white transition-colors hover:bg-[#c91e26]"
          >
            Show {state.total.toLocaleString("en-IN")} {state.total === 1 ? "product" : "products"}
          </button>
        </div>
      </div>
    </div>
  );
}