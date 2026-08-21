import React, { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { getSellerPlans, changeSellerPlan } from '../../lib/sellerApi';
import { useSellerSubscription } from '../../context/SellerSubscriptionContext';
import { useSellerPermission } from '../../context/SellerPermissionContext';


const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });

const FEATURE_LABEL = {
  basic_catalog: 'Product catalog', supply_workflow: 'Inbound supply', order_deduction: 'Outbound sales',
  low_stock_alerts: 'Low-stock alerts', inventory_view: 'Inventory views (stock / lots / batches)',
  multi_warehouse: 'Unlimited warehouses', unit_labels: 'Unit labels (print & scan)', batch_expiry: 'Batch & expiry tracking',
  reserved_stock: 'Reserved stock', advanced_analytics: 'Analytics',
};
const PLAN_PRICE = { free: '₹0', pro: '₹999 / mo', enterprise: 'Contact us' };

const SellerBilling = () => {
  const { sellerPlan, refresh } = useSellerSubscription();
  const canManage = useSellerPermission('billing:manage'); // seller_admin only
  const [plans, setPlans] = useState({});
  const [busy, setBusy] = useState('');

  useEffect(() => { getSellerPlans().then((r) => setPlans(r?.data || {})).catch(() => {}); }, []);

  const choose = async (key) => {
    if (key === sellerPlan || !canManage) return;
    setBusy(key);
    try { await changeSellerPlan(key); await refresh(); toast('success', `Switched to ${key}`); }
    catch (err) { toast('error', err?.response?.data?.message || 'Could not change plan'); }
    finally { setBusy(''); }
  };

  const fmtLimit = (v) => (v === null || v === undefined || v === Infinity || v > 1e6 ? 'Unlimited' : v);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 font-sora">
     
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Billing &amp; Usage</h1>
      <p className="text-stone-500 mb-6">
        You are on the <b className="text-stone-800 capitalize">{sellerPlan}</b> plan.
        {canManage ? ' Upgrade to unlock Inventory, Labels, unlimited warehouses and Analytics.' : ' This plan applies to your whole team.'}
      </p>

      {!canManage && (
        <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <span className="material-symbols-outlined text-amber-500">info</span>
          <div>
            <p className="font-bold text-amber-800 text-sm">Only your seller admin can change the plan</p>
            <p className="text-xs text-amber-700">You can see the current plan and what it unlocks. Ask your seller admin to upgrade if you need a paid module.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {Object.entries(plans).map(([key, p]) => {
          const isCurrent = key === sellerPlan;
          const feats = p.features === 'ALL'
            ? ['Everything in Pro', 'All current & future features']
            : (p.features || []).map((f) => FEATURE_LABEL[f] || f);
          return (
            <div key={key} className={`rounded-2xl border p-6 shadow-sm flex flex-col ${isCurrent ? 'border-[#EA2831] ring-2 ring-[#EA2831]/20' : 'border-stone-200'}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-stone-900">{p.label || key}</h3>
                {isCurrent && <span className="text-[10px] font-bold uppercase tracking-wider text-[#EA2831] bg-[#EA2831]/10 rounded-full px-2 py-0.5">Current</span>}
              </div>
              <p className="text-2xl font-black text-stone-900 mt-2">{PLAN_PRICE[key] || '—'}</p>
              <p className="text-[11px] text-stone-400 mt-1">
                {fmtLimit(p.limits?.warehouses)} warehouse(s) · {fmtLimit(p.limits?.customers)} customer(s)
              </p>
              <ul className="mt-4 space-y-1.5 flex-1">
                {feats.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-stone-600">
                    <span className="material-symbols-outlined text-[16px] text-green-500 mt-0.5">check_circle</span>{f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => choose(key)}
                disabled={isCurrent || busy === key || !canManage}
                title={!canManage ? 'Only your seller admin can change the plan' : undefined}
                className={`mt-5 rounded-lg px-4 py-2.5 text-sm font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isCurrent ? 'bg-stone-100 text-stone-500' : 'bg-[#EA2831] text-white hover:bg-red-600'}`}
              >
                {isCurrent ? 'Your plan' : !canManage ? 'Admin only' : busy === key ? 'Switching…' : `Switch to ${p.label || key}`}
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-stone-400 mt-6">Plan switching here is a manual/dev action; real payment integration comes later.</p>
    </div>
  );
};

export default SellerBilling;
