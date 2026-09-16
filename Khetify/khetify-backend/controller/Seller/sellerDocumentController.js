const path = require("path");
const SellerDocument = require("../../model/PC/SellerDocument");
const PCApplication = require("../../model/PC/PCApplication");
const PrincipalCertificate = require("../../model/PC/PrincipalCertificate");
const fileService = require("../../services/fileService");

/** A document row with `fileUrl` resolved from its KEY at read time (signed on
 * S3, /uploads/<key> locally). The stored fileUrl is the bucket's public-style
 * URL, which a private bucket refuses, so it is never returned as-is. */
const withResolvedUrl = async (doc) => {
  const o = doc.toObject ? doc.toObject() : doc;
  if (o.fileKey) o.fileUrl = await fileService.signedUrl(o.fileKey);
  return o;
};

const keyFor = (sellerId, originalName) => {
  const ext = path.extname(originalName || "").toLowerCase() || ".bin";
  return `sellers/${sellerId}/documents/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
};

/**
 * POST /api/seller/documents (multer .array("files") or .single("file"))
 * Upload one or more KYC/business documents to storage and record them.
 */
exports.uploadDocuments = async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const files = req.files && req.files.length ? req.files : (req.file ? [req.file] : []);
    if (!files.length) return res.status(400).json({ success: false, message: "No file uploaded" });

    const docType = req.body.docType || "other";
    const created = [];
    for (const f of files) {
      const key = keyFor(sellerId, f.originalname);
      const { url } = await fileService.uploadBuffer(f.buffer, key, f.mimetype);
      const doc = await SellerDocument.create({
        sellerId, docType,
        label: req.body.label || f.originalname,
        fileKey: key, fileUrl: url, fileName: f.originalname, mimeType: f.mimetype,
      });
      created.push(await withResolvedUrl(doc));
    }
    res.status(201).json({ success: true, count: created.length, data: created });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** GET /api/seller/documents — the seller's documents, newest first. */
exports.getDocuments = async (req, res) => {
  try {
    const rows = await SellerDocument.find({ sellerId: req.user.sellerId }).sort({ createdAt: -1 });
    res.json({ success: true, count: rows.length, data: await Promise.all(rows.map(withResolvedUrl)) });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** DELETE /api/seller/documents/:id — only if not bound to an issued PC. */
exports.deleteDocument = async (req, res) => {
  try {
    const doc = await SellerDocument.findOne({ _id: req.params.id, sellerId: req.user.sellerId });
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });

    const appIds = (await PCApplication.find({ sellerId: req.user.sellerId, documentIds: doc._id }).select("_id")).map((a) => a._id);
    if (appIds.length) {
      const bound = await PrincipalCertificate.exists({ applicationId: { $in: appIds } });
      if (bound) return res.status(409).json({ success: false, message: "This document is attached to an issued certificate and can't be deleted" });
    }
    await doc.deleteOne();
    res.json({ success: true, message: "Document deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
