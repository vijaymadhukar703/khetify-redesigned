import React, { useState, useEffect, useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useSubscription } from '../../context/SubscriptionContext';
import { usePermission } from '../../context/PermissionContext';
import { computeInventorySummary } from '../../lib/inventoryData';
import { getLots, getOrderSummary, getTmsShipments, getCustomers, getOwnerDashboard, getDashboardSummary, getTransferRequests, getProducts, getWarehouseDirectory, formatINR } from '../../lib/imsApi';
import SummaryCards from '../../Components/ims/SummaryCards';

/**
 * Build the SVG trend paths (viewBox 0 0 100 50) for a weekly units series —
 * a line plus a soft area fill. Returns flat paths when there's no data.
 */
function buildTrendPaths(weekly) {
  if (!weekly?.length || weekly.every((d) => !d.units)) {
    return { line: 'M0 49 L100 49', area: '' };
  }
  const max = Math.max(...weekly.map((d) => d.units), 1);
  const n = weekly.length;
  const pts = weekly.map((d, i) => {
    const x = Math.round(((i / (n - 1)) * 100) * 100) / 100;
    const y = Math.round((48 - (d.units / max) * 40) * 100) / 100;
    return [x, y];
  });
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  const area = `M0 50 ${pts.map((p) => `L${p[0]} ${p[1]}`).join(' ')} L100 50 Z`;
  return { line, area };
}

const EMPTY_SALES = { totalOrders: 0, weekRevenue: 0, weekUnits: 0, weekReturns: 0, weekly: [] };

// Map a named range (or a custom from/to) to an ISO {from,to} window for the
// dashboard summary endpoint. "daily" = today; others count back from now.
function rangeToWindow(range, custom) {
  if (range === 'custom') {
    return { from: custom.from || undefined, to: custom.to || undefined };
  }
  const now = new Date();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (range === 'weekly') from.setDate(from.getDate() - 6);
  else if (range === 'monthly') from.setMonth(from.getMonth() - 1);
  else if (range === 'quarterly') from.setMonth(from.getMonth() - 3);
  else if (range === 'yearly') from.setFullYear(from.getFullYear() - 1);
  // "daily" leaves from at start of today
  return { from: from.toISOString(), to: now.toISOString() };
}

const RANGE_OPTIONS = [
  ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'],
  ['quarterly', 'Quarterly'], ['yearly', 'Yearly'], ['custom', 'Custom'],
];

const PERIOD_LABEL = {
  daily: 'today', weekly: 'this week', monthly: 'this month',
  quarterly: 'this quarter', yearly: 'this year', custom: 'selected range',
};

const CompanyDashboard = () => {
  const navigate = useNavigate();

  // 🔥 Subscription gating for the inventory widget
  const { plan, loading: subLoading } = useSubscription();
  // billing:manage resolves only via the company_admin wildcard — managers
  // must never see subscription/upgrade controls (strict, not optimistic).
  const { can, role, loading: permLoading } = usePermission();
  const isAdmin = !permLoading && can('billing:manage');
  // Sales visibility: operations_manager has no order:read, so they never see
  // revenue, orders, P&L or the sales overview. sales_manager + admin do.
  const canSeeSales = !permLoading && can('order:read');
  // Cost visibility: only roles holding cost:read (e.g. company_admin) may see
  // cost/COGS/profit figures. Operations managers no longer hold cost:read, so
  // every value they see is MRP-based — the Profit & Loss card stays hidden.
  const canCost = !permLoading && can('cost:read');

  // Admin-only Profit & Loss snapshot (same source as the Executive
  // dashboard). Managers never see company financials.
  const [pnl, setPnl] = useState(null);
  useEffect(() => {
    if (!isAdmin) return;
    getOwnerDashboard().then((r) => setPnl(r?.data?.kpis || null)).catch(() => {});
  }, [isAdmin]);
  const isSubscribed = !!plan && plan !== 'free';

  // Live inventory: pull the company's lot rows and roll them up with the
  // SAME helper the Inventory tab uses, so the dashboard widget reflects
  // real stock (lots/batches received in IMS) instead of mock data.
  const [lots, setLots] = useState([]);
  const inv = useMemo(
    () =>
      computeInventorySummary(
        lots.map((l) => ({
          stock: l.availableStock,
          reorderLevel: l.lowStockThreshold || 0,
          price: l.productId?.mrp || 0,
        }))
      ),
    [lots]
  );

  // Real sales numbers from the orders backend (GET /api/orders/summary).
  const [sales, setSales] = useState(EMPTY_SALES);
  const trend = useMemo(() => buildTrendPaths(sales.weekly), [sales.weekly]);

  const [stats, setStats] = useState({
    totalProducts: 0,
    activeProducts: 0,
    warehouses: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login");
      return;
    }

    const fetchDashboardData = async () => {
      try {
        // Token-authenticated + company-scoped on the server, so counts always
        // match the Product Catalog (no client companyId guessing).
        // allSettled: the warehouse count is a separate concern, so a failure
        // there must not wipe out the product counts (and vice versa).
        const [prodRes, whRes] = await Promise.allSettled([getProducts(), getWarehouseDirectory()]);

        const products = prodRes.status === 'fulfilled' ? (prodRes.value?.data || []) : [];
        const total = products.length;
        // productStatus is stored lowercase ("active"/"inactive") — match case-insensitively.
        const active = products.filter((p) => (p.productStatus || '').toLowerCase() === 'active').length;

        // The endpoint returns either a bare array or { data: [...] }.
        const whRaw = whRes.status === 'fulfilled' ? whRes.value : null;
        const whList = Array.isArray(whRaw) ? whRaw : (whRaw?.data || []);

        setStats({ totalProducts: total, activeProducts: active, warehouses: whList.length });
      } catch (error) {
        console.error("Dashboard Data Error:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [navigate]);

  // Live inventory feed — only meaningful (and only allowed) when subscribed.
  useEffect(() => {
    if (subLoading || !isSubscribed) {
      setLots([]);
      return;
    }
    getLots()
      .then((res) => res?.success && setLots(res.data))
      .catch((err) =>
        console.error('Dashboard lots fetch failed:', err?.response?.data || err.message)
      );
  }, [subLoading, isSubscribed]);

  // ── Unified dashboard time-range filter ──────────────────────────────
  // Daily / Weekly / Monthly / Quarterly / Yearly / Custom. Drives BOTH the
  // headline numbers (reports/dashboard) and the sales overview / order count
  // (orders/summary), so every sales widget reacts to the selected period.
  const [range, setRange] = useState('weekly');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [summary, setSummary] = useState(null);
  const rangeWindow = useMemo(() => rangeToWindow(range, customRange), [range, customRange]);

  useEffect(() => {
    // Custom range needs both ends before it can query.
    if (range === 'custom' && (!rangeWindow.from || !rangeWindow.to)) return;
    const params = {};
    if (rangeWindow.from) params.from = rangeWindow.from;
    if (rangeWindow.to) params.to = rangeWindow.to;

    // Sales widgets only fetch when the role is allowed to see sales.
    if (canSeeSales) {
      getOrderSummary(params)
        .then((res) => res?.success && setSales({ ...EMPTY_SALES, ...res.data }))
        .catch((err) => console.error('Dashboard orders fetch failed:', err?.response?.data || err.message));
      getDashboardSummary(params)
        .then((res) => res?.success && setSummary(res.data))
        .catch(() => {});
    }
  }, [range, rangeWindow.from, rangeWindow.to, canSeeSales]);

  // Operations data — for roles that can't see sales (e.g. operations_manager),
  // the dashboard shows shipments & transfers instead of revenue.
  const [opsData, setOpsData] = useState(null);
  useEffect(() => {
    if (permLoading || canSeeSales || !isSubscribed) return;
    let alive = true;
    (async () => {
      const [shipRes, trRes] = await Promise.all([
        getTmsShipments().catch(() => null),
        getTransferRequests().catch(() => null),
      ]);
      if (!alive) return;
      const ships = Array.isArray(shipRes) ? shipRes : shipRes?.data || [];
      const transfers = Array.isArray(trRes) ? trRes : trRes?.data || [];
      setOpsData({
        pending: ships.filter((x) => ['draft', 'planned', 'approved', 'loading'].includes(x.status)).length,
        inTransit: ships.filter((x) => ['in_transit', 'arrived', 'verifying', 'dispatched'].includes(x.status)).length,
        totalShipments: ships.length,
        openTransfers: transfers.filter((t) => ['requested', 'accepted'].includes(t.status)).length,
        recent: ships.slice(0, 5),
      });
    })();
    return () => { alive = false; };
  }, [permLoading, canSeeSales, isSubscribed]);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-[#f8f9fa] font-sora">
      <div className="max-w-[1400px] mx-auto space-y-6 sm:space-y-8">

        {/* TIME-RANGE FILTER, now ABOVE the headline cards.

           It already drove both `reports/dashboard` and `orders/summary`, so
           every number below it — Stock Value, Expiring, Open Shipments,
           Today's Sales and the whole Sales overview — was already reacting to
           it. Sitting underneath those cards made it look like a filter for the
           chart alone; at the top it reads as what it is: the period for the
           entire dashboard. Only its POSITION changed, not its behaviour.

           Sales-visible roles only — an operations manager sees shipments
           rather than revenue and has nothing here to filter. */}
        {canSeeSales && (
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-stone-400">Period</span>
            <div className="inline-flex rounded-lg border border-stone-200 bg-white overflow-hidden">
              {RANGE_OPTIONS.map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setRange(k)}
                  className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                    range === k ? 'bg-[#EA2831] text-white' : 'text-stone-500 hover:bg-stone-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* THE WINDOW ACTUALLY BEING QUERIED.
                Without this there is no way to tell a filter that is not
                applying from a period that simply has no orders in it — both
                look like "nothing changed". These are the exact dates sent to
                the API as ?from&to. */}
            {rangeWindow.from && rangeWindow.to && (
              <span className="text-[11px] text-stone-400">
                {new Date(rangeWindow.from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                {' → '}
                {new Date(rangeWindow.to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
            {range === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={customRange.from ? customRange.from.slice(0, 10) : ''} onChange={(e) => setCustomRange((r) => ({ ...r, from: e.target.value ? new Date(e.target.value).toISOString() : '' }))}
                  className="border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs" />
                <span className="text-stone-400 text-xs">to</span>
                <input type="date" value={customRange.to ? customRange.to.slice(0, 10) : ''} onChange={(e) => setCustomRange((r) => ({ ...r, to: e.target.value ? new Date(e.target.value).toISOString() : '' }))}
                  className="border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs" />
              </div>
            )}
          </div>
          {summary && (
            <div className="flex items-center gap-4 text-sm">
              <span className="text-stone-500">Revenue <b className="text-stone-900">{formatINR(summary.rangeSales ?? summary.todaySales ?? 0)}</b></span>
              <span className="text-stone-500">Orders <b className="text-stone-900">{summary.rangeOrders ?? summary.todayOrders ?? 0}</b></span>
            </div>
          )}
        </div>
        )}

        {/* 🔥 IMS headline numbers */}
        <SummaryCards />

        {/* {isAdmin && canCost && pnl && (
          <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm mb-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-stone-900">Profit &amp; Loss</h3>
                <p className="text-[11px] text-stone-400">Owner-only · revenue vs cost across the company</p>
              </div>
              <button onClick={() => navigate('/analytics')}
                className="text-xs font-bold text-[#EA2831] hover:text-black transition-colors flex items-center gap-1">
                Stock Valuation <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Revenue</p>
                <p className="text-lg font-bold text-stone-900">{formatINR(pnl.totalRevenue)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Cost (COGS + Transport)</p>
                <p className="text-lg font-bold text-stone-900">{formatINR((pnl.totalCost || 0) + (pnl.transportCost || 0))}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Gross Profit</p>
                <p className={`text-lg font-bold ${(pnl.totalProfit || 0) >= 0 ? 'text-green-600' : 'text-[#EA2831]'}`}>{formatINR(pnl.totalProfit)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Margin</p>
                <p className={`text-lg font-bold ${(pnl.profitMarginPct || 0) >= 0 ? 'text-green-600' : 'text-[#EA2831]'}`}>{pnl.profitMarginPct ?? 0}%</p>
              </div>
            </div>
            {(pnl.totalLoss || 0) > 0 && (
              <p className="mt-3 text-[11px] text-stone-500">
                <span className="material-symbols-outlined text-xs align-middle text-[#EA2831]">trending_down</span>{' '}
                Loss-making products account for <b className="text-[#EA2831]">{formatINR(pnl.totalLoss)}</b> — see Stock Valuation for the breakdown.
              </p>
            )}
          </div>
        )} */}

        {/* Top Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <div className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 hover:shadow-md transition-all">
            <p className="text-stone-500 text-xs sm:text-sm font-medium mb-2">Total Products</p>
            <p className="text-2xl sm:text-3xl font-bold text-stone-900">{loading ? '...' : stats.totalProducts}</p>
          </div>
          <div className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 hover:shadow-md transition-all">
            <p className="text-stone-500 text-xs sm:text-sm font-medium mb-2">Active Products</p>
            <p className="text-2xl sm:text-3xl font-bold text-emerald-600">{loading ? '...' : stats.activeProducts}</p>
          </div>
          <div className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 hover:shadow-md transition-all">
            <p className="text-stone-500 text-xs sm:text-sm font-medium mb-2">Warehouses</p>
            <p className="text-2xl sm:text-3xl font-bold text-stone-900">{loading ? '...' : stats.warehouses}</p>
          </div>
          {canSeeSales ? (
            <div className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 hover:shadow-md transition-all">
              <p className="text-stone-500 text-xs sm:text-sm font-medium mb-2">Orders <span className="text-stone-300">· {PERIOD_LABEL[range]}</span></p>
              <p className="text-2xl sm:text-3xl font-bold text-stone-900">{sales.totalOrders.toLocaleString('en-IN')}</p>
            </div>
          ) : (
            <div className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 hover:shadow-md transition-all">
              <p className="text-stone-500 text-xs sm:text-sm font-medium mb-2">Pending Shipments</p>
              <p className="text-2xl sm:text-3xl font-bold text-stone-900">{opsData ? opsData.pending : '—'}</p>
            </div>
          )}
        </div>

        {/* Main Dashboard Layout.
           The right-hand widget column (Inventory status + Quick actions) has
           been removed, so this is a single full-width row now rather than a
           3-column grid with an empty third of the page. The panel below keeps
           its `lg:col-span-2`, which is harmless in a 1-column grid and means
           the shared operations/empty-state panels did not have to change. */}
        <div className="grid grid-cols-1 gap-6 sm:gap-8">

          {/* Left: Sales overview (sales roles) / Operations overview (ops roles) */}
          {canSeeSales ? (
          <div className="lg:col-span-2 bg-white border border-stone-200 rounded-xl p-5 sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-stone-900">Sales overview</h3>
            </div>
            <div className="flex gap-6 sm:gap-12 mb-8 border-b border-stone-100 pb-8 overflow-x-auto no-scrollbar">
              <div className="min-w-max">
                <p className="text-xs text-stone-500 mb-1 uppercase tracking-wider">Revenue</p>
                <p className="text-xl sm:text-2xl font-bold text-stone-900">₹{sales.weekRevenue.toLocaleString('en-IN')}</p>
                <p className="text-[10px] text-stone-400 font-medium">{PERIOD_LABEL[range]}</p>
              </div>
              <div className="min-w-max">
                <p className="text-xs text-stone-500 mb-1 uppercase tracking-wider">Units Sold</p>
                <p className="text-xl sm:text-2xl font-bold text-stone-900">{sales.weekUnits.toLocaleString('en-IN')}</p>
                <p className="text-[10px] text-stone-400 font-medium">{PERIOD_LABEL[range]}</p>
              </div>
              <div className="min-w-max">
                <p className="text-xs text-stone-500 mb-1 uppercase tracking-wider">Returns</p>
                <p className="text-xl sm:text-2xl font-bold text-stone-900">{sales.weekReturns.toLocaleString('en-IN')}</p>
                <p className="text-[10px] text-stone-400 font-medium">{PERIOD_LABEL[range]}</p>
              </div>
            </div>
            {/* EMPTY STATE. A period with no orders produces an all-zero series,
                and the chart draws the same flat baseline for every one of them —
                which reads as "the filter does nothing". Saying so explicitly
                distinguishes "no sales in this period" from a broken filter. */}
            {sales.weekly?.length > 0 && sales.weekly.every((p) => !p.units) && (
              <div className="mb-4 rounded-xl border border-stone-200 bg-stone-50/60 px-4 py-3">
                <p className="text-xs font-bold text-stone-600">No sales recorded {PERIOD_LABEL[range]}.</p>
                <p className="mt-0.5 text-[11px] text-stone-400">
                  The filter is applied — this period simply has no orders. Try a wider period such as Yearly.
                </p>
              </div>
            )}
            <div className="w-full h-40 sm:h-56 relative px-1">
              <div className="absolute inset-0 flex flex-col justify-between text-xs text-stone-100 pointer-events-none pb-8">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="border-b border-dashed border-stone-100 w-full"></div>
                ))}
              </div>
              <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 50">
                {trend.area && <path d={trend.area} fill="#EA2831" fillOpacity="0.08" stroke="none" />}
                <path d={trend.line} fill="none" stroke="#EA2831" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="flex justify-between mt-4 text-[10px] sm:text-xs text-stone-400 font-bold uppercase tracking-tighter">
                {(sales.weekly.length ? sales.weekly : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({ day })))
                  .map((d, i) => <span key={i}>{d.day}</span>)}
              </div>
            </div>
          </div>
          ) : (
            <OperationsOverviewPanel data={opsData} subscribed={isSubscribed} />
          )}

        </div>
      </div>
    </div>
  );
};

/**
 * Role-specific dashboard widgets, shown to managers in place of any
 * subscription/IMS-activation card (those are admin-only).
 *  - sales_manager:      Orders Today · Revenue (week) · Top Customers
 *  - operations_manager: Pending Shipments · Open Transfers · Warehouse Activity
 */
const RoleWidgets = ({ role }) => {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        if (role === 'sales_manager') {
          const [sumRes, custRes] = await Promise.allSettled([getOrderSummary(), getCustomers()]);
          const sum = sumRes.status === 'fulfilled' ? (sumRes.value?.data || {}) : {};
          const customers = custRes.status === 'fulfilled'
            ? (Array.isArray(custRes.value) ? custRes.value : custRes.value?.data || [])
            : [];
          const top = [...customers]
            .sort((a, b) => (b.totalSpend || b.orderCount || 0) - (a.totalSpend || a.orderCount || 0))
            .slice(0, 3);
          if (alive) setStats({
            kind: 'sales',
            rows: [
              { label: 'Orders (total)', value: sum.totalOrders ?? 0 },
              { label: 'Revenue (this week)', value: formatINR(sum.weekRevenue) },
              { label: 'Units sold (this week)', value: sum.weekUnits ?? 0 },
            ],
            top,
          });
        } else {
          const shipRes = await getTmsShipments().catch(() => null);
          const ships = Array.isArray(shipRes) ? shipRes : shipRes?.data || [];
          const pending = ships.filter((x) => ['draft', 'planned', 'approved', 'loading'].includes(x.status)).length;
          const open = ships.filter((x) => ['in_transit', 'arrived', 'verifying'].includes(x.status)).length;
          const recent = ships.slice(0, 3);
          if (alive) setStats({
            kind: 'ops',
            rows: [
              { label: 'Pending shipments', value: pending },
              { label: 'Open transfers (in transit)', value: open },
              { label: 'Total shipments', value: ships.length },
            ],
            recent,
          });
        }
      } catch { if (alive) setStats({ kind: 'none', rows: [] }); }
    };
    load();
    return () => { alive = false; };
  }, [role]);

  if (!stats) return <p className="text-sm text-stone-400 py-2">Loading…</p>;

  return (
    <div className="py-1">
      <div className="space-y-3">
        {stats.rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between text-sm">
            <span className="text-stone-600">{r.label}</span>
            <span className="font-bold text-stone-900">{r.value}</span>
          </div>
        ))}
      </div>
      {stats.kind === 'sales' && stats.top?.length > 0 && (
        <div className="mt-4 pt-3 border-t border-dashed border-stone-100">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">Top customers</p>
          {stats.top.map((c) => (
            <p key={c._id} className="text-sm text-stone-700 py-0.5">{c.name || c.customerName || '—'}</p>
          ))}
        </div>
      )}
      {stats.kind === 'ops' && stats.recent?.length > 0 && (
        <div className="mt-4 pt-3 border-t border-dashed border-stone-100">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">Warehouse activity</p>
          {stats.recent.map((sh) => (
            <p key={sh._id} className="text-sm text-stone-700 py-0.5 flex justify-between">
              <span className="truncate pr-2">{sh.toLabel}</span>
              <span className="text-xs text-stone-400">{sh.status}</span>
            </p>
          ))}
        </div>
      )}
      {stats.rows.length === 0 && <p className="text-sm text-stone-400">No activity yet.</p>}
    </div>
  );
};

/**
 * Operations-focused left panel for roles that can't see sales (e.g.
 * operations_manager). Shows shipments & transfers instead of revenue.
 */
const OperationsOverviewPanel = ({ data, subscribed }) => {
  if (!subscribed) {
    return (
      <div className="lg:col-span-2 bg-white border border-stone-200 rounded-xl p-5 sm:p-8 flex items-center justify-center">
        <p className="text-sm text-stone-400">Operations data appears once the IMS module is active.</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="lg:col-span-2 bg-white border border-stone-200 rounded-xl p-5 sm:p-8">
        <p className="text-sm text-stone-400">Loading operations…</p>
      </div>
    );
  }
  const tiles = [
    { label: 'Pending shipments', value: data.pending, accent: 'text-[#EA2831]' },
    { label: 'In transit', value: data.inTransit, accent: 'text-stone-900' },
    { label: 'Open transfers', value: data.openTransfers, accent: 'text-stone-900' },
    { label: 'Total shipments', value: data.totalShipments, accent: 'text-stone-900' },
  ];
  return (
    <div className="lg:col-span-2 bg-white border border-stone-200 rounded-xl p-5 sm:p-8">
      <h3 className="text-lg font-bold text-stone-900 mb-6">Operations overview</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8 border-b border-stone-100 pb-8">
        {tiles.map((t) => (
          <div key={t.label}>
            <p className="text-xs text-stone-500 mb-1 uppercase tracking-wider">{t.label}</p>
            <p className={`text-xl sm:text-2xl font-bold ${t.accent}`}>{t.value}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">Recent shipments</p>
      {data.recent?.length ? (
        <div className="divide-y divide-stone-50">
          {data.recent.map((sh) => (
            <div key={sh._id} className="flex items-center justify-between py-2.5 text-sm">
              <span className="text-stone-700 truncate pr-3">{sh.toLabel || sh.lrNumber || sh._id?.slice(-6)}</span>
              <span className="text-xs font-semibold text-stone-400 capitalize">{(sh.status || '').replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-stone-400">No shipments yet.</p>
      )}
    </div>
  );
};

export default CompanyDashboard;