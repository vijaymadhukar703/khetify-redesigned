# File upload / storage inventory (AWS readiness)

Audit of every upload path in `khetify-backend` as of the `aws-deployment` branch (Phase 1).

**Categories:**
**A**: already S3-ready (goes through `fileService`, key persisted, URL resolved at read time).
**B**: requires a code change to reach S3.
**C**: requires data/file migration of existing records.
**D**: temporary local-storage compatibility needed (host volume at `/app/uploads`).

## Storage primitives

| Piece | Behavior |
|---|---|
| `services/storage.js` | `STORAGE_DRIVER=local` writes `uploads/<key>`; `s3` does `PutObject` to `S3_BUCKET`. The S3 client uses the default credential chain unless both static keys are set. |
| `services/fileService.js` | `uploadBuffer(buf, key)`, `signedUrl(key)` (presigned GET, 300 s, or `/uploads/<key>` locally), `publicFileUrl(stored)` (tolerates legacy absolute paths locally; under S3 treats the value as a key) |
| `middlewares/upload.js` | multer **disk** storage → `uploads/products/`, images (+PDF for KYC fields), 25 MB/file. **Always local disk, whatever `STORAGE_DRIVER` says.** |
| `middlewares/uploadDocuments.js` | multer memory, PDF + images, 10 MB/file |
| `middlewares/uploadAny.js` | multer memory, any type, **25 MB/file** (was unlimited) |
| `middlewares/uploadImages.js` | **new**: multer memory, images only, 25 MB/file (POD photos) |
| `Server.js` | `app.use("/uploads", express.static("uploads"))`: **public, unauthenticated** |

## Inventory

| # | Feature | Route → handler | Middleware | Destination (driver = s3) | DB value stored | Uses fileService? | Local disk? | Category |
|---|---|---|---|---|---|---|---|---|
| 1 | Company product images | `POST /api/product/create`, `PUT /api/product/:productId` → `productController` | `upload.uploadProductFields` | `uploads/products/<ts>-<rand>.<ext>` (local) | `Product.productImages[]`, `variants[].image/images[]` = `"uploads/products/<file>"` (older rows: absolute disk paths) | No | Yes | **B, C, D** |
| 2 | Seller "My Products" images | `POST/PUT /api/seller/my-products` → `sellerMyProductController.applyUploadedImages` | `upload.uploadProductFields` | same as #1 | same as #1 | No | Yes | **B, C, D** |
| 3 | Company setup wizard: logo, cover, certifications, **GST / Udyam / PAN** | `PUT /api/company/update/:id` → `companyController.updateCompany` (used by `CompanySetupStep2–5.jsx`) | `upload.fields` | `uploads/products/` (local) | `companyInfo.companyLogo`, `coverImage`, `certifications[]`, `companyDocument.gstCertificate/udyamIncorporationCertificate/panFile` = **multer `file.path` (absolute server path)** | No | Yes | **B, C, D** (sensitive) |
| 4 | Company profile documents | `PATCH /api/company/profile` → `updateCompanyProfile` | `uploadDocuments.fields` | `companies/<companyId>/{gst,pan,doc}-…` | storage key in `companyDocument.gstCertificate/panFile`, `certifications[]` | Yes | Only if driver=local | **A** |
| 5 | Seller profile KYC / licences | `PATCH /api/seller/profile` → `sellerAuthController.upsertSellerDoc` | `uploadDocuments.fields` | `sellers/<sellerId>/documents/…` | `SellerDocument.fileKey` (+ `fileUrl`) | Yes | Only if local | **A** |
| 6 | Seller documents (PC) | `POST/GET /api/seller/documents` → `sellerDocumentController` | `uploadDocuments.array` | `sellers/<sellerId>/documents/…` | `SellerDocument.fileKey` (+ `fileUrl`) | Yes | Only if local | **A** (fixed in Phase 1: responses now resolve `fileUrl` from the key) |
| 7 | Seller legacy `verification.docs[]` | `PATCH /api/seller/...` (client-supplied strings) | n/a | n/a | free-form strings / paths | Read via `publicFileUrl` | Possibly | **C** (verify contents) |
| 8 | PC agreement attached by company | `POST /api/company/pc-applications/:id/agreement/attach` → `pcService` | `uploadDocuments.single` | `sellers/<sellerId>/agreements/<appId>-company.<ext>` | `agreementFileKey` (+ Url) | Yes | Only if local | **A** |
| 9 | PC agreement signed by seller (upload) | `POST /api/seller/pc-applications/:id/agreement/sign` | `uploadDocuments.single` | `…/agreements/<appId>-signed.<ext>` | `signedPdfKey` (+ Url) | Yes | Only if local | **A** |
| 10 | Generated PDFs (unsigned/signed agreement, PC certificate) | `pcService` (pdfkit) | n/a | `sellers/<sellerId>/agreements/…`, `…/certificates/<pcNumber>.pdf` | `*PdfKey` (+ Url) | Yes | Only if local | **A** (issue response URL now signed) |
| 11 | Warehouse shipment delivery challan | `POST /api/shipments`, `POST /api/shipments/:id/dispatch` → `tmsController.storeChallan` | `uploadAny.single` | `shipments/<companyId>/<ts>-<name>` | `Shipment.challanDocument.key` | Yes | Only if local | **A** |
| 12 | Seller transfer / shipment challan | `POST /api/seller/transfers/direct`, `POST /api/seller/shipments/:id/transfer-dispatch` | `uploadAny.single` | `seller-transfers/<sellerId>/<ts>-<name>` | `challanDocument.key` | Yes | Only if local | **A** |
| 13 | Company → seller transfer challan / bill / bilty | `POST /api/supply-order/transfer` → `companySellerTransferService` | `uploadDocuments.fields` | `transfers/<companyId>/<ts>-<field>-<name>` | key on `SupplyOrder` docs | Yes | Only if local | **A** |
| 14 | **Driver proof-of-delivery photos** | `POST /api/driver/shipments/:id/pod` → `tmsController.driverDeliver` | **`uploadImages.array("photos", 5)`** (was `upload`) | `pod/<companyId>/<shipmentId>/<ts>-<rand>-<name>` | `Shipment.pod.photoUrls[]` = **storage key** | **Yes (fixed)** | Only if local | **A** (new rows), **C** (old rows) |

## Driver POD bug (fixed)

- **Before:** the route used `middlewares/upload.js` (disk → `uploads/products/<filename>`) but the
  controller recorded `/uploads/<filename>`. Every stored POD photo link pointed at a file that didn't exist.
  POD photos also never reached S3.
- **After:** memory upload → `fileService.uploadBuffer` under a `pod/` key. The key is stored in
  `pod.photoUrls[]`, and any reader should resolve it with `fileService.publicFileUrl(value)`
  (signed on S3, `/uploads/<key>` locally; absolute `http(s)` URLs sent by a client still pass through unchanged).
- **Compatibility:** the endpoint, field name (`photos`, max 5), allowed image types and 25 MB limit are unchanged.
  The response (`{ success, message, data: { status } }`) is unchanged. No backend or web frontend code reads `pod.photoUrls` today.
- **Existing rows:** values like `/uploads/<filename>` are broken today. The file (if it still exists) is at
  `uploads/products/<filename>`. Fixing them is a data migration (below), not guessed in code.

## Public `/uploads` exposure

`/uploads` is served statically **without authentication**. With `STORAGE_DRIVER=local` this includes KYC
documents under `companies/` and `sellers/`, challans, and the setup-wizard GST/PAN/Udyam files in
`uploads/products/`. File names are random (timestamp + random number), which is obscurity, not access control.

- With `STORAGE_DRIVER=s3`, rows #4–#14 are private (presigned URLs).
- Rows #1–#3 stay on local disk and stay publicly reachable. Product images are meant to be public; the
  **company KYC documents in #3 are not**. This is a known risk to remove in the storage migration phase.
- Don't expose `/uploads` through CloudFront. It stays reachable only via `api.<primary-domain>`.

## Required follow-up (not done in Phase 1)

### B: code changes
1. **Company setup wizard (#3):** switch `PUT /api/company/update/:id` to `uploadDocuments`/memory and
   `storeCompanyDoc()` (the pattern already used by `PATCH /api/company/profile`), storing keys.
   Keep the request field names and response shape.
2. **Product images (#1, #2):** decide the public-image strategy first:
   (a) presign on every product read (many URLs per list response, 5-minute expiry breaks cached pages), or
   (b) a separate **public-read prefix/bucket behind CloudFront** for catalog images only (recommended), then store keys and
   return a CloudFront URL. This touches storefront and catalog responses, `getProductImage()` and the edit flows, so it gets its own change.

### C: data / file migration (run against a backup / staging first)
0. **Check first (read-only):** does the Render service have a *persistent disk* mounted at the backend's `uploads/`?
   Without one, Render's filesystem is wiped on every deploy, so locally-stored files from before the last deploy may already be gone.
   Also check which `STORAGE_DRIVER` Render uses today.
1. Copy the Render disk `uploads/` tree to S3, keeping relative paths as keys (`products/…`, `companies/…`, `sellers/…`, `shipments/…`).
2. Rewrite `Company.companyInfo.*` / `companyDocument.*` values that are absolute paths
   (`…/uploads/products/x.pdf`) to their key (`products/x.pdf`). Under the S3 driver, `publicFileUrl` treats the stored value as a key.
3. Rewrite legacy POD values `/uploads/<file>` → `products/<file>` where that object exists.
4. Review `Seller.verification.docs[]` values.
5. Product image paths `uploads/products/<file>` → only after strategy B.2 is chosen.

Dry-run every rewrite (count + sample) before applying, and take an Atlas snapshot first.

### D: temporary local-storage compatibility on EC2
Until B + C are done, mount a persistent EBS-backed host directory into the container:
`-v /srv/khetify/uploads:/app/uploads` (owned by uid/gid `1000`, the image's `node` user),
back it up (EBS snapshots), and copy the existing Render `uploads/` tree into it at cut-over.
