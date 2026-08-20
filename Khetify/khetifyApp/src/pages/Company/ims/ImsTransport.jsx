import React, { useEffect, useMemo, useRef, useState } from 'react';
import Swal from 'sweetalert2';
import {
  getTmsShipments, createTmsShipment, approveShipment, dispatchShipment, deliverShipment, getDiscrepancies,
  getVehicles, createVehicle, getDrivers, createDriver, getWarehouses, getWarehouseDirectory, getLots, getProducts, fmtDate,
  getTransferRequests, createTransferRequest, acceptTransferRequest, rejectTransferRequest,
  getDispatchChecklist, dispatchScan, getShipmentBoxes, packRepackBox, discardRepackBox,
} from '../../../lib/imsApi';
// The contents view behind every repack box ID — one component, shared by every
// screen that shows one.
import RepackBoxView from '../../../Components/ims/RepackBoxView';
// The repack cartons packed for one shipment, reachable from the Shipments
// table after the scan-out dialog has closed. It opens the same RepackBoxView.
import RepackBoxesModal from '../../../Components/ims/RepackBoxesModal';
import { usePermission } from '../../../context/PermissionContext';
import { WAREHOUSE_ROLES } from '../../../lib/roles';
import { Modal, Field, inputCls, PrimaryBtn, GhostBtn, Th } from './ImsUi';
import { ManifestModal, ReceiveModal } from '../../../Components/ims/TransferModals';
// Shipment Box labels for a Company Warehouse → Seller transfer that packed
// individually scanned units into cartons. The SAME component the transfer page
// prints from — nothing is duplicated here.
import ShipmentBoxLabelsModal from '../../../Components/ims/ShipmentBoxLabel';
// The Pick dialog's body, rendered as-is by the dispatch scan dialog so the two
// screens cannot drift apart. See DispatchScanModal below.
import { PickBody } from './ImsOutbound';
import { movementKind } from '../../../lib/movementLabel';
// Stored files come back as a signed absolute URL (S3) or a served /uploads
// path (local); this resolves either into something a link can open.
import { fileHref } from '../../../lib/fileHref';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);

const STATUS_STYLES = {
  draft: 'bg-stone-100 text-stone-500', planned: 'bg-blue-50 text-blue-600', approved: 'bg-indigo-50 text-indigo-600', in_transit: 'bg-orange-50 text-orange-600',
  arrived: 'bg-amber-50 text-amber-600', verifying: 'bg-amber-50 text-amber-600', delivered: 'bg-green-50 text-green-600',
  partially_received: 'bg-amber-50 text-amber-700', received: 'bg-green-50 text-green-600',
  exception: 'bg-red-50 text-red-700', cancelled: 'bg-stone-100 text-stone-400', pending: 'bg-stone-100 text-stone-500',
};

const getPos = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve({});
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => resolve({}), { timeout: 5000 }
  );
});

// Fleet admin (Vehicles / Drivers) and Exceptions are centrally managed, so
// neither the MAIN COMPANY nor the COMPANY WAREHOUSE gets those tabs — both see
// the shipment views only. Every other role keeps the full set. Nothing is
// removed globally: the tab components, routes and APIs are untouched.
// [key, label] — the key drives the tab state and must stay "shipments"; only
// the label the operator reads has changed.
const ALL_TABS = [
  ['shipments', 'All Transfers'], ['requests', 'Requests'],
  ['vehicles', 'Vehicles'], ['drivers', 'Drivers'], ['exceptions', 'Exceptions'],
];
const SHIPMENT_TABS = ['shipments', 'requests'];

const ImsTransport = () => {
  const { role } = usePermission();
  const restricted = role === 'company_admin' || WAREHOUSE_ROLES.has(role);
  const tabs = restricted ? ALL_TABS.filter(([k]) => SHIPMENT_TABS.includes(k)) : ALL_TABS;

  const [tab, setTab] = useState('shipments');
  // Never render a tab this role can't see (e.g. state left over from a role
  // switch) — fall back to the first allowed one.
  const active = tabs.some(([k]) => k === tab) ? tab : tabs[0][0];

  /* NO HORIZONTAL PADDING OF ITS OWN on wide screens.

     The Operations shell around this tab already supplies the page gutter (and
     drops its max-width for Transfers), so repeating it here just took another
     32px off every row for nothing. Vertical padding and the phone gutter stay.
     The table's own card keeps its border and rounding, so losing the padding
     does not make anything look edge-welded. */
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:px-0 sm:py-6 bg-white font-sora">
      <div className="w-full max-w-none space-y-6">
        <div className="flex items-center gap-1 border-b border-stone-200">
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px ${active === k ? 'border-[#EA2831] text-[#EA2831]' : 'border-transparent text-stone-400 hover:text-stone-700'}`}>{l}</button>
          ))}
        </div>
        {active === 'shipments' && <ShipmentsTab />}
        {active === 'requests' && <RequestsTab />}
        {active === 'vehicles' && <VehiclesTab />}
        {active === 'drivers' && <DriversTab />}
        {active === 'exceptions' && <ExceptionsTab />}
      </div>
    </div>
  );
};

/* ───────────── Shipments ───────────── */
/**
 * Which business flow raised this shipment — a small hint under the reference,
 * read from the shipment's OWN refType/toType (already on the payload). Purely
 * additive context; the Type column keeps showing Transfer/Sales as before.
 */
/**
 * Could this consignment carry Shipment Boxes?
 *
 * `boxCount` comes from the shipments API. When it is a number we trust it
 * exactly. When it is MISSING — an older backend, or a box-count lookup that
 * failed — we fall back to the shipment's own shape: a Company Warehouse →
 * Seller transfer is the only flow that packs cartons, so the button is offered
 * there and the fetch itself reports if there are none. Without this fallback a
 * single missing field silently hides every box label.
 */
const mayHaveBoxes = (s) =>
  typeof s.boxCount === 'number'
    ? s.boxCount > 0
    : (s.refType === 'SupplyOrder' && s.toType === 'seller');

const sourceLabelOf = (s) => {
  if (s.refType === 'TransferRequest' || s.refType === 'Transfer') return 'Warehouse Transfer';
  if (s.refType === 'SupplyOrder') return s.toType === 'seller' ? 'Seller Supply' : 'Supply Request';
  if (s.toType === 'seller') return 'Seller Supply';
  return null;
};

const ShipmentsTab = () => {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [manifestInfo, setManifestInfo] = useState(null);
  // { boxes, seller, ref } — the Shipment Box label sheet currently open.
  const [boxLabels, setBoxLabels] = useState(null);
  const [verify, setVerify] = useState(null);
  // The warehouse transfer currently being scanned out, if any.
  const [dispatchScanFor, setDispatchScanFor] = useState(null);
  // The shipment whose repack cartons are being listed, if any.
  const [boxesFor, setBoxesFor] = useState(null);
  const [view, setView] = useState('all'); // all | incoming
  // Warehouse-level access: the backend already scopes this list to the
  // user's assigned warehouses; warehouseIds drives the Incoming filter.
  const { warehouseIds, can, role } = usePermission();
  const isMainCompany = role === 'company_admin';
  const isWarehouse = WAREHOUSE_ROLES.has(role);
  // company_admin is denied inventory:transfer (view-only on transfers), so the
  // transfer-initiation controls (warehouse New Shipment, dispatching a
  // transfer) are hidden from them; operations managers keep them.
  const canTransfer = can('inventory:transfer');
  const refresh = () => getTmsShipments().then((r) => setRows(listOf(r))).catch(apiError);
  useEffect(() => { refresh(); }, []);

  /**
   * IS THIS ROW MINE TO RECEIVE?
   *
   * "partially_received" belongs in this list. It used to be a TERMINAL state —
   * the shipping label received a transfer in one go, and the status only read
   * "partially" when the lines came up short, with no way to take any more. Now
   * that cartons are scanned in one at a time it is a MID-FLIGHT state, and
   * leaving it out emptied the Actions column the moment the first box landed:
   * the row still said "partially_received" while offering nothing to finish it,
   * so the rest of the transfer could not be received at all.
   *
   * The rule is simply: still receivable until nothing is left in transit, which
   * is exactly when the server flips it to "received".
   */
  const isIncoming = (s) =>
    s.toType === 'warehouse' &&
    ['in_transit', 'arrived', 'verifying', 'partially_received'].includes(s.status) &&
    (!warehouseIds?.length || warehouseIds.includes(String(s.toWarehouseId?._id || s.toWarehouseId)));
  // direction checks: only the SOURCE side approves/dispatches, only the
  // DESTINATION side receives (admin/unscoped users pass both).
  const isMyOutgoing = (s) =>
    !warehouseIds?.length || !s.fromWarehouseId || warehouseIds.includes(String(s.fromWarehouseId?._id || s.fromWarehouseId));

  // A warehouse-scoped user (Yogesh/Indore, Karan/Bhopal) needs to know which
  // way a shipment is moving relative to THEIR warehouse — "To: Bhopal" alone
  // doesn't tell Karan it's arriving. The main Company is unscoped, so it reads
  // From → To and gets no badge. Compared by ID, never by name.
  const mine = (warehouseIds || []).map(String);
  const scoped = mine.length > 0;
  const directionOf = (s) => {
    if (!scoped) return null;
    if (mine.includes(String(s.fromWarehouseId?._id || s.fromWarehouseId))) return 'Outgoing';
    if (mine.includes(String(s.toWarehouseId?._id || s.toWarehouseId))) return 'Incoming';
    return null;
  };

  // The direction FILTERS count by direction alone. isIncoming() above stays as
  // the Receive Lot action gate — it also demands a receivable status
  // (in_transit/arrived/verifying), which is exactly why the old count read
  // "Incoming Transfers (0)" while incoming rows sat on screen.
  const incomingRows = isWarehouse ? rows.filter((s) => directionOf(s) === 'Incoming') : rows.filter(isIncoming);
  const outgoingRows = rows.filter((s) => directionOf(s) === 'Outgoing');
  const views = isMainCompany
    ? [['all', `All (${rows.length})`]]
    : isWarehouse
      ? [['all', `All (${rows.length})`], ['incoming', `Incoming Transfers (${incomingRows.length})`], ['outgoing', `Outgoing Transfers (${outgoingRows.length})`]]
      : [['all', `All (${rows.length})`], ['incoming', `Incoming Transfers (${incomingRows.length})`]];
  // Guards the data too, not just the buttons — a view a role can't select can
  // never filter its table.
  const inView = isMainCompany ? rows
    : view === 'incoming' ? incomingRows
      : view === 'outgoing' && isWarehouse ? outgoingRows
        : rows;

  // Search runs AFTER the direction views, so incoming/outgoing filtering and
  // its counts are untouched — it only narrows what the chosen view already
  // holds. Case-insensitive on a copy; the stored reference is never altered.
  // Client-side by design: `ref` is derived from _id, so the server cannot index
  // or regex it without a materialised column.
  const needle = q.trim().toLowerCase();
  const visible = needle
    ? inView.filter((s) =>
        [s.ref, s.fromName, s.toName, s.vehicleId?.regNo, s.vehicleNo]
          .some((f) => (f || '').toLowerCase().includes(needle)))
    : inView;

  const doApprove = async (s) => {
    try { await approveShipment(s._id); toast('success', 'Shipment approved'); refresh(); } catch (err) { apiError(err); }
  };
  const doDispatch = async (s) => {
    try { const r = await dispatchShipment(s._id, await getPos()); setManifestInfo(r?.data || r); refresh(); } catch (err) { apiError(err); }
  };
  // A WAREHOUSE→WAREHOUSE transfer is scanned out before it leaves — the same
  // verification a seller supply already gets from its pick step. Every other
  // shipment type dispatches exactly as before.
  const isWarehouseTransfer = (s) => s.toType === 'warehouse' && !!(s.toWarehouseId?._id || s.toWarehouseId);
  const onDispatchClick = (s) => (isWarehouseTransfer(s) ? setDispatchScanFor(s) : doDispatch(s));
  // Labels are fetched on demand: the list only carries a count, so a table of
  // 500 shipments never pulls every carton's contents.
  const openBoxLabels = async (s) => {
    try {
      const r = await getShipmentBoxes(s._id);
      const boxes = listOf(r);
      if (!boxes.length) {
        return toast('info', 'This consignment has no shipment boxes — its units travel under the shipping label or their own Bulk Packaging labels.');
      }
      setBoxLabels({ boxes, seller: s.toName || s.toLabel || '', ref: s.ref });
    } catch (err) { apiError(err); }
  };

  /**
   * MAY THIS SHIPMENT'S REPACK CARTONS STILL BE BROKEN OPEN?
   *
   * Only while the goods are still on the shelf — the same states Dispatch is
   * offered in, gated to the same people. Once dispatched the box has left the
   * warehouse, so the list opens read-only (View + Print). The server refuses a
   * late unpack as well; this only keeps the button honest.
   */
  const canUnpackBoxes = (s) =>
    ['draft', 'planned', 'approved', 'loading'].includes(s.status)
    && isMyOutgoing(s)
    && (s.refType !== 'Transfer' || canTransfer);
  const doDeliver = async (s) => {
    const { value: signedBy } = await Swal.fire({ title: 'Mark delivered', input: 'text', inputLabel: 'Received by (name)', showCancelButton: true });
    if (!signedBy) return;
    try { await deliverShipment(s._id, { signedBy, ...(await getPos()) }); toast('success', 'Delivered'); refresh(); } catch (err) { apiError(err); }
  };

  return (
    <>
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Direction views answer "what is MY warehouse sending / receiving?" —
              meaningless for the unscoped main Company (it owns every
              warehouse), so it only shows the All view. */}
          {views.map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${view === k ? 'bg-[#EA2831] border-[#EA2831] text-white' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search ref (SH-…), warehouse or vehicle…"
            className="w-56 sm:w-72 border border-stone-200 rounded-lg text-sm px-3 py-2 bg-white focus:ring-[#EA2831]"
          />
          {/* Shipments are raised by the warehouse that physically ships — the main
              Company's view is read-only oversight. Other roles keep the button. */}
          {!isMainCompany && (
            <PrimaryBtn onClick={() => setShowNew(true)}><span className="material-symbols-outlined text-base">local_shipping</span> New Transfer</PrimaryBtn>
          )}
        </div>
      </div>
      {/* NO MIN-WIDTH — the table fits the page instead of scrolling.

          `table-fixed` plus the colgroup percentages below already make every
          column share whatever width the page has, which is exactly what stops
          a horizontal scrollbar. A floor width was tried to keep the extra
          columns roomy, but that FORCED the scroll it was meant to avoid: the
          table simply refused to be narrower than 1440px even when the screen
          was. Long values wrap (line-clamp on Product / From / To) rather than
          pushing the table wider.

          overflow-x-auto is kept as a safety net for a genuinely tiny desktop
          window — with no min-width there is normally nothing to scroll, and a
          hidden overflow would silently CLIP the Actions column instead.
          Below lg the resp-table CSS collapses rows into cards and ignores
          these widths entirely, so mobile is unaffected. */}
      <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-x-auto">
        <table className="w-full text-left border-collapse table-fixed resp-table">
          <colgroup>
            {/* Widths must match the VISIBLE columns. Vehicle and Driver stay
                hidden, and the Challan column takes a share of what they freed. */}
            {/* Rebalanced for the no-scroll layout: the columns that only ever
                hold a short code or a chip give their slack to Actions, which is
                the one cell that can hold four buttons and would otherwise wrap
                them onto three lines and make every row tall. Totals 100%. */}
            <col style={{ width: '10%' }} />{/* Shipment Ref. */}
            <col style={{ width: '8%' }} />{/* Seller Request No. */}
            <col style={{ width: '14%' }} />{/* Product Name */}
            <col style={{ width: '6%' }} />{/* Type */}
            {/* Vehicle and Driver columns are hidden:
                <col style={{ width: '10%' }} />
                <col style={{ width: '13%' }} /> */}
            <col style={{ width: '11%' }} />{/* Challan */}
            <col style={{ width: '11%' }} />{/* Bilty Number */}
            <col style={{ width: '11%' }} />{/* Bill */}
            <col style={{ width: '7%' }} />{/* Status */}
            <col style={{ width: '7%' }} />{/* Dispatched */}
            <col style={{ width: '15%' }} />{/* Actions */}
          </colgroup>
          <thead><tr className="bg-stone-50 border-b border-stone-200"><Th pad="px-3">Shipment Ref.</Th><Th pad="px-3">Seller Request No.</Th><Th pad="px-3">Product Name</Th><Th pad="px-3">Type</Th>{/* Vehicle & Driver temporarily hidden — the data is still stored on the shipment and returned by the API. */}{/* <Th pad="px-3">Vehicle</Th><Th pad="px-3">Driver</Th> */}<Th pad="px-3">Challan</Th><Th pad="px-3">Bilty Number</Th><Th pad="px-3">Bill</Th><Th pad="px-3">Status</Th><Th pad="px-3">Dispatched</Th><Th pad="px-3" right>Actions</Th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {visible.map((s) => {
              const dir = directionOf(s);
              // Driver name/phone are stored on the shipment at creation
              // (driverName / driverPhone); fall back to a linked Driver record
              // if the backend returns one instead. Commented out alongside the
              // hidden Driver column — restore both together.
              // const driverName = s.driverName || s.driver?.name || s.driverId?.userId?.name || s.driverId?.name || s.manifest?.driverName || '';
              // const driverPhone = s.driverPhone || s.driver?.phone || s.driverId?.phone || s.driverId?.userId?.phone || s.manifest?.driverPhone || '';
              return (
              <tr key={s._id} className="hover:bg-stone-50/40">
                {/* The reference the backend derives (shipmentService.shipmentRef)
                    — the SAME value Transfer History and Supply Requests show, so
                    an operator can match a row across all three. Never rebuilt
                    here. Shown in full, no truncation. */}
                <td className="px-3 py-4 align-top" data-label="Shipment Ref.">
                  <span className="text-xs font-bold font-mono bg-stone-100 text-stone-700 px-2.5 py-1 rounded-full whitespace-nowrap">
                    {s.ref || '—'}
                  </span>
                  {sourceLabelOf(s) && (
                    <span className="block mt-1 text-[10px] font-bold uppercase tracking-wide text-stone-400">
                      {sourceLabelOf(s)}
                    </span>
                  )}
                </td>
                {/* The SELLER REQUEST this shipment fulfils — the same SR-… the
                    Send Stock list shows. Resolved server-side (`requestRef`);
                    a shipment with no supply request simply shows a dash. */}
                <td className="px-3 py-4 align-top" data-label="Seller Request No.">
                  <span className="text-xs font-mono text-stone-600 whitespace-nowrap">
                    {s.requestRef || '—'}
                  </span>
                </td>
                {/* PRODUCT NAME — what is actually being moved. Resolved
                    server-side from the shipment's own lines (`productNames`),
                    so it is the real product record and never a label string.
                    A transfer of several lots of one product names it once; a
                    multi-product transfer lists each.

                    The Incoming/Outgoing chip lived on the old "To" cell and is
                    kept here, so removing that column does not also remove the
                    only indication of which way a row is going. */}
                <td className="px-3 py-4 text-sm font-bold text-stone-900 align-top" data-label="Product Name">
                  <span className="block break-words line-clamp-2" title={(s.productNames || []).join(', ')}>
                    {(s.productNames || []).length ? s.productNames.join(', ') : '—'}
                  </span>
                  {dir && (
                    <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      dir === 'Outgoing' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-700'
                    }`}>{dir}</span>
                  )}
                </td>
                <td className="px-3 py-4 text-xs text-stone-500 align-top" data-label="Type"><span className="block break-words">{movementKind(s)}</span></td>
                {/* VEHICLE & DRIVER — temporarily hidden from this table. The
                    values are still captured at dispatch, stored on the shipment
                    and returned by the API (and `driverName`/`driverPhone` are
                    still resolved above), so un-commenting restores them with no
                    other change.
                <td className="px-3 py-4 text-xs text-stone-500 align-top" data-label="Vehicle"><span className="block truncate" title={s.vehicleId?.regNo || s.vehicleNo || ''}>{s.vehicleId?.regNo || s.vehicleNo || '—'}</span></td>
                <td className="px-3 py-4 text-xs text-stone-500 align-top" data-label="Driver">
                  {driverName || driverPhone ? (
                    <div className="leading-tight">
                      {driverName && <div className="font-semibold text-stone-700 break-words">{driverName}</div>}
                      {driverPhone && <div className="text-stone-400 break-words">{driverPhone}</div>}
                    </div>
                  ) : '—'}
                </td>
                */}
                {/* DELIVERY CHALLAN — the number captured when the shipment was
                    raised, and a link that opens the stored scan in a new tab.
                    challanDocumentUrl is resolved server-side from the stored
                    key on every read, so it is never a stale or guessed path. */}
                <td className="px-3 py-4 text-xs text-stone-500 align-top" data-label="Challan">
                  {s.deliveryChallanNumber || s.challanDocumentUrl ? (
                    <div className="leading-tight">
                      {s.deliveryChallanNumber && (
                        <div className="font-semibold text-stone-700 break-words" title={s.deliveryChallanNumber}>{s.deliveryChallanNumber}</div>
                      )}
                      {s.challanDocumentUrl && (
                        <a
                          href={fileHref(s.challanDocumentUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 font-bold text-[#EA2831] hover:underline"
                          title={s.challanDocument?.name || 'Delivery challan'}
                        >
                          <span className="material-symbols-outlined text-sm">description</span> View
                        </a>
                      )}
                    </div>
                  ) : '—'}
                </td>
                {/* BILTY and BILL — read exactly like the Challan cell
                    beside them, from the same kind of stored key resolved
                    server-side on every read (`biltyDocumentUrl` / `billDocumentUrl`).
                    Same empty state: a dash when neither a number nor a document
                    is present, so a row is never broken by missing paperwork. */}
                <td className="px-3 py-4 text-xs text-stone-500 align-top" data-label="Bilty Number">
                  <DocCell number={s.biltyNumber} url={s.biltyDocumentUrl} name={s.biltyDocument?.name} label="Bilty" />
                </td>
                <td className="px-3 py-4 text-xs text-stone-500 align-top" data-label="Bill">
                  <DocCell number={s.billNumber} url={s.billDocumentUrl} name={s.billDocument?.name} label="Bill" />
                </td>
                <td className="px-3 py-4 align-top" data-label="Status"><span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_STYLES[s.status] || 'bg-stone-100'}`}>{s.status}</span></td>
                <td className="px-3 py-4 text-xs text-stone-500 align-top" data-label="Dispatched">{s.dispatchedAt ? fmtDate(s.dispatchedAt) : '—'}</td>
                <td className="px-3 py-4 cell-actions align-top">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {/* Transfers skip the separate Approve step — Dispatch
                        accepts a planned shipment directly. Approve stays for
                        other shipment types. */}
                    {s.refType !== 'Transfer' && ['draft', 'planned'].includes(s.status) && isMyOutgoing(s) && <GhostBtn onClick={() => doApprove(s)}>Approve</GhostBtn>}
                    {['draft', 'planned', 'approved', 'loading'].includes(s.status) && isMyOutgoing(s) && (s.refType !== 'Transfer' || canTransfer) && <GhostBtn onClick={() => onDispatchClick(s)}>Dispatch</GhostBtn>}
                    {/* BOX PACKAGING — the repack cartons assembled for this
                        shipment in the scan-out dialog. Shown only when there
                        are any (repackBoxCount comes back with the list), and
                        both BEFORE dispatch, while a box can still be broken
                        open, and AFTER it, when the labels may still be
                        reprinted.

                        A SENDING-SIDE CONTROL. The cartons are packed by the
                        warehouse that ships, and their labels are printed there;
                        the destination's job on this row is Receive Lot. Gated on
                        the very `dir` the Incoming/Outgoing chip is drawn from,
                        so what the row says about itself and what it offers can
                        never disagree. An unscoped viewer (the main Company,
                        which has no chip and no side) keeps seeing it.

                        DISTINCT FROM "Box Labels" BELOW: this lists the repack
                        cartons packed at scan-out; that one prints the Shipment
                        Box labels of a Company → Seller transfer. Different
                        records, different counts — hence two buttons. */}
                    {dir !== 'Incoming' && Number(s.repackBoxCount) > 0 && (
                      <GhostBtn onClick={() => setBoxesFor(s)} title="Repack cartons packed for this shipment">
                        <span className="material-symbols-outlined text-sm">inventory_2</span>
                        Box ({s.repackBoxCount})
                      </GhostBtn>
                    )}
                    {/* Shipment Box labels — only for consignments that actually
                        packed loose units into cartons (boxCount > 0). Sender-side,
                        like the Shipping Label beside it. A transfer with several
                        boxes prints all of them on one sheet.

                        ORDER: Box Labels comes BEFORE Shipping Label so a
                        Company → Seller row reads the same way round as a
                        warehouse → warehouse one, which already puts its box
                        control first. Only the order changed — same button, same
                        text, same handler, same label output. */}
                    {mayHaveBoxes(s) && isMyOutgoing(s) && !isIncoming(s) && (
                      <GhostBtn onClick={() => openBoxLabels(s)}>
                        <span className="material-symbols-outlined text-sm">inventory_2</span>
                        Box {s.boxCount ? ` (${s.boxCount})` : ''}
                      </GhostBtn>
                    )}
                    {/* Sender can re-open the shipping label (QR + barcode) any
                        time after dispatch to print/share it. It is a SENDER-only
                        control: never shown on the destination's receivable row
                        (so it never appears alongside "Receive Lot"). */}
                    {s.qrToken && isMyOutgoing(s) && !isIncoming(s) && (
                      <GhostBtn onClick={() => setManifestInfo({ qrPayload: `${s._id}.${s.qrToken}` })}>
                        <span className="material-symbols-outlined text-sm">qr_code_2</span> Shipping Label
                      </GhostBtn>
                    )}
                    {/* Receive only renders for the DESTINATION warehouse's team
                        (the sender sees the row but cannot receive their own
                        outbound transfer — the backend enforces this too). */}
                    {isIncoming(s) && <GhostBtn onClick={() => setVerify(s)}>Receive Lot</GhostBtn>}
                    {['in_transit', 'arrived'].includes(s.status) && s.toType === 'customer' && <GhostBtn onClick={() => doDeliver(s)}>Deliver</GhostBtn>}
                  </div>
                </td>
              </tr>
              );
            })}
            {/* colSpan matches the VISIBLE column count (10) so the empty-state row
                spans the full table. */}
            {visible.length === 0 && <tr><td colSpan={10} className="px-6 py-12 text-center text-sm text-stone-400">{needle ? `No shipment matches “${q.trim()}”.` : view === 'incoming' ? 'No incoming transfers for your warehouse.' : 'No shipments yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {/* Guarded on the role too, so the modal can never be opened for the main
          Company through leftover/forced UI state — not just a hidden button. */}
      {showNew && !isMainCompany && <NewShipmentModal canTransfer={canTransfer} onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); refresh(); }} />}
      {boxesFor && (
        <RepackBoxesModal
          shipment={boxesFor}
          canUnpack={canUnpackBoxes(boxesFor)}
          onClose={() => setBoxesFor(null)}
          // An unpack removes a carton, so the row's count is stale — reload the
          // table rather than guessing at the new number.
          onChanged={refresh}
        />
      )}
      {dispatchScanFor && (
        <DispatchScanModal
          shipment={dispatchScanFor}
          onClose={() => setDispatchScanFor(null)}
          onDone={(info) => { setDispatchScanFor(null); setManifestInfo(info); refresh(); }}
        />
      )}
      {manifestInfo && <ManifestModal info={manifestInfo} onClose={() => setManifestInfo(null)} />}
      {boxLabels && (
        <ShipmentBoxLabelsModal
          boxes={boxLabels.boxes}
          seller={boxLabels.seller}
          transferRef={boxLabels.ref}
          onClose={() => setBoxLabels(null)}
        />
      )}
      {verify && <ReceiveModal shipment={verify} onClose={() => setVerify(null)} onDone={() => { setVerify(null); refresh(); }} />}
    </>
  );
};

/**
 * SCAN-OUT before a warehouse→warehouse transfer leaves.
 *
 * The sending warehouse used to press Dispatch and the stock left unverified. A
 * seller supply is already scanned (Send Stock → Pick); this gives a transfer
 * the same treatment and nothing more — on confirm it calls the SAME dispatch as
 * before, and the shipment lands on the same next status.
 *
 * It RENDERS THE PICK DIALOG'S OWN BODY (PickBody, imported from ImsOutbound)
 * rather than a copy of its markup: the two do the same job, so they stay
 * identical by construction. All this component supplies is the `pick` shape
 * that body is driven by — scan handler, per-product counts, scanned groups —
 * fed by the shipment's own dispatch-scan endpoints.
 *
 * Nothing is decided here. Which product a code belongs to, whether the whole
 * carton may go, and whether the stock is received and present at the sending
 * warehouse are all answered by the server, and re-answered at dispatch.
 */
/**
 * WHICH LEVEL a scan resolved to, in the operator's words. `boxLevel` comes from
 * the server (main vs inner carton); `scanType` keeps its existing values, so an
 * older payload without boxLevel simply reads "Box".
 */
const scanLevelLabel = (d) => {
  if (d.scanType === 'lot') return 'Lot';
  if (d.scanType === 'unit') return 'Unit';
  return d.boxLevel === 'main' ? 'Main box' : d.boxLevel === 'inner' ? 'Inner box' : 'Box';
};

const DispatchScanModal = ({ shipment, onClose, onDone }) => {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState(shipment.ref || '');
  const [items, setItems] = useState([]);
  // One entry per SCAN, so a carton and a single unit can be removed
  // independently — the same grouping the Pick dialog uses.
  const [groups, setGroups] = useState([]);
  // REPACK. Which loose-unit rows are ticked, and which box is open in the View.
  const [picked, setPicked] = useState(() => new Set());
  const [viewBox, setViewBox] = useState(null);
  /* DELIVERY CHALLAN — required before this transfer can leave. Pre-filled from
     whatever the shipment already carries: a DIRECT transfer collected it on the
     New Transfer form, while one created by accepting a REQUEST never saw that
     form and arrives here with nothing. Either way it is entered once. */
  const [challanNumber, setChallanNumber] = useState(shipment.deliveryChallanNumber || '');
  const [challan, setChallan] = useState(null);
  const [challanUrl, setChallanUrl] = useState(null);
  const challanRef = useRef(null);
  const storedChallanUrl = shipment.challanDocumentUrl || null;

  useEffect(() => {
    let alive = true;
    getDispatchChecklist(shipment._id)
      .then((r) => {
        if (!alive) return;
        const d = r?.data || r;
        // PickBody reads `productId.productName` and `productId.trackSerial`,
        // so the rows are shaped the way an order item is. requiredQty is this
        // dialog's qtyField.
        setItems((d?.items || []).map((i) => ({
          productId: { _id: i.productId, productName: i.name, trackSerial: true },
          requiredQty: i.requiredQty,
          pickedQty: 0,
        })));
        setRef(d?.ref || shipment.ref || '');
      })
      .catch(apiError)
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [shipment._id, shipment.ref]);

  const selectedCodes = groups.flatMap((g) => g.unitCodes);
  const countFor = (pid) => groups.reduce((n, g) => (g.productId === String(pid) ? n + g.unitCodes.length : n), 0);
  const requiredTotal = items.reduce((n, it) => n + Number(it.requiredQty || 0), 0);
  const complete = requiredTotal > 0 && selectedCodes.length === requiredTotal;

  const onScan = async (raw) => {
    const code = String(raw || '').trim();
    if (!code || busy) return;
    setBusy(true);
    try {
      // The server resolves the code, applies the whole-carton rule and the
      // received-and-here checks, and says which units it adds.
      const r = await dispatchScan(shipment._id, { code, selectedCodes });
      const d = r?.data || r;
      if (!d?.addedUnitCodes?.length) { toast('error', 'Nothing was added by this scan.'); return; }
      // DOUBLE COUNT GUARD, client side too: a unit this dialog already holds —
      // e.g. an inner box scanned before its parent carton — is never added a
      // second time. The server applies the same rule against the database.
      const already = new Set(selectedCodes);
      const fresh = d.addedUnitCodes.filter((c) => !already.has(c));
      if (!fresh.length) { toast('error', 'These units have already been scanned.'); return; }
      setGroups((prev) => [...prev, {
        key: `${d.scanType}:${d.bulkPackagingId || d.lotNumber}:${fresh[0]}`,
        scanType: d.scanType,
        // WHAT was scanned and WHICH LOT it came out of — a transfer can draw on
        // more than one lot of the same product, so the box ID alone does not
        // say where the units came from.
        label: `${scanLevelLabel(d)} · ${d.bulkPackagingId || (d.scanType === 'lot' ? d.lotNumber : fresh[0])}`
          + (d.lotNumber ? ` · Lot ${d.lotNumber}` : ''),
        bulkPackagingId: d.bulkPackagingId || null,
        lotNumber: d.lotNumber,
        productId: String(d.productId),
        unitCodes: fresh,
      }]);
      // Immediate confirmation of what this scan actually did. A carton whose
      // units are not all available still goes through — it adds what it can and
      // says how much it could not.
      const unavailable = Number(d.unavailableQuantity || 0);
      toast(
        unavailable ? 'warning' : 'success',
        unavailable
          ? `Added ${fresh.length} of ${d.boxUnitTotal} — ${unavailable} unit(s) unavailable · Lot ${d.lotNumber}`
          : `Added ${fresh.length} unit(s) · Lot ${d.lotNumber}`,
      );
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  /** Drop a row from the dialog. Touches nothing on the server. */
  const dropRow = (key) => {
    setGroups((prev) => prev.filter((g) => g.key !== key));
    setPicked((prev) => { const next = new Set(prev); next.delete(key); return next; });
  };

  /**
   * THE × ON A ROW.
   *
   * On a Bulk Packaging or a unit row it means what it always meant: take this
   * scan back out of the selection. Nothing was created on the server, so
   * nothing has to be undone.
   *
   * ON A REPACK BOX ROW IT MEANS "THIS BOX WAS NEVER PACKED". A carton is a real
   * database row minted the moment it was created, so dropping the row on screen
   * alone left an ID behind that named no physical box and never would. The box
   * is deleted outright and its units come back as INDIVIDUAL loose rows — the
   * state they were in before the carton was made, checkboxes and all.
   *
   * THE PICKED COUNT DOES NOT MOVE. The same unit codes go back on the list, one
   * row each instead of one row for all of them; only the grouping changes,
   * exactly as packing them only changed the grouping.
   */
  const removeGroup = async (key) => {
    const row = groups.find((g) => g.key === key);
    if (!row || row.scanType !== 'repack') { dropRow(key); return; }
    if (busy) return;

    const n = row.unitCodes.length;
    const { isConfirmed } = await Swal.fire({
      title: 'Remove this box?',
      text: `The ${n} unit(s) will go back as loose units.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Remove box',
      confirmButtonColor: '#EA2831',
    });
    if (!isConfirmed) return;

    setBusy(true);
    try {
      const r = await discardRepackBox(row.repackBoxId);
      const d = r?.data || r;
      setGroups((prev) => [
        ...prev.filter((g) => g.key !== key),
        // ONE ROW PER UNIT, shaped exactly like a scanned unit row — the lot it
        // belongs to and the box it was originally minted into both come back
        // from the server, so the rows read the same as before the repack.
        ...(d.units || []).map((u) => ({
          key: `unit:${u.serial}`,
          scanType: 'unit',
          label: `Unit · ${u.unitCode}`,
          bulkPackagingId: u.bulkPackagingId,
          lotNumber: u.lotNumber,
          productId: String(u.productId),
          unitCodes: [u.serial],
        })),
      ]);
      setPicked((prev) => { const next = new Set(prev); next.delete(key); return next; });
      toast('success', `${d.repackBoxId} removed — ${d.unitCount} unit(s) are loose again`);
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  /* ---- REPACK: loose units → one new carton -----------------------------
     ONLY LOOSE UNITS MAY BE TICKED — nothing that already has a packaging
     identity of its own:

       LOT             — the lot number IS the identity of everything scanned by
                         it; a whole lot going out has nothing loose about it,
                         and minting a repack ID for it would name the same goods
                         twice.
       BULK PACKAGING  — the carton's own printed ID
       BOX PACKAGING   — a repack carton packed a moment ago

     Selection is per row, and a row is one scan. */
  const isLooseRow = (g) => g.scanType === 'unit';
  const toggleRow = (key) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const pickedRows = groups.filter((g) => picked.has(g.key) && isLooseRow(g));
  const pickedUnitCodes = pickedRows.flatMap((g) => g.unitCodes);

  /**
   * Pack the ticked units. The server mints the ID, links the units and writes
   * the audit rows; it also refuses anything that is not one of THIS shipment's
   * picked units, so the carton can never reach into the rest of the warehouse.
   *
   * THE PICKED COUNT DOES NOT MOVE: the ticked rows are replaced by ONE row
   * carrying exactly the same unit codes, so 34/100 stays 34/100 — only the
   * grouping changes.
   */
  const packSelected = async () => {
    if (!pickedUnitCodes.length || busy) return;
    setBusy(true);
    try {
      const r = await packRepackBox({ shipmentId: shipment._id, serials: pickedUnitCodes });
      const box = r?.data || r;
      const packedKeys = new Set(pickedRows.map((g) => g.key));
      setGroups((prev) => [
        ...prev.filter((g) => !packedKeys.has(g.key)),
        {
          key: `repack:${box.repackBoxId}`,
          scanType: 'repack',
          label: `New box · ${box.repackBoxId}`,
          repackBoxId: box.repackBoxId,
          bulkPackagingId: box.repackBoxId,
          lotNumber: box.lotGroups?.[0]?.lotNumber || '',
          // A carton may hold several lots, so the row states that rather than
          // one lot number.
          lotSummary: box.lotCount > 1 ? `${box.lotCount} lots inside` : `Lot ${box.lotGroups?.[0]?.lotNumber || '—'}`,
          productId: String(pickedRows[0]?.productId || ''),
          unitCodes: pickedUnitCodes,
        },
      ]);
      setPicked(new Set());
      toast('success', `Packed ${box.unitCount} unit(s) into ${box.repackBoxId}`);
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  /* ── CHALLAN FILE HANDLING. Both an image and a PDF are accepted; anything
     else is refused here with a message rather than being sent and rejected. ── */
  const pickChallan = (file) => {
    setChallanUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return file && isImageFile(file) ? URL.createObjectURL(file) : null; });
    setChallan(file);
  };
  const clearChallan = () => {
    pickChallan(null);
    // Clearing the INPUT too is what lets the same file be picked again — a bare
    // state reset leaves the input's value in place and the next identical pick
    // fires no change event at all.
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

  // A document is in place if one is already on the shipment or one has just
  // been picked. The server re-checks both and is the authority; this only
  // decides whether the button is live.
  const challanReady = !!challanNumber.trim() && !!(storedChallanUrl || challan);

  const confirm = async () => {
    if (!complete || !challanReady || busy) return;
    setBusy(true);
    try {
      // Exactly the dispatch this button always ran, plus the units that were
      // scanned and the delivery challan. The server re-derives what is required,
      // re-checks each code, and refuses unless both challan parts are present.
      //
      // MULTIPART, so the document travels with the dispatch. Every field goes
      // over as a string, so scannedCodes is serialised and the route parses it
      // back before the validator sees it.
      const fd = new FormData();
      const pos = await getPos();
      Object.entries(pos || {}).forEach(([k, val]) => {
        if (val !== undefined && val !== null) fd.append(k, String(val));
      });
      fd.append('scannedCodes', JSON.stringify(selectedCodes));
      fd.append('deliveryChallanNumber', challanNumber.trim());
      if (challan) fd.append('challanDocument', challan, challan.name);
      const r = await dispatchShipment(shipment._id, fd);
      toast('success', 'Transfer dispatched — stock is now in transit');
      onDone(r?.data || r);
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  // The contract PickBody is driven by. `qtys`/`setQty` exist because it accepts
  // a typed quantity for non-serialized rows; every row here is scan-driven
  // (trackSerial), so they are never reached.
  const pick = {
    groups, busy, qtys: {}, setQty: () => {},
    scannedCount: selectedCodes.length,
    countFor, onScan, removeGroup,
    // REPACK controls. Supplied only here, so the order-pick dialog — which
    // shares this body — shows no checkboxes and no action bar.
    select: {
      isOn: (key) => picked.has(key),
      toggle: toggleRow,
      canSelect: isLooseRow,
      // A packed carton carries View. There is deliberately no Unpack beside it
      // any more: the row's own × already removes the box and hands its units
      // back loose, and two controls that both un-make a carton — one leaving a
      // row behind, one not — is a choice the operator should not have to make
      // mid-dispatch.
      rowActions: (g) => (g.scanType === 'repack' ? (
        <button
          type="button"
          onClick={() => setViewBox(g.repackBoxId)}
          className="shrink-0 text-[11px] font-bold text-[#EA2831] hover:underline"
        >
          View
        </button>
      ) : null),
      footer: pickedUnitCodes.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#EA2831]/30 bg-[#EA2831]/5 px-3 py-2">
          <p className="text-[11px] font-medium text-stone-600">
            {pickedUnitCodes.length} loose unit(s) selected
          </p>
          <PrimaryBtn onClick={packSelected} disabled={busy}>
            {busy ? 'Packing…' : `Pack ${pickedUnitCodes.length} units into new box`}
          </PrimaryBtn>
        </div>
      ) : null,
    },
  };

  return (
    <Modal title={`Scan out · ${ref || 'transfer'}`} onClose={onClose} wide>
      {loading
        ? <p className="py-6 text-center text-sm text-stone-400">Loading…</p>
        : <PickBody items={items} qtyField="requiredQty" pick={pick} />}
      {/* Contents of a carton packed here — the same view every other screen
          opens for a repack box ID. Read-only: un-making a carton is the row's
          ×, one control in one place, so the two can never leave the dialog in
          different states. */}
      {viewBox && (
        <RepackBoxView
          repackBoxId={viewBox}
          onClose={() => setViewBox(null)}
        />
      )}
      {/* DELIVERY CHALLAN — REQUIRED BEFORE DISPATCH, both parts. Shown once the
          scan is complete, which is when the paperwork is actually written, so
          it does not clutter the scanning step. */}
      {!loading && complete && (
        <div className="mt-3 rounded-xl border border-stone-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
              Delivery challan · required
            </p>
            {challanReady && <span className="text-[10px] font-bold text-green-600">✓ ready</span>}
          </div>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            <Field label="Challan Number *">
              <input
                className={inputCls}
                value={challanNumber}
                onChange={(e) => setChallanNumber(e.target.value)}
                placeholder="As printed on the challan"
              />
            </Field>
            <Field label="Challan Document *">
              {challan ? (
                <ChallanPreview file={challan} previewUrl={challanUrl} onRemove={clearChallan} />
              ) : storedChallanUrl ? (
                /* ALREADY ON THE SHIPMENT — attached when the transfer was
                   raised. Openable here, and replaceable without re-uploading. */
                <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50/60 p-2">
                  <span className="material-symbols-outlined shrink-0 text-[28px] text-green-600">task</span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={fileHref(storedChallanUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-xs font-bold text-[#EA2831] hover:underline"
                      title={shipment.challanDocumentName || 'Delivery challan'}
                    >
                      {shipment.challanDocumentName || 'View challan'}
                    </a>
                    <p className="text-[11px] text-stone-400">Attached to this transfer</p>
                  </div>
                  <label className="shrink-0 cursor-pointer text-[11px] font-bold uppercase tracking-wider text-stone-500 hover:text-[#EA2831]">
                    Replace
                    <input type="file" ref={challanRef} accept="image/*,application/pdf,.pdf" className="hidden" onChange={onChallanChange} />
                  </label>
                </div>
              ) : (
                <label className={`${inputCls} flex cursor-pointer items-center gap-2 text-stone-400 hover:bg-stone-50`}>
                  <span className="material-symbols-outlined text-base">upload_file</span>
                  Choose an image or PDF…
                  {/* `accept` narrows the picker; onChallanChange re-checks,
                      because accept is a hint a user can bypass. */}
                  <input type="file" ref={challanRef} accept="image/*,application/pdf,.pdf" className="hidden" onChange={onChallanChange} />
                </label>
              )}
            </Field>
          </div>
        </div>
      )}
      <PrimaryBtn disabled={!complete || !challanReady || busy || loading} onClick={confirm}>
        {busy ? 'Dispatching…' : 'Dispatch'}
      </PrimaryBtn>
      {!loading && complete && !challanReady && (
        <p className="mt-1 text-[11px] text-stone-400">
          {!challanNumber.trim()
            ? 'Enter the delivery challan number to dispatch.'
            : 'Attach the delivery challan document to dispatch.'}
        </p>
      )}
    </Modal>
  );
};

/* ---- DELIVERY CHALLAN upload. ANY file type and ANY size is accepted, so
   there is no accept attribute and no client- or server-side validation of the
   file itself — only that one was chosen. */
/**
 * ONE DESPATCH-DOCUMENT CELL — a number and a link to the stored scan.
 *
 * The Challan cell above is the original and is left exactly as it was; this is
 * the same markup factored out so the BL and the Bill read identically rather
 * than being copy-pasted twice more. The URL is always the server-resolved one
 * (signed at read time from the stored key) — never rebuilt here.
 *
 * EMPTY STATE IS EXPLICIT: with neither a number nor a document the cell is a
 * dash, so a transfer that predates this paperwork renders normally. A number
 * with no file, or a file with no number, each render on their own.
 */
const DocCell = ({ number, url, name, label }) => {
  if (!number && !url) return '—';
  return (
    <div className="leading-tight">
      {number && <div className="font-semibold text-stone-700 break-words" title={number}>{number}</div>}
      {url ? (
        <a
          href={fileHref(url)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 font-bold text-[#EA2831] hover:underline"
          title={name || label}
        >
          <span className="material-symbols-outlined text-sm">description</span> View
        </a>
      ) : (
        <span className="text-stone-300">No document</span>
      )}
    </div>
  );
};

const isImageFile = (file) => /^image\//i.test(file?.type || '');
// The challan may be an IMAGE or a PDF. Both are accepted everywhere a
// challan is collected, so the test lives beside isImageFile rather than
// being re-written at each call site.
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

const NewShipmentModal = ({ canTransfer = true, onClose, onDone }) => {
  // The caller's own warehouse(s) — used to pre-fill the FROM picker so a
  // warehouse user never has to hunt for their own warehouse in the list.
  const perm = usePermission();
  const { warehouseIds } = perm;
  const [warehouses, setWarehouses] = useState([]);
  // Destination picker uses the full company directory; the FROM picker stays
  // on the caller's scoped list (you dispatch from YOUR warehouse).
  const [warehouseDir, setWarehouseDir] = useState([]);
  const [lots, setLots] = useState([]);
  // THIS FORM ONLY RAISES WAREHOUSE TRANSFERS. It is reached from the warehouse
  // transfer flow, so the movement is known — there is no Type to choose, and
  // toType/refType are fixed below at submit rather than asked for.
  const [f, setF] = useState({ fromWarehouseId: '', toWarehouseId: '', deliveryChallanNumber: '' });
  // ONE ROW PER PRODUCT — what is going out, and how much of it. The lots are
  // NOT chosen here: the server splits each quantity across the product's lots
  // (earliest expiry first) when the shipment is planned, and the physical
  // lot / box / unit identity is established by SCANNING AT DISPATCH.
  const [rows, setRows] = useState([{ productId: '', qty: '' }]);
  // The delivery challan scan. `challanUrl` is an object URL for the image
  // preview — revoked whenever the file is replaced or cleared, so a long
  // session cannot leak them.
  const [challan, setChallan] = useState(null);
  const [challanUrl, setChallanUrl] = useState(null);
  const challanRef = useRef(null);
  // One error bag for the whole form — every field is required, so submit
  // validates them all and each message renders under its own field.
  const [errors, setErrors] = useState({});
  const setField = (key, value) => {
    setF((p) => ({ ...p, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };
  useEffect(() => {
    getWarehouses().then((r) => {
      const list = listOf(r);
      setWarehouses(list);
      // Auto-select the caller's OWN warehouse as the source. A warehouse user
      // always ships FROM their own warehouse; falls back to the sole warehouse
      // when only one exists. Unscoped multi-warehouse users still choose.
      setF((prev) => {
        if (prev.fromWarehouseId) return prev;
        // Collect every id the context might use for "my / current warehouse":
        // string ids, populated { _id } objects, and singular fields that some
        // roles expose (warehouseId / currentWarehouseId). Then match against
        // the scoped list so the FROM select shows the warehouse NAME, not "—".
        const myIds = [
          ...((warehouseIds || []).map((w) => String(w?._id || w))),
          perm.warehouseId && String(perm.warehouseId?._id || perm.warehouseId),
          perm.currentWarehouseId && String(perm.currentWarehouseId?._id || perm.currentWarehouseId),
        ].filter(Boolean);
        const mineId = myIds.find((id) => list.some((w) => String(w._id) === id));
        const auto = mineId || (list.length === 1 ? String(list[0]._id) : '');
        return auto ? { ...prev, fromWarehouseId: auto } : prev;
      });
    }).catch(() => {});
    getWarehouseDirectory().then((r) => setWarehouseDir(Array.isArray(r) ? r : r?.data || [])).catch(() => {});
    getLots().then((r) => setLots(listOf(r))).catch(() => {});
  }, []);
  // Replace / clear the picked file, keeping the object URL and the native
  // input in step with the state.
  const pickChallan = (file) => {
    setChallanUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return file && isImageFile(file) ? URL.createObjectURL(file) : null; });
    setChallan(file);
    setErrors((e) => (e.challanDocument ? { ...e, challanDocument: undefined } : e));
  };
  const clearChallan = () => {
    pickChallan(null);
    // Resetting the input's value is what allows the same file to be chosen
    // again after a Remove.
    if (challanRef.current) challanRef.current.value = '';
  };
  // ANY file, ANY size — whatever paperwork the warehouse holds is attachable,
  // so there is nothing to check here beyond "was something chosen".
  const onChallanChange = (ev) => pickChallan(ev.target.files?.[0] || null);
  // Object URLs live outside React, so the last one is released on unmount.
  useEffect(() => () => { if (challanUrl) URL.revokeObjectURL(challanUrl); }, [challanUrl]);

  /* ---- PRODUCTS AT THE SOURCE WAREHOUSE ----------------------------------
     ONE OPTION PER PRODUCT, never one per lot. The same product held in four
     lots used to appear four times, each labelled with a lot number the
     dispatcher has no reason to choose between — they scan what physically
     goes out, and the scan decides the lot. So the lots at this warehouse are
     folded into their product and their available stock summed. */
  const productOptions = useMemo(() => {
    const byProduct = new Map();
    for (const lot of lots) {
      if (String(lot.warehouseId?._id || lot.warehouseId || '') !== String(f.fromWarehouseId)) continue;
      const id = String(lot.productId?._id || lot.productId || '');
      if (!id) continue;
      const entry = byProduct.get(id) || { productId: id, name: lot.productId?.productName || 'Item', available: 0 };
      entry.available += Number(lot.availableStock || 0);
      byProduct.set(id, entry);
    }
    return [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [lots, f.fromWarehouseId]);

  const updateRow = (i, patch) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const optionFor = (productId) => productOptions.find((p) => p.productId === productId);
  /** An untouched row is ignored, not an error — "+ Add product" leaves one. */
  const isBlankRow = (row) => !row.productId && !String(row.qty).trim();

  /**
   * WHAT IS WRONG WITH THIS ROW, or null. Quantity is a required whole number of
   * at least 1 and may not exceed the product's available stock at the source
   * warehouse — the very "(avail N)" figure its own dropdown option shows, so
   * the rule and the number the operator reads can never disagree.
   *
   * Read live (not only on submit) because it also decides whether Plan Shipment
   * is clickable at all.
   */
  const rowError = (row) => {
    if (isBlankRow(row)) return null;
    if (!row.productId) return 'Select a product';
    const raw = String(row.qty).trim();
    if (!raw) return 'Enter a quantity';
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) return 'Quantity must be a whole number of 1 or more';
    const avail = optionFor(row.productId)?.available ?? 0;
    if (n > avail) return `Only ${avail.toLocaleString('en-IN')} available at this warehouse`;
    return null;
  };
  // The rows that will actually be sent, and whether every row is usable.
  const filledRows = rows.filter((r) => !isBlankRow(r));
  const rowsReady = filledRows.length > 0 && filledRows.every((r) => !rowError(r));

  const submit = async () => {
    // Every field is mandatory. Collect all problems first so the user sees
    // each missing field at once, not one at a time.
    const e = {};
    if (!f.fromWarehouseId) e.fromWarehouseId = 'Source warehouse is required';
    if (!f.toWarehouseId) e.toWarehouseId = 'Select a destination warehouse';
    if (!filledRows.length) e.rows = 'Add a product and a quantity';
    else if (!rowsReady) e.rows = 'Fix the highlighted product rows';
    if (!f.deliveryChallanNumber.trim()) e.deliveryChallanNumber = 'Delivery challan number is required';
    if (!challan) e.challanDocument = 'Attach the delivery challan';
    setErrors(e);
    if (Object.keys(e).length) { toast('error', 'Please fill all required fields'); return; }
    try {
      // MULTIPART, because the challan scan travels with the fields. The type is
      // no longer asked for: this form is the warehouse transfer flow, so the
      // shipment is recorded as one — refType "Transfer" (what the Type column
      // and every transfer view read) with toType "warehouse". Neither is ever
      // left unset.
      const fd = new FormData();
      fd.append('refType', 'Transfer');
      fd.append('toType', 'warehouse');
      fd.append('toLabel', 'Warehouse transfer');
      fd.append('fromWarehouseId', f.fromWarehouseId);
      fd.append('toWarehouseId', f.toWarehouseId);
      fd.append('deliveryChallanNumber', f.deliveryChallanNumber.trim());
      // PRODUCT AND QUANTITY ONLY. The server splits each one across that
      // product's lots at the source warehouse, earliest expiry first, and
      // writes one line per lot — it never reserves or deducts anything here.
      // Sent as JSON text, which the create validator accepts from a multipart
      // body (validators/transportValidators).
      fd.append('lines', JSON.stringify(filledRows.map((r) => ({ productId: r.productId, qty: Number(r.qty) }))));
      fd.append('challanDocument', challan, challan.name);
      await createTmsShipment(fd); toast('success', 'Shipment planned'); onDone();
    } catch (err) { apiError(err); }
  };
  const errText = (msg) => (msg ? <p className="text-xs font-medium text-[#EA2831] mt-1">⚠ {msg}</p> : null);
  const fromName = warehouses.find((w) => String(w._id) === String(f.fromWarehouseId))?.name;
  return (
    <Modal title="New Transfer" onClose={onClose} wide>
      {/* Every shipment raised here is a warehouse transfer, so a role without
          inventory:transfer (company_admin) cannot use this form at all — say so
          up front rather than letting the save come back 403. */}
      {!canTransfer && (
        <p className="mb-3 rounded-lg border border-[#EA2831]/30 bg-[#EA2831]/5 px-3 py-2 text-xs font-medium text-[#EA2831]">
          Your role cannot transfer stock between warehouses.
        </p>
      )}
      {/* SOURCE AND DESTINATION SIDE BY SIDE — one row, two columns. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="From warehouse" required>
          {/* Read-only: a warehouse user always ships FROM their own warehouse,
              auto-detected on load. Rendered as text so it can't be changed. */}
          <div className={`${inputCls} flex items-center ${fromName ? 'text-stone-900' : 'text-stone-400'}`}>
            {fromName || 'No warehouse assigned'}
          </div>
          {errText(errors.fromWarehouseId)}
        </Field>
        <Field label="To warehouse" required>
          <select className={inputCls} value={f.toWarehouseId} onChange={(e) => setField('toWarehouseId', e.target.value)}>
            <option value="">Select…</option>
            {(warehouseDir.length ? warehouseDir : warehouses).filter((w) => String(w._id) !== String(f.fromWarehouseId)).map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
          </select>
          {errText(errors.toWarehouseId)}
        </Field>
      </div>

      {/* PRODUCT + SCANS. The quantity is never typed: it is the total of what
          was scanned into the row, and each scan states exactly what it was. */}
      <p className="text-xs font-bold text-stone-500 mt-2">Product <span className="text-[#EA2831]">*</span></p>
      {rows.map((row, i) => {
        const problem = rowError(row);
        const option = optionFor(row.productId);
        return (
          <div key={i} className="mb-2">
            <div className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <select
                  className={`${inputCls} w-full`}
                  value={row.productId}
                  onChange={(e) => updateRow(i, { productId: e.target.value })}
                >
                  <option value="">Select product…</option>
                  {productOptions
                    // A product already on another row cannot be added twice —
                    // its quantity belongs in that row.
                    .filter((p) => p.productId === row.productId || !rows.some((r) => r.productId === p.productId))
                    .map((p) => (
                      <option key={p.productId} value={p.productId}>
                        {p.name} (avail {p.available.toLocaleString('en-IN')})
                      </option>
                    ))}
                </select>
              </div>
              {/* inputCls carries w-full, so the width is pinned via inline style
                  (beats the class) — keeps Qty compact and lets the product
                  select fill the row. Digits only: a stray "e", "." or "-" that
                  a number input would otherwise accept can never be typed. */}
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                placeholder="Qty"
                style={{ width: '5rem' }}
                className={`${inputCls} shrink-0 text-center px-2 ${problem ? 'border-[#EA2831]' : ''}`}
                value={row.qty}
                max={option ? option.available : undefined}
                onChange={(e) => updateRow(i, { qty: e.target.value.replace(/[^0-9]/g, '') })}
              />
              {rows.length > 1 && <GhostBtn onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>✕</GhostBtn>}
            </div>
            {/* Live, per row — the same rule that decides whether Plan Shipment
                is clickable, so the button is never off without a reason on
                screen. */}
            {errText(problem)}
          </div>
        );
      })}
      {errText(errors.rows)}
      <GhostBtn onClick={() => setRows((rs) => [...rs, { productId: '', qty: '' }])}>+ Add product</GhostBtn>
      {/* DELIVERY CHALLAN — the paperwork that travels with the goods. Both
          parts are required: the number the challan carries, and a scan of the
          document itself, which is stored against the shipment and reachable
          from the shipments table and the transfer detail page afterwards. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 mt-2">
        <Field label="Delivery Challan Number" required>
          <input
            className={inputCls}
            value={f.deliveryChallanNumber}
            onChange={(e) => setField('deliveryChallanNumber', e.target.value)}
            placeholder="As printed on the challan"
          />
          {errText(errors.deliveryChallanNumber)}
        </Field>
        <Field label="Challan Document" required>
          {challan ? (
            <ChallanPreview file={challan} previewUrl={challanUrl} onRemove={clearChallan} />
          ) : (
            <label className={`${inputCls} flex cursor-pointer items-center gap-2 text-stone-400 hover:bg-stone-50`}>
              <span className="material-symbols-outlined text-base">upload_file</span>
              Choose a file…
              {/* No `accept` and no size or type check, here or on the server —
                  any file the warehouse holds can be attached. */}
              <input type="file" ref={challanRef} className="hidden" onChange={onChallanChange} />
            </label>
          )}
          {errText(errors.challanDocument)}
        </Field>
      </div>
      {/* Off until every product row carries a product AND a usable quantity —
          blank, 0, or more than the available stock all keep it off. The other
          required fields still report themselves on click, as before. */}
      <div className="mt-3">
        <PrimaryBtn
          onClick={submit}
          disabled={!rowsReady}
          title={rowsReady ? undefined : 'Add a product and a quantity of at least 1 (no more than the available stock).'}
        >
          Plan Transfer
        </PrimaryBtn>
      </div>
    </Modal>
  );
};

/* ───────────── Stock Requests (B asks A) ───────────── */
const REQ_STATUS_STYLES = {
  requested: 'bg-amber-50 text-amber-600', accepted: 'bg-green-50 text-green-600',
  rejected: 'bg-red-50 text-red-600', fulfilled: 'bg-blue-50 text-blue-600', cancelled: 'bg-stone-100 text-stone-400',
};

/**
 * Inter-warehouse stock requests. A destination warehouse asks a source
 * warehouse for stock; the source's operations manager sees the request here
 * and accepts/rejects it; the requester sees the decision (acknowledgment);
 * the company admin is notified of every step.
 */
const RequestsTab = () => {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const { warehouseIds, can } = usePermission();
  // Accepting a request creates a transfer shipment → needs inventory:transfer.
  // Admins (denied) can see + reject requests but not accept them.
  const canTransfer = can('inventory:transfer');
  const refresh = () => getTransferRequests().then((r) => setRows(listOf(r))).catch(apiError);
  useEffect(() => { refresh(); }, []);

  const mine = (whId) => !warehouseIds?.length || warehouseIds.includes(String(whId?._id || whId));

  // Case-insensitive search across the transfer ref, product and both
  // warehouses, so a row can be found by the SH-… seen in Transfer History.
  // Read-only over what the API already returned — never alters the stored ref.
  const needle = q.trim().toLowerCase();
  const visible = needle
    ? rows.filter((r) =>
        [r.transferRef, r.productId?.productName, r.fromWarehouseId?.name, r.toWarehouseId?.name]
          .some((f) => (f || '').toLowerCase().includes(needle)))
    : rows;
  const decide = async (id, ok) => {
    try {
      // Accept runs a server-side stock check: if the source warehouse lacks
      // the quantity, a 409 alert explains how much is available and what to
      // do (restock and accept later, or reject with a note) — apiError
      // surfaces that message. On success a linked FEFO shipment is created.
      const r = await (ok ? acceptTransferRequest(id) : rejectTransferRequest(id));
      toast('success', r?.message || (ok ? 'Request accepted — the requester has been notified' : 'Request rejected'));
      refresh();
    } catch (err) { apiError(err); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{visible.length} request(s)</p>
        <div className="flex items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search ref (SH-…), product or warehouse…"
            className="w-56 sm:w-72 border border-stone-200 rounded-lg text-sm px-3 py-2 bg-white focus:ring-[#EA2831]"
          />
          <PrimaryBtn onClick={() => setShowNew(true)}>
            <span className="material-symbols-outlined text-base">move_down</span> Request Stock
          </PrimaryBtn>
        </div>
      </div>
      <div className="border border-stone-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[920px] resp-table">
          <thead><tr className="text-[10px] uppercase text-stone-400 bg-stone-50"><Th>Product</Th><Th right>Qty</Th><Th>From (source)</Th><Th>For (requester)</Th><Th>Transfer Ref.</Th><Th>Status</Th><Th>Requested</Th><Th right>Actions</Th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {visible.map((r) => (
              <tr key={r._id} className="hover:bg-stone-50/40">
                <td className="px-4 py-3 text-sm font-bold" data-label="Product">{r.productId?.productName || '—'}</td>
                <td className="px-4 py-3 text-sm text-right" data-label="Qty">{r.qty}</td>
                <td className="px-4 py-3 text-sm" data-label="From (source)">{r.fromWarehouseId?.name || '—'}</td>
                <td className="px-4 py-3 text-sm" data-label="For (requester)">{r.toWarehouseId?.name || '—'}{r.requestedBy?.name ? <span className="text-xs text-stone-400"> · {r.requestedBy.name}</span> : null}</td>
                {/* The reference of the shipment this request created — the exact
                    SH-… shown in Transfer History (server-supplied `transferRef`,
                    never rebuilt here). "Not created" until a shipment exists; a
                    request has at most one shipment, so no +N case. Shown in full,
                    monospace, no truncation. */}
                <td className="px-4 py-3" data-label="Transfer Ref.">
                  {r.transferRef
                    ? <span className="text-xs font-bold font-mono bg-stone-100 text-stone-700 px-2.5 py-1 rounded-full whitespace-nowrap">{r.transferRef}</span>
                    : <span className="text-xs text-stone-400">Not created</span>}
                </td>
                <td className="px-4 py-3" data-label="Status"><span className={`text-xs font-bold px-2.5 py-1 rounded-full ${REQ_STATUS_STYLES[r.status] || 'bg-stone-100 text-stone-500'}`}>{r.status}</span></td>
                <td className="px-4 py-3 text-xs text-stone-400" data-label="Requested">{fmtDate(r.createdAt)}</td>
                <td className="px-4 py-3 cell-actions">
                  <div className="flex items-center justify-end gap-2">
                    {r.status === 'requested' && mine(r.fromWarehouseId) && (
                      canTransfer ? (
                        <>
                          <GhostBtn onClick={() => decide(r._id, true)}>Accept</GhostBtn>
                          <GhostBtn onClick={() => decide(r._id, false)}>Reject</GhostBtn>
                        </>
                      ) : (
                        <span className="text-[11px] font-bold text-stone-400">Awaiting source warehouse</span>
                      )
                    )}
                    {r.status === 'accepted' && (
                      <span className="text-[11px] font-bold text-green-600">
                        ✓ Accepted{r.decidedBy?.name ? ` by ${r.decidedBy.name}` : ''}{r.shipmentId ? ' · shipment created' : ''}
                      </span>
                    )}
                    {r.status === 'fulfilled' && (
                      <span className="text-[11px] font-bold text-blue-600">✓ Delivered &amp; received</span>
                    )}
                    {r.status === 'rejected' && mine(r.toWarehouseId) && (
                      <span className="text-[11px] font-bold text-red-600">✕ Rejected</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={8} className="px-6 py-12 text-center text-sm text-stone-400">{needle ? `No request matches “${q.trim()}”.` : 'No stock requests yet. Use "Request Stock" to ask another warehouse for inventory.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {showNew && <NewRequestModal onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); refresh(); toast('success', 'Request sent — the source warehouse and admin have been notified'); }} />}
    </div>
  );
};

const NewRequestModal = ({ onClose, onDone }) => {
  const [products, setProducts] = useState([]);
  const [dir, setDir] = useState([]);
  const { warehouseIds } = usePermission();
  const [f, setF] = useState({ productId: '', fromWarehouseId: '', toWarehouseId: '', qty: '', note: '' });
  useEffect(() => {
    getProducts().then((r) => setProducts(r?.data || r?.products || [])).catch(() => {});
    getWarehouseDirectory().then((r) => setDir(Array.isArray(r) ? r : r?.data || [])).catch(() => {});
  }, []);
  const scoped = !!warehouseIds?.length;
  // a scoped manager requests FOR their own warehouse; sources are everyone else
  const sources = dir.filter((w) => (scoped ? !warehouseIds.includes(String(w._id)) : String(w._id) !== String(f.toWarehouseId)));
  const submit = async () => {
    try {
      await createTransferRequest({
        productId: f.productId, fromWarehouseId: f.fromWarehouseId,
        ...(!scoped && { toWarehouseId: f.toWarehouseId }),
        qty: Number(f.qty), ...(f.note && { note: f.note }),
      });
      onDone();
    } catch (err) { apiError(err); }
  };
  return (
    <Modal title="Request Stock from Another Warehouse" onClose={onClose}>
      <Field label="Product *">
        <select className={inputCls} value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
          <option value="">Select product…</option>
          {products.map((p) => <option key={p._id} value={p._id}>{p.productName}</option>)}
        </select>
      </Field>
      {!scoped && (
        <Field label="Requesting warehouse (needs the stock) *">
          <select className={inputCls} value={f.toWarehouseId} onChange={(e) => setF({ ...f, toWarehouseId: e.target.value })}>
            <option value="">Select…</option>
            {dir.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Source warehouse (has the stock) *">
        <select className={inputCls} value={f.fromWarehouseId} onChange={(e) => setF({ ...f, fromWarehouseId: e.target.value })}>
          <option value="">Select…</option>
          {sources.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
        </select>
      </Field>
      <Field label="Quantity *"><input type="number" min="1" className={inputCls} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
      <Field label="Note"><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="optional" /></Field>
      <PrimaryBtn disabled={!f.productId || !f.fromWarehouseId || !f.qty || (!scoped && !f.toWarehouseId)} onClick={submit}>
        <span className="material-symbols-outlined text-base">send</span> Send Request
      </PrimaryBtn>
    </Modal>
  );
};

/* ───────────── Vehicles ───────────── */
const VehiclesTab = () => {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ regNo: '', type: '', capacityKg: '' });
  const refresh = () => getVehicles().then((r) => setRows(listOf(r))).catch(apiError);
  useEffect(() => { refresh(); }, []);
  const add = async () => { try { await createVehicle({ regNo: f.regNo, type: f.type, capacityKg: f.capacityKg ? Number(f.capacityKg) : undefined }); setF({ regNo: '', type: '', capacityKg: '' }); refresh(); } catch (err) { apiError(err); } };
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <Field label="Reg No."><input className={inputCls} value={f.regNo} onChange={(e) => setF({ ...f, regNo: e.target.value })} placeholder="MP20 GA 1234" /></Field>
        <Field label="Type"><input className={inputCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} placeholder="truck" /></Field>
        <Field label="Capacity (kg)"><input type="number" className={inputCls} value={f.capacityKg} onChange={(e) => setF({ ...f, capacityKg: e.target.value })} /></Field>
        <PrimaryBtn disabled={!f.regNo} onClick={add}>Add</PrimaryBtn>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {rows.map((v) => (
          <div key={v._id} className="border border-stone-200 rounded-xl p-4">
            <p className="font-bold">{v.regNo}</p>
            <p className="text-xs text-stone-400">{v.type || '—'} · {v.capacityKg || '?'} kg · {v.status}</p>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-stone-400 col-span-full">No vehicles yet.</p>}
      </div>
    </div>
  );
};

/* ───────────── Drivers ───────────── */
const DriversTab = () => {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ name: '', phone: '', pin: '', licenseNo: '' });
  const refresh = () => getDrivers().then((r) => setRows(listOf(r))).catch(apiError);
  useEffect(() => { refresh(); }, []);
  const add = async () => { try { await createDriver(f); toast('success', 'Driver added'); setF({ name: '', phone: '', pin: '', licenseNo: '' }); refresh(); } catch (err) { apiError(err); } };
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2 flex-wrap">
        <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Phone"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="PIN"><input className={inputCls} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} placeholder="4-8 digits" /></Field>
        <Field label="Licence No."><input className={inputCls} value={f.licenseNo} onChange={(e) => setF({ ...f, licenseNo: e.target.value })} /></Field>
        <PrimaryBtn disabled={!f.name || !f.phone || !f.pin} onClick={add}>Add Driver</PrimaryBtn>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {rows.map((d) => (
          <div key={d._id} className="border border-stone-200 rounded-xl p-4">
            <p className="font-bold">{d.userId?.name}</p>
            <p className="text-xs text-stone-400">{d.phone} · {d.vehicleId?.regNo || 'no vehicle'} · {d.licenseNo || 'no licence'}</p>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-stone-400 col-span-full">No drivers yet.</p>}
      </div>
      <p className="text-[11px] text-stone-400">Drivers log in at <span className="font-mono">/driver</span> with phone + PIN.</p>
    </div>
  );
};

/* ───────────── Exceptions ───────────── */
const ExceptionsTab = () => {
  const [rows, setRows] = useState([]);
  useEffect(() => { getDiscrepancies().then((r) => setRows(listOf(r))).catch(apiError); }, []);
  return (
    <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-x-auto">
      <table className="w-full text-left border-collapse min-w-[640px] resp-table">
        <thead><tr className="bg-stone-50 border-b border-stone-200"><Th>Shipment</Th><Th>Product</Th><Th>Expected</Th><Th>Received</Th><Th>Short</Th><Th>Status</Th></tr></thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((d) => (
            <tr key={d._id}>
              <td className="px-6 py-4 text-sm text-stone-500" data-label="Shipment">{d.shipmentId?.toLabel || '—'}</td>
              <td className="px-6 py-4 text-sm font-bold" data-label="Product">{d.productId?.productName || '—'}</td>
              <td className="px-6 py-4 text-sm" data-label="Expected">{d.expectedQty}</td>
              <td className="px-6 py-4 text-sm" data-label="Received">{d.receivedQty}</td>
              <td className="px-6 py-4 text-sm text-red-600 font-bold" data-label="Short">{d.shortageQty}</td>
              <td className="px-6 py-4" data-label="Status"><span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-600">{d.status}</span></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-stone-400">No open discrepancies.</td></tr>}
        </tbody>
      </table>
    </div>
  );
};

export default ImsTransport;