import React, { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import TopNav from "../TopNav";
import Sidebar from "../Sidebar";
import { getSellerMe, clearSellerToken } from "../../lib/sellerApi";
import {
  SELLER_MODULES, SELLER_ADMIN_MODULE_KEYS, SELLER_ADMIN_ITEMS, SELLER_ADMIN_NAV,
} from "../../lib/sellerNav";
import { useSellerSubscription } from "../../context/SellerSubscriptionContext";
import { useSellerPermission } from "../../context/SellerPermissionContext";
import { useSellerNotifications, sellerNotifRoute } from "../../hooks/useSellerNotifications";
import { NOTIF_ICON } from "../../hooks/useNotifications";

/** Seller header bell — unread badge + recent-notifications dropdown. Passed to
 * the shared TopNav as its `Bell`, mirroring the company NotificationBell slot. */
const SellerBell = () => {
  const navigate = useNavigate();
  const { items, unread, markRead, markAll } = useSellerNotifications();
  const [open, setOpen] = useState(false);
  const recent = items.slice(0, 6);

  const openNotif = (n) => {
    if (!n.read) markRead(n._id);
    setOpen(false);
    const route = sellerNotifRoute(n);
    if (route) navigate(route);
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="text-stone-400 hover:text-stone-600 relative p-1 transition-colors" title="Notifications">
        <span className="material-symbols-outlined text-[22px]">notifications</span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-[#EA2831] text-white text-[9px] font-bold rounded-full flex items-center justify-center border border-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-3 w-80 bg-white border border-stone-200 rounded-2xl shadow-xl z-40 overflow-hidden font-sora">
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
              <p className="font-bold text-stone-900 text-sm">Notifications</p>
              {unread > 0 && <button onClick={markAll} className="text-[11px] font-bold text-[#EA2831] hover:underline">Mark all read</button>}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {recent.length === 0 && <p className="text-sm text-stone-400 text-center py-8">You&apos;re all caught up 🎉</p>}
              {recent.map((n) => {
                const meta = NOTIF_ICON[n.type] || { icon: "notifications", cls: "text-stone-500 bg-stone-100" };
                return (
                  <button key={n._id} onClick={() => openNotif(n)}
                    className={`w-full text-left flex gap-3 px-4 py-3 border-b border-stone-50 hover:bg-stone-50 transition-colors ${n.read ? "" : "bg-red-50/30"}`}>
                    <span className={`material-symbols-outlined text-base h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${meta.cls}`}>{meta.icon}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-stone-900 truncate">{n.title}</p>
                      <p className="text-[11px] text-stone-500 leading-snug">{n.body}</p>
                    </div>
                    {!n.read && <span className="ml-auto mt-1 h-2 w-2 rounded-full bg-[#EA2831] shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// Every seller nav destination (modules + admin sections) — used to resolve the
// TopNav breadcrumb, mirroring the company's activeModule().
const SELLER_NAV_CRUMBS = [
  ...SELLER_MODULES.map((m) => ({ path: m.path, icon: m.icon, title: m.label })),
  { path: SELLER_ADMIN_NAV.path, icon: SELLER_ADMIN_NAV.icon, title: SELLER_ADMIN_NAV.label },
  ...SELLER_ADMIN_ITEMS.map((i) => ({ path: i.path, icon: i.icon, title: i.title })),
];
const resolveSellerCrumb = (pathname) => {
  const exact = SELLER_NAV_CRUMBS.find((c) => c.path === pathname);
  if (exact) return { icon: exact.icon, title: exact.title };
  const pre = [...SELLER_NAV_CRUMBS].sort((a, b) => b.path.length - a.path.length).find((c) => pathname.startsWith(c.path));
  return pre ? { icon: pre.icon, title: pre.title } : null;
};

// Seller portal shell — renders through the SAME shared TopNav + Sidebar as the
// company portal (Components/TopNav, Components/Sidebar) so the profile menu and
// the sidebar look identical; only the config (brand chip, nav entries, profile,
// bell) differs. Seller gating (cap / paid feature / approval locks) is computed
// here and carried on the entries.
const SellerLayout = () => {
  const navigate = useNavigate();
  const { sellerCan } = useSellerSubscription();
  // `role` comes from the same context — it decides whether the Settings entry
  // is offered (warehouse side only). Destructured alongside the existing
  // capability helper rather than as a second hook call.
  const { sellerCan: hasCap, role } = useSellerPermission();
  const canBill = hasCap("billing:manage"); // only seller_admin can switch plans

  const [seller, setSeller] = useState(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sellerSidebarCollapsed") === "1");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let active = true;
    getSellerMe()
      .then((r) => { if (active) setSeller(r?.data || null); })
      .catch(() => { /* token may be stale; RequireSeller still gates routes */ });
    return () => { active = false; };
  }, []);

  const toggleCollapsed = () =>
    setCollapsed((c) => { localStorage.setItem("sellerSidebarCollapsed", c ? "0" : "1"); return !c; });

  const logout = () => {
    clearSellerToken();
    localStorage.clear();
    navigate("/seller/login", { replace: true });
  };

  // Display name = the member's own name when a team member is logged in, else
  // the seller business name.
  const businessName = seller?.businessName || seller?.sellerInfo?.businessName || "Seller";
  const displayName = seller?.name || businessName;

  /**
   * THE LINE UNDER THE NAME IS THE WAREHOUSE, not the seller.
   *
   * A warehouse manager is standing in ONE warehouse and needs to see which —
   * it is the thing that changes what they are looking at, and every screen
   * they open is scoped to it. The seller/business name is the same on every
   * login and told them nothing.
   *
   * Names come from the seller /me payload, resolved server-side from the
   * member's assigned warehouse ids. Falls back to the business name for anyone
   * with NO warehouse assignment — a seller_admin is not in a warehouse, so the
   * account name is the honest label there and their header is unchanged.
   */
  const warehouses = seller?.warehouses || [];
  const warehouseLabel = warehouses.length === 1
    ? warehouses[0].name
    : warehouses.length > 1
      // Several assignments: name them, and let TopNav truncate if it must.
      ? warehouses.map((w) => w.name).filter(Boolean).join(" · ")
      : null;
  const showAccount = seller?.isMember && businessName && businessName !== displayName;
  const secondaryLabel = warehouseLabel || (showAccount ? businessName : undefined);
  const approved = seller?.linkStatus === "approved";

  // Gate a MODULE (approval + plan + cap), returning a sidebar entry or null.
  const moduleEntry = (m) => {
    if (m.cap && !hasCap(m.cap)) return null; // role lacks access → hide entirely
    const planOk = sellerCan(m.feature);
    const unlocked = m.live && approved && planOk;
    if (unlocked) return { to: m.path, icon: m.icon, title: m.label };
    const planLocked = m.live && approved && !planOk; // paid module not in owner's plan
    return {
      to: m.path, icon: m.icon, title: m.label, isLocked: true, lockReason: planLocked ? "plan" : "approval",
      // Admin sees a "Pro" upgrade affordance; everyone else just a lock.
      lockIcon: planLocked && canBill ? "workspace_premium" : "lock",
      lockTitle: planLocked
        ? (canBill ? "Upgrade your plan to unlock" : "Ask your seller admin to upgrade the plan")
        : (m.live ? "Available after your company approves you" : `Coming in phase ${m.phase}`),
    };
  };
  // Top-level modules in the company-like order (admin-tagged modules excluded).
  const topModules = SELLER_MODULES.filter((m) => !SELLER_ADMIN_MODULE_KEYS.includes(m.key)).map(moduleEntry).filter(Boolean);

  // Single "Administration" button (gear) → the admin hub, mirroring the
  // company. Shown only when the role can see ≥1 admin item.
  const adminVisible = SELLER_ADMIN_ITEMS.some((i) => hasCap(i.cap));

  const entries = [
    { to: "/seller/hub", icon: "home", title: "Home", end: true },
    ...topModules,
    ...(adminVisible ? [{ to: SELLER_ADMIN_NAV.path, icon: SELLER_ADMIN_NAV.icon, title: SELLER_ADMIN_NAV.label }] : []),
    // Help resources — always available, no gating.
    { to: "/seller/faq", icon: "quiz", title: "FAQ" },
  ];

  // Locked entries: a plan-locked module routes the admin to Billing; a
  // manager/staff can't upgrade (tooltip says ask the admin). Approval / coming
  // -soon locks are no-ops.
  const onLocked = (e) => {
    if (e.lockReason === "plan" && canBill) navigate("/seller/billing");
  };

  /**
   * SETTINGS IS FOR THE WAREHOUSE SIDE ONLY.
   *
   * A seller WAREHOUSE MANAGER is a `User` with their own password, so changing
   * or resetting it is a real need. A seller_admin signs in as the seller
   * ACCOUNT itself — its token's `id` is the Seller record, not a User — so
   * /api/users/change-password would not find an account for them and the page
   * would be a dead end. The entry is therefore gated to the warehouse role
   * rather than shown to everyone, which is also exactly the brief: add it to
   * the Seller Warehouse, not to the ordinary seller side.
   *
   * The same rule that already decides a warehouse-scoped view elsewhere in the
   * portal — anyone who is not seller_admin and is a member.
   */
  const isWarehouseSide = role !== "seller_admin" && !!seller?.isMember;

  // Mirror the company dropdown: Profile + Administration (when the role can see
  // ≥1 admin section) + Logout. Administration deep-links to the existing seller
  // admin hub. Settings is appended for the warehouse side; the three existing
  // entries are untouched and keep their order.
  const profile = {
    name: displayName,
    secondary: secondaryLabel,
    menuItems: [
      { icon: "person", label: "Profile", onClick: () => navigate("/seller/profile") },
      ...(adminVisible ? [{ icon: "apps", label: "Administration", onClick: () => navigate(SELLER_ADMIN_NAV.path) }] : []),
      ...(isWarehouseSide ? [{ icon: "settings", label: "Settings", onClick: () => navigate("/seller/settings") }] : []),
      { divider: true },
      { icon: "logout", label: "Logout", danger: true, onClick: logout },
    ],
  };

  return (
    <div className="flex flex-col h-screen bg-stone-50 font-sora overflow-hidden text-stone-900">
      <TopNav
        onMenuClick={() => setMobileOpen(true)}
        brand={{ label: "Khetify", sublabel: "Seller" }}
        homePath="/seller/hub"
        resolveCrumb={resolveSellerCrumb}
        Bell={SellerBell}
        profile={profile}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
          entries={entries}
          onLocked={onLocked}
        />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default SellerLayout;