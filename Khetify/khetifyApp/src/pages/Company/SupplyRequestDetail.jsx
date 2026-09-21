import React, { useEffect, useMemo, useState, Suspense, lazy } from 'react';
import { useParams } from 'react-router-dom';
import { getSupplyOrderDetails } from '../../lib/imsApi';
import BackButton from '../../Components/BackButton';
import { usePermission } from '../../context/PermissionContext';

const Barcode128 = lazy(() => import('../../lib/barcode128'));

// SUPPLY REQUEST DETAIL — read-only traceability for ONE request: what was
// asked for, which PARENT LOTS it was allocated from, and the EXACT child unit
// serials picked from each parent lot. Everything comes from the existing
// records (items[].allocations[] + UnitSerial/UnitEvent); this page writes
// nothing and changes no quantity or status.

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtNum = (n) => Number(n || 0).toLocaleString('en-IN');

const UNITS_PER_PAGE = 50;

const STATUS_STYLE = {
  requested: 'bg-amber-50 text-amber-700', under_review: 'bg-amber-50 text-amber-700',
  approved: 'bg-blue-50 text-blue-700', picking: 'bg-blue-50 text-blue-700', picked: 'bg-blue-50 text-blue-700',
  packing: 'bg-indigo-50 text-indigo-700', packed: 'bg-indigo-50 text-indigo-700',
  dispatched: 'bg-violet-50 text-violet-700', in_transit: 'bg-violet-50 text-violet-700', arrived: 'bg-violet-50 text-violet-700',
  partially_received: 'bg-amber-50 text-amber-700', received: 'bg-green-50 text-green-700',
  delivered: 'bg-green-50 text-green-700', rejected: 'bg-red-50 text-red-700', cancelled: 'bg-stone-100 text-stone-500',
};
const unitStatusStyle = (s) => {
  if (['in_stock', 'generated', 'printed'].includes(s)) return 'bg-stone-100 text-stone-600';
  if (['picked', 'packed'].includes(s)) return 'bg-blue-50 text-blue-700';
  if (s === 'shipped') return 'bg-violet-50 text-violet-700';
  if (['sold', 'returned'].includes(s)) return 'bg-green-50 text-green-700';
  return 'bg-stone-100 text-stone-600';
};

const Detail = ({ label, value }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
    <p className="text-sm text-stone-800 font-medium break-words">{value == null || value === '' ? '—' : value}</p>
  </div>
);

const Card = ({ title, subtitle, children }) => (
  <section className="bg-white border border-stone-200 rounded-xl p-4 sm:p-5">
    <h2 className="text-sm font-bold text-stone-900">{title}</h2>
    {subtitle && <p className="text-xs text-stone-500 mt-0.5 mb-3">{subtitle}</p>}
    <div className={subtitle ? '' : 'mt-3'}>{children}</div>
  </section>
);

const SupplyRequestDetail = () => {
  const { id } = useParams();
  const { role } = usePermission();
  // MAIN COMPANY view only. This detail page is shared — a Company Warehouse
  // role reaches the same route via inventory:read — so the field-hiding below
  // is gated on the role. Everyone else sees the page exactly as before.
  const isMainCompany = role === 'company_admin';
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    getSupplyOrderDetails(id)
      .then((r) => setD(r?.data || null))
      .catch((e) => setErr(e?.response?.data?.message || 'Could not load this request.'));
  }, [id]);

  if (err) {
    return (
      <div className="w-full px-3 sm:px-5 py-6 font-sora">
        <BackButton />
        <p className="mt-6 text-sm text-stone-500">{err}</p>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="w-full px-3 sm:px-5 py-6 font-sora">
        <BackButton />
        <p className="mt-6 text-sm text-stone-400">Loading…</p>
      </div>
    );
  }

  const s = d.summary || {};
  const lots = d.parentLots || [];

  return (
    <div className="w-full px-3 sm:px-5 py-6 font-sora space-y-4">
      <BackButton />
      <div>
        <h1 className="text-2xl font-bold text-stone-900 mb-1">Supply Request</h1>
        <p className="text-stone-500">
          {s.seller} · {(s.products || []).join(', ') || '—'}
        </p>
      </div>

      {/* 1 — Request summary */}
      <Card title="Request Summary">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
          <Detail label="Seller" value={s.seller} />
          <Detail label="Source Warehouse" value={s.sourceWarehouse} />
          <Detail label="Destination" value={s.destination} />
          <Detail label="Product" value={(s.products || []).join(', ')} />
          <Detail label="Requested Qty" value={fmtNum(s.requestedQty)} />
          {/* Approved / Picked / Dispatched Qty hidden for the Main Company view.
              Display-only — the values remain in the API response. */}
          {!isMainCompany && <Detail label="Approved Qty" value={fmtNum(s.approvedQty)} />}
          {!isMainCompany && <Detail label="Picked Qty" value={fmtNum(s.pickedQty)} />}
          {!isMainCompany && <Detail label="Dispatched Qty" value={fmtNum(s.dispatchedQty)} />}
          <Detail label="Received Qty" value={fmtNum(s.receivedQty)} />
          <Detail label="Request Date" value={fmtDate(s.requestDate)} />
          <Detail label="Transfer / Shipment Ref" value={s.shipmentRef} />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Current Status</p>
            <span className={`inline-block mt-0.5 text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${STATUS_STYLE[s.status] || 'bg-stone-100 text-stone-500'}`}>
              {String(s.status || '').replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      </Card>

      {/* 2 + 3 — Parent lots, each with the exact child units picked from it */}
      {lots.length === 0 ? (
        <Card title="Parent Lots" subtitle="No source lot has been assigned to this request yet.">
          <p className="text-sm text-stone-400">Not assigned — a source lot is chosen when the request is approved.</p>
        </Card>
      ) : lots.map((l, i) => <ParentLotCard key={i} lot={l} hideAllocation={isMainCompany} />)}

      {/* 4 — Timeline (only when the shipment carries a history). Hidden entirely
          for the Main Company view — no empty card is rendered. */}
      {!isMainCompany && (d.timeline || []).length > 0 && (
        <Card title="Timeline">
          <div className="flex flex-wrap items-center gap-2">
            {d.timeline.map((t, i) => (
              <React.Fragment key={i}>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
                  <span className="h-2 w-2 rounded-full bg-[#EA2831]" />
                  <span className="capitalize">{String(t.status || '').replace(/_/g, ' ')}</span>
                  <span className="text-stone-400 font-normal">{fmtDateTime(t.at)}</span>
                </div>
                {i < d.timeline.length - 1 && <span className="text-stone-300">→</span>}
              </React.Fragment>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

/** One parent lot + the exact child units transferred from it (searchable, paged).
 *  hideAllocation (Main Company view) drops the Product / Source Warehouse /
 *  Qty Allocated / Received Qty fields — the child-unit table is untouched. */
const ParentLotCard = ({ lot, hideAllocation = false }) => {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const units = useMemo(() => lot.units || [], [lot.units]);
  const filtered = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return needle ? units.filter((u) => String(u.serial).toUpperCase().includes(needle)) : units;
  }, [units, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / UNITS_PER_PAGE));
  const current = Math.min(page, totalPages);
  const start = filtered.length === 0 ? 0 : (current - 1) * UNITS_PER_PAGE + 1;
  const end = Math.min(current * UNITS_PER_PAGE, filtered.length);
  const paged = filtered.slice((current - 1) * UNITS_PER_PAGE, current * UNITS_PER_PAGE);

  return (
    <Card title={`Parent Lot · ${lot.lotNumber}`}>
      {/* ── LOT SUMMARY ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3 mb-4">
        <Detail label="Lot Number" value={<span className="font-mono text-xs">{lot.lotNumber}</span>} />
        <Detail label="Batch No." value={lot.mfgBatchNo} />
        {!hideAllocation && <Detail label="Product" value={lot.productName} />}
        {!hideAllocation && <Detail label="Source Warehouse" value={lot.sourceWarehouse} />}
        {!hideAllocation && <Detail label="Qty Allocated" value={fmtNum(lot.allocatedQty)} />}
        {!hideAllocation && <Detail label="Received Qty" value={lot.receivedQty == null ? '—' : fmtNum(lot.receivedQty)} />}
        {lot.mrp != null && <Detail label="MRP" value={`₹${lot.mrp}`} />}
        {lot.category && <Detail label="Category" value={lot.category} />}
        <Detail label="Manufacturing Date" value={fmtDate(lot.mfgDate)} />
        <Detail label="Expiry Date" value={fmtDate(lot.expiryDate)} />
        <Detail label="Transfer Status" value={<span className="capitalize">{String(lot.status || '').replace(/_/g, ' ')}</span>} />
        {lot.originalQty != null && <Detail label="Original Lot Qty" value={fmtNum(lot.originalQty)} />}
      </div>

      {/* ── PACKAGING SUMMARY ───────────────────────────────── */}
      {(lot.packagingType || lot.unitLabelCount > 0) && (
        <div className="border-t border-stone-100 pt-3 mb-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">Packaging Summary</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
            {lot.packagingType && <Detail label="Packaging" value={lot.packagingType} />}
            {lot.unitLabelCount > 0 && <Detail label="Unit Labels" value={fmtNum(lot.unitLabelCount)} />}
          </div>
        </div>
      )}

      {/* ── LOT BARCODE ─────────────────────────────────────── */}
      <div className="border-t border-stone-100 pt-3 mb-4 flex justify-center">
        <div className="text-center">
          <Suspense fallback={<div className="h-12 w-64 bg-stone-100 rounded animate-pulse" />}>
            <Barcode128 value={lot.lotNumber} height={52} className="w-64" />
          </Suspense>
          <p className="text-[11px] font-mono text-stone-500 mt-1 break-all">{lot.lotNumber}</p>
        </div>
      </div>

      {/* ── CHILD UNITS ─────────────────────────────────────── */}
      <div className="border-t border-stone-100 pt-3">
        {units.length === 0 ? (
          <p className="text-sm text-stone-400">
            {lot.trackSerial
              ? 'This product is serial-tracked, but this lot was picked by quantity only — no unit-level barcodes were scanned, so none are recorded here.'
              : "This product isn't serial-tracked, so it has no individual unit barcodes to show."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <p className="text-xs font-bold text-stone-700">
                This transfer used these child units from this parent lot.
              </p>
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                placeholder="Search serial…"
                className="text-xs border border-stone-200 rounded-lg px-3 py-1.5 bg-white min-w-[180px]"
              />
            </div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-2">
              Showing {start}–{end} of {filtered.length} child units
            </p>

            <div className="overflow-x-auto">
              <table className={`w-full text-left border-collapse ${hideAllocation ? 'min-w-[720px]' : 'min-w-[820px]'}`}>
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200">
                    {/* Received At column dropped for the Main Company view — the
                        u.receivedAt data is untouched, just not shown. */}
                    {['Child Serial', 'Parent Lot No.', 'Status', 'Picked At', 'Dispatched At', ...(hideAllocation ? [] : ['Received At']), 'Owner'].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-[10px] font-bold text-stone-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {paged.map((u) => (
                    <tr key={u.serial} className="hover:bg-stone-50/60">
                      <td className="px-4 py-2.5 font-mono text-xs text-stone-800">{u.serial}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-stone-500">{u.lotNumber || lot.lotNumber}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 capitalize ${unitStatusStyle(u.status)}`}>
                          {String(u.status || '').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{fmtDateTime(u.pickedAt)}</td>
                      <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{fmtDateTime(u.dispatchedAt)}</td>
                      {!hideAllocation && <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{fmtDateTime(u.receivedAt)}</td>}
                      <td className="px-4 py-2.5 text-xs text-stone-500 capitalize">{u.owner || '—'}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={hideAllocation ? 6 : 7} className="px-4 py-6 text-center text-sm text-stone-400">No serial matches that search.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-end gap-1 mt-3">
                <button
                  onClick={() => setPage((n) => Math.max(1, n - 1))}
                  disabled={current <= 1}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >Previous</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`min-w-[32px] text-xs font-bold px-2.5 py-1.5 rounded-lg border transition-colors ${
                      n === current ? 'bg-[#EA2831] border-[#EA2831] text-white' : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                    }`}
                  >{n}</button>
                ))}
                <button
                  onClick={() => setPage((n) => Math.min(totalPages, n + 1))}
                  disabled={current >= totalPages}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
};

export default SupplyRequestDetail;