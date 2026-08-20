import React from 'react';
import PackagingChip from './PackagingChip';

/**
 * PACKAGING INFORMATION — the READ-ONLY "what was physically in this lot"
 * renderer, shared by:
 *   - Inventory → Lot Details          (pages/Company/ims/ImsLotDetails.jsx)
 *   - Transfer History → View          (pages/Company/WarehouseTransferDetail.jsx)
 *
 * The markup was LIFTED VERBATIM out of ImsLotDetails so the two pages cannot
 * drift apart — there is exactly one definition of how a Bulk Packaging ID and
 * its unit codes are drawn. Nothing here mutates: no transfer, no receive, no
 * generate, no print. It renders whatever it is handed and nothing else.
 *
 * Both callers normalise their own API payload into this ONE shape, which is
 * why the component needs no knowledge of lots, shipments or warehouses:
 *
 *   boxes          [{ bulkPackagingId, boxSerial, unitsInBox, status,
 *                     receivedAt, unitCodes: [string] }]
 *   looseUnitCodes [string]   units not linked to any box (single package, or
 *                             labels generated before the lot was packed)
 *   summary        { totalBoxes, receivedBoxes, pendingBoxes, receivedUnits,
 *                     pendingUnits } | null   — null = single package
 *   totalBoxes     number | null  ("Box 2 of 4" needs the denominator)
 *   unitTotal      number  — true total, may exceed the codes actually listed
 *   unitsTruncated boolean — the caller capped the list (see MAX_DETAIL_UNITS)
 *   unitsLabel     string  — heading for the un-boxed list
 *
 * MIXED transfers are handled by construction: a payload carrying both boxes
 * and looseUnitCodes renders BOTH sections, because each is driven by its own
 * array rather than by an either/or flag.
 */

const num = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtDay = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const Detail = ({ label, value, mono = false }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
    <p className={`text-sm text-stone-800 font-medium break-words ${mono ? 'font-mono' : ''}`}>
      {value === null || value === undefined || value === '' ? '—' : value}
    </p>
  </div>
);

const Section = ({ title, subtitle, children, right }) => (
  <section className="border border-stone-200 rounded-2xl bg-white shadow-sm overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-stone-100 bg-stone-50/60">
      <div>
        <h2 className="text-sm font-bold text-stone-800">{title}</h2>
        {subtitle && <p className="text-[11px] text-stone-400">{subtitle}</p>}
      </div>
      {right}
    </div>
    <div className="p-5">{children}</div>
  </section>
);

export const StatusPill = ({ status }) => {
  const s = String(status || '').toLowerCase();
  const cls =
    s === 'received' ? 'bg-green-50 text-green-700'
    : s === 'partially_received' ? 'bg-amber-50 text-amber-700'
    : s === 'cancelled' ? 'bg-red-50 text-red-600'
    : s === 'created' || s === 'pending' ? 'bg-stone-100 text-stone-600'
    : 'bg-stone-100 text-stone-600';
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${cls}`}>
      {s ? s.replace(/_/g, ' ') : '—'}
    </span>
  );
};

/**
 * The units of ONE original lot inside a box — lot number, its mfg and expiry,
 * how many units, then the codes.
 *
 * Only a REPACK carton needs this: it may hold units from several lots (its
 * label carries no expiry, which is what makes that safe), so the dates have to
 * be readable per lot rather than per box. A lot's own box has one lot by
 * definition and passes no `lotGroups`, so it renders exactly as before.
 */
const LotGroup = ({ group }) => (
  <div className="border border-stone-100 rounded-lg overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-stone-50/40">
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Lot</p>
        <p className="font-mono text-[11px] text-stone-800 break-all">{group.lotNumber}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-500">
        <span>Mfg <span className="font-medium text-stone-700">{fmtDay(group.mfgDate)}</span></span>
        <span>Expiry <span className="font-medium text-stone-700">{fmtDay(group.expiryDate)}</span></span>
        <span className="font-bold text-stone-700">{num(group.unitCount)} unit(s)</span>
      </div>
    </div>
    <ul className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-x-4 gap-y-1">
      {(group.units || []).map((u) => (
        <li key={u.unitCode || u.serial} className="flex items-center justify-between gap-2 text-[11px] border-b border-dashed border-stone-100 py-1">
          <span className="font-mono text-stone-700 break-all">{u.unitCode || u.serial}</span>
          {/* {u.status && u.status !== 'in_stock' && (
            <span className="shrink-0 text-[10px] text-stone-400">{String(u.status).replace(/_/g, ' ')}</span>
          )} */}
        </li>
      ))}
    </ul>
  </div>
);

/**
 * ONE BOX HEADER, used by every box on the page — a carton whose units are all
 * here, and one that is only partly here.
 *
 * The two used to be drawn differently: a whole box showed the received badge
 * and date but no count, a partial one showed "6 of 50 units here" but no
 * badge. Same object, two vocabularies. Both now read the same way:
 *   left   box position, ID, and how much of it is here
 *   right  the received badge and date, when it has been received
 */
/**
 * `warehouse` / `warehouseBreakdown` are OPTIONAL and company-only: a warehouse
 * page never sends them, because a warehouse holds what it holds. The company
 * owns every warehouse, so its view of one lot spans several — and the location
 * belongs on the box's own header rather than in a second listing of it.
 */
const WhereItIs = ({ warehouse, breakdown }) => {
  if (!warehouse && !(breakdown || []).length) return null;
  // Undivided: one name. Split by a later transfer: every part, with its share,
  // so a carton whose contents were separated never reads as if it were whole.
  const text = warehouse
    ? `at ${warehouse}`
    : breakdown.map((b) => `${num(b.qty)} at ${b.warehouse}`).join(' · ');
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-stone-500 bg-stone-100 rounded-full px-2 py-0.5">
      <span className="material-symbols-outlined text-[12px]">warehouse</span>
      {text}
    </span>
  );
};

const BoxHeader = ({ id, boxSerial, totalBoxes, here, capacity, status, receivedAt, kind, label, warehouse, warehouseBreakdown }) => (
  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-stone-50/60 border-b border-stone-100">
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
        {label || (boxSerial ? `Box ${boxSerial}${totalBoxes ? ` of ${totalBoxes}` : ''}` : 'Units')}
        {here != null ? ` · ${num(here)}${capacity ? ` of ${num(capacity)}` : ''} units here` : ''}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {kind && <PackagingChip kind={kind} />}
        <p className="font-mono text-xs text-stone-800 break-all">{id || '—'}</p>
        {/* <WhereItIs warehouse={warehouse} breakdown={warehouseBreakdown} /> */}
      </div>
    </div>
    <div className="flex items-center gap-3">
      {status && <StatusPill status={status} />}
      {receivedAt && <span className="text-[11px] text-stone-400">Received {fmtDay(receivedAt)}</span>}
    </div>
  </div>
);

/** One box header + the unit codes inside it. */
const BoxCard = ({ box, totalBoxes }) => (
  <div className="border border-stone-200 rounded-xl overflow-hidden">
    <BoxHeader
      id={box.bulkPackagingId}
      boxSerial={box.boxSerial}
      totalBoxes={totalBoxes}
      here={box.unitsInBox}
      capacity={box.capacity}
      status={box.status}
      receivedAt={box.receivedAt}
      kind={box.kind}
      warehouse={box.warehouse}
      warehouseBreakdown={box.warehouseBreakdown}
    />

    {/* Lot-wise when the caller supplies groups (a repack carton), flat
        otherwise — one component, both shapes. */}
    {(box.lotGroups || []).length > 0 ? (
      <div className="p-3 space-y-3">
        {box.lotGroups.map((g) => <LotGroup key={g.lotNumber + g.inventoryId} group={g} />)}
      </div>
    ) : (box.unitCodes || []).length > 0 ? (
      <ul className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
        {box.unitCodes.map((code) => (
          <li key={code} className="flex items-center justify-between gap-2 text-[11px] border-b border-dashed border-stone-100 py-1">
            <span className="font-mono text-stone-700 break-all">{code}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="px-4 py-4 text-[11px] text-stone-400">No unit labels generated for this box yet.</p>
    )}
  </div>
);

/** ONE UNIT CODE. The same row wherever codes are listed. */
const UnitCodeLi = ({ code }) => (
  <li className="flex items-center justify-between gap-2 text-[11px] border-b border-dashed border-stone-100 py-1">
    <span className="font-mono text-stone-700 break-all">{code}</span>
  </li>
);

/**
 * Units held here out of a box that is NOT here in full.
 *
 * Rendered as a labelled group rather than a box card, because the carton
 * itself is elsewhere — the header names the parent Bulk Packaging ID and says
 * how much of it is actually present, so two boxes' units can never be confused
 * for one another.
 */
const LooseBoxGroup = ({ group, totalBoxes }) => (
  <div className="border border-stone-200 rounded-xl overflow-hidden">
    {/* SAME header as a whole box — see BoxHeader. `warehouse` and `kind` are
        optional: the warehouse page passes neither. */}
    <BoxHeader
      id={group.bulkPackagingId || group.warehouse}
      boxSerial={group.boxSerial}
      totalBoxes={totalBoxes}
      here={group.codes.length}
      capacity={group.unitsInBox}
      status={group.status}
      receivedAt={group.receivedAt}
      kind={group.kind}
      label={group.bulkPackagingId
        ? (group.kind === 'repack' ? 'Box Packaging' : undefined)
        : (group.warehouse ? `Units · at ${group.warehouse}` : 'Units')}
    />
    <ul className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
      {group.codes.map((code) => (
        <UnitCodeLi key={code} code={code} />
      ))}
    </ul>
  </div>
);

const LotPackagingPanel = ({
  boxes = [],
  looseUnitCodes = [],
  // Loose units that DO know their parent box — see LooseBoxGroup. Optional, so
  // a caller that doesn't compute them (Transfer History) renders exactly as
  // before.
  looseUnitGroups = [],
  summary = null,
  totalBoxes = null,
  unitsPerBox = null,
  unitTotal = 0,
  originalQty = null,
  unitsTruncated = false,
  unitsLabel = 'Unit Codes',
  // Heading over the box cards. Defaults to what every lot view has always
  // shown; a repack carton is not bulk packaging, so its view titles it
  // "Box Packaging".
  boxesTitle = 'Bulk Packaging IDs',
  showSummary = true,
}) => {
  // "This lot is packed into boxes" — true whether those boxes are here WHOLE
  // (cards) or only partly (groups). Reading boxes.length alone made a lot whose
  // cartons all arrived partially render as "Single package", with no Packaging
  // Summary figures at all.
  const boxGroups = looseUnitGroups.filter((g) => g.bulkPackagingId);
  const boxed = boxes.length > 0 || boxGroups.length > 0;

  /**
   * THE THREE LEVELS: Bulk Packaging (main carton) → Inner Box → units.
   *
   * Every entry — a whole box card and a partly-present group alike — states
   * its parent carton, so both are folded under one heading here. An entry with
   * no parent (a two-level lot, or a single-package one) is left where it is
   * and renders exactly as before; no carton is invented for it.
   */
  const parentIdOf = (e) => e.parentBulkPackagingId || e.parent_bulk_packaging_id || null;
  const mainCartons = [];
  const cartonByIdx = new Map();
  const ungrouped = { cards: [], groups: [] };
  const place = (entry, bucket) => {
    const pid = parentIdOf(entry);
    if (!pid) { ungrouped[bucket].push(entry); return; }
    if (!cartonByIdx.has(pid)) {
      cartonByIdx.set(pid, mainCartons.length);
      mainCartons.push({
        bulkPackagingId: pid,
        boxSerial: entry.parentBoxSerial ?? entry.parent_box_serial ?? null,
        unitsInBox: entry.parentUnitsInBox ?? entry.parent_units_in_box ?? null,
        status: entry.parentStatus || entry.parent_status || null,
        receivedAt: entry.parentReceivedAt || entry.parent_received_at || null,
        cards: [], groups: [],
      });
    }
    mainCartons[cartonByIdx.get(pid)][bucket].push(entry);
  };
  boxes.forEach((b) => place(b, 'cards'));
  boxGroups.forEach((g) => place(g, 'groups'));
  const nested = mainCartons.length > 0;
  const totalMainBoxes = mainCartons.length;
  // How many units of each carton are actually here — summed from its inner
  // boxes, never guessed from the carton's capacity.
  const hereIn = (c) =>
    c.cards.reduce((n, b) => n + Number(b.unitsInBox || 0), 0)
    + c.groups.reduce((n, g) => n + g.codes.length, 0);

  return (
    <>
      {showSummary && (
        <Section title="Packaging Summary">
          {boxed ? (
            /* EVERY FIGURE HERE COMES FROM THE SUMMARY the server computed
               (bulkPackageService.summaryForLot), so the sending and receiving
               sides of a transfer are drawn from ONE calculation.

               The `totalBoxes` / `unitsPerBox` props are the fallback for a
               caller that supplies no summary (Transfer History's snapshot).
               They used to be read FIRST, which is why a receiving row — whose
               Inventory record carries neither, because it was never created
               through Create Lot — printed "0 boxes" and "Total Boxes 0" beside
               a list of the cartons actually on its shelf. */
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
              <Detail
                label="Packaging"
                value={`${num(summary?.totalBoxes ?? totalBoxes ?? boxes.length)} boxes${
                  (summary?.unitsPerBox ?? unitsPerBox)
                    ? ` × ${num(summary?.unitsPerBox ?? unitsPerBox)} units`
                    : ''
                }`}
              />
              <Detail label="Total Boxes" value={num(summary?.totalBoxes ?? totalBoxes ?? boxes.length)} />
              {summary && <Detail label="Boxes Received" value={num(summary.receivedBoxes)} />}
              {summary && <Detail label="Boxes Pending" value={num(summary.pendingBoxes)} />}
              {summary && <Detail label="Units Received" value={num(summary.receivedUnits)} />}
              {summary && <Detail label="Units Pending" value={num(summary.pendingUnits)} />}
              <Detail
                label="Unit Labels"
                /* HOW MANY CODES EXIST HERE — not how much is on the shelf.
                   `unitTotal` is the row's IN-STOCK set, which is the right
                   basis for the Unit Codes section but reads 0 for a warehouse
                   whose units are minted-but-not-put-away, or already
                   dispatched, while their codes are listed right below. */
                value={summary?.unitLabels != null
                  ? num(summary.unitLabels)
                  : (originalQty == null ? num(unitTotal) : `${num(unitTotal)} of ${num(originalQty)}`)}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
              <Detail label="Packaging" value="Single package" />
              <Detail
                label="Unit Labels"
                value={originalQty == null ? num(unitTotal) : `${num(unitTotal)} of ${num(originalQty)}`}
              />
            </div>
          )}
        </Section>
      )}

      {/* BULK PACKAGING IDs + the units inside each box — nested three levels
          deep when the lot has main cartons, flat when it does not. */}
      {boxed && (
        <Section
          title={boxesTitle}
          right={(
            <span className="text-[11px] text-stone-400">
              {nested
                ? `${num(totalMainBoxes)} bulk box(es) · ${num(boxes.length + boxGroups.length)} inner box(es)`
                : `${num(boxes.length + boxGroups.length)} box(es)`}
            </span>
          )}
        >
          <div className="space-y-4">
            {/* LEVEL 1 — the Bulk Packaging carton, with its inner boxes inside
                its own border so the nesting on screen is the nesting in the
                warehouse. <details> gives it a collapsible heading with no
                extra state to keep. */}
            {mainCartons.map((c, i) => (
              <details key={c.bulkPackagingId} open className="border border-stone-200 rounded-xl overflow-hidden">
                <summary className="cursor-pointer list-none">
                  <BoxHeader
                    id={c.bulkPackagingId}
                    boxSerial={c.boxSerial ?? i + 1}
                    totalBoxes={totalMainBoxes}
                    here={hereIn(c)}
                    capacity={c.unitsInBox}
                    status={c.status}
                    receivedAt={c.receivedAt}
                    kind="bulk_package"
                  />
                </summary>
                {/* LEVEL 2 — the inner boxes, each with its own units. */}
                <div className="p-3 space-y-3">
                  {c.cards.map((box) => (
                    <BoxCard key={box.bulkPackagingId} box={box} totalBoxes={null} />
                  ))}
                  {c.groups.map((g) => (
                    <LooseBoxGroup key={g.bulkPackagingId} group={g} totalBoxes={null} />
                  ))}
                </div>
              </details>
            ))}
            {/* A two-level lot's boxes — no carton above them, so they stay
                exactly where they were. */}
            {ungrouped.cards.map((box) => (
              <BoxCard key={box.bulkPackagingId} box={box} totalBoxes={totalBoxes} />
            ))}
            {ungrouped.groups.map((g) => (
              <LooseBoxGroup key={g.bulkPackagingId} group={g} totalBoxes={totalBoxes} />
            ))}
          </div>
        </Section>
      )}

      {/* Units from boxes that are NOT here in full — one group per parent box.
          Rendered ALONGSIDE the box cards above when both are present, and a
          unit is in exactly one of the two: the caller puts a box's units in
          its card OR in a group here, never both. */}
      {/* Groups that name no box at all — the company view's per-warehouse
          split. Box groups are rendered above, with the boxes, so nothing is
          drawn twice. */}
      {looseUnitGroups.filter((g) => !g.bulkPackagingId).length > 0 && (
        <Section
          title={unitsLabel}
          subtitle="Where this lot's units are held"
          right={(
            <span className="text-[11px] text-stone-400">
              {num(looseUnitGroups.filter((g) => !g.bulkPackagingId).reduce((n, g) => n + g.codes.length, 0))} unit(s)
            </span>
          )}
        >
          <div className="space-y-4">
            {looseUnitGroups.filter((g) => !g.bulkPackagingId).map((g) => (
              <LooseBoxGroup key={g.warehouse || 'units'} group={g} totalBoxes={totalBoxes} />
            ))}
          </div>
        </Section>
      )}

      {/* Units with no parent box at all. Rendered ALONGSIDE the boxes above when
          both are present, which is exactly the "mixed transfer" case. */}
      {looseUnitCodes.length > 0 && (
        <Section
          title={boxed ? 'Unit Codes (not in a box)' : unitsLabel}
          right={<span className="text-[11px] text-stone-400">{num(looseUnitCodes.length)} unit(s)</span>}
        >
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
            {looseUnitCodes.map((code) => (
              <UnitCodeLi key={code} code={code} />
            ))}
          </ul>
        </Section>
      )}

      {!boxed && looseUnitCodes.length === 0 && looseUnitGroups.length === 0 && (
        <Section title={unitsLabel}>
          <p className="text-sm text-stone-400">No unit codes were recorded for this stock.</p>
        </Section>
      )}

      {/* {unitsTruncated && (
        <p className="text-[11px] text-stone-400 px-1">
          Showing the first {num(boxes.reduce((n, b) => n + (b.unitCodes || []).length, 0) + looseUnitCodes.length)} of {num(unitTotal)} unit codes.
        </p>
      )} */}
    </>
  );
};

export default LotPackagingPanel;
