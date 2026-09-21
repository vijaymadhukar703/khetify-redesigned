import React, { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import TopNav from '../TopNav';
import Sidebar from '../Sidebar';
import { getAdminUser, clearAdminSession } from '../../lib/adminApi';
import { disconnectAdminSocket } from '../../lib/socket';

// Sidebar entries for the platform admin. Dashboard + Companies are wired;
// the rest are placeholders that render their (empty-state) page without
// breaking navigation.
const ADMIN_ENTRIES = [
  { to: '/admin/dashboard', icon: 'grid_view', title: 'Dashboard' },
  { to: '/admin/companies', icon: 'apartment', title: 'Companies' },
  { to: '/admin/support', icon: 'chat', title: 'Support Chats' },
  // { to: '/admin/sellers', icon: 'storefront', title: 'Sellers' },
  // { to: '/admin/pending', icon: 'hourglass_empty', title: 'Pending Requests' },
  // { to: '/admin/approved', icon: 'verified', title: 'Approved Records' },
  // { to: '/admin/rejected', icon: 'block', title: 'Rejected Records' },
];

// Admin shell — same slim TopNav + collapsible Sidebar the company/seller
// portals use, so the look and behaviour stay identical. Brand shows an "ADMIN"
// chip; the profile dropdown is just Profile + Logout (per spec).
const AdminLayout = () => {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('adminSidebarCollapsed') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);

  const admin = getAdminUser();
  const name = admin?.name || 'Admin';

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      localStorage.setItem('adminSidebarCollapsed', c ? '0' : '1');
      return !c;
    });

  const logout = () => {
    disconnectAdminSocket();
    clearAdminSession();
    navigate('/admin/login', { replace: true });
  };

  const profile = {
    name,
    secondary: admin?.email || undefined,
    menuItems: [
      // { icon: 'person', label: 'Profile', onClick: () => navigate('/admin/profile') },
      // { divider: true },
      { icon: 'logout', label: 'Logout', danger: true, onClick: logout },
    ],
  };

  return (
    <div className="flex flex-col h-screen bg-stone-50 font-sora overflow-hidden text-stone-900">
      <TopNav
        onMenuClick={() => setMobileOpen(true)}
        brand={{ label: "Khettify", sublabel: 'Admin' }}
        homePath="/admin/dashboard"
        profile={profile}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          title="Platform"
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
          entries={ADMIN_ENTRIES}
        />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;