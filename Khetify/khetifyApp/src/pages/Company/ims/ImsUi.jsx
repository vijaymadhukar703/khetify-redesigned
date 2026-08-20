// Shared UI bits for the IMS pages — styled to match the rest of the app
// (font-sora, stone palette, #EA2831 accents, rounded-xl cards, tiny uppercase labels).
import React from 'react';
import { useNavigate } from 'react-router-dom';

export const StatCard = ({ label, value, accent }) => (
  <div className="bg-white border border-stone-200 rounded-xl p-5 sm:p-6 shadow-sm">
    <p className="text-stone-500 text-[10px] font-bold uppercase mb-2 tracking-wider">{label}</p>
    <p className={`text-2xl sm:text-3xl font-bold ${accent || 'text-stone-900'}`}>{value}</p>
  </div>
);

export const Modal = ({ title, onClose, children, wide }) => (
  <div
    className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-[2px] flex items-center justify-center p-4 font-sora"
    onClick={(e) => e.target === e.currentTarget && onClose()}
  >
    <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[88vh] overflow-y-auto p-6`}>
      <div className="flex items-start justify-between mb-5">
        <h3 className="text-lg font-bold text-stone-900">{title}</h3>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600 p-1">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      {children}
    </div>
  </div>
);

export const Field = ({ label, required, children }) => {
  // Render a trailing "*" (or an explicit `required` prop) as a red asterisk.
  const base = typeof label === 'string' ? label.replace(/\s*\*\s*$/, '') : label;
  const showStar = required || (typeof label === 'string' && /\*\s*$/.test(label));
  return (
    <div className="flex flex-col gap-1.5 mb-4">
      <label className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
        {base}{showStar && <span className="text-[#EA2831] ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
};

export const inputCls =
  'w-full border border-stone-200 rounded-lg px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#EA2831]/30 focus:border-[#EA2831]';

export const PrimaryBtn = ({ children, ...props }) => (
  <button
    {...props}
    className={`inline-flex items-center gap-2 bg-[#EA2831] hover:bg-[#c91e26] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg px-5 py-2.5 transition-colors ${props.className || ''}`}
  >
    {children}
  </button>
);

export const GhostBtn = ({ children, ...props }) => (
  <button
    {...props}
    className={`inline-flex items-center gap-1.5 border border-stone-200 hover:bg-stone-50 text-stone-700 text-xs font-bold rounded-lg px-3 py-2 transition-colors ${props.className || ''}`}
  >
    {children}
  </button>
);

export const Th = ({ children, right, pad = 'px-6' }) => (
  <th className={`${pad} py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest ${right ? 'text-right' : 'text-left'}`}>
    {children}
  </th>
);

/**
 * NO WAREHOUSE — the Inventory / Lot-creation gate.
 *
 * A lot always lives in a warehouse, so a company that hasn't set one up yet
 * cannot create lots. This is the single shared message for that state, used
 * by InventoryTracking (full-page empty state) and by ImsLots (compact banner
 * above the list). The backend enforces the same rule authoritatively in
 * middlewares/requireWarehouseExists.js.
 *
 * The SELLER panel reuses this same component for its Inbound Supply gate,
 * overriding only the wording and the CTA target. Every text prop defaults to
 * the original company/Lot copy, so existing callers render unchanged.
 *
 *   compact — inline banner instead of the full-page card.
 *   showCta — render the "Create Warehouse" button (default on).
 *   to      — where the button navigates; ?new=1 opens Add Warehouse directly.
 */
export const NoWarehouseNotice = ({
  compact = false,
  showCta = true,
  to = '/warehouses?new=1',
  // Wording. Defaults are the original company Lot-gate strings.
  message = 'Please create a Warehouse first before creating a Lot.',
  hint = 'Lot creation stays locked until this company has at least one warehouse.',
  title = 'No warehouse set up yet',
  body = 'Please create a Warehouse first before creating a Lot. Every lot has to be stored somewhere, so Inventory opens up as soon as your first warehouse is added.',
}) => {
  const navigate = useNavigate();
  const go = () => navigate(to);

  if (compact) {
    return (
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 border border-[#EA2831]/30 bg-[#EA2831]/[0.04] rounded-xl p-4">
        <span className="material-symbols-outlined text-[#EA2831]">warehouse</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-stone-900">{message}</p>
          <p className="text-xs text-stone-500 mt-0.5">{hint}</p>
        </div>
        {showCta && (
          <GhostBtn onClick={go} className="shrink-0">
            <span className="material-symbols-outlined text-sm">add_business</span> Create Warehouse
          </GhostBtn>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-8 sm:p-12 text-center max-w-2xl mx-auto">
      <div className="w-14 h-14 rounded-full bg-[#EA2831]/10 text-[#EA2831] flex items-center justify-center mx-auto mb-5">
        <span className="material-symbols-outlined text-[30px]">warehouse</span>
      </div>
      <h3 className="text-lg font-bold text-stone-900 mb-2">{title}</h3>
      <p className="text-sm text-stone-500 leading-relaxed mb-6">{body}</p>
      {showCta && (
        <PrimaryBtn onClick={go} className="mx-auto">
          <span className="material-symbols-outlined text-base">add_business</span> Create Warehouse
        </PrimaryBtn>
      )}
    </div>
  );
};