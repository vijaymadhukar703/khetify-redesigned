import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import config from '../../../config/config';

import {
  getSellerDocuments, uploadSellerDocuments, deleteSellerDocument,
  getPcApplications, getPcApplyForm, createPcApplication, attachPcDocuments,
  getPcAgreement, signPcAgreement,
  getSellerCertificates,
} from '../../lib/sellerApi';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2400, showConfirmButton: false });
const apiErr = (e) => toast('error', e?.response?.data?.message || e.message || 'Something went wrong');
const FILE_ORIGIN = config.BASE_URL.replace(/\/api\/?$/, '');
const absUrl = (u) => (!u ? null : u.startsWith('http') ? u : `${FILE_ORIGIN}${u}`);
const openPdf = (u) => { const a = absUrl(u); if (a) window.open(a, '_blank', 'noopener'); };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const APP_STATUS = {
  applied: 'bg-amber-50 text-amber-700', under_review: 'bg-blue-50 text-blue-700', need_more_docs: 'bg-orange-50 text-orange-700',
  approved: 'bg-blue-50 text-blue-700', agreement_pending: 'bg-indigo-50 text-indigo-700', agreement_signed: 'bg-indigo-50 text-indigo-700',
  pc_issued: 'bg-green-50 text-green-700',
  active: 'bg-green-50 text-green-700', rejected: 'bg-red-50 text-red-700', cancelled: 'bg-stone-100 text-stone-500',
};
const CERT_STATUS = { active: 'bg-green-50 text-green-700', expired: 'bg-stone-100 text-stone-500', revoked: 'bg-red-50 text-red-700' };
const CERT_LABEL = { active: 'Active', expired: 'Expired', revoked: 'Revoked' };
const DOC_TYPES = [['gst', 'GST'], ['pan', 'PAN'], ['license', 'License'], ['business_registration', 'Business registration'], ['address_proof', 'Address proof'], ['other', 'Other']];
const companyLabel = (c) => c?.companyInfo?.companyName || c?.fullName || c?.businessName || '—';

const SellerCertifications = () => {
  const [docs, setDocs] = useState([]);
  const [apps, setApps] = useState([]);
  const [certs, setCerts] = useState([]);
  const [params] = useSearchParams();
  const preselectCompany = params.get('company') || '';

  const refresh = useCallback(() => {
    getSellerDocuments().then((r) => setDocs(r?.data || [])).catch(() => {});
    getPcApplications().then((r) => setApps(r?.data || [])).catch(() => {});
    getSellerCertificates().then((r) => setCerts(r?.data || [])).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50/50 font-sora">
      <div className="max-w-5xl mx-auto space-y-8">
     
        <div>
          <h1 className="text-xl font-bold text-stone-900">Certifications</h1>
          <p className="text-sm text-stone-500">Apply for a Principal Certificate to become an authorized reseller. Search a company, fill its application form (your profile details auto-fill), and submit — once the company issues the PC, you can sell its products.</p>
        </div>

        <DocumentsCard docs={docs} onChange={refresh} />
        <ApplyCard preselectCompany={preselectCompany} onApplied={refresh} />
        <ApplicationsCard apps={apps} docs={docs} onChange={refresh} />
        <CertificatesCard certs={certs} />
      </div>
    </div>
  );
};

/* ---- documents ---- */
const DocumentsCard = ({ docs, onChange }) => {
  const fileRef = useRef(null);
  const [docType, setDocType] = useState('gst');
  const [busy, setBusy] = useState(false);

  const upload = async () => {
    const files = fileRef.current?.files;
    if (!files || !files.length) { toast('error', 'Choose a file'); return; }
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('files', f));
    fd.append('docType', docType);
    setBusy(true);
    try { await uploadSellerDocuments(fd); toast('success', 'Uploaded'); fileRef.current.value = ''; onChange(); }
    catch (e) { apiErr(e); } finally { setBusy(false); }
  };
  const remove = async (id) => {
    try { await deleteSellerDocument(id); toast('success', 'Deleted'); onChange(); } catch (e) { apiErr(e); }
  };

  const inputCls = 'h-10 px-3 rounded-lg border border-stone-300 text-sm bg-white outline-none focus:border-[#EA2831]';
  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
      <h2 className="font-bold text-stone-900 mb-3">Business documents</h2>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select className={inputCls} value={docType} onChange={(e) => setDocType(e.target.value)}>
          {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" className="text-sm" />
        <button onClick={upload} disabled={busy} className="h-10 px-4 rounded-lg bg-[#EA2831] text-white text-sm font-bold hover:bg-red-600 disabled:opacity-60">{busy ? 'Uploading…' : 'Upload'}</button>
      </div>
      <div className="divide-y divide-stone-100">
        {docs.length === 0 && <p className="text-sm text-stone-400 py-3">No documents yet.</p>}
        {docs.map((d) => (
          <div key={d._id} className="flex items-center justify-between py-2">
            <div className="min-w-0">
              <button onClick={() => openPdf(d.fileUrl)} className="text-sm font-bold text-stone-800 hover:text-[#EA2831] truncate">{d.label || d.fileName}</button>
              <p className="text-[11px] text-stone-400 uppercase">{d.docType}</p>
            </div>
            <button onClick={() => remove(d._id)} className="text-xs font-bold text-stone-400 hover:text-red-500">Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ---- apply: load the COMPANY's PC form, profile fields auto-fill ---- */
const inputCls = 'w-full h-10 px-3 rounded-lg border border-stone-300 text-sm bg-white outline-none focus:border-[#EA2831]';

const ApplyCard = ({ preselectCompany, onApplied }) => {
  const navigate = useNavigate();
  const [form, setForm] = useState(null); // { company, fields, prefill, profile, alreadyApplied }
  const [loading, setLoading] = useState(false);
  const [answers, setAnswers] = useState({}); // key -> value (non-file)
  const [files, setFiles] = useState({}); // key -> File (non-profile file fields)
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!preselectCompany) { setForm(null); return; }
    setLoading(true);
    getPcApplyForm(preselectCompany)
      .then((r) => {
        const d = r?.data || null;
        setForm(d);
        if (d) setAnswers({ ...d.prefill }); // seed editable fields with profile prefill
      })
      .catch((e) => { apiErr(e); setForm(null); })
      .finally(() => setLoading(false));
  }, [preselectCompany]);

  const setAns = (k) => (v) => setAnswers((a) => ({ ...a, [k]: v }));
  const setFile = (k) => (f) => setFiles((s) => ({ ...s, [k]: f }));

  const submit = async () => {
    const fields = form.fields || [];
    // Validate required, non-autofilled fields the seller must fill.
    for (const f of fields) {
      if (!f.required) continue;
      if (f.type === 'file') {
        if (f.profileField) continue; // satisfied by the profile (auto-attached)
        if (!files[f.key]) { toast('error', `${f.label} is required`); return; }
      } else if (!String(answers[f.key] ?? '').trim()) {
        toast('error', `${f.label} is required`); return;
      }
    }
    setBusy(true);
    try {
      // Upload any company-specific (non-profile) file fields → SellerDocuments.
      const documentIds = [];
      for (const f of fields) {
        if (f.type === 'file' && !f.profileField && files[f.key]) {
          const fd = new FormData();
          fd.append('files', files[f.key]);
          fd.append('docType', 'other');
          fd.append('label', f.label);
          const up = await uploadSellerDocuments(fd);
          (up?.data || []).forEach((d) => documentIds.push(d._id));
        }
      }
      await createPcApplication({ companyId: form.company._id, formAnswers: answers, documentIds });
      toast('success', 'Application submitted');
      navigate('/seller/certifications'); // drop ?company= → show the applications list
      onApplied();
    } catch (e) { apiErr(e); } finally { setBusy(false); }
  };

  if (!preselectCompany) {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
        <h2 className="font-bold text-stone-900 mb-2">Apply for a Principal Certificate</h2>
        <p className="text-sm text-stone-500">Pick a company to apply to — each company has its own application form.</p>
        <button onClick={() => navigate('/seller/companies')} className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-[#EA2831] hover:underline">
          <span className="material-symbols-outlined text-base">domain</span> Find a company
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
      <h2 className="font-bold text-stone-900 mb-3">
        Apply for a Principal Certificate{form?.company ? ` — ${form.company.name}` : ''}
      </h2>
      {loading || !form ? (
        <p className="text-sm text-stone-400">Loading the application form…</p>
      ) : !form.profile.complete ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-bold text-amber-800">Complete your profile first</p>
          <p className="text-xs text-amber-700 mt-0.5">Add: {form.profile.missing.join(', ')}.</p>
          <button onClick={() => navigate('/seller/profile')} className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-[#EA2831] hover:underline">
            <span className="material-symbols-outlined text-base">person</span> Go to Profile
          </button>
        </div>
      ) : form.alreadyApplied ? (
        <p className="text-sm text-stone-500">You already have an active application or certificate with this company. <button onClick={() => navigate('/seller/certifications')} className="font-bold text-[#EA2831] hover:underline">View status</button></p>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-stone-400">Fields marked <span className="font-bold text-stone-500">from profile</span> are auto-filled — update them on your Profile page.</p>
          {form.fields.map((f) => {
            const mapped = !!f.profileField;
            if (f.type === 'file') {
              return (
                <div key={f.key}>
                  <label className="block text-xs font-bold text-stone-600 mb-1">{f.label}{f.required && <span className="text-[#EA2831]"> *</span>}</label>
                  {mapped ? (
                    <p className="text-xs text-stone-500 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
                      {answers[f.key] ? '✓ Auto-attached from your profile' : '⚠ Missing in your profile'} <span className="text-stone-400">· from profile</span>
                    </p>
                  ) : (
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="text-sm" onChange={(e) => setFile(f.key)(e.target.files?.[0] || null)} />
                  )}
                </div>
              );
            }
            return (
              <div key={f.key}>
                <label className="block text-xs font-bold text-stone-600 mb-1">
                  {f.label}{f.required && <span className="text-[#EA2831]"> *</span>}
                  {mapped && <span className="ml-2 text-[10px] font-bold text-stone-400">from profile</span>}
                </label>
                {f.type === 'select' ? (
                  <select className={inputCls} value={answers[f.key] || ''} onChange={(e) => setAns(f.key)(e.target.value)} disabled={mapped}>
                    <option value="">Select…</option>
                    {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    className={`${inputCls} ${mapped ? 'bg-stone-50 text-stone-500' : ''}`}
                    value={answers[f.key] || ''}
                    onChange={(e) => setAns(f.key)(e.target.value)}
                    readOnly={mapped}
                  />
                )}
              </div>
            );
          })}
          <button onClick={submit} disabled={busy} className="rounded-lg bg-[#EA2831] px-5 py-2 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-60">{busy ? 'Submitting…' : 'Submit application'}</button>
        </div>
      )}
    </div>
  );
};

/* ---- applications ---- */
const ApplicationsCard = ({ apps, docs, onChange }) => {
  const [signing, setSigning] = useState(null);

  const addDocs = async (app) => {
    if (docs.length === 0) { toast('error', 'Upload documents first'); return; }
    const { value, isConfirmed } = await Swal.fire({
      title: 'Add documents',
      html: `<div style="text-align:left">${docs.map((d) => `<label style="display:block;margin:4px 0"><input type="checkbox" value="${d._id}" class="pcdoc"> ${d.label || d.fileName}</label>`).join('')}</div>`,
      showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'Submit',
      preConfirm: () => Array.from(document.querySelectorAll('.pcdoc:checked')).map((el) => el.value),
    });
    if (!isConfirmed) return;
    try { await attachPcDocuments(app._id, value || []); toast('success', 'Documents submitted'); onChange(); } catch (e) { apiErr(e); }
  };

  return (
    <div>
      <h2 className="font-bold text-stone-900 mb-3">My applications</h2>
      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
        {apps.length === 0 ? <p className="px-5 py-8 text-center text-sm text-stone-400">No applications yet.</p> : (
          <ul className="divide-y divide-stone-100">
            {apps.map((a) => (
              <li key={a._id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-stone-800 truncate">{companyLabel(a.companyId)}</p>
                  <p className="text-[11px] text-stone-400">{(a.productCategories || []).join(', ') || '—'} · {fmtDate(a.createdAt)}</p>
                  {a.status === 'need_more_docs' && a.requestedDocs?.length > 0 && <p className="text-[11px] text-orange-600 mt-0.5">Requested: {a.requestedDocs.join(', ')}</p>}
                  {a.status === 'agreement_pending' && <p className="text-[11px] text-indigo-600 mt-0.5">Agreement ready — review &amp; sign</p>}
                  {a.status === 'agreement_signed' && <p className="text-[11px] text-indigo-600 mt-0.5">Signed — awaiting certificate</p>}
                  {a.status === 'rejected' && a.rejectionReason && <p className="text-[11px] text-red-500 mt-0.5">{a.rejectionReason}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {a.status === 'need_more_docs' && <button onClick={() => addDocs(a)} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50">Add docs</button>}
                  {a.status === 'agreement_pending' && <button onClick={() => setSigning(a)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#EA2831] text-white hover:bg-red-600">Review &amp; sign</button>}
                  <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${APP_STATUS[a.status] || 'bg-stone-100 text-stone-500'}`}>{a.status.replace(/_/g, ' ')}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {signing && <SignModal app={signing} onClose={() => setSigning(null)} onDone={() => { setSigning(null); onChange(); }} />}
    </div>
  );
};

const SignModal = ({ app, onClose, onDone }) => {
  const [agreement, setAgreement] = useState(null);
  const [busy, setBusy] = useState(false);
  const uploadRef = useRef(null);

  useEffect(() => { getPcAgreement(app._id).then((r) => setAgreement(r?.data || null)).catch(() => {}); }, [app._id]);

  const signUpload = async () => {
    const f = uploadRef.current?.files?.[0];
    if (!f) { toast('error', 'Choose the signed copy to upload'); return; }
    const fd = new FormData(); fd.append('file', f);
    setBusy(true);
    try { await signPcAgreement(app._id, fd); toast('success', 'Signed copy uploaded'); onDone(); }
    catch (e) { apiErr(e); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 font-sora" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-stone-900 mb-2">Authorization agreement</h3>
        <p className="text-xs text-stone-500 mb-3">Download the agreement your company sent, sign it, then upload the signed copy.</p>
        <button onClick={() => openPdf(agreement?.agreementFileUrl || agreement?.unsignedPdfUrl)} disabled={!agreement} className="text-sm font-bold text-[#EA2831] hover:underline disabled:opacity-50">Open agreement to review &amp; download →</button>

        <div className="mt-4 pt-4 border-t border-stone-100 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-stone-400">Upload signed copy</p>
          <input ref={uploadRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="text-sm" />
          <button onClick={signUpload} disabled={busy} className="w-full rounded-lg bg-[#EA2831] py-2 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-60">{busy ? 'Uploading…' : 'Submit signed agreement'}</button>
        </div>

        <div className="mt-4 flex justify-end"><button onClick={onClose} className="text-xs font-bold text-stone-500">Cancel</button></div>
      </div>
    </div>
  );
};

/* ---- certificates ---- */
const CertificatesCard = ({ certs }) => (
  <div>
    <h2 className="font-bold text-stone-900 mb-3">My certificates</h2>
    <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
      {certs.length === 0 ? <p className="px-5 py-8 text-center text-sm text-stone-400">No certificates yet.</p> : (
        <ul className="divide-y divide-stone-100">
          {certs.map((c) => (
            <li key={c._id} className="px-5 py-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-stone-800 font-mono">{c.pcNumber}</p>
                <p className="text-[11px] text-stone-400">{companyLabel(c.companyId)} · valid till {fmtDate(c.validUntil)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {c.status === 'active' && <button onClick={() => openPdf(c.pdfUrl)} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50">Download</button>}
                <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${CERT_STATUS[c.status] || 'bg-stone-100 text-stone-500'}`}>{CERT_LABEL[c.status] || c.status}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  </div>
);

export default SellerCertifications;
