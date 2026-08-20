import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getShipmentDetails, getLotTransferSnapshot, formatINR } from '../../lib/imsApi';
import BackButton from '../../Components/BackButton';
import LotPackagingPanel from '../../Components/ims/LotPackagingPanel';
import { usePermission } from '../../context/PermissionContext';
// Resolves a stored file reference (signed S3 URL or served /uploads path) into
// an openable href — the same helper the profile documents use.
import { fileHref } from '../../lib/fileHref';

// WAREHOUSE TRANSFER DETAIL — READ-ONLY traceability for ONE transfer, reached
// from Company Warehouse → Transfer History → View.
//
// ONE page, ONE layout, for EVERY transfer. A warehouse→warehouse shipment and a
// company→warehouse assignment are fetched from DIFFERENT endpoints, but that is
// the ONLY thing that differs: both payloads are normalised into ONE common
// view-model (see `normalize*` below) and rendered by the SAME JSX. There is no
// `kind`-based branch anywhere in the render tree — a section shows when it has
// data and hides when it does not. The record type never changes the structure,
// only the data.
//
//   ?kind=company_transfer  → GET /lots/:id/transfer-snapshot  (the IMMUTABLE
//                             historical view of the Company → Warehouse
//                             assignment: original quantity + every unit ever
//                             minted for the lot + its boxes. Deliberately NOT
//                             /lots/:id/details, whose units are the LIVE set
//                             still in the row and therefore shrink whenever a
//                             later transfer moves stock out — a Transfer History
//                             record must read the same forever.)
//   anything else (default) → GET /shipments/:id/details (warehouse→warehouse;
//                             an existing link with no ?kind still resolves here)
//
// Sections, in order, all data-driven:
//   1. Transfer Information   2. Product Information   3. Packaging Summary
//   4. Bulk Packaging IDs     5. Unit Codes            6. Parent Lot Information
//   7. Timeline
//
// THIS PAGE WRITES NOTHING — no edit, delete, transfer or receive control, and
// it calls no mutating endpoint. Serials come from the real UnitEvent audit
// trail / minted UnitSerial rows; none are ever synthesised. Warehouse scope is
// enforced server-side by both endpoints, so this page can never widen what the
// session may see.

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtNum = (n) => Number(n || 0).toLocaleString('en-IN');

/**
 * A comma list with each value said ONCE, or null when there is nothing to say.
 *
 * A transfer carries one row per LOT, so a field that describes the PRODUCT —
 * its name, its category — repeats as many times as there are lots unless the
 * duplicates are dropped. Order is preserved: the first lot's product leads.
 */
const uniqJoin = (values) =>
  [...new Set((values || []).filter(Boolean).map((v) => String(v).trim()).filter(Boolean))]
    .join(', ') || null;

const Detail = ({ label, value }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
    <p className="text-sm text-stone-800 font-medium break-words">{value == null || value === '' ? '—' : value}</p>
  </div>
);

const Card = ({ title, children, right }) => (
  <section className="bg-white border border-stone-200 rounded-xl p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h2 className="text-sm font-bold text-stone-900">{title}</h2>
      {right}
    </div>
    {children}
  </section>
);

const DirectionPill = ({ direction }) => (
  <span className={`inline-block mt-0.5 text-[11px] font-bold rounded-full px-2.5 py-1 ${
    direction === 'Outgoing' ? 'bg-orange-50 text-orange-600'
    : direction === 'Incoming' ? 'bg-blue-50 text-blue-700'
    : 'bg-stone-100 text-stone-500'
  }`}>{direction}</span>
);

const StatusChip = ({ status }) => (
  <span className="inline-block mt-0.5 text-[11px] font-bold rounded-full px-2.5 py-1 bg-stone-100 text-stone-600 capitalize">
    {String(status || '').replace(/_/g, ' ') || '—'}
  </span>
);

/**
 * Normalise the COMPANY → WAREHOUSE payload (/lots/:id/transfer-snapshot) into
 * the common view-model. Direction is always Incoming: the source is the
 * Company, not a warehouse. A company assignment is the ORIGIN of the stock, so
 * it has no upstream parent lot of its own — `parentLots` is therefore empty and
 * section 6 hides itself, exactly the same way a single-package transfer hides
 * Bulk Packaging IDs. The structure is identical; only the data is absent.
 *
 * Quantity and Unit Labels come from the snapshot's immutable numbers
 * (originalQuantity / the full minted count the endpoint returns as unitTotal),
 * NEVER from live balances — this is a historical record and must read the same
 * regardless of later warehouse movements.
 */
function normalizeCompany(d, companyName) {
  const lot = d.lot || {};
  const p = lot.productId || {};
  const boxes = d.bulkPackages || [];
  const units = d.units || [];
  // Original arrival quantity. `d.unitTotal` is the snapshot's immutable total
  // (lot.originalQuantity, or the full minted-unit count for pre-register rows).
  const originalQty = typeof lot.originalQuantity === 'number'
    ? lot.originalQuantity
    : Number(d.unitTotal || units.length);
  const byBox = boxes.map((box) => ({
    bulkPackagingId: box.bulk_packaging_id,
    boxSerial: box.box_serial,
    unitsInBox: box.units_in_box,
    status: box.status,
    receivedAt: box.received_at,
    unitCodes: units
      .filter((u) => String(u.bulk_packaging_record_id) === String(box._id))
      .map((u) => u.unit_code || u.serial),
  }));
  const loose = units.filter((u) => !u.bulk_packaging_record_id).map((u) => u.unit_code || u.serial);
  const received = lot.receivedAt || (String(lot.receiving_status) === 'received' ? lot.updatedAt : null);

  return {
    info: {
      ref: `CW-${String(lot._id || '').slice(-6).toUpperCase()}`,
      direction: 'Incoming',
      status: lot.receiving_status || (Number(lot.inTransitStock || 0) > 0 ? 'pending' : 'received'),
      date: received || lot.createdAt,
      from: companyName || 'Company',
      to: lot.warehouseId?.name || '—',
      value: p.mrp ? originalQty * Number(p.mrp) : null,
      createdAt: lot.createdAt || null,
      pickedAt: null,        // a company assignment has no pick step
      dispatchedAt: null,    // …nor a dispatch step
      receivedAt: received || null,
    },
    product: {
      productName: p.productName || '—',
      category: p.category || null,
      lotNumber: lot.lotNumber || lot.batchNumber || '—',
      // No batchNumber — the Product Information section no longer shows one.
      quantity: originalQty,
      warehouse: lot.warehouseId?.name || '—',
      mfgDate: lot.mfgDate,
      expiryDate: lot.expiryDate,
    },
    packing: {
      boxes: byBox,
      looseUnitCodes: loose,
      summary: d.packaging || null,
      totalBoxes: lot.number_of_boxes,
      unitsPerBox: lot.units_per_box,
      unitTotal: d.unitTotal || units.length,
      originalQty,
      unitsTruncated: !!d.unitsTruncated,
    },
    parentLots: [],
    // Real, non-synthesised events only: the lot was created, and (if it has
    // arrived) received. Empty → Timeline hides itself.
    timeline: [
      lot.createdAt && { status: 'created', at: lot.createdAt },
      received && { status: 'received', at: received },
    ].filter(Boolean),
  };
}

/** Normalise the WAREHOUSE → WAREHOUSE payload (/shipments/:id/details). */
function normalizeShipment(d, mine) {
  const s = d.summary || {};
  const lots = d.parentLots || [];
  const direction = mine.includes(String(s.fromWarehouseId)) ? 'Outgoing'
    : mine.includes(String(s.toWarehouseId)) ? 'Incoming' : '—';

  // One transfer may draw on several parent lots; merge their boxes and loose
  // units so Packaging Information reads as one list for the whole transfer.
  const boxes = lots.flatMap((l) => l.bulkPackages || []);
  const loose = lots.flatMap((l) => l.looseUnitCodes || []);
  const unitTotal = boxes.reduce((n, b) => n + (b.unitCodes || []).length, 0) + loose.length;

  return {
    info: {
      ref: s.ref,
      direction,
      status: s.status,
      date: s.receivedAt || s.dispatchedAt || s.createdAt,
      from: s.source,
      to: s.destination,
      value: s.value,
      createdAt: s.createdAt || null,
      pickedAt: s.pickedAt || null,
      dispatchedAt: s.dispatchedAt || null,
      receivedAt: s.receivedAt || null,
      // The delivery challan captured when the transfer was raised. A company
      // assignment (normalizeCompany) has no challan, so these stay undefined
      // there and the fields simply don't render.
      challanNumber: s.deliveryChallanNumber || null,
      challanUrl: s.challanDocumentUrl || null,
      challanName: s.challanDocumentName || null,
    },
    product: {
      // ONE ENTRY PER DISTINCT PRODUCT, not one per lot. A transfer of three
      // lots of the same product read "abc, abc, abc"; the lots are listed by
      // their own numbers below, and repeating the product once per lot says
      // nothing the Lot Number field does not already say. Several genuinely
      // different products still list several names.
      productName: uniqJoin(lots.map((l) => l.productName)) || uniqJoin(s.products),
      category: uniqJoin(lots.map((l) => l.category)),
      // Lot numbers are NOT deduped — each lot is its own thing, and two lots
      // never share a number.
      lotNumber: lots.map((l) => l.lotNumber).filter(Boolean).join(', ') || '—',
      quantity: s.quantity,
      warehouse: direction === 'Outgoing' ? s.source : s.destination,
      mfgDate: lots[0]?.mfgDate,
      expiryDate: lots[0]?.expiryDate,
    },
    packing: {
      boxes,
      looseUnitCodes: loose,
      summary: null, // a transfer moves part of a lot; box roll-ups belong to the lot
      totalBoxes: lots[0]?.numberOfBoxes ?? null,
      unitsPerBox: lots[0]?.unitsPerBox ?? null,
      unitTotal,
      originalQty: null,
      unitsTruncated: false,
    },
    parentLots: lots.map((l) => ({
      lotNumber: l.lotNumber,
      batchNumber: l.mfgBatchNo || l.batchNumber || null,
      productName: l.productName,
      category: l.category,
      allocatedQty: l.allocatedQty,
      receivedQty: l.receivedQty,
      mfgDate: l.mfgDate,
      expiryDate: l.expiryDate,
    })),
    timeline: d.timeline || [],
  };
}

const WarehouseTransferDetail = () => {
  const { id } = useParams();
  const [params] = useSearchParams();
  // `kind` chooses which existing endpoint to ask — NOTHING in the render tree
  // reads it. Default to `shipment` so an existing link with no ?kind still works.
  const kind = params.get('kind') || 'shipment';
  const isCompanyTransfer = kind === 'company_transfer';
  const { warehouseIds, companyName } = usePermission();
  const [raw, setRaw] = useState(null);
  const [err, setErr] = useState('');
  // Which row `raw` was actually loaded for — the same marker pattern
  // ImsLotDetails uses. It doubles as the loading flag and guarantees a stale
  // response for a previously-viewed row can never render against this one,
  // without resetting state synchronously inside the effect body.
  const key = `${kind}:${id}`;
  const [loadedFor, setLoadedFor] = useState(null);
  const loading = loadedFor !== key;

  useEffect(() => {
    let cancelled = false;
    const load = isCompanyTransfer ? getLotTransferSnapshot(id) : getShipmentDetails(id);
    load
      .then((r) => {
        if (cancelled) return;
        setRaw(r?.data || null); setErr(''); setLoadedFor(key);
      })
      .catch((e) => {
        if (cancelled) return;
        setRaw(null);
        setErr(e?.response?.data?.message || 'Could not load this transfer.');
        setLoadedFor(key);
      });
    return () => { cancelled = true; };
  }, [id, isCompanyTransfer, key]);

  const mine = useMemo(() => (warehouseIds || []).map(String), [warehouseIds]);
  const vm = useMemo(() => {
    if (!raw) return null;
    // The ONLY place `kind` matters: which normaliser turns the raw payload into
    // the ONE common view-model. Everything below renders that model identically.
    return isCompanyTransfer ? normalizeCompany(raw, companyName) : normalizeShipment(raw, mine);
  }, [raw, isCompanyTransfer, companyName, mine]);

  if (loading) return <div className="w-full px-3 sm:px-5 py-6 font-sora"><BackButton /><p className="mt-6 text-sm text-stone-400">Loading…</p></div>;
  if (err) return <div className="w-full px-3 sm:px-5 py-6 font-sora"><BackButton /><p className="mt-6 text-sm text-stone-500">{err}</p></div>;
  if (!vm) return <div className="w-full px-3 sm:px-5 py-6 font-sora"><BackButton /><p className="mt-6 text-sm text-stone-500">This transfer could not be loaded.</p></div>;

  // `parentLots` and `timeline` are still produced by the normalisers; their
  // sections are currently disabled below, so they are not destructured here.
  const { info, product, packing } = vm;

  return (
    <div className="w-full px-3 sm:px-5 py-6 font-sora space-y-4">
      <BackButton />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 mb-1">Transfer {info.ref}</h1>
          <p className="text-stone-500">{info.from} → {info.to}</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 border border-stone-200 rounded-full px-3 py-1">
          Read-only
        </span>
      </div>

      {/* ── 1 · TRANSFER INFORMATION ─────────────────────────────────────────
          Each timestamp shows only when it has a value — a company assignment
          simply has no pick/dispatch step, so those fields are absent by data,
          not by record type. */}
      <Card title="Transfer Information">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
          <Detail label="Reference No." value={info.ref} />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Direction</p>
            <DirectionPill direction={info.direction} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Status</p>
            <StatusChip status={info.status} />
          </div>
          <Detail label="Transfer Date & Time" value={fmtDateTime(info.date)} />
          <Detail label="From" value={info.from} />
          <Detail label="To" value={info.to} />
          {info.value != null && <Detail label="Total Value" value={formatINR(info.value)} />}
          {info.createdAt && <Detail label="Created" value={fmtDateTime(info.createdAt)} />}
          {info.pickedAt && <Detail label="Picked" value={fmtDateTime(info.pickedAt)} />}
          {info.dispatchedAt && <Detail label="Dispatched" value={fmtDateTime(info.dispatchedAt)} />}
          {info.receivedAt && <Detail label="Received" value={fmtDateTime(info.receivedAt)} />}
          {/* Delivery challan — the number, and the stored scan itself. The link
              opens in a new tab; its href is whatever the API resolved from the
              stored key (signed S3 URL or the served /uploads path). */}
          {info.challanNumber && <Detail label="Delivery Challan No." value={info.challanNumber} />}
          {info.challanUrl && (
            <Detail
              label="Challan Document"
              value={(
                <a
                  href={fileHref(info.challanUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-bold text-[#EA2831] hover:underline"
                  title={info.challanName || 'Delivery challan'}
                >
                  <span className="material-symbols-outlined text-base">description</span>
                  <span className="truncate">{info.challanName || 'View document'}</span>
                </a>
              )}
            />
          )}
        </div>
      </Card>

      {/* ── 2 · PRODUCT INFORMATION ──────────────────────────────────────────── */}
      <Card title="Product Information">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
          <Detail label="Product Name" value={product.productName} />
          <Detail label="Category" value={product.category} />
          {/* NO "Batch Number" HERE. It listed the same lot numbers the field
              above already carries, once per lot — a second, longer copy of the
              answer. The manufacturer's own batch, where a lot has one, is on
              that lot's row in Parent Lot Information below. */}
          <Detail label="Lot Number" value={<span className="font-mono text-xs break-all">{product.lotNumber}</span>} />
          <Detail label="Quantity" value={fmtNum(product.quantity)} />
          <Detail label="Warehouse" value={product.warehouse} />
          <Detail label="Manufacturing Date" value={fmtDate(product.mfgDate)} />
          <Detail label="Expiry Date" value={fmtDate(product.expiryDate)} />
        </div>
      </Card>

      {/* ── 3 · PACKAGING SUMMARY · 4 · BULK PACKAGING IDs · 5 · UNIT CODES ───────
          Same shared renderer Inventory → Lot Details uses, so a Bulk Packaging
          ID and its unit codes look identical in both places. Each of its three
          sections is driven by its own array: a single-package transfer shows
          Unit Codes only (no boxes → Bulk Packaging IDs hides), a bulk transfer
          shows Bulk Packaging IDs, and a mixed transfer shows both. */}
      <LotPackagingPanel
        boxes={packing.boxes}
        looseUnitCodes={packing.looseUnitCodes}
        summary={packing.summary}
        totalBoxes={packing.totalBoxes}
        unitsPerBox={packing.unitsPerBox}
        unitTotal={packing.unitTotal}
        originalQty={packing.originalQty}
        unitsTruncated={packing.unitsTruncated}
        unitsLabel="Unit Codes"
      />

      {/* ── 6 · PARENT LOT INFORMATION ───────────────────────────────────────────
          The source lot(s) a warehouse→warehouse transfer drew its units from.
          A company→warehouse assignment is the origin of its stock and has no
          upstream parent lot, so `parentLots` is empty and this section hides —
          the same data-driven hide as an empty Bulk Packaging IDs section. */}
      {/* {parentLots.length > 0 && (
        <Card title="Parent Lot Information adasdsad" right={parentLots.length > 1 ? <span className="text-[11px] text-stone-400">{parentLots.length} lots</span> : null}>
          <div className="space-y-4">
            {parentLots.map((l, i) => (
              <div key={i} className={i > 0 ? 'pt-4 border-t border-stone-100' : ''}>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
                  <Detail label="Parent Lot No." value={<span className="font-mono text-xs break-all">{l.lotNumber}</span>} />
                  <Detail label="Batch No." value={l.batchNumber} />
                  <Detail label="Product" value={l.productName} />
                  <Detail label="Category" value={l.category} />
                  <Detail label="Qty Allocated" value={l.allocatedQty == null ? '—' : fmtNum(l.allocatedQty)} />
                  <Detail label="Received Qty" value={l.receivedQty == null ? '—' : fmtNum(l.receivedQty)} />
                  <Detail label="Manufacturing Date" value={fmtDate(l.mfgDate)} />
                  <Detail label="Expiry Date" value={fmtDate(l.expiryDate)} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )} */}

      {/* ── 7 · TIMELINE ─────────────────────────────────────────────────────── */}
      {/* {timeline.length > 0 && (
        <Card title="Timeline">
          <div className="flex flex-wrap items-center gap-2">
            {timeline.map((t, i) => (
              <React.Fragment key={i}>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
                  <span className="h-2 w-2 rounded-full bg-[#EA2831]" />
                  <span className="capitalize">{String(t.status || '').replace(/_/g, ' ')}</span>
                  <span className="text-stone-400 font-normal">{fmtDateTime(t.at)}</span>
                </div>
                {i < timeline.length - 1 && <span className="text-stone-300">→</span>}
              </React.Fragment>
            ))}
          </div>
        </Card>
      )} */}
    </div>
  );
};

export default WarehouseTransferDetail;
