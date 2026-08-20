import React, { lazy, Suspense } from 'react';
import QrCode from '../../lib/qrcode';
import { Modal, PrimaryBtn, GhostBtn } from '../../pages/Company/ims/ImsUi';

// Lazy, exactly like ManifestModal: the barcode library only loads when a label
// is actually opened.
const Barcode128 = lazy(() => import('../../lib/barcode128'));

/**
 * SHIPMENT BOX LABEL — the label for one road carton of individually scanned
 * units, printed by the sending warehouse and scanned by the receiving seller.
 *
 * Deliberately distinct from its neighbours, and it replaces none of them:
 *   LotLabel         — the whole lot
 *   BulkPackageLabel — one manufacturer box of a lot (permanent stock identity)
 *   unit sheet       — one sellable unit
 *   ShipmentBoxLabel — this file: one carton packed FOR THIS TRANSFER only
 *
 * Units that already sit inside a Bulk Package never appear here; they keep
 * being received by their own Bulk Packaging Label.
 *
 * The scanned payload is `<SHIPMENT BOX ID>.<token>`, the same signed shape the
 * shipment manifest uses, so the receiving scanner verifies both the same way.
 */
export const ShipmentBoxLabel = ({ box, seller, transferRef }) => (
  <div className="border border-stone-300 rounded-lg p-4 text-center break-inside-avoid">
    <div className="flex items-center justify-between">
      <p className="text-[9px] font-black uppercase tracking-widest text-stone-400">Shipment Box</p>
      {transferRef && <p className="text-[9px] font-mono text-stone-400">{transferRef}</p>}
    </div>

    <div className="my-2 inline-block rounded-md bg-stone-900 px-3 py-1">
      <p className="text-[11px] font-black uppercase tracking-widest text-white">
        Box {box.boxNumber} of {box.totalBoxes}
      </p>
    </div>

    {seller && <p className="text-xs font-bold text-stone-900 leading-tight">To: {seller}</p>}

    {/* What is inside — so the receiver can check the carton without opening it. */}
    <div className="text-left text-[10px] text-stone-600 my-2 border-y border-stone-200 py-2 space-y-0.5">
      {(box.products || []).map((p) => (
        <div key={p.productId} className="flex justify-between gap-2">
          <span className="truncate">
            <b className="text-stone-800">{p.productName || 'Item'}</b>
            {p.lots?.length ? <span className="font-mono text-stone-400"> · {p.lots.join(', ')}</span> : null}
          </span>
          <span className="font-bold text-stone-900 shrink-0">{p.quantity}</span>
        </div>
      ))}
      <div className="flex justify-between pt-1 border-t border-stone-100">
        <span className="font-bold text-stone-700">Total units</span>
        <span className="font-black text-stone-900">{box.totalUnits}</span>
      </div>
    </div>

    <div className="flex justify-center mb-1">
      {/* QR for a camera; the 1D strip below for wedge scanners. */}
      <QrCode value={box.qrPayload} size={120} />
    </div>
    <Suspense fallback={<div className="h-10" />}>
      <Barcode128 value={box.qrPayload} height={40} width={1.2} className="w-full" />
    </Suspense>
    <p className="text-[9px] font-mono tracking-[0.12em] break-all text-stone-700 mt-1">{box.shipmentBoxId}</p>
  </div>
);

const LABEL_PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  #shipment-box-labels, #shipment-box-labels * { visibility: visible; }
  #shipment-box-labels { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  @page { margin: 10mm; }
}`;

/**
 * All of a transfer's Shipment Box labels on one printable sheet — two per row,
 * each carton's label cut and taped to its box.
 */
export const ShipmentBoxLabelsModal = ({ boxes, seller, transferRef, onClose }) => (
  <Modal title={`Shipment Box Labels (${boxes.length})`} onClose={onClose}>
    <style>{LABEL_PRINT_CSS}</style>
    <p className="no-print text-sm text-stone-600 mb-3">
      Print these and tape one to each carton. The seller scans a box label to receive everything inside it —
      no need to scan the units one by one. Cartons that are already Bulk Packages are not listed here: they
      keep their existing Bulk Packaging Label.
    </p>
    <div id="shipment-box-labels" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {boxes.map((b) => (
        <ShipmentBoxLabel key={b.shipmentBoxId} box={b} seller={seller} transferRef={transferRef} />
      ))}
    </div>
    <div className="no-print mt-4 flex justify-end gap-2">
      <GhostBtn onClick={onClose}>Done</GhostBtn>
      <PrimaryBtn onClick={() => window.print()}>
        <span className="material-symbols-outlined text-base">print</span> Print Labels
      </PrimaryBtn>
    </div>
  </Modal>
);

export default ShipmentBoxLabelsModal;