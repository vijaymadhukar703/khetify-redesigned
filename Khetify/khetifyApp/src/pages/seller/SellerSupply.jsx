import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import {
  getSellerLink, getSellerProducts, getSellerWarehouses, getSellerCompanies,
  createSellerSupplyOrder, getSellerSupplyOrders, receiveSellerSupply, scanSellerReceiveBox,
} from '../../lib/sellerApi';
import { Modal, PrimaryBtn, GhostBtn, NoWarehouseNotice } from '../Company/ims/ImsUi';
import ScanBox from '../../Components/ims/ScanBox';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/**
 * Scan-to-receive: the seller must actually scan (camera or wedge) — or paste —
 * the manifest code printed on the shipment label. The field starts EMPTY (no
 * pre-fill) — scanning the physical label IS the verification. ScanBox already
 * offers device-camera decoding (QR + 1D barcode) with a manual fallback.
 */
const SellerReceiveModal = ({ order, onClose, onDone }) => {
  const [qr, setQr] = useState(''); // EMPTY — operator scans/pastes the label code
  const [busy, setBusy] = useState(false);
  // CARTON SCANS: each entry is one resolved label — a Shipment Box packed for
  // this transfer, or an existing Bulk Packaging label. One scan stands for
  // every unit inside it, so units are never scanned one by one.
  const [cartons, setCartons] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [scanMsg, setScanMsg] = useState('');
  const [scanErr, setScanErr] = useState('');
  const expectedPrefix = order.shipmentId?._id ? `${order.shipmentId._id}.` : '';
  const manifestScanned = !!qr.trim() && (!expectedPrefix || qr.trim().startsWith(expectedPrefix));
  const cartonsComplete = !!coverage?.complete;
  const canReceive = manifestScanned || cartonsComplete;

  // Every scan goes to the server: it decides WHAT the label is (manifest /
  // shipment box / bulk package) by lookup and reports what it accounts for.
  const handleScan = async (raw) => {
    const code = String(raw || '').trim();
    if (!code) return;
    setScanErr(''); setScanMsg('');
    setBusy(true);
    try {
      const r = await scanSellerReceiveBox(order._id, { code, scanned: cartons.map((c) => c.code) });
      const hit = r.data;
      if (hit.kind === 'manifest') {
        setQr(hit.code);
        setScanMsg('Shipment manifest verified — the whole consignment is covered.');
        setCoverage(hit.coverage || null);
        return;
      }
      if (cartons.some((c) => c.code === hit.code)) {
        setScanErr(`${hit.code} has already been scanned.`);
        return;
      }
      setCartons((prev) => [...prev, hit]);
      setCoverage(hit.coverage || null);
      setScanMsg(`${hit.label} — ${hit.totalUnits} unit(s) loaded`);
    } catch (err) {
      setScanErr(err?.response?.data?.message || 'That label could not be read.');
    } finally { setBusy(false); }
  };

  const run = async () => {
    setBusy(true);
    try {
      const body = manifestScanned
        ? { qr: qr.trim() }
        : { boxCodes: cartons.map((c) => c.code) };
      const r = await receiveSellerSupply(order._id, body);
      toast('success', r?.message || 'Received & verified');
      onDone();
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  return (
    <Modal title="Scan to receive" onClose={onClose}>
      <p className="text-xs text-stone-500 mb-3">
        Scan the shipment label with your camera (tap the camera icon) or a wedge scanner. You can scan the
        single manifest label for the whole consignment, or scan each carton — a <b>Shipment Box</b> label or an
        existing <b>Bulk Packaging</b> label — and everything inside it loads automatically.
      </p>
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Scan a label</p>
      <ScanBox onScan={handleScan} disabled={busy} placeholder="Scan the manifest or a box label" autoFocus />

      {scanErr && (
        <p className="mt-2 text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {scanErr}
        </p>
      )}
      {!scanErr && scanMsg && (
        <p className="mt-2 text-[11px] font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          {scanMsg}
        </p>
      )}

      {/* What each scanned carton brought with it. */}
      {cartons.length > 0 && (
        <div className="mt-3 border border-stone-200 rounded-xl divide-y divide-stone-100 max-h-64 overflow-y-auto">
          {cartons.map((c) => (
            <div key={c.code} className="px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-stone-900">{c.label}</p>
                <span className="text-[10px] font-bold text-stone-500 bg-stone-100 border border-stone-200 rounded-full px-2 py-0.5 shrink-0">
                  {c.totalUnits} unit(s)
                </span>
              </div>
              <p className="text-[10px] font-mono text-stone-400 break-all">{c.code}</p>
              {(c.products || []).map((p, i) => (
                <p key={i} className="text-[11px] text-stone-600">
                  {p.productName || 'Item'} × {p.quantity}
                  {p.lots?.length ? <span className="font-mono text-stone-400"> · {p.lots.join(', ')}</span> : null}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      {coverage && !manifestScanned && (
        <p className={`mt-3 text-[11px] font-bold ${cartonsComplete ? 'text-green-600' : 'text-stone-500'}`}>
          {coverage.covered} of {coverage.total} unit(s) accounted for
          {cartonsComplete ? ' — everything is here.' : ` · ${coverage.missing} still to scan`}
        </p>
      )}
      {manifestScanned && (
        <p className="mt-2 text-[11px] font-mono text-green-600 break-all">✓ {qr.trim()}</p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn disabled={!canReceive || busy} onClick={run}>{busy ? 'Receiving…' : 'Verify & receive'}</PrimaryBtn>
      </div>
    </Modal>
  );
};

const STATUS_STYLE = {
  requested: 'bg-amber-50 text-amber-700', under_review: 'bg-amber-50 text-amber-700',
  approved: 'bg-blue-50 text-blue-700', picking: 'bg-blue-50 text-blue-700', packed: 'bg-indigo-50 text-indigo-700',
  dispatched: 'bg-violet-50 text-violet-700', in_transit: 'bg-violet-50 text-violet-700', arrived: 'bg-violet-50 text-violet-700',
  partially_received: 'bg-amber-50 text-amber-700', received: 'bg-green-50 text-green-700',
  delivered: 'bg-green-50 text-green-700', rejected: 'bg-red-50 text-red-700', cancelled: 'bg-stone-100 text-stone-500',
};
// Statuses where the seller can scan the manifest to receive the supply.
const RECEIVABLE = ['dispatched', 'in_transit', 'arrived', 'partially_received'];

// Seller — Request Supply + My Supply Orders. Pick the linked company's products
// and a destination seller warehouse → POST /api/seller/supply-orders.
const SellerSupply = () => {
  const [params] = useSearchParams();
  const [approved, setApproved] = useState(null);
  const [companies, setCompanies] = useState([]); // the seller's APPROVED companies
  const [companyId, setCompanyId] = useState(''); // chosen supplying company
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  // Mirrors the `checked` guard in the company hook (hooks/useHasWarehouse.js):
  // the gate below must only fire once the lookup has ACTUALLY run, never
  // while `warehouses` is still its initial empty array.
  const [warehousesChecked, setWarehousesChecked] = useState(false);
  const [orders, setOrders] = useState([]);

  const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState([{ productId: '', quantity: '' }]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(null); // supply order being scan-received

  const companyName = companies.find((c) => String(c._id) === String(companyId))?.businessName || '';

  const refreshOrders = useCallback(() => {
    getSellerSupplyOrders().then((r) => { if (r?.success) setOrders(r.data || []); }).catch(() => {});
  }, []);

  // Approval gate + the seller's APPROVED companies (the ones they can order
  // from). setState only inside the async callbacks.
  const load = useCallback(() => {
    getSellerLink()
      .then((r) => {
        const ok = r?.data?.linkStatus === 'approved';
        setApproved(ok);
        if (!ok) return;
        getSellerCompanies('approved').then((c) => {
          const list = c?.data || [];
          setCompanies(list);
          if (list.length) setCompanyId((cur) => cur || String(list[0]._id)); // default to the first approved
        }).catch(() => {});
        // Reuses the page's EXISTING warehouse fetch — no second request just
        // for the gate. Fails OPEN (checked stays false) so a network blip can
        // never lock a seller out; the backend rejects the create regardless.
        getSellerWarehouses()
          .then((w) => { if (w?.success) { setWarehouses(w.data || []); setWarehousesChecked(true); } })
          .catch(() => {});
        refreshOrders();
      })
      .catch(() => setApproved(false));
  }, [refreshOrders]);
  useEffect(() => { load(); }, [load]);

  // Products come from the SELECTED company's catalog — refetch on change and
  // reset the line items so you can't carry another company's products over.
  useEffect(() => {
    if (!companyId) { setProducts([]); return; }
    let alive = true;
    getSellerProducts({ companyId })
      .then((p) => { if (alive && p?.success) setProducts(p.data || []); })
      .catch(() => { if (alive) setProducts([]); });
    return () => { alive = false; };
  }, [companyId]);

  // Preselect a product when arriving from the catalog (?product=<id>).
  useEffect(() => {
    const pid = params.get('product');
    if (pid && products.some((p) => p._id === pid)) {
      setLines((ls) => (ls.length === 1 && !ls[0].productId ? [{ productId: pid, quantity: '' }] : ls));
    }
  }, [params, products]);

  const setLine = (i, k, v) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((ls) => [...ls, { productId: '', quantity: '' }]);
  const removeLine = (i) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  // A supply request must land in a warehouse, so creation stays locked until
  // the seller owns one. Backend enforces the same rule authoritatively
  // (middlewares/requireWarehouseExists.js) — this is UX, never the guarantee.
  const supplyBlocked = warehousesChecked && warehouses.length === 0;

  const valid = useMemo(() => {
    if (!companyId || !warehouseId) return false;
    const items = lines.filter((l) => l.productId && Number(l.quantity) > 0);
    return items.length > 0;
  }, [companyId, warehouseId, lines]);

  const submit = async () => {
    const items = lines.filter((l) => l.productId && Number(l.quantity) > 0).map((l) => ({ productId: l.productId, quantity: Number(l.quantity) }));
    setBusy(true);
    try {
      await createSellerSupplyOrder({ companyId, items, warehouseId, notes });
      toast('success', 'Supply request sent');
      setLines([{ productId: '', quantity: '' }]); setNotes('');
      refreshOrders();
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  if (approved === null) return <div className="flex-1 p-8 text-center text-stone-400 font-sora">Loading…</div>;
  if (!approved) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">lock</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Supply requests are locked</h2>
          <p className="text-sm text-amber-700 mt-1">Available after your supplying company approves you.</p>
        </div>
      </div>
    );
  }

  const inputCls = 'w-full h-11 px-3 rounded-lg border border-stone-300 outline-none focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/10 text-sm bg-white';

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50/50 font-sora">
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-xl font-bold text-stone-900">Request Supply</h1>
          <p className="text-sm text-stone-500">Order stock from <b className="text-stone-700">{companyName || 'one of your approved companies'}</b> into one of your warehouses.</p>
        </div>

        {/* Request form — replaced by the shared warehouse gate when the seller
            has none. Past requests below stay visible either way. */}
        {supplyBlocked ? (
          <NoWarehouseNotice
            to="/seller/warehouses?new=1"
            title="No warehouse set up yet"
            body="Please create a Warehouse first before creating an Inbound Supply Request. Every request needs a destination warehouse, so supply opens up as soon as your first warehouse is added."
          />
        ) : (
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div>
            <label className="block text-xs font-bold text-stone-600 mb-1">Supplying company</label>
            <select className={inputCls} value={companyId} onChange={(e) => { setCompanyId(e.target.value); setLines([{ productId: '', quantity: '' }]); }}>
              <option value="">Select a company…</option>
              {companies.map((c) => <option key={c._id} value={c._id}>{c.businessName}{c.location ? ` · ${c.location}` : ''}</option>)}
            </select>
            {companies.length === 0 && <p className="text-[11px] text-amber-600 mt-1">No approved companies yet — get approved by a company under Administration → Companies first.</p>}
          </div>
          <div>
            <label className="block text-xs font-bold text-stone-600 mb-1">Destination warehouse</label>
            <select className={inputCls} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Select your warehouse…</option>
              {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}{w.code ? ` (${w.code})` : ''}</option>)}
            </select>
            {warehouses.length === 0 && <p className="text-[11px] text-stone-400 mt-1">No warehouses yet — add one under Warehouses first.</p>}
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-600 mb-1">Products</label>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select className={`${inputCls.replace('w-full', '')} flex-1 min-w-0`} value={l.productId} onChange={(e) => setLine(i, 'productId', e.target.value)}>
                    <option value="">Select product…</option>
                    {products.map((p) => <option key={p._id} value={p._id}>{p.productName}{p.skuNumber ? ` · ${p.skuNumber}` : ''}</option>)}
                  </select>
                  <input type="number" min="1" placeholder="Qty" className={`${inputCls.replace('w-full', '')} w-24 shrink-0`} value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} />
                  {lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(i)} className="h-11 w-11 shrink-0 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50">✕</button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={addLine} className="mt-2 text-xs font-bold text-[#EA2831] hover:underline">+ Add product</button>
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-600 mb-1">Notes (optional)</label>
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any details for the company" />
          </div>

          <button onClick={submit} disabled={!valid || busy} className="rounded-lg bg-[#EA2831] px-6 py-2.5 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed">
            {busy ? 'Sending…' : 'Send supply request'}
          </button>
        </div>
        )}

        {/* My supply orders */}
        <div>
          <h2 className="text-base font-bold text-stone-900 mb-3">My Supply Orders</h2>
          <div className="bg-white border border-stone-200 rounded-2xl overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[640px] resp-table">
              <thead>
                <tr className="bg-stone-50/50 border-b border-stone-200">
                  {['Items', 'Destination', 'Status', 'Requested', ''].map((h, i) => (
                    <th key={i} className="px-5 py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {orders.map((o) => (
                  <tr key={o._id} className="hover:bg-stone-50/40">
                    <td data-label="Items" className="px-5 py-3 text-sm text-stone-700">
                      {(o.items || []).map((it) => `${it.productId?.productName || 'Item'} ×${it.quantity}`).join(', ')}
                    </td>
                    <td data-label="Destination" className="px-5 py-3 text-sm text-stone-600">{o.warehouseId?.name || '—'}</td>
                    <td data-label="Status" className="px-5 py-3">
                      <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${STATUS_STYLE[o.status] || 'bg-stone-100 text-stone-500'}`}>{o.status?.replace('_', ' ')}</span>
                    </td>
                    <td data-label="Requested" className="px-5 py-3 text-sm text-stone-500">{fmtDate(o.createdAt)}</td>
                    <td className="px-5 py-3 cell-actions text-right">
                      {RECEIVABLE.includes(o.status) && (
                        <button onClick={() => setReceiving(o)} className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-[#EA2831] text-white hover:bg-red-600">
                          <span className="material-symbols-outlined text-sm">qr_code_scanner</span> Scan to receive
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-stone-400">No supply orders yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {receiving && (
        <SellerReceiveModal
          order={receiving}
          onClose={() => setReceiving(null)}
          onDone={() => { setReceiving(null); refreshOrders(); }}
        />
      )}
    </div>
  );
};

export default SellerSupply;