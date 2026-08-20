const multer = require("multer");

/**
 * UNRESTRICTED upload — memory storage, NO size limit and NO type filter, so the
 * handler gets a Buffer for whatever was sent.
 *
 * Deliberately separate from middlewares/uploadDocuments (10MB, PDF + images):
 * that one is shared by the KYC and agreement routes, and loosening it would
 * loosen those too. This exists for the delivery challan on a warehouse
 * shipment, where any document the warehouse holds must be attachable.
 *
 * NOTE: with no limit, the whole file is held in memory while it is stored. If
 * uploads here ever grow large, this is the place to add a cap.
 */
const uploadAny = multer({ storage: multer.memoryStorage() });

module.exports = uploadAny;
