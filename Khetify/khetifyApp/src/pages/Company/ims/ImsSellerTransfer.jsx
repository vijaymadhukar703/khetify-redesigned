import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import ScanBox from '../../../Components/ims/ScanBox';
// The SAME shipping label the warehouse→warehouse transfer and the supply
// dispatch already print: manifest QR + Code128 strip + Print. The seller scans
// this to receive, so there is nothing new to build here.
import { ManifestModal } from '../../../Components/ims/TransferModals';
import ShipmentBoxLabelsModal from '../../../Components/ims/ShipmentBoxLabel';
import { Field, GhostBtn, PrimaryBtn, StatCard, Th, inputCls } from './ImsUi';
import { usePermission } from '../../../context/PermissionContext';
import {
  getSellerTransferOptions,
  getSellerTransferProducts,
  getSellerTransferPrefill,
  scanSellerTransferItem,
  confirmSellerTransfer,
} from '../../../lib/imsApi';

/**
 * SEND TO SELLER — a Company Warehouse pushes stock to one of its sellers.
 *
 * The form is linear and each step unlocks the next:
 *   1. FROM   — this warehouse, filled in automatically (never chosen by hand)
 *      TO     — the seller, with their company details shown once picked
 *   2. WHAT   — a product this warehouse actually holds, and how many
 *   3. SCAN   — exactly that many units, no more
 *   4. SEND   — vehicle + driver, then confirm
 *
 * Scanning is the only way to add an item; the server decides what each code is
 * (Lot Number / Bulk Packaging ID / Unit Code) by exact lookup and applies the
 * same rules as the rest of the warehouse — including the all-or-nothing carton
 * rule, so a box holding more than the remaining quantity is refused and the
 * operator scans single units instead. Every code is re-verified at confirm.
 */

const SCAN_LABEL = {
  lot: 'Lot Number',
  bulk_package: 'Bulk Packaging ID',
  unit: 'Unit Code',
};

// Same toast the rest of the IMS uses (ImsInbound, ImsLabels, …), with an
// optional detail line under the headline.
//
// `icon` carries the severity and is what the operator reads first:
//   success — the scan/transfer went through
//   error   — invalid code, or the transfer was refused
//   warning — nothing is wrong with the code, but it cannot be added now
//             (duplicate, or the required quantity is already scanned)
//   info    — a neutral statement of fact
// A failure stays on screen longer than a success: it has to be read.
const toast = (icon, title, text) =>
  Swal.fire({
    icon, title, text,
    toast: true, position: 'top-end', showConfirmButton: false,
    timer: icon === 'success' ? 2600 : 5000,
    timerProgressBar: true,
  });
// The server's own message is the useful one — never swallow it behind a generic
// "something went wrong", and never leave the operator with only a red button.
const apiMessage = (err, fallback) =>
  err?.response?.data?.message || err?.message || fallback;

/**
 * A refused scan, as a toast. The SEVERITY comes from the status the server
 * already sends, not from reading its wording:
 *   404 — the code is not a lot/carton/unit of this company → invalid scan
 *   409 — the code is real but cannot be added right now: already scanned,
 *         already transferred, wrong warehouse, wrong product, quantity full
 *   anything else — an outright failure
 * The server's message is the detail line, so the operator is told exactly
 * which code and why.
 */
const scanFailureToast = (err, fallback) => {
  const status = err?.response?.status;
  const detail = apiMessage(err, fallback);
  if (status === 404) return toast('error', 'Invalid scan', detail);
  if (status === 409) return toast('warning', 'Cannot add this scan', detail);
  return toast('error', 'Scan failed', detail);
};

// Module scope: a component defined inside another one is re-created on every
// keystroke, which makes the inputs below lose focus.

// Transfer paperwork: a number and, optionally, a scan of the document itself.
// Same types the seller-KYC upload accepts (middlewares/uploadDocuments).
const DOC_ACCEPT = 'application/pdf,image/jpeg,image/jpg,image/png,image/webp';
const DOC_MAX_BYTES = 10 * 1024 * 1024;
const DOC_FIELDS = [
  { key: 'challan', numberKey: 'challanNumber', fileKey: 'challanDocument', label: 'Challan', placeholder: 'e.g., CH/2026/0142' },
  { key: 'bill', numberKey: 'billNumber', fileKey: 'billDocument', label: 'Bill', placeholder: 'e.g., INV-2026-0088' },
  { key: 'bilty', numberKey: 'biltyNumber', fileKey: 'biltyDocument', label: 'Bilty', placeholder: "Transporter's bilty / LR no." },
];

const prettyBytes = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * A document number with an optional scanned copy. Before submission the chosen
 * file can be previewed (opened in a new tab from a local object URL) or
 * removed; an ALREADY STORED document instead offers View and Download, resolved
 * from the server's short-lived signed URL.
 */
const DocumentField = ({ field, number, onNumber, file, onFile, stored, error }) => {
  const inputId = `doc-${field.key}`;
  return (
    // The number and its attachment are one control, so the spacing is owned
    // here (space-y-2) rather than inherited from Field's mb-4 — that margin sat
    // BETWEEN the two halves and left nothing under the attach box, so whatever
    // came next appeared stuck to it.
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${inputId}-no`} className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
          {field.label} Number<span className="text-[#EA2831] ml-0.5">*</span>
        </label>
        <input
          id={`${inputId}-no`}
          className={inputCls}
          value={number}
          onChange={(e) => onNumber(e.target.value)}
          placeholder={field.placeholder}
        />
      </div>

      {/* Already stored (viewing an existing transfer). */}
      {stored ? (
        <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
          <span className="material-symbols-outlined text-stone-400 text-[18px] shrink-0">
            {String(stored.mimeType || '').includes('pdf') ? 'picture_as_pdf' : 'image'}
          </span>
          <span className="text-[11px] text-stone-700 truncate flex-1" title={stored.fileName}>
            {stored.fileName}
          </span>
          <a
            href={stored.url} target="_blank" rel="noreferrer"
            className="text-[11px] font-bold text-[#EA2831] hover:underline shrink-0"
          >
            View
          </a>
          <a
            href={stored.url} download={stored.fileName}
            className="text-[11px] font-bold text-stone-500 hover:text-stone-900 shrink-0"
          >
            Download
          </a>
        </div>
      ) : file ? (
        <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
          <span className="material-symbols-outlined text-stone-400 text-[18px] shrink-0">
            {file.type.includes('pdf') ? 'picture_as_pdf' : 'image'}
          </span>
          <span className="text-[11px] text-stone-700 truncate flex-1" title={file.name}>
            {file.name} <span className="text-stone-400">· {prettyBytes(file.size)}</span>
          </span>
          <button
            type="button"
            onClick={() => window.open(URL.createObjectURL(file), '_blank', 'noopener')}
            className="text-[11px] font-bold text-[#EA2831] hover:underline shrink-0"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => onFile(null)}
            className="text-stone-400 hover:text-[#EA2831] shrink-0"
            aria-label={`Remove the ${field.label} document`}
          >
            <span className="material-symbols-outlined text-[16px] block">close</span>
          </button>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className="flex items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-white px-3 py-2 cursor-pointer hover:border-[#EA2831]/50 transition-colors"
        >
          <span className="material-symbols-outlined text-stone-400 text-[18px]">upload_file</span>
          <span className="text-[11px] text-stone-500">
            Attach {field.label.toLowerCase()} copy<span className="text-[#EA2831]">*</span>
            <span className="text-stone-300"> · PDF or image, max 10MB</span>
          </span>
          <input
            id={inputId}
            type="file"
            accept={DOC_ACCEPT}
            className="hidden"
            onChange={(e) => { onFile(e.target.files?.[0] || null); e.target.value = ''; }}
          />
        </label>
      )}

      {error && <p className="text-[11px] font-medium text-red-600">{error}</p>}
    </div>
  );
};

/**
 * A pre-filled value the operator may read but not change. Used for everything
 * carried in from an approved seller request: the approval already decided the
 * seller, their warehouse and the source, so re-choosing them here would create
 * a transfer that no longer matches the request it claims to fulfil.
 *
 * Rendered as a card rather than a disabled <select>: a greyed-out dropdown
 * still looks like something you failed to operate, whereas this reads as
 * settled information.
 */
const LockedValue = ({ icon, value, hint }) => (
  <div className="flex items-center gap-2.5 border border-stone-200 bg-stone-50 rounded-lg px-3.5 py-2.5">
    <span className="material-symbols-outlined text-stone-400 text-[20px] shrink-0">{icon}</span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-bold text-stone-900 truncate">{value || '—'}</p>
      {hint && <p className="text-[11px] text-stone-500 truncate">{hint}</p>}
    </div>
    <span
      className="material-symbols-outlined text-stone-300 text-[16px] shrink-0"
      title="Set by the seller request — cannot be changed here"
    >
      lock
    </span>
  </div>
);

/**
 * One section of the transfer form. The whole form lives in a SINGLE container;
 * these dividers give it structure without breaking it into disconnected cards.
 */
const Section = ({ title, hint, icon, aside, muted = false, children }) => (
  <section className={`border-t border-stone-200 first:border-t-0 px-5 sm:px-7 py-6 transition-opacity ${muted ? 'opacity-50' : ''}`}>
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && (
          <span className="material-symbols-outlined text-stone-400 text-[20px] mt-px shrink-0">{icon}</span>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-black text-stone-900 uppercase tracking-wide">{title}</h3>
          {hint && <p className="text-xs text-stone-500 mt-1 leading-relaxed">{hint}</p>}
        </div>
      </div>
      {aside}
    </div>
    <div className={muted ? 'pointer-events-none' : ''}>{children}</div>
  </section>
);

// A native <select> cannot be given a max height, a styled scrollbar, or hover
// and selected colours — the OS draws its popup. So the product list is a real
// listbox: fixed 320px max height, smooth scrolling, search, keyboard support,
// and 44px touch rows on mobile.
const PICKER_CSS = `
.kt-picker-scroll { max-height: 320px; overflow-y: auto; scroll-behavior: smooth; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.kt-picker-scroll { scrollbar-width: thin; scrollbar-color: #d6d3d1 transparent; }
.kt-picker-scroll::-webkit-scrollbar { width: 8px; }
.kt-picker-scroll::-webkit-scrollbar-track { background: transparent; }
.kt-picker-scroll::-webkit-scrollbar-thumb { background: #d6d3d1; border-radius: 9999px; border: 2px solid #fff; }
.kt-picker-scroll::-webkit-scrollbar-thumb:hover { background: #a8a29e; }
`;

const ProductPicker = ({ products, value, onChange, disabled, loading, warehouseName }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);

  const selected = products.find((p) => p.productId === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      p.productName.toLowerCase().includes(q) || String(p.skuNumber || '').toLowerCase().includes(q));
  }, [products, query]);

  // The menu is portalled to <body> and positioned from the trigger's rect:
  // the page scrolls inside a container with overflow hidden, which would
  // otherwise clip an absolutely positioned dropdown.
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    setRect({
      left: r.left, width: r.width, top: r.bottom + 6, bottom: window.innerHeight - r.top + 6,
      // Flip upwards when there is more room above than below.
      dropUp: below < 260 && r.top > below,
    });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    place();
    const onWin = () => place();
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, true);
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    const t = setTimeout(() => searchRef.current?.focus(), 10);
    return () => {
      window.removeEventListener('resize', onWin);
      window.removeEventListener('scroll', onWin, true);
      document.removeEventListener('mousedown', onDown);
      clearTimeout(t);
    };
  }, [open, place]);

  const pick = (p) => {
    if (!p.transferable) return;
    onChange(p.productId);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return Math.max(0, Math.min(filtered.length - 1, next));
      });
      return;
    }
    const target = filtered[Math.min(active, filtered.length - 1)];
    if (e.key === 'Enter' && target) { e.preventDefault(); pick(target); }
  };

  const label = loading
    ? 'Loading stock…'
    : selected
      ? selected.productName
      : products.length ? 'Select product' : 'No stock in this warehouse';

  return (
    <>
      <style>{PICKER_CSS}</style>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || loading}
        onClick={() => { setActive(0); setOpen((v) => !v); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 text-left border rounded-lg px-3.5 py-2.5 text-sm bg-white transition-all disabled:bg-stone-50 disabled:text-stone-400
          ${open ? 'border-[#EA2831] ring-2 ring-[#EA2831]/20' : 'border-stone-200 hover:border-stone-300'}`}
      >
        <span className={`truncate ${selected ? 'text-stone-900 font-medium' : 'text-stone-400'}`}>{label}</span>
        {selected && (
          <span className="shrink-0 text-[11px] font-bold text-stone-500 bg-stone-100 border border-stone-200 rounded-full px-2 py-0.5">
            {selected.transferableQty} ready
          </span>
        )}
        <span className={`material-symbols-outlined text-stone-400 text-[20px] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
          expand_more
        </span>
      </button>

      {open && rect && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          onKeyDown={onKeyDown}
          style={{
            position: 'fixed', left: rect.left, width: rect.width, zIndex: 60,
            ...(rect.dropUp ? { bottom: rect.bottom } : { top: rect.top }),
          }}
          className="bg-white border border-stone-200 rounded-xl shadow-xl shadow-stone-900/10 overflow-hidden"
        >
          <div className="p-2 border-b border-stone-100">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-300 text-[18px]">search</span>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onKeyDown}
                placeholder="Search product or SKU"
                className="w-full border border-stone-200 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/20"
              />
            </div>
          </div>

          <div className="kt-picker-scroll">
            {!filtered.length ? (
              <p className="px-4 py-6 text-sm text-stone-400 text-center">
                {products.length ? 'No product matches that search.' : `No stock in ${warehouseName || 'this warehouse'}.`}
              </p>
            ) : filtered.map((p, i) => {
              const isSelected = p.productId === value;
              const isActive = i === active;
              return (
                <button
                  key={p.productId}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={!p.transferable}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(p)}
                  className={`w-full text-left px-4 py-3 min-h-[44px] border-b border-stone-50 last:border-0 transition-colors
                    ${!p.transferable
                      ? 'bg-white cursor-not-allowed'
                      : isSelected
                        ? 'bg-[#EA2831]/5'
                        : isActive ? 'bg-stone-50' : 'bg-white'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`text-sm truncate ${p.transferable ? 'text-stone-900 font-medium' : 'text-stone-400'}`}>
                        {p.productName}
                        {isSelected && <span className="material-symbols-outlined text-[#EA2831] text-[16px] align-middle ml-1">check</span>}
                      </p>
                      <p className="text-[11px] text-stone-400 truncate">
                        {p.skuNumber ? `${p.skuNumber} · ` : ''}
                        {p.availableQty} available · {p.unitsAvailable} labelled
                        {p.pendingQty > 0 ? ` · ${p.pendingQty} awaiting receipt` : ''}
                        {p.expiredQty > 0 ? ` · ${p.expiredQty} expired` : ''}
                      </p>
                    </div>
                    <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full
                      ${p.transferable ? 'bg-green-50 text-green-700' : 'bg-stone-100 text-stone-500'}`}>
                      {p.transferable ? `${p.transferableQty} ready` : p.blockedReason}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

const ImsSellerTransfer = () => {
  const canTransfer = usePermission('inventory:transfer');
  // Arriving from Send Stock → "Dispatch to Seller" carries the approved request
  // in the URL (?supply=…). The transfer flow below is unchanged — only how it
  // is STARTED differs: the seller, their warehouse, the product and the
  // approved quantity are filled in instead of being chosen by hand.
  const [params, setParams] = useSearchParams();
  const supplyOrderId = params.get('supply');
  const [prefill, setPrefill] = useState(null);
  const [prefillError, setPrefillError] = useState('');

  const [options, setOptions] = useState({ sourceWarehouses: [], sellers: [] });
  const [loadingOptions, setLoadingOptions] = useState(true);

  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');

  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productId, setProductId] = useState('');
  // OPTIONAL manual target. Empty → scanning is open and the quantity simply
  // counts up. Filled → scanning stops at that number.
  const [targetQty, setTargetQty] = useState('');


  const [rows, setRows] = useState([]);
  const [scanError, setScanError] = useState('');
  const [scanNotice, setScanNotice] = useState('');
  // Kept apart from scanError on purpose: a confirm failure used to render up in
  // the scan card, far above the Transfer button, so the operator saw a red
  // button and no reason for it.
  const [submitError, setSubmitError] = useState('');

  const [transport, setTransport] = useState({ vehicleNo: '', driverName: '', driverPhone: '' });
  // Transfer paperwork — saved on the transfer record and carried through the flow.
  const [docs, setDocs] = useState({ challanNumber: '', billNumber: '', biltyNumber: '' });
  // The scanned copies chosen for upload, keyed by the multipart field name.
  const [docFiles, setDocFiles] = useState({ challanDocument: null, billDocument: null, biltyDocument: null });
  const [docErrors, setDocErrors] = useState({});
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  // { qrPayload } — the shipping label currently open, from a fresh dispatch or
  // re-opened from the history row.
  const [labelInfo, setLabelInfo] = useState(null);
  // Documents already stored on the transfer that was just created — shown with
  // View / Download instead of the attach control. Declared here, AFTER
  // `result`: a const is hoisted but not initialised, so reading it above its
  // declaration throws "Cannot access 'result' before initialization".
  const storedDocs = result?.documents || null;
  // Shipment Boxes being planned: [{ id, units: [unitCode…] }]. Only LOOSE units
  // (not already inside a Bulk Package) can go in one.
  const [boxes, setBoxes] = useState([]);
  const boxSeq = useRef(1);
  // Units ticked but not yet committed to a box.
  const [picked, setPicked] = useState(() => new Set());
  // Whether the "Add to Box" chooser is showing.
  const [boxMenuOpen, setBoxMenuOpen] = useState(false);
  // { boxes, seller, ref } — the printable label sheet currently open.
  const [boxLabels, setBoxLabels] = useState(null);

  /* ── options: the warehouse is resolved for the operator, not chosen ── */
  useEffect(() => {
    if (!canTransfer) { setLoadingOptions(false); return; }
    let alive = true;
    getSellerTransferOptions()
      .then((r) => {
        if (!alive) return;
        const data = r.data || { sourceWarehouses: [], sellers: [] };
        setOptions(data);
        // A warehouse manager is scoped to their own warehouse, so this is
        // normally the only one — FROM is filled in for them either way.
        if (data.sourceWarehouses.length) setFromWarehouseId(data.sourceWarehouses[0]._id);
        if (data.sellers.length === 1) setSellerId(data.sellers[0]._id);
      })
      .catch(() => { if (alive) setOptions({ sourceWarehouses: [], sellers: [] }); })
      .finally(() => { if (alive) setLoadingOptions(false); });
    return () => { alive = false; };
  }, [canTransfer]);

  /* ── PREFILL from an approved seller request ──
     Fetched once. The server authorises it (company, warehouse scope, and the
     request must actually be approved), so a hand-typed id cannot open someone
     else's request. */
  useEffect(() => {
    if (!canTransfer || !supplyOrderId) { setPrefill(null); return undefined; }
    let alive = true;
    setPrefillError('');
    getSellerTransferPrefill(supplyOrderId)
      .then((r) => { if (alive) setPrefill(r.data || null); })
      .catch((err) => {
        if (!alive) return;
        setPrefill(null);
        setPrefillError(apiMessage(err, 'That seller request could not be opened.'));
      });
    return () => { alive = false; };
  }, [canTransfer, supplyOrderId]);

  // Apply it once the pickers have their options, so the ids resolve to real
  // rows. Runs on the prefill's identity, so nothing the operator changes
  // afterwards is overwritten.
  useEffect(() => {
    if (!prefill) return;
    if (prefill.sourceWarehouse?._id) setFromWarehouseId(prefill.sourceWarehouse._id);
    setSellerId(prefill.seller._id);
    if (prefill.destinationWarehouse?._id) setDestinationWarehouseId(prefill.destinationWarehouse._id);
  }, [prefill]);

  /* ── what this warehouse holds ── */
  useEffect(() => {
    if (!fromWarehouseId) { setProducts([]); return; }
    let alive = true;
    setLoadingProducts(true);
    getSellerTransferProducts(fromWarehouseId)
      .then((r) => { if (alive) setProducts(r.data || []); })
      .catch(() => { if (alive) setProducts([]); })
      .finally(() => { if (alive) setLoadingProducts(false); });
    return () => { alive = false; };
  }, [fromWarehouseId]);

  // The product and its approved quantity can only be applied once this
  // warehouse's stock list has arrived (the picker needs a matching row).
  // A request transfer drives itself off `requestLines`, so no product is
  // selected and no single target quantity is set — each line has its own.
  useEffect(() => {
    if (prefill) { setProductId(''); setTargetQty(''); }
  }, [prefill]);

  const sourceWarehouse = useMemo(
    () => options.sourceWarehouses.find((w) => w._id === fromWarehouseId) || null,
    [options.sourceWarehouses, fromWarehouseId]
  );
  const seller = useMemo(
    () => options.sellers.find((s) => s._id === sellerId) || null,
    [options.sellers, sellerId]
  );
  const product = useMemo(
    () => products.find((p) => p.productId === productId) || null,
    [products, productId]
  );

  // The destination must belong to the chosen seller, so it follows them.
  useEffect(() => {
    setDestinationWarehouseId((prev) => {
      if (!seller) return '';
      if (seller.warehouses.some((w) => w._id === prev)) return prev;
      return seller.warehouses.length === 1 ? seller.warehouses[0]._id : '';
    });
  }, [seller]);

  const scannedCodes = useMemo(() => rows.flatMap((r) => r.unitCodes), [rows]);
  const scannedCount = scannedCodes.length;

  // ── REQUESTED LINES ──
  // When the transfer came from a seller request it has one line per requested
  // product. Each row's progress is derived from the scan list itself, so the
  // figures can never drift from the items.
  const requestLines = useMemo(() => {
    if (!prefill?.items?.length) return [];
    const scannedByProduct = new Map();
    for (const r of rows) {
      if (!r.productId) continue;
      scannedByProduct.set(r.productId, (scannedByProduct.get(r.productId) || 0) + r.unitCodes.length);
    }
    return prefill.items.map((it) => {
      const scanned = scannedByProduct.get(it.productId) || 0;
      const required = it.approvedQty || 0;
      return {
        ...it,
        requiredQty: required,
        scannedQty: scanned,
        remainingQty: Math.max(0, required - scanned),
        complete: required > 0 && scanned >= required,
        over: scanned > required,
      };
    });
  }, [prefill, rows]);

  const isRequestTransfer = requestLines.length > 0;
  const allLinesComplete = isRequestTransfer
    && requestLines.every((l) => l.scannedQty === l.requiredQty);

  // WHICH UNITS NEED A SHIPMENT BOX?
  //
  // A Bulk Package label only travels with the goods when the WHOLE carton goes.
  // Scan a carton by its Bulk Packaging ID → it travels, nothing to box. Scan 5
  // unit codes out of a 200-unit carton → the carton stays on the shelf and
  // those 5 are loose, so they need a Shipment Box.
  //
  // Same arithmetic the server does at confirm (resolveScannedUnits), so the
  // screen can never offer a grouping the server will reject.
  const looseCodes = useMemo(() => {
    // How many units of each carton this transfer is taking.
    const perCarton = new Map();
    for (const r of rows) {
      if (!r.bulkPackagingId) continue;
      perCarton.set(r.bulkPackagingId, (perCarton.get(r.bulkPackagingId) || 0) + r.unitCodes.length);
    }
    const wholeCarton = (r) => {
      if (!r.bulkPackagingId) return false;
      if (r.scanType === 'bulk_package') return true;         // scanned as a carton
      if (!r.cartonUnits) return false;                        // size unknown → treat as loose
      return (perCarton.get(r.bulkPackagingId) || 0) >= r.cartonUnits;
    };
    return rows.filter((r) => r.boxable && !wholeCarton(r)).flatMap((r) => r.unitCodes);
  }, [rows]);
  const bulkPackagedCount = scannedCount - looseCodes.length;
  const assignedCodes = useMemo(() => new Set(boxes.flatMap((b) => b.units)), [boxes]);
  const unassignedCodes = useMemo(
    () => looseCodes.filter((c) => !assignedCodes.has(c)),
    [looseCodes, assignedCodes]
  );
  const freeCodes = unassignedCodes;
  const boxesReady = !boxes.length || (boxes.every((b) => b.units.length) && !unassignedCodes.length);

  // QUANTITY WORKS BOTH WAYS.
  //   target empty → scan freely; the total is whatever has been scanned
  //   target set   → scanning stops once that many units are in
  // Either way the number shown is never typed into existence: it is always the
  // scanned count, so the figure and the item list can never disagree.
  //
  // The warehouse ceiling holds regardless — labelled units on non-expired
  // stock, computed server-side as `transferableQty`, re-enforced at confirm.
  const stockCeiling = product ? product.transferableQty : 0;
  const target = Number(targetQty) || 0;
  const hasTarget = target > 0;
  // The effective limit is the stricter of the two.
  const maxQty = hasTarget ? Math.min(target, stockCeiling || target) : stockCeiling;
  const remaining = maxQty ? Math.max(0, maxQty - scannedCount) : null;
  const targetTooBig = hasTarget && stockCeiling > 0 && target > stockCeiling;
  const targetMet = hasTarget && scannedCount >= target;
  const destinationReady = !!(fromWarehouseId && sellerId && destinationWarehouseId);
  // Scanning opens as soon as a product is chosen — no quantity step in between.
  // A request transfer needs no product chosen — the scan finds its own line.
  const readyToScan = destinationReady && !targetTooBig
    && (isRequestTransfer || !!productId);
  // A declared target must be met exactly before the transfer can go.
  // Challan, Bill and Bilty travel with every consignment: both the NUMBER and a
  // scanned copy of the document. A transfer cannot be confirmed without them,
  // and the server enforces the same rule.
  const missingDocNumbers = DOC_FIELDS.filter((f) => !String(docs[f.numberKey] || '').trim());
  const missingDocFiles = DOC_FIELDS.filter((f) => !docFiles[f.fileKey] && !storedDocs?.[f.fileKey]);
  const readyToSend = readyToScan && scannedCount > 0 && boxesReady
    // Every requested line must be complete before a request transfer can go.
    && (isRequestTransfer ? allLinesComplete : (!hasTarget || scannedCount === target))
    && !missingDocNumbers.length && !missingDocFiles.length;

  const resetItems = (notice = '') => {
    setRows([]);
    setBoxes([]);
    setPicked(new Set());
    setBoxMenuOpen(false);
    setScanError('');
    setSubmitError('');
    setScanNotice(notice);
  };

  /* ── SHIPMENT BOXES (loose units only) ──
     Tick the units, press "Add to Box", choose which box. A unit lives in
     exactly ONE box: adding it anywhere removes it from every other, so the same
     unit can never end up in two cartons.

     There is no separate "Create Box" step — a box comes into existence the
     moment units are put into it, so an empty box can never be left behind. The
     PAYLOAD IS UNCHANGED: `boxes` is still [{ units: [...] }] in the order the
     boxes were first filled. */
  const removeBox = (id) => setBoxes((prev) => prev.filter((b) => b.id !== id));

  const togglePick = (code) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });
  // Tick/untick every unit that is still free.
  const toggleAllFree = () => setPicked((prev) => {
    const free = looseCodes.filter((c) => !assignedCodes.has(c));
    const allOn = free.length > 0 && free.every((c) => prev.has(c));
    return allOn ? new Set() : new Set(free);
  });

  /**
   * Put the ticked units into a box.
   * `boxId` null → a NEW box, appended at the end (that is how a box is made).
   * Otherwise the existing box with that id.
   */
  const addPickedToBox = (boxId = null) => {
    const codes = [...picked];
    if (!codes.length) return;
    setBoxes((prev) => {
      // Take the units out of wherever they were first, so a re-assignment
      // moves them rather than duplicating them.
      const cleared = prev.map((b) => ({ ...b, units: b.units.filter((u) => !codes.includes(u)) }));
      if (boxId === null) return [...cleared, { id: boxSeq.current++, units: codes }];
      return cleared.map((b) => (b.id === boxId ? { ...b, units: [...b.units, ...codes] } : b));
    });
    setPicked(new Set());
    setBoxMenuOpen(false);
  };

  const unassignUnit = (code) => setBoxes((prev) => prev.map((b) => ({
    ...b, units: b.units.filter((u) => u !== code),
  })));

  // Fair split, in scan order — the common case done in one click.
  const autoSplit = (count) => {
    const per = Math.ceil(looseCodes.length / count);
    setBoxes(Array.from({ length: count }, (_, i) => ({
      id: boxSeq.current++, units: looseCodes.slice(i * per, (i + 1) * per),
    })).filter((b) => b.units.length));
    setPicked(new Set());
  };

  const changeProduct = (value) => {
    setProductId(value);
    // A transfer is for ONE product, so switching it invalidates what was scanned.
    setTargetQty('');
    resetItems();
  };

  const changeTarget = (value) => {
    // Digits only — a unit count. Lowering it below what is already scanned
    // would strand items, so the scanned rows are cleared and said so.
    const clean = value.replace(/[^\d]/g, '');
    setTargetQty(clean);
    setScanError('');
    const n = Number(clean) || 0;
    if (rows.length && n > 0 && n < scannedCount) {
      resetItems('Scanned items were cleared because the quantity was reduced below them.');
    }
  };

  const handleScan = async (code) => {
    setScanError('');
    setScanNotice('');
    if (!readyToScan) {
      const m = 'Choose the seller and the product first.';
      setScanError(m);
      toast('info', 'Not ready to scan', m);
      return;
    }
    if (isRequestTransfer && allLinesComplete) {
      const m = 'Every requested product has been scanned in full.';
      setScanError(m);
      toast('warning', 'Required quantity already scanned', m);
      return;
    }
    if (!isRequestTransfer && hasTarget && scannedCount >= target) {
      const m = `The quantity of ${target} is already complete — raise it to scan more.`;
      setScanError(m);
      toast('warning', 'Required quantity already scanned', m);
      return;
    }
    if (!isRequestTransfer && stockCeiling && scannedCount >= stockCeiling) {
      const m = `All ${stockCeiling} transferable unit(s) of this product have already been scanned.`;
      setScanError(m);
      toast('warning', 'Scan limit reached', m);
      return;
    }
    setBusy(true);
    try {
      const r = await scanSellerTransferItem({
        code,
        fromWarehouseId,
        // MULTI-PRODUCT: the requested lines go instead of a chosen product —
        // the server matches the scan to its own line and caps it by THAT
        // line's remainder, refusing anything not on the request.
        ...(isRequestTransfer
          ? { lines: requestLines.map((l) => ({ productId: l.productId, requiredQty: l.requiredQty })) }
          : { productId, ...(hasTarget ? { requiredQty: target } : {}) }),
        selectedCodes: scannedCodes,
      });
      const item = r.data;
      if (!item.addedQuantity) {
        const m = 'Nothing available to add from that code.';
        setScanError(m);
        toast('warning', 'Nothing added', m);
        return;
      }
      setRows((prev) => [
        ...prev,
        {
          key: `${item.scanType}:${item.bulkPackagingId || item.lotNumber}:${Date.now()}`,
          scanType: item.scanType,
          // What the operator actually scanned: the unit code for a unit scan,
          // the carton id for a carton, the lot number for a lot. Showing the
          // carton id on a unit row made five different units look identical.
          label: item.scanType === 'unit'
            ? (item.addedUnitCodes[0] || item.lotNumber)
            : (item.bulkPackagingId || item.lotNumber),
          lotNumber: item.lotNumber,
          // Which requested line this scan filled.
          productId: item.productId,
          productName: item.productName,
          bulkPackagingId: item.bulkPackagingId,
          // Size of the carton this scan came out of, so the page can tell a
          // whole carton from units taken out of one.
          cartonUnits: item.bulkPackageUnitsAvailable ?? null,
          // A whole carton scanned by its Bulk Packaging ID is never re-boxed;
          // everything else is a candidate until the arithmetic below says
          // otherwise. (Fallback keeps a stale backend from crashing the page.)
          boxable: item.boxable ?? item.scanType !== 'bulk_package',
          unitCodes: item.addedUnitCodes,
        },
      ]);
      const left = item.remainingRequired;
      const notice =
        `${SCAN_LABEL[item.scanType] || 'Item'} ${item.bulkPackagingId || item.lotNumber} — ${item.addedQuantity} × ${item.productName || 'unit(s)'}`
        + (item.skippedQuantity ? ` · ${item.skippedQuantity} already scanned` : '')
        + (typeof left === 'number'
          ? (left > 0 ? ` · ${left} more of this product` : ' · this product is complete')
          : ` · ${scannedCount + item.addedQuantity} total`);
      setScanNotice(notice);
      toast('success', `${item.addedQuantity} unit(s) added`, notice);
    } catch (err) {
      // Invalid / duplicate / unavailable / already-transferred — the toast's
      // icon says which, from the status the server sent.
      setScanError(apiMessage(err, 'That code could not be added.'));
      scanFailureToast(err, 'That code could not be added.');
    } finally {
      setBusy(false);
    }
  };

  const removeRow = (key) => {
    const gone = rows.find((r) => r.key === key)?.unitCodes || [];
    setRows((prev) => prev.filter((r) => r.key !== key));
    setBoxes((prev) => prev
      .map((b) => ({ ...b, units: b.units.filter((u) => !gone.includes(u)) }))
      .filter((b) => b.units.length));
    setPicked((prev) => new Set([...prev].filter((c) => !gone.includes(c))));
    setScanError('');
    setScanNotice('');
  };

  // Checked before the request so a bad file is caught instantly; the server
  // repeats both checks and is the real gate.
  const pickDocFile = (fileKey, label, file) => {
    if (!file) {
      setDocFiles((p) => ({ ...p, [fileKey]: null }));
      setDocErrors((p) => ({ ...p, [fileKey]: '' }));
      return;
    }
    if (!DOC_ACCEPT.split(',').includes(file.type)) {
      setDocErrors((p) => ({ ...p, [fileKey]: `The ${label} copy must be a PDF or an image (JPG, PNG, WEBP).` }));
      return;
    }
    if (file.size > DOC_MAX_BYTES) {
      setDocErrors((p) => ({ ...p, [fileKey]: `The ${label} copy must be smaller than 10MB.` }));
      return;
    }
    setDocErrors((p) => ({ ...p, [fileKey]: '' }));
    setDocFiles((p) => ({ ...p, [fileKey]: file }));
  };

  const submit = async () => {
    setScanError('');
    setSubmitError('');

    if (missingDocNumbers.length || missingDocFiles.length) {
      const errs = {};
      for (const f of missingDocNumbers) errs[f.numberKey] = `${f.label} Number is required.`;
      for (const f of missingDocFiles) errs[f.fileKey] = `Attach the ${f.label} copy (PDF or image).`;
      setDocErrors((p) => ({ ...p, ...errs }));
      const parts = [];
      if (missingDocNumbers.length) {
        parts.push(`enter the ${missingDocNumbers.map((f) => f.label).join(', ')} number${missingDocNumbers.length > 1 ? 's' : ''}`);
      }
      if (missingDocFiles.length) {
        parts.push(`attach the ${missingDocFiles.map((f) => f.label).join(', ')} document${missingDocFiles.length > 1 ? 's' : ''}`);
      }
      const message = `Please ${parts.join(' and ')} before transferring.`;
      setSubmitError(message);
      toast('warning', 'Paperwork incomplete', message);
      return;
    }

    setBusy(true);
    try {
      const payload = {
        sellerId, destinationWarehouseId, fromWarehouseId,
        // The server re-derives and re-validates all of this; sending the count
        // keeps its "scanned must equal quantity" check meaningful.
        productId, quantity: scannedCount, codes: scannedCodes,
      };
      if (isRequestTransfer) {
        payload.supplyOrderId = prefill.supplyOrderId;
        payload.lines = requestLines.map((l) => ({ productId: l.productId, requiredQty: l.requiredQty }));
        delete payload.productId;
      }
      if (boxes.length) payload.boxes = boxes.map((b) => ({ units: b.units }));
      if (notes.trim()) payload.notes = notes.trim();
      for (const [k, v] of Object.entries(transport)) if (v.trim()) payload[k] = v.trim();
      for (const [k, v] of Object.entries(docs)) if (v.trim()) payload[k] = v.trim();

      // Only build a multipart body when there is actually a file — a plain JSON
      // request stays the common path, and the route handles both.
      const attached = Object.entries(docFiles).filter(([, f]) => f);
      let body = payload;
      if (attached.length) {
        const form = new FormData();
        for (const [k, v] of Object.entries(payload)) {
          // Arrays/objects must be JSON-encoded for form-data; the controller
          // parses them back.
          form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
        }
        for (const [k, f] of attached) form.append(k, f, f.name);
        body = form;
      }
      const r = await confirmSellerTransfer(body);
      setResult(r.data);
      toast(
        'success',
        'Transfer completed',
        r.message || `${r.data.totalUnits} unit(s) dispatched to ${r.data.seller}.`,
      );
      // The request is now fulfilled server-side, so drop it from the URL: the
      // banner clears, and going back to Send Stock re-reads a list that no
      // longer contains it. Only ever reached on a SUCCESSFUL transfer — an
      // abandoned or failed one leaves the parameter (and the request) alone.
      if (supplyOrderId) {
        setPrefill(null);
        setParams({ tab: 'seller-transfer' });
      }
      // Show the label immediately — the goods cannot be received without it.
      if (r.data?.boxes?.length) {
        setBoxLabels({ boxes: r.data.boxes, seller: r.data.seller, ref: r.data.ref });
      } else if (r.data?.qrPayload) {
        setLabelInfo({ qrPayload: r.data.qrPayload });
      }
      resetItems();
      setProductId('');
      setTargetQty('');
      setNotes('');
      setTransport({ vehicleNo: '', driverName: '', driverPhone: '' });
      setDocs({ challanNumber: '', billNumber: '', biltyNumber: '' });
      setDocFiles({ challanDocument: null, billDocument: null, biltyDocument: null });
      setDocErrors({});
      // The warehouse holds less than it did a moment ago.
      getSellerTransferProducts(fromWarehouseId)
        .then((p) => setProducts(p.data || []))
        .catch(() => { /* the list refreshes on the next visit */ });
    } catch (err) {
      // Say WHY. The server explains itself (wrong warehouse, a unit already
      // taken, a unit that belongs to a Bulk Package, an unassigned unit …) and
      // that explanation is what the operator needs to act on.
      const message = apiMessage(err, 'The transfer could not be confirmed.');
      setSubmitError(message);
      toast('error', 'Transfer failed', message);
    } finally {
      setBusy(false);
    }
  };

  if (!canTransfer) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl p-8 text-center">
        <span className="material-symbols-outlined text-4xl text-stone-300">lock</span>
        <p className="text-sm font-bold text-stone-900 mt-2">Transfers are performed by the warehouse</p>
        <p className="text-xs text-stone-500 mt-1">
          Your role can view stock but not move it to a seller. Ask an operations or warehouse manager.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── dispatched ── */}
      {result && (
        <div className="bg-white border border-green-200 rounded-xl p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-green-600">check_circle</span>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-stone-900">
                Dispatched to {result.seller} — {result.totalUnits} unit(s) on the way
              </h3>
              <p className="text-xs text-stone-500 mt-1">
                {result.sourceWarehouse} → {result.destinationWarehouse} · Reference {result.ref}. The stock has
                left this warehouse. Print this shipping label and send it with the consignment —
                {' '}{result.seller} scans it at their warehouse to receive the stock.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <PrimaryBtn onClick={() => setLabelInfo({ qrPayload: result.qrPayload })}>
                  <span className="material-symbols-outlined text-base">qr_code_2</span>
                  Shipping Label
                </PrimaryBtn>
                {!!result.boxes?.length && (
                  <GhostBtn onClick={() => setBoxLabels({ boxes: result.boxes, seller: result.seller, ref: result.ref })}>
                    <span className="material-symbols-outlined text-sm">inventory_2</span>
                    Box Labels ({result.boxes.length})
                  </GhostBtn>
                )}
                <span className="text-[11px] text-stone-400">
                  Labels can be re-printed any time from Shipment Tracking &amp; Transfers.
                </span>
                <span className="text-[11px] font-mono text-stone-400 break-all">{result.qrPayload}</span>
              </div>
            </div>
            <button onClick={() => setResult(null)} className="text-stone-400 hover:text-stone-600 p-1">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Fulfilling an approved seller request — shown so the operator can see
          what this dispatch is against, and leave it if they picked wrongly. */}
      {prefillError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <span className="material-symbols-outlined text-red-600 text-[18px]">error</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-stone-900">This request could not be opened</p>
            <p className="text-xs text-red-700 mt-0.5">{prefillError}</p>
          </div>
          <GhostBtn onClick={() => setParams({ tab: 'seller-transfer' })}>Start a blank transfer</GhostBtn>
        </div>
      )}

      {prefill && (
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm px-5 sm:px-7 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#EA2831] text-[20px]">assignment_turned_in</span>
                <h3 className="text-sm font-black text-stone-900 uppercase tracking-wide">
                  Fulfilling request {prefill.requestNumber}
                </h3>
              </div>
              <p className="text-xs text-stone-500 mt-1 ml-7">
                {prefill.seller.businessName}
                {prefill.seller.ownerName ? ` · ${prefill.seller.ownerName}` : ''}
                {prefill.destinationWarehouse ? ` → ${prefill.destinationWarehouse.name}` : ''}
                {' · '}approved {prefill.totalApprovedQty} unit(s)
              </p>
              {prefill.notes && (
                <p className="text-[11px] text-stone-400 mt-1 ml-7">Note: {prefill.notes}</p>
              )}
            </div>
            <GhostBtn onClick={() => setParams({ tab: 'seller-transfer' })}>
              <span className="material-symbols-outlined text-sm">close</span> Clear request
            </GhostBtn>
          </div>

          {/* Requested vs approved, per product, straight off the request. */}
          <div className="mt-3 ml-7 flex flex-wrap gap-2">
            {(prefill.items || []).map((it) => (
              <span key={it.productId} className="text-[11px] font-medium text-stone-600 bg-stone-100 border border-stone-200 rounded-full px-3 py-1">
                {it.productName} · requested {it.requestedQty} · approved <b className="text-stone-900">{it.approvedQty}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ══ THE FORM — one container, four sections ══ */}
      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 sm:px-7 py-5 border-b border-stone-200 bg-stone-50/60">
          <h2 className="text-base font-black text-stone-900">Send Stock to Seller</h2>
          
        </div>

        {/* ── TRANSFER DETAILS ── */}
        <Section title="Transfer Details" icon="local_shipping">

        {loadingOptions ? (
          <p className="text-sm text-stone-400">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* FROM — resolved automatically from the operator's own warehouse. */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">From</p>
              {!options.sourceWarehouses.length ? (
                <p className="text-sm text-stone-500">No warehouse is assigned to you.</p>
              ) : options.sourceWarehouses.length === 1 ? (
                <div className="flex items-center gap-2.5 border border-stone-200 bg-stone-50 rounded-lg px-3.5 py-2.5">
                  <span className="material-symbols-outlined text-stone-400 text-[20px]">warehouse</span>
                  <div>
                    <p className="text-sm font-bold text-stone-900">{sourceWarehouse?.name}</p>
                    <p className="text-[11px] text-stone-500">
                      Your warehouse{sourceWarehouse?.code ? ` · ${sourceWarehouse.code}` : ''}
                    </p>
                  </div>
                </div>
              ) : prefill ? (
                // The approval already chose the source warehouse.
                <LockedValue
                  icon="warehouse"
                  value={sourceWarehouse?.name}
                  hint={`From the seller request${sourceWarehouse?.code ? ` · ${sourceWarehouse.code}` : ''}`}
                />
              ) : (
                // Only reachable for an unscoped role overseeing several
                // warehouses; the first is preselected so nothing is asked twice.
                <select
                  className={inputCls}
                  value={fromWarehouseId}
                  onChange={(e) => { setFromWarehouseId(e.target.value); changeProduct(''); }}
                >
                  {options.sourceWarehouses.map((w) => (
                    <option key={w._id} value={w._id}>{w.name}{w.code ? ` (${w.code})` : ''}</option>
                  ))}
                </select>
              )}
            </div>

            {/* TO — the seller. */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">
                To <span className="text-[#EA2831]">*</span>
              </p>
              {prefill ? (
                <LockedValue
                  icon="storefront"
                  value={prefill.seller.businessName}
                  hint={`Requested by this seller · ${prefill.requestNumber}`}
                />
              ) : !options.sellers.length ? (
                <p className="text-sm text-stone-500">
                  No sellers are authorized yet. A seller can receive stock once your company has issued them an
                  active Principal Certificate.
                </p>
              ) : (
                <select className={inputCls} value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
                  <option value="">Select seller</option>
                  {options.sellers.map((s) => (
                    <option key={s._id} value={s._id}>{s.businessName}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        {/* The seller's own company details, once chosen. */}
        {(seller || prefill) && (
          <div className="mt-5 border border-stone-200 rounded-xl p-4 bg-stone-50/60">
            {prefill && (
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-3">
                <span className="material-symbols-outlined text-[14px]">lock</span>
                Read-only — set by request {prefill.requestNumber}
              </p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Company Name</p>
                <p className="text-sm font-bold text-stone-900">
                  {seller?.businessName || prefill?.seller?.businessName || '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Contact Person</p>
                <p className="text-sm text-stone-700">
                  {seller?.ownerName || prefill?.seller?.ownerName || '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Location</p>
                <p className="text-sm text-stone-700">
                  {[seller?.city, seller?.state].filter(Boolean).join(', ') || '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Principal Certificate</p>
                <p className="text-sm font-mono text-stone-700">{seller?.pcNumber || '—'}</p>
              </div>
            </div>
            <div className="mt-4 max-w-sm">
              <Field label="Receiving warehouse *">
                {prefill ? (
                  // Decided when the request was approved.
                  <LockedValue
                    icon="warehouse"
                    value={prefill.destinationWarehouse?.name}
                    hint={`From the seller request${prefill.destinationWarehouse?.code ? ` · ${prefill.destinationWarehouse.code}` : ''}`}
                  />
                ) : (
                <select
                  className={inputCls}
                  value={destinationWarehouseId}
                  onChange={(e) => setDestinationWarehouseId(e.target.value)}
                >
                  <option value="">Select warehouse</option>
                  {(seller?.warehouses || []).map((w) => (
                    <option key={w._id} value={w._id}>{w.name}{w.code ? ` (${w.code})` : ''}</option>
                  ))}
                </select>
                )}
              </Field>
              {!prefill && !seller?.warehouses?.length && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {seller?.businessName} has no active warehouse yet, so there is nowhere for this stock to land.
                </p>
              )}
            </div>
          </div>
        )}
        </Section>

        {/* ── PRODUCT SELECTION ── */}
        <Section
          title={isRequestTransfer ? 'Requested Products' : 'Product Selection'}
          icon="inventory"
          
          muted={!destinationReady}
          aside={isRequestTransfer ? (
            <span className={`shrink-0 text-[11px] font-black uppercase tracking-wider rounded-full px-3 py-1.5 ${
              allLinesComplete ? 'bg-green-600 text-white' : 'bg-stone-900 text-white'
            }`}>
              {requestLines.filter((l) => l.complete).length} / {requestLines.length} complete
            </span>
          ) : null}
        >
          {/* ONE ROW PER REQUESTED PRODUCT. Read-only name and requested
              quantity; scanned, remaining and status all derive from the scan
              list, so they cannot disagree with what has been scanned. */}
          {isRequestTransfer ? (
            <div className="border border-stone-200 rounded-xl overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <Th pad="px-4">Product</Th>
                    <Th pad="px-4" right>Requested</Th>
                    <Th pad="px-4" right>Scanned</Th>
                    <Th pad="px-4" right>Remaining</Th>
                    <Th pad="px-4">Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {requestLines.map((l) => (
                    <tr key={l.productId} className={l.complete ? 'bg-green-50/40' : ''}>
                      <td className="px-4 py-3">
                        <p className="text-sm font-bold text-stone-900">{l.productName}</p>
                        {l.skuNumber && <p className="text-[11px] font-mono text-stone-400">{l.skuNumber}</p>}
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-stone-900 text-right">{l.requiredQty}</td>
                      <td className="px-4 py-3 text-sm font-black text-[#EA2831] text-right">{l.scannedQty}</td>
                      <td className="px-4 py-3 text-sm text-stone-600 text-right">{l.remainingQty}</td>
                      <td className="px-4 py-3">
                        {l.over ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-red-50 text-red-700 rounded-full px-2.5 py-1">
                            <span className="material-symbols-outlined text-[13px]">error</span> Over-scanned
                          </span>
                        ) : l.complete ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-green-50 text-green-700 rounded-full px-2.5 py-1">
                            <span className="material-symbols-outlined text-[13px]">check_circle</span> Complete
                          </span>
                        ) : l.scannedQty > 0 ? (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 rounded-full px-2.5 py-1">
                            In progress
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-stone-100 text-stone-500 rounded-full px-2.5 py-1">
                            Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-stone-50 border-t border-stone-200">
                  <tr>
                    <td className="px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-stone-500">Total</td>
                    <td className="px-4 py-2.5 text-sm font-black text-stone-900 text-right">
                      {requestLines.reduce((s, l) => s + l.requiredQty, 0)}
                    </td>
                    <td className="px-4 py-2.5 text-sm font-black text-[#EA2831] text-right">{scannedCount}</td>
                    <td className="px-4 py-2.5 text-sm font-bold text-stone-600 text-right">
                      {requestLines.reduce((s, l) => s + l.remainingQty, 0)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
          <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
            <div className="md:col-span-2">
              <Field label="Product *">
                <ProductPicker
                  products={products}
                  value={productId}
                  onChange={changeProduct}
                  disabled={!destinationReady}
                  loading={loadingProducts}
                  warehouseName={sourceWarehouse?.name}
                />
              </Field>
            </div>
            {/* Optional target. Leave it blank and the quantity simply counts up
                as you scan; fill it in and scanning stops there. */}
            <Field label="Quantity (optional)">
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={targetQty}
                  onChange={(e) => changeTarget(e.target.value)}
                  disabled={!productId}
                  placeholder={product ? `Blank = count as I scan` : '—'}
                />
                {product && (
                  <span className="shrink-0 self-center text-[11px] font-bold text-stone-400 uppercase">
                    {product.unit || 'units'}
                  </span>
                )}
              </div>
            </Field>
          </div>

          {/* SCANNED vs TOTAL — the two figures the operator works against, kept
              in step because both are derived from the same scan list. */}
          {productId && (
            <div className="grid grid-cols-2 gap-3 mb-4 max-w-md">
              <div className="rounded-xl border border-stone-200 bg-stone-50/70 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Scanned Quantity</p>
                <p className="text-2xl font-black text-[#EA2831] leading-tight">{scannedCount}</p>
              </div>
              <div className="rounded-xl border border-stone-200 bg-stone-50/70 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Total Quantity</p>
                <p className="text-2xl font-black text-stone-900 leading-tight">
                  {hasTarget ? target : scannedCount}
                </p>
                <p className="text-[11px] text-stone-500">
                  {hasTarget
                    ? (targetMet ? 'complete' : `${remaining} still to scan`)
                    : 'counting from your scans'}
                </p>
              </div>
            </div>
          )}

         

          {targetTooBig && (
            <p className="mt-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              Only {stockCeiling} unit(s) of this product can be transferred from this warehouse right now.
            </p>
          )}

          {product && product.unitsAvailable < product.availableQty && (
            <p className="mt-3 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {product.availableQty - product.unitsAvailable} unit(s) of this product have no labels yet and cannot be
              scanned out — {product.unitsAvailable} of {product.availableQty} are transferable.
            </p>
          )}
          </>
          )}
        </Section>

        {/* ── SCANNING ── */}
        <Section
          title="Scanning"
          icon="barcode_scanner"
          muted={!readyToScan}
          aside={scannedCount > 0 ? (
            <span className="shrink-0 text-[11px] font-black uppercase tracking-wider bg-stone-900 text-white rounded-full px-3 py-1.5">
              {scannedCount} scanned
            </span>
          ) : null}
        >

          {/* THE SCAN TARGET. Deliberately the loudest thing on the page: a
              dashed, tinted panel with its own label and instruction, so there
              is never a question of where to point the scanner. */}
          <div className={`rounded-xl border-2 border-dashed p-4 sm:p-5 transition-colors ${
            !readyToScan ? 'border-stone-200 bg-stone-50'
              : scanError ? 'border-red-300 bg-red-50/40'
                : 'border-[#EA2831]/40 bg-[#EA2831]/[0.03]'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <label className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-stone-700">
                <span className="material-symbols-outlined text-[18px] text-[#EA2831]">qr_code_scanner</span>
                Scan here
              </label>
              
            </div>

            <div className="rounded-lg bg-white border border-stone-200 px-3 py-2 shadow-sm">
              <ScanBox
                onScan={handleScan}
                disabled={busy || !readyToScan || targetMet}
                placeholder="Scan a Lot Number / Bulk Packaging ID / Unit Code…"
              />
            </div>

            {/* Progress against the whole request. */}
            {readyToScan && isRequestTransfer && (
              <div className="flex items-center gap-3 mt-3">
                <div className="flex-1 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#EA2831] transition-all"
                    style={{ width: `${Math.min(100, (scannedCount / Math.max(1, requestLines.reduce((s, l) => s + l.requiredQty, 0))) * 100)}%` }}
                  />
                </div>
                <span className="text-[11px] font-bold text-stone-700 whitespace-nowrap">
                  {scannedCount} / {requestLines.reduce((s, l) => s + l.requiredQty, 0)}
                </span>
              </div>
            )}

            {/* Progress only means something against a declared target. */}
            {readyToScan && !isRequestTransfer && hasTarget && (
              <div className="flex items-center gap-3 mt-3">
                <div className="flex-1 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#EA2831] transition-all"
                    style={{ width: `${Math.min(100, (scannedCount / target) * 100)}%` }}
                  />
                </div>
                <span className="text-[11px] font-bold text-stone-700 whitespace-nowrap">
                  {scannedCount} / {target}
                </span>
              </div>
            )}

            
          </div>

          {/* Scan success and failure are announced by the TOAST only — printing
              them here as well said the same thing twice. `scanError` still
              tints the panel border above, and both flags still gate the resting
              line below. */}
          {readyToScan && !scanError && !scanNotice && !rows.length && (
            <p className="mt-3 text-xs text-stone-400">Nothing scanned yet.</p>
          )}
          {readyToScan && isRequestTransfer && allLinesComplete && !scanError && (
            <p className="mt-3 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              Every requested product has been scanned in full.
            </p>
          )}
          {readyToScan && !isRequestTransfer && targetMet && !scanError && (
            <p className="mt-3 text-xs font-medium text-stone-600 bg-stone-100 border border-stone-200 rounded-lg px-3 py-2">
              The quantity of {target} is complete. Raise it, or remove an item below, to scan more.
            </p>
          )}
          {readyToScan && !isRequestTransfer && !hasTarget && stockCeiling > 0 && scannedCount >= stockCeiling && (
            <p className="mt-3 text-xs font-medium text-stone-600 bg-stone-100 border border-stone-200 rounded-lg px-3 py-2">
              Every transferable unit of this product is now in the transfer.
            </p>
          )}

          {rows.length > 0 && (
            <div className="mt-5 overflow-x-auto border border-stone-200 rounded-xl">
              <table className="w-full min-w-[600px]">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <Th pad="px-4">Scanned</Th>
                    <Th pad="px-4">Type</Th>
                    {isRequestTransfer && <Th pad="px-4">Product</Th>}
                    <Th pad="px-4">Lot</Th>
                    <Th pad="px-4" right>Units</Th>
                    <Th pad="px-4" right> </Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((r) => (
                  <tr key={r.key} className="hover:bg-stone-50/60">
                    <td className="px-4 py-3 font-mono text-[11px] text-stone-800 break-all">{r.label}</td>
                    <td className="px-4 py-3 text-xs text-stone-500">{SCAN_LABEL[r.scanType] || r.scanType}</td>
                    {isRequestTransfer && (
                      <td className="px-4 py-3 text-xs font-medium text-stone-800">{r.productName || '—'}</td>
                    )}
                    <td className="px-4 py-3 font-mono text-[11px] text-stone-500 break-all">
                      {r.lotNumber || '—'}
                      {r.bulkPackagingId && (
                        <span className="block text-[10px] text-stone-400">
                          {r.scanType === 'bulk_package' ? 'carton ' : 'from '}{r.bulkPackagingId}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-stone-900 text-right">{r.unitCodes.length}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => removeRow(r.key)}
                        className="text-stone-400 hover:text-[#EA2831] p-1"
                        title="Remove from this transfer"
                      >
                        <span className="material-symbols-outlined text-base block">delete</span>
                      </button>
                    </td>
                  </tr>
                  ))}
                </tbody>
                <tfoot className="bg-stone-50 border-t border-stone-200">
                  <tr>
                    <td colSpan={isRequestTransfer ? 4 : 3} className="px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-stone-500">
                      Total quantity
                    </td>
                    <td className="px-4 py-2.5 text-sm font-black text-stone-900 text-right">{scannedCount}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Section>

        {/* ── SHIPMENT BOX ASSIGNMENT ── */}
        <Section
          title="Shipment Box Assignment"
          icon="inventory_2"
          muted={!scannedCount}
        >

          {bulkPackagedCount > 0 && (
            <p className="text-xs text-stone-600 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 mb-4">
              <span className="material-symbols-outlined text-[14px] align-middle mr-1">inventory_2</span>
              {bulkPackagedCount} unit(s) travel inside their existing Bulk Package — the seller scans that label,
              nothing to do here. Units taken OUT of a carton are listed below and do need a box.
            </p>
          )}

          {!looseCodes.length ? (
            <p className="text-sm text-stone-400">No individually scanned units in this transfer.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                
                {boxes.length > 0 && (
                  <GhostBtn onClick={() => setBoxes([])}>
                    <span className="material-symbols-outlined text-sm">close</span> Clear boxes
                  </GhostBtn>
                )}
              </div>

              {boxes.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {boxes.map((b, i) => (
                    <div key={b.id} className="border border-stone-200 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-black uppercase tracking-wider text-stone-900">
                          Box {i + 1}
                          <span className="ml-2 text-[10px] font-bold text-stone-400">{b.units.length} unit(s)</span>
                        </p>
                        <button
                          onClick={() => removeBox(b.id)}
                          className="text-stone-400 hover:text-[#EA2831] p-1"
                          title="Remove this box"
                        >
                          <span className="material-symbols-outlined text-base block">delete</span>
                        </button>
                      </div>
                      {!b.units.length ? (
                        <p className="text-xs text-stone-400">Empty — assign units from the list below.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {b.units.map((code) => (
                            <span
                              key={code}
                              className="inline-flex items-center gap-1 bg-stone-100 border border-stone-200 rounded-full pl-2.5 pr-1 py-0.5 text-[10px] font-mono text-stone-700"
                            >
                              {code}
                              <button
                                onClick={() => unassignUnit(code)}
                                className="text-stone-400 hover:text-[#EA2831]"
                                aria-label={`Remove ${code} from this box`}
                              >
                                <span className="material-symbols-outlined text-[13px] block">close</span>
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Every individually scanned unit, with a checkbox. Tick the ones
                  you want together, press Add to Box, and choose which box. */}
              <div className="border border-stone-200 rounded-xl overflow-hidden">
                <div className="bg-stone-50 border-b border-stone-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-[#EA2831] cursor-pointer"
                        checked={freeCodes.length > 0 && freeCodes.every((c) => picked.has(c))}
                        onChange={toggleAllFree}
                        disabled={!freeCodes.length}
                      />
                      <span className="text-[10px] font-black uppercase tracking-wider text-stone-500">
                        Individual Units ({looseCodes.length})
                      </span>
                    </label>
                    {picked.size > 0 && (
                      <span className="text-[11px] font-bold text-[#EA2831]">{picked.size} selected</span>
                    )}
                  </div>
                  <p className={`text-[11px] font-bold ${unassignedCodes.length ? 'text-stone-500' : 'text-green-600'}`}>
                    {unassignedCodes.length
                      ? `${unassignedCodes.length} unit(s) still unassigned`
                      : 'All units assigned'}
                  </p>
                </div>

                <div className="kt-picker-scroll divide-y divide-stone-100">
                  {looseCodes.map((code) => {
                    const boxIndex = boxes.findIndex((b) => b.units.includes(code));
                    const inBox = boxIndex >= 0;
                    return (
                      <label
                        key={code}
                        className={`flex items-center justify-between gap-3 px-4 py-2.5 min-h-[44px] transition-colors ${
                          inBox ? 'bg-stone-50/60' : picked.has(code) ? 'bg-[#EA2831]/5' : 'hover:bg-stone-50'
                        } ${inBox ? '' : 'cursor-pointer'}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-[#EA2831] shrink-0 cursor-pointer disabled:cursor-not-allowed"
                            checked={picked.has(code)}
                            disabled={inBox}
                            onChange={() => togglePick(code)}
                          />
                          <span className={`font-mono text-[11px] truncate ${inBox ? 'text-stone-400' : 'text-stone-700'}`}>
                            {code}
                          </span>
                        </div>
                        {inBox ? (
                          <span className="shrink-0 inline-flex items-center gap-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-stone-900 text-white rounded-full px-2.5 py-1">
                              Box {boxIndex + 1}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); unassignUnit(code); }}
                              className="text-stone-400 hover:text-[#EA2831] p-0.5"
                              title="Take out of this box"
                            >
                              <span className="material-symbols-outlined text-[15px] block">close</span>
                            </button>
                          </span>
                        ) : (
                          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-stone-300">
                            Unassigned
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {/* ONE action. Tick the units, press Add to Box, choose which —
                    the list offers every box that exists plus the next new one,
                    so a box is made by putting something in it. */}
                <div className="border-t border-stone-200 bg-stone-50/60 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-stone-500">
                    {picked.size
                      ? `${picked.size} unit(s) selected — choose a box.`
                      : 'Tick the units you want to box together.'}
                  </p>

                  <div className="relative">
                    <PrimaryBtn onClick={() => setBoxMenuOpen((v) => !v)} disabled={!picked.size}>
                      <span className="material-symbols-outlined text-base">move_to_inbox</span>
                      Add to Box
                      <span className={`material-symbols-outlined text-base transition-transform ${boxMenuOpen ? 'rotate-180' : ''}`}>
                        expand_more
                      </span>
                    </PrimaryBtn>

                    {boxMenuOpen && picked.size > 0 && (
                      <>
                        {/* Click anywhere else to dismiss. */}
                        <button
                          type="button"
                          aria-label="Close"
                          onClick={() => setBoxMenuOpen(false)}
                          className="fixed inset-0 z-40 cursor-default"
                        />
                        <div className="absolute right-0 bottom-full z-50 mb-2 w-60 rounded-xl border border-stone-200 bg-white shadow-xl shadow-stone-900/10 overflow-hidden">
                          <p className="px-3 py-2 text-[10px] font-black uppercase tracking-wider text-stone-400 border-b border-stone-100">
                            Add {picked.size} unit(s) to
                          </p>
                          <div className="max-h-56 overflow-y-auto">
                            {boxes.map((b, i) => (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => addPickedToBox(b.id)}
                                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-stone-50 transition-colors"
                              >
                                <span className="text-sm font-medium text-stone-900">Box {i + 1}</span>
                                <span className="text-[10px] font-bold text-stone-400">{b.units.length} unit(s)</span>
                              </button>
                            ))}
                            {/* The next box, created by this click. */}
                            <button
                              type="button"
                              onClick={() => addPickedToBox(null)}
                              className="w-full flex items-center gap-2 px-3 py-2.5 text-left border-t border-stone-100 hover:bg-[#EA2831]/5 transition-colors"
                            >
                              <span className="material-symbols-outlined text-[18px] text-[#EA2831]">add_box</span>
                              <span className="text-sm font-bold text-[#EA2831]">Box {boxes.length + 1}</span>
                              <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-stone-400">New</span>
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {!boxesReady && (
                <p className="mt-3 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Every individually scanned unit must sit in a box before the transfer can be confirmed —
                  or clear the boxes to send them loose.
                </p>
              )}
            </>
          )}
        </Section>

        {/* ── DISPATCH DETAILS + CONFIRM ── */}
        <Section
          title="Dispatch Details"
          icon="receipt_long"
          muted={!scannedCount}
        >
          {/* <div className="grid grid-cols-1 md:grid-cols-3 gap-x-5">
            <Field label="Vehicle Number">
              <input
                className={inputCls}
                value={transport.vehicleNo}
                onChange={(e) => setTransport((p) => ({ ...p, vehicleNo: e.target.value.toUpperCase() }))}
                placeholder="MP09 AB 1234"
              />
            </Field>
            <Field label="Driver Name">
              <input
                className={inputCls}
                value={transport.driverName}
                onChange={(e) => setTransport((p) => ({ ...p, driverName: e.target.value }))}
                placeholder="Full name"
              />
            </Field>
            <Field label="Driver Phone Number">
              <input
                className={inputCls}
                inputMode="tel"
                value={transport.driverPhone}
                onChange={(e) => setTransport((p) => ({ ...p, driverPhone: e.target.value.replace(/[^\d+\s-]/g, '') }))}
                placeholder="10-digit mobile"
              />
            </Field>
          </div> */}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
            {DOC_FIELDS.map((f) => (
              <DocumentField
                key={f.key}
                field={f}
                number={docs[f.numberKey]}
                onNumber={(v) => {
                  setDocs((p) => ({ ...p, [f.numberKey]: v }));
                  if (v.trim()) setDocErrors((p) => ({ ...p, [f.numberKey]: '' }));
                }}
                file={docFiles[f.fileKey]}
                onFile={(file) => pickDocFile(f.fileKey, f.label, file)}
                stored={storedDocs?.[f.fileKey] || null}
                error={docErrors[f.fileKey] || docErrors[f.numberKey]}
              />
            ))}
          </div>

          <Field label="Note (optional)">
  <textarea
    className={`${inputCls} min-h-[90px] resize-y py-2.5`}
    rows={3}
    value={notes}
    onChange={(e) => setNotes(e.target.value)}
    placeholder="Anything the seller should know about this consignment"
  />
</Field>

        

          {submitError && (
            <div className="mb-4 flex items-start gap-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <span className="material-symbols-outlined text-[16px] shrink-0">error</span>
              <span>
                <b className="block">The transfer was not completed.</b>
                {submitError}
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
            <p className="text-xs text-stone-500">
              On confirm, {scannedCount || 0} unit(s) leave {sourceWarehouse?.name || 'this warehouse'} and go in
              transit to {seller?.businessName || 'the seller'}.
            </p>
            <div className="flex items-center gap-3">
              <GhostBtn onClick={() => resetItems()} disabled={busy || !rows.length}>Clear scans</GhostBtn>
              <PrimaryBtn onClick={submit} disabled={busy || !readyToSend}>
                <span className="material-symbols-outlined text-base">local_shipping</span>
                {busy
                  ? 'Transferring…'
                  : !scannedCount
                    ? 'Scan items to confirm'
                    : isRequestTransfer && !allLinesComplete
                      ? `Scan ${requestLines.reduce((s, l) => s + l.remainingQty, 0)} more to confirm`
                      : !isRequestTransfer && hasTarget && scannedCount !== target
                      ? `Scan ${remaining} more to confirm`
                      : !boxesReady
                        ? 'Assign every unit to a box'
                        : missingDocNumbers.length
                          ? `Enter the ${missingDocNumbers.map((f) => f.label).join(', ')} number${missingDocNumbers.length > 1 ? 's' : ''}`
                          : missingDocFiles.length
                            ? `Attach the ${missingDocFiles.map((f) => f.label).join(', ')} document${missingDocFiles.length > 1 ? 's' : ''}`
                            : `Confirm transfer of ${scannedCount} unit(s)`}
              </PrimaryBtn>
            </div>
          </div>
        </Section>
      </div>

      {labelInfo && <ManifestModal info={labelInfo} onClose={() => setLabelInfo(null)} />}
      {boxLabels && (
        <ShipmentBoxLabelsModal
          boxes={boxLabels.boxes}
          seller={boxLabels.seller}
          transferRef={boxLabels.ref}
          onClose={() => setBoxLabels(null)}
        />
      )}
    </div>
  );
};

export default ImsSellerTransfer;