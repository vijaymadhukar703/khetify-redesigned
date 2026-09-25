import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Swal from 'sweetalert2';
import { runReport, downloadReportCsv, getWarehouses } from '../../../lib/imsApi';
import { PrimaryBtn, GhostBtn } from './ImsUi';
import { usePermission } from '../../../context/PermissionContext';
import { ChevronDown } from 'lucide-react';

const apiError = (err) => Swal.fire({ icon: 'error', title: err?.response?.data?.message || err.message || 'Error', toast: true, position: 'top-end', timer: 2600, showConfirmButton: false });
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);

// The Analytics page is fixed to Stock on Hand — the report picker was removed,
// so this is the single report name sent to the API (reports/<name>) and used
// for the CSV export. Kept as a constant, not state, so it can never change.
const REPORT_NAME = 'stock-on-hand';

const PAGE_SIZE = 10; // Main Company report pagination — rows per page

// Columns hidden from the report table for EVERY role that reaches this shared
// view. Columns are DERIVED from the row keys, so hiding one is purely a display
// concern — the API still returns `sku` and the CSV still exports it
// (batch/abcClass/costPrice are likewise suppressed in the view only). Module
// scope so it is a stable reference (no re-created array per render).
const HIDDEN_COLS = ['sku', 'batch', 'abcClass', 'costPrice'];
// Header overrides — rename column headers without touching the data keys.
const COL_LABELS = { lot: 'Lot/Batch', value: 'MRP' };





// Custom dropdown replacing the native Warehouse <select> — same border/size
// as the date inputs beside it, but the open menu is theme-styled.
const WarehouseFilterSelect = ({ value, warehouses, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const currentLabel = warehouses.find((w) => w._id === value)?.name || 'All';

  return (
    <div className="relative min-w-[140px]" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center justify-between gap-2 w-full border rounded-lg text-sm px-3 py-2 mt-1 bg-white text-left transition-all cursor-pointer ${
          open ? 'border-[#EA2831] ring-2 ring-[#EA2831]/20' : 'border-stone-200 hover:border-stone-300'
        }`}
      >
        <span className="truncate text-stone-700">{currentLabel}</span>
        <ChevronDown className={`size-4 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1.5 w-full min-w-[160px] rounded-xl border border-stone-200 bg-white py-1.5 shadow-lg shadow-stone-900/10 max-h-64 overflow-y-auto"
        >
          <li role="option" aria-selected={value === ''}>
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className={`flex w-full items-center px-3.5 py-2 text-left text-sm font-medium transition-colors ${
                value === '' ? 'text-[#EA2831] bg-[#EA2831]/5 font-bold' : 'text-stone-600 hover:bg-stone-50'
              }`}
            >
              All
            </button>
          </li>
          {warehouses.map((w) => {
            const selected = w._id === value;
            return (
              <li key={w._id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => { onChange(w._id); setOpen(false); }}
                  className={`flex w-full items-center px-3.5 py-2 text-left text-sm font-medium transition-colors ${
                    selected ? 'text-[#EA2831] bg-[#EA2831]/5 font-bold' : 'text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {w.name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};




/**
 * Reports explorer — pick a report, filter, view a table, export CSV.
 *
 * Reached by every role holding report:read (company_admin, the warehouse/ops
 * roles, transport, sales, auditor) — the component is shared, so the MAIN
 * COMPANY behaviours below are gated on the role. Everyone else keeps the
 * original full, unpaginated table with all its columns.
 */
const ImsAnalytics = () => {
  const { role } = usePermission();
  const isMainCompany = role === 'company_admin';
  const [warehouses, setWarehouses] = useState([]);
  const [filters, setFilters] = useState({ from: '', to: '', warehouseId: '' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    getWarehouses().then((r) => setWarehouses(listOf(r))).catch(() => {});
  }, []);

  const run = (overrides) => {
  setLoading(true);
  setPage(1);
  const merged = { ...filters, ...(overrides || {}) };
  const params = Object.fromEntries(Object.entries(merged).filter(([, v]) => v));
  runReport(REPORT_NAME, params).then((r) => setRows(listOf(r))).catch((e) => { apiError(e); setRows([]); }).finally(() => setLoading(false));
};

  // Auto-load Stock on Hand on mount — no report selection is required.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, []);

  /** Filter edits invalidate the current page — the next Run starts from page 1. */
  const setFilter = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };

  // Table is `w-full`, so dropping SKU lets the remaining columns reflow across
  // the freed width — no placeholder cell is left behind.
  // Underscore-prefixed keys are INTERNAL row metadata (the lot id behind a
  // Stock on Hand line, used by the View action) and are never a column.
  const columns = useMemo(
    () => (rows[0] ? Object.keys(rows[0]).filter((c) => !c.startsWith('_') && !HIDDEN_COLS.includes(c)) : []),
    [rows]
  );
  // Actions column — every role that reaches this page. A row is openable only
  // when it carries the lot it was derived from.
  //
  // The two audiences go to DIFFERENT View pages on purpose. The Main Company
  // reads its stock as the original lot register; a warehouse reads the current
  // state of its own row. Same three sections either way — see
  // Components/ims/AnalyticsDetailsView — but the Company page is finalized and
  // stays exactly as it is, so the warehouse gets its own route rather than a
  // branch inside it.
  const showActions = true;
  const viewPathFor = (r) => (isMainCompany
    ? `/analytics/product/${r._inventoryId}`
    : `/warehouse/analytics/product/${r._inventoryId}`);
  const colCount = columns.length + (showActions ? 1 : 0);

  // PAGINATION (Main Company only) — the report API returns a plain array with
  // no page/limit support, and the rows here are already the fully FILTERED set
  // (report type + from/to + warehouse are all applied server-side by runReport).
  // So paging is a pure view slice over that complete set: filter first, then
  // paginate. `rows.length` stays the authoritative total, and the CSV keeps
  // re-querying the whole filtered report server-side, untouched by the page.
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = isMainCompany ? rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) : rows;
  const rangeStart = totalRows === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, totalRows);
  const download = async () => {
    try { await downloadReportCsv(REPORT_NAME, Object.fromEntries(Object.entries(filters).filter(([, v]) => v))); } catch (e) { apiError(e); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-6x3 mx-auto space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          {/* Report picker removed — the page is fixed to Stock on Hand
              (REPORT_NAME) and auto-loads it on mount. */}
          <div>
            <label className="text-[10px] font-bold uppercase text-stone-400">From</label>
            <input type="date" value={filters.from} onChange={setFilter('from')} className="block border border-stone-200 rounded-lg text-sm px-3 py-2 mt-1 outline-none transition-all focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/20 hover:border-stone-300" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-stone-400">To</label>
            <input type="date" value={filters.to} onChange={setFilter('to')} className="block border border-stone-200 rounded-lg text-sm px-3 py-2 mt-1 outline-none transition-all focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/20 hover:border-stone-300" />
          </div>
          <div>
  <label className="text-[10px] font-bold uppercase text-stone-400">Warehouse</label>
  <WarehouseFilterSelect
  value={filters.warehouseId}
  warehouses={warehouses}
  onChange={(v) => {
    setFilters((f) => ({ ...f, warehouseId: v }));
    run({ warehouseId: v }); // fetch immediately with the new value, don't wait for state to update
  }}
/>
</div>
          <PrimaryBtn onClick={run}>Run</PrimaryBtn>
          <GhostBtn onClick={download} disabled={rows.length === 0}><span className="material-symbols-outlined text-sm">download</span> CSV</GhostBtn>
        </div>
        <p className="text-[11px] text-stone-400">★ advanced reports require the Pro/Enterprise plan. {rows.length} row(s).</p>

        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead><tr className="bg-stone-50 border-b border-stone-200">
                {columns.map((c) => <th key={c} className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-stone-400 whitespace-nowrap">{COL_LABELS[c] || c}</th>)}
                {showActions && <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-stone-400 whitespace-nowrap text-right">Actions</th>}
              </tr></thead>
              <tbody className="divide-y divide-stone-100">
                {paged.map((r, i) => (
                  <tr key={i} className="hover:bg-stone-50/40">
                    {columns.map((c) => <td key={c} className="px-4 py-2.5 text-stone-700 whitespace-nowrap">{typeof r[c] === 'boolean' ? (r[c] ? 'Yes' : 'No') : String(r[c] ?? '')}</td>)}
                    {showActions && (
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {r._inventoryId ? (
                          <Link
                            to={viewPathFor(r)}
                            title="View product analytics details"
                            className="inline-flex items-center gap-1 text-[11px] font-bold border border-stone-200 hover:border-[#EA2831] hover:text-[#EA2831] text-stone-600 rounded-lg px-2.5 py-1.5 transition-colors"
                          >
                            <span className="material-symbols-outlined text-[15px]">visibility</span> View
                          </Link>
                        ) : (
                          <span className="text-[11px] text-stone-300">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {!loading && rows.length === 0 && <tr><td colSpan={colCount || 1} className="px-4 py-12 text-center text-stone-400">No data for this report / filter.</td></tr>}
                {loading && <tr><td colSpan={colCount || 1} className="px-4 py-12 text-center text-stone-400">Loading…</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Pagination (Main Company). Counts read the FULL filtered dataset —
              `totalRows` is every row the report returned, never the page. */}
          {isMainCompany && !loading && totalRows > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-stone-200 bg-stone-50/50">
              <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                Showing {rangeStart}–{rangeEnd} of {totalRows} rows
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1}
                    className="px-3 py-1.5 text-xs font-bold text-stone-500 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:hover:bg-white disabled:cursor-not-allowed">
                    Previous
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                    <button key={n} onClick={() => setPage(n)}
                      className={`min-w-[32px] px-2 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                        n === currentPage ? 'bg-[#EA2831] border-[#EA2831] text-white' : 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50'
                      }`}>
                      {n}
                    </button>
                  ))}
                  <button onClick={() => setPage(currentPage + 1)} disabled={currentPage === totalPages}
                    className="px-3 py-1.5 text-xs font-bold text-stone-500 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:hover:bg-white disabled:cursor-not-allowed">
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImsAnalytics;
