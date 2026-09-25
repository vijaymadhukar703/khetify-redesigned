import React, { useState } from 'react';
import Swal from 'sweetalert2';
import { traceSerial, traceLot, traceInvoice, formatINR, fmtDate } from '../../../lib/imsApi';
import { GhostBtn } from './ImsUi';
import Invoice from '../../../Components/ims/Invoice';
import { movementKind } from '../../../lib/movementLabel';

const apiError = (err) => Swal.fire({ icon: 'error', title: err?.response?.data?.message || 'Not found', toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });

/** Detect what was searched and call the right trace endpoint. */
function detect(q) {
  const s = q.trim();
  if (/^INV-/i.test(s)) return 'invoice';
  // Unit serial: prefix-less <lotkey>-<3+ digit seq> (e.g. ABSAMIO012-001), or a
  // legacy "K-U-…" label. Lot numbers rarely take this single-segment shape;
  // the Serial/Lot/Invoice dropdown overrides the guess when needed.
  if (/^(K-U-)?[A-Z0-9]+-\d{3,}$/i.test(s)) return 'serial';
  return 'lot';
}

const ImsTrace = () => {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('auto');
  const [result, setResult] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    const type = kind === 'auto' ? detect(q) : kind;
    setBusy(true);
    try {
      let data;
      if (type === 'serial') data = await traceSerial(q.trim());
      else if (type === 'invoice') data = await traceInvoice(q.trim());
      else data = await traceLot(q.trim());
      setResult({ type, ...data.data });
    } catch (err) { apiError(err); setResult(null); } finally { setBusy(false); }
  };

  return (
    // NO max-w-4xl. The Operations shell already supplies the page gutter and
    // the other tabs run edge to edge; the old cap here centred a narrow column
    // inside a full-width white card, which is what made the tab look empty.
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-white font-sora">
      <div className="w-full space-y-5">
        <div>
          <h2 className="text-xl font-bold text-stone-900">Trace</h2>
          <p className="text-xs text-stone-400 mt-0.5">Search a unit serial, lot number, or invoice number.</p>
        </div>

        {/* The search row is the whole tab until something is found, so it reads
            as one panel rather than three loose controls. Select, input and
            button all sit at h-11 — previously each took its own height. */}
        <div className="border border-stone-200 rounded-2xl bg-stone-50/50 p-4">
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Native select arrows differ per browser, so it is hidden and a
                Material chevron drawn in its place — matching the filters on
                the Product Catalog and the chevrons in the pagination. */}
            <div className="relative sm:w-36 shrink-0">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="h-11 w-full pl-3 pr-9 appearance-none bg-white border border-stone-200 rounded-lg text-sm font-bold text-stone-600 outline-none cursor-pointer transition-colors hover:bg-stone-50 focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/10"
              >
                <option value="auto">Auto</option><option value="serial">Serial</option><option value="lot">Lot</option><option value="invoice">Invoice</option>
              </select>
              <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 text-[20px] pointer-events-none">expand_more</span>
            </div>
            <div className="relative flex-1 min-w-0">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-[20px] pointer-events-none">search</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
                placeholder="unit serial / lot / INV-…"
                className="h-11 w-full pl-10 pr-3 bg-white border border-stone-200 rounded-lg text-sm font-mono outline-none transition-colors focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/10"
              />
            </div>
            <button
              type="button"
              disabled={!q.trim() || busy}
              onClick={search}
              className="h-11 shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#EA2831] px-6 text-sm font-bold text-white transition-colors hover:bg-[#C91E26] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#EA2831]"
            >
              {/* Busy state: the search hits three different endpoints and can
                  take a moment — the button used to give no sign it was working. */}
              <span className={`material-symbols-outlined text-[18px] ${busy ? 'animate-spin' : ''}`}>{busy ? 'progress_activity' : 'search'}</span>
              {busy ? 'Searching…' : 'Search'}
            </button>
          </div>
          <p className="text-[11px] text-stone-400 mt-2.5">
            Auto detects the type from what you type — pick Serial, Lot or Invoice to override it.
          </p>
        </div>

        {/* Nothing searched yet. The tab used to be a blank white expanse below
            the search box with no indication of what it does. */}
        {!result && !busy && (
          <div className="border border-dashed border-stone-200 rounded-2xl py-14 text-center">
            <span className="material-symbols-outlined text-5xl text-stone-200 font-light">travel_explore</span>
            <p className="text-sm font-bold text-stone-500 mt-2">Trace a unit, lot or invoice</p>
            <p className="text-xs text-stone-400 mt-1">
              Enter a reference above to see its full journey — where it came from, where it went, and who received it.
            </p>
          </div>
        )}

        {result?.type === 'serial' && <SerialResult r={result} />}
        {result?.type === 'lot' && <LotResult r={result} />}
        {result?.type === 'invoice' && (
          <div className="border border-stone-200 rounded-2xl bg-white shadow-sm p-5">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <p className="font-mono font-bold text-stone-900">{result.order.invoiceNumber}</p>
                <p className="text-xs text-stone-400 mt-0.5">{result.order.customerName} · {formatINR(result.order.totalAmount)} · {result.order.status}</p>
              </div>
              <GhostBtn onClick={() => setInvoice(result.order)}>View Invoice</GhostBtn>
            </div>
          </div>
        )}
      </div>
      {invoice && <Invoice order={invoice} onClose={() => setInvoice(null)} />}
    </div>
  );
};

const Dot = ({ children }) => (
  <div className="relative pl-6 pb-4 border-l-2 border-stone-200">
    <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-[#EA2831]" />
    {children}
  </div>
);

const SerialResult = ({ r }) => (
  <div className="border border-stone-200 rounded-2xl bg-white shadow-sm p-5 space-y-3">
    <div className="flex justify-between">
      <div>
        <p className="font-mono font-bold text-stone-900">{r.unit.serial}</p>
        <p className="text-xs text-stone-400">{r.unit.productId?.productName} · status <b>{r.unit.status}</b></p>
      </div>
      {r.customer && <div className="text-right text-xs"><p className="font-bold">{r.customer.name}</p><p className="text-stone-400">{r.customer.phone}</p></div>}
    </div>
    <div>
      <p className="text-[10px] font-bold uppercase text-stone-400 mb-2">Journey</p>
      {(r.events || []).map((e, i) => (
        <Dot key={i}>
          <p className="text-sm font-bold text-stone-700 capitalize">{e.event} {e.fromStatus && e.toStatus ? `(${e.fromStatus}→${e.toStatus})` : ''}</p>
          <p className="text-xs text-stone-400">{fmtDate(e.at)}{e.refType ? ` · ${movementKind(e)}` : ''}</p>
        </Dot>
      ))}
      {(!r.events || r.events.length === 0) && <p className="text-xs text-stone-400">No movement events recorded yet.</p>}
    </div>
    {r.order && <p className="text-xs text-stone-500">Order: {r.order.invoiceNumber || r.order.orderNumber} ({r.order.status})</p>}
  </div>
);

const LotResult = ({ r }) => (
  <div className="space-y-4">
    <div className="border border-stone-200 rounded-2xl bg-white shadow-sm p-5">
      <p className="font-bold text-stone-900">Lot {r.lotNumber}</p>
      <div className="flex gap-3 mt-2 text-xs">
        {Object.entries(r.units || {}).map(([s, n]) => <span key={s} className="bg-stone-100 rounded-full px-2 py-0.5">{s}: <b>{n}</b></span>)}
      </div>
      <div className="mt-3 text-xs text-stone-500">
        {(r.stock || []).map((s, i) => <div key={i}>{s.warehouseId?.name || s.productId?.productName}: avail {s.availableStock}, damaged {s.damagedStock}</div>)}
      </div>
    </div>
    <div className="border border-stone-200 rounded-2xl bg-white shadow-sm p-5">
      <p className="text-[10px] font-bold uppercase text-stone-400 mb-2">Customers reached</p>
      {(r.ordersReached || []).length ? r.ordersReached.map((o) => (
        <div key={o._id} className="text-xs text-stone-500 py-0.5">{o.invoiceNumber || o.orderNumber} · {o.customerName || '—'} · {o.status}</div>
      )) : <p className="text-xs text-stone-400">No sales of this lot recorded.</p>}
    </div>
    <div className="border border-stone-200 rounded-2xl bg-white shadow-sm p-5">
      <p className="text-[10px] font-bold uppercase text-stone-400 mb-2">Movement ledger ({r.movements?.length || 0})</p>
      <div className="max-h-64 overflow-y-auto">
        {(r.movements || []).map((m) => (
          <div key={m._id} className="flex justify-between text-xs border-b border-dashed border-stone-100 py-1">
            <span className="text-stone-600">{m.type}</span>
            <span className={m.quantity < 0 ? 'text-red-600' : 'text-green-600'}>{m.quantity > 0 ? '+' : ''}{m.quantity}</span>
            <span className="text-stone-400">{fmtDate(m.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default ImsTrace;