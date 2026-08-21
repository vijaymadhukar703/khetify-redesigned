import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import {
  getSellerReportList, runSellerReport, downloadSellerReportCsv, getSellerWarehouses,
} from '../../lib/sellerApi';
import { PrimaryBtn, GhostBtn } from '../Company/ims/ImsUi';
import { useSellerPermission } from '../../context/SellerPermissionContext';

const apiError = (err) => Swal.fire({ icon: 'error', title: err?.response?.data?.message || err.message || 'Error', toast: true, position: 'top-end', timer: 2600, showConfirmButton: false });
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);
const isUpgrade = (err) => err?.response?.status === 403 || err?.response?.data?.code === 'UPGRADE_REQUIRED';

// Fixed to Stock on Hand — the report picker was removed, so this is the single
// report name sent to the seller report API and used for the CSV export.
const REPORT_NAME = 'stock-on-hand';

// `sku` is removed from the Analytics table for every role (mirrors the company
// ImsAnalytics). View-only: the seller report API still returns it and the CSV
// still exports it. Columns derive from the row keys, so filtering the key drops
// the column cleanly with no empty cell and the rest reflow.
// `batch` is hidden too. The seller report sets `lot: lotNumber || batchNumber`
// and `batch: batchNumber`, so on a lot that has both — which is every lot the
// company supplies — the two columns print the SAME string side by side. The
// company page hides it for exactly this reason. Nothing is lost: the value is
// still in `lot`, still returned by the API, and still exported in the CSV.
const HIDDEN_COLS = ['sku', 'batch'];

// Rows per page. The SAME size the company Analytics table uses, so a report
// reads identically on both sides.
const PAGE_SIZE = 10;

/**
 * Header overrides — they rename the COLUMN HEADING only and never touch the
 * data key, so the row values, the CSV export and the report API are all
 * completely unaffected.
 *
 * `value` IS NOT THE MRP ON THE SELLER REPORT. The company report has no `mrp`
 * key and uses `value` for the unit MRP, so its page labels `value` "MRP". The
 * seller report returns BOTH: `mrp` (the unit price) and `value`
 * (`availableStock × mrp` — the line total). Borrowing the company's label
 * verbatim therefore printed two columns headed MRP, the second one actually
 * holding the amount. It is labelled for what it holds here.
 *
 * The result is the company's column set exactly:
 * Product · Warehouse · Lot/Batch · Qty · MRP · Amount · Expiry · Actions.
 */
const COL_LABELS = { lot: 'Lot/Batch', value: 'Amount' };

// Seller analytics — pick a report, filter, view a table, export CSV. Mirrors
// the company ImsAnalytics. Lot-level reports are a paid (owner) feature; a free
// seller sees an upgrade prompt (a manager is told to ask the admin).
const SellerAnalytics = () => {
  const navigate = useNavigate();
  const canBill = useSellerPermission('billing:manage');
  const [warehouses, setWarehouses] = useState([]);
  const [filters, setFilters] = useState({ from: '', to: '', warehouseId: '' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    // The report picker is gone, but this call is kept as the mount-time access
    // probe: a free (upgrade-gated) seller gets 403 → the Pro prompt, exactly as
    // before. Its report list is simply no longer rendered.
    getSellerReportList().catch((e) => { if (isUpgrade(e)) setLocked(true); });
    getSellerWarehouses().then((r) => setWarehouses(listOf(r))).catch(() => {});
  }, []);

  // setState only inside the promise callbacks (never synchronously in the
  // effect body) so the auto-run on report change stays lint-clean.
  const fetchRows = () => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    return runSellerReport(REPORT_NAME, params)
      .then((r) => { setRows(listOf(r)); setLocked(false); })
      .catch((e) => { if (isUpgrade(e)) { setLocked(true); setRows([]); } else { apiError(e); setRows([]); } });
  };
  const run = () => {
    setLoading(true);
    setPage(1); // a fresh result set always starts at page 1
    fetchRows().finally(() => setLoading(false));
  };

  /** Filter edits invalidate the current page — the next Run starts from page 1. */
  const setFilter = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };
  // Auto-load Stock on Hand on mount — no report selection is required.
  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Underscore-prefixed keys are INTERNAL row metadata (the lot id behind a
  // Stock on Hand line, used by the View action) and are never a column.
  const columns = useMemo(
    () => (rows[0] ? Object.keys(rows[0]).filter((c) => !c.startsWith('_') && !HIDDEN_COLS.includes(c)) : []),
    [rows]
  );
  const colCount = columns.length + 1; // + Actions

  /* PAGINATION — a pure VIEW SLICE over the already-filtered result set.

     Identical in shape to the company page's. The seller report API returns a
     plain array with no page/limit support, and `rows` is already the fully
     FILTERED set (from/to/warehouse are applied server-side by runSellerReport).
     So this filters first, then paginates: `rows.length` stays the authoritative
     total, and the CSV keeps re-querying the whole filtered report server-side,
     untouched by whichever page is on screen.

     NO CALCULATION CHANGES: nothing is summed, sorted or dropped here — the same
     rows in the same order, ten at a time. */
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const rangeStart = totalRows === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, totalRows);

  const download = async () => {
    try { await downloadSellerReportCsv(REPORT_NAME, Object.fromEntries(Object.entries(filters).filter(([, v]) => v))); } catch (e) { apiError(e); }
  };

  if (locked) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">workspace_premium</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Analytics is a Pro feature</h2>
          <p className="text-sm text-amber-700 mt-1">
            {canBill
              ? 'Upgrade your plan to unlock stock, aging, expiry and movement reports.'
              : 'Ask your seller admin to upgrade the plan to unlock these reports.'}
          </p>
          {canBill && (
            <button onClick={() => navigate('/seller/billing')} className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-white bg-[#EA2831] hover:bg-red-600 rounded-lg px-4 py-2">
              <span className="material-symbols-outlined text-base">workspace_premium</span> View plans
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      {/* FULL WIDTH, matching the company Analytics page. That page carries
          `max-w-6x3`, which is not a real Tailwind class — so no max-width is
          applied there and the report runs edge to edge. `max-w-none` is the
          same result stated on purpose, rather than copying a typo across. */}
      <div className="max-w-none mx-auto space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          {/* Report picker removed — the page is fixed to Stock on Hand
              (REPORT_NAME) and auto-loads it on mount. */}
          <div>
            <label className="text-[10px] font-bold uppercase text-stone-400">From</label>
            <input type="date" value={filters.from} onChange={setFilter('from')} className="block border border-stone-200 rounded-lg text-sm px-3 py-2 mt-1" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-stone-400">To</label>
            <input type="date" value={filters.to} onChange={setFilter('to')} className="block border border-stone-200 rounded-lg text-sm px-3 py-2 mt-1" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-stone-400">Warehouse</label>
            <select value={filters.warehouseId} onChange={setFilter('warehouseId')} className="block border border-stone-200 rounded-lg text-sm px-3 py-2 bg-white mt-1">
              <option value="">All</option>
              {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
            </select>
          </div>
          <PrimaryBtn onClick={run}>Run</PrimaryBtn>
          <GhostBtn onClick={download} disabled={rows.length === 0}><span className="material-symbols-outlined text-sm">download</span> CSV</GhostBtn>
        </div>
        <p className="text-[11px] text-stone-400">{rows.length} row(s).</p>

        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead><tr className="bg-stone-50 border-b border-stone-200">
                {columns.map((c) => <th key={c} className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-stone-400 whitespace-nowrap">{COL_LABELS[c] || c}</th>)}
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-stone-400 whitespace-nowrap text-right">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-stone-100">
                {paged.map((r, i) => (
                  <tr key={i} className="hover:bg-stone-50/40">
                    {columns.map((c) => <td key={c} className="px-4 py-2.5 text-stone-700 whitespace-nowrap">{typeof r[c] === 'boolean' ? (r[c] ? 'Yes' : 'No') : String(r[c] ?? '')}</td>)}
                    {/* VIEW — the read-only Analytics details for this lot. Only a
                        row that carries the lot it came from is openable. */}
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {r._inventoryId ? (
                        <Link
                          to={`/seller/analytics/product/${r._inventoryId}`}
                          title="View product analytics details"
                          className="inline-flex items-center gap-1 text-[11px] font-bold border border-stone-200 hover:border-[#EA2831] hover:text-[#EA2831] text-stone-600 rounded-lg px-2.5 py-1.5 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[15px]">visibility</span> View
                        </Link>
                      ) : (
                        <span className="text-[11px] text-stone-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && <tr><td colSpan={colCount} className="px-4 py-12 text-center text-stone-400">No data for this report / filter.</td></tr>}
                {loading && <tr><td colSpan={colCount} className="px-4 py-12 text-center text-stone-400">Loading…</td></tr>}
              </tbody>
            </table>
          </div>

          {/* PAGINATION — the same footer, markup and states as the company
              Analytics table: range read-out on the left, Previous / numbered
              pages / Next on the right, current page in the brand colour.

              The counts read the FULL filtered dataset — `totalRows` is every
              row the report returned, never the size of the page — so the
              numbers a seller sees are still the report's own totals. */}
          {!loading && totalRows > 0 && (
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

export default SellerAnalytics;