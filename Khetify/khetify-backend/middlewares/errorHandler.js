const multer = require("multer");
const logger = require("../services/logger");

/** 404 for unmatched API routes. */
function notFound(req, res) {
  res.status(404).json({ success: false, message: "Not found" });
}

/**
 * Central error handler (must be mounted LAST). Honours err.status, logs 5xx
 * with the request id, and never leaks stack traces to clients.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Upload errors (bad file type from fileFilter, size limit, etc.) are client
  // errors — surface the real reason as a 400 instead of a generic "Server error".
  if (err instanceof multer.MulterError || err?.code === "LIMIT_FILE_SIZE") {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "File is too large."
        : err.message || "File upload failed.";
    return res.status(400).json({ success: false, message, reqId: req.id });
  }
  // uploadDocuments' message has no trailing "!" — match both spellings.
  if (/^Only (PDF or image files|images) are allowed!?$/.test(err?.message || "")) {
    return res.status(400).json({ success: false, message: err.message, reqId: req.id });
  }

  const status = err.status || err.statusCode || 500;
  if (status >= 500) logger.error({ err, reqId: req.id, path: req.originalUrl }, "Unhandled error");
  res.status(status).json({ success: false, message: status >= 500 ? "Server error" : err.message, reqId: req.id });
}

module.exports = { notFound, errorHandler };
