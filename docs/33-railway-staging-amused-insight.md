# Railway staging — `amused-insight` / `staging`

What actually runs in staging as of 11 Oct 2026, how it was built, and the hazards found on the
way. `docs/26` remains the configuration inventory and `docs/16` the generic runbook; this is the
provider record for the Railway project that also hosts production.

## 1. Topology

One Railway project, two environments. Staging is isolated from production by environment, not by
project: no staging service reads a production variable, database or bucket.

| Service | `production` | `staging` |
|---|---|---|
| `cleartrade-ai-build-spec` (web/API) | `master`, untouched | `staging/railway`, `Dockerfile`, `npm start`, pre-deploy `npm run migrate:deploy`, health `/api/health/ready` (120 s), 2 GB / 2 vCPU |
| `cleartrade-worker` | — (does not exist) | `staging/railway`, `Dockerfile`, `npm run worker:platform`, pre-deploy `npm run migrate:deploy`, 2 GB / 2 vCPU |
| `cleartrade-scanner` | `master`, untouched | `staging/railway`, `deploy/scanner/Dockerfile` (ClamAV), health `/health/ready` (300 s), 4 GB / 2 vCPU |
| `Postgres` | — (production DB is external) | staging-only Railway Postgres; app uses the private network, operators use the TCP proxy |
| Bucket | production bucket | `cleartrade-staging-env-*` (staging only) |

Instance settings mirror `deploy/railway/{web,worker,scanner}.railway.json`. Those files are
deliberately **not** at the repository root: Railway auto-applies a root `railway.json` to every
service built from the repository, which is how the scanner once built and crashed with the
application image.

Both public domains target port **3000** (`PORT=3000`). Railway generated them targeting 8080,
which produced `502 Application failed to respond` while the internal health check — which uses
`PORT` — reported the deployment healthy.

## 2. Configuration

The web and worker carry the same 42 staging values (`PORT` only on web). Every secret is freshly
generated for staging and differs from production: `AUTH_SECRET`, `GUEST_IP_HASH_SECRET`,
`IMPORT_BUYER_REF_SECRET`, `IMPORT_RAW_IDENTITY_ENCRYPTION_KEY`, `OPERATIONS_TOKEN`, the scanner
bearer token, the database credential and the bucket credentials. The database and storage
identity pins (`*_IDENTITY_SHA256`) are computed from the staging URLs and bucket, so a staging
process pointed at production storage or data refuses to start.

- **Comtrade:** `COMTRADE_CLIENT=real`, reusing the development key temporarily (shared quota).
- **Email:** Resend in redirect mode — outside production, every non-allowlisted recipient is
  rewritten to `NOTIFICATION_REDIRECT_TO` with a `[staging→original]` subject prefix. The Resend
  API key is currently shared with production; a staging-only key should replace it.
- **Scanner:** `DOCUMENT_MALWARE_SCANNER=http`, bearer-authenticated; unauthenticated or wrong-token
  requests get 401.
- **Storage (since 30 Oct 2026, E-037):** on web and worker, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `STORAGE_BUCKET` and `STORAGE_ENDPOINT` are references to the staging bucket, so a provider credential
  reset reaches the services. Railway's reset of 21 Oct hit literal copies and stopped storage for nine
  days (R-35). `STORAGE_REGION` waits on the owner's choice between the reference (renders `sin`) and the
  literal `auto`. The operator env still holds literal copies; re-copy them after any reset.
- **Census:** `CENSUS_API_KEY` is on web and, as a reference to web's, on the worker, where the
  regional-demand job runs.

## 3. First-time bootstrap of an empty staging database

1. Deploy; `migrate:deploy` applies the full migration history in the pre-deploy step.
2. `APP_ENV=staging npx tsx --env-file=<operator env> scripts/bootstrap-staging-fee-policy.ts` —
   registration snapshots the commitment fee from the active `FeePolicy`, and the only API that
   creates one needs an admin who cannot yet register. The script refuses production and refuses
   any database that already has a policy; every later change goes through
   `POST /api/v1/fee-policy`. Never run `prisma/seed.ts` against staging: it creates demo tenants
   with a published shared password.
3. Register the operator through the deployed `POST /api/v1/register`, then
   `scripts/staging-pilot.ts promote <email>`.
4. Load Customs Atlas releases (see `docs/customs-atlas/railway-staging-acceptance-2026-10-11.md`).

The operator env for steps 2–4 is the staging variable set with the database URLs swapped for the
TCP-proxy URLs and their identity pins recomputed. It lives only in the gitignored `tmp/rw/`.

## 4. Verification (11 Oct 2026, commit `933614fa`)

| Check | Result |
|---|---|
| `/api/health/live` | 200 |
| `/api/health/ready` | `ready`: database, S3 storage, worker heartbeat |
| `scripts/verify-staging-storage.ts` | 9/9 |
| `scripts/verify-staging-scanner.ts` | 6/6 (clean accepted, EICAR blocked, unavailable and timeout not clean) |
| Scanner without / with wrong token | 401 / 401 |
| Comtrade job on the deployed worker | completed, 39 `TradeFlow` rows (chapter 09, India exports, 2024) |
| Customs Atlas | 55/55 sovereigns in one full deployed run — see the acceptance record |

## 5. Hazards found, not fixed here

- **Production web scans against the staging scanner domain.** Production's
  `DOCUMENT_MALWARE_SCANNER_URL` points at `cleartrade-scanner-staging.up.railway.app`. Staging now
  has its own scanner token, so production uploads fail closed (they were already failing: the
  production scanner's last deployment failed on 24 Aug). Production needs its own scanner.
- **The old staging web migrated the production database on 8 Oct** — staging previously carried
  production's database URL. Staging now has its own database; production's migration state
  should be reviewed.
- **Production web deploy settings** still come from the root `railway.json` that has since moved
  to `deploy/railway/web.railway.json`. Before this branch reaches `master`, set production's
  instance settings explicitly or it will lose its pre-deploy migration and health check.
- **Resend key** shared with production (see §2).
