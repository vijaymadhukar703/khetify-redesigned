import React, { useState } from 'react';
import { fileHref } from '../lib/fileHref';
import { profileChecks, profileCompletion } from '../lib/profileCompletion';

// Shared registration-details Profile page used by BOTH the company and seller
// portals (same layout + styling). Display-only until "Edit profile" is tapped,
// then identity + compliance fields become inputs and each document gets a
// file-picker to replace it. Save builds a multipart payload and calls
// `onSave(formData)` (the portal's PATCH); on success the parent refreshes the
// model and the completion bar updates.
//
// Normalized model:
//   { identity:{ businessName, contactPerson, email, phone, address },
//     compliance:{ gstin, pan, udyam, gstCertificateUrl, panFileUrl, udyamCertificateUrl },
//     documents:[{ _id, label, fileName, status, url }] }

const brand = '#EA2831';
const inputCls = 'w-full border border-stone-200 rounded-lg px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#EA2831]/30 focus:border-[#EA2831]';

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/i;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';
const fileOk = (f) => !f || (/(pdf|jpe?g|png|webp)$/i.test(f.name) && f.size <= MAX_BYTES);

/* OTHER REGISTRATION LICENCES — seller portal only.

   Rendered ONLY when the caller passes `licences` (SellerProfile does; the
   company profile does not), so the company page keeps the free-form
   "Other registration documents" list it has always had. The field names
   below must match SELLER_LICENCES in sellerAuthController.js and the multer
   fields in routes/Seller/sellerRoutes.js. */
/* LICENCE NUMBER FORMATS.

   TAN and Udyam are issued centrally and have ONE published format, so they
   are checked. Gumasta / Shop Act, Agriculture and Horticulture are issued
   per STATE, each in its own scheme — there is no national format, and a
   regex would reject real licence numbers and leave those sellers unable to
   record their licence at all. `re: null` on those three is deliberate.

   The server enforces exactly the same two rules (SELLER_LICENCES in
   sellerAuthController.js); this is the immediate feedback, not the gate. */
const LICENCE_MAX_LEN = 30;

// Letters + digits only, capped. What TAN and the free-form licences share.
const cleanUpper = (v, max) => String(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max);

/* UDYAM types itself: the seller enters MP230001234 (or udyam-mp-23-0001234,
   or anything in between) and the hyphens appear on their own.

   While the value is still a prefix of the literal "UDYAM" it is left alone,
   so someone typing the prefix out sees U → UD → UDY rather than the field
   fighting them. Everything after that is split into the state / year /
   serial groups. Clearing the field must stay possible, so an empty input
   returns empty rather than rebuilding the prefix. */
const formatUdyam = (raw) => {
  const flat = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!flat) return '';
  if ('UDYAM'.startsWith(flat)) return flat;

  const rest = flat.startsWith('UDYAM') ? flat.slice(5) : flat;
  const state = rest.slice(0, 2).replace(/[^A-Z]/g, '');
  const afterState = rest.slice(state.length);
  const year = afterState.slice(0, 2).replace(/\D/g, '');
  const serial = afterState.slice(year.length).replace(/\D/g, '').slice(0, 7);

  let out = 'UDYAM';
  if (state) out += `-${state}`;
  if (year) out += `-${year}`;
  if (serial) out += `-${serial}`;
  return out;
};

const LICENCE_ROWS = [
  { key: 'tan',          label: 'TAN',                  doc: 'TAN certificate',          numField: 'tanNumber',          fileField: 'tanCertificate',
    placeholder: 'MUMA12345B',
    format: (v) => cleanUpper(v, 10),
    re: /^[A-Z]{4}[0-9]{5}[A-Z]$/,
    error: 'TAN must be 10 characters — 4 letters, 5 digits, 1 letter (e.g. MUMA12345B)' },

  { key: 'gumasta',      label: 'Gumasta / Shop Act',   doc: 'Gumasta certificate',      numField: 'gumastaNumber',      fileField: 'gumastaCertificate',
    format: (v) => String(v).toUpperCase().slice(0, LICENCE_MAX_LEN), re: null },

  { key: 'udyam',        label: 'Udyam',                doc: 'Udyam certificate',        numField: 'udyamNumber',        fileField: 'udyamCertificate',
    placeholder: 'UDYAM-MP-23-0001234',
    format: formatUdyam,
    re: /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/,
    error: 'Udyam number must look like UDYAM-MP-23-0001234' },

  { key: 'agriculture',  label: 'Agriculture licence',  doc: 'Agriculture certificate',  numField: 'agricultureNumber',  fileField: 'agricultureCertificate',
    format: (v) => String(v).toUpperCase().slice(0, LICENCE_MAX_LEN), re: null },

  { key: 'horticulture', label: 'Horticulture licence', doc: 'Horticulture certificate', numField: 'horticultureNumber', fileField: 'horticultureCertificate',
    format: (v) => String(v).toUpperCase().slice(0, LICENCE_MAX_LEN), re: null },
];

// A certificate scan is capped tighter than the 10MB the other KYC uploads
// allow; the server enforces the same 5MB, this just says so before the
// upload rather than after it.
const LICENCE_MAX_BYTES = 5 * 1024 * 1024;
const licenceFileOk = (f) => !f || (/(pdf|jpe?g|png)$/i.test(f.name) && f.size <= LICENCE_MAX_BYTES);

// View / Download links for a stored file (signed S3 url or served /uploads path).
const DocLinks = ({ url, fileName }) => {
  const href = fileHref(url);
  if (!href) return <span className="text-xs text-stone-400">Not provided</span>;
  return (
    <div className="flex items-center gap-3">
      <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-[#EA2831] hover:underline">
        <span className="material-symbols-outlined text-sm">visibility</span> View
      </a>
      <a href={href} download={fileName || true} className="inline-flex items-center gap-1 text-xs font-bold text-stone-500 hover:text-stone-800">
        <span className="material-symbols-outlined text-sm">download</span> Download
      </a>
    </div>
  );
};

const Empty = () => <span className="text-sm text-stone-400 italic">Not provided</span>;

const Card = ({ title, icon, children }) => (
  <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm">
    <h3 className="flex items-center gap-2 text-sm font-bold text-stone-900 mb-5">
      {icon && <span className="material-symbols-outlined text-[20px] text-stone-400">{icon}</span>}{title}
    </h3>
    {children}
  </div>
);

// One identity field: static text in display mode, an input in edit mode.
const IdField = ({ label, value, editing, onChange, type = 'text', error }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</span>
    {editing ? (
      <input className={inputCls} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    ) : (value ? <span className="text-sm font-medium text-stone-800 break-words">{value}</span> : <Empty />)}
    {error && <span className="text-[11px] font-medium text-[#EA2831]">{error}</span>}
  </div>
);

// A compliance row (GSTIN / PAN): value + its document, editable inline.
// `format` (optional) rewrites each keystroke — uppercasing, capping length,
// inserting Udyam's hyphens. Omitted for GSTIN / PAN, which keep the plain
// pass-through they have always had.
const ComplianceRow = ({ label, docLabel, value, editing, onChange, error, url, fileName, fileKey, onFile, fileErr, chosenName, format, placeholder }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 py-3.5">
    <div className="min-w-[220px] flex-1">
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
      {editing ? (
        <input className={`${inputCls} mt-1 font-mono uppercase`} value={value} onChange={(e) => onChange(format ? format(e.target.value) : e.target.value)} placeholder={placeholder || label} />
      ) : (value ? <p className="text-sm font-mono font-medium text-stone-800">{value}</p> : <Empty />)}
      {error && <span className="text-[11px] font-medium text-[#EA2831]">{error}</span>}
      <p className="text-[10px] text-stone-400 mt-1">{docLabel}</p>
      {editing && (
        <div className="mt-1">
          <input id={`file-${fileKey}`} type="file" accept={ACCEPT} className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] || null)} />
          <label htmlFor={`file-${fileKey}`} className="inline-flex items-center gap-1 text-xs font-bold text-stone-600 border border-stone-200 rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-stone-50">
            <span className="material-symbols-outlined text-sm">upload_file</span> {url ? 'Replace file' : 'Upload file'}
          </label>
          {chosenName && <span className="ml-2 text-[11px] text-stone-500">{chosenName}</span>}
          {fileErr && <span className="block text-[11px] font-medium text-[#EA2831] mt-0.5">{fileErr}</span>}
        </div>
      )}
    </div>
    {!editing && <DocLinks url={url} fileName={fileName} />}
  </div>
);

// `licences` (optional) turns on the five-row Other registration documents
// section. Absent → the section renders exactly as it always did.
const ProfileView = ({ title, model, loading, error, onSave, licences: showLicences = false }) => {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);     // identity + compliance text fields
  const [files, setFiles] = useState({});     // { gstCertificate, panFile, otherDocs:[] }
  const [fileNames, setFileNames] = useState({}); // chosen-file labels for display
  const [errs, setErrs] = useState({});        // inline field errors
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);  // { ok, msg }

  if (loading) {
    return <div className="flex-1 p-4 sm:p-8 bg-white font-sora"><p className="text-sm text-stone-400">Loading profile…</p></div>;
  }
  if (error) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-3xl mx-auto bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-[#EA2831] text-3xl">error</span>
          <p className="text-sm font-bold text-red-800 mt-1">Couldn&apos;t load your profile</p>
          <p className="text-xs text-red-700 mt-0.5">{error}</p>
        </div>
      </div>
    );
  }

  const id = model?.identity || {};
  const c = model?.compliance || {};
  const documents = model?.documents || [];
  const lic = model?.licences || {};
  const { pct, missing } = profileCompletion(profileChecks(model || {}));

  const startEdit = () => {
    setForm({
      businessName: id.businessName || '', contactPerson: id.contactPerson || '', email: id.email || '',
      phone: id.phone || '', address: id.address || '', gstin: c.gstin || '', pan: c.pan || '',
      // Seeded from the saved values so an untouched row re-posts what it had
      // rather than blanking it.
      ...Object.fromEntries(LICENCE_ROWS.map((r) => [r.numField, lic[r.key]?.number || ''])),
    });
    setFiles({ otherDocs: [] });
    setFileNames({});
    setErrs({});
    setBanner(null);
    setEditing(true);
  };
  const cancel = () => { setEditing(false); setErrs({}); setFileNames({}); };

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const pickFile = (k) => (f) => {
    setErrs((e) => ({ ...e, [k]: fileOk(f) ? undefined : 'PDF or image up to 10MB' }));
    setFileNames((n) => ({ ...n, [k]: f?.name }));
    setFiles((prev) => ({ ...prev, [k]: f }));
  };
  const pickOthers = (list) => {
    const arr = Array.from(list || []);
    const bad = arr.find((f) => !fileOk(f));
    setErrs((e) => ({ ...e, otherDocs: bad ? 'Each file must be a PDF or image up to 10MB' : undefined }));
    setFileNames((n) => ({ ...n, otherDocs: arr.map((f) => f.name).join(', ') }));
    setFiles((prev) => ({ ...prev, otherDocs: arr }));
  };

  const validate = () => {
    const e = {};
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email';
    if (form.phone && !/^[0-9]{10}$/.test(form.phone)) e.phone = 'Enter a 10-digit phone';
    if (form.gstin && !GSTIN_RE.test(form.gstin.trim())) e.gstin = 'Invalid GSTIN (15 chars)';
    if (form.pan && !PAN_RE.test(form.pan.trim())) e.pan = 'Invalid PAN (10 chars)';
    if (!fileOk(files.gstCertificate)) e.gstCertificate = 'PDF or image up to 10MB';
    if (!fileOk(files.panFile)) e.panFile = 'PDF or image up to 10MB';
    if ((files.otherDocs || []).some((f) => !fileOk(f))) e.otherDocs = 'Each file must be a PDF or image up to 10MB';
    if (showLicences) {
      LICENCE_ROWS.forEach((r) => {
        if (!licenceFileOk(files[r.fileField])) e[r.fileField] = 'PNG, JPG or PDF up to 5MB';
        // OPTIONAL fields: a blank one is fine and must never block the save.
        // Only a value that is actually present is checked, and only for the
        // two formats that have a national standard.
        const v = (form[r.numField] || '').trim();
        if (v && r.re && !r.re.test(v)) e[r.numField] = r.error;
      });
    }
    setErrs(e);
    return Object.values(e).every((x) => !x);
  };

  const save = async () => {
    if (!validate()) return;
    const fd = new FormData();
    ['businessName', 'contactPerson', 'email', 'phone', 'address', 'gstin', 'pan'].forEach((k) => fd.append(k, form[k] ?? ''));
    if (files.gstCertificate) fd.append('gstCertificate', files.gstCertificate);
    if (files.panFile) fd.append('panFile', files.panFile);
    (files.otherDocs || []).forEach((f) => fd.append('otherDocs', f));
    if (showLicences) {
      LICENCE_ROWS.forEach((r) => {
        fd.append(r.numField, form[r.numField] ?? '');
        if (files[r.fileField]) fd.append(r.fileField, files[r.fileField]);
      });
    }
    setSaving(true);
    setBanner(null);
    try {
      await onSave(fd);
      setFileNames({});
      setEditing(false);
      setBanner({ ok: true, msg: 'Profile saved' });
    } catch (err) {
      setBanner({ ok: false, msg: err?.response?.data?.message || err.message || 'Could not save' });
    } finally { setSaving(false); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-stone-900">{title}</h2>
          {onSave && !editing && (
            <button onClick={startEdit} className="inline-flex items-center gap-1.5 border border-stone-200 hover:bg-stone-50 text-stone-700 text-sm font-bold rounded-lg px-4 py-2 transition-colors">
              <span className="material-symbols-outlined text-base">edit</span> Edit profile
            </button>
          )}
        </div>

        {banner && (
          <div className={`rounded-xl px-4 py-3 text-sm font-medium ${banner.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {banner.msg}
          </div>
        )}

        {/* Completion bar */}
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-stone-900">Profile {pct}% complete</h3>
            <span className="text-xs font-bold" style={{ color: pct === 100 ? '#16a34a' : brand }}>
              {pct === 100 ? 'All set 🎉' : `${missing.length} item${missing.length === 1 ? '' : 's'} left`}
            </span>
          </div>
          <div className="h-2 w-full bg-stone-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#16a34a' : brand }} />
          </div>
          {missing.length > 0 && (
            <p className="text-xs text-stone-500 mt-3">Add: <span className="font-medium text-stone-700">{missing.join(', ')}</span></p>
          )}
        </div>

        {/* Business identity */}
        <Card title="Business identity" icon="badge">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <IdField label="Business / legal name" value={editing ? form.businessName : id.businessName} editing={editing} onChange={set('businessName')} />
            <IdField label="Contact person" value={editing ? form.contactPerson : id.contactPerson} editing={editing} onChange={set('contactPerson')} />
            <IdField label="Email" value={editing ? form.email : id.email} editing={editing} onChange={set('email')} error={errs.email} />
            <IdField label="Phone" value={editing ? form.phone : id.phone} editing={editing} onChange={set('phone')} error={errs.phone} />
            <div className="sm:col-span-2">
              <IdField label="Address / location" value={editing ? form.address : id.address} editing={editing} onChange={set('address')} />
            </div>
          </div>
        </Card>

        {/* Compliance — GSTIN / PAN with their documents */}
        <Card title="Compliance & registration" icon="verified_user">
          <div className="divide-y divide-stone-100">
            <ComplianceRow label="GSTIN" docLabel="GST certificate" value={editing ? form.gstin : c.gstin}
              editing={editing} onChange={set('gstin')} error={errs.gstin}
              url={c.gstCertificateUrl} fileName="gst-certificate" fileKey="gstCertificate"
              onFile={pickFile('gstCertificate')} fileErr={errs.gstCertificate} chosenName={fileNames.gstCertificate} />
            <ComplianceRow label="PAN" docLabel="PAN card / file" value={editing ? form.pan : c.pan}
              editing={editing} onChange={set('pan')} error={errs.pan}
              url={c.panFileUrl} fileName="pan-file" fileKey="panFile"
              onFile={pickFile('panFile')} fileErr={errs.panFile} chosenName={fileNames.panFile} />
            {(c.udyam || c.udyamCertificateUrl) && (
              <div className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Udyam / Registration</p>
                  {c.udyam ? <p className="text-sm font-mono font-medium text-stone-800">{c.udyam}</p> : <Empty />}
                  <p className="text-[10px] text-stone-400 mt-0.5">Registration certificate</p>
                </div>
                <DocLinks url={c.udyamCertificateUrl} fileName="registration-certificate" />
              </div>
            )}
          </div>
        </Card>

        {/* OTHER REGISTRATION LICENCES — seller only.

            Five FIXED rows rather than a free-form pile, so a seller can see at
            a glance which registrations are still missing. Built from the same
            <ComplianceRow> the GSTIN / PAN card uses, so the number input, the
            Upload / Replace button and the spacing are identical by
            construction and cannot drift from it. */}
        {showLicences && (
          <Card title="Other registration documents" icon="assignment">
            <div className="divide-y divide-stone-100">
              {LICENCE_ROWS.map((r) => (
                <ComplianceRow
                  key={r.key}
                  label={r.label}
                  docLabel={`${r.doc} · PNG, JPG or PDF`}
                  value={editing ? (form[r.numField] ?? '') : (lic[r.key]?.number || '')}
                  editing={editing}
                  onChange={set(r.numField)}
                  format={r.format}
                  placeholder={r.placeholder}
                  error={errs[r.numField]}
                  url={lic[r.key]?.url}
                  fileName={lic[r.key]?.fileName}
                  fileKey={r.fileField}
                  onFile={pickFile(r.fileField)}
                  fileErr={errs[r.fileField]}
                  chosenName={fileNames[r.fileField]}
                />
              ))}
            </div>
          </Card>
        )}

        {/* Other uploaded documents */}
        <Card title={showLicences ? 'Additional documents' : 'Other registration documents'} icon="folder">
          {documents.length === 0 ? (
            <p className="text-sm text-stone-400">No additional documents uploaded.</p>
          ) : (
            <div className="divide-y divide-stone-100">
              {documents.map((d) => (
                <div key={d._id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-800 truncate">{d.label}{d.fileName && d.fileName !== d.label ? ` · ${d.fileName}` : ''}</p>
                    {d.status && (
                      <span className={`inline-block mt-1 text-[10px] font-bold rounded-full px-2 py-0.5 capitalize ${
                        d.status === 'verified' ? 'bg-green-50 text-green-700' : d.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                      }`}>{d.status}</span>
                    )}
                  </div>
                  <DocLinks url={d.url} fileName={d.fileName} />
                </div>
              ))}
            </div>
          )}
          {editing && (
            <div className="mt-4 border-t border-stone-100 pt-4">
              <input id="file-otherDocs" type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => pickOthers(e.target.files)} />
              <label htmlFor="file-otherDocs" className="inline-flex items-center gap-1 text-xs font-bold text-stone-600 border border-stone-200 rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-stone-50">
                <span className="material-symbols-outlined text-sm">add</span> Add documents
              </label>
              {fileNames.otherDocs && <span className="ml-2 text-[11px] text-stone-500">{fileNames.otherDocs}</span>}
              {errs.otherDocs && <span className="block text-[11px] font-medium text-[#EA2831] mt-0.5">{errs.otherDocs}</span>}
            </div>
          )}
        </Card>

        {/* Save / Cancel */}
        {editing && (
          <div className="flex items-center justify-end gap-3">
            <button onClick={cancel} disabled={saving} className="border border-stone-200 hover:bg-stone-50 text-stone-700 text-sm font-bold rounded-lg px-5 py-2.5 transition-colors disabled:opacity-40">Cancel</button>
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 bg-[#EA2831] hover:bg-[#c91e26] disabled:opacity-40 text-white text-sm font-bold rounded-lg px-5 py-2.5 transition-colors">
              <span className="material-symbols-outlined text-base">save</span> {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfileView;
