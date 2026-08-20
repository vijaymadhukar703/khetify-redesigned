import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  closestCenter, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, rectSortingStrategy,
  sortableKeyboardCoordinates, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import {
  getLots, receiveLot, createTmsShipment, dispatchShipment, getWarehouses, getWarehouseDirectory, getProducts,
  generateUnits, getUnits, markUnitsPrinted,
  getIncomingLot, confirmLotReceipt,
  getIncomingBox, receiveBulkPackage,
  daysToExpiry, expiryBadge, fmtDate,
} from '../../../lib/imsApi';
// THE shared rule for what each range part of a lot number counts to — the
// server builds the stored number from its own copy of it.
import { packagingSpans } from '../../../lib/lotNumberSpans';
import { STATUS, statusOf, computeInventorySummary, formatINR } from '../../../lib/inventoryData';
import { Modal, Field, inputCls, PrimaryBtn, GhostBtn, Th, NoWarehouseNotice } from './ImsUi';
import { ManifestModal } from '../../../Components/ims/TransferModals';
import LotLabel from '../../../Components/ims/LotLabel';
import BulkPackageLabel from '../../../Components/ims/BulkPackageLabel';
import Barcode128 from '../../../lib/barcode128';
import ScanBox from '../../../Components/ims/ScanBox';
import Can from '../../../Components/ims/Can';
import useHasWarehouse from '../../../hooks/useHasWarehouse';

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });

const apiError = (err) =>
  toast('error', err?.response?.data?.message || err.message || 'Something went wrong');

/** Stock status of a lot from quantity vs reorder level — the single rule used
 *  by the Company summary cards, stock filter and table. */
/**
 * The lot's CREATED quantity = what's on the books here + what is booked to this
 * warehouse but still awaiting its Receive confirmation (inTransitStock).
 *
 * A Company → Company Warehouse lot starts fully in-transit (availableStock 0),
 * so reading availableStock alone would report the Company's own 100-unit lot as
 * 0/Out of Stock. This does NOT make pending stock available to the warehouse:
 * a warehouse-scoped caller never receives purely-pending rows (getLots
 * excludePending), and once received the qty has moved into availableStock with
 * inTransitStock back to 0 — so this reads identically for them.
 */
const lotQty = (l) => Number(l.availableStock || 0) + Number(l.inTransitStock || 0);

/**
 * How the lot is physically packed. A lot created before Bulk Packaging existed
 * has none of these fields, which reads as a single package — exactly right.
 */
const packagingLabel = (l) =>
  l?.has_bulk_packaging && l?.number_of_boxes
    ? `Packaging: ${l.number_of_boxes} boxes × ${Number(l.units_per_box || 0).toLocaleString('en-IN')} units`
    : 'Packaging: Single package';

/**
 * ORIGINAL LOT REGISTER (Main Company only, `originalRegister`): the quantity the
 * lot was CREATED with — Inventory.originalQuantity, an immutable field written
 * once at creation. Deliberately NOT lotQty(): a lot created at 3000 that has since
 * sent 300 to another warehouse reads 2700 live, and the Company register must
 * still say 3000. Live stock stays correct on the Warehouse/Seller views, which
 * never pass this flag.
 *
 * Falls back to null (rendered "—") rather than to live stock: a row the migration
 * could not prove must read as unknown, never as a wrong-but-plausible number.
 */
const originalQty = (l) => (typeof l.originalQuantity === 'number' ? l.originalQuantity : null);
const qtyFor = (l, original) => (original ? originalQty(l) : lotQty(l));
const statusFor = (l, original) => {
  const stock = qtyFor(l, original);
  if (stock === null) return null;
  return statusOf({ stock, reorderLevel: l.lowStockThreshold || 0 });
};

// The stock-status option that shows ONLY the lots this warehouse has nothing
// left of. Deliberately not one of STATUS.*: those describe how much stock a lot
// has, this one is about whether the lot still belongs in the working list.
const STOCK_ZERO = 'zero';

const PAGE_SIZE = 10; // Company Lots pagination — lots per page

/**
 * Lots — receive stock lot-wise (lot no, mfg/expiry, warehouse) and transfer
 * lots between warehouses. The lot number is the single identity. Selling happens through
 * the Outbound flow — there is deliberately no Sell action here.
 *
 * Company-only configuration (all default to false, so every OTHER role keeps
 * the original behaviour untouched):
 *   showSummary     — render the summary cards + restocking alert above the list
 *                     and show ALL lots (incl. zero-quantity / out-of-stock)
 *                     so the card totals and the table use the same dataset.
 *   showStockStatus — add the Stock Status column + the stock-status filter.
 *   hideReceive     — hide the Receive Lot button (Create Lot is kept).
 *   paginate        — paginate the table (10/page) with Prev/Next + page numbers.
 *   showBatchNo     — add the Batch No. column + the Batch Number field in Create Lot.
 *   fluid           — widen the page: drop the max-w-7xl cap + reduce inner padding.
 *   requireWarehouse— Create/Receive Lot: make Warehouse mandatory (Unassigned
 *                     shown but disabled). Company + Company Warehouse only.
 *   hideCreate      — hide the Create Lot button (Receive Lot is kept). Company
 *                     Warehouse only: a warehouse receives stock, it never mints
 *                     a new lot — that stays with the main Company.
 *   receiveTransfer — Company Warehouse only: "Receive Lot" scans an incoming
 *                     PARENT LOT and confirms the transfer (stock arrives here)
 *                     instead of stocking in a brand-new lot.
 *   originalRegister— MAIN COMPANY only: render as the ORIGINAL LOT REGISTER —
 *                     list only lots the Company itself minted (lotOrigin
 *                     "company", so transfer-landed destination copies, warehouse
 *                     Receive-Lot and GRN lots are excluded) and read the
 *                     immutable originalQuantity instead of live stock. Off for
 *                     every other role, so the Company Warehouse view keeps
 *                     showing live balances exactly as before.
 */
const ImsLots = ({
  showSummary = false, showStockStatus = false, hideReceive = false,
  paginate = false, showBatchNo = false, fluid = false, requireWarehouse = false,
  hideCreate = false, receiveTransfer = false, originalRegister = false,
} = {}) => {
  const navigate = useNavigate();
  const [lots, setLots] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  // Destination options for transfers: ALL company warehouses (directory),
  // not just the caller's scoped list — a Katni manager sends to Khargone.
  const [warehouseDir, setWarehouseDir] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all'); // 'all'|STATUS.IN|STATUS.LOW|STATUS.OUT (Company view)
  const [page, setPage] = useState(1); // Company pagination (1-based)
  const [modal, setModal] = useState(null); // { type: 'receive'|'transfer'|'label', lot? }

  // ── LOT-CREATION GATE ──
  // A lot always lives in a warehouse, so Create Lot / Receive Lot (both POST
  // /lots/receive) stay locked until the company has at least one warehouse.
  // Reads the company-wide warehouse directory, so a warehouse-scoped user is
  // never wrongly blocked. `checked` guards against a false block while the
  // lookup is still in flight; the backend enforces the same rule for real
  // (middlewares/requireWarehouseExists.js), so this is UX, never the guarantee.
  const { checked: whChecked, hasWarehouse } = useHasWarehouse();
  const lotCreationBlocked = whChecked && !hasWarehouse;

  // Open a lot modal, or explain the gate and offer the way out of it.
  // 'receive-transfer' is a CONFIRMATION of an incoming lot, not a creation,
  // so it is deliberately never gated here.
  const openLotModal = (type) => {
    if (lotCreationBlocked && (type === 'create' || type === 'receive')) {
      Swal.fire({
        icon: 'warning',
        title: 'Warehouse required',
        text: 'Please create a Warehouse first before creating a Lot.',
        showCancelButton: true,
        confirmButtonText: 'Create Warehouse',
        cancelButtonText: 'Close',
        confirmButtonColor: '#EA2831',
      }).then((r) => { if (r.isConfirmed) navigate('/warehouses?new=1'); });
      return;
    }
    setModal({ type });
  };

  const refresh = () =>
    // The register asks the API for Company-minted lots only; every other caller
    // sends no filter and gets the full live list, unchanged.
    getLots(originalRegister ? { lotOrigin: 'company' } : {})
      .then((res) => res?.success && setLots(res.data))
      .catch(apiError)
      .finally(() => setLoading(false));

  useEffect(() => {
    refresh();
    getWarehouses().then((r) => r?.success && setWarehouses(r.data)).catch(() => {});
    getWarehouseDirectory().then((r) => setWarehouseDir(Array.isArray(r) ? r : r?.data || [])).catch(() => {});
    getProducts().then((r) => setProducts(r?.data || r?.products || [])).catch(() => {});
  }, []);

  /**
   * A lot this warehouse no longer holds any of. Its record STAYS in the
   * database for traceability — it is only hidden from the working list, and
   * the "Zero quantity" filter below brings it back.
   *
   * Read from live stock, never from the original register: a lot created with
   * 100 that has all 100 dispatched away is empty HERE even though its created
   * quantity is still 100.
   */
  const isEmptyHere = (l) => Number(l.availableStock || 0) <= 0 && Number(l.inTransitStock || 0) <= 0;

  const visible = useMemo(() => {
    // Company view (showSummary) lists every lot the register knows; other roles
    // keep the original live-only behaviour. EITHER WAY a lot with nothing left
    // at this warehouse is hidden by default — it is finished business, not
    // working stock — unless the operator asks for exactly those.
    let out = showSummary ? lots.slice() : lots.filter((l) => l.availableStock > 0);
    out = stockFilter === STOCK_ZERO ? out.filter(isEmptyHere) : out.filter((l) => !isEmptyHere(l));
    if (filter === 'expiring') out = out.filter((l) => { const d = daysToExpiry(l.expiryDate); return d !== null && d >= 0 && d <= 90; });
    else if (filter === 'expired') out = out.filter((l) => daysToExpiry(l.expiryDate) < 0);
    if (showStockStatus && stockFilter !== 'all' && stockFilter !== STOCK_ZERO) {
      out = out.filter((l) => statusFor(l, originalRegister) === stockFilter);
    }
    return out;
  }, [lots, filter, stockFilter, showSummary, showStockStatus, originalRegister]);

  // The lots the SUMMARY CARDS describe — the same set the table works on, so a
  // hidden zero-quantity lot is not counted in Total Lots, Units in Stock or
  // Total Stock Value either.
  const countedLots = useMemo(() => lots.filter((l) => !isEmptyHere(l)), [lots]);

  // Company summary — reuse the SAME shared helper the dashboard uses, over the
  // SAME lot dataset, so the numbers can never disagree. No dummy/duplicated maths.
  const rows = useMemo(
    () =>
      countedLots.map((l) => {
        const p = l.productId || {};
        return {
          id: l._id,
          // Register: the ORIGINAL created quantity, so "Units in Stock" and
          // "Total Stock Value" describe the lots as created, not as they stand
          // now. An unproven row contributes 0 rather than a guess.
          stock: qtyFor(l, originalRegister) ?? 0,
          reorderLevel: l.lowStockThreshold || 0,
          price: p.mrp || 0,
        };
      }),
    [countedLots, originalRegister]
  );
  const summary = useMemo(() => computeInventorySummary(rows), [rows]);

  // Pagination (Company only) — applied AFTER all filters, on the filtered
  // `visible` set. Filter changes reset to page 1 via the handlers below.
  const totalPages = paginate ? Math.max(1, Math.ceil(visible.length / PAGE_SIZE)) : 1;
  const currentPage = Math.min(page, totalPages);
  const paged = paginate ? visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) : visible;
  const rangeStart = visible.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, visible.length);

  return (
    <div className={`flex-1 overflow-y-auto bg-white font-sora ${fluid ? 'p-2 sm:p-4' : 'p-4 sm:p-8'}`}>
      <div className={`space-y-6 ${fluid ? 'max-w-none' : 'max-w-7xl mx-auto'}`}>

        {/* Summary cards (Company) — COMPUTED from the live lots with the shared
            helper, so they match the dashboard exactly. */}
        {showSummary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {[
              { label: 'Total Lots', value: summary.total },
              { label: 'Low / Out of Stock', value: summary.lowStock + summary.outOfStock },
              { label: 'Units in Stock', value: rows.reduce((s, r) => s + r.stock, 0).toLocaleString('en-IN') },
              { label: 'Total Stock Value', value: formatINR(summary.stockValue) },
            ].map((stat, i) => (
              <div key={i} className="min-w-0 bg-white border border-stone-200 rounded-xl p-5 sm:p-6 shadow-sm">
                <p className="text-stone-500 text-[10px] font-bold uppercase mb-2 tracking-wider">{stat.label}</p>
                <p className="text-xl sm:text-2xl lg:text-3xl font-bold text-stone-900 break-words leading-tight tabular-nums">{stat.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Lot-creation gate — shown only once the check has actually run. */}
        {lotCreationBlocked && <NoWarehouseNotice compact />}

        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {[['all', 'All Lots'], ['expiring', 'Expiring ≤ 90d'], ['expired', 'Expired']].map(([k, label]) => (
              <button
                key={k}
                onClick={() => { setFilter(k); setPage(1); }}
                className={`text-xs font-bold px-4 py-2 rounded-full border transition-colors ${
                  filter === k
                    ? 'bg-[#EA2831] border-[#EA2831] text-white'
                    : 'border-stone-200 text-stone-500 hover:bg-stone-50'
                }`}
              >
                {label}
              </button>
            ))}
            {/* Stock-status filter (Company) — operates on the SAME lot dataset and
                the SAME statusOf rule as the cards, so "Low/Out" here == the card. */}
            {showStockStatus && (
              <select
                value={stockFilter}
                onChange={(e) => { setStockFilter(e.target.value); setPage(1); }}
                className="text-xs font-bold border border-stone-200 rounded-full px-4 py-2 bg-white text-stone-600 focus:ring-[#EA2831]"
                aria-label="Filter by stock status"
              >
                <option value="all">All Stock Status</option>
                <option value={STATUS.IN}>In Stock</option>
                <option value={STATUS.LOW}>Low Stock</option>
                <option value={STATUS.OUT}>Out of Stock</option>
                {/* The lots hidden from every other view — nothing left at this
                    warehouse. The records still exist; this is how you reach
                    them. */}
                <option value={STOCK_ZERO}>Zero quantity (moved out)</option>
              </select>
            )}
          </div>
          {/* Create + Receive — both available to admin AND operations manager
              (anyone holding lot:receive). Create = manual lot; Receive = scan.
              hideReceive (main Company) hides Receive Lot only; hideCreate
              (Company Warehouse) hides Create Lot only. Neither is removed for
              any other role, and the underlying modal/API are untouched. */}
          <Can capability="lot:receive">
            <div className="flex gap-2">
              {!hideCreate && (
                <GhostBtn onClick={() => openLotModal('create')} title={lotCreationBlocked ? 'Create a warehouse first' : undefined}
                  className={lotCreationBlocked ? 'opacity-50' : ''}>
                  <span className="material-symbols-outlined text-base">add_box</span> Create Lot
                </GhostBtn>
              )}
              {!hideReceive && (
                <PrimaryBtn onClick={() => openLotModal(receiveTransfer ? 'receive-transfer' : 'receive')}
                  title={lotCreationBlocked && !receiveTransfer ? 'Create a warehouse first' : undefined}
                  className={lotCreationBlocked && !receiveTransfer ? 'opacity-50' : ''}>
                  <span className="material-symbols-outlined text-base">qr_code_scanner</span> Receive Lot
                </PrimaryBtn>
              )}
            </div>
          </Can>
        </div>

        {/* Record count — the list is never silently truncated */}
        {showSummary && !loading && (
          <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
            {paginate
              ? `Showing ${rangeStart}–${rangeEnd} of ${visible.length} lots`
              : `Showing ${visible.length} of ${lots.length} lots`}
          </p>
        )}

        {/* Table */}
        <div className="border border-stone-200 rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="overflow-x-auto no-scrollbar">
            <table className={`w-full text-left border-collapse resp-table ${showBatchNo ? 'min-w-[1150px]' : 'min-w-[1000px]'}`}>
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200">
                  <Th>Lot No.</Th><Th>Product</Th><Th>Warehouse</Th>
                  <Th>Mfg</Th><Th>Expiry</Th><Th>Qty</Th>
                  {showStockStatus && <Th>Stock Status</Th>}
                  <Th>{showStockStatus ? 'Expiry Status' : 'Status'}</Th><Th right>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paged.map((lot) => {
                  const p = lot.productId || {};
                  const badge = expiryBadge(lot.expiryDate);
                  const qty = qtyFor(lot, originalRegister);
                  const stock = statusFor(lot, originalRegister);
                  const stockCls =
                    stock === STATUS.IN ? 'bg-green-50 text-green-700'
                    : stock === STATUS.LOW ? 'bg-orange-50 text-orange-600'
                    : stock === null ? 'bg-stone-100 text-stone-500'
                    : 'bg-red-50 text-red-600';
                  return (
                    <tr key={lot._id} className="hover:bg-stone-50/30 transition-colors">
                      <td className="px-6 py-5" data-label="Lot No.">
                        <span className="text-xs font-bold bg-stone-100 text-stone-600 px-2.5 py-1 rounded-full">
                          {lot.lotNumber || lot.batchNumber}
                        </span>
                        {/* How the lot is physically packed — boxes vs one package. */}
                        <span className="block mt-1 text-[10px] font-bold uppercase tracking-wide text-stone-400">
                          {packagingLabel(lot)}
                        </span>
                      </td>
                      {/* {showBatchNo && (
                        <td className="px-6 py-5 text-sm text-stone-500 font-medium" data-label="Batch No.">
                          {lot.mfgBatchNo || '—'}
                        </td>
                      )} */}
                      <td className="px-6 py-5" data-label="Product">
                        <p className="font-bold text-stone-900 text-sm">{p.productName || '—'}</p>
                        <p className="text-[10px] font-bold text-stone-400 uppercase">{p.category || ''}</p>
                      </td>
                      <td className="px-6 py-5 text-sm text-stone-500 font-medium" data-label="Warehouse">{lot.warehouseId?.name || 'Unassigned'}</td>
                      <td className="px-6 py-5 text-sm text-stone-500 font-medium" data-label="Mfg">{fmtDate(lot.mfgDate)}</td>
                      <td className="px-6 py-5 text-sm text-stone-500 font-medium" data-label="Expiry">{fmtDate(lot.expiryDate)}</td>
                      <td className="px-6 py-5 text-sm text-stone-900 font-bold" data-label="Qty">
                        {qty === null ? '—' : qty.toLocaleString('en-IN')}
                        {/* Only ever set on a lot the destination warehouse hasn't
                            confirmed yet — a warehouse never sees these rows. */}
                        {lot.inTransitStock > 0 && (
                          <span className="block text-[10px] font-bold text-amber-600 uppercase tracking-wide">
                            Awaiting receipt
                          </span>
                        )}
                      </td>
                      {showStockStatus && (
                        <td className="px-6 py-5" data-label="Stock Status">
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${stockCls}`}>{stock ?? 'Unknown'}</span>
                        </td>
                      )}
                      <td className="px-6 py-5" data-label={showStockStatus ? 'Expiry Status' : 'Status'}>
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-6 py-5 cell-actions">
                        {/* flex-wrap only: the extra View button must not force
                            the Actions column wider or push the row layout. */}
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {/* Everything ABOUT this lot — packaging, box IDs,
                              package-wise units, stock context and movement
                              history — lives on the read-only details page, so
                              this table keeps exactly the columns it had. */}
                          <GhostBtn onClick={() => navigate(`/ims/lots/${lot._id}`)}>
                            <span className="material-symbols-outlined text-sm">visibility</span> View
                          </GhostBtn>
                          {/* <Can capability="inventory:transfer">
                            <GhostBtn onClick={() => setModal({ type: 'transfer', lot })}>
                              <span className="material-symbols-outlined text-sm">sync_alt</span> Transfer
                            </GhostBtn>
                          </Can> */}
                          <GhostBtn onClick={() => navigate(`/ims/labels?lot=${lot._id}`)}>
                            <span className="material-symbols-outlined text-sm">qr_code_2</span> Label
                          </GhostBtn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && visible.length === 0 && (
                  <tr><td colSpan={8 + (showStockStatus ? 1 : 0) + (showBatchNo ? 1 : 0)} className="px-6 py-12 text-center text-sm text-stone-400">No lots here.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination (Company) — frontend paging over the filtered lot set */}
        {paginate && !loading && visible.length > 0 && totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
              Showing {rangeStart}–{rangeEnd} of {visible.length} lots
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((n) => Math.max(1, n - 1))}
                disabled={currentPage <= 1}
                className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-base">chevron_left</span> Previous
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  className={`min-w-[36px] text-xs font-bold px-3 py-2 rounded-lg border transition-colors ${
                    n === currentPage
                      ? 'bg-[#EA2831] border-[#EA2831] text-white'
                      : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {n}
                </button>
              ))}
              <button
                onClick={() => setPage((n) => Math.min(totalPages, n + 1))}
                disabled={currentPage >= totalPages}
                className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <span className="material-symbols-outlined text-base">chevron_right</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {(modal?.type === 'receive' || modal?.type === 'create') && (
        <ReceiveLotModal products={products} warehouses={warehouses} lots={lots} scanFirst={modal.type === 'receive'}
          showBatchNo={showBatchNo} requireWarehouse={requireWarehouse}
          onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />
      )}
      {modal?.type === 'receive-transfer' && (
        <ReceiveTransferModal onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />
      )}
      {modal?.type === 'transfer' && (
        <TransferModal lot={modal.lot} warehouses={warehouseDir.length ? warehouseDir : warehouses}
          onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />
      )}
    </div>
  );
};

/* ---------- modals ---------- */

const Detail = ({ label, value }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
    <p className="text-sm text-stone-800 font-medium break-words">{value == null || value === '' ? '—' : value}</p>
  </div>
);

/**
 * RECEIVE LOT (Company Warehouse) — scan an incoming PARENT LOT booked to THIS
 * warehouse and confirm it onto the books.
 *
 * The scan only LOOKS UP the pending lot or box (read-only, EXACT match on the
 * stored identifier — the code is trimmed and never parsed, so a manually
 * composed number containing "/" or "~", or any number of segments, resolves
 * exactly like a Khetify-generated one).
 * Nothing moves on lot creation, on opening this modal, or on
 * a successful scan. The quantity lands solely in
 * POST /lots/:id/confirm-receipt (lotService.confirmLotReceipt) — one atomic
 * operation that also activates the lot's already-generated child units.
 * Confirm Receive stays disabled until an exact lot is verified, and a repeat
 * confirm is rejected ("already received"), so qty can never be added twice.
 */
const ReceiveTransferModal = ({ onClose, onDone }) => {
  const [found, setFound] = useState(null);   // a whole single-package lot
  const [box, setBox] = useState(null);       // ONE bulk-packaging box
  const [busy, setBusy] = useState(false);

  const onScan = async (raw) => {
    // TRIM ONLY. The scanned string is looked up as-is against the identifiers
    // in the database — it is never parsed, split or pattern-matched.
    //
    // It used to be routed by testing the code against the Khetify shape
    // (/-BP-?\d+$/ → a box, anything else → a lot). That is exactly what broke
    // manually composed numbers: they carry "/" and "~", have no fixed segment
    // count and need not end in digits, so a real box ID was sent to the lot
    // lookup and 404'd. Which KIND of identifier it is, is now answered by the
    // database rather than guessed from its text.
    const code = String(raw || '').trim();
    if (!code) return;
    setFound(null);
    setBox(null);

    // Box first, then the whole lot. Only a "not found" falls through — an
    // already-received or cancelled box is a definitive answer about a real
    // box and must be reported, not retried as a lot. Trying the box first
    // also preserves the lot endpoint's own message when a boxed lot's PARENT
    // number is scanned ("scan each box separately").
    try {
      const r = await getIncomingBox(code);
      setBox(r?.data || null);
      return;
    } catch (err) {
      if (err?.response?.status !== 404) { apiError(err); return; }
    }

    try {
      const r = await getIncomingLot(code);
      setFound(r?.data || null);
    } catch (err) {
      // A boxed lot refuses the parent-lot scan and says how many boxes remain.
      apiError(err);
    }
  };

  const confirm = async () => {
    if (!found || busy) return;
    setBusy(true);
    try {
      await confirmLotReceipt(found.inventoryId);
      toast('success', 'Received into your warehouse');
      onDone();
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  // Receive exactly ONE box. The modal stays open so the operator can keep
  // scanning the rest of the boxes without reopening it.
  const confirmBox = async () => {
    if (!box || busy) return;
    setBusy(true);
    try {
      const r = await receiveBulkPackage(box.bulkPackagingId);
      const out = r?.data || {};
      toast('success', out.receivingStatus === 'received'
        ? `Final box received — lot ${out.lotNumber} fully received`
        : `Box ${out.boxSerial} received (${out.receivedUnits} units). ${out.packaging?.pendingBoxes ?? 0} box(es) still pending.`);
      setBox(null);
      if (out.receivingStatus === 'received') onDone();
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  return (
    <Modal title="Receive Lot" onClose={onClose} wide>
      <div className="mb-4 bg-stone-50 border border-stone-200 rounded-xl p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-2">Scan the lot or product barcode</p>
        <ScanBox onScan={onScan} placeholder="Scan or type the lot or Bulk Packaging ID, then Enter" />
        <p className="text-[11px] text-stone-400 mt-2">
          Single-package lot: scan the parent lot (e.g. KH-BHO-PRE482-2026-07-0001).
          A lot packed into boxes must be received one box at a time — scan each box’s
          Bulk Packaging ID (e.g. KH-BHO-PRE482-2026-07-0001-BP001).
          Nothing is added to your stock until you press Confirm Receive.
        </p>
      </div>

      {box && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 border border-stone-200 rounded-xl p-3">
            <Detail label="Bulk Packaging ID" value={box.bulkPackagingId} />
            <Detail label="Box" value={box.packaging ? `Box ${box.boxSerial} of ${box.packaging.totalBoxes}` : `Box ${box.boxSerial}`} />
            <Detail label="Units in this Box" value={Number(box.unitsInBox || 0).toLocaleString('en-IN')} />
            <Detail label="Parent Lot No." value={box.lotNumber} />
            <Detail label="Product" value={box.productName} />
            <Detail label="Product Code" value={box.productCode} />
            <Detail label="Destination Warehouse" value={box.destination} />
            <Detail label="Manufacturing Date" value={fmtDate(box.mfgDate)} />
            <Detail label="Expiry Date" value={fmtDate(box.expiryDate)} />
          </div>

          {box.packaging && (
            <p className="text-[11px] text-stone-500">
              Received so far: <b>{box.packaging.receivedBoxes}</b> of <b>{box.packaging.totalBoxes}</b> box(es)
              ({Number(box.packaging.receivedUnits).toLocaleString('en-IN')} units).
              Pending: <b>{Number(box.packaging.pendingUnits).toLocaleString('en-IN')}</b> units.
            </p>
          )}

          <PrimaryBtn disabled={busy} onClick={confirmBox}>
            <span className="material-symbols-outlined text-base">inventory_2</span>
            {busy ? 'Receiving…' : `Confirm Receive — Box ${box.boxSerial}`}
          </PrimaryBtn>
        </div>
      )}

      {found && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 border border-stone-200 rounded-xl p-3">
            <Detail label="Parent Lot No." value={found.lotNumber} />
            <Detail label="Product" value={found.productName} />
            <Detail label="Batch No." value={found.mfgBatchNo} />
            <Detail label="Destination Warehouse" value={found.destination} />
            <Detail label="Transfer Quantity" value={Number(found.qty || 0).toLocaleString('en-IN')} />
            <Detail label="Current Status" value={String(found.status || '').replace(/_/g, ' ')} />
            <Detail label="Manufacturing Date" value={fmtDate(found.mfgDate)} />
            <Detail label="Expiry Date" value={fmtDate(found.expiryDate)} />
          </div>

          <PrimaryBtn disabled={busy} onClick={confirm}>
            <span className="material-symbols-outlined text-base">inventory</span>
            {busy ? 'Receiving…' : 'Confirm Receive'}
          </PrimaryBtn>
        </div>
      )}
    </Modal>
  );
};

/**
 * The parts a lot number may be composed from.
 *
 * EVERY TICKED PART IS INSIDE THE LOT NUMBER ITSELF, at its badge position.
 * Nothing here is a suffix or a second level of identity — the lot number is the
 * whole assembled string.
 *
 * There are exactly two kinds of part:
 *
 *   VALUE part  — one input, printed as typed.
 *                 Year / Month / Date are read-only: they are derived from the
 *                 manufacturing date, which is the only place that truth lives.
 *   RANGE part  — `range: true`, and it is either VARIABLE or FIXED. Which one
 *                 is chosen on the part's own tick-box tile, so the choice sits
 *                 with the part rather than with the input:
 *
 *                 VARIABLE (the default) — a free-text Prefix and a Digits
 *                   width, printed as the SPAN of a numbered series:
 *                       <prefix><first> ~ <prefix><last>
 *                   Bulk Packaging spans 1 … box count, SKU spans 1 … the lot's
 *                   total unit quantity, and each box / unit then takes its own
 *                   member of that series.
 *                 FIXED — the single typed value, no span and no "~". It counts
 *                   nothing, so there is no width to pad to and the Digits input
 *                   is hidden; every box / unit repeats the same value.
 *
 *                 There is deliberately no built-in prefix such as "BP" — the
 *                 operator's own value is the only one used, all the way down to
 *                 the box and unit IDs the backend mints.
 *
 * SERIAL IS DELIBERATELY ABSENT. It is a lifetime running counter per (company,
 * product) that only the server can allocate — it is drawn atomically inside the
 * create transaction, so a browser could not know it without racing another
 * operator into a duplicate lot number. The server appends it last, exactly as
 * it does for the Khetify-generated option.
 *
 * Declared at module scope so React never remounts the inputs (that would drop
 * focus on every keystroke).
 */
const LOT_SEGMENTS = [
  { key: 'company', label: 'Company Code', placeholder: 'BHO' },
  { key: 'product', label: 'Product Code', placeholder: 'OPP247' },
  // Calendar parts: taken from the manufacturing date, never typed. Two dates
  // for one lot (one typed here, one in the date field) could disagree; one
  // cannot.
  { key: 'year',    label: 'Year',         derived: 'year' },
  { key: 'month',   label: 'Month',        derived: 'month' },
  { key: 'date',    label: 'Date',         derived: 'date' },
  { key: 'batch',   label: 'Batch Number', placeholder: 'B2026' },
  // Range parts. Ticking Bulk Packaging is ALSO this mode's answer to "is the
  // lot packed into boxes?", and so reveals the boxes / units-per-box fields.
  // The Khetify-generated mode has its own separate switch for that.
  // `spans` names WHICH count this range runs to, and `noun` how that count
  // reads in the hint under the input.
  {
    key: 'bulk', label: 'Bulk Packaging', range: true, spans: 'boxes',
    // With three levels on screen "Bulk Packaging" alone is ambiguous — it is
    // the OUTERMOST box — so the familiar name keeps its place and the new one
    // is added in brackets. Display only; the key and the stored config never
    // change.
    nestedLabel: 'Bulk Packaging (Main Box)',
    noun: ['box', 'boxes'], prefixPlaceholder: 'GP00AS',
  },
  // THE MIDDLE LEVEL. Only exists while "Inside bulk packaging" is ticked —
  // without it a lot has just main boxes and units, and this has nothing to
  // count (see `onlyWhenNested`).
  //
  // NAMED FOR WHAT IT NUMBERS, not for the setting that reveals it. It read
  // "Inside bulk packaging" — word for word the packaging checkbox under the
  // MAIN BOXES fields — so the tile looked like a duplicate of that setting
  // rather than a part of the number, and was left unticked. Every inner box
  // then took the identical ID and the second insert hit the unique index on
  // bulk_packaging_id (E11000).
  {
    key: 'inner', label: 'Inner Box', range: true, spans: 'inner',
    onlyWhenNested: true,
    noun: ['box per main box', 'boxes per main box'], prefixPlaceholder: 'IB',
  },
  {
    key: 'sku', label: 'SKU', range: true, spans: 'units',
    noun: ['unit', 'units'], prefixPlaceholder: 'UI',
  },
  // Kept last in this list so ticking straight down the picker lands it last,
  // which is where a catch-all usually belongs. It is not pinned there — the
  // input cells can be dragged into any order (see appendKey).
  { key: 'other',   label: 'Other',        placeholder: 'Any value' },
];

const SEGMENT_BY_KEY = LOT_SEGMENTS.reduce((m, s) => { m[s.key] = s; return m; }, {});

/**
 * HOVER HELP, keyed by part — ONE definition, read by both the tick-box tile and
 * that part's input, so the two can never describe the same part differently.
 *
 * English first, then the Hindi in brackets (Devanagari, not transliterated).
 * Used as `title` for the pointer and `aria-label` for a screen reader.
 */
const PART_HINTS = {
  company: 'Your company code (आपकी कंपनी का कोड)',
  product: "The selected product's code (चुने गए प्रोडक्ट का कोड)",
  year: 'Year from the manufacturing date (मैन्युफैक्चरिंग डेट का साल)',
  month: 'Month from the manufacturing date (मैन्युफैक्चरिंग डेट का महीना)',
  date: 'Day from the manufacturing date (मैन्युफैक्चरिंग डेट का दिन)',
  batch: 'Your batch number for this lot (इस लॉट का बैच नंबर)',
  bulk: 'ID for each box in this lot (लॉट के हर बॉक्स की आईडी)',
  inner: 'ID for each box inside a main package (मेन बॉक्स के अंदर हर बॉक्स की आईडी)',
  sku: 'ID for each unit inside a box (बॉक्स के अंदर हर यूनिट की आईडी)',
  other: 'Any extra value you want in the lot number (लॉट नंबर में कोई और वैल्यू)',
};

/**
 * The label a part shows RIGHT NOW. Only the outermost box changes: with a third
 * level on screen "Bulk Packaging" no longer says which box it means.
 */
const labelFor = (seg, nested) => (nested && seg?.nestedLabel ? seg.nestedLabel : seg?.label);

const REMEMBER_HINT = 'Save these values for the next lot (अगले लॉट के लिए ये वैल्यू सेव करें)';

/** The same, for the packaging counts. One source, read by label and input. */
const PACKAGING_HINTS = {
  mainPackages: 'How many main boxes in this lot (इस लॉट में कितने मेन बॉक्स)',
  boxesPerMain: 'How many boxes inside one main package (एक मेन बॉक्स में कितने बॉक्स)',
  unitsPerBox: 'How many units inside one box (एक बॉक्स में कितनी यूनिट)',
  insideBulk: 'Boxes packed inside a bigger package (बड़े पैकेज के अंदर पैक किए बॉक्स)',
};

/** A fresh three-level packaging entry — one per lot-number mode. */
const EMPTY_NESTED = { mainPackages: '', boxesPerMain: '', unitsPerBox: '' };

/** The look of a part input. Unchanged from the single-input row it replaces. */
const segmentInputCls =
  'rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-center text-sm font-mono font-bold tracking-wide text-stone-800 outline-none transition-colors placeholder:font-normal placeholder:tracking-normal placeholder:text-stone-300 focus:border-[#EA2831] focus:ring-1 focus:ring-[#EA2831]';

/**
 * HOW WIDE A RANGE PADS TO — derived, never typed.
 *
 * A range only ever has to number up to its own span, so the width is simply
 * what that span needs: 20 units fit in two digits, 1,000 need four. TWO is the
 * floor, so a short span still reads as an identifier ("BUL01") rather than a
 * bare digit, and it grows only when the count genuinely requires it — 100 boxes
 * pad to three, 1,000 to four, and a number is never truncated.
 *
 * Two, not three, so the manual builder matches the Khetify-generated shape,
 * which has always used a two-digit floor (lotNumberService.GENERATED_DIGITS).
 * The width travels with the segment to the server, so the preview and the
 * stored number are the same string by construction; lots minted at three
 * digits keep the width stored on their own recipe and are never rewritten.
 *
 * Recomputed on every render, so changing the box count or the quantity changes
 * the padding.
 */
const MIN_AUTO_DIGITS = 2;
const MAX_AUTO_DIGITS = 12;
const autoDigits = (span) => {
  const n = Math.max(0, Math.trunc(Number(span) || 0));
  return Math.min(MAX_AUTO_DIGITS, Math.max(MIN_AUTO_DIGITS, String(n).length));
};

/**
 * The two ways a range part can behave. "variable" is the default and the
 * historical behaviour; "fixed" turns the part into a plain constant.
 */
const RANGE_MODES = [
  { value: 'variable', label: 'Variable', hint: 'A different number for each one (हर एक का अलग नंबर)' },
  { value: 'fixed',    label: 'Fixed',    hint: 'The same value for all of them (सबके लिए एक ही वैल्यू)' },
];
const MODE_HINT = RANGE_MODES.reduce((m, x) => { m[x.value] = x.hint; return m; }, {});

/** One member of a range: <prefix><n zero-padded to the chosen width>. */
const rangeMember = (prefix, n, digits) =>
  `${String(prefix || '').trim().toUpperCase()}${String(Math.max(0, Math.trunc(n) || 0)).padStart(digits, '0')}`;

/**
 * ORDER IS THE OPERATOR'S. The badge number, the position in the number and the
 * position of the input cell are all one thing: the index in `manualOrder`,
 * which is rearranged by dragging the cells.
 *
 * Ticking a part appends it to the END; unticking removes it and everything
 * after it renumbers. Nothing is pinned — the earlier rule that forced "Other"
 * last existed only because tick order was the sole way to influence position,
 * and dragging supersedes it. "Other" is still the last TILE in the picker, so
 * ticking straight down the grid still lands it last by default.
 */
const appendKey = (order, key) => (order.includes(key) ? order : [...order, key]);

/**
 * Year / Month / Date read straight off the manufacturing date (yyyy-mm-dd), so
 * they can never contradict it. Empty until a date is chosen.
 */
const derivedValue = (seg, mfgDate) => {
  const [y, m, d] = String(mfgDate || '').split('-');
  if (seg.derived === 'year') return y || '';
  if (seg.derived === 'month') return m || '';
  if (seg.derived === 'date') return d || '';
  return '';
};

/** A range part either counts ("variable") or repeats one value ("fixed"). */
const isFixedRange = (ranges, key) => ranges?.[key]?.mode === 'fixed';

/**
 * How far a range part counts — one entry per level:
 *   boxes → the outermost boxes, inner → the boxes inside one of them,
 *   units → the lot's units.
 */
const spanOf = (seg, { boxCount, innerCount, unitCount }) => {
  if (seg?.spans === 'boxes') return Number(boxCount) || 0;
  if (seg?.spans === 'inner') return Number(innerCount) || 0;
  return Number(unitCount) || 0;
};

/**
 * The ONE thing a range part numbers, singular — "every main box", "every inner
 * box", "every unit". Read by the fixed-mode hint and by the collision messages,
 * so a part is described the same way wherever it is mentioned. The outermost
 * level is a "main box" only once there is a level below it to distinguish it
 * from, exactly as its label is (labelFor).
 */
const levelNoun = (seg, nested) => {
  if (seg?.spans === 'boxes') return nested ? 'main box' : 'box';
  if (seg?.spans === 'inner') return 'inner box';
  return 'unit';
};

/** What one ticked part contributes to the number, plus how to show it. */
const segmentText = (key, { vals, ranges, mfgDate, boxCount, innerCount, unitCount }) => {
  const seg = SEGMENT_BY_KEY[key];
  if (!seg) return '';
  if (seg.range) {
    const { prefix } = ranges[key] || {};
    // FIXED: the typed value alone — nothing is counted, so there is no span
    // and no width to pad to.
    if (isFixedRange(ranges, key)) return String(prefix || '').trim().toUpperCase();
    const last = spanOf(seg, { boxCount, innerCount, unitCount });
    if (!(last > 0)) return '';
    const width = autoDigits(last);
    return `${rangeMember(prefix, 1, width)}~${rangeMember(prefix, last, width)}`;
  }
  if (seg.derived) return derivedValue(seg, mfgDate);
  return String(vals[key] || '').trim();
};

/**
 * Remembered part setup — selection, order, typed values, prefixes and each
 * range's fixed/variable mode. Digit widths are NOT stored: they are derived
 * from the box count and quantity of whatever lot is being created.
 *
 * OPT-IN. Closing the modal throws every field away (the modal is unmounted, so
 * nothing survives on its own); this format is the single exception, and only
 * when the operator ticked "Remember for next lot". Without that tick nothing is
 * written and nothing is read back, so reopening shows a clean form.
 *
 * Best-effort only: a blocked or corrupt localStorage just means no memory.
 */
const PARTS_STORAGE_KEY = 'khetify.lotNumberParts.v1';

const emptyRanges = () =>
  LOT_SEGMENTS.filter((s) => s.range)
    .reduce((m, s) => { m[s.key] = { prefix: '', mode: 'variable' }; return m; }, {});

const readStoredParts = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(PARTS_STORAGE_KEY) || 'null');
    // No explicit "remember" flag → treat it as nothing to restore, so an entry
    // written before this was opt-in cannot silently pre-fill the form.
    if (!saved || saved.remember !== true || !Array.isArray(saved.order)) return null;
    // The stored order is the arrangement the operator dragged into place, so
    // it is restored verbatim — only unknown keys are dropped.
    const order = saved.order.filter((k) => SEGMENT_BY_KEY[k]);
    const vals = {};
    for (const [k, v] of Object.entries(saved.vals || {})) {
      // Derived parts are never restored — they belong to this lot's own date.
      if (SEGMENT_BY_KEY[k] && !SEGMENT_BY_KEY[k].derived && !SEGMENT_BY_KEY[k].range) vals[k] = String(v || '');
    }
    const ranges = emptyRanges();
    for (const [k, v] of Object.entries(saved.ranges || {})) {
      if (ranges[k]) {
        ranges[k] = {
          prefix: String(v?.prefix || ''),
          // Anything but an explicit "fixed" is the counting default. A `digits`
          // from an older stored config is ignored — the width is derived now.
          mode: v?.mode === 'fixed' ? 'fixed' : 'variable',
        };
      }
    }
    return { order, vals, ranges };
  } catch {
    return null;
  }
};

const writeStoredParts = (order, vals, ranges) => {
  try {
    localStorage.setItem(PARTS_STORAGE_KEY, JSON.stringify({ remember: true, order, vals, ranges }));
  } catch {
    /* storage unavailable — the builder still works, it just won't remember */
  }
};

/** Untick "Remember for next lot" and the format is dropped, not just ignored. */
const forgetStoredParts = () => {
  try {
    localStorage.removeItem(PARTS_STORAGE_KEY);
  } catch {
    /* nothing to do — there is simply no memory to clear */
  }
};

/**
 * The line under a VARIABLE range input, e.g.
 *   "GP00AS + 5 boxes → GP00AS001~GP00AS005"
 *   "UI + 1,000 units → UI0001~UI1000"
 *
 * It exists because the operator can no longer see the digit count anywhere: the
 * width is derived, so the only honest way to show it is the result itself.
 */
const rangeHint = (seg, prefix, span) => {
  const [one, many] = seg.noun || ['unit', 'units'];
  const n = Math.max(0, Math.trunc(Number(span) || 0));
  if (!n) return `Enter a prefix · pads to fit the ${one} count`;
  const width = autoDigits(n);
  const counted = `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
  const shown = String(prefix || '').trim().toUpperCase() || '…';
  return `${shown} + ${counted} → ${rangeMember(prefix, 1, width)}~${rangeMember(prefix, n, width)}`;
};

/** Nothing is being dragged. */
const NO_DRAG = { activeKey: null, overKey: null, side: null };

/**
 * ONE PART'S INPUT CELL.
 *
 * Declared at module scope, never inside the modal's render, so React keeps the
 * same DOM nodes between keystrokes — remounting would drop the caret out of the
 * field on every character.
 *
 * The LABEL ROW is the drag handle (grip icon included): the part is moved by
 * grabbing its name, never its input, so typing and selecting text inside the
 * field behave exactly as they always did. A part whose value is auto-filled and
 * read-only (Year / Month / Date) drags just the same — where it sits in the
 * number is a separate question from who fills it in.
 */
const PartCellBody = ({
  seg, index, vals, ranges, warnings, errors = {}, mfgDate, span = 0, nested = false,
  onValue, onRange, handleProps = {},
}) => {
  const key = seg.key;
  const range = !!seg.range;
  const derived = !!seg.derived;
  return (
    <>
      <div
        {...handleProps}
        // touch-none stops the browser claiming the gesture as a page scroll, so
        // the same press-and-drag works with a finger as with a mouse.
        className="flex touch-none select-none items-center justify-between gap-1 mb-1 cursor-grab active:cursor-grabbing"
      >
        <span className="flex min-w-0 items-center gap-1">
          <GripVertical className="size-3.5 shrink-0 text-stone-300" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 truncate">
            {labelFor(seg, nested)}
          </span>
        </span>
        <span className="text-[10px] font-bold text-stone-300 tabular-nums shrink-0">{index + 1}</span>
      </div>
      {/* The hover help sits on a WRAPPER, not the field: a non-editable input
          can swallow pointer events, so a tooltip hung on the input itself may
          never show for Year / Month / Date. The wrapper is a block, so it takes
          the cell's full width and changes no layout. Same text as this part's
          tile above (PART_HINTS). */}
      <span className="block" title={PART_HINTS[key]}>
        {range ? (
          // ONE input, like every other part. Whatever is typed is the value the
          // box and unit IDs carry too; the zero-padding width is derived from
          // the span (see autoDigits), so there is nothing to set.
          <input
            className={`${segmentInputCls} w-full`}
            value={ranges[key]?.prefix ?? ''}
            onChange={(e) => onRange(key, 'prefix', e.target.value)}
            placeholder={seg.prefixPlaceholder}
            title={PART_HINTS[key]}
            aria-label={PART_HINTS[key]}
          />
        ) : (
          <input
            className={`${segmentInputCls} w-full ${derived ? 'bg-stone-100 text-stone-500' : ''}`}
            value={derived ? derivedValue(seg, mfgDate) : (vals[key] || '')}
            onChange={(e) => onValue(key, e.target.value)}
            placeholder={derived ? '—' : seg.placeholder}
            // Calendar parts come from the manufacturing date, so they are shown
            // but never typed into.
            readOnly={derived}
            title={PART_HINTS[key]}
            aria-label={PART_HINTS[key]}
          />
        )}
      </span>
      {range && (
        <>
          {/* States the RESULT, since the width is no longer visible anywhere
              else: the prefix, what it spans, and the range that comes out. */}
          <p className="mt-1 text-[10px] text-stone-400 break-all">
            {isFixedRange(ranges, key)
              ? `Same value for every ${levelNoun(seg, nested)}`
              : rangeHint(seg, ranges[key]?.prefix, span)}
          </p>
          {/* A BLOCKING error outranks the advisory warning below: one shared ID
              across a level that holds more than one box/unit is not a choice,
              it is a duplicate key the server will refuse. */}
          {errors[key] ? (
            <p className="mt-1 text-[10px] font-medium text-[#EA2831]">{errors[key]}</p>
          ) : warnings[key] && (
            /* Not an error — one shared ID is a real choice here, so this only
               says what it costs. */
            <p className="mt-1 text-[10px] font-medium text-amber-600">{warnings[key]}</p>
          )}
        </>
      )}
    </>
  );
};

/**
 * The same cell, wired to dnd-kit. `dropSide` draws the insertion line on the
 * edge the dragged part would land against; the cell being dragged is dimmed in
 * place while the DragOverlay copy follows the cursor.
 */
const SortablePartCell = ({ dropSide, ...props }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.seg.key });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative min-w-0 ${isDragging ? 'opacity-40' : ''}`}
    >
      {dropSide && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 w-0.5 rounded-full bg-[#EA2831] ${
            dropSide === 'before' ? '-left-1.5' : '-right-1.5'
          }`}
        />
      )}
      <PartCellBody {...props} handleProps={{ ...attributes, ...listeners }} />
    </div>
  );
};

// Exported so the modal can be RENDERED on its own. It is opened from this
// page's internal state, so nothing outside could reach it — and a
// temporal-dead-zone crash inside its body (a const read above its own
// declaration) took the whole Inventory page down with no way to reproduce it
// short of clicking through the UI. Rendering it directly is that way.
export const ReceiveLotModal = ({ products, warehouses, lots = [], scanFirst = false, showBatchNo = false, requireWarehouse = false, onClose, onDone }) => {
  const [f, setF] = useState({
    // `qty` is NOT here — it is per lot-number mode (autoQty / manualQty below).
    productId: '', warehouseId: '', lotNumber: '', mfgBatchNo: '', mfgDate: '', expiryDate: '', lowStockThreshold: '',
    // Bulk Packaging — off by default, so the lot is one physical package.
    numberOfBoxes: '', unitsPerBox: '',
  });
  // A THIRD PACKAGING LEVEL — units inside boxes inside main packages.
  //
  // Off by default, and off means the two fields below behave exactly as they
  // always have. On, the operator states the three counts and the payload still
  // carries the two the API takes: numberOfBoxes = main × boxes-per-main. The
  // three raw values are kept in state for the real three-level save to come.
  //
  // ONE SET PER LOT-NUMBER MODE. The generated and hand-built modes are separate
  // answers to how a lot is packed, exactly as their Bulk Packaging switches are
  // (autoBulkPackaging vs the 'bulk' part), so they get their own state and
  // switching modes copies nothing across.
  const [autoNestedOn, setAutoNestedOn] = useState(false);
  const [autoNested, setAutoNested] = useState(EMPTY_NESTED);
  // Manual mode has no nested SWITCH of its own — the Inner Box part is the
  // switch (see insideBulk) — so only its counts are held here.
  const [manualNested, setManualNested] = useState(EMPTY_NESTED);

  // QUANTITY, one per lot-number mode. Deliberately NOT part of `f`: a value
  // typed in one mode must not be visible in the other, and sharing one field
  // is what made it leak.
  const [autoQty, setAutoQty] = useState('');
  const [manualQty, setManualQty] = useState('');

  // The part setup this company kept last time — and ONLY if it asked us to
  // (see readStoredParts). Read once, so the modal opens on that scheme.
  const [remembered] = useState(readStoredParts);
  // "Remember for next lot": the one and only thing that outlives the modal.
  // Pre-ticked when a remembered format was actually loaded.
  const [rememberFormat, setRememberFormat] = useState(() => !!remembered);
  // BULK PACKAGING, KHETIFY-GENERATED MODE ONLY.
  //
  // Manual mode has its OWN Bulk Packaging switch — the 'bulk' part in
  // manualOrder, which is part of the format being built. The two were one
  // variable and so ticked each other; they are now completely separate, and
  // `hasBulkPackaging` below simply reads whichever one the active mode owns.
  const [autoBulkPackaging, setAutoBulkPackaging] = useState(false);
  const [busy, setBusy] = useState(false); // prevents accidental duplicate submission

  // Live occupancy per warehouse (sum of availableStock across its lots) — the
  // same figure the Warehouses page shows. Used to pre-check capacity before we
  // hit the API; the backend enforces the same rule authoritatively.
  const occByWarehouse = useMemo(() => {
    const map = {};
    for (const l of lots) {
      const id = String(l.warehouseId?._id || l.warehouseId || '');
      if (!id) continue;
      map[id] = (map[id] || 0) + (l.availableStock > 0 ? l.availableStock : 0);
    }
    return map;
  }, [lots]);
  // After a successful create we switch the modal into a success state offering
  // one-tap label printing / unit-barcode generation for the new lot.
  const [created, setCreated] = useState(null);
  // Lot numbering: 'auto' → Khetify generates
  // KH-<COMPANY>-<PRODUCT CODE>-<YYYY>-<MM>-<SERIAL> on save;
  // 'manual' → the operator types the lot number.
  const [lotMode, setLotMode] = useState('auto');

  // WHICH MODE'S packaging answer is on screen. Reading through these is what
  // keeps the two independent: nothing below knows there are two sets.
  // MANUAL lot number, composed. `manualOrder` is the keys in TICK order (this
  // is what decides the badge order and the position inside the number);
  // `manualVals` holds what was typed into each value part, `manualRanges` the
  // prefix + digit width of each range part. f.lotNumber remains the assembled
  // string every existing check reads.
  //
  // All three start from the last lot's setup, so a company that always builds
  // the same scheme only has to choose it once.
  //
  // DECLARED HERE, ABOVE EVERY READER. `insideBulk` and `hasBulkPackaging` are
  // both answered by which PARTS are ticked, so they read `manualOrder` — and a
  // `const` read before its declaration is a temporal-dead-zone crash that takes
  // the whole page down, not a quiet undefined. This block has to stay above the
  // packaging derivations below.
  const [manualOrder, setManualOrder] = useState(() => remembered?.order || []);
  const [manualVals, setManualVals] = useState(() => remembered?.vals || {});
  const [manualRanges, setManualRanges] = useState(() => remembered?.ranges || emptyRanges());

  const nestedIsManual = lotMode === 'manual';
  // The active mode's QUANTITY. Everything below reads `qty` / writes `setQty`,
  // so no consumer knows there are two.
  const qty = nestedIsManual ? manualQty : autoQty;
  const setQty = nestedIsManual ? setManualQty : setAutoQty;
  /**
   * IS THERE A MIDDLE PACKAGING LEVEL?
   *
   * MANUAL mode: the Inner Box PART answers it. It used to be a separate
   * "Inside bulk packaging" checkbox sitting beside the packaging fields, so the
   * operator had to say the same thing twice — tick the part, and tick the box —
   * and the two could disagree. The part IS the level: if the number carries an
   * Inner Box part, the lot has inner boxes.
   *
   * GENERATED mode has no parts to tick, so it keeps its own checkbox.
   */
  const insideBulk = nestedIsManual ? manualOrder.includes('inner') : autoNestedOn;
  // Only the generated mode has a switch to set; manual mode's answer is its
  // Inner Box part, and the checkbox that read this is not rendered there.
  const setInsideBulk = setAutoNestedOn;
  const nested = nestedIsManual ? manualNested : autoNested;
  const setNested = nestedIsManual ? setManualNested : setAutoNested;
  const setNestedField = (key) => (e) =>
    setNested((prev) => ({ ...prev, [key]: e.target.value }));

  // The three counts. A blank or unusable entry READS AS 1, so the derived total
  // is always computable and these fields never block the save.
  const countOr1 = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : 1;
  };
  const mainPackages = countOr1(nested.mainPackages);
  const boxesPerMain = countOr1(nested.boxesPerMain);
  const nestedUnits = countOr1(nested.unitsPerBox);
  // Has the operator entered ANY of the three yet? Nothing entered means unset,
  // not "1" — the derived line stays quiet until there is something to derive.
  const nestedEntered = [nested.mainPackages, nested.boxesPerMain, nested.unitsPerBox]
    .some((v) => String(v ?? '').trim() !== '');

  // boxes × units-per-box must equal the lot quantity exactly. Computed live so
  // the operator sees the running total before they save; the backend re-checks
  // the same rule, so editing the quantity here changes nothing.
  //
  // With the third level on, "boxes" is main × boxes-per-main — the SAME two
  // figures the API has always taken, so everything downstream of here (the
  // total, the match check, the payload) is untouched by the extra level.
  const boxes = insideBulk ? mainPackages * boxesPerMain : Number(f.numberOfBoxes);
  const perBox = insideBulk ? nestedUnits : Number(f.unitsPerBox);
  const packedTotal = Number.isInteger(boxes) && Number.isInteger(perBox) && boxes > 0 && perBox > 0
    ? boxes * perBox
    : null;
  const packagingMatches = packedTotal !== null && packedTotal === Number(qty);

  /**
   * A packaging count the operator ACTUALLY ENTERED, as a positive whole number
   * — or null when the field is blank or unusable.
   *
   * countOr1 above reads a blank as 1 so the derived preview line always has
   * something to multiply. That is fine for a preview and WRONG for validation:
   * with "Inside bulk packaging" on, a blank Units per Box silently became 1, so
   * 2 × 3 × (blank) came to 6 — and a lot of quantity 6 then MATCHED, leaving
   * Create Lot enabled and posting unitsPerBox: 1 that nobody typed. Validation
   * therefore asks whether the field was filled in, never what it defaults to.
   */
  const enteredCount = (v) => {
    const raw = String(v ?? '').trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  const u = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Whether THIS lot is packed into boxes, answered by whichever mode is on
  // screen. Each mode owns its own answer; neither can set the other's.
  const hasBulkPackaging = lotMode === 'manual'
    ? manualOrder.includes('bulk')
    : autoBulkPackaging;

  // Which packaging fields are still missing. Every one of them is required the
  // moment bulk packaging is on — this is the list the button and the message
  // under the fields both read, so they cannot disagree.
  //
  // Declared HERE, below hasBulkPackaging, because it reads it: sitting above
  // the declaration it hit the temporal dead zone and crashed the whole page
  // with "Cannot access 'hasBulkPackaging' before initialization".
  const packagingMissing = !hasBulkPackaging ? [] : (insideBulk
    ? [['Main Boxes', nested.mainPackages], ['Boxes per Main Boxes', nested.boxesPerMain], ['Units per Box', nested.unitsPerBox]]
    : [['Number of Boxes', f.numberOfBoxes], ['Units per Box', f.unitsPerBox]]
  ).filter(([, v]) => enteredCount(v) === null).map(([label]) => label);

  // What each ticked part contributes right now, in order. A range part needs
  // its span — the box count for Bulk Packaging, the lot quantity for SKU — so
  // this recomputes as those fields are filled in.
  //
  // WHAT EACH LEVEL COUNTS TO comes from packagingSpans, which the server reads
  // too (lotNumberSegmentService.packagingSpans). Derived here in its own shape,
  // the preview and the stored number disagreed on a three-level lot; taking
  // both from one rule is what stops them drifting apart again. It is fed the
  // very numbers the payload carries — `boxes` is main × per-main, exactly what
  // is posted as numberOfBoxes — so the two can only ever see the same figures.
  const spanSource = packagingSpans({
    qty,
    numberOfBoxes: insideBulk ? boxes : Number(f.numberOfBoxes) || 0,
    ...(insideBulk ? { mainBoxes: mainPackages, boxesPerMain } : {}),
  });
  const piece = (key) => segmentText(key, {
    vals: manualVals,
    ranges: manualRanges,
    mfgDate: f.mfgDate,
    ...spanSource,
  });
  const pieces = manualOrder.map((key) => ({
    key,
    label: labelFor(SEGMENT_BY_KEY[key], insideBulk) || key,
    range: !!SEGMENT_BY_KEY[key]?.range,
    text: piece(key),
  }));
  const assembled = pieces.map((p) => p.text).filter(Boolean).join('-');

  // The assembled number IS f.lotNumber — the same field the payload, the
  // required-field check and the disabled state have always read. Recomputed
  // rather than pushed on every keystroke because two of the parts (the ranges)
  // depend on fields outside this panel. A scanner-captured code is left alone:
  // it is a complete number with no parts ticked.
  useEffect(() => {
    if (lotMode !== 'manual' || !manualOrder.length) return;
    setF((prev) => (prev.lotNumber === assembled ? prev : { ...prev, lotNumber: assembled }));
  }, [lotMode, manualOrder.length, assembled]);

  // Remember the setup for the next lot — ONLY while the operator asks for it.
  // Untick and the stored format is deleted, so the next open is a clean form.
  // Derived parts are excluded on read.
  useEffect(() => {
    if (rememberFormat) writeStoredParts(manualOrder, manualVals, manualRanges);
    else forgetStoredParts();
  }, [rememberFormat, manualOrder, manualVals, manualRanges]);

  // Tick appends to the END; untick removes only that part and everything after
  // it shifts up a badge. Where a part sits after that is decided by dragging.
  const toggleSegment = (key) => {
    let order, vals;
    if (manualOrder.includes(key)) {
      order = manualOrder.filter((k) => k !== key);
      vals = { ...manualVals };
      delete vals[key];
    } else {
      order = appendKey(manualOrder, key);
      vals = manualVals;
    }
    // Dropping the Bulk Packaging part also puts away the boxes / units-per-box
    // fields it reveals, so a stale value can never be submitted. It writes
    // nothing that the Khetify-generated mode can see.
    if (key === 'bulk' && !order.includes('bulk')) {
      setF((prev) => ({ ...prev, numberOfBoxes: '', unitsPerBox: '' }));
    }
    setManualOrder(order);
    setManualVals(vals);
    // Unticking the last part leaves nothing to assemble, and the effect above
    // stops running — clear the number here so no stale value survives.
    if (!order.length) setF((prev) => ({ ...prev, lotNumber: '' }));
  };

  // Which part is being dragged, which one it is over, and which edge of that
  // one the insertion line belongs on.
  const [drag, setDrag] = useState(NO_DRAG);
  // PointerSensor covers mouse, pen AND touch from one code path. The small
  // distance threshold is what lets a plain tap or click on the label row still
  // be a click rather than the start of a drag.
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const setSegmentValue = (key, value) => setManualVals({ ...manualVals, [key]: value });

  const setRangeField = (key, field, value) =>
    setManualRanges({
      ...manualRanges,
      [key]: { ...(manualRanges[key] || { prefix: '', mode: 'variable' }), [field]: value },
    });

  // How far each range part counts, for the hint under its input and for the
  // width the padding derives from.
  const spanFor = (seg) => spanOf(seg, spanSource);

  // AN INNER BOX NEEDS A BOX TO BE INSIDE. Unticking Bulk Packaging takes the
  // Inner Box part with it — out of the badges, the input row and the assembled
  // number together — and discards the counts that only that level uses, so a
  // hidden field can never be submitted. Keyed on manual mode's own selection,
  // so switching to the generated mode never disturbs this order.
  const manualBulkOn = manualOrder.includes('bulk');
  useEffect(() => {
    if (manualBulkOn) return;
    setManualOrder((prev) => (prev.includes('inner') ? prev.filter((k) => k !== 'inner') : prev));
    setManualNested(EMPTY_NESTED);
  }, [manualBulkOn]);

  // NO per-part validation remains. Every part is free text, read-only, or a
  // range whose width is derived — a range can no longer be too narrow for its
  // own span, which was the only thing this ever caught.

  // Is this number already in use? A manual number carries no serial, so the
  // parts alone have to be unique — nothing is appended to rescue a repeat.
  //
  // This is the QUICK answer, from the lots already loaded on the page, so the
  // operator is told before they press Save. It is not the guarantee: the
  // server re-checks against every lot and its unique index settles any race.
  const lotNumberTaken = useMemo(() => {
    if (lotMode !== 'manual') return false;
    const wanted = String(f.lotNumber || '').trim().toUpperCase();
    if (!wanted) return false;
    return lots.some((l) =>
      String(l.lotNumber || l.batchNumber || '').trim().toUpperCase() === wanted);
  }, [lotMode, f.lotNumber, lots]);

  /**
   * A PACKAGING LEVEL THAT HOLDS MORE THAN ONE THING NEEDS A COUNTING PART.
   *
   * Each level's ID is built from the ticked parts alone. If the level's own
   * part is missing — or is present but Fixed, which repeats one value — every
   * box or unit at that level is minted with the IDENTICAL id. The first insert
   * succeeds and the second dies on the unique index:
   *   E11000 duplicate key … bulk_packaging_id_1
   * which is exactly what a three-level lot hit with no Inner Box part ticked.
   *
   * So the counts on screen decide which parts are compulsory:
   *   MAIN BOXES > 1           → Bulk Packaging
   *   BOXES PER MAIN BOXES > 1 → Inner Box
   *   UNITS PER BOX > 1        → SKU
   * A level holding exactly one thing has nothing to tell apart and is exempt.
   */
  const levelRules = [
    { key: 'bulk', count: spanSource.boxCount },
    // Only a lot that HAS a middle level can be asked to number one.
    ...(insideBulk ? [{ key: 'inner', count: spanSource.innerCount }] : []),
    { key: 'sku', count: perBox },
  ];

  // Blocking, keyed by part — the same shape as the warnings below, so the cell
  // can render either from one place.
  const manualErrors = {};
  if (lotMode === 'manual') {
    for (const { key, count } of levelRules) {
      if (!(Number(count) > 1)) continue;
      const seg = SEGMENT_BY_KEY[key];
      const label = labelFor(seg, insideBulk);
      const noun = levelNoun(seg, insideBulk);
      if (!manualOrder.includes(key)) {
        manualErrors[key] = `Tick ${label} — without it every ${noun} would get the same ID.`;
      } else if (isFixedRange(manualRanges, key)) {
        // The Fixed warning, promoted: at this level it is not a preference,
        // it produces the same duplicate ID as leaving the part out.
        manualErrors[key] = `Set ${label} to Variable — Fixed gives every ${noun} the same ID.`;
      }
    }
  }
  const manualErrorList = Object.values(manualErrors);

  // A FIXED range over more than one box / unit means they all end up with the
  // same ID. Where that is NOT one of the levels above — a level of exactly one,
  // or the lot quantity behind a single-unit box — it stays a legitimate choice
  // (some companies genuinely label a whole lot with one code), so it only warns
  // and never blocks the save.
  const manualWarnings = useMemo(() => {
    const out = {};
    if (lotMode !== 'manual') return out;
    for (const key of manualOrder) {
      const seg = SEGMENT_BY_KEY[key];
      if (!seg?.range || !isFixedRange(manualRanges, key)) continue;
      // The part's OWN span — the level it numbers, not the box field, which is
      // empty on a three-level lot and so silenced this for main boxes.
      if (spanOf(seg, spanSource) > 1) {
        out[key] = `All ${levelNoun(seg, insideBulk)}s will share this ID and cannot be told apart.`;
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotMode, manualOrder, manualRanges, insideBulk,
      spanSource.boxCount, spanSource.innerCount, spanSource.unitCount]);

  // Scan a barcode / QR (USB scanner or device camera). If the code matches a
  // product SKU we auto-select that product; otherwise we treat it as the lot
  // number. Mirrors the scan flow used in warehouse transfers.
  const onScan = (code) => {
    const c = String(code || '').trim();
    if (!c) return;
    const norm = c.toLowerCase();
    const match = products.find(
      (p) => [p.skuNumber, p.barcode, p.hsnCode].filter(Boolean).some((v) => String(v).toLowerCase() === norm)
    );
    if (match) {
      setF((prev) => ({ ...prev, productId: match._id }));
      toast('success', `Product matched: ${match.productName}`);
    } else {
      // A scanned lot code is a manual lot number — surface the field.
      setLotMode('manual');
      setF((prev) => ({ ...prev, lotNumber: prev.lotNumber || c }));
      toast('success', `Lot code captured: ${c}`);
    }
  };

  const submit = async () => {
    if (busy) return; // guard against a double click while the request is in flight
    // Validate required data and surface a clear message when something's missing.
    if (!f.productId || !qty || Number(qty) <= 0 || !f.mfgDate || (lotMode === 'manual' && !f.lotNumber.trim())) {
      toast('error', 'Please fill Product, Quantity, Manufacturing Date' + (lotMode === 'manual' ? ' and Lot Number.' : '.'));
      return;
    }
    // A manual number is unique only if its parts are. Refuse the save and let
    // the operator change a part — never quietly append something to fix it.
    if (lotNumberTaken) {
      toast('error', 'This lot number already exists. Change one of the parts to make it unique.');
      return;
    }
    // A part missing (or Fixed) for a level that holds more than one thing would
    // mint the same ID for every box / unit at that level, which the unique
    // index rejects mid-save. Refuse it here, where the fix is one tick away.
    if (manualErrorList.length) {
      toast('error', manualErrorList[0]);
      return;
    }
    // Warehouse is mandatory for Company / Company Warehouse (Unassigned is a
    // disabled placeholder there). Never enforced for roles that don't opt in.
    if (requireWarehouse && !f.warehouseId) {
      toast('error', 'Please select a Warehouse.');
      return;
    }
    // Bulk Packaging: both fields required, positive whole numbers, and their
    // product must equal the lot quantity exactly.
    if (hasBulkPackaging) {
      if (!Number.isInteger(boxes) || boxes <= 0 || !Number.isInteger(perBox) || perBox <= 0) {
        toast('error', 'Number of boxes and units per box must be positive whole numbers.');
        return;
      }
      if (!packagingMatches) {
        toast('error', 'Number of boxes × units per box must be equal to the total lot quantity.');
        return;
      }
    }
    // Capacity pre-check: block a lot that would push the chosen warehouse past
    // its capacity, and tell the operator exactly how much room is left. The
    // backend enforces the same rule, so this is UX only, never the guarantee.
    const wh = warehouses.find((w) => String(w._id) === String(f.warehouseId));
    const capacity = Number(wh?.capacityUnits);
    if (f.warehouseId && Number.isFinite(capacity) && capacity > 0) {
      const current = occByWarehouse[String(f.warehouseId)] || 0;
      const space = capacity - current;
      if (Number(qty) > space) {
        toast('error', space > 0
          ? `Cannot add stock. Only ${space.toLocaleString('en-IN')} units space is available in this warehouse.`
          : 'Cannot add stock. Warehouse capacity is full. Available space is 0 units.');
        return;
      }
    }
    setBusy(true);
    try {
      const res = await receiveLot({
        productId: f.productId,
        // 'auto' → send undefined so the backend mints the Khetify lot number
        // (KH-<COMPANY>-<PRODUCT CODE>-<YYYY>-<MM>-<SERIAL>).
        // 'manual' splits two ways:
        //   parts ticked   → the PARTS are sent (lotSegments below) and the
        //                    server assembles the number and appends the serial.
        //                    The parts travel rather than the assembled string
        //                    so the backend can mint each box's and each unit's
        //                    single-value ID from the very same recipe.
        //   nothing ticked → a scanner-captured code is already a COMPLETE lot
        //                    number and is sent as-is, exactly as before.
        lotNumber: lotMode === 'manual' && manualOrder.length === 0
          ? (f.lotNumber.trim() || undefined)
          : undefined,
        lotSegments: lotMode === 'manual' && manualOrder.length > 0
          ? manualOrder.map((key) => {
              const seg = SEGMENT_BY_KEY[key];
              if (seg?.range) {
                const r = manualRanges[key] || {};
                return {
                  key,
                  type: 'range',
                  mode: r.mode === 'fixed' ? 'fixed' : 'variable',
                  prefix: String(r.prefix || '').trim(),
                  // Derived from the span, exactly as the preview derived it, so
                  // the server assembles the identical string.
                  digits: autoDigits(spanFor(seg)),
                };
              }
              return { key, type: 'value', value: piece(key) };
            })
          : undefined,
        // Manufacturer/supplier batch number — separate optional value; trimmed.
        // MANUAL mode only. In 'auto' the field isn't shown, so nothing is sent
        // and the backend leaves Inventory.mfgBatchNo unset (it already treats
        // the field as optional — no server change was needed for this).
        mfgBatchNo: lotMode === 'manual' ? (f.mfgBatchNo.trim() || undefined) : undefined,
        warehouseId: f.warehouseId || null,
        mfgDate: f.mfgDate || null,
        expiryDate: f.expiryDate || null,
        qty: Number(qty),
        lowStockThreshold: f.lowStockThreshold ? Number(f.lowStockThreshold) : undefined,
        // Bulk Packaging — omitted entirely when the checkbox is off, so a
        // single-package lot posts exactly the same body as before.
        ...(hasBulkPackaging
          ? {
            hasBulkPackaging: true,
            numberOfBoxes: boxes,
            unitsPerBox: perBox,
            // THREE LEVELS: numberOfBoxes stays the inner box count (main ×
            // per-main) so nothing downstream changes, and these two say how
            // they are grouped — which is what gives the lot number its own
            // main-box and inner-box ranges instead of one multiplied span.
            ...(insideBulk ? { mainBoxes: mainPackages, boxesPerMain } : {}),
          }
          : {}),
      });
      toast('success', 'Lot received into stock');
      const inv = res?.data;
      if (inv) {
        // Enrich with the chosen product (the API returns an unpopulated
        // productId) so the lot label renders name / brand / MRP immediately.
        const prod = products.find((p) => String(p._id) === String(f.productId));
        setCreated({ ...inv, productId: prod || inv.productId, bulkPackages: res?.bulkPackages || [] });
      } else {
        onDone();
      }
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  // EVERY reason Create Lot is refused, in one list.
  //
  // The button takes its disabled state straight from this, so what the operator
  // is told and what is actually enforced come from one place and cannot drift.
  const blockingReasons = [];
  if (!f.productId) blockingReasons.push('Select a product.');
  if (!qty) blockingReasons.push('Enter a quantity.');
  if (!f.mfgDate) blockingReasons.push('Enter the manufacturing date.');
  if (lotMode === 'manual' && !f.lotNumber) blockingReasons.push('Build the lot number — tick at least one part above.');
  if (lotNumberTaken) blockingReasons.push('This lot number already exists. Change one of the parts to make it unique.');
  // One entry per level that cannot be told apart — see manualErrors.
  blockingReasons.push(...manualErrorList);
  if (requireWarehouse && !f.warehouseId) blockingReasons.push('Select a warehouse.');
  // EVERY packaging field is required once bulk packaging is on. Named one by
  // one, because "the total does not match" is not an answer when the reason is
  // that a box was never filled in.
  for (const label of packagingMissing) {
    blockingReasons.push(`${label} is required — enter a whole number of 1 or more.`);
  }
  // The totals only get compared once there are real numbers to compare.
  if (hasBulkPackaging && !packagingMissing.length && !packagingMatches) {
    blockingReasons.push(insideBulk
      ? `${mainPackages} × ${boxesPerMain} × ${nestedUnits} = ${(packedTotal || 0).toLocaleString('en-IN')} units, but quantity is ${Number(qty || 0).toLocaleString('en-IN')}. These do not match.`
      : `Number of boxes × units per box must be equal to the total lot quantity (${Number(qty || 0).toLocaleString('en-IN')}).`);
  }

  // Success state: print the lot label and/or generate unit barcodes in place.
  if (created) return <CreatedLotSuccess lot={created} onDone={onDone} />;

  // Bulk Packaging tick-box for the KHETIFY-GENERATED mode, styled like a
  // lot-number part box. It reads and writes autoBulkPackaging and nothing else:
  // there is no number being built here, so it decides only whether box IDs are
  // minted. The manual mode's Bulk Packaging is a separate selection in the
  // part picker (LOT_SEGMENTS 'bulk'), and the two are independent.
  const bulkPackagingBox = (
    <label
      title="Enable this when the lot quantity is packed into multiple boxes."
      className={`flex min-h-[42px] items-center gap-2 rounded-lg border bg-white px-2.5 py-2 cursor-pointer transition-colors ${
        autoBulkPackaging ? 'border-[#EA2831]' : 'border-stone-200 hover:bg-stone-50'
      }`}
    >
      <input
        type="checkbox"
        className="size-4 shrink-0 accent-[#EA2831] cursor-pointer"
        checked={autoBulkPackaging}
        onChange={(e) => {
          // This mode's own switch. It decides whether box IDs are minted and
          // nothing else — the manual builder's Bulk Packaging part is a
          // separate selection that this never touches.
          setAutoBulkPackaging(e.target.checked);
          // Clear the box fields when switching off so a stale value can
          // never be submitted.
          if (!e.target.checked) setF((prev) => ({ ...prev, numberOfBoxes: '', unitsPerBox: '' }));
        }}
      />
      <span className="text-xs font-bold text-stone-700">Do You Need Bulk Packaging Ids</span>
    </label>
  );

  return (
    <Modal title={scanFirst ? 'Receive Lot — scan or enter' : 'Create Lot'} onClose={onClose} wide>
      {scanFirst && (
        <div className="mb-4 bg-stone-50 border border-stone-200 rounded-xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-2">Scan the lot or product barcode</p>
          <ScanBox onScan={onScan} placeholder="Scan barcode / QR, or type a code then Enter" />
          <p className="text-[11px] text-stone-400 mt-2">
            Use a USB scanner or the camera button. A matching product is selected automatically; any other code fills the lot number.
          </p>
        </div>
      )}
      <Field label="Product">
        <select className={inputCls} value={f.productId} onChange={u('productId')}>
          <option value="">Select product…</option>
          {products.map((p) => (
            <option key={p._id} value={p._id}>{p.productName} {p.packagingType ? `(${p.packagingType})` : ''}</option>
          ))}
        </select>
      </Field>

      <Field label="Lot Number">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setLotMode('auto');
              // Batch Number belongs to manual entry only, so clear it here as
              // well — the field is hidden below and must not leave a stale
              // value behind in state. The box fields go with it: they are the
              // OTHER mode's answer and must not carry over into this one.
              setF((prev) => ({ ...prev, lotNumber: '', mfgBatchNo: '', numberOfBoxes: '', unitsPerBox: '' }));
              // The composed parts themselves are kept — they are this modal's
              // draft of the manual format, and lotSegments is only ever sent
              // from manual mode.
            }}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-bold border transition-colors ${
              lotMode === 'auto'
                ? 'bg-[#EA2831] border-[#EA2831] text-white'
                : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
            }`}
          >
            <span className="material-symbols-outlined text-base">auto_awesome</span> Khetify-generated
          </button>
          <button
            type="button"
            onClick={() => {
              setLotMode('manual');
              // Nothing is copied in from the generated mode. Its Bulk
              // Packaging answer is its own; this mode's is the 'bulk' part in
              // the builder. Only the box fields are cleared, so the figures
              // typed for the other mode cannot show up here.
              setF((prev) => ({ ...prev, numberOfBoxes: '', unitsPerBox: '' }));
            }}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-bold border transition-colors ${
              lotMode === 'manual'
                ? 'bg-[#EA2831] border-[#EA2831] text-white'
                : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
            }`}
          >
            <span className="material-symbols-outlined text-base">keyboard</span> Enter manually
          </button>
        </div>
        {lotMode === 'manual' ? (
          <div className="mt-2 space-y-3">
            {/* Part picker — tick the parts this lot number should be built from.
                The number badge shows the position each part will take. */}
            <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  Select the parts of the lot number
                </p>
                {/* The one thing that outlives this modal. Everything else —
                    every tick, value, date and quantity — is thrown away when
                    the modal closes. */}
                <label
                  className="flex shrink-0 items-center gap-1.5 cursor-pointer"
                  title={REMEMBER_HINT}
                  aria-label={REMEMBER_HINT}
                >
                  <input
                    type="checkbox"
                    className="size-3.5 shrink-0 accent-[#EA2831] cursor-pointer"
                    checked={rememberFormat}
                    onChange={(e) => setRememberFormat(e.target.checked)}
                  />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                    Remember for next lot
                  </span>
                </label>
              </div>
              {/* Two columns, at every width: the range tiles carry a mode
                  dropdown as well as a label and a badge, and a third column
                  leaves too little room for "Bulk Packaging" to render whole. */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                {/* An inner box only exists inside a bulk packaging box, so the
                    tile appears once Bulk Packaging is ticked — not once the
                    lot is already nested, which is what this used to read and
                    which made the part impossible to tick in the first place. */}
                {LOT_SEGMENTS.filter((seg) => !seg.onlyWhenNested || manualBulkOn).map((seg) => {
                  const idx = manualOrder.indexOf(seg.key);
                  const on = idx !== -1;
                  return (
                    <label
                      key={seg.key}
                      // Same hover help as this part's input below — one source,
                      // so they cannot drift (PART_HINTS).
                      title={PART_HINTS[seg.key]}
                      aria-label={PART_HINTS[seg.key]}
                      // min-h holds every tile to the height of the tallest
                      // content (the mode select), so a row of tiles stays level
                      // whether or not the tile carries one.
                      className={`flex min-h-[42px] items-center gap-2 rounded-lg border bg-white px-2.5 py-2 cursor-pointer transition-colors ${
                        on ? 'border-[#EA2831]' : 'border-stone-200 hover:bg-stone-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-[#EA2831] cursor-pointer"
                        checked={on}
                        onChange={() => toggleSegment(seg.key)}
                      />
                      <span className="text-xs font-bold text-stone-700 whitespace-nowrap">{labelFor(seg, insideBulk)}</span>
                      {/* A range part chooses here whether it counts (a span, one
                          value per box/unit) or repeats one fixed value. Only
                          meaningful once the part is actually in the number, so
                          it appears with the tick. The clicks are stopped from
                          reaching the label, which would otherwise untick the
                          box the moment the dropdown is opened. */}
                      {on && seg.range && (
                        <select
                          className="h-6 shrink-0 cursor-pointer rounded border border-stone-300 bg-transparent px-1 text-[12px] font-medium text-stone-600 outline-none transition-colors focus:border-[#EA2831]"
                          value={manualRanges[seg.key]?.mode || 'variable'}
                          onChange={(e) => { e.stopPropagation(); setRangeField(seg.key, 'mode', e.target.value); }}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          // The hint follows the CHOSEN mode: hovering a closed
                          // <select> can only ever show one, and per-option
                          // titles are unreliable across browsers.
                          title={MODE_HINT[manualRanges[seg.key]?.mode || 'variable']}
                          aria-label={MODE_HINT[manualRanges[seg.key]?.mode || 'variable']}
                        >
                          {RANGE_MODES.map((m) => (
                            <option key={m.value} value={m.value} title={m.hint} aria-label={m.hint}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      )}
                      {on && (
                        <span className="ml-auto shrink-0 text-[10px] font-bold text-[#EA2831] tabular-nums">
                          {idx + 1}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              {/* WHY THE LOT CANNOT BE CREATED YET, right under the tiles that
                  fix it. An unticked part has no input cell to carry its own
                  message, so this is the only place the missing-part reason can
                  be read — and it names the tile to tick. */}
              {manualErrorList.length > 0 && (
                <ul className="mt-2 space-y-0.5 rounded-lg border border-[#EA2831]/30 bg-[#EA2831]/5 px-2.5 py-2">
                  {manualErrorList.map((reason) => (
                    <li key={reason} className="text-[11px] font-medium text-[#EA2831]">{reason}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* Part input cells — one per ticked part, in the operator's order.
                DRAG A CELL BY ITS LABEL ROW to move the part; the badge numbers
                and the preview below follow immediately, because all three read
                the same `manualOrder`. Three columns — these cells are narrower
                than the tiles above and deliberately do NOT line up with them:
                this row follows the chosen order, the tiles follow the fixed
                part order, so a column-for-column match would only ever be a
                coincidence. */}
            {manualOrder.length > 0 && (
              <DndContext
                sensors={dragSensors}
                collisionDetection={closestCenter}
                onDragStart={({ active }) => setDrag({ activeKey: active.id, overKey: null, side: null })}
                onDragOver={({ active, over }) => {
                  if (!over || over.id === active.id) {
                    setDrag((d) => ({ ...d, overKey: null, side: null }));
                    return;
                  }
                  // Moving forward lands AFTER the cell under the cursor,
                  // moving back lands BEFORE it — which is the edge the line
                  // is drawn on.
                  const from = manualOrder.indexOf(active.id);
                  const to = manualOrder.indexOf(over.id);
                  setDrag({ activeKey: active.id, overKey: over.id, side: from < to ? 'after' : 'before' });
                }}
                onDragCancel={() => setDrag(NO_DRAG)}
                onDragEnd={({ active, over }) => {
                  setDrag(NO_DRAG);
                  if (!over || active.id === over.id) return;
                  const from = manualOrder.indexOf(active.id);
                  const to = manualOrder.indexOf(over.id);
                  if (from < 0 || to < 0) return;
                  setManualOrder(arrayMove(manualOrder, from, to));
                }}
              >
                <SortableContext items={manualOrder} strategy={rectSortingStrategy}>
                  <div className="grid grid-cols-3 items-start gap-x-3 gap-y-2">
                    {manualOrder.map((key, i) => (
                      <SortablePartCell
                        key={key}
                        seg={SEGMENT_BY_KEY[key]}
                        index={i}
                        vals={manualVals}
                        ranges={manualRanges}
                        warnings={manualWarnings}
                        errors={manualErrors}
                        mfgDate={f.mfgDate}
                        span={spanFor(SEGMENT_BY_KEY[key])}
                        nested={insideBulk}
                        onValue={setSegmentValue}
                        onRange={setRangeField}
                        dropSide={drag.overKey === key ? drag.side : null}
                      />
                    ))}
                  </div>
                </SortableContext>
                {/* The copy that travels with the cursor. */}
                <DragOverlay dropAnimation={null}>
                  {drag.activeKey && (
                    <div className="rounded-lg border border-[#EA2831] bg-white p-2 shadow-lg">
                      <PartCellBody
                        seg={SEGMENT_BY_KEY[drag.activeKey]}
                        index={manualOrder.indexOf(drag.activeKey)}
                        vals={manualVals}
                        ranges={manualRanges}
                        warnings={manualWarnings}
                        errors={manualErrors}
                        mfgDate={f.mfgDate}
                        span={spanFor(SEGMENT_BY_KEY[drag.activeKey])}
                        nested={insideBulk}
                        onValue={setSegmentValue}
                        onRange={setRangeField}
                      />
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            )}

            {/* A code captured by the scanner fills the lot number directly, with
                no part ticked — keep it visible and editable exactly as before. */}
            {manualOrder.length === 0 && f.lotNumber && (
              <input
                className={inputCls}
                value={f.lotNumber}
                onChange={u('lotNumber')}
                placeholder="Enter the lot number for this received lot"
              />
            )}

            {/* Live preview — the number EXACTLY as it will be saved. Nothing is
                appended on the server in this mode, so what is shown here is the
                whole lot number. */}
            <div className="rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-0.5">
                Lot Number
              </p>
              <p className="font-mono text-sm break-all">
                {manualOrder.length === 0 ? (
                  <span className="font-bold text-stone-800">{f.lotNumber || '—'}</span>
                ) : (
                  <>
                    {pieces.map((p, i) => (
                      <React.Fragment key={p.key}>
                        {i > 0 && <span className="text-stone-300">-</span>}
                        {p.text ? (
                          // A range is the part that states a span rather than a
                          // single value, so it is called out in the string.
                          <span className={p.range
                            ? 'font-bold text-[#EA2831] bg-[#EA2831]/5 rounded px-0.5'
                            : 'font-bold text-stone-800'}
                          >
                            {p.text}
                          </span>
                        ) : (
                          <span className="text-stone-300 italic">{p.label.toLowerCase()}</span>
                        )}
                      </React.Fragment>
                    ))}
                  </>
                )}
              </p>
              {/* Nothing is auto-added to make a repeat unique, so a clash has
                  to be corrected by hand — say so where the number is read. */}
              {lotNumberTaken ? (
                <p className="text-[11px] font-medium text-[#EA2831] mt-1">
                  This lot number already exists. Change one of the parts to make it unique.
                </p>
              ) : (
                <p className="text-[11px] text-stone-400 mt-1">
                  {manualOrder.length > 0
                    ? 'Saved exactly as shown — this mode adds nothing of its own.'
                    : (f.lotNumber
                        ? 'Scanned code — saved exactly as shown.'
                        : 'Tick at least one part above.')}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-stone-400">
            Khetify will assign a unique number when you save:
            KH-&lt;COMPANY&gt;-&lt;PRODUCT CODE&gt;{hasBulkPackaging ? (insideBulk ? '-<MAIN BOX RANGE>-<INNER BOX RANGE>' : '-<BULK PACKAGING RANGE>') : ''}-&lt;YYYY&gt;-&lt;MM&gt;-&lt;DD&gt;-&lt;SKU RANGE&gt;-&lt;SERIAL&gt;
            {' '}— e.g.{' '}
            {hasBulkPackaging
              ? (insideBulk
                // The inner range spans ONE carton's boxes (20 in each of the
                // two here), not the lot's 40 — inner numbering restarts in
                // every carton, so 01~20 are the only inner numbers there are.
                ? 'KH-BHO-PRE607-BP01~BP02-BPinner01~BPinner20-2026-07-01-SKU01~SKU600-0002'
                : 'KH-BHO-PRE498-BP01~BP05-2026-07-25-SKU01~SKU1000-0001')
              : 'KH-BHO-PRE498-2026-07-25-SKU01~SKU1000-0001'}.
            {' '}The date comes from the Manufacturing Date, the SKU range spans the lot quantity
            {hasBulkPackaging ? ', and the Bulk Packaging range spans the boxes' : ''}.
            Each box and unit label carries a single value in place of a range.
          </p>
        )}
      </Field>

         {/* BULK PACKAGING — off by default. On, the lot is split into physical
          outer boxes, each with its own Bulk Packaging ID, and the warehouse
          receives it one box at a time instead of in a single confirm.
          In manual mode this box lives inside the part-picker grid above; here
          it covers the Khetify-generated mode, where that grid is not rendered. */}
      {lotMode !== 'manual' && (
        <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-3 mb-4">
          <div className="grid gap-x-3 gap-y-2">
            {bulkPackagingBox}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Manufacturing Date *"><input type="date" className={inputCls} value={f.mfgDate} onChange={u('mfgDate')} /></Field>
        <Field label="Expiry Date"><input type="date" className={inputCls} value={f.expiryDate} onChange={u('expiryDate')} /></Field>
        {/* Reads and writes THIS mode's quantity — never the shared form object. */}
        <Field label="Quantity *"><input type="number" min="1" className={inputCls} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label={requireWarehouse ? 'Warehouse *' : 'Warehouse'}>
          <select className={inputCls} value={f.warehouseId} onChange={u('warehouseId')}>
            {/* Unassigned stays visible but becomes a non-selectable placeholder
                when a warehouse is required (Company / Company Warehouse). */}
            <option value="" disabled={requireWarehouse}>Unassigned</option>
            {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
          </select>
        </Field>
      </div>
      {hasBulkPackaging && (
        <>
          {insideBulk ? (
            // THREE LEVELS. Each label names exactly what it counts — reusing
            // "Number of Boxes" for two of these would be unreadable.
            // The hover help sits on a WRAPPER so it covers the label as well as
            // the field. Strings come from PACKAGING_HINTS, alongside the ones
            // the lot-number parts read.
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 mt-3">
              <div title={PACKAGING_HINTS.mainPackages} aria-label={PACKAGING_HINTS.mainPackages}>
                <Field label="Main Boxes *">
                  <input
                    type="number" min="1" step="1" className={inputCls}
                    value={nested.mainPackages} onChange={setNestedField('mainPackages')}
                    placeholder="Outer Boxes in this lot"
                    title={PACKAGING_HINTS.mainPackages}
                    aria-label={PACKAGING_HINTS.mainPackages}
                  />
                </Field>
              </div>
              <div title={PACKAGING_HINTS.boxesPerMain} aria-label={PACKAGING_HINTS.boxesPerMain}>
                <Field label="Boxes per Main Boxes *">
                  <input
                    type="number" min="1" step="1" className={inputCls}
                    value={nested.boxesPerMain} onChange={setNestedField('boxesPerMain')}
                    placeholder="Boxes inside one main Boxes"
                    title={PACKAGING_HINTS.boxesPerMain}
                    aria-label={PACKAGING_HINTS.boxesPerMain}
                  />
                </Field>
              </div>
              <div title={PACKAGING_HINTS.unitsPerBox} aria-label={PACKAGING_HINTS.unitsPerBox}>
                <Field label="Units per Box *">
                  <input
                    type="number" min="1" step="1" className={inputCls}
                    value={nested.unitsPerBox} onChange={setNestedField('unitsPerBox')}
                    placeholder="Units inside one box"
                    title={PACKAGING_HINTS.unitsPerBox}
                    aria-label={PACKAGING_HINTS.unitsPerBox}
                  />
                </Field>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 mt-3">
              {/* MANUAL mode calls this "Main Boxes": the field belongs to the
                  Bulk Packaging part, and reads the same whether or not an
                  Inner Box level has been added under it. The generated mode
                  has no parts, so it keeps its own wording. */}
              <Field label={`${lotMode === 'manual' ? 'Main Boxes' : 'Number of Boxes'} *`}>
                <input
                  type="number" min="1" step="1" className={inputCls}
                  value={f.numberOfBoxes} onChange={u('numberOfBoxes')}
                  placeholder="Enter number of boxes"
                />
              </Field>
              <Field label="Units per Box *">
                <input
                  type="number" min="1" step="1" className={inputCls}
                  value={f.unitsPerBox} onChange={u('unitsPerBox')}
                  placeholder="Enter units in each box"
                />
              </Field>
            </div>
          )}

          {/* Adds the third level. Unticking DISCARDS this mode's three counts,
              so the two fields above come back to exactly what they held.
              GENERATED MODE ONLY. The manual builder has no use for it: ticking
              the Inner Box PART is what adds the level there, and asking for the
              same answer twice let the two disagree. */}
          {lotMode !== 'manual' && (
          <label
            className="flex items-start gap-2.5 cursor-pointer mb-1"
            title={PACKAGING_HINTS.insideBulk}
            aria-label={PACKAGING_HINTS.insideBulk}
          >
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-[#EA2831] cursor-pointer"
              checked={insideBulk}
              onChange={(e) => {
                setInsideBulk(e.target.checked);
                if (!e.target.checked) setNested(EMPTY_NESTED);
              }}
            />
            <span>
              <span className="block text-sm font-bold text-stone-800">Inside bulk packaging</span>
              {/* <span className="block text-[11px] text-stone-500">
                Tick when boxes are themselves packed into larger main packages.
              </span> */}
            </span>
          </label>
          )}

          {/* THE DERIVED TOTAL, and a WARNING when it disagrees with Quantity.
              The operator is told, but never stopped: this styles as a warning,
              not an error, nothing here disables Create Lot, and neither value
              is cleared or corrected. An entry not yet made is UNSET, so the
              line waits rather than reading "1 × 1 × 1". */}
          {/* A MISSING FIELD IS NAMED, never folded into the multiplication.
              This line used to read "2 × 3 × 1 = 6" with Units per Box left
              blank — the 1 was countOr1's placeholder, not anything the
              operator typed. */}
          {packagingMissing.length > 0 && (
            <p className="text-[11px] font-medium text-[#EA2831]">
              {packagingMissing.join(', ')} {packagingMissing.length > 1 ? 'are' : 'is'} required.
            </p>
          )}
          {insideBulk && !packagingMissing.length && nestedEntered && (
            <p className={`text-[11px] font-medium ${packagingMatches ? 'text-emerald-600' : 'text-[#EA2831]'}`}>
              {mainPackages} × {boxesPerMain} × {nestedUnits} = {packedTotal.toLocaleString('en-IN')} units
              {packagingMatches
                ? ' — matches the lot quantity.'
                : `, but quantity is ${Number(qty || 0).toLocaleString('en-IN')}. These do not match.`}
            </p>
          )}
          {!insideBulk && !packagingMissing.length && packedTotal !== null && (
            <p className={`text-[11px] font-medium ${packagingMatches ? 'text-emerald-600' : 'text-[#EA2831]'}`}>
              {boxes} × {perBox} = {packedTotal.toLocaleString('en-IN')}
              {packagingMatches
                ? ` — matches the lot quantity.`
                : ` — Number of boxes × units per box must be equal to the total lot quantity (${Number(qty || 0).toLocaleString('en-IN')}).`}
            </p>
          )}
        </>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 mt-[10px]">
        <Field label="Low-stock Alert At"><input type="number" className={inputCls} value={f.lowStockThreshold} onChange={u('lowStockThreshold')} placeholder="optional" /></Field>
      </div>

      {/* WHY the button is off — every outstanding reason, from the same list
          the button reads, so the two can never disagree. */}
      {/* {blockingReasons.length > 0 && (
        <div className="mb-3 rounded-lg border border-[#EA2831]/30 bg-[#EA2831]/5 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#EA2831] mb-1">
            Cannot create this lot yet
          </p>
          <ul className="list-disc pl-4 space-y-0.5">
            {blockingReasons.map((reason) => (
              <li key={reason} className="text-[11px] text-stone-700">{reason}</li>
            ))}
          </ul>
        </div>
      )} */}

      {/* The button says WHY it is off. The full list block above is currently
          commented out, so without this a disabled button gives no reason at
          all — which is how a missing Units per Box looked like a broken form. */}
      <PrimaryBtn
        disabled={busy || blockingReasons.length > 0}
        onClick={submit}
        title={blockingReasons.length ? blockingReasons.join('\n') : undefined}
      >
        <span className="material-symbols-outlined text-base">inventory</span> {busy ? 'Saving…' : (scanFirst ? 'Receive Lot' : 'Create Lot')}
      </PrimaryBtn>
    </Modal>
  );
};

const TransferModal = ({ lot, warehouses, onClose, onDone }) => {
  const srcId = String(lot.warehouseId?._id || lot.warehouseId || '');
  const dest = warehouses.filter((w) => String(w._id) !== srcId);
  // Dispatch now is ON by default — the sender creates AND dispatches in one
  // step and gets the manifest QR right here, never opening Operations.
  const [f, setF] = useState({ toWarehouseId: dest[0]?._id || '', qty: lot.availableStock, vehicleNo: '', driverName: '', driverPhone: '', dispatchNow: true });
  const [busy, setBusy] = useState(false);
  const [manifest, setManifest] = useState(null); // { qrPayload } once dispatched
  const submit = async () => {
    const destWh = warehouses.find((w) => String(w._id) === String(f.toWarehouseId));
    if (!destWh) return;
    setBusy(true);
    try {
      // Warehouse-to-warehouse transfers go through the full shipment workflow.
      // This creates a PLANNED transfer shipment; stock isn't deducted yet.
      const res = await createTmsShipment({
        refType: 'Transfer',
        toType: 'warehouse',
        fromWarehouseId: srcId || null,
        toWarehouseId: f.toWarehouseId,
        toLabel: destWh.name,
        lines: [{ inventoryId: lot._id, qty: Number(f.qty) }],
        // Optional transport details captured on this transfer. Additive:
        // the shipment model + create validator already accept these.
        vehicleNo: f.vehicleNo.trim() || undefined,
        driverName: f.driverName.trim() || undefined,
        driverPhone: f.driverPhone.trim() || undefined,
      });
      const id = res?.data?._id || res?._id;
      if (f.dispatchNow && id) {
        // Dispatch immediately: deducts source (in-transit) and mints the
        // manifest QR. The receiving code is pushed to the destination — we
        // only show the QR/barcode here for the sender to print/share.
        const dres = await dispatchShipment(id);
        const info = dres?.data || dres;
        toast('success', 'Transfer dispatched — stock is now in transit');
        setManifest({ qrPayload: info?.qrPayload });
        return; // keep the modal open showing the manifest; onDone runs on its close
      }
      toast('success', 'Transfer shipment created — dispatch it from Operations → Shipment Tracking');
      onDone();
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  // Once dispatched, swap the form for the manifest; closing it refreshes the list.
  if (manifest) return <ManifestModal info={manifest} onClose={onDone} />;

  return (
    <Modal title={`Transfer Lot ${lot.lotNumber || lot.batchNumber}`} onClose={onClose}>
      <p className="text-sm text-stone-500 mb-4">
        {lot.productId?.productName} — {lot.availableStock} units at {lot.warehouseId?.name || 'Unassigned'}
      </p>
      <Field label="Destination Warehouse" required>
        <select className={inputCls} value={f.toWarehouseId} onChange={(e) => setF({ ...f, toWarehouseId: e.target.value })}>
          <option value="">Select warehouse…</option>
          {dest.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
        </select>
      </Field>
      <Field label="Quantity" required>
        <input type="number" min="1" max={lot.availableStock} className={inputCls}
          value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
      </Field>
      {/* Transport details for this transfer (all optional). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-3">
        <Field label="Vehicle No." required>
          <input className={inputCls} value={f.vehicleNo} onChange={(e) => setF({ ...f, vehicleNo: e.target.value })} />
        </Field>
        <Field label="Driver" required>
          <input className={inputCls} value={f.driverName} onChange={(e) => setF({ ...f, driverName: e.target.value })} />
        </Field>
        <Field label="Driver phone" required>
          <input
            className={inputCls}
            type="tel"
            inputMode="numeric"
            maxLength={10}
            placeholder="10-digit number"
            value={f.driverPhone}
            onChange={(e) => setF({ ...f, driverPhone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
        <input type="checkbox" className="h-4 w-4 accent-[#EA2831]"
          checked={f.dispatchNow} onChange={(e) => setF({ ...f, dispatchNow: e.target.checked })} />
        <span className="text-sm font-medium text-stone-700">Dispatch now (print the shipping label here)</span>
      </label>
      <div className="text-[11px] text-stone-500 bg-stone-50 border border-stone-200 rounded-lg p-3 mb-4">
        {f.dispatchNow
          ? <>This <b>dispatches</b> the transfer immediately: stock moves in-transit and the shipping label appears here to print/share. The destination warehouse <b>scans the label to receive</b> it.</>
          : <>This creates a planned transfer shipment. Dispatch it later from Operations → Shipment Tracking; the destination then <b>scans the label to receive</b> it into stock.</>}
      </div>
      <PrimaryBtn disabled={!f.toWarehouseId || !f.qty || Number(f.qty) <= 0 || !f.vehicleNo.trim() || !f.driverName.trim() || !/^\d{10}$/.test(f.driverPhone.trim()) || busy} onClick={submit}>
        <span className="material-symbols-outlined text-base">local_shipping</span>
        {busy ? (f.dispatchNow ? 'Dispatching…' : 'Creating…') : (f.dispatchNow ? 'Dispatch Transfer' : 'Create Transfer Shipment')}
      </PrimaryBtn>
    </Modal>
  );
};


/* Print only the lot label / unit sheet, not the whole modal chrome. */
const CREATED_PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  #created-print, #created-print * { visibility: visible; }
  #created-print { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  @page { size: A4; margin: 8mm; }
}`;

const UNIT_LAYOUT = { cols: 5, w: 38, h: 21 }; // mirrors the ImsLabels "65/page" layout

/**
 * Shown right after Create Lot — the fewest-steps path to labels: print the lot
 * label and/or generate unit barcodes (prefilled to the lot quantity) and print
 * the unit sheet, without leaving the flow. Reuses the shared LotLabel and the
 * same Barcode128 unit layout as the Labels page.
 */
const CreatedLotSuccess = ({ lot, onDone }) => {
  // Prefill from the CREATED quantity — a lot sent to a warehouse for receipt
  // sits in inTransitStock, so availableStock alone would prefill 0.
  const [qty, setQty] = useState(String(lotQty(lot) || ''));
  const [units, setUnits] = useState([]);
  const [busy, setBusy] = useState(false);
  const code = lot.lotNumber || lot.batchNumber || '';

  // Bulk Packaging: the box IDs the create call minted. Kept STRICTLY separate
  // from unit barcodes — a box is an outer package, a unit is what's inside it,
  // and the two print as different labels.
  const bulkPackages = lot.bulkPackages || [];
  const hasBoxes = !!lot.has_bulk_packaging && bulkPackages.length > 0;
  // Which sheet the print button sends: the lot label or the box labels.
  const [printMode, setPrintMode] = useState('lot');

  const generate = async () => {
    const n = Number(qty);
    if (!n || n < 1) return;
    setBusy(true);
    try {
      await generateUnits({ inventoryId: lot._id, qty: n });
      const r = await getUnits({ inventoryId: lot._id });
      setUnits(Array.isArray(r) ? r : r?.data || []);
      toast('success', 'Unit barcodes generated');
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  const print = async () => {
    window.print();
    const serials = units.filter((x) => !x.printed).map((x) => x.serial);
    if (serials.length) { try { await markUnitsPrinted(serials); } catch { /* best-effort */ } }
  };

  return (
    <Modal title="Lot created" onClose={onDone} wide>
      <style>{CREATED_PRINT_CSS}</style>
      <div id="created-print">
        {/* One sheet at a time: the lot label OR the box labels. Unit barcodes
            append to the lot sheet exactly as before. */}
        {printMode === 'boxes' && hasBoxes ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {bulkPackages.map((box) => (
              <BulkPackageLabel key={box.bulk_packaging_id} box={box} lot={lot} totalBoxes={bulkPackages.length} />
            ))}
          </div>
        ) : (
          <LotLabel lot={lot} />
        )}
        {printMode !== 'boxes' && units.length > 0 && (
          <div className="mt-4" style={{ display: 'grid', gridTemplateColumns: `repeat(${UNIT_LAYOUT.cols}, ${UNIT_LAYOUT.w}mm)`, gap: '2mm' }}>
            {units.map((unit) => (
              <div key={unit.serial} style={{ width: `${UNIT_LAYOUT.w}mm`, height: `${UNIT_LAYOUT.h}mm` }}
                className="border border-stone-300 rounded-sm p-1 flex flex-col items-center justify-center overflow-hidden break-inside-avoid">
                <p className="text-[7px] font-bold text-stone-800 leading-tight text-center truncate w-full">{lot.productId?.productName || 'Item'}</p>
                <p className="text-[6px] text-stone-500 leading-tight">{unit.lotNumber}</p>
                <Barcode128 value={unit.serial} height={20} width={1} className="w-full" />
                <p className="text-[6px] font-mono text-stone-700 leading-tight">{unit.serial}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="no-print mt-4 space-y-3">
        <p className="text-sm text-stone-500">
          Lot <b className="font-mono">{code}</b> created with {lotQty(lot)} unit(s).
          {lot.inTransitStock > 0 && ' Awaiting the warehouse’s Receive confirmation.'}
        </p>

        {/* Bulk Packaging summary — what was actually minted for this lot. */}
        {hasBoxes && (
          <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-2">Bulk Packaging</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
              <Detail label="Lot Number" value={code} />
              <Detail label="Total Quantity" value={Number(lotQty(lot) || 0).toLocaleString('en-IN')} />
              {/* THREE LEVELS get three figures. `number_of_boxes` is the INNER
                  box count, so on its own it read as "Number of Boxes 40" and
                  hid the distinction between main and inner boxes. */}
              {lot.packaging_main_boxes ? (
                <>
                  <Detail label="Main Boxes" value={lot.packaging_main_boxes} />
                  <Detail label="Inner Boxes per Main Box" value={lot.packaging_boxes_per_main} />
                  <Detail label="Units per Box" value={lot.units_per_box} />
                </>
              ) : (
                <>
                  <Detail label="Number of Boxes" value={lot.number_of_boxes} />
                  <Detail label="Units per Box" value={lot.units_per_box} />
                </>
              )}
              {/* <Detail label="Bulk Packaging IDs generated" value={bulkPackages.length} /> */}
            </div>
            {/* <p className="text-[11px] text-stone-400 mt-2">
              The warehouse receives this lot by scanning each box’s Bulk Packaging ID — not the lot number.
            </p> */}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          {/* <Field label="Unit barcodes to generate">
            <input
              type="text" inputMode="numeric" pattern="[0-9]*"
              className={`${inputCls} w-28`} value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </Field>
          <GhostBtn onClick={generate} disabled={busy || !Number(qty)}>
            <span className="material-symbols-outlined text-base">qr_code_2</span>
            {busy ? 'Generating…' : (units.length ? 'Re-generate' : 'Generate unit barcodes')}
          </GhostBtn> */}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <GhostBtn onClick={onDone}>Done</GhostBtn>
          {/* {hasBoxes && (
            <GhostBtn onClick={() => { setPrintMode('boxes'); setTimeout(print, 0); }}>
              <span className="material-symbols-outlined text-base">inventory_2</span>
              Print Bulk Packaging Labels ({bulkPackages.length})
            </GhostBtn>
          )} */}
          <PrimaryBtn onClick={() => { setPrintMode('lot'); setTimeout(print, 0); }}>
            <span className="material-symbols-outlined text-base">print</span>
            Print {hasBoxes ? 'Lot Label' : (units.length ? 'labels' : 'lot label')}
          </PrimaryBtn>
        </div>
      </div>
    </Modal>
  );
};

export default ImsLots;