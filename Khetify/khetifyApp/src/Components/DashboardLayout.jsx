import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import TopNav from './TopNav';
import Sidebar from './Sidebar';
import NotificationBell from './ims/NotificationBell';
import { MODULES, activeModule } from '../lib/nav';
import { useSubscription, FEATURES } from '../context/SubscriptionContext';
import { usePermission } from '../context/PermissionContext';
import { isWarehouseRole } from '../lib/roles';
import { disconnectSocket } from '../lib/socket';
import { getCompany } from '../lib/imsApi';
import SupportChatWidget from './support/SupportChatWidget';

// Company-only label overrides. The MAIN company (company_admin) sees the
// Order History module labelled "Transfer History" in the sidebar + breadcrumb;
// every other role keeps the shared nav title untouched. Keyed by module `key`.
const companyLabel = (m, isMainCompany) =>
  isMainCompany && m.key === 'order-history' ? 'Transfer History' : m.title;

// Company breadcrumb: resolve the active module for the current path, applying
// the company-only label override.
const resolveCompanyCrumb = (isMainCompany) => (pathname) => {
  const m = activeModule(pathname);
  return m ? { icon: m.icon, title: companyLabel(m, isMainCompany) } : null;
};

// Shell: a slim full-width TopNav over a collapsible left Sidebar + page
// content. The Sidebar mirrors the Hub's module cards so the same destinations
// are reachable from any screen; it expands/compresses on desktop and slides in
// as a drawer on mobile. The company nav config (entries + profile menu) is
// built here and passed to the SHARED TopNav/Sidebar (the seller portal renders
// through the very same components with its own config).
const DashboardLayout = () => {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const { has, plan, loading: subLoading } = useSubscription();
  const { can, role, loading: permLoading, name, companyName, warehouses } = usePermission();
  const isMainCompany = role === 'company_admin';

  // The company must be approved before the module sidebar is usable. Until then
  // we hide the Sidebar entirely and let the page (Hub) show its under-review
  // message, so an un-approved company can't navigate into gated modules.
  const companyId = localStorage.getItem('companyId');
  const [approved, setApproved] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!companyId) return;
    getCompany(companyId)
      .then((c) => { if (alive) setApproved(c?.status === 'approved'); })
      .catch(() => {});
    return () => { alive = false; };
  }, [companyId]);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      localStorage.setItem('sidebarCollapsed', c ? '0' : '1');
      return !c;
    });

  // Same gating as the Hub: HIDE on capability (RBAC), LOCK on subscription.
  const imsActive = !subLoading && !!plan && plan !== 'free';
  // HIDE on capability (RBAC), plus two optional role pins:
  //  - `roles`        allow-list: only these roles see the module (e.g. the
  //                   Company Warehouse's own Transfer History), so a wildcard
  //                   role like company_admin doesn't also pick it up.
  //  - `hideForRoles` deny-list: everyone EXCEPT these roles sees it (e.g.
  //                   Orders, hidden from company_admin but kept for the rest).
  const visible = (m) =>
    !(m.capability && !permLoading && !can(m.capability)) &&
    !(m.roles && !permLoading && !m.roles.includes(role)) &&
    !(m.hideForRoles && !permLoading && m.hideForRoles.includes(role));
  const locked = (m) => {
    if (m.feature === 'ims') return !imsActive;
    if (m.feature === FEATURES.API_ACCESS) return !has(FEATURES.API_ACCESS);
    return false;
  };
  const entries = [
    { to: '/hub', icon: 'home', title: 'Home', end: true },
    ...MODULES.filter(visible).map((m) => ({
      to: m.path, icon: m.icon, title: companyLabel(m, isMainCompany), isLocked: locked(m), lockTitle: 'Upgrade to unlock',
      // Carried through to onLocked so Billing can show a message for the
      // SPECIFIC module the person tried to open, instead of a generic one.
      moduleKey: m.key,
    })),
    // Help resources — always available, no gating.
    { to: '/faq', icon: 'quiz', title: 'FAQ' },
  ];

  // The PERSON. Live from /auth/me; the login-time localStorage snapshot is only
  // a fallback so the header doesn't flash "User" before the fetch resolves.
  const userName = name || localStorage.getItem('userName') || 'User';

  // The ORGANISATION under the name: a warehouse user works a warehouse, the
  // main Company owns the business. Keyed off the role, never off which fields
  // happen to be populated. Other company roles (sales_manager, …) pass no
  // secondary and keep their single-line header exactly as before.
  const orgName = isWarehouseRole(role)
    ? warehouses.map((w) => w.name).filter(Boolean).join(', ') || null
    : isMainCompany
      ? companyName
      : null;
  // A company with no business name on file resolves to the account holder's own
  // name — showing "Aakash / Aakash" would be noise, so drop the second line.
  const secondary = orgName && orgName !== userName ? orgName : undefined;

  const logout = () => {
    disconnectSocket();
    localStorage.clear();
    navigate('/login', { replace: true });
  };
  const profile = {
    name: userName,
    secondary,
    menuItems: [
      { icon: 'person', label: 'Profile', onClick: () => navigate('/profile') },
      // Administration + Settings only once the company is approved; an
      // un-approved company gets Profile + Logout only.
      ...(approved
        ? [
            { icon: 'apps', label: 'Administration', onClick: () => navigate('/admin') },
            { icon: 'settings', label: 'Settings', onClick: () => navigate('/settings') },
          ]
        : []),
      { divider: true },
      { icon: 'logout', label: 'Logout', danger: true, onClick: logout },
    ],
  };

  return (
    <div className="flex flex-col h-screen bg-stone-50 font-sora overflow-hidden text-stone-900">
      <TopNav
        onMenuClick={() => setMobileOpen(true)}
        brand={{ label: 'Khetify' }}
        homePath="/hub"
        resolveCrumb={resolveCompanyCrumb(isMainCompany)}
        Bell={NotificationBell}
        profile={profile}
      />
      <div className="flex flex-1 overflow-hidden">
        {approved && (
          <Sidebar
            collapsed={collapsed}
            onToggle={toggleCollapsed}
            mobileOpen={mobileOpen}
            onMobileClose={() => setMobileOpen(false)}
            entries={entries}
            // Sidebar header shows the company's name instead of the generic
            // "Menu" label; falls back to "Menu" until /auth/me resolves it.
            title={companyName || 'Menu'}
            onLocked={(entry) => navigate('/billing', { state: { fromKey: entry?.moduleKey, fromTitle: entry?.title } })}
          />
        )}
        {/* overflow-x-hidden stops a stray wide element from scrolling the whole
            page sideways on mobile; data tables keep their own scroll wrappers. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
      {/* Floating company↔support chat — reachable from every dashboard screen. */}
      <SupportChatWidget />
    </div>
  );
};

export default DashboardLayout;