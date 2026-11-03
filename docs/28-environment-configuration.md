# Environment configuration

**No values appear in this document, and none ever should.** Names, classifications, semantic
values and ownership only. Run `npm run env:check` to see the state of your own machine.

Three environments exist, and each has exactly one authoritative source of configuration:

| Environment | Authoritative source | Who owns it |
|---|---|---|
| **local development** | `.env.local` on your machine (gitignored) | you |
| **Railway staging** | Railway → service → Variables | ops |
| **Railway production** (`www.cleartrade.in`, live) | Railway → production service → Variables | ops |

**No file in this repository ever holds a production value.** Production configuration lives
only in Railway Variables on the production service. `.env.local` is for your machine and is
never a source for a deployed environment; `.env.example` and `.env.staging.example` are
committed templates holding placeholders only.

The failure this structure prevents is a local checkout quietly reading or writing a real
staging database, bucket or email provider. That is not hypothetical: the same `AUTH_SECRET`
and identity keys are valid in both places, so nothing except deliberate separation stops a
dev machine from acting on staging data.

---

## 1. Files

| File | Tracked? | Contains | Notes |
|---|---|---|---|
| `.env.example` | **yes** | variable names, safe placeholders, descriptions | The template. Never a real credential. |
| `.env.local` | no (`.gitignore: .env*.local`) | your real local values | Mode `0600`. The only local file the app and every `npm run` script reads. |
| `.env.staging.example` | **yes** | staging variable names with `REPLACE` placeholders | A shape reference for Railway, not a deployable file. |
| `.env.staging.secrets` | no (`.gitignore`) | ClearTrade-**generated** staging secrets, transiently | Output of `npm run secrets:staging`. Transfer to Railway, then delete. **Not** the complete staging configuration — it holds only the secrets we mint, never provider credentials or URLs. |

`.env` is **not used**. It was the old local filename; it has been consolidated into
`.env.local`. Two files with overlapping keys is the ambiguity this structure removes — and
because Next.js gives `.env.local` precedence, a leftover `.env` becomes a silent shadow whose
values are read by `tsx` scripts but ignored by `next dev`. If one reappears, delete it.

Getting started on a new machine:

```bash
cp .env.example .env.local
chmod 600 .env.local
# fill in the generated secrets and your local database URL, then:
npm run env:check
```

---

## 2. What belongs where

### Local development (`.env.local`)

- `APP_ENV=development`, `DATABASE_ENVIRONMENT=development`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`.
- A **local** Postgres URL (`localhost`, database name containing `dev`). Never a hosted URL.
- Locally generated secrets. They may be weak-ish and reused across your own machines; they
  are not staging's and must never be copied into staging, or the reverse.
- Provider **modes** set to local stand-ins, so no external service is required:
  `COMTRADE_CLIENT=mock`, `STORAGE_BACKEND=local`, `DOCUMENT_MALWARE_SCANNER=development`,
  `NOTIFICATION_PROVIDER=sandbox`, `ERROR_REPORTING_PROVIDER=log`, `DISCOVERY_ENGINE=warehouse`,
  `RATIONALE_WRITER=template`.
- `OPERATIONS_TOKEN` may be left empty: with `APP_ENV=development`, `operationsAuthorized()`
  opens `/api/metrics` without a token. Set it if you want to exercise the real bearer path.

### Railway staging (Railway Variables)

- `APP_ENV=staging`, `DATABASE_ENVIRONMENT=staging` (startup fails unless they match).
- Pooled `DATABASE_URL` and unpooled `DIRECT_DATABASE_URL`, both with `sslmode=require` or
  stricter, neither labelled `dev`/`test`/`local`. Independently pin their exact resolved values
  with `DATABASE_IDENTITY_SHA256` and `DIRECT_DATABASE_IDENTITY_SHA256`; startup and migration
  tooling reject a copied, rotated or cross-environment URL before connecting.
- `NEXT_PUBLIC_APP_URL` on **https** — it is compiled into the client bundle and scopes cookies.
- Independently generated secrets from `npm run secrets:staging`. Never the development values.
- Real providers: `COMTRADE_CLIENT=real`, `STORAGE_BACKEND=s3`, `DOCUMENT_MALWARE_SCANNER=http`
  with an https URL, `NOTIFICATION_PROVIDER=http|resend`.
- Because staging is a real environment but not production, it must not be able to email
  arbitrary people: `NOTIFICATION_ALLOWED_RECIPIENTS` or `NOTIFICATION_REDIRECT_TO` is
  **required** when using Resend.
- Two services, two variable sets. The **web** service holds
  `DOCUMENT_MALWARE_SCANNER_TOKEN`; the **scanner** service holds `SCANNER_AUTH_TOKEN`. These
  two must hold the same value or every upload fails closed.

### Railway production — `www.cleartrade.in` (live)

Same shape as staging, with these differences:

- `APP_ENV=production`, `DATABASE_ENVIRONMENT=production`, separate database and bucket. Production
  requires its own pooled and direct SHA-256 identity pins; neither staging pin is valid there.
- `NEXT_PUBLIC_APP_URL=https://www.cleartrade.in` — the `www` host is canonical; the apex
  does not serve the app. It is compiled into the client bundle and scopes cookies, so
  changing it requires a rebuild, not just a restart.
- Freshly generated secrets again — production never inherits staging's.
- `NOTIFICATION_ALLOWED_RECIPIENTS`/`NOTIFICATION_REDIRECT_TO` are no longer required (this is
  the environment permitted to email real users), so removing them is a deliberate step.
- Prefer workload identity over static `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`.
- `DANGEROUS_ALLOW_PRODUCTION_FIXTURES` must never be set.
- **Payments**: the five `RAZORPAY_*` variables hold **live-mode** credentials and exist only
  here. See §3 *Payments* below — the web service refuses to boot without them unless
  `PAYMENTS_DISABLED=true` is set deliberately.

---

## 3. Variable matrix

Requirement key: **R** required · **r** recommended · **o** optional · **–** not applicable ·
**✗** must not be set. "Local value" and "Staging value" are *semantic* values, never literals.

### Environment identity

| Variable | Local | Stg | Prod | Class | Source | Local value | Staging value | Consumed by |
|---|---|---|---|---|---|---|---|---|
| `APP_ENV` | R | R | R | public | ClearTrade | `development` | `staging` | `evidence-environment.ts`, gates every real-environment rule |
| `DATABASE_ENVIRONMENT` | R | R | R | public | ClearTrade | `development` | `staging` (must equal `APP_ENV`) | `runtime-config.ts` |
| `NEXT_PUBLIC_APP_URL` | R | R | R | public | ClearTrade | `http://localhost:3000` | staging https URL | `runtime-config.ts`, `notification-delivery.ts`, client bundle |
| `EVIDENCE_DEMO_MODE` | o | o | o | public | ClearTrade | unset | unset | `evidence-environment.ts` |
| `DANGEROUS_ALLOW_PRODUCTION_FIXTURES` | o | ✗ | ✗ | public | ClearTrade | unset | unset | `evidence-environment.ts` |

### Database

| Variable | Local | Stg | Prod | Class | Source | Local value | Staging value | Consumed by |
|---|---|---|---|---|---|---|---|---|
| `DATABASE_URL` | R | R | R | **secret** | managed Postgres | local `cleartrade_dev` | pooled staging URL, `sslmode=require` | `prisma/schema.prisma`, `runtime-config.ts` |
| `DIRECT_DATABASE_URL` | r | R | R | **secret** | managed Postgres | same local URL | unpooled staging URL, TLS | `schema.prisma` `directUrl`, `db-backup.sh` |
| `DATABASE_IDENTITY_SHA256` | o | R | R | **secret** | ClearTrade | unset | SHA-256 of exact resolved pooled URL | `runtime-config.ts`, migration tooling |
| `DIRECT_DATABASE_IDENTITY_SHA256` | o | R | R | **secret** | ClearTrade | unset | SHA-256 of exact resolved direct URL | `runtime-config.ts`, migration/backup tooling |
| `RESTORE_DRILL_DATABASE_URL` | o | o | o | **secret** | managed Postgres | unset | drill target only | `db-restore-drill.sh` |

### Auth, guests and identity crypto — all ClearTrade-generated

| Variable | Local | Stg | Prod | Class | Source | Local value | Staging value | Consumed by |
|---|---|---|---|---|---|---|---|---|
| `AUTH_SECRET` | R | R | R | **secret** | generated | local random | independent random, ≥32 chars | `auth.ts` |
| `AUTH_TRUST_HOST` | o | o | o | public | ClearTrade | `on` | platform-dependent | Auth.js |
| `AUTH_GOOGLE_ID` | o | o | o | **secret** | Google OAuth | unset | set only when Google sign-in is enabled | `auth.ts` |
| `AUTH_GOOGLE_SECRET` | o | o | o | **secret** | Google OAuth | unset | set only when Google sign-in is enabled | `auth.ts` |
| `AUTH_APPLE_ID` | o | o | o | **secret** | Apple OAuth | unset | set only when Apple sign-in is enabled | `auth.ts` |
| `AUTH_APPLE_SECRET` | o | o | o | **secret** | Apple OAuth | unset | ES256 JWT, expires ≤6 months (docs/29) | `auth.ts` |
| `APPLE_TEAM_ID` | o | – | – | public | Apple Developer | generation-time only | not set at runtime | `scripts/generate-apple-client-secret.ts` |
| `APPLE_KEY_ID` | o | – | – | public | Apple Developer | generation-time only | not set at runtime | `scripts/generate-apple-client-secret.ts` |
| `APPLE_AUTH_KEY_FILE` | o | – | – | public | Apple Developer | path to an untracked `.p8` | not set at runtime | `scripts/generate-apple-client-secret.ts` |
| `GUEST_IP_HASH_SECRET` | R | R | R | **secret** | generated | local random | independent random | `guest.ts` |
| `GUEST_TRUST_XFF` | o | o | o | public | ClearTrade | `false` | `true` only behind a trusted proxy | `guest.ts` |
| `OPERATIONS_TOKEN` | o | R | R | **secret** | generated | may be empty | independent random | `operations-auth.ts` |
| `IMPORT_BUYER_REF_SECRET` | R | R | R | **secret** | generated | local random | independent random | `import-identity.ts` |
| `IMPORT_BUYER_REF_KEY_VERSION` | o | R | R | public | generated | `v1` | `v1`, bumped per rotation | `import-identity.ts` |
| `IMPORT_BUYER_REF_PREVIOUS_SECRETS` | o | o | o | **secret** | generated | `{}` | retired keys JSON | `import-identity.ts` |
| `IMPORT_RAW_IDENTITY_ENCRYPTION_KEY` | R | R | R | **secret** | generated | local 32-byte base64 | independent 32-byte base64 | `import-identity.ts` |
| `IMPORT_RAW_IDENTITY_KEY_VERSION` | o | R | R | public | generated | `v1` | `v1`, bumped per rotation | `import-identity.ts` |
| `IMPORT_RAW_IDENTITY_PREVIOUS_KEYS` | o | o | o | **secret** | generated | `{}` | retired keys JSON | `import-identity.ts` |

### Comtrade, discovery and documents

| Variable | Local | Stg | Prod | Class | Source | Local value | Staging value | Consumed by |
|---|---|---|---|---|---|---|---|---|
| `COMTRADE_CLIENT` | R | R | R | public | ClearTrade | `mock` | `real` | `comtrade/index.ts` |
| `COMTRADE_API_KEY` | o | R | R | **secret** | UN Comtrade | unset unless testing live | provider key | `comtrade/real-client.ts` |
| `COMTRADE_BASE_URL` | o | o | o | public | UN Comtrade | unset | provider default | `comtrade/real-client.ts` |
| `CENSUS_API_KEY` | o | o | o | **secret** | U.S. Census Bureau (free key, api.census.gov/data/key_signup.html) | unset | provider key; without it US regional demand is shown as unavailable | `job-handlers/regional-demand.ts` (D-033, docs/38) |
| `DISCOVERY_ENGINE` | o | r | r | public | ClearTrade | `warehouse` | `warehouse` (`mock` rejected) | `discovery/index.ts` |
| `DISCOVERY_MOCK_LATENCY_MS` | o | – | – | public | ClearTrade | unset | – | `discovery/index.ts` |
| `RATIONALE_WRITER` | o | o | o | public | ClearTrade | `template` | `template` | `discovery/rationale/index.ts` |
| `ANTHROPIC_API_KEY` | o | o | o | **secret** | Anthropic | unset | only if `RATIONALE_WRITER=claude` | `discovery/rationale/index.ts` |
| `DOCUMENT_ENGINE` | o | o | o | public | ClearTrade | `mock` | default | `document-generation/index.ts` |

### Storage

| Variable | Local | Stg | Prod | Class | Source | Local value | Staging value | Consumed by |
|---|---|---|---|---|---|---|---|---|
| `STORAGE_BACKEND` | R | R | R | public | ClearTrade | `local` (writes `.data/`) | `s3` | `document-storage.ts` |
| `STORAGE_BUCKET` | – | R | R | public | object storage | unset | staging bucket | `document-storage.ts` |
| `STORAGE_REGION` | – | R | R | public | object storage | unset | bucket region | `document-storage.ts` |
| `STORAGE_ENDPOINT` | – | o | o | public | object storage | unset | non-AWS endpoint | `document-storage.ts` |
| `STORAGE_FORCE_PATH_STYLE` | – | o | o | public | object storage | unset | provider-dependent | `document-storage.ts` |
| `STORAGE_SERVER_SIDE_ENCRYPTION` | – | o | o | public | object storage | unset | `AES256` or `aws:kms` | `document-storage.ts` |
| `STORAGE_PUBLIC_BASE_URL` | – | o | o | public | object storage | unset | used to prove bucket is private | `verify-staging-storage.ts` |
| `AWS_ACCESS_KEY_ID` | – | R | R | **secret** | object storage | unset | least-privilege key | AWS SDK credential chain (not app code) |
| `AWS_SECRET_ACCESS_KEY` | – | R | R | **secret** | object storage | unset | least-privilege key | AWS SDK credential chain (not app code) |
| `UPLOAD_MAX_BYTES` | o | o | o | public | ClearTrade | unset (25 MiB) | default | `document-storage.ts` |

### Malware scanner (web side)

| Variable | Local | Stg | Prod | Class | Source | Local value | Staging value | Consumed by |
|---|---|---|---|---|---|---|---|---|
| `DOCUMENT_MALWARE_SCANNER` | R | R | R | public | ClearTrade | `development` | `http` | `document-storage.ts` |
| `DOCUMENT_MALWARE_SCANNER_URL` | – | R | R | public | self-hosted | unset | private https scanner URL | `document-storage.ts` |
| `DOCUMENT_MALWARE_SCANNER_TOKEN` | – | r | r | **secret** | self-hosted | unset | must equal scanner `SCANNER_AUTH_TOKEN` | `document-storage.ts` |
| `DOCUMENT_MALWARE_SCANNER_TIMEOUT_MS` | o | o | o | public | ClearTrade | unset (30 s) | default | `document-storage.ts` |
| `DOCUMENT_MALWARE_SCANNER_MAX_BYTES` | o | o | o | public | ClearTrade | unset (32 MiB) | default | `document-storage.ts` |

### Notifications

| Variable | Local | Stg | Prod | Class | Source | Local value | Staging value | Consumed by |
|---|---|---|---|---|---|---|---|---|
| `NOTIFICATION_PROVIDER` | R | R | R | public | ClearTrade | `sandbox` | `http` or `resend` | `notification-delivery.ts` |
| `RESEND_API_KEY` | – | R if `resend` | R if `resend` | **secret** | Resend | unset | Resend key | `notification-delivery.ts` |
| `NOTIFICATION_PROVIDER_API_KEY` | – | R if `http` | R if `http` | **secret** | email provider | unset | provider key | `notification-delivery.ts` |
| `NOTIFICATION_PROVIDER_URL` | – | R if `http` | R if `http` | public | email provider | unset | provider endpoint | `notification-delivery.ts` |
| `NOTIFICATION_FROM_EMAIL` | – | R if `resend` | R if `resend` | public | Resend | unset | verified sender | `notification-delivery.ts` |
| `NOTIFICATION_ALLOWED_RECIPIENTS` | o | R\* | o | public | ClearTrade | unset | allowlist | `notification-delivery.ts` |
| `NOTIFICATION_REDIRECT_TO` | o | R\* | o | public | ClearTrade | unset | single catch-all inbox | `notification-delivery.ts` |

\* One of the two is required outside production when `NOTIFICATION_PROVIDER=resend`.

### Payments (Razorpay memberships)

| Variable | Local | Stg | Prod | Class | Source | Local value | Staging value | Consumed by |
|---|---|---|---|---|---|---|---|---|
| `RAZORPAY_KEY_ID` | o | o | **R** | **secret** | Razorpay | unset, or `rzp_test_…` | `rzp_test_…` | `billing/razorpay.ts` |
| `RAZORPAY_KEY_SECRET` | o | o | **R** | **secret** | Razorpay | unset | test-mode secret | `billing/razorpay.ts` |
| `RAZORPAY_WEBHOOK_SECRET` | o | o | **R** | **secret** | Razorpay | unset | per-environment webhook secret | `api/v1/billing/razorpay/webhook` |
| `RAZORPAY_PLAN_ID_MONTHLY` | o | o | **R** | public | Razorpay | unset | test-mode plan id | `api/v1/billing/subscription` |
| `RAZORPAY_PLAN_ID_ANNUAL` | o | o | **R** | public | Razorpay | unset | test-mode plan id | `api/v1/billing/subscription` |
| `PAYMENTS_DISABLED` | o | o | o | public | ClearTrade | unset | unset | `runtime-config.ts` |

Rules the startup check enforces (`razorpayProblems()` in `runtime-config.ts`, web role only —
the worker needs no gateway credentials):

- **All five or none.** A partially configured gateway is the dangerous state: keys present
  but no webhook secret means cards are charged and no confirmation can ever be verified, so
  memberships never activate and the money must be refunded by hand.
- **`rzp_live_…` outside production is refused**, because it charges real cards from a laptop.
  **`rzp_test_…` in production is refused**, because no real payment can succeed.
- **Production without payments is refused** unless `PAYMENTS_DISABLED=true` states it
  deliberately — otherwise a mistyped variable becomes a silent revenue outage that no health
  check would catch. Setting `PAYMENTS_DISABLED=true` *alongside* credentials is also refused
  as ambiguous.
- The monthly and annual plan ids must be **distinct** Razorpay plans.

Test-mode and live-mode are separate universes in Razorpay: different keys, different plan
objects, different webhook endpoints and secrets. Nothing is shared between them, and a
live-mode key rotation re-authorizes every existing mandate — which is why these values live
only in Railway Variables and never in a file.

**Webhook endpoint**, registered in the Razorpay dashboard per environment:

| Environment | Endpoint |
|---|---|
| production | `https://www.cleartrade.in/api/v1/billing/razorpay/webhook` |
| local | a tunnel (`ngrok http 3000`) — Razorpay's servers must be able to reach it, so `localhost` alone receives nothing |

**`www` is the canonical production host, not the apex.** `https://www.cleartrade.in` serves
the app; `https://cleartrade.in` does not. This matters more for the webhook than for a
browser: a redirect from apex to `www` would be followed by a browser but **not** reliably by
a webhook POST, and a 301 on a POST drops the body — so a webhook registered on the apex would
appear configured and never deliver, leaving paid memberships permanently unactivated.

Subscribed events in production:

`subscription.activated`, `subscription.charged`, `subscription.pending`,
`subscription.paused`, `subscription.resumed`, `subscription.halted`,
`subscription.cancelled`, `subscription.completed`.

The route additionally tolerates `subscription.authenticated` and `subscription.updated` if
they are ever enabled; neither is required. Without `authenticated`, a membership simply
stays `created` (which grants nothing) until `activated`/`charged` arrives — access begins at
the first successful charge, which is the conservative behaviour.

`tests/membership.test.ts` asserts every event in this list appears in the route's
`HANDLED_EVENTS` allowlist. The dashboard and the code are two systems edited by different
people, and an event Razorpay sends that the route does not list is acknowledged and silently
discarded.

Membership **prices** are not environment variables. They live in the `billing.plans`
`ConfigSetting` row (defaults in `src/lib/billing/plans.ts`) and are editable by Ops through
the config registry — money is never a literal in application code, and never in a deploy
variable that would need a redeploy to change.

### Workers, operations and sanctions

| Variable | Local | Stg | Prod | Class | Source | Local value | Staging value | Consumed by |
|---|---|---|---|---|---|---|---|---|
| `REQUIRE_WORKER_READY` | o | r | r | public | ClearTrade | `false` | `true` | `api/health/ready/route.ts` |
| `WORKER_HEARTBEAT_INTERVAL_MS` | o | o | o | public | ClearTrade | unset | default | `scripts/worker.ts` |
| `WORKER_READY_MAX_AGE_MS` | o | o | o | public | ClearTrade | unset | default | `api/health/ready/route.ts` |
| `WORKER_MAX_CONSECUTIVE_FAILURES` | o | o | o | public | ClearTrade | unset | default | `scripts/worker.ts` |
| `WORKER_INSTANCE_ID` | – | o | o | public | platform | unset | platform-injected | `scripts/worker.ts` |
| `ERROR_REPORTING_PROVIDER` | o | o | o | public | ClearTrade | `log` | `log` | `observability.ts` |
| `BACKUP_DIRECTORY` | o | o | o | public | ClearTrade | unset | backup target | `db-backup.sh` |
| `PORT` | – | o | o | public | platform | unset | platform-injected | Next.js server |
| `SANCTIONS_REFRESH_HOURS` | o | o | o | public | ClearTrade | unset (12) | default; `_<DATASET>` overrides | `sanctions/scheduler.ts` |
| `SANCTIONS_LEASE_TTL_MINUTES` | o | o | o | public | ClearTrade | unset (30) | default | `sanctions/scheduler.ts` |
| `SANCTIONS_REQUIRE_ARTIFACT_RETENTION` | o | o | o | public | ClearTrade | unset (off) | unset — defaults to **required** | `sanctions/artifact-store.ts` |
| `SANCTIONS_MAX_AGE_DAYS` | o | o | o | public | compliance | unset (2) | policy value | `sanctions/screening.ts` |

### Scanner service — separate container, separate variable set

These belong to `deploy/scanner/`, **not** to the app, and never appear in `.env.example`.

| Variable | Class | Value | Consumed by |
|---|---|---|---|
| `SCANNER_AUTH_TOKEN` | **secret** | must equal the web service's `DOCUMENT_MALWARE_SCANNER_TOKEN` | `deploy/scanner/server.js` |
| `PORT` | public | platform-injected | `deploy/scanner/server.js` |
| `CLAMD_SOCKET` | public | `/run/clamav/clamd.ctl` | `server.js`, `entrypoint.sh` |
| `CLAMD_HOST` / `CLAMD_PORT` | public | `127.0.0.1` / `3310` — loopback only, never public | `server.js` |
| `CLAMD_TIMEOUT_MS` | public | default 60 s | `server.js` |
| `SCANNER_MAX_BYTES` | public | default 32 MiB | `server.js` |

---

## 4. Provider credentials: shared or separate?

Whether one credential may serve two environments is a blast-radius question, not a
convenience one. **Do not rotate or reissue anything as part of a routine config change.**

| Provider | Share local ↔ staging? | Why |
|---|---|---|
| **Postgres** | **Never** | Separate databases entirely. A shared URL means local code can write real rows. |
| **UN Comtrade** | **Separate, or mock locally** | One subscription key with a shared quota. Local `COMTRADE_CLIENT=real` silently spends staging's budget and pollutes provider rate limits. Use `mock` locally; opt in per-command when genuinely testing the live client. |
| **Object storage** | **Never** | Bucket credentials should be scoped to one bucket per environment. Locally use `STORAGE_BACKEND=local`, which needs no credential at all. |
| **Resend** | **Separate key; never locally** | An email key can send real mail to real people. Locally use `sandbox`. In staging, pair the key with `NOTIFICATION_REDIRECT_TO` so nothing escapes. Production gets its own key and its own verified domain. |
| **Malware scanner** | **Separate token per environment** | The token authenticates one caller to one scanner; it is minted with the service, not bought. |
| **Anthropic** | Separate if adopted | Only needed when `RATIONALE_WRITER=claude`. Bill and rate-limit per environment. |
| **Google OAuth** | **Separate client per environment** | Redirect URIs are per-origin: `http://localhost:3000` and staging's https origin must not share one OAuth client. Use `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` for each environment pair. |
| **Apple OAuth** | **Separate Services ID + secret per environment** | Keep Apple credentials environment-specific and rotate `AUTH_APPLE_SECRET` periodically. Local enablement is optional; if absent, Apple sign-in stays disabled in UI. |

---

## 5. Adding a new API or provider

1. **Name it** with the existing prefix convention (`<DOMAIN>_<THING>`), and add a
   `<DOMAIN>_PROVIDER`-style mode variable if a local stand-in is possible. Never prefix a
   secret with `NEXT_PUBLIC_` — that compiles it into the browser bundle.
2. **Add it to `.env.example`** with an empty value or safe default plus a one-line
   description. This is the tracked contract.
3. **Add it to `INVENTORY` in `scripts/env-check.ts`** with its class, provider, and
   per-environment requirement. This is what makes `npm run env:check` able to see it.
4. **Add it to the matrix in §3 of this document**, including where it is consumed.
5. **If it is mandatory in a real environment, enforce it in `src/lib/runtime-config.ts`** and
   assert that in `tests/deployment-operations.test.ts`. A variable that is only documented is
   not required; startup validation is what makes it required.
6. **Give local development a stand-in** so `npm run dev` never needs the provider — an
   in-process sandbox, a disk-backed fake, or a deterministic mock. If local work now demands a
   third-party credential, that is a design regression, not a configuration step.
7. **Set it in Railway** for staging. Railway is authoritative; do not add staging values here.

---

## 6. Not accidentally targeting staging from local

The guardrails, in the order they catch you:

1. **`npm run env:check`** warns when `APP_ENV` is not a real environment but the
   configuration looks real anyway: a hosted `DATABASE_URL`, `STORAGE_BACKEND=s3`,
   `COMTRADE_CLIENT=real`, or `NOTIFICATION_PROVIDER=resend`. Run it after editing
   `.env.local`.
2. **`validateRuntimeEnvironment`** (`src/instrumentation.ts`) fails staging/production
   startup when `DATABASE_ENVIRONMENT !== APP_ENV`, when a real environment's database URL is
   labelled `dev`/`test`/`local` or lacks TLS, or when a provider is still mocked.
3. **Vitest** refuses to run when `APP_ENV` is `staging`/`production`, and refuses any database
   whose name does not contain `test`, `dev` or `local` (`tests/global-setup.ts`).
4. **`assertVerificationEnvironment`** makes the `verify:*` scripts refuse a real database.
5. **`db-restore-drill.sh`** refuses any target whose URL lacks `restore_drill`.

Rules of thumb:

- Never paste a staging value into `.env.local`. To run one controlled command against
  staging, pass it inline for that command only — `DATABASE_URL=... npm run <script>` — so it
  lives in your shell history, not in a file that every future command reads.
- `npm run dev` should never need a staging service to boot. If it does, something has
  regressed.
- `.env.staging.secrets` and `.env.apple.secret` are transport artifacts. Move their contents to
  Railway, then delete them. Apple's `.p8` signing key is never committed (`.gitignore: *.p8`)
  and outranks the JWT it produces — if it leaks, revoke the key, don't just rotate the secret.

Social sign-in setup, account-linking behaviour and the Apple rotation procedure are documented
separately in [29-social-authentication.md](29-social-authentication.md).
