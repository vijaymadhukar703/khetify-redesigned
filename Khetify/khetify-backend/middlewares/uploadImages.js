const multer = require("multer");
const path = require("path");

/**
 * Image-only upload held in MEMORY so the handler can push the Buffer through
 * services/fileService (local disk or S3, per STORAGE_DRIVER).
 *
 * Same type rule, error message and 25MB per-file cap as middlewares/upload.js,
 * which writes straight to local disk and so can never reach S3. Used for the
 * driver proof-of-delivery photos.
 */
const ALLOWED = /jpeg|jpg|png|webp/;

const uploadImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB, parity with middlewares/upload.js
  fileFilter: (req, file, cb) => {
    const ext = ALLOWED.test(path.extname(file.originalname || "").toLowerCase());
    const mime = ALLOWED.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error("Only images are allowed!"));
  },
});

module.exports = uploadImages;
