import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import Barcode128 from '../../lib/barcode128';
import { Field, inputCls, PrimaryBtn } from '../Company/ims/ImsUi';
/* THE COMPANY'S OWN LABEL COMPONENTS, reused as-is — not re-implemented. This
   is what makes a seller's Bulk Packaging / Inner Box label byte-for-byte the
   label the company prints for the same carton: same badge, same Lot / Units in
   Box / Mfg / Expiry block, same CODE 128 of the stored ID. Neither component
   is modified. */
import LotLabel from '../../Components/ims/LotLabel';
import BulkPackageLabel from '../../Components/ims/BulkPackageLabel';
import {
  getSellerLink, getSellerLots, getSellerUnits, printSellerUnits, getSellerLotDetails,
} from '../../lib/sellerApi';

const toast = (icon, title) => Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
const apiError = (err) => toast('error', err?.response?.data?.message || err.message || 'Something went wrong');
const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);

// label layouts: id -> { cols, w(mm), h(mm), label }
const LAYOUTS = {
  '65': { cols: 5, w: 38, h: 21, label: '65 / page · 38×21mm' },
  '24': { cols: 3, w: 64, h: 34, label: '24 / page · 64×34mm' },
};

/* The SAME print + nesting CSS the company Labels page uses, so a carton looks
   and prints identically on both sides. Only the sheet id differs
   (#seller-label-sheet), because that is what this page's print rule targets. */
const PRINT_CSS = `
/* Unit labels: a centred wrap, so a partial last row sits in the middle
   (3 on top, 2 centred beneath) instead of hugging the left edge. */
.unit-grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 2mm; margin: 0 auto; }
.unit-grid > * { break-inside: avoid; page-break-inside: avoid; }

/* THREE-LEVEL PACKAGING. A main box card holds its own inner box cards inside
   its border, so the nesting on screen is the nesting in the warehouse. */
.main-card { border: 1px solid #e7e5e4; border-radius: 1rem; padding: 1rem; background: #fff; }
.inner-stack { display: grid; gap: 1rem; margin-top: 1rem; }
.inner-card { border: 1px dashed #d6d3d1; border-radius: 0.75rem; padding: 0.75rem; background: #fafaf9; }

/* A LONE CARD ON THE LAST ROW IS CENTRED, at the width of a normal card. */
.inner-stack > .inner-card:last-child:nth-child(odd) {
  grid-column: 1 / -1;
  justify-self: center;
  width: calc(50% - 0.5rem);
}

@media print {
  body * { visibility: hidden; }
  #seller-label-sheet, #seller-label-sheet * { visibility: visible; }
  #seller-label-sheet { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  @page { size: A4; margin: 8mm; }

  /* Screen-only chrome off; cards flow one per page instead of side by side. */
  .print-page { border: 0; padding: 0; margin: 0 auto; max-width: none; }

  /* The nesting is screen structure. On paper every box is its own sheet, in
     document order: main box -> its inner boxes and their units -> next main box. */
  .main-card { border: 0; padding: 0; margin: 0; }
  .inner-stack { display: block; margin: 0; }
  .inner-card { border: 0; padding: 0; margin: 0; background: none; }
  .inner-stack > .inner-card:last-child:nth-child(odd) { grid-column: auto; width: auto; }

  /* The lot label takes the first sheet whenever box pages follow it. */
  .lot-master.has-pages { page-break-after: always; break-after: page; }
  .bp-page { page-break-after: always; break-after: page; }
  .bp-page:last-child { page-break-after: auto; break-after: auto; }

  /* NESTED sheets break BEFORE each box instead of after it: the last inner box
     of main box 1 is a :last-child too, so a break-after rule would lose the
     separation from main box 2 and still leave a blank trailing sheet. */
  .nested-sheet .bp-page {
    page-break-before: always; break-before: page;
    page-break-after: auto; break-after: auto;
  }
}`;

/* Card sizing, mirroring the company page: a box card is capped to an exact
   number of unit labels so a row never stretches into one long line. */
const BOX_UNIT_COLS = 3;
const GAP_MM = 2;
const rowWidthMm = (cols, w) => cols * w + (cols - 1) * GAP_MM;
// The company page caps its top-level cards at this width; matched so a seller
// carton label is the same size as the company's for the same box.
const TOP_CARD_W = 600;

/**
 * The seller API describes a box in its own words (`bulkPackagingId`,
 * `boxSerial`, `unitsOriginallyInPackage`); BulkPackageLabel expects the raw
 * BulkPackage field names. This maps between them so the SHARED component can
 * be used unchanged rather than forked for the seller.
 *
 * `unitsInBox` is the AS-PACKED count from the carton record — the number
 * physically printed on that box — not how many of them this seller happens to
 * hold. A label describes the box, not the current stock position.
 */
const toLabelBox = (b) => ({
  bulk_packaging_id: b.bulkPackagingId,
  box_serial: b.boxSerial,
  units_in_box: b.unitsInBox ?? b.unitsOriginallyInPackage,
  lot_number: b.lotNumber,
});

// Seller Labels — VIEW, (re)PRINT and SCAN the unit labels the seller received
// via supply. There is NO "Generate Units": sellers never mint serials.
//
// ── PACKAGING HIERARCHY ──
// The arrangement below is the company Labels page's, rebuilt from the SAME
// stored relationships rather than re-derived from anything cosmetic:
//
//   Lot / Batch
//     └── Bulk Packaging — Main / Outer Box   (BulkPackage.box_level "main")
//           └── Inner Box                     (BulkPackage.parent_box_id -> main)
//                 └── Units                   (UnitSerial.bulk_packaging_record_id -> inner)
//
// A unit always points at the box that PHYSICALLY holds it, so on a two-level
// lot that pointer is the bulk box itself and the layout degrades to
// Lot -> Bulk Packaging -> Units — exactly the company page's fallback. Nothing
// is created, moved or renumbered here; this only reads and groups.
const SellerLabels = () => {
  const [params] = useSearchParams();
  const [approved, setApproved] = useState(null);
  const [lots, setLots] = useState([]);
  const [lotId, setLotId] = useState('');
  const [units, setUnits] = useState([]);
  // The seller's OWN view of this lot's packaging: the boxes it actually holds
  // units in, plus the outer cartons above them. Read-only.
  const [boxes, setBoxes] = useState([]);
  const [mainBoxes, setMainBoxes] = useState([]);
  const [layout, setLayout] = useState('65');
  const [custom, setCustom] = useState({ cols: 4, w: 50, h: 30 });

  useEffect(() => {
    getSellerLink()
      .then((r) => {
        const ok = r?.data?.linkStatus === 'approved';
        setApproved(ok);
        if (!ok) return;
        getSellerLots().then((res) => {
          const l = listOf(res);
          setLots(l);
          const wanted = params.get('lot');
          const match = wanted && l.find((x) => x._id === wanted);
          setLotId(match ? match._id : (l[0]?._id || ''));
        }).catch(apiError);
      })
      .catch(() => setApproved(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUnits = (id) => {
    if (!id) { setUnits([]); return; }
    getSellerUnits({ inventoryId: id, limit: 10000 }).then((r) => setUnits(listOf(r))).catch(apiError);
  };
  useEffect(() => { if (approved && lotId) loadUnits(lotId); }, [lotId, approved]);

  /* The packaging tree for the selected lot. Uses the EXISTING lot-details
     endpoint — no new API — which already returns the seller's bulk packages and
     now also states each one's level and parent. A lot with no boxes simply
     returns none and the flat layout is used. */
  useEffect(() => {
    if (!approved || !lotId) { setBoxes([]); setMainBoxes([]); return undefined; }
    let cancelled = false;
    getSellerLotDetails(lotId)
      .then((r) => {
        if (cancelled) return;
        const d = r?.data || r || {};
        setBoxes(Array.isArray(d.bulkPackages) ? d.bulkPackages : []);
        setMainBoxes(Array.isArray(d.mainBoxes) ? d.mainBoxes : []);
      })
      // A lot whose packaging cannot be read still prints its labels — it just
      // falls back to the flat grid rather than showing nothing.
      .catch(() => { if (!cancelled) { setBoxes([]); setMainBoxes([]); } });
    return () => { cancelled = true; };
  }, [lotId, approved]);

  const lot = useMemo(() => lots.find((l) => l._id === lotId), [lots, lotId]);
  const lotLabel = (l) => `${l.productId?.productName || 'Item'} · ${l.lotNumber || l.batchNumber}`;

  const cfg = layout === 'custom'
    ? { cols: Math.max(1, Number(custom.cols) || 1), w: Math.max(10, Number(custom.w) || 10), h: Math.max(8, Number(custom.h) || 8), label: 'Custom' }
    : LAYOUTS[layout];
  const bcH = Math.max(16, Math.round(cfg.h * 0.7));

  const seqNum = (serial) => parseInt(String(serial).split('-').pop(), 10) || 0;
  const visibleUnits = useMemo(() => [...units].sort((a, b) => seqNum(a.serial) - seqNum(b.serial)), [units]);

  /* ---- BULK PACKAGING (Lot -> Box -> Units) -----------------------------
     THE BOXES DECIDE, not any flag on the lot row. If the API returned boxes
     the lot IS boxed; a single-package lot returns none and everything below
     falls through to the original flat grid, so a lot received before this
     existed prints exactly as it did. */
  const isBoxed = boxes.length > 0;

  // The visible units of each box, in box order then unit order. A unit knows
  // its box through bulk_packaging_record_id, set when the company minted it.
  const boxGroups = useMemo(() => {
    if (!isBoxed) return [];
    const byBox = new Map(boxes.map((b) => [String(b.bulkPackageId), []]));
    for (const u of visibleUnits) {
      const key = String(u.bulk_packaging_record_id || '');
      if (byBox.has(key)) byBox.get(key).push(u);
    }
    return boxes.map((b) => ({
      box: b,
      units: (byBox.get(String(b.bulkPackageId)) || []).sort((x, y) => (x.unit_serial || 0) - (y.unit_serial || 0)),
    }));
  }, [isBoxed, boxes, visibleUnits]);

  // Boxes with nothing to print are skipped entirely, so a run never emits a
  // page holding just a box heading.
  const printableGroups = useMemo(() => boxGroups.filter((g) => g.units.length > 0), [boxGroups]);

  /* ---- THREE LEVELS (Lot -> Main Box -> Inner Box -> Units) --------------
     The parent link comes from the stored `parentBoxId`, never from reading the
     ID string: the two IDs share a prefix by convention, not by contract. */
  const isNested = isBoxed && mainBoxes.length > 0;

  const mainGroups = useMemo(() => {
    if (!isNested) return [];
    const byParent = new Map(mainBoxes.map((m) => [String(m.bulkPackageId), []]));
    for (const g of printableGroups) {
      const key = String(g.box.parentBoxId || '');
      if (byParent.has(key)) byParent.get(key).push(g);
    }
    // A main box whose inner boxes hold no labels is skipped, exactly as a box
    // with no labels is skipped in the flat layout.
    return mainBoxes
      .map((m) => ({ main: m, inners: byParent.get(String(m.bulkPackageId)) || [] }))
      .filter((n) => n.inners.length > 0);
  }, [isNested, mainBoxes, printableGroups]);

  /* Units that belong to no box the seller holds — e.g. a lot only partly
     boxed, or a unit whose box record is not visible to this seller. They are
     still the seller's labels, so they are printed under their own heading
     rather than silently dropped. */
  const looseUnits = useMemo(() => {
    if (!isBoxed) return visibleUnits;
    const known = new Set(boxes.map((b) => String(b.bulkPackageId)));
    return visibleUnits.filter((u) => !known.has(String(u.bulk_packaging_record_id || '')));
  }, [isBoxed, boxes, visibleUnits]);

  const print = async () => {
    window.print();
    const serials = visibleUnits.map((u) => u.serial);
    if (serials.length) { try { await printSellerUnits(serials); loadUnits(lotId); } catch { /* ignore */ } }
  };

  /* One unit label. Unchanged in content and size — same product name, lot
     number, CODE 128 barcode and serial the flat grid always printed. */
  const UnitLabel = ({ u }) => (
    <div
      style={{ width: `${cfg.w}mm`, height: `${cfg.h}mm` }}
      className="border border-stone-300 rounded-sm p-1 flex flex-col items-center justify-center overflow-hidden break-inside-avoid"
    >
      <p className="text-[7px] font-bold text-stone-800 leading-tight text-center truncate w-full">{lot ? (lot.productId?.productName || 'Item') : ''}</p>
      <p className="text-[6px] text-stone-500 leading-tight">{u.lotNumber}</p>
      <Barcode128 value={u.serial} height={bcH} width={1} className="w-full" />
      <p className="text-[6px] font-mono text-stone-700 leading-tight">{u.serial}</p>
    </div>
  );

  /* A grid of unit labels, capped to an exact number of columns so a partial
     last row centres instead of stretching. */
  const UnitGrid = ({ list, cols }) => (
    <div className="unit-grid" style={{ maxWidth: `${rowWidthMm(cols, cfg.w)}mm` }}>
      {list.map((u) => <UnitLabel key={u.serial} u={u} />)}
    </div>
  );

  /**
   * An INNER BOX (or, on a two-level lot, the bulk box itself): its PRINTED
   * LABEL, then the unit labels inside it.
   *
   * The label is the shared BulkPackageLabel — the very component the company
   * Labels page uses — so the badge, the Lot / Units in Box / Mfg / Expiry block
   * and the CODE 128 are identical for the same carton on both sides. `caption`
   * carries the box's position INSIDE ITS OWN main box, because its lot-wide
   * box_serial would read "box 7 of 10" on a carton that is really box 2 of 3.
   */
  const BoxCard = ({ group, caption, sub }) => (
    <div className="inner-card bp-page">
      <BulkPackageLabel box={toLabelBox(group.box)} lot={lot} caption={caption} />
      {sub && <p className="no-print mt-1 text-center text-[10px] text-stone-400">{sub}</p>}
      <p className="mt-3 text-center text-[10px] font-bold uppercase tracking-widest text-stone-400">
        Units in this box — {group.units.length}
      </p>
      <div className="mt-2">
        <UnitGrid list={group.units} cols={BOX_UNIT_COLS} />
      </div>
    </div>
  );

  if (approved === null) return <div className="flex-1 p-8 text-center text-stone-400 font-sora">Loading…</div>;
  if (!approved) {
    return (
      <div className="flex-1 p-4 sm:p-8 bg-white font-sora">
        <div className="max-w-xl mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <span className="material-symbols-outlined text-amber-500 text-4xl">lock</span>
          <h2 className="text-lg font-bold text-amber-800 mt-2">Labels are locked</h2>
          <p className="text-sm text-amber-700 mt-1">Available after your supplying company approves you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <style>{PRINT_CSS}</style>
      <div className="w-full max-w-[100rem] mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-stone-900">Labels</h1>
          <p className="text-sm text-stone-500">Print and scan the unit labels you received from your supplying company. Serials are assigned by the company.</p>
        </div>

        {/* Controls — unchanged. Same lot picker, layout picker, custom size and
            Print button, all wired to the same handlers as before. */}
        <div className="no-print border border-stone-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <Field label="Lot">
                <select className={inputCls} value={lotId} onChange={(e) => setLotId(e.target.value)}>
                  {lots.map((l) => <option key={l._id} value={l._id}>{lotLabel(l)} (avail {l.availableStock})</option>)}
                  {lots.length === 0 && <option value="">No lots yet</option>}
                </select>
              </Field>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-stone-400">{units.length} unit label(s)</span>
              <select className="border border-stone-200 rounded-lg text-xs px-2 py-1.5 bg-white" value={layout} onChange={(e) => setLayout(e.target.value)}>
                {Object.entries(LAYOUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                <option value="custom">Custom size…</option>
              </select>
              {layout === 'custom' && (
                <div className="no-print flex items-center gap-2">
                  {[['Cols', 'cols', 1], ['Width (mm)', 'w', 10], ['Height (mm)', 'h', 8]].map(([lbl, key, min]) => (
                    <label key={key} className="flex flex-col text-[10px] font-bold uppercase tracking-wider text-stone-400">
                      {lbl}
                      <input type="number" min={min} className="mt-0.5 w-16 border border-stone-200 rounded-lg text-xs px-2 py-1.5 bg-white text-stone-700"
                        value={custom[key]} onChange={(e) => setCustom((c) => ({ ...c, [key]: e.target.value }))} />
                    </label>
                  ))}
                </div>
              )}
            </div>
            <PrimaryBtn onClick={print} disabled={visibleUnits.length === 0}>
              <span className="material-symbols-outlined text-base">print</span> Print Labels
            </PrimaryBtn>
          </div>
          {lot && visibleUnits.length > 0 && (
            <p className="text-[11px] text-stone-500">Printing <b>{visibleUnits.length.toLocaleString('en-IN')}</b> label(s).</p>
          )}
        </div>

        {/* PACKAGING READ-OUT — makes the hierarchy explicit in words before the
            cards show it in layout. Only what the seller actually holds. */}
        {isBoxed && (
          <div className="no-print rounded-2xl border border-stone-200 bg-stone-50/60 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Packaging</p>
            <p className="mt-1 text-sm text-stone-600">
              {isNested ? (
                <>
                  You hold <b>{mainGroups.length} bulk packaging box(es)</b>, containing{' '}
                  <b>{printableGroups.length} inner box(es)</b> and{' '}
                  <b>{printableGroups.reduce((n, g) => n + g.units.length, 0).toLocaleString('en-IN')} unit label(s)</b>.
                </>
              ) : (
                <>
                  You hold <b>{printableGroups.length} bulk packaging box(es)</b> containing{' '}
                  <b>{printableGroups.reduce((n, g) => n + g.units.length, 0).toLocaleString('en-IN')} unit label(s)</b>.
                </>
              )}
              {looseUnits.length > 0 && (
                <> {looseUnits.length.toLocaleString('en-IN')} further label(s) are not inside a box you hold.</>
              )}
            </p>
          </div>
        )}

        {/* Printable sheet */}
        <div id="seller-label-sheet" className={isNested ? 'nested-sheet space-y-6' : 'space-y-6'}>

          {/* THE LOT / BATCH LABEL — the top of the hierarchy, printed first,
              exactly as the company page prints it. Shared LotLabel component,
              unmodified. */}
          {lot && visibleUnits.length > 0 && (
            <div className={`lot-master print-page${isBoxed ? ' has-pages' : ''}`}>
              <LotLabel lot={lot} />
            </div>
          )}

          {/* THREE LEVELS — a main box card physically contains its inner box
              cards, so the nesting on screen is the nesting in the warehouse. */}
          {isNested && mainGroups.map(({ main, inners }) => (
            <div key={main.bulkPackageId} className="main-card print-page">
              {/* THE OUTER CARTON'S OWN LABEL. Its caption is its lot-wide
                  position ("Bulk Packaging Box 1 of 2"), which for a MAIN box is
                  the correct reading — it is the inner boxes that need a
                  per-parent number. */}
              <div className="bp-page mx-auto" style={{ maxWidth: `${TOP_CARD_W}px` }}>
                <BulkPackageLabel
                  box={toLabelBox(main)}
                  lot={lot}
                  caption={`Bulk Packaging Box ${main.boxSerial || ''} of ${mainBoxes.length}`}
                />
              </div>
              <p className="no-print mt-2 text-center text-[10px] font-bold uppercase tracking-widest text-stone-400">
                {inners.length} inner box(es) · {inners.reduce((n, g) => n + g.units.length, 0)} unit label(s)
              </p>
              <div className="inner-stack sm:grid-cols-2">
                {inners.map((g) => (
                  <BoxCard
                    key={g.box.bulkPackageId}
                    group={g}
                    caption={`Inner Box ${g.box.innerIndex || ''}${main.innerTotal ? ` of ${main.innerTotal}` : ''}`}
                    sub={g.box.sourceWarehouse ? `from ${g.box.sourceWarehouse}` : null}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* TWO LEVELS — units sit directly under their bulk packaging box,
              exactly as the company page falls back when a lot has no inner
              boxes. */}
          {isBoxed && !isNested && printableGroups.map((g) => (
            <div key={g.box.bulkPackageId} className="main-card print-page">
              <div className="mx-auto" style={{ maxWidth: `${TOP_CARD_W}px` }}>
                <BoxCard
                  group={g}
                  caption={`Bulk Packaging Box ${g.box.boxSerial || ''} of ${printableGroups.length}`}
                  sub={g.box.sourceWarehouse ? `from ${g.box.sourceWarehouse}` : null}
                />
              </div>
            </div>
          ))}

          {/* Units outside any box the seller holds — and, on a lot with no bulk
              packaging at all, simply every unit, which is the original flat
              grid this page has always shown. */}
          {looseUnits.length > 0 && (
            <div className={isBoxed ? 'main-card print-page' : ''}>
              {isBoxed && (
                <p className="no-print mb-2 text-[11px] font-bold uppercase tracking-wider text-stone-500">
                  Not in a box you hold · {looseUnits.length} label(s)
                </p>
              )}
              {isBoxed
                ? <UnitGrid list={looseUnits} cols={BOX_UNIT_COLS} />
                : (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cfg.cols}, ${cfg.w}mm)`, gap: '2mm' }}>
                    {looseUnits.map((u) => <UnitLabel key={u.serial} u={u} />)}
                  </div>
                )}
            </div>
          )}

          {visibleUnits.length === 0 && (
            <p className="no-print text-sm text-stone-400 py-10 text-center">
              No unit labels for this lot — they arrive when your company supplies labeled stock.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SellerLabels;