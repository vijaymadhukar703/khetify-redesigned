import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { getSupplyOrders, fmtDate } from '../../../lib/imsApi';
import { inputCls, PrimaryBtn, Th } from './ImsUi';
import ScanBox from '../../../Components/ims/ScanBox';
// The ONE definition of the packaging-level chip, so a repack carton reads
// "Box Packaging" identically on every screen that lists one.
import PackagingChip from '../../../Components/ims/PackagingChip';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');
const listOf = (r) => (Array.isArray(r) ? r : r?.data || r?.products || []);

const itemPid = (it) => String(it.productId?._id || it.productId);

// PickBody below is driven entirely by the `pick` object its CALLER supplies —
// the scan handler, the per-product counts and the scanned groups all come from
// there (see DispatchScanModal in ImsTransport). Nothing in this file resolves
// a scan any more.

/**
 * SEND STOCK — approved seller requests, and one action on each.
 *
 * Pick → Pack → Dispatch is gone from this page: an approved request is handed
 * straight to the Send to Seller transfer (ImsSellerTransfer), which scans the
 * stock out, builds shipment boxes and captures the paperwork in one place.
 *
 * NOTHING WAS DELETED ON THE SERVER. pickSupplyOrder / packSupplyOrder /
 * dispatchSupplyOrder, pickOrder, createPackage, dispatchOrder and their routes
 * are all untouched — only this screen stopped surfacing them.
 */
const ImsOutbound = () => (
  <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
    <div className="max-w-6xl mx-auto space-y-6">
      <SellerRequestsTab />
    </div>
  </div>
);

/* ───────────── Seller Requests ─────────────
   Approved requests waiting to be sent. One action: hand the request to the
   Send to Seller transfer with everything already filled in. */

// The request's serial. The SAME value is shown against its shipment on the
// Shipment Tracking table (resolved server-side as `requestRef`), so one piece
// of work carries one number across both screens.
const requestNumberOf = (o) => `SR-${String(o._id).slice(-6).toUpperCase()}`;

const SUPPLY_STATUS_STYLE = {
  approved: 'bg-indigo-50 text-indigo-700',
  picking: 'bg-amber-50 text-amber-700',
  picked: 'bg-amber-50 text-amber-700',
  packing: 'bg-amber-50 text-amber-700',
  packed: 'bg-amber-50 text-amber-700',
};

// Sum of the per-lot plan recorded at approval; falls back to the requested
// quantity when approval recorded no allocation.
const approvedQtyOf = (it) => {
  const planned = (it.allocations || []).reduce((sum, a) => sum + Number(a.qty || 0), 0);
  return planned > 0 ? planned : Number(it.quantity || 0);
};

const SellerRequestsTab = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // The Operations tab set lives in the URL (?tab=…), so handing a request to
  // the transfer page is a deep link — no new route, and the page is reachable
  // again by going Back.
  const [params, setParams] = useSearchParams();
  const activeTab = params.get('tab');

  // Re-read on every visit, including coming BACK from the transfer page. A
  // request only leaves this list once the server has actually moved it off
  // "approved" — which happens only after a transfer completes and dispatches.
  // Merely opening (or abandoning) the transfer page changes nothing, so the
  // request is still here when the manager returns.
  useEffect(() => {
    let alive = true;
    getSupplyOrders({ stage: 'pick' })
      .then((r) => { if (alive) setRows(listOf(r).filter((o) => o.status === 'approved')); })
      .catch((err) => { if (alive) apiError(err); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [activeTab]);

  const dispatchToSeller = (o) => setParams({ tab: 'seller-transfer', supply: String(o._id) });

  if (loading) return <p className="text-sm text-stone-400">Loading approved requests…</p>;

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <SectionHeader>{rows.length} approved seller request(s) to send</SectionHeader>
      </div>

      {!rows.length ? (
        <div className="border border-stone-200 rounded-xl p-8 text-center">
          <span className="material-symbols-outlined text-4xl text-stone-300">inbox</span>
          <p className="text-sm font-bold text-stone-900 mt-2">Nothing waiting to send</p>
          <p className="text-xs text-stone-500 mt-1">
            Approved seller requests appear here, ready to dispatch.
          </p>
        </div>
      ) : (
        <div className="border border-stone-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <Th pad="px-4">Seller Request No.</Th>
                <Th pad="px-4">Seller</Th>
                <Th pad="px-4">Product</Th>
                <Th pad="px-4" right>No. of Products</Th>
                <Th pad="px-4" right>Total Quantity</Th>
                <Th pad="px-4">Destination</Th>
                <Th pad="px-4">Status</Th>
                <Th pad="px-4" right>Action</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((o) => {
                const items = o.items || [];
                // Total across every requested product — the approved (allocated)
                // quantity, which is what will actually be transferred.
                const totalQty = items.reduce((s, it) => s + approvedQtyOf(it), 0);
                return (
                  <tr key={o._id} className="hover:bg-stone-50/60 align-top">
                    <td className="px-4 py-3">
                      <p className="text-xs font-bold font-mono text-stone-800">{requestNumberOf(o)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-bold text-stone-900">
                        {o.sellerId?.sellerInfo?.businessName || 'Seller'}
                      </p>
                      {o.sellerId?.contact?.ownerName && (
                        <p className="text-[11px] text-stone-400">{o.sellerId.contact.ownerName}</p>
                      )}
                      <p className="text-[11px] text-stone-400 mt-0.5">{fmtDate(o.createdAt)}</p>
                    </td>
                    <td className="px-4 py-3">
                      {items.map((it, i) => (
                        <p key={i} className="text-xs text-stone-700">
                          {it.productId?.productName || 'Item'}
                          {it.productId?.skuNumber && (
                            <span className="text-stone-400 font-mono"> · {it.productId.skuNumber}</span>
                          )}
                        </p>
                      ))}
                    </td>
                    {/* How many DIFFERENT products are on the request, and the
                        combined quantity across all of them. */}
                    <td className="px-4 py-3 text-sm font-bold text-stone-900 text-right">{items.length}</td>
                    <td className="px-4 py-3 text-sm font-bold text-stone-900 text-right">{totalQty}</td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-stone-700">{o.warehouseId?.name || '—'}</p>
                      {o.sourceWarehouseId?.name && (
                        <p className="text-[11px] text-stone-400">from {o.sourceWarehouseId.name}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${SUPPLY_STATUS_STYLE[o.status] || 'bg-stone-100 text-stone-600'}`}>
                        {String(o.status).replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
  type="button"
  onClick={() => dispatchToSeller(o)}
  className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#EA2831] px-3 text-xs font-bold text-white transition-all hover:bg-[#c91e26] hover:shadow-sm"
>
  <span className="material-symbols-outlined text-[16px]">local_shipping</span>
  <span>Dispatch to Seller</span>
</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

const SectionHeader = ({ children }) => <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{children}</p>;



/**
 * Scan box + the scanned-items list + the ORIGINAL per-product rows.
 *
 * EXPORTED because the warehouse-transfer dispatch dialog (ImsTransport) does
 * the same job — scan stock against what a document requires — and renders this
 * component directly rather than copying its markup, so the two cannot drift.
 * It is driven entirely by `pick`, so any caller supplying that shape can use
 * it; nothing here knows about orders specifically.
 */
/**
 * `pick.select` — OPTIONAL. When a caller supplies it, every LOOSE-UNIT row gets
 * a checkbox and the caller may render an action bar under the list (the
 * dispatch dialog packs the ticked units into a new carton). Rows that are
 * already a box — a Bulk Packaging ID, or a repack carton — never get one:
 * there is nothing loose about them to pack.
 *
 * Omitted by the order-pick dialog, which is why that screen is unchanged.
 *   select: { isOn(key), toggle(key), canSelect(group), footer }
 */
export const PickBody = ({ items, qtyField, pick }) => {
  const select = pick.select || null;
  const nameFor = (pid) => {
    const it = (items || []).find((x) => itemPid(x) === String(pid));
    return it?.productId?.productName || it?.name || 'Item';
  };
  return (
  <>
    <div className="mb-3">
      <ScanBox onScan={pick.onScan} placeholder="Scan a Bulk Packaging ID, Lot Number or Unit Code" />
      <p className="text-[11px] text-stone-400 mt-1.5">
        Scanning a Bulk Packaging ID adds every available unit in that box; a Lot Number adds a
        whole non-bulk lot; a Unit Code adds one unit.
      </p>
    </div>

    {/* SCANNED ITEMS — one row per scan, so a box and an individual unit are
        removable independently. */}
    {pick.groups.length > 0 && (
      <div className="mb-3 border border-stone-200 rounded-xl divide-y divide-stone-100">
        {pick.groups.map((g) => {
          const selectable = !!select && select.canSelect(g);
          return (
          <div key={g.key} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="flex min-w-0 items-start gap-2">
              {/* Only a LOOSE unit row can be packed into a new carton. A box
                  row gets a spacer instead, so every row still lines up. */}
              {select && (selectable ? (
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-[#EA2831] cursor-pointer"
                  checked={select.isOn(g.key)}
                  onChange={() => select.toggle(g.key)}
                  title="Select loose units to pack them into a new box and generate its packaging ID"
                />
              ) : <span className="size-4 shrink-0" aria-hidden="true" />)}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {/* One shared chip: a repack carton reads "Box Packaging" and
                      carries its own colour, so it is never mistaken for a
                      lot's own Bulk Packaging box. */}
                  <PackagingChip kind={g.scanType} />
                  <span className="text-[11px] font-mono text-stone-800 break-all">{g.label}</span>
                </div>
                <p className="text-[10px] text-stone-400 mt-0.5 break-all">
                  {nameFor(g.productId)}
                  {/* A repack carton may hold several lots, so it states its own
                      summary instead of a single lot number. */}
                  {g.scanType === 'repack' ? <> · {g.lotSummary}</> : <> · Lot {g.lotNumber}</>}
                  {g.scanType === 'unit' && g.bulkPackagingId && <> · in {g.bulkPackagingId}</>}
                  {' · '}{g.unitCodes.length} unit(s)
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Per-row actions the caller supplies (View / Unpack a carton). */}
              {select?.rowActions?.(g)}
              <button
                type="button" title="Remove this scan" onClick={() => pick.removeGroup(g.key)}
                className="shrink-0 text-stone-400 hover:text-[#EA2831] font-bold leading-none px-1"
              >×</button>
            </div>
          </div>
          );
        })}
      </div>
    )}

    {/* The caller's action bar, directly under the list it acts on. */}
    {select?.footer}

    <div className="space-y-2">
      {(items || []).map((it) => {
        const pid = itemPid(it);
        const n = pick.countFor(pid);
        // Serial-tracked rows are driven by scanning only — qty is read-only and
        // always equals the unique serials scanned for this product.
        const serialized = !!it.productId?.trackSerial || n > 0;
        return (
          <div key={pid} className="flex items-center justify-between gap-2 border border-stone-100 rounded-lg px-3 py-2">
            <div className="text-sm">
              <span className="font-bold">{it.productId?.productName || it.name || 'Item'}</span>
              <span className="text-stone-400 ml-2">Picked {(it.pickedQty || 0) + n} / {it[qtyField]}</span>
            </div>
            {serialized ? (
              <input
                type="text" readOnly value={n} title="Set by scanning unit serials"
                className={`${inputCls} w-24 bg-stone-50 text-stone-500 cursor-not-allowed`}
              />
            ) : (
              <input
                type="number" min="0" placeholder="Qty" className={`${inputCls} w-24`}
                value={pick.qtys[pid]} onChange={(e) => pick.setQty(pid, e.target.value)}
              />
            )}
          </div>
        );
      })}
    </div>

    <p className="text-xs text-stone-400 my-3">
      {pick.scannedCount ? `${pick.scannedCount} unit(s) selected` : 'Scan to pick, or enter a quantity per item for non-serialized stock.'}
    </p>
  </>
  );
};

// Direct scan-pick a confirmed ORDER against its reserved allocations (no wave).

// Direct scan-pick a supply order against its reserved allocations (no wave).






export default ImsOutbound;