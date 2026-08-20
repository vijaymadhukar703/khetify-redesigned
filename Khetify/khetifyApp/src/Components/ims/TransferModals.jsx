import React, { lazy, Suspense, useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { getProducts, getReceiveChecklist, receiveScan, receiveUnits } from '../../lib/imsApi';
import { usePermission } from '../../context/PermissionContext';
import { Modal, PrimaryBtn, GhostBtn, Th } from '../../pages/Company/ims/ImsUi';
import ScanBox from './ScanBox';
// The shared packaging chip — a carton reads the same word here as it does in
// the dispatch dialog, Inventory and the label pages.
import PackagingChip from './PackagingChip';
import CameraScanner, { cameraScanSupported } from './CameraScanner';
import QrCode from '../../lib/qrcode';

// Lazy-loaded so the barcode library only loads when a manifest/receive modal
// opens — callers (shipment board, Lots, Hub) never depend on it to render.
const Barcode128 = lazy(() => import('../../lib/barcode128'));

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');

const getPos = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve({});
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => resolve({}), { timeout: 5000 }
  );
});

// Print only the label block — everything else on the page is hidden.
const LABEL_PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  #shipping-label, #shipping-label * { visibility: visible; }
  #shipping-label { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  @page { margin: 12mm; }
}`;

/**
 * Shipping label (QR + Barcode) for a dispatched transfer. Re-openable any time
 * after dispatch from the row "Shipping Label" button, the Hub, or the
 * create+dispatch flow. Receiving needs only this QR + destination-warehouse
 * validation. Includes a Print action that prints just the label.
 */
export function ManifestModal({ info, onClose }) {
  return (
    <Modal title="Shipping Label" onClose={onClose}>
      <style>{LABEL_PRINT_CSS}</style>
      <p className="no-print text-sm text-stone-600 mb-3">
        Print or show this shipping label to the receiving side. They scan it at the destination
        warehouse to receive the stock — no code needed.
      </p>
      <div id="shipping-label" className="text-center border border-stone-200 rounded-xl p-4">
        {/* QR is what the receiving CAMERA scans (the 1D strip below stays for
            keyboard-wedge scanners and as a fallback). */}
        <div className="flex justify-center mb-2">
          <QrCode value={info.qrPayload} size={180} />
        </div>
        <Suspense fallback={<div className="h-12" />}>
          <Barcode128 value={info.qrPayload} height={48} className="w-full" />
        </Suspense>
        <p className="text-[10px] font-mono text-stone-500 mt-1 break-all">{info.qrPayload}</p>
      </div>
      <div className="no-print mt-3 flex justify-end gap-2">
        <GhostBtn onClick={onClose}>Done</GhostBtn>
        <PrimaryBtn onClick={() => window.print()}>
          <span className="material-symbols-outlined text-base">print</span> Print Label
        </PrimaryBtn>
      </div>
    </Modal>
  );
}

/**
 * RECEIVING A TRANSFER — by scanning whatever is actually in the operator's hand.
 *
 * One shipping label is minted per shipment, so a transfer that arrives as five
 * cartons had a single barcode between them: nothing to stick it on, and no way
 * to take three today and two tomorrow. Every carton already carries its own
 * printed ID, so this accepts all of them —
 *
 *   Shipping label     → everything still in transit, in one scan (unchanged)
 *   Lot Number         → that lot's share of the transfer
 *   Bulk Packaging ID  → the carton, cascading through its inner boxes
 *   Inner Box ID       → that box
 *   Box Packaging ID   → a repack carton assembled at dispatch
 *   Unit Code          → one unit
 *
 * WHAT A CODE MEANS IS NOT DECIDED HERE, nor even on this side of the journey:
 * the server resolves it through the very module the dispatch scan-out uses
 * (packagingScanService), so a box reads the same going out and coming in.
 *
 * PARTIAL BY DESIGN. Whatever is scanned is received; the transfer stays
 * PARTIALLY RECEIVED with the rest still in transit, and the dialog can be
 * reopened for it. Warehouse validation and the geofence are enforced by the
 * server on the landing call, exactly as the shipping-label path enforces them.
 */
export function ReceiveModal({ shipment, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState(null);        // the checklist: expected vs received
  const [rows, setRows] = useState([]);          // one row per scan, newest last
  const [productById, setProductById] = useState({}); // productId -> product name
  // CAMERA-FIRST: clicking "Receive Lot" opens the device camera right away
  // (where supported) — a code is traced, then resolved against this transfer.
  const [showCamera, setShowCamera] = useState(cameraScanSupported());
  const { warehouseIds } = usePermission();

  const destId = String(shipment.toWarehouseId?._id || shipment.toWarehouseId || '');
  // Unscoped users (admin / unassigned) pass automatically; the server checks
  // this again and is the authority.
  const warehouseOk = !warehouseIds?.length || warehouseIds.includes(destId);

  const load = () => getReceiveChecklist(shipment._id)
    .then((r) => setList(r?.data || r))
    .catch(apiError)
    .finally(() => setLoading(false));

  useEffect(() => {
    load();
    // The destination warehouse does NOT own the source lot, so a lot lookup
    // would not resolve it. Names come from the company catalog by productId.
    getProducts().then((r) => {
      const catalog = r?.data || r?.products || (Array.isArray(r) ? r : []);
      const pmap = {};
      catalog.forEach((prod) => { pmap[String(prod._id)] = prod.productName; });
      setProductById(pmap);
    }).catch(() => {});
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
      const r = await receiveScan(shipment._id, { code, selectedCodes: staged });
      const d = r?.data || r;
      if (!d?.addedUnitCodes?.length) { toast('error', 'Nothing was added by this scan.'); return; }
      // DOUBLE-COUNT GUARD, client side too — the server applies the same rule
      // against the database.
      const held = new Set(staged);
      const fresh = d.addedUnitCodes.filter((c) => !held.has(c));
      if (!fresh.length) { toast('error', 'These units have already been scanned.'); return; }

      setRows((prev) => [...prev, {
        key: `${d.scanType}:${d.bulkPackagingId || d.lotNumber || fresh[0]}`,
        // The chip: an inner box is named apart from the carton that holds it.
        chip: d.boxLevel === 'inner' ? 'inner_box' : d.scanType,
        label: d.label,
        productId: String(d.productId || ''),
        lotNumber: d.lotNumber,
        lotCount: d.lotCount,
        unitCodes: fresh,
      }]);
      // WHAT THIS SCAN DID, and where the units came from — a carton may hold
      // more than one lot, so it says so rather than naming just the first.
      const from = d.lotCount > 1 ? `${d.lotCount} lots` : `Lot ${d.lotNumber || '—'}`;
      toast('success', `Added ${fresh.length} unit(s) · ${from}`);
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  const removeRow = (key) => setRows((prev) => prev.filter((r) => r.key !== key));

  /** Land everything staged. Partial is fine — the rest can be scanned later. */
  const run = async () => {
    if (!staged.length || busy) return;
    setBusy(true);
    try {
      const pos = await getPos();
      const r = await receiveUnits(shipment._id, {
        serials: staged,
        warehouseId: destId || undefined,
        ...pos,
      });
      const d = r?.data || r;
      toast(
        'success',
        d.stillInTransit
          ? `Received ${d.receivedNow} unit(s) — ${d.stillInTransit} still in transit`
          : `Received ${d.receivedNow} unit(s) — transfer complete`,
      );
      setRows([]);
      // A partly-received transfer stays open so the next cartons can be
      // scanned; a completed one closes and refreshes the board behind it.
      if (d.stillInTransit) { setLoading(true); load(); } else { onDone(); }
    } catch (err) { apiError(err); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Receive Lot — ${shipment.toLabel}`} onClose={onClose} wide>
      <p className="text-xs text-stone-400 mb-3">
        Only the destination warehouse can receive. Scan the shipping label to take the whole
        transfer at once, or scan each carton — a Bulk Packaging ID, an inner box, a Box Packaging
        ID, a Lot Number or a Unit Code. Whatever you scan is what is received; the rest stays in
        transit for later.
      </p>

      {!warehouseOk && (
        <div className="mb-3 border border-red-200 bg-red-50 rounded-xl p-3 text-center">
          <p className="text-sm font-bold text-red-700">Access Denied — Wrong Warehouse</p>
          <p className="text-xs text-red-500 mt-0.5">This transfer is destined for another warehouse. Only its assigned operations manager can receive it.</p>
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
          {/* RECEIVED X / Y — what has already landed plus what is staged on
              screen, against what this transfer is carrying. */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2">
            <p className="text-[11px] font-medium text-stone-600">
              <b className="text-stone-900">{shipment.fromLabel || 'Source'}</b> → <b className="text-stone-900">{shipment.toLabel}</b>
            </p>
            <p className="text-[11px] font-bold text-stone-700">
              Received {alreadyReceived + staged.length} / {expected}
              {list.stillInTransit > 0 && (
                <span className="ml-2 font-medium text-stone-400">{list.stillInTransit} in transit</span>
              )}
            </p>
          </div>

          <div className="mb-3">
            <ScanBox
              onScan={onScan}
              placeholder="Scan shipping label, Bulk Packaging ID, Box ID, Lot Number or Unit Code"
              autoFocus={!showCamera}
            />
          </div>
          {showCamera && (
            <CameraScanner
              hint="Point the camera at the carton's barcode, or the shipping label"
              onClose={() => setShowCamera(false)}
              onDetected={(code) => { setShowCamera(false); onScan(code); }}
            />
          )}

          {/* ALREADY IN — what earlier visits took, per lot and when.
              Without it a transfer reopened on day two showed "Received 40 / 50"
              with nothing to account for the 40, and no way to tell which
              cartons had already been taken. */}
          {list.alreadyReceived?.length > 0 && (
            <div className="mb-3 rounded-xl border border-green-200 bg-green-50/50">
              <p className="px-3 pt-2 text-[10px] font-bold uppercase tracking-wider text-green-700">
                Already received
              </p>
              <div className="divide-y divide-green-100">
                {list.alreadyReceived.map((a) => (
                  <div key={a.lotNumber} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-mono text-stone-800 break-all">Lot {a.lotNumber}</p>
                      <p className="text-[10px] text-stone-500 mt-0.5">
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

          {/* ONE ROW PER SCAN, so a carton and a single unit can be taken back
              out independently. The same chips the dispatch dialog uses. */}
          {rows.length > 0 && (
            <div className="mb-3 border border-stone-200 rounded-xl divide-y divide-stone-100">
              {rows.map((r) => (
                <div key={r.key} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <PackagingChip kind={r.chip} />
                      <span className="text-[11px] font-mono text-stone-800 break-all">{r.label}</span>
                    </div>
                    <p className="text-[10px] text-stone-400 mt-0.5 break-all">
                      {productById[r.productId] || 'Item'}
                      {r.lotCount > 1 ? <> · {r.lotCount} lots inside</> : <> · Lot {r.lotNumber || '—'}</>}
                      {' · '}{r.unitCodes.length} unit(s)
                    </p>
                  </div>
                  <button
                    type="button" title="Remove this scan" onClick={() => removeRow(r.key)}
                    className="shrink-0 text-stone-400 hover:text-[#EA2831] font-bold leading-none px-1"
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {/* PER PRODUCT — what this transfer carries and how much has landed. */}
          <div className="space-y-2">
            {(list.items || []).map((it) => (
              <div key={it.productId} className="flex items-center justify-between gap-2 border border-stone-100 rounded-lg px-3 py-2">
                <span className="text-sm font-bold">{it.name}</span>
                <span className="text-sm text-stone-400">Received {it.receivedQty} / {it.expectedQty}</span>
              </div>
            ))}
          </div>

          <p className="text-xs text-stone-400 my-3">
            {staged.length
              ? `${staged.length} unit(s) scanned and ready to receive`
              : 'Scan a carton, a lot, a unit — or the shipping label for the whole transfer.'}
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
}
