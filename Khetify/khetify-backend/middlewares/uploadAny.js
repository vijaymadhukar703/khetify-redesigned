const multer = require("multer");

/**
 * PERMISSIVE upload — memory storage, NO type filter, so the handler gets a
 * Buffer for whatever was sent.
 *
 * Deliberately separate from middlewares/uploadDocuments (10MB, PDF + images):
 * that one is shared by the KYC and agreement routes, and loosening it would
 * loosen those too. This exists for the delivery challan on a warehouse
 * shipment, where any document the warehouse holds must be attachable.
 *
 * The whole file is held in memory while it is stored, so it is capped at 25MB
 * (the same ceiling as middlewares/upload.js). Without a cap a single large
 * request could exhaust the memory of a small server. Oversized files are
 * rejected with a 400 "File is too large." by middlewares/errorHandler.
 */
const uploadAny = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

module.exports = uploadAny;
