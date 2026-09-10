const express = require("express");

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const requireActivePC = require("../../middlewares/requireActivePC");
const uploadDocuments = require("../../middlewares/uploadDocuments");
const docs = require("../../controller/Seller/sellerDocumentController");
const pc = require("../../controller/Seller/sellerPcController");

// Any authenticated SELLER principal (approval NOT required — applying for a PC
// is how a seller becomes authorized in the first place).
const sellerOnly = (req, res, next) =>
  req.user && req.user.sellerId ? next() : res.status(403).json({ success: false, message: "Seller access only" });

// Certifications (KYC docs, PC applications, issued certificates) are the
// seller_admin's domain — certification:manage (held via "*"). Managers/staff
// are blocked server-side, matching the hidden "Certifications" nav.
const manageCerts = authorize("certification:manage");

/* /api/seller/documents */
const documents = express.Router();
documents.use(auth, sellerOnly, manageCerts);
documents.post("/", uploadDocuments.array("files", 10), docs.uploadDocuments);
documents.get("/", docs.getDocuments);
documents.delete("/:id", docs.deleteDocument);

/* /api/seller/pc-applications */
const applications = express.Router();
applications.use(auth, sellerOnly, manageCerts);
applications.get("/form/:companyId", pc.getApplyForm); // company form + profile autofill + prereq
applications.post("/", pc.createApplication);
applications.get("/", pc.listApplications);
applications.get("/:id", pc.getApplication);
applications.post("/:id/documents", pc.attachDocuments);
applications.get("/:id/agreement", pc.getAgreement);
applications.post("/:id/agreement/sign", uploadDocuments.single("file"), pc.signAgreement);

/* /api/seller/certificates */
const certificates = express.Router();
certificates.use(auth, sellerOnly, manageCerts);
certificates.get("/", pc.listCertificates);
certificates.get("/:id", pc.getCertificate);
certificates.get("/:id/download", pc.downloadCertificate);

/* /api/seller/listings — marketplace publish, gated by an ACTIVE PC.
   READ IS SPLIT FROM WRITE on this router: seeing whether a product is live is
   "listing:read" (managers/staff hold it, so My Products can render a truthful
   Published / Not published badge), while publish and unpublish stay on
   manageCerts. The capability therefore sits per-route, not on the router. */
const listings = express.Router();
listings.use(auth, sellerOnly);
listings.get("/", authorize("listing:read"), pc.listListings);
/**
 * PC GATE, ONLY WHERE THERE IS A COMPANY TO BE CERTIFIED BY.
 *
 * A Principal Certificate authorises a seller to resell A COMPANY'S products —
 * so publishing a COMPANY product still requires an active PC for that company,
 * byte for byte the same call as before. Publishing the seller's OWN product
 * (My Products) has no company and therefore nothing a PC could certify, so
 * demanding one would make the gate unsatisfiable: requireActivePC 400s on a
 * missing companyId, which is why My Products could not publish at all.
 *
 * Ownership of a seller-own product is not left unchecked — it moves to
 * publishListing, which proves the product is `ownerType: "seller"` AND
 * `sellerId` = the caller before writing anything.
 *
 * middlewares/requireActivePC.js is untouched and still used verbatim.
 */
const pcGateWhenCompanyProduct = (req, res, next) =>
  req.body?.companyId
    ? requireActivePC((r) => r.body.companyId)(req, res, next)
    : next();

listings.post("/publish", manageCerts, pcGateWhenCompanyProduct, pc.publishListing);
// Unpublish is intentionally NOT PC-gated — a seller can always pull a listing.
listings.patch("/:id/unpublish", manageCerts, pc.unpublishListing);

module.exports = { documents, applications, certificates, listings };
