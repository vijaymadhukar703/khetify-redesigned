# Environment variable reference

Every variable read by the code on the `aws-deployment` branch, gathered with
`grep process.env` across `khetify-backend` plus `import.meta.env` in `khetifyApp`.
**No real values belong in this file or in the repository.** Production values live in
SSM Parameter Store (`/khetify/prod/<NAME>`, SecureString for secrets).

Legend: **Req** = required · **Opt** = optional · **Dev** = development-only ·
**Prod** = production-relevant/only · **Secret** = SecureString, never logged or committed · **Public** = non-secret.

## Backend (`Khetify/khetify-backend`)

### Server / runtime

| Variable | Class | Default | Production (AWS) value / notes |
|---|---|---|---|
| `PORT` | Opt · Public | `5000` | `5000` (ALB target port; Docker healthcheck honors it) |
| `NODE_ENV` | Req (prod) · Public | `development` | `production` (set in the Docker image). Enables production logging, and the process exits if the initial MongoDB connection fails |
| `LOG_LEVEL` | Opt · Public | `info` | `info` |
| `CORS_ORIGINS` | Req (prod) · Public | `*` | Comma-separated exact frontend origins, e.g. `https://<primary-domain>,https://www.<primary-domain>`. Trailing slashes are trimmed. `*` logs a warning in production. Auth is a bearer header (no cookies), so `credentials` is not enabled |
| `FRONTEND_URL` | Req (prod) · Public | `http://localhost:5173` | `https://<primary-domain>`, used in password-reset and invite links |
| `JOBS_ENABLED` | Opt · Prod · Public | `true` | `true` on the ONE process that runs node-cron jobs; `false` on any other backend sharing the DB (e.g. Render during coexistence) |
| `TZ` | Opt · Public | container default (UTC) | Leave unset: cron schedules assume UTC, matching Render |

### Database

| Variable | Class | Default | Notes |
|---|---|---|---|
| `MONGO_URI` | **Req · Secret** | none (boot fails) | Atlas `mongodb+srv://<user>:<password>@<cluster>/<db>?retryWrites=true&w=majority` |
| `MONGO_TRANSACTIONS` | Opt · Public | auto-detect | `on` / `off`; leave unset on Atlas (auto-detects replica set) |

### Auth / crypto

| Variable | Class | Default | Notes |
|---|---|---|---|
| `JWT_SECRET` | **Req · Secret** | none (boot fails) | Long random string. Changing it logs everyone out. Keep the Render value during migration so existing tokens stay valid |
| `MASTER_KEY` | **Req (prod) · Secret** | insecure dev default + warning | AES-256-GCM key for stored channel credentials. **Must equal the current production value** or existing encrypted credentials can't be decrypted |
| `QR_SECRET` | Opt · Secret | n/a | Only used if `JWT_SECRET` is missing, which boot already prevents. Not needed |

### File storage

| Variable | Class | Default | Notes |
|---|---|---|---|
| `STORAGE_DRIVER` | Req (prod) · Public | `local` | `s3` on AWS |
| `S3_BUCKET` | Req if `s3` · Public | none | Private uploads bucket name. Boot fails if missing with `s3` |
| `S3_REGION` | Req if `s3` · Public | falls back to `AWS_REGION` | e.g. `ap-south-1` |
| `AWS_REGION` | Opt · Public | none | Standard SDK variable, fallback for `S3_REGION` |
| `S3_ACCESS_KEY` | Opt · **Dev** · Secret | unset | **Leave unset on EC2** (IAM role). Set BOTH or NEITHER; half a pair fails boot |
| `S3_SECRET_KEY` | Opt · **Dev** · Secret | unset | As above |
| `S3_ENDPOINT` | Opt · Dev | unset | S3-compatible stores only (MinIO/R2); enables path-style. Unset on AWS |
| `S3_PUBLIC_URL` | Opt · Public | `https://<bucket>.s3.<region>.amazonaws.com` | Only shapes the (unused for private buckets) URL returned by `storage.save`. Leave unset |

### Email

| Variable | Class | Default | Notes |
|---|---|---|---|
| `SMTP_HOST` | Opt (Req for real email) · Public | unset → email logged, not sent (HOST, USER and PASS all required to send) | e.g. `smtp.gmail.com` / SES SMTP endpoint |
| `SMTP_PORT` | Opt · Public | `587` | |
| `SMTP_SECURE` | Opt · Public | `false` | Implied `true` when `SMTP_PORT=465` |
| `SMTP_USER` | Opt · Secret | unset | |
| `SMTP_PASS` | Opt · **Secret** | unset | |
| `MAIL_FROM` | Opt · Public | `Khetify <no-reply@khetify.local>` | Set a real, domain-verified sender in production |
| `MAIL_TEST_MODE` | Opt · **Dev** | unset | `ethereal` sends to a throwaway test inbox |

### Payments (Razorpay)

| Variable | Class | Default | Notes |
|---|---|---|---|
| `RAZORPAY_KEY_ID` | Opt · Public (publishable) | unset → mock gateway | `rzp_live_…` in production. Set with `KEY_SECRET` or not at all |
| `RAZORPAY_KEY_SECRET` | Opt · **Secret** | unset | Never in a `VITE_` variable |
| `RAZORPAY_WEBHOOK_SECRET` | Req with a live key · **Secret** | unset → webhooks rejected | Boot fails with a `rzp_live_` key and no webhook secret |
| `PAYMENT_GATEWAY` | Opt · Public | auto | `mock` / `razorpay` to force |

### Maps / geocoding

| Variable | Class | Default | Notes |
|---|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Opt · Secret | unset → Nominatim | Restrict the key to the Geocoding API |
| `NOMINATIM_USER_AGENT` | Opt · Public | `Khetify/1.0 (support@khetify.com)` | |

### Observability (New Relic)

| Variable | Class | Default | Notes |
|---|---|---|---|
| `NEW_RELIC_LICENSE_KEY` | Opt · **Secret** | unset → agent inactive | |
| `NEW_RELIC_APP_NAME` | Opt · Public | n/a | e.g. `khetify-backend-aws` (keep it distinct from Render during coexistence) |
| `NEW_RELIC_LOG` | Opt · Public | `stdout` in the Docker image | |
| `NEW_RELIC_ENABLED` | Opt · Public | agent default | `false` to disable explicitly |

## Frontend (`Khetify/khetifyApp`), build time only

| Variable | Class | Where | Notes |
|---|---|---|---|
| `VITE_API_URL` | Req · **Public** (inlined into JS) | `.env` (dev: `http://localhost:5000`), `.env.production` (Render URL), or the build shell (overrides both) | AWS build: `https://api.<primary-domain>`, **no trailing slash**. Never put a secret in any `VITE_` variable |

## CI (GitHub Actions)

CI uses only dummy values: `JWT_SECRET=test-secret`, `STORAGE_DRIVER=local`,
`VITE_API_URL=https://api.example.invalid`. **No production secrets are configured in, or needed by, CI.**

## Rendering the env file on EC2 (deployment phase)

```bash
# Run on the instance (uses the instance role; values never printed).
umask 077
aws ssm get-parameters-by-path --path /khetify/prod/ --with-decryption --recursive \
  --query 'Parameters[].[Name,Value]' --output text \
  | awk -F'\t' '{ n=$1; sub(".*/", "", n); print n "=" $2 }' > /etc/khetify/backend.env
chmod 600 /etc/khetify/backend.env
```

Docker `--env-file` takes values literally (no quotes, no multi-line values), so
store each parameter as a single-line value.
