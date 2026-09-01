import React, { useEffect, useMemo, useState } from 'react';
import { getMyProducts, addMyStock } from '../../lib/sellerMyProductApi';
import { getSellerWarehouses } from '../../lib/sellerApi';

/**
 * ADD STOCK — records the seller's OWN existing stock against one of their own
 * products.
 *
 * THIS IS THE ONLY DOOR quantity enters through. The product form's variant
 * table shows Stock as read-only 0 and the API refuses a variant `stock`, so
 * there is exactly one place a number can be typed and exactly one thing it
 * produces: a real Inventory lot with a lot number, dates and a `supply_in`
 * ledger row — the same shape a company lot has.
 */

// yyyy-mm-dd for <input type="date">, in LOCAL time. toISOString() would shift
// the date backwards for anyone east of UTC, so a lot made today could be filed
// as yesterday.
const toDateInput = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};

const SellerAddStockModal = ({ onClose, onDone }) => {
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loadingRefs, setLoadingRefs] = useState(true);

  const [f, setF] = useState({
    productId: '',
    variantSku: '',
    lotNumber: '',
    mfgDate: '',
    expiryDate: '',
    qty: '',
    lowStockThreshold: '0',
    warehouseId: '',
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Editing a field clears its own message as it's fixed.
  const clearErr = (k) => setErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev));
  const u = (k) => (e) => { setF((prev) => ({ ...prev, [k]: e.target.value })); clearErr(k); };

  useEffect(() => {
    let ignore = false;
    Promise.all([
      getMyProducts().catch(() => ({ data: [] })),
      getSellerWarehouses().catch(() => ({ data: [] })),
    ])
      .then(([p, w]) => {
        if (ignore) return;
        setProducts(p?.data || []);
        setWarehouses(w?.data || []);
      })
      .finally(() => { if (!ignore) setLoadingRefs(false); });
    return () => { ignore = true; };
  }, []);

  const product = useMemo(
    () => products.find((p) => String(p._id) === String(f.productId)) || null,
    [products, f.productId]
  );
  // The Variant field exists only for a product that actually HAS variants —
  // for every single-variant product it is not rendered at all.
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const hasVariants = variants.length > 0;

  /* PICKING A PRODUCT resets the variant choice: a variant SKU from the
     previously selected product would otherwise stay selected and be submitted
     against the new one. */
  const onProduct = (e) => {
    setF((prev) => ({ ...prev, productId: e.target.value, variantSku: '' }));
    clearErr('productId');
    clearErr('variantSku');
  };

  /* MANUFACTURING DATE → EXPIRY.
     Filling the mfg date derives the expiry from the product's shelf life, so
     the seller doesn't compute "today + 730 days" by hand. It is a SUGGESTION,
     not a lock: the expiry field stays fully editable afterwards, and a value
     the user has already typed is never overwritten. */
  const onMfgDate = (e) => {
    const value = e.target.value;
    setF((prev) => {
      const next = { ...prev, mfgDate: value };
      const days = Number(product?.shelfLifeDays);
      if (value && !prev.expiryDate && Number.isFinite(days) && days > 0) {
        const base = new Date(`${value}T00:00:00`);
        if (!Number.isNaN(base.getTime())) {
          next.expiryDate = toDateInput(new Date(base.getTime() + days * 86400000));
        }
      }
      return next;
    });
    clearErr('mfgDate');
  };

  const validate = () => {
    const next = {};
    if (!f.productId) next.productId = 'Select a product';
    if (hasVariants && !f.variantSku) next.variantSku = 'Select a variant';
    if (!f.mfgDate) next.mfgDate = 'Manufacturing date is required';
    if (!String(f.qty).trim()) next.qty = 'Quantity is required';
    else if (!(Number(f.qty) >= 1)) next.qty = 'Quantity must be at least 1';
    if (!f.warehouseId) next.warehouseId = 'Select a warehouse';
    if (f.mfgDate && f.expiryDate && new Date(f.expiryDate) <= new Date(f.mfgDate)) {
      next.expiryDate = 'Expiry must be after the manufacturing date';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    setBusy(true);
    try {
      await addMyStock({
        productId: f.productId,
        warehouseId: f.warehouseId,
        // Blank → the server mints MYP-<6 chars>.
        lotNumber: f.lotNumber.trim() || undefined,
        mfgDate: f.mfgDate,
        expiryDate: f.expiryDate || undefined,
        qty: Number(f.qty),
        lowStockThreshold: String(f.lowStockThreshold).trim() === '' ? 0 : Number(f.lowStockThreshold),
        // Which variant this stock is. Sent only for a product that HAS
        // variants — the API rejects one sent for a single-variant product,
        // and requires one for a multi-variant product. It is what keeps Red
        // and Yellow on separate Inventory rows instead of merging.
        variantSku: hasVariants ? f.variantSku : undefined,
      });
      onDone?.();
    } catch (err) {
      setSubmitError(err?.response?.data?.message || 'Could not add stock. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "w-full border border-stone-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#EA2831]/20 focus:border-[#EA2831] outline-none transition-all placeholder:text-stone-300 bg-white font-sora";
  const errClass = "border-red-300 focus:ring-red-100 focus:border-red-400";
  const labelClass = "block text-sm font-semibold text-stone-700 mb-1.5";
  const cls = (k) => `${inputClass} ${errors[k] ? errClass : ''}`;
  const Err = ({ k }) => (errors[k] ? <p className="text-[11px] font-medium text-red-500 mt-1">{errors[k]}</p> : null);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 font-sora" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-200 flex items-start justify-between gap-4">
          <div>
            <h3 className="font-bold text-stone-900">Add stock</h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Record stock you already hold. This creates a lot you can trace, with its own lot number and expiry.
            </p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 p-1 text-stone-400 hover:text-stone-700 transition-colors" aria-label="Close">
            <span className="material-symbols-outlined text-xl block">close</span>
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
          <div className="p-5 overflow-y-auto space-y-5">
            {loadingRefs && <p className="text-sm text-stone-400 text-center py-6">Loading…</p>}

            {!loadingRefs && products.length === 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs font-bold text-amber-800">No products yet</p>
                <p className="text-[11px] text-amber-700 mt-0.5">Add a product on the Products tab first — stock is always recorded against one.</p>
              </div>
            )}

            {!loadingRefs && products.length > 0 && (
              <>
                <div>
                  <label className={labelClass}>Product <span className="text-[#EA2831]">*</span></label>
                  <select className={cls('productId')} value={f.productId} onChange={onProduct}>
                    <option value="">Select a product</option>
                    {products.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.productName}{p.brandName ? ` — ${p.brandName}` : ''}
                      </option>
                    ))}
                  </select>
                  <Err k="productId" />
                </div>

                {/* Rendered ONLY for a product that has variants. */}
                {hasVariants && (
                  <div>
                    <label className={labelClass}>Variant <span className="text-[#EA2831]">*</span></label>
                    <select className={cls('variantSku')} value={f.variantSku} onChange={u('variantSku')}>
                      <option value="">Select a variant</option>
                      {variants.map((v) => (
                        <option key={v.sku || v.label} value={v.sku || v.label}>
                          {v.label}{v.sku ? ` (${v.sku})` : ''}
                        </option>
                      ))}
                    </select>
                    <Err k="variantSku" />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className={labelClass}>Lot Number</label>
                    <input className={inputClass} value={f.lotNumber} onChange={u('lotNumber')} placeholder="Auto-generated if left blank" />
                  </div>
                  <div>
                    <label className={labelClass}>Warehouse <span className="text-[#EA2831]">*</span></label>
                    <select className={cls('warehouseId')} value={f.warehouseId} onChange={u('warehouseId')}>
                      <option value="">Select a warehouse</option>
                      {warehouses.map((w) => (
                        <option key={w._id} value={w._id}>{w.name}{w.code ? ` (${w.code})` : ''}</option>
                      ))}
                    </select>
                    <Err k="warehouseId" />
                  </div>

                  <div>
                    <label className={labelClass}>Manufacturing Date <span className="text-[#EA2831]">*</span></label>
                    <input type="date" className={cls('mfgDate')} value={f.mfgDate} onChange={onMfgDate} />
                    <Err k="mfgDate" />
                  </div>
                  <div>
                    <label className={labelClass}>Expiry Date</label>
                    <input type="date" className={cls('expiryDate')} value={f.expiryDate} onChange={u('expiryDate')} />
                    <Err k="expiryDate" />
                    {/* {Number(product?.shelfLifeDays) > 0 && (
                      <p className="text-xs text-stone-400 mt-1">
                        Filled in from this product&rsquo;s {product.shelfLifeDays}-day shelf life — edit it if the pack says otherwise.
                      </p>
                    )} */}
                  </div>

                  <div>
                    <label className={labelClass}>Quantity <span className="text-[#EA2831]">*</span></label>
                    <input type="number" min="1" step="1" className={cls('qty')} value={f.qty} onChange={u('qty')} placeholder="e.g., 250" />
                    <Err k="qty" />
                  </div>
                  <div>
                    <label className={labelClass}>Low-stock Alert At</label>
                    <input type="number" min="0" step="1" className={inputClass} value={f.lowStockThreshold} onChange={u('lowStockThreshold')} placeholder="0" />
                    <p className="text-xs text-stone-400 mt-1">You&rsquo;ll be alerted when this lot drops to this number. 0 turns it off.</p>
                  </div>
                </div>

                {submitError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    <p className="text-xs font-medium text-red-700">{submitError}</p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="px-5 py-4 border-t border-stone-200 flex justify-end gap-3 bg-stone-50/50">
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-bold border border-stone-200 rounded-xl hover:bg-white transition-all">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || loadingRefs || products.length === 0}
              className="px-8 py-2.5 text-sm font-bold bg-[#EA2831] text-white rounded-xl hover:bg-black shadow-lg shadow-[#EA2831]/20 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy ? 'Adding…' : 'Add stock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SellerAddStockModal;
