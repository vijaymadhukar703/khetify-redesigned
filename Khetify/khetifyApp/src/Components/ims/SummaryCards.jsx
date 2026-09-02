import React, { useEffect, useState } from 'react';
import { getDashboardSummary, formatINR } from '../../lib/imsApi';
import { usePermission } from '../../context/PermissionContext';

/**
 * The headline IMS numbers for the company dashboard. Self-contained: fetches
 * /api/reports/dashboard. Renders nothing if the call fails (e.g. no token).
 * The sales card is hidden for roles without order:read (e.g. operations_manager).
 */
const Card = ({ icon, label, value, accent }) => (
  <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm flex items-center gap-4">
    <span className={`material-symbols-outlined text-3xl ${accent}`}>{icon}</span>
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
      <p className="text-xl font-bold text-stone-900">{value}</p>
    </div>
  </div>
);

/**
 * `params` is the selected period ({from, to}) from whichever dashboard renders
 * this. It is OPTIONAL: called with nothing, the request is exactly the one this
 * component always made and the numbers are unchanged, so any other caller keeps
 * working untouched.
 *
 * `periodLabel` only captions the Sales tile ("this week"); it changes no data.
 */
const SummaryCards = ({ params, periodLabel }) => {
  const [d, setD] = useState(null);
  const { can, loading } = usePermission();
  const canSeeSales = !loading && (can('order:read') || can('shipment:read'));
  // Re-fetches when the period changes. The two values are read individually so
  // a caller passing a fresh object literal each render does not loop.
  const from = params?.from;
  const to = params?.to;
  useEffect(() => {
    getDashboardSummary({ ...(from && { from }), ...(to && { to }) })
      .then((r) => r?.success && setD(r.data))
      .catch(() => {});
  }, [from, to]);
  if (!d) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card icon="inventory_2" label="Stock Value" value={formatINR(d.stockValue)} accent="text-stone-400" />
      <Card icon="schedule" label="Expiring (≤90d)" value={formatINR(d.expiringValue)} accent="text-orange-400" />
      <Card icon="local_shipping" label="Open Shipments" value={d.openShipments} accent="text-blue-400" />
      {canSeeSales && (
        /* SALES = value dispatched to SELLERS in the selected period, valued at
           product MRP × quantity (`supplySales` from the dashboard endpoint).
           Company-wide for an admin; for a warehouse-scoped manager the server
           narrows it to stock that left THEIR warehouse.
           This is deliberately NOT `todaySales`, which is customer-order revenue
           — a different money flow, still powering the Sales overview panel. */
        <Card
          icon="payments"
          label={periodLabel ? `Sales · ${periodLabel}` : 'Sales'}
          value={formatINR(d.supplySales ?? 0)}
          accent="text-green-500"
        />
      )}
    </div>
  );
};

export default SummaryCards;