const multer = require("multer");
const path = require("path");
const fs = require("fs");

// 📁 Storage Config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, "../uploads/products");

    // 🔥 Create folder automatically if not exists
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },

  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueName + path.extname(file.originalname));
  },
});

// 🛑 File Filter
// KYC document fields accept PDF or images (scans / signed certificates);
// every other field (logos, cover images, product/certification images)
// stays image-only.
const DOC_FIELDS = new Set([
  "gstCertificate",
  "registrationCertificate",
  "panCard",
]);

const fileFilter = (req, file, cb) => {
  const allowedTypes = DOC_FIELDS.has(file.fieldname)
    ? /pdf|jpeg|jpg|png|webp/
    : /jpeg|jpg|png|webp/;

  const extName = allowedTypes.test(
    path.extname(file.originalname).toLowerCase(),
  );

  const mimeType = allowedTypes.test(file.mimetype);

  if (extName && mimeType) {
    cb(null, true);
  } else {
    cb(
      new Error(
        DOC_FIELDS.has(file.fieldname)
          ? "Only PDF or image files are allowed!"
          : "Only images are allowed!",
      ),
    );
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — roomy enough for scanned PDF certificates
  fileFilter,
});

// Pre-configured fields() middleware for product create/update routes.
// Accepts up to 5 product gallery images and up to 10 per-variant images in
// one multipart request, keeping them in separate req.files buckets.
const { randomUUID } = require("crypto");
const { pipeline } = require("stream");
const cleanup = require("./productUploadCleanup");
// Exclusive creation prevents failed requests from overwriting existing assets.
const productStorage = {
  _handleFile(req, file, cb) {
    const destination = cleanup.PRODUCT_UPLOAD_DIRECTORY;
    fs.mkdir(destination, { recursive: true }, (err) => {
      if (err) return cb(err);
      const filename = randomUUID() + path.extname(file.originalname);
      const target = path.join(destination, filename);
      fs.open(target, "wx", (openError, fd) => {
        if (openError) return cb(openError);
        const output = fs.createWriteStream(target, { fd });
        pipeline(file.stream, output, (streamError) => {
          if (streamError) fs.unlink(target, () => cb(streamError));
          else cb(null, { destination, filename, path: target, size: output.bytesWritten });
        });
      });
    });
  },
  _removeFile(req, file, cb) { fs.unlink(file.path, cb); },
};
const productFields = multer({ storage: productStorage, limits: { fileSize: 25 * 1024 * 1024 }, fileFilter }).fields([
  { name: "productImages", maxCount: 5 },
  { name: "variantImages", maxCount: 30 },
]);

upload.uploadProductFields = (req, res, next) => productFields(req, res, (error) => {
  if (error) return next(error); // Multer handles upload-stage rollback.
  cleanup.capture(req, cleanup.PRODUCT_UPLOAD_DIRECTORY);
  next();
});
module.exports = upload;
