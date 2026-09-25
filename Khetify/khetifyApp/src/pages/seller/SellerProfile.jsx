import React, { useCallback, useEffect, useState } from "react";
import ProfileView from "../../Components/ProfileView";
import LocationSettingsCard from "../../Components/common/LocationSettingsCard";
import {
  getSellerProfile,
  updateSellerProfile,
  getSellerMe,
  saveSellerLocation,
  sendSellerPhoneOtp,
  verifySellerPhoneOtp,
} from "../../lib/sellerApi";

// Seller Profile — registration details (identity, GSTIN/PAN, KYC documents)
// resolved from the seller token via GET /api/seller/profile, editable via
// PATCH /api/seller/profile. Uses the SAME shared ProfileView as the company,
// so the two profiles look + behave identically.
//
// The live-location switch is rendered BESIDE ProfileView rather than inside
// it: ProfileView is shared with the company portal, and location consent is a
// seller/customer concept only. Putting it in the shared component would have
// pushed it onto the company side too.
const SellerProfile = () => {
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Consent lives on the seller ACCOUNT, not on the profile document, so it is
  // read from /me — the same source the login prompt uses.
  const [locationAccess, setLocationAccess] = useState(null);
  const [isMember, setIsMember] = useState(false);
  // { text, kind: 'success' | 'error' } — ek waqt me ek hi toast.
  const [toast, setToast] = useState(null);

  const load = useCallback(
    () =>
      getSellerProfile()
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

  useEffect(() => {
    getSellerMe()
      .then((r) => {
        setLocationAccess(r?.data?.locationAccess || null);
        setIsMember(!!r?.data?.isMember);
      })
      // The profile itself must still render if this fails; the switch simply
      // does not appear.
      .catch(() => {
        setLocationAccess(null);
        setIsMember(false);
      });
  }, []);

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

  const onSave = async (formData) => {
    const r = await updateSellerProfile(formData);
    setModel(r?.data || null);
    return r;
  };

  // Verify poora profile lautata hai (GET /profile wala hi shape), isliye badge
  // badalne ke liye doosri request nahi karni padti.
  const onVerifyPhone = async (code) => {
    const r = await verifySellerPhoneOtp(code);
    if (r?.data) setModel(r.data);
    return r;
  };

  const onSaveLocation = async (payload) => {
    const r = await saveSellerLocation(payload);
    setLocationAccess(r?.data || null);
    return r;
  };

  return (
    <>
      {/* `licences` switches on the seller-only licence rows: Agriculture and
          Horticulture inside Compliance & registration, then Udyam, TAN and
          Gumasta under Other registration documents (see
          COMPLIANCE_LICENCE_KEYS / OTHER_LICENCE_KEYS in ProfileView). The
          company profile renders the same component WITHOUT this prop and is
          unaffected. */}
      {/* `phoneVerification` company profile jaisa hi hai — ProfileView dono
          portals ki hai aur yeh prop pehle se support karti hai, isliye us
          shared component me ek line bhi badalni nahi padi. */}
      <ProfileView
        title="My Profile"
        model={model}
        loading={loading}
        error={error}
        onSave={onSave}
        licences
        phoneVerification={{
          verified: (model?.identity || {}).phoneVerified === true,
          phoneMasked: (model?.identity || {}).accountPhoneMasked || "",
          // Badge ko yeh milana padta hai ki jo number dikh raha hai wahi
          // verify hua tha. Bina iske badge kabhi hara nahi hoga.
          accountPhone: (model?.identity || {}).accountPhone || "",
          onSendOtp: sendSellerPhoneOtp,
          onVerify: onVerifyPhone,
          onToast: (text, kind) => setToast({ text, kind }),
        }}
      />

      {/* Owner only. A team member's handset is not the business's location —
          the server refuses the write for them, so offering the switch would
          just be a button that errors. */}
      {!isMember && (
        <div className="mt-6">
          <LocationSettingsCard
            value={locationAccess}
            onSave={onSaveLocation}
            text={{
              subtitle:
                "Used to suggest the nearest warehouses and speed up delivery details.",
            }}
          />
        </div>
      )}

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

export default SellerProfile;
