import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import config from '../../../config/config';
import { useSubscription } from '../../context/SubscriptionContext';
import { getBillingHistory, formatINR, fmtDate } from '../../lib/imsApi';


// Default header content — shown when Billing is opened directly (no locked
// tab/feature to attribute), or for a module key we don't have copy for yet.
const DEFAULT_HEADER = {
  eyebrowIcon: 'lock_open',
  eyebrow: 'Unlock the Khetify IMS',
  heading: 'Manage your inventory like a pro',
  description:
    'Inventory management is a premium feature. Subscribe to unlock live stock ' +
    'tracking, alerts, multi-warehouse and more for your company.',
};

// Per-module header content, keyed by the SAME `key` used in lib/nav.js's
// MODULES list — so a locked tab/card can pass its module key and Billing
// shows a message that actually matches what the person tried to open,
// instead of always showing the Inventory copy.
const LOCKED_FEATURE_HEADERS = {
  inventory: {
    eyebrowIcon: 'inventory_2',
    eyebrow: 'Unlock Inventory',
    heading: 'Manage your inventory like a pro',
    description:
      'Inventory is a premium feature. Subscribe to unlock live stock levels, ' +
      'lot & batch tracking, low-stock alerts and more for your company.',
  },
  warehouses: {
    eyebrowIcon: 'warehouse',
    eyebrow: 'Unlock Warehouses',
    heading: 'Run every warehouse from one place',
    description:
      'Multi-warehouse management is a premium feature. Subscribe to track ' +
      'sites, capacity and stock across every warehouse your company operates.',
  },
  operations: {
    eyebrowIcon: 'sync_alt',
    eyebrow: 'Unlock Stock Transfers',
    heading: 'Move stock with confidence',
    description:
      'Stock transfers are a premium feature. Subscribe to receive, send, ' +
      'transfer and track stock between warehouses in real time.',
  },
  labels: {
    eyebrowIcon: 'qr_code_2',
    eyebrow: 'Unlock Barcodes & Labels',
    heading: 'Print barcodes for every lot',
    description:
      'Barcode & label generation is a premium feature. Subscribe to generate ' +
      'and print unit barcodes for every lot you receive.',
  },
  analytics: {
    eyebrowIcon: 'monitoring',
    eyebrow: 'Unlock Advanced Stock Valuation',
    heading: 'See the trends behind your stock',
    description:
      'Advanced stock valuation is a premium feature. Subscribe to unlock sales ' +
      'trends, movement history and inventory insights.',
  },
  admin: {
    eyebrowIcon: 'settings',
    eyebrow: 'Unlock Administration',
    heading: 'Manage your company at scale',
    description:
      'Administration tools are a premium feature. Subscribe to manage ' +
      'products, sellers, team and settings all in one place.',
  },
};

// What subscribing to the IMS unlocks — plain-English version of config/plans.js
const IMS_BENEFITS = [
  { icon: 'inventory',        title: 'Full Inventory Management',  desc: 'Live stock levels, status and stock value across every product.' },
  { icon: 'notifications_active', title: 'Low-stock & Reorder Alerts', desc: 'Get warned before you run out, with reorder thresholds per item.' },
  { icon: 'warehouse',        title: 'Multi-Warehouse',            desc: 'Track stock across multiple locations, not just one.' },
  { icon: 'lock_clock',       title: 'Reserved Stock Workflow',    desc: 'Hold stock against pending orders so you never oversell.' },
  { icon: 'local_shipping',   title: 'Supply Orders',              desc: 'Raise and track restock orders to your suppliers.' },
  { icon: 'event_available',  title: 'Batch & Expiry Tracking',    desc: 'Manage batches and expiry dates for perishable goods.' },
  { icon: 'monitoring',       title: 'Advanced Stock Valuation',   desc: 'Sales trends, movement history and inventory insights.' },
  { icon: 'sync',             title: 'Real-time Sync',             desc: 'Stock updates reflect instantly across the dashboard.' },
];

// Dummy pricing for the MVP demo. Replace with real plan/payment data later.
const PLANS = [
  {
    key: 'free', name: 'Free', price: 0, tagline: 'Get started',
    perks: ['Basic product catalog', 'Order stock deduction', 'Low-stock alerts', 'Up to 50 products'],
    highlight: false,
  },
  {
    key: 'pro', name: 'Pro', price: 999, tagline: 'Best for growing companies',
    perks: ['Everything in Free', 'Full Inventory Management', 'Multi-warehouse + Reserved stock', 'Supply orders & batch/expiry', 'Advanced stock valuation', 'Up to 5,000 products'],
    highlight: true,
  },
  {
    key: 'enterprise', name: 'Enterprise', price: 2999, tagline: 'For large operations',
    perks: ['Everything in Pro', 'Unlimited products & warehouses', 'AI forecasting', 'API access', 'Priority support'],
    highlight: false,
  },
];

const Billing = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { plan: currentPlan, refresh } = useSubscription();
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);

  // Which locked tab/feature sent the person here (if any) — passed via
  // navigate('/billing', { state: { fromKey, fromTitle } }) by the sidebar,
  // the Hub cards, etc. Falls back to the default IMS copy when Billing is
  // opened directly (no state) or the key has no dedicated message yet.
  const fromKey = location.state?.fromKey;
  const header = LOCKED_FEATURE_HEADERS[fromKey] || DEFAULT_HEADER;

  const loadHistory = () =>
    getBillingHistory().then((r) => r?.success && setHistory(r.data)).catch(() => {});
  useEffect(() => { loadHistory(); }, []);

  const subscribe = async (planKey) => {
    setError('');
    setBusyKey(planKey);
    try {
      const token = localStorage.getItem('token');
      // Backend already supports this: POST /api/subscription/change { plan }
      const { data } = await axios.post(
        `${config.BASE_URL}subscription/change`,
        { plan: planKey },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (data?.success) {
        await refresh();                 // re-pull plan so gates update everywhere
        if (planKey === 'free') navigate('/hub');
        else navigate('/inventory');     // straight into the unlocked feature
      } else {
        setError(data?.message || 'Could not update your plan.');
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Subscription failed. Please try again.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-[#f8f9fa] font-sora">
      <div className="max-w-6xl mx-auto space-y-10">
       

        {/* Header — content varies by which locked tab/feature sent the
            person here (see `header` above); identical layout/styling either way. */}
        <div className="text-center max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 text-[#EA2831] font-bold text-xs uppercase tracking-widest mb-3">
            <span className="material-symbols-outlined text-base">{header.eyebrowIcon}</span>
            {header.eyebrow}
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-stone-900 mb-3">
            {header.heading}
          </h1>
          <p className="text-stone-500">
            {header.description}
          </p>
        </div>

        {/* What you get */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {IMS_BENEFITS.map((b) => (
            <div key={b.title} className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
              <span className="material-symbols-outlined text-[#EA2831] text-2xl mb-3 block">{b.icon}</span>
              <h3 className="font-bold text-stone-900 text-sm mb-1">{b.title}</h3>
              <p className="text-xs text-stone-500 leading-relaxed">{b.desc}</p>
            </div>
          ))}
        </div>

        {/* Pricing */}
        <div>
          <h2 className="text-center text-lg font-bold text-stone-900 mb-6">Choose a plan</h2>
          {error && (
            <p className="text-center text-sm text-[#EA2831] font-semibold mb-4">{error}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PLANS.map((p) => {
              const isCurrent = currentPlan === p.key;
              return (
                <div
                  key={p.key}
                  className={`rounded-2xl p-6 border flex flex-col ${
                    p.highlight
                      ? 'border-[#EA2831] shadow-lg ring-1 ring-[#EA2831]/20 bg-white relative'
                      : 'border-stone-200 bg-white shadow-sm'
                  }`}
                >
                  {p.highlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#EA2831] text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full">
                      Most popular
                    </span>
                  )}
                  <p className="font-bold text-stone-900">{p.name}</p>
                  <p className="text-xs text-stone-400 mb-4">{p.tagline}</p>
                  <div className="mb-5">
                    <span className="text-3xl font-bold text-stone-900">₹{p.price.toLocaleString('en-IN')}</span>
                    <span className="text-sm text-stone-400 font-medium"> / month</span>
                  </div>
                  <ul className="space-y-2.5 mb-6 flex-1">
                    {p.perks.map((perk) => (
                      <li key={perk} className="flex items-start gap-2 text-sm text-stone-600">
                        <span className="material-symbols-outlined text-[#EA2831] text-base mt-0.5">check_circle</span>
                        {perk}
                      </li>
                    ))}
                  </ul>
                  <button
                    disabled={isCurrent || busyKey === p.key}
                    onClick={() => subscribe(p.key)}
                    className={`w-full py-3 rounded-xl text-sm font-bold transition-all ${
                      isCurrent
                        ? 'bg-stone-100 text-stone-400 cursor-default'
                        : p.highlight
                          ? 'bg-[#EA2831] text-white hover:bg-black'
                          : 'bg-stone-900 text-white hover:bg-black'
                    }`}
                  >
                    {isCurrent ? 'Current plan' : busyKey === p.key ? 'Processing…' : p.price === 0 ? 'Switch to Free' : `Subscribe — ₹${p.price.toLocaleString('en-IN')}/mo`}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-center text-xs text-stone-400 mt-6">
            Demo mode — no real payment is taken. Subscribing instantly switches your plan so you can try the IMS.
          </p>
        </div>

        {/* Billing history */}
        {history.length > 0 && (
          <div>
            <h2 className="text-center text-lg font-bold text-stone-900 mb-6">Billing history</h2>
            <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden max-w-3xl mx-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">
                    <th className="px-6 py-3">Invoice</th><th className="px-6 py-3">Plan</th>
                    <th className="px-6 py-3">Date</th><th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {history.map((pay) => (
                    <tr key={pay._id}>
                      <td className="px-6 py-3 font-bold text-stone-900">{pay.invoiceNo || '—'}</td>
                      <td className="px-6 py-3 text-stone-600 capitalize">{pay.plan}</td>
                      <td className="px-6 py-3 text-stone-500">{fmtDate(pay.paidAt)}</td>
                      <td className="px-6 py-3">
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-50 text-green-600 capitalize">{pay.status}</span>
                      </td>
                      <td className="px-6 py-3 text-right font-bold text-stone-900">{formatINR(pay.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Billing;