import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { getUsers, updateUser, deleteUser } from '../../lib/imsApi';
import { roleLabel } from '../../lib/roles';
import { GhostBtn, Th } from './ims/ImsUi';
import Can from '../../Components/ims/Can';


const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) =>
  toast('error', err?.response?.data?.message || err.message || 'Something went wrong');

const STATUS_STYLES = {
  active: 'bg-green-50 text-green-600',
  invited: 'bg-amber-50 text-amber-600',
  disabled: 'bg-stone-100 text-stone-400',
};

// Roles that are never warehouse-scoped — they can see every warehouse, so
// there is no single assignment to display for them.
const UNSCOPED_ROLES = ['company_admin', 'super_admin', 'auditor'];

/** The warehouse(s) a member is assigned to, as plain text.
 *  `warehouseIds` is populated with { name, code } by GET /api/users. */
const warehouseLabel = (u) => {
  if (UNSCOPED_ROLES.includes(u.role)) return 'All warehouses';
  const list = (u.warehouseIds || []).map((w) => w?.name).filter(Boolean);
  return list.length ? list.join(', ') : 'Not assigned';
};

/**
 * TEAM & ROLES — a LISTING page.
 *
 * Members are no longer created here. A Warehouse Manager is created as part of
 * creating the Warehouse they run (Warehouses → Add Warehouse), which also
 * assigns them to it in the same operation. This page therefore shows who is on
 * the team, what role they hold and which warehouse they cover, and keeps only
 * the account-lifecycle actions (enable / disable / remove) that have no other
 * home. Role and warehouse are READ-ONLY here — both are set by the warehouse
 * creation flow, which is now the single place that decides them.
 *
 * Nothing was removed from the API: PATCH/DELETE /api/users are untouched, and
 * POST /api/users still exists — the Company Panel simply no longer calls it.
 */
const CompanyUsers = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = () =>
    getUsers().then((r) => r?.success && setUsers(r.data)).catch(apiError).finally(() => setLoading(false));
  useEffect(() => { refresh(); }, []);

  const toggleStatus = async (u) => {
    try { await updateUser(u._id, { status: u.status === 'disabled' ? 'active' : 'disabled' }); refresh(); }
    catch (err) { apiError(err); }
  };
  const remove = async (id) => {
    const ok = await Swal.fire({ icon: 'warning', title: 'Remove this member?', showCancelButton: true, confirmButtonColor: '#EA2831' });
    if (!ok.isConfirmed) return;
    try { await deleteUser(id); toast('success', 'Removed'); refresh(); } catch (err) { apiError(err); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-5xl mx-auto space-y-6">
       
        <div>
          <h2 className="text-xl font-bold text-stone-900">Team & Roles</h2>
          <p className="text-xs text-stone-400">{users.length} member(s)</p>
        </div>

        {/* Where members come from now — stated once, right where someone would
            have looked for the old Add Member button. */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 border border-stone-200 bg-stone-50 rounded-xl p-4">
          <span className="material-symbols-outlined text-stone-400">info</span>
          <p className="flex-1 min-w-0 text-sm text-stone-600">
            Warehouse Managers are created when you add a Warehouse — the manager account is
            created and assigned to that warehouse in one step.
          </p>
          <Can capability="warehouse:manage">
            <GhostBtn onClick={() => navigate('/warehouses?new=1')} className="shrink-0">
              <span className="material-symbols-outlined text-sm">add_business</span> Add Warehouse
            </GhostBtn>
          </Can>
        </div>

        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[760px] resp-table">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200">
                  <Th>Name</Th><Th>Email</Th><Th>Phone</Th><Th>Role</Th><Th>Warehouse</Th><Th>Status</Th><Th right>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {users.map((u) => (
                  <tr key={u._id} className="hover:bg-stone-50/30">
                    <td data-label="Name" className="px-6 py-4 text-sm font-bold text-stone-900">{u.name}</td>
                    <td data-label="Email" className="px-6 py-4 text-sm text-stone-500">{u.email || '—'}</td>
                    <td data-label="Phone" className="px-6 py-4 text-sm text-stone-500">{u.phone || '—'}</td>
                    <td data-label="Role" className="px-6 py-4 text-sm font-medium text-stone-700">
                      {roleLabel(u.role)}
                    </td>
                    {/* Assignment is decided by the warehouse creation flow, so it
                        is shown here rather than edited. */}
                    <td data-label="Warehouse" className="px-6 py-4 text-sm text-stone-600">
                      {warehouseLabel(u)}
                    </td>
                    <td data-label="Status" className="px-6 py-4">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_STYLES[u.status]}`}>{u.status}</span>
                    </td>
                    <td className="px-6 py-4 cell-actions">
                      <div className="flex items-center justify-end gap-2">
                        <Can capability="user:update">
                          <GhostBtn onClick={() => toggleStatus(u)}>{u.status === 'disabled' ? 'Enable' : 'Disable'}</GhostBtn>
                        </Can>
                        <Can capability="user:delete">
                          <GhostBtn onClick={() => remove(u._id)}>Remove</GhostBtn>
                        </Can>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && users.length === 0 && (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-stone-400">No team members yet — add a warehouse to create its manager.</td></tr>
                )}
                {loading && <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-stone-400">Loading…</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanyUsers;