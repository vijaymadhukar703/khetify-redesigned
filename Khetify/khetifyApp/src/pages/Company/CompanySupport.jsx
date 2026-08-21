import React, { useState, useEffect } from 'react';

import { getSupportTickets, createSupportTicket } from '../../lib/imsApi';

// Must match the backend enum (model/Support/SupportTicket.js).
const CATEGORIES = [
  'Product Upload',
  'Inventory & Stock',
  'Orders',
  'Warehouses & Operations',
  'Sellers / Dealers',
  'Returns',
  'Billing & Subscription',
  'Account & Settings',
  'Other',
];

// Backend status enum → display label + pill colour.
const STATUS_META = {
  open: { label: 'Open', cls: 'bg-blue-50 text-blue-700 border-blue-100' },
  in_review: { label: 'In Review', cls: 'bg-amber-50 text-amber-700 border-amber-100' },
  resolved: { label: 'Resolved', cls: 'bg-green-50 text-green-700 border-green-100' },
  closed: { label: 'Closed', cls: 'bg-stone-100 text-stone-600 border-stone-200' },
};
const statusMeta = (s) => STATUS_META[s] || STATUS_META.open;

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const CompanySupport = () => {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: '', subject: '', description: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const loadTickets = () => {
    setLoading(true);
    getSupportTickets()
      .then((res) => setTickets(res?.data || []))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadTickets(); }, []);

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const getErrors = () => {
    const e = {};
    if (!form.category) e.category = 'Please choose a category';
    if (!form.subject.trim()) e.subject = 'Subject is required';
    if (!form.description.trim()) e.description = 'Description is required';
    return e;
  };

  const closeModal = () => {
    setOpen(false);
    setForm({ category: '', subject: '', description: '' });
    setErrors({});
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = getErrors();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const res = await createSupportTicket({
        category: form.category,
        subject: form.subject.trim(),
        description: form.description.trim(),
      });
      // Prepend the saved ticket (newest first); fall back to a refetch.
      if (res?.data) setTickets((prev) => [res.data, ...prev]);
      else loadTickets();
      closeModal();
    } catch (err) {
      setErrors({ submit: err?.response?.data?.message || 'Could not create the request. Try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    /* Padding responsive ki: mobile par p-4, desktop par p-8 */
    <div className="flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-7xl mx-auto w-full">

       

        {/* Header - Text alignment mobile par center ho sakti hai agar aap chahein */}
        <div className="mb-8 sm:mb-10">
          <h3 className="text-2xl sm:text-3xl font-bold text-stone-900">Support Center</h3>
          {/* <p className="text-stone-500 mt-2 text-sm sm:text-base max-w-2xl leading-relaxed">
            Get assistance with your company account, product listings, or platform guidelines.
          </p> */}
        </div>

        {/* Top Cards Grid - Mobile par 1 column, Tablets par 2, Desktop par 3 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-12">
          {/* Raise Request */}
          {/* <div className="p-6 border border-stone-200 rounded-2xl flex flex-col h-full bg-white hover:border-red-100 transition-all shadow-sm">
            <h4 className="text-lg font-bold text-stone-900 mb-3">Raise a Request</h4>
            <p className="text-sm text-stone-500 mb-6 flex-grow leading-relaxed">Submit a formal ticket for technical issues, account changes, or billing inquiries.</p>
            <button
              onClick={() => setOpen(true)}
              className="w-full py-3.5 bg-[#EA2831] text-white font-bold text-sm rounded-xl hover:bg-[#c91e26] transition-all active:scale-[0.98]"
            >
              Create Support Request
            </button>
          </div> */}

          {/* Guidelines */}
          {/* <div className="p-6 border border-stone-200 rounded-2xl flex flex-col h-full bg-white hover:border-red-100 transition-all shadow-sm">
            <h4 className="text-lg font-bold text-stone-900 mb-4">Help & Guidelines</h4>
            <div className="flex flex-col gap-3.5">
              {['Product upload guidelines', 'Vendor policies', 'Returns and issue handling', 'Platform rules'].map((item) => (
                <a key={item} href="#" className="text-sm text-stone-600 hover:text-[#EA2831] transition-colors flex items-center group font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-300 mr-2 group-hover:bg-[#EA2831] transition-colors"></span>
                  {item}
                </a>
              ))}
            </div>
          </div> */}

          {/* Contact Details - Tablet par full width le lega agar odd number ho */}
          <div className="p-6 border border-stone-200 rounded-2xl flex flex-col h-full bg-white hover:border-red-100 transition-all shadow-sm md:col-span-2 lg:col-span-1">
            <h4 className="text-lg font-bold text-stone-900 mb-3">Contact Support</h4>
            <div className="space-y-4 flex-grow">
              <div>
                <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Email Address</p>
                <p className="text-sm font-semibold text-stone-800">support@khetify.com</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Working Hours</p>
                <p className="text-sm text-stone-800 font-medium">Mon - Sat, 09:00 AM - 06:00 PM</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-stone-100">
              <p className="text-[11px] text-stone-400 font-medium italic">Our team typically responds within 4 hours.</p>
            </div>
          </div>
        </div>

        {/* Requests Table Section */}
        <div className="mb-12">
          {/* <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <h4 className="text-xl font-bold text-stone-900">Your Requests</h4>
            <div className="text-xs font-bold text-stone-400 uppercase tracking-wider bg-stone-50 px-3 py-1 rounded-full">
              {loading ? 'Loading…' : `Showing ${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`}
            </div>
          </div> */}

          {/* {!loading && tickets.length === 0 ? (
            <div className="border border-dashed border-stone-200 rounded-2xl p-10 text-center text-stone-400 text-sm">
              No support requests yet. Click “Create Support Request” to raise one.
            </div>
          ) : (
            <>
              <div className="hidden md:block border border-stone-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-200 text-stone-500">
                      <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest">Request ID</th>
                      <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest">Category</th>
                      <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest">Subject</th>
                      <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest">Description</th>
                      <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest">Status</th>
                      <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest">Created Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {tickets.map((ticket) => (
                      <tr key={ticket._id} className="hover:bg-stone-50 transition-colors cursor-pointer group">
                        <td className="px-6 py-5 text-sm font-bold text-stone-900 whitespace-nowrap">#{ticket.ticketId}</td>
                        <td className="px-6 py-5 text-sm text-stone-600 font-medium whitespace-nowrap">{ticket.category}</td>
                        <td className="px-6 py-5 text-sm text-stone-600">{ticket.subject}</td>
                        <td className="px-6 py-5 text-sm text-stone-500 max-w-xs">
                          <span className="line-clamp-2">{ticket.description || '—'}</span>
                        </td>
                        <td className="px-6 py-5">
                          <span className={`px-3 py-1 text-[10px] font-bold border rounded-full uppercase tracking-wider ${statusMeta(ticket.status).cls}`}>
                            {statusMeta(ticket.status).label}
                          </span>
                        </td>
                        <td className="px-6 py-5 text-sm text-stone-500 font-medium whitespace-nowrap">{fmtDate(ticket.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden space-y-4">
                {tickets.map((ticket) => (
                  <div key={ticket._id} className="p-5 border border-stone-200 rounded-2xl bg-white shadow-sm active:bg-stone-50 transition-colors">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-0.5">Request ID</span>
                        <p className="text-sm font-bold text-stone-900">#{ticket.ticketId}</p>
                      </div>
                      <span className={`px-3 py-1 text-[9px] font-bold border rounded-full uppercase tracking-wider ${statusMeta(ticket.status).cls}`}>
                        {statusMeta(ticket.status).label}
                      </span>
                    </div>

                    <div className="mb-4">
                      <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-0.5">Subject</span>
                      <p className="text-sm text-stone-800 font-medium leading-relaxed">{ticket.subject}</p>
                      <p className="text-[10px] text-[#EA2831] font-bold mt-1 uppercase italic">{ticket.category}</p>
                    </div>

                    {ticket.description && (
                      <div className="mb-4">
                        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-0.5">Description</span>
                        <p className="text-sm text-stone-600 leading-relaxed">{ticket.description}</p>
                      </div>
                    )}

                    <div className="pt-3 border-t border-stone-50 flex justify-between items-center">
                       <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Date Created</span>
                       <p className="text-xs text-stone-600 font-bold">{fmtDate(ticket.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )} */}
        </div>

      </div>

      {/* ── Create Support Request Modal ── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50" onClick={closeModal}>
          <div
            className="w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
              <h4 className="text-lg font-bold text-stone-900">Create Support Request</h4>
              <button onClick={closeModal} className="text-stone-400 hover:text-stone-700 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Category */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-stone-700">Category<span className="text-[#EA2831] ml-0.5">*</span></label>
                <select
                  name="category"
                  value={form.category}
                  onChange={onChange}
                  className="w-full h-11 px-3 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#EA2831] bg-white"
                >
                  <option value="">Select a category</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {errors.category && <p className="text-red-500 text-xs font-medium">⚠ {errors.category}</p>}
              </div>

              {/* Subject */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-stone-700">Subject<span className="text-[#EA2831] ml-0.5">*</span></label>
                <input
                  type="text"
                  name="subject"
                  value={form.subject}
                  onChange={onChange}
                  placeholder="e.g. Bulk upload failing for Irrigation category"
                  className="w-full h-11 px-3 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#EA2831]"
                />
                {errors.subject && <p className="text-red-500 text-xs font-medium">⚠ {errors.subject}</p>}
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-stone-700">Description<span className="text-[#EA2831] ml-0.5">*</span></label>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={onChange}
                  rows={4}
                  placeholder="Describe your issue in detail…"
                  className="w-full px-3 py-2.5 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#EA2831] resize-none"
                />
                {errors.description && <p className="text-red-500 text-xs font-medium">⚠ {errors.description}</p>}
              </div>

              {errors.submit && <p className="text-red-500 text-sm font-medium">{errors.submit}</p>}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-5 py-2.5 text-sm font-semibold text-stone-600 hover:text-stone-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-[#EA2831] text-white font-bold text-sm rounded-lg hover:bg-[#c91e26] transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompanySupport;
