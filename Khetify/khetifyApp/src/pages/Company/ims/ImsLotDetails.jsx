import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { getLotDetails, formatINR, fmtDate, expiryBadge } from '../../../lib/imsApi';
import { Th, GhostBtn } from './ImsUi';
import LotPackagingPanel from '../../../Components/ims/LotPackagingPanel';
import Barcode128 from '../../../lib/barcode128';

/**
 * LOT DETAILS — a dedicated, READ-ONLY page for ONE lot.
 *
 * This exists so the Inventory list can stay exactly as it is. Everything that
 * would otherwise crowd that table — the full lot summary, where the stock
 * actually sits, the packaging breakdown, every Bulk Packaging ID, the units
 * inside each box, and the movement history — lives here instead. Reached from
 * the list's Actions → View.
 *
 * Nothing on this page mutates anything: no transfer, no receive, no generate,
 * no print. One GET /lots/:id/details supplies the whole page.
 */

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2600, showConfirmButton: false });

const num = (n) => Number(n || 0).toLocaleString('en-IN');

/** One labelled read-only value. */
const Detail = ({ label, value, mono = false }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
    <p className={`text-sm text-stone-800 font-medium break-words ${mono ? 'font-mono' : ''}`}>
      {value === null || value === undefined || value === '' ? '—' : value}
    </p>
  </div>
);

const Section = ({ title, subtitle, children, right }) => (
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

const StatusPill = ({ status }) => {
  const s = String(status || '').toLowerCase();
  const cls =
    s === 'received' ? 'bg-green-50 text-green-700'
    : s === 'partially_received' ? 'bg-amber-50 text-amber-700'
    : s === 'cancelled' ? 'bg-red-50 text-red-600'
    : s === 'created' || s === 'pending' ? 'bg-stone-100 text-stone-600'
    : 'bg-stone-100 text-stone-600';
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${cls}`}>
      {s ? s.replace(/_/g, ' ') : '—'}
    </span>
  );
};

const ImsLotDetails = () => {
  const { lotId } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  // Which lot `d` was actually loaded for. Same marker pattern the Labels page
  // uses for its units: it doubles as the loading flag (nothing loaded for this
  // lot yet) and guarantees a stale response for a previous lot can never be
  // rendered against the current one.
  const [loadedFor, setLoadedFor] = useState(null);
  const loading = loadedFor !== lotId;

  useEffect(() => {
    let cancelled = false;
    getLotDetails(lotId)
      .then((r) => { if (!cancelled) { setD(r?.data || null); setLoadedFor(lotId); } })
      .catch((err) => {
        if (cancelled) return;
        toast('error', err?.response?.data?.message || err.message || 'Could not load this lot');
        setD(null);
        setLoadedFor(lotId);
      });
    return () => { cancelled = true; };
  }, [lotId]);

  if (loading) {
    return <div className="w-full px-3 sm:px-5 py-10 text-sm text-stone-400">Loading lot…</div>;
  }
  if (!d?.lot) {
    return (
      <div className="w-full px-3 sm:px-5 py-10">
        <p className="text-sm text-stone-500 mb-4">This lot could not be loaded.</p>
        <GhostBtn onClick={() => navigate('/inventory')}>Back to Inventory</GhostBtn>
      </div>
    );
  }

  const {
    lot, stockByWarehouse = [], packaging, bulkPackages = [], units = [], unitTotal,
    unitsTruncated, movements = [], lotOriginalQuantity = null,
    looseUnitGroups = [], looseUnitCodes = [],
  } = d;
  const p = lot.productId || {};
  const lotNo = lot.lotNumber || lot.batchNumber || '—';
  const badge = expiryBadge(lot.expiryDate);
  // THE LOT'S CREATED QUANTITY — a property of the lot, resolved by the backend
  // from the original allocations under its number. Deliberately NOT this row's
  // own figure and never the live unit count: a warehouse holding 3 units of a
  // 1,000-unit lot must still read 1,000.
  const originalQty = typeof lotOriginalQuantity === 'number'
    ? lotOriginalQuantity
    : (typeof lot.originalQuantity === 'number' ? lot.originalQuantity : null);
  // …and what THIS warehouse holds, as its own separate figure.
  const unitsHere = Number(lot.availableStock || 0) + Number(lot.inTransitStock || 0);

  // RECEIVING STATUS. A row this warehouse received by transfer carries no
  // stored status (only a Company → Warehouse allocation is booked as pending),
  // which is why it rendered as a dash. Derive the same answer the stored value
  // would give: anything still awaiting arrival is partial, otherwise it is all
  // here. The stored value always wins where it exists.
  const receivingStatus = lot.receiving_status
    || (Number(lot.inTransitStock || 0) > 0
      ? (Number(lot.availableStock || 0) > 0 ? 'partially_received' : 'pending')
      : (unitsHere > 0 ? 'received' : null));

  // Units grouped by their parent box, in box order. A unit knows its box from
  // bulk_packaging_record_id, set when it was minted.
  const unitsByBox = bulkPackages.map((box) => ({
    box,
    units: units.filter((u) => String(u.bulk_packaging_record_id) === String(box._id)),
  }));

  return (
    <div className="w-full px-3 sm:px-5 py-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="text-[11px] font-bold text-stone-400 hover:text-stone-700 inline-flex items-center gap-1 mb-1"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span> Back
          </button>
          <h1 className="text-2xl font-bold text-stone-900">Lot Details</h1>
          <p className="font-mono text-sm text-stone-500 break-all">{lotNo}</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 border border-stone-200 rounded-full px-3 py-1">
          Read-only
        </span>
      </div>

      {/* ── COMPLETE LOT SUMMARY ─────────────────────────────────────────── */}
      <Section title="Lot Summary">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
          <Detail label="Lot Number" value={lotNo} mono />
          <Detail label="Product" value={p.productName} />
          <Detail label="Product Code" value={p.product_code} mono />
          {/* <Detail label="SKU" value={p.skuNumber} mono /> */}
          {/* Two distinct numbers: what the LOT was created with, and what is
              on this warehouse's shelf. */}
          <Detail label="Original Lot Quantity" value={originalQty == null ? null : num(originalQty)} />
          <Detail label="Units at this Warehouse" value={num(unitsHere)} />
          <Detail label="Batch No." value={lot.mfgBatchNo} />
          <Detail label="Manufacturing Date" value={fmtDate(lot.mfgDate)} />
          <Detail
            label="Expiry Date"
            value={<span className={badge?.cls ? `${badge.cls} px-2 py-0.5 rounded-full text-xs font-bold` : ''}>{fmtDate(lot.expiryDate)}</span>}
          />
          <Detail label="Category" value={p.category} />
          {/* <Detail label="Unit" value={p.unit || p.unitType} /> */}
          <Detail label="MRP" value={p.mrp ? formatINR(p.mrp) : null} />
          <Detail label="Warehouse" value={lot.warehouseId?.name || 'Unassigned'} />
          <Detail label="Receiving Status" value={<StatusPill status={receivingStatus} />} />
          {/* <Detail label="Lot Origin" value={lot.lotOrigin} /> */}
          <Detail label="Low-stock Alert At" value={num(lot.lowStockThreshold)} />
          <Detail label="Created" value={fmtDate(lot.createdAt)} />
        </div>

        <div className="mt-5 flex justify-center">
          <div className="w-full max-w-xs text-center">
            <Barcode128 value={lotNo} height={48} width={1} className="w-full" />
            <p className="text-[10px] font-mono tracking-widest break-all text-stone-600 mt-1">{lotNo}</p>
          </div>
        </div>
      </Section>

      {/* ── STOCK CONTEXT ──────────────────────────────────────────────────
          The CURRENT stock this warehouse holds for the lot — the same number the
          Inventory list shows. Units later moved to another warehouse have left
          this row and are not counted here; that movement is recorded in
          Warehouse → Transfer History, which keeps the original transferred
          quantity. The backend returns this warehouse's row only. */}
      {/* <Section
        title="Stock Context"
        subtitle="Current stock held by this warehouse"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[480px]">
            <thead>
              <tr className="border-b border-stone-200">
                <Th pad="px-3">Warehouse</Th>
                <Th pad="px-3">Current Stock</Th>
                <Th pad="px-3">Awaiting Receipt</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {stockByWarehouse.map((s) => (
                <tr key={String(s.inventoryId)} className={s.isThisRow ? 'bg-stone-50/60' : ''}>
                  <td className="px-3 py-3 text-sm font-medium text-stone-800">
                    {s.warehouse}
                  </td>
                  <td className="px-3 py-3 text-sm font-bold text-stone-900">{num(s.availableStock)}</td>
                  <td className="px-3 py-3 text-sm text-amber-700 font-medium">{num(s.inTransitStock)}</td>
                </tr>
              ))}
              {stockByWarehouse.length === 0 && (
                <tr><td colSpan={3} className="px-3 py-8 text-center text-sm text-stone-400">No stock rows.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section> */}

      {/* ── PACKAGING INFORMATION ────────────────────────────────────────
          Rendered by the SHARED LotPackagingPanel so this page and Transfer
          History → View can never draw a Bulk Packaging ID differently. The
          markup is unchanged — it simply lives in the component now. The
          mapping below is the only thing local to this page: it turns the
          /lots/:id/details payload into the panel's neutral shape. */}
      <LotPackagingPanel
        boxes={unitsByBox.map(({ box, units: boxUnits }) => ({
          bulkPackagingId: box.bulk_packaging_id,
          boxSerial: box.box_serial,
          // CURRENT units in the box (what this warehouse still holds), not the
          // box's original capacity. Taken from the backend's own count rather
          // than the codes below, which are capped for the page — otherwise a
          // box whose codes fell outside that cap would read "0 units".
          unitsInBox: box.current_units ?? boxUnits.length,
          // …and what the box was BUILT to hold, so the header can read
          // "5 of 5 units here" the same way a partly-present box does.
          capacity: box.units_in_box ?? null,
          status: box.status,
          receivedAt: box.received_at,
          // The Bulk Packaging carton above this inner box — the panel folds
          // the boxes under it. Null on a two-level lot, which keeps those flat.
          parentBulkPackagingId: box.parent_bulk_packaging_id || null,
          parentBoxSerial: box.parent_box_serial ?? null,
          parentUnitsInBox: box.parent_units_in_box ?? null,
          parentStatus: box.parent_status || null,
          parentReceivedAt: box.parent_received_at || null,
          // WHERE THIS BOX'S UNITS NOW ARE (company view only — the warehouse
          // view sends neither, since a warehouse holds what it holds). The
          // company used to learn this from a SECOND copy of every box listed
          // underneath the cards; it belongs on the card itself.
          warehouse: box.warehouse || null,
          warehouseBreakdown: box.warehouseBreakdown || null,
          // The box's OWN units, as the backend linked them. Grouping the page's
          // in-stock `units` array here left the most recently received box
          // empty, because a receive activates the first units of the LOT
          // rather than the units of the box it received.
          unitCodes: box.unit_codes ?? boxUnits.map((u) => u.unit_code || u.serial),
        }))}
        // Both computed by the backend, which is what guarantees a unit sits in
        // exactly one place: a box card, a loose group, or this plain list.
        looseUnitGroups={looseUnitGroups}
        looseUnitCodes={looseUnitCodes}
        summary={packaging}
        totalBoxes={lot.number_of_boxes}
        unitsPerBox={lot.units_per_box}
        unitTotal={unitTotal}
        // Inventory View is CURRENT: show the live unit-label count for this
        // warehouse ("71"), not "71 of 100". Original quantity stays available as
        // lot metadata in the Lot Summary above.
        originalQty={null}
        unitsTruncated={unitsTruncated}
      />

      {/* ── MOVEMENT HISTORY ─────────────────────────────────────────────── */}
      {/* <Section
        title="Movement History"
        subtitle="The append-only stock ledger for this lot — newest first"
        right={<span className="text-[11px] text-stone-400">{movements.length} entry(ies)</span>}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[720px]">
            <thead>
              <tr className="border-b border-stone-200">
                <Th pad="px-3">When</Th>
                <Th pad="px-3">Type</Th>
                <Th pad="px-3">Channel</Th>
                <Th pad="px-3">Qty</Th>
                <Th pad="px-3">Balance After</Th>
                <Th pad="px-3">Reference</Th>
                <Th pad="px-3">Note</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {movements.map((m) => (
                <tr key={m._id}>
                  <td className="px-3 py-3 text-sm text-stone-500">{fmtDate(m.createdAt)}</td>
                  <td className="px-3 py-3 text-sm font-medium text-stone-800">{String(m.type || '').replace(/_/g, ' ')}</td>
                  <td className="px-3 py-3 text-sm text-stone-500">{m.channel}</td>
                  <td className={`px-3 py-3 text-sm font-bold ${Number(m.quantity) < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {Number(m.quantity) > 0 ? '+' : ''}{num(m.quantity)}
                  </td>
                  <td className="px-3 py-3 text-sm text-stone-600">{m.balanceAfter == null ? '—' : num(m.balanceAfter)}</td>
                  <td className="px-3 py-3 text-sm text-stone-500">{m.refType || '—'}</td>
                  <td className="px-3 py-3 text-[11px] text-stone-500 max-w-[280px] break-words">{m.note || '—'}</td>
                </tr>
              ))}
              {movements.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-stone-400">No movements recorded for this lot.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section> */}
    </div>
  );
};

export default ImsLotDetails;
