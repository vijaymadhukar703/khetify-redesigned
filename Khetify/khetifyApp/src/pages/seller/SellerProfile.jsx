import React, { useCallback, useEffect, useState } from 'react';
import ProfileView from '../../Components/ProfileView';
import { getSellerProfile, updateSellerProfile } from '../../lib/sellerApi';

// Seller Profile — registration details (identity, GSTIN/PAN, KYC documents)
// resolved from the seller token via GET /api/seller/profile, editable via
// PATCH /api/seller/profile. Uses the SAME shared ProfileView as the company,
// so the two profiles look + behave identically.
const SellerProfile = () => {
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => getSellerProfile()
    .then((r) => setModel(r?.data || null))
    .catch((e) => setError(e?.response?.data?.message || e.message || 'Something went wrong'))
    .finally(() => setLoading(false)), []);

  useEffect(() => { load(); }, [load]);

  const onSave = async (formData) => {
    const r = await updateSellerProfile(formData);
    setModel(r?.data || null);
    return r;
  };

  // `licences` switches on the five-row Other registration documents section
  // (TAN, Gumasta, Udyam, Agriculture, Horticulture). The company profile
  // renders the same component WITHOUT this prop and is unaffected.
  return <ProfileView title="My Profile" model={model} loading={loading} error={error} onSave={onSave} licences />;
};

export default SellerProfile;
