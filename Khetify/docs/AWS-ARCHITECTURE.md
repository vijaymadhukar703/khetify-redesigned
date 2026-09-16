# Khetify on AWS — Architecture (Phase 1 target)

> Status: **planned**. Nothing in this document has been provisioned. Production
> currently runs on Render. The primary domain is not final; `<primary-domain>`
> is a placeholder throughout.

Related documents:

- [AWS-DEPLOYMENT.md](AWS-DEPLOYMENT.md): runbook, cut-over, rollback
- [AWS-ENV-VARS.md](AWS-ENV-VARS.md): environment variable reference
- [AWS-STORAGE-INVENTORY.md](AWS-STORAGE-INVENTORY.md): every upload path and its S3 readiness

---

## 1. Architecture overview

```
                         Hostinger DNS
                              │
        ┌─────────────────────┴───────────────────────┐
        │                                             │
 <primary-domain> / www                       api.<primary-domain>
        │                                             │
   CloudFront (ACM cert, us-east-1)          ALB (ACM cert, ap-south-1)
        │  Origin Access Control                      │  HTTPS 443 → HTTP 5000
        ▼                                             ▼
 Private S3 bucket (frontend)               EC2 × 1 (Docker)
   React/Vite dist/                           └─ khetify-backend container
                                                   │  node Server.js
                                                   │  Express + Socket.IO + node-cron
                                  ┌────────────────┼──────────────────┐
                                  ▼                ▼                  ▼
                           MongoDB Atlas   Private S3 bucket   SSM Parameter Store
                           (ap-south-1)    (uploads, SSE)      (secrets → env file)
                                                   │
                                            CloudWatch Logs (awslogs driver)
```

- **Frontend** is static: `khetifyApp` is built with `VITE_API_URL=https://api.<primary-domain>`
  and the `dist/` output is uploaded to a private S3 bucket served only through CloudFront.
- **Backend** is exactly one Docker container on one EC2 instance behind an ALB.
- **Files** go to a private S3 bucket via `services/fileService.js` and are read
  through short-lived presigned URLs (300 s). Some legacy upload paths still use
  local disk. See [AWS-STORAGE-INVENTORY.md](AWS-STORAGE-INVENTORY.md).
- **Database** is MongoDB Atlas (replica set, so `services/txn.js` uses real transactions).

## 2. AWS services used

| Service | Purpose |
|---|---|
| S3 (frontend bucket) | Static React build, private, CloudFront OAC only |
| CloudFront | HTTPS, caching and SPA fallback for the frontend |
| S3 (uploads bucket) | Private persistent file storage (KYC docs, challans, PC PDFs, POD photos) |
| EC2 (1 instance) | Runs the backend Docker container |
| ALB | TLS termination, health checks, WebSocket pass-through to EC2 |
| ACM | TLS certificates (CloudFront cert **must** be in `us-east-1`; ALB cert in the ALB's region) |
| IAM | EC2 instance role (S3 + SSM read + CloudWatch Logs); no static AWS keys |
| SSM Parameter Store | SecureString secrets, rendered to an env file at deploy time |
| CloudWatch | Container logs (`awslogs` driver), basic EC2/ALB metrics and alarms |

## 3. Intentionally NOT used initially

Lambda, API Gateway, ECS/Fargate, App Runner, EKS, Redis/ElastiCache, SQS/SNS,
EventBridge, EFS, NAT Gateway, DocumentDB, Cognito, CloudFront as an API proxy.

Why: the traffic is low and the backend is stateful (in-memory rate limits,
in-memory Socket.IO rooms, node-cron jobs). One container on one instance is
the simplest deployment that is correct for this code. See §13–14 for what must
change before scaling out.

## 4. Frontend deployment model

- Build: `cd Khetify/khetifyApp && npm ci && VITE_API_URL=https://api.<primary-domain> npm run build`.
  - `VITE_API_URL` is inlined at **build time**. A value set in the build shell
    overrides `.env.production` (which still points at Render so the current
    Render build keeps working).
  - Give it **no trailing slash**. `config/config.js` normalizes one, but two pages
    (`CompanyEditProduct.jsx`, `CompanyProductCatalog.jsx`) read the variable directly.
- Upload `dist/` to the private frontend bucket:
  - `index.html`: `Cache-Control: no-cache`
  - `assets/*` (content-hashed): `Cache-Control: public, max-age=31536000, immutable`
- CloudFront invalidation of `/index.html` after each deploy.
- No frontend Docker image is used on AWS. `khetifyApp/Dockerfile` (nginx) remains for local docker-compose only.

## 5. Backend deployment model

- Image built from `Khetify/khetify-backend/Dockerfile` (Node 20 alpine,
  `npm ci --omit=dev`, `NODE_ENV=production`, non-root `node` user, `/healthz` healthcheck).
- Runs as a single container with `--restart unless-stopped`, env file from SSM,
  and (temporarily) a host directory mounted at `/app/uploads`.
- Listens on port 5000. Only the ALB security group may reach it.

## 6. S3 storage model

- **Private bucket**, Block Public Access ON (all four settings), default SSE-S3 encryption, versioning recommended.
- The app stores the **object key** in MongoDB and generates a presigned GET
  URL at read time (`fileService.signedUrl` / `publicFileUrl`). Never make the bucket public to "fix" a broken link.
- Key prefixes in use: `companies/`, `sellers/`, `shipments/`, `seller-transfers/`, `transfers/`, `pod/`.
- Browser access is by plain navigation (`<a href>` / `window.open`) to the
  presigned URL, so the bucket needs **no CORS rule** today. Add a GET CORS rule
  for the frontend origin only if a future feature `fetch()`es file contents.
- Product images and the company setup-wizard uploads still write to local disk
  (see inventory). Until they are migrated, the EC2 host must persist `/app/uploads` on EBS.

## 7. MongoDB Atlas

- Cluster region: **AWS ap-south-1 (Mumbai)**, same region as EC2, unless an existing production constraint says otherwise.
- `MONGO_URI` comes only from the environment (`mongodb+srv://…`). No credentials live in the source.
- Network access: with no NAT Gateway, the EC2 instance sits in a public subnet with an **Elastic IP**. Add that IP to the Atlas IP access list. VPC peering / PrivateLink can come later.
- Replica set means multi-document transactions are active (`services/txn.js` auto-detects; `MONGO_TRANSACTIONS=on` forces it).
- Use a dedicated Atlas database user with `readWrite` on the app database only.

## 8. IAM role approach

**EC2 IAM role → S3 permissions**, never static access keys on the instance.
`services/storage.js` omits `credentials` unless both `S3_ACCESS_KEY` and
`S3_SECRET_KEY` are set, so the AWS SDK default provider chain picks up the instance role through IMDS.

Instance role policy (least privilege, placeholders):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "UploadsObjects", "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::<uploads-bucket>/*" },
    { "Sid": "ReadAppParameters", "Effect": "Allow",
      "Action": ["ssm:GetParametersByPath", "ssm:GetParameters"],
      "Resource": "arn:aws:ssm:<region>:<account-id>:parameter/khetify/prod/*" },
    { "Sid": "DecryptParameters", "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:<region>:<account-id>:key/<ssm-kms-key-or-alias>" },
    { "Sid": "ContainerLogs", "Effect": "Allow",
      "Action": ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"],
      "Resource": "arn:aws:logs:<region>:<account-id>:log-group:/khetify/backend:*" }
  ]
}
```

Also attach `AmazonSSMManagedInstanceCore` so the instance can be reached with
Session Manager instead of opening SSH. The code never deletes S3 objects, so `s3:DeleteObject` is not granted.

Require IMDSv2 on the instance. Docker containers reach IMDS through the host
network; set the instance metadata **hop limit to 2** so the SDK inside the container can fetch role credentials.

## 9. Networking / security groups

| SG | Inbound | Notes |
|---|---|---|
| `alb-sg` | 443, 80 from `0.0.0.0/0` (and `::/0`) | 80 only redirects to 443 |
| `ec2-sg` | 5000 from `alb-sg` only | No public 5000. No port 22 when using Session Manager |

Optional (free): an **S3 Gateway VPC endpoint** so S3 traffic doesn't leave the VPC.

## 10. ALB requirements

- HTTPS listener :443 with the ACM certificate for `api.<primary-domain>`; HTTP :80 → 301 to HTTPS.
- Target group: HTTP, port 5000, instance target.
  - Health check path **`/healthz`**, success code `200`, interval 30 s, healthy 2 / unhealthy 3.
  - `/healthz` returns `200 {"status":"ok","db":"connected"}` or `503 {"status":"degraded","db":"down"}`. No secrets or connection details.
  - Deregistration delay about 30 s (the app's graceful shutdown force-exits after 10 s).
- **WebSockets**: ALB supports the HTTP/1.1 `Upgrade` natively. No extra setting, but do not put anything in front of the ALB that strips upgrade headers.
- Idle timeout: default 60 s works (Socket.IO pings every 25 s). Raise to 120 s if large uploads over slow mobile links time out.
- Stickiness: not required. Web clients use `transports: ["websocket"]` only, and there is a single target.
- `app.set("trust proxy", 1)` in `Server.js` is correct for **exactly one** proxy hop (the ALB). If CloudFront is ever placed in front of the API, this value and the rate-limit keying must be revisited.

## 11. Socket.IO

- Attached to the same HTTP server (`sockets/index.js`), JWT in `handshake.auth.token`, rooms `company:<id>`, `seller:<id>`, `admins`.
- Room membership lives in process memory, so all sockets must hit the same process. That holds with **one** instance.
- Socket.IO CORS is `origin: "*"`. Auth is a bearer token (no cookies), so this is not a credential exposure. Tighten it together with CORS in a later security phase.
- No Redis adapter. Horizontal scaling would need `@socket.io/redis-adapter` (or similar) plus sticky sessions for polling clients.

## 12. Cron jobs and the single-instance requirement

Defined in `jobs/index.js` and started from `Server.js` after MongoDB connects:

| Schedule | Job | Effect |
|---|---|---|
| `0 2 * * *` | ABC classification (`abcService.classifyAllCompanies`) | Rewrites product ABC classes |
| `* * * * *` | Webhook outbox dispatcher (`outboxService.dispatchPending`) | Delivers outbound integration webhooks |
| `* * * * *` | Support chat inactivity sweep (`chatService.closeInactiveConversations`) | Auto-closes threads idle > 10 min |
| `0 3 * * *` | Ledger vs. stock reconciliation (`reconciliationService.reconcileAllCompanies`) | Flags drift, notifies owners |

**Timezone:** no `timezone` option is set, so schedules use the process timezone.
The Docker image and Render both default to **UTC**, so 02:00 = 07:30 IST and 03:00 = 08:30 IST.
Moving to AWS doesn't change this as long as `TZ` is not set on the container.

> **Initial AWS deployment = exactly ONE backend process with jobs enabled per database.**
> Running two (e.g. Render + EC2 against the same Atlas cluster, or two EC2 targets)
> runs every job twice: duplicate webhook deliveries, duplicate reconciliation notifications.
> Use `JOBS_ENABLED=false` on every additional process.

Future horizontal scaling needs: a job leader lock or a separate worker, a
Socket.IO adapter, and a shared rate-limit store. Out of scope for Phase 1.

## 13. Other in-memory state (single-instance assumptions)

- `express-rate-limit` uses the default memory store (300 req/min per IP on `/api`, 30 per 15 min on auth routes). Limits reset on restart and are per process.
- `services/txn.js` caches transaction support per process (harmless).

## 14. Razorpay webhook

- Endpoint: `POST https://api.<primary-domain>/api/shop/payments/webhook`
- Verification: HMAC-SHA256 of the **raw request bytes** with `RAZORPAY_WEBHOOK_SECRET`,
  compared to `x-razorpay-signature` with `crypto.timingSafeEqual`. It fails closed (400) when the secret or signature is missing.
- Raw body: `express.json({ verify })` in `Server.js` keeps the original buffer for this path only.
  The comparison now ignores a query string, so a `?…` on the configured URL can't silently break verification.
- Works behind an ALB: the ALB does not modify the body or this header, and nothing depends on query-string rewriting.
- The route is under `/api`, so the global rate limit (300/min per source IP) applies. That is far above Razorpay's webhook volume.
- At cut-over, update the webhook URL in the Razorpay Dashboard (Settings → Webhooks). Not changed in Phase 1.

## 15. DNS (Hostinger)

| Record | Target |
|---|---|
| `api.<primary-domain>` CNAME | ALB DNS name |
| `www.<primary-domain>` CNAME | CloudFront distribution domain |
| `<primary-domain>` (apex) | Hostinger cannot CNAME/ALIAS an apex to CloudFront. Either redirect apex → `www` with Hostinger's redirect feature, or move the zone to Route 53 later. **Verify before cut-over.** |
| ACM validation CNAMEs | As issued by ACM (one set per certificate) |

Lower TTLs (e.g. 300 s) a day before cut-over.

## 16. ACM certificates

- CloudFront: certificate for `<primary-domain>` + `www.<primary-domain>`, requested in **us-east-1**.
- ALB: certificate for `api.<primary-domain>`, requested in the **ALB's region** (e.g. ap-south-1).
- DNS validation through Hostinger CNAME records.

## 17. CloudFront SPA fallback

The app uses `BrowserRouter`, so deep links like `/seller/certifications` have no object in S3.

- Recommended: a **CloudFront Function** on viewer-request of the default behavior that rewrites
  any URI **without a file extension** to `/index.html`. Real missing assets still return errors.
- Simpler alternative: custom error responses **403 → /index.html (200)** and **404 → /index.html (200)**.
  With a private bucket and OAC, S3 returns **403** for missing keys, so both are needed. The downside is that genuinely missing assets also get `index.html`.
- Default root object: `index.html`.

## 18. CloudWatch logging

- Container logs are JSON (pino) on stdout. Ship them with the Docker `awslogs` driver to log group `/khetify/backend` (retention e.g. 30 days).
- `Authorization`, `Cookie`, `x-api-key`, `x-razorpay-signature` and `Set-Cookie` headers are **redacted** in request logs (`services/logger.js`).
- New Relic (optional) logs to stdout in the image (`NEW_RELIC_LOG=stdout`).
- Suggested alarms: ALB `UnHealthyHostCount > 0`, ALB 5xx rate, EC2 `StatusCheckFailed`, CPU and memory (CloudWatch agent).
