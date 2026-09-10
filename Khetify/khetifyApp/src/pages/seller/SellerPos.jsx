import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Field, inputCls, PrimaryBtn, GhostBtn, Th } from '../Company/ims/ImsUi';
import { useSellerPermission } from '../../context/SellerPermissionContext';
import {
  getSellerWarehouses, getSellerTransferStock, createSellerPosSale, getSellerPosInvoicePdf,
  getSellerMe,
} from '../../lib/sellerApi';

const listOf = (r) => (Array.isArray(r) ? r : r?.data || []);
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => `Rs. ${inr(n)}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
// POS counter takes cash and UPI only. "card"/"credit" remain valid in the
// Order enum for other flows — this is a screen choice, not a schema change.
const MODES = [
  { key: 'cash', label: 'Cash' }, { key: 'upi', label: 'UPI' },
];

/** Earliest-expiring lot. Nulls sort last — an undated lot is not "earliest". */
const fefoLot = (lots = []) => {
  const sorted = [...lots].sort((a, b) => {
    if (!a?.expiryDate) return 1;
    if (!b?.expiryDate) return -1;
    return new Date(a.expiryDate) - new Date(b.expiryDate);
  });
  return sorted[0] || null;
};

/* ---- amount in words (Indian system) — formats the server's total, never recomputes it ---- */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const under100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const under1000 = (n) => {
  const h = Math.floor(n / 100); const rest = n % 100; const out = [];
  if (h) out.push(`${ONES[h]} Hundred`);
  if (rest) out.push(under100(rest));
  return out.join(' ');
};
function amountInWords(amount) {
  const n = Math.round(Number(amount) || 0);
  if (n <= 0) return 'Zero Rupees Only';
  const parts = [];
  const cr = Math.floor(n / 10000000);
  const lk = Math.floor((n % 10000000) / 100000);
  const th = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (cr) parts.push(`${under1000(cr)} Crore`);
  if (lk) parts.push(`${under1000(lk)} Lakh`);
  if (th) parts.push(`${under1000(th)} Thousand`);
  if (rest) parts.push(under1000(rest));
  return `${parts.join(' ')} Rupees Only`;
}

/* Print: show only the invoice block, so the sidebar/header never print.
   No PDF library — the real PDF comes from the server. */
const PRINT_CSS = `
/* Suppresses the browser's own date/URL header and footer. */
@page { size: A4; margin: 12mm; }
@media print {
  body * { visibility: hidden !important; }
  #pos-invoice, #pos-invoice * { visibility: visible !important; }
  #pos-invoice {
    position: absolute; left: 0; top: 0; width: 100%; padding: 0;
    /* Paper needs no card chrome. */
    border: 0 !important; border-radius: 0 !important;
    box-shadow: none !important; background: #fff !important;
  }
  /* Muted greys must stay readable on paper. */
  #pos-invoice, #pos-invoice * {
    color: #000 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  #pos-invoice tr, #pos-invoice .totals-block { page-break-inside: avoid; break-inside: avoid; }
  .no-print { display: none !important; }
}`;

/** Split a stored field into its comma-separated tokens, dropping empties.
 *  Address fields are free text and often already hold the whole address, so a
 *  token is the unit we de-duplicate on. */
const tokens = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** Keep the first occurrence of each token, comparing case-insensitively, and
 *  skip anything already used on an earlier line. Every part prints ONCE. */
const dedupe = (parts, used = new Set()) => {
  const out = [];
  parts.forEach((t) => {
    const k = t.toLowerCase();
    if (used.has(k)) return;
    used.add(k);
    out.push(t);
  });
  return out;
};

export default function SellerPos() {
  const { warehouseIds = [], role } = useSellerPermission();
  const myWh = (warehouseIds || []).map(String);
  const scoped = role !== 'seller_admin' && myWh.length > 0;

  const [warehouses, setWarehouses] = useState([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [stock, setStock] = useState([]);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState([]);
  const [mode, setMode] = useState('cash');
  const [received, setReceived] = useState('');
  const [phone, setPhone] = useState('');
  const [custName, setCustName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);   // the saved Order
  const [billedTo, setBilledTo] = useState(null); // the phone/name as typed for this bill
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState('');
  const [seller, setSeller] = useState(null); // supplier block on the invoice

  // Lock to the single warehouse this user is scoped to; otherwise they pick one.
  const lockedWh = scoped && myWh.length === 1
    ? (warehouses.find((w) => String(w._id) === myWh[0]) || null)
    : null;

  useEffect(() => {
    getSellerWarehouses().then((r) => {
      const all = listOf(r);
      setWarehouses(scoped ? all.filter((w) => myWh.includes(String(w._id))) : all);
    }).catch(() => {});
    // Supplier details for the invoice header, fetched ONCE. A failure here
    // must never hide a bill that already saved, so the block is simply omitted.
    getSellerMe().then((r) => setSeller(r?.data || null)).catch(() => setSeller(null));
    // No catalogue call: /transfers/stock carries mrp, gstPercentage and hsnCode
    // itself. The catalogue route is gated by catalog:read + BASIC_CATALOG, which
    // the warehouse user standing at this counter does not have.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (lockedWh && !warehouseId) setWarehouseId(String(lockedWh._id)); }, [lockedWh, warehouseId]);

  const loadStock = useCallback((whId) => {
    if (!whId) { setStock([]); return; }
    getSellerTransferStock(whId).then((r) => setStock(listOf(r))).catch(() => setStock([]));
  }, []);

  // Stock in a different warehouse is a different set of goods, so the cart goes.
  useEffect(() => { setCart([]); setDone(null); setErr(''); loadStock(warehouseId); }, [warehouseId, loadStock]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return stock.filter((s) => `${s.productName || ''} ${s.skuNumber || ''}`.toLowerCase().includes(term)).slice(0, 8);
  }, [q, stock]);

  const addRow = (s) => {
    setCart((prev) => {
      const i = prev.findIndex((r) => String(r.productId) === String(s.productId));
      if (i >= 0) { // already billed — bump the qty rather than duplicate the row
        const next = [...prev];
        next[i] = { ...next[i], qty: Math.min(next[i].qty + 1, next[i].availableQty || Infinity) };
        return next;
      }
      return [...prev, {
        productId: s.productId, productName: s.productName, skuNumber: s.skuNumber,
        // Straight off the stock row. null mrp stays null — never 0, which would
        // read as "free" on the bill.
        mrp: s.mrp == null ? null : Number(s.mrp),
        gstPercentage: Number(s.gstPercentage || 0), hsnCode: s.hsnCode || '',
        availableQty: Number(s.availableQty || 0), lot: fefoLot(s.lots), qty: 1,
      }];
    });
    setQ('');
  };

  const setQty = (productId, raw) => setCart((prev) => prev.map((r) => {
    if (String(r.productId) !== String(productId)) return r;
    const n = Math.max(1, Math.floor(Number(raw) || 1));
    return { ...r, qty: Math.min(n, r.availableQty || n), over: n > (r.availableQty || n) };
  }));

  // Only priced lines can total up. An unpriced line is still sellable — the
  // server knows its price — it just cannot show an amount here.
  const priced = cart.filter((r) => r.mrp != null);
  const subtotal = priced.reduce((sum, r) => sum + r.mrp * r.qty, 0);
  // ONE combined figure for the BILL panel. The saved TAX INVOICE below still
  // states CGST and SGST separately — a GST invoice is legally required to
  // (CGST Rules, Rule 46) — so only this pre-save preview is collapsed.
  const gstEst = priced.reduce((sum, r) => sum + (r.mrp * r.qty * (r.gstPercentage || 0)) / 100, 0);
  const totalEst = subtotal + gstEst;
  const unpriced = cart.some((r) => r.mrp == null);
  const change = Number(received || 0) - totalEst;

  const phoneOk = /^\d{10}$/.test(phone.trim());
  const nameOk = custName.trim().length > 0;
  const blockedWhy = !warehouseId ? 'Pick a warehouse to start.'
    : !cart.length ? 'Add at least one item.'
      : !nameOk ? 'Enter the customer’s name.'
        : !phoneOk ? 'Enter the customer’s 10-digit phone number.' : '';

  const save = async () => {
    if (busy || blockedWhy) return;
    setBusy(true); setErr(''); // this endpoint deducts stock — a double-click is real inventory loss
    try {
      const body = {
        items: cart.map((r) => ({ productId: r.productId, qty: r.qty })), // no price: the server resolves it
        payment: { mode },
        warehouseId,
        customerPhone: phone.trim(),
        customerName: custName.trim(),
      };
      const res = await createSellerPosSale(body);
      setBilledTo({ name: custName.trim(), phone: phone.trim() });
      setDone(res?.data || res);
      loadStock(warehouseId); // availableQty has moved
    } catch (e) {
      setErr(e?.response?.data?.message || e.message || 'Could not save the bill');
    } finally { setBusy(false); } // cart deliberately kept on error, so they can retry
  };

  const downloadPdf = async () => {
    if (!done?._id || pdfBusy) return;
    setPdfBusy(true); setPdfErr('');
    let url;
    try {
      const blob = await getSellerPosInvoicePdf(done._id);
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${done.invoiceNumber || done._id}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      setPdfErr(e?.response?.data?.message || e.message || 'Could not download the invoice');
    } finally {
      if (url) URL.revokeObjectURL(url);
      setPdfBusy(false);
    }
  };

  const reset = () => {
    setCart([]); setDone(null); setErr(''); setQ(''); setPdfErr('');
    setReceived(''); setPhone(''); setCustName(''); setMode('cash'); setBilledTo(null);
  };

  /* ---------- SAVED: the invoice, rendered from the save response ---------- */
  if (done) {
    const items = done.items || [];
    const sum = (f) => items.reduce((a, it) => a + Number(it.taxes?.[f] || 0), 0);
    // The Order carries totalAmount (taxable value) and totalTax separately —
    // there is no grand-total field — so Total is their sum, exactly as the
    // server's own PDF does it. Nothing else is derived.
    const grand = Number(done.totalAmount || 0) + Number(done.totalTax || 0);
    // Supplier lines. Blank fields drop out entirely rather than printing
    // "undefined" or a stray comma / dash, and each part is used exactly once:
    // line 1 is [line, city], line 2 is [state, pincode], with any token
    // already shown on line 1 skipped so nothing repeats.
    const addr = seller?.contact?.address || {};
    const bizName = String(seller?.sellerInfo?.businessName || '').trim();
    const sellerGstin = String(seller?.verification?.gstin || '').trim();
    const used = new Set();
    const addrLine1 = dedupe([...tokens(addr.line), ...tokens(addr.city)], used).join(', ');
    const addrLine2 = dedupe([...tokens(addr.state), ...tokens(addr.pincode)], used).join(' - ');
    // The warehouse this bill was issued from — already in state, not re-fetched.
    const issuingWh = warehouses.find((w) => String(w._id) === String(warehouseId)) || lockedWh;
    const whName = String(issuingWh?.name || '').trim();
    const whCode = String(issuingWh?.code || '').trim();
    const branch = whName ? `Branch: ${whName}${whCode ? ` (${whCode})` : ''}` : '';
    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
        <style>{PRINT_CSS}</style>
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="flex items-center justify-between gap-3 no-print">
            <div className="text-sm font-bold text-green-700">✓ Sale complete — stock deducted</div>
            <div className="flex gap-2">
              <GhostBtn onClick={() => window.print()}>Print</GhostBtn>
              <GhostBtn onClick={downloadPdf} disabled={pdfBusy}>{pdfBusy ? 'Preparing…' : 'Download PDF'}</GhostBtn>
            </div>
          </div>
          {pdfErr && <div className="text-sm text-[#EA2831] bg-[#EA2831]/5 rounded-lg px-3 py-2 no-print">{pdfErr}</div>}

          <div id="pos-invoice" className="border border-stone-200 rounded-xl p-6 space-y-4">
            <div className="text-center text-lg font-bold tracking-wide text-stone-900">TAX INVOICE</div>
            <div className="border-t border-stone-200" />

            <div className="flex flex-col sm:flex-row justify-between gap-4 text-sm">
              {/* Supplier. Each line is omitted when its source field is blank. */}
              <div className="space-y-0.5">
                {bizName && <div className="font-bold text-stone-900">{bizName}</div>}
                {sellerGstin && <div className="text-stone-700">GSTIN {sellerGstin}</div>}
                {addrLine1 && <div className="text-stone-600">{addrLine1}</div>}
                {addrLine2 && <div className="text-stone-600">{addrLine2}</div>}
                {branch && <div className="text-stone-600">{branch}</div>}
              </div>
              <div className="space-y-0.5 sm:text-right">
                <div><span className="text-stone-500">Invoice No. </span><span className="font-semibold text-stone-900">{done.invoiceNumber}</span></div>
                <div><span className="text-stone-500">Date </span><span className="text-stone-800">{fmtDate(done.createdAt)}</span></div>
                <div><span className="text-stone-500">Payment </span><span className="text-stone-800 capitalize">{done.payment?.mode}</span></div>
              </div>
            </div>
            <div className="border-t border-stone-200" />

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Bill to</div>
              <div className="text-sm font-semibold text-stone-900">{done.customerName || billedTo?.name}</div>
              {billedTo?.phone && <div className="text-sm text-stone-600">{billedTo.phone}</div>}
            </div>
            <div className="border-t border-stone-200" />

            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-stone-400">
                    <th className="py-2 text-left font-bold">#</th>
                    <th className="py-2 text-left font-bold">Description</th>
                    <th className="py-2 text-left font-bold">HSN</th>
                    <th className="py-2 text-right font-bold">Qty</th>
                    <th className="py-2 text-right font-bold">Rate</th>
                    <th className="py-2 text-right font-bold">Taxable</th>
                    <th className="py-2 text-right font-bold">GST</th>
                    <th className="py-2 text-right font-bold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const t = it.taxes || {};
                    const amt = Number(t.taxable || 0) + Number(t.cgst || 0) + Number(t.sgst || 0) + Number(t.igst || 0);
                    return (
                      <tr key={i} className="border-t border-stone-100">
                        <td className="py-2 text-stone-500">{i + 1}</td>
                        <td className="py-2 text-stone-800">{it.name}</td>
                        <td className="py-2 text-stone-600">{t.hsnCode}</td>
                        <td className="py-2 text-right text-stone-800">{it.qty}</td>
                        <td className="py-2 text-right text-stone-800">{inr(it.price)}</td>
                        <td className="py-2 text-right text-stone-800">{inr(t.taxable)}</td>
                        <td className="py-2 text-right text-stone-600">{Number(t.gstRate || 0)}%</td>
                        <td className="py-2 text-right font-semibold text-stone-900">{inr(amt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-stone-200" />

            <div className="flex flex-col sm:flex-row justify-between gap-6">
              <div className="flex-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Amount in words</div>
                <div className="text-sm text-stone-800">{amountInWords(grand)}</div>
              </div>
              <div className="totals-block w-full sm:w-64 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-stone-500">Taxable value</span><span className="text-stone-800">{money(done.totalAmount)}</span></div>
                {/* PRESENTATION ONLY: the split is still computed and still
                    stored per line in items[].taxes — shown here as one figure. */}
                <div className="flex justify-between"><span className="text-stone-500">GST</span><span className="text-stone-800">{money(sum('cgst') + sum('sgst') + sum('igst'))}</span></div>
                <div className="flex justify-between pt-2 mt-1 border-t border-stone-200">
                  <span className="font-bold text-stone-900">Total</span>
                  <span className="font-bold text-stone-900">{money(grand)}</span>
                </div>
              </div>
            </div>

            <div className="border-t border-stone-200 pt-4 flex flex-col sm:flex-row justify-between gap-6">
              {/* <p className="text-xs text-stone-500 max-w-sm">
                This is a computer-generated invoice and does not require a signature.
              </p> */}
              {bizName && (
                <div className="text-right">
                  <div className="text-xs text-stone-600">For {bizName}</div>
                  {/* Room for a signature. */}
                  <div className="h-12" />
                </div>
              )}
            </div>
          </div>

          <div className="no-print"><PrimaryBtn onClick={reset}>New Sale</PrimaryBtn></div>
        </div>
      </div>
    );
  }

  /* ---------- BILLING ---------- */
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-white font-sora">
      <div className="max-w-7xl mx-auto space-y-6">

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-stone-900">Point of Sale</h1>
            <p className="text-sm text-stone-500">Counter billing — stock is deducted the moment the bill is saved.</p>
          </div>
          <div className="min-w-[220px]">
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">Warehouse</div>
            {lockedWh ? (
              <div className="text-sm font-semibold text-stone-800 border border-stone-200 rounded-lg px-3.5 py-2.5 bg-stone-50">
                {lockedWh.name}
              </div>
            ) : (
              <select className={inputCls} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">Select a warehouse…</option>
                {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
              </select>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          <div className="lg:col-span-2 space-y-3">
            <div className="relative">
              <input
                className={inputCls}
                placeholder={warehouseId ? 'Search a product by name or SKU…' : 'Pick a warehouse first'}
                value={q}
                disabled={!warehouseId}
                onChange={(e) => setQ(e.target.value)}
              />
              {results.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-stone-200 rounded-lg shadow-lg overflow-hidden">
                  {results.map((s) => (
                    <button
                      key={s.productId}
                      className="w-full text-left px-4 py-2.5 hover:bg-stone-50 border-b border-stone-100 last:border-0"
                      onClick={() => addRow(s)}
                    >
                      <div className="text-sm font-semibold text-stone-800">{s.productName}</div>
                      <div className="text-xs text-stone-500">{s.skuNumber} · {s.availableQty} in stock</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-stone-200 rounded-xl overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <Th pad="px-4">Product</Th><Th pad="px-4">HSN</Th><Th pad="px-4">Lot (FEFO)</Th>
                    <Th pad="px-4">Qty</Th><Th pad="px-4" right>Rate</Th><Th pad="px-4" right>GST</Th>
                    <Th pad="px-4" right>Amount</Th><Th pad="px-4" />
                  </tr>
                </thead>
                <tbody>
                  {!cart.length && (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-stone-400">No items yet. Search above to add one.</td></tr>
                  )}
                  {cart.map((r) => {
                    const rate = r.mrp;
                    return (
                      <tr key={r.productId} className="border-b border-stone-100 last:border-0">
                        <td className="px-4 py-3">
                          <div className="text-sm font-semibold text-stone-800">{r.productName}</div>
                          <div className="text-xs text-stone-500">{r.skuNumber}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-stone-600">{r.hsnCode || <span className="text-stone-400">—</span>}</td>
                        <td className="px-4 py-3">
                          {r.lot ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-stone-700">{r.lot.lotNumber}</span>
                              <span className="text-[9px] font-bold bg-stone-100 text-stone-500 rounded px-1.5 py-0.5">FEFO</span>
                            </div>
                          ) : <span className="text-xs text-stone-400">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number" min={1} value={r.qty}
                            className="w-20 border border-stone-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#EA2831]/30"
                            onChange={(e) => setQty(r.productId, e.target.value)}
                          />
                          {r.over && <div className="text-[10px] text-[#EA2831] mt-1">Only {r.availableQty} in stock</div>}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-stone-700">
                          {rate == null ? <span className="text-stone-400">—</span> : inr(rate)}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-stone-600">{r.gstPercentage || 0}%</td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-stone-800">
                          {rate == null ? <span className="text-stone-400">—</span> : inr(rate * r.qty)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            className="text-stone-400 hover:text-[#EA2831]"
                            onClick={() => setCart((p) => p.filter((x) => String(x.productId) !== String(r.productId)))}
                          >✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-stone-400">FEFO picks the earliest-expiring lot automatically.</p>
          </div>

          {/* One panel holds the whole bill: who it is for, what it comes to, how it is paid. */}
          <div className="border border-stone-200 rounded-xl p-5 h-fit space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Bill</span>
              <span className="text-xs text-stone-500">{fmtDate(new Date())}</span>
            </div>
            <p className="text-xs text-stone-400 -mt-3">Invoice no. will be assigned on save</p>

            <div className="border-t border-stone-200 pt-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-2">
                Customer<span className="text-[#EA2831] ml-0.5">*</span>
              </div>
              <Field label="Name" required>
                <input className={inputCls} placeholder="Customer name" value={custName} onChange={(e) => setCustName(e.target.value)} />
              </Field>
              <Field label="Phone" required>
                <input
                  className={inputCls} inputMode="numeric" placeholder="10-digit phone"
                  value={phone} onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
              <p className="text-xs text-stone-400 -mt-2">Required for a GST bill.</p>
            </div>

            <div className="border-t border-stone-200 pt-3">
              <div className="flex justify-between items-baseline text-sm">
                <span className="text-stone-500">Subtotal</span>
                <span className="font-semibold text-stone-800">{money(subtotal)}</span>
              </div>
              <div className="flex justify-between items-baseline text-sm mt-1">
                <span className="text-stone-500">GST</span>
                <span className="font-semibold text-stone-800">{money(gstEst)}</span>
              </div>
              <div className="flex justify-between items-baseline mt-2 pt-2 border-t border-stone-200">
                <span className="text-sm text-stone-500">Total</span>
                <span className="text-xl font-bold text-stone-900">{money(totalEst)}</span>
              </div>
            </div>

            <div className="border-t border-stone-200 pt-3">
              <Field label="Payment mode">
                <div className="grid grid-cols-2 gap-2">
                  {MODES.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => setMode(m.key)}
                      className={`text-sm font-bold rounded-lg px-3 py-2 border transition-colors ${
                        mode === m.key
                          ? 'bg-[#EA2831] border-[#EA2831] text-white'
                          : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                      }`}
                    >{m.label}</button>
                  ))}
                </div>
              </Field>

              {mode === 'cash' && (
                <div>
                  <Field label="Cash received">
                    <input type="number" min={0} className={inputCls} value={received} onChange={(e) => setReceived(e.target.value)} />
                  </Field>
                  <div className="flex justify-between text-sm">
                    <span className="text-stone-500">Change to return</span>
                    <span className="font-bold text-stone-900">{change > 0 ? money(change) : '—'}</span>
                  </div>
                </div>
              )}
            </div>

            {unpriced && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                One or more items have no rate set. The final bill may differ.
              </div>
            )}

            {err && <div className="text-sm text-[#EA2831] bg-[#EA2831]/5 rounded-lg px-3 py-2">{err}</div>}

            <PrimaryBtn className="w-full justify-center" disabled={busy || !!blockedWhy} onClick={save}>
              {busy ? 'Saving…' : 'Save Bill · Deduct Stock'}
            </PrimaryBtn>
            {blockedWhy && <p className="text-xs text-stone-500 text-center">{blockedWhy}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
