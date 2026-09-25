import React, { useEffect, useMemo, useState } from 'react';
import Swal from 'sweetalert2';
import {
  getCustomers, createCustomer, updateCustomer, getCustomerHistory,
  createOrder, getProducts, formatINR, fmtDate,
} from '../../../lib/imsApi';
import { Modal, Field, inputCls, PrimaryBtn, GhostBtn, Th } from './ImsUi';
import Can from '../../../Components/ims/Can';
import Invoice from '../../../Components/ims/Invoice';


const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');
const listOf = (r) => (Array.isArray(r) ? r : r?.data || r?.products || []);
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\d{10}$/;
const PINCODE_RE = /^[1-9]\d{5}$/;
const STATECODE_RE = /^[0-9]{2}$/;

const ImsCustomers = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null); // customer or {} for new
  const [history, setHistory] = useState(null);
  const [sale, setSale] = useState(null); // customer for new-sale
  const [invoice, setInvoice] = useState(null);

  const refresh = () => { setLoading(true); getCustomers(q ? { q } : {}).then((r) => setRows(listOf(r))).catch(apiError).finally(() => setLoading(false)); };
  useEffect(() => { refresh(); }, [q]);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-6xl mx-auto space-y-6">
    
        <div className="flex items-center justify-between gap-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / phone / code" className="border border-stone-200 rounded-lg text-sm px-3 py-2 w-72" />
          <Can capability="customer:create"><PrimaryBtn onClick={() => setEdit({})}><span className="material-symbols-outlined text-base">person_add</span> New Customer</PrimaryBtn></Can>
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
                    <td data-label="Type" className="px-6 py-4 text-xs text-stone-500">{c.type}</td>
                    <td data-label="Phone" className="px-6 py-4 text-sm text-stone-500">{c.phone || '—'}</td>
                    <td data-label="GSTIN" className="px-6 py-4 text-xs font-mono text-stone-500">{c.gstin || '—'}</td>
                    <td className="px-6 py-4 cell-actions">
                      <div className="flex items-center justify-end gap-2">
                        <GhostBtn onClick={() => setHistory(c)}>History</GhostBtn>
                        <Can capability="order:create"><GhostBtn onClick={() => setSale(c)}>New Sale</GhostBtn></Can>
                        <Can capability="customer:update"><GhostBtn onClick={() => setEdit(c)}>Edit</GhostBtn></Can>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-stone-400">No customers yet.</td></tr>}
                {loading && <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-stone-400">Loading…</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {edit && <CustomerModal customer={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); refresh(); }} />}
      {history && <HistoryDrawer customer={history} onClose={() => setHistory(null)} />}
      {sale && <NewSaleModal customer={sale} onClose={() => setSale(null)} onDone={(order) => { setSale(null); setInvoice(order); }} />}
      {invoice && <Invoice order={invoice} onClose={() => setInvoice(null)} />}
    </div>
  );
};

const CustomerModal = ({ customer, onClose, onDone }) => {
  const isEdit = !!customer._id;
  const a0 = customer.addresses?.[0] || {};
  const [f, setF] = useState({
    name: customer.name || '', type: customer.type || 'retail', phone: customer.phone || '', email: customer.email || '', gstin: customer.gstin || '',
    line1: a0.line1 || '', city: a0.city || '', state: a0.state || '', stateCode: a0.stateCode || '', pincode: a0.pincode || '',
  });
  const [touched, setTouched] = useState({});
  const u = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const touch = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  const errs = {
    name: !f.name.trim() ? 'Name is required.' : '',
    phone: !f.phone.trim() ? 'Phone is required.' : !PHONE_RE.test(f.phone.trim()) ? 'Phone must be exactly 10 digits.' : '',
    email: !f.email.trim() ? 'Email is required.' : !EMAIL_RE.test(f.email.trim()) ? 'Enter a valid email address.' : '',
    gstin: !f.gstin.trim() ? 'GSTIN is required.' : !GSTIN_RE.test(f.gstin.toUpperCase()) ? 'GSTIN format looks invalid.' : '',
    stateCode: !f.stateCode.trim() ? 'State code is required.' : !STATECODE_RE.test(f.stateCode.trim()) ? 'State code must be 2 digits.' : '',
    line1: !f.line1.trim() ? 'Address line is required.' : '',
    city: !f.city.trim() ? 'City is required.' : '',
    state: !f.state.trim() ? 'State is required.' : '',
    pincode: !f.pincode.trim() ? 'Pincode is required.' : !PINCODE_RE.test(f.pincode.trim()) ? 'Pincode must be 6 digits.' : '',
  };
  const hasErr = Object.values(errs).some(Boolean);
  const show = (k) => touched[k] && errs[k];
  const errCls = (k) => (show(k) ? 'border-red-400' : '');

  const submit = async () => {
    setTouched({ name: true, phone: true, email: true, gstin: true, stateCode: true, line1: true, city: true, state: true, pincode: true });
    if (hasErr) return toast('error', 'Please fix the highlighted fields');
    const body = {
      name: f.name, type: f.type, phone: f.phone || undefined, email: f.email || undefined,
      gstin: f.gstin ? f.gstin.toUpperCase() : undefined,
      addresses: (f.line1 || f.city) ? [{ label: 'Default', line1: f.line1, city: f.city, state: f.state, stateCode: f.stateCode || undefined, pincode: f.pincode, isDefault: true }] : undefined,
    };
    try { isEdit ? await updateCustomer(customer._id, body) : await createCustomer(body); toast('success', isEdit ? 'Updated' : 'Created'); onDone(); }
    catch (err) { apiError(err); }
  };
  return (
    <Modal title={isEdit ? 'Edit Customer' : 'New Customer'} onClose={onClose} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Name *"><input className={`${inputCls} ${errCls('name')}`} value={f.name} onChange={u('name')} onBlur={touch('name')} />{show('name') && <p className="text-xs text-red-500 mt-1">{errs.name}</p>}</Field>
        <Field label="Type"><select className={inputCls} value={f.type} onChange={u('type')}><option value="retail">Retail</option><option value="business">Business</option></select></Field>
        <Field label="Phone *"><input className={`${inputCls} ${errCls('phone')}`} value={f.phone} onChange={u('phone')} onBlur={touch('phone')} placeholder="9876543210" inputMode="numeric" maxLength={10} />{show('phone') && <p className="text-xs text-red-500 mt-1">{errs.phone}</p>}</Field>
        <Field label="Email *"><input className={`${inputCls} ${errCls('email')}`} value={f.email} onChange={u('email')} onBlur={touch('email')} type="email" placeholder="name@example.com" />{show('email') && <p className="text-xs text-red-500 mt-1">{errs.email}</p>}</Field>
        <Field label="GSTIN *"><input className={`${inputCls} ${errCls('gstin')}`} value={f.gstin} onChange={u('gstin')} onBlur={touch('gstin')} placeholder="23ABCDE1234F1Z5" maxLength={15} />{show('gstin') && <p className="text-xs text-red-500 mt-1">{errs.gstin}</p>}</Field>
        <Field label="State code (GST) *"><input className={`${inputCls} ${errCls('stateCode')}`} value={f.stateCode} onChange={u('stateCode')} onBlur={touch('stateCode')} placeholder="23" inputMode="numeric" maxLength={2} />{show('stateCode') && <p className="text-xs text-red-500 mt-1">{errs.stateCode}</p>}</Field>
        <Field label="Address line *"><input className={`${inputCls} ${errCls('line1')}`} value={f.line1} onChange={u('line1')} onBlur={touch('line1')} />{show('line1') && <p className="text-xs text-red-500 mt-1">{errs.line1}</p>}</Field>
        <Field label="City *"><input className={`${inputCls} ${errCls('city')}`} value={f.city} onChange={u('city')} onBlur={touch('city')} />{show('city') && <p className="text-xs text-red-500 mt-1">{errs.city}</p>}</Field>
        <Field label="State *"><input className={`${inputCls} ${errCls('state')}`} value={f.state} onChange={u('state')} onBlur={touch('state')} />{show('state') && <p className="text-xs text-red-500 mt-1">{errs.state}</p>}</Field>
        <Field label="Pincode *"><input className={`${inputCls} ${errCls('pincode')}`} value={f.pincode} onChange={u('pincode')} onBlur={touch('pincode')} placeholder="560001" inputMode="numeric" maxLength={6} />{show('pincode') && <p className="text-xs text-red-500 mt-1">{errs.pincode}</p>}</Field>
      </div>
      <div className="mt-3"><PrimaryBtn onClick={submit}>{isEdit ? 'Save' : 'Create'}</PrimaryBtn></div>
    </Modal>
  );
};

const HistoryDrawer = ({ customer, onClose }) => {
  const [data, setData] = useState(null);
  useEffect(() => { getCustomerHistory(customer._id).then((r) => setData(r?.data)).catch(apiError); }, [customer._id]);
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
              <div className="text-[11px] text-stone-400 mt-1">
                {(o.items || []).map((it, i) => (
                  <span key={i} className="mr-2">{it.name} ×{it.qty}{it.allocations?.length ? ` [${it.allocations.map((a) => a.lotNumber).join(', ')}]` : ''}</span>
                ))}
              </div>
            </div>
          ))}
          {data.orders.length === 0 && <p className="text-sm text-stone-400">No orders yet.</p>}
        </div>
      )}
    </Modal>
  );
};

const NewSaleModal = ({ customer, onClose, onDone }) => {
  const [products, setProducts] = useState([]);
  const [lines, setLines] = useState([{ productId: '', qty: '' }]);
  const [channel, setChannel] = useState('offline');
  useEffect(() => { getProducts().then((r) => setProducts(listOf(r))).catch(() => {}); }, []);
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const submit = async () => {
    try {
      const items = lines.filter((l) => l.productId && l.qty).map((l) => ({ productId: l.productId, qty: Number(l.qty) }));
      if (!items.length) return toast('error', 'Add at least one item');
      const r = await createOrder({ customerId: customer._id, items, salesChannel: 'manual', channel });
      toast('success', r?.message || 'Order created');
      onDone(r?.data);
    } catch (err) { apiError(err); }
  };
  return (
    <Modal title={`New Sale — ${customer.name}`} onClose={onClose} wide>
      <p className="text-xs text-stone-400 mb-2">Reserves stock FEFO and assigns a GST invoice number. Dispatch later to deduct stock.</p>
      <Field label="Channel"><select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="offline">Offline</option><option value="online">Online</option></select></Field>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1">
              <select className={inputCls} value={l.productId} onChange={(e) => setLine(i, 'productId', e.target.value)}>
                <option value="">Select product…</option>
                {products.map((p) => <option key={p._id} value={p._id}>{p.productName} {p.mrp ? `· ₹${p.mrp}` : ''}</option>)}
              </select>
            </div>
            <input type="number" min="1" placeholder="Qty" className={`${inputCls} w-24`} value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} />
            {lines.length > 1 && <GhostBtn onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>✕</GhostBtn>}
          </div>
        ))}
        <GhostBtn onClick={() => setLines((ls) => [...ls, { productId: '', qty: '' }])}>+ Add line</GhostBtn>
      </div>
      <div className="mt-3"><PrimaryBtn onClick={submit}>Create Order &amp; Invoice</PrimaryBtn></div>
    </Modal>
  );
};

export default ImsCustomers;
