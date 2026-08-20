import React from 'react';
import { formatINR, fmtDate } from '../../lib/imsApi';
import BackButton from '../BackButton';
import { ViewAvailableUnitsBtn, AvailableUnitsModal } from './AvailableUnits';

/**
 * ANALYTICS DETAILS — the ONE read-only layout every Analytics View page uses.
 *
 * Company Warehouse, Seller and Seller Warehouse Analytics all reach a lot from
 * a different endpoint with a different payload shape, but they answer the same
 * three questions, so they share this renderer. Each page normalises its own API
 * response into the view-model below and hands it over; nothing here knows which
 * module it is serving.
 *
 * Sections, matching the finalized Company Analytics View page:
 *   1. Product Summary   2. Inventory Information   3. Stock Summary
 *
 * Wherever the available quantity appears it carries a View Available Units
 * button, wired to the shared popup (AvailableUnits). The `units` prop is a
 * useAvailableUnits() handle, so one page-level fetch serves every button.
 *
 * READ-ONLY: renders what it is given. No edit, delete, transfer, receive or
 * print control, and it calls no endpoint of its own.
 *
 * View-model:
 *   backTo, backLabel, title, subtitle
 *   product   { name, code, category, lotNumber, batchNumber, warehouse,
 *               quantity, mrp, totalAmount, mfgDate, expiryDate }
 *   inventory { warehouse, availableQty, receivingStatus, lowStockThreshold }
 *   stock     { availableQty, stockValue, warehouseLocation }
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

const Section = ({ title, children }) => (
  <section className="border border-stone-200 rounded-2xl bg-white shadow-sm overflow-hidden">
    <div className="px-5 py-3 border-b border-stone-100 bg-stone-50/60">
      <h2 className="text-sm font-bold text-stone-800">{title}</h2>
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

/** The shell every Analytics View page shares while loading or failing. */
export const AnalyticsDetailsShell = ({ backTo, backLabel, children }) => (
  <div className="w-full px-3 sm:px-5 py-6 font-sora">
    <BackButton to={backTo} label={backLabel} />
    {children}
  </div>
);

const AnalyticsDetailsView = ({ vm, units }) => {
  const { product, inventory, stock } = vm;

  return (
    <div className="w-full px-3 sm:px-5 py-6 font-sora space-y-4">
      <BackButton to={vm.backTo} label={vm.backLabel} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 mb-1">{vm.title || 'Product'}</h1>
          <p className="text-stone-500 font-mono text-xs break-all">{vm.subtitle}</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 border border-stone-200 rounded-full px-3 py-1">
          Read-only
        </span>
      </div>

      {/* ── 1 · PRODUCT SUMMARY ─────────────────────────────────────────────── */}
      <Section title="Product Summary">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
          <Detail label="Product Name" value={product.name} />
          <Detail label="Product Code" value={product.code} mono />
          <Detail label="Category" value={product.category} />
          <Detail label="Lot Number" value={product.lotNumber} mono />
          <Detail label="Batch Number" value={product.batchNumber} mono />
          <Detail label="Warehouse" value={product.warehouse} />
          <Detail label="Quantity" value={num(product.quantity)} />
          <Detail label="MRP" value={product.mrp ? formatINR(product.mrp) : null} />
          <Detail label="Total Amount" value={product.totalAmount ? formatINR(product.totalAmount) : null} />
          <Detail label="Manufacturing Date" value={fmtDate(product.mfgDate)} />
          <Detail label="Expiry Date" value={fmtDate(product.expiryDate)} />
        </div>
      </Section>

      {/* ── 2 · INVENTORY INFORMATION ───────────────────────────────────────── */}
      <Section title="Inventory Information">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
          <Detail label="Current Warehouse" value={inventory.warehouse} />
          <Detail label="Current Available Quantity" value={num(inventory.availableQty)}>
            <ViewAvailableUnitsBtn onClick={units.open} />
          </Detail>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Receiving Status</p>
            <div className="mt-1"><StatusPill status={inventory.receivingStatus} /></div>
          </div>
          <Detail
            label="Low Stock Alert"
            value={Number(inventory.lowStockThreshold || 0) > 0
              ? `At ${num(inventory.lowStockThreshold)} unit(s)${inventory.availableQty <= Number(inventory.lowStockThreshold) ? ' · triggered' : ''}`
              : 'Not set'}
          />
        </div>
      </Section>

      {/* ── 3 · STOCK SUMMARY ───────────────────────────────────────────────── */}
      <Section title="Stock Summary">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
          <Detail label="Current Available Quantity" value={num(stock.availableQty)}>
            <ViewAvailableUnitsBtn onClick={units.open} />
          </Detail>
          <Detail label="Total Stock Value" value={formatINR(stock.stockValue)} />
          <Detail label="Warehouse Location" value={stock.warehouseLocation} />
        </div>
      </Section>

      {units.isOpen && <AvailableUnitsModal state={units.state} onClose={units.close} />}
    </div>
  );
};

export default AnalyticsDetailsView;
