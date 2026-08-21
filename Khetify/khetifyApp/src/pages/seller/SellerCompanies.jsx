import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSellerCompanies, searchSellerCompanies, getRecommendedCompanies } from '../../lib/sellerApi';


const STATUS_STYLE = {
  active: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-700',
};
const inProgress = (s) => s && s !== 'active' && s !== 'rejected';
const statusLabel = (s) => (s === 'active' ? 'PC issued' : (s || '').replace(/_/g, ' '));

// Seller → Companies. Lists the companies the seller has a Principal Certificate
// from (issued = the authorization) plus any in-progress / rejected PC
// applications, and lets the seller search for NEW companies to APPLY FOR A PC.
// There is no separate "request link → approve" step anymore.
const SellerCompanies = () => {
  const navigate = useNavigate();
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [recommended, setRecommended] = useState([]);

  const loadLinks = useCallback(() => {
    getSellerCompanies()
      .then((r) => setLinks(r?.data || []))
      .catch(() => setLinks([]))
      .finally(() => setLoading(false));
    getRecommendedCompanies()
      .then((r) => setRecommended(r?.data || []))
      .catch(() => setRecommended([]));
  }, []);
  useEffect(() => { loadLinks(); }, [loadLinks]);

  // Debounced company search. All setState happens inside the async timeout
  // callback (never synchronously in the effect body).
  useEffect(() => {
    const term = q.trim();
    let alive = true;
    const t = setTimeout(() => {
      if (!term) { if (alive) setResults([]); return; }
      setSearching(true);
      searchSellerCompanies(term)
        .then((r) => { if (alive) setResults(r?.data || []); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, term ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  // Applying for a PC happens via the company's application form on the
  // Certifications page (profile autofill + the company's custom fields).
  const applyForPc = (company) => navigate(`/seller/certifications?company=${company._id}`);

  const ApplyBtn = ({ company }) => (
    <button onClick={() => applyForPc(company)} className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg bg-[#EA2831] text-white hover:bg-red-600">
      Apply for PC
    </button>
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50/50 font-sora">
      <div className="max-w-4xl mx-auto space-y-8">
        
        <div>
          <h1 className="text-xl font-bold text-stone-900">Companies</h1>
          <p className="text-sm text-stone-500">Companies that issued you a Principal Certificate — and new ones to apply to.</p>
        </div>

        {/* Search → apply for a PC */}
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm">
          <label className="block text-xs font-bold text-stone-600 mb-1">Find a company to sell for</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by company name or region…"
            className="w-full h-11 px-3 rounded-lg border border-stone-300 outline-none focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/10 text-sm"
          />
          {q.trim() && (
            <div className="mt-2 border border-stone-200 rounded-lg divide-y divide-stone-100 max-h-72 overflow-y-auto">
              {searching && <p className="px-3 py-2 text-sm text-stone-400">Searching…</p>}
              {!searching && results.length === 0 && <p className="px-3 py-2 text-sm text-stone-400">No new companies found.</p>}
              {results.map((c) => (
                <div key={c._id} className="flex items-center justify-between px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-stone-800 truncate">{c.businessName}</p>
                    {c.location && <p className="text-[11px] text-stone-400">{c.location}</p>}
                  </div>
                  <ApplyBtn company={c} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* My companies (derived from PC status) */}
        <div>
          <h2 className="text-base font-bold text-stone-900 mb-3">My companies</h2>
          <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
            {loading ? (
              <p className="px-5 py-10 text-center text-sm text-stone-400">Loading…</p>
            ) : links.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-stone-400">No companies yet — search above to apply for a PC.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {links.map((c) => (
                  <li key={c._id} className="flex items-center justify-between px-5 py-4">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-stone-800 truncate">
                        {c.businessName}
                        {c.pcNumber && <span className="ml-2 text-[10px] font-mono text-stone-400">{c.pcNumber}</span>}
                      </p>
                      <p className="text-[11px] text-stone-400">
                        {c.location || '—'}
                        {c.status === 'rejected' && c.rejectionReason ? ` · ${c.rejectionReason}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.status === 'active' && (
                        <button onClick={() => navigate('/seller/certifications')} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">View certificate</button>
                      )}
                      {inProgress(c.status) && (
                        <button onClick={() => navigate('/seller/certifications')} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">View status</button>
                      )}
                      {c.status === 'rejected' && <ApplyBtn company={c} />}
                      <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${STATUS_STYLE[c.status] || 'bg-amber-50 text-amber-700'}`}>
                        {statusLabel(c.status)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Recommended — approved companies to apply to, IMS-subscribed first. */}
        {recommended.length > 0 && (
          <div>
            <div className="flex items-end justify-between mb-3">
              <h2 className="text-base font-bold text-stone-900">Recommended for you</h2>
              <span className="text-[11px] text-stone-400">Companies on Khetify IMS appear first</span>
            </div>
            <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
              <ul className="divide-y divide-stone-100">
                {recommended.map((c) => (
                  <li key={c._id} className={`flex items-center justify-between px-5 py-4 ${c.subscribed ? 'bg-amber-50/30' : ''}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-stone-800 truncate flex items-center gap-2">
                        {c.businessName}
                        {c.subscribed && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">
                            <span className="material-symbols-outlined text-[12px]">star</span> Preferred · IMS
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-stone-400">
                        {c.location || '—'}
                        {c.subscribed && <span className="text-stone-400"> · Uses Khetify Inventory</span>}
                      </p>
                    </div>
                    <ApplyBtn company={c} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SellerCompanies;
