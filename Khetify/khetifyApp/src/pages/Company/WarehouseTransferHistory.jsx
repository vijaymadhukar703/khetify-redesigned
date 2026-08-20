import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOrderHistory, getWarehouses, formatINR } from '../../lib/imsApi';
import { StatCard, inputCls } from './ims/ImsUi';
import { movementKind } from '../../lib/movementLabel';
import { usePermission } from '../../context/PermissionContext';

// WAREHOUSE TRANSFER HISTORY — a Company-Warehouse-only, READ-ONLY view of the
// movements THIS warehouse took part in, as source (Outgoing) or destination
// (Incoming). It reuses the SAME API as the Company Transfer History
// (GET /api/orders/history); the backend enforces the warehouse scope from the
// session (services/warehouseScope.js), so this page can never widen it — the
// client-side filters below are convenience only.
//
// The main Company Transfer History (pages/Company/OrderHistory.jsx) is a
// separate component and is completely untouched.

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const PAGE_SIZE = 10;

const STATUS_STYLE = (s) => {
  if (['delivered', 'received', 'fulfilled'].includes(s)) return 'bg-green-50 text-green-700';
  if (['cancelled', 'rejected', 'exception', 'returned'].includes(s)) return 'bg-red-50 text-red-700';
  if (['pending', 'requested', 'draft', 'planned'].includes(s)) return 'bg-stone-100 text-stone-600';
  return 'bg-yellow-50 text-yellow-700';
};
// Movements still on the road / not yet received.
const RECEIVED = new Set(['received', 'delivered', 'fulfilled', 'partially_received']);
const CLOSED = new Set(['cancelled', 'rejected', 'exception', 'returned']);

const WarehouseTransferHistory = () => {
  const { warehouseIds, loading: permLoading } = usePermission(); // the warehouse(s) this user works
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState([]);
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ direction: '', status: '', counterparty: '', from: '', to: '', q: '' });

  useEffect(() => {
    // NB: do NOT pass `type: 'transfer'` — that selects only the TransferRequest
    // model, while real warehouse-to-warehouse movements are SHIPMENTS
    // (createTmsShipment). `scope: 'warehouse'` asks the backend for exactly the
    // movements this warehouse took part in (source OR destination) and makes it
    // deny-by-default when the account has no warehouse assigned. Customer/seller
    // orders are skipped server-side for a scoped caller.
    //
    // `excludeRequests` drops the TR-* TransferRequest rows: a request is the
    // authorisation for a move, and the move itself is the SH-* shipment raised
    // when the request is fulfilled. Listing both showed one physical transfer
    // twice and double-counted its value in the cards. Requests remain visible
    // in Operations → Shipment Tracking & Transfers → Requests.
    getOrderHistory({ scope: 'warehouse', excludeRequests: 1 })
      .then((r) => setRows(r?.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
    getWarehouses().then((r) => setWarehouses(r?.data || r || [])).catch(() => {});
  }, []);

  const mine = useMemo(() => (warehouseIds || []).map(String), [warehouseIds]);
  // Without an assigned warehouse there is no "my warehouse" to report on — the
  // backend returns nothing for this view, so say why instead of showing zeros.
  const unassigned = !permLoading && mine.length === 0;
  const isMine = (id) => !!id && mine.includes(String(id));
  /** Outgoing when MY warehouse is the source; Incoming when it's the destination. */
  const directionOf = (r) => {
    if (isMine(r.fromWarehouseId)) return 'Outgoing';
    if (isMine(r.toWarehouseId)) return 'Incoming';
    return '—';
  };

  // Filters compose; the summary + pagination both read from this filtered set.
  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return rows.filter((r) => {
      const dir = directionOf(r);
      if (f.direction && dir !== f.direction) return false;
      if (f.status && r.status !== f.status) return false;
      if (f.counterparty) {
        const other = dir === 'Outgoing' ? r.toWarehouseId : r.fromWarehouseId;
        if (String(other || '') !== String(f.counterparty)) return false;
      }
      if (f.from && new Date(r.date) < new Date(f.from)) return false;
      if (f.to && new Date(r.date) > new Date(f.to)) return false;
      if (q && !`${r.ref} ${r.itemName} ${r.lotNo} ${r.from} ${r.to}`.toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, f, mine]);

  // Cards read the FULL filtered dataset, never the current page.
  const cards = useMemo(() => ({
    total: filtered.length,
    outgoing: filtered.filter((r) => directionOf(r) === 'Outgoing').length,
    incoming: filtered.filter((r) => directionOf(r) === 'Incoming').length,
    inTransit: filtered.filter((r) => !RECEIVED.has(r.status) && !CLOSED.has(r.status)).length,
    received: filtered.filter((r) => RECEIVED.has(r.status)).length,
    value: filtered.reduce((s, r) => s + (r.total || 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [filtered, mine]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const start = filtered.length === 0 ? 0 : (current - 1) * PAGE_SIZE + 1;
  const end = Math.min(current * PAGE_SIZE, filtered.length);
  const paged = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  // Any filter/search change goes back to page 1.
  const set = (k) => (e) => { setF((p) => ({ ...p, [k]: e.target.value })); setPage(1); };
  const clear = () => { setF({ direction: '', status: '', counterparty: '', from: '', to: '', q: '' }); setPage(1); };

  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status).filter(Boolean))].sort(), [rows]);

  return (
    <div className="w-full px-3 sm:px-5 py-6 font-sora">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Transfer History</h1>
      <p className="text-stone-500 mb-5">View and track all transfers sent from or received by your warehouse.</p>

      {unassigned && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
          <span className="material-symbols-outlined text-amber-500">warehouse</span>
          <div>
            <p className="font-bold text-stone-900 text-sm">Your account isn&apos;t assigned to a warehouse yet</p>
            <p className="text-xs text-stone-500">Ask a company admin to assign your warehouse — this page then shows every transfer it sends or receives.</p>
          </div>
        </div>
      )}

      {/* Summary — full filtered dataset */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 sm:gap-4 mb-5">
        <StatCard label="Total Transfers" value={cards.total} />
        <StatCard label="Outgoing" value={cards.outgoing} />
        <StatCard label="Incoming" value={cards.incoming} />
        <StatCard label="In Transit" value={cards.inTransit} />
        <StatCard label="Received / Completed" value={cards.received} />
        <StatCard label="Total Transfer Value" value={formatINR(cards.value)} />
      </div>

      {/* Filters */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <select className={inputCls} value={f.direction} onChange={set('direction')}>
          <option value="">All Directions</option>
          <option value="Incoming">Incoming</option>
          <option value="Outgoing">Outgoing</option>
        </select>
        <select className={inputCls} value={f.status} onChange={set('status')}>
          <option value="">All Statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select className={inputCls} value={f.counterparty} onChange={set('counterparty')}>
          <option value="">All Warehouses</option>
          {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
        </select>
        <input type="date" className={inputCls} value={f.from} onChange={set('from')} title="From" />
        <input type="date" className={inputCls} value={f.to} onChange={set('to')} title="To" />
        <input className={inputCls} placeholder="Search ref / item / lot / warehouse…" value={f.q} onChange={set('q')} />
      </div>
      <div className="mb-4">
        <button onClick={clear} className="text-xs font-bold px-4 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">Clear filters</button>
      </div>

      {!loading && (
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-2">
          Showing {start}–{end} of {filtered.length} transfers
        </p>
      )}

      {/* List */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[1280px] resp-table">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50/50">
              {['Reference', 'Type', 'Direction', 'From', 'To', 'Item', 'Lot No.', 'Quantity', 'Status', 'MRP', 'Date', 'View'].map((h) => (
                <th key={h} className="px-5 py-3.5 text-[10px] font-bold text-stone-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {loading ? (
              <tr><td colSpan={12} className="px-5 py-10 text-center text-stone-400">Loading…</td></tr>
            ) : paged.length === 0 ? (
              <tr><td colSpan={12} className="px-5 py-10 text-center text-stone-400">No transfers involve your warehouse yet.</td></tr>
            ) : paged.map((r) => {
              const dir = directionOf(r);
              return (
              <tr key={`${r.kind}-${r.id}`} className="hover:bg-stone-50/60">
                <td data-label="Reference" className="px-5 py-3.5 font-bold text-stone-800 text-sm">{r.ref}</td>
                {/* Shared rule: warehouse→warehouse reads "Transfer", anything
                    to an outside party (e.g. a seller supply) reads "Sales". */}
                <td data-label="Type" className="px-5 py-3.5 text-sm text-stone-600">{movementKind(r) || 'Transfer'}</td>
                {/* Direction is relative to THIS warehouse: the same transfer is
                    Outgoing for its source and Incoming for its destination, so it
                    can only be resolved per-viewer. directionOf() compares the
                    row's warehouse IDs against the session's assigned warehouse(s)
                    — never names, which are neither unique nor stable. Same helper
                    the cards and the Direction filter already use, so the column
                    can never disagree with them. Colours match the Incoming/Outgoing
                    pills in Operations → Shipments. */}
                <td data-label="Direction" className="px-5 py-3.5">
                  <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${
                    dir === 'Outgoing' ? 'bg-orange-50 text-orange-600'
                    : dir === 'Incoming' ? 'bg-blue-50 text-blue-700'
                    : 'bg-stone-100 text-stone-500'
                  }`}>{dir}</span>
                </td>
                <td data-label="From" className="px-5 py-3.5 text-sm text-stone-600">{r.from || '—'}</td>
                <td data-label="To" className="px-5 py-3.5 text-sm text-stone-600">{r.to || r.party || '—'}</td>
                <td data-label="Item" className="px-5 py-3.5 text-sm text-stone-600 max-w-[200px] truncate" title={r.itemName}>{r.itemName || '—'}</td>
                {/* Heading reads "Lot No."; the value is still the parent/master
                    lot straight from the API (r.lotNo) — no mapping change. */}
                <td data-label="Lot No." className="px-5 py-3.5 text-xs font-mono text-stone-600 max-w-[200px] truncate" title={r.lotNo}>
                  {r.lotNo && r.lotNo !== '—' ? r.lotNo : <span className="text-stone-400 font-sans">Not assigned</span>}
                </td>
                <td data-label="Quantity" className="px-5 py-3.5 text-sm font-bold text-stone-800 tabular-nums">{Number(r.units || 0).toLocaleString('en-IN')}</td>
                <td data-label="Status" className="px-5 py-3.5"><span className={`text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${STATUS_STYLE(r.status)}`}>{String(r.status || '').replace(/_/g, ' ')}</span></td>
                {/* Heading reads "MRP"; same value/calculation as before (r.total). */}
                <td data-label="MRP" className="px-5 py-3.5 text-sm font-semibold text-stone-800">{r.total ? formatINR(r.total) : '—'}</td>
                <td data-label="Date" className="px-5 py-3.5 text-sm text-stone-500 whitespace-nowrap">{fmtDate(r.date)}</td>
                {/* VIEW — the ONLY action on this page, and it is read-only.
                    `kind` tells the detail page which record this row came from
                    so it can ask the right existing endpoint: a shipment row
                    (SH-*) resolves through /shipments/:id/details, a company
                    assignment (CW-*) through /lots/:id/details. No new backend.
                    Nothing here edits, deletes, transfers or receives. */}
                <td data-label="View" className="px-5 py-3.5">
                  <Link
                    to={`/warehouse/transfer-history/${r.id}?kind=${r.kind}`}
                    title="View transfer details"
                    className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 hover:text-[#EA2831] transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">visibility</span> View
                  </Link>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && filtered.length > 0 && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
            Showing {start}–{end} of {filtered.length} transfers
          </p>
          <div className="flex flex-wrap items-center justify-center gap-1">
            <button onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={current <= 1}
              className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed">
              <span className="material-symbols-outlined text-base">chevron_left</span> Previous
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <button key={n} onClick={() => setPage(n)}
                className={`min-w-[36px] text-xs font-bold px-3 py-2 rounded-lg border transition-colors ${
                  n === current ? 'bg-[#EA2831] border-[#EA2831] text-white' : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                }`}>{n}</button>
            ))}
            <button onClick={() => setPage((n) => Math.min(totalPages, n + 1))} disabled={current >= totalPages}
              className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed">
              Next <span className="material-symbols-outlined text-base">chevron_right</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WarehouseTransferHistory;
