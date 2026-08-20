import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STATUS, statusOf, computeInventorySummary, formatINR } from '../../lib/inventoryData';
import { daysToExpiry, expiryBadge, fmtDate } from '../../lib/imsApi';
import { getSellerLink, getSellerLots } from '../../lib/sellerApi';

// Seller Inventory — READ-ONLY unified view of the seller's own stock
// (ownerType "seller"). Stock, lots and expiry batches are one lots-based page:
// they always described the same rows, so they are projected from one dataset
// rather than shown as three tabs. Sellers receive lots via supply (Phase 3);
// they never create them, so there are no create/receive controls. Stock is
// valued at MRP (never cost).
const PAGE_SIZE = 10;

const EXPIRY_FILTERS = [['all', 'All Lots'], ['expiring', 'Expiring ≤ 90d'], ['expired', 'Expired']];

/** Stable identity for a seller lot. Falls back to the Inventory collection's
 *  unique dimensions (productId, warehouseId, batchNumber) when _id is absent. */
const lotKey = (l) =>
  l._id ||
  [l.productId?._id || l.productId, l.warehouseId?._id || l.warehouseId, l.batchNumber || l.lotNumber]
    .filter(Boolean)
    .join('|');

const SellerInventory = () => {
  const navigate = useNavigate();
  const [approved, setApproved] = useState(null);
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [expiryFilter, setExpiryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('All');
  const [page, setPage] = useState(1);

  // Any filter change sends the reader back to page 1 — otherwise a narrowed
  // result set would land them on a page that no longer exists.
  const applySearch = (v) => { setSearch(v); setPage(1); };
  const applyExpiryFilter = (v) => { setExpiryFilter(v); setPage(1); };
  const applyStatusFilter = (v) => { setStatusFilter(v); setPage(1); };

  const loadLots = useCallback(() => {
    getSellerLots()
      .then((r) => { if (r?.success) setLots(r.data || []); })
      .catch(() => setLots([]))
      .finally(() => setLoading(false));
  }, []);

  const load = useCallback(() => {
    getSellerLink()
      .then((r) => {
        const ok = r?.data?.linkStatus === 'approved';
        setApproved(ok);
        if (ok) loadLots(); else setLoading(false);
      })
      .catch(() => { setApproved(false); setLoading(false); });
  }, [loadLots]);
  useEffect(() => { load(); }, [load]);

  // One row per lot — deduped, since the same lot may arrive from more than one
  // source. Field names match statusOf/computeInventorySummary's contract.
  const rows = useMemo(() => {
    const byKey = new Map();
    for (const l of lots) {
      const key = lotKey(l);
      if (!key || byKey.has(key)) continue;
      const p = l.productId || {};
      byKey.set(key, {
        id: key,
        lotId: l._id,
        lotNo: l.lotNumber || l.batchNumber || '—',
        batchNo: l.batchNumber || '—',
        name: p.productName || '—',
        sku: p.skuNumber || '',
        category: p.category || 'Uncategorised',
        brand: p.brandName || '',
        packingSize: [p.packagingType, p.unit].filter(Boolean).join(' · '),
        warehouse: l.warehouseId?.name || 'Unassigned',
        mfgDate: l.mfgDate || null,
        expiryDate: l.expiryDate || null,
        stock: l.availableStock || 0,
        reorderLevel: l.lowStockThreshold || 0,
        price: p.mrp || 0, // value at MRP only — never cost
      });
    }
    return Array.from(byKey.values());
  }, [lots]);

  // Summary cards read the full seller dataset, never the current page.
  const summary = useMemo(() => computeInventorySummary(rows), [rows]);
  const totalUnits = useMemo(() => rows.reduce((s, r) => s + r.stock, 0), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesSearch = !q || [r.name, r.lotNo, r.batchNo, r.brand, r.warehouse]
        .some((f) => (f || '').toLowerCase().includes(q));
      const d = daysToExpiry(r.expiryDate);
      const matchesExpiry =
        expiryFilter === 'all' ? true :
        expiryFilter === 'expiring' ? (d !== null && d >= 0 && d <= 90) :
        (d !== null && d < 0);
      const matchesStatus = statusFilter === 'All' || statusOf(r) === statusFilter;
      return matchesSearch && matchesExpiry && matchesStatus;
    });
  }, [rows, search, expiryFilter, statusFilter]);

  // Filters run first, then pagination.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  if (approved === null) return <div className="flex-1 p-8 text-center text-stone-400 font-sora">Loading…</div>;
  if (!approved) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">lock</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Inventory is locked</h2>
          <p className="text-sm text-amber-700 mt-1">Available after your supplying company approves you.</p>
        </div>
      </div>
    );
  }

  const statusClasses = (s) => (s === STATUS.IN ? 'text-green-600' : s === STATUS.LOW ? 'text-orange-500' : s === STATUS.OUT ? 'text-red-600' : 'text-stone-600');

  return (
    <div className="w-full mx-auto px-3 sm:px-5 py-6 font-sora">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Inventory</h1>
      <p className="text-stone-500 mb-5">Your stock on hand, lots and expiry batches — received from your supplying company.</p>

      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {[
            { label: 'Total Lots', value: summary.total },
            { label: 'Low / Out of Stock', value: summary.lowStock + summary.outOfStock },
            { label: 'Units in Stock', value: totalUnits.toLocaleString('en-IN') },
            { label: 'Total Stock Value (MRP)', value: formatINR(summary.stockValue) },
          ].map((stat) => (
            <div key={stat.label} className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 shadow-sm">
              <p className="text-stone-500 text-[10px] font-bold uppercase mb-2 tracking-wider">{stat.label}</p>
              <p className="text-2xl sm:text-3xl font-bold text-stone-900">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-stone-50/50 p-4 rounded-xl border border-stone-100">
          <div className="flex gap-2 flex-wrap">
            {EXPIRY_FILTERS.map(([k, label]) => (
              <button key={k} onClick={() => applyExpiryFilter(k)}
                className={`text-xs font-bold px-4 py-2 rounded-full border transition-colors ${expiryFilter === k ? 'bg-[#EA2831] border-[#EA2831] text-white' : 'border-stone-200 text-stone-500 bg-white hover:bg-stone-50'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-3">
            <div className="relative w-full sm:w-72">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">search</span>
              <input type="text" value={search} onChange={(e) => applySearch(e.target.value)} placeholder="Search product, lot, batch, brand or warehouse..." className="pl-10 w-full border border-stone-200 rounded-lg py-2.5 text-sm focus:ring-[#EA2831] bg-white" />
            </div>
            <select value={statusFilter} onChange={(e) => applyStatusFilter(e.target.value)} className="md:min-w-[150px] border border-stone-200 rounded-lg text-sm px-4 py-2.5 bg-white">
              <option value="All">All Stock Status</option>
              {[STATUS.IN, STATUS.LOW, STATUS.OUT].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[1300px] resp-table">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200">
                  {/* Brand + Reorder At are intentionally not shown on Seller
                      Inventory. The reorder value still drives Stock Status and
                      the Low/Out-of-Stock card — it's just not a column here. */}
                  {['Lot No.', 'Batch No.', 'Product', 'Category', 'Warehouse', 'Mfg', 'Expiry', 'Qty', 'Stock Status', 'Expiry Status', 'MRP', ''].map((h, i) => (
                    <th key={i} className={`px-4 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest whitespace-nowrap ${h === '' ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paged.map((r) => {
                  const status = statusOf(r);
                  const badge = expiryBadge(r.expiryDate);
                  return (
                    <tr key={r.id} className="hover:bg-stone-50/30 transition-colors">
                      <td data-label="Lot No." className="px-4 py-5">
                        <span className="text-xs font-bold bg-stone-100 text-stone-600 px-2.5 py-1 rounded-full whitespace-nowrap">{r.lotNo}</span>
                      </td>
                      <td data-label="Batch No." className="px-4 py-5 text-sm text-stone-500 font-medium">{r.batchNo}</td>
                      <td data-label="Product" className="px-4 py-5">
                        <p className="font-bold text-stone-900 text-sm">{r.name}</p>
                        {r.sku && <p className="text-[10px] font-bold text-stone-400 uppercase tracking-tight">SKU: {r.sku}</p>}
                      </td>
                      <td data-label="Category" className="px-4 py-5 text-sm text-stone-500 font-medium">{r.category}</td>
                      {/* <td data-label="Packing Size" className="px-4 py-5 text-sm text-stone-500 font-medium">{r.packingSize || '—'}</td> */}
                      <td data-label="Warehouse" className="px-4 py-5 text-sm text-stone-900 font-medium">{r.warehouse}</td>
                      <td data-label="Mfg" className="px-4 py-5 text-sm text-stone-500 font-medium whitespace-nowrap">{fmtDate(r.mfgDate)}</td>
                      <td data-label="Expiry" className="px-4 py-5 text-sm text-stone-500 font-medium whitespace-nowrap">{fmtDate(r.expiryDate)}</td>
                      <td data-label="Qty" className="px-4 py-5 text-sm text-stone-900 font-bold">{r.stock.toLocaleString('en-IN')}</td>
                      <td data-label="Stock Status" className="px-4 py-5 text-sm"><span className={`font-bold whitespace-nowrap ${statusClasses(status)}`}>{status}</span></td>
                      <td data-label="Expiry Status" className="px-4 py-5"><span className={`text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${badge.cls}`}>{badge.label}</span></td>
                      <td data-label="MRP" className="px-4 py-5 text-sm text-stone-900 font-bold whitespace-nowrap">{formatINR(r.price)}</td>
                      <td className="px-4 py-5 cell-actions">
                        {/* flex-wrap only: the extra View button must never push
                            the row layout or widen the column. */}
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {/* Everything about this lot — packaging, box IDs,
                              package-wise units and traceability — lives on the
                              read-only details page, so this table is unchanged. */}
                          <button onClick={() => navigate(`/seller/inventory/lots/${r.lotId}/view`)} title="View lot traceability" disabled={!r.lotId}
                            className="inline-flex items-center gap-1 text-xs font-bold text-stone-500 hover:text-[#EA2831] transition-colors disabled:opacity-40">
                            <span className="material-symbols-outlined text-sm">visibility</span> View
                          </button>
                          <button onClick={() => navigate(`/seller/labels?lot=${r.lotId}`)} title="Print / scan labels" disabled={!r.lotId}
                            className="inline-flex items-center gap-1 text-xs font-bold text-stone-500 hover:text-[#EA2831] transition-colors disabled:opacity-40">
                            <span className="material-symbols-outlined text-sm">qr_code_2</span> Label
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && filtered.length === 0 && <tr><td colSpan={13} className="px-6 py-12 text-center text-sm text-stone-400">{rows.length === 0 ? 'No stock yet — it appears after your company approves a supply request.' : 'No lots match these filters.'}</td></tr>}
                {loading && <tr><td colSpan={13} className="px-6 py-12 text-center text-sm text-stone-400">Loading inventory…</td></tr>}
              </tbody>
            </table>
          </div>

          {filtered.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 sm:px-6 py-4 border-t border-stone-200 bg-stone-50/50">
              <p className="text-xs font-bold text-stone-400 uppercase tracking-wider">
                Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} lots
              </p>
              {pageCount > 1 && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(safePage - 1)} disabled={safePage === 1}
                    className="px-3 py-1.5 text-xs font-bold text-stone-500 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:hover:bg-white">
                    Previous
                  </button>
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                    <button key={n} onClick={() => setPage(n)}
                      className={`min-w-[32px] px-2 py-1.5 text-xs font-bold rounded-lg border transition-colors ${n === safePage ? 'bg-[#EA2831] border-[#EA2831] text-white' : 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50'}`}>
                      {n}
                    </button>
                  ))}
                  <button onClick={() => setPage(safePage + 1)} disabled={safePage === pageCount}
                    className="px-3 py-1.5 text-xs font-bold text-stone-500 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:hover:bg-white">
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SellerInventory;
