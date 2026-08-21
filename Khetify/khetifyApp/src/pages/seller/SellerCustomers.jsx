import React, { useCallback, useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { Modal, Field, inputCls, PrimaryBtn, GhostBtn, Th } from '../Company/ims/ImsUi';
import { formatINR, fmtDate } from '../../lib/imsApi';

import {
  getSellerLink, getSellerCustomers, createSellerCustomer, updateSellerCustomer, getSellerCustomerHistory,
} from '../../lib/sellerApi';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEXT_NAME_RE = /^[A-Za-z .-]{2,}$/; // city / state: letters, space, dot, hyphen
const ALLOWED_TYPES = ['retail', 'business', 'dealer'];
const CREDIT_MAX = 999999999;
const TYPE_LABEL = { retail: 'Retail', business: 'Business', dealer: 'Dealer / Retailer' };

// Client-side validation for the customer/dealer form. Mirrors the backend
// validator (validators/customerValidators.js) exactly. Only Name is mandatory;
// every other field is optional but, WHEN filled, must be well-formed. Returns
// an { field: message } map — empty means valid.
const validateCustomer = (f) => {
  const e = {};
  const name = (f.name || '').trim();
  if (!name) e.name = 'Name is required';
  else if (name.length < 2) e.name = 'Name must be at least 2 characters';

  const type = (f.type || '').trim();
  if (!type) e.type = 'Type is required';
  else if (!ALLOWED_TYPES.includes(type)) e.type = 'Select a valid type';

  const phone = (f.phone || '').trim();
  if (!phone) e.phone = 'Phone is required';
  else if (!/^[0-9]{10}$/.test(phone)) e.phone = 'Enter a valid 10-digit phone number';

  const email = (f.email || '').trim();
  if (!email) e.email = 'Email is required';
  else if (!EMAIL_RE.test(email)) e.email = 'Enter a valid email address';

  const gstin = (f.gstin || '').trim().toUpperCase();
  if (!gstin) e.gstin = 'GSTIN is required';
  else if (!GSTIN_RE.test(gstin)) e.gstin = 'Enter a valid 15-character GSTIN';

  const stateCode = (f.stateCode || '').trim();
  if (!stateCode) e.stateCode = 'State code is required';
  else if (!/^[0-9]{2}$/.test(stateCode)) e.stateCode = 'Enter valid 2-digit GST state code';
  if (gstin && !e.gstin) {
    if (!stateCode) e.stateCode = 'State code is required when GSTIN is provided';
    else if (!e.stateCode && stateCode !== gstin.slice(0, 2)) e.stateCode = 'State code must match GSTIN state code';
  }

  const line1 = (f.line1 || '').trim();
  if (!line1) e.line1 = 'Address line is required';
  else if (line1.length < 3) e.line1 = 'Address line must be at least 3 characters';

  const city = (f.city || '').trim();
  if (!city) e.city = 'City is required';
  else if (!TEXT_NAME_RE.test(city)) e.city = 'Enter a valid city name';

  const state = (f.state || '').trim();
  if (!state) e.state = 'State is required';
  else if (!TEXT_NAME_RE.test(state)) e.state = 'Enter a valid state name';

  const pincode = (f.pincode || '').trim();
  if (!pincode) e.pincode = 'Pincode is required';
  else if (!/^[0-9]{6}$/.test(pincode)) e.pincode = 'Enter a valid 6-digit pincode';

  const cl = f.creditLimit;
  if (cl === '' || cl === undefined || cl === null) {
    e.creditLimit = 'Credit limit is required';
  } else {
    const n = Number(cl);
    if (Number.isNaN(n) || n < 0 || n > CREDIT_MAX) e.creditLimit = 'Enter a valid credit limit';
  }
  return e;
};

// Seller's own buyer book — end customers AND dealers. Read+write, scoped to the
// seller. No "New Sale" here (that's Phase 5b). Gated behind approval.
const SellerCustomers = () => {
  const [approved, setApproved] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [history, setHistory] = useState(null);

  // setState only in async callbacks (not synchronously in an effect body).
  const refresh = useCallback((term) => {
    getSellerCustomers(term ? { q: term } : {}).then((r) => setRows(listOf(r))).catch(apiError).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    getSellerLink()
      .then((r) => { setApproved(r?.data?.linkStatus === 'approved'); })
      .catch(() => setApproved(false));
  }, []);

  // Load (and re-search) once approved and whenever the query changes. (When
  // not approved, the locked panel renders and `loading` is irrelevant.)
  useEffect(() => {
    if (approved) refresh(q);
  }, [q, approved, refresh]);

  if (approved === null) return <div className="flex-1 p-8 text-center text-stone-400 font-sora">Loading…</div>;
  if (!approved) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
      
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">lock</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Customers &amp; Dealers is locked</h2>
          <p className="text-sm text-amber-700 mt-1">Available after your supplying company approves you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-6xl mx-auto space-y-6">
       
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-stone-900">Customers &amp; Dealers</h1>
            <p className="text-sm text-stone-500">Your buyer book — end customers and downstream dealers.</p>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / phone / code" className="border border-stone-200 rounded-lg text-sm px-3 py-2 w-72" />
          <PrimaryBtn onClick={() => setEdit({})}><span className="material-symbols-outlined text-base">person_add</span> New</PrimaryBtn>
        </div>

        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[820px] resp-table">
              <thead><tr className="bg-stone-50 border-b border-stone-200">
                <Th>Code</Th><Th>Name</Th><Th>Type</Th><Th>Phone</Th><Th>GSTIN</Th><Th right>Actions</Th>
              </tr></thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((c) => (
                  <tr key={c._id} className="hover:bg-stone-50/40">
                    <td data-label="Code" className="px-6 py-4 text-sm font-mono text-stone-500">{c.customerCode}</td>
                    <td data-label="Name" className="px-6 py-4 text-sm font-bold text-stone-900">{c.name}</td>
                    <td data-label="Type" className="px-6 py-4 text-xs text-stone-500">{TYPE_LABEL[c.type] || c.type}</td>
                    <td data-label="Phone" className="px-6 py-4 text-sm text-stone-500">{c.phone || '—'}</td>
                    <td data-label="GSTIN" className="px-6 py-4 text-xs font-mono text-stone-500">{c.gstin || '—'}</td>
                    <td className="px-6 py-4 cell-actions">
                      <div className="flex items-center justify-end gap-2">
                        <GhostBtn onClick={() => setHistory(c)}>History</GhostBtn>
                        <GhostBtn onClick={() => setEdit(c)}>Edit</GhostBtn>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-stone-400">No customers or dealers yet.</td></tr>}
                {loading && <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-stone-400">Loading…</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {edit && <CustomerModal customer={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); refresh(q); }} />}
      {history && <HistoryDrawer customer={history} onClose={() => setHistory(null)} />}
    </div>
  );
};

const CustomerModal = ({ customer, onClose, onDone }) => {
  const isEdit = !!customer._id;
  const a0 = customer.addresses?.[0] || {};
  const [f, setF] = useState({
    name: customer.name || '', type: customer.type || 'retail', phone: customer.phone || '', email: customer.email || '', gstin: customer.gstin || '',
    line1: a0.line1 || '', city: a0.city || '', state: a0.state || '', stateCode: a0.stateCode || '', pincode: a0.pincode || '', creditLimit: customer.creditLimit ?? '',
  });
  const [touched, setTouched] = useState({});
  const [saving, setSaving] = useState(false);
  const [apiErr, setApiErr] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  // Live validation drives both the inline messages and the disabled Create
  // button, so invalid data can never be submitted.
  const errors = validateCustomer(f);
  const mergedErrors = { ...errors, ...fieldErrors };
  const hasErrors = Object.keys(mergedErrors).length > 0;

  // Update a field; mark it touched so its error can surface as the user types.
  // `transform` lets specific fields coerce input (digits-only, uppercase).
  const u = (k, transform) => (e) => {
    const value = transform ? transform(e.target.value) : e.target.value;
    setF((prev) => ({ ...prev, [k]: value }));
    setTouched((prev) => (prev[k] ? prev : { ...prev, [k]: true }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
    if (apiErr) setApiErr('');
  };
  const digitsOnly = (v) => v.replace(/[^0-9]/g, '');
  const upper = (v) => v.toUpperCase();
  const touch = (name) => () => setTouched((prev) => ({ ...prev, [name]: true }));

  const submit = async () => {
    setTouched({ name: 1, type: 1, phone: 1, email: 1, gstin: 1, stateCode: 1, line1: 1, city: 1, state: 1, pincode: 1, creditLimit: 1 });
    if (hasErrors) return toast('error', 'Please fix the highlighted fields');

    const body = {
      name: f.name.trim(), type: f.type, phone: f.phone.trim() || undefined, email: f.email.trim().toLowerCase() || undefined,
      gstin: f.gstin.trim() ? f.gstin.trim().toUpperCase() : undefined,
      creditLimit: f.creditLimit !== '' ? Number(f.creditLimit) : undefined,
      addresses: (f.line1.trim() || f.city.trim() || f.state.trim() || f.pincode.trim() || f.stateCode.trim()) ? [{
        label: 'Default', line1: f.line1.trim(), city: f.city.trim(), state: f.state.trim(),
        stateCode: f.stateCode.trim() || undefined, pincode: f.pincode.trim(), isDefault: true,
      }] : undefined,
    };
    setSaving(true);
    setApiErr('');
    setFieldErrors({});
    try {
      isEdit ? await updateSellerCustomer(customer._id, body) : await createSellerCustomer(body);
      toast('success', isEdit ? 'Updated' : 'Created');
      onDone();
    } catch (err) {
      const message = err?.response?.data?.message || err.message || 'Something went wrong';
      if (message && message.includes('duplicate key error')) {
        setFieldErrors({ phone: 'This phone number is already in use' });
      } else {
        setApiErr(message);
      }
    } finally { setSaving(false); }
  };

  // Show a field's error only once it's been touched (or after a submit attempt).
  const Err = ({ name }) => (touched[name] && mergedErrors[name] ? <p className="text-xs text-red-500 mt-1">{mergedErrors[name]}</p> : null);
  const cls = (name) => `${inputCls} ${touched[name] && mergedErrors[name] ? 'border-red-400 focus:ring-red-200 focus:border-red-400' : ''}`;

  return (
    <Modal title={isEdit ? 'Edit Customer / Dealer' : 'New Customer / Dealer'} onClose={onClose} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Name" required><input className={cls('name')} value={f.name} onChange={u('name')} onBlur={touch('name')} /><Err name="name" /></Field>
        <Field label="Type" required>
          <select className={cls('type')} value={f.type} onChange={u('type')} onBlur={touch('type')}>
            <option value="retail">Retail (end customer)</option>
            <option value="business">Business</option>
            <option value="dealer">Dealer / Retailer</option>
          </select>
          <Err name="type" />
        </Field>
        <Field label="Phone" required><input className={cls('phone')} value={f.phone} onChange={u('phone', digitsOnly)} onBlur={touch('phone')} inputMode="numeric" maxLength={10} placeholder="10-digit mobile" /><Err name="phone" /></Field>
        <Field label="Email" required><input className={cls('email')} value={f.email} onChange={u('email')} onBlur={touch('email')} type="email" placeholder="name@example.com" /><Err name="email" /></Field>
        <Field label="GSTIN" required><input className={cls('gstin')} value={f.gstin} onChange={u('gstin', upper)} onBlur={touch('gstin')} maxLength={15} placeholder="23ABCDE1234F1Z5" /><Err name="gstin" /></Field>
        <Field label="State code (GST)" required><input className={cls('stateCode')} value={f.stateCode} onChange={u('stateCode', digitsOnly)} onBlur={touch('stateCode')} inputMode="numeric" maxLength={2} placeholder="23" /><Err name="stateCode" /></Field>
        <Field label="Address line" required><input className={cls('line1')} value={f.line1} onChange={u('line1')} onBlur={touch('line1')} /><Err name="line1" /></Field>
        <Field label="City" required><input className={cls('city')} value={f.city} onChange={u('city')} onBlur={touch('city')} /><Err name="city" /></Field>
        <Field label="State" required><input className={cls('state')} value={f.state} onChange={u('state')} onBlur={touch('state')} /><Err name="state" /></Field>
        <Field label="Pincode" required><input className={cls('pincode')} value={f.pincode} onChange={u('pincode', digitsOnly)} onBlur={touch('pincode')} inputMode="numeric" maxLength={6} placeholder="482001" /><Err name="pincode" /></Field>
        <Field label="Credit limit (₹)" required><input type="number" min="0" max={CREDIT_MAX} className={cls('creditLimit')} value={f.creditLimit} onChange={u('creditLimit')} onBlur={touch('creditLimit')} /><Err name="creditLimit" /></Field>
      </div>

      {apiErr && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          <span className="material-symbols-outlined text-[18px] mt-0.5">error</span>
          <span>{apiErr}</span>
        </div>
      )}

      <div className="mt-3"><PrimaryBtn onClick={submit}>{saving ? 'Saving…' : (isEdit ? 'Save' : 'Create')}</PrimaryBtn></div>
    </Modal>
  );
};

const HistoryDrawer = ({ customer, onClose }) => {
  const [data, setData] = useState(null);
  useEffect(() => { getSellerCustomerHistory(customer._id).then((r) => setData(r?.data)).catch(apiError); }, [customer._id]);
  return (
    <Modal title={`History — ${customer.name}`} onClose={onClose} wide>
      {!data ? <p className="text-sm text-stone-400 py-6 text-center">Loading…</p> : (
        <div className="space-y-3">
          <p className="text-xs text-stone-400">{data.orders.length} order(s) · {data.serialUnitsSold} serialized unit(s) sold</p>
          {data.orders.map((o) => (
            <div key={o._id} className="border border-stone-200 rounded-lg p-3">
              <div className="flex justify-between text-sm">
                <span className="font-bold">{o.invoiceNumber || o.orderNumber}</span>
                <span className="text-stone-400">{fmtDate(o.placedAt)} · {o.status}</span>
              </div>
              <div className="text-xs text-stone-500 mt-1">{formatINR(o.totalAmount)} · {o.totalUnits} units</div>
            </div>
          ))}
          {data.orders.length === 0 && <p className="text-sm text-stone-400">No orders yet.</p>}
        </div>
      )}
    </Modal>
  );
};

export default SellerCustomers;
