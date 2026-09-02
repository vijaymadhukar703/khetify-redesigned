import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSubscription } from '../../context/SubscriptionContext';


const PREF_KEY = 'ims_prefs';
const loadPrefs = () => {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; }
};

const Toggle = ({ on, onChange }) => (
  <button
    onClick={() => onChange(!on)}
    className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${on ? 'bg-[#EA2831]' : 'bg-stone-200'}`}
  >
    <span className={`absolute top-0.5 h-5 w-5 bg-white rounded-full shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
  </button>
);

/** Settings — subscription and alert preferences. */
const CompanySettings = () => {
  const navigate = useNavigate();
  const { plan } = useSubscription();

  const [prefs, setPrefs] = useState(loadPrefs());

  const setPref = (k, v) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    localStorage.setItem(PREF_KEY, JSON.stringify(next));
  };

  const prefRows = [
    { key: 'alertLowStock', label: 'Low-stock alerts', desc: 'Notify when a lot drops below its reorder level' },
    { key: 'alertExpiry', label: 'Expiry alerts', desc: 'Notify about lots expiring within 90 days' },
    { key: 'alertOrders', label: 'Order alerts', desc: 'Notify on new and updated seller orders' },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-3xl mx-auto space-y-6">
       
        <h2 className="text-xl font-bold text-stone-900">Settings</h2>

        {/* Subscription */}
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-stone-900">Subscription</h3>
            <p className="text-xs text-stone-500 mt-1">
              Current plan: <span className="font-bold text-stone-900 capitalize">{plan || 'free'}</span>
            </p>
          </div>
          <button onClick={() => navigate('/billing')} className="bg-[#EA2831] hover:bg-[#c91e26] text-white text-sm font-bold rounded-lg px-5 py-2.5 transition-colors">
            Manage Plan
          </button>
        </div>

        {/* Alert preferences */}
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm">
          <h3 className="text-sm font-bold text-stone-900 mb-1">Alert Preferences</h3>
          <p className="text-[11px] text-stone-400 mb-4">Stored on this device.</p>
          <div className="divide-y divide-stone-100">
            {prefRows.map((r) => (
              <div key={r.key} className="flex items-center justify-between py-3.5">
                <div>
                  <p className="text-sm font-medium text-stone-800">{r.label}</p>
                  <p className="text-xs text-stone-400">{r.desc}</p>
                </div>
                <Toggle on={prefs[r.key] !== false} onChange={(v) => setPref(r.key, v)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanySettings;
