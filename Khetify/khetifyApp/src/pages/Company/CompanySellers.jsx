import React, { useCallback, useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { useNavigate } from 'react-router-dom';
import { getCompanySellers } from '../../lib/imsApi';


const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// SELLERS (downstream dealers/distributors this company supplies). These are the
// APPROVED RESELLERS — the sellers this company has ISSUED a Principal
// Certificate to (issuing a PC IS the authorization). New applicants are
// reviewed on the PC Applications page; there is no separate link approval here.
const CompanySellers = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    getCompanySellers()
      .then((r) => setRows(listOf(r)))
      .catch((e) => { apiError(e); setRows([]); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 font-sora">
     
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-stone-900">Sellers</h1>
        <button onClick={() => navigate('/pc-applications')} className="text-xs font-bold px-3.5 py-2 rounded-lg border border-[#EA2831] text-[#EA2831] hover:bg-red-50 transition-colors">
          Review PC applications
        </button>
      </div>
      <p className="text-stone-500 mb-5">Your authorized resellers — the dealers you&apos;ve issued a Principal Certificate to.</p>

      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[720px] resp-table">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50/50">
              {['Business', 'Contact', 'Location', 'Certificate', 'Issued'].map((h, i) => (
                <th key={i} className="px-5 py-3.5 text-[10px] font-bold text-stone-400 uppercase tracking-widest">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {loading ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-stone-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-stone-400">
                No authorized sellers yet — issue a Principal Certificate from the PC Applications page.
              </td></tr>
            ) : rows.map((s) => (
              <tr key={s._id} className="hover:bg-stone-50/60">
                <td data-label="Business" className="px-5 py-3.5">
                  <p className="font-bold text-stone-800 text-sm">{s.businessName}</p>
                  <p className="text-xs text-stone-400">{s.contact?.ownerName || '—'}</p>
                </td>
                <td data-label="Contact" className="px-5 py-3.5 text-sm text-stone-600">
                  <p>{s.email || '—'}</p>
                  <p className="text-xs text-stone-400">{s.phone || '—'}</p>
                </td>
                <td data-label="Location" className="px-5 py-3.5 text-sm text-stone-600">
                  {[s.contact?.address?.city, s.contact?.address?.state].filter(Boolean).join(', ') || '—'}
                </td>
                <td data-label="Certificate" className="px-5 py-3.5 text-sm">
                  <span className="font-mono text-xs text-stone-700">{s.pcNumber || '—'}</span>
                </td>
                <td data-label="Issued" className="px-5 py-3.5 text-sm text-stone-500">{fmtDate(s.approvedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CompanySellers;
