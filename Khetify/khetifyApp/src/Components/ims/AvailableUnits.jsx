import React from 'react';
import { Modal } from '../../pages/Company/ims/ImsUi';
import LotPackagingPanel from './LotPackagingPanel';

/**
 * AVAILABLE UNITS — the shared "which units make up this quantity?" control for
 * COMPANY → ANALYTICS View pages.
 *
 * A quantity on its own ("Available: 100") does not say WHICH 100. Every
 * Analytics View page that shows a current/available quantity puts this button
 * beside it, and every one of them gets the identical popup — that is the whole
 * point of this living here rather than inside one page.
 *
 * USAGE — three lines, wherever a quantity is shown:
 *
 *   const units = useAvailableUnits(lotId);       // ./useAvailableUnits
 *   …
 *   <Detail label="Current Available Quantity" value={qty}>
 *     <ViewAvailableUnitsBtn onClick={units.open} />
 *   </Detail>
 *   …
 *   {units.isOpen && <AvailableUnitsModal state={units.state} onClose={units.close} />}
 *
 * The hook owns ONE fetch no matter how many buttons a page renders, so a page
 * showing the quantity in two sections costs one request, on first open.
 *
 * WHAT IS SHOWN. Full Unit IDs, read off real UnitSerial rows by
 * GET /lots/:id/available-units — never built from a lot number and a counter,
 * so nothing can be invented. Only units still in stock in this warehouse are
 * listed; anything transferred, sold, picked or damaged has left the lot and is
 * simply absent. Boxed lots are grouped under their Bulk Packaging ID.
 *
 * The list is drawn by LotPackagingPanel — the SAME component that renders unit
 * labels on Lot Details and Transfer Details — so a unit code looks identical
 * everywhere it appears. Only the Packaging Summary is suppressed; this popup is
 * about the IDs, not the box roll-up.
 *
 * READ-ONLY: fetches and displays, nothing else.
 */

const num = (n) => Number(n || 0).toLocaleString('en-IN');

const Stat = ({ label, value, mono = false }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
    <p className={`text-sm text-stone-800 font-medium break-words ${mono ? 'font-mono text-xs' : ''}`}>
      {value === null || value === undefined || value === '' ? '—' : value}
    </p>
  </div>
);

/** The action that sits under a quantity figure. */
export const ViewAvailableUnitsBtn = ({ onClick, label = 'View Available Units' }) => (
  <button
    type="button"
    onClick={onClick}
    className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-stone-500 border border-stone-200 hover:border-[#EA2831] hover:text-[#EA2831] rounded-lg px-2 py-1 transition-colors"
  >
    <span className="material-symbols-outlined text-[14px]">list</span> {label}
  </button>
);

export const AvailableUnitsModal = ({ state, onClose, title = 'Available Unit IDs' }) => {
  const { loading, error, data } = state;

  // Map the API's groups onto what LotPackagingPanel draws. `unitsInBox` is the
  // AVAILABLE count rather than the carton's original size, so a box header can
  // never claim ten units above a list of seven.
  const boxes = (data?.groups || [])
    .filter((g) => g.bulkPackagingId)
    .map((g) => ({
      bulkPackagingId: g.bulkPackagingId,
      boxSerial: g.boxSerial,
      unitsInBox: g.count,
      unitCodes: g.unitIds,
      status: null,      // a stock listing, not a receiving state
      receivedAt: null,
    }));
  const looseUnitCodes = (data?.groups || [])
    .filter((g) => !g.bulkPackagingId)
    .flatMap((g) => g.unitIds);

  return (
    <Modal title={title} onClose={onClose} wide>
      {loading && <p className="text-sm text-stone-400">Loading…</p>}
      {error && <p className="text-sm text-stone-500">{error}</p>}
      {data && (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4 pb-4 border-b border-stone-100">
            <Stat label="Lot Number" value={data.lotNumber} mono />
            <Stat label="Warehouse" value={data.warehouse} />
            <Stat label="Available Quantity" value={num(data.availableStock)} />
            <Stat label="Unit IDs Available" value={num(data.labelledCount)} />
          </div>

          {/* Say so plainly rather than letting the two figures disagree in
              silence. A lot can hold stock that was never labelled. */}
          {data.labelledCount !== data.availableStock && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">
              {data.labelledCount < data.availableStock
                ? `${num(data.availableStock - data.labelledCount)} unit(s) of the available balance carry no label, so they have no Unit ID to list.`
                : `${num(data.labelledCount - data.availableStock)} labelled unit(s) more than the available balance — the lot's stock figure and its labels disagree.`}
            </p>
          )}
          {data.truncated && (
            <p className="text-[11px] text-stone-500 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 mb-4">
              Showing the first {num(data.listed)} of {num(data.labelledCount)} available Unit IDs.
            </p>
          )}

          {data.groups.length === 0 ? (
            <p className="text-sm text-stone-400">No labelled units are currently available in this warehouse for this lot.</p>
          ) : (
            <div className="space-y-4 max-h-[52vh] overflow-y-auto pr-1">
              <LotPackagingPanel
                boxes={boxes}
                looseUnitCodes={looseUnitCodes}
                totalBoxes={null}
                unitTotal={data.labelledCount}
                unitsLabel="Available Unit IDs"
                showSummary={false}
              />
            </div>
          )}

          <p className="text-[11px] text-stone-400 mt-4">
            Only units currently in stock in this warehouse are listed — anything transferred, sold, picked or damaged has left this lot and is not shown.
          </p>
        </>
      )}
    </Modal>
  );
};

export default AvailableUnitsModal;
