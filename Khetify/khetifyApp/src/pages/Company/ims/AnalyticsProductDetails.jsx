import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getLotDetails, formatINR, fmtDate } from '../../../lib/imsApi';
import BackButton from '../../../Components/BackButton';
import { ViewAvailableUnitsBtn, AvailableUnitsModal } from '../../../Components/ims/AvailableUnits';
import useAvailableUnits from '../../../Components/ims/useAvailableUnits';

/**
 * PRODUCT ANALYTICS DETAILS — READ-ONLY view of ONE Analytics row, reached from
 * Company → Analytics → View.
 *
 * An Analytics (Stock on Hand) row IS a lot row, so this page reuses the lot
 * endpoint the Inventory View already runs on — GET /lots/:id/details — and adds
 * no business logic of its own. The layout follows Company → Inventory → View
 * (pages/Company/ims/ImsLotDetails.jsx): same Section/Detail primitives, same
 * status pill.
 *
 * Sections:
 *   1. Product Summary   2. Inventory Information   3. Stock Summary
 *
 * WHICH UNITS, NOT JUST HOW MANY. "Available: 100" does not say which 100, so
 * every place this page shows the available quantity carries a View Available
 * Units action. Both the button and its popup come from the shared
 * Components/ims/AvailableUnits — the STANDARD control for Analytics View pages,
 * so any report that grows a View page later gets the identical thing by
 * importing it rather than by copying this file.
 *
 * THIS PAGE WRITES NOTHING — no edit, delete, transfer, receive or print
 * control, and it calls no mutating endpoint.
 */

const num = (n) => Number(n || 0).toLocaleString('en-IN');
const titleCase = (s) => String(s || '').replace(/_/g, ' ');

const Detail = ({ label, value, mono = false, children }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
    <p className={`text-sm text-stone-800 font-medium break-words ${mono ? 'font-mono text-xs' : ''}`}>
      {value === null || value === undefined || value === '' ? '—' : value}
    </p>
    {children}
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
    : 'bg-stone-100 text-stone-600';
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${cls}`}>
      {s ? titleCase(s) : '—'}
    </span>
  );
};

const AnalyticsProductDetails = () => {
  const { lotId } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [loadedFor, setLoadedFor] = useState(null);
  const loading = loadedFor !== lotId;

  // The standard Analytics available-units control. ONE fetch, on first open,
  // shared by every button on the page.
  const units = useAvailableUnits(lotId);

  useEffect(() => {
    let cancelled = false;
    getLotDetails(lotId)
      .then((r) => {
        if (cancelled) return;
        setD(r?.data || null); setErr(''); setLoadedFor(lotId);
      })
      .catch((e) => {
        if (cancelled) return;
        setD(null);
        setErr(e?.response?.data?.message || 'Could not load this analytics record.');
        setLoadedFor(lotId);
      });
    return () => { cancelled = true; };
  }, [lotId]);

  const back = <BackButton to="/analytics" label="Back to Analytics" />;
  if (loading) return <div className="w-full px-3 sm:px-5 py-6 font-sora">{back}<p className="mt-6 text-sm text-stone-400">Loading…</p></div>;
  if (err) return <div className="w-full px-3 sm:px-5 py-6 font-sora">{back}<p className="mt-6 text-sm text-stone-500">{err}</p></div>;
  if (!d?.lot) return <div className="w-full px-3 sm:px-5 py-6 font-sora">{back}<p className="mt-6 text-sm text-stone-500">This analytics record could not be loaded.</p></div>;

  const lot = d.lot;
  const p = lot.productId || {};
  const lotNo = lot.lotNumber || lot.batchNumber || '—';
  const availableQty = Number(lot.availableStock || 0);
  const originalQty = typeof lot.originalQuantity === 'number'
    ? lot.originalQuantity
    : Number(d.unitTotal || 0);
  // Valued exactly as the Stock on Hand row was: qty × (price || MRP).
  const unitPrice = Number(p.price || p.mrp || 0);
  const totalAmount = availableQty * unitPrice;
  // Total Stock Value follows the Inventory page: available × MRP.
  const stockValue = availableQty * Number(p.mrp || p.price || 0);
  const warehouseName = lot.warehouseId?.name || 'Unassigned';
  // `address` is a structured subdocument (line1/city/district/state/pincode),
  // not a string — flatten the parts that are actually filled in.
  const a = lot.warehouseId?.address || {};
  const warehouseLocation = [
    warehouseName,
    lot.warehouseId?.code && `(${lot.warehouseId.code})`,
    [a.line1, a.city, a.district, a.state, a.pincode].filter(Boolean).join(', '),
  ].filter(Boolean).join(' · ');

  return (
    <div className="w-full px-3 sm:px-5 py-6 font-sora space-y-4">
      {back}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 mb-1">{p.productName || 'Product'}</h1>
          <p className="text-stone-500 font-mono text-xs break-all">{lotNo}</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 border border-stone-200 rounded-full px-3 py-1">
          Read-only
        </span>
      </div>

      {/* ── 1 · PRODUCT SUMMARY ─────────────────────────────────────────────── */}
      <Section title="Product Summary">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
          <Detail label="Product Name" value={p.productName} />
          <Detail label="Product Code" value={p.product_code || p.skuNumber} mono />
          <Detail label="Category" value={p.category} />
          <Detail label="Lot Number" value={lotNo} mono />
          <Detail label="Batch Number" value={lot.mfgBatchNo || lot.batchNumber} mono />
          <Detail label="Warehouse" value={warehouseName} />
          <Detail label="Quantity" value={num(availableQty)} />
          <Detail label="MRP" value={p.mrp ? formatINR(p.mrp) : null} />
          <Detail label="Total Amount" value={unitPrice ? formatINR(totalAmount) : null} />
          <Detail label="Manufacturing Date" value={fmtDate(lot.mfgDate)} />
          <Detail label="Expiry Date" value={fmtDate(lot.expiryDate)} />
        </div>
      </Section>

      {/* ── 2 · INVENTORY INFORMATION ───────────────────────────────────────── */}
      <Section title="Inventory Information">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
          <Detail label="Current Warehouse" value={warehouseName} />
          <Detail label="Current Available Quantity" value={num(availableQty)}>
            <ViewAvailableUnitsBtn onClick={units.open} />
          </Detail>
          <Detail label="Original Lot Quantity" value={num(originalQty)} />
          <Detail
            label="Low Stock Alert"
            value={Number(lot.lowStockThreshold || 0) > 0
              ? `At ${num(lot.lowStockThreshold)} unit(s)${availableQty <= Number(lot.lowStockThreshold) ? ' · triggered' : ''}`
              : 'Not set'}
          />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Receiving Status</p>
            <div className="mt-1"><StatusPill status={lot.receiving_status} /></div>
          </div>
        </div>
      </Section>

      {/* ── 3 · STOCK SUMMARY ───────────────────────────────────────────────── */}
      <Section title="Stock Summary">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
          <Detail label="Current Available Quantity" value={num(availableQty)}>
            <ViewAvailableUnitsBtn onClick={units.open} />
          </Detail>
          <Detail label="Total Stock Value" value={formatINR(stockValue)} />
          <Detail label="Warehouse Location" value={warehouseLocation} />
        </div>
      </Section>

      {units.isOpen && <AvailableUnitsModal state={units.state} onClose={units.close} />}
    </div>
  );
};

export default AnalyticsProductDetails;
