import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { GhostBtn } from '../Company/ims/ImsUi';

import {
  getSellerTeam, updateSellerMember, deleteSellerMember, SELLER_TEAM_ROLES,
} from '../../lib/sellerApi';
import { useSellerPermission } from '../../context/SellerPermissionContext';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiErr = (e) => toast('error', e?.response?.data?.message || e.message || 'Something went wrong');

const ROLE_LABEL = Object.fromEntries(SELLER_TEAM_ROLES.map((r) => [r.value, r.label]));
const STATUS_STYLE = { active: 'bg-green-50 text-green-700', invited: 'bg-amber-50 text-amber-700', disabled: 'bg-stone-100 text-stone-500' };

// Roles that are never warehouse-scoped — they can see every warehouse, so
// there is no single assignment to display for them.
const UNSCOPED_ROLES = ['seller_admin'];

/** The warehouse(s) a member is assigned to, as plain text.
 *  `warehouseIds` is populated with { name, code } by GET /api/seller/team. */
const warehouseLabel = (m) => {
  if (UNSCOPED_ROLES.includes(m.role)) return 'All warehouses';
  const list = (m.warehouseIds || []).map((w) => w?.name).filter(Boolean);
  return list.length ? list.join(', ') : 'Not assigned';
};

/**
 * TEAM & ROLES — a LISTING page.
 *
 * Members are no longer created here. A Warehouse Manager is created as part of
 * creating the Warehouse they run (Warehouses → Add Warehouse), which also
 * assigns them to it and emails them their login details in the same operation.
 * This page therefore shows who is on the team, what role they hold and which
 * warehouse they cover, and keeps only the account-lifecycle actions
 * (enable / disable / remove) that have no other home. Role and warehouse are
 * READ-ONLY here — both are set by the warehouse creation flow, which is now
 * the single place that decides them.
 *
 * This mirrors the company Team & Roles page (pages/Company/CompanyUsers.jsx)
 * exactly. Nothing was removed from the API: PATCH/DELETE /api/seller/team are
 * untouched, and POST /api/seller/team still exists — the Seller Panel simply
 * no longer calls it.
 */
const SellerTeam = () => {
  const navigate = useNavigate();
  const canManage = useSellerPermission('user:manage');
  const canCreateWarehouse = useSellerPermission('warehouse:create');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    getSellerTeam().then((r) => setRows(r?.data || [])).catch(apiErr).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, msg) => { try { await fn(); toast('success', msg); load(); } catch (e) { apiErr(e); } };
  const toggleStatus = (m) => act(() => updateSellerMember(m._id, { status: m.status === 'disabled' ? 'active' : 'disabled' }), 'Updated');
  const remove = async (m) => {
    const { isConfirmed } = await Swal.fire({ title: `Remove ${m.name}?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'Remove' });
    if (isConfirmed) act(() => deleteSellerMember(m._id), 'Removed');
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50/50 font-sora">
      <div className="max-w-5xl mx-auto space-y-5">
       
        <div>
          <h1 className="text-xl font-bold text-stone-900">Team &amp; Roles</h1>
          <p className="text-sm text-stone-500">{rows.length} member(s) across your seller portal.</p>
        </div>

        {/* Where members come from now — stated once, right where someone would
            have looked for the old Invite member button. */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 border border-stone-200 bg-white rounded-xl p-4">
          <span className="material-symbols-outlined text-stone-400">info</span>
          <p className="flex-1 min-w-0 text-sm text-stone-600">
            Warehouse Managers are created when you add a Warehouse — the manager account is
            created, assigned to that warehouse and emailed its login details in one step.
          </p>
          {canCreateWarehouse && (
            <GhostBtn onClick={() => navigate('/seller/warehouses?new=1')} className="shrink-0">
              <span className="material-symbols-outlined text-sm">add_business</span> Add Warehouse
            </GhostBtn>
          )}
        </div>

        <div className="bg-white border border-stone-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[640px] resp-table">
            <thead>
              <tr className="bg-stone-50/50 border-b border-stone-200">
                {['Name', 'Contact', 'Role', 'Status', 'Warehouses', ''].map((h, i) => (
                  <th key={i} className="px-5 py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? <tr><td colSpan={6} className="px-5 py-10 text-center text-stone-400">Loading…</td></tr>
                : rows.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-stone-400">No team members yet — add a warehouse to create its manager.</td></tr>
                : rows.map((m) => (
                  <tr key={m._id} className="hover:bg-stone-50/40">
                    <td data-label="Name" className="px-5 py-3 text-sm font-bold text-stone-800">{m.name}</td>
                    <td data-label="Contact" className="px-5 py-3 text-sm text-stone-600">{m.email || m.phone || '—'}</td>
                    {/* Role and warehouse are decided by the warehouse creation
                        flow, so they are shown here rather than edited. */}
                    <td data-label="Role" className="px-5 py-3"><span className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-stone-100 text-stone-600">{ROLE_LABEL[m.role] || m.role}</span></td>
                    <td data-label="Status" className="px-5 py-3"><span className={`text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${STATUS_STYLE[m.status] || 'bg-stone-100 text-stone-500'}`}>{m.status}</span></td>
                    <td data-label="Warehouses" className="px-5 py-3 text-[11px] text-stone-500">{warehouseLabel(m)}</td>
                    <td className="px-5 py-3 cell-actions text-right">
                      {canManage && (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => toggleStatus(m)} className="text-xs font-bold text-stone-500 hover:text-[#EA2831]">{m.status === 'disabled' ? 'Enable' : 'Disable'}</button>
                          <button onClick={() => remove(m)} className="text-xs font-bold text-stone-400 hover:text-red-500">Remove</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SellerTeam;