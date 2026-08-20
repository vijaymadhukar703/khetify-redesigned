import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import config from "../../../config/config";

/* ─── OFFICIAL ID FORMATS ───────────────────────────────────────────────────
   Taken from the SERVER's own rules (khetify-backend/utils/fieldValidators.js)
   rather than re-derived, so the form can never reject something the API would
   have accepted.

   GSTIN  — 15 chars: 2-digit state + 10-char PAN + entity char + 'Z' + checksum.
            NOTE the entity char is [0-9A-Z] here, matching the backend. This
            file previously used [1-9A-Z], which rejected a perfectly valid
            GSTIN whose entity code is 0 (e.g. 27AAPFU0939F0ZV) — the API would
            have taken it, the form would not.
   PAN    — 10 chars: 5 letters + 4 digits + 1 letter.
   UDYAM  — 19 chars: UDYAM-<2-letter state>-<2 digits>-<7 digits>.
   CIN    — 21 chars: L/U + 5 digits + 2-letter state + 4-digit year
            + 3-letter ownership + 6-digit registration number.
   The Udyam/CIN field accepts EITHER, exactly as it did before. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const UDYAM_RE = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
const CIN_RE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;

const GSTIN_LEN = 15;
const PAN_LEN = 10;
// The field takes either form, so the cap is the longer of the two (CIN).
const UDYAM_CIN_MAX = 21;

/* Character masks. Applied as the value is set, so they govern TYPING AND
   PASTING alike — `maxLength` alone does not stop every paste path, and it
   cannot strip an illegal character out of the middle of a pasted string. */
const onlyAlnum = (v) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
// Udyam and CIN are the only ones that legitimately contain a separator.
const onlyAlnumDash = (v) => v.replace(/[^A-Za-z0-9-]/g, '').toUpperCase();

const CompanySetupStep4 = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

const [formData, setFormData] = useState({
  gstinNumber: "",
  udyamIncorporationNumber: "",
  panNumber: "",
});
  const [gstFile, setGstFile] = useState(null);
  const [regFile, setRegFile] = useState(null);
  const [panFile, setPanFile] = useState(null);

  // Verification ids AND their uploads are all required, ids must match format.
  const getErrors = () => {
    const e = {};
    // Ids are validated case-insensitively and normalized to uppercase, using
    // the module-level formats above (which mirror the server's).
    const gstin = formData.gstinNumber.trim().toUpperCase();
    const udyam = formData.udyamIncorporationNumber.trim().toUpperCase();
    const pan = formData.panNumber.trim().toUpperCase();

    if (!gstin) e.gstinNumber = "GSTIN is required";
    else if (gstin.length !== GSTIN_LEN) e.gstinNumber = `GSTIN must be exactly ${GSTIN_LEN} characters`;
    else if (!GSTIN_RE.test(gstin)) e.gstinNumber = "Enter a valid GSTIN (e.g. 27AAPFU0939F1ZV)";

    if (!gstFile) e.gstCertificate = "Upload the GST certificate";

    if (!udyam) e.udyamIncorporationNumber = "Udyam/Incorporation number is required";
    else if (!UDYAM_RE.test(udyam) && !CIN_RE.test(udyam))
      e.udyamIncorporationNumber = "Enter a valid Udyam (UDYAM-MP-03-0012345) or CIN (U72200MP2020PTC012345)";

    if (!regFile) e.registrationCertificate = "Upload the registration certificate";

    if (!pan) e.panNumber = "PAN number is required";
    else if (pan.length !== PAN_LEN) e.panNumber = `PAN must be exactly ${PAN_LEN} characters`;
    else if (!PAN_RE.test(pan)) e.panNumber = "Enter a valid PAN (e.g. ABCDE1234F)";

    if (!panFile) e.panCard = "Upload the PAN card";
    return e;
  };

  useEffect(() => {
    const fonts = [
      "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&family=Sora:wght@400;600;700&display=swap",
      "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght@100..700&display=swap"
    ];
    fonts.forEach(url => {
      const link = document.createElement("link");
      link.href = url;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    });
  }, []);

  /**
   * Every id field is MASKED AS IT IS SET, so typing and pasting behave the
   * same: illegal characters are dropped (wherever they appear in a pasted
   * string), the value is upper-cased, and it is cut to that id's exact maximum
   * length. `maxLength` is on the inputs as well, but it only limits typing —
   * this is what makes a paste obey the limit too.
   *
   * The stored value stays a plain string under the SAME field name, so the
   * payload sent to the API is unchanged.
   */
  const MASKS = {
    gstinNumber: (v) => onlyAlnum(v).slice(0, GSTIN_LEN),
    panNumber: (v) => onlyAlnum(v).slice(0, PAN_LEN),
    udyamIncorporationNumber: (v) => onlyAlnumDash(v).slice(0, UDYAM_CIN_MAX),
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    const mask = MASKS[name];
    setFormData((prev) => ({ ...prev, [name]: mask ? mask(value) : value }));
    // Clear that field's error as soon as the user edits it.
    setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
  };

/* PNG AND PDF ONLY. JPG/JPEG and WEBP were accepted before and are now
   refused, along with everything else. */
const ALLOWED_DOC_TYPES = ["application/pdf", "image/png"];
const ALLOWED_DOC_EXTS = [".pdf", ".png"];
// What the file picker itself offers, and what the hint under each field says.
const DOC_ACCEPT = ".png,.pdf,image/png,application/pdf";
const DOC_HINT = "Accepted formats: PNG, PDF";

const handleFileChange = (e) => {
  const { name } = e.target;
  const file = e.target.files[0];
  if (!file) return;

  /* CHECKED TWO WAYS ON PURPOSE. The browser-reported MIME type is the primary
     test, but some systems hand over an empty or generic type
     (application/octet-stream) for a perfectly good file, which would refuse a
     valid PNG. The extension is the fallback, so a renamed .doc still cannot
     get through while a correctly named PNG/PDF always can. */
  const nameLower = String(file.name || "").toLowerCase();
  const extOk = ALLOWED_DOC_EXTS.some((ext) => nameLower.endsWith(ext));
  // A type the browser could not work out. Windows in particular hands back
  // "application/octet-stream" for a perfectly good PDF, so treating that as a
  // real answer would refuse the file; the extension decides in that case.
  const typeUnknown = !file.type || file.type === "application/octet-stream";
  const typeOk = ALLOWED_DOC_TYPES.includes(file.type);

  if (!extOk || (!typeUnknown && !typeOk)) {
    toast.error("Only PNG or PDF files are allowed.");
    e.target.value = "";
    return;
  }

  if (name === "gstCertificate") setGstFile(file);
  if (name === "registrationCertificate") setRegFile(file);
  if (name === "panCard") setPanFile(file);
};

   const handleContinue = async (e) => {
     e.preventDefault();
     const errs = getErrors();
     setErrors(errs);
     if (Object.keys(errs).length > 0) {
       toast.error("Please complete all verification fields and uploads.");
       return;
     }
     setLoading(true);

     const companyId = localStorage.getItem("companyId");
     const token = localStorage.getItem("token");

     const data = new FormData();

     data.append("gstinNumber", formData.gstinNumber.trim().toUpperCase());
     data.append("udyamIncorporationNumber", formData.udyamIncorporationNumber.trim().toUpperCase());
     data.append("panNumber", formData.panNumber.trim().toUpperCase());

     if (gstFile) data.append("gstCertificate", gstFile);
     if (regFile) data.append("registrationCertificate", regFile);
     if (panFile) data.append("panCard", panFile);

     try {
       await axios.put(`${config.BASE_URL}company/update/${companyId}`, data, {
         headers: {
           Authorization: `Bearer ${token}`,
         },
       });

       toast.success("Verification documents uploaded!");
       setTimeout(() => {
         navigate("/company-final");
       }, 1500);
     } catch (error) {
       console.error("Step 4 Error:", error.response?.data);
       toast.error(
         error.response?.data?.message || "Failed to upload documents.",
       );
     } finally {
       setLoading(false);
     }
   };
  return (
    <div className="font-['Manrope',sans-serif] bg-[#f8f5f5] min-h-screen flex flex-col text-stone-900">
      <ToastContainer position="top-right" autoClose={3000} />

      <nav className="w-full bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <h1 className="text-[#f20d0d] text-xl font-bold tracking-tight">
          Khetify
        </h1>
      </nav>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        <div className="w-full max-w-[480px] bg-white rounded-xl shadow-lg border border-stone-100 flex flex-col overflow-hidden my-8">
          <div className="p-8 sm:p-10 flex flex-col h-full">
            <div className="w-full flex justify-center mb-6">
              <span className="text-stone-500 text-sm font-medium bg-stone-50 px-3 py-1 rounded-full border border-stone-100">
                Step 4 of 5
              </span>
            </div>

            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-stone-900 leading-tight font-['Sora',sans-serif] mb-2">
                Business verification
              </h2>
              <p className="text-stone-500 text-sm font-['Sora',sans-serif]">
                Upload your certificates for faster verification.
              </p>
            </div>

            <form className="space-y-8 mb-8" noValidate onSubmit={handleContinue}>
              {/* GST Section */}
              <div className="space-y-4">
                <h3 className="text-base font-bold text-stone-900 font-['Sora',sans-serif] border-b border-stone-100 pb-2">
                  GST Details
                </h3>
                <div className="flex flex-col space-y-2">
                  <label className="text-sm text-stone-700">GSTIN Number<span className="text-[#EA2831] ml-0.5">*</span></label>
                  <input
                    name="gstinNumber"
                    type="text"
                    placeholder="27AAPFU0939F1ZV"
                    maxLength={GSTIN_LEN}
                    inputMode="text"
                    autoComplete="off"
                    value={formData.gstinNumber}
                    className="w-full h-11 px-3 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#f20d0d] uppercase tracking-wide"
                    onChange={handleChange}
                  />
                  <p className="text-stone-400 text-[11px] leading-snug">
                    15 characters — 2-digit state code, 10-character PAN, entity code, Z, checksum.
                  </p>
                  {errors.gstinNumber && <p className="text-red-500 text-xs font-medium">⚠ {errors.gstinNumber}</p>}
                </div>
                <div className="flex flex-col space-y-2">
                  <label className="text-sm text-stone-700">
                    Upload GST Certificate<span className="text-[#EA2831] ml-0.5">*</span>
                  </label>
                  <input
                    type="file"
                    name="gstCertificate"
                    accept={DOC_ACCEPT}
                    onChange={handleFileChange}
                    className="block w-full text-sm text-stone-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-red-50 file:text-red-700 hover:file:bg-red-100 cursor-pointer"
                  />
                  {/* Stated BEFORE a file is chosen, so the rule is known up
                      front rather than only after a rejected pick. */}
                  <p className="text-stone-400 text-[11px] leading-snug">{DOC_HINT}</p>
                  {errors.gstCertificate && <p className="text-red-500 text-xs font-medium">⚠ {errors.gstCertificate}</p>}
                </div>
              </div>

              {/* Registration Section */}
              <div className="space-y-4">
                <h3 className="text-base font-bold text-stone-900 font-['Sora',sans-serif] border-b border-stone-100 pb-2">
                  Business Registration
                </h3>
                <div className="flex flex-col space-y-2">
                  <label className="text-sm text-stone-700">
                    Udyam/Incorporation Number<span className="text-[#EA2831] ml-0.5">*</span>
                  </label>
                  <input
                    name="udyamIncorporationNumber"
                    type="text"
                    placeholder="UDYAM-MP-03-0012345 or CIN number"
                    maxLength={UDYAM_CIN_MAX}
                    autoComplete="off"
                    value={formData.udyamIncorporationNumber}
                    className="w-full h-11 px-3 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#f20d0d] uppercase tracking-wide"
                    onChange={handleChange}
                  />
                  <p className="text-stone-400 text-[11px] leading-snug">
                    Udyam: UDYAM-XX-00-0000000 (19 characters) &nbsp;·&nbsp; or CIN: U72200MP2020PTC012345 (21 characters).
                  </p>
                  {errors.udyamIncorporationNumber && <p className="text-red-500 text-xs font-medium">⚠ {errors.udyamIncorporationNumber}</p>}
                </div>
                <div className="flex flex-col space-y-2">
                  <label className="text-sm text-stone-700">
                    Upload Udyam/Incorporation Certificate<span className="text-[#EA2831] ml-0.5">*</span>
                  </label>
                  <input
                    type="file"
                    name="registrationCertificate"
                    accept={DOC_ACCEPT}
                    onChange={handleFileChange}
                    className="block w-full text-sm text-stone-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-red-50 file:text-red-700 hover:file:bg-red-100 cursor-pointer"
                  />
                  {/* Stated BEFORE a file is chosen, so the rule is known up
                      front rather than only after a rejected pick. */}
                  <p className="text-stone-400 text-[11px] leading-snug">{DOC_HINT}</p>
                  {errors.registrationCertificate && <p className="text-red-500 text-xs font-medium">⚠ {errors.registrationCertificate}</p>}
                </div>
              </div>

              {/* PAN Section - UPDATED */}
              <div className="space-y-4">
                <h3 className="text-base font-bold text-stone-900 font-['Sora',sans-serif] border-b border-stone-100 pb-2">
                  Tax Identification
                </h3>
                <div className="flex flex-col space-y-2">
                  <label className="text-sm text-stone-700">
                    PAN Card Number<span className="text-[#EA2831] ml-0.5">*</span>
                  </label>
                  <input
                    name="panNumber"
                    type="text"
                    placeholder="ABCDE1234F"
                    maxLength={PAN_LEN}
                    autoComplete="off"
                    value={formData.panNumber}
                    className="w-full h-11 px-3 border border-stone-300 rounded-lg outline-none focus:ring-2 focus:ring-[#f20d0d] uppercase tracking-wide"
                    onChange={handleChange}
                  />
                  <p className="text-stone-400 text-[11px] leading-snug">
                    10 characters — 5 letters, 4 digits, 1 letter.
                  </p>
                  {errors.panNumber && <p className="text-red-500 text-xs font-medium">⚠ {errors.panNumber}</p>}
                </div>
                {/* --- NEW: PAN Upload Input --- */}
                <div className="flex flex-col space-y-2">
                  <label className="text-sm text-stone-700">
                    Upload PAN Card<span className="text-[#EA2831] ml-0.5">*</span>
                  </label>
                  <input
                    type="file"
                    name="panCard"
                    accept={DOC_ACCEPT}
                    onChange={handleFileChange}
                    className="block w-full text-sm text-stone-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-red-50 file:text-red-700 hover:file:bg-red-100 cursor-pointer"
                  />
                  {/* Stated BEFORE a file is chosen, so the rule is known up
                      front rather than only after a rejected pick. */}
                  <p className="text-stone-400 text-[11px] leading-snug">{DOC_HINT}</p>
                  {errors.panCard && <p className="text-red-500 text-xs font-medium">⚠ {errors.panCard}</p>}
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#f20d0d] hover:bg-red-700 text-white font-bold h-12 rounded-lg transition-all active:scale-[0.98] shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? "Uploading Documents..." : "Continue"}
              </button>
            </form>
          </div>

          <div className="h-1 w-full bg-stone-100">
            <div className="h-full w-4/5 bg-[#f20d0d] rounded-r-full transition-all duration-700"></div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default CompanySetupStep4;