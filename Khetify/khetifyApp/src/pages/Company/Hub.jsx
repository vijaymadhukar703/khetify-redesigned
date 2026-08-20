import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { useSubscription, FEATURES } from '../../context/SubscriptionContext';
import { usePermission } from '../../context/PermissionContext';
import { MODULES } from '../../lib/nav';
import {
  getDashboardSummary,
  getOrderSummary,
  getWarehouses,
  getOrders,
  getLots,
  getTmsShipments,
  dispatchShipment,
  getSupplyPendingCount,
  getCompany,
  formatINR,
} from '../../lib/imsApi';
import { ManifestModal, ReceiveModal } from '../../Components/ims/TransferModals';
import { useNotifications } from '../../hooks/useNotifications';
import HomeUpdates from '../../Components/HomeUpdates';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);

// Map a company notification to the page where the user acts on it. Every type
// resolves to a real destination so the Home feed is always click-through.
function companyNotifRoute(n) {
  const kind = n?.payload?.kind || '';
  if (kind.startsWith('pc_')) return '/pc-applications';
  if (kind.startsWith('seller_link')) return '/sellers';
  if (kind === 'supply_request' || kind.startsWith('supply_') || n?.type === 'supply_status') return '/supply-requests';
  if (kind === 'transfer_incoming' || n?.type === 'shipment') return '/operations?tab=shipments';
  if (n?.type === 'order') return '/orders';
  if (n?.type === 'low_stock' || n?.type === 'expiry') return '/inventory';
  return '/notifications';
}

// Oversight (admin) view of a transfer's lifecycle: a single read-only pill
// that follows the shipment from awaiting-dispatch → dispatched → delivered.
function transferLabel(status) {
  if (['planned', 'approved', 'loading'].includes(status)) return 'Awaiting dispatch';
  if (['in_transit', 'arrived', 'verifying'].includes(status)) return 'Dispatched';
  if (['received', 'partially_received', 'delivered'].includes(status)) return 'Delivered';
  return status;
}
const transferPillCls = (status) => {
  if (['in_transit', 'arrived', 'verifying'].includes(status)) return 'text-amber-600 bg-amber-50';
  if (['received', 'partially_received', 'delivered'].includes(status)) return 'text-green-600 bg-green-50';
  return 'bg-stone-100 text-stone-500'; // awaiting dispatch / fallback
};

const DISPATCH_STATUSES = ['planned', 'approved', 'loading'];
const RECEIVE_STATUSES = ['in_transit', 'arrived', 'verifying'];
const OVERVIEW_STATUSES = [...DISPATCH_STATUSES, ...RECEIVE_STATUSES, 'received', 'partially_received', 'delivered'];

// The Hub is the post-login landing screen: a compact KPI strip plus a grid of
// module cards. It replaces the old left sidebar as the primary navigation.
// Cards are gated exactly like the old menu (capability + subscription), so a
// role/plan never sees a module it cannot use.

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const Hub = () => {
  const navigate = useNavigate();
  const { has, plan, loading: subLoading } = useSubscription();
  const { can, role, warehouseIds, loading: permLoading } = usePermission();
  // Live updates feed (same role-scoped notifications as the header bell).
  const { items: updates, unread, markRead, markAll } = useNotifications();

  const isSubscribed = !!plan && plan !== 'free';
  const imsActive = !subLoading && isSubscribed;
  // operations_manager has no order:read → never sees revenue/orders KPIs.
  const canSeeSales = !permLoading && can('order:read');

  // Company approval gate: the full Hub (KPIs, modules, transfers) is only shown
  // once the company is "approved". Until then we render a plain "under review"
  // message so the user isn't dropped into an empty/unusable dashboard.
  const companyId = localStorage.getItem('companyId');
  const [companyStatus, setCompanyStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!companyId) { setStatusLoading(false); return; }
    getCompany(companyId)
      .then((c) => { if (alive) setCompanyStatus(c?.status ?? null); })
      .catch(() => {})
      .finally(() => { if (alive) setStatusLoading(false); });
    return () => { alive = false; };
  }, [companyId]);

  const isApproved = companyStatus === 'approved';

  // Per-card KPI + pending counts. Best-effort: every call degrades to nothing
  // on failure so the Hub always renders.
  const [kpi, setKpi] = useState({});
  const [counts, setCounts] = useState({});
  // Seller supply requests awaiting this company's action (Home banner).
  const [supplyPending, setSupplyPending] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [summary, orderSummary] = await Promise.all([
        getDashboardSummary().catch(() => null),
        getOrderSummary().catch(() => null),
      ]);
      if (!alive) return;
      setKpi({
        revenue: orderSummary?.data?.weekRevenue ?? summary?.data?.todaySales ?? 0,
        orders: orderSummary?.data?.totalOrders ?? summary?.data?.todayOrders ?? 0,
        stockValue: summary?.data?.stockValue ?? 0,
        alerts: (summary?.data?.expiringValue ? 1 : 0),
        openShipments: summary?.data?.openShipments ?? 0,
      });
    })();
    return () => { alive = false; };
  }, []);

  // Module-level counts only when the IMS module is active (avoids 403 noise).
  useEffect(() => {
    if (!imsActive) return;
    let alive = true;
    (async () => {
      const [whs, lots, pendingOrders, supply] = await Promise.all([
        getWarehouses().catch(() => null),
        getLots({ limit: 500 }).catch(() => null),
        getOrders({ status: 'pending' }).catch(() => null),
        getSupplyPendingCount().catch(() => null),
      ]);
      if (!alive) return;
      setSupplyPending(supply?.data?.pendingCount || 0);
      const lotRows = lots?.data || lots || [];
      const lowStock = Array.isArray(lotRows)
        ? lotRows.filter((l) => (l.availableStock ?? l.qty ?? 0) <= (l.reorderPoint ?? 0)).length
        : 0;
      setCounts({
        warehouses: (whs?.data || whs || []).length || 0,
        lots: Array.isArray(lotRows) ? lotRows.length : 0,
        lowStock,
        pendingOrders: (pendingOrders?.data || pendingOrders || []).length || 0,
      });
    })();
    return () => { alive = false; };
  }, [imsActive]);

  // Pending transfers panel: act-in-place from the Hub so neither the sender
  // (dispatch) nor the receiver (receive) has to hunt through Operations.
  const [transfers, setTransfers] = useState([]);
  const [manifest, setManifest] = useState(null); // { qrPayload } after dispatch / re-open
  const [receive, setReceive] = useState(null);    // shipment being received

  const loadTransfers = () => {
    if (!imsActive) return;
    getTmsShipments().then((r) => setTransfers(listOf(r))).catch(() => {});
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadTransfers(); }, [imsActive]);

  // Operator (assigned to ≥1 warehouse) vs admin (unscoped → oversight only).
  const myWh = (warehouseIds || []).map(String);
  const isOperator = myWh.length > 0;
  const isAdmin = !isOperator;
  const fromId = (s) => String(s.fromWarehouseId?._id || s.fromWarehouseId || '');
  const toId = (s) => String(s.toWarehouseId?._id || s.toWarehouseId || '');
  const xfers = transfers.filter((s) => s.refType === 'Transfer');

  // Operator: only the transfers that need an action from THEIR warehouse —
  // dispatch (their outgoing, pre-transit) or receive (their incoming, in-transit).
  const toAct = isOperator
    ? xfers.filter((s) =>
      (myWh.includes(fromId(s)) && DISPATCH_STATUSES.includes(s.status)) ||
      (myWh.includes(toId(s)) && RECEIVE_STATUSES.includes(s.status)))
    : [];
  // Admin: read-only overview of all active + just-completed transfers, newest first.
  const overview = isAdmin
    ? xfers
      .filter((s) => OVERVIEW_STATUSES.includes(s.status))
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 8)
    : [];
  const transferRows = isAdmin ? overview : toAct;
  const showTransfers = imsActive && transferRows.length > 0;

  const dispatchTransfer = async (s) => {
    try {
      const dres = await dispatchShipment(s._id);
      const info = dres?.data || dres;
      toast('success', 'Transfer dispatched — stock is now in transit');
      setManifest({ qrPayload: info?.qrPayload || `${s._id}.${s.qrToken || ''}` });
      loadTransfers();
    } catch (err) { apiError(err); }
  };

  // Build the per-card { metric, pending } descriptor.
  const cardMeta = useMemo(() => ({
    dashboard: { metric: canSeeSales ? (kpi.revenue != null ? formatINR(kpi.revenue) : '—') : 'Overview', metricLabel: canSeeSales ? 'this week' : '' },
    inventory: { metric: counts.lots != null ? `${counts.lots} lots` : '—', pending: counts.lowStock ? `${counts.lowStock} low stock` : null },
    'upload-product': { metric: 'Add product' },
    'product-catalog': { metric: 'Browse & edit' },
    warehouses: { metric: counts.warehouses != null ? `${counts.warehouses} sites` : '—' },
    operations: { metric: kpi.openShipments != null ? `${kpi.openShipments} shipments` : '—', pending: kpi.openShipments ? 'in transit' : null },
    labels: { metric: 'Generate & print' },
    orders: { metric: kpi.orders != null ? `${kpi.orders} orders` : '—', pending: counts.pendingOrders ? `${counts.pendingOrders} to approve` : null },
    'order-history': { metric: 'All activity' },
    analytics: { metric: 'Reports' },
    admin: { metric: 'Products · Team' },
  }), [kpi, counts, canSeeSales]);

  // Two distinct gates:
  //  - HIDE (RBAC): a role without the capability never sees the card. The
  //    optional `roles` / `hideForRoles` pins narrow it further for modules a
  //    wildcard role shouldn't get — kept in step with the sidebar's visible()
  //    in Components/DashboardLayout.jsx so a card and its menu entry never
  //    disagree.
  //  - LOCK (subscription): a premium module the plan hasn't unlocked is shown
  //    but gated, routing to Billing — so users can see what an upgrade unlocks.
  const visible = (m) =>
    !(m.capability && !permLoading && !can(m.capability)) &&
    !(m.roles && !permLoading && !m.roles.includes(role)) &&
    !(m.hideForRoles && !permLoading && m.hideForRoles.includes(role));
  const locked = (m) => {
    if (m.feature === 'ims') return !imsActive;                         // any paid plan unlocks IMS
    if (m.feature === FEATURES.API_ACCESS) return !has(FEATURES.API_ACCESS);
    return false;                                                       // feature:null -> always open
  };

  const cards = MODULES.filter(visible);
  const userName = localStorage.getItem('userName') || '';

  // One panel, rendered ABOVE the cards for operators ("needing you", with
  // action buttons) and BELOW the cards for admins ("Transfers", read-only pills).
  const transfersPanel = (
    <div className="bg-white border border-stone-200 rounded-2xl shadow-sm mb-8 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-stone-100">
        <span className="material-symbols-outlined text-[#EA2831]">sync_alt</span>
        <h2 className="font-bold text-stone-900">{isAdmin ? 'Transfers' : 'Transfers needing you'}</h2>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#EA2831] bg-[#EA2831]/10 rounded-full px-2.5 py-1">
          {transferRows.length}
        </span>
      </div>
      <div className="divide-y divide-stone-100">
        {transferRows.map((s) => {
          const canDispatchRow = isOperator && myWh.includes(fromId(s)) && DISPATCH_STATUSES.includes(s.status);
          const canReceiveRow = isOperator && myWh.includes(toId(s)) && RECEIVE_STATUSES.includes(s.status);
          return (
            <div key={s._id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-stone-900 truncate">
                  {s.fromLabel || 'Source'} <span className="text-stone-300">→</span> {s.toLabel}
                </p>
                <p className="text-[11px] text-stone-400">{(s.lines || []).length} lot(s)</p>
              </div>
              {canDispatchRow && (
                <button onClick={() => dispatchTransfer(s)}
                  className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full bg-[#EA2831] text-white hover:bg-[#d11f28] transition-colors">
                  Dispatch
                </button>
              )}
              {canReceiveRow && (
                <button onClick={() => setReceive(s)}
                  className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors">
                  Receive
                </button>
              )}
              {isAdmin && (
                <span className={`shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full ${transferPillCls(s.status)}`}>
                  {transferLabel(s.status)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // Gate: until the company is approved, show only a plain status message.
  if (statusLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-16 text-center text-stone-500">
        Loading…
      </div>
    );
  }

  if (!isApproved) {
    const rejected = companyStatus === 'rejected';
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-8 py-20">
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-10 text-center">
          <h1 className="text-2xl font-bold text-stone-900 mb-3 text-[#EA2A33]">
            {rejected ? 'Your company was not approved' : 'Your account is under review'}
          </h1>
          <p className="text-stone-500 leading-relaxed">
            {rejected
              ? 'Unfortunately your company details could not be verified. Please review your submission or contact support for help.'
              : 'Our team is reviewing your company details. You’ll get access to your dashboard once the verification is complete.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8">
      {/* Heading */}
      <div className="mb-7">
        <h1 className="text-2xl sm:text-3xl font-bold text-stone-900">
          {greeting()}{userName ? `, ${userName.split(' ')[0]}` : ''}
        </h1>
        <p className="text-stone-500 mt-1">Here is your business at a glance. Pick a module to get started.</p>
      </div>

      {/* Seller supply requests — surfaced at the TOP of Home; hidden when zero. */}
      {supplyPending > 0 && (
        <div className="mb-6 flex items-center gap-3 bg-[#EA2831]/5 border border-[#EA2831]/30 rounded-2xl p-4">
          <span className="material-symbols-outlined text-[#EA2831]">inventory</span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-stone-900 text-sm">
              {supplyPending} seller supply request{supplyPending > 1 ? 's' : ''} need{supplyPending > 1 ? '' : 's'} action
            </p>
            <p className="text-xs text-stone-500">Dealers are requesting bulk supply of your products — assign a warehouse and approve.</p>
          </div>
          <button onClick={() => navigate('/supply-requests')} className="shrink-0 text-xs font-bold px-4 py-2 rounded-lg bg-[#EA2831] text-white hover:bg-[#d11f28] transition-colors">
            Review requests
          </button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {canSeeSales ? (
          <>
            <KpiTile label="Revenue (week)" value={formatINR(kpi.revenue || 0)} accent="text-stone-900" />
            <KpiTile label="Orders" value={kpi.orders ?? 0} accent="text-stone-900" />
            <KpiTile label="Inventory value" value={formatINR(kpi.stockValue || 0)} accent="text-stone-900" />
            <KpiTile label="Alerts" value={(counts.lowStock || 0) + (kpi.alerts || 0)} accent="text-[#EA2831]" />
          </>
        ) : (
          <>
            <KpiTile label="Inventory value" value={formatINR(kpi.stockValue || 0)} accent="text-stone-900" />
            <KpiTile label="Open shipments" value={kpi.openShipments ?? 0} accent="text-stone-900" />
            <KpiTile label="Lots" value={counts.lots ?? 0} accent="text-stone-900" />
            <KpiTile label="Alerts" value={(counts.lowStock || 0) + (kpi.alerts || 0)} accent="text-[#EA2831]" />
          </>
        )}
      </div>

      {/* Operators act in place (dispatch / receive) — panel sits above the cards */}
      {isOperator && showTransfers && transfersPanel}

      {/* Updates — every role's live activity feed, right on Home */}
      <div className="mb-8">
        <HomeUpdates items={updates} unread={unread} markRead={markRead} markAll={markAll} resolveRoute={companyNotifRoute} fallbackRoute="/notifications" />
      </div>

      {/* Module cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {cards.map((m) => {
          const meta = cardMeta[m.key] || {};
          const isLocked = locked(m);
          return (
            <button
              key={m.key}
              onClick={() => (isLocked ? navigate('/billing', { state: { fromKey: m.key, fromTitle: m.title } }) : navigate(m.path))}
              aria-disabled={isLocked}
              title={isLocked ? 'Upgrade to unlock' : undefined}
              className={`group text-left bg-white border border-stone-200 rounded-2xl p-6 shadow-sm transition-all ${
                isLocked ? 'opacity-90 hover:border-stone-300' : 'hover:shadow-md hover:border-[#EA2831]/40'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${
                  isLocked ? 'bg-stone-100 text-stone-400' : 'bg-[#EA2831]/10 text-[#EA2831]'
                }`}>
                  <span className="material-symbols-outlined text-[26px]">{m.icon}</span>
                </div>
                {isLocked ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-stone-500 bg-stone-100 rounded-full px-2.5 py-1">
                    <span className="material-symbols-outlined text-[13px]">lock</span> Pro
                  </span>
                ) : meta.pending && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#EA2831] bg-[#EA2831]/10 rounded-full px-2.5 py-1">
                    {meta.pending}
                  </span>
                )}
              </div>
              <h3 className="text-lg font-bold text-stone-900 mb-1">{m.title}</h3>
              <p className="text-sm text-stone-500 leading-snug mb-4">{m.description}</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-stone-700 truncate min-w-0">
                  {isLocked
                    ? <span className="text-stone-500 font-medium">Upgrade to unlock</span>
                    : <>{meta.metric}{meta.metricLabel ? <span className="text-stone-400 font-medium"> · {meta.metricLabel}</span> : null}</>}
                </span>
                {isLocked ? (
                  <span className="material-symbols-outlined text-stone-300 shrink-0">lock</span>
                ) : (
                  <span className="material-symbols-outlined text-stone-300 group-hover:text-[#EA2831] group-hover:translate-x-0.5 transition-all shrink-0">
                    arrow_forward
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Admins watch only — read-only overview panel sits below the cards,
          spaced off the module grid like every other section. */}
      {isAdmin && showTransfers && <div className="mt-8">{transfersPanel}</div>}

      {manifest && <ManifestModal info={manifest} onClose={() => setManifest(null)} />}
      {receive && <ReceiveModal shipment={receive} onClose={() => setReceive(null)} onDone={() => { setReceive(null); loadTransfers(); }} />}
    </div>
  );
};

const KpiTile = ({ label, value, accent }) => (
  // min-w-0 lets the tile shrink inside the grid; break-words + a smaller font
  // on phones keep long currency values (e.g. ₹28,80,42,060) inside the card
  // instead of forcing the page to scroll sideways.
  <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm min-w-0">
    <p className="text-stone-400 text-[10px] font-bold uppercase mb-2 tracking-wider truncate">{label}</p>
    <p className={`text-xl sm:text-2xl font-bold leading-tight break-words ${accent}`}>{value}</p>
  </div>
);

export default Hub;