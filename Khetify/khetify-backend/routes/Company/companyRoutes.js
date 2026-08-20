const express = require("express");
const router = express.Router();

const {
  registerCompany,
  loginCompany,
  forgotPassword,
  resetPassword,
  getAllCompanies,
  getCompanyById,
  updateCompany,
  getImsSettings,
  updateImsSettings,
  getCompanyProfile,
  updateCompanyProfile,
} = require("../../controller/Company/companyController");
const {
  listSellers,
} = require("../../controller/Company/companySellerController");

const authMiddleware = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const upload = require("../../middlewares/upload");
const uploadDocuments = require("../../middlewares/uploadDocuments");

// Auth
router.post("/register", registerCompany);
router.post("/login", loginCompany);

// Password reset (email link flow). forgot-password emails a one-time token;
// reset-password consumes it to set a new password.
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// IMS settings (lot numbering, ...). Declared BEFORE "/:id" so "settings"
// isn't swallowed by the id param. Reading is open to any team member;
// changing settings is owner-only (company:settings resolves only via the
// company_admin/super_admin "*" wildcard).
router.get("/settings/ims", authMiddleware, getImsSettings);
router.put("/settings/ims", authMiddleware, authorize("company:settings"), updateImsSettings);

// Own registration profile (identity + GSTIN/PAN + KYC docs as signed URLs).
// Declared BEFORE "/:id" so "profile" isn't captured as an id. Resolved from
// the token — any authenticated company member can view its own company; PATCH
// edits identity/compliance + replaces docs (multipart → S3, stored as keys).
router.get("/profile", authMiddleware, getCompanyProfile);
router.patch(
  "/profile",
  authMiddleware,
  uploadDocuments.fields([
    { name: "gstCertificate", maxCount: 1 },
    { name: "panFile", maxCount: 1 },
    { name: "otherDocs", maxCount: 10 },
  ]),
  updateCompanyProfile,
);

// Downstream SELLERS (dealers this company supplies) — the APPROVED resellers,
// i.e. sellers this company has ISSUED a Principal Certificate to. Authorization
// is the PC itself; there is no separate link-approval step (sellers apply for a
// PC via the PC Applications queue). Declared BEFORE "/:id".
// Sellers is an ADMINISTRATION module — gated on the paid ADMINISTRATION
// feature, the same loadSubscription + requireFeature pattern used elsewhere.
const loadSubscriptionMw = require("../../middlewares/loadSubscription");
const requireFeatureMw = require("../../middlewares/requireFeature");
const { FEATURES: PLAN_FEATURES } = require("../../config/plans");
router.get("/sellers", authMiddleware, authorize("inventory:read"), loadSubscriptionMw, requireFeatureMw(PLAN_FEATURES.ADMINISTRATION), listSellers);

// Protected
router.get("/", authMiddleware, getAllCompanies);
router.get("/:id", authMiddleware, getCompanyById);
router.put(
  "/update/:id",
  authMiddleware,
  upload.fields([
    { name: "companyLogo", maxCount: 1 },
    { name: "coverImage", maxCount: 1 },
    { name: "certifications", maxCount: 10 },
    { name: "gstCertificate", maxCount: 1 },
    { name: "registrationCertificate", maxCount: 1 },
    { name: "panCard", maxCount: 1 },
  ]),
  updateCompany,
);
module.exports = router;