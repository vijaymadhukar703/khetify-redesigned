import React from 'react';
import { useSearchParams } from 'react-router-dom';
import ImsInbound from './ImsInbound';
import ImsOutbound from './ImsOutbound';
import ImsSellerTransfer from './ImsSellerTransfer';
import ImsTransport from './ImsTransport';
import ImsTrace from './ImsTrace';
import { usePermission } from '../../../context/PermissionContext';
import { WAREHOUSE_ROLES } from '../../../lib/roles';

// OPERATIONS — one module that merges the old Inbound, Outbound, Transport and
// Traceability pages. Warehouse jargon (inbound / outbound / putaway) is
// replaced with plain business language. The active tab is held in the URL
// (?tab=receive) so old deep links can redirect straight into the right tab.
//
// Per-role tab sets (nothing is removed globally — ImsInbound / ImsOutbound,
// their routes and their APIs are untouched):
//  - MAIN COMPANY (company_admin): oversight only, no stock handling.
//  - COMPANY WAREHOUSE: no "Receive Stock" tab — it receives Company-transferred
//    parent lots through Inventory → Receive Lot (scan + Confirm Receive)
//    instead. That flow is a different feature and is NOT affected here.
//  - Everyone else: the full set, unchanged.

const TABS = [
  { key: 'receive', label: 'Receive Stock', icon: 'move_to_inbox', render: () => <ImsInbound /> },
  { key: 'send', label: 'Seller Requests', icon: 'outbox', render: () => <ImsOutbound /> },
  // Warehouse-initiated push transfer to a PC-authorized seller (scan-verified).
  { key: 'seller-transfer', label: 'Transfer to Seller', icon: 'storefront', render: () => <ImsSellerTransfer /> },
  // `key` is the ?tab= value in the URL and stays "shipments" — only the label
  // the operator reads has changed.
  { key: 'shipments', label: 'Transfers', icon: 'local_shipping', render: () => <ImsTransport /> },
  { key: 'trace', label: 'Traceability', icon: 'travel_explore', render: () => <ImsTrace /> },
];
// Tabs the main Company may open (oversight only — no stock handling).
const COMPANY_TABS = ['shipments', 'trace'];
// The Company Warehouse keeps everything except Receive Stock.
const WAREHOUSE_TABS = ['send', 'seller-transfer', 'shipments', 'trace'];

const Operations = () => {
  const { role } = usePermission();
  const isMainCompany = role === 'company_admin';
  const isWarehouse = WAREHOUSE_ROLES.has(role);
  const allowed = isMainCompany ? COMPANY_TABS : isWarehouse ? WAREHOUSE_TABS : null;
  const tabs = allowed ? TABS.filter((t) => allowed.includes(t.key)) : TABS;
  // Resolve the active tab against the VISIBLE list, so ?tab=receive / ?tab=send
  // can't open a hidden tab — the role falls back to its first allowed tab
  // (Company → Transfers, Warehouse → Seller Requests) with no manual switch.
  const [params, setParams] = useSearchParams();
  const active = tabs.find((t) => t.key === params.get('tab')) || tabs[0];

  /**
   * EVERY TAB GETS THE FULL PAGE WIDTH.
   *
   * `max-w-7xl` (1280px) plus `sm:px-8` used to cap this shell, and the Transfers
   * tab alone opted out of it — which is why that one table ran edge to edge
   * while Seller Requests, Transfer to Seller and Traceability sat in a narrower
   * column, with their tab strip and heading starting at a different x than the
   * Transfers one. The cap is now gone for all of them, so the heading, the tab
   * strip and each tab's card share one left edge and one width.
   *
   * Nothing inside the tabs changed: their cards are already w-full and simply
   * follow this container.
   */

  return (
    <div className="max-w-none mx-auto px-4 sm:px-4 py-6">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Stock Transfers</h1>
      <p className="text-stone-500 mb-5">
        {isMainCompany
          ? 'Track your transfers and trace your stock.'
          : isWarehouse
            ? 'Send, transfer and track your stock. Incoming lots are received from Inventory → Receive Lot.'
            : 'Receive, send, transfer and track your stock.'}
      </p>

      <style>{`
        .kt-tabstrip { scrollbar-width: none; -ms-overflow-style: none; }
        .kt-tabstrip::-webkit-scrollbar { display: none; }
      `}</style>
      {/* Tabs sit at their natural label width, left-aligned. Stretching them to
          equal shares of the (now full-width) shell spread them far apart and
          read as four separate buttons rather than one tab strip. */}
      <div className="kt-tabstrip flex gap-1 border-b border-stone-200 mb-6 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setParams({ tab: t.key })}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px whitespace-nowrap transition-colors ${
              active.key === t.key
                ? 'border-[#EA2831] text-[#EA2831]'
                : 'border-transparent text-stone-400 hover:text-stone-700'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div>{active.render()}</div>
    </div>
  );
};

export default Operations;