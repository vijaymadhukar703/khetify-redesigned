import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOrderHistory, getWarehouses, formatINR } from '../../lib/imsApi';
import { StatCard, inputCls } from './ims/ImsUi';
import { movementKind } from '../../lib/movementLabel';
import { usePermission } from '../../context/PermissionContext';

// ORDER HISTORY — a dedicated, searchable history across seller orders,
// warehouse transfers and shipments. Filters by date, seller, warehouse,
// product and status; each row expands to its status timeline.
//
// MAIN COMPANY (role "company_admin") sees this page as "TRANSFER HISTORY":
// only actual warehouse stock MOVEMENTS are listed (SH-* shipments), with
// transfer-specific cards, no type filter, and pagination. The TR-* transfer
// REQUESTS that authorise those movements are excluded server-side via
// excludeRequests — they are not a second movement, and they already have a
// home in Operations → Shipment Tracking & Transfers → Requests. Every OTHER
// role (sales_manager, pos_operator, support, …) keeps the original full Order
// History unchanged: no flag is sent, so all three sources still come back.
// No backend data or API is removed.

// Two user-facing terms only: internal warehouse moves => "Transfer", anything
// with an outside party => "Sales". Used as a fallback when a row doesn't carry
// the toType/refType/type fields movementKind() reads.
const KIND_LABEL = { seller: 'Sales', transfer: 'Transfer', shipment: 'Sales' };
// Prefer the field-driven kind (so a warehouse shipment reads "Transfer" and a
// customer shipment reads "Sales"); fall back to the per-row map above.
const kindLabel = (r) => movementKind(r) || KIND_LABEL[r.kind] || r.kind;
const KIND_STYLE = {
  seller: 'bg-blue-50 text-blue-700',
  transfer: 'bg-amber-50 text-amber-700',
  shipment: 'bg-violet-50 text-violet-700',
};

// A row is a TRANSFER when its effective movement kind is "Transfer" — i.e.
// a TransferRequest (kind "transfer") OR a warehouse→warehouse Shipment
// (kind "shipment" with toType "warehouse"). Seller orders and customer/vendor
// shipments (Sales) are excluded. Reuses the shared movementKind rule.
const isTransfer = (r) => kindLabel(r) === 'Transfer';

// A row that has its own read-only Transfer Details page: a WAREHOUSE→WAREHOUSE
// SHIPMENT, whose `id` is the Shipment the detail endpoint is keyed by. The TR-*
// request rows (kind "transfer") authorise a move but are not one, carry no
// shipment id, and are excluded from this view server-side anyway.
const isViewableTransfer = (r) => r.kind === 'shipment' && r.toType === 'warehouse';

// Real transfer status values (TransferRequest: requested/accepted/rejected/
// fulfilled/cancelled · Shipment transfer pipeline: …dispatched/in_transit/
// arrived/received/delivered/cancelled). Mapped to summary buckets.
// `partially_received` belongs here: the goods HAVE been received, just short.
// Leaving it out put a partially received transfer in the In Transit card and
// hid it from the Received filter — the same grouping the API's statusBucket
// uses, so the two must agree.
const RECEIVED_STATUSES = new Set(['received', 'partially_received', 'delivered', 'fulfilled', 'completed']);
const CLOSED_STATUSES = new Set(['cancelled', 'rejected', 'exception', 'returned']);
// MAIN COMPANY status filter — two BUCKETS, not raw pipeline values.
//
// These are the same two groupings the summary cards above the table already
// use ("In Transit", "Received / Completed"), so picking one narrows the table to
// exactly what its card counts. Matching on the literal statuses instead would
// make the "In Transit: 5" card filter down to 2 (only rows sitting on the exact
// `in_transit` step), which reads as a bug.
//
// Bucketing is also what lets the granular options go without hiding rows: a
// `dispatched` or `arrived` transfer is still reachable under In Transit, and
// `delivered` / `partially_received` under Received. Only CLOSED rows
// (cancelled/rejected/exception/returned) sit outside both buckets — by design,
// since the Cancelled option was dropped — and stay reachable via All statuses.
const MAIN_COMPANY_STATUS_FILTERS = [
  ['in_transit', 'In Transit'],
  ['received', 'Received'],
];

/** Does a row fall in the chosen Company bucket? Empty bucket = All statuses. */
const matchesStatusBucket = (r, bucket) => {
  if (!bucket) return true;
  if (bucket === 'received') return RECEIVED_STATUSES.has(r.status);
  if (bucket === 'in_transit') return !RECEIVED_STATUSES.has(r.status) && !CLOSED_STATUSES.has(r.status);
  return true;
};
// Original order statuses (unchanged) for every non-company role.
const ORDER_STATUSES = ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'];

const STATUS_STYLE = (s) => {
  if (['delivered', 'received', 'fulfilled'].includes(s)) return 'bg-green-50 text-green-700';
  if (['cancelled', 'rejected', 'exception', 'returned'].includes(s)) return 'bg-red-50 text-red-700';
  if (['pending', 'requested', 'draft'].includes(s)) return 'bg-stone-100 text-stone-600';
  return 'bg-yellow-50 text-yellow-700';
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const PAGE_SIZE = 10; // Company Transfer History pagination

// Company Transfer History applies its filters as they change — no Apply step.
// Typing is the only one that needs holding back, so a search term costs one
// request instead of one per keystroke; the selects and date pickers fire at
// once. Order History (every other role) keeps its Apply Filters button.
const SEARCH_DEBOUNCE_MS = 400;

const OrderHistory = () => {
  const { role, loading: permLoading } = usePermission();
  const isMainCompany = role === 'company_admin';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [page, setPage] = useState(1);

  const [filters, setFilters] = useState({ type: '', status: '', warehouseId: '', from: '', to: '', q: '' });
  // The filter set actually applied on the last load — the Company transfer view
  // narrows by status client-side against this (the backend doesn't status-filter
  // TransferRequests), so cards/table/pagination stay consistent.
  const [applied, setApplied] = useState({ status: '' });
  // Set when From is later than To — the one filter combination that cannot be
  // satisfied, so it is reported rather than silently returning nothing.
  const [dateError, setDateError] = useState('');
  // The search term the last request actually used — `filters.q` held back by
  // SEARCH_DEBOUNCE_MS (Company view only).
  const [debouncedQ, setDebouncedQ] = useState('');
  // Bumped by Clear so it always reloads, even when every filter was already
  // empty and none of the value-based dependencies below would have changed.
  const [reloadKey, setReloadKey] = useState(0);

  // Auto-applied filters fire a request per change, so two can be in flight at
  // once. Only the LATEST is allowed to land — otherwise a slow early response
  // (say the empty search) can overwrite the newer, narrower one and the table
  // ends up showing results for a filter the user has already moved past.
  const reqSeq = useRef(0);

  // Shared fetch: pulls the history for a filter set. Kept side-effect-light so
  // it can run from an effect without synchronous setState.
  const fetchHistory = (f) => {
    const seq = ++reqSeq.current;
    const isCurrent = () => seq === reqSeq.current;
    const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
    // Transfer History lists actual stock movements (SH-*) only. The TR-*
    // request rows are the authorisation for a move, not a second move, and are
    // already listed under Operations → Shipment Tracking & Transfers →
    // Requests. Order History (every other role) is unaffected — no flag, so the
    // response still carries all three sources.
    if (isMainCompany) {
      params.excludeRequests = 1;
      // Ask for warehouse→warehouse movements ONLY. Without this the API builds
      // its union from seller orders + every shipment and then caps it, so a
      // company with recent sales spent that cap on rows this page discards and
      // the transfers the filters should have narrowed never arrived.
      params.transfersOnly = 1;
      // The Company's two options are BUCKETS ("In Transit" groups dispatched /
      // arrived / …), not single statuses, so they go as ?statusBucket= — which
      // the API resolves IN THE QUERY. ?status= stays an exact match for Order
      // History (every other role), which is unaffected.
      delete params.status;
      // Read the status off the SET BEING FETCHED, not off `filters` — during a
      // Clear the state update has not flushed yet, so the closure still holds
      // the outgoing value and the "reset" request would carry the old bucket.
      if (f.status) params.statusBucket = f.status;
    }
    return getOrderHistory(params)
      .then((r) => { if (isCurrent()) setRows(r?.data || []); })
      .catch(() => { if (isCurrent()) setRows([]); })
      .finally(() => { if (isCurrent()) setLoading(false); });
  };

  // Apply filters — ORDER HISTORY ONLY (every non-company role keeps its button).
  // An event handler, so setting state here is fine. Captures the applied
  // status, resets to page 1, then refetches.
  const load = () => {
    // A backwards range can only ever return nothing; say so instead of showing
    // an empty table. Checked as plain YYYY-MM-DD strings, which sort correctly.
    if (filters.from && filters.to && filters.from > filters.to) {
      setDateError('From date cannot be later than To date.');
      return;
    }
    setDateError('');
    setLoading(true);
    setApplied({ status: filters.status });
    setPage(1);
    fetchHistory(filters);
  };

  // Wait for the role before the first load — `isMainCompany` decides whether
  // the request carries excludeRequests, and fetching while it is still false
  // would populate Transfer History with the TR-* rows this view excludes.
  // The Company view loads through its own auto-apply effect below, so this
  // covers Order History only and the two can never both fire.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!permLoading && !isMainCompany) fetchHistory({}); }, [permLoading, isMainCompany]);
  useEffect(() => { getWarehouses().then((r) => setWarehouses(r?.data || r || [])).catch(() => {}); }, []);

  // ── COMPANY TRANSFER HISTORY — filters apply themselves ──────────────────
  // Search is held for SEARCH_DEBOUNCE_MS so a typed term is one request, not
  // one per keystroke. Everything else is a discrete pick and goes immediately.
  useEffect(() => {
    if (!isMainCompany) return undefined;
    const t = setTimeout(() => setDebouncedQ(filters.q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filters.q, isMainCompany]);

  // The single loader for this view: mount, every filter change, and Clear.
  // Depending on the individual values (not the `filters` object) means it fires
  // when a value really changed, not on every re-render that rebuilds the object.
  const { status: fStatus, warehouseId: fWarehouse, from: fFrom, to: fTo } = filters;
  useEffect(() => {
    if (permLoading || !isMainCompany) return;
    if (fFrom && fTo && fFrom > fTo) {
      // Unsatisfiable: report it and leave the current results on screen rather
      // than fetching a guaranteed-empty list.
      setDateError('From date cannot be later than To date.');
      return;
    }
    setDateError('');
    setLoading(true);
    setApplied({ status: fStatus });
    setPage(1);
    fetchHistory({ status: fStatus, warehouseId: fWarehouse, from: fFrom, to: fTo, q: debouncedQ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permLoading, isMainCompany, fStatus, fWarehouse, fFrom, fTo, debouncedQ, reloadKey]);

  // Original totals (non-company roles) — every kind of record.
  const totals = useMemo(() => {
    const value = rows.reduce((s, r) => s + (r.total || 0), 0);
    const byKind = rows.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] || 0) + 1 }), {});
    return { count: rows.length, value, byKind };
  }, [rows]);

  // Company transfer view — the full filtered dataset of transfer records only.
  const transferRows = useMemo(
    () => rows.filter(isTransfer).filter((r) => matchesStatusBucket(r, applied.status)),
    [rows, applied.status]
  );

  // Transfer summary cards — computed over the FULL filtered transfer set.
  const transferTotals = useMemo(() => ({
    total: transferRows.length,
    inTransit: transferRows.filter((r) => !RECEIVED_STATUSES.has(r.status) && !CLOSED_STATUSES.has(r.status)).length,
    received: transferRows.filter((r) => RECEIVED_STATUSES.has(r.status)).length,
    value: transferRows.reduce((s, r) => s + (r.total || 0), 0),
  }), [transferRows]);

  // Pagination (Company) — applied AFTER filtering, over transferRows.
  const totalPages = Math.max(1, Math.ceil(transferRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rangeStart = transferRows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, transferRows.length);
  const pagedTransfers = transferRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Rows actually rendered in the table.
  const displayRows = isMainCompany ? pagedTransfers : rows;

  // Changing any filter/search resets pagination to page 1.
  const set = (k) => (e) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    if (k === 'from' || k === 'to') setDateError('');
    setPage(1);
  };
  const clear = () => {
    setFilters({ type: '', status: '', warehouseId: '', from: '', to: '', q: '' });
    setApplied({ status: '' });
    setDateError('');
    setPage(1);
    if (isMainCompany) {
      // Reset the debounced term straight away so the reload is immediate rather
      // than trailing the search debounce, and bump reloadKey so the full list
      // comes back even if no filter was set. The auto-apply effect does the
      // fetch — these all batch into ONE run of it.
      setDebouncedQ('');
      setReloadKey((n) => n + 1);
      return;
    }
    setLoading(true);
    fetchHistory({});
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 font-sora">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">{isMainCompany ? 'Transfer History' : 'Order History'}</h1>
      <p className="text-stone-500 mb-5">
        {isMainCompany
          ? 'View and track all warehouse transfer records in one place.'
          : 'Every order, transfer and shipment — searchable in one place.'}
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {isMainCompany ? (
          <>
            <StatCard label="Total Transfers" value={transferTotals.total} />
            <StatCard label="In Transit" value={transferTotals.inTransit} />
            <StatCard label="Received / Completed" value={transferTotals.received} />
            <StatCard label="Total Transfer Value" value={formatINR(transferTotals.value)} />
          </>
        ) : (
          <>
            <StatCard label="Records" value={totals.count} />
            <StatCard label="Seller orders" value={totals.byKind.seller || 0} />
            <StatCard label="Transfers" value={totals.byKind.transfer || 0} />
            <StatCard label="Total value" value={formatINR(totals.value)} />
          </>
        )}
      </div>

      {/* Filters */}
      <div className={`bg-white border border-stone-200 rounded-xl p-4 mb-5 grid grid-cols-1 sm:grid-cols-2 gap-3 ${isMainCompany ? 'lg:grid-cols-5' : 'lg:grid-cols-6'}`}>
        {/* Type filter — hidden for the Company transfer view (transfers only). */}
        {!isMainCompany && (
          <select className={inputCls} value={filters.type} onChange={set('type')}>
            <option value="">All types</option>
            <option value="seller">Seller orders</option>
            <option value="transfer">Transfers</option>
            <option value="shipment">Shipments</option>
          </select>
        )}
        <select className={inputCls} value={filters.status} onChange={set('status')}>
          <option value="">All statuses</option>
          {/* Company: the two summary buckets, explicitly labelled. Every other
              role keeps the original raw order statuses, unchanged. */}
          {isMainCompany
            ? MAIN_COMPANY_STATUS_FILTERS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))
            : ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
        </select>
        <select className={inputCls} value={filters.warehouseId} onChange={set('warehouseId')}>
          <option value="">All warehouses</option>
          {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
        </select>
        <input type="date" className={inputCls} value={filters.from} onChange={set('from')} title="From" />
        <input type="date" className={inputCls} value={filters.to} onChange={set('to')} title="To" />
        <input className={inputCls} placeholder={isMainCompany ? 'Search ref / item / lot / warehouse…' : 'Search ref / party…'} value={filters.q} onChange={set('q')} />
      </div>
      {dateError && (
        <p className="text-xs font-semibold text-[#EA2831] mb-2" role="alert">{dateError}</p>
      )}
      <div className="flex items-center gap-2 mb-5">
        {/* Apply filters — ORDER HISTORY ONLY. Transfer History applies each
            change as it is made, so the button has nothing left to do there. */}
        {!isMainCompany && (
          <button onClick={load} className="inline-flex items-center gap-2 bg-[#EA2831] hover:bg-[#c91e26] text-white text-sm font-bold rounded-lg px-5 py-2.5 transition-colors">
            <span className="material-symbols-outlined text-base">search</span> Apply filters
          </button>
        )}
        <button onClick={clear}
          className="inline-flex items-center gap-1.5 border border-stone-200 hover:bg-stone-50 text-stone-700 text-sm font-bold rounded-lg px-4 py-2.5 transition-colors">
          Clear
        </button>
        {isMainCompany && loading && (
          <span className="text-[11px] font-bold uppercase tracking-wider text-stone-400">Filtering…</span>
        )}
      </div>

      {/* Record count (Company) — the list is never silently truncated */}
      {isMainCompany && !loading && (
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-2">
          Showing {rangeStart}–{rangeEnd} of {transferRows.length} transfers
        </p>
      )}

      {/* Table */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[980px] resp-table">
          <thead>
            <tr className="border-b border-stone-200">
              {['Ref', 'Type', 'From', 'To', 'Item', 'Lot No.', 'Qty', 'Status', 'MRP', 'Date', isMainCompany ? 'Actions' : ''].map((h, i) => (
                <th key={i} className="px-5 py-3.5 text-[10px] font-bold text-stone-400 uppercase tracking-widest">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-5 py-10 text-center text-stone-400">Loading…</td></tr>
            ) : displayRows.length === 0 ? (
              <tr><td colSpan={11} className="px-5 py-10 text-center text-stone-400">{isMainCompany ? 'No transfers match your filters yet.' : 'No history matches your filters yet.'}</td></tr>
            ) : displayRows.map((r) => (
              <React.Fragment key={`${r.kind}-${r.id}`}>
                <tr className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                  <td data-label="Ref" className="px-5 py-3.5 font-bold text-stone-800 text-sm">{r.ref}</td>
                  <td data-label="Type" className="px-5 py-3.5"><span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${KIND_STYLE[r.kind]}`}>{kindLabel(r)}</span></td>
                  <td data-label="From" className="px-5 py-3.5 text-sm text-stone-600">{r.from || '—'}</td>
                  <td data-label="To" className="px-5 py-3.5 text-sm text-stone-600">{r.to || r.party || '—'}</td>
                  <td data-label="Item" className="px-5 py-3.5 text-sm text-stone-600">{r.itemName || '—'}</td>
                  <td data-label="Lot No." className="px-5 py-3.5 text-sm text-stone-600">{r.lotNo || '—'}</td>
                  <td data-label="Qty" className="px-5 py-3.5 text-sm text-stone-600">{r.units || '—'}</td>
                  <td data-label="Status" className="px-5 py-3.5"><span className={`text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${STATUS_STYLE(r.status)}`}>{r.status}</span></td>
                  <td data-label="Value" className="px-5 py-3.5 text-sm font-semibold text-stone-800">{r.total ? formatINR(r.total) : '—'}</td>
                  <td data-label="Date" className="px-5 py-3.5 text-sm text-stone-500">{fmtDate(r.date)}</td>
                  <td data-label="Actions" className="px-5 py-3.5 text-right cell-actions">
                    <div className="inline-flex items-center gap-2">
                      {/* VIEW — read-only Transfer Details. Only a warehouse→
                          warehouse transfer has one; every other row keeps the
                          expand-only behaviour it already had. stopPropagation
                          so the click navigates instead of toggling the row. */}
                      {isMainCompany && isViewableTransfer(r) && (
                        <Link
                          to={`/order-history/transfer/${r.id}`}
                          onClick={(e) => e.stopPropagation()}
                          title="View transfer details"
                          className="inline-flex items-center gap-1 text-[11px] font-bold border border-stone-200 hover:border-[#EA2831] hover:text-[#EA2831] text-stone-600 rounded-lg px-2.5 py-1.5 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[15px]">visibility</span> View
                        </Link>
                      )}
                      {/* <span className={`material-symbols-outlined text-stone-300 transition-transform ${expanded === r.id ? 'rotate-180' : ''}`}>expand_more</span> */}
                    </div>
                  </td>
                </tr>
                {/* {expanded === r.id && (
                  <tr className="bg-stone-50/60">
                    <td colSpan={11} className="px-5 py-4">
                      <Timeline row={r} />
                    </td>
                  </tr>
                )} */}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination (Company) */}
      {isMainCompany && !loading && transferRows.length > 0 && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
            Showing {rangeStart}–{rangeEnd} of {transferRows.length} transfers
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((n) => Math.max(1, n - 1))}
              disabled={currentPage <= 1}
              className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-base">chevron_left</span> Previous
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setPage(n)}
                className={`min-w-[36px] text-xs font-bold px-3 py-2 rounded-lg border transition-colors ${
                  n === currentPage
                    ? 'bg-[#EA2831] border-[#EA2831] text-white'
                    : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                }`}
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => setPage((n) => Math.min(totalPages, n + 1))}
              disabled={currentPage >= totalPages}
              className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next <span className="material-symbols-outlined text-base">chevron_right</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const Timeline = ({ row }) => {
  // Seller orders carry the canonical 5-step timeline; shipments carry their
  // own statusHistory; transfers have no sub-steps.
  if (row.timeline && row.timeline.length && row.timeline[0].step) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {row.timeline.map((t, i) => (
          <React.Fragment key={i}>
            <div className={`flex items-center gap-1.5 text-xs font-semibold ${t.done === false ? 'text-stone-300' : 'text-stone-700'}`}>
              <span className={`h-2 w-2 rounded-full ${t.done === false ? 'bg-stone-300' : 'bg-[#EA2831]'}`} />
              <span className="capitalize">{t.step}{t.at ? ` · ${fmtDate(t.at)}` : ''}</span>
            </div>
            {i < row.timeline.length - 1 && <span className="text-stone-300">→</span>}
          </React.Fragment>
        ))}
      </div>
    );
  }
  return <p className="text-sm text-stone-400">No detailed timeline for this record.</p>;
};

export default OrderHistory;
