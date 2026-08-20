import React from 'react';
// CODE 128 — the same renderer every other label in the system uses. The Code 39
// one silently drops characters it cannot encode, which makes a composed ID
// unscannable (see BulkPackageLabel).
import Barcode from '../../lib/barcode128';
import PackagingChip from './PackagingChip';

/**
 * THE LABEL FOR ONE REPACK CARTON — the thing that gets stuck on the box.
 *
 * Deliberately distinct from its two neighbours:
 *   LotLabel         — the whole lot
 *   BulkPackageLabel — one box of ONE lot
 *   this             — one carton assembled at dispatch, which may hold units
 *                      from SEVERAL lots
 *
 * NO EXPIRY DATE, and that is a design decision rather than an omission: a
 * repack carton may mix lots, so there is no single expiry to print. The lots
 * inside are stated by count here and read per lot in RepackBoxView — which is
 * the whole reason that screen exists. Printing one lot's expiry on a mixed
 * carton would be worse than printing none.
 *
 * Shape and sizing mirror BulkPackageLabel so a printed sheet of the two reads
 * as one system.
 */
const RepackBoxLabel = ({ box }) => {
  const code = box?.repackBoxId || '';

  return (
    <div className="border border-stone-300 rounded-lg p-4 text-center break-inside-avoid">
      <p className="font-bold text-stone-900 text-sm leading-tight">{box?.productName || '—'}</p>

      <div className="my-2 inline-block rounded-md bg-stone-900 px-3 py-1">
        <p className="text-[11px] font-black uppercase tracking-widest text-white">
          {box?.unitCount} unit(s)
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-stone-500 text-left my-2">
        <div><span className="font-bold text-stone-700">Shipment:</span> {box?.shipmentRef || '—'}</div>
        <div><span className="font-bold text-stone-700">Lots inside:</span> {box?.lotCount ?? '—'}</div>
        <div className="col-span-2">
          <span className="font-bold text-stone-700">Packed:</span>{' '}
          {box?.createdAt ? new Date(box.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
          {box?.createdBy ? ` · ${box.createdBy}` : ''}
        </div>
      </div>

      {/* MIXED LOTS ARE STATED ON THE CARTON. The receiving warehouse must not
          assume one box means one lot — every unit is received back into its
          own lot, never merged. */}
      {box?.lotCount > 1 && (
        <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-amber-800">
          {box.lotCount} lots inside — check system before putaway
        </p>
      )}

      <div className="px-1">
        {/* Exactly the stored repack_box_id — nothing stripped or escaped. */}
        <Barcode value={code} height={48} width={1.4} className="w-full" />
      </div>
      <p className="text-[9px] font-mono tracking-[0.15em] break-all text-stone-700 mt-1">{code}</p>

      <div className="mt-1 flex justify-center"><PackagingChip kind="repack" /></div>
    </div>
  );
};

export default RepackBoxLabel;
