import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { Modal, Field, inputCls, PrimaryBtn, GhostBtn, Th } from '../Company/ims/ImsUi';
import { ManifestModal } from '../../Components/ims/TransferModals';
import ScanBox from '../../Components/ims/ScanBox';
// SELLER WAREHOUSE → WAREHOUSE TRANSFER. Its own scan → box → dispatch popup and
// its own box-label receive popup, modelled on the COMPANY warehouse transfer
// (DispatchScanModal / ReceiveModal in pages/Company/ims/ImsTransport.jsx).
// Deliberately separate components: the customer-order flow below
// (OrderProcessModal + DeliveryLabelModal) is a parcel with an address and a
// delivery label, and stays exactly as it was.
import SellerTransferProcessModal from '../../Components/seller/SellerTransferProcessModal';
import SellerTransferReceiveModal from '../../Components/seller/SellerTransferReceiveModal';
import SellerTransferBoxLabels from '../../Components/seller/SellerTransferBoxLabel';
import { movementKind } from '../../lib/movementLabel';
// Stored files come back as a signed absolute URL (S3) or a served /uploads
// path (local); this resolves either into something a link can open. The SAME
// helper the company transfer table uses for its challan link.
import { fileHref } from '../../lib/fileHref';
import {
  getSellerLink, getSellerWarehouses,
  getSellerShipments,
  scanSellerShipment, getSellerScanState,
  previewSellerBoxLabel, dispatchSellerOrder, receiveSellerShipment,
  getSellerTransfers, createSellerTransfer, directSellerTransfer, getSellerTransferStock, getSellerTransferWarehouses, acceptSellerTransfer, rejectSellerTransfer,
  getSellerSupplyOrders, receiveSellerSupply,
  getSellerTransferBoxes,
  sellerTraceLot, sellerTraceUnit,
} from '../../lib/sellerApi';
import { useSellerPermission } from '../../context/SellerPermissionContext';
// The SAME renderers the company shipping label uses (Components/ims/TransferModals):
// JsBarcode CODE128 → SVG, plus the QR the receiving camera scans. Reused rather
// than reimplemented, so seller labels scan exactly like company ones.
import QrCode from '../../lib/qrcode';
const Barcode128 = lazy(() => import('../../lib/barcode128'));

// Print only the label block — copied verbatim from the company label so the
// printed output behaves identically.
const LABEL_PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  #seller-delivery-label, #seller-delivery-label * { visibility: visible; }
  #seller-delivery-label { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  @page { margin: 12mm; }
}`;

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiErr = (e) => toast('error', e?.response?.data?.message || e.message || 'Something went wrong');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtNum = (n) => Number(n || 0).toLocaleString('en-IN');

// Send-Stock pipeline (mirrors the company Pick · Pack · Dispatch):
// The five label types the seller scan validator resolves.
const SCAN_TYPE_LABEL = {
  lot: 'Lot', bulk_package: 'Bulk package', box: 'Main box',
  inner_box: 'Inner box', unit: 'Unit',
};
// Every stage before dispatch. There is ONE queue now: picking, packing and
// dispatching all happen inside the single process flow, so a shipment stays in
// this list until it actually leaves the warehouse.
const LIVE_STAGE = ['planned', 'picking', 'picked', 'packing', 'packed'];
const DISPATCHABLE = ['draft', 'planned', 'picking', 'picked', 'packed', 'approved', 'loading'];
// "partially_received" belongs here. It used to be terminal — the manifest QR
// received a whole transfer in one go. Now that boxes are scanned in one at a
// time it is a MID-FLIGHT state, and leaving it out would empty the Actions
// column the moment the first box landed, with no way to finish the transfer.
const RECEIVABLE = ['in_transit', 'arrived', 'verifying', 'partially_received'];
const SUPPLY_RECEIVABLE = ['dispatched', 'in_transit', 'arrived', 'partially_received'];
const SHIP_STATUS_STYLE = {
  planned: 'bg-stone-100 text-stone-600', picking: 'bg-amber-50 text-amber-700', picked: 'bg-blue-50 text-blue-700',
  packed: 'bg-blue-50 text-blue-700', approved: 'bg-blue-50 text-blue-700', loading: 'bg-blue-50 text-blue-700',
  in_transit: 'bg-violet-50 text-violet-700', arrived: 'bg-violet-50 text-violet-700', verifying: 'bg-amber-50 text-amber-700',
  received: 'bg-green-50 text-green-700', partially_received: 'bg-amber-50 text-amber-700', cancelled: 'bg-stone-100 text-stone-500',
};
// Total / picked unit counts for a transfer shipment (across its FEFO lots).
const lineUnits = (s) => (s.lines || []).reduce((n, l) => n + (l.qty || 0), 0);
const linePicked = (s) => (s.lines || []).reduce((n, l) => n + (l.pickedQty || 0), 0);
/**
 * IS THIS SHIPMENT A WAREHOUSE → WAREHOUSE TRANSFER?
 *
 * The single switch that keeps the two flows apart. `toType` is set by the
 * server when the shipment is raised: "warehouse" for a transfer between two of
 * the seller's own warehouses, "customer" for an order parcel. Everything that
 * differs between them — which popup opens, which label prints, how it is
 * received — hangs off this one question, so a customer order can never be sent
 * down the transfer path or vice versa.
 */
const isWarehouseTransfer = (s) => s?.toType === 'warehouse' && !!s?.toWarehouseId;

/* ── DELIVERY CHALLAN upload. Images AND PDFs are both accepted, so `accept`
   names both rather than restricting to one. Copied in shape from the company
   New Transfer form (pages/Company/ims/ImsTransport.jsx) so the two forms read
   and behave the same. */
const isImageFile = (file) => /^image\//i.test(file?.type || '');
const isPdfFile = (file) => /pdf$/i.test(file?.type || '') || /\.pdf$/i.test(file?.name || '');
const prettySize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The picked challan file: image thumbnail or a PDF row, with Remove. */
const ChallanPreview = ({ file, previewUrl, onRemove }) => (
  <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50/60 p-2">
    {previewUrl ? (
      <img src={previewUrl} alt={file.name} className="size-12 shrink-0 rounded object-cover border border-stone-200" />
    ) : (
      <span className="material-symbols-outlined shrink-0 text-[32px] text-stone-400">picture_as_pdf</span>
    )}
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs font-bold text-stone-700" title={file.name}>{file.name}</p>
      <p className="text-[11px] text-stone-400">{prettySize(file.size)}</p>
    </div>
    {/* Remove clears the input too (see clearChallan), so the SAME file can be
        picked again — a bare state reset leaves the input's value in place and
        the next identical pick fires no change event. */}
    <button
      type="button"
      onClick={onRemove}
      className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-[#EA2831] hover:underline"
    >
      Remove
    </button>
  </div>
);
// The SAME palette the company Requests table uses (ImsTransport.REQ_STATUS_STYLES),
// so a status reads identically on both sides: accepted is GREEN (a decision was
// made) and fulfilled is BLUE (the goods actually landed). They were the other
// way round here, which made an accepted request look finished.
const REQ_STATUS_STYLE = {
  requested: 'bg-amber-50 text-amber-600', accepted: 'bg-green-50 text-green-600',
  rejected: 'bg-red-50 text-red-600', fulfilled: 'bg-blue-50 text-blue-600', cancelled: 'bg-stone-100 text-stone-400',
};

const TAB_DEFS = [
  { key: 'receive', label: 'Receive Stock', icon: 'move_to_inbox' },
  { key: 'send', label: 'Send Stock', icon: 'outbox' },
  { key: 'shipments', label: 'Transfers', icon: 'local_shipping' },
  { key: 'trace', label: 'Traceability', icon: 'travel_explore' },
];

// WHO SEES WHAT — the seller mirror of the company's COMPANY_TABS /
// WAREHOUSE_TABS split (pages/Company/ims/Operations.jsx).
//
// seller_admin is the head office: it reviews and approves requests and watches
// every shipment, but it does not physically hold stock, so Receive and Send
// (pick / pack / dispatch / scan) are not its screens.
//
// seller_manager IS the warehouse: it gets the full set.
//
// This is UI shaping only. The real gate is the backend's `transfer:create`,
// which config/permissions.js now denies to seller_admin.
const SELLER_ADMIN_TABS = ['shipments', 'trace'];
const WAREHOUSE_TABS = ['receive', 'send', 'shipments', 'trace'];

// Seller Operations — mirrors the company Operations module (Receive · Send ·
// Shipment Tracking & Transfers · Traceability), fed the seller's owner-aware
// data. Inter-warehouse transfers ride the full shipment lifecycle.
const SellerOperations = () => {
  const [params, setParams] = useSearchParams();
  // Role + warehouse scope drive which action a user sees: a seller_manager may
  // only act on the warehouse(s) assigned to them; seller_admin acts on all.
  const { sellerCan: hasCap, warehouseIds = [], role } = useSellerPermission();
  const canWrite = hasCap('transfer:create');
  // Warehouse work is for whoever may actually move stock. Anyone without
  // transfer:create (seller_admin, seller_staff) gets the review-only set.
  const allowedTabs = canWrite ? WAREHOUSE_TABS : SELLER_ADMIN_TABS;
  const tabs = TAB_DEFS.filter((t) => allowedTabs.includes(t.key));
  // A hand-typed ?tab=send falls back to the first tab this role may see.
  const active = tabs.find((t) => t.key === params.get('tab')) || tabs[0];
  const myWh = (warehouseIds || []).map(String);
  const scoped = role !== 'seller_admin' && myWh.length > 0;
  const canActOn = (whId) => { const id = String(whId?._id ?? whId ?? ''); return !scoped || myWh.includes(id); };

  const [approved, setApproved] = useState(null);
  const [shipments, setShipments] = useState([]);
  const [requests, setRequests] = useState([]);
  const [supply, setSupply] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [manifest, setManifest] = useState(null); // { qrPayload } shipping label
  const [receiving, setReceiving] = useState(null); // { kind, item }
  // ONE guided Pick → Pack → Label → Dispatch flow; it opens at whichever step
  // the shipment's current status implies.
  const [flow, setFlow] = useState(null);
  const [showNewReq, setShowNewReq] = useState(false); // pull: "New request"
  const [showTransfer, setShowTransfer] = useState(false); // push: "Transfer" (direct)
  // Box labels for a dispatched warehouse transfer — reprintable at any time.
  const [boxLabels, setBoxLabels] = useState(null); // { boxes, ref }

  const reload = useCallback(() => {
    getSellerShipments().then((r) => setShipments(r?.data || [])).catch(() => {});
    getSellerTransfers().then((r) => setRequests(r?.data || [])).catch(() => {});
    getSellerSupplyOrders().then((r) => setSupply(r?.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    getSellerLink().then((r) => {
      const ok = r?.data?.linkStatus === 'approved';
      if (!alive) return;
      setApproved(ok);
      if (!ok) return;
      reload();
      getSellerWarehouses().then((w) => { if (alive) setWarehouses(w?.data || []); }).catch(() => {});
    }).catch(() => { if (alive) setApproved(false); });
    return () => { alive = false; };
  }, [reload]);

  const accept = async (req) => {
    try { await acceptSellerTransfer(req._id); toast('success', 'Accepted — shipment created'); reload(); }
    catch (e) { apiErr(e); }
  };
  const reject = async (req) => {
    const { isConfirmed, value } = await Swal.fire({ title: `Reject request?`, input: 'text', inputLabel: 'Reason (optional)', showCancelButton: true, confirmButtonColor: '#EA2831', confirmButtonText: 'Reject' });
    if (!isConfirmed) return;
    try { await rejectSellerTransfer(req._id, { note: value || '' }); toast('success', 'Rejected'); reload(); }
    catch (e) { apiErr(e); }
  };
  /** Reprint the box labels of a dispatched warehouse transfer. */
  const openBoxLabels = async (s) => {
    try {
      const r = await getSellerTransferBoxes(s._id);
      const boxes = r?.data || [];
      if (!boxes.length) { toast('info', 'No boxes were packed for this transfer.'); return; }
      setBoxLabels({ boxes, ref: s.lrNumber || `SH-${String(s._id).slice(-6).toUpperCase()}` });
    } catch (e) { apiErr(e); }
  };
  const incomingShipments = useMemo(() => shipments.filter((s) => RECEIVABLE.includes(s.status)), [shipments]);
  const incomingSupply = useMemo(() => supply.filter((o) => SUPPLY_RECEIVABLE.includes(o.status)), [supply]);
  const outgoing = useMemo(() => shipments.filter((s) => DISPATCHABLE.includes(s.status)), [shipments]);

  if (approved === null) return <div className="flex-1 p-8 text-center text-stone-400 font-sora">Loading…</div>;
  if (!approved) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">lock</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Operations are locked</h2>
          <p className="text-sm text-amber-700 mt-1">Available after your supplying company approves you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 font-sora">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Operations</h1>
      <p className="text-stone-500 mb-5">Receive, send, transfer and track your stock.</p>

      <div className="flex gap-1 border-b border-stone-200 mb-6 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setParams({ tab: t.key })}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px whitespace-nowrap transition-colors ${
              active.key === t.key ? 'border-[#EA2831] text-[#EA2831]' : 'border-transparent text-stone-400 hover:text-stone-700'
            }`}>
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {active.key === 'receive' && (
        <ReceiveTab
          shipments={incomingShipments} supply={incomingSupply} canWrite={canWrite} canActOn={canActOn}
          onScanShipment={(s) => setReceiving({ kind: 'transfer', item: s })}
          onScanSupply={(o) => setReceiving({ kind: 'supply', item: o })}
        />
      )}
      {active.key === 'send' && (
        <SendTab
          shipments={outgoing} canWrite={canWrite} canActOn={canActOn}
          onProcess={(s) => setFlow(s)}
        />
      )}
      {active.key === 'shipments' && (
        <ShipmentsTab
          shipments={shipments} requests={requests} canWrite={canWrite} canActOn={canActOn}
          onLabel={(s) => setManifest({ qrPayload: `${s._id}.${s.qrToken || ''}` })}
          onReceive={(s) => setReceiving({ kind: 'transfer', item: s })}
          onAccept={accept} onReject={reject}
          onNewRequest={() => setShowNewReq(true)}
          onNewTransfer={() => setShowTransfer(true)}
          onBoxLabels={openBoxLabels}
        />
      )}
      {active.key === 'trace' && <TraceTab />}

      {manifest && <ManifestModal info={manifest} onClose={() => setManifest(null)} />}
      {/* ONE ROW, TWO FLOWS. A warehouse transfer opens the transfer popup —
          scan → tick units → box → dispatch → box labels. A customer order
          opens the untouched order popup. */}
      {flow && (isWarehouseTransfer(flow) ? (
        <SellerTransferProcessModal
          shipment={flow}
          onClose={() => setFlow(null)}
          onDone={() => { setFlow(null); reload(); }}
        />
      ) : (
        <OrderProcessModal
          shipment={flow}
          onClose={() => setFlow(null)}
          onDone={() => { setFlow(null); reload(); }}
        />
      ))}
      {/* Receiving a warehouse transfer is box-label by box-label. A supply
          order still receives through its own manifest dialog, untouched. */}
      {receiving && (receiving.kind === 'transfer' && isWarehouseTransfer(receiving.item) ? (
        <SellerTransferReceiveModal
          shipment={receiving.item}
          onClose={() => setReceiving(null)}
          onDone={() => { setReceiving(null); reload(); }}
        />
      ) : (
        <ScanReceiveModal
          target={receiving}
          onClose={() => setReceiving(null)}
          onDone={() => { setReceiving(null); reload(); }}
        />
      ))}
      {boxLabels && (
        <SellerTransferBoxLabels
          boxes={boxLabels.boxes}
          transferRef={boxLabels.ref}
          onClose={() => setBoxLabels(null)}
        />
      )}
      {showTransfer && (
        <DirectTransferModal
          warehouses={warehouses}
          onClose={() => setShowTransfer(false)}
          onDone={() => { setShowTransfer(false); reload(); setParams({ tab: 'send' }); }}
        />
      )}
      {showNewReq && <NewRequestModal warehouses={warehouses} onClose={() => setShowNewReq(false)} onDone={() => { setShowNewReq(false); reload(); setParams({ tab: 'shipments' }); }} />}
    </div>
  );
};

/* ───────── Receive Stock ───────── */
// Receiving is done by the DESTINATION warehouse (its manager) or seller_admin.
const ReceiveTab = ({ shipments, supply, canWrite, canActOn, onScanShipment, onScanSupply }) => (
  <div className="space-y-8">
    <Section title="Incoming transfers to receive" empty="No transfers awaiting receipt.">
      {shipments.map((s) => (
        <Row key={s._id} title={`${s.fromLabel || 'Source'} → ${s.toLabel}`} sub={`${(s.lines || []).length} lot(s) · ${fmtDate(s.dispatchedAt)}`}
          status={s.status} statusStyle={SHIP_STATUS_STYLE}
          action={canWrite && canActOn(s.toWarehouseId) && <ScanBtn onClick={() => onScanShipment(s)} />} />
      ))}
    </Section>
    <Section title="Incoming supply to receive" empty="No supply awaiting receipt.">
      {supply.map((o) => (
        <Row key={o._id} title={`${(o.items || []).length} item(s) → ${o.warehouseId?.name || 'warehouse'}`} sub={`Requested ${fmtDate(o.createdAt)}`}
          status={o.status} statusStyle={SHIP_STATUS_STYLE}
          action={canWrite && canActOn(o.warehouseId) && <ScanBtn onClick={() => onScanSupply(o)} />} />
      ))}
    </Section>
  </div>
);

/* ───────── Send Stock: customer & product detail ───────── */

/** The delivery address as one line. Null for a transfer (no customer). */
const addressText = (a) => {
  if (!a) return null;
  return [a.line1, a.line2, a.city, a.district, a.state, a.pincode].filter(Boolean).join(', ');
};

/** Order / invoice reference, whichever the order carries. */
const orderRef = (o) => o?.invoiceNumber || o?.orderNumber || null;

/**
 * SEND STOCK TABLE
 *
 * Replaces the previous card list. One ROW PER REQUEST (shipment). A request
 * containing several products keeps ONE row — the Product and Qty cells stack
 * their lines and share horizontal rules, so the products read as a group under
 * their own order without the row splitting or the columns losing alignment.
 *
 * `resp-table` + `data-label` is the same responsive pattern the Shipments and
 * Receive tables in this file already use, so the table collapses to stacked
 * labelled cells on a narrow screen instead of scrolling off.
 *
 * Purely presentational: the action button opens the single processing flow.
 */
const SEND_COLUMNS = ['Order / Ref', 'Customer', 'Address', 'City', 'State', 'PIN', 'Product', 'Qty', 'Status', ''];

/** Per-product rows for the Product / Qty cells. Falls back to the shipment's
 *  per-LOT lines for a transfer (or an order raised before products were
 *  recorded), so every row shows something real rather than a dash. */
const productRows = (s) => {
  if ((s.products || []).length) {
    return s.products.map((p) => ({
      key: p.productId,
      name: p.productName,
      requested: p.requestedQty,
      picked: p.pickedQty || 0,
      note: p.lotCount > 1 ? `${p.lotCount} lots` : null,
    }));
  }
  return (s.lines || []).map((l, i) => ({
    key: `${l.productId || 'line'}-${i}`,
    name: l.productName || l.lotNumber || l.batchNumber || 'Item',
    requested: l.qty || 0,
    picked: l.pickedQty || 0,
    note: l.productName ? (l.lotNumber || l.batchNumber || null) : null,
  }));
};

const SendRow = ({ shipment: s, canWrite, actionLabel, actionIcon, onAction }) => {
  const o = s.order;
  const a = o?.address;
  const rows = productRows(s);
  // Stacked cells share one divider set so Product and Qty stay aligned.
  const stack = 'divide-y divide-stone-100/80';
  const cellPad = 'px-2 py-1.5 first:pt-0 last:pb-0';

  return (
    <tr className="hover:bg-stone-50/40 align-top">
      <td data-label="Order / Ref" className="px-5 py-3">
        <span className="block text-xs font-mono font-bold text-stone-800">
          {orderRef(o) || s.ref || '—'}
        </span>
        <span className="block text-[10px] text-stone-400 mt-0.5">
          {s.refType === 'Order' ? 'Customer order' : 'Transfer'}
        </span>
      </td>

      <td data-label="Customer" className="px-5 py-3">
        <span className="block text-sm font-semibold text-stone-800">
          {o?.customerName || s.toLabel || '—'}
        </span>
        {a?.phone && <span className="block text-[11px] text-stone-400">{a.phone}</span>}
        <span className="block text-[10px] text-stone-400 mt-0.5">from {s.fromLabel || 'Source'}</span>
      </td>

      <td data-label="Address" className="px-5 py-3 max-w-[220px]">
        <span className="block text-[11px] text-stone-600 break-words">
          {[a?.line1, a?.line2].filter(Boolean).join(', ') || '—'}
        </span>
      </td>
      <td data-label="City" className="px-5 py-3 text-[11px] text-stone-600">{a?.city || '—'}</td>
      <td data-label="State" className="px-5 py-3 text-[11px] text-stone-600">{a?.state || '—'}</td>
      <td data-label="PIN" className="px-5 py-3 text-[11px] font-mono text-stone-600">{a?.pincode || '—'}</td>

      {/* MULTI-PRODUCT: each product on its own line, inside the one row. */}
      <td data-label="Product" className="px-3 py-3 min-w-[170px]">
        <div className={stack}>
          {rows.map((r) => (
            <div key={r.key} className={cellPad}>
              <span className="block text-xs font-semibold text-stone-800">{r.name}</span>
              {r.note && <span className="block text-[10px] text-stone-400">{r.note}</span>}
            </div>
          ))}
        </div>
      </td>

      <td data-label="Qty" className="px-3 py-3">
        <div className={stack}>
          {rows.map((r) => {
            const done = r.picked >= r.requested;
            return (
              <div key={r.key} className={`${cellPad} whitespace-nowrap`}>
                <span className={`text-xs font-bold ${done ? 'text-green-600' : 'text-stone-800'}`}>
                  {r.picked}/{r.requested}
                </span>
                {done && <span className="material-symbols-outlined text-[13px] align-middle text-green-600 ml-0.5">check</span>}
              </div>
            );
          })}
        </div>
      </td>

      <td data-label="Status" className="px-5 py-3">
        <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 capitalize ${SHIP_STATUS_STYLE[s.status] || 'bg-stone-100 text-stone-500'}`}>
          {(s.status || '').replace(/_/g, ' ')}
        </span>
      </td>

      <td className="px-5 py-3 cell-actions text-right">
        {canWrite && (
          <button
            onClick={() => onAction(s)}
            className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-[#EA2831] text-white hover:bg-red-600 whitespace-nowrap"
          >
            {actionIcon && <span className="material-symbols-outlined text-sm">{actionIcon}</span>}
            {actionLabel}
          </button>
        )}
      </td>
    </tr>
  );
};

const SendTable = ({ rows, empty, canWrite, actionLabel, actionIcon, onAction }) => (
  <div className="bg-white border border-stone-200 rounded-2xl overflow-x-auto">
    <table className="w-full text-left border-collapse min-w-[1080px] resp-table">
      <thead><tr className="bg-stone-50/50 border-b border-stone-200">
        {SEND_COLUMNS.map((h, i) => (
          <th key={i} className="px-5 py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest">{h}</th>
        ))}
      </tr></thead>
      <tbody className="divide-y divide-stone-100">
        {rows.length === 0
          ? <tr><td colSpan={SEND_COLUMNS.length} className="px-5 py-10 text-center text-sm text-stone-400">{empty}</td></tr>
          : rows.map((s) => (
            <SendRow key={s._id} shipment={s} canWrite={canWrite}
              actionLabel={actionLabel} actionIcon={actionIcon} onAction={onAction} />
          ))}
      </tbody>
    </table>
  </div>
);

/* ───────── Send Stock ───────── */
// Mirrors the company Send Stock (Operations → Send): three sub-tabs Pick · Pack
// · Dispatch. The SOURCE warehouse (or seller_admin) fulfils an accepted transfer
// by scanning to pick (until requested qty met), packing it, then printing the
// label and dispatching (label required). Receiving stays with the destination.
/**
 * SEND STOCK — ONE LIST, ONE ACTION.
 *
 * The Pick / Pack / Dispatch sub-tabs are gone. They existed because those were
 * three separate operations on three screens; they are now a single guided
 * process, so splitting the queue by stage only made the manager hunt for the
 * same row under a different tab.
 *
 * Every live request appears once here. "Process" opens the whole flow —
 * scan, select, box, label, dispatch — and the row leaves the list when the
 * shipment is dispatched.
 */
const SendTab = ({ shipments, canWrite, canActOn, onProcess }) => {
  // Only the source warehouse's manager (or seller_admin) acts on a shipment.
  // This list carries BOTH inter-warehouse transfers AND customer orders — a
  // confirmed order becomes a customer shipment that rides this same pipeline.
  const mine = shipments.filter((s) => canActOn(s.fromWarehouseId));
  const open = mine.filter((s) => LIVE_STAGE.includes(s.status));

  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">
        To process — customer orders &amp; transfers{open.length ? ` (${open.length})` : ''}
      </p>
      <SendTable
        rows={open}
        canWrite={canWrite}
        onAction={onProcess}
        actionLabel="Process"
        actionIcon="qr_code_scanner"
        empty="Nothing to process. Confirm an order, or accept a transfer request."
      />
    </div>
  );
};

/**
 * THE CUSTOMER DELIVERY LABEL.
 *
 * A normal e-commerce parcel label: deliver-to block, return address, contents
 * and the scannable package barcode. Entirely SEPARATE from the Lot / Bulk
 * Package / Main Box / Inner Box / Unit labels, which identify inventory and
 * are untouched.
 *
 * Every value is rendered from the server's label payload, which reads the
 * actual order. Nothing is hardcoded — and there is deliberately no country
 * line, because no address in this system stores one.
 */
const DeliveryLabelModal = ({ label, onClose }) => {
  const d = label.deliverTo || {};
  const cityLine = [d.city, d.district].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4 font-sora" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <style>{LABEL_PRINT_CSS}</style>
        <div className="no-print flex items-center justify-between px-5 py-3 border-b border-stone-200">
          <h3 className="font-bold text-stone-900 text-sm">
            Delivery label{label.draft ? ' · dispatch to confirm' : ''}
          </h3>
          <div className="flex items-center gap-2">
            <GhostBtn onClick={() => window.print()}>
              <span className="material-symbols-outlined text-base">print</span> Print
            </GhostBtn>
            <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        {/* The label itself. Black on white with heavy rules — it is meant to be
            printed and stuck on a carton. */}
        <div className="p-4">
          <div id="seller-delivery-label" className="border-2 border-black rounded-sm">
            <div className="flex items-stretch border-b-2 border-black">
              <div className="flex-1 px-3 py-2">
                <p className="text-[9px] font-bold uppercase tracking-widest text-black/60">Order</p>
                <p className="text-sm font-bold text-black">{label.orderNumber || '—'}</p>
              </div>
              <div className="px-3 py-2 border-l-2 border-black text-right">
                <p className="text-[9px] font-bold uppercase tracking-widest text-black/60">Units</p>
                <p className="text-sm font-bold text-black">{label.totalUnits}</p>
              </div>
            </div>

            <div className="px-3 py-3 border-b-2 border-black">
              <p className="text-[9px] font-bold uppercase tracking-widest text-black/60 mb-1">Deliver to</p>
              <p className="text-base font-bold text-black leading-tight">{d.name || '—'}</p>
              {d.line1 && <p className="text-xs text-black leading-snug">{d.line1}</p>}
              {d.line2 && <p className="text-xs text-black leading-snug">{d.line2}</p>}
              {cityLine && <p className="text-xs text-black leading-snug">{cityLine}</p>}
              {d.state && <p className="text-xs text-black leading-snug">{d.state}</p>}
              {d.pincode && <p className="text-sm font-bold text-black mt-0.5">PIN {d.pincode}</p>}
              {d.phone && <p className="text-xs text-black mt-1">Ph: {d.phone}</p>}
            </div>

            {label.from && (
              <div className="px-3 py-2 border-b-2 border-black">
                <p className="text-[9px] font-bold uppercase tracking-widest text-black/60">From</p>
                <p className="text-[11px] text-black">
                  {[label.from.name, label.from.city, label.from.state, label.from.pincode].filter(Boolean).join(', ')}
                </p>
              </div>
            )}

            <div className="px-3 py-2 border-b-2 border-black">
              <p className="text-[9px] font-bold uppercase tracking-widest text-black/60 mb-1">Contents</p>
              {label.items.map((i) => (
                <div key={i.productId} className="flex justify-between text-[11px] text-black">
                  <span className="truncate pr-2">{i.productName}</span>
                  <span className="font-bold shrink-0">x{i.qty}</span>
                </div>
              ))}
              {(label.weightKg || label.dims) && (
                <p className="text-[10px] text-black/60 mt-1">
                  {[label.weightKg ? `${label.weightKg} kg` : null, label.dims].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>

            {/* THE SCANNABLE PART. Rendered with the same JsBarcode CODE128
                SVG and QR components the company shipping label uses, so it
                prints as a real barcode rather than the number as text.

                The barcode is present BEFORE dispatch too. The manager prints
                this, sticks it on the carton and then dispatches — so the
                number is minted when the label is first opened, kept on the
                draft box, and saved unchanged at dispatch. It is not written to
                the database until then, so backing out still leaves nothing
                behind; the number is simply never used. */}
            <div className="px-3 py-3 text-center">
              <div className="flex justify-center mb-2">
                <QrCode value={label.barcode} size={130} />
              </div>
              <Suspense fallback={<div className="h-12" />}>
                <Barcode128 value={label.barcode} height={52} className="w-full" />
              </Suspense>
              <p className="text-sm font-mono font-bold tracking-widest text-black mt-1 break-all">
                {label.packageNumber}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ───────── Seller order processing: Scan → Select → Box → Dispatch ───────── */

/**
 * ONE CONTINUOUS PROCESS for a seller customer order.
 *
 * Scan → tick the units → Add to Box → label → Dispatch, all in this modal.
 * There is no separate Pick, Pack or Dispatch screen to visit.
 *
 * NOTHING IS SAVED BY SCANNING. A scan only asks the server "what is this label
 * worth?" — it writes no stock and records no pick. The scanned units live in
 * this component's state and nowhere else, so closing the modal discards them
 * and they must be scanned again. Stock is committed only when Add to Box is
 * pressed, which is the moment the server records the pick for exactly those
 * units and mints the parcel.
 */
const OrderProcessModal = ({ shipment: initial, onClose, onDone }) => {
  const [shipment, setShipment] = useState(initial);
  // Units scanned but NOT yet boxed. Ephemeral by design — see above.
  const [pending, setPending] = useState([]); // [{ token, code, label, type, productId, productName }]
  const [checked, setChecked] = useState(() => new Set());
  const [products, setProducts] = useState(initial.products || []);
  // DRAFT boxes. Held here and nowhere else — no Package row exists until
  // Dispatch, so closing the popup discards them with nothing to clean up.
  const [boxes, setBoxes] = useState([]); // [{ id, tokens, units, label }]
  const [history, setHistory] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState(null);
  const [showLabel, setShowLabel] = useState(false);
  // Final labels, available only after dispatch — these carry the real barcode.
  const [finalLabels, setFinalLabels] = useState([]);
  const [dispatchedAt, setDispatchedAt] = useState(null);

  const dispatched = ['dispatched', 'in_transit', 'arrived', 'verifying', 'delivered'].includes(shipment.status);

  useEffect(() => {
    getSellerScanState(shipment._id)
      .then((r) => { if (r?.data?.products) setProducts(r.data.products); })
      .catch(() => { /* fall back to the row's own figures */ });
  }, [shipment._id]);

  const allComplete = products.length > 0 && products.every((p) => p.complete);
  // Everything scanned has been boxed, and nothing is still outstanding.
  const readyToDispatch = allComplete && boxes.length > 0 && pending.length === 0;
  // Every carton needs its own printed label — one label for a three-box order
  // would leave two cartons unlabelled.
  const allLabelled = boxes.length > 0 && boxes.every((b) => b.labelPrinted);

  const onScan = async (code) => {
    const value = String(code || '').trim();
    if (!value || scanning) return;
    setScanning(true);
    try {
      // `selectedTokens` includes what is already pending, so the server can
      // refuse a duplicate and cap the remaining quantity correctly.
      const known = pending.map((u) => u.token);
      const r = await scanSellerShipment(shipment._id, { code: value, selectedTokens: known });
      const d = r?.data;
      if (!d) { toast('error', 'Could not read that label'); return; }
      // One row per UNIT the scan contributed, so a scanned carton can still be
      // split across two parcels.
      const added = (d.addedTokens || []).map((tok) => ({
        token: tok,
        code: tok.startsWith('unit:') ? tok.slice(5) : d.label,
        type: d.scanType,
        source: d.label,
        productId: d.productId,
        productName: d.productName,
        qty: tok.startsWith('lot:') ? d.addedQuantity : 1,
      }));
      setPending((prev) => [...prev, ...added]);
      // Newly scanned units start ticked — the common case is boxing what you
      // just scanned, and un-ticking is easier than ticking twenty rows.
      setChecked((prev) => { const n = new Set(prev); added.forEach((u) => n.add(u.token)); return n; });
      setProducts(d.products || []);
      setHistory((h) => [{ key: `${value}-${Date.now()}`, code: d.label || value, type: d.scanType, product: d.productName, qty: d.addedQuantity, ok: true }, ...h]);
      toast('success', `${SCAN_TYPE_LABEL[d.scanType] || 'Label'} accepted · ${d.productName} +${d.addedQuantity}`);
    } catch (e) {
      const msg = e?.response?.data?.message || e.message || 'That label could not be used';
      setHistory((h) => [{ key: `${value}-${Date.now()}`, code: value, ok: false, error: msg }, ...h]);
      toast('error', msg);
    } finally { setScanning(false); }
  };

  const toggle = (token) => setChecked((prev) => {
    const n = new Set(prev);
    if (n.has(token)) n.delete(token); else n.add(token);
    return n;
  });
  const toggleAll = () => setChecked((prev) =>
    prev.size === pending.length ? new Set() : new Set(pending.map((u) => u.token)));

  const selected = pending.filter((u) => checked.has(u.token));
  const selectedUnits = selected.reduce((n, u) => n + (u.qty || 1), 0);

  // ADD TO BOX — entirely local. No API call, nothing written. The box exists
  // only in this component until Dispatch commits the whole operation.
  const addToBox = () => {
    if (!selected.length) return;
    const box = {
      id: `draft-${Date.now()}-${boxes.length + 1}`,
      tokens: selected.map((u) => u.token),
      units: selected.map((u) => ({ code: u.code, productName: u.productName, qty: u.qty || 1 })),
      // Set the first time this box's label is opened, and kept thereafter — the
      // number printed on the carton is the number saved at dispatch.
      packageNumber: null,
      labelPrinted: false,
    };
    setBoxes((prev) => [...prev, box]);
    const used = new Set(box.tokens);
    setPending((prev) => prev.filter((u) => !used.has(u.token)));
    setChecked(new Set());
    toast('success', `Box ${boxes.length + 1} prepared — dispatch to confirm`);
  };

  /** Undo a draft box: its units go back to the scanned list. */
  const removeBox = (id) => {
    const box = boxes.find((b) => b.id === id);
    if (!box) return;
    setBoxes((prev) => prev.filter((b) => b.id !== id));
    setPending((prev) => [...prev, ...box.units.map((u, i) => ({
      token: box.tokens[i], code: u.code, productName: u.productName, qty: u.qty,
    }))]);
    toast('success', 'Box removed — units returned to the list');
  };

  // Renders a label from the draft box's contents. Saves nothing — the parcel's
  // real barcode is minted at dispatch, so this preview has none.
  // Renders this box's label. The barcode is real and printable: the number is
  // minted here but SAVED NOWHERE until dispatch, and the box keeps it so
  // re-opening shows the same barcode that is already on the carton.
  const openLabel = async (box) => {
    const idx = boxes.findIndex((b) => b.id === box.id);
    try {
      const r = await previewSellerBoxLabel(shipment._id, {
        tokens: box.tokens,
        boxNumber: idx + 1,
        boxCount: boxes.length,
        packageNumber: box.packageNumber || undefined,
      });
      if (!r?.data) { toast('error', 'Could not build the delivery label'); return; }
      setBoxes((prev) => prev.map((b) => (b.id === box.id
        ? { ...b, packageNumber: r.data.packageNumber, labelPrinted: true }
        : b)));
      setLabel(r.data);
      setShowLabel(true);
    } catch (e) {
      toast('error', e?.response?.data?.message || e.message || 'Could not build the delivery label');
    }
  };

  // THE ONLY WRITE. Sends every draft box; the server validates, picks, packs,
  // creates the real parcels and dispatches — all or nothing.
  const dispatchNow = async () => {
    setBusy(true);
    try {
      const r = await dispatchSellerOrder(shipment._id, {
        boxes: boxes.map((b) => ({ tokens: b.tokens, packageNumber: b.packageNumber || undefined })),
      });
      toast('success', 'Dispatched — on its way to the customer');
      // The parcels are real now, so their labels finally carry a scannable
      // barcode. Show them for printing INSTEAD of closing — closing here would
      // send the manager back to a list where the row has already gone, with no
      // way to print the label they are about to stick on the carton.
      const finals = r?.labels || [];
      if (finals.length) {
        setFinalLabels(finals);
        setLabel(finals[0]);
        setShowLabel(true);
        setDispatchedAt(new Date());
      } else {
        onDone();
      }
    } catch (e) {
      toast('error', e?.response?.data?.message || e.message || 'Could not dispatch');
    } finally { setBusy(false); }
  };

  // Closing with unboxed scans throws them away — say so rather than letting the
  // manager assume the work was saved.
  // Closing throws away EVERYTHING — scans and draft boxes alike. None of it was
  // ever saved, so there is nothing to clean up; the manager simply starts again.
  const close = async () => {
    if (dispatchedAt) { onDone(); return; }
    if (pending.length || boxes.length) {
      const bits = [];
      if (pending.length) bits.push(`${pending.length} scanned unit(s)`);
      if (boxes.length) bits.push(`${boxes.length} prepared box(es)`);
      const { isConfirmed } = await Swal.fire({
        title: 'Discard this pick?',
        text: `${bits.join(' and ')} will be discarded. Nothing has been saved — you will need to scan everything again.`,
        icon: 'warning', showCancelButton: true,
        confirmButtonColor: '#EA2831', confirmButtonText: 'Discard & close', cancelButtonText: 'Keep working',
      });
      if (!isConfirmed) return;
    }
    onClose();
  };

  const order = shipment.order;
  const addr = addressText(order?.address);
  const title = order?.customerName ? `${orderRef(order) || 'Order'} → ${order.customerName}` : `Send → ${shipment.toLabel}`;

  return (
    <Modal title={title} onClose={close}>
      {order && (
        <div className="rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2.5 mb-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {orderRef(order) && <span className="text-[10px] font-mono font-bold text-stone-700 bg-white border border-stone-200 rounded px-1.5 py-0.5">{orderRef(order)}</span>}
            <span className="text-xs font-bold text-stone-800">{order.customerName || '—'}</span>
            {order.address?.phone && <span className="text-[11px] text-stone-500">· {order.address.phone}</span>}
          </div>
          {addr && <p className="text-[11px] text-stone-500 mt-1">{addr}</p>}
        </div>
      )}

      {/* PROGRESS — per product, straight from the server. */}
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Products</p>
      <div className="border border-stone-200 rounded-xl overflow-hidden mb-3">
        <table className="w-full text-left text-sm">
          <thead><tr className="bg-stone-50 text-[10px] uppercase text-stone-400">
            <th className="px-3 py-2 font-bold">Product</th>
            <th className="px-3 py-2 font-bold text-center">Req</th>
            <th className="px-3 py-2 font-bold text-center">Done</th>
            <th className="px-3 py-2 font-bold text-center">Left</th>
            <th className="px-3 py-2 font-bold text-right">Status</th>
          </tr></thead>
          <tbody className="divide-y divide-stone-100">
            {products.map((p) => (
              <tr key={p.productId} className={p.complete ? 'bg-green-50/40' : undefined}>
                <td className="px-3 py-1.5 text-xs font-semibold text-stone-800">{p.productName}</td>
                <td className="px-3 py-1.5 text-center text-xs font-bold text-stone-700">{p.requestedQty}</td>
                <td className="px-3 py-1.5 text-center text-xs font-bold text-stone-900">{p.scannedQty}</td>
                <td className={`px-3 py-1.5 text-center text-xs font-bold ${p.remainingQty ? 'text-[#EA2831]' : 'text-green-600'}`}>{p.remainingQty}</td>
                <td className="px-3 py-1.5 text-right">
                  <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${p.complete ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                    {p.complete ? 'Complete' : 'Pending'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!dispatched && !dispatchedAt && !allComplete && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Scan a label</p>
          <ScanBox onScan={onScan} placeholder="Scan a lot, bulk package, box or unit label" autoFocus disabled={scanning} />
          <p className="text-[11px] text-stone-400 mt-1">
            Scanning saves nothing yet — units are recorded when you add them to a box.
          </p>
        </>
      )}

      {/* SCANNED UNITS — tick the ones going into the next box. */}
      {pending.length > 0 && !dispatchedAt && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
              Scanned units · not yet boxed ({pending.length})
            </p>
            <button onClick={toggleAll} className="text-[11px] font-bold text-[#EA2831] hover:underline">
              {checked.size === pending.length ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div className="border border-stone-200 rounded-xl overflow-hidden max-h-52 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-stone-100">
                {pending.map((u) => (
                  <tr key={u.token} className={checked.has(u.token) ? 'bg-red-50/30' : undefined}>
                    <td className="pl-3 py-1.5 w-8">
                      <input type="checkbox" className="accent-[#EA2831] w-4 h-4"
                        checked={checked.has(u.token)} onChange={() => toggle(u.token)} />
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="block text-xs font-mono font-bold text-stone-800">{u.code}</span>
                      <span className="text-[10px] text-stone-400">
                        {u.productName}
                        {u.source && u.source !== u.code ? ` · from ${SCAN_TYPE_LABEL[u.type] || u.type} ${u.source}` : ''}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-xs font-bold text-stone-700">{u.qty > 1 ? `x${u.qty}` : '1'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ADD TO BOX — appears as soon as anything is ticked. */}
          {selected.length > 0 && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-[#EA2831]/30 bg-red-50/40 px-3 py-2">
              <span className="text-[11px] font-bold text-stone-700">
                {selected.length} selected · {selectedUnits} unit(s)
              </span>
              <PrimaryBtn disabled={busy} onClick={addToBox}>
                <span className="material-symbols-outlined text-base">inventory_2</span>
                {busy ? 'Creating…' : `Add to Box ${boxes.length + 1}`}
              </PrimaryBtn>
            </div>
          )}
        </div>
      )}

      {/* DRAFT BOXES. Not saved — they exist only until Dispatch. */}
      {boxes.length > 0 && !dispatchedAt && (
        <div className="mt-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">
            Boxes ({boxes.length}) · not saved until dispatch
          </p>
          <div className="border border-stone-200 rounded-xl divide-y divide-stone-100">
            {boxes.map((b, i) => (
              <div key={b.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <span className="block text-xs font-bold text-stone-800">
                    Box {i + 1}
                    {b.labelPrinted && <span className="ml-1 text-[10px] font-bold text-green-600">✓ labelled</span>}
                  </span>
                  <span className="text-[10px] text-stone-400">
                    {b.units.reduce((n, u) => n + (u.qty || 1), 0)} unit(s) ·{' '}
                    {new Set(b.units.map((u) => u.productName)).size} product(s)
                  </span>
                  {/* The barcode actually printed on this carton. */}
                  {b.packageNumber && (
                    <span className="block text-[10px] font-mono text-stone-500">{b.packageNumber}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <GhostBtn onClick={() => openLabel(b)}>
                    <span className="material-symbols-outlined text-sm">local_shipping</span>
                    {b.labelPrinted ? 'Re-print' : 'Label'}
                  </GhostBtn>
                  <button onClick={() => removeBox(b.id)}
                    className="text-[11px] font-bold text-stone-400 hover:text-[#EA2831] px-2">
                    Undo
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-3 max-h-32 overflow-y-auto border border-stone-100 rounded-xl divide-y divide-stone-100">
          {history.map((h) => (
            <div key={h.key} className="flex items-start gap-2 px-3 py-1.5">
              <span className={`material-symbols-outlined text-[15px] shrink-0 ${h.ok ? 'text-green-600' : 'text-[#EA2831]'}`}>
                {h.ok ? 'check_circle' : 'error'}
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-[11px] font-mono font-bold text-stone-700">{h.code}</span>
                {h.ok
                  ? <span className="text-[11px] text-stone-500"> · {SCAN_TYPE_LABEL[h.type] || h.type} · {h.product} +{h.qty}</span>
                  : <p className="text-[11px] text-[#EA2831]">{h.error}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* DISPATCHED — the parcels exist, so their real labels can be printed. */}
      {dispatchedAt && (
        <div className="mt-3 rounded-xl border border-green-200 bg-green-50/60 px-3 py-2.5">
          <p className="text-xs font-bold text-green-700 mb-1.5">
            Dispatched · {finalLabels.length} label(s) ready to print
          </p>
          <div className="flex flex-wrap gap-1.5">
            {finalLabels.map((l, i) => (
              <GhostBtn key={l.packageId || i} onClick={() => { setLabel(l); setShowLabel(true); }}>
                <span className="material-symbols-outlined text-sm">print</span>
                Box {i + 1} · {l.packageNumber}
              </GhostBtn>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4">
        {dispatchedAt ? (
          <PrimaryBtn onClick={onDone}>Done</PrimaryBtn>
        ) : (
          <>
            <GhostBtn onClick={close}>Close</GhostBtn>
            <PrimaryBtn disabled={!readyToDispatch || !allLabelled || busy} onClick={dispatchNow}>
              <span className="material-symbols-outlined text-base">local_shipping</span>
              {busy ? 'Dispatching…' : 'Dispatch'}
            </PrimaryBtn>
          </>
        )}
      </div>
      {!readyToDispatch && !dispatchedAt && (
        <p className="text-[11px] text-stone-400 text-right mt-1">
          {pending.length ? 'Add the scanned units to a box first.'
            : !allComplete ? 'Scan and box every requested product to dispatch.'
              : 'Create a box to dispatch.'}
        </p>
      )}
      {readyToDispatch && !allLabelled && !dispatchedAt && (
        <p className="text-[11px] text-stone-400 text-right mt-1">
          Print the label for every box to enable dispatch.
        </p>
      )}

      {showLabel && label && <DeliveryLabelModal label={label} onClose={() => setShowLabel(false)} />}
    </Modal>
  );
};

/* ───────── Shipment Tracking & Transfers ───────── */
const ShipmentsTab = ({ shipments, requests, canWrite, canActOn, onLabel, onReceive, onAccept, onReject, onNewRequest, onNewTransfer, onBoxLabels }) => {
  const [sub, setSub] = useState('shipments');
  // Search over the requests list, mirroring the company Requests tab.
  const [q, setQ] = useState('');
  // The decider for a request: pull → the HOLDER (from); push → the DESTINATION (to).
  const deciderWh = (r) => (r.mode === 'pull' ? r.fromWarehouseId : r.toWarehouseId);

  // Case-insensitive search across the transfer ref, product and both
  // warehouses, so a row can be found by the SH-… seen in the Transfers table.
  // Read-only over what the API already returned — it alters nothing stored.
  const needle = q.trim().toLowerCase();
  const visibleRequests = needle
    ? requests.filter((r) =>
      [r.transferRef, r.productId?.productName, r.fromWarehouseId?.name, r.toWarehouseId?.name]
        .some((f) => (f || '').toLowerCase().includes(needle)))
    : requests;

  return (
    <div>
      {/* UNDERLINE TABS, as on the company Transfers screen: the two lists are
          peers, and the pill toggle read like a filter on one list. */}
      <div className="flex gap-1 border-b border-stone-200 mb-4 overflow-x-auto">
        {[['shipments', 'All Transfers'], ['requests', 'Requests']].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSub(k)}
            className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px whitespace-nowrap transition-colors ${
              sub === k ? 'border-[#EA2831] text-[#EA2831]' : 'border-transparent text-stone-400 hover:text-stone-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* PER-TAB TOOLBAR. Each list gets the action that belongs to it, rather
          than both actions sitting above both lists: Transfer pushes stock out
          (All Transfers), Request Stock asks for it (Requests). */}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
          {sub === 'requests' ? `${visibleRequests.length} request(s)` : `${shipments.length} transfer(s)`}
        </p>
        <div className="flex items-center gap-3">
          {sub === 'requests' && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search ref (SH-…), product or warehouse…"
              className="w-56 sm:w-72 border border-stone-200 rounded-lg text-sm px-3 py-2 bg-white focus:ring-[#EA2831]"
            />
          )}
          {canWrite && sub === 'requests' && (
            /* PULL — ask another of your warehouses to send you stock. */
            <PrimaryBtn onClick={onNewRequest}>
              <span className="material-symbols-outlined text-base">move_down</span> Request Stock
            </PrimaryBtn>
          )}
          {canWrite && sub === 'shipments' && (
            /* PUSH — send stock from your warehouse, no request needed. */
            <PrimaryBtn onClick={onNewTransfer}>
              <span className="material-symbols-outlined text-base">local_shipping</span> New Transfer
            </PrimaryBtn>
          )}
        </div>
      </div>

      {sub === 'shipments' ? (
        /* THE TRANSFERS TABLE, laid out exactly like the company one
           (pages/Company/ims/ImsTransport.jsx): fixed table-layout with a
           colgroup proportioning every column to the full page width, so nothing
           scrolls horizontally on desktop and long warehouse names wrap instead
           of forcing a min-width. Below lg the shared `resp-table` CSS collapses
           each row into a labelled card, which is what the `data-label`
           attributes are for. Same Th component, same paddings, same badges. */
        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <table className="w-full text-left border-collapse table-fixed resp-table">
            <colgroup>
              <col style={{ width: '13%' }} />{/* Shipment Ref. */}
              <col style={{ width: '14%' }} />{/* From */}
              <col style={{ width: '15%' }} />{/* To */}
              <col style={{ width: '9%' }} />{/* Type */}
              <col style={{ width: '15%' }} />{/* Challan */}
              <col style={{ width: '10%' }} />{/* Status */}
              <col style={{ width: '10%' }} />{/* Dispatched */}
              <col style={{ width: '14%' }} />{/* Actions */}
            </colgroup>
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200">
                <Th pad="px-3">Shipment Ref.</Th>
                <Th pad="px-3">From</Th>
                <Th pad="px-3">To</Th>
                <Th pad="px-3">Type</Th>
                <Th pad="px-3">Challan</Th>
                <Th pad="px-3">Status</Th>
                <Th pad="px-3">Dispatched</Th>
                <Th pad="px-3" right>Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {shipments.length === 0 ? <tr><td colSpan={8} className="px-3 py-12 text-center text-sm text-stone-400">No transfers yet.</td></tr>
                : shipments.map((s) => (
                  <tr key={s._id} className="hover:bg-stone-50/40">
                    {/* The reference the backend derives (shipmentService.shipmentRef)
                        — never rebuilt here, so a row can be matched against the
                        SH-… seen anywhere else. */}
                    <td className="px-3 py-4 align-top" data-label="Shipment Ref.">
                      <span className="text-xs font-bold font-mono bg-stone-100 text-stone-700 px-2.5 py-1 rounded-full whitespace-nowrap">
                        {s.ref || `SH-${String(s._id).slice(-6).toUpperCase()}`}
                      </span>
                      <span className="block mt-1 text-[10px] font-bold uppercase tracking-wide text-stone-400">
                        {isWarehouseTransfer(s) ? 'Warehouse Transfer' : 'Customer Order'}
                      </span>
                    </td>
                    {/* fromName/toName are resolved server-side from the warehouse
                        RELATIONS (shipmentService.shipmentRoute), never from the
                        *Label strings, which carry flow text like
                        "Warehouse (transfer)". */}
                    <td className="px-3 py-4 text-sm text-stone-600 align-top" data-label="From">
                      <span className="block break-words line-clamp-2" title={s.fromName || s.fromLabel || ''}>{s.fromName || s.fromLabel || '—'}</span>
                    </td>
                    <td className="px-3 py-4 text-sm font-bold text-stone-900 align-top" data-label="To">
                      <span className="block break-words line-clamp-2" title={s.toName || s.toLabel || ''}>{s.toName || s.toLabel || '—'}</span>
                      {canActOn(s.fromWarehouseId) && (
                        <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-600">Outgoing</span>
                      )}
                    </td>
                    <td className="px-3 py-4 text-xs text-stone-500 align-top" data-label="Type">
                      <span className="block break-words">{movementKind({ toType: s.toType, refType: s.refType })}</span>
                    </td>
                    {/* DELIVERY CHALLAN — the number captured when the transfer
                        was raised, and a link that opens the stored document
                        (image or PDF) in a new tab. `challanDocumentUrl` is
                        resolved server-side from the stored key on every read, so
                        it is never a stale or guessed path.

                        THE EMPTY STATE IS EXPLICIT. A transfer raised without
                        paperwork — every one raised before this existed — shows a
                        dash and renders normally; a number with no document, or a
                        document with no number, each render on their own. */}
                    <td className="px-3 py-4 text-xs text-stone-500 align-top" data-label="Challan">
                      {s.deliveryChallanNumber || s.challanDocumentUrl ? (
                        <div className="leading-tight">
                          {s.deliveryChallanNumber && (
                            <div className="font-semibold text-stone-700 break-words" title={s.deliveryChallanNumber}>{s.deliveryChallanNumber}</div>
                          )}
                          {s.challanDocumentUrl ? (
                            <a
                              href={fileHref(s.challanDocumentUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 font-bold text-[#EA2831] hover:underline"
                              title={s.challanDocument?.name || 'Delivery challan'}
                            >
                              <span className="material-symbols-outlined text-sm">description</span> View
                            </a>
                          ) : (
                            <span className="text-stone-300">No document</span>
                          )}
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-4 align-top" data-label="Status">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full capitalize ${SHIP_STATUS_STYLE[s.status] || 'bg-stone-100 text-stone-500'}`}>{(s.status || '').replace(/_/g, ' ')}</span>
                    </td>
                    <td className="px-3 py-4 text-xs text-stone-500 align-top" data-label="Dispatched">{s.dispatchedAt ? fmtDate(s.dispatchedAt) : '—'}</td>
                    <td className="px-3 py-4 cell-actions align-top">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {s.qrToken && canActOn(s.fromWarehouseId) && (
                          <GhostBtn onClick={() => onLabel(s)}>
                            <span className="material-symbols-outlined text-sm">qr_code_2</span> Shipping Label
                          </GhostBtn>
                        )}
                        {/* BOX LABELS — a SENDING-SIDE control for a dispatched
                            warehouse transfer, so a torn or lost sticker can
                            always be reprinted. Never shown for a customer
                            order, which carries a delivery label instead. */}
                        {isWarehouseTransfer(s) && s.dispatchedAt && canActOn(s.fromWarehouseId) && (
                          <GhostBtn onClick={() => onBoxLabels(s)}>
                            <span className="material-symbols-outlined text-sm">inventory_2</span> Box Labels
                          </GhostBtn>
                        )}
                        {canWrite && DISPATCHABLE.includes(s.status) && canActOn(s.fromWarehouseId) && <span className="text-[11px] text-stone-400">Fulfil in Send Stock</span>}
                        {canWrite && RECEIVABLE.includes(s.status) && canActOn(s.toWarehouseId) && (
                          <GhostBtn onClick={() => onReceive(s)} className="border-[#EA2831]/40 text-[#EA2831]">Receive Lot</GhostBtn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* THE REQUESTS TABLE, laid out like the company one: same eight columns,
           same paddings, same ref pill, same status chip and the same
           acknowledgment line in Actions once a decision has been made. Only the
           DATA is seller-side — seller warehouses, the seller's own accept /
           reject calls, and the push/pull distinction the company flow does not
           have. */
        <div className="border border-stone-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[920px] resp-table">
            <thead>
              <tr className="text-[10px] uppercase text-stone-400 bg-stone-50">
                <Th>Product</Th>
                <Th right>Qty</Th>
                <Th>From (source)</Th>
                <Th>For (requester)</Th>
                <Th>Transfer Ref.</Th>
                <Th>Status</Th>
                <Th>Requested</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {visibleRequests.map((r) => {
                const isPull = r.mode === 'pull';
                const canDecide = canActOn(deciderWh(r));
                return (
                  <tr key={r._id} className="hover:bg-stone-50/40">
                    {/* PUSH vs PULL has no company equivalent, so rather than add
                        a ninth column it sits under the product name — the row
                        still reads at a glance who is waiting on whom. */}
                    <td className="px-4 py-3 text-sm font-bold" data-label="Product">
                      {r.productId?.productName || '—'}
                      <span className={`block mt-0.5 text-[10px] font-bold ${isPull ? 'text-violet-600' : 'text-blue-600'}`}>
                        {isPull ? 'Request (pull)' : 'Transfer (push)'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right" data-label="Qty">{r.qty}</td>
                    <td className="px-4 py-3 text-sm" data-label="From (source)">{r.fromWarehouseId?.name || '—'}</td>
                    <td className="px-4 py-3 text-sm" data-label="For (requester)">
                      {r.toWarehouseId?.name || '—'}
                      {r.requestedBy?.name ? <span className="text-xs text-stone-400"> · {r.requestedBy.name}</span> : null}
                    </td>
                    {/* The reference of the shipment this request created — the
                        exact SH-… shown in the Transfers table (server-supplied
                        `transferRef`, never rebuilt here). "Not created" until a
                        shipment exists; a request has at most one, so no +N case. */}
                    <td className="px-4 py-3" data-label="Transfer Ref.">
                      {r.transferRef
                        ? <span className="text-xs font-bold font-mono bg-stone-100 text-stone-700 px-2.5 py-1 rounded-full whitespace-nowrap">{r.transferRef}</span>
                        : <span className="text-xs text-stone-400">Not created</span>}
                    </td>
                    <td className="px-4 py-3" data-label="Status">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${REQ_STATUS_STYLE[r.status] || 'bg-stone-100 text-stone-500'}`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-400" data-label="Requested">{fmtDate(r.createdAt)}</td>
                    <td className="px-4 py-3 cell-actions">
                      <div className="flex items-center justify-end gap-2">
                        {/* UNCHANGED RULE: the decider is the stock HOLDER —
                            pull → source, push → destination. Same handlers, same
                            capability check; only the buttons' styling now
                            matches the company table. */}
                        {r.status === 'requested' && canDecide && (
                          canWrite ? (
                            <>
                              <GhostBtn onClick={() => onAccept(r)}>Accept</GhostBtn>
                              <GhostBtn onClick={() => onReject(r)}>Reject</GhostBtn>
                            </>
                          ) : (
                            <span className="text-[11px] font-bold text-stone-400">Awaiting {isPull ? 'holding warehouse' : 'destination'}</span>
                          )
                        )}
                        {r.status === 'requested' && !canDecide && (
                          <span className="text-[11px] font-bold text-stone-400">Awaiting {isPull ? 'holding warehouse' : 'destination'}</span>
                        )}
                        {r.status === 'accepted' && (
                          <span className="text-[11px] font-bold text-green-600">
                            ✓ Accepted{r.decidedBy?.name ? ` by ${r.decidedBy.name}` : ''}{r.shipmentId ? ' · shipment created' : ''}
                          </span>
                        )}
                        {r.status === 'fulfilled' && (
                          <span className="text-[11px] font-bold text-blue-600">✓ Delivered &amp; received</span>
                        )}
                        {r.status === 'rejected' && (
                          <span className="text-[11px] font-bold text-red-600">✕ Rejected</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleRequests.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-sm text-stone-400">
                    {needle
                      ? `No request matches “${q.trim()}”.`
                      : 'No stock requests yet. Use "Request Stock" to ask another of your warehouses for inventory.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/* ───────── Traceability ───────── */
const TraceTab = () => {
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = (value) => {
    const q = String(value ?? code).trim();
    if (!q) return;
    setLoading(true);
    // Try lot first (the common case); fall back to a unit serial.
    sellerTraceLot(q)
      .then((r) => setResult({ kind: 'lot', data: r?.data }))
      .catch(() => sellerTraceUnit(q).then((r) => setResult({ kind: 'unit', data: r?.data })).catch((e) => { apiErr(e); setResult(null); }))
      .finally(() => setLoading(false));
  };

  return (
    <div className="space-y-5">
      <div className="bg-stone-50 border border-stone-200 rounded-xl p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-2">Scan or enter a lot number / unit serial</p>
        <ScanBox onScan={(c) => { setCode(c); run(c); }} placeholder="Scan a unit / lot, or type then Enter" />
      </div>
      {loading && <p className="text-sm text-stone-400">Tracing…</p>}
      {result?.kind === 'lot' && <LotTrace data={result.data} />}
      {result?.kind === 'unit' && <UnitTrace data={result.data} />}
    </div>
  );
};

const LotTrace = ({ data }) => (
  <div className="space-y-4">
    <h3 className="text-base font-bold text-stone-900">Lot {data.lotNumber}</h3>
    <div className="bg-white border border-stone-200 rounded-2xl overflow-x-auto">
      <table className="w-full text-left text-sm min-w-[520px] resp-table">
        <thead><tr className="bg-stone-50 text-[10px] uppercase text-stone-400">{['Product', 'Warehouse', 'Qty'].map((h) => <th key={h} className="px-4 py-2 font-bold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-stone-100">
          {data.stock.map((s) => (
            <tr key={s._id}><td className="px-4 py-2 text-stone-700">{s.productId?.productName || '—'}</td><td className="px-4 py-2 text-stone-600">{s.warehouseId?.name || 'Unassigned'}</td><td className="px-4 py-2 font-bold text-stone-900">{s.availableStock}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Movement ledger ({data.movements.length})</p>
    <div className="bg-white border border-stone-200 rounded-2xl overflow-x-auto">
      <table className="w-full text-left text-sm min-w-[520px] resp-table">
        <thead><tr className="bg-stone-50 text-[10px] uppercase text-stone-400">{['When', 'Type', 'Qty', 'Balance'].map((h) => <th key={h} className="px-4 py-2 font-bold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-stone-100">
          {data.movements.map((m) => (
            <tr key={m._id}><td className="px-4 py-2 text-stone-500 text-xs">{fmtDate(m.createdAt)}</td><td className="px-4 py-2 text-stone-700">{m.type}</td><td className={`px-4 py-2 font-bold ${m.quantity < 0 ? 'text-red-600' : 'text-green-600'}`}>{m.quantity}</td><td className="px-4 py-2 text-stone-600">{m.balanceAfter}</td></tr>
          ))}
          {data.movements.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-stone-400 text-xs">No movements.</td></tr>}
        </tbody>
      </table>
    </div>
  </div>
);

const UnitTrace = ({ data }) => (
  <div className="space-y-4">
    <h3 className="text-base font-bold text-stone-900">Unit {data.unit?.serial}</h3>
    <p className="text-sm text-stone-600">{data.unit?.productId?.productName || '—'} · status <b className="capitalize">{data.unit?.status}</b></p>
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Journey ({(data.events || []).length})</p>
    <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100">
      {(data.events || []).map((e) => (
        <div key={e._id} className="flex items-center justify-between px-4 py-2.5 text-sm">
          <span className="text-stone-700">{e.event} <span className="text-stone-400">({e.fromStatus} → {e.toStatus})</span></span>
          <span className="text-xs text-stone-400">{fmtDate(e.at)}</span>
        </div>
      ))}
      {(data.events || []).length === 0 && <p className="px-4 py-6 text-center text-stone-400 text-xs">No events.</p>}
    </div>
  </div>
);

/* ───────── shared bits ───────── */
const Section = ({ title, empty, children }) => {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">{title}</p>
      <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100">
        {items.length ? items : <p className="px-5 py-8 text-center text-sm text-stone-400">{empty}</p>}
      </div>
    </div>
  );
};
const Row = ({ title, sub, status, statusStyle, action }) => (
  <div className="flex items-center gap-3 px-5 py-3.5">
    <div className="min-w-0 flex-1">
      <p className="text-sm font-bold text-stone-800 truncate">{title}</p>
      <p className="text-[11px] text-stone-400">{sub}</p>
    </div>
    {status && <span className={`shrink-0 text-[10px] font-bold rounded-full px-2.5 py-1 capitalize ${statusStyle[status] || 'bg-stone-100 text-stone-500'}`}>{(status || '').replace(/_/g, ' ')}</span>}
    {action}
  </div>
);
const ScanBtn = ({ onClick }) => (
  <button onClick={onClick} className="shrink-0 inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-[#EA2831] text-white hover:bg-red-600">
    <span className="material-symbols-outlined text-sm">qr_code_scanner</span> Scan to receive
  </button>
);

// Scan-to-receive: works for a transfer shipment (receiveSellerShipment) or a
// supply order (receiveSellerSupply). The manifest QR is mandatory.
const ScanReceiveModal = ({ target, onClose, onDone }) => {
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const isSupply = target.kind === 'supply';
  const expectedPrefix = isSupply ? (target.item.shipmentId?._id ? `${target.item.shipmentId._id}.` : '') : `${target.item._id}.`;
  const scanned = !!qr.trim();
  const looksRight = scanned && (!expectedPrefix || qr.trim().startsWith(expectedPrefix));

  const run = async () => {
    setBusy(true);
    try {
      if (isSupply) await receiveSellerSupply(target.item._id, { qr: qr.trim() });
      else await receiveSellerShipment(target.item._id, { qr: qr.trim() });
      toast('success', 'Received & verified — stock updated');
      onDone();
    } catch (e) { apiErr(e); } finally { setBusy(false); }
  };

  return (
    <Modal title="Scan to receive" onClose={onClose}>
      <p className="text-xs text-stone-500 mb-3">Scan the manifest barcode/QR on the shipment label (camera or wedge scanner) — or paste it. The system verifies it before receiving.</p>
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Scan the shipping label</p>
      <ScanBox onScan={(c) => setQr(c)} placeholder="Scan or paste the manifest code" autoFocus />
      {scanned && <p className={`mt-2 text-[11px] font-mono break-all ${looksRight ? 'text-green-600' : 'text-red-600'}`}>{looksRight ? '✓' : '✕'} {qr.trim()}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn disabled={!scanned || busy} onClick={run}>{busy ? 'Receiving…' : 'Verify & receive'}</PrimaryBtn>
      </div>
    </Modal>
  );
};

/**
 * NEW TRANSFER — direct, no prior request.
 *
 * The seller mirror of the company "New Transfer" form
 * (pages/Company/ims/ImsTransport.jsx): pick a source and destination
 * warehouse, add product rows with quantities, and the server FEFO-splits each
 * product across that warehouse's lots and raises a PLANNED shipment. Nothing
 * is reserved or deducted here — the transfer is then processed from Send Stock
 * exactly like an accepted request: scan → box → label → dispatch, then the
 * destination receives it.
 *
 * TWO DELIBERATE DIFFERENCES FROM THE COMPANY FORM, both because the seller
 * backend already defines the contract and is not being changed:
 *   • No delivery-challan upload. The company route takes a multipart challan;
 *     POST /api/seller/transfers/direct takes JSON { fromWarehouseId,
 *     toWarehouseId, items[], note } and has no challan field.
 *   • Source is a DROPDOWN, not read-only text. A seller_admin has no single
 *     "own" warehouse, so they choose; a warehouse-scoped manager only sees the
 *     warehouse(s) they run, and the server re-checks that scope regardless.
 *
 * ONE OPTION PER PRODUCT, never one per lot — the same rule the company form
 * uses. The dispatcher scans what physically leaves, and the scan decides the
 * lot, so listing four lots of one product would only ask them to choose
 * between numbers they have no reason to pick between.
 */
const DirectTransferModal = ({ warehouses, onClose, onDone }) => {
  const [accountWh, setAccountWh] = useState([]); // every warehouse on the account
  const [f, setF] = useState({ fromWarehouseId: '', toWarehouseId: '', challanNumber: '', note: '' });
  // The delivery challan scan. `challanUrl` is an object URL used ONLY to
  // preview a picked image; a PDF has no preview and renders as a file row.
  // Revoked on unmount and on every re-pick so nothing leaks.
  const [challan, setChallan] = useState(null);
  const [challanUrl, setChallanUrl] = useState(null);
  const challanRef = useRef(null);
  const [rows, setRows] = useState([{ productId: '', qty: '' }]);
  const [stock, setStock] = useState([]); // products at the source warehouse
  const [loadingStock, setLoadingStock] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  // Destinations: any warehouse on the seller account. Sources: only the ones
  // this user may send FROM (already scoped by the caller).
  useEffect(() => {
    let alive = true;
    getSellerTransferWarehouses()
      .then((r) => { if (alive) setAccountWh(r?.data || []); })
      .catch(() => { if (alive) setAccountWh([]); });
    return () => { alive = false; };
  }, []);

  // Products held at the chosen source. Re-fetched whenever the source changes,
  // and the rows reset because last warehouse's products no longer apply.
  useEffect(() => {
    setRows([{ productId: '', qty: '' }]);
    setStock([]);
    if (!f.fromWarehouseId) return;
    let alive = true;
    setLoadingStock(true);
    getSellerTransferStock(f.fromWarehouseId)
      .then((r) => { if (alive) setStock(r?.data || []); })
      .catch(() => { if (alive) setStock([]); })
      .finally(() => { if (alive) setLoadingStock(false); });
    return () => { alive = false; };
  }, [f.fromWarehouseId]);

  /* ── CHALLAN FILE HANDLING ──
     Both an IMAGE and a PDF are accepted. Anything else is refused here with a
     message rather than being sent and rejected later. */
  const pickChallan = (file) => {
    setChallanUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return file && isImageFile(file) ? URL.createObjectURL(file) : null; });
    setChallan(file);
    setErrors((e) => (e.challanDocument ? { ...e, challanDocument: undefined } : e));
  };
  const clearChallan = () => {
    pickChallan(null);
    // Clearing the INPUT too is what lets the same file be picked again — a
    // bare state reset leaves the input's value in place and the next identical
    // pick fires no change event at all.
    if (challanRef.current) challanRef.current.value = '';
  };
  const onChallanChange = (ev) => {
    const file = ev.target.files?.[0] || null;
    if (file && !isImageFile(file) && !isPdfFile(file)) {
      toast('error', 'Attach an image or a PDF');
      if (challanRef.current) challanRef.current.value = '';
      return;
    }
    pickChallan(file);
  };
  useEffect(() => () => { if (challanUrl) URL.revokeObjectURL(challanUrl); }, [challanUrl]);

  const optionFor = (productId) => stock.find((p) => String(p.productId) === String(productId));
  const updateRow = (i, patch) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  /** An untouched row is ignored, not an error — "+ Add product" leaves one. */
  const isBlankRow = (r) => !r.productId && !String(r.qty).trim();

  /**
   * What is wrong with this row, or null. Quantity is a whole number of at
   * least 1 and may not exceed the product's available stock at the source —
   * the very "(avail N)" figure its own dropdown shows, so the rule and the
   * number the operator reads can never disagree. Read live, so it also decides
   * whether Create Transfer is clickable.
   */
  const rowError = (r) => {
    if (isBlankRow(r)) return null;
    if (!r.productId) return 'Select a product';
    const raw = String(r.qty).trim();
    if (!raw) return 'Enter a quantity';
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) return 'Quantity must be a whole number of 1 or more';
    const avail = optionFor(r.productId)?.availableQty ?? 0;
    if (n > avail) return `Only ${fmtNum(avail)} available at this warehouse`;
    return null;
  };
  // A product may only appear once — two rows of the same product would double
  // its quantity against one availability figure.
  const duplicateIds = (() => {
    const seen = new Set(); const dupes = new Set();
    rows.filter((r) => r.productId).forEach((r) => {
      if (seen.has(r.productId)) dupes.add(r.productId); else seen.add(r.productId);
    });
    return dupes;
  })();

  const filledRows = rows.filter((r) => !isBlankRow(r));
  const rowsReady = filledRows.length > 0
    && filledRows.every((r) => !rowError(r))
    && duplicateIds.size === 0;

  const submit = async () => {
    // Collect every problem at once rather than one at a time.
    const e = {};
    if (!f.fromWarehouseId) e.fromWarehouseId = 'Select the source warehouse';
    if (!f.toWarehouseId) e.toWarehouseId = 'Select a destination warehouse';
    else if (String(f.toWarehouseId) === String(f.fromWarehouseId)) {
      e.toWarehouseId = 'Source and destination must be different';
    }
    if (!filledRows.length) e.rows = 'Add a product and a quantity';
    else if (duplicateIds.size) e.rows = 'The same product is listed twice';
    else if (!rowsReady) e.rows = 'Fix the highlighted product rows';
    setErrors(e);
    if (Object.keys(e).length) { toast('error', 'Please fill all required fields'); return; }

    setBusy(true);
    try {
      // MULTIPART, because the challan document travels with the fields — the
      // same shape the company New Transfer form posts. Every value goes over
      // as a string, so `items` is serialised and the server parses it back.
      //
      // PRODUCT AND QUANTITY ONLY on those items. The server splits each across
      // that product's lots at the source, earliest expiry first, and writes one
      // line per lot. It reserves and deducts nothing — that happens at dispatch.
      const fd = new FormData();
      fd.append('fromWarehouseId', f.fromWarehouseId);
      fd.append('toWarehouseId', f.toWarehouseId);
      fd.append('items', JSON.stringify(filledRows.map((x) => ({ productId: x.productId, qty: Number(x.qty) }))));
      if (f.challanNumber.trim()) fd.append('challanNumber', f.challanNumber.trim());
      if (f.note.trim()) fd.append('note', f.note.trim());
      // The FILE ITSELF, not its name — the server stores the bytes and keeps
      // only the storage key, so the document stays openable afterwards.
      if (challan) fd.append('challanDocument', challan, challan.name);
      const r = await directSellerTransfer(fd);
      toast('success', r?.message || 'Transfer created — process it from Send Stock');
      onDone();
    } catch (err) {
      toast('error', err?.response?.data?.message || err.message || 'Could not create the transfer');
    } finally { setBusy(false); }
  };

  const errText = (msg) => (msg ? <p className="text-xs font-medium text-[#EA2831] mt-1">⚠ {msg}</p> : null);

  return (
    <Modal title="New Transfer" onClose={onClose} wide>
      <p className="text-xs text-stone-500 mb-3">
        Send stock from one of your warehouses to another. This plans the shipment — scan, box and
        dispatch it from Send Stock, then the destination receives it.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="From warehouse *">
          <select className={inputCls} value={f.fromWarehouseId}
            onChange={(e) => { setF({ ...f, fromWarehouseId: e.target.value }); setErrors({}); }}>
            <option value="">Select source…</option>
            {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
          </select>
          {errText(errors.fromWarehouseId)}
        </Field>
        <Field label="To warehouse *">
          <select className={inputCls} value={f.toWarehouseId}
            onChange={(e) => { setF({ ...f, toWarehouseId: e.target.value }); setErrors({}); }}>
            <option value="">Select destination…</option>
            {accountWh
              .filter((w) => String(w._id) !== String(f.fromWarehouseId))
              .map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
          </select>
          {errText(errors.toWarehouseId)}
        </Field>
      </div>

      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mt-2 mb-1">Products</p>
      {!f.fromWarehouseId && <p className="text-xs text-stone-400 mb-2">Choose the source warehouse first.</p>}
      {f.fromWarehouseId && loadingStock && <p className="text-xs text-stone-400 mb-2">Loading stock…</p>}
      {f.fromWarehouseId && !loadingStock && stock.length === 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
          This warehouse has no stock available to transfer.
        </p>
      )}

     {f.fromWarehouseId && stock.length > 0 && (
  <div className="space-y-2">
    {rows.map((r, i) => {
      const err = rowError(r);
      const dup = r.productId && duplicateIds.has(r.productId);
      return (
        <div key={i}>
          <div className="flex items-center gap-2">
            
            {/* 🛠️ 1. Product Select Box (Flex-1 + w-full: Baaki bachi saari width lega) */}
          <div className="flex-1 min-w-0">
  <CustomProductSelect
    stock={stock}
    value={r.productId}
    onChange={(newId) => updateRow(i, { productId: newId })}
    fmtNum={fmtNum}
    inputCls={inputCls}
  />
</div>

            {/* 🛠️ 2. Quantity Input (w-20 + shrink-0: Fixed width, kabhi flex glitch nahi karega) */}
            <div className="w-20 shrink-0">
              <input 
                type="number" 
                min="1" 
                placeholder="Qty" 
                className={`${inputCls} w-full text-center px-1`}
                value={r.qty} 
                onChange={(e) => updateRow(i, { qty: e.target.value })} 
              />
            </div>

            {/* 3. Delete Row Button */}
            {rows.length > 1 && (
              <GhostBtn onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>✕</GhostBtn>
            )}
          </div>
          
          {errText(dup ? 'This product is already listed above' : err)}
        </div>
      );
    })}
    <GhostBtn onClick={() => setRows((rs) => [...rs, { productId: '', qty: '' }])}>+ Add product</GhostBtn>
  </div>
)}
      {errText(errors.rows)}

      {/* DELIVERY CHALLAN — the number printed on the document, and the
          document itself. Both OPTIONAL: a transfer raised without paperwork
          still works exactly as it did before. The company form makes them
          mandatory; that rule is not copied here because it would break every
          existing seller transfer habit overnight. */}
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mt-3 mb-1">Delivery challan</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Challan Number">
          <input
            className={inputCls}
            value={f.challanNumber}
            onChange={(e) => setF({ ...f, challanNumber: e.target.value })}
            placeholder="As printed on the challan"
          />
        </Field>
        <Field label="Challan Document">
          {challan ? (
            <ChallanPreview file={challan} previewUrl={challanUrl} onRemove={clearChallan} />
          ) : (
            <label className={`${inputCls} flex cursor-pointer items-center gap-2 text-stone-400 hover:bg-stone-50`}>
              <span className="material-symbols-outlined text-base">upload_file</span>
              Choose an image or PDF…
              {/* BOTH kinds are accepted. `accept` narrows the file picker;
                  onChallanChange re-checks, because accept is a hint a user can
                  bypass. */}
              <input
                type="file"
                ref={challanRef}
                accept="image/*,application/pdf,.pdf"
                className="hidden"
                onChange={onChallanChange}
              />
            </label>
          )}
          {errText(errors.challanDocument)}
        </Field>
      </div>

      <Field label="Note (optional)">
        <input className={inputCls} value={f.note}
          onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Reason or reference" />
      </Field>

      <div className="mt-3 flex justify-end gap-2">
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn disabled={busy || !rowsReady || !f.toWarehouseId} onClick={submit}>
          <span className="material-symbols-outlined text-base">local_shipping</span>
          {busy ? 'Creating…' : 'Create Transfer'}
        </PrimaryBtn>
      </div>
    </Modal>
  );
};

/* ── Dropdown Helper Component ── */
function CustomProductSelect({ stock, value, onChange, fmtNum, inputCls }) {
  const [open, setOpen] = React.useState(false);
  const selectedProduct = stock.find((p) => String(p.productId) === String(value));

  return (
    <div className="relative w-full">
      {/* Trigger Box */}
      <div
        onClick={() => setOpen(!open)}
        className={`${inputCls} w-full flex items-center justify-between cursor-pointer rounded-xl border border-stone-200 bg-white py-2 px-3 text-sm transition-all hover:border-stone-300`}
      >
        <span className={selectedProduct ? "text-stone-900 font-semibold truncate" : "text-stone-400"}>
          {selectedProduct ? selectedProduct.productName : "Select product…"}
        </span>
        <span className={`material-symbols-outlined text-[20px] text-stone-400 transition-transform ${open ? "rotate-180" : ""}`}>
          expand_more
        </span>
      </div>

      {/* Modern Popup List */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-xl py-1">
            {stock.length === 0 ? (
              <div className="px-3 py-2 text-xs text-stone-400">No stock available</div>
            ) : (
              stock.map((p) => (
                <div
                  key={p.productId}
                  onClick={() => {
                    onChange(p.productId);
                    setOpen(false);
                  }}
                  className={`flex items-center justify-between px-3 py-2 text-xs sm:text-sm cursor-pointer transition-colors ${
                    String(p.productId) === String(value)
                      ? "bg-red-50 text-[#EA2831] font-bold"
                      : "text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  <span className="truncate pr-2">{p.productName}</span>
                  <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-stone-500">
                    Avail: {fmtNum(p.availableQty)}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}



// PULL: "I ask another of my warehouses to send me stock." To = my warehouse
// (the receiver), From = the holder I'm requesting from, Product = what the
// holder has in stock. Creates a pull TransferRequest (holder accepts/dispatches,
// I receive).
const NewRequestModal = ({ warehouses, onClose, onDone }) => {
  const [f, setF] = useState({ toWarehouseId: '', fromWarehouseId: '', productId: '', qty: '', note: '' });
  const [stock, setStock] = useState(null);
  const [loadingStock, setLoadingStock] = useState(false);
  const [accountWh, setAccountWh] = useState(null);
  const [busy, setBusy] = useState(false);
  const u = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));

  // To = my warehouse(s) (manager → assigned; admin → all). From = ANY other
  // seller warehouse (the holder), minus my chosen destination.
  const toOptions = warehouses;
  const fromOptions = (accountWh || []).filter((w) => String(w._id) !== String(f.toWarehouseId));
  const enoughWarehouses = accountWh === null ? true : accountWh.length >= 2;
  const selectedProduct = (stock || []).find((p) => String(p.productId) === String(f.productId));

  useEffect(() => {
    let alive = true;
    getSellerTransferWarehouses().then((r) => { if (alive) setAccountWh(r?.data || []); }).catch(() => { if (alive) setAccountWh([]); });
    return () => { alive = false; };
  }, []);

  // Products the HOLDER warehouse currently has in stock (forRequest reads
  // another of your warehouses, bypassing your own manager scope).
  useEffect(() => {
    if (!f.fromWarehouseId) { setStock(null); return undefined; }
    let alive = true;
    setLoadingStock(true);
    setF((prev) => ({ ...prev, productId: '' }));
    getSellerTransferStock(f.fromWarehouseId, { forRequest: 1 })
      .then((r) => { if (alive) setStock(r?.data || []); })
      .catch((e) => { if (alive) { setStock([]); apiErr(e); } })
      .finally(() => { if (alive) setLoadingStock(false); });
    return () => { alive = false; };
  }, [f.fromWarehouseId]);

  const submit = async () => {
    if (!f.toWarehouseId || !f.fromWarehouseId || !f.productId || !f.qty) { toast('error', 'Pick your warehouse, the holder, a product and a quantity'); return; }
    setBusy(true);
    try {
      await createSellerTransfer({ fromWarehouseId: f.fromWarehouseId, toWarehouseId: f.toWarehouseId, productId: f.productId, qty: Number(f.qty), note: f.note, mode: 'pull' });
      toast('success', 'Request sent');
      onDone();
    } catch (e) { apiErr(e); } finally { setBusy(false); }
  };

  if (!enoughWarehouses) {
    return (
      <Modal title="New request" onClose={onClose}>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
          <span className="material-symbols-outlined text-amber-500 text-3xl">warehouse</span>
          <p className="text-sm font-bold text-amber-800 mt-1">You need at least 2 warehouses</p>
          <p className="text-xs text-amber-700 mt-0.5">Add another warehouse to request stock between them.</p>
        </div>
        <div className="mt-4 flex justify-end"><GhostBtn onClick={onClose}>Close</GhostBtn></div>
      </Modal>
    );
  }

  return (
    <Modal title="New request" onClose={onClose}>
      <p className="text-xs text-stone-500 mb-3">Ask another of your warehouses to send you stock. The holding warehouse accepts &amp; dispatches; you receive.</p>
      <Field label="To warehouse (mine) *">
        <select className={inputCls} value={f.toWarehouseId} onChange={u('toWarehouseId')}>
          <option value="">Select your warehouse…</option>
          {toOptions.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
        </select>
      </Field>
      <Field label="From warehouse (holder) *">
        <select className={inputCls} value={f.fromWarehouseId} onChange={u('fromWarehouseId')} disabled={!f.toWarehouseId}>
          <option value="">{f.toWarehouseId ? 'Select the warehouse to request from…' : 'Pick your warehouse first'}</option>
          {fromOptions.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
        </select>
      </Field>
      <Field label="Product *">
        <select className={inputCls} value={f.productId} onChange={u('productId')} disabled={!f.fromWarehouseId || loadingStock || !(stock && stock.length)}>
          <option value="">
            {!f.fromWarehouseId ? 'Pick a holding warehouse first'
              : loadingStock ? 'Loading stock…'
              : stock && stock.length === 0 ? 'That warehouse has no stock to send'
              : 'Select product…'}
          </option>
          {(stock || []).map((p) => (
            <option key={p.productId} value={p.productId}>
              {p.productName}{p.skuNumber ? ` · ${p.skuNumber}` : ''} — {p.availableQty} in stock
            </option>
          ))}
        </select>
        {f.fromWarehouseId && stock && stock.length === 0 && !loadingStock && (
          <p className="text-[11px] text-amber-600 mt-1">That warehouse has no stock to send.</p>
        )}
      </Field>
      <Field label={`Quantity *${selectedProduct ? ` (max ${selectedProduct.availableQty})` : ''}`}>
        <input type="number" min="1" max={selectedProduct?.availableQty || undefined} className={inputCls} value={f.qty} onChange={u('qty')} />
      </Field>
      <Field label="Note"><input className={inputCls} value={f.note} onChange={u('note')} placeholder="Optional" /></Field>
      <PrimaryBtn disabled={busy || !f.productId} onClick={submit}>{busy ? 'Sending…' : 'Send request'}</PrimaryBtn>
    </Modal>
  );
};

// Label-gated dispatch for a transfer shipment — mirrors the company supply
export default SellerOperations;