const PCApplication = require("../../model/PC/PCApplication");
const SellerDocument = require("../../model/PC/SellerDocument");
const SellerAgreement = require("../../model/PC/SellerAgreement");
const PrincipalCertificate = require("../../model/PC/PrincipalCertificate");
const pcService = require("../../services/pcService");
const fileService = require("../../services/fileService");

const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
const SELLER_SELECT = "sellerInfo.businessName contact.ownerName email phone";

/* ---- review queue ---- */
exports.listApplications = async (req, res) => {
  try {
    const filter = { companyId: req.user.companyId };
    if (req.query.status) filter.status = req.query.status;
    const rows = await PCApplication.find(filter)
      .sort({ createdAt: -1 })
      .populate({ path: "sellerId", model: "Seller", select: SELLER_SELECT });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

exports.getApplication = async (req, res) => {
  try {
    const app = await PCApplication.findOne({ _id: req.params.id, companyId: req.user.companyId })
      .populate({ path: "sellerId", model: "Seller", select: SELLER_SELECT });
    if (!app) return res.status(404).json({ success: false, message: "Application not found" });
    // Seller documents with viewable URLs resolved from their stored keys.
    const docs = await SellerDocument.find({ _id: { $in: app.documentIds } });
    const documents = await Promise.all(docs.map(async (d) => ({
      _id: d._id, docType: d.docType, label: d.label, fileName: d.fileName, mimeType: d.mimeType, status: d.status, note: d.note,
      url: await fileService.signedUrl(d.fileKey),
    })));
    const agreement = await pcService.resolveAgreementUrls(await SellerAgreement.findOne({ applicationId: app._id }));
    const cert = await PrincipalCertificate.findOne({ applicationId: app._id });
    const certificate = cert ? await pcService.resolveCertUrls(pcService.withComputedStatus(cert)) : null;
    res.json({ success: true, data: { application: app, documents, agreement, certificate } });
  } catch (err) { fail(res, err); }
};

/* ---- configurable PC application form (per company) ---- */
exports.getForm = async (req, res) => {
  try {
    const fields = await pcService.getCompanyForm(req.user.companyId);
    res.json({ success: true, data: { fields } });
  } catch (err) { fail(res, err); }
};

exports.saveForm = async (req, res) => {
  try {
    const fields = await pcService.saveCompanyForm(req.user.companyId, req.body.fields || [], req.user.id);
    res.json({ success: true, message: "Application form saved", data: { fields } });
  } catch (err) { fail(res, err); }
};

/* ---- decisions ---- */
exports.review = async (req, res) => {
  try { res.json({ success: true, data: await pcService.reviewApp(req.user.companyId, req.params.id, req.user.id) }); }
  catch (err) { fail(res, err); }
};
exports.requestDocs = async (req, res) => {
  try { res.json({ success: true, data: await pcService.requestDocs(req.user.companyId, req.params.id, req.user.id, { docs: req.body.docs || [], note: req.body.note }) }); }
  catch (err) { fail(res, err); }
};
exports.reject = async (req, res) => {
  try { res.json({ success: true, data: await pcService.rejectApp(req.user.companyId, req.params.id, req.user.id, { reason: req.body.reason }) }); }
  catch (err) { fail(res, err); }
};
exports.approve = async (req, res) => {
  try {
    const { app, agreement } = await pcService.approveApp(req.user.companyId, req.params.id, req.user.id);
    res.json({ success: true, message: "Approved — agreement generated", data: { status: app.status, agreementId: agreement._id } });
  } catch (err) { fail(res, err); }
};

exports.attachAgreement = async (req, res) => {
  try {
    const agreement = await pcService.attachAgreement(req.user.companyId, req.params.id, { file: req.file || null, attachedBy: req.user.id });
    res.json({ success: true, message: "Agreement sent to seller for signature", data: agreement });
  } catch (err) { fail(res, err); }
};

/* ---- issue + manage certificates ---- */
exports.issuePc = async (req, res) => {
  try {
    // A PC is issued active immediately (no government-approval step). Any
    // legacy `govtRequired` input is ignored.
    const { app, cert } = await pcService.issuePc(req.user.companyId, req.params.id, {
      validMonths: req.body.validMonths, issuedBy: req.user.id,
    });
    res.json({ success: true, message: `Certificate ${cert.pcNumber} issued`, data: { status: app.status, pcNumber: cert.pcNumber, certificateId: cert._id, url: await fileService.signedUrl(cert.pdfKey) } });
  } catch (err) { fail(res, err); }
};

exports.listCertificates = async (req, res) => {
  try {
    const filter = { companyId: req.user.companyId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.govt) filter["govt.status"] = req.query.govt; // e.g. ?govt=submitted → the verify queue
    const rows = await PrincipalCertificate.find(filter).sort({ createdAt: -1 }).populate({ path: "sellerId", model: "Seller", select: SELLER_SELECT });
    const data = await Promise.all(rows.map((c) => pcService.resolveCertUrls(pcService.withComputedStatus(c))));
    res.json({ success: true, count: data.length, data });
  } catch (err) { fail(res, err); }
};

exports.revoke = async (req, res) => {
  try { res.json({ success: true, message: "Certificate revoked", data: await pcService.revokeCertificate(req.user.companyId, req.params.id, { reason: req.body.reason, revokedBy: req.user.id }) }); }
  catch (err) { fail(res, err); }
};
exports.reinstate = async (req, res) => {
  try { res.json({ success: true, message: "Certificate reinstated", data: await pcService.reinstateCertificate(req.user.companyId, req.params.id, { reinstatedBy: req.user.id }) }); }
  catch (err) { fail(res, err); }
};
// Authorized certificate download (signed/served URL) — only when active.
exports.downloadCertificate = async (req, res) => {
  try {
    const cert = await PrincipalCertificate.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!cert) return res.status(404).json({ success: false, message: "Certificate not found" });
    if (cert.status !== "active") return res.status(403).json({ success: false, message: `Certificate is ${cert.status} — not downloadable.` });
    res.json({ success: true, data: { pcNumber: cert.pcNumber, url: await fileService.signedUrl(cert.pdfKey) } });
  } catch (err) { fail(res, err); }
};


/* ---- per-document verify / reject (only docs on an application addressed here) ---- */
async function loadOwnDoc(req, res) {
  const doc = await SellerDocument.findById(req.params.id);
  if (!doc) { res.status(404).json({ success: false, message: "Document not found" }); return null; }
  const onOwnApp = await PCApplication.exists({ companyId: req.user.companyId, documentIds: doc._id });
  if (!onOwnApp) { res.status(403).json({ success: false, message: "This document is not on one of your applications" }); return null; }
  return doc;
}
exports.verifyDocument = async (req, res) => {
  try {
    const doc = await loadOwnDoc(req, res); if (!doc) return;
    doc.status = "verified"; doc.note = req.body.note; await doc.save();
    res.json({ success: true, data: { _id: doc._id, status: doc.status } });
  } catch (err) { fail(res, err); }
};
exports.rejectDocument = async (req, res) => {
  try {
    const doc = await loadOwnDoc(req, res); if (!doc) return;
    doc.status = "rejected"; doc.note = req.body.note || req.body.reason; await doc.save();
    res.json({ success: true, data: { _id: doc._id, status: doc.status } });
  } catch (err) { fail(res, err); }
};
