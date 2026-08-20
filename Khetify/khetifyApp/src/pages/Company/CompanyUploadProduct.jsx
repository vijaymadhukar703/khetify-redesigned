import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css'; 
import 'animate.css'; 
import config from "../../../config/config";
import { useNavigate } from 'react-router-dom';
import SelectWithOther from '../../Components/ims/SelectWithOther';

/* ================= STATIC OPTION CATALOGUES =================
   Kept at MODULE scope on purpose: these arrays never change, so defining them
   outside the component keeps their identity stable across renders (and avoids
   the classic "component re-created on every keystroke" focus-loss trap). */

// Every Unit of Measurement carries the metadata needed to render the correct
// follow-up value field once the user picks it:
//   short → suffix shown inside the input (kg, L, Pcs …)
//   kind  → decides the LABEL of the value field (weight / volume / count)
//   step  → decimals allowed (counts are whole numbers)
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

// Bulk packaging variant attributes ("Color: Red, Blue, Black"). Caps mirror the
// ones enforced server-side in productController.normalizeBulkVariants.
const MAX_BULK_ATTRS = 10;
const MAX_BULK_ATTR_VALUES = 25;
const MAX_BULK_TEXT_LEN = 60;
// Suggestions only — the user is free to type any attribute name.
const BULK_ATTR_SUGGESTIONS = ['Color', 'Material', 'Size', 'Capacity', 'Finish', 'Model'];

const CompanyUploadProduct = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    product_name: '',
    category: '',
    categoryOther: '',
    description: '',
    sku: '',
    hsn: '',
    license_no: '',
    // "Is this product from another company?" — when off, the two company
    // fields below are hidden AND dropped from the payload.
    is_third_party: false,
    mfr_company_name: '',
    mfr_company_address: '',
    // Country of Origin is FIXED to India: the input is read-only and the
    // server sets the value too, so this is never user-editable.
    origin: 'India',
    mrp: '',
    cost_price: '',
    gst: '0',
    stock: '',
    moq: '',
    capacity: '', 
    packaging: '',
    unit: '',
    unit_value: '',
    dim_length: '',
    dim_width: '',
    dim_height: '',
    dimension_unit: 'cm',
    gross_weight: '',
    weight_unit: 'kg',
    bulk_type: '',
    bulk_custom_type: '',
    bulk_capacity: '',
    bulk_capacity_unit: 'units',
    bulk_has_variants: 'no',
    dispatch_location: '',
    // Shelf life is entered in DAYS (was months). The readable "365 Days"
    // string stored on the product is derived server-side from this number.
    shelf_life_days: '',
    storage_inst: '',
    usage_inst: '',
    handling_inst: '',
    isActive: true
  });

  // Bulk packaging variant attributes. `draft` holds the value currently being
  // typed for that row (committed to `values` on Enter / +); `id` keeps React
  // keys stable so removing a row never shuffles input state.
  const bulkAttrId = useRef(1);
  const makeBulkAttr = () => ({ id: bulkAttrId.current++, name: '', values: [], draft: '' });
  const [bulkAttrs, setBulkAttrs] = useState([]);

  /* HSN → GST LOOKUP (Company Upload Product only).
     `hsn` holds the outcome of the last resolved lookup, never a guess:
       null                     — nothing looked up yet
       { status:'single'   }    — one rate; auto-filled into the GST field
       { status:'multiple' }    — several rates; the user must pick one
       { status:'not_found' }   — not in the master; GST stays manual
     `hsnLoading` only drives the little "Looking up…" line. */
  const [hsn, setHsn] = useState(null);
  const [hsnLoading, setHsnLoading] = useState(false);
  /* Autocomplete: `hsnOptions` is the list the dropdown renders, `hsnOpen`
     whether it is showing. `hsnPicked` records that the current code came from
     the list rather than being typed — the GST field is only ever filled from a
     resolved lookup, so this just controls the helper text. */
  const [hsnOptions, setHsnOptions] = useState([]);
  /* 'idle' | 'loading' | 'ok' | 'empty' | 'error'
     A failed or empty search USED TO BE SILENT — the list simply never appeared
     and there was no way to tell "no such code" from "the server is not
     reachable" from "I forgot to restart the backend". The state is tracked so
     the dropdown can say which it is. */
  const [hsnSearchState, setHsnSearchState] = useState('idle');
  const [hsnOpen, setHsnOpen] = useState(false);
  const [hsnPicked, setHsnPicked] = useState(false);
  const hsnBoxRef = useRef(null);

  const [selectedFiles, setSelectedFiles] = useState([]); 
  const [previews, setPreviews] = useState([]); 

  const handleInputChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  /* HSN accepts DIGITS ONLY, 4 to 8 of them. Filtering on the way in means a
     pasted "3102-1000" simply becomes "31021000" rather than being rejected
     after the fact; the length is still checked before upload.

     THE MINIMUM IS 4, NOT 8. The GST notification is written at HEADING level —
     of its 1163 codes, 1018 are 4-digit — so a 4-digit code is a complete,
     valid answer and refusing it would reject the very form most rates are
     published in. */
  const HSN_MIN = 4;
  const HSN_MAX = 8;
  const handleHsnChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, HSN_MAX);
    setFormData(prev => ({ ...prev, hsn: digits }));
    // The previous result belongs to the previous code — drop it immediately so
    // a stale rate can never sit next to a half-typed HSN. The GST field goes
    // with it: it is filled ONLY from a resolved lookup, never left over.
    setHsn(null);
    setHsnPicked(false);
    setFormData(prev => ({ ...prev, gst: '0' }));
    setHsnOpen(true);
  };

  /** Choosing a code from the dropdown. The rate still comes from the lookup
      effect below — this only sets the code and closes the list, so there is
      exactly one place that decides GST. */
  const pickHsn = (code) => {
    setFormData(prev => ({ ...prev, hsn: code }));
    setHsn(null);
    setHsnPicked(true);
    setHsnOpen(false);
  };

  /* MANUFACTURER LICENCE NO.

     INDIA HAS NO SINGLE NATIONAL FORMAT FOR THIS FIELD. Unlike PAN (10
     characters), GSTIN (15 characters) or HSN Code (8 digits) — which are
     fixed by central statute and therefore have ONE correct pattern to
     validate against — a "manufacturer licence" for an agri-input is issued
     under whichever Act governs that product's category:
       • Insecticides Act, 1968           → pesticides / insecticides
       • Fertiliser (Control) Order, 1985 → fertilizers
       • Seeds Act, 1966                  → seeds
     Every one of these is enforced by the STATE licensing / agriculture
     department, each of which mints its own certificate/licence number in
     its own alphanumeric scheme (e.g. "MH/PEST/2023/00456",
     "UP-FERT-2022-005678") — there is no central government spec that fixes
     a digit count the way PAN or GSTIN do, so hard-coding one (30, or any
     other number) would be inventing a rule that does not exist in law.

     What IS common to every one of these licences, in every state and under
     every one of the Acts above, is its SHAPE: a short authority/type code
     combined with a serial number, separated by "-" or "/" — never a bare
     word of only letters or only digits. That structural rule is what is
     enforced below, in place of a guessed fixed length:
       • allowed characters: letters, digits, hyphen (-) and slash (/) —
         unchanged from before, and matches every real sample format above;
       • must contain AT LEAST ONE LETTER AND AT LEAST ONE DIGIT — a licence
         number is never all-digits or all-letters under any of these
         schemes;
       • length kept within a realistic 8–25 characters — the range every
         real-world sample above, and this project's own seeded driver
         licence numbers (e.g. "MP20-2019-0012345"), fall inside. This
         replaces the old arbitrary 30-character ceiling with bounds that
         are still a judgement call (no authority publishes one either), but
         are now tied to how these numbers are actually written rather than
         picked out of the air.

     The cap is enforced in TWO places on purpose, as before. `maxLength`
     stops typing, but it does not stop every paste path on every browser, so
     the handler slices as well — that is what makes "no unlimited typing or
     pasting" actually true rather than merely intended. */
  const LICENSE_MAX = 25;
  const LICENSE_MIN = 8;
  const LICENSE_ALLOWED = /^[A-Za-z0-9/-]+$/;
  // Structural check: a real licence number always mixes a code with digits.
  const LICENSE_HAS_LETTER = /[A-Za-z]/;
  const LICENSE_HAS_DIGIT = /[0-9]/;
  const handleLicenseChange = (e) => {
    const cleaned = e.target.value.replace(/[^A-Za-z0-9/-]/g, '').slice(0, LICENSE_MAX);
    setFormData(prev => ({ ...prev, license_no: cleaned }));
  };

  // Unticking "from another company" CLEARS the two fields as well as hiding
  // them, so a name typed and then dismissed is never submitted.
  const toggleThirdParty = (checked) => {
    setFormData(prev => ({
      ...prev,
      is_third_party: checked,
      ...(checked ? {} : { mfr_company_name: '', mfr_company_address: '' }),
    }));
  };

  const handleToggle = () => {
    setFormData(prev => ({ ...prev, isActive: !prev.isActive }));
  };

  /* ================= BULK PACKAGING VARIANTS ================= */
  // Answering "Yes" seeds one empty attribute row; "No" clears the list so no
  // stale attributes can be submitted.
  const setHasBulkVariants = (answer) => {
    setFormData(prev => ({ ...prev, bulk_has_variants: answer }));
    setBulkAttrs(prev => {
      if (answer === 'no') return [];
      return prev.length ? prev : [makeBulkAttr()];
    });
  };

  const patchBulkAttr = (id, patch) => {
    setBulkAttrs(prev => prev.map(a => (a.id === id ? { ...a, ...patch } : a)));
  };

  const addBulkAttr = () => {
    setBulkAttrs(prev => (prev.length >= MAX_BULK_ATTRS ? prev : [...prev, makeBulkAttr()]));
  };

  const removeBulkAttr = (id) => {
    setBulkAttrs(prev => (prev.length === 1 ? [makeBulkAttr()] : prev.filter(a => a.id !== id)));
  };

  // Commit the row's draft text as a value chip (ignoring blanks and repeats).
  const commitBulkValue = (id) => {
    setBulkAttrs(prev => prev.map(a => {
      if (a.id !== id) return a;
      const v = a.draft.trim().slice(0, MAX_BULK_TEXT_LEN);
      if (!v) return { ...a, draft: '' };
      if (a.values.length >= MAX_BULK_ATTR_VALUES) return a;
      if (a.values.some(x => x.toLowerCase() === v.toLowerCase())) return { ...a, draft: '' };
      return { ...a, values: [...a.values, v], draft: '' };
    }));
  };

  const removeBulkValue = (id, value) => {
    setBulkAttrs(prev => prev.map(a => (
      a.id === id ? { ...a, values: a.values.filter(v => v !== value) } : a
    )));
  };

  // Shape the rows for the API: drafts are auto-committed, blanks dropped.
  const buildBulkVariantAttributes = () => {
    if (formData.bulk_has_variants !== 'yes') return [];
    return bulkAttrs
      .map(a => {
        const draft = a.draft.trim().slice(0, MAX_BULK_TEXT_LEN);
        const values = draft && !a.values.some(v => v.toLowerCase() === draft.toLowerCase())
          ? [...a.values, draft]
          : [...a.values];
        return { name: a.name.trim().slice(0, MAX_BULK_TEXT_LEN), values };
      })
      .filter(a => a.name && a.values.length)
      .slice(0, MAX_BULK_ATTRS);
  };

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length + selectedFiles.length > 5) {
      return Swal.fire({
        title: 'Limit Exceeded',
        text: 'You can only upload up to 5 images',
        icon: 'warning',
        confirmButtonColor: '#EA2831'
      });
    }
    setSelectedFiles(prev => [...prev, ...files]);
    const newPreviews = files.map(file => URL.createObjectURL(file));
    setPreviews(prev => [...prev, ...newPreviews]);
  };

  const removeImage = (index) => {
    const updatedFiles = selectedFiles.filter((_, i) => i !== index);
    const updatedPreviews = previews.filter((_, i) => i !== index);
    setSelectedFiles(updatedFiles);
    setPreviews(updatedPreviews);
  };

  /* ================= HSN AUTOCOMPLETE =================
     Fetches codes starting with what has been typed, from 2 digits up. Same
     400ms debounce and same out-of-order guard as the lookup below. The list is
     only ever a NAVIGATION aid — no GST is read from it; that still comes from
     the lookup, so there is one source of truth for the rate. */
  useEffect(() => {
    const q = formData.hsn;
    if (q.length < 2) { setHsnOptions([]); setHsnSearchState('idle'); return undefined; }

    let ignore = false;
    setHsnSearchState('loading');
    const timer = setTimeout(async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await axios.get(`${config.BASE_URL}hsn/search`, {
          params: { q, limit: 20 },
          headers: { Authorization: `Bearer ${token}` },
        });
        if (ignore) return;
        const list = res.data?.results || [];
        setHsnOptions(list);
        setHsnSearchState(list.length ? 'ok' : 'empty');
      } catch (err) {
        if (ignore) return;
        setHsnOptions([]);
        // 404 on the ROUTE ITSELF (not a missing code) almost always means the
        // backend is running an older build without /api/hsn/search — worth
        // saying out loud rather than showing an empty list.
        setHsnSearchState('error');
        console.error('HSN search failed:', err?.response?.status, err?.response?.data || err.message);
      }
    }, 400);

    return () => { ignore = true; clearTimeout(timer); };
  }, [formData.hsn]);

  /* HAS THE CURRENT CODE BEEN RESOLVED AGAINST THE MASTER?
     Upload is blocked unless it has, so a code that is not in the GST master —
     and therefore has no rate we could stand behind — cannot be submitted.
     'multiple' counts as resolved only once a rate has actually been picked. */
  const hsnResolved =
    hsn?.status === 'single' ||
    (hsn?.status === 'multiple' && hsn.rates?.some(r => String(r.gstRate) === String(formData.gst)));

  // Close the dropdown on an outside click, the way a native select behaves.
  useEffect(() => {
    if (!hsnOpen) return undefined;
    const onDown = (e) => {
      if (hsnBoxRef.current && !hsnBoxRef.current.contains(e.target)) setHsnOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [hsnOpen]);

  /* ================= HSN → GST LOOKUP =================
     Runs whenever the HSN reaches a valid 4-8 digits. Debounced by 400ms so
     typing 31021000 fires ONE request, not five.

     THE RATE ALWAYS COMES FROM THE DATABASE. There is no rate table in this
     file; the server resolves the code against the GST master and this only
     renders what it is told. `ignore` guards the classic out-of-order race —
     a slow reply for an old code must never overwrite a fast reply for the
     current one. */
  useEffect(() => {
    const code = formData.hsn;
    if (!(code.length >= HSN_MIN && code.length <= HSN_MAX)) { setHsn(null); return undefined; }

    let ignore = false;
    const timer = setTimeout(async () => {
      setHsnLoading(true);
      try {
        const token = localStorage.getItem("token");
        const res = await axios.get(`${config.BASE_URL}hsn/${code}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (ignore) return;
        const data = res.data;
        setHsn(data);
        // ONE RATE → fill it in. Several → fill NOTHING and let the user choose;
        // picking any of them here would be a guess with real tax consequences.
        if (data.status === "single") {
          setFormData(prev => ({ ...prev, gst: String(data.gstRate) }));
        }
      } catch (err) {
        if (ignore) return;
        // A 404 is a normal outcome (code genuinely absent), not a failure —
        // the server's own payload explains it, so it is shown as-is.
        setHsn(err.response?.data || { status: "error", message: "Could not reach the GST rate master." });
      } finally {
        if (!ignore) setHsnLoading(false);
      }
    }, 400);

    return () => { ignore = true; clearTimeout(timer); };
  }, [formData.hsn]);

  /* ================= UNIT OF MEASUREMENT (DYNAMIC) =================
     The value field below the Unit dropdown is driven entirely by the selected
     unit. A custom unit typed through SelectWithOther's "Other…" escape hatch is
     supported too — it just falls back to a generic label + free decimals. */
  const knownUnit = UNIT_OPTIONS.find(o => o.value === formData.unit) || null;
  const unitMeta = formData.unit
    ? (knownUnit || { short: formData.unit, kind: 'custom', step: 'any' })
    : null;
  const unitValueLabel = unitMeta ? UNIT_VALUE_LABEL[unitMeta.kind] : '';

  /* ================= CLIENT-SIDE VALIDATION =================
     Only enforced on a real upload — "Save as Draft" stays deliberately lenient
     so a half-filled product can always be parked. */
  const validateForUpload = () => {
    /* ── Packaging & Measurement — all four are required on a real upload ── */
    if (!formData.packaging.trim()) {
      return 'Please select the Packaging Type.';
    }
    if (!formData.unit.trim()) {
      return 'Please select the Unit of Measurement.';
    }
    if (formData.unit && !(Number(formData.unit_value) > 0)) {
      return `Please enter the ${unitValueLabel} for the selected Unit of Measurement.`;
    }
    const dims = [formData.dim_length, formData.dim_width, formData.dim_height];
    if (dims.some(v => String(v).trim() === '')) {
      return 'Please enter all three Product Dimensions (length, width and height).';
    }
    if (dims.some(v => !(Number(v) > 0))) {
      return 'Product Dimensions must be numbers greater than zero.';
    }
    if (String(formData.gross_weight).trim() === '') {
      return 'Please enter the Shipping Weight (Gross).';
    }
    if (!(Number(formData.gross_weight) > 0)) {
      return 'Shipping Weight must be greater than zero.';
    }

    /* ── Identification & Traceability ── */
    if (!new RegExp(`^\\d{${HSN_MIN},${HSN_MAX}}$`).test(formData.hsn)) {
      return `HSN Code must be ${HSN_MIN} to ${HSN_MAX} digits (numbers only).`;
    }
    /* THE HSN MUST EXIST IN THE GST MASTER.
       GST is not typed on this form any more — it is read from the master — so a
       code the master does not know would leave the product with the default 0%
       and no way for anyone to notice. Blocking here means only codes we hold a
       statutory rate for can be uploaded. */
    if (hsn?.status === 'not_found') {
      return `HSN ${formData.hsn} is not in the GST master. Please choose an HSN code from the suggestions.`;
    }
    if (hsn?.status === 'multiple' && !hsnResolved) {
      return `HSN ${hsn.matchedHsn} has more than one GST rate — please select the one that applies to this product.`;
    }
    if (!hsnResolved) {
      return 'Please wait for the GST rate to load, or pick an HSN code from the suggestions.';
    }
    const licence = formData.license_no.trim();
    // The wording names WHOSE licence it is, because when the box is ticked the
    // field belongs to the other company and a generic message would be
    // ambiguous.
    const licenceOwner = formData.is_third_party ? "other company's" : '';
    if (!licence) {
      return `Please enter the ${licenceOwner ? `${licenceOwner} ` : ''}Manufacturer License No.`;
    }
    if (licence.length < LICENSE_MIN || licence.length > LICENSE_MAX) {
      return `Manufacturer License No. must be between ${LICENSE_MIN} and ${LICENSE_MAX} characters.`;
    }
    if (!LICENSE_ALLOWED.test(licence)) {
      return 'Manufacturer License No. can only contain letters, numbers, hyphens (-) and slashes (/).';
    }
    // A real state-issued licence (Insecticides Act / FCO / Seeds Act) always
    // combines an authority/type code with a serial number — never all-digits
    // or all-letters — so this catches typos like "12345678" or "MFGLICENSE"
    // that pass the character check above but aren't a real licence shape.
    if (!LICENSE_HAS_LETTER.test(licence) || !LICENSE_HAS_DIGIT.test(licence)) {
      return 'Manufacturer License No. must include both letters and numbers (e.g., MH/PEST/2023/00456).';
    }
    // Only enforced while the box is ticked — exactly when the fields are shown.
    if (formData.is_third_party) {
      if (!formData.mfr_company_name.trim()) {
        return 'Please enter the Company Name of the other company/manufacturer.';
      }
      if (!formData.mfr_company_address.trim()) {
        return 'Please enter the Company Address of the other company/manufacturer.';
      }
    }

    /* ── Shelf life, in whole days ── */
    const days = Number(formData.shelf_life_days);
    if (!(Number.isFinite(days) && days > 0)) {
      return 'Please enter the Shelf Life in days (a number greater than zero).';
    }
    if (!Number.isInteger(days)) {
      return 'Shelf Life must be a whole number of days.';
    }
    if (formData.bulk_has_variants === 'yes') {
      const attrs = buildBulkVariantAttributes();
      if (!attrs.length) {
        return 'Add at least one bulk packaging attribute with a name and one value, or answer "No".';
      }
      const names = attrs.map(a => a.name.toLowerCase());
      if (new Set(names).size !== names.length) {
        return 'Each bulk packaging attribute name must be unique.';
      }
    }
    return null;
  };

  const handleSubmit = async (e, uploadStatus = 'uploaded') => {
    if (e) e.preventDefault();

    if (uploadStatus !== 'draft') {
      const problem = validateForUpload();
      if (problem) {
        return Swal.fire({
          title: 'Check the form',
          text: problem,
          icon: 'warning',
          confirmButtonColor: '#EA2831'
        });
      }
    }

    setLoading(true);
    const companyId = localStorage.getItem("companyId");
    const token = localStorage.getItem("token");

    const data = new FormData();
    // 🔥 Mapping all fields to match Backend productModel.js
    data.append('companyId', companyId);
    data.append('productName', formData.product_name);
    data.append('category', formData.category === 'other' ? (formData.categoryOther || '').trim() : formData.category);
    data.append('unit', formData.unit);
    data.append('unitValue', formData.unit_value);
    data.append('description', formData.description);
    data.append('skuNumber', formData.sku);
    data.append('hsnCode', formData.hsn);
    data.append('manufactureLicenseNo', formData.license_no);
    // The two company fields ride along only when the box is ticked; the server
    // clears them otherwise, so an unticked product can never keep a stale name.
    data.append('isThirdPartyProduct', formData.is_third_party ? 'true' : 'false');
    if (formData.is_third_party) {
      data.append('manufacturerCompanyName', formData.mfr_company_name);
      data.append('manufacturerCompanyAddress', formData.mfr_company_address);
    }
    // Fixed value — the server sets this too and does not trust the client.
    data.append('countryOrigin', 'India');
    data.append('mrp', formData.mrp);
    data.append('costPrice', formData.cost_price);
    data.append('gstPercentage', formData.gst);
    data.append('availableStock', formData.stock);
    data.append('minimumOrderQuantity', formData.moq);
    data.append('monthlyProductionCapacity', formData.capacity);
    data.append('packagingType', formData.packaging);
    // Packed dimensions + gross weight (shipping & warehouse planning).
    data.append('length', formData.dim_length);
    data.append('width', formData.dim_width);
    data.append('height', formData.dim_height);
    data.append('dimensionUnit', formData.dimension_unit);
    data.append('weight', formData.gross_weight);
    data.append('weightUnit', formData.weight_unit);
    data.append('bulkPackaging', JSON.stringify({
      type: formData.bulk_type === 'Other' ? (formData.bulk_custom_type || 'Other') : formData.bulk_type,
      customType: formData.bulk_type === 'Other' ? formData.bulk_custom_type : '',
      capacity: formData.bulk_capacity ? Number(formData.bulk_capacity) : undefined,
      capacityUnit: formData.bulk_capacity_unit || 'units',
      hasVariants: formData.bulk_has_variants === 'yes',
      variantAttributes: buildBulkVariantAttributes(),
    }));
    data.append('dispatchLocation', formData.dispatch_location);
    // DAYS ONLY. The readable "365 Days" string that the catalog and edit pages
    // render is derived from this server-side, so there is one input and the two
    // can never disagree.
    data.append('shelfLifeDays', formData.shelf_life_days);
    data.append('storageInstructions', formData.storage_inst);
    data.append('usageInstructions', formData.usage_inst);
    data.append('safetyInstructions', formData.handling_inst);
    data.append('productStatus', formData.isActive ? 'active' : 'inactive');
    data.append('productUpload', uploadStatus === 'draft' ? 'saveDraft' : 'uploaded');
    
    selectedFiles.forEach((file) => data.append('productImages', file));

    try {
      const response = await axios.post(`${config.BASE_URL}product/create`, data, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      
      if (response.status === 201) {
        // The Product Code is generated by the backend on create — surface it
        // straight away so the user can note it down.
        const productCode = response.data?.data?.product_code;
        // 🔥 Professional Success Popup
        Swal.fire({
          title: 'Success!',
          text: productCode
            ? `Your product has been successfully uploaded. Product Code: ${productCode}`
            : 'Your product has been successfully uploaded.',
          icon: 'success',
          confirmButtonColor: '#EA2831',
          showClass: { popup: 'animate__animated animate__fadeInDown' }
        }).then((result) => { 
          // 🔥 OK click karne par catalog page par redirect
          if (result.isConfirmed) {
            navigate('/product-catalog'); 
          }
        });
      }
    } catch (error) {
      console.error("Upload Error:", error);
      Swal.fire({ 
        title: 'Upload Failed', 
        text: error.response?.data?.message || 'Internal Server Error', 
        icon: 'error', 
        confirmButtonColor: '#EA2831' 
      });
    } finally { 
      setLoading(false); 
    }
  };

  const inputClass = "w-full border border-stone-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#EA2831]/20 focus:border-[#EA2831] outline-none transition-all placeholder:text-stone-300 bg-white font-sora";
  const labelClass = "block text-sm font-semibold text-stone-700 mb-1.5";
  const hintClass = "text-xs text-stone-400 mt-1";

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50/30 font-sora">
      <div className="max-w-5xl mx-auto text-left">
        <form onSubmit={(e) => handleSubmit(e, 'uploaded')} className="space-y-10 bg-white p-6 sm:p-10 border border-stone-200 rounded-2xl shadow-sm mb-12 animate__animated animate__fadeIn">
          
          {/* Section 1: Basic Information */}
          <section>
            <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase tracking-wide">Basic Product Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-1">
                <label className={labelClass}>Product Name <span className="text-[#EA2831]">*</span></label>
                <input id="product_name" className={inputClass} value={formData.product_name} onChange={handleInputChange} placeholder="Enter full product name" required />
                {/* The Product Code is derived from this name on the server. */}
                {/* <p className="text-[11px] text-stone-400 mt-1.5">
                  A unique <b className="text-stone-500">Product Code</b> (3 letters from the name + 3 digits, e.g. PRE482) is generated automatically on save.
                </p> */}
              </div>
              <div>
                <label className={labelClass}>Category <span className="text-[#EA2831]">*</span></label>
                <select id="category" className={inputClass} value={formData.category} onChange={handleInputChange} required>
                  <option value="">Select Category</option>
                  <option value="fertilizers">Fertilizers</option>
                  <option value="pesticides">Pesticides</option>
                  <option value="seeds">Seeds</option>
                  <option value="tools">Equipment & Tools</option>
                  <option value="growth_promoters">Growth Promoters</option>
                  <option value="other">Other…</option>
                </select>
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
                  <input type="file" multiple onChange={handleImageChange} className="absolute inset-0 opacity-0 cursor-pointer z-20" />
                  <span className="material-symbols-outlined text-stone-400 text-4xl group-hover:text-[#EA2831] transition-colors mb-2">cloud_upload</span>
                  <p className="text-sm font-medium text-stone-900">Drag & drop or <span className="text-[#EA2831] underline">browse</span></p>
                  <p className="text-[10px] text-stone-500 uppercase mt-1 font-bold">JPEG, PNG (MAX 5MB)</p>
                </div>
                {previews.map((src, index) => (
                  <div key={index} className="aspect-square rounded-xl border border-stone-200 overflow-hidden relative shadow-sm animate__animated animate__zoomIn">
                    <img src={src} className="w-full h-full object-cover" alt="preview" />
                    <button type="button" onClick={() => removeImage(index)} className="absolute top-1.5 right-1.5 bg-[#EA2831] text-white rounded-full p-1 shadow-md hover:bg-black transition-all">
                      <span className="material-symbols-outlined text-xs block font-bold">close</span>
                    </button>
                  </div>
                ))}
                {[...Array(Math.max(0, 3 - previews.length))].map((_, i) => (
                  <div key={`empty-${i}`} className="aspect-square bg-stone-50 rounded-xl border border-stone-200 border-dashed flex items-center justify-center text-stone-300">
                    <span className="material-symbols-outlined text-3xl">add</span>
                  </div>
                ))}
              </div>
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
                    <select id="dimension_unit" className={inputClass} value={formData.dimension_unit} onChange={handleInputChange}>
                      {DIMENSION_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  
                </div>

                <div>
                  <label className={labelClass}>Shipping Weight (Gross) <span className="text-[#EA2831]">*</span></label>
                  <div className="flex gap-2">
                    <input id="gross_weight" type="number" min="0" step="0.01" className={inputClass} value={formData.gross_weight} onChange={handleInputChange} placeholder="e.g., 51" />
                    <select id="weight_unit" className={`${inputClass} max-w-[100px]`} value={formData.weight_unit} onChange={handleInputChange}>
                      {WEIGHT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: Identification */}
          <section>
            <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase">Identification & Traceability</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* <div><label className="block text-sm font-semibold text-stone-700 mb-1.5">SKU Code</label><input id="sku" className={inputClass} value={formData.sku} onChange={handleInputChange} placeholder="e.g., KHT-UREA-001" /></div> */}

              {/* 1 — COUNTRY OF ORIGIN. Fixed to India and not user-editable, so
                  the SelectWithOther dropdown is replaced by a read-only input
                  carrying the SAME styling. The server sets this value as well
                  and does not trust the client. */}
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

              {/* 2 — HSN CODE. 4 to 8 digits; the field itself accepts only
                  digits so letters, spaces and punctuation can never be typed or
                  pasted in, and the length is checked before upload.

                  Entering a valid code looks the GST rate up in the master and
                  reports the outcome directly beneath the field. */}
              <div>
                <label className={labelClass}>HSN Code <span className="text-[#EA2831]">*</span></label>
                {/* The input and its dropdown share a positioned wrapper so the
                    list hangs directly under the field. The input itself is
                    unchanged — same id, same class, same handler, same cap. */}
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
                      problem. Rendering only on a non-empty list is what made a
                      broken endpoint look identical to an unfinished code.
                      `!hsnPicked` keeps it closed immediately after a selection —
                      it is cleared again the moment the user edits the field. */}
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
                          Could not reach the GST master. Check that the backend is running and has been
                          restarted, and that <span className="font-mono">npm run seed:hsn</span> has been run.
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
                            {/* A code with several rates is flagged rather than
                                shown with one of them — the choice belongs to
                                the user, after they pick the code. */}
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
               

                {/* The code is in the field but the master has no rate for it.
                    Upload is blocked here rather than at submit, so the problem
                    is visible while the field is still in front of the user. */}
                {!hsnLoading && formData.hsn.length >= HSN_MIN && hsn?.status === 'not_found' && (
                  <p className="mt-1 text-xs font-medium text-[#EA2831]">
                    ⚠ Pick an HSN code from the list — only codes present in the GST master can be used.
                  </p>
                )}

                {hsnLoading && (
                  <p className="text-xs text-stone-400 mt-1">Looking up the GST rate…</p>
                )}

                {/* ONE RATE — filled in. The matched level is stated because it
                    may be a parent of what was typed (08045020 → 0804), and the
                    operator should see which entry the rate actually came from. */}
                {/* {!hsnLoading && hsn?.status === 'single' && (
                  <div className="mt-2 rounded-lg border border-green-200 bg-green-50/60 px-3 py-2">
                    <p className="text-xs font-bold text-green-700">
                      GST {hsn.gstRate}% applied
                      {hsn.matchedHsn !== formData.hsn && <> · matched HSN {hsn.matchedHsn}</>}
                    </p>
                    {hsn.rates?.[0]?.description && (
                      <p className="text-[11px] text-stone-500 mt-0.5">{hsn.rates[0].description}</p>
                    )}
                  </div>
                )} */}

                {/* SEVERAL RATES — nothing is chosen automatically. Each option
                    is shown with the condition from the notification that makes
                    it apply, and the user picks the one matching their product. */}
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

                {/* NOT IN THE MASTER — say so plainly and leave GST manual. No
                    rate is inferred from a chapter or a neighbouring code. */}
                {!hsnLoading && (hsn?.status === 'not_found' || hsn?.status === 'error') && (
                  <p className="mt-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] text-stone-600">
                    {hsn.message || 'No GST rate found for this HSN code.'} Please select the GST rate manually below.
                  </p>
                )}
              </div>

              {/* 3 — MANUFACTURER LICENCE.

                  Shown HERE only while the product is the company's own. Once
                  "from another company" is ticked, the licence being asked for
                  is the OTHER company's, so the field moves down into that block
                  and sits between the name and the address. It is the SAME field
                  either way — same `license_no` state, same `manufactureLicenseNo`
                  on the payload — so nothing downstream changes and the number is
                  never asked for twice. */}
              {!formData.is_third_party && (
                <div>
                  <label className={labelClass}>Manufacturer License No. <span className="text-[#EA2831]">*</span></label>
                  <input
                    id="license_no"
                    className={inputClass}
                    value={formData.license_no}
                    onChange={handleLicenseChange}
                    placeholder="e.g., MFG/LIC/2023/890"
                    maxLength={LICENSE_MAX}
                    required
                  />
                
                </div>
              )}

              <div className="md:col-span-3">
                <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
                  <input
                    type="checkbox"
                    checked={formData.is_third_party}
                    onChange={(e) => toggleThirdParty(e.target.checked)}
                    className="w-4 h-4 accent-[#EA2831] cursor-pointer"
                  />
                  <span className="text-sm font-semibold text-stone-700">Is this product from another company?</span>
                </label>

                {/* Shown only while the box is ticked. Unticking hides these AND
                    clears them, so their validation stops applying and nothing
                    typed here is submitted.

                    ORDER IS DELIBERATE: Company Name → Manufacturer License No.
                    → Company Address, stacked one per row so the three read as a
                    single block about one company rather than as unrelated
                    fields sitting side by side. */}
                {formData.is_third_party && (
                  <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50/60 p-5 animate__animated animate__fadeIn">
                    <p className="text-sm font-semibold text-stone-700">Other company / manufacturer details</p>
                    <p className="text-xs text-stone-400 mt-0.5 mb-4">
                      Enter the details of the other company/manufacturer — the name, licence number and
                      address below all belong to <b className="text-stone-500">that company</b>, not yours.
                    </p>

                    <div className="grid grid-cols-1 gap-6">
                      <div>
                        <label className={labelClass}>Company Name <span className="text-[#EA2831]">*</span></label>
                        <input
                          id="mfr_company_name"
                          className={inputClass}
                          value={formData.mfr_company_name}
                          onChange={handleInputChange}
                          placeholder="Name of the other company/manufacturer"
                          required
                        />
                      </div>

                      <div>
                        <label className={labelClass}>Manufacturer License No. <span className="text-[#EA2831]">*</span></label>
                        <input
                          id="license_no"
                          className={inputClass}
                          value={formData.license_no}
                          onChange={handleLicenseChange}
                          placeholder="e.g., MFG/LIC/2023/890"
                          maxLength={LICENSE_MAX}
                          required
                        />
                        <p className={hintClass}>
                          The other company's licence number. Letters and numbers only (with - or /), and must
                          include both. {LICENSE_MIN}–{LICENSE_MAX} characters.
                        </p>
                      </div>

                      <div>
                        <label className={labelClass}>Company Address <span className="text-[#EA2831]">*</span></label>
                        <input
                          id="mfr_company_address"
                          className={inputClass}
                          value={formData.mfr_company_address}
                          onChange={handleInputChange}
                          placeholder="Address of the other company/manufacturer"
                          required
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Section 3: Pricing */}
          <section>
            <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase tracking-wide">Pricing & Tax</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div><label className={labelClass}>MRP (₹) <span className="text-[#EA2831]">*</span></label>
              <input id="mrp" type="number" className={inputClass} value={formData.mrp} onChange={handleInputChange} placeholder="0.00" required /></div>
              <div>
                {/* <label className="block text-sm font-semibold text-stone-700 mb-1.5 flex justify-between">Cost Price (₹) <span className="text-[#EA2831]">*</span> <span className="text-[9px] bg-stone-100 px-1.5 py-0.5 rounded border border-stone-200 text-stone-500 font-bold uppercase">INTERNAL ONLY</span></label> */}
                <label className="block text-sm font-semibold text-stone-700 mb-1.5 flex justify-between">
  <span>
    Cost Price (₹)<span className="text-[#EA2831]">*</span>
  </span>

  <span className="text-[9px] bg-stone-100 px-1.5 py-0.5 rounded border border-stone-200 text-stone-500 font-bold uppercase">
    INTERNAL ONLY
  </span>
</label>
                <input id="cost_price" type="number" className={inputClass} value={formData.cost_price} onChange={handleInputChange} placeholder="0.00" required />
              </div>
              <div><label className={labelClass}>GST (%)</label>
                {/* READ-ONLY. The rate is statutory — it belongs to the HSN code,
                    not to whoever is filling the form — so it is displayed, not
                    entered. It is set in exactly two places, both driven by the
                    database: the lookup effect (single rate) and the radio
                    buttons under the HSN field (multiple rates).

                    A DISABLED <select> IS NOT USED. A disabled control is
                    skipped by form serialisation and reads as unavailable to a
                    screen reader, and there is nothing here for the user to do —
                    so this is a plain read-only display of the resolved value,
                    with the same `formData.gst` still going to the API under the
                    same key. The payload is unchanged. */}
                <div className={`${inputClass} flex items-center justify-between bg-stone-50 text-stone-700 cursor-not-allowed`}>
                  <span className="font-semibold">
                    {formData.gst === '0' ? '0% (Exempt)' : `${formData.gst}%`}
                  </span>
                  <span className="material-symbols-outlined text-base text-stone-400" title="Set automatically from the HSN code">lock</span>
                </div>
                {/* The value still reaches the form the same way for anything
                    that reads the DOM, and stays in formData for the submit. */}
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

          {/* Section 4: Supply & Logistics */}
          <section>
            <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase tracking-wide">Supply & Logistics</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* <div><label className="block text-sm font-semibold text-stone-700 mb-1.5">Available Stock <span className="text-[#EA2831]">*</span></label><input id="stock" type="number" className={inputClass} value={formData.stock} onChange={handleInputChange} placeholder="e.g., 5000" required /></div> */}
              <div><label className={labelClass}>Minimum Order Quantity (MOQ)</label><input id="moq" type="number" className={inputClass} value={formData.moq} onChange={handleInputChange} placeholder="e.g., 10" /></div>
              <div><label className={labelClass}>Monthly Production Capacity</label><input id="capacity" className={inputClass} value={formData.capacity} onChange={handleInputChange} placeholder="e.g., 20000 Units" /></div>
              {/* Packaging Type now lives in "Packaging & Measurement" above — kept
                  here only as a pointer so nothing is asked for twice. */}
              <div>
                <label className={labelClass}>Bulk Packaging Type</label>
                <select id="bulk_type" className={inputClass} value={formData.bulk_type} onChange={handleInputChange}>
                  <option value="">Select Bulk Packaging</option>
                  <option value="Carton">Carton</option>
                  <option value="Bag">Bag</option>
                  <option value="Box">Box</option>
                  <option value="Sack">Sack</option>
                  <option value="Drum">Drum</option>
                  <option value="Other">Other…</option>
                </select>
                {formData.bulk_type === 'Other' && (
                  <input
                    id="bulk_custom_type"
                    className={`${inputClass} mt-2`}
                    value={formData.bulk_custom_type}
                    onChange={handleInputChange}
                    placeholder="Enter bulk packaging type"
                  />
                )}
              </div>
              <div>
                <label className={labelClass}>Capacity Bulk Package</label>
                <div className="flex gap-2">
                  <input
                    id="bulk_capacity"
                    type="number"
                    min="0"
                    className={inputClass}
                    value={formData.bulk_capacity}
                    onChange={handleInputChange}
                    placeholder="e.g., 50"
                  />
                  <input
                    id="bulk_capacity_unit"
                    className={`${inputClass} max-w-[120px]`}
                    value={formData.bulk_capacity_unit}
                    onChange={handleInputChange}
                    placeholder="units"
                  />
                </div>
                <p className="text-xs text-stone-400 mt-1">e.g. 1 Carton contains 50 units</p>
              </div>

              {/* ===== Bulk packaging variants ===== */}
              <div className="md:col-span-2">
                <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <label className={labelClass}>Is there a variant of product?</label>
                      <p className="text-xs text-stone-400">
                        Choose Yes if the same product ships in different options (e.g. Color, Material, Size).
                      </p>
                    </div>
                    <div className="flex rounded-lg border border-stone-200 bg-white p-1">
                      {['no', 'yes'].map((answer) => (
                        <button
                          key={answer}
                          type="button"
                          onClick={() => setHasBulkVariants(answer)}
                          aria-pressed={formData.bulk_has_variants === answer}
                          className={`px-6 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${
                            formData.bulk_has_variants === answer
                              ? 'bg-[#EA2831] text-white shadow-sm'
                              : 'text-stone-400 hover:text-stone-600'
                          }`}
                        >
                          {answer === 'yes' ? 'Yes' : 'No'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {formData.bulk_has_variants === 'yes' && (
                    <div className="mt-5 space-y-4 animate__animated animate__fadeIn">
                      {bulkAttrs.map((attr, index) => (
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
                                  onChange={(e) => patchBulkAttr(attr.id, { name: e.target.value })}
                                  placeholder="e.g., Color"
                                  list="bulk-attr-suggestions"
                                  maxLength={MAX_BULK_TEXT_LEN}
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-stone-500 mb-1.5">Available Values</label>
                                <div className="flex gap-2">
                                  <input
                                    className={inputClass}
                                    value={attr.draft}
                                    onChange={(e) => patchBulkAttr(attr.id, { draft: e.target.value })}
                                    onKeyDown={(e) => {
                                      // Enter adds a value without submitting the form.
                                      if (e.key === 'Enter' || e.key === ',') {
                                        e.preventDefault();
                                        commitBulkValue(attr.id);
                                      }
                                    }}
                                    placeholder="Type a value, press Enter"
                                    maxLength={MAX_BULK_TEXT_LEN}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => commitBulkValue(attr.id)}
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
                                          onClick={() => removeBulkValue(attr.id, value)}
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
                              onClick={() => removeBulkAttr(attr.id)}
                              className="shrink-0 mt-7 p-2 rounded-lg border border-stone-200 text-stone-400 hover:text-[#EA2831] hover:border-[#EA2831]/40 transition-all"
                              aria-label="Remove attribute"
                            >
                              <span className="material-symbols-outlined text-base block">delete</span>
                            </button>
                          </div>
                        </div>
                      ))}

                      <datalist id="bulk-attr-suggestions">
                        {BULK_ATTR_SUGGESTIONS.map((name) => <option key={name} value={name} />)}
                      </datalist>

                      {bulkAttrs.length < MAX_BULK_ATTRS && (
                        <button type="button" onClick={addBulkAttr} className="text-xs font-bold text-[#EA2831] hover:underline">
                          + Add another attribute
                        </button>
                      )}
                      
                    </div>
                  )}
                </div>
              </div>
              {/* <div className="md:col-span-2"><label className="block text-sm font-semibold text-stone-700 mb-1.5">Dispatch Location</label><input id="dispatch_location" className={inputClass} value={formData.dispatch_location} onChange={handleInputChange} placeholder="City, State (e.g., Pune, Maharashtra)" /></div> */}
            </div>
          </section>

          {/* Section 5: Compliance & Validity */}
          <section>
            <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase tracking-wide">Compliance & Validity</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* SHELF LIFE IN DAYS (was months). A whole number of days; the
                  readable "365 Days" string stored on the product is derived
                  from this server-side. */}
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
                <p className={hintClass}>Shelf Life Duration (Days) from Date of Manufacturing.</p>
              </div>
             
            </div>
          </section>

          {/* Section 6: Storage & Handling */}
          <section>
            <h3 className="text-lg font-bold text-stone-900 mb-6 border-b border-stone-100 pb-2 uppercase tracking-wide">Storage & Handling</h3>
            <div className="grid grid-cols-1 gap-6">
              <div><label className={labelClass}>Storage Instructions</label>
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
              <div><label className={labelClass}>Handling & Safety Instructions</label><textarea id="handling_inst" className={inputClass} value={formData.handling_inst} onChange={handleInputChange} rows="2" placeholder="e.g., Use gloves..."></textarea></div>
            </div>
          </section>

          {/* Status Toggle */}
          {/* <section className="flex items-center justify-between py-6 border-t border-stone-100">
            <div><h3 className="font-bold text-stone-900">Product Status</h3><p className="text-sm text-stone-500">Active products appear in the catalog.</p></div>
            <div className="flex items-center gap-3">
              <span className={`text-[11px] font-black tracking-widest ${formData.isActive ? 'text-[#EA2831]' : 'text-stone-400'}`}>{formData.isActive ? 'ACTIVE' : 'INACTIVE'}</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={formData.isActive} onChange={handleToggle} className="sr-only peer" />
                <div className="w-11 h-6 bg-stone-200 rounded-full peer peer-checked:bg-[#EA2831] after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
              </label>
            </div>
          </section> */}

          {/* Buttons */}
          <div className="flex justify-end gap-4 border-t border-stone-100 pt-8">
            <button type="button" onClick={(e) => handleSubmit(e, 'draft')} className="px-6 py-2.5 text-sm font-bold border border-stone-200 rounded-xl hover:bg-stone-50 transition-all">Save as Draft</button>
            <button type="submit" disabled={loading} className="px-10 py-2.5 text-sm font-bold bg-[#EA2831] text-white rounded-xl hover:bg-black shadow-lg shadow-[#EA2831]/20 active:scale-[0.98] transition-all">
              {loading ? 'Processing...' : 'Upload Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CompanyUploadProduct;