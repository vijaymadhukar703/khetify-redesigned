import React, { useCallback, useEffect, useState } from 'react';
import ProfileView from '../../Components/ProfileView';
import LocationSettingsCard from '../../Components/common/LocationSettingsCard';
import { getSellerProfile, updateSellerProfile, getSellerMe, saveSellerLocation } from '../../lib/sellerApi';

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
  const [error, setError] = useState('');

  // Consent lives on the seller ACCOUNT, not on the profile document, so it is
  // read from /me — the same source the login prompt uses.
  const [locationAccess, setLocationAccess] = useState(null);
  const [isMember, setIsMember] = useState(false);

  const load = useCallback(() => getSellerProfile()
    .then((r) => setModel(r?.data || null))
    .catch((e) => setError(e?.response?.data?.message || e.message || 'Something went wrong'))
    .finally(() => setLoading(false)), []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    getSellerMe()
      .then((r) => {
        setLocationAccess(r?.data?.locationAccess || null);
        setIsMember(!!r?.data?.isMember);
      })
      // The profile itself must still render if this fails; the switch simply
      // does not appear.
      .catch(() => { setLocationAccess(null); setIsMember(false); });
  }, []);

  const onSave = async (formData) => {
    const r = await updateSellerProfile(formData);
    setModel(r?.data || null);
    return r;
  };

  const onSaveLocation = async (payload) => {
    const r = await saveSellerLocation(payload);
    setLocationAccess(r?.data || null);
    return r;
  };

  return (
    <>
      {/* `licences` switches on the five-row Other registration documents
          section (TAN, Gumasta, Udyam, Agriculture, Horticulture). The company
          profile renders the same component WITHOUT this prop and is
          unaffected. */}
      <ProfileView title="My Profile" model={model} loading={loading} error={error} onSave={onSave} licences />

      {/* Owner only. A team member's handset is not the business's location —
          the server refuses the write for them, so offering the switch would
          just be a button that errors. */}
      {!isMember && (
        <div className="mt-6">
          <LocationSettingsCard
            value={locationAccess}
            onSave={onSaveLocation}
            text={{
              subtitle: 'Used to suggest the nearest warehouses and speed up delivery details.',
            }}
          />
        </div>
      )}
    </>
  );
};

export default SellerProfile;