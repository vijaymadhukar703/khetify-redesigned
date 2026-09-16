const fs = require("fs");
const path = require("path");

/**
 * Storage abstraction with an env-switchable driver (STORAGE_DRIVER):
 *   - "local" (default): files on disk under /uploads, served by express.static
 *   - "s3": S3-compatible object storage (lazy-loads @aws-sdk/client-s3)
 *
 * Keeps local for dev; production sets STORAGE_DRIVER=s3 + S3_BUCKET/S3_REGION.
 */
const DRIVER = process.env.STORAGE_DRIVER || "local";

async function saveLocal(buffer, key) {
  const dest = path.join(__dirname, "../uploads", key);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buffer);
  return `/uploads/${key}`;
}

/**
 * S3Client options from env. Static keys are used ONLY when BOTH
 * S3_ACCESS_KEY and S3_SECRET_KEY are set (local dev, MinIO/R2). Otherwise
 * `credentials` is omitted so the AWS SDK's default provider chain resolves
 * them — on EC2 that is the attached IAM instance role, so no long-lived AWS
 * keys ever need to be deployed. Region falls back to the SDK's AWS_REGION.
 */
function s3ClientConfig(env = process.env) {
  const cfg = { region: env.S3_REGION || env.AWS_REGION };
  if (env.S3_ENDPOINT) {
    cfg.endpoint = env.S3_ENDPOINT;
    cfg.forcePathStyle = true;
  }
  if (env.S3_ACCESS_KEY && env.S3_SECRET_KEY) {
    cfg.credentials = { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY };
  }
  return cfg;
}

let _client = null;
/** One shared, lazily-created S3 client (reused for uploads and presigning). */
function s3() {
  let S3;
  try { S3 = require("@aws-sdk/client-s3"); }
  catch { const e = new Error("STORAGE_DRIVER=s3 requires @aws-sdk/client-s3 to be installed"); e.status = 500; throw e; }
  if (!_client) _client = new S3.S3Client(s3ClientConfig());
  return { S3, client: _client };
}

async function saveS3(buffer, key, contentType) {
  const { S3, client } = s3();
  await client.send(new S3.PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: buffer, ContentType: contentType }));
  // NOTE: with a private bucket this URL is NOT reachable. Callers must persist
  // the KEY and resolve links at read time via fileService.signedUrl().
  const region = process.env.S3_REGION || process.env.AWS_REGION;
  const base = process.env.S3_PUBLIC_URL || `https://${process.env.S3_BUCKET}.s3.${region}.amazonaws.com`;
  return `${base}/${key}`;
}

/** Persist a file buffer; returns its public URL/path. */
async function save(buffer, key, contentType = "application/octet-stream") {
  return DRIVER === "s3" ? saveS3(buffer, key, contentType) : saveLocal(buffer, key);
}

module.exports = { save, DRIVER, s3, s3ClientConfig };
