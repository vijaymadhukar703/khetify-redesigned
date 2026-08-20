import React, { lazy, Suspense } from 'react';
import { Modal, GhostBtn, PrimaryBtn } from '../../pages/Company/ims/ImsUi';
import QrCode from '../../lib/qrcode';

// CODE 128 — the same renderer every other label in the system uses, lazy so
// the barcode library only loads when a label sheet is actually opened.
const Barcode128 = lazy(() => import('../../lib/barcode128'));

// Print only the label sheet — everything else on the page is hidden.
const LABEL_PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  #transfer-box-labels, #transfer-box-labels * { visibility: visible; }
  #transfer-box-labels { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  @page { margin: 10mm; }
}`;

const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/**
 * THE LABEL FOR ONE SELLER TRANSFER BOX — the sticker that goes on the carton.
 *
 * A WAREHOUSE TRANSFER LABEL, NOT A DELIVERY LABEL. There is deliberately no
 * deliver-to block, no address, no city, state, PIN or phone and no customer
 * name anywhere on it: this carton is going between two of the seller's own
 * warehouses, so the only things that matter are which transfer it belongs to,
 * where it came from, where it is going, what is inside, and the scannable box
 * ID. The customer parcel label (Components: DeliveryLabelModal in
 * SellerOperations) is a completely separate thing and is untouched.
 *
 * NO EXPIRY DATE, and that is a decision rather than an omission: a transfer box
 * may mix lots of one product, so there is no single expiry to print. The lots
 * inside are stated by count here and read per lot from the box contents.
 *
 * Both symbologies carry the SAME string — the box ID. The QR is what a phone
 * camera reads at the destination; the CODE 128 strip is for keyboard-wedge
 * scanners. Either one resolves through the same server lookup.
 */
export const SellerTransferBoxLabel = ({ box, index, total }) => {
  const code = box?.sellerBoxId || box?.repackBoxId || '';
  const number = box?.boxNumber || (index != null ? index + 1 : 1);
  const count = box?.totalBoxes || total || 1;

  return (
    <div className="border border-stone-300 rounded-lg p-4 break-inside-avoid">
      <div className="flex items-start justify-between gap-2 border-b border-stone-200 pb-2">
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-widest text-stone-400">
            Warehouse Transfer
          </p>
          <p className="text-sm font-bold text-stone-900 leading-tight truncate">
            {box?.productName || '—'}
          </p>
        </div>
        <div className="shrink-0 rounded-md bg-stone-900 px-2.5 py-1 text-center">
          <p className="text-[11px] font-black uppercase tracking-widest text-white">
            Box {number} / {count}
          </p>
        </div>
      </div>

      {/* FROM → TO is warehouse-to-warehouse only. No address lines. */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 py-2 text-[10px] text-stone-500">
        <div className="col-span-2">
          <span className="font-bold text-stone-700">From:</span> {box?.fromLabel || box?.warehouse || '—'}
        </div>
        <div className="col-span-2">
          <span className="font-bold text-stone-700">To:</span> {box?.toLabel || '—'}
        </div>
        <div><span className="font-bold text-stone-700">Transfer:</span> {box?.shipmentRef || '—'}</div>
        <div><span className="font-bold text-stone-700">Units:</span> {box?.unitCount ?? '—'}</div>
        <div><span className="font-bold text-stone-700">Lots inside:</span> {box?.lotCount ?? '—'}</div>
        <div><span className="font-bold text-stone-700">Packed:</span> {fmtDate(box?.createdAt)}</div>
      </div>

      {/* MIXED LOTS ARE STATED ON THE CARTON. The receiving warehouse must not
          assume one box means one lot — every unit is received back into its
          own lot, never merged. */}
      {box?.lotCount > 1 && (
        <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-amber-800">
          {box.lotCount} lots inside — check the system before putaway
        </p>
      )}

      <div className="flex items-center justify-center gap-3">
        <QrCode value={code} size={92} />
        <div className="min-w-0 flex-1">
          <Suspense fallback={<div className="h-10" />}>
            {/* Exactly the stored box ID — nothing stripped or escaped. */}
            <Barcode128 value={code} height={40} width={1.2} className="w-full" />
          </Suspense>
        </div>
      </div>
      <p className="mt-1 break-all text-center font-mono text-[9px] tracking-[0.12em] text-stone-700">
        {code}
      </p>
    </div>
  );
};

/**
 * THE LABEL SHEET — every box of one transfer, on one printable page.
 *
 * Opened both immediately after dispatch (when the boxes first become real) and
 * again later from the transfer row, so a torn label can always be reprinted.
 */
const SellerTransferBoxLabels = ({ boxes = [], transferRef, onClose }) => (
  <Modal title={`Box labels · ${transferRef || 'transfer'}`} onClose={onClose} wide>
    <style>{LABEL_PRINT_CSS}</style>
    <p className="no-print mb-3 text-xs text-stone-500">
      One label per box. Stick each on its carton — the destination warehouse scans these to receive.
    </p>

    {boxes.length === 0 ? (
      <p className="py-8 text-center text-sm text-stone-400">No boxes were packed for this transfer.</p>
    ) : (
      <div id="transfer-box-labels" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {boxes.map((b, i) => (
          <SellerTransferBoxLabel
            key={b.sellerBoxId || b.repackBoxId || i}
            box={b}
            index={i}
            total={boxes.length}
          />
        ))}
      </div>
    )}

    <div className="no-print mt-4 flex justify-end gap-2">
      <GhostBtn onClick={onClose}>Done</GhostBtn>
      {boxes.length > 0 && (
        <PrimaryBtn onClick={() => window.print()}>
          <span className="material-symbols-outlined text-base">print</span>
          Print {boxes.length} label{boxes.length > 1 ? 's' : ''}
        </PrimaryBtn>
      )}
    </div>
  </Modal>
);

export default SellerTransferBoxLabels;