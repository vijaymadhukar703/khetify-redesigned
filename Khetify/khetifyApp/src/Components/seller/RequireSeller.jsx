import React from "react";
import { Navigate } from "react-router-dom";
import { isSellerAuthed } from "../../lib/sellerApi";
import SellerLocationGate from "./SellerLocationGate";

// Page-level guard for the seller portal: no seller token → bounce to login.
// Mirrors the company-side route protection but reads the seller token only.
//
// Authenticated pages are additionally wrapped in SellerLocationGate, which
// asks for live location on the landing screens (onboarding after registering,
// hub/dashboard after logging in). It NEVER blocks: children render exactly as
// before and the prompt is only ever an overlay, so a denied or unavailable
// location changes nothing about access.
const RequireSeller = ({ children }) => {
  if (!isSellerAuthed()) return <Navigate to="/seller/login" replace />;
  return <SellerLocationGate>{children}</SellerLocationGate>;
};

export default RequireSeller;