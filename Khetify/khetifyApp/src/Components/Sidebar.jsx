import React from 'react';
import { NavLink } from 'react-router-dom';

/**
 * Persistent left sidebar shared by BOTH the company and seller portals. It can
 * expand (icon + label) or compress (icon only) on desktop, and slides in as an
 * overlay drawer on mobile. Purely presentational — the parent passes the
 * already-gated `entries` so each portal keeps its own visibility/lock rules
 * while the look (Menu header, collapse, active red highlight, lock icons) stays
 * identical.
 *
 * entry: { to, icon, title, end?, isLocked?, lockTitle?, lockIcon? }
 *   - normal entries render a NavLink (active highlight via isActive)
 *   - locked entries render a button → onLocked(entry) (e.g. route to Billing)
 */
const Sidebar = ({ collapsed, onToggle, mobileOpen, onMobileClose, entries = [], title = 'Menu', onLocked }) => (
  <>
    {/* Mobile backdrop */}
    {mobileOpen && (
      <div className="fixed inset-0 bg-stone-900/40 z-30 md:hidden" onClick={onMobileClose} />
    )}

    <aside
      className={`bg-white border-r border-stone-200 flex flex-col shrink-0 z-40 transition-all duration-200
        fixed inset-y-0 left-0 w-64 md:static md:inset-auto
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
        ${collapsed ? 'md:w-16' : 'md:w-60'}`}
    >
      {/* Header: label + collapse (desktop) / close (mobile) */}
      <div className="h-16 flex items-center justify-between px-3 border-b border-stone-100 shrink-0">
        <span className={`font-bold text-stone-900 px-1 ${collapsed ? 'md:hidden' : ''}`}>{title}</span>
        <button
          onClick={onToggle}
          className="hidden md:inline-flex items-center justify-center h-8 w-8 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span className="material-symbols-outlined text-[20px]">{collapsed ? 'chevron_right' : 'chevron_left'}</span>
        </button>
        <button
          onClick={onMobileClose}
          className="md:hidden inline-flex items-center justify-center h-8 w-8 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition-colors"
          title="Close menu"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {entries.map((e) => (
          e.isLocked ? (
            // Locked (premium / not-yet-available) — defer to onLocked.
            <button
              key={e.to}
              onClick={() => { onMobileClose?.(); onLocked?.(e); }}
              aria-disabled
              title={collapsed ? `${e.title} — ${e.lockTitle || 'locked'}` : e.lockTitle}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-stone-400 hover:bg-stone-100 transition-colors ${
                collapsed ? 'md:justify-center' : ''
              }`}
            >
              <span className="material-symbols-outlined text-[22px] shrink-0">{e.icon}</span>
              <span className={`truncate ${collapsed ? 'md:hidden' : ''}`}>{e.title}</span>
              <span className={`material-symbols-outlined text-[16px] ml-auto text-stone-300 ${collapsed ? 'md:hidden' : ''}`}>{e.lockIcon || 'lock'}</span>
            </button>
          ) : (
            <NavLink
              key={e.to}
              to={e.to}
              end={e.end}
              onClick={onMobileClose}
              title={collapsed ? e.title : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                  collapsed ? 'md:justify-center' : ''
                } ${isActive ? 'bg-[#EA2831]/10 text-[#EA2831]' : 'text-stone-600 hover:bg-stone-100'}`
              }
            >
              <span className="material-symbols-outlined text-[22px] shrink-0">{e.icon}</span>
              <span className={`truncate ${collapsed ? 'md:hidden' : ''}`}>{e.title}</span>
            </NavLink>
          )
        ))}
      </nav>
    </aside>
  </>
);

export default Sidebar;
