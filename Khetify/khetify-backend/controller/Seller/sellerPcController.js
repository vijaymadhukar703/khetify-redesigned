const mongoose = require("mongoose");
const PCApplication = require("../../model/PC/PCApplication");
const SellerAgreement = require("../../model/PC/SellerAgreement");
const PrincipalCertificate = require("../../model/PC/PrincipalCertificate");
const SellerListing = require("../../model/PC/SellerListing");
// Ownership proof for publishing the seller's OWN product — see publishListing.
const Product = require("../../model/Company/productModel");
// Live sellable stock for the listings table — same source the storefront reads.
const Inventory = require("../../model/Inventory/Inventory");
const pcService = require("../../services/pcService");
const fileService = require("../../services/fileService");

const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
const COMPANY_SELECT = "companyInfo.companyName fullName";

/* ---- application form (company-defined, profile-autofilled) ---- */
exports.getApplyForm = async (req, res) => {
  try {
    const data = await pcService.getApplyForm(req.user.sellerId, req.params.companyId);
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};

/* ---- applications ---- */
exports.createApplication = async (req, res) => {
  try {
    const { companyId, productCategories, documentIds, formAnswers } = req.body;
    if (!companyId) return res.status(400).json({ success: false, message: "companyId is required" });
    const app = await pcService.applyForPc({
      sellerId: req.user.sellerId, companyId,
      productCategories: productCategories || [],
      documentIds: documentIds || [],
      formAnswers: formAnswers || {},
    });
    res.status(201).json({ success: true, message: "Application submitted", data: app });
  } catch (err) { fail(res, err); }
};

exports.listApplications = async (req, res) => {
  try {
    const rows = await PCApplication.find({ sellerId: req.user.sellerId })
      .sort({ createdAt: -1 })
      .populate({ path: "companyId", select: COMPANY_SELECT });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

exports.getApplication = async (req, res) => {
  try {
    const app = await PCApplication.findOne({ _id: req.params.id, sellerId: req.user.sellerId })
      .populate({ path: "companyId", select: COMPANY_SELECT })
      .populate({ path: "documentIds" });
    if (!app) return res.status(404).json({ success: false, message: "Application not found" });
    const agreement = await pcService.resolveAgreementUrls(await SellerAgreement.findOne({ applicationId: app._id }));
    const cert = await PrincipalCertificate.findOne({ applicationId: app._id });
    const certificate = cert ? await pcService.resolveCertUrls(pcService.withComputedStatus(cert)) : null;
    res.json({ success: true, data: { application: app, agreement, certificate } });
  } catch (err) { fail(res, err); }
};

exports.attachDocuments = async (req, res) => {
  try {
    const app = await pcService.attachDocs({ sellerId: req.user.sellerId, applicationId: req.params.id, documentIds: req.body.documentIds || [] });
    res.json({ success: true, message: "Documents submitted", data: app });
  } catch (err) { fail(res, err); }
};

/* ---- agreement ---- */
exports.getAgreement = async (req, res) => {
  try {
    const agreement = await pcService.getAgreement(req.params.id, req.user.sellerId);
    if (!agreement) return res.status(404).json({ success: false, message: "Agreement not found" });
    res.json({ success: true, data: await pcService.resolveAgreementUrls(agreement) });
  } catch (err) { fail(res, err); }
};

exports.signAgreement = async (req, res) => {
  try {
    // Signing is by UPLOADING a signed copy of the agreement (no digital sign).
    if (!req.file) return res.status(400).json({ success: false, message: "Upload the signed agreement copy to submit" });
    const { app, agreement } = await pcService.signAgreement({
      sellerId: req.user.sellerId,
      applicationId: req.params.id,
      ip: req.ip,
      file: req.file,
    });
    res.json({ success: true, message: "Signed agreement uploaded", data: { status: app.status, agreement } });
  } catch (err) { fail(res, err); }
};

/* ---- certificates ---- */
exports.listCertificates = async (req, res) => {
  try {
    const rows = await PrincipalCertificate.find({ sellerId: req.user.sellerId })
      .sort({ createdAt: -1 })
      .populate({ path: "companyId", select: COMPANY_SELECT });
    const data = await Promise.all(rows.map((c) => pcService.resolveCertUrls(pcService.withComputedStatus(c))));
    res.json({ success: true, count: data.length, data });
  } catch (err) { fail(res, err); }
};

exports.getCertificate = async (req, res) => {
  try {
    const cert = await PrincipalCertificate.findOne({ _id: req.params.id, sellerId: req.user.sellerId }).populate({ path: "companyId", select: COMPANY_SELECT });
    if (!cert) return res.status(404).json({ success: false, message: "Certificate not found" });
    const agreement = await pcService.resolveAgreementUrls(await SellerAgreement.findOne({ _id: cert.agreementId }));
    const certificate = await pcService.resolveCertUrls(pcService.withComputedStatus(cert));
    res.json({ success: true, data: { certificate, agreementUrl: agreement?.signedPdfUrl || agreement?.unsignedPdfUrl || null } });
  } catch (err) { fail(res, err); }
};

exports.downloadCertificate = async (req, res) => {
  try {
    const cert = await PrincipalCertificate.findOne({ _id: req.params.id, sellerId: req.user.sellerId });
    if (!cert) return res.status(404).json({ success: false, message: "Certificate not found" });
    // The official certificate is downloadable only while ACTIVE (not revoked/expired).
    if (cert.status !== "active") {
      return res.status(403).json({ success: false, message: "This certificate is not active." });
    }
    res.json({ success: true, data: { pcNumber: cert.pcNumber, url: await fileService.signedUrl(cert.pdfKey) } });
  } catch (err) { fail(res, err); }
};

/* ---- marketplace listings (gated by requireActivePC) ---- */
exports.publishListing = async (req, res) => {
  try {
    const { companyId, productId, price } = req.body;
    if (!productId) return res.status(400).json({ success: false, message: "productId is required" });

    /* ── THE SELLER'S OWN PRODUCT (My Products) ────────────────────────────
       No companyId means there is no company, and therefore no PC gate on the
       route. THIS is where that trust is paid back: without the check below any
       seller could publish any other seller's — or any company's — product just
       by omitting companyId. Both halves are required. `sellerId` alone could
       be satisfied by a stray row; `ownerType` alone is scoped to nobody.

       The filter/insert then pins companyId to NULL explicitly. Passing
       `companyId: undefined` would have Mongoose DROP the key from the query,
       leaving { sellerId, productId } — which can match this seller's existing
       COMPANY listing of the same product and quietly convert it. */
    if (!companyId) {
      const product = await Product.findOne({
        _id: productId,
        ownerType: "seller",
        sellerId: req.user.sellerId,
      }).select("_id").lean();
      if (!product) {
        return res.status(403).json({ success: false, message: "Not your product" });
      }

      const own = await SellerListing.findOneAndUpdate(
        { sellerId: req.user.sellerId, companyId: null, productId },
        {
          $set: { status: "published", price, publishedAt: new Date() },
          $setOnInsert: { ownerType: "seller" },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      return res.status(201).json({ success: true, message: "Product listed", data: own });
    }

    /* ── COMPANY PRODUCT — unchanged, PC-gated on the route above. ───────── */
    const listing = await SellerListing.findOneAndUpdate(
      { sellerId: req.user.sellerId, companyId, productId },
      { $set: { status: "published", price, publishedAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ success: true, message: "Product listed", data: listing });
  } catch (err) { fail(res, err); }
};

/* Remove a listing from the marketplace. Scoped to the seller's own listings.
   Not PC-gated — a seller can always pull their product even if the PC lapsed. */
exports.unpublishListing = async (req, res) => {
  try {
    const listing = await SellerListing.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.user.sellerId },
      { $set: { status: "unpublished" } },
      { new: true }
    );
    if (!listing) return res.status(404).json({ success: false, message: "Listing not found" });
    res.json({ success: true, message: "Product unpublished", data: listing });
  } catch (err) { fail(res, err); }
};

/**
 * GET /api/seller/listings — the seller's marketplace listings.
 *
 * Returns two things the listing row itself does not hold:
 *
 *   productImages — pulled in via the existing populate. A marketplace page
 *                   showing grey placeholder boxes is a page the seller cannot
 *                   scan; the image IS how you recognise your own product.
 *
 *   availableStock — summed from Inventory with the SAME aggregate the
 *                   storefront uses (services/shopCatalogService.js). That
 *                   matters more than it looks: the number the seller sees here
 *                   and the number that decides "in stock?" for a shopper are
 *                   now literally the same figure, so they cannot disagree.
 *                   A seller reading "12 in stock" while the storefront quietly
 *                   says out-of-stock would be worse than showing nothing.
 *
 * One extra aggregate for the whole page, not one query per row.
 */
exports.listListings = async (req, res) => {
  try {
    const rows = await SellerListing.find({ sellerId: req.user.sellerId })
      .sort({ createdAt: -1 })
      .populate({ path: "productId", select: "productName skuNumber productImages" })
      .lean();

    // Sum availableStock per product across every warehouse/batch this seller
    // holds. availableStock is already onlineStock + offlineStock - reserved,
    // so it is the sellable number, not the shelf count.
    const productIds = rows
      .map((r) => (r.productId && typeof r.productId === "object" ? r.productId._id : r.productId))
      .filter(Boolean);

    const stockMap = new Map();
    if (productIds.length) {
      /* ObjectId cast is NOT optional here. An aggregate $match does no schema
         casting (unlike find()), and req.user.sellerId arrives from the JWT as a
         STRING — so matching it raw would quietly match nothing and every row
         would read "0 in stock" with no error anywhere. Same cast
         services/shopCatalogService.js does for the same reason. */
      const sellerObjectId = new mongoose.Types.ObjectId(String(req.user.sellerId));
      const inv = await Inventory.aggregate([
        { $match: { ownerType: "seller", ownerId: sellerObjectId, productId: { $in: productIds } } },
        { $group: { _id: "$productId", avail: { $sum: "$availableStock" } } },
      ]);
      for (const r of inv) stockMap.set(String(r._id), r.avail);
    }

    const data = rows.map((r) => {
      const pid = r.productId && typeof r.productId === "object" ? r.productId._id : r.productId;
      return { ...r, availableStock: stockMap.get(String(pid)) || 0 };
    });

    res.json({ success: true, count: data.length, data });
  } catch (err) { fail(res, err); }
};