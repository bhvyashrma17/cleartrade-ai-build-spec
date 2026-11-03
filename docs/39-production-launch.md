# Production launch — `www.cleartrade.in` (WP5, WP6)

How production moves from the 24 Aug 2026 code to the release that passed the Phase 1 gate (E-048),
with Demand Discovery v5 and its data, a working scanner and a worker. Written from production's
read-only check of 3 Nov 2026 (E-049); every step is checked before the next one starts.

| Who | Does |
|---|---|
| **Owner** | Dashboard steps only the owner can take (Railway, Neon, Resend, UN Comtrade) and the merge into `master` (D-001) |
| **Claude Code (CC)** | Railway CLI, imports and checks on the owner's Mac, with production's variables injected by `railway run --environment production --service <service>` or read from `tmp/rw/production.env` (gitignored). Never prints a secret |
| **Agent** | Pull requests, the release PR's CI, and the ledger |

**Authority.** The owner authorized these production changes on 3 Nov 2026, to be made in one
session with the owner present (E-049): everything in §2–§6, nothing else. Razorpay's keys are not
rotated (owner). Production keeps its Neon database (owner).

## 1. Starting point (read-only check, 3 Nov 2026, E-049)

| Area | Found |
|---|---|
| Database | Neon, AWS `ap-southeast-1` (Singapore), Postgres 16. 80 of the release's 85 migrations applied: 15 staging-only ones were applied 26 Aug – 2 Sep while an old staging service carried this database's URL (docs/33 §5). Missing: `20261013100000_trade_dataset_releases`, `20261013180000_demand_discovery_v5_runs`, `20261013181000_assessment_delete_guard_returns_old`, `20261022100000_regional_demand_runs`, `20261022120000_official_importer_lists` |
| Data | 17 users (14 exporter owners, 2 agents, 1 admin: the owner), 16 organisations (12 free, 4 paid), an active FeePolicy, 14 discovery runs, 3 deals, 21 documents. Test data: 4 `pilot.invalid` users in 3 `[PILOT]` organisations, which own all 3 deals and all 21 documents; 1 user on a reserved test domain |
| Web | `master`, auto-deploy on, Singapore, 1 replica. Build, start and health check come from the root `railway.json`, which the release deletes; pre-deploy `npx prisma migrate deploy` from service settings. Last deploy 8 Oct (a redeploy of 24 Aug). Holds `www.cleartrade.in`; the apex redirects to `www` |
| Readiness | `/api/health/ready` **503**: storage. Production's storage variables are literal copies that went stale in Railway's 21 Oct bucket roll, and they name the *staging* environment's copy of the `cleartrade-staging` bucket (`cleartrade-staging-4nwl2e`). Production's own copy of that bucket is unused (R-13) |
| Scanner | No source branch, auto-deploy off; last deploy (24 Aug) failed: the root `railway.json` built it with the application image (docs/33 §1). Web scans against **staging's** scanner URL |
| Worker | None. No `*_IDENTITY_SHA256` variables |
| Payments | Razorpay configured (live). Stays on (owner) |

## 2. Before the merge

Production keeps serving the 24 Aug code until §3. Every Railway variable change in this section is
made with `--skip-deploys` (or staged without deploying in the dashboard), so nothing redeploys early.

### 2.1 Backups (owner, CC)
1. **Neon** (owner): Branches → *Create branch* from production's primary branch, at the current
   time, named `before-launch-2026-11-03`. This is the database to return to (§7).
2. **Variables** (CC): save production web's and scanner's current variables to
   `tmp/rw/production-variables-before-2026-11-03.json` (gitignored, never printed), so any value
   can be restored.

### 2.2 Storage: production's own bucket (CC)
Exactly as staging was fixed (E-037): on production web, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `STORAGE_BUCKET` and `STORAGE_ENDPOINT` become **references** to
production's own instance of the bucket service; `STORAGE_REGION` the literal `auto`;
`STORAGE_BACKEND=s3`. References follow any future credential roll. Nothing real is lost: the only
stored documents are the 21 `[PILOT]` ones (§6).

### 2.3 Passwords and keys (R-36)
Railway advised rotating every secret stored before its 21 Oct incident. Do this last in §2, right
before §3: the Neon reset stops the old code's database connections until the release deploys.

| Value | Who | How |
|---|---|---|
| Neon app role password | Owner, then CC | Owner resets it in Neon (Roles). CC sets `DATABASE_URL` (pooled host, `-pooler`) and `DIRECT_DATABASE_URL` (direct host), both `sslmode=require` |
| `DATABASE_IDENTITY_SHA256`, `DIRECT_DATABASE_IDENTITY_SHA256` | CC | SHA-256 of the exact URLs (`databaseIdentityFingerprint`, `directDatabaseIdentityFingerprint` in `runtime-config.ts`), computed inside `railway run` and set without printing. Required by the new code's start-up and by `migrate:deploy` |
| `AUTH_SECRET`, `GUEST_IP_HASH_SECRET`, `OPERATIONS_TOKEN` | CC | Fresh, ≥ 32 characters. A new `AUTH_SECRET` signs everyone out once |
| `IMPORT_BUYER_REF_SECRET`, `IMPORT_RAW_IDENTITY_ENCRYPTION_KEY` with `IMPORT_BUYER_REF_KEY_VERSION=v1`, `IMPORT_RAW_IDENTITY_KEY_VERSION=v1` | CC | First count `ImportRecord` rows (read-only). None: set fresh values. Any: keep the old values under the `*_PREVIOUS_*` maps and use version `v2` (docs/28 §3) |
| `RESEND_API_KEY` | Owner, then CC | Owner creates one key for production and one for staging in Resend; CC sets them; the owner revokes the old shared key once both environments are healthy |
| `COMTRADE_API_KEY` | Owner, then CC | A production subscription key from the UN Comtrade portal |
| `CENSUS_API_KEY` | CC | Production web; the worker references it |
| `SCANNER_AUTH_TOKEN` = web's `DOCUMENT_MALWARE_SCANNER_TOKEN` | CC | One fresh value set on both (§2.4) |
| Razorpay (5 values) | — | Unchanged (owner, 3 Nov) |

### 2.4 Scanner (owner, CC)
- Owner, production scanner service: *Source* this repository, branch `master`, auto-deploy on;
  *Config file path* `deploy/railway/scanner.railway.json` (Dockerfile `deploy/scanner/Dockerfile`,
  health `/health/ready`, 300 s); 4 GB / 2 vCPU as staging; *Networking* → generate a public domain.
- CC: remove the scanner's stale `RAILWAY_DOCKERFILE_PATH` (the config file names the Dockerfile);
  set `SCANNER_AUTH_TOKEN` (§2.3); on web, `DOCUMENT_MALWARE_SCANNER=http`,
  `DOCUMENT_MALWARE_SCANNER_URL=https://<that domain>/scan` and the same token.

### 2.5 Web settings (owner)
Production web → Settings → *Config file path* `deploy/railway/web.railway.json`. From the next
deploy it supplies what the deleted root `railway.json` did, plus the pre-deploy
`npm run migrate:deploy` (identity check, then migrations) and the `/api/health/ready` check (120 s).

### 2.6 Worker (owner, CC)
- Owner: production → *New service* → this repository, branch `master`, region **Singapore** (web
  and Neon are there; R-37), *Config file path* `deploy/railway/worker.railway.json`, 1 replica
  (R-11), 2 GB / 2 vCPU.
- CC: every variable of web except `PORT` as a reference to web's (as staging, docs/33 §2).

### 2.7 Preflight (CC, read-only)
On a checkout of the release commit (the `staging/railway` tip):

```
railway run --environment production --service cleartrade-ai-build-spec -- npx tsx scripts/env-check.ts --role=web
railway run --environment production --service cleartrade-worker -- npx tsx scripts/env-check.ts --role=worker
```

Run `env-check.ts` directly, not `npm run env:check`: the npm script also reads `.env.local`, which
could hide a variable production lacks. Both must report *runtime validation passes*. Record the
first 12 characters of production's database fingerprint for the session (they are what
`--confirm-production` asks for, §4.3 and §6).

## 3. The release

1. Agent: PR `staging/railway` → `master`, "Release: Demand Discovery v5 to production". Its CI
   must pass. `master` is an ancestor of `staging/railway` (198 commits behind on 3 Nov), so the
   merge has no conflicts.
2. Owner merges. Railway deploys web, worker and scanner from `master`.
3. Web's pre-deploy checks the database identity and applies the five migrations of §1. The new
   deployment takes traffic only when `/api/health/ready` passes; if anything fails, Railway keeps
   serving the old deployment while it is fixed.
4. Checks (CC, agent):
   - `https://www.cleartrade.in/api/health/ready` → 200 `ready` (database, storage, worker).
   - `railway run … -- npx tsx scripts/verify-staging-scanner.ts` → 4 / 4 (clean accepted, EICAR
     blocked, unavailable and timeout not clean); the scanner without or with a wrong token → 401.
   - `railway run … -- npx tsx scripts/verify-staging-storage.ts` → 9 / 9 (writes and removes its own
     probe objects).
   - The owner signs in (everyone signs in again after the new `AUTH_SECRET`).
5. Then `REQUIRE_WORKER_READY=true` on web and redeploy it; readiness stays 200.

## 4. Demand Discovery data (CC)

`tmp/rw/production.env`: production web's variables, built like staging's operator env (docs/33 §3).
Neon's hosts are public with TLS, so no proxy is needed. Each import runs twice and the second run
must say UNCHANGED (docs/36 §10).

1. **Reference data and BACI**: docs/36 §10 steps 2–5 and 9 (BACI HS17 and HS22, the World Bank
   indicators, Comtrade's reporting lists, ECGC, GeoDist, India's agreements, capitals, currency
   pegs, sanctions programmes, shipping connectivity, the HS22 product codes), with the same SHA-256
   pins. `<merged commit>` in the source URLs is the release commit on `master`.
2. **Official tariffs**: make production's active releases equal staging's. CC lists staging's
   active authority and tariff releases read-only (family, edition, bundle SHA-256, importer) and
   replays each through its family's canonical importer against production with the same pins: the
   method of `docs/customs-atlas/railway-staging-acceptance-2026-10-11.md`, plus docs/37 for the
   schedule bundles and customs unions. Families read live from their authority use
   `ingest-authority-release.ts`; Singapore only between 03:00 and 07:00 SGT, or by the nightly
   refresh (4.4). The US and the UK need nothing (live APIs). CC then compares the two active lists.
3. **Importer lists** (stage 3): the newest HMRC monthly list, through
   `import-importer-list.ts … --confirm-production=<prefix>` (the owner accepted the licensing, E-049).
4. **Settings** (owner, as admin in `/ops`): `demand_discovery.v5` →
   `reference_auto_import_actor_email` (an ops supervisor or admin) so the World Bank and Comtrade
   lists refresh daily, and re-runs on new data on; the official tariff look-up on;
   `market_access.authority_refresh` on with its actor (Singapore, nightly inside the window).
5. **Check**: `/ops/discovery` shows "Runs can start" and no dataset "Not imported".

## 5. The owner's test

- Signed out: the free estimate for a product (the code finder opens under the HS field).
- As an exporter: register with an email that is not the admin account, pay the commitment fee
  (Razorpay is live, so this is a real payment; an admin can waive it in `/ops` instead), add a
  product and confirm its HS code. Demand Discovery starts by itself; the results show the ranked
  markets and "Where India already sells most". On a market page: regional demand (US) and buyers
  (UK).
- As admin: the run in `/ops/discovery`.

## 6. Removing the test data (CC, after the backup in §2.1)

```
railway run --environment production --service cleartrade-ai-build-spec -- npx tsx scripts/staging-pilot.ts status
railway run --environment production --service cleartrade-ai-build-spec -- npx tsx scripts/staging-pilot.ts reset \
  --include-reserved-test-domains --confirm-production=<prefix> --actor-email=<owner's admin email>
```

`reset` removes the `[PILOT]` organisations with everything they own (deals, documents, runs), the
`pilot.invalid` users and the account on a reserved test domain, in one transaction, and records a
`pilot_data_removed` audit event. It refuses, changing nothing, if an organisation holds issued
invoice numbers (append-only by design) or if another record still points at an account: then stop
and report. Afterwards nothing production uses lives in `cleartrade-staging-4nwl2e`; the owner may
delete that bucket copy in Railway.

## 7. Rollback

| When | How |
|---|---|
| Before §3 | Restore any variable from the §2.1 copy |
| After §3 | Web → Deployments → redeploy the previous successful deployment (the 24 Aug code). The five new migrations only add tables and fix a trigger, so the old code runs on the migrated schema |
| Data gone wrong | Point the URLs (and pins) at the Neon branch `before-launch-2026-11-03`. It discards every write since §2.1, so only for damaged data |

## 8. Afterwards

- Owner: revoke the old Resend key; delete `cleartrade-staging-4nwl2e` once §6 is done.
- Staging gets its own Resend and Comtrade keys and its other secrets rotated (R-36), and its
  worker moves to Singapore (R-37).
- docs/33 §5's hazards are resolved by §2–§3; the ledger records each check with its result.
- Support from day one: `docs/40-support-guide.md`.
