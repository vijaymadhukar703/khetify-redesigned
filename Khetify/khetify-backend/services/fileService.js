const storage = require("./storage");

/**
 * Thin wrapper over services/storage.js (local | S3, driver via STORAGE_DRIVER).
 * Uploads a buffer and returns { key, url }. `signedUrl(key)` returns a
 * REACHABLE, time-limited URL for a stored key, resolved per driver:
 *   - s3    → a pre-signed GET URL (expires shortly; works on private buckets)
 *   - local → the /uploads/<key> path served by express.static
 * Always resolve links from the stored KEY at read-time via this helper — never
 * persist/serve a guessed public URL.
 */
async function uploadBuffer(buffer, key, mime = "application/octet-stream") {
  const url = await storage.save(buffer, key, mime);
  return { key, url };
}

const SIGNED_TTL = 300; // seconds

async function signedUrl(key) {
  if (!key) return null;
  if (storage.DRIVER === "s3") {
    const { S3, client } = storage.s3();
    const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
    return getSignedUrl(client, new S3.GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), { expiresIn: SIGNED_TTL });
  }
  return `/uploads/${key}`;
}

/**
 * Resolve a STORED document value into a reachable, never-hardcoded URL —
 * tolerant of the legacy formats that predate the storage abstraction:
 *   - an already-absolute http(s) URL → returned as-is
 *   - S3 driver → treat the value as a key and return a short-lived SIGNED url
 *   - local driver → normalise any absolute/relative disk path (incl. Windows
 *     backslashes, e.g. multer's `…/uploads/products/x.pdf`) to the `/uploads/…`
 *     path served by express.static, so old rows resolve instead of 404-ing.
 * Use this for fields written outside fileService (company KYC docs); use
 * signedUrl() directly when you already hold a clean S3 key.
 */
async function publicFileUrl(stored) {
  if (!stored) return null;
  const v = String(stored).trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (storage.DRIVER === "s3") return signedUrl(v.replace(/^\/+/, ""));
  const norm = v.replace(/\\/g, "/");
  const last = norm.toLowerCase().lastIndexOf("/uploads/");
  if (last >= 0) return norm.slice(last);
  const first = norm.toLowerCase().indexOf("uploads/");
  if (first >= 0) return `/${norm.slice(first)}`;
  if (norm.startsWith("/")) return norm;
  return `/uploads/${norm}`;
}

module.exports = { uploadBuffer, signedUrl, publicFileUrl };
