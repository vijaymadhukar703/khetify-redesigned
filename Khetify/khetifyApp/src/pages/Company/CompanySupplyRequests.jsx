import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { getSupplyOrders, updateSupplyStatus, getSupplySourceOptions } from '../../lib/imsApi';

import { usePermission } from '../../context/PermissionContext';
import { WAREHOUSE_ROLES } from '../../lib/roles';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);
// THE REQUEST'S SERIAL. Built from the request's own id, character for
// character the same way Seller Requests (ImsOutbound) and Shipment Tracking
// (tmsController.requestRef) build it — so one request reads as ONE number
// across every screen. Nothing new is generated here; the id already arrives in
// the API response, so no backend change was needed.
const requestSerialOf = (o) => (o?._id ? `SR-${String(o._id).slice(-6).toUpperCase()}` : '—');
const fmtNum = (n) => Number(n || 0).toLocaleString('en-IN');

const STATUS_STYLE = {
  requested: 'bg-amber-50 text-amber-700', under_review: 'bg-amber-50 text-amber-700',
  approved: 'bg-blue-50 text-blue-700', picking: 'bg-blue-50 text-blue-700', packed: 'bg-indigo-50 text-indigo-700',
  dispatched: 'bg-violet-50 text-violet-700', in_transit: 'bg-violet-50 text-violet-700', arrived: 'bg-violet-50 text-violet-700',
  partially_received: 'bg-amber-50 text-amber-700', received: 'bg-green-50 text-green-700',
  delivered: 'bg-green-50 text-green-700', rejected: 'bg-red-50 text-red-700', cancelled: 'bg-stone-100 text-stone-500',
};

// SUPPLY REQUESTS — incoming bulk-supply requests from the dealers this company
// supplies. Approving asks the company to ASSIGN A SOURCE WAREHOUSE, then runs
// the lot-accurate company → seller transfer (FEFO from that warehouse).
// Derived straight from the list payload — no extra API call and no new field.
// Quantity comes from the STRUCTURED items[].quantity, never parsed from text.
const totalQty = (o) => (o.items || []).reduce((s, it) => s + Number(it.quantity || 0), 0);
const itemNames = (o) => (o.items || []).map((it) => it.productId?.productName || 'Item').join(', ');
/** Parent lots this request was allocated from (items[].allocations[]). */
const parentLotsOf = (o) => [
  ...new Set((o.items || []).flatMap((it) => (it.allocations || []).map((a) => a.lotNumber || a.batchNumber).filter(Boolean))),
];

const PAGE_SIZE = 10; // Company Warehouse Supply Requests pagination

const CompanySupplyRequests = () => {
  const navigate = useNavigate();
  const { role } = usePermission();
  // The lot-aware view (Quantity, Source (Warehouse), Parent Lot No., View
  // Details, pagination, wider layout) is shown to BOTH the MAIN COMPANY and the
  // COMPANY WAREHOUSE. It is purely additive visibility — each role keeps its own
  // actions (the Company still approves/rejects/assigns via actionsFor). Every
  // other role keeps the original narrow list untouched.
  const isWarehouse = WAREHOUSE_ROLES.has(role);
  const isMainCompany = role === 'company_admin';
  const enhanced = isMainCompany || isWarehouse;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false); // plan lacks the supply workflow
  const [approving, setApproving] = useState(null); // the order whose source-warehouse modal is open
  const [page, setPage] = useState(1); // Company Warehouse pagination (1-based)

  const load = useCallback(() => {
    getSupplyOrders()
      // Back to page 1 whenever the list is (re)loaded — e.g. after an approve
      // or reject changes what's in it.
      .then((r) => { setRows(listOf(r)); setBlocked(false); setPage(1); })
      .catch((e) => {
        if (e?.response?.status === 403) setBlocked(true);
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (o, status, extra = {}) => {
    try { await updateSupplyStatus(o._id, { status, ...extra }); toast('success', `Marked ${status}`); load(); }
    catch (e) { toast('error', e?.response?.data?.message || 'Action failed'); }
  };

  const reject = async (o) => {
    const { isConfirmed } = await Swal.fire({ title: 'Reject this request?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'Reject' });
    if (isConfirmed) act(o, 'rejected');
  };

  // Pagination (Company Warehouse only) — over the FULL list the page holds, so
  // the counts always reflect every request, not just the visible page. This
  // page has no filters today; if any are added, filter first and paginate the
  // filtered result here, then reset `page` to 1 on change.
  const totalPages = enhanced ? Math.max(1, Math.ceil(rows.length / PAGE_SIZE)) : 1;
  const currentPage = Math.min(page, totalPages);
  const rangeStart = rows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, rows.length);
  const displayRows = enhanced ? rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) : rows;

  const actionsFor = (o) => {
    if (['requested', 'under_review'].includes(o.status)) {
      return (
        <div className="flex items-center gap-2">
          <button onClick={() => setApproving(o)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#EA2831] text-white hover:bg-red-600">Approve</button>
          <button onClick={() => reject(o)} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">Reject</button>
        </div>
      );
    }
    // Approval only AUTHORIZES and assigns the source — it moves no stock. The
    // order then flows through SEND STOCK: Operations picks (stock is reserved
    // there), packs and prints a shipping label, then dispatch creates the
    // shipment and commits the stock out. The SELLER scans the manifest to
    // receive. The order status mirrors the pipeline automatically.
    if (o.status === 'approved') return <span className="text-[11px] font-bold text-stone-500">Assigned — pick in Send Stock</span>;
    if (o.status === 'picking') return <span className="text-[11px] font-bold text-blue-600">Picking in Send Stock</span>;
    if (o.status === 'packed') return <span className="text-[11px] font-bold text-indigo-600">Packed — print label &amp; dispatch</span>;
    if (['dispatched', 'in_transit', 'arrived'].includes(o.status)) return <span className="text-[11px] font-bold text-violet-600">In transit — awaiting seller scan</span>;
    if (o.status === 'partially_received') return <span className="text-[11px] font-bold text-amber-600">Received with discrepancies</span>;
    if (['received', 'delivered'].includes(o.status)) return <span className="text-[11px] font-bold text-green-600">✓ Received &amp; verified</span>;
    return <span className="text-[11px] text-stone-400">—</span>;
  };

  return (
    // Company Warehouse gets the wider, lot-aware view; every other role keeps
    // the original centred layout.
    <div className={`font-sora py-6 ${enhanced ? 'w-full px-3 sm:px-5' : 'max-w-7xl mx-auto px-4 sm:px-8'}`}>
     
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Supply Requests</h1>
      <p className="text-stone-500 mb-5">Bulk-supply requests from the dealers you supply. Approving only authorizes the request and assigns a source warehouse — no stock moves. The warehouse reserves it at pick, then packs and dispatches it from Send Stock.</p>

      {blocked ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center max-w-xl mx-auto mt-8">
          <span className="material-symbols-outlined text-amber-500 text-4xl">workspace_premium</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Supply workflow is a premium feature</h2>
          <p className="text-sm text-amber-700 mt-1">Upgrade your plan to manage seller supply requests.</p>
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
          <table className={`w-full text-left border-collapse resp-table ${enhanced ? 'min-w-[1180px]' : 'min-w-[920px]'}`}>
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50/50">
                {(enhanced
                  ? ['Request Serial No.', 'Seller', 'Item', 'Quantity', 'Destination', 'Source (Warehouse)', 'Parent Lot No.', 'Status', 'View', 'Actions']
                  : ['Request Serial No.', 'Seller', 'Items', 'Destination', 'Source', 'Status', 'Actions']
                ).map((h) => (
                  <th key={h} className="px-5 py-3.5 text-[10px] font-bold text-stone-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr><td colSpan={enhanced ? 10 : 7} className="px-5 py-10 text-center text-stone-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={enhanced ? 10 : 7} className="px-5 py-10 text-center text-stone-400">No supply requests yet.</td></tr>
              ) : displayRows.map((o) => {
                const lots = parentLotsOf(o);
                return (
                  <tr key={o._id} className="hover:bg-stone-50/60">
                    <td data-label="Request Serial No." className="px-5 py-3.5 text-sm font-mono text-stone-600 whitespace-nowrap">{requestSerialOf(o)}</td>
                    <td data-label="Seller" className="px-5 py-3.5 font-bold text-stone-800 text-sm">{o.sellerId?.sellerInfo?.businessName || '—'}</td>
                    <td data-label={enhanced ? 'Item' : 'Items'} className="px-5 py-3.5 text-sm text-stone-600 max-w-[240px] truncate" title={itemNames(o)}>
                      {enhanced ? itemNames(o) : (o.items || []).map((it) => `${it.productId?.productName || 'Item'} ×${it.quantity}`).join(', ')}
                    </td>
                    {enhanced && (
                      <td data-label="Quantity" className="px-5 py-3.5 text-sm font-bold text-stone-800 tabular-nums">{totalQty(o).toLocaleString('en-IN')}</td>
                    )}
                    <td data-label="Destination" className="px-5 py-3.5 text-sm text-stone-600">{o.warehouseId?.name || '—'}</td>
                    <td data-label={enhanced ? 'Source (Warehouse)' : 'Source'} className="px-5 py-3.5 text-sm text-stone-600">{o.sourceWarehouseId?.name || '—'}</td>
                    {enhanced && (
                      <td data-label="Parent Lot No." className="px-5 py-3.5 text-sm text-stone-600 max-w-[220px] truncate" title={lots.join(', ')}>
                        {lots.length === 0
                          ? <span className="text-stone-400">Not assigned</span>
                          : <>
                              <span className="font-mono text-xs">{lots[0]}</span>
                              {lots.length > 1 && <span className="text-stone-400 text-xs"> +{lots.length - 1} more</span>}
                            </>}
                      </td>
                    )}
                    <td data-label="Status" className="px-5 py-3.5"><span className={`text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${STATUS_STYLE[o.status] || 'bg-stone-100 text-stone-500'}`}>{o.status?.replace('_', ' ')}</span></td>
                  
                    {enhanced && (
                      <td data-label="View" className="px-5 py-3.5">
                        <button
                          onClick={() => navigate(`/supply-requests/${o._id}`)}
                          className="inline-flex items-center gap-1 text-xs font-bold text-stone-600 hover:text-[#EA2831] transition-colors whitespace-nowrap"
                        >
                          <span className="material-symbols-outlined text-base">visibility</span> View Details
                        </button>
                      </td>
                    )}
                    <td data-label="Actions" className="px-5 py-3.5 cell-actions">{actionsFor(o)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination (Company Warehouse) — counts reflect the full list, never
          just the visible page. Nothing is hidden without these controls. */}
      {!blocked && enhanced && !loading && rows.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
            Showing {rangeStart}–{rangeEnd} of {rows.length} requests
          </p>
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-center gap-1">
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
          )}
        </div>
      )}

      {approving && (
        <SourceWarehouseModal
          order={approving}
          onClose={() => setApproving(null)}
          onConfirm={async (warehouseId) => {
            await act(approving, 'approved', { sourceWarehouseId: warehouseId });
            setApproving(null);
          }}
        />
      )}
    </div>
  );
};

// "Assign a source warehouse" — shows each company warehouse's AVAILABLE qty of
// the requested product(s), sorts fulfilling warehouses first, disables ones
// that can't cover the request, and only enables Approve for a fulfilling pick.
//
// WAREHOUSE ONLY. Approval decides WHERE the supply is fulfilled from, nothing
// more. WHICH lot / batch / boxes / units are used is the source warehouse
// manager's call, made at Pick, Pack and Dispatch in Send Stock — so this modal
// asks for no lot at all.
const SourceWarehouseModal = ({ order, onClose, onConfirm }) => {
  const [options, setOptions] = useState(null); // null = loading
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSupplySourceOptions(order._id)
      .then((r) => setOptions(listOf(r)))
      .catch(() => setOptions([]));
  }, [order._id]);

  const multi = (order.items || []).length > 1;
  const anyFulfills = (options || []).some((o) => o.canFulfill);
  const chosen = (options || []).find((o) => String(o.warehouseId) === String(selected));

  const confirm = async () => {
    if (!chosen?.canFulfill) return;
    setBusy(true);
    try { await onConfirm(selected); } catch { /* surfaced by caller */ } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 font-sora" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-200">
          <h3 className="font-bold text-stone-900">Assign a source warehouse</h3>
          <p className="text-xs text-stone-500 mt-0.5">Choose where this is fulfilled from. Approving moves no stock; the warehouse picks the lots and reserves it in Send Stock.</p>
        </div>

        <div className="p-4 overflow-y-auto space-y-2">
          {options === null && <p className="text-sm text-stone-400 text-center py-8">Checking availability…</p>}
          {options && options.length === 0 && <p className="text-sm text-stone-400 text-center py-8">No warehouses found. Add a warehouse first.</p>}

          {(options || []).map((w) => {
            const single = w.items[0];
            const disabled = !w.canFulfill;
            const isSel = String(selected) === String(w.warehouseId);
            return (
              <button
                key={w.warehouseId}
                type="button"
                disabled={disabled}
                onClick={() => setSelected(w.warehouseId)}
                className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                  disabled ? 'border-stone-200 bg-stone-50 opacity-60 cursor-not-allowed'
                    : isSel ? 'border-[#EA2831] bg-red-50/40'
                      : 'border-stone-200 hover:border-[#EA2831]/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm text-stone-800">
                    {w.name}{w.code ? <span className="text-stone-400 font-normal"> ({w.code})</span> : null}
                  </span>
                  {w.canFulfill
                    ? (!multi && <span className="text-xs font-bold text-green-600">{fmtNum(single.availableQty)} available</span>)
                    : <span className="text-[11px] font-bold text-red-500">Insufficient</span>}
                </div>
                {multi ? (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {w.items.map((it) => (
                      <span key={it.productId} className={`text-[11px] ${it.availableQty >= it.requiredQty ? 'text-stone-500' : 'text-red-500 font-bold'}`}>
                        {it.productName} {fmtNum(it.availableQty)}/{fmtNum(it.requiredQty)}
                      </span>
                    ))}
                  </div>
                ) : (
                  !w.canFulfill && <p className="mt-0.5 text-[11px] text-red-500">{fmtNum(single.availableQty)} available · needs {fmtNum(single.requiredQty)}</p>
                )}
              </button>
            );
          })}

          {options && options.length > 0 && !anyFulfills && (
            <p className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No single warehouse has enough stock for this request.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-200 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs font-bold px-4 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">Cancel</button>
          <button
            onClick={confirm}
            disabled={!chosen?.canFulfill || busy}
            className="text-xs font-bold px-4 py-2 rounded-lg bg-[#EA2831] text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Approving…' : 'Approve & assign'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CompanySupplyRequests;