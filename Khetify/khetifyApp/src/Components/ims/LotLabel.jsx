import React from 'react';
// CODE 128, not the Code 39 renderer in lib/barcode.jsx. Code 39 has no "~" and
// its renderer DROPS any character it cannot encode, so a composed lot number
// ("…-GP001~GP005-…") printed through it produced a barcode that decoded to a
// different string and could never be scanned back. Code 128 carries the full
// ASCII set, so the label encodes the stored lot number byte for byte.
import Barcode from '../../lib/barcode128';
import { fmtDate } from '../../lib/imsApi';

/**
 * The canonical lot label — one component so the Lots → Label action, the
 * Labels page header, and the post-create success step all render an identical
 * label (product, brand/packaging, Lot, Qty, MRP, Mfg, Expiry + the
 * Code-128 of the lot number).
 */
const LotLabel = ({ lot }) => {
  const p = lot?.productId || {};
  const code = lot?.lotNumber || lot?.batchNumber || '';
  // The lot's ORIGINAL CREATED quantity — what was manufactured into this lot.
  // A printed label is a physical artefact of the lot, so its quantity must not
  // drift with live stock: availableStock alone reads 0 while the lot awaits the
  // warehouse's receipt (the qty sits in inTransitStock), reads only the
  // received part of a partially-received boxed lot, and drops again as stock is
  // dispatched or transferred away. originalQuantity is immutable (written once
  // at creation); rows that predate it fall back to on-hand + in-transit.
  const qty = typeof lot?.originalQuantity === 'number'
    ? lot.originalQuantity
    : Number(lot?.availableStock || 0) + Number(lot?.inTransitStock || 0);
  return (
    <div id="lot-label" className="w-[600px] mx-auto border border-stone-200 rounded-xl p-5 text-center">
      <p className="font-bold text-stone-900">{p.productName || '—'}</p>
      <p className="text-xs text-stone-500 mb-1">{p.brandName || ''} {p.packagingType ? `· ${p.packagingType}` : ''}</p>
      <div className="grid grid-cols-2 gap-2 text-[11px] text-stone-500 my-3">
        <div><span className="font-bold text-stone-700">Lot:</span> {code}</div>
        <div><span className="font-bold text-stone-700">Qty:</span> {qty.toLocaleString('en-IN')}</div>
        <div><span className="font-bold text-stone-700">MRP:</span> ₹{p.mrp || 0}</div>
        <div><span className="font-bold text-stone-700">Mfg:</span> {fmtDate(lot?.mfgDate)}</div>
        <div><span className="font-bold text-stone-700">Expiry:</span> {fmtDate(lot?.expiryDate)}</div>
      </div>
      <div className="px-2">
        {/* `code` is lot.lotNumber exactly as stored — nothing is stripped,
            uppercased or escaped on the way into the barcode, or the scan
            could not match it. */}
        <Barcode value={code} height={56} width={1.4} className="w-full" />
      </div>
      {/* break-all so the FULL lot number always prints — the Khetify format
          (KH-<COMPANY>-<PRODUCT CODE>-<YYYY>-<MM>-<SERIAL>) is long enough to
          overflow a narrow label otherwise. */}
      <p className="text-[10px] font-mono tracking-[0.2em] break-all text-stone-600 mt-1">{code.toUpperCase()}</p>
    </div>
  );
};

export default LotLabel;
