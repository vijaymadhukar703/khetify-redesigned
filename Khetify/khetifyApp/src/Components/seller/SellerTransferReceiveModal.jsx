import React, { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { Modal, PrimaryBtn, GhostBtn } from '../../pages/Company/ims/ImsUi';
import ScanBox from '../ims/ScanBox';
import PackagingChip from '../ims/PackagingChip';
import { useSellerPermission } from '../../context/SellerPermissionContext';
import {
  getSellerTransferReceiveChecklist, sellerTransferReceiveScan, receiveSellerTransfer,
} from '../../lib/sellerApi';

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2600, showConfirmButton: false });
const apiErr = (e) =>
  toast('error', e?.response?.data?.message || e.message || 'Something went wrong');

// The shared vocabulary from lib/packagingKind. A transfer box is chipped
// "Box Packaging" (`repack`) — the same word the company dispatch dialog uses
// for a carton assembled at dispatch, which is exactly what this is.
const chipFor = (d) => {
  if (d.scanType === 'unit') return 'unit';
  if (d.scanType === 'lot') return 'lot';
  if (d.scanType === 'shipment') return 'shipment';
  if (d.scanType === 'seller_box') return 'repack';
  if (d.boxLevel === 'inner') return 'inner_box';
  return 'bulk_package';
};

/**
 * RECEIVING A SELLER WAREHOUSE → WAREHOUSE TRANSFER — by scanning whatever is
 * actually in the manager's hand.
 *
 * The seller mirror of the company's ReceiveModal
 * (Components/ims/TransferModals.jsx). One shipping label is minted per
 * shipment, so a transfer that arrives as three cartons had a single barcode
 * between them: nothing to stick it on, and no way to take two today and one
 * tomorrow. Every box now carries its own printed ID, so this accepts:
 *
 *   Transfer Box ID    → that box, the label stuck on at dispatch
 *   Bulk Packaging ID  → the carton, cascading through its inner boxes
 *   Inner Box ID       → that box
 *   Lot Number         → that lot's share of the transfer
 *   Unit Code          → one unit
 *   Shipping label     → everything still in transit, in one scan
 *
 * WHAT A CODE MEANS IS NOT DECIDED HERE, nor even on this side of the journey:
 * the server resolves it through the same lookups the dispatch scan-out uses,
 * so a box reads the same going out and coming in.
 *
 * PARTIAL BY DESIGN. Whatever is scanned is received; the transfer stays
 * PARTIALLY RECEIVED with the rest still in transit, and the dialog can be
 * reopened for it. Warehouse validation is enforced by the server on the
 * landing call.
 */
const SellerTransferReceiveModal = ({ shipment, onClose, onDone }) => {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState(null);
  const [rows, setRows] = useState([]); // one row per scan, newest last
  const { warehouseIds, role } = useSellerPermission();

  const destId = String(shipment.toWarehouseId?._id || shipment.toWarehouseId || '');
  // Unscoped users (seller_admin / unassigned) pass automatically; the server
  // checks this again and is the authority.
  const scoped = role !== 'seller_admin' && (warehouseIds || []).length > 0;
  const warehouseOk = !scoped || (warehouseIds || []).map(String).includes(destId);

  const load = () => getSellerTransferReceiveChecklist(shipment._id)
    .then((r) => setList(r?.data || r))
    .catch(apiErr)
    .finally(() => setLoading(false));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipment._id]);

  // Everything the dialog is holding but has not landed yet.
  const staged = rows.flatMap((r) => r.unitCodes);
  const alreadyReceived = Number(list?.receivedTotal || 0);
  const expected = Number(list?.expectedTotal || 0);

  /** Resolve one code and add it as its own row. Nothing lands here. */
  const onScan = async (raw) => {
    const code = String(raw || '').trim();
    if (!code || busy) return;
    setBusy(true);
    try {
      const r = await sellerTransferReceiveScan(shipment._id, { code, selectedCodes: staged });
      const d = r?.data || r;
      if (!d?.addedUnitCodes?.length) { toast('error', 'Nothing was added by this scan.'); return; }

      // DOUBLE-COUNT GUARD, client side too — the server applies the same rule
      // against the database.
      const held = new Set(staged);
      const fresh = d.addedUnitCodes.filter((c) => !held.has(c));
      if (!fresh.length) { toast('error', 'These units have already been scanned.'); return; }

      setRows((prev) => [...prev, {
        key: `${d.scanType}:${d.sellerBoxId || d.bulkPackagingId || d.lotNumber || fresh[0]}`,
        chip: chipFor(d),
        label: d.label,
        lotNumber: d.lotNumber,
        lotCount: d.lotCount,
        unitCodes: fresh,
      }]);
      const from = d.lotCount > 1 ? `${d.lotCount} lots` : `Lot ${d.lotNumber || '—'}`;
      toast('success', `Added ${fresh.length} unit(s) · ${from}`);
    } catch (e) { apiErr(e); } finally { setBusy(false); }
  };

  const removeRow = (key) => setRows((prev) => prev.filter((r) => r.key !== key));

  /** Land everything staged. Partial is fine — the rest can be scanned later. */
  const run = async () => {
    if (!staged.length || busy) return;
    setBusy(true);
    try {
      const r = await receiveSellerTransfer(shipment._id, {
        serials: staged,
        warehouseId: destId || undefined,
      });
      const d = r?.data || r;
      toast('success', r?.message || 'Received');
      setRows([]);
      // A partly-received transfer stays open so the next boxes can be scanned;
      // a completed one closes and refreshes the board behind it.
      if (d.stillInTransit) { setLoading(true); load(); } else { onDone(); }
    } catch (e) { apiErr(e); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Receive transfer — ${shipment.toLabel || 'destination'}`} onClose={onClose} wide>
      <p className="mb-3 text-xs text-stone-400">
        Only the destination warehouse can receive. Scan each box label — or a Bulk Packaging ID, an
        inner box, a Lot Number or a Unit Code. Whatever you scan is what is received; the rest stays
        in transit for later.
      </p>

      {!warehouseOk && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-center">
          <p className="text-sm font-bold text-red-700">Access denied — wrong warehouse</p>
          <p className="mt-0.5 text-xs text-red-500">
            This transfer is destined for another warehouse. Only its assigned manager can receive it.
          </p>
        </div>
      )}

      {loading && <p className="py-6 text-center text-sm text-stone-400">Loading…</p>}

      {!loading && list && !list.receivable && (
        <p className="py-6 text-center text-sm text-stone-500">
          This transfer is {list.status} — there is nothing left to receive.
        </p>
      )}

      {!loading && list?.receivable && warehouseOk && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2">
            <p className="text-[11px] font-medium text-stone-600">
              <b className="text-stone-900">{list.fromLabel || 'Source'}</b> →{' '}
              <b className="text-stone-900">{list.toLabel || 'Destination'}</b>
            </p>
            <p className="text-[11px] font-bold text-stone-700">
              Received {alreadyReceived + staged.length} / {expected}
              {list.stillInTransit > 0 && (
                <span className="ml-2 font-medium text-stone-400">{list.stillInTransit} in transit</span>
              )}
            </p>
          </div>

          {/* THE BOXES THIS TRANSFER TRAVELLED IN — the checklist of what should
              physically be on the dock. */}
          {list.boxes?.length > 0 && (
            <div className="mb-3 rounded-xl border border-stone-200">
              <p className="px-3 pt-2 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                Boxes on this transfer ({list.boxes.length})
              </p>
              <div className="divide-y divide-stone-100">
                {list.boxes.map((b) => (
                  <div key={b.sellerBoxId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-stone-800">
                        Box {b.boxNumber} of {b.totalBoxes}
                      </p>
                      <p className="break-all font-mono text-[10px] text-stone-500">{b.sellerBoxId}</p>
                    </div>
                    <span className="shrink-0 text-[11px] font-bold text-stone-600">
                      {b.productName} · {b.unitCount} unit(s)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-3">
            <ScanBox
              onScan={onScan}
              placeholder="Scan a box label, Bulk Packaging ID, Lot Number or Unit Code"
              autoFocus
              disabled={busy}
            />
          </div>

          {/* ALREADY IN — what earlier visits took, per lot and when. */}
          {list.alreadyReceived?.length > 0 && (
            <div className="mb-3 rounded-xl border border-green-200 bg-green-50/50">
              <p className="px-3 pt-2 text-[10px] font-bold uppercase tracking-wider text-green-700">
                Already received
              </p>
              <div className="divide-y divide-green-100">
                {list.alreadyReceived.map((a) => (
                  <div key={a.lotNumber} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="break-all font-mono text-[11px] text-stone-800">Lot {a.lotNumber}</p>
                      <p className="mt-0.5 text-[10px] text-stone-500">
                        {a.name}
                        {a.receivedAt && <> · received {new Date(a.receivedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</>}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] font-bold text-green-700">{a.qty} unit(s)</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ONE ROW PER SCAN, so a box and a single unit can be taken back out
              independently. */}
          {rows.length > 0 && (
            <div className="mb-3 divide-y divide-stone-100 rounded-xl border border-stone-200">
              {rows.map((r) => (
                <div key={r.key} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <PackagingChip kind={r.chip} />
                      <span className="break-all font-mono text-[11px] text-stone-800">{r.label}</span>
                    </div>
                    <p className="mt-0.5 break-all text-[10px] text-stone-400">
                      {r.lotCount > 1 ? `${r.lotCount} lots inside` : `Lot ${r.lotNumber || '—'}`}
                      {' · '}{r.unitCodes.length} unit(s)
                    </p>
                  </div>
                  <button
                    type="button" title="Remove this scan" onClick={() => removeRow(r.key)}
                    className="shrink-0 px-1 font-bold leading-none text-stone-400 hover:text-[#EA2831]"
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {/* PER PRODUCT — what this transfer carries and how much has landed. */}
          <div className="space-y-2">
            {(list.items || []).map((it) => (
              <div key={it.productId} className="flex items-center justify-between gap-2 rounded-lg border border-stone-100 px-3 py-2">
                <span className="text-sm font-bold">{it.name}</span>
                <span className="text-sm text-stone-400">Received {it.receivedQty} / {it.expectedQty}</span>
              </div>
            ))}
          </div>

          <p className="my-3 text-xs text-stone-400">
            {staged.length
              ? `${staged.length} unit(s) scanned and ready to receive`
              : 'Scan a box label to bring its units in.'}
          </p>

          <div className="flex items-center gap-2">
            <PrimaryBtn disabled={busy || !staged.length} onClick={run}>
              {busy ? 'Receiving…' : `Receive ${staged.length || ''} unit(s)`}
            </PrimaryBtn>
            {staged.length > 0 && staged.length + alreadyReceived < expected && (
              <span className="text-[11px] text-stone-400">The rest stays in transit — scan it later.</span>
            )}
          </div>
        </>
      )}
    </Modal>
  );
};

export default SellerTransferReceiveModal;