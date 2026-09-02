import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  saveSellerInfo, saveSellerContact, submitSellerOnboarding,
  getSellerCategories, createSellerCategory,
} from "../../lib/sellerApi";

// Seller onboarding wizard — mirrors the company multi-step setup:
//   info → contact → review/submit.
// Each step persists to /api/seller/onboarding/* (scoped to the authenticated
// seller) before advancing; review fires the final submit.
// Statutory ids (GSTIN / PAN / Udyam) are NOT collected here any more — the
// seller fills them from the Compliance section of its Profile page, so the
// /onboarding/verification endpoint is never called from this flow.
const STEPS = ["Business", "Contact", "Review"];

// The category list comes from the shared master (GET /api/seller/categories),
// not from a constant here: a category one seller types through "Other" is
// POSTed to that master and shows up in the dropdown for every seller after.
// "Other" itself is UI-only — it opens the free-text box and is never a row in
// the master, so it is appended in the markup rather than fetched.
const OTHER = "Other";

const field = "block w-full h-11 px-3 rounded-lg border border-stone-300 outline-none focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/10 text-sm";
const Label = ({ children, required = true }) => (
  <label className="block text-xs font-bold text-stone-600 mb-1">
    {children}{required && <span className="text-[#EA2831] ml-0.5">*</span>}
  </label>
);
const Err = ({ e }) => (e ? <p className="text-red-500 text-xs font-medium mt-0.5">⚠ {e}</p> : null);

const SellerOnboarding = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [info, setInfo] = useState({ businessName: "", productCategories: [] });
  const [contact, setContact] = useState({ line: "", city: "", state: "", pincode: "", ownerName: "", officialEmail: "", officialPhone: "" });
  const [fieldErrors, setFieldErrors] = useState({});

  // The dropdown's options, loaded from the shared master.
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [categoriesError, setCategoriesError] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState("");
  const [otherError, setOtherError] = useState("");
  const [otherBusy, setOtherBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getSellerCategories()
      .then((res) => { if (alive) setCategoryOptions((res.data || []).map((c) => c.name)); })
      .catch(() => { if (alive) setCategoriesError("Could not load categories. Reload the page."); });
    return () => { alive = false; };
  }, []);

  const addCategory = (c) => {
    setInfo((prev) => (prev.productCategories.includes(c)
      ? prev
      : { ...prev, productCategories: [...prev.productCategories, c] }));
  };
  // Only drops this seller's selection — the category stays in the master.
  const removeCategory = (c) => {
    setInfo((prev) => ({ ...prev, productCategories: prev.productCategories.filter((x) => x !== c) }));
  };
  const onCategoryPick = (value) => {
    if (!value) return;
    if (value === OTHER) { setOtherError(""); setOtherOpen(true); return; }
    addCategory(value);
  };
  // Saves the typed category to the master and selects whatever comes back. The
  // server is the one that dedupes (case-insensitively), so typing
  // "micronutrient" when "Micronutrient" already exists selects the existing
  // one instead of creating a near-duplicate.
  const commitOther = async () => {
    const v = otherText.trim();
    if (!v) return;
    setOtherError("");
    setOtherBusy(true);
    try {
      const res = await createSellerCategory(v);
      const name = res.data?.name || v;
      setCategoryOptions((prev) => (prev.includes(name) ? prev : [...prev, name].sort((a, b) => a.localeCompare(b))));
      addCategory(name);
      setOtherText("");
      setOtherOpen(false);
    } catch (err) {
      // Rejected (too short/long, bad characters, server down): keep the box
      // open with what was typed so it can be corrected in place.
      setOtherError(err.response?.data?.message || "Could not add that category.");
    } finally {
      setOtherBusy(false);
    }
  };

  // Every field on the active step is required. Review (step 2) has no inputs.
  const stepErrors = () => {
    const e = {};
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (step === 0) {
      if (!info.businessName.trim()) e.businessName = "Business legal name is required";
      if (info.productCategories.length === 0) e.productCategories = "Add at least one category";
    } else if (step === 1) {
      if (!contact.line.trim()) e.line = "Address line is required";
      if (!contact.city.trim()) e.city = "City is required";
      if (!contact.state.trim()) e.state = "State is required";
      if (!/^[0-9]{6}$/.test(contact.pincode.trim())) e.pincode = "Pincode must be 6 digits";
      if (!contact.ownerName.trim()) e.ownerName = "Name of contact person is required";
      if (!emailRe.test(contact.officialEmail.trim())) e.officialEmail = "Enter a valid email";
      if (!/^[0-9]{10}$/.test(contact.officialPhone.trim())) e.officialPhone = "Phone must be 10 digits";
    }
    return e;
  };
  const isStepValid = Object.keys(stepErrors()).length === 0;

  const next = () => { setFieldErrors({}); setStep((s) => Math.min(STEPS.length - 1, s + 1)); };
  const back = () => { setFieldErrors({}); setStep((s) => Math.max(0, s - 1)); };

  const saveStep = async () => {
    setError("");
    const errs = stepErrors();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    try {
      if (step === 0) {
        await saveSellerInfo({
          businessName: info.businessName,
          productCategories: info.productCategories,
        });
      } else if (step === 1) {
        await saveSellerContact({
          address: { line: contact.line, city: contact.city, state: contact.state, pincode: contact.pincode },
          ownerName: contact.ownerName,
          officialEmail: contact.officialEmail,
          officialPhone: contact.officialPhone,
        });
      }
      next();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      await submitSellerOnboarding();
      navigate("/seller/hub");
    } catch (err) {
      setError(err.response?.data?.message || "Could not submit. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-[#f8f6f6] min-h-screen flex flex-col items-center py-10 px-4 font-sora">
      <div className="w-full max-w-[640px]">
        <div className="text-center mb-6">
          <h1 className="text-[#EA2831] text-3xl font-bold tracking-tight">Khetify</h1>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-stone-400">Seller Onboarding</p>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-between mb-6">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1 flex items-center">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${i <= step ? "bg-[#EA2831] text-white" : "bg-stone-200 text-stone-500"}`}>{i + 1}</div>
              <span className={`ml-2 text-xs font-bold ${i <= step ? "text-stone-800" : "text-stone-400"}`}>{label}</span>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-2 ${i < step ? "bg-[#EA2831]" : "bg-stone-200"}`} />}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 sm:p-8">
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-stone-900">Business details</h2>
              <div><Label>Business legal name</Label><input className={field} value={info.businessName} onChange={(e) => setInfo({ ...info, businessName: e.target.value })} /><Err e={fieldErrors.businessName} /></div>

              <div>
                <Label>Primary product categories</Label>
                {/* The select is a picker, not the value — it snaps back to the
                    placeholder and the chosen categories live in the chip list. */}
                <select
                  className={field}
                  value=""
                  onChange={(e) => { onCategoryPick(e.target.value); e.target.value = ""; }}
                >
                  <option value="">Select a category…</option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c} disabled={info.productCategories.includes(c)}>{c}</option>
                  ))}
                  <option value={OTHER}>{OTHER}</option>
                </select>
                <Err e={categoriesError} />

                {otherOpen && (
                  <div className="mt-2">
                    <div className="flex gap-2">
                      <input
                        className={field}
                        autoFocus
                        value={otherText}
                        placeholder="Type a category, e.g. Micronutrient"
                        onChange={(e) => { setOtherText(e.target.value); setOtherError(""); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitOther(); } }}
                      />
                      <button type="button" onClick={commitOther} disabled={!otherText.trim() || otherBusy} className="shrink-0 rounded-lg bg-stone-800 px-4 text-sm font-bold text-white disabled:opacity-40">{otherBusy ? "Adding…" : "Add"}</button>
                      <button type="button" onClick={() => { setOtherOpen(false); setOtherText(""); setOtherError(""); }} className="shrink-0 px-2 text-sm font-bold text-stone-500">Cancel</button>
                    </div>
                    <Err e={otherError} />
                    <p className="mt-1 text-[11px] text-stone-400">Added categories become available to every seller.</p>
                  </div>
                )}

                {info.productCategories.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {info.productCategories.map((c) => (
                      <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-[#EA2831]/10 text-[#EA2831] text-xs font-bold px-3 py-1">
                        {c}
                        <button type="button" onClick={() => removeCategory(c)} aria-label={`Remove ${c}`} className="leading-none text-[#EA2831]/70 hover:text-[#EA2831]">×</button>
                      </span>
                    ))}
                  </div>
                )}
                <Err e={fieldErrors.productCategories} />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-stone-900">Contact &amp; address</h2>
              <div><Label>Name of contact person</Label><input className={field} value={contact.ownerName} onChange={(e) => setContact({ ...contact, ownerName: e.target.value })} /><Err e={fieldErrors.ownerName} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Official email</Label><input className={field} value={contact.officialEmail} onChange={(e) => setContact({ ...contact, officialEmail: e.target.value })} /><Err e={fieldErrors.officialEmail} /></div>
                <div><Label>Official phone</Label><input className={field} value={contact.officialPhone} onChange={(e) => setContact({ ...contact, officialPhone: e.target.value })} /><Err e={fieldErrors.officialPhone} /></div>
              </div>
              <div><Label>Address line</Label><input className={field} value={contact.line} onChange={(e) => setContact({ ...contact, line: e.target.value })} /><Err e={fieldErrors.line} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>City</Label><input className={field} value={contact.city} onChange={(e) => setContact({ ...contact, city: e.target.value })} /><Err e={fieldErrors.city} /></div>
                <div><Label>State</Label><input className={field} value={contact.state} onChange={(e) => setContact({ ...contact, state: e.target.value })} /><Err e={fieldErrors.state} /></div>
                <div><Label>Pincode</Label><input className={field} value={contact.pincode} onChange={(e) => setContact({ ...contact, pincode: e.target.value })} /><Err e={fieldErrors.pincode} /></div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3 text-sm">
              <h2 className="text-lg font-bold text-stone-900">Review &amp; submit</h2>
              <Row k="Business legal name" v={info.businessName || "—"} />
              <Row k="Primary product categories" v={info.productCategories.join(", ") || "—"} />
              <Row k="Name of contact person" v={contact.ownerName || "—"} />
              <Row k="Contact" v={`${contact.officialEmail || "—"} · ${contact.officialPhone || "—"}`} />
              <Row k="Address" v={[contact.line, contact.city, contact.state, contact.pincode].filter(Boolean).join(", ") || "—"} />
              {/* <p className="text-[11px] text-stone-400 pt-2">Submitting sends your profile for approval. You can explore the portal meanwhile. GSTIN, PAN and Udyam are added later from your Profile.</p> */}
            </div>
          )}

          {error && <p className="mt-4 text-sm font-medium text-red-600">⚠ {error}</p>}

          <div className="flex items-center justify-between mt-6">
            <button onClick={back} disabled={step === 0 || busy} className="text-sm font-bold text-stone-500 disabled:opacity-40">Back</button>
            {step < STEPS.length - 1 ? (
              <button onClick={saveStep} disabled={busy || !isStepValid} className="rounded-lg bg-[#EA2831] px-6 py-2.5 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed">
                {busy ? "Saving..." : "Save & continue"}
              </button>
            ) : (
              <button onClick={submit} disabled={busy} className="rounded-lg bg-[#EA2831] px-6 py-2.5 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-60">
                {busy ? "Submitting..." : "Submit"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const Row = ({ k, v }) => (
  <div className="flex justify-between border-b border-dashed border-stone-100 py-1.5">
    <span className="text-stone-400 font-semibold">{k}</span>
    <span className="text-stone-700 text-right">{v}</span>
  </div>
);

export default SellerOnboarding;
