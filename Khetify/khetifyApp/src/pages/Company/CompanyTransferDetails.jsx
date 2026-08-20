import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getShipmentDetails, formatINR } from '../../lib/imsApi';
import BackButton from '../../Components/BackButton';
import { StatusPill } from '../../Components/ims/LotPackagingPanel';
import Barcode from '../../lib/barcode';

// COMPANY TRANSFER DETAILS — READ-ONLY view of ONE warehouse→warehouse transfer,
// reached from Company → Transfer History → View.
//
// Serves the MAIN COMPANY's history (pages/Company/OrderHistory.jsx). The
// warehouse's own history has its own, separate detail page
// (WarehouseTransferDetail.jsx) and is deliberately left untouched — the two
// answer different questions for different audiences.
//
// NO NEW BUSINESS LOGIC AND NO NEW ENDPOINT: everything below is a projection of
// GET /shipments/:id/details, the same read-only payload the warehouse page
// already consumes. Company scoping and warehouse scoping are enforced there, so
// this page can never widen what the session may see.
//
// Sections, in the order the spec asks for them:
//   1. Transfer Summary   2. Product Details   3. Packaging Details
//   4. Barcode            5. Timeline
//
// THIS PAGE WRITES NOTHING — no edit, delete, receive or transfer control, and it
// calls no mutating endpoint.

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const titleCase = (s) => String(s || '').replace(/_/g, ' ');

const Detail = ({ label, value, mono = false }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
    <p className={`text-sm text-stone-800 font-medium break-words ${mono ? 'font-mono text-xs' : ''}`}>
      {value === null || value === undefined || value === '' ? '—' : value}
    </p>
  </div>
);

const Card = ({ title, subtitle, children, right }) => (
  <section className="border border-stone-200 rounded-2xl bg-white shadow-sm overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-stone-100 bg-stone-50/60">
      <div>
        <h2 className="text-sm font-bold text-stone-800">{title}</h2>
        {subtitle && <p className="text-[11px] text-stone-400">{subtitle}</p>}
      </div>
      {right}
    </div>
    <div className="p-5">{children}</div>
  </section>
);

const StatusChip = ({ status }) => (
  <span className="inline-block mt-0.5 text-[11px] font-bold rounded-full px-2.5 py-1 bg-stone-100 text-stone-600 capitalize">
    {titleCase(status) || '—'}
  </span>
);

/**
 * The canonical transfer pipeline, in order. A step is DONE when the shipment's
 * own statusHistory recorded it — the dates are real events, never inferred.
 * `matches` maps the several stored statuses that mean the same milestone
 * (dispatched and in_transit are both "In Transit"; a partial receipt is still
 * a receipt) onto the five steps the spec asks for.
 */
const PIPELINE = [
  { key: 'planned', label: 'Planned', matches: ['planned', 'draft'] },
  { key: 'approved', label: 'Approved', matches: ['approved', 'picking', 'picked', 'packed', 'loading'] },
  { key: 'in_transit', label: 'In Transit', matches: ['dispatched', 'in_transit'] },
  { key: 'verifying', label: 'Verifying', matches: ['arrived', 'verifying'] },
  { key: 'received', label: 'Received', matches: ['received', 'partially_received', 'delivered'] },
];

/** Build the 5-step timeline from the shipment's real status history. */
function buildPipeline(timeline) {
  const events = timeline || [];
  return PIPELINE.map((step) => {
    const hit = events.find((e) => step.matches.includes(e.status));
    return { ...step, at: hit?.at || null, done: !!hit, actual: hit?.status || null };
  });
}

/** Section 3 rows: one per Bulk Packaging ID this transfer drew units from. */
function boxRows(parentLots) {
  return (parentLots || []).flatMap((lot) =>
    (lot.bulkPackages || []).map((b) => ({
      bulkPackagingId: b.bulkPackagingId,
      boxSerial: b.boxSerial,
      lotNumber: lot.lotNumber,
      unitsInBox: b.unitsInBox,
      transferred: (b.unitCodes || []).length,
      status: b.status,
      unitCodes: b.unitCodes || [],
    }))
  );
}

const CompanyTransferDetails = () => {
  const { id } = useParams();
  const [raw, setRaw] = useState(null);
  const [err, setErr] = useState('');
  const [loadedFor, setLoadedFor] = useState(null);
  const [openBox, setOpenBox] = useState(null);
  const loading = loadedFor !== id;

  useEffect(() => {
    let cancelled = false;
    getShipmentDetails(id)
      .then((r) => {
        if (cancelled) return;
        setRaw(r?.data || null); setErr(''); setLoadedFor(id);
      })
      .catch((e) => {
        if (cancelled) return;
        setRaw(null);
        setErr(e?.response?.data?.message || 'Could not load this transfer.');
        setLoadedFor(id);
      });
    return () => { cancelled = true; };
  }, [id]);

  const summary = raw?.summary || {};
  const parentLots = useMemo(() => raw?.parentLots || [], [raw]);
  const steps = useMemo(() => buildPipeline(raw?.timeline), [raw]);
  const boxes = useMemo(() => boxRows(parentLots), [parentLots]);
  // Units this transfer moved that were NOT packed into a box (single-package
  // lots, or labels minted before the lot was packed).
  const looseUnits = useMemo(
    () => parentLots.flatMap((l) => (l.looseUnitCodes || []).map((code) => ({ code, lotNumber: l.lotNumber }))),
    [parentLots]
  );

  if (loading) return <div className="w-full px-3 sm:px-5 py-6 font-sora"><BackButton to="/order-history" label="Back to Transfer History" /><p className="mt-6 text-sm text-stone-400">Loading…</p></div>;
  if (err) return <div className="w-full px-3 sm:px-5 py-6 font-sora"><BackButton to="/order-history" label="Back to Transfer History" /><p className="mt-6 text-sm text-stone-500">{err}</p></div>;
  if (!raw) return <div className="w-full px-3 sm:px-5 py-6 font-sora"><BackButton to="/order-history" label="Back to Transfer History" /><p className="mt-6 text-sm text-stone-500">This transfer could not be loaded.</p></div>;

  return (
    <div className="w-full px-3 sm:px-5 py-6 font-sora space-y-4">
      <BackButton to="/order-history" label="Back to Transfer History" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 mb-1">Transfer {summary.ref}</h1>
          <p className="text-stone-500">{summary.source} → {summary.destination}</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 border border-stone-200 rounded-full px-3 py-1">
          Read-only
        </span>
      </div>

      {/* ── 1 · TRANSFER SUMMARY ─────────────────────────────────────────────── */}
      <Card title="Transfer Summary">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
          <Detail label="Transfer Reference No." value={summary.ref} mono />
          <Detail label="Transfer Type" value="Warehouse → Warehouse" />
          <Detail label="From Warehouse" value={summary.source} />
          <Detail label="To Warehouse" value={summary.destination} />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Transfer Status</p>
            <StatusChip status={summary.status} />
          </div>
          <Detail label="Transfer Date" value={fmtDateTime(summary.createdAt)} />
          <Detail label="Dispatch Date" value={fmtDateTime(summary.dispatchedAt)} />
          <Detail label="Receive Date" value={fmtDateTime(summary.receivedAt)} />
          <Detail label="Approved By" value={summary.approvedBy} />
          <Detail label="Received By" value={summary.receivedBy} />
          <Detail label="Total Quantity" value={num(summary.quantity)} />
          {summary.value != null && <Detail label="Total Value" value={formatINR(summary.value)} />}
        </div>

        {/* Shipment status timeline — the raw recorded steps, in order. */}
        {/* <div className="mt-5 pt-4 border-t border-stone-100">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">Shipment Status Timeline</p>
          {(raw.timeline || []).length === 0 ? (
            <p className="text-sm text-stone-400">No status history recorded for this transfer.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {raw.timeline.map((t, i) => (
                <React.Fragment key={`${t.status}-${i}`}>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
                    <span className="h-2 w-2 rounded-full bg-[#EA2831]" />
                    <span className="capitalize">{titleCase(t.status)}</span>
                    <span className="text-stone-400 font-normal">{fmtDateTime(t.at)}</span>
                  </div>
                  {i < raw.timeline.length - 1 && <span className="text-stone-300">→</span>}
                </React.Fragment>
              ))}
            </div>
          )}
        </div> */}
      </Card>

      {/* ── 2 · PRODUCT DETAILS ──────────────────────────────────────────────────
          One block per lot on the transfer — a transfer may move several. */}
      <Card
        title="Product Details"
        right={parentLots.length > 1 ? <span className="text-[11px] text-stone-400">{parentLots.length} lots</span> : null}
      >
        {parentLots.length === 0 ? (
          <p className="text-sm text-stone-400">No product lines recorded for this transfer.</p>
        ) : (
          <div className="space-y-4">
            {parentLots.map((l, i) => (
              <div key={`${l.lotNumber}-${i}`} className={i > 0 ? 'pt-4 border-t border-stone-100' : ''}>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
                  <Detail label="Product Name" value={l.productName} />
                  {/* <Detail label="Product Code" value={l.productCode} mono /> */}
                  <Detail label="Category" value={l.category} />
                  <Detail label="Lot Number" value={l.lotNumber} mono />
                  <Detail label="Batch Number" value={l.mfgBatchNo || l.batchNumber} mono />
                  <Detail label="MRP" value={l.mrp == null ? null : formatINR(l.mrp)} />
                  <Detail label="Manufacturing Date" value={fmtDate(l.mfgDate)} />
                  <Detail label="Expiry Date" value={fmtDate(l.expiryDate)} />
                  <Detail label="Quantity Transferred" value={num(l.allocatedQty)} />
                  {l.receivedQty != null && <Detail label="Quantity Received" value={num(l.receivedQty)} />}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── 3 · PACKAGING DETAILS ────────────────────────────────────────────────
          Data-driven, exactly like the transfer itself: boxes when the transfer
          moved Bulk Packaging IDs, unit codes when it moved individual units,
          both for a mixed transfer, and the lot fallback when neither was
          labelled. Each list carries ONLY what THIS transfer moved. */}
      <Card
        title="Packaging Details"
        subtitle={boxes.length ? 'Transferred using Bulk Packaging IDs' : looseUnits.length ? 'Transferred using individual Units' : 'Transferred as a lot quantity'}
        right={boxes.length ? <span className="text-[11px] text-stone-400">{boxes.length} package(s)</span> : null}
      >
        {boxes.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[720px]">
              <thead>
                <tr className="border-b border-stone-200">
                  {['Bulk Packaging ID', 'Lot No.', 'Qty Transferred', 'Current Status', ''].map((h, i) => (
                    <th key={i} className="px-3 py-2.5 text-[10px] font-bold text-stone-400 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {boxes.map((b) => (
                  <React.Fragment key={b.bulkPackagingId}>
                    <tr className="border-b border-stone-100">
                      <td className="px-3 py-3 font-mono text-xs text-stone-800 break-all">{b.bulkPackagingId}</td>
                      <td className="px-3 py-3 font-mono text-xs text-stone-500 break-all">{b.lotNumber}</td>
                      {/* <td className="px-3 py-3 text-sm text-stone-600">{b.unitsInBox == null ? '—' : num(b.unitsInBox)}</td> */}
                      <td className="px-3 py-3 text-sm font-semibold text-stone-800">{num(b.transferred)}</td>
                      <td className="px-3 py-3"><StatusPill status={b.status} /></td>
                      <td className="px-3 py-3 text-right">
                        {b.unitCodes.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setOpenBox(openBox === b.bulkPackagingId ? null : b.bulkPackagingId)}
                            className="text-[11px] font-bold text-stone-500 hover:text-[#EA2831] transition-colors"
                          >
                            {openBox === b.bulkPackagingId ? 'Hide' : 'Show'} unit IDs
                          </button>
                        )}
                      </td>
                    </tr>
                    {openBox === b.bulkPackagingId && (
                      <tr className="bg-stone-50/60">
                        <td colSpan={6} className="px-3 py-3">
                          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
                            {b.unitCodes.map((code) => (
                              <li key={code} className="text-[11px] font-mono text-stone-700 break-all border-b border-dashed border-stone-200 py-1">{code}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {looseUnits.length > 0 && (
          <div className={boxes.length ? 'mt-5 pt-4 border-t border-stone-100' : ''}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">
              Unit IDs {boxes.length ? '(not in a package)' : ''} · {num(looseUnits.length)} unit(s)
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
              {looseUnits.map((u) => (
                <li key={u.code} className="text-[11px] font-mono text-stone-700 break-all border-b border-dashed border-stone-100 py-1">{u.code}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Neither boxes nor unit codes: a non-serialised lot transfer. The lot
            lines in Product Details above ARE the transfer detail, so restate the
            quantities here rather than showing an empty section. */}
        {boxes.length === 0 && looseUnits.length === 0 && (
          parentLots.length === 0 ? (
            <p className="text-sm text-stone-400">No packaging detail recorded for this transfer.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-[11px] text-stone-400">
                This transfer moved lot quantities — no Bulk Packaging IDs or unit labels were recorded against it.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
                {parentLots.map((l, i) => (
                  <Detail
                    key={`${l.lotNumber}-${i}`}
                    label={`Lot ${l.lotNumber}`}
                    value={`${num(l.allocatedQty)} unit(s)${l.hasBulkPackaging && l.numberOfBoxes ? ` · lot packed in ${num(l.numberOfBoxes)} box(es)` : ''}`}
                  />
                ))}
              </div>
            </div>
          )
        )}
      </Card>

      {/* ── 4 · BARCODE ──────────────────────────────────────────────────────────
          The transfer reference, rendered locally as Code 39 by the same
          component the lot and box labels use. Display only — scanning to
          RECEIVE still goes through the manifest QR on the warehouse side. */}
      {/* {summary.ref && (
        <Card title="Barcode" subtitle="Transfer reference">
          <div className="max-w-sm">
            <Barcode value={summary.ref} height={56} />
            <p className="text-[11px] font-mono tracking-[0.15em] text-stone-700 mt-1 break-all">{summary.ref}</p>
          </div>
        </Card>
      )} */}

      {/* ── 5 · TIMELINE ─────────────────────────────────────────────────────────
          The five canonical milestones. A step with no recorded event is shown
          greyed with no date rather than invented. */}
      {/* <Card title="Timeline">
        <ol className="space-y-0">
          {steps.map((s, i) => (
            <li key={s.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={`h-2.5 w-2.5 rounded-full mt-1.5 ${s.done ? 'bg-[#EA2831]' : 'bg-stone-200'}`} />
                {i < steps.length - 1 && <span className={`w-px flex-1 ${s.done ? 'bg-[#EA2831]/30' : 'bg-stone-200'}`} />}
              </div>
              <div className={`pb-5 ${s.done ? '' : 'opacity-50'}`}>
                <p className="text-sm font-semibold text-stone-800">{s.label}</p>
                <p className="text-[11px] text-stone-400">
                  {s.done ? fmtDateTime(s.at) : 'Not reached'}
                  {s.done && s.actual && s.actual !== s.key && <span className="capitalize"> · {titleCase(s.actual)}</span>}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card> */}
    </div>
  );
};

export default CompanyTransferDetails;
