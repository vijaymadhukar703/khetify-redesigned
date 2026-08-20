import React, { useEffect, useMemo, useRef, useState } from 'react';
import Swal from 'sweetalert2';
import { Modal, Field, inputCls, PrimaryBtn, GhostBtn } from '../../pages/Company/ims/ImsUi';
import { fileHref } from '../../lib/fileHref';
import ScanBox from '../ims/ScanBox';
import PackagingChip from '../ims/PackagingChip';
import SellerTransferBoxLabels from './SellerTransferBoxLabel';
import {
  getSellerTransferChecklist, sellerTransferScan, packSellerTransferBox,
  discardSellerTransferBox, dispatchSellerTransfer, abandonSellerTransferBoxes,
} from '../../lib/sellerApi';

const toast = (icon, title) =>
  Swal.fire({ icon, title, toast: true, position: 'top-end', timer: 2600, showConfirmButton: false });
const apiErr = (e) =>
  toast('error', e?.response?.data?.message || e.message || 'Something went wrong');

/**
 * WHICH LEVEL a scan resolved to, in the operator's words. `boxLevel` comes
 * from the server (main vs inner carton); `scanType` keeps its own values, so a
 * payload without boxLevel simply reads "Box".
 */
const scanLevelLabel = (d) => {
  if (d.scanType === 'lot') return 'Lot';
  if (d.scanType === 'unit') return 'Unit';
  return d.boxLevel === 'main' ? 'Main box' : d.boxLevel === 'inner' ? 'Inner box' : 'Bulk package';
};

// The shared vocabulary from lib/packagingKind — a carton must read the same
// word here as it does in Inventory, the label pages and the receive dialog.
/* ── DELIVERY CHALLAN. Images AND PDFs are both accepted — the same handling
   the seller New Transfer form uses, so the two places behave identically. */
const isImageFile = (file) => /^image\//i.test(file?.type || '');
const isPdfFile = (file) => /pdf$/i.test(file?.type || '') || /\.pdf$/i.test(file?.name || '');
const prettySize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The picked challan file: image thumbnail or a PDF row, with Remove. */
const ChallanPreview = ({ file, previewUrl, onRemove }) => (
  <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50/60 p-2">
    {previewUrl ? (
      <img src={previewUrl} alt={file.name} className="size-12 shrink-0 rounded object-cover border border-stone-200" />
    ) : (
      <span className="material-symbols-outlined shrink-0 text-[32px] text-stone-400">picture_as_pdf</span>
    )}
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs font-bold text-stone-700" title={file.name}>{file.name}</p>
      <p className="text-[11px] text-stone-400">{prettySize(file.size)}</p>
    </div>
    <button
      type="button"
      onClick={onRemove}
      className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-[#EA2831] hover:underline"
    >
      Remove
    </button>
  </div>
);

const chipFor = (type) => {
  if (type === 'unit') return 'unit';
  if (type === 'lot') return 'lot';
  return 'bulk_package';
};

/**
 * SELLER WAREHOUSE → WAREHOUSE TRANSFER: Scan → Select → Box → Dispatch.
 *
 * The seller mirror of the company's DispatchScanModal
 * (pages/Company/ims/ImsTransport.jsx) — same steps, same rules, same refusal
 * reasons, fed by the seller's own owner-scoped endpoints.
 *
 * THIS IS NOT THE CUSTOMER FLOW. The seller order popup (OrderProcessModal in
 * SellerOperations) builds a customer parcel: it prints a delivery label with a
 * deliver-to address and commits everything in one dispatch-order call. A
 * warehouse transfer has no customer and no address, so it uses the simple
 * transfer box + box label flow instead, and the order flow is left untouched.
 *
 * WHAT SCANNING DOES AND DOES NOT DO. A scan only asks the server "what is this
 * label worth?" — it reserves nothing and deducts nothing. Packing a box is a
 * real write (the box ID has to exist before it can be printed), but it is a
 * GROUPING, not a movement: the scanned count is identical before and after,
 * and a box can be undone until the moment of dispatch. Stock moves once, in
 * the Dispatch call, which re-validates every code again.
 *
 * A BOX IS A DRAFT UNTIL THE TRANSFER DISPATCHES. Close this dialog without
 * dispatching and every box made in it is deleted server-side and its units
 * become loose stock again — they are NOT "already inside a box" and are free
 * for the next transfer. Only a successful dispatch makes the split permanent.
 * The server sweeps again whenever this dialog is reopened, so a browser crash
 * cannot strand a unit either.
 */
const SellerTransferProcessModal = ({ shipment, onClose, onDone }) => {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);       // checklist: ref, from/to, items
  const [items, setItems] = useState([]);       // per-product required quantities
  // One row per SCANNED UNIT, so a carton can still be split across two boxes.
  const [pending, setPending] = useState([]);   // [{ code, productId, lotNumber, source, type }]
  const [checked, setChecked] = useState(() => new Set());
  const [boxes, setBoxes] = useState([]);       // real, discardable until dispatch
  const [history, setHistory] = useState([]);
  const [dispatched, setDispatched] = useState(null); // { ref, boxes }
  const [showLabels, setShowLabels] = useState(false);
  // DELIVERY CHALLAN. Pre-filled from whatever the transfer already carries
  // (captured at New Transfer, or on a previous visit here), so the paperwork is
  // entered once and never twice.
  const [challanNumber, setChallanNumber] = useState('');
  const [challan, setChallan] = useState(null);
  const [challanUrl, setChallanUrl] = useState(null);
  const challanRef = useRef(null);

  useEffect(() => {
    let alive = true;
    getSellerTransferChecklist(shipment._id)
      .then((r) => {
        if (!alive) return;
        const d = r?.data || r;
        setInfo(d);
        setItems(d?.items || []);
        if (d?.challanNumber) setChallanNumber(d.challanNumber);
      })
      .catch(apiErr)
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [shipment._id]);

  /* ------------------------------------------------------------- challan */

  const pickChallan = (file) => {
    setChallanUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return file && isImageFile(file) ? URL.createObjectURL(file) : null; });
    setChallan(file);
  };
  const clearChallan = () => {
    pickChallan(null);
    // Clearing the INPUT too is what lets the same file be picked again.
    if (challanRef.current) challanRef.current.value = '';
  };
  const onChallanChange = (ev) => {
    const file = ev.target.files?.[0] || null;
    if (file && !isImageFile(file) && !isPdfFile(file)) {
      toast('error', 'Attach an image or a PDF');
      if (challanRef.current) challanRef.current.value = '';
      return;
    }
    pickChallan(file);
  };
  useEffect(() => () => { if (challanUrl) URL.revokeObjectURL(challanUrl); }, [challanUrl]);

  // A document is in place if one is already stored on the transfer, or one has
  // just been picked. The server re-checks both on the dispatch call and is the
  // authority; this only decides whether the button is live.
  const hasChallanDoc = !!(info?.challanDocumentUrl || challan);
  const challanReady = !!challanNumber.trim() && hasChallanDoc;

  /* ------------------------------------------------------------ counting */

  // Every unit currently accounted for: loose on screen, plus already boxed.
  const boxedCodes = useMemo(
    () => boxes.flatMap((b) => b.unitCodes || []),
    [boxes],
  );
  const selectedCodes = useMemo(
    () => [...pending.map((u) => u.code), ...boxedCodes],
    [pending, boxedCodes],
  );

  const countFor = (pid) => selectedCodes.length === 0
    ? 0
    : [...pending, ...boxes.flatMap((b) => b.units || [])]
      .filter((u) => String(u.productId) === String(pid)).length;

  const requiredTotal = items.reduce((n, it) => n + Number(it.requiredQty || 0), 0);
  const scannedTotal = selectedCodes.length;
  const complete = requiredTotal > 0 && scannedTotal === requiredTotal;
  // Every loose unit must be in a box before dispatch — otherwise it would
  // travel with nothing to stick a label on, and the destination would have no
  // box label to scan for it.
  const allBoxed = pending.length === 0 && boxes.length > 0;

  /* --------------------------------------------------------------- scan */

  const onScan = async (raw) => {
    const code = String(raw || '').trim();
    if (!code || busy) return;
    setBusy(true);
    try {
      const r = await sellerTransferScan(shipment._id, { code, selectedCodes });
      const d = r?.data || r;
      if (!d?.addedUnitCodes?.length) { toast('error', 'Nothing was added by this scan.'); return; }

      // DOUBLE-COUNT GUARD, client side too: a unit this dialog already holds —
      // e.g. an inner box scanned before its parent carton — is never added a
      // second time. The server applies the same rule against the database.
      const held = new Set(selectedCodes);
      const fresh = d.addedUnitCodes.filter((c) => !held.has(c));
      if (!fresh.length) { toast('error', 'These units have already been scanned.'); return; }

      const source = d.bulkPackagingId || (d.scanType === 'lot' ? d.lotNumber : null);
      setPending((prev) => [
        ...prev,
        ...fresh.map((c) => ({
          code: c,
          productId: String(d.productId),
          lotNumber: d.lotNumber,
          type: d.scanType,
          level: scanLevelLabel(d),
          source: source && source !== c ? source : null,
        })),
      ]);
      // Newly scanned units start ticked — the common case is boxing what you
      // just scanned, and un-ticking is easier than ticking twenty rows.
      // setChecked((prev) => { const n = new Set(prev); fresh.forEach((c) => n.add(c)); return n; });

      const unavailable = Number(d.unavailableQuantity || 0);
      setHistory((h) => [{
        key: `${code}-${Date.now()}`, code: source || fresh[0], ok: true,
        level: scanLevelLabel(d), qty: fresh.length, lot: d.lotNumber,
      }, ...h]);
      toast(
        unavailable ? 'warning' : 'success',
        unavailable
          ? `Added ${fresh.length} of ${d.boxUnitTotal} — ${unavailable} unavailable · Lot ${d.lotNumber}`
          : `Added ${fresh.length} unit(s) · Lot ${d.lotNumber || '—'}`,
      );
    } catch (e) {
      const msg = e?.response?.data?.message || e.message || 'That label could not be used';
      setHistory((h) => [{ key: `${code}-${Date.now()}`, code, ok: false, error: msg }, ...h]);
      toast('error', msg);
    } finally { setBusy(false); }
  };

  /* --------------------------------------------------------- box building */

  const toggle = (code) => setChecked((prev) => {
    const n = new Set(prev);
    if (n.has(code)) n.delete(code); else n.add(code);
    return n;
  });
  const toggleAll = () => setChecked((prev) =>
    (prev.size === pending.length ? new Set() : new Set(pending.map((u) => u.code))));

  const selected = pending.filter((u) => checked.has(u.code));

  /**
   * ADD TO BOX. The server mints the ID, links the units and writes the audit
   * rows; it also refuses anything that is not one of THIS transfer's scannable
   * units, so a box can never reach into the rest of the warehouse.
   *
   * THE SCANNED COUNT DOES NOT MOVE — the ticked rows are replaced by one box
   * carrying exactly the same unit codes.
   */
  const addToBox = async () => {
    if (!selected.length || busy) return;
    setBusy(true);
    try {
      const r = await packSellerTransferBox(shipment._id, { serials: selected.map((u) => u.code) });
      const box = r?.data || r;
      const used = new Set(selected.map((u) => u.code));
      setBoxes((prev) => [...prev, {
        sellerBoxId: box.sellerBoxId,
        unitCount: box.unitCount,
        lotCount: box.lotCount,
        productName: box.productName,
        unitCodes: box.unitCodes || [...used],
        units: selected.map((u) => ({ code: u.code, productId: u.productId })),
      }]);
      setPending((prev) => prev.filter((u) => !used.has(u.code)));
      setChecked(new Set());
      toast('success', `Box ${boxes.length + 1} packed · ${box.sellerBoxId}`);
    } catch (e) { apiErr(e); } finally { setBusy(false); }
  };

  /**
   * UNDO A BOX. It is a real database row, so dropping it on screen alone would
   * leave an ID behind that names no physical carton. The box is deleted and
   * its units come back as individual loose rows — the state they were in
   * before the box was made, checkboxes and all.
   */
  const undoBox = async (sellerBoxId) => {
    if (busy) return;
    const box = boxes.find((b) => b.sellerBoxId === sellerBoxId);
    if (!box) return;
    const { isConfirmed } = await Swal.fire({
      title: 'Remove this box?',
      text: `The ${box.unitCount} unit(s) will go back as loose units.`,
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Remove box', confirmButtonColor: '#EA2831',
    });
    if (!isConfirmed) return;
    setBusy(true);
    try {
      const r = await discardSellerTransferBox(shipment._id, sellerBoxId);
      const d = r?.data || r;
      setBoxes((prev) => prev.filter((b) => b.sellerBoxId !== sellerBoxId));
      setPending((prev) => [
        ...prev,
        ...(d.units || []).map((u) => ({
          code: u.serial,
          productId: String(u.productId),
          lotNumber: u.lotNumber,
          type: 'unit',
          level: 'Unit',
          source: u.bulkPackagingId || null,
        })),
      ]);
      toast('success', `${d.sellerBoxId} removed — ${d.unitCount} unit(s) are loose again`);
    } catch (e) { apiErr(e); } finally { setBusy(false); }
  };

  /* ----------------------------------------------------------- dispatch */

  const dispatchNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // MULTIPART, so the challan document travels with the dispatch. The
      // server re-derives what is required, re-checks every code and refuses
      // outright unless both challan parts are present, before a unit moves.
      const fd = new FormData();
      fd.append('scannedCodes', JSON.stringify(selectedCodes));
      fd.append('challanNumber', challanNumber.trim());
      if (challan) fd.append('challanDocument', challan, challan.name);
      const r = await dispatchSellerTransfer(shipment._id, fd);
      const packed = r?.boxes || [];
      setDispatched({ ref: r?.data?.ref || info?.ref, boxes: packed });
      // The boxes are on their way now, so their labels are what the manager
      // needs next — open the sheet instead of closing on them.
      setShowLabels(true);
      toast('success', r?.message || 'Transfer dispatched');
    } catch (e) { apiErr(e); } finally { setBusy(false); }
  };

  /**
   * CLOSING WITHOUT DISPATCHING THROWS EVERYTHING AWAY — the loose scans, which
   * only ever lived in this component, AND the boxes, which are drafts on the
   * server until dispatch. The units go back to being ordinary loose stock and
   * can be scanned into any other transfer straight away.
   */
  const close = async () => {
    if (dispatched) { onDone(); return; }
    if (pending.length || boxes.length) {
      const bits = [];
      if (boxes.length) bits.push(`${boxes.length} draft box(es)`);
      if (pending.length) bits.push(`${pending.length} loose scanned unit(s)`);
      const { isConfirmed } = await Swal.fire({
        title: 'Discard this transfer?',
        text: `${bits.join(' and ')} will be discarded and the units will be available again. Nothing has been dispatched — you will need to scan everything again.`,
        icon: 'warning', showCancelButton: true,
        confirmButtonColor: '#EA2831', confirmButtonText: 'Discard & close', cancelButtonText: 'Keep working',
      });
      if (!isConfirmed) return;
    }
    // Tell the server to bin the drafts. If this call never lands — closed tab,
    // dropped connection — the sweep on the next open cleans up regardless, so
    // the units are never stranded.
    if (boxes.length) await abandonSellerTransferBoxes(shipment._id).catch(() => {});
    onClose();
  };

  const title = `Transfer · ${info?.fromLabel || shipment.fromLabel || 'Source'} → ${info?.toLabel || shipment.toLabel || 'Destination'}`;

  return (
    <Modal title={title} onClose={close} wide>
      {loading && <p className="py-6 text-center text-sm text-stone-400">Loading…</p>}

      {!loading && (
        <>
          {/* No customer block, no address: a transfer moves between two of the
              seller's own warehouses. */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2">
            <p className="text-[11px] font-medium text-stone-600">
              <b className="text-stone-900">{info?.fromLabel || 'Source'}</b> →{' '}
              <b className="text-stone-900">{info?.toLabel || 'Destination'}</b>
              {info?.ref && <span className="ml-2 font-mono text-stone-400">{info.ref}</span>}
            </p>
            <p className="text-[11px] font-bold text-stone-700">
              Scanned {scannedTotal} / {requiredTotal}
            </p>
          </div>

          {/* PROGRESS — per product, driven by the server's checklist. */}
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">Products</p>
          <div className="mb-3 overflow-hidden rounded-xl border border-stone-200">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-stone-50 text-[10px] uppercase text-stone-400">
                  <th className="px-3 py-2 font-bold">Product</th>
                  <th className="px-3 py-2 text-center font-bold">Req</th>
                  <th className="px-3 py-2 text-center font-bold">Scanned</th>
                  <th className="px-3 py-2 text-center font-bold">Left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {items.map((it) => {
                  const done = countFor(it.productId);
                  const left = Math.max(0, Number(it.requiredQty || 0) - done);
                  return (
                    <tr key={it.productId} className={left === 0 ? 'bg-green-50/40' : undefined}>
                      <td className="px-3 py-1.5 text-xs font-semibold text-stone-800">{it.name}</td>
                      <td className="px-3 py-1.5 text-center text-xs font-bold text-stone-700">{it.requiredQty}</td>
                      <td className="px-3 py-1.5 text-center text-xs font-bold text-stone-900">{done}</td>
                      <td className={`px-3 py-1.5 text-center text-xs font-bold ${left ? 'text-[#EA2831]' : 'text-green-600'}`}>{left}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!dispatched && !complete && (
            <>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">Scan a label</p>
              <ScanBox
                onScan={onScan}
                placeholder="Scan a Lot, Bulk Packaging ID, Main/Inner Box or Unit Code"
                autoFocus
                disabled={busy}
              />
              <p className="mt-1 text-[11px] text-stone-400">
                Scanning saves nothing — stock moves only when you dispatch.
              </p>
            </>
          )}

          {/* SCANNED UNITS — tick the ones going into the next box. */}
          {pending.length > 0 && !dispatched && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  Scanned units · not yet boxed ({pending.length})
                </p>
                <button onClick={toggleAll} className="text-[11px] font-bold text-[#EA2831] hover:underline">
                  {checked.size === pending.length ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="max-h-52 overflow-y-auto overflow-hidden rounded-xl border border-stone-200">
                <table className="w-full text-left text-sm">
                  <tbody className="divide-y divide-stone-100">
                    {pending.map((u) => (
                      <tr key={u.code} className={checked.has(u.code) ? 'bg-red-50/30' : undefined}>
                        <td className="w-8 py-1.5 pl-3">
                          <input
                            type="checkbox" className="h-4 w-4 accent-[#EA2831]"
                            checked={checked.has(u.code)} onChange={() => toggle(u.code)}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <PackagingChip kind={chipFor(u.type)} />
                            <span className="break-all font-mono text-xs font-bold text-stone-800">{u.code}</span>
                          </div>
                          <span className="text-[10px] text-stone-400">
                            Lot {u.lotNumber || '—'}
                            {u.source ? ` · from ${u.level} ${u.source}` : ''}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selected.length > 0 && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-[#EA2831]/30 bg-red-50/40 px-3 py-2">
                  <span className="text-[11px] font-bold text-stone-700">
                    {selected.length} unit(s) selected
                  </span>
                  <PrimaryBtn disabled={busy} onClick={addToBox}>
                    <span className="material-symbols-outlined text-base">inventory_2</span>
                    {busy ? 'Packing…' : `Add to Box ${boxes.length + 1}`}
                  </PrimaryBtn>
                </div>
              )}
            </div>
          )}

          {/* THE BOXES. Each one gets its own barcode and its own label. */}
          {boxes.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                Boxes ({boxes.length}) · draft until dispatch
              </p>
              <div className="divide-y divide-stone-100 rounded-xl border border-stone-200">
                {boxes.map((b, i) => (
                  <div key={b.sellerBoxId} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <span className="block text-xs font-bold text-stone-800">Box {i + 1}</span>
                      <span className="block break-all font-mono text-[10px] text-stone-500">{b.sellerBoxId}</span>
                      <span className="text-[10px] text-stone-400">
                        {b.unitCount} unit(s)
                        {b.lotCount > 1 ? ` · ${b.lotCount} lots inside` : ''}
                      </span>
                    </div>
                    {!dispatched && (
                      <button
                        onClick={() => undoBox(b.sellerBoxId)}
                        className="shrink-0 px-2 text-[11px] font-bold text-stone-400 hover:text-[#EA2831]"
                      >
                        Undo
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {history.length > 0 && !dispatched && (
            <div className="mt-3 max-h-32 divide-y divide-stone-100 overflow-y-auto rounded-xl border border-stone-100">
              {history.map((h) => (
                <div key={h.key} className="flex items-start gap-2 px-3 py-1.5">
                  <span className={`material-symbols-outlined shrink-0 text-[15px] ${h.ok ? 'text-green-600' : 'text-[#EA2831]'}`}>
                    {h.ok ? 'check_circle' : 'error'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="break-all font-mono text-[11px] font-bold text-stone-700">{h.code}</span>
                    {h.ok
                      ? <span className="text-[11px] text-stone-500"> · {h.level} · Lot {h.lot || '—'} +{h.qty}</span>
                      : <p className="text-[11px] text-[#EA2831]">{h.error}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* DISPATCHED — the boxes are on the road, so their labels can print. */}
          {dispatched && (
            <div className="mt-3 rounded-xl border border-green-200 bg-green-50/60 px-3 py-2.5">
              <p className="mb-1.5 text-xs font-bold text-green-700">
                Dispatched · {dispatched.boxes.length} box label(s) ready to print
              </p>
              <GhostBtn onClick={() => setShowLabels(true)}>
                <span className="material-symbols-outlined text-sm">print</span>
                Print box labels
              </GhostBtn>
              <p className="mt-1.5 text-[11px] text-stone-500">
                Stick one on each carton. The destination warehouse scans these to receive.
              </p>
            </div>
          )}

          {/* DELIVERY CHALLAN — REQUIRED BEFORE DISPATCH. Both parts. Shown
              once the goods are boxed, which is when the paperwork is actually
              written, so it does not clutter the scanning step. */}
          {!dispatched && boxes.length > 0 && (
            <div className="mt-3 rounded-xl border border-stone-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                
                {challanReady && (
                  <span className="text-[10px] font-bold text-green-600">✓ ready</span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                <Field label="Challan Number" required>
                  <input
                    className={inputCls}
                    value={challanNumber}
                    onChange={(e) => setChallanNumber(e.target.value)}
                    placeholder="As printed on the challan"
                  />
                </Field>
                <Field label="Challan Document" required>
                  {challan ? (
                    <ChallanPreview file={challan} previewUrl={challanUrl} onRemove={clearChallan} />
                  ) : info?.challanDocumentUrl ? (
                    /* ALREADY ON THE TRANSFER — attached when it was raised.
                       Openable here, and replaceable without being re-uploaded. */
                    <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50/60 p-2">
                      <span className="material-symbols-outlined shrink-0 text-[28px] text-green-600">task</span>
                      <div className="min-w-0 flex-1">
                        <a
                          href={fileHref(info.challanDocumentUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate text-xs font-bold text-[#EA2831] hover:underline"
                          title={info.challanDocumentName || 'Delivery challan'}
                        >
                          {info.challanDocumentName || 'View challan'}
                        </a>
                        <p className="text-[11px] text-stone-400">Attached to this transfer</p>
                      </div>
                      <label className="shrink-0 cursor-pointer text-[11px] font-bold uppercase tracking-wider text-stone-500 hover:text-[#EA2831]">
                        Replace
                        <input
                          type="file"
                          ref={challanRef}
                          accept="image/*,application/pdf,.pdf"
                          className="hidden"
                          onChange={onChallanChange}
                        />
                      </label>
                    </div>
                  ) : (
                    <label className={`${inputCls} flex cursor-pointer items-center gap-2 text-stone-400 hover:bg-stone-50`}>
                      <span className="material-symbols-outlined text-base">upload_file</span>
                      Choose an image or PDF…
                      {/* `accept` narrows the picker; onChallanChange re-checks,
                          because accept is a hint a user can bypass. */}
                      <input
                        type="file"
                        ref={challanRef}
                        accept="image/*,application/pdf,.pdf"
                        className="hidden"
                        onChange={onChallanChange}
                      />
                    </label>
                  )}
                </Field>
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            {dispatched ? (
              <PrimaryBtn onClick={onDone}>Done</PrimaryBtn>
            ) : (
              <>
                <GhostBtn onClick={close}>Close</GhostBtn>
                <PrimaryBtn disabled={!complete || !allBoxed || !challanReady || busy} onClick={dispatchNow}>
                  <span className="material-symbols-outlined text-base">local_shipping</span>
                  {busy ? 'Dispatching…' : 'Dispatch'}
                </PrimaryBtn>
              </>
            )}
          </div>
          {!dispatched && (!complete || !allBoxed || !challanReady) && (
            <p className="mt-1 text-right text-[11px] text-stone-400">
              {!complete
                ? 'Scan every requested unit to dispatch.'
                : pending.length
                  ? 'Put the remaining scanned units into a box first.'
                  : !allBoxed
                    ? 'Create at least one box to dispatch.'
                    : !challanNumber.trim()
                      ? 'Enter the delivery challan number to dispatch.'
                      : 'Attach the delivery challan document to dispatch.'}
            </p>
          )}
        </>
      )}

      {showLabels && (
        <SellerTransferBoxLabels
          boxes={dispatched?.boxes || []}
          transferRef={info?.ref}
          onClose={() => setShowLabels(false)}
        />
      )}
    </Modal>
  );
};

export default SellerTransferProcessModal;