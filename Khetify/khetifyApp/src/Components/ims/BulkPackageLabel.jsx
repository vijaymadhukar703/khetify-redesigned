import React from 'react';
// CODE 128 — see LotLabel.jsx. The Code 39 renderer silently drops "~" and any
// other character it cannot encode, which makes a composed box ID unscannable.
import Barcode from '../../lib/barcode128';
import { fmtDate } from '../../lib/imsApi';

/**
 * The label for ONE PHYSICAL OUTER BOX of a lot — the Bulk Packaging ID label.
 *
 * Deliberately distinct from the two neighbouring labels:
 *   LotLabel        — the whole lot (Lot Number + lot barcode)
 *   BulkPackageLabel— one outer box (this file; Bulk Packaging ID + box barcode)
 *   unit sheet      — individual sellable units inside a box
 *
 * The warehouse scans THIS barcode to receive exactly this box's units.
 */
/**
 * `caption` overrides the "Box n of N" chip. Three-level packaging needs it: an
 * inner box carries a LOT-WIDE box_serial (box 7 of 10), but on the carton it is
 * "INNER BOX 2 OF 5" — its position inside the main box that holds it. The chip
 * has to read what the operator will count on the shelf.
 */
const BulkPackageLabel = ({ box, lot, totalBoxes, caption }) => {
  const p = lot?.productId || {};
  const code = box?.bulk_packaging_id || '';
  const total = totalBoxes || lot?.number_of_boxes || 0;

  return (
    <div className="border border-stone-300 rounded-lg p-4 text-center break-inside-avoid">
      <p className="font-bold text-stone-900 text-sm leading-tight">{p.productName || '—'}</p>
      <p className="text-[10px] font-mono tracking-wider text-stone-500">{p.product_code || ''}</p>

      <div className="my-2 inline-block rounded-md bg-stone-900 px-3 py-1">
        <p className="text-[11px] font-black uppercase tracking-widest text-white">
          {caption || `Box ${box?.box_serial} of ${total}`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-stone-500 text-left my-2">
        <div className="col-span-2">
          <span className="font-bold text-stone-700">Lot:</span>{' '}
          <span className="font-mono break-all">{box?.lot_number || ''}</span>
        </div>
        <div><span className="font-bold text-stone-700">Units in Box:</span> {box?.units_in_box}</div>
        <div><span className="font-bold text-stone-700">Mfg:</span> {fmtDate(lot?.mfgDate)}</div>
        <div><span className="font-bold text-stone-700">Expiry:</span> {fmtDate(lot?.expiryDate)}</div>
      </div>

      <div className="px-1">
        {/* Exactly the stored bulk_packaging_id — nothing stripped or escaped. */}
        <Barcode value={code} height={48} width={1.4} className="w-full" />
      </div>
      <p className="text-[9px] font-mono tracking-[0.15em] break-all text-stone-700 mt-1">{code}</p>
    </div>
  );
};

export default BulkPackageLabel;
