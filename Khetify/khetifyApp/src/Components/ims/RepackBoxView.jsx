import React, { useEffect, useState } from 'react';
import { getRepackBox } from '../../lib/imsApi';
import { Modal } from '../../pages/Company/ims/ImsUi';
import LotPackagingPanel from './LotPackagingPanel';
import PackagingChip from './PackagingChip';
import Barcode128 from '../../lib/barcode128';

/**
 * WHAT IS INSIDE A REPACK CARTON — the read-only view behind every "View" next
 * to a repack box ID (Dispatch scan-out, Inventory, Barcodes & Labels,
 * Traceability). One component so those four can never draw it differently.
 *
 * The unit list is drawn by the SHARED LotPackagingPanel — the same component
 * that renders a lot's Bulk Packaging IDs — handed one "box" whose units are
 * grouped by their ORIGINAL LOT. That grouping is the point of this screen:
 * the label deliberately carries no expiry, so lot, mfg and expiry are read
 * here, from the system, per lot.
 *
 * Fetches by box ID, so any caller only needs the string.
 */
const RepackBoxView = ({ repackBoxId, onClose, onUnpacked }) => {
  const [box, setBox] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    getRepackBox(repackBoxId)
      .then((r) => { if (alive) setBox(r?.data || r); })
      .catch((e) => { if (alive) setErr(e?.response?.data?.message || 'Could not load this box.'); });
    return () => { alive = false; };
  }, [repackBoxId]);

  return (
    <Modal title={`Box · ${repackBoxId}`} onClose={onClose} wide>
      {err && <p className="py-6 text-center text-sm text-stone-500">{err}</p>}
      {!err && !box && <p className="py-6 text-center text-sm text-stone-400">Loading…</p>}
      {box && (
        <div className="space-y-4">
          {/* THE LABEL, as it prints: ID, barcode, product, unit count. No
              expiry — that is the design decision this whole screen exists to
              compensate for. */}
          <div className="rounded-xl border border-stone-200 p-4 text-center">
            <div className="mb-1 flex justify-center"><PackagingChip kind="repack" /></div>
            <p className="font-bold text-stone-900">{box.productName}</p>
            <p className="mt-1 text-[11px] text-stone-500">{box.unitCount} unit(s) in this box</p>
            <div className="mt-3 px-2">
              <Barcode128 value={box.repackBoxId} height={48} width={1.4} className="w-full" />
            </div>
            <p className="mt-1 font-mono text-[11px] tracking-[0.15em] break-all text-stone-700">{box.repackBoxId}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 rounded-xl border border-stone-200 p-4">
            {[
              ['Created on', box.createdAt ? new Date(box.createdAt).toLocaleString('en-IN') : '—'],
              ['Created by', box.createdBy || '—'],
              ['Shipment', box.shipmentRef || '—'],
              ['Lots inside', `${box.lotCount} lot(s)`],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
                <p className="text-sm font-medium text-stone-800 break-words">{value}</p>
              </div>
            ))}
          </div>

          {/* MORE THAN ONE LOT is called out plainly — the receiving warehouse
              must not assume one carton means one lot. */}
          {box.lotCount > 1 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              {box.lotCount} lots inside — each unit is received back into its own lot, never merged.
            </p>
          )}

          <LotPackagingPanel
            showSummary={false}
            boxesTitle="Box Packaging"
            boxes={[{
              bulkPackagingId: box.repackBoxId,
              boxSerial: null,
              unitsInBox: box.unitCount,
              status: box.status,
              // Chipped by the shared PackagingChip — "Box Packaging", never
              // "Bulk Packaging".
              kind: 'repack',
              lotGroups: box.lotGroups,
            }]}
            unitTotal={box.unitCount}
          />

          {onUnpacked && box.status === 'packed' && (
            <button
              type="button"
              onClick={() => onUnpacked(box.repackBoxId)}
              className="text-[11px] font-bold uppercase tracking-wider text-[#EA2831] hover:underline"
            >
              Unpack this box
            </button>
          )}
        </div>
      )}
    </Modal>
  );
};

export default RepackBoxView;
