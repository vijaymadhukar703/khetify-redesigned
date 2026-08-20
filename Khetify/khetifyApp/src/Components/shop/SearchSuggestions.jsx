import React from "react";

export default function SearchSuggestions({
  open,
  query,
  suggestions = [],
  loading = false,
  error = "",
  onSelect,
  onClose,
  onInputChange,
  onInputFocus,
  onSubmit,
  inputId,
  isMobile = false,
  overlayRef = null,
  className = "",
}) {
  const trimmedQuery = (query || "").trim();
  const hasQuery = trimmedQuery.length > 0;

  if (!open) return null;

const emptyStateClass = "px-4 py-6 text-sm text-stone-500 text-center font-medium";
  const renderBody = () => {
    if (loading) {
      return <div className={emptyStateClass}>Searching products…</div>;
    }

    if (error) {
      return <div className={`${emptyStateClass} text-[#EA2831]`}>{error}</div>;
    }

    if (!hasQuery) {
      return <div className={emptyStateClass}>Type a product name to see live suggestions.</div>;
    }

    if (suggestions.length === 0) {
      return <div className={emptyStateClass}>No results found</div>;
    }

    return (
<div className="space-y-1.5 p-1">
          {suggestions.map((item) => (
          <button
            key={item.listingId || item.name}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect?.(item.name)}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-stone-700 transition-colors hover:bg-stone-50 hover:text-[#EA2831]"
          >
            <span className="material-symbols-outlined text-base text-stone-400">search</span>
            <span className="flex-1 truncate">{item.name}</span>
          </button>
        ))}
      </div>
    );
  };

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-[80] bg-white" ref={overlayRef}>
        <div className="flex h-full flex-col bg-white">
          <div className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 shadow-sm">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close search"
              className="flex size-10 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 transition-colors hover:bg-stone-50"
            >
              <span className="material-symbols-outlined text-[22px]">arrow_back</span>
            </button>
            <div className="flex flex-1 items-center rounded-full border border-stone-200 bg-stone-50 px-3 py-2.5">
              <span className="material-symbols-outlined pr-2 text-xl text-stone-400">search</span>
              <input
                id={`${inputId}-overlay`}
                value={query}
                onChange={onInputChange}
                onFocus={onInputFocus}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onSubmit?.(event);
                    onClose?.();
                  }
                }}
                placeholder="Search products..."
                autoFocus
                className="flex-1 bg-transparent text-sm text-stone-800 outline-none placeholder:text-stone-400"
                aria-label="Search products"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3">{renderBody()}</div>
        </div>
      </div>
    );
  }

  return (
  <div
    className={`absolute left-0 right-0 top-full z-50 mt-2 max-h-[320px] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-2 shadow-[0_16px_45px_-18px_rgba(20,32,26,0.35)] transition-all duration-200 ${
      open ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0"
    } ${className}`}
  >
    {renderBody()}
  </div>
);
}
