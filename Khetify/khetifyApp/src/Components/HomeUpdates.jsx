import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NOTIF_ICON } from '../hooks/useNotifications';

const timeAgo = (d) => {
  if (!d) return '';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/**
 * "Updates" feed for the Home page — shared by the company AND seller Hubs (all
 * roles). The parent passes its own role/owner-scoped notification state
 * (items/unread/markRead/markAll), a `resolveRoute(n)` that maps a notification
 * to the page where the user acts on it, and a `fallbackRoute` used when a
 * notification has no specific destination. EVERY item is clickable: clicking
 * marks it read and navigates to the right functionality. Presentational only.
 */
const PREVIEW = 4;
const HomeUpdates = ({ items = [], unread = 0, markRead, markAll, resolveRoute, fallbackRoute = '/' }) => {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);
  const recent = showAll ? items : items.slice(0, PREVIEW);

  const routeFor = (n) => resolveRoute?.(n) || fallbackRoute;
  const open = (n) => {
    if (!n.read) markRead?.(n._id);
    navigate(routeFor(n)); // always direct to a destination
  };

  return (
    <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden mt-[30px]">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100">
        <p className="font-bold text-stone-900 text-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-[#EA2831]">notifications_active</span>
          Updates {unread > 0 && <span className="text-[10px] font-bold text-white bg-[#EA2831] rounded-full px-2 py-0.5">{unread} new</span>}
        </p>
        {unread > 0 && <button onClick={() => markAll?.()} className="text-[11px] font-bold text-[#EA2831] hover:underline">Mark all read</button>}
      </div>
      <div className="divide-y divide-stone-50">
        {recent.length === 0 && (
          <p className="text-sm text-stone-400 text-center py-8">You&apos;re all caught up — new supply, transfers, orders and stock activity show here.</p>
        )}
        {recent.map((n) => {
          const meta = NOTIF_ICON[n.type] || { icon: 'notifications', cls: 'text-stone-500 bg-stone-100' };
          return (
            <button
              key={n._id}
              onClick={() => open(n)}
              title="Open"
              className={`group w-full text-left flex gap-3 px-5 py-3 transition-colors hover:bg-stone-50 ${n.read ? '' : 'bg-red-50/30'}`}
            >
              <span className={`material-symbols-outlined text-base h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${meta.cls}`}>{meta.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-stone-900">{n.title}</p>
                <p className="text-[11px] text-stone-500 leading-snug">{n.body}</p>
              </div>
              <span className="text-[10px] text-stone-400 shrink-0 flex items-center gap-1">
                {timeAgo(n.createdAt)}
                <span className="material-symbols-outlined text-stone-300 group-hover:text-[#EA2831] text-base transition-colors">chevron_right</span>
              </span>
            </button>
          );
        })}
      </div>
      {items.length > PREVIEW && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="w-full text-center text-[11px] font-bold text-[#EA2831] hover:bg-stone-50 py-3 border-t border-stone-100 uppercase tracking-wider"
        >
          {showAll ? 'Show less' : `Show all (${items.length})`}
        </button>
      )}
    </div>
  );
};

export default HomeUpdates;
