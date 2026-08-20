import React from 'react';
import { useNavigate } from 'react-router-dom';
import { usePermission } from '../../context/PermissionContext';
import { useSubscription } from '../../context/SubscriptionContext';

/**
 * Page-level protection. Wrap a routed page so that:
 *  - a role without the required capability gets a clear "Not authorized"
 *    screen instead of the page shell;
 *  - with `ims`, the page also requires an active IMS subscription. When the
 *    company hasn't subscribed, the COMPANY ADMIN sees an "IMS Module Not
 *    Activated" screen with View Plan / Subscribe options, while other roles
 *    see a neutral message with NO billing/upgrade controls.
 *
 * UI gating only — the backend authorize()/requireFeature() middleware is the
 * real enforcement point and returns 403 for any direct API access.
 *
 *   <Route path="/ims/lots" element={<RequireCap capability="lot:read" ims><ImsLots /></RequireCap>} />
 *   <Route path="/admin" element={<RequireCap ims><Administration /></RequireCap>} />
 */
const RequireCap = ({ capability, ims = false, children }) => {
  const { can, loading } = usePermission();
  const { plan, loading: subLoading } = useSubscription();
  const navigate = useNavigate();

  if (loading || (ims && subLoading)) {
    return <div className="flex-1 p-8 bg-white font-sora"><p className="text-sm text-stone-400">Loading…</p></div>;
  }

  if (capability && !can(capability)) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-white font-sora">
        <div className="text-center max-w-sm">
          <span className="material-symbols-outlined text-5xl text-stone-300">lock</span>
          <p className="mt-2 text-lg font-bold text-stone-900">Not authorized</p>
          <p className="mt-1 text-sm text-stone-500">
            Your role doesn&apos;t have access to this page. Ask a company admin if you
            think this is a mistake.
          </p>
        </div>
      </div>
    );
  }

  if (ims && (!plan || plan === 'free')) {
    // billing:manage resolves only via the company_admin wildcard.
    const isAdmin = can('billing:manage');
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-white font-sora">
        <div className="text-center max-w-md">
          <span className="material-symbols-outlined text-5xl text-stone-300">inventory_2</span>
          <p className="mt-2 text-lg font-bold text-stone-900">IMS Module Not Activated</p>
          {isAdmin ? (
            <>
              <p className="mt-1 text-sm text-stone-500 mb-5">
                The Inventory Management System isn&apos;t part of your current plan.
                Activate it to manage lots, warehouses, transfers and more.
              </p>
              <div className="flex items-center justify-center gap-3">
                <button onClick={() => navigate('/billing')} className="px-5 py-2.5 text-sm font-bold border border-stone-200 text-stone-700 rounded-xl hover:border-stone-400 transition-all">
                  View Plan
                </button>
                <button onClick={() => navigate('/billing')} className="px-6 py-2.5 text-sm font-bold bg-[#EA2831] text-white rounded-xl hover:bg-black transition-all">
                  Subscribe / Upgrade
                </button>
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-stone-500">
              This module isn&apos;t enabled for your company yet. Please contact your
              company admin.
            </p>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default RequireCap;