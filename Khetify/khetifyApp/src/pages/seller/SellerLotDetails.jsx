import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getSellerLotDetails, getSellerLotHistory,
  getSellerLotUnits, getSellerPackageUnits,
} from '../../lib/sellerApi';
import { fmtDate, formatINR } from '../../lib/imsApi';

/**
 * SELLER LOT DETAILS — a dedicated, READ-ONLY traceability page for ONE lot the
 * seller holds. Reached from Seller Inventory → Actions → View.
 *
 * The seller only ever sees their OWN received/current stock: the API is scoped
 * to the seller's inventory row, so company-wide quantities, other warehouses,
 * other sellers' units, reserved/internal figures and cost price are never in
 * the response. Nothing here mutates anything.
 *
 * Units are loaded LAZILY and PAGINATED — a bulk lot can hold thousands, so the
 * box rows stay collapsed until the seller opens one.
 */

const num = (n) => Number(n || 0).toLocaleString('en-IN');
const UNIT_PAGE_SIZE = 25;

const Detail = ({ label, value, mono = false }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
    <p className={`text-sm text-stone-800 font-medium break-words ${mono ? 'font-mono' : ''}`}>
      {value === null || value === undefined || value === '' ? '—' : value}
    </p>
  </div>
);

const Card = ({ title, subtitle, right, children }) => (
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

const statusPill = (status) => {
  const s = String(status || '').toLowerCase();
  const cls =
    ['in_stock', 'available'].includes(s) ? 'bg-green-50 text-green-700'
    : ['sold', 'shipped', 'dispatched', 'packed', 'picked'].includes(s) ? 'bg-blue-50 text-blue-700'
    : ['returned'].includes(s) ? 'bg-amber-50 text-amber-700'
    : ['damaged', 'recalled', 'cancelled'].includes(s) ? 'bg-red-50 text-red-600'
    : 'bg-stone-100 text-stone-600';
  return <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${cls}`}>{s ? s.replace(/_/g, ' ') : '—'}</span>;
};

/** A paginated, searchable unit table. `fetchPage(page, search)` returns the API page. */
const UnitTable = ({ fetchPage, boxed }) => {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback((p, q) => {
    setLoading(true);
    fetchPage(p, q)
      .then((r) => {
        setRows(r?.data || []);
        setPage(r?.page || 1);
        setTotalPages(r?.totalPages || 1);
        setTotal(r?.total || 0);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [fetchPage]);

  useEffect(() => { load(1, ''); }, [load]);

  // Debounce the search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => load(1, search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Unit Code…"
          className="w-full max-w-xs border border-stone-200 rounded-lg text-sm px-3 py-2 outline-none focus:border-[#EA2831]"
        />
        <span className="text-[11px] text-stone-400 whitespace-nowrap">{num(total)} unit(s)</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[720px]">
          <thead>
            <tr className="border-b border-stone-200 text-[10px] font-bold uppercase tracking-wider text-stone-400">
              <th className="px-3 py-2">Unit Code</th>
              {/* <th className="px-3 py-2">Serial</th>
              {boxed && <th className="px-3 py-2">Bulk Packaging ID</th>} */}
              <th className="px-3 py-2">Lot Number</th>
              <th className="px-3 py-2">Received</th>
              <th className="px-3 py-2">Current Status</th>
              <th className="px-3 py-2">Received At</th>
              <th className="px-3 py-2">Source Warehouse</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((u) => (
              <tr key={u.unitCode}>
                <td className="px-3 py-2 text-[11px] font-mono text-stone-800 break-all">{u.unitCode}</td>
                {/* <td className="px-3 py-2 text-xs text-stone-600">{u.unitSerial ?? '—'}</td>
                {boxed && <td className="px-3 py-2 text-[11px] font-mono text-stone-500 break-all">{u.bulkPackagingId || '—'}</td>} */}
                <td className="px-3 py-2 text-[11px] font-mono text-stone-500 break-all">{u.lotNumber || '—'}</td>
                <td className="px-3 py-2">{statusPill(u.receivedStatus)}</td>
                <td className="px-3 py-2">{statusPill(u.currentStatus)}</td>
                <td className="px-3 py-2 text-xs text-stone-500">{fmtDate(u.receivedAt)}</td>
                <td className="px-3 py-2 text-xs text-stone-500">{u.sourceWarehouse || '—'}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={boxed ? 8 : 7} className="px-3 py-8 text-center text-sm text-stone-400">No units found.</td></tr>
            )}
            {loading && (
              <tr><td colSpan={boxed ? 8 : 7} className="px-3 py-8 text-center text-sm text-stone-400">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 mt-3">
          <button disabled={page <= 1} onClick={() => load(page - 1, search)}
            className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 disabled:opacity-40">Prev</button>
          <span className="text-[11px] text-stone-500">Page {page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => load(page + 1, search)}
            className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
};

/** One collapsible Bulk Packaging box row; units fetch only when expanded. */
const PackageRow = ({ lotId, box }) => {
  const [open, setOpen] = useState(false);
  const fetchPage = useCallback(
    (page, search) => getSellerPackageUnits(lotId, box.bulkPackageId, { page, limit: UNIT_PAGE_SIZE, search }),
    [lotId, box.bulkPackageId]
  );
  return (
    <div className="border border-stone-200 rounded-xl overflow-hidden">
      <div className="grid grid-cols-2 md:grid-cols-7 gap-x-3 gap-y-2 items-center px-4 py-3">
        <div className="md:col-span-2 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Bulk Packaging ID</p>
          <p className="font-mono text-xs text-stone-800 break-all">{box.bulkPackagingId}</p>
        </div>
        <Detail label="Originally in Package" value={num(box.unitsOriginallyInPackage)} />
        <Detail label="Received by Seller" value={num(box.unitsReceivedBySeller)} />
        <Detail label="Current with Seller" value={num(box.currentUnitsWithSeller)} />
        <Detail label="Source Warehouse" value={box.sourceWarehouse} />
        <div className="flex md:justify-end">
          <button onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-bold text-[#EA2831] hover:underline">
            <span className="material-symbols-outlined text-sm">{open ? 'expand_less' : 'visibility'}</span>
            {open ? 'Hide Units' : 'View Units'}
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-stone-100 p-4 bg-stone-50/40">
          <UnitTable fetchPage={fetchPage} boxed />
        </div>
      )}
    </div>
  );
};

const SellerLotDetails = () => {
  const { lotId } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [history, setHistory] = useState([]);
  // Which lot `d` was loaded for — doubles as the loading flag and stops a stale
  // response for a previous lot rendering against the current one.
  const [loadedFor, setLoadedFor] = useState(null);
  const [error, setError] = useState('');
  const loading = loadedFor !== lotId && !error;

  useEffect(() => {
    let cancelled = false;
    // Reset from inside the async callbacks (not synchronously in the effect
    // body) so React doesn't flag a cascading render.
    getSellerLotDetails(lotId)
      .then((r) => { if (!cancelled) { setError(''); setD(r?.data || null); setLoadedFor(lotId); } })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.message || 'You do not have access to this inventory lot.');
        setD(null);
        setLoadedFor(lotId);
      });
    getSellerLotHistory(lotId)
      .then((r) => { if (!cancelled) setHistory(r?.data || []); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [lotId]);

  const lotUnitsFetch = useCallback(
    (page, search) => getSellerLotUnits(lotId, { page, limit: UNIT_PAGE_SIZE, search }),
    [lotId]
  );

  if (loading) {
    return <div className="w-full px-3 sm:px-6 py-10 text-sm text-stone-400">Loading lot…</div>;
  }
  if (error || !d?.lot) {
    return (
      <div className="w-full px-3 sm:px-6 py-10">
        <p className="text-sm text-stone-500 mb-4">{error || 'This lot could not be loaded.'}</p>
        <button onClick={() => navigate('/seller/inventory')} className="text-sm font-bold text-[#EA2831] hover:underline">Back to Inventory</button>
      </div>
    );
  }

  const { lot, stock, bulkPackages = [] } = d;

  return (
    <div className="w-full px-3 sm:px-6 py-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={() => navigate('/seller/inventory')}
            className="text-[11px] font-bold text-stone-400 hover:text-stone-700 inline-flex items-center gap-1 mb-1">
            <span className="material-symbols-outlined text-sm">arrow_back</span> Back to Inventory
          </button>
          <h1 className="text-2xl font-bold text-stone-900">{lot.productName || 'Lot'}</h1>
          {/* <p className="font-mono text-sm text-stone-500 break-all">
            {lot.lotNumber}{lot.batchNumber ? ` · Batch ${lot.batchNumber}` : ''}
          </p> */}
          {/* <p className="text-xs text-stone-500 mt-1">
            Current Seller Quantity: <b className="text-stone-800">{num(stock.currentQuantity)}</b>
            <span className={`ml-2 font-bold ${stock.currentQuantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {stock.currentQuantity > 0 ? 'In Stock' : 'Out of Stock'}
            </span>
          </p> */}
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 border border-stone-200 rounded-full px-3 py-1">Read-only</span>
      </div>

      {/* 1. Lot Summary */}
      <Card title="Lot Summary">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
          <Detail label="Product Name" value={lot.productName} />
          <Detail label="Product Code" value={lot.productCode} mono />
          <Detail label="Category" value={lot.category} />
          <Detail label="Lot Number" value={lot.lotNumber} mono />
          <Detail label="Batch Number" value={lot.batchNumber} />
          <Detail label="Manufacturing Date" value={fmtDate(lot.mfgDate)} />
          <Detail label="Expiry Date" value={fmtDate(lot.expiryDate)} />
          <Detail label="MRP" value={lot.mrp != null ? formatINR(lot.mrp) : null} />
          <Detail label="Supplying Company" value={lot.supplyingCompany} />
          <Detail label="Source Warehouse" value={lot.sourceWarehouse} />
          <Detail label="Received Date" value={fmtDate(lot.receivedAt)} />
          {/* <Detail label="Packaging Type" value={lot.packagingType} /> */}
        </div>
      </Card>

      {/* 2. Seller Stock Summary — received vs current, kept separate */}
      {/* <Card title="Seller Stock Summary" subtitle="Your received and current quantities — not the company's original lot quantity">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl bg-stone-50 border border-stone-100 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Total Units Received</p>
            <p className="text-2xl font-black text-stone-900">{num(stock.totalUnitsReceived)}</p>
          </div>
          <div className="rounded-xl bg-green-50 border border-green-100 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-green-600">Current Units in Inventory</p>
            <p className="text-2xl font-black text-green-700">{num(stock.currentUnits)}</p>
          </div>
          <div className="rounded-xl bg-stone-50 border border-stone-100 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Current Quantity</p>
            <p className="text-2xl font-black text-stone-900">{num(stock.currentQuantity)}</p>
          </div>
        </div>
      </Card> */}

      {/* 3. Packaging Summary */}
      {/* <Card title="Packaging Summary" subtitle="Lot → Bulk Packaging Box → Units">
        <Detail label="Packaging Type" value={lot.packagingType} />
      </Card> */}

      {/* 4. Received Bulk Packaging IDs / Units */}
      {lot.isBulk ? (
        <Card
          title="Received Bulk Packaging IDs"
          right={<span className="text-[11px] text-stone-400">{bulkPackages.length} package(s)</span>}
        >
          <div className="space-y-3">
            {bulkPackages.map((box) => <PackageRow key={box.bulkPackageId} lotId={lotId} box={box} />)}
            {bulkPackages.length === 0 && <p className="text-sm text-stone-400">No Bulk Packaging IDs received for this lot.</p>}
          </div>
        </Card>
      ) : (
        <Card title="Units in this Lot" subtitle="Your received / current units">
          <UnitTable fetchPage={lotUnitsFetch} boxed={false} />
        </Card>
      )}

      {/* 5. Seller-visible Traceability History */}
      {/* <Card title="Traceability History" subtitle="Only events you are a party to">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[640px]">
            <thead>
              <tr className="border-b border-stone-200 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                <th className="px-3 py-2">Date &amp; Time</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">From</th>
                <th className="px-3 py-2">To</th>
                <th className="px-3 py-2">Quantity</th>
                <th className="px-3 py-2">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {history.map((h, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-xs text-stone-500 whitespace-nowrap">{fmtDate(h.at)}</td>
                  <td className="px-3 py-2 text-sm font-medium text-stone-800">{h.event}</td>
                  <td className="px-3 py-2 text-xs text-stone-500">{h.from || '—'}</td>
                  <td className="px-3 py-2 text-xs text-stone-500">{h.to || '—'}</td>
                  <td className="px-3 py-2 text-sm font-bold text-stone-800">{num(h.quantity)}</td>
                  <td className="px-3 py-2 text-[11px] font-mono text-stone-500 break-all">{h.referenceNo || '—'}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-stone-400">No traceability events recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card> */}
    </div>
  );
};

export default SellerLotDetails;
