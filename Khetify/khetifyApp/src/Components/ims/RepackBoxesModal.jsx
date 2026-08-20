import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Swal from 'sweetalert2';
import { listRepackBoxes, unpackRepackBox } from '../../lib/imsApi';
import { Modal, GhostBtn, PrimaryBtn } from '../../pages/Company/ims/ImsUi';
import Barcode128 from '../../lib/barcode128';
import PackagingChip from './PackagingChip';
import RepackBoxView from './RepackBoxView';
import RepackBoxLabel from './RepackBoxLabel';

/**
 * EVERY REPACK CARTON PACKED FOR ONE SHIPMENT — reachable from the Shipments
 * table long after the scan-out dialog has closed.
 *
 * Cartons are assembled during scan-out out of loose picked units. Until this
 * screen existed their IDs vanished with that dialog: there was no way to print
 * a label, and no way to look a box up afterwards. This is the list that answers
 * both, before dispatch and after it.
 *
 * IT DRAWS NOTHING ITSELF. "View" opens the SAME RepackBoxView every other
 * caller uses (scan-out, Inventory, Barcodes & Labels, Traceability) so the five
 * can never disagree about what is in a carton, and the printed label is the
 * shared RepackBoxLabel.
 *
 * BEFORE / AFTER DISPATCH is the one behavioural difference: while the goods are
 * still on the shelf a carton may be broken back open, so Unpack is offered.
 * Once they have left, the box is out of the operator's hands and the screen is
 * read-only — the server refuses an unpack after dispatch too, so this is the
 * button matching the rule rather than the rule itself.
 */

/* Same mechanism as Barcodes & Labels: everything on the page is hidden for the
   print run except the sheet, which is rendered off-screen until then. Scoped to
   this sheet's own id so it cannot collide with that page's. */
const PRINT_CSS = `
#repack-label-sheet { position: absolute; left: -10000px; top: 0; width: 210mm; }
@media print {
  body * { visibility: hidden; }
  #repack-label-sheet, #repack-label-sheet * { visibility: visible; }
  #repack-label-sheet { position: absolute; left: 0; top: 0; width: 100%; }
  @page { size: A4; margin: 10mm; }
  /* One carton per sheet, in list order; the last one must not leave a blank
     page behind it. */
  .repack-label-page { page-break-after: always; break-after: page; }
  .repack-label-page:last-child { page-break-after: auto; break-after: auto; }
  .repack-label-page > * { margin: 0 auto; max-width: 90mm; }
}
`;

// Same toast helpers every other modal in this folder defines — kept local
// rather than imported, exactly as TransferModals does.
const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');

const RepackBoxesModal = ({ shipment, canUnpack = false, onClose, onChanged }) => {
  const [boxes, setBoxes] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Which box the shared detail modal is open on, if any.
  const [viewBox, setViewBox] = useState(null);
  // What the print sheet currently holds: null (nothing), or a list of boxes.
  // Printing one box and printing all are the same operation over a different
  // list, so there is only ever one sheet.
  const [sheet, setSheet] = useState([]);

  const ref = shipment?.ref || `SH-${String(shipment?._id || '').slice(-6).toUpperCase()}`;

  const load = useCallback(() => {
    let alive = true;
    listRepackBoxes(shipment._id)
      .then((r) => { if (alive) setBoxes(Array.isArray(r?.data) ? r.data : (r?.data ? [r.data] : [])); })
      .catch((e) => { if (alive) setErr(e?.response?.data?.message || 'Could not load this shipment’s boxes.'); });
    return () => { alive = false; };
  }, [shipment._id]);

  useEffect(load, [load]);

  const totalUnits = useMemo(
    () => (boxes || []).reduce((n, b) => n + Number(b.unitCount || 0), 0),
    [boxes]
  );

  /**
   * Put the labels on the sheet, let React paint them, then print.
   *
   * The wait matters: the barcodes are drawn into their SVGs by an effect in
   * Barcode128, so printing in the same tick would send empty boxes to the
   * printer. Two frames is enough for the paint that effect triggers.
   */
  const printLabels = (list) => {
    if (!list.length) return;
    setSheet(list);
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  /** Break a carton back open. Only reachable before dispatch. */
  const unpack = async (repackBoxId) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await unpackRepackBox(repackBoxId);
      const d = r?.data || r;
      setViewBox(null);
      toast('success', `${repackBoxId} unpacked — ${d.unitCodes?.length ?? 0} unit(s) are loose again`);
      // Reload rather than splice: the list is the server's answer, and an
      // unpacked box drops out of it entirely.
      load();
      // The Shipments row shows the count, so it has to be told.
      onChanged?.();
    } catch (e) { apiError(e); } finally { setBusy(false); }
  };

  return (
    <>
      <style>{PRINT_CSS}</style>

      <Modal title={`Box Packaging · ${ref}`} onClose={onClose} wide>
        {err && <p className="py-6 text-center text-sm text-stone-500">{err}</p>}
        {!err && !boxes && <p className="py-6 text-center text-sm text-stone-400">Loading…</p>}

        {boxes && !boxes.length && (
          <p className="py-6 text-center text-sm text-stone-400">
            No boxes were packed for this shipment.
          </p>
        )}

        {boxes && boxes.length > 0 && (
          <div className="space-y-4">
            <div className="no-print flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2">
              <p className="text-[11px] font-medium text-stone-600">
                <b>{boxes.length}</b> box(es) · <b>{totalUnits}</b> unit(s) packed for this shipment
              </p>
              <GhostBtn onClick={() => printLabels(boxes)}>
                <span className="material-symbols-outlined text-sm">print</span> Print All Labels
              </GhostBtn>
            </div>

            {!canUnpack && (
              <p className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-[11px] text-stone-500">
                This shipment has been dispatched — the boxes have left the warehouse, so they can
                no longer be unpacked. Labels can still be reprinted.
              </p>
            )}

            <ul className="space-y-3">
              {boxes.map((b) => (
                <li key={b.repackBoxId} className="rounded-xl border border-stone-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <PackagingChip kind="repack" />
                        <p className="font-mono text-xs font-bold tracking-wider text-stone-800 break-all">
                          {b.repackBoxId}
                        </p>
                      </div>
                      <p className="mt-1 text-sm font-bold text-stone-900">{b.productName}</p>
                      <p className="text-[11px] text-stone-500">
                        {b.unitCount} unit(s) · {b.lotCount} lot(s) inside
                      </p>
                      <p className="mt-1 text-[11px] text-stone-400">
                        Packed {b.createdAt ? new Date(b.createdAt).toLocaleString('en-IN') : '—'}
                        {b.createdBy ? ` · by ${b.createdBy}` : ''}
                      </p>
                      {/* The scannable ID, right here — an operator with the
                          carton in front of them can check it without opening
                          anything. */}
                      <div className="mt-2 max-w-[16rem]">
                        <Barcode128 value={b.repackBoxId} height={32} width={1} className="w-full" />
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-stretch gap-1.5">
                      <GhostBtn onClick={() => setViewBox(b.repackBoxId)}>View</GhostBtn>
                      <GhostBtn onClick={() => printLabels([b])}>
                        <span className="material-symbols-outlined text-sm">print</span> Print Label
                      </GhostBtn>
                      {canUnpack && (
                        <button
                          type="button"
                          onClick={() => unpack(b.repackBoxId)}
                          disabled={busy}
                          title="Break this box back into loose units"
                          className="text-[11px] font-bold text-stone-500 hover:text-[#EA2831] hover:underline disabled:opacity-40"
                        >
                          Unpack
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex justify-end">
              <PrimaryBtn onClick={onClose}>Done</PrimaryBtn>
            </div>
          </div>
        )}
      </Modal>

      {/* THE SAME detail modal the scan-out dialog opens. `onUnpacked` is passed
          only before dispatch, which is what hides its own Unpack afterwards. */}
      {viewBox && (
        <RepackBoxView
          repackBoxId={viewBox}
          onClose={() => setViewBox(null)}
          onUnpacked={canUnpack ? unpack : undefined}
        />
      )}

      {/* The print sheet. Off-screen until a print run, and left in place
          afterwards so a jammed printer or a second copy just needs Print
          again. */}
      <div id="repack-label-sheet">
        {sheet.map((b) => (
          <div key={b.repackBoxId} className="repack-label-page">
            <RepackBoxLabel box={b} />
          </div>
        ))}
      </div>
    </>
  );
};

export default RepackBoxesModal;
