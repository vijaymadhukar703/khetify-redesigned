import React, { useCallback, useEffect, useRef, useState } from 'react';
import Swal from 'sweetalert2';
import config from '../../../config/config';
import {
  getCompanyPcApplications, getCompanyPcApplication, reviewPcApplication, requestPcDocs,
  rejectPcApplication, approvePcApplication, issuePc,
  revokeCertificate, reinstateCertificate,
  verifySellerDocument, rejectSellerDocument, attachPcAgreement,
  getCompanyPcForm, saveCompanyPcForm,
} from '../../lib/imsApi';

const FIELD_TYPES = ['text', 'number', 'date', 'select', 'file'];
// Profile autofill targets a seller can map a field to (so it pre-fills).
const PROFILE_FIELDS = [
  ['', 'No autofill (company-specific)'],
  ['identity.businessName', 'Profile · Business name'],
  ['identity.contactPerson', 'Profile · Contact person'],
  ['identity.email', 'Profile · Email'],
  ['identity.phone', 'Profile · Phone'],
  ['identity.address', 'Profile · Address'],
  ['compliance.gstin', 'Profile · GSTIN'],
  ['compliance.pan', 'Profile · PAN'],
  ['compliance.gstCertificateUrl', 'Profile · GST certificate (file)'],
  ['compliance.panFileUrl', 'Profile · PAN file (file)'],
];

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2400, showConfirmButton: false });
const apiErr = (e) => toast('error', e?.response?.data?.message || e.message || 'Something went wrong');
const FILE_ORIGIN = config.BASE_URL.replace(/\/api\/?$/, '');
const absUrl = (u) => (!u ? null : u.startsWith('http') ? u : `${FILE_ORIGIN}${u}`);
const openPdf = (u) => { const a = absUrl(u); if (a) window.open(a, '_blank', 'noopener'); };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const sellerName = (s) => s?.sellerInfo?.businessName || s?.contact?.ownerName || '—';

const STATUS_STYLE = {
  applied: 'bg-amber-50 text-amber-700', under_review: 'bg-blue-50 text-blue-700', need_more_docs: 'bg-orange-50 text-orange-700',
  approved: 'bg-blue-50 text-blue-700', agreement_pending: 'bg-indigo-50 text-indigo-700', agreement_signed: 'bg-indigo-50 text-indigo-700',
  pc_issued: 'bg-green-50 text-green-700',
  active: 'bg-green-50 text-green-700', rejected: 'bg-red-50 text-red-700', revoked: 'bg-red-50 text-red-700', expired: 'bg-stone-100 text-stone-500',
};
// Friendly badge labels (statuses the lifecycle actually surfaces).
const STATUS_LABEL = {
  applied: 'Applied', under_review: 'Under Review', need_more_docs: 'Need Docs',
  agreement_pending: 'Awaiting Signature', agreement_signed: 'Ready to Issue',
  active: 'Active', rejected: 'Rejected',
};
const statusLabel = (s) => STATUS_LABEL[s] || (s || '').replace(/_/g, ' ');

// One lightweight filter (NOT nine tabs). "Pending action" = anything the
// company still needs to act on; the rest are terminal-ish buckets.
const FILTERS = [['all', 'All'], ['pending', 'Pending action'], ['active', 'Active'], ['rejected', 'Rejected']];
const PENDING_ACTION = ['applied', 'under_review', 'need_more_docs', 'agreement_pending', 'agreement_signed'];
const matchesFilter = (status, filter) => (
  filter === 'all' ? true
    : filter === 'pending' ? PENDING_ACTION.includes(status)
    : filter === 'active' ? ['active', 'pc_issued'].includes(status)
    : filter === 'rejected' ? status === 'rejected'
    : true
);

const CompanyPcApplications = () => {
  const [filter, setFilter] = useState('all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    getCompanyPcApplications().then((r) => setRows(r?.data || [])).catch(apiErr).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = rows.filter((a) => matchesFilter(a.status, filter));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 font-sora">
      <div className="flex items-end justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 mb-1">PC Applications</h1>
          <p className="text-stone-500">Review reseller authorizations and issue Principal Certificates. Open a row to act.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowForm((v) => !v)} className="h-10 px-3.5 rounded-lg border border-stone-300 text-sm font-bold text-stone-600 hover:bg-stone-50">
            <span className="material-symbols-outlined text-base align-middle mr-1">tune</span>{showForm ? 'Hide form builder' : 'Application form'}
          </button>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-10 px-3 rounded-lg border border-stone-300 text-sm bg-white outline-none focus:border-[#EA2831]"
          >
            {FILTERS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
      </div>

      {showForm && <FormBuilderCard />}

      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        {loading ? <p className="px-5 py-10 text-center text-stone-400">Loading…</p>
          : visible.length === 0 ? <p className="px-5 py-10 text-center text-stone-400">No applications.</p>
          : (
            <ul className="divide-y divide-stone-100">
              {visible.map((a) => (
                <li key={a._id}>
                  <button
                    onClick={() => setDetail(a._id)}
                    className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-stone-50/70 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-stone-800 truncate">{sellerName(a.sellerId)}</p>
                      <p className="text-[11px] text-stone-400">{(a.productCategories || []).join(', ') || '—'} · {fmtDate(a.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${STATUS_STYLE[a.status] || 'bg-stone-100 text-stone-500'}`}>{statusLabel(a.status)}</span>
                      <span className="text-[11px] font-bold text-[#EA2831] hidden sm:inline">Open</span>
                      <span className="material-symbols-outlined text-stone-300 text-lg">chevron_right</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>

      {detail && <ApplicationDetailModal id={detail} onClose={() => setDetail(null)} onChange={load} />}
    </div>
  );
};

// Company-configurable PC application form builder — add / edit / remove /
// reorder fields, mark required, set the profile autofill mapping, and save.

/**
 * The per-field actions, collapsed behind a single ⋮ button.
 *
 * SAME THREE ACTIONS, SAME HANDLERS — Move up, Move down and Remove still call
 * the exact `move(i, -1)`, `move(i, 1)` and `remove(i)` they always did. Only
 * the presentation changed, so a long field row no longer ends in three icons
 * competing with the inputs beside them.
 *
 * Move up is disabled on the first row and Move down on the last, because those
 * were silent no-ops before: `move` returns the list unchanged at the ends, so
 * the button looked live and did nothing.
 */
const RowActionsMenu = ({ onMoveUp, onMoveDown, onRemove, isFirst, isLast }) => {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // Close on an outside click, the way a native menu behaves.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const run = (fn) => () => { setOpen(false); fn(); };
  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
      >
        <span className="material-symbols-outlined text-lg">more_vert</span>
      </button>

      {open && (
        /* right-0 so the menu opens INWARDS from a right-aligned button and
           cannot spill off the edge of the card on a narrow screen. */
        <div role="menu" className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-xl">
          <button type="button" role="menuitem" disabled={isFirst} onClick={run(onMoveUp)}
            className={`${item} text-stone-600 hover:bg-stone-50`}>
            <span className="material-symbols-outlined text-base">arrow_upward</span> Move up
          </button>
          <button type="button" role="menuitem" disabled={isLast} onClick={run(onMoveDown)}
            className={`${item} text-stone-600 hover:bg-stone-50`}>
            <span className="material-symbols-outlined text-base">arrow_downward</span> Move down
          </button>
          <button type="button" role="menuitem" onClick={run(onRemove)}
            className={`${item} text-[#EA2831] hover:bg-red-50`}>
            <span className="material-symbols-outlined text-base">delete</span> Remove
          </button>
        </div>
      )}
    </div>
  );
};

const FIELDS_PER_PAGE = 5;

const FormBuilderCard = () => {
  const [fields, setFields] = useState(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => { getCompanyPcForm().then((r) => setFields(r?.data?.fields || [])).catch(apiErr); }, []);

  const update = (i, patch) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const remove = (i) => setFields((fs) => fs.filter((_, j) => j !== i));
  const move = (i, dir) => setFields((fs) => {
    const j = i + dir;
    if (j < 0 || j >= fs.length) return fs;
    const next = [...fs]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });
  const add = () => setFields((fs) => {
    const next = [...fs, { key: `field_${fs.length + 1}`, label: '', type: 'text', required: false, profileField: null }];
    // Jump to the page the new field landed on, otherwise "+ Add field" appears
    // to do nothing once the list is longer than one page.
    setPage(Math.ceil(next.length / FIELDS_PER_PAGE));
    return next;
  });

  const save = async () => {
    setBusy(true);
    try {
      const payload = fields.map((f) => ({
        key: f.key, label: f.label, type: f.type, required: !!f.required,
        profileField: f.profileField || null,
        options: f.type === 'select' ? String(f.optionsText ?? (f.options || []).join(', ')).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      }));
      const r = await saveCompanyPcForm(payload);
      setFields(r?.data?.fields || payload);
      toast('success', 'Application form saved');
    } catch (e) { apiErr(e); } finally { setBusy(false); }
  };

  /* PAGINATION — a pure view slice over `fields`. The array itself is never
     reordered or trimmed, so Save still posts EVERY field, not just the page on
     screen.

     THE REAL INDEX IS CARRIED THROUGH. `update`, `move` and `remove` all address
     a field by its position in the full array, so the slice keeps each row's
     true index (`start + n`). Using the position within the page would edit the
     wrong field on page 2 onwards — the classic pagination bug. */
  const total = fields?.length || 0;
  const totalPages = Math.max(1, Math.ceil(total / FIELDS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * FIELDS_PER_PAGE;
  const pageFields = (fields || []).slice(start, start + FIELDS_PER_PAGE);
  const rangeStart = total === 0 ? 0 : start + 1;
  const rangeEnd = Math.min(start + FIELDS_PER_PAGE, total);

  const cell = 'h-9 px-2 rounded-lg border border-stone-300 text-sm bg-white outline-none focus:border-[#EA2831]';
  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm mb-5">
      {/* The explanatory line now sits IN the heading rather than floating at
          the far right of the card, where on a narrow screen it wrapped away
          from the title it belongs to. */}
      <div className="mb-1">
        <h2 className="font-bold text-stone-900">
          Application Form{' '}
          <span className="font-medium text-stone-400">(Sellers fill this when applying for your PC)</span>
        </h2>
      </div>
      <p className="text-xs text-stone-500 mb-4">Map a field to a profile value to auto-fill it from the seller&apos;s profile (so they never re-type PAN/GSTIN/etc.).</p>
      {fields === null ? <p className="text-sm text-stone-400">Loading…</p> : (
        <div className="space-y-2">
          {/* Column headings so each input's purpose is clear (aligned to the field row widths below). */}
          {fields.length > 0 && (
            <div className="hidden md:flex flex-wrap items-center gap-2 px-2 text-[10px] font-bold uppercase tracking-wider text-stone-400">
              <span className="w-40">Field label</span>
              {/* <span className="w-32">Field Key</span> */}
              <span className="w-24">Type</span>
              <span className="w-52">Auto-fill from profile</span>
              <span>Required</span>
              <span className="ml-auto pr-2">Actions</span>
            </div>
          )}
          {pageFields.map((f, n) => {
            // The field's position in the FULL array — every handler below
            // addresses fields by this, never by the index within the page.
            const i = start + n;
            return (
            <div key={i} className="flex flex-wrap items-center gap-2 border border-stone-100 rounded-lg p-2">
              <input className={`${cell} w-40`} value={f.label} placeholder="Label" onChange={(e) => update(i, { label: e.target.value })} />
              {/* <input className={`${cell} w-32`} value={f.key} placeholder="key" onChange={(e) => update(i, { key: e.target.value })} /> */}
              <select className={`${cell} w-24`} value={f.type} onChange={(e) => update(i, { type: e.target.value })}>
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className={`${cell} w-52`} value={f.profileField || ''} onChange={(e) => update(i, { profileField: e.target.value || null })}>
                {PROFILE_FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {f.type === 'select' && (
                <input className={`${cell} w-44`} value={f.optionsText ?? (f.options || []).join(', ')} placeholder="Options (comma-sep)" onChange={(e) => update(i, { optionsText: e.target.value })} />
              )}
              <label className="flex items-center gap-1 text-xs font-bold text-stone-600">
                <input type="checkbox" checked={!!f.required} onChange={(e) => update(i, { required: e.target.checked })} /> Required
              </label>
              <div className="ml-auto flex items-center gap-1">
                <RowActionsMenu
                  onMoveUp={() => move(i, -1)}
                  onMoveDown={() => move(i, 1)}
                  onRemove={() => remove(i)}
                  isFirst={i === 0}
                  isLast={i === total - 1}
                />
              </div>
            </div>
            );
          })}

          {/* PAGINATION. Only shown once there is more than one page — a
              three-field form should not carry a pager. The counts read the FULL
              list, so the total is the real number of fields, not the page. */}
          {total > FIELDS_PER_PAGE && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                Showing {rangeStart}–{rangeEnd} of {total} fields
              </p>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1}
                  className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-bold text-stone-500 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white">
                  Previous
                </button>
                {Array.from({ length: totalPages }, (_, k) => k + 1).map((num) => (
                  <button key={num} type="button" onClick={() => setPage(num)}
                    className={`min-w-[32px] rounded-lg border px-2 py-1.5 text-xs font-bold transition-colors ${
                      num === currentPage
                        ? 'border-[#EA2831] bg-[#EA2831] text-white'
                        : 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50'
                    }`}>
                    {num}
                  </button>
                ))}
                <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === totalPages}
                  className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-bold text-stone-500 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white">
                  Next
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={add} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">+ Add field</button>
            <button onClick={save} disabled={busy} className="text-xs font-bold px-4 py-1.5 rounded-lg bg-[#EA2831] text-white hover:bg-red-600 disabled:opacity-60">{busy ? 'Saving…' : 'Save form'}</button>
          </div>
        </div>
      )}
    </div>
  );
};

const ApplicationDetailModal = ({ id, onClose, onChange }) => {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { getCompanyPcApplication(id).then((r) => setD(r?.data || null)).catch(apiErr); }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, after) => { setBusy(true); try { await fn(); toast('success', after || 'Done'); load(); onChange(); } catch (e) { apiErr(e); } finally { setBusy(false); } };

  const requestDocs = async () => {
    const { value, isConfirmed } = await Swal.fire({ title: 'Request more documents', input: 'text', inputLabel: 'Which documents? (comma-separated)', showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'Request' });
    if (!isConfirmed) return;
    run(() => requestPcDocs(id, { docs: (value || '').split(',').map((s) => s.trim()).filter(Boolean), note: value }), 'Requested');
  };
  const reject = async () => {
    const { value, isConfirmed } = await Swal.fire({ title: 'Reject application', input: 'text', inputLabel: 'Reason', showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'Reject' });
    if (isConfirmed) run(() => rejectPcApplication(id, value || ''), 'Rejected');
  };
  const [showIssue, setShowIssue] = useState(false);
  const confirmIssue = ({ validMonths }) => {
    setShowIssue(false);
    run(() => issuePc(id, { validMonths }), 'Certificate issued');
  };
  const attachRef = useRef(null);
  const attach = async () => {
    const f = attachRef.current?.files?.[0];
    if (!f) { toast('error', 'Choose an agreement file (PDF)'); return; }
    const fd = new FormData(); fd.append('file', f);
    run(() => attachPcAgreement(id, fd), 'Agreement sent to seller');
  };
  // Certificate actions (formerly the Certificates tab) — now in the detail.
  const revokeCert = async (certId) => {
    const r = await Swal.fire({ title: 'Revoke this certificate?', input: 'text', inputLabel: 'Reason (optional)', icon: 'warning', showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'Revoke' });
    if (r.isConfirmed) run(() => revokeCertificate(certId, r.value), 'Certificate revoked');
  };
  const reinstateCert = async (certId) => {
    const r = await Swal.fire({ title: 'Reinstate this certificate?', text: 'It becomes Active again (if still within its validity).', icon: 'question', showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'Reinstate' });
    if (r.isConfirmed) run(() => reinstateCertificate(certId), 'Certificate reinstated');
  };

  const app = d?.application;
  const status = app?.status;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 font-sora" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {!d ? <p className="p-8 text-center text-stone-400">Loading…</p> : (
          <>
            <div className="px-5 py-4 border-b border-stone-200">
              <h3 className="font-bold text-stone-900">{sellerName(app.sellerId)}</h3>
              <p className="text-xs text-stone-500">{(app.productCategories || []).join(', ') || '—'} · <span className="capitalize">{status?.replace(/_/g, ' ')}</span></p>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Business</p>
                <p className="text-sm text-stone-700">{app.businessSnapshot?.businessName || '—'}</p>
                <p className="text-[11px] text-stone-400">GSTIN {app.businessSnapshot?.gstin || '—'} · PAN {app.businessSnapshot?.pan || '—'}</p>
                <p className="text-[11px] text-stone-400">{app.businessSnapshot?.address || '—'}</p>
              </div>
              {app.formAnswers && Object.keys(app.formAnswers).length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Application form</p>
                  <ul className="space-y-1">
                    {(app.formSnapshot?.length ? app.formSnapshot.filter((f) => f.type !== 'file') : Object.keys(app.formAnswers).map((k) => ({ key: k, label: k }))).map((f) => (
                      <li key={f.key} className="text-[11px] text-stone-500 flex gap-2">
                        <span className="font-bold text-stone-700">{f.label}:</span>
                        <span>{String(app.formAnswers[f.key] ?? '—') || '—'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Documents</p>
                {(d.documents || []).length === 0 ? <p className="text-sm text-stone-400">No documents attached.</p> : (
                  <ul className="space-y-1.5">
                    {d.documents.map((doc) => (
                      <li key={doc._id} className="flex items-center justify-between gap-2 border border-stone-100 rounded-lg px-3 py-2">
                        <button onClick={() => openPdf(doc.url)} className="text-xs font-bold text-stone-700 hover:text-[#EA2831] truncate text-left">{doc.label || doc.fileName} <span className="text-stone-400">({doc.docType})</span></button>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 capitalize ${doc.status === 'verified' ? 'bg-green-50 text-green-700' : doc.status === 'rejected' ? 'bg-red-50 text-red-600' : 'bg-stone-100 text-stone-500'}`}>{doc.status || 'pending'}</span>
                          {doc.status !== 'verified' && <button disabled={busy} onClick={() => run(() => verifySellerDocument(doc._id), 'Document verified')} className="text-[11px] font-bold text-green-600 hover:underline">Verify</button>}
                          {doc.status !== 'rejected' && <button disabled={busy} onClick={() => run(() => rejectSellerDocument(doc._id), 'Document rejected')} className="text-[11px] font-bold text-red-500 hover:underline">Reject</button>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {(app.timeline || []).length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Timeline</p>
                  <ul className="space-y-1">
                    {[...app.timeline].reverse().map((t, i) => (
                      <li key={i} className="text-[11px] text-stone-500 flex gap-2">
                        <span className="font-bold text-stone-700 capitalize">{t.status?.replace(/_/g, ' ')}</span>
                        <span>· {t.byType}</span>
                        <span className="text-stone-400">· {fmtDate(t.at)}</span>
                        {t.note && <span className="text-stone-400">· {t.note}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.agreement && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Agreement</p>

                  {/* Awaiting signature: company attaches the contract to send to the seller. */}
                  {status === 'agreement_pending' && (
                    <div className="border border-stone-200 rounded-xl p-3 space-y-2">
                      {d.agreement.agreementFileUrl ? (
                        <>
                          <p className="text-sm font-bold text-indigo-700">Agreement sent to seller for signature</p>
                          <button onClick={() => openPdf(d.agreement.agreementFileUrl)} className="text-xs font-bold text-[#EA2831] hover:underline">View attached agreement</button>
                        </>
                      ) : (
                        <p className="text-sm text-stone-600">Awaiting seller signature. Attach your own agreement to send, or the generated draft will be signed.</p>
                      )}
                      {d.agreement.unsignedPdfUrl && <button onClick={() => openPdf(d.agreement.unsignedPdfUrl)} className="block text-[11px] text-stone-500 hover:underline">View generated draft</button>}
                      <div className="flex items-center gap-2 pt-1">
                        <input ref={attachRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="text-xs" />
                        <button disabled={busy} onClick={attach} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50">{d.agreement.agreementFileUrl ? 'Replace & resend' : 'Attach & send'}</button>
                      </div>
                    </div>
                  )}

                  {/* Signed: show the signed agreement + the prominent next step. */}
                  {status === 'agreement_signed' && (
                    <div className="border border-green-200 bg-green-50/50 rounded-xl p-3 space-y-2">
                      <p className="text-sm font-bold text-green-800">✓ Seller signed the agreement</p>
                      <button onClick={() => openPdf(d.agreement.signedPdfUrl || d.agreement.agreementFileUrl || d.agreement.unsignedPdfUrl)} className="text-xs font-bold text-[#EA2831] hover:underline">View signed agreement</button>
                      <button disabled={busy} onClick={() => setShowIssue(true)} className="block w-full mt-1 rounded-lg bg-[#EA2831] py-2 text-sm font-bold text-white hover:bg-red-600">Issue Principal Certificate →</button>
                    </div>
                  )}

                  {/* Otherwise just a link to the latest agreement document. */}
                  {!['agreement_pending', 'agreement_signed'].includes(status) && (
                    <button onClick={() => openPdf(d.agreement.signedPdfUrl || d.agreement.agreementFileUrl || d.agreement.unsignedPdfUrl)} className="text-sm font-bold text-[#EA2831] hover:underline">Open agreement ({d.agreement.status})</button>
                  )}
                </div>
              )}
              {d.certificate && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Certificate</p>
                  <div className="border border-stone-200 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <button onClick={() => openPdf(d.certificate.pdfUrl)} className="text-sm font-bold text-[#EA2831] hover:underline font-mono">{d.certificate.pcNumber}</button>
                      <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${STATUS_STYLE[d.certificate.status] || 'bg-stone-100 text-stone-500'}`}>{statusLabel(d.certificate.status)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {d.certificate.status === 'active' && <button onClick={() => openPdf(d.certificate.pdfUrl)} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50">Download</button>}
                      {d.certificate.status === 'active' && <button disabled={busy} onClick={() => revokeCert(d.certificate._id)} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Revoke</button>}
                      {d.certificate.status === 'revoked' && <button disabled={busy} onClick={() => reinstateCert(d.certificate._id)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#EA2831] text-white hover:bg-red-600">Reinstate</button>}
                      {d.certificate.status === 'revoked' && d.certificate.revokedReason && <span className="text-[11px] text-red-500 self-center">Revoked: {d.certificate.revokedReason}</span>}
                    </div>
                  </div>

                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-stone-200 flex flex-wrap justify-end gap-2">
              {['applied', 'under_review', 'need_more_docs'].includes(status) && <button disabled={busy} onClick={() => run(() => reviewPcApplication(id), 'Marked under review')} className="text-xs font-bold px-3 py-2 rounded-lg border border-stone-200 hover:bg-stone-50">Mark under review</button>}
              {['applied', 'under_review'].includes(status) && <button disabled={busy} onClick={requestDocs} className="text-xs font-bold px-3 py-2 rounded-lg border border-stone-200 hover:bg-stone-50">Request docs</button>}
              {['applied', 'under_review', 'need_more_docs'].includes(status) && <button disabled={busy} onClick={reject} className="text-xs font-bold px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Reject</button>}
              {['applied', 'under_review', 'need_more_docs'].includes(status) && <button disabled={busy} onClick={() => run(() => approvePcApplication(id), 'Approved — agreement generated')} className="text-xs font-bold px-3 py-2 rounded-lg bg-[#EA2831] text-white hover:bg-red-600">Approve</button>}
              <button onClick={onClose} className="text-xs font-bold px-3 py-2 rounded-lg text-stone-500">Close</button>
            </div>
          </>
        )}
      </div>
      {showIssue && <IssuePcModal busy={busy} onClose={() => setShowIssue(false)} onConfirm={confirmIssue} />}
    </div>
  );
};

// Issue PC dialog — clearly labelled validity (months) with presets + a live
// expiry preview, plus the regulated toggle.
const VALIDITY_PRESETS = [12, 24, 36, 60];
const addMonths = (months) => { const d = new Date(); d.setMonth(d.getMonth() + Number(months || 0)); return d; };

const IssuePcModal = ({ busy, onClose, onConfirm }) => {
  const [months, setMonths] = useState(36);
  const n = Number(months);
  const valid = Number.isInteger(n) && n >= 1 && n <= 120;

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4 font-sora" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-stone-900 mb-1">Issue Principal Certificate</h3>
        <p className="text-xs text-stone-500 mb-4">Set how long the certificate stays valid from today.</p>

        <label className="block text-xs font-bold text-stone-600 mb-1">Validity (months)</label>
        <input
          type="number" min={1} max={120} step={1}
          value={months}
          onChange={(e) => setMonths(e.target.value.replace(/[^0-9]/g, ''))}
          className="w-full h-11 px-3 rounded-lg border border-stone-300 text-sm outline-none focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/10"
        />
        <p className="text-[11px] text-stone-400 mt-1">How long the certificate stays valid from the issue date (1–120 months).</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {VALIDITY_PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => setMonths(p)}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${n === p ? 'border-[#EA2831] bg-red-50 text-[#EA2831]' : 'border-stone-200 text-stone-600 hover:bg-stone-50'}`}>
              {p} mo
            </button>
          ))}
        </div>
        <p className="text-sm font-bold text-stone-700 mt-3">{valid ? `Valid until ${fmtDate(addMonths(n))}` : <span className="text-red-500">Enter 1–120 months</span>}</p>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs font-bold px-4 py-2 rounded-lg text-stone-500 hover:bg-stone-50">Cancel</button>
          <button
            disabled={!valid || busy}
            onClick={() => onConfirm({ validMonths: n })}
            className="text-xs font-bold px-4 py-2 rounded-lg bg-[#EA2831] text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Issue
          </button>
        </div>
      </div>
    </div>
  );
};

export default CompanyPcApplications;