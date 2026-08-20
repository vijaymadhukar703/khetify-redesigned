import React, { useCallback, useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { Modal, Field, inputCls, PrimaryBtn, GhostBtn, Th } from '../Company/ims/ImsUi';
import { formatINR, fmtDate } from '../../lib/imsApi';
import {
  getSellerLink, getSellerOrders, createSellerOrder, updateSellerOrderStatus,
  getSellerCustomers, getSellerProducts, getSellerOrderSourceOptions,
} from '../../lib/sellerApi';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);
const fmtNum = (n) => Number(n || 0).toLocaleString('en-IN');

const STATUS_STYLE = {
  pending: 'bg-stone-100 text-stone-600', confirmed: 'bg-blue-50 text-blue-700', packed: 'bg-amber-50 text-amber-700',
  shipped: 'bg-violet-50 text-violet-700', delivered: 'bg-green-50 text-green-700', returned: 'bg-orange-50 text-orange-700', cancelled: 'bg-red-50 text-red-700',
};
// The seller's ONLY action is to confirm (or cancel) a PENDING order. After
// confirmation the order belongs to the warehouse that holds the stock — it
// picks, packs, dispatches and delivers. The seller just watches the status
// progress (confirmed → packed → shipped → delivered), read-only, like the
// customer's order tracker. So no post-confirm actions are offered here.
const NEXT_ACTIONS = {
  pending: [['Approve', 'confirmed'], ['Cancel', 'cancelled']],
};

/** The ordered products, as a primary line plus an overflow count. Orders are
 *  usually one line; multi-line ones stay readable instead of wrapping. */
const productSummary = (o) => {
  const names = (o.items || []).map((it) => it.name).filter(Boolean);
  if (!names.length) return { first: '—', more: 0 };
  return { first: names[0], more: names.length - 1 };
};

/** One-line delivery address off the order's shipping (or billing) snapshot. */
const addressLines = (o) => {
  const a = o.shippingAddress || o.billingAddress;
  if (!a) return null;
  const street = [a.line1, a.line2].filter(Boolean).join(', ');
  const region = [a.city, a.district, a.state].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ');
  const tail = [region, a.pincode].filter(Boolean).join(' · ');
  return { street, tail };
};

const SellerOutbound = () => {
  const [approved, setApproved] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  // The order awaiting a warehouse choice before it can be approved.
  const [assigning, setAssigning] = useState(null);

  const refresh = useCallback(() => {
    getSellerOrders().then((r) => setOrders(listOf(r))).catch(apiError).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    getSellerLink()
      .then((r) => { const ok = r?.data?.linkStatus === 'approved'; setApproved(ok); if (ok) refresh(); })
      .catch(() => setApproved(false));
  }, [refresh]);

  const advance = async (o, status) => {
    // Approving now goes through warehouse assignment — the seller picks WHICH
    // of their warehouses fulfils this order before it is confirmed.
    if (status === 'confirmed') { setAssigning(o); return; }
    if (status === 'cancelled') {
      const { isConfirmed } = await Swal.fire({ title: 'Cancel this order?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'Cancel order' });
      if (!isConfirmed) return;
    }
    try { await updateSellerOrderStatus(o._id, status); toast('success', `Marked ${status}`); refresh(); }
    catch (err) { apiError(err); }
  };

  if (approved === null) return <div className="flex-1 p-8 text-center text-stone-400 font-sora">Loading…</div>;
  if (!approved) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">lock</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Outbound Sales is locked</h2>
          <p className="text-sm text-amber-700 mt-1">Available after your supplying company approves you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-stone-900">Outbound Sales</h1>
            <p className="text-sm text-stone-500">Sell from your stock to customers and dealers. Shipping deducts stock FEFO.</p>
          </div>
          <PrimaryBtn onClick={() => setCreating(true)}><span className="material-symbols-outlined text-base">add_shopping_cart</span> New Order</PrimaryBtn>
        </div>

        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[1040px] resp-table">
              <thead><tr className="bg-stone-50 border-b border-stone-200">
                <Th>Invoice</Th><Th>Product</Th><Th>Buyer</Th><Th>Delivery Address</Th><Th>Units</Th><Th>Total</Th><Th>Status</Th><Th>Placed</Th><Th right>Actions</Th>
              </tr></thead>
              <tbody className="divide-y divide-stone-100">
                {orders.map((o) => {
                  const prod = productSummary(o);
                  const addr = addressLines(o);
                  return (
                    <tr key={o._id} className="hover:bg-stone-50/40 align-top">
                      <td data-label="Invoice" className="px-6 py-4">
                        <span className="text-sm font-mono font-bold text-stone-800">{o.invoiceNumber || o.orderNumber}</span>
                        {o.salesChannel === 'website' && <span className="block mt-1 text-[10px] font-bold uppercase tracking-wider text-violet-600">Online</span>}
                      </td>
                      {/* Product name gets its own column — it was previously
                          invisible here, so a seller had to open the order to
                          see what had actually been bought. */}
                      <td data-label="Product" className="px-6 py-4 max-w-[220px]">
                        <span className="block text-sm font-semibold text-stone-800 truncate" title={prod.first}>{prod.first}</span>
                        {prod.more > 0 && <span className="text-[11px] text-stone-400">+{prod.more} more item{prod.more > 1 ? 's' : ''}</span>}
                      </td>
                      <td data-label="Buyer" className="px-6 py-4 text-sm text-stone-700">{o.customerName || '—'}</td>
                      {/* Where it ships to — the same address the warehouse
                          recommendation is measured against. */}
                      <td data-label="Delivery Address" className="px-6 py-4 max-w-[260px]">
                        {addr ? (
                          <>
                            {addr.street && <span className="block text-sm text-stone-700 truncate" title={addr.street}>{addr.street}</span>}
                            {addr.tail && <span className="block text-[11px] text-stone-500 truncate" title={addr.tail}>{addr.tail}</span>}
                          </>
                        ) : <span className="text-sm text-stone-300">—</span>}
                      </td>
                      <td data-label="Units" className="px-6 py-4 text-sm text-stone-600">{fmtNum(o.totalUnits)}</td>
                      <td data-label="Total" className="px-6 py-4 text-sm font-semibold text-stone-800 whitespace-nowrap">{formatINR(o.totalAmount)}</td>
                      <td data-label="Status" className="px-6 py-4"><span className={`text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${STATUS_STYLE[o.status] || 'bg-stone-100'}`}>{o.status}</span></td>
                      <td data-label="Placed" className="px-6 py-4 text-sm text-stone-500 whitespace-nowrap">{fmtDate(o.placedAt)}</td>
                      <td className="px-6 py-4 cell-actions">
                        <div className="flex items-center justify-end gap-2">
                          {(NEXT_ACTIONS[o.status] || []).map(([label, status]) => (
                            <GhostBtn key={status} onClick={() => advance(o, status)}>{label}</GhostBtn>
                          ))}
                          {!NEXT_ACTIONS[o.status] && <span className="text-xs text-stone-300">—</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && orders.length === 0 && <tr><td colSpan={9} className="px-6 py-12 text-center text-sm text-stone-400">No orders yet.</td></tr>}
                {loading && <tr><td colSpan={9} className="px-6 py-12 text-center text-sm text-stone-400">Loading…</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {creating && <NewOrderModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); }} />}
      {assigning && (
        <AssignWarehouseModal
          order={assigning}
          onClose={() => setAssigning(null)}
          onDone={() => { setAssigning(null); refresh(); }}
        />
      )}
    </div>
  );
};

/**
 * ASSIGN WAREHOUSES — shown when the seller approves a pending order.
 *
 * Modelled on the company's "Assign a source warehouse"
 * (pages/Company/CompanySupplyRequests.jsx): the same per-warehouse
 * availability call, the same "approve only when everything is coverable" gate.
 * What differs is that a seller order may be SPLIT — the basket is assigned
 * PRODUCT BY PRODUCT, because warehouse 1 may hold products A and B while only
 * warehouse 2 has C.
 *
 * One row per product: what it needs, where it's coming from, how much that
 * warehouse has. The server's recommendation is pre-selected (fewest
 * warehouses, nearest to the delivery address); every row is a dropdown the
 * seller can override, listing only warehouses that can actually cover it.
 */
const AssignWarehouseModal = ({ order, onClose, onDone }) => {
  const [info, setInfo] = useState(null); // null = loading
  const [choice, setChoice] = useState({}); // productId -> warehouseId
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSellerOrderSourceOptions(order._id)
      .then((r) => {
        setInfo(r);
        // Start from the server's plan; the seller can change any row.
        const initial = {};
        (r?.products || []).forEach((p) => { if (p.recommendedWarehouseId) initial[p.productId] = p.recommendedWarehouseId; });
        setChoice(initial);
      })
      .catch((err) => { apiError(err); setInfo({ products: [], unfulfillable: [], canApprove: false }); });
  }, [order._id]);

  const products = info?.products || [];
  const unfulfillable = info?.unfulfillable || [];
  // Approve needs every line assigned to a warehouse that can cover it.
  const allAssigned = products.length > 0 && products.every((p) => {
    const w = choice[p.productId];
    return w && (p.options || []).some((o) => String(o.warehouseId) === String(w) && o.canCover);
  });
  const canApprove = allAssigned && unfulfillable.length === 0;
  const warehousesUsed = new Set(Object.values(choice).filter(Boolean)).size;

  const confirm = async () => {
    if (!canApprove) return;
    setBusy(true);
    try {
      await updateSellerOrderStatus(order._id, {
        status: 'confirmed',
        allocation: products.map((p) => ({ productId: p.productId, warehouseId: choice[p.productId] })),
      });
      toast('success', warehousesUsed > 1 ? `Approved · split across ${warehousesUsed} warehouses` : 'Approved');
      onDone();
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  const addr = info?.deliveryAddress;
  const addrLine = addr ? [addr.city, addr.district, addr.state, addr.pincode].filter(Boolean).join(', ') : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 font-sora" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-200">
          <h3 className="font-bold text-stone-900">Assign warehouses</h3>
          <p className="text-xs text-stone-500 mt-0.5">
            Each product ships from the warehouse that holds it. Approving reserves nothing — each warehouse picks and packs its own items in Send Stock.
          </p>
          {addrLine && (
            <p className="text-[11px] text-stone-400 mt-1.5">
              <span className="material-symbols-outlined text-[13px] align-middle">local_shipping</span> Delivering to {addrLine}
            </p>
          )}
        </div>

        <div className="p-4 overflow-y-auto space-y-3">
          {info === null && <p className="text-sm text-stone-400 text-center py-8">Checking availability…</p>}

          {/* Blockers first: which products can't be fulfilled, and why. */}
          {unfulfillable.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-3">
              <p className="text-xs font-bold text-red-700 mb-1.5">
                {unfulfillable.length} product{unfulfillable.length > 1 ? 's' : ''} cannot be fulfilled
              </p>
              {unfulfillable.map((u) => (
                <p key={u.productId} className="text-[11px] text-red-600">
                  <span className="font-semibold">{u.productName}</span> — {u.reason}
                </p>
              ))}
              <p className="text-[11px] text-red-500 mt-1.5">Restock, or cancel the order.</p>
            </div>
          )}

          {products.map((p) => {
            const selected = choice[p.productId] || '';
            const sel = (p.options || []).find((o) => String(o.warehouseId) === String(selected));
            const isRecommended = selected && String(selected) === String(p.recommendedWarehouseId);
            return (
              <div key={p.productId} className={`rounded-xl border px-4 py-3 ${p.fulfillable ? 'border-stone-200' : 'border-red-200 bg-red-50/40'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <span className="block text-sm font-bold text-stone-800 truncate" title={p.productName}>{p.productName}</span>
                    <span className="text-[11px] text-stone-500">Qty required: <span className="font-semibold text-stone-700">{fmtNum(p.requiredQty)}</span></span>
                  </div>

                  {p.fulfillable ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        className="text-xs border border-stone-200 rounded-lg px-2 py-1.5 bg-white min-w-[210px]"
                        value={selected}
                        onChange={(e) => setChoice((c) => ({ ...c, [p.productId]: e.target.value }))}
                      >
                        <option value="">Select warehouse…</option>
                        {/* Only warehouses that can cover this line in full are
                            selectable; short ones are shown disabled so the
                            seller can see they were considered, not missing. */}
                        {(p.options || []).map((o) => (
                          <option key={o.warehouseId} value={o.warehouseId} disabled={!o.canCover}>
                            {o.name} ({fmtNum(o.availableQty)} available){o.canCover ? '' : ' — too few'}
                          </option>
                        ))}
                      </select>
                      {selected
                        ? (
                          <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 shrink-0 ${isRecommended ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
                            {isRecommended ? 'Recommended' : 'Selected'}
                          </span>
                        )
                        : <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-amber-50 text-amber-700 shrink-0">Choose</span>}
                    </div>
                  ) : (
                    <span className="text-[11px] font-bold text-red-600 shrink-0">
                      Unavailable · best is {fmtNum(p.bestAvailableQty)}
                    </span>
                  )}
                </div>

                {sel && (
                  <p className="text-[11px] text-stone-400 mt-1.5">
                    {sel.name} holds {fmtNum(sel.availableQty)}{sel.proximity?.label ? ` · ${sel.proximity.label}` : ''}
                  </p>
                )}
              </div>
            );
          })}

          {/* Say plainly when this will become more than one parcel. */}
          {warehousesUsed > 1 && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              This order will ship as {warehousesUsed} separate parcels — one per warehouse, each picked and dispatched on its own.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-200 flex items-center justify-between gap-2">
          <span className="text-[11px] text-stone-400">
            {products.length > 0 && `${products.filter((p) => choice[p.productId]).length}/${products.length} products assigned`}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-xs font-bold px-4 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">Cancel</button>
            <button
              onClick={confirm}
              disabled={!canApprove || busy}
              className="text-xs font-bold px-4 py-2 rounded-lg bg-[#EA2831] text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Approving…' : 'Approve & assign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const NewOrderModal = ({ onClose, onDone }) => {
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [channel, setChannel] = useState('offline');
  const [lines, setLines] = useState([{ productId: '', qty: '' }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSellerCustomers().then((r) => setCustomers(listOf(r))).catch(() => {});
    getSellerProducts().then((r) => setProducts(listOf(r))).catch(() => {});
  }, []);

  const setLine = (i, k, v) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const submit = async () => {
    const items = lines.filter((l) => l.productId && Number(l.qty) > 0).map((l) => ({ productId: l.productId, qty: Number(l.qty) }));
    if (!items.length) return toast('error', 'Add at least one product');
    setBusy(true);
    try {
      const r = await createSellerOrder({ customerId: customerId || undefined, items, channel, salesChannel: 'manual' });
      toast('success', r?.message || 'Order created');
      onDone();
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  return (
    <Modal title="New Order" onClose={onClose} wide>
      <p className="text-xs text-stone-400 mb-2">Reserves your stock FEFO and assigns an invoice number. Ship later to deduct stock and mark units sold.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Buyer (customer / dealer)">
          <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Walk-in (no buyer)</option>
            {customers.map((c) => <option key={c._id} value={c._id}>{c.name}{c.type === 'dealer' ? ' · Dealer' : ''}</option>)}
          </select>
        </Field>
        <Field label="Channel"><select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="offline">Offline</option><option value="online">Online</option></select></Field>
      </div>
      <p className="text-xs font-bold text-stone-500 mt-2 mb-1">Products</p>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1">
              <select className={inputCls} value={l.productId} onChange={(e) => setLine(i, 'productId', e.target.value)}>
                <option value="">Select product…</option>
                {products.map((p) => <option key={p._id} value={p._id}>{p.productName}{p.mrp ? ` · ₹${p.mrp}` : ''}</option>)}
              </select>
            </div>
            <input type="number" min="1" placeholder="Qty" className={`${inputCls} w-24`} value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} />
            {lines.length > 1 && <GhostBtn onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>✕</GhostBtn>}
          </div>
        ))}
        <GhostBtn onClick={() => setLines((ls) => [...ls, { productId: '', qty: '' }])}>+ Add product</GhostBtn>
      </div>
      <div className="mt-3"><PrimaryBtn disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create Order & Invoice'}</PrimaryBtn></div>
    </Modal>
  );
};

export default SellerOutbound;