import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// Slim, full-width top bar shared by BOTH the company and seller portals.
// Everything portal-specific is passed in as props so the two render through
// the identical component:
//   brand        { label, sublabel? }  — wordmark + optional chip ("Seller")
//   homePath     route the wordmark / "Back to Home" go to
//   resolveCrumb (pathname) => { icon, title } | null  — breadcrumb resolver
//   Bell         notification-bell component (company vs seller bell)
//   profile      { name, secondary?, initials?, menuItems:[{icon,label,onClick,danger?}|{divider:true}] }
const TopNav = ({ onMenuClick, brand, homePath = '/', resolveCrumb, Bell, profile }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const crumb = resolveCrumb ? resolveCrumb(location.pathname) : null;
  const onHome = location.pathname === homePath;

  const name = profile?.name || 'User';
  const initials = profile?.initials
    || name.split(' ').map((n) => n[0]).filter(Boolean).join('').toUpperCase()
    || 'U';
  const menuItems = profile?.menuItems || [];

  return (
    <header className="h-16 border-b border-stone-200 px-4 sm:px-8 flex items-center justify-between bg-white z-20 shrink-0 font-sora">
      {/* Left: wordmark + breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Mobile-only: open the sidebar drawer (desktop shows the sidebar inline). */}
        <button
          onClick={onMenuClick}
          className="md:hidden inline-flex items-center justify-center h-9 w-9 -ml-1 rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-900 transition-colors shrink-0"
          title="Menu"
        >
          <span className="material-symbols-outlined text-[24px]">menu</span>
        </button>

        <button
          onClick={() => navigate(homePath)}
          className="flex items-center gap-2 shrink-0"
          title="Home"
        >
          <span className="text-[#EA2831] text-xl font-bold tracking-tight hover:opacity-80 transition-opacity">
            {brand?.label || 'Khetify'}
          </span>
          {brand?.sublabel && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 bg-stone-100 rounded-full px-2 py-0.5">
              {brand.sublabel}
            </span>
          )}
        </button>

        

       
      </div>

      {/* Right: notifications + account */}
      <div className="flex items-center gap-4 sm:gap-6 shrink-0">
        {Bell ? <Bell /> : null}

        <div className="relative sm:pl-4 sm:border-l border-stone-100">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2.5 rounded-lg hover:bg-stone-50 transition-colors py-1 pr-1.5"
            title="Account"
          >
            <div className="h-9 w-9 rounded-full bg-[#EA2831]/10 border border-[#EA2831]/20 flex items-center justify-center font-bold text-[#EA2831] uppercase text-sm">
              {initials}
            </div>
            {profile?.secondary ? (
              <span className="hidden md:flex flex-col items-start leading-tight">
                <span className="text-sm font-bold text-stone-900 leading-none uppercase truncate max-w-[160px]">{name}</span>
                <span className="text-[10px] font-medium text-stone-400 normal-case truncate max-w-[160px]">{profile.secondary}</span>
              </span>
            ) : (
              <span className="text-sm font-bold text-stone-900 leading-none uppercase hidden md:inline">{name}</span>
            )}
            <span className={`material-symbols-outlined text-base text-stone-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`}>
              keyboard_arrow_down
            </span>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 mt-3 w-48 bg-white border border-stone-200 rounded-2xl shadow-xl z-40 overflow-hidden py-1">
                {menuItems.map((it, i) => (it.divider ? (
                  <div key={`divider-${i}`} className="h-px bg-stone-100 my-1" />
                ) : (
                  <button
                    key={it.label}
                    onClick={() => { setMenuOpen(false); it.onClick?.(); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                      it.danger ? 'font-bold text-[#EA2831] hover:bg-red-50' : 'font-medium text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[20px]">{it.icon}</span> {it.label}
                  </button>
                )))}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default TopNav;
