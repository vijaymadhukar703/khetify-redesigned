import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePermission } from '../../../context/PermissionContext';
import { WAREHOUSE_ROLES } from '../../../lib/roles';
import CompanyInventory from '../CompanyInventory';
import ImsLots from './ImsLots';
import ImsLotDashboard from './ImsLotDashboard';
import { NoWarehouseNotice } from './ImsUi';
import useHasWarehouse from '../../../hooks/useHasWarehouse';

// INVENTORY TRACKING — one module merging Stock Overview, Lot Management, and
// Batch Management. It renders a role-appropriate view of the SAME shared
// ImsLots via props; no shared component's default behaviour is changed.
//
//  • Main Company (role "company_admin"): dedicated Lots-only view (no
//    Stock/Batches tabs) with summary cards + stock status, Receive Lot HIDDEN
//    (admins oversee receipts, don't perform them) and Transfer naturally
//    absent (company_admin is denied inventory:transfer in permissions.js).
//  • Company Warehouse / Warehouse Manager (warehouse-operations roles, see
//    WAREHOUSE_ROLES): the SAME Lots-only view, but Receive Lot is KEPT and
//    Transfer shows for those holding inventory:transfer (self-gated by <Can>).
//  • Every OTHER role (sales_manager, transport_manager, pos_operator,
//    support, …): the original 3-tab experience, untouched.
//
// The Stock (CompanyInventory) and Batch (ImsLotDashboard) components, their
// APIs and data logic are never removed — only which view a role sees changes.

// Company warehouse-operations roles that get the simplified Lots-only view
// (shared definition — see lib/roles.js). These are warehouse-scoped
// (services/warehouseScope.js) and manage lots; the row actions (Transfer /
// Receive / Create) self-gate on each role's own capabilities via <Can>, so a
// role only ever sees actions it already had.

const TABS = [
  { key: 'stock', label: 'Stock', icon: 'list_alt', render: () => <CompanyInventory /> },
  { key: 'lots', label: 'Lots', icon: 'package_2', render: () => <ImsLots /> },
  { key: 'batches', label: 'Batches', icon: 'monitoring', render: () => <ImsLotDashboard /> },
];

const InventoryTracking = () => {
  const { role } = usePermission();
  const [params, setParams] = useSearchParams();
  // Inventory gate: the main Company cannot work with lots until it owns at
  // least one warehouse. Hook order is fixed (called before any early return).
  const { checked: whChecked, hasWarehouse } = useHasWarehouse();

  const isMainCompany = role === 'company_admin';
  const isWarehouse = WAREHOUSE_ROLES.has(role);

  // ── Simplified Lots-only view (Main Company + Company Warehouse) ──
  // Lots page directly: no tabs / no tab arrows; stale ?tab=… params are ignored
  // (never read here), so /inventory always lands on Lots. Full-width wrapper
  // (no max-w-7xl) so the wider `fluid` Lots table uses the available content
  // area. Only main Company hides Receive Lot; the warehouse keeps it.
  if (isMainCompany || isWarehouse) {
    return (
      <div className="w-full px-3 sm:px-5 py-6">
        <h1 className="text-2xl font-bold text-stone-900 mb-1">Inventory</h1>
        {/* <p className="text-stone-500 mb-5">Track stock on hand and lots.</p> */}

        {/* Main Company mints lots (Create) but doesn't perform receipts; the
            Company Warehouse never mints a lot — its "Receive Lot" scans an
            incoming parent lot and confirms the transfer into this warehouse. */}
        {/* Main Company reads its Inventory as the ORIGINAL LOT REGISTER: the
            lots it minted, at their created quantity. The Company Warehouse keeps
            the live-stock view — same component, flag off. */}
        {/* No warehouse yet → Lot creation is unavailable. Only the main Company
            is gated: a Company Warehouse user is, by definition, attached to one,
            and the check runs on the company-wide directory. If the lookup could
            not complete (whChecked false) the page renders normally and the
            backend rejects any lot creation. */}
        {isMainCompany && whChecked && !hasWarehouse ? (
          <div className="py-6">
            <NoWarehouseNotice />
          </div>
        ) : (
          <ImsLots
            showSummary showStockStatus paginate showBatchNo fluid requireWarehouse
            hideReceive={isMainCompany}
            hideCreate={isWarehouse}
            receiveTransfer={isWarehouse}
            originalRegister={isMainCompany}
          />
        )}
      </div>
    );
  }

  // ── Every other role: original Stock / Lots / Batches tabs (unchanged). ──
  const active = TABS.find((t) => t.key === params.get('tab')) || TABS[0];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Inventory</h1>
      <p className="text-stone-500 mb-5">Track stock on hand, lots and batches.</p>

      <div className="flex gap-1 border-b border-stone-200 mb-6 overflow-x-auto">
        {TABS.map((t) => (
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

export default InventoryTracking;