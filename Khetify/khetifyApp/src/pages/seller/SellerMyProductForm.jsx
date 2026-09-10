import React, { useEffect, useRef, useState } from 'react';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import 'animate.css';
import { ChevronDown, X } from 'lucide-react';
import SelectWithOther from '../../Components/ims/SelectWithOther';
import { getProductImage } from '../../lib/productImage';
import HORTICULTURE_PRODUCTS from '../../lib/horticultureProducts';
import { createMyProduct, updateMyProduct, getMyProduct, checkDuplicateName, searchHsn, getGstByHsn } from '../../lib/sellerMyProductApi';

/* ================= STATIC OPTION CATALOGUES =================
   Kept at MODULE scope on purpose: these arrays never change, so defining them
   outside the component keeps their identity stable across renders (and avoids
   the classic "component re-created on every keystroke" focus-loss trap). */

const UNIT_OPTIONS = [
  { value: 'Kilograms',   label: 'Kilograms (kg)',    short: 'kg',  kind: 'weight', step: '0.01' },
  { value: 'Grams',       label: 'Grams (g)',         short: 'g',   kind: 'weight', step: '1'    },
  { value: 'Metric Ton',  label: 'Metric Ton (MT)',   short: 'MT',  kind: 'weight', step: '0.01' },
  { value: 'Liters',      label: 'Liters (L)',        short: 'L',   kind: 'volume', step: '0.01' },
  { value: 'Milliliters', label: 'Milliliters (ml)',  short: 'ml',  kind: 'volume', step: '1'    },
  { value: 'Pieces',      label: 'Pieces (Pcs)',      short: 'Pcs', kind: 'count',  step: '1'    },
  { value: 'Packets',     label: 'Packets (Pkt)',     short: 'Pkt', kind: 'count',  step: '1'    },
];

const UNIT_VALUE_LABEL = {
  weight: 'Net Weight',
  volume: 'Net Volume',
  count:  'Quantity per Pack',
  custom: 'Unit Value',
};

// What a given unit measures. Used to decide whether an already-typed value is
// still meaningful when the unit changes (kg → g keeps it, kg → Pieces clears it).
const unitKindOf = (u) => {
  if (!u) return '';
  const known = UNIT_OPTIONS.find(o => o.value === u);
  return known ? known.kind : 'custom';
};

const DIMENSION_UNITS = ['mm', 'cm', 'm', 'inch', 'ft'];
const WEIGHT_UNITS = ['g', 'kg', 'MT'];

// Variant attribute caps — the same ones the seller product validator enforces.
const MAX_ATTRS = 10;
const MAX_ATTR_VALUES = 25;
const MAX_TEXT_LEN = 60;
// Suggestions only — the user is free to type any attribute name.
const ATTR_SUGGESTIONS = ['Size', 'Color', 'Material', 'Capacity', 'Finish', 'Model'];

// Photos per variant. middlewares/upload.js accepts 30 variantImages in one
// request, so this allows 6 variants at the full 5 before multer refuses.
const MAX_VARIANT_IMAGES = 5;

// 2 to 8 digits: the GST master carries both HEADING-level (4-digit, the bulk
// of the notification) and genuine CHAPTER-level (2-digit) entries, so both
// are valid input. The lookup effect below resolves whichever level is typed.
const HSN_MIN = 2;
const HSN_MAX = 8;

// Pure utility: cartesian product of an array of arrays.
const cartesian = (arrays) => {
  if (!arrays.length) return [[]];
  const [first, ...rest] = arrays;
  const restCombos = cartesian(rest);
  return first.flatMap(v => restCombos.map(r => [v, ...r]));
};

// Auto-generate a SKU from product name + variant combination values.
const autoSku = (productName, combo) => {
  const prefix = (productName || 'PRD').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4) || 'PRD';
  const suffix = combo.map(v => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5)).join('-');
  return `${prefix}-${suffix}`;
};

// Custom dropdown replacing native <select> across this form — same inputClass
// sizing/border, themed open menu (red accent) instead of the browser default.
// A copy of the company form's, because that one is defined inside
// CompanyUploadProduct.jsx and is not exported (that file is read-only here).
const ThemedSelect = ({ id, value, options, onChange, placeholder, className = '' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const norm = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const currentLabel = norm.find((o) => o.value === value)?.label || placeholder || 'Select…';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${className} flex items-center justify-between gap-2 text-left transition-colors ${
          open ? 'border-[#EA2831] ring-2 ring-[#EA2831]/20' : ''
        } ${value ? 'text-stone-800' : 'text-stone-400'}`}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className={`size-4 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1.5 w-full min-w-[140px] rounded-xl border border-stone-200 bg-white py-1.5 shadow-lg shadow-stone-900/10 max-h-64 overflow-y-auto"
        >
          {norm.map((opt) => {
            const selected = opt.value === value;
            return (
              <li key={opt.value} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={`flex w-full items-center px-3.5 py-2 text-left text-sm font-medium transition-colors ${
                    selected ? 'text-[#EA2831] bg-[#EA2831]/5 font-bold' : 'text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

/**
 * SEARCHABLE dropdown — a select2-style picker for long option lists.
 *
 * Deliberately hand-rolled: this project has no jQuery and no select library,
 * and the bundle is already large enough that pulling one in for a single
 * optional field is not worth it. Styling matches ThemedSelect above exactly,
 * so it reads as the same control as Category / Storage Instructions.
 *
 * Keyboard: ↑/↓ move, Enter picks the highlighted row, Esc closes.
 * The × clears the selection (the field is optional, so "none" is valid).
 */
const SearchableSelect = ({ id, value, options, onChange, placeholder, className = '' }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Opening always starts from a clean search box with the current selection
  // highlighted. Done in the handler rather than an effect on `open` — that
  // would be a second render pass for state we already know here.
  const openMenu = () => {
    setQuery('');
    const i = options.findIndex((o) => o === value);
    setActive(i < 0 ? 0 : i);
    setOpen(true);
  };
  const toggle = () => (open ? setOpen(false) : openMenu());

  // Focus the search box once the menu is actually in the DOM, so typing
  // filters immediately without a click.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const pick = (opt) => { onChange(opt); setOpen(false); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!filtered.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      // Inside a <form>: without this, Enter submits the product.
      e.preventDefault();
      if (filtered[active]) pick(filtered[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <div
        className={`${className} flex items-center justify-between gap-2 text-left transition-colors ${
          open ? 'border-[#EA2831] ring-2 ring-[#EA2831]/20' : ''
        } ${value ? 'text-stone-800' : 'text-stone-400'}`}
      >
        <button
          type="button"
          id={id}
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex-1 min-w-0 text-left truncate outline-none"
        >
          {value || placeholder || 'Select…'}
        </button>
        {value && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => { onChange(''); setOpen(false); }}
            className="shrink-0 text-stone-400 hover:text-[#EA2831] transition-colors"
          >
            <X className="size-4" />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={toggle}
          className="shrink-0"
        >
          <ChevronDown className={`size-4 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="absolute z-30 mt-1.5 w-full rounded-xl border border-stone-200 bg-white shadow-lg shadow-stone-900/10">
          <div className="p-2 border-b border-stone-100">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              placeholder="Search…"
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/20 placeholder:text-stone-300 font-sora"
            />
          </div>
          <ul role="listbox" ref={listRef} className="py-1.5 max-h-60 overflow-y-auto">
            {filtered.length === 0 && (
              <li className="px-3.5 py-2 text-sm text-stone-400">No match</li>
            )}
            {filtered.map((opt, i) => {
              const selected = opt === value;
              return (
                <li key={opt} role="option" aria-selected={selected} data-active={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(opt)}
                    className={`flex w-full items-center px-3.5 py-2 text-left text-sm font-medium transition-colors ${
                      selected ? 'text-[#EA2831] bg-[#EA2831]/5 font-bold'
                        : i === active ? 'text-stone-800 bg-stone-50' : 'text-stone-600'
                    }`}
                  >
                    {opt}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

const BLANK = {
  product_name: '',
  category: '',
  categoryOther: '',
  brand_name: '',
  // Optional, seller-side only — the company form has no such field.
  horticulture_product: '',
  description: '',
  hsn: '',
  // Country of Origin is FIXED to India, exactly as on the company form: the
  // input is read-only there and here.
  origin: 'India',
  mrp: '',
  // '' means NOT YET RESOLVED — deliberately not '0'. A real HSN rate can
  // genuinely be 0% (exempt goods); using '0' as the "unresolved" sentinel
  // would accidentally equal that real rate and count the field as already
  // resolved before the user ever chose anything, silently skipping the
  // multi-rate picker. '' can never equal a real gstRate.
  gst: '',
  packaging: '',
  unit: '',
  unit_value: '',
  dim_length: '',
  dim_width: '',
  dim_height: '',
  dimension_unit: 'cm',
  gross_weight: '',
  weight_unit: 'kg',
  has_variants: 'no',
  shelf_life_days: '',
  storage_inst: '',
  usage_inst: '',
  handling_inst: '',
  isActive: true,
};

/**
 * MY PRODUCTS → upload / edit form. The seller counterpart of the company's
 * Upload Product page, with the same sections, styling and spacing.
 *
 * WHAT IS DELIBERATELY DIFFERENT FROM THE COMPANY FORM:
 *
 *  · "Supply & Logistics" (MOQ, monthly production capacity, bulk packaging) is
 *    GONE. A seller does not manufacture and does not supply themselves, so
 *    every field in that section would be meaningless here.
 *
 *  · "Company Name / Company Address" (the third-party manufacturer block) is
 *    GONE for the same reason — those were the uploading COMPANY's details.
 *
 *  · "Brand / Manufacturer" is NEW: a seller resells other people's brands, so
 *    whose brand this is matters here in a way it does not on the company form.
 *
 *  · HSN → GST works exactly as on the company form: the code is looked up in
 *    the GST master and the rate is READ-ONLY, never typed. It reads that
 *    master through the seller-namespaced mount (/api/seller/hsn) because
 *    middlewares/principalRouteGuard refuses a seller token on /api/hsn.
 *
 *  · The variant STOCK column is read-only at 0 — see the variants section.
 */
const SellerMyProductForm = ({ productId = null, onCancel, onSaved }) => {
  const isEdit = !!productId;
  const [formData, setFormData] = useState(BLANK);
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(isEdit);

  // Duplicate-name warning. Advisory ONLY — it never blocks a save.
  const [dupes, setDupes] = useState([]);

  /* ================= HORTICULTURE PAPERWORK ================= /
     Picking a Horticulture Product is a claim the seller has to back with a
     licence NUMBER and a CERTIFICATE in their profile. The real gate is the
     backend's (sellerMyProductController → HORTICULTURE_DOCS_REQUIRED); this
     state only renders what it says. `missing` comes STRAIGHT from that
     response — recomputing it here would just be a second opinion that can
     disagree with the one that actually blocked the save. */
  const [hortiMissing, setHortiMissing] = useState(null); // null = never refused

  const HORTI_LABEL = { number: 'Horticulture licence number', certificate: 'Horticulture certificate' };


  // Variant attributes. `draft` holds the value currently being typed for that
  // row (committed to `values` on Enter / comma / +); `id` keeps React keys
  // stable so removing a row never shuffles input state.
  const attrId = useRef(1);
  const makeAttr = () => ({ id: attrId.current++, name: '', values: [], draft: '' });
  const [attrs, setAttrs] = useState([]);
  // Each row: { label, attrMap, sku, mrp }
  const [variantRows, setVariantRows] = useState([]);

  /* PRODUCT GALLERY, in the same two halves the company edit form uses:
       keptImages  — server paths ("uploads/products/x.jpg") already on the
                     product and NOT removed. Sent back as `kept_images`, so
                     anything the user deletes simply is not in the list.
       newFiles    — File objects picked in this session, uploaded as
                     `productImages`. `newPreviews` holds their object URLs.
     The FILES are what was missing: previews alone are browser-local blobs, so
     nothing ever reached multer. */
  const [keptImages, setKeptImages] = useState([]);
  const [newFiles, setNewFiles] = useState([]);
  const [newPreviews, setNewPreviews] = useState([]);

  /* HSN → GST LOOKUP. `hsn` holds the outcome of the last resolved lookup,
     never a guess:
       null                     — nothing looked up yet
       { status:'single'   }    — one rate; auto-filled into the GST field
       { status:'multiple' }    — several rates; the user must pick one
       { status:'not_found' }   — not in the master; GST stays at 0
     `hsnLoading` only drives the little "Looking up…" line. */
  const [hsn, setHsn] = useState(null);
  const [hsnLoading, setHsnLoading] = useState(false);
  // Autocomplete: the list, whether it is showing, and whether the current code
  // came from the list (which just controls when the panel stays closed).
  const [hsnOptions, setHsnOptions] = useState([]);
  // 'idle' | 'loading' | 'ok' | 'empty' | 'error' — tracked so an empty result
  // and an unreachable master do not look identical (a silent empty list is
  // what makes "I forgot to restart the backend" undebuggable).
  const [hsnSearchState, setHsnSearchState] = useState('idle');
  const [hsnOpen, setHsnOpen] = useState(false);
  const [hsnPicked, setHsnPicked] = useState(false);
  const hsnBoxRef = useRef(null);

  const handleInputChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  /* ================= EDIT: HYDRATE ================= */
  useEffect(() => {
    if (!isEdit) return;
    let ignore = false;
    getMyProduct(productId)
      .then((r) => {
        if (ignore || !r?.success) return;
        const p = r.data || {};
        const rows = Array.isArray(p.variants) ? p.variants : [];
        setFormData({
          ...BLANK,
          product_name: p.productName || '',
          category: p.category || '',
          brand_name: p.brandName || '',
          horticulture_product: p.horticultureProduct || '',
          description: p.description || '',
          hsn: p.hsnCode || '',
          origin: p.countryOrigin || 'India',
          mrp: p.mrp ?? '',
          // '' (not '0') when a legacy product has no stored rate at all — see
          // the note on the initial BLANK.gst above. A genuinely saved 0% still
          // comes through as '0' here since p.gstPercentage is a real 0, not
          // missing.
          gst: p.gstPercentage != null ? String(p.gstPercentage) : '',
          packaging: p.packagingType || '',
          unit: p.unit || '',
          unit_value: p.unitValue ?? '',
          dim_length: p.length ?? '',
          dim_width: p.width ?? '',
          dim_height: p.height ?? '',
          dimension_unit: p.dimensionUnit || 'cm',
          gross_weight: p.weight ?? '',
          weight_unit: p.weightUnit || 'kg',
          has_variants: rows.length ? 'yes' : 'no',
          shelf_life_days: p.shelfLifeDays ?? '',
          storage_inst: p.storageInstructions || '',
          usage_inst: p.usageInstructions || '',
          handling_inst: p.safetyInstructions || '',
          isActive: p.productStatus !== 'inactive',
        });
        // Existing gallery images start out KEPT; removing one drops it here
        // and it is then absent from kept_images, which is what deletes it.
        setKeptImages(Array.isArray(p.productImages) ? p.productImages.filter(Boolean) : []);
        // Rebuild the attribute builder from the saved variants, so editing a
        // multi-variant product opens on the same grid it was created with
        // rather than an empty one.
        if (rows.length) {
          const byName = new Map();
          for (const v of rows) {
            for (const [name, value] of Object.entries(v.attributes || {})) {
              if (!byName.has(name)) byName.set(name, []);
              const list = byName.get(name);
              if (!list.some(x => x.toLowerCase() === String(value).toLowerCase())) list.push(String(value));
            }
          }
          setAttrs([...byName.entries()].map(([name, values]) => ({ id: attrId.current++, name, values, draft: '' })));
          setVariantRows(rows.map(v => ({
            label: v.label,
            attrMap: v.attributes || {},
            sku: v.sku || '',
            mrp: v.mrp ?? '',
            // The photos already on the variant, re-sent on save so an edit
            // that adds one does not drop the rest. `images` is the new list;
            // a variant saved before multi-image has only the single `image`,
            // which is folded in here so it is never lost.
            keptImages: v.images?.length ? [...v.images] : (v.image ? [v.image] : []),
            // Files picked in this session, with their object URLs.
            newFiles: [],
            newPreviews: [],
          })));
        }
      })
      .catch(() => {
        Swal.fire({ title: 'Could not load', text: 'This product could not be opened.', icon: 'error', confirmButtonColor: '#EA2831' });
      })
      .finally(() => { if (!ignore) setHydrating(false); });
    return () => { ignore = true; };
  }, [isEdit, productId]);

  /* ================= DUPLICATE NAME WARNING =================
     Debounced ~500ms so typing a name fires ONE request, not one per keystroke.
     `ignore` guards the classic out-of-order race — a slow reply for an old name
     must never overwrite a fast reply for the current one.

     PURELY ADVISORY: it never disables the save button and never blocks submit.
     Two products may legitimately share a name (different pack sizes, different
     batches); the seller is simply told so they can decide. */
  useEffect(() => {
    const name = formData.product_name.trim();
    if (name.length < 3) { setDupes([]); return undefined; }

    let ignore = false;
    const timer = setTimeout(() => {
      checkDuplicateName(name)
        .then((r) => {
          if (ignore) return;
          // On edit, the product being edited is not a duplicate of itself.
          setDupes((r?.data || []).filter(d => String(d._id) !== String(productId)));
        })
        .catch(() => { if (!ignore) setDupes([]); });
    }, 500);

    return () => { ignore = true; clearTimeout(timer); };
  }, [formData.product_name, productId]);

  /* ================= VARIANTS ================= */

  // Answering "Yes" seeds one empty attribute row; "No" clears the list so no
  // stale attributes can be submitted.
  const setHasVariants = (answer) => {
    setFormData(prev => ({ ...prev, has_variants: answer }));
    setAttrs(prev => {
      if (answer === 'no') return [];
      return prev.length ? prev : [makeAttr()];
    });
  };

  const patchAttr = (id, patch) => setAttrs(prev => prev.map(a => (a.id === id ? { ...a, ...patch } : a)));
  const addAttr = () => setAttrs(prev => (prev.length >= MAX_ATTRS ? prev : [...prev, makeAttr()]));
  const removeAttr = (id) => setAttrs(prev => (prev.length === 1 ? [makeAttr()] : prev.filter(a => a.id !== id)));

  // Commit the row's draft text as a value chip (ignoring blanks and repeats).
  const commitValue = (id) => {
    setAttrs(prev => prev.map(a => {
      if (a.id !== id) return a;
      const v = a.draft.trim().slice(0, MAX_TEXT_LEN);
      if (!v) return { ...a, draft: '' };
      if (a.values.length >= MAX_ATTR_VALUES) return a;
      if (a.values.some(x => x.toLowerCase() === v.toLowerCase())) return { ...a, draft: '' };
      return { ...a, values: [...a.values, v], draft: '' };
    }));
  };

  const removeValue = (id, value) =>
    setAttrs(prev => prev.map(a => (a.id === id ? { ...a, values: a.values.filter(v => v !== value) } : a)));

  const patchVariantRow = (label, patch) =>
    setVariantRows(prev => prev.map(r => (r.label === label ? { ...r, ...patch } : r)));

  const applyBaseMrpToAll = () =>
    setVariantRows(prev => prev.map(r => ({ ...r, mrp: formData.mrp })));

  // Recompute the combinations table whenever variant attributes or the toggle
  // changes. Existing row edits are preserved for unchanged combinations.
  useEffect(() => {
    if (formData.has_variants !== 'yes') { setVariantRows([]); return; }
    const filled = attrs.filter(a => a.name.trim() && a.values.length > 0);
    if (!filled.length) { setVariantRows([]); return; }
    const combos = cartesian(filled.map(a => a.values));
    setVariantRows(prev =>
      combos.map(combo => {
        const label = combo.join(' / ');
        const attrMap = Object.fromEntries(filled.map((a, i) => [a.name, combo[i]]));
        const existing = prev.find(r => r.label === label);
        return {
          label,
          attrMap,
          sku: existing?.sku ?? autoSku(formData.product_name, combo),
          mrp: existing?.mrp ?? formData.mrp ?? '',
          keptImages: existing?.keptImages ?? [],
          newFiles: existing?.newFiles ?? [],
          newPreviews: existing?.newPreviews ?? [],
        };
      })
    );
  }, [attrs, formData.has_variants]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ================= IMAGES (preview only — see the note in the markup) ===== */
  // The cap counts kept + new together — multer accepts 5 productImages, and
  // an edit that keeps 4 may only add 1.
  const totalImages = keptImages.length + newFiles.length;

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    // Reset the input so picking the SAME file again still fires onChange.
    e.target.value = '';
    if (!files.length) return;
    if (files.length + totalImages > 5) {
      return Swal.fire({
        title: 'Limit Exceeded',
        text: 'You can only upload up to 5 images',
        icon: 'warning',
        confirmButtonColor: '#EA2831',
      });
    }
    setNewFiles(prev => [...prev, ...files]);
    setNewPreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))]);
  };

  const removeKeptImage = (index) =>
    setKeptImages(prev => prev.filter((_, i) => i !== index));

  const removeNewImage = (index) => {
    setNewPreviews(prev => {
      const url = prev[index];
      if (url) URL.revokeObjectURL(url);
      return prev.filter((_, i) => i !== index);
    });
    setNewFiles(prev => prev.filter((_, i) => i !== index));
  };

  /* ── PER-VARIANT PHOTO ──────────────────────────────────────────────────
     What turns a variant chip into a photo swatch on the storefront: a variant
     WITH an image renders as a thumbnail, one without renders as a text chip. */
  const variantImageCount = (r) => r.keptImages.length + r.newFiles.length;

  const addVariantImages = (label, files) => {
    const picked = Array.from(files || []);
    if (!picked.length) return;
    setVariantRows(prev => prev.map(r => {
      if (r.label !== label) return r;
      const room = MAX_VARIANT_IMAGES - variantImageCount(r);
      if (room <= 0) return r;
      const take = picked.slice(0, room);
      return {
        ...r,
        newFiles: [...r.newFiles, ...take],
        newPreviews: [...r.newPreviews, ...take.map(f => URL.createObjectURL(f))],
      };
    }));
    if (picked.length > MAX_VARIANT_IMAGES) {
      Swal.fire({
        title: 'Limit Exceeded',
        text: `Up to ${MAX_VARIANT_IMAGES} images per variant.`,
        icon: 'warning',
        confirmButtonColor: '#EA2831',
      });
    }
  };

  // A SAVED photo: dropping it from keptImages is what deletes it, because
  // the server rebuilds the variant's list from exactly what is re-sent.
  const removeVariantKeptImage = (label, index) =>
    setVariantRows(prev => prev.map(r => (
      r.label === label ? { ...r, keptImages: r.keptImages.filter((_, i) => i !== index) } : r
    )));

  // One picked in this session — revoke its object URL as it goes.
  const removeVariantNewImage = (label, index) =>
    setVariantRows(prev => prev.map(r => {
      if (r.label !== label) return r;
      const url = r.newPreviews[index];
      if (url) URL.revokeObjectURL(url);
      return {
        ...r,
        newFiles: r.newFiles.filter((_, i) => i !== index),
        newPreviews: r.newPreviews.filter((_, i) => i !== index),
      };
    }));

  // Release every object URL when the form CLOSES, so previews don't leak.
  // The lists are read through a ref: depending on them directly would run the
  // cleanup on every add/remove and revoke URLs that are still on screen.
  const previewsRef = useRef({ product: newPreviews, variants: variantRows });
  previewsRef.current = { product: newPreviews, variants: variantRows };
  useEffect(() => () => {
    previewsRef.current.product.forEach(URL.revokeObjectURL);
    previewsRef.current.variants.forEach((r) => (r.newPreviews || []).forEach(URL.revokeObjectURL));
  }, []);

  /* ================= UNIT OF MEASUREMENT (DYNAMIC) ================= */
  const knownUnit = UNIT_OPTIONS.find(o => o.value === formData.unit) || null;
  const unitMeta = formData.unit
    ? (knownUnit || { short: formData.unit, kind: 'custom', step: 'any' })
    : null;
  const unitValueLabel = unitMeta ? UNIT_VALUE_LABEL[unitMeta.kind] : '';

  /* HSN accepts DIGITS ONLY, 2 to 8 of them. Filtering on the way in means a
     pasted "3102-1000" becomes "31021000" rather than being rejected after the
     fact. Any previous result belongs to the previous code, so it is dropped
     immediately — and the GST goes with it, because that field is filled ONLY
     from a resolved lookup and must never be left over from another code. */
  const handleHsnChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, HSN_MAX);
    setFormData(prev => ({ ...prev, hsn: digits, gst: '' }));
    setHsn(null);
    setHsnPicked(false);
    setHsnOpen(true);
  };

  /** Choosing a code from the dropdown. The rate still comes from the lookup
      effect below — this only sets the code and closes the list, so there is
      exactly one place that decides GST. */
  const pickHsn = (code) => {
    // Reset GST only when the code is actually CHANGING. The reset itself
    // exists so a leftover rate from a previous code (edit mode, or an
    // earlier pick) can't accidentally match one of the new code's several
    // rates and silently skip the picker. But the GST lookup effect below is
    // keyed on formData.hsn — if the clicked suggestion is the SAME code
    // already in the field (e.g. typed "07", then clicked "07" in the list),
    // that value never changes, so the effect never re-fires and a reset here
    // would wipe the already-resolved GST% with nothing to bring it back.
    const changed = code !== formData.hsn;
    setFormData(prev => ({ ...prev, hsn: code, gst: changed ? '' : prev.gst }));
    if (changed) setHsn(null);
    setHsnPicked(true);
    setHsnOpen(false);
  };

  /* AUTOCOMPLETE. Codes starting with what has been typed, from 2 digits up.
     400ms debounce, and `ignore` guards the classic out-of-order race — a slow
     reply for an old query must never overwrite a fast reply for the current
     one. The list is a NAVIGATION aid only; no rate is read from it. */
  useEffect(() => {
    const q = formData.hsn;
    if (q.length < 2) { setHsnOptions([]); setHsnSearchState('idle'); return undefined; }

    let ignore = false;
    const timer = setTimeout(() => {
      setHsnSearchState('loading');
      searchHsn(q, 20)
        .then((r) => {
          if (ignore) return;
          const list = r?.results || [];
          setHsnOptions(list);
          setHsnSearchState(list.length ? 'ok' : 'empty');
        })
        .catch(() => {
          if (ignore) return;
          setHsnOptions([]);
          setHsnSearchState('error');
        });
    }, 400);

    return () => { ignore = true; clearTimeout(timer); };
  }, [formData.hsn]);

  // Close the dropdown on an outside click, the way a native select behaves.
  useEffect(() => {
    if (!hsnOpen) return undefined;
    const onDown = (e) => {
      if (hsnBoxRef.current && !hsnBoxRef.current.contains(e.target)) setHsnOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [hsnOpen]);

  /* HSN → GST. Runs once the code reaches a valid 2-8 digits, debounced so
     typing 31021000 fires ONE request, not five.

     THE RATE ALWAYS COMES FROM THE DATABASE. There is no rate table in this
     file; the server resolves the code against the GST master and this only
     renders what it is told. ONE rate is filled in; SEVERAL fill nothing and
     the user picks, because guessing here has real tax consequences. */
  useEffect(() => {
    const code = formData.hsn;
    if (!(code.length >= HSN_MIN && code.length <= HSN_MAX)) { setHsn(null); return undefined; }

    let ignore = false;
    const timer = setTimeout(() => {
      setHsnLoading(true);
      getGstByHsn(code)
        .then((result) => {
          if (ignore) return;
          setHsn(result);
          if (result.status === 'single') {
            setFormData(prev => ({ ...prev, gst: String(result.gstRate) }));
          }
        })
        .catch((err) => {
          if (ignore) return;
          // A 404 is a NORMAL outcome (code genuinely absent), not a failure —
          // the server's own payload explains it, so it is shown as-is.
          setHsn(err.response?.data || { status: 'error', message: 'Could not reach the GST rate master.' });
        })
        .finally(() => { if (!ignore) setHsnLoading(false); });
    }, 400);

    return () => { ignore = true; clearTimeout(timer); };
  }, [formData.hsn]);

  /* Has the current code been RESOLVED against the master? 'multiple' counts as
     resolved only once a rate has actually been picked. */
  const hsnResolved =
    hsn?.status === 'single' ||
    (hsn?.status === 'multiple' && hsn.rates?.some(r => String(r.gstRate) === String(formData.gst)));

  const handleToggle = () => setFormData(prev => ({ ...prev, isActive: !prev.isActive }));

  /* ================= VALIDATION ================= */
  const validate = () => {
    if (!formData.product_name.trim()) return 'Please enter the Product Name.';
    if (!formData.category.trim()) return 'Please select the Category.';
    if (formData.category === 'other' && !formData.categoryOther.trim()) return 'Please enter the category name.';

    if (!formData.packaging.trim()) return 'Please select the Packaging Type.';
    if (!formData.unit.trim()) return 'Please select the Unit of Measurement.';
    if (formData.unit && !(Number(formData.unit_value) > 0)) {
      return `Please enter the ${unitValueLabel} for the selected Unit of Measurement.`;
    }
    const dims = [formData.dim_length, formData.dim_width, formData.dim_height];
    if (dims.some(v => String(v).trim() === '')) return 'Please enter all three Product Dimensions (length, width and height).';
    if (dims.some(v => !(Number(v) > 0))) return 'Product Dimensions must be numbers greater than zero.';
    if (String(formData.gross_weight).trim() === '') return 'Please enter the Shipping Weight (Gross).';
    if (!(Number(formData.gross_weight) > 0)) return 'Shipping Weight must be greater than zero.';

    if (!new RegExp(`^\\d{${HSN_MIN},${HSN_MAX}}$`).test(formData.hsn)) {
      return `HSN Code must be ${HSN_MIN} to ${HSN_MAX} digits (numbers only).`;
    }
    if (!(Number(formData.mrp) > 0)) return 'Please enter the MRP (a number greater than zero).';

    /* SHELF LIFE IS REQUIRED, in whole days.
       Add Stock derives every lot's expiry date from it. Without one, lots are
       saved with no expiry, and then the Stock tab's Expiring/Expired filters
       and FEFO picking are both blind — for agricultural inputs that is not a
       state worth allowing a product to be created in. */
    const days = Number(formData.shelf_life_days);
    if (String(formData.shelf_life_days).trim() === '' || !(Number.isFinite(days) && days > 0)) {
      return 'Please enter the Shelf Life in days (a number greater than zero).';
    }
    if (!Number.isInteger(days)) return 'Shelf Life must be a whole number of days.';

    if (formData.has_variants === 'yes') {
      const filled = attrs.filter(a => a.name.trim() && a.values.length > 0);
      if (!filled.length) return 'Add at least one variant attribute with a name and one value, or answer "No".';
      const names = filled.map(a => a.name.trim().toLowerCase());
      if (new Set(names).size !== names.length) return 'Each variant attribute name must be unique.';
    }
    return null;
  };

  /* ================= SUBMIT ================= */
  // Clearing the dropdown removes the reason the save was refused, so the
  // banner goes with it rather than sitting there contradicting the form.
  useEffect(() => {
    if (!formData.horticulture_product) setHortiMissing(null);
  }, [formData.horticulture_product]);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const problem = validate();
    if (problem) {
      return Swal.fire({ title: 'Check the form', text: problem, icon: 'warning', confirmButtonColor: '#EA2831' });
    }

    setLoading(true);
    // Numeric fields go as numbers or are OMITTED — the API's validator turns ""
    // into "leave this field alone", which is what keeps a blank optional field
    // from wiping a saved value on edit.
    const num = (v) => (String(v ?? '').trim() === '' ? undefined : Number(v));
    const fields = {
      productName: formData.product_name.trim(),
      category: formData.category === 'other' ? formData.categoryOther.trim() : formData.category,
      brandName: formData.brand_name.trim(),
      // Optional: sent even when blank so clearing it with the × actually
      // clears the saved value on edit.
      horticultureProduct: formData.horticulture_product,
      description: formData.description.trim(),
      packagingType: formData.packaging,
      unit: formData.unit,
      unitValue: num(formData.unit_value),
      length: num(formData.dim_length),
      width: num(formData.dim_width),
      height: num(formData.dim_height),
      dimensionUnit: formData.dimension_unit,
      weight: num(formData.gross_weight),
      weightUnit: formData.weight_unit,
      countryOrigin: formData.origin,
      hsnCode: formData.hsn,
      mrp: num(formData.mrp),
      gstPercentage: num(formData.gst) ?? 0,
      shelfLifeDays: num(formData.shelf_life_days),
      storageInstructions: formData.storage_inst,
      usageInstructions: formData.usage_inst,
      safetyInstructions: formData.handling_inst,
      productStatus: formData.isActive ? 'active' : 'inactive',
    };

    /* ── MULTIPART, because images are files ──────────────────────────────
       The field names are fixed by middlewares/upload.js and must match it
       EXACTLY, or multer never picks the files up:
         "productImages"  — the gallery (max 5)
         "variantImages"  — one entry per variant photo (max 10)
       Each variant records its POSITION in that ordered file list as
       `imageIndex`; the server maps index → saved path and drops the index.
       The same contract the company upload form uses. */
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      data.append(key, value);
    }

    // The gallery images the user KEPT (edit only), one entry each so the
    // server reads them as a list. Anything removed is simply absent.
    keptImages.forEach((path) => data.append('kept_images', path));
    newFiles.forEach((file) => data.append('productImages', file));

    // NO `stock` per row — the API rejects it and the Stock tab is the only
    // way quantity enters the system.
    if (formData.has_variants === 'yes') {
      /* Every variant's files go into ONE ordered "variantImages" list, so each
         variant records WHICH positions in that list are its own. The counter
         advances once per appended file and the append loop below walks the rows
         in the same order, which is what keeps red's photos on red. */
      let fileIdx = 0;
      const variantPayload = variantRows.map((r) => ({
        label: r.label,
        attributes: r.attrMap,
        sku: r.sku,
        mrp: num(r.mrp),
        // The photos already saved on this variant, re-sent so they survive.
        images: r.keptImages,
        // Positions of this variant's NEW files in the combined upload list.
        imageIndexes: r.newFiles.map(() => fileIdx++),
      }));
      data.append('variants', JSON.stringify(variantPayload));
      // SAME ROW ORDER as the index assignment above.
      variantRows.forEach((r) => r.newFiles.forEach((f) => data.append('variantImages', f)));
    } else {
      data.append('variants', JSON.stringify([]));
    }

    try {
      const res = isEdit ? await updateMyProduct(productId, data) : await createMyProduct(data);
      const code = res?.data?.product_code;
      await Swal.fire({
        title: isEdit ? 'Saved' : 'Product added',
        text: !isEdit && code
          ? `Your product has been added. Product Code: ${code}`
          : 'Your changes have been saved.',
        icon: 'success',
        confirmButtonColor: '#EA2831',
        showClass: { popup: 'animate__animated animate__fadeInDown' },
      });
      onSaved?.();
    } catch (error) {
      const body = error.response?.data;
      // Missing horticulture paperwork is not a generic failure: it is fixable,
      // and the fix is somewhere else. Render the banner (which keeps every
      // field intact) instead of an error popup that says nothing actionable.
      if (body?.code === 'HORTICULTURE_DOCS_REQUIRED') {
        const missing = Array.isArray(body.missing) && body.missing.length
          ? body.missing
          : ['number', 'certificate'];
        setHortiMissing(missing);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      Swal.fire({
        title: isEdit ? 'Could not save' : 'Could not add product',
        text: body?.message || 'Please try again.',
        icon: 'error',
        confirmButtonColor: '#EA2831',
      });
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full border border-stone-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#EA2831]/20 focus:border-[#EA2831] outline-none transition-all placeholder:text-stone-300 bg-white font-sora";
  const labelClass = "block text-sm font-semibold text-stone-700 mb-1.5";
  const hintClass = "text-xs text-stone-400 mt-1";

  if (hydrating) {
    return <div className="py-16 text-center text-sm text-stone-400 font-sora">Loading…</div>;
  }

  return (
    <div className="text-left">
      <div className="flex items-center justify-between gap-4 mb-4">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-stone-500 hover:text-stone-800 transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Back to My Products
        </button>
      </div>

      {/* Refused by the backend for missing horticulture paperwork. Sits ABOVE
          the form and leaves every field exactly as typed — the seller opens
          the profile in a NEW TAB, uploads, comes back and presses Save again
          without re-entering anything. */}
      {hortiMissing && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 animate__animated animate__fadeIn">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-amber-500">lock</span>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-amber-800">Horticulture documents required</h3>
              <p className="text-sm text-amber-700 mt-1">
                Ye product upload karne ke liye pehle profile me jaakar Horticulture licence number aur certificate upload karein.
              </p>
              <ul className="mt-3 space-y-1">
                {hortiMissing.map((k) => (
                  <li key={k} className="flex items-center gap-2 text-sm text-amber-800">
                    <span className="material-symbols-outlined text-base text-amber-600">close</span>
                    <span className="font-medium">{HORTI_LABEL[k] || k}</span>
                    <span className="text-xs text-amber-600">— missing</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <a
                  href="/seller/profile"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg bg-[#EA2831] text-white hover:bg-[#d11f28] transition-colors"
                >
                  <span className="material-symbols-outlined text-base">badge</span> Go to profile
                </a>
                <span className="text-xs text-amber-600">
                  Opens in a new tab — nothing you have filled in here is lost.
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setHortiMissing(null)}
              aria-label="Dismiss"
              className="shrink-0 text-amber-500 hover:text-amber-700 transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-10 bg-white p-6 sm:p-10 border border-stone-200 rounded-2xl shadow-sm mb-12 animate__animated animate__fadeIn">

        {/* Section 1: Basic Information */}
        <section>
          <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase tracking-wide">Basic Product Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-1">
              <label className={labelClass}>Product Name <span className="text-[#EA2831]">*</span></label>
              <input id="product_name" className={inputClass} value={formData.product_name} onChange={handleInputChange} placeholder="Enter full product name" required />
              {/* ADVISORY ONLY — never blocks the save. Two products may
                  legitimately share a name; this just makes an accidental
                  re-upload visible before it happens. */}
              {dupes.length > 0 && (
                <p className="mt-1.5 text-xs font-medium text-blue-600">
                  Similar product exists — {dupes.map(d => d.productName).join(', ')}
                </p>
              )}
            </div>
            <div>
              <label className={labelClass}>Category <span className="text-[#EA2831]">*</span></label>
              <ThemedSelect
                id="category"
                className={inputClass}
                value={formData.category}
                placeholder="Select Category"
                onChange={(v) => setFormData(prev => ({ ...prev, category: v }))}
                options={[
                  { value: 'fertilizers', label: 'Fertilizers' },
                  { value: 'pesticides', label: 'Pesticides' },
                  { value: 'seeds', label: 'Seeds' },
                  { value: 'tools', label: 'Equipment & Tools' },
                  { value: 'growth_promoters', label: 'Growth Promoters' },
                  { value: 'other', label: 'Other…' },
                ]}
              />
              {formData.category === 'other' && (
                <input
                  id="categoryOther"
                  className={`${inputClass} mt-2`}
                  value={formData.categoryOther}
                  onChange={handleInputChange}
                  placeholder="Enter category name"
                  required
                />
              )}
            </div>
            {/* NEW vs the company form: a seller resells other people's brands,
                so whose brand this is matters here. */}
            <div>
              <label className={labelClass}>Brand / Manufacturer</label>
              <input id="brand_name" className={inputClass} value={formData.brand_name} onChange={handleInputChange} placeholder="e.g., IFFCO" />
            </div>
            {/* Optional. Long catalogue, so this one is searchable rather than a
                plain ThemedSelect; the list lives in lib/horticultureProducts.js. */}
            <div>
              <label className={labelClass}>Product</label>
              <SearchableSelect
                id="horticulture_product"
                className={inputClass}
                value={formData.horticulture_product}
                placeholder="Select Horticulture Product"
                options={HORTICULTURE_PRODUCTS}
                onChange={(v) => setFormData(prev => ({ ...prev, horticulture_product: v }))}
              />
              {/* Soft, up-front heads-up — deliberately NOT an error colour and
                  deliberately NOT a check of its own. The seller learns the
                  requirement while picking rather than after filling the whole
                  form; whether they actually HAVE the paperwork is decided by
                  the backend on save. */}
              {formData.horticulture_product && (
                <p className={`${hintClass} text-stone-500`}>
                  Needs a Horticulture licence number and certificate in your profile.
                </p>
              )}
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Product Description</label>
              <textarea id="description" className={inputClass} value={formData.description} onChange={handleInputChange} placeholder="Provide features and benefits..." rows="3"></textarea>
            </div>
          </div>

          {/* Image Upload Area */}
          <div className="mt-8">
            <label className="block text-sm font-semibold text-stone-700 mb-3">Product Images (Upload up to 5)</label>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="md:col-span-2 border-2 border-dashed border-stone-200 rounded-xl p-8 flex flex-col items-center justify-center bg-stone-50 hover:bg-stone-100 cursor-pointer min-h-[160px] relative transition-colors group">
                <input type="file" accept="image/*" multiple onChange={handleImageChange} className="absolute inset-0 opacity-0 cursor-pointer z-20" />
                <span className="material-symbols-outlined text-stone-400 text-4xl group-hover:text-[#EA2831] transition-colors mb-2">cloud_upload</span>
                <p className="text-sm font-medium text-stone-900">Drag &amp; drop or <span className="text-[#EA2831] underline">browse</span></p>
                <p className="text-[10px] text-stone-500 uppercase mt-1 font-bold">JPEG, PNG (MAX 5MB)</p>
              </div>
              {/* Already saved on the product. Removing one drops it from
                  kept_images, which is what deletes it server-side. */}
              {keptImages.map((path, index) => (
                <div key={path} className="aspect-square rounded-xl border border-stone-200 overflow-hidden relative shadow-sm">
                  <img src={getProductImage(path)} className="w-full h-full object-cover" alt="product" onError={(e) => { e.target.style.display = 'none'; }} />
                  <button type="button" onClick={() => removeKeptImage(index)} className="absolute top-1.5 right-1.5 bg-[#EA2831] text-white rounded-full p-1 shadow-md hover:bg-black transition-all">
                    <span className="material-symbols-outlined text-xs block font-bold">close</span>
                  </button>
                </div>
              ))}
              {/* Picked in this session — uploaded on save. */}
              {newPreviews.map((src, index) => (
                <div key={src} className="aspect-square rounded-xl border border-stone-200 overflow-hidden relative shadow-sm animate__animated animate__zoomIn">
                  <img src={src} className="w-full h-full object-cover" alt="preview" />
                  <button type="button" onClick={() => removeNewImage(index)} className="absolute top-1.5 right-1.5 bg-[#EA2831] text-white rounded-full p-1 shadow-md hover:bg-black transition-all">
                    <span className="material-symbols-outlined text-xs block font-bold">close</span>
                  </button>
                </div>
              ))}
              {[...Array(Math.max(0, 3 - totalImages))].map((_, i) => (
                <div key={`empty-${i}`} className="aspect-square bg-stone-50 rounded-xl border border-stone-200 border-dashed flex items-center justify-center text-stone-300">
                  <span className="material-symbols-outlined text-3xl">add</span>
                </div>
              ))}
            </div>
            <p className={`${hintClass} mt-2`}>
              The first image is the one customers see on the product card.
            </p>
          </div>

          {/* ===== Packaging & Measurement (sits directly below Product Images) =====
              Order is deliberate: Packaging Type → Unit of Measurement → the
              value field for that unit → Product Dimensions. */}
          <div className="mt-8 pt-8 border-t border-stone-100">
            <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase">Product Packaging Description &amp; Measurement</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className={labelClass}>Packaging Type <span className="text-[#EA2831]">*</span></label>
                <SelectWithOther
                  id="packaging" className={inputClass} value={formData.packaging}
                  onChange={(v) => setFormData(prev => ({ ...prev, packaging: v }))}
                  placeholder="Select Packaging" otherPlaceholder="Enter packaging type"
                  options={['HDPE Bag', 'Jute Bag', 'Bottle', 'Drum', 'Carton Box', 'Pouch', 'Sachet', 'Tin/Can', 'Bulk Container']}
                />
              </div>

              <div>
                <label className={labelClass}>Unit of Measurement <span className="text-[#EA2831]">*</span></label>
                <SelectWithOther
                  id="unit" className={inputClass} value={formData.unit}
                  onChange={(v) => setFormData(prev => (
                    unitKindOf(prev.unit) === unitKindOf(v)
                      ? { ...prev, unit: v }
                      : { ...prev, unit: v, unit_value: '' }
                  ))}
                  placeholder="Select Unit" otherPlaceholder="Enter unit of measurement"
                  options={UNIT_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                />
              </div>

              {/* Dynamic value field — appears only once a unit is chosen, and
                  re-labels itself based on what that unit measures. */}
              {unitMeta && (
                <div className="animate__animated animate__fadeIn">
                  <label className={labelClass}>
                    {unitValueLabel} <span className="text-[#EA2831]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="unit_value"
                      type="number"
                      min="0"
                      step={unitMeta.step}
                      className={`${inputClass} pr-16`}
                      value={formData.unit_value}
                      onChange={handleInputChange}
                      placeholder={unitMeta.kind === 'count' ? 'e.g., 10' : 'e.g., 50'}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-stone-400 pointer-events-none max-w-[52px] truncate">
                      {unitMeta.short}
                    </span>
                  </div>
                  <p className={hintClass}>
                    {formData.unit_value
                      ? `Sells as: ${formData.unit_value} ${unitMeta.short}${formData.packaging ? ` · ${formData.packaging}` : ''}`
                      : `Value in ${formData.unit}.`}
                  </p>
                </div>
              )}

              <div className="md:col-span-2">
                <label className={labelClass}>Product Dimensions <span className="text-[#EA2831]">*</span></label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <input id="dim_length" type="number" min="0" step="0.01" className={inputClass} value={formData.dim_length} onChange={handleInputChange} placeholder="Length" />
                  <input id="dim_width" type="number" min="0" step="0.01" className={inputClass} value={formData.dim_width} onChange={handleInputChange} placeholder="Width" />
                  <input id="dim_height" type="number" min="0" step="0.01" className={inputClass} value={formData.dim_height} onChange={handleInputChange} placeholder="Height" />
                  <ThemedSelect
                    id="dimension_unit"
                    className={inputClass}
                    value={formData.dimension_unit}
                    onChange={(v) => setFormData(prev => ({ ...prev, dimension_unit: v }))}
                    options={DIMENSION_UNITS}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Shipping Weight (Gross) <span className="text-[#EA2831]">*</span></label>
                <div className="flex gap-2">
                  <input id="gross_weight" type="number" min="0" step="0.01" className={inputClass} value={formData.gross_weight} onChange={handleInputChange} placeholder="e.g., 51" />
                  <ThemedSelect
                    id="weight_unit"
                    className={`${inputClass} max-w-[100px]`}
                    value={formData.weight_unit}
                    onChange={(v) => setFormData(prev => ({ ...prev, weight_unit: v }))}
                    options={WEIGHT_UNITS}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Identification */}
        <section>
          <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase">Identification &amp; Traceability</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* COUNTRY OF ORIGIN. Fixed to India and not user-editable, so the
                dropdown is a read-only input carrying the SAME styling — exactly
                as on the company form. */}
            <div>
              <label className={labelClass}>Country of Origin <span className="text-[#EA2831]">*</span></label>
              <input
                id="origin"
                className={`${inputClass} bg-stone-50 text-stone-500 cursor-not-allowed`}
                value={formData.origin}
                readOnly
                aria-readonly="true"
                title="Country of Origin is fixed to India"
              />
            </div>

            {/* HSN CODE. 2 to 8 digits; the field itself accepts only digits so
                letters, spaces and punctuation can never be typed or pasted in.
                Entering a valid code looks the GST rate up in the master and
                reports the outcome directly beneath the field. */}
            <div>
              <label className={labelClass}>HSN Code <span className="text-[#EA2831]">*</span></label>
              {/* The input and its dropdown share a positioned wrapper so the
                  list hangs directly under the field. */}
              <div className="relative" ref={hsnBoxRef}>
                <input
                  id="hsn"
                  className={inputClass}
                  value={formData.hsn}
                  onChange={handleHsnChange}
                  onFocus={() => setHsnOpen(true)}
                  placeholder="Type digits to search, e.g. 3105"
                  inputMode="numeric"
                  maxLength={HSN_MAX}
                  autoComplete="off"
                  required
                />

                {/* The panel opens as soon as there is something to SAY —
                    results, "searching", "nothing matched" or a reachability
                    problem. Rendering only on a non-empty list is what makes a
                    broken endpoint look identical to an unfinished code.
                    `!hsnPicked` keeps it closed right after a selection. */}
                {hsnOpen && !hsnPicked && formData.hsn.length >= 2 && hsnSearchState !== 'idle' && (
                  <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 shadow-xl">
                    {hsnSearchState === 'loading' && (
                      <li className="px-3 py-2 text-[11px] text-stone-400">Searching the GST master…</li>
                    )}
                    {hsnSearchState === 'empty' && (
                      <li className="px-3 py-2 text-[11px] text-stone-500">
                        No HSN code starts with <b>{formData.hsn}</b> in the GST master.
                      </li>
                    )}
                    {hsnSearchState === 'error' && (
                      <li className="px-3 py-2 text-[11px] text-[#EA2831]">
                        Could not reach the GST master. Please try again in a moment.
                      </li>
                    )}
                    {hsnOptions.map(opt => (
                      <li key={opt.hsnCode}>
                        <button
                          type="button"
                          onClick={() => pickHsn(opt.hsnCode)}
                          className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-stone-50"
                        >
                          <span className="shrink-0 font-mono text-xs font-bold text-stone-800">{opt.hsnCode}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] text-stone-500">{opt.description}</span>
                          </span>
                          {/* A code with several rates is FLAGGED rather than
                              shown with one of them — the choice belongs to the
                              user, after they pick the code. */}
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            opt.multiple ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
                          }`}>
                            {opt.multiple
                              ? `${[...new Set(opt.rates.map(r => r.gstRate))].join('% / ')}%`
                              : `${opt.gstRate}%`}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {hsnLoading && <p className="text-xs text-stone-400 mt-1">Looking up the GST rate…</p>}

              {/* SEVERAL RATES — nothing is chosen automatically. Each option is
                  shown with the condition that makes it apply. */}
              {!hsnLoading && hsn?.status === 'multiple' && !hsnResolved && (
                <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-bold text-amber-800">
                    HSN {hsn.matchedHsn} has more than one GST rate — select the one that applies to your product.
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {hsn.rates.map((r, i) => (
                      <label
                        key={`${r.gstRate}-${i}`}
                        className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
                          String(formData.gst) === String(r.gstRate)
                            ? 'border-[#EA2831] bg-white'
                            : 'border-stone-200 bg-white/70 hover:border-stone-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="hsnGstChoice"
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[#EA2831]"
                          checked={String(formData.gst) === String(r.gstRate)}
                          onChange={() => setFormData(prev => ({ ...prev, gst: String(r.gstRate) }))}
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-bold text-stone-800">{r.gstRate}%</span>
                          <span className="block text-[11px] leading-snug text-stone-500">{r.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* NOT IN THE MASTER — say so plainly. No rate is inferred from a
                  chapter or a neighbouring code. */}
              {!hsnLoading && (hsn?.status === 'not_found' || hsn?.status === 'error') && (
                <p className="mt-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] text-stone-600">
                  {hsn.message || 'No GST rate found for this HSN code.'} Pick a code from the suggestions to set the GST rate.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Section 3: Pricing */}
        <section>
          <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase tracking-wide">Pricing &amp; Tax</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className={labelClass}>MRP (₹) <span className="text-[#EA2831]">*</span></label>
              <input id="mrp" type="number" min="0" step="0.01" className={inputClass} value={formData.mrp} onChange={handleInputChange} placeholder="0.00" required />
            </div>
            <div>
              <label className={labelClass}>GST (%)</label>
              {/* READ-ONLY. The rate is statutory — it belongs to the HSN code,
                  not to whoever is filling the form — so it is displayed, not
                  entered. It is set in exactly two places, both driven by the
                  database: the lookup effect (single rate) and the radio buttons
                  under the HSN field (multiple rates).

                  A DISABLED <input> IS NOT USED: a disabled control is skipped by
                  form serialisation and reads as unavailable to a screen reader,
                  and there is nothing here for the user to do — so this is a
                  plain read-only display of the resolved value. */}
              <div className={`${inputClass} flex items-center justify-between bg-stone-50 text-stone-700 cursor-not-allowed`}>
                <span className="font-semibold">
                  {formData.gst === '' ? '—' : formData.gst === '0' ? '0% (Exempt)' : `${formData.gst}%`}
                </span>
                <span className="material-symbols-outlined text-base text-stone-400" title="Set automatically from the HSN code">lock</span>
              </div>
              {/* The value still reaches anything that reads the DOM, and stays
                  in formData for the submit. */}
              <input type="hidden" id="gst" name="gst" value={formData.gst} readOnly />
              <p className={hintClass}>
                {hsn?.status === 'single'
                  ? `Set from the GST master for HSN ${hsn.matchedHsn}.`
                  : hsn?.status === 'multiple'
                    ? 'Select the applicable rate under the HSN Code field above.'
                    : 'Determined automatically by the HSN code.'}
              </p>
            </div>
          </div>
        </section>

        {/* Section 4: Product Variants */}
        <section>
          <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase tracking-wide">Product Variants</h3>
          <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-5">
            {/* Toggle */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <label className={labelClass}>Does this product have variants?</label>
                <p className="text-xs text-stone-400">
                  Choose Yes if the same product ships in different options (e.g. Size, Color, Capacity).
                </p>
              </div>
              <div className="flex rounded-lg border border-stone-200 bg-white p-1">
                {['no', 'yes'].map((answer) => (
                  <button
                    key={answer}
                    type="button"
                    onClick={() => setHasVariants(answer)}
                    aria-pressed={formData.has_variants === answer}
                    className={`px-6 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${
                      formData.has_variants === answer
                        ? 'bg-[#EA2831] text-white shadow-sm'
                        : 'text-stone-400 hover:text-stone-600'
                    }`}
                  >
                    {answer === 'yes' ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
            </div>

            {formData.has_variants === 'yes' && (
              <div className="mt-6 space-y-6 animate__animated animate__fadeIn">

                {/* Part A: Attribute builder */}
                <div>
                  <p className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-3">Variant Attributes</p>
                  <div className="space-y-3">
                    {attrs.map((attr, index) => (
                      <div key={attr.id} className="rounded-lg border border-stone-200 bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-[10px] font-black uppercase tracking-widest text-stone-300 mt-2.5">
                            #{index + 1}
                          </span>
                          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-stone-500 mb-1.5">Attribute Name</label>
                              <input
                                className={inputClass}
                                value={attr.name}
                                onChange={(e) => patchAttr(attr.id, { name: e.target.value })}
                                placeholder="e.g., Size"
                                list="my-product-attr-suggestions"
                                maxLength={MAX_TEXT_LEN}
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-stone-500 mb-1.5">Values</label>
                              <div className="flex gap-2">
                                <input
                                  className={inputClass}
                                  value={attr.draft}
                                  onChange={(e) => patchAttr(attr.id, { draft: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ',') {
                                      e.preventDefault();
                                      commitValue(attr.id);
                                    }
                                  }}
                                  placeholder="Type a value, press Enter"
                                  maxLength={MAX_TEXT_LEN}
                                />
                                <button
                                  type="button"
                                  onClick={() => commitValue(attr.id)}
                                  className="shrink-0 px-3 rounded-lg border border-stone-200 text-stone-500 hover:text-[#EA2831] hover:border-[#EA2831]/40 transition-all"
                                  aria-label="Add value"
                                >
                                  <span className="material-symbols-outlined text-base block">add</span>
                                </button>
                              </div>
                              {attr.values.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {attr.values.map((value) => (
                                    <span
                                      key={value}
                                      className="inline-flex items-center gap-1 bg-stone-100 border border-stone-200 rounded-full pl-3 pr-1.5 py-1 text-xs font-medium text-stone-700"
                                    >
                                      {value}
                                      <button
                                        type="button"
                                        onClick={() => removeValue(attr.id, value)}
                                        className="text-stone-400 hover:text-[#EA2831] transition-colors"
                                        aria-label={`Remove ${value}`}
                                      >
                                        <span className="material-symbols-outlined text-sm block">close</span>
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeAttr(attr.id)}
                            className="shrink-0 mt-7 p-2 rounded-lg border border-stone-200 text-stone-400 hover:text-[#EA2831] hover:border-[#EA2831]/40 transition-all"
                            aria-label="Remove attribute"
                          >
                            <span className="material-symbols-outlined text-base block">delete</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <datalist id="my-product-attr-suggestions">
                    {ATTR_SUGGESTIONS.map((name) => <option key={name} value={name} />)}
                  </datalist>

                  {attrs.length < MAX_ATTRS && (
                    <button
                      type="button"
                      onClick={addAttr}
                      className="mt-3 text-xs font-bold text-[#EA2831] hover:underline"
                    >
                      + Add another attribute
                    </button>
                  )}
                </div>

                {/* Part B: Generated combinations table */}
                {variantRows.length === 0 && (
                  <div className="rounded-lg border border-dashed border-stone-200 bg-white px-6 py-8 text-center">
                    <span className="material-symbols-outlined text-stone-300 text-4xl block mb-2">table_rows</span>
                    <p className="text-sm font-semibold text-stone-400">Variant table will appear here</p>
                    <p className="text-xs text-stone-300 mt-1">
                      Enter an attribute name (e.g. <b>Size</b>) and add at least one value (e.g. <b>500g</b>) — press <kbd className="bg-stone-100 border border-stone-200 rounded px-1 py-0.5 text-[10px]">Enter</kbd> to confirm each value.
                    </p>
                  </div>
                )}
                {variantRows.length > 0 && (
                  <div className="animate__animated animate__fadeIn">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                      <p className="text-xs font-bold text-stone-500 uppercase tracking-wider">
                        {variantRows.length} variant{variantRows.length !== 1 ? 's' : ''} generated
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={applyBaseMrpToAll}
                          className="text-xs font-semibold text-[#EA2831] border border-[#EA2831]/30 rounded-lg px-3 py-1.5 hover:bg-[#EA2831]/5 transition-all"
                        >
                          Apply base MRP to all
                        </button>
                        {/* NO "Set stock to 0" button — stock is not editable
                            here, so a button that zeroes it has nothing to do. */}
                      </div>
                    </div>

                    <div className="rounded-xl border border-stone-200 overflow-hidden">
                     <div className="overflow-x-auto">
                      <div className="min-w-[760px]">
                      {/* Table header.

                          NO STOCK COLUMN — unlike the company table, which keeps
                          its own. A seller's stock has exactly one door, the
                          Stock tab, which writes a real Inventory lot with a lot
                          number, dates and a ledger row. A quantity here would be
                          a second, parallel number that nothing reconciles. The
                          API agrees: it does not accept a variant `stock` at all,
                          so every variant stays at the schema default of 0. */}
                      <div className="grid grid-cols-[120px_140px_92px_minmax(320px,1fr)] bg-stone-100 border-b border-stone-200 px-4 py-2.5 gap-3">
                        <span className="text-[10px] font-black uppercase tracking-widest text-stone-400">Variant</span>
                        <span className="text-[10px] font-black uppercase tracking-widest text-stone-400">SKU</span>
                        <span className="text-[10px] font-black uppercase tracking-widest text-stone-400">MRP (₹)</span>
                        <span className="text-[10px] font-black uppercase tracking-widest text-stone-400">Photo</span>
                      </div>
                      {/* Table rows */}
                      {variantRows.map((row, i) => (
                        <div
                          key={row.label}
                          className={`grid grid-cols-[120px_140px_92px_minmax(320px,1fr)] gap-3 px-4 py-3 items-center ${
                            i % 2 === 0 ? 'bg-white' : 'bg-stone-50/50'
                          } ${i < variantRows.length - 1 ? 'border-b border-stone-100' : ''}`}
                        >
                          <span className="text-sm font-semibold text-stone-700 truncate" title={row.label}>
                            {row.label}
                          </span>
                          <input
                            className={inputClass}
                            value={row.sku}
                            onChange={e => patchVariantRow(row.label, { sku: e.target.value })}
                            placeholder="SKU"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className={inputClass}
                            value={row.mrp}
                            onChange={e => patchVariantRow(row.label, { mrp: e.target.value })}
                            placeholder="0.00"
                          />
                          {/* PER-VARIANT PHOTO — the whole difference the
                              customer sees: a variant WITH an image renders on
                              the storefront as a photo swatch instead of a text
                              chip. The FIRST photo is the swatch.
                          
                              FIVE EQUAL SLOTS, always. The tiles used to be a
                              fixed 48px in a flex row, so they huddled at the
                              left of a column far wider than they needed and left
                              a dead gap out to the table's edge. As grid tracks
                              they divide the column between them instead, so five
                              photos reach the right edge — and because the track
                              count never changes, a variant with two photos shows
                              them at exactly the same size as one with five,
                              rather than stretching to fill.
                          
                              THE HEIGHT IS STILL PINNED (64px, up from 48 so the
                              picture is actually recognisable). Only the WIDTH
                              flexes. That is what keeps the earlier layout bug
                              fixed: the row's height cannot change as photos are
                              added or removed, so nothing below it ever moves. */}
                          <div>
                            <div className="grid grid-cols-5 gap-2">
                              {Array.from({ length: MAX_VARIANT_IMAGES }).map((_, slot) => {
                                const keptCount = row.keptImages.length;
                                const total = variantImageCount(row);
                          
                                // Saved photos come first, then the ones picked in this
                                // session, then the add tile in the first free slot.
                                if (slot < keptCount) {
                                  const path = row.keptImages[slot];
                                  return (
                                    <div key={`k-${path}`} className="relative h-[64px] w-full">
                                      <img
                                        src={getProductImage(path)}
                                        alt={row.label}
                                        className="h-full w-full object-cover rounded-lg border border-stone-200"
                                        onError={(e) => { e.target.style.display = 'none'; }}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => removeVariantKeptImage(row.label, slot)}
                                        className="absolute top-1 right-1 bg-[#EA2831] text-white rounded-full w-4 h-4 flex items-center justify-center shadow hover:bg-black transition-colors"
                                        aria-label="Remove photo"
                                      >
                                        <span className="material-symbols-outlined text-[10px] leading-none">close</span>
                                      </button>
                                    </div>
                                  );
                                }
                          
                                if (slot < total) {
                                  const i = slot - keptCount;
                                  return (
                                    <div key={`n-${row.newPreviews[i]}`} className="relative h-[64px] w-full">
                                      <img src={row.newPreviews[i]} alt={row.label} className="h-full w-full object-cover rounded-lg border border-stone-200" />
                                      <button
                                        type="button"
                                        onClick={() => removeVariantNewImage(row.label, i)}
                                        className="absolute top-1 right-1 bg-[#EA2831] text-white rounded-full w-4 h-4 flex items-center justify-center shadow hover:bg-black transition-colors"
                                        aria-label="Remove photo"
                                      >
                                        <span className="material-symbols-outlined text-[10px] leading-none">close</span>
                                      </button>
                                    </div>
                                  );
                                }
                          
                                // At the cap there is no free slot, so all five are photos and
                                // the add tile correctly disappears.
                                if (slot === total) {
                                  return (
                                    <label
                                      key={`add-${slot}`}
                                      title={`Add photos (${total}/${MAX_VARIANT_IMAGES})`}
                                      className="relative h-[64px] w-full flex flex-col items-center justify-center border border-dashed border-stone-300 rounded-lg bg-stone-50 hover:bg-stone-100 hover:border-[#EA2831]/50 cursor-pointer transition-colors group"
                                    >
                                      {/* THE INPUT FILLS THE TILE instead of being `sr-only`.
                                          An sr-only input is a 1px absolutely-positioned box
                                          with no positioned ancestor, and it KEEPS FOCUS after
                                          the file dialog closes — the browser then scrolls to
                                          reveal it somewhere far from where it appears, which
                                          is what used to jump the page and leave a blank area
                                          below. Full-size and in place, revealing it moves
                                          nothing. */}
                                      <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                        onChange={e => { addVariantImages(row.label, e.target.files); e.target.value = ''; }}
                                      />
                                      <span className="material-symbols-outlined text-stone-300 group-hover:text-[#EA2831] text-xl transition-colors pointer-events-none">add_photo_alternate</span>
                                    </label>
                                  );
                                }
                          
                                // Slots past the add tile stay empty so the tracks — and so the
                                // tile size — stay the same whatever the photo count.
                                return <div key={`e-${slot}`} aria-hidden="true" />;
                              })}
                            </div>
                            {variantImageCount(row) > 0 && (
                              <p className="text-[10px] text-stone-400 mt-1 leading-none">
                                {variantImageCount(row)}/{MAX_VARIANT_IMAGES} photos
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                      </div>
                     </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Section 5: Compliance & Validity */}
        <section>
          <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase tracking-wide">Compliance &amp; Validity</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>Shelf Life (Days) <span className="text-[#EA2831]">*</span></label>
              <div className="relative">
                <input
                  id="shelf_life_days"
                  type="number"
                  min="1"
                  step="1"
                  className={`${inputClass} pr-16`}
                  value={formData.shelf_life_days}
                  onChange={handleInputChange}
                  placeholder="e.g., 730"
                  required
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-stone-400 pointer-events-none">
                  Days
                </span>
              </div>
              <p className={hintClass}>
                Shelf Life Duration (Days) from Date of Manufacturing..
              </p>
            </div>
          </div>
        </section>

        {/* Section 6: Storage & Handling */}
        <section>
          <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase tracking-wide">Storage &amp; Handling</h3>
          <div className="grid grid-cols-1 gap-6">
            <div>
              <label className={labelClass}>Storage Instructions</label>
              <SelectWithOther
                id="storage_inst" className={inputClass} value={formData.storage_inst}
                onChange={(v) => setFormData(prev => ({ ...prev, storage_inst: v }))}
                placeholder="Select Storage Condition" otherPlaceholder="Enter storage condition"
                options={[
                  { value: 'cool_dry', label: 'Cool & Dry Place' },
                  { value: 'refrigerated', label: 'Refrigerated (2-8°C)' },
                  { value: 'frozen', label: 'Frozen (Below 0°C)' },
                  { value: 'room_temp', label: 'Room Temperature' },
                  { value: 'ventilated', label: 'Well Ventilated Area' },
                  { value: 'hazmat', label: 'Hazardous Material Storage' },
                ]}
              />
            </div>
            <div>
              <label className={labelClass}>Usage / Application Instructions</label>
              <textarea id="usage_inst" className={inputClass} value={formData.usage_inst} onChange={handleInputChange} rows="2" placeholder="e.g., Apply 2 ml per litre of water, spray at 15-day intervals"></textarea>
              <p className={hintClass}>Dosage and method of use — shown to customers on the product page.</p>
            </div>
            <div>
              <label className={labelClass}>Handling &amp; Safety Instructions</label>
              <textarea id="handling_inst" className={inputClass} value={formData.handling_inst} onChange={handleInputChange} rows="2" placeholder="e.g., Use gloves..."></textarea>
            </div>
          </div>
        </section>

        {/* Status Toggle */}
        <section className="flex items-center justify-between py-6 border-t border-stone-100">
          <div>
            <h3 className="font-bold text-stone-900">Product Status</h3>
            <p className="text-sm text-stone-500">Active products appear in the catalog.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[11px] font-black tracking-widest ${formData.isActive ? 'text-[#EA2831]' : 'text-stone-400'}`}>
              {formData.isActive ? 'ACTIVE' : 'INACTIVE'}
            </span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={formData.isActive} onChange={handleToggle} className="sr-only peer" />
              <div className="w-11 h-6 bg-stone-200 rounded-full peer peer-checked:bg-[#EA2831] after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
            </label>
          </div>
        </section>

        {/* Buttons */}
        <div className="flex justify-end gap-4 border-t border-stone-100 pt-8">
          <button type="button" onClick={onCancel} className="px-6 py-2.5 text-sm font-bold border border-stone-200 rounded-xl hover:bg-stone-50 transition-all">
            Cancel
          </button>
          <button type="submit" disabled={loading} className="px-10 py-2.5 text-sm font-bold bg-[#EA2831] text-white rounded-xl hover:bg-black shadow-lg shadow-[#EA2831]/20 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
            {loading ? 'Processing...' : isEdit ? 'Save changes' : 'Upload Product'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SellerMyProductForm;