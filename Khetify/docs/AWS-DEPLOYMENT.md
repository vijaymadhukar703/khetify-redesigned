# Khetify AWS deployment runbook

> **Phase 1 status:** the repository is prepared; **no AWS resources exist yet**.
> Every command below is for a later, separately approved deployment phase.
> Placeholders: `<primary-domain>`, `<region>` (recommended `ap-south-1`),
> `<account-id>`, `<uploads-bucket>`, `<frontend-bucket>`, `<distribution-id>`.

Read first: [AWS-ARCHITECTURE.md](AWS-ARCHITECTURE.md) (design, IAM, ALB, CloudFront, cron),
[AWS-ENV-VARS.md](AWS-ENV-VARS.md) (all variables), [AWS-STORAGE-INVENTORY.md](AWS-STORAGE-INVENTORY.md) (uploads).

---

## 1. What Phase 1 changed in the repository

| Area | Change |
|---|---|
| S3 credentials | `services/storage.js` builds one shared S3 client and omits static credentials unless both `S3_ACCESS_KEY` and `S3_SECRET_KEY` are set, so the EC2 IAM role works. `fileService` reuses it. |
| Config validation | `config/env.js`: `STORAGE_DRIVER=s3` requires `S3_BUCKET` + region; half a key pair fails boot; CORS origins trimmed of trailing `/`; warning for `CORS_ORIGINS=*` in production; `JOBS_ENABLED` flag. |
| Driver POD bug | Photos were saved to `uploads/products/` but recorded as `/uploads/<file>` (dead links) and never reached S3. They now go through `fileService` under `pod/<companyId>/<shipmentId>/…`. |
| Private-bucket links | `GET/POST /api/seller/documents` and the PC issue response return URLs resolved from the stored key (presigned on S3) instead of the stored public-style URL. |
| Upload memory safety | `uploadAny` (challans) capped at 25 MB (was unlimited, fully buffered in RAM). `uploadDocuments` type errors now return 400 instead of 500. |
| Startup | In `production`, a failed initial MongoDB connection exits the process (the restart policy retries) instead of serving 503 forever with jobs unscheduled. |
| Razorpay webhook | Raw-body capture matches the path even when a query string is present. |
| Logging | Authorization / cookie / API-key / Razorpay-signature headers redacted from request logs. |
| Docker | Non-root `node` user; only `/app/uploads` writable; `NEW_RELIC_LOG=stdout`; healthcheck honors `PORT`; `.dockerignore` excludes `.env.*`, logs, tests, git files. |
| CI | Workflow moved from `Khetify/.github/workflows/` (ignored by GitHub, because the Git root is one level up) to `.github/workflows/ci.yml` at the repository root. Paths fixed; adds a Docker build check. No deploy, no secrets. |
| Frontend | `config/config.js` normalizes a trailing slash in `VITE_API_URL`. No hardcoded API hosts in active code (Render URL only in `.env.production`). |

## 2. Prerequisites (decide / verify before provisioning)

- [ ] Final `<primary-domain>`; apex handling on Hostinger (redirect to `www` vs. moving DNS to Route 53).
- [ ] Is production MongoDB **already on Atlas**? If yes, the AWS backend reuses the same `MONGO_URI` (no data move). If not, plan a `mongodump`/`mongorestore` or Atlas Live Migration window separately.
- [ ] Atlas cluster region (prefer AWS `ap-south-1`) and a dedicated DB user.
- [ ] Render (read-only check): persistent disk? current `STORAGE_DRIVER`? current S3 bucket, if any?
- [ ] Current production values of `JWT_SECRET` and `MASTER_KEY` (must be **reused**, see AWS-ENV-VARS.md).
- [ ] Razorpay: live or test keys; access to Dashboard → Webhooks.
- [ ] Driver mobile app (not in this repo): uses `VITE_API_URL`-like config? It will need the new API host.

## 3. Provisioning order (deployment phase)

1. **ACM**: request `api.<primary-domain>` in `<region>`, and `<primary-domain>` + `www.<primary-domain>` in **us-east-1**. Add the DNS validation CNAMEs in Hostinger.
2. **S3 uploads bucket** (`<uploads-bucket>`, `<region>`): Block Public Access ON, SSE-S3, versioning ON, no bucket policy granting public read.
3. **S3 frontend bucket** (`<frontend-bucket>`): Block Public Access ON; bucket policy allowing only the CloudFront distribution (OAC).
4. **IAM**: instance role + profile with the policy in AWS-ARCHITECTURE.md §8 and `AmazonSSMManagedInstanceCore`.
5. **SSM Parameter Store**: create `/khetify/prod/*` parameters (SecureString for secrets). Values are never committed or echoed.
6. **Security groups**: `alb-sg`, `ec2-sg` (AWS-ARCHITECTURE.md §9).
7. **EC2**: one instance (e.g. `t3.small`/`t3.medium`, Amazon Linux 2023), public subnet, Elastic IP, IMDSv2 required with hop limit 2, gp3 EBS (plus a separate volume or path for `/srv/khetify/uploads`). Install Docker and AWS CLI v2.
8. **Atlas**: add the Elastic IP to the IP access list.
9. **CloudWatch**: log group `/khetify/backend` with a retention period.
10. **ALB** + target group (`/healthz`), HTTPS listener, HTTP→HTTPS redirect.
11. **CloudFront**: origin = frontend bucket (OAC), default root object `index.html`, SPA fallback (AWS-ARCHITECTURE.md §17), aliases + us-east-1 certificate, HTTP→HTTPS redirect, compression on.

## 4. Backend deploy (on the EC2 instance)

```bash
# 1) Code: build on the instance from a reviewed commit (no registry needed initially).
git clone https://github.com/vijaymadhukar703/khetify-redesigned.git /opt/khetify   # first time
cd /opt/khetify && git fetch && git checkout <reviewed-commit-sha>
docker build -t khetify-backend:<sha> Khetify/khetify-backend

# 2) Env file from SSM (see AWS-ENV-VARS.md) → /etc/khetify/backend.env (chmod 600)

# 3) Temporary local-upload compatibility (until the storage migration is complete)
sudo mkdir -p /srv/khetify/uploads && sudo chown -R 1000:1000 /srv/khetify/uploads

# 4) One-off maintenance commands (only when needed, see §6)
docker run --rm --env-file /etc/khetify/backend.env khetify-backend:<sha> npm run ensure-indexes

# 5) Run
docker rm -f khetify-backend 2>/dev/null || true
docker run -d --name khetify-backend --restart unless-stopped --init \
  -p 5000:5000 \
  --env-file /etc/khetify/backend.env \
  -v /srv/khetify/uploads:/app/uploads \
  --log-driver awslogs --log-opt awslogs-region=<region> \
  --log-opt awslogs-group=/khetify/backend --log-opt awslogs-create-group=false \
  khetify-backend:<sha>

# 6) Verify
curl -fsS http://127.0.0.1:5000/healthz        # {"status":"ok","db":"connected"}
docker inspect --format '{{.State.Health.Status}}' khetify-backend
```

A restart or redeploy briefly drops traffic (single instance). Deploy in a low-traffic window.
Keep the previous image tag for rollback.

## 5. Frontend deploy

```bash
cd Khetify/khetifyApp
npm ci
VITE_API_URL=https://api.<primary-domain> npm run build   # no trailing slash

aws s3 sync dist/ s3://<frontend-bucket>/ --delete \
  --exclude index.html --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html s3://<frontend-bucket>/index.html --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id <distribution-id> --paths "/index.html"
```

## 6. MongoDB commands

| Command | What it does | When |
|---|---|---|
| `npm run ensure-indexes` | `syncIndexes()` on every model. **Creates missing indexes AND drops indexes that are not declared in the schemas** (including any created by hand in Atlas). | Only after reviewing current indexes in Atlas and taking a snapshot. Not required for the AWS move itself if the database is unchanged. |
| `npm run migrate` | Runs migrations 001–003 only | Historical; don't re-run on production without review |
| `node scripts/migrations/00X-*.js` | 004–008 are data repairs; some have dry-run flags (read each header) | Only if not already applied to production. Unrelated to AWS; don't run as part of the migration |
| Server startup | Drops legacy `subscriptions.companyId_1` index if present (already the behavior on Render) | Automatic |

Rules: take an Atlas snapshot first; run against staging or a restored snapshot first;
never run seed scripts (`seed:*`) against production.

## 7. Cut-over sequence (Render → AWS)

1. **Freeze prep:** lower DNS TTLs; announce a short maintenance window.
2. Deploy the AWS backend with the **same** `MONGO_URI`, `JWT_SECRET`, `MASTER_KEY` and Razorpay keys as Render, and `JOBS_ENABLED=false`.
   Test it via the ALB DNS name / a temporary `api-staging` host: `/healthz`, login, a file upload, Socket.IO connect.
3. Build and deploy the frontend with `VITE_API_URL=https://api.<primary-domain>`. Test via the CloudFront domain.
4. **Files:** copy the Render `uploads/` tree to `/srv/khetify/uploads` on EC2 (and/or S3 per the storage inventory).
5. **Switch:** on Render set `JOBS_ENABLED=false` **(or stop the Render backend)**; on AWS set `JOBS_ENABLED=true` and restart. Exactly one process runs jobs.
6. Update Hostinger DNS: `api.<primary-domain>` → ALB, `www` / apex → CloudFront.
7. Update `CORS_ORIGINS` / `FRONTEND_URL` on AWS to the final frontend origin(s).
8. Razorpay Dashboard → Webhooks: set `https://api.<primary-domain>/api/shop/payments/webhook` (same secret, or rotate both sides together).
9. Point the driver mobile app at the new API host (app release).
10. Watch CloudWatch logs, ALB 5xx, `/healthz`, and a Razorpay test or low-value payment for 24–48 h.
11. Keep Render running with `JOBS_ENABLED=false` (idle) until rollback is no longer needed, then retire it.

## 8. Render coexistence rules

- Both backends may serve requests against the same Atlas DB (the app is stateless apart from in-memory rate limits and socket rooms), **but only one may run cron jobs** (`JOBS_ENABLED`).
- Socket.IO events emitted by one backend don't reach clients connected to the other. Keep coexistence short.
- Local-disk uploads made on one host are not visible on the other. Minimize the window, or use `STORAGE_DRIVER=s3` with the same bucket on both.
  (Render has no IAM role; it would need static `S3_ACCESS_KEY`/`S3_SECRET_KEY` for a dedicated, S3-only IAM user.)
- Razorpay sends webhooks to one URL. Switch it at the same moment as DNS (step 8).
- The current `.env.production` still targets Render so Render's frontend build keeps working; AWS builds override `VITE_API_URL` in the shell.

## 9. Rollback

| Failure | Action |
|---|---|
| Backend bad release | `docker run` the previous `khetify-backend:<old-sha>` tag (same flags). |
| AWS backend unusable | Hostinger: point `api.<primary-domain>` back (or users back to the Render frontend); Render `JOBS_ENABLED=true`, AWS `JOBS_ENABLED=false`/stopped; Razorpay webhook URL back to Render. |
| Frontend bad release | Re-sync the previous `dist/` build (keep the last build artifact) and invalidate `/index.html`. S3 versioning allows restoring objects. |
| Data issue from a script | Restore from the Atlas snapshot taken before running it. |

Because the database is shared and the code is backwards compatible (no route or response-shape changes), rollback is DNS and config only.

## 10. Known migration tasks (still to do)

1. Storage code changes B.1 (company setup wizard → S3 keys) and B.2 (product image strategy). See AWS-STORAGE-INVENTORY.md.
2. File/data migration C (Render uploads → S3; rewrite absolute-path document values; legacy POD values).
3. Decide the apex-domain handling on Hostinger.
4. Update the driver mobile app API host.
5. Razorpay webhook URL at cut-over.
6. CloudWatch alarms and log retention.
7. Optional deploy script to standardize §4 (still manual, no CI/CD deploy).

## 11. Known technical debt (not blocking Phase 1)

- Single instance only: node-cron, in-memory rate limiting, in-memory Socket.IO rooms (see AWS-ARCHITECTURE.md §12–13).
- `/uploads` is public and unauthenticated; local-disk uploads include company KYC documents (setup wizard).
- Product images are local-disk only; no CDN.
- Socket.IO CORS is `*` (token auth, so low risk).
- `require('newrelic')` runs after other modules are loaded, which limits auto-instrumentation.
- Frontend bundle is one ~10.8 MB JS chunk (2.9 MB gzip); needs code-splitting.
- Frontend ESLint: 191 existing problems (CI reports them without failing).
- Backend: 17 test suites / 52 tests were already failing before Phase 1 (see the Phase 1 report); no backend ESLint config.
- `@aws-sdk/client-lambda` is a dependency but unused by application code.
- Stored `fileUrl` / `*PdfUrl` columns hold public-style S3 URLs that don't work on a private bucket; readers must keep resolving from keys.
- Uploads are stored before the shipment/POD state is validated, so failed requests can leave orphaned objects.
- `CompanyEditProduct.jsx` / `CompanyProductCatalog.jsx` read `VITE_API_URL` directly instead of `config.js`.
- Several `tmp_*.js` scratch files are committed in `khetifyApp/`.
