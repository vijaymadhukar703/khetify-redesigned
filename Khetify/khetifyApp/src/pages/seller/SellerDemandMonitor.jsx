import React, { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import {
  getSellerQuantityRequests,
  getQuantityRequestsSummary,
  updateQuantityRequestStatus,
} from '../../lib/sellerApi';

// Matches the pattern across seller pages: sellerApi functions use the Bearer
// token from "sellerToken" and the backend reads sellerId from req.user.sellerId.
// No sellerId is ever read from localStorage here.

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2500, showConfirmButton: false });

const STATUS_BADGE = {
  pending:             'bg-yellow-100 text-yellow-800',
  fulfilled:           'bg-green-100 text-green-800',
  rejected:            'bg-red-100 text-red-800',
  partially_fulfilled: 'bg-blue-100 text-blue-800',
};

const STATUS_LABEL = {
  pending:             'Pending',
  fulfilled:           'Fulfilled',
  rejected:            'Rejected',
  partially_fulfilled: 'Partial',
};

const SummaryCard = ({ icon, label, value, colour = 'text-stone-900' }) => (
  <div className="rounded-2xl bg-white p-5 ring-1 ring-stone-200/70">
    <div className="flex items-center gap-3">
      <span className={`flex size-10 items-center justify-center rounded-full bg-stone-100 material-symbols-outlined text-xl ${colour}`}>
        {icon}
      </span>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</p>
        <p className={`text-2xl font-extrabold ${colour}`}>{value ?? '—'}</p>
      </div>
    </div>
  </div>
);

export default function SellerDemandMonitor() {
  const [requests, setRequests]               = useState([]);
  const [summary, setSummary]                 = useState(null);
  const [loading, setLoading]                 = useState(true);
  const [page, setPage]                       = useState(1);
  const [totalPages, setTotalPages]           = useState(1);
  const [sortBy, setSortBy]                   = useState('recent');
  const [filterStatus, setFilterStatus]       = useState('all');

  // Respond modal
  const [respondingTo, setRespondingTo]       = useState(null); // request object
  const [responseStatus, setResponseStatus]   = useState('fulfilled');
  const [rejectionReason, setRejectionReason] = useState('');
  const [submitting, setSubmitting]           = useState(false);

  // ── Data fetching ────────────────────────────────────────────────────────────

  const fetchRequests = async (pageNum = 1) => {
    try {
      setLoading(true);
      const params = {
        page: pageNum,
        limit: 20,
        sortBy,
        ...(filterStatus !== 'all' && { status: filterStatus }),
      };
      const res = await getSellerQuantityRequests(params);
      // sellerApi wraps: { success, data: [...], pagination: { pages } }
      setRequests(res.data || []);
      setTotalPages(res.pagination?.pages || 1);
    } catch (err) {
      toast('error', err?.response?.data?.message || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const res = await getQuantityRequestsSummary();
      setSummary(res.data || res);
    } catch {
      // non-critical — page still works without summary
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  useEffect(() => {
    setPage(1);
    fetchRequests(1);
  }, [sortBy, filterStatus]);

  // ── Respond to request ───────────────────────────────────────────────────────

  const openRespond = (req) => {
    setRespondingTo(req);
    setResponseStatus('fulfilled');
    setRejectionReason('');
  };

  const submitResponse = async () => {
    if (!respondingTo) return;
    if (responseStatus === 'rejected' && !rejectionReason.trim()) {
      toast('warning', 'Please enter a rejection reason');
      return;
    }

    setSubmitting(true);
    try {
      await updateQuantityRequestStatus(respondingTo._id, {
        status: responseStatus,
        rejectionReason: responseStatus === 'rejected' ? rejectionReason.trim() : undefined,
      });
      toast('success', 'Response submitted');
      setRespondingTo(null);
      fetchRequests(page);
      fetchSummary();
    } catch (err) {
      toast('error', err?.response?.data?.message || 'Failed to submit response');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#FAFAF8] p-4 sm:p-6 lg:p-8">

      {/* Page Header */}
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-extrabold text-stone-900 sm:text-3xl">
          Demand Monitor
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Quantity requests from customers who reached stock limits
        </p>
      </div>

      {/* Summary Cards */}
      {/* {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard icon="list_alt"   label="Total"     value={summary.totalRequests}     />
          <SummaryCard icon="pending"    label="Pending"   value={summary.pendingRequests}   colour="text-yellow-700" />
          <SummaryCard icon="check_circle" label="Fulfilled" value={summary.fulfilledRequests} colour="text-green-700"  />
          <SummaryCard icon="group"      label="Customers" value={summary.uniqueCustomersCount} colour="text-blue-700"   />
        </div>
      )} */}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Status Filter */}
        <div className="flex items-center gap-2 overflow-x-auto">
          {[
            { v: 'all',      label: 'All' },
            { v: 'pending',  label: 'Pending' },
            { v: 'fulfilled',label: 'Fulfilled' },
            { v: 'rejected', label: 'Rejected' },
          ].map(({ v, label }) => (
            <button
              key={v}
              onClick={() => setFilterStatus(v)}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                filterStatus === v
                  ? 'bg-[#EA2831] text-white'
                  : 'bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="ml-auto rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-[#EA2831]/30"
        >
          <option value="recent">Most Recent</option>
          <option value="urgent">Urgent First</option>
          <option value="oldest">Oldest First</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-2xl bg-white ring-1 ring-stone-200/70 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-stone-500">
            <span className="material-symbols-outlined animate-spin mr-2">refresh</span>
            Loading requests…
          </div>
        ) : requests.length === 0 ? (
          <div className="py-16 text-center">
            <span className="material-symbols-outlined text-4xl text-stone-300">inbox</span>
            <p className="mt-2 text-stone-500">No requests found</p>
            {filterStatus !== 'all' && (
              <button
                onClick={() => setFilterStatus('all')}
                className="mt-3 text-sm font-semibold text-[#EA2831] hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs font-bold uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3 text-center">Qty</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {requests.map((req) => (
                  <tr key={req._id} className="hover:bg-stone-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-stone-900 line-clamp-1">{req.productName}</p>
                      {req.variantDetails?.label && (
                        <p className="text-xs text-stone-400">{req.variantDetails.label}</p>
                      )}
                      {req.isUrgent && (
                        <span className="mt-0.5 inline-block text-xs font-bold text-red-600">🚨 Urgent</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-stone-900">{req.customerName}</p>
                      {req.customerPhone && (
                        <p className="text-xs text-stone-400">{req.customerPhone}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-stone-900">
                      {req.requestedQuantity}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${STATUS_BADGE[req.status] || 'bg-stone-100 text-stone-700'}`}>
                        {STATUS_LABEL[req.status] || req.status}
                      </span>
                      {req.status === 'rejected' && req.rejectionReason && (
                        <p className="mt-1 text-xs text-red-500 line-clamp-1" title={req.rejectionReason}>
                          {req.rejectionReason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-500 whitespace-nowrap">
                      {new Date(req.createdAt).toLocaleDateString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {req.status === 'pending' ? (
                        <button
                          onClick={() => openRespond(req)}
                          className="rounded-lg bg-[#EA2831] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#D91C22]"
                        >
                          Respond
                        </button>
                      ) : (
                        <span className="text-xs text-stone-400">Done</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-stone-200 px-4 py-3">
            <button
              onClick={() => { setPage((p) => p - 1); fetchRequests(page - 1); }}
              disabled={page <= 1}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-stone-500">Page {page} of {totalPages}</span>
            <button
              onClick={() => { setPage((p) => p + 1); fetchRequests(page + 1); }}
              disabled={page >= totalPages}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Respond Modal */}
      {respondingTo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
              <h2 className="text-lg font-bold text-stone-900">Respond to Request</h2>
              <button onClick={() => setRespondingTo(null)} className="text-stone-400 hover:text-stone-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5">
              {/* Request Summary */}
              <div className="rounded-lg bg-stone-50 p-4">
                <p className="font-semibold text-stone-900">{respondingTo.productName}</p>
                {respondingTo.variantDetails?.label && (
                  <p className="text-sm text-stone-500">{respondingTo.variantDetails.label}</p>
                )}
                <div className="mt-2 flex items-center gap-4 text-sm">
                  <span className="text-stone-600">
                    Customer: <span className="font-semibold text-stone-900">{respondingTo.customerName}</span>
                  </span>
                  <span className="text-stone-600">
                    Qty: <span className="font-semibold text-stone-900">{respondingTo.requestedQuantity}</span>
                  </span>
                  {respondingTo.isUrgent && (
                    <span className="text-xs font-bold text-red-600">🚨 Urgent</span>
                  )}
                </div>
              </div>

              {/* Status Select */}
              <div>
                <label className="mb-1 block text-sm font-bold text-stone-900">Response</label>
                <select
                  value={responseStatus}
                  onChange={(e) => setResponseStatus(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EA2831]/30"
                >
                  <option value="fulfilled">Fulfilled — Stock available, customer notified</option>
                  <option value="partially_fulfilled">Partially Fulfilled — Some stock available</option>
                  <option value="rejected">Rejected — Unable to fulfil</option>
                </select>
              </div>

              {/* Rejection Reason */}
              {responseStatus === 'rejected' && (
                <div>
                  <label className="mb-1 block text-sm font-bold text-stone-900">
                    Rejection Reason <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={3}
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="e.g. Product discontinued, insufficient demand…"
                    className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EA2831]/30"
                  />
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setRespondingTo(null)}
                  disabled={submitting}
                  className="flex-1 rounded-lg border border-stone-300 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={submitResponse}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-[#EA2831] py-2.5 text-sm font-bold text-white hover:bg-[#D91C22] disabled:opacity-50"
                >
                  {submitting
                    ? <><span className="material-symbols-outlined animate-spin text-base">refresh</span> Submitting…</>
                    : 'Submit Response'
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}