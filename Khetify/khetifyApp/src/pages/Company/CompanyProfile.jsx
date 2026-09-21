import React, { useCallback, useEffect, useState } from "react";
import ProfileView from "../../Components/ProfileView";
import {
  getCompanyProfile,
  updateCompanyProfile,
  sendCompanyPhoneOtp,
  verifyCompanyPhoneOtp,
} from "../../lib/imsApi";

// Company Profile — registration details (identity, GSTIN/PAN, KYC documents)
// resolved from the verified token via GET /api/company/profile, editable via
// PATCH /api/company/profile. Renders through the shared ProfileView so it
// matches the seller profile exactly.
//
// 📱 PHONE VERIFICATION is passed DOWN as a prop rather than built into
// ProfileView, because that component is shared with the seller portal — which
// has no such flow. Seller profile isliye bilkul pehle jaisi rehti hai.
const CompanyProfile = () => {
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // { text, kind: 'success' | 'error' } — ek waqt me ek hi toast.
  const [toast, setToast] = useState(null);

  const load = useCallback(
    () =>
      getCompanyProfile()
        .then((r) => setModel(r?.data || null))
        .catch((e) =>
          setError(
            e?.response?.data?.message || e.message || "Something went wrong",
          ),
        )
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Toast khud hat jata hai. Error ko zyada waqt milta hai kyunki usme padhne
  // layak kuch hota hai; success sirf pushti hai.
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(
      () => setToast(null),
      toast.kind === "error" ? 5000 : 3000,
    );
    return () => clearTimeout(id);
  }, [toast]);

  // Save returns the updated profile so the page + completion bar refresh.
  const onSave = async (formData) => {
    const r = await updateCompanyProfile(formData);
    setModel(r?.data || null);
    return r;
  };

  // Verify poora profile lautata hai (GET /profile wala hi shape), isliye badge
  // badalne ke liye doosri request nahi karni padti.
  const onVerifyPhone = async (code) => {
    const r = await verifyCompanyPhoneOtp(code);
    if (r?.data) setModel(r.data);
    return r;
  };

  const identity = model?.identity || {};

  return (
    <>
      <ProfileView
        title="Company Profile"
        model={model}
        loading={loading}
        error={error}
        onSave={onSave}
        phoneVerification={{
          verified: identity.phoneVerified === true,
          phoneMasked: identity.accountPhoneMasked || "",
          onSendOtp: sendCompanyPhoneOtp,
          onVerify: onVerifyPhone,
          onToast: (text, kind) => setToast({ text, kind }),
        }}
      />

      {toast && (
        <div
          className={`fixed top-6 left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-[400px] p-3 rounded-lg flex items-center gap-3 shadow-2xl text-white ${
            toast.kind === "error" ? "bg-[#333]" : "bg-[#1b4d2e]"
          }`}
        >
          <div
            className={`rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shadow-md ${
              toast.kind === "error" ? "bg-red-500" : "bg-green-500"
            }`}
          >
            {toast.kind === "error" ? "!" : "✓"}
          </div>
          <p className="text-sm font-medium">{toast.text}</p>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-auto text-gray-300 text-lg hover:text-white leading-none"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
};

export default CompanyProfile;
