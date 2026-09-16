/**
 * AWS readiness (Phase 1):
 *  - S3 client uses the SDK default credential chain (EC2 IAM role) unless BOTH
 *    static keys are set.
 *  - env loader fails fast on an incomplete S3 config and normalises CORS.
 *  - driver POD photos are stored through fileService under a pod/ key that
 *    actually resolves (they used to be recorded as a non-existent path).
 *  - upload limits / type errors surface as 400s.
 *  - seller document links are resolved from the KEY, never the stored URL.
 */
process.env.STORAGE_DRIVER = "local";

const fs = require("fs");
const path = require("path");
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const { s3ClientConfig } = require("../services/storage");
const { load } = require("../config/env");
const fileService = require("../services/fileService");
const uploadAny = require("../middlewares/uploadAny");
const uploadImages = require("../middlewares/uploadImages");
const { errorHandler } = require("../middlewares/errorHandler");
const Company = require("../model/Company/Company");
const Shipment = require("../model/Transport/Shipment");
const SellerDocument = require("../model/PC/SellerDocument");
const tmsCtrl = require("../controller/Transport/tmsController");
const sellerDocCtrl = require("../controller/Seller/sellerDocumentController");

const POD_ROOT = path.join(__dirname, "../uploads/pod");
afterAll(() => { fs.rmSync(POD_ROOT, { recursive: true, force: true }); });

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

describe("s3ClientConfig", () => {
  test("omits credentials when no static keys are set (IAM role / default chain)", () => {
    const cfg = s3ClientConfig({ S3_REGION: "ap-south-1", S3_BUCKET: "b" });
    expect(cfg).toEqual({ region: "ap-south-1" });
    expect(cfg.credentials).toBeUndefined();
  });

  test("uses static keys only when BOTH are set", () => {
    expect(s3ClientConfig({ S3_REGION: "r", S3_ACCESS_KEY: "a" }).credentials).toBeUndefined();
    expect(s3ClientConfig({ S3_REGION: "r", S3_ACCESS_KEY: "a", S3_SECRET_KEY: "s" }).credentials)
      .toEqual({ accessKeyId: "a", secretAccessKey: "s" });
  });

  test("custom endpoint enables path-style; region falls back to AWS_REGION", () => {
    const cfg = s3ClientConfig({ AWS_REGION: "ap-south-1", S3_ENDPOINT: "http://minio:9000" });
    expect(cfg).toEqual({ region: "ap-south-1", endpoint: "http://minio:9000", forcePathStyle: true });
  });
});

describe("env loader — S3 + CORS", () => {
  const KEYS = ["STORAGE_DRIVER", "S3_BUCKET", "S3_REGION", "AWS_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY", "CORS_ORIGINS", "NODE_ENV", "MONGO_URI"];
  let saved, exitSpy, errSpy, warnSpy;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    KEYS.forEach((k) => { delete process.env[k]; });
    process.env.MONGO_URI = "mongodb://127.0.0.1:27017/test";
    exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
    exitSpy.mockRestore(); errSpy.mockRestore(); warnSpy.mockRestore();
  });

  test("STORAGE_DRIVER=s3 boots with only bucket + region (no static keys)", () => {
    Object.assign(process.env, { STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_REGION: "ap-south-1" });
    expect(load().storageDriver).toBe("s3");
  });

  test("STORAGE_DRIVER=s3 without a bucket fails fast", () => {
    Object.assign(process.env, { STORAGE_DRIVER: "s3", S3_REGION: "ap-south-1" });
    expect(() => load()).toThrow("exit:1");
  });

  test("half an S3 key pair fails fast", () => {
    Object.assign(process.env, { STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_REGION: "r", S3_ACCESS_KEY: "a" });
    expect(() => load()).toThrow("exit:1");
  });

  test("CORS origins are trimmed of trailing slashes", () => {
    process.env.CORS_ORIGINS = "https://app.example.com/, https://www.example.com";
    expect(load().corsOrigins).toEqual(["https://app.example.com", "https://www.example.com"]);
  });

  test("background jobs are on by default and only JOBS_ENABLED=false turns them off", () => {
    const savedJobs = process.env.JOBS_ENABLED;
    try {
      delete process.env.JOBS_ENABLED;
      expect(load().jobsEnabled).toBe(true);
      process.env.JOBS_ENABLED = "false";
      expect(load().jobsEnabled).toBe(false);
    } finally {
      if (savedJobs === undefined) delete process.env.JOBS_ENABLED; else process.env.JOBS_ENABLED = savedJobs;
    }
  });

  test("warns when production allows every origin", () => {
    process.env.NODE_ENV = "production";
    load();
    expect(warnSpy.mock.calls.some(([m]) => /CORS_ORIGINS allows all origins/.test(m))).toBe(true);
  });
});

describe("driver POD photos", () => {
  test("are stored under pod/<companyId>/<shipmentId>/ and resolve to a real file", async () => {
    const company = await Company.create({ fullName: "Co", email: `c-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
    const ship = await Shipment.create({ companyId: company._id, refType: "Manual", toType: "customer", toLabel: "Ramesh", status: "in_transit" });
    const req = {
      user: { id: new mongoose.Types.ObjectId(), companyId: company._id, role: "driver" },
      params: { id: String(ship._id) },
      body: { signedBy: "Ramesh" },
      files: [{ buffer: Buffer.from("fake-jpeg"), originalname: "proof photo.jpg", mimetype: "image/jpeg", size: 9 }],
    };
    const res = makeRes();
    await tmsCtrl.driverDeliver(req, res);
    expect(res.statusCode).toBe(200);

    const saved = await Shipment.findById(ship._id).lean();
    expect(saved.status).toBe("delivered");
    expect(saved.pod.photoUrls).toHaveLength(1);
    const key = saved.pod.photoUrls[0];
    expect(key).toMatch(new RegExp(`^pod/${company._id}/${ship._id}/\\d+-\\d+-proof_photo\\.jpg$`));
    expect(fs.existsSync(path.join(__dirname, "../uploads", key))).toBe(true);
    expect(await fileService.publicFileUrl(key)).toBe(`/uploads/${key}`);
  });
});

describe("upload limits and type errors → 400", () => {
  const appWith = (mw) => {
    const app = express();
    app.post("/up", mw, (req, res) => res.json({ success: true }));
    app.use(errorHandler);
    return app;
  };

  test("uploadAny rejects files over 25MB", async () => {
    const res = await request(appWith(uploadAny.single("challanDocument")))
      .post("/up")
      .attach("challanDocument", Buffer.alloc(25 * 1024 * 1024 + 1), "big.pdf");
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("File is too large.");
  });

  test("uploadAny still accepts any file type", async () => {
    const res = await request(appWith(uploadAny.single("challanDocument")))
      .post("/up")
      .attach("challanDocument", Buffer.from("x"), "challan.docx");
    expect(res.status).toBe(200);
  });

  test("POD uploader rejects non-images with a 400", async () => {
    const res = await request(appWith(uploadImages.array("photos", 5)))
      .post("/up")
      .attach("photos", Buffer.from("%PDF"), { filename: "x.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Only images are allowed!");
  });
});

describe("seller documents — links resolved from the key", () => {
  test("GET returns fileUrl derived from fileKey, not the stored public-style URL", async () => {
    const sellerId = new mongoose.Types.ObjectId();
    await SellerDocument.create({
      sellerId, docType: "gst", fileKey: `sellers/${sellerId}/documents/gst.pdf`,
      fileUrl: `https://bucket.s3.ap-south-1.amazonaws.com/sellers/${sellerId}/documents/gst.pdf`, fileName: "gst.pdf",
    });
    const res = makeRes();
    await sellerDocCtrl.getDocuments({ user: { sellerId } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].fileUrl).toBe(`/uploads/sellers/${sellerId}/documents/gst.pdf`);
  });
});
