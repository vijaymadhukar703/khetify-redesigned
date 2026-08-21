import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getSellerLink, getSellerDashboardSummary, getSellerSupplyOrders, getSellerTransfers,
} from '../../lib/sellerApi';
import { formatINR } from '../../lib/imsApi';

// Supply-order status groups (mirror SellerSupply.jsx).
const PENDING = ['requested', 'under_review', 'approved', 'picking', 'packed'];
const IN_TRANSIT = ['dispatched', 'in_transit', 'arrived'];
const RECEIVED = ['received', 'partially_received', 'delivered'];


// Map a named range (or a custom from/to) to an ISO {from,to} window.
// Copied verbatim from CompanyDashboard so a period means the same number of
// days on both dashboards. "daily" = today; others count back from now.
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

/**
 * Is a record inside the selected window?
 *
 * THE FILTERING HAPPENS HERE, IN THE PAGE, and that is deliberate. The seller
 * supply-order and transfer endpoints return the full list and take no date
 * params, so rather than change those APIs the arrays we already hold are
 * narrowed by `createdAt`. It is the SAME real data — nothing is fabricated and
 * no request shape changed.
 *
 * A custom range with an empty end is treated as open-ended rather than
 * matching nothing, so the numbers do not blank out mid-entry.
 */
const inWindow = (dateish, win) => {
  if (!win.from && !win.to) return true;
  const t = new Date(dateish || 0).getTime();
  if (!t) return false;
  if (win.from && t < new Date(win.from).getTime()) return false;
  if (win.to && t > new Date(win.to).getTime()) return false;
  return true;
};

// Seller Dashboard — the warehouse manager's at-a-glance view. Mirrors the
// company CompanyDashboard (KPI strip + operations overview + inventory status +
// quick actions) but seller-scoped; for a seller_manager every number is
// limited to their assigned warehouse(s) by the backend (warehouseScope).
const SellerDashboard = () => {
  const navigate = useNavigate();

  // Selected period. Defaults to weekly, matching the company dashboard.
  const [range, setRange] = useState('weekly');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const rangeWindow = useMemo(() => rangeToWindow(range, customRange), [range, customRange]);

  const [approved, setApproved] = useState(null);
  const [kpi, setKpi] = useState(null);
  const [supply, setSupply] = useState([]);
  const [transfers, setTransfers] = useState([]);

  useEffect(() => {
    let alive = true;
    getSellerLink()
      .then((r) => {
        const ok = r?.data?.linkStatus === 'approved';
        if (!alive) return;
        setApproved(ok);
        if (!ok) return;
        getSellerDashboardSummary().then((s) => { if (alive && s?.success) setKpi(s.data); }).catch(() => {});
        getSellerSupplyOrders().then((s) => { if (alive && s?.success) setSupply(s.data || []); }).catch(() => {});
        getSellerTransfers().then((t) => { if (alive && t?.success) setTransfers(t.data || []); }).catch(() => {});
      })
      .catch(() => { if (alive) setApproved(false); });
    return () => { alive = false; };
  }, []);

  // Supply orders raised inside the selected period. Status grouping is
  // unchanged — only the set of orders it runs over is narrowed.
  const periodSupply = useMemo(
    () => supply.filter((o) => inWindow(o.createdAt, rangeWindow)),
    [supply, rangeWindow],
  );
  const periodTransfers = useMemo(
    () => transfers.filter((t) => inWindow(t.createdAt, rangeWindow)),
    [transfers, rangeWindow],
  );

  const ops = useMemo(() => {
    const pending = periodSupply.filter((o) => PENDING.includes(o.status)).length;
    const inTransit = periodSupply.filter((o) => IN_TRANSIT.includes(o.status)).length;
    const received = periodSupply.filter((o) => RECEIVED.includes(o.status)).length;
    return { pending, inTransit, received, total: periodSupply.length, recent: periodSupply.slice(0, 5) };
  }, [periodSupply]);

  const openShipments = ops.pending + ops.inTransit;

  if (approved === null) return <div className="flex-1 p-8 text-center text-stone-400 bg-[#f8f9fa] font-sora">Loading…</div>;
  if (!approved) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-[#f8f9fa] font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center shadow-sm">
          <span className="material-symbols-outlined text-amber-500 text-4xl">lock</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Dashboard is locked</h2>
          <p className="text-sm text-amber-700 mt-1">Available after your supplying company approves you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-[#f8f9fa] font-sora">
      <div className="max-w-[1400px] mx-auto space-y-6 sm:space-y-8">
        {/* TIME-RANGE FILTER — same control, markup and placement as the company
            dashboard: above the headline cards, so it reads as the period for
            the page rather than for one panel.

            WHAT IT ACTUALLY FILTERS: supply orders and transfers, by the date
            they were raised. Open Shipments and the whole Operations overview
            move with it. Stock Value, Expiring and Lots in Stock deliberately do
            NOT — those are point-in-time inventory readings (what is on the
            shelf right now), not activity over a period, so a date range has no
            meaning for them. They are labelled below to say so. */}
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
            {/* The window actually being applied. Without it there is no way to
                tell a filter that is not working from a period that simply has
                no activity in it — both look like "nothing changed". */}
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
          <div className="flex items-center gap-4 text-sm">
            <span className="text-stone-500">Supply orders <b className="text-stone-900">{ops.total}</b></span>
            <span className="text-stone-500">Transfers <b className="text-stone-900">{periodTransfers.length}</b></span>
          </div>
        </div>

        {/* HEADLINE KPI STRIP — the company dashboard's card language exactly:
            rounded-2xl, a plain accented icon rather than a tinted tile, and a
            per-metric accent colour so the four are scannable at a glance.
            Same four metrics, same data. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard icon="inventory_2" label="Stock Value" value={kpi ? formatINR(kpi.stockValue) : '—'} accent="text-stone-400" />
          <KpiCard icon="schedule" label="Expiring (≤90d)" value={kpi ? formatINR(kpi.expiringValue) : '—'} accent="text-orange-400" />
          <KpiCard icon="local_shipping" label={`Open Shipments · ${PERIOD_LABEL[range]}`} value={openShipments} accent="text-blue-400" />
          <KpiCard icon="package_2" label="Lots in Stock" value={kpi?.lots ?? '—'} accent="text-green-500" />
        </div>

        {/* TOP STATS GRID — four separate cards, exactly the company dashboard's
            second row (same rounded-xl, same p-5 sm:p-6, same hover:shadow-md,
            same label and 2xl/3xl number sizes). A single flat panel read as a
            much lighter element than the company's row and was the main reason
            the two dashboards looked unrelated. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <div className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 hover:shadow-md transition-all">
            <p className="text-stone-500 text-xs sm:text-sm font-medium mb-2">Total Lots</p>
            <p className="text-2xl sm:text-3xl font-bold text-stone-900">{kpi?.totalLots ?? '—'}</p>
          </div>
          <div className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 hover:shadow-md transition-all">
            <p className="text-stone-500 text-xs sm:text-sm font-medium mb-2">Low Stock Items</p>
            <p className="text-2xl sm:text-3xl font-bold text-[#EA2831]">{kpi?.lowStock ?? '—'}</p>
          </div>
          <div className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 hover:shadow-md transition-all">
            <p className="text-stone-500 text-xs sm:text-sm font-medium mb-2">Out of Stock</p>
            <p className="text-2xl sm:text-3xl font-bold text-[#EA2831]">{kpi?.outOfStock ?? '—'}</p>
          </div>
          <div className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 hover:shadow-md transition-all">
            <p className="text-stone-500 text-xs sm:text-sm font-medium mb-2">Pending Supply <span className="text-stone-300">· {PERIOD_LABEL[range]}</span></p>
            <p className="text-2xl sm:text-3xl font-bold text-stone-900">{ops.pending}</p>
          </div>
        </div>

        {/* The right-hand widget column (Inventory status + Quick actions) has
            been removed, so this is one full-width row rather than a 3-column
            grid with an empty third. The panel keeps `lg:col-span-2`, which is
            a no-op in a 1-column grid. */}
        <div className="grid grid-cols-1 gap-6 sm:gap-8">
          {/* OPERATIONS OVERVIEW — same panel chrome as the company dashboard:
              rounded-2xl with a shadow, a small bold heading with a grey
              sub-line, and a red arrow link to the full screen. */}
          {/* OPERATIONS OVERVIEW — the company "Sales overview" panel shape:
              rounded-xl with p-5 sm:p-8, an 18px heading, and the figure row as
              a horizontally scrollable strip of large numbers with a small
              caption under each. The compact version read as a footnote next to
              the company's panel. */}
          <div className="lg:col-span-2 bg-white border border-stone-200 rounded-xl p-5 sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-stone-900">Stock Valuation overview</h3>
              <button onClick={() => navigate('/seller/operations')}
                className="text-xs font-bold text-[#EA2831] hover:text-black transition-colors flex items-center gap-1">
                Stock Valuation <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </button>
            </div>

            <div className="flex gap-6 sm:gap-12 mb-8 border-b border-stone-100 pb-8 overflow-x-auto no-scrollbar">
              {[
                { label: 'Pending supply', value: ops.pending, accent: 'text-[#EA2831]' },
                { label: 'In transit', value: ops.inTransit, accent: 'text-stone-900' },
                { label: 'Transfers', value: periodTransfers.length, accent: 'text-stone-900' },
                { label: 'Total supply orders', value: ops.total, accent: 'text-stone-900' },
              ].map((t) => (
                <div key={t.label} className="min-w-max">
                  <p className="text-xs text-stone-500 mb-1 uppercase tracking-wider">{t.label}</p>
                  <p className={`text-xl sm:text-2xl font-bold ${t.accent}`}>{t.value}</p>
                  <p className="text-[10px] text-stone-400 font-medium">{PERIOD_LABEL[range]}</p>
                </div>
              ))}
            </div>

            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">Recent supply orders</p>
            {ops.recent.length ? (
              <div className="divide-y divide-stone-100">
                {ops.recent.map((o) => (
                  <div key={o._id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate text-stone-700">
                      {(o.items || []).length} item(s) → {o.warehouseId?.name || 'warehouse'}
                    </span>
                    {/* A status pill rather than grey text, matching how status
                        reads everywhere else in the seller portal. */}
                    <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-bold capitalize text-stone-600">
                      {(o.status || '').replace(/_/g, ' ')}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-3 text-sm text-stone-400">No supply orders yet.</p>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

/* A headline metric card, identical in shape to the company dashboard's
   (Components/ims/SummaryCards). The value keeps `break-words` because a seller
   stock value can be long enough to overflow a half-width card on mobile. */
/* Byte-for-byte the company's headline card (Components/ims/SummaryCards):
   rounded-2xl, p-5, shadow-sm, a plain 3xl accented icon and an 11px uppercase
   label over a 20px value. `min-w-0` + `break-words` are the only additions —
   a seller stock value can be long enough to overflow a half-width card on a
   phone, which the company card never has to handle. */
const KpiCard = ({ icon, label, value, accent }) => (
  <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm flex items-center gap-4 min-w-0">
    <span className={`material-symbols-outlined text-3xl shrink-0 ${accent || 'text-stone-400'}`}>{icon}</span>
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 truncate">{label}</p>
      <p className="text-xl font-bold text-stone-900 leading-tight break-words">{value}</p>
    </div>
  </div>
);



export default SellerDashboard;