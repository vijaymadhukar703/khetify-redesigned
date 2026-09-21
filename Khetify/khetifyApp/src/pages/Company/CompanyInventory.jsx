import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSubscription } from '../../context/SubscriptionContext';
import { STATUS, statusOf, computeInventorySummary, formatINR } from '../../lib/inventoryData';
import { getLots, expiryBadge, fmtDate } from '../../lib/imsApi';

/**
 * Stock Overview — a live, read-only roll-up of the company's lot rows.
 * It pulls from the SAME source as the dashboard (GET /api/lots) and uses the
 * SAME computeInventorySummary helper, so the two always agree. Stock actions
 * (receive / transfer / sell) live in Inventory → Lots & Batches.
 */
const CompanyInventory = () => {
  const navigate = useNavigate();
  const { plan, loading: subLoading } = useSubscription();
  const isSubscribed = !!plan && plan !== 'free';

  // Defense-in-depth: even if someone reaches the URL directly, free users
  // get sent to billing instead of seeing the inventory.
  useEffect(() => {
    if (!subLoading && !isSubscribed) navigate('/billing', { replace: true });
  }, [subLoading, isSubscribed, navigate]);

  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  useEffect(() => {
    if (subLoading || !isSubscribed) return;
    getLots()
      .then((res) => res?.success && setLots(res.data))
      .catch((err) => console.error('Inventory fetch failed:', err?.response?.data || err.message))
      .finally(() => setLoading(false));
  }, [subLoading, isSubscribed]);

  // Map each lot to the shape the shared summary helper expects — identical to
  // the dashboard, so totals/percentages match exactly.
  // For deleted products, use productNameSnapshot as fallback to preserve visibility.
  const rows = useMemo(
    () =>
      lots.map((l) => {
        const p = l.productId || {};
        // Use product name, fallback to snapshot if product deleted, then to "-"
        const displayName = p.productName || l.productNameSnapshot || '—';
        
        // Check if product is expired (expiryDate has passed)
        const isExpired = l.expiryDate && new Date(l.expiryDate) < new Date();
        
        // If expired, add visual indicator
        const nameWithStatus = isExpired ? `${displayName} (Expired)` : displayName;
        
        return {
          id: l._id,
          name: nameWithStatus,
          originalName: displayName, // Keep for filtering/search
          category: p.category || 'Uncategorised',
          lotNo: l.lotNumber || l.batchNumber || '—',
          warehouse: l.warehouseId?.name || 'Unassigned',
          expiryDate: l.expiryDate || null,
          stock: l.availableStock || 0,
          reorderLevel: l.lowStockThreshold || 0,
          price: p.mrp || 0,
          isExpired,
        };
      }),
    [lots]
  );

  const summary = useMemo(() => computeInventorySummary(rows), [rows]);
  const categories = useMemo(
    () => ['All', ...Array.from(new Set(rows.map((r) => r.category)))],
    [rows]
  );

  const filtered = useMemo(() => {
    return rows.filter((item) => {
      const q = search.toLowerCase();
      // Search against originalName (without the "(Expired)" suffix)
      const matchesSearch =
        item.originalName.toLowerCase().includes(q) || item.lotNo.toLowerCase().includes(q);
      const matchesCategory = category === 'All' || item.category === category;
      const matchesStatus = statusFilter === 'All' || statusOf(item) === statusFilter;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [rows, search, category, statusFilter]);

  const statusClasses = (status) => {
    switch (status) {
      case STATUS.IN:  return 'text-green-600';
      case STATUS.LOW: return 'text-orange-500';
      case STATUS.OUT: return 'text-red-600';
      default:         return 'text-stone-600';
    }
  };

  const lowOrOut = rows.filter(
    (i) => statusOf(i) === STATUS.LOW || statusOf(i) === STATUS.OUT
  );

  if (subLoading || !isSubscribed) return null; // avoid flashing before redirect

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">

        {/* Stats — COMPUTED from live lots with the shared helper, so they match the dashboard */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {[
            { label: 'Total Lots', value: summary.total },
            { label: 'Low / Out of Stock', value: summary.lowStock + summary.outOfStock },
            { label: 'Units in Stock', value: rows.reduce((s, r) => s + r.stock, 0).toLocaleString('en-IN') },
            { label: 'Total Stock Value', value: formatINR(summary.stockValue) },
          ].map((stat, i) => (
            <div key={i} className="min-w-0 bg-white border border-stone-200 rounded-xl p-5 sm:p-6 shadow-sm">
              <p className="text-stone-500 text-[10px] font-bold uppercase mb-2 tracking-wider">{stat.label}</p>
              <p className="text-xl sm:text-2xl lg:text-3xl font-bold text-stone-900 break-words leading-tight tabular-nums">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Low-stock alert banner — a core IMS feature */}
        {lowOrOut.length > 0 && (
          <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-xl p-4">
            <span className="material-symbols-outlined text-orange-500">notifications_active</span>
            <div>
              <p className="font-bold text-stone-900 text-sm">{lowOrOut.length} lot(s) need restocking</p>
              <p className="text-xs text-stone-500">
                {lowOrOut.map((i) => `${i.name} (${i.lotNo})`).join(', ')} — at or below their reorder level.
              </p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-stone-50/50 p-4 rounded-xl border border-stone-100">
          <div className="relative w-full md:flex-1 md:max-w-md">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">search</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by product or lot number..."
              className="pl-10 w-full border-stone-200 rounded-lg py-2.5 text-sm focus:ring-[#EA2831] bg-white"
            />
          </div>
          <div className="flex w-full md:w-auto gap-3">
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="flex-1 md:min-w-[140px] border-stone-200 rounded-lg text-sm px-4 py-2.5 bg-white">
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="flex-1 md:min-w-[140px] border-stone-200 rounded-lg text-sm px-4 py-2.5 bg-white">
              {['All', STATUS.IN, STATUS.LOW, STATUS.OUT].map((s) => <option key={s}>{s}</option>)}
            </select>
            <button
              onClick={() => navigate('/inventory?tab=lots')}
              className="inline-flex items-center gap-1.5 bg-[#EA2831] hover:bg-[#c91e26] text-white text-sm font-bold rounded-lg px-4 py-2.5 transition-colors whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-base">tune</span> Manage Lots
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[760px] resp-table">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200">
                  {['Product Details', 'Category', 'Lot / Warehouse', 'Stock', 'Reorder At', 'Expiry', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filtered.map((item) => {
                  const status = statusOf(item);
                  const badge = expiryBadge(item.expiryDate);
                  return (
                    <tr key={item.id} className={`hover:bg-stone-50/30 transition-colors ${item.isExpired ? 'bg-red-50/30' : ''}`}>
                      <td data-label="Product Details" className="px-4 py-5">
                        <p className={`font-bold text-sm ${item.isExpired ? 'text-red-700' : 'text-stone-900'}`}>
                          {item.name}
                        </p>
                        <p className="text-[10px] font-bold text-stone-400 uppercase tracking-tight">Lot: {item.lotNo}</p>
                      </td>
                      <td data-label="Category" className="px-4 py-5 text-sm text-stone-500 font-medium">{item.category}</td>
                      <td data-label="Lot / Warehouse" className="px-4 py-5 text-sm">
                        <p className="text-stone-900 font-medium">{item.warehouse}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td data-label="Stock" className="px-4 py-5 text-sm text-stone-900 font-bold">{item.stock.toLocaleString('en-IN')}</td>
                      <td data-label="Reorder At" className="px-4 py-5 text-sm text-stone-500 font-medium">{item.reorderLevel.toLocaleString('en-IN')}</td>
                      <td data-label="Expiry" className="px-4 py-5 text-sm text-stone-500 font-medium">{fmtDate(item.expiryDate)}</td>
                      <td data-label="Status" className="px-4 py-5 text-sm">
                        <span className={`font-bold ${statusClasses(status)}`}>{status}</span>
                      </td>
                    </tr>
                  );
                })}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-6 py-10 text-center text-sm text-stone-400">No stock matches your filters.</td></tr>
                )}
                {loading && (
                  <tr><td colSpan={7} className="px-6 py-10 text-center text-sm text-stone-400">Loading stock…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanyInventory;