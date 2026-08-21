const express = require("express");
const router = express.Router();

const {
  registerSeller,
  loginSeller,
  getSellerMe,
  getSellerProfile,
  updateSellerProfile,
  updateSellerInfo,
  updateSellerContact,
  updateSellerVerification,
  submitSellerOnboarding,
  getSellerLink,
  ackApproval,
  sellerForgotPassword,
  sellerResetPassword,
  sellerChangePassword,
} = require("../../controller/Seller/sellerAuthController");
const {
  getSellerCompanyLinks,
  searchSellerCompanies,
  getRecommendedCompanies,
} = require("../../controller/Seller/sellerCompanyController");
const {
  getSellerNotifications,
  markSellerNotificationRead,
  markAllSellerNotificationsRead,
} = require("../../controller/Seller/sellerNotificationController");

const authMiddleware = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const uploadDocuments = require("../../middlewares/uploadDocuments");

// Managing the supplying-company relationship (search for / apply to companies)
// is a seller_admin action — company:manage (held via "*"). Managers/staff are
// blocked server-side, matching the hidden "Companies" nav. READING the link
// status (GET /companies, /link) stays open: other modules use it to know
// whether the seller is approved.
const manageCompanies = authorize("company:manage");

// Auth (public). The login rate-limit is applied in Server.js, mirroring the
// company login/register limiter.
router.post("/register", registerSeller);
router.post("/login", loginSeller);

// ── PASSWORD RESET (public, no auth) ──
// Getting back into your own account must never depend on being signed in, so
// these sit beside login and carry no auth and no capability. The seller
// counterpart of /api/users/forgot-password, which is company-members-only.
// Changing a password while SIGNED IN needs nothing here: that already works
// through /api/users/change-password, which is scoped to the caller's own
// account rather than to a company.
router.post("/forgot-password", sellerForgotPassword);
router.post("/reset-password", sellerResetPassword);

// CHANGING YOUR PASSWORD WHILE SIGNED IN. It lives here, not on
// /api/users/change-password, because principalRouteGuard refuses a seller
// token on any non-/api/seller route ("Company access only"). Authenticated,
// but no capability check: every principal may change their OWN password.
router.post("/change-password", authMiddleware, sellerChangePassword);

// Authenticated principal.
router.get("/me", authMiddleware, getSellerMe);
router.get("/profile", authMiddleware, getSellerProfile); // registration details + KYC docs (signed)
router.patch(
  "/profile",
  authMiddleware,
  uploadDocuments.fields([
    { name: "gstCertificate", maxCount: 1 },
    { name: "panFile", maxCount: 1 },
    { name: "otherDocs", maxCount: 10 },
  ]),
  updateSellerProfile,
); // edit identity/compliance + replace KYC docs (multipart → S3 keys)
router.post("/ack-approval", authMiddleware, ackApproval); // dismiss the one-time "Linked" banner

// Onboarding wizard — all scoped to req.user.sellerId.
router.put("/onboarding/info", authMiddleware, updateSellerInfo);
router.put("/onboarding/contact", authMiddleware, updateSellerContact);
router.put("/onboarding/verification", authMiddleware, updateSellerVerification);
router.post("/onboarding/submit", authMiddleware, submitSellerOnboarding);

// Companies section — derived from PC issuance (the authorization). There is no
// separate "request link → approve" step: a seller searches a company and
// applies for a PC (see /pc-applications). Reads are open; search is admin-only.
//   /companies         → the seller's companies (PC status per company) — read
//   /companies/search  → approved companies to apply to for a PC — admin
//   /companies/recommended → ranked candidates to apply to — admin
router.get("/companies", authMiddleware, getSellerCompanyLinks);
router.get("/companies/search", authMiddleware, manageCompanies, searchSellerCompanies);
router.get("/companies/recommended", authMiddleware, manageCompanies, getRecommendedCompanies);

// Notifications (same system as the company, scoped to the seller).
router.get("/notifications", authMiddleware, getSellerNotifications);
router.put("/notifications/read-all", authMiddleware, markAllSellerNotificationsRead);
router.put("/notifications/:id/read", authMiddleware, markSellerNotificationRead);

// Approval status read — still used by seller pages as a coarse "can I operate"
// check. linkStatus is now PC-derived (set when a PC is issued via reconcileLink);
// there is no POST to request a link anymore (apply for a PC instead).
router.get("/link", authMiddleware, getSellerLink);

module.exports = router;