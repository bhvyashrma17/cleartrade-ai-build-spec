# Staging on Neon + Railway + Resend

Provider-specific deployment for the staging environment. The application architecture is
unchanged — this maps the existing platform-neutral container/runtime design onto three
specific providers. `docs/26` remains the authoritative configuration inventory.

**Nothing in this document has been executed.** No Railway project, Neon database or Resend
account exists yet. Everything below is prepared and locally verified where verification was
possible without provider resources.

---

## 1. Services

Four Railway services. Three run the **same application image** (one `Dockerfile`, one build)
and differ only in start command; the scanner is a separate image because the app should not
carry a virus engine and the scanner should not carry the app's dependencies or secrets.

| Service | Image | Start command | Health check | Notes |
|---|---|---|---|---|
| `cleartrade-web` | root `Dockerfile` | `npm start` | `/api/health/ready` | Public. The only internet-facing service. |
| `cleartrade-worker` | root `Dockerfile` | `npm run worker:platform` | none (heartbeat in `WorkerHeartbeat`) | Long-running. 10-minute termination grace. |
| `cleartrade-migrator` | root `Dockerfile` | `npm run migrate:deploy` | n/a | One-shot; must complete before web/worker roll out. |
| `cleartrade-scanner` | `deploy/scanner/Dockerfile` | container default | `/health/ready` | **Private networking only.** Never assign a public domain. |

`railway.json` configures the web service. `deploy/railway/scanner.railway.json` holds the
scanner's build/health settings.

### Why `:platform` script variants exist

The existing `worker`, `sanctions:schedule` and `purge:guests` scripts pass `--env-file=.env`,
which is correct locally but **fails on Railway** — `.env` is excluded by `.dockerignore` and
does not exist in the image, and Node aborts when `--env-file` names a missing file. The
`:platform` variants are identical minus that flag, because Railway injects environment
variables into the process directly. Use the `:platform` form for every Railway service and
cron job.

---

## 2. Neon (PostgreSQL 16, Free plan)

Free is deliberate for this validation phase. Do not upgrade to make a checklist green;
reassess against measured usage (§7) before the pilot.

Neon exposes two endpoints and **both are required**:

| Variable | Neon endpoint | Used by |
|---|---|---|
| `DATABASE_URL` | pooled (`-pooler` host) | web, worker |
| `DIRECT_DATABASE_URL` | direct (no `-pooler`) | migrator, Prisma Migrate |

Append `?sslmode=require` to both — startup validation rejects a URL without it.
Set `DATABASE_IDENTITY_SHA256` to SHA-256 of the exact resolved pooled URL and
`DIRECT_DATABASE_IDENTITY_SHA256` to SHA-256 of the exact resolved direct URL. Both pins are
required independently in staging and production, and `npm run migrate:deploy` refuses to invoke
Prisma when either resolved URL does not match its own environment pin.

### The schema change this required

`prisma/schema.prisma` previously declared only `url`. Neon's pooled endpoint runs PgBouncer in
transaction mode, which cannot hold the session-level advisory lock `prisma migrate deploy`
takes. Migrating through the pooler either hangs on that lock or fails outright. The datasource
now declares `directUrl`, so Migrate uses the direct endpoint while the application keeps the
pooled one.

Consequence for local work: `DIRECT_DATABASE_URL` must now be set locally too (it may point at
the same server as `DATABASE_URL`). `.env.example` and the Vitest global setup both set it —
the test harness sets **both** to its throwaway schema, otherwise `migrate deploy` would target
the developer's real database instead of the isolated one.

Verified locally: `prisma validate`, `migrate deploy` from scratch, and the full test suite all
pass with the pooled/direct split in place.

---

## 3. Object storage

Railway's S3-compatible bucket, private, configured through the **existing** `DocumentStorage`
S3 adapter — no new storage code. It stores user documents, shipment/payment/task evidence and
sanctions raw artifacts in one bucket, key-prefixed by purpose (`sanctions/…`, `objects/…`).

```
STORAGE_BACKEND=s3
STORAGE_BUCKET / STORAGE_REGION / STORAGE_ENDPOINT
STORAGE_FORCE_PATH_STYLE=true        # required for non-AWS S3 implementations
STORAGE_SERVER_SIDE_ENCRYPTION=AES256
```

Credentials must be least-privilege and scoped to this bucket alone. No public ACL, no public
bucket policy.

Once credentials exist:

```bash
npm run verify:staging-storage    # write, metadata, read, size, SHA-256, identity, delete
npm run sanctions:refresh-retained  # one controlled refresh into the real bucket
```

The first is the Phase 4 live proof. The second closes the **outstanding sanctions S3
validation item** carried since the sanctions hardening gate — retention is currently proven
only against the local adapter.

---

## 4. Scanner

`deploy/scanner/` is a ClamAV service exposing exactly the contract `scanForMalware()` expects:

```
POST /scan  application/octet-stream
  200 {"clean":true,  "engine":"clamav","version":"1.4.2/27000"}
  200 {"clean":false, "engine":"clamav","version":"…","signature":"…"}
  4xx/5xx whenever cleanliness could not be established
```

The controlling property: it **never** returns `clean:true` unless clamd affirmatively said OK.
Every error path returns non-2xx, which the client maps to `failed`, which blocks the upload. A
scanner that fails open is worse than none, because it manufactures the appearance of
protection.

- Private networking only. Set `SCANNER_AUTH_TOKEN` anyway — network policy is not
  authorization.
- Readiness requires clamd to answer `PING`; if clamd dies the container exits so Railway
  restarts it, rather than serving a live HTTP face over a dead engine.
- Signature DB fetched at build, refreshed by `freshclam` at runtime. A scanner with no
  signatures answers "clean" to everything, so this is correctness, not optimisation.

`npm run verify:scanner-contract` runs the service against a protocol-accurate fake clamd:
**9/9 passing locally**, covering clean, EICAR, oversize, bad credential, empty body, clamd
error, clamd unreachable and readiness-when-down. This proves the HTTP contract and every
fail-closed path; it does **not** prove ClamAV detects real malware — that is the live EICAR
check in `npm run verify:staging-scanner` against the deployed service.

---

## 5. Resend (operational email only)

`NOTIFICATION_PROVIDER=resend` selects `ResendEmailProvider`. Operational messages only —
account/security, tasks, approvals, compliance blockers, shipment/payment events. **Buyer
outreach is not implemented and must not run through this sender**; outreach carries different
consent and deliverability requirements, and sharing a sending domain would put compliance mail
and cold contact on one reputation.

### Staging recipient guard

A staging environment holding realistic data emails real people by accident — a seeded address,
a copied row, a colleague's account. Not theoretical, and not undoable. Two controls:

1. `NOTIFICATION_ALLOWED_RECIPIENTS` — comma-separated addresses and/or `@domain` suffixes.
2. `NOTIFICATION_REDIRECT_TO` — non-allowed recipients are redirected here (subject prefixed
   `[staging→original@address]`) instead of dropped, so messages stay observable.

Outside production, startup **fails** if neither is set. With an allow-list but no catch-all, an
unlisted recipient is refused permanently rather than sent. The safe outcome is "no email",
never "email to a stranger". The refusal message masks the local part of the address.

Error mapping matches the existing retry contract: 4xx (except 429) is permanent and terminal;
429, 5xx and transport failures retry with backoff. Resend's response id is recorded as the
provider message id; `delivered` stays false because acceptance is not delivery (webhooks
confirm that).

---

## 6. Scheduling

Railway cron, using `:platform` scripts:

| Job | Command | Cadence |
|---|---|---|
| Sanctions refresh tick | `npm run sanctions:schedule:platform` | hourly |
| Guest purge | `npm run purge:guests:platform` | daily |

The sanctions tick is safe hourly: it enqueues only datasets whose per-dataset interval has
elapsed, so tick frequency does not drive fetch frequency. Overlap is safe — a per-dataset
lease, a job dedupe key and a partial unique index each independently prevent concurrent
refreshes or two active snapshots.

---

## 7. Neon Free limits

Report actual usage before recommending any upgrade. Relevant Free-plan characteristics to
measure once running:

- **Storage** — the four sanctions datasets parse to ~26,900 entity rows; raw artifacts
  (~57 MB/refresh) go to object storage, not Postgres.
- **Compute suspension** — Free projects scale to zero when idle. The worker polls, which may
  keep it warm; if cold starts cause job latency, record it as a measured finding.
- **Connections** — always use the pooled endpoint for web/worker. Direct is for the migrator.

Do not upgrade speculatively. Record what is actually hit.

---

## 8. Deployment order

1. Neon project → copy both connection strings.
2. Railway project + environment → set variables (§ docs/26).
3. Deploy `cleartrade-scanner`, wait for `/health/ready`.
4. Run `cleartrade-migrator` to completion.
5. Deploy `cleartrade-worker`, confirm `WorkerHeartbeat`.
6. Deploy `cleartrade-web`, confirm `/api/health/ready`.
7. Configure bucket credentials → `npm run verify:staging-storage`.
8. `npm run verify:staging-scanner`.
9. `npm run sanctions:refresh-retained` (closes the S3 sanctions item).
10. Configure cron jobs.
11. Record the deployed commit SHA and image digest.
