# Staging configuration inventory

**Names, purposes and ownership only. No values appear in this document, and none ever should.**

Derived from the environment variables actually read by `src/` and `scripts/`. "Configured?"
reflects the state of the ClearTrade **staging** environment on 2026-08-17, established by
listing Railway's variable **names** for the staging environment. Presence is therefore
verified; correctness of the values is not — a variable can be set and still be wrong.

For the full three-environment picture (local development, staging, future production),
including which credentials may be shared and how to add a new provider, see
[28-environment-configuration.md](28-environment-configuration.md). That document is the
strategy; this one is the staging inventory and rotation ownership record.

Startup validation for every mandatory entry lives in `src/lib/runtime-config.ts` and is
asserted by `tests/deployment-operations.test.ts`. A missing or weak mandatory secret aborts
the process rather than degrading quietly.

---

## A. ClearTrade-generated secrets

We mint these. Generate with `npm run secrets:staging`, which writes a `0600` file and prints
only SHA-256 fingerprints — never values. Transfer to the platform secret manager, then delete
the file.

| Variable | Purpose | Configured? | Source | Rotation responsibility |
|---|---|---|---|---|
| `AUTH_SECRET` | NextAuth JWT signing key | **Yes** | generated | ClearTrade eng. Rotating invalidates all sessions. |
| `GUEST_IP_HASH_SECRET` | HMAC key for guest IP hashing (raw IPs are never stored) | **Yes** | generated | ClearTrade eng. Rotating resets guest quota counters. |
| `IMPORT_BUYER_REF_SECRET` | HMAC key deriving stable buyer references | **Yes** | generated | ClearTrade eng. Rotate **only** via `IMPORT_BUYER_REF_PREVIOUS_SECRETS`, or existing references become unresolvable. |
| `IMPORT_BUYER_REF_KEY_VERSION` | Active buyer-ref key label | **Yes** | generated | ClearTrade eng. Bump on every rotation. |
| `IMPORT_BUYER_REF_PREVIOUS_SECRETS` | Retired buyer-ref keys, JSON keyed by version | **Yes** | generated | ClearTrade eng. Prune only after re-derivation. |
| `IMPORT_RAW_IDENTITY_ENCRYPTION_KEY` | AES-256-GCM key for raw importer identity | **Yes** | generated | ClearTrade eng. Must be exactly 32 bytes base64 — enforced at startup. |
| `IMPORT_RAW_IDENTITY_KEY_VERSION` | Active raw-identity key label | **Yes** | generated | ClearTrade eng. Bump on every rotation. |
| `IMPORT_RAW_IDENTITY_PREVIOUS_KEYS` | Retired raw-identity keys, JSON keyed by version | **Yes** | generated | ClearTrade eng. Required to decrypt historical rows. |
| `OPERATIONS_TOKEN` | Bearer token for `/api/metrics` | **Yes** | generated | ClearTrade eng/ops. Rotate on any operator offboarding. |

## B. External provider credentials

Issued by third parties. **Never generate placeholder values for these** — a fabricated
credential produces a config that passes startup and fails at first real use.

| Variable | Purpose | Configured? | Source | Rotation responsibility |
|---|---|---|---|---|
| `DATABASE_URL` | Pooled application connection | **Yes** | provider (managed Postgres) | Provider console; ClearTrade ops rotates credential. |
| `DIRECT_DATABASE_URL` | Unpooled connection for migrations | **Yes** | provider | Provider console. Required for the `migration` role. |
| `DATABASE_IDENTITY_SHA256` | Exact pooled-URL identity pin | **Yes** | ClearTrade | Recompute only with a reviewed database credential/endpoint rotation. |
| `DIRECT_DATABASE_IDENTITY_SHA256` | Exact direct-URL identity pin | **Yes** | ClearTrade | Independently recompute only with a reviewed direct credential/endpoint rotation. |
| `COMTRADE_API_KEY` | UN Comtrade API subscription key | **Yes** | provider (UN Comtrade) | UN Comtrade account owner. Staging budget must stay capped. |
| `STORAGE_BUCKET` / `STORAGE_REGION` / `STORAGE_ENDPOINT` | Object storage target | **Yes** | provider | Ops. Not secret, but environment-specific. |
| object-storage access key / secret | Least-privilege bucket credentials | **Yes** | provider | Ops. Scope to the single staging bucket. |
| `DOCUMENT_MALWARE_SCANNER_URL` | Private scanner endpoint (https enforced) | **Yes** | platform/self-hosted | Ops. |
| `DOCUMENT_MALWARE_SCANNER_TOKEN` | Scanner bearer credential | **Yes** | platform/self-hosted | Ops. Optional if authenticated at the mesh layer. |
| `NOTIFICATION_PROVIDER_API_KEY` / `NOTIFICATION_PROVIDER_URL` | Transactional email provider, generic `http` mode | **No** | provider | Not used: staging runs `NOTIFICATION_PROVIDER=resend`. Required only if switching back to the generic HTTP provider. |
| `RESEND_API_KEY` | Resend API key (used when `NOTIFICATION_PROVIDER=resend`) | **Yes** | provider (Resend) | Ops. Separate key per environment; never used from a dev machine. |
| `NOTIFICATION_FROM_EMAIL` | Verified Resend sender address | **Yes** | provider (Resend) | Ops. Must stay a verified domain sender. |
| `NOTIFICATION_REDIRECT_TO` | Funnels all staging mail to one inbox | **Yes** | ClearTrade | Ops. Required outside production so staging cannot email real users. |
| `ANTHROPIC_API_KEY` | Only if `RATIONALE_WRITER=claude` | **No** | provider (Anthropic) | ClearTrade eng. Not required while `RATIONALE_WRITER=template`. |
| error-reporting DSN | Only if a vendor is selected | **No** | provider | Ops. No vendor selected; `ERROR_REPORTING_PROVIDER=log`. |

## C. Public / non-secret configuration

Safe in plain config. `NEXT_PUBLIC_APP_URL` is compiled into the client bundle — never put a
secret behind a `NEXT_PUBLIC_` prefix.

| Variable | Purpose | Staging value class |
|---|---|---|
| `APP_ENV` | Environment identity; gates every real-environment rule | must be `staging` |
| `NODE_ENV` | Node build mode | `production` |
| `DATABASE_ENVIRONMENT` | Cross-check against `APP_ENV`; blocks pointing staging at the dev DB | must equal `APP_ENV` |
| `NEXT_PUBLIC_APP_URL` | Public base URL; https enforced so cookies are Secure | staging URL |
| `COMTRADE_CLIENT` | Must be `real` in staging | `real` |
| `COMTRADE_BASE_URL` | API base override | provider default |
| `DISCOVERY_ENGINE` | `mock` forbidden in staging | `warehouse` |
| `RATIONALE_WRITER` | LLM prose writer selection | `template` |
| `DOCUMENT_ENGINE` | Document generation backend | default |
| `STORAGE_BACKEND` | Must be `s3` in staging | `s3` |
| `STORAGE_SERVER_SIDE_ENCRYPTION` | `AES256` or `aws:kms` | `AES256` |
| `STORAGE_FORCE_PATH_STYLE` | Non-AWS S3 compatibility | provider-dependent |
| `STORAGE_PUBLIC_BASE_URL` | Optional; used only to probe that the bucket is private | optional |
| `DOCUMENT_MALWARE_SCANNER` | Must be `http` in staging | `http` |
| `DOCUMENT_MALWARE_SCANNER_TIMEOUT_MS` / `_MAX_BYTES` | Scanner timeout and request size limit | defaults 30000 / 32 MiB |
| `NOTIFICATION_PROVIDER` | Must be `http` in staging | `http` |
| `ERROR_REPORTING_PROVIDER` | Error reporting seam | `log` |
| `UPLOAD_MAX_BYTES` | Upload size ceiling | default 25 MiB |
| `GUEST_TRUST_XFF` | Whether `X-Forwarded-For` is trusted | only behind a trusted proxy |
| `REQUIRE_WORKER_READY` | Readiness requires a live worker | `true` recommended |
| `WORKER_HEARTBEAT_INTERVAL_MS`, `WORKER_READY_MAX_AGE_MS`, `WORKER_MAX_CONSECUTIVE_FAILURES`, `WORKER_INSTANCE_ID` | Worker supervision | defaults |
| `SANCTIONS_REFRESH_HOURS`, `SANCTIONS_REFRESH_HOURS_<DATASET>` | Refresh cadence (operational) | default 12 |
| `SANCTIONS_LEASE_TTL_MINUTES` | Refresh lease TTL | default 30 |
| `SANCTIONS_REQUIRE_ARTIFACT_RETENTION` | Forces raw artifact retention | required in staging |
| `SANCTIONS_MAX_AGE_DAYS` | Freshness threshold — **policy, pending approval** | default 2 |
| `DISCOVERY_MOCK_LATENCY_MS` | Mock-engine latency simulation | unused in staging |

## D. Must NEVER be set in staging

| Variable | Why |
|---|---|
| `DANGEROUS_ALLOW_PRODUCTION_FIXTURES` | Defeats the evidence-origin isolation that keeps fixture data out of real environments. |
| `EVIDENCE_DEMO_MODE` | Surfaces fixture evidence as if it were real. Only for an explicitly labelled demo environment. |

`APP_ENV=staging` retains all fixture protections. Do not seed demo data.

---

## E. Blocked items

Honest status, not deferred work:

1. ~~**Notification provider (Phase 11)**~~ — **resolved.** Resend is provisioned: staging sets
   `NOTIFICATION_PROVIDER=resend` with `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL` and
   `NOTIFICATION_REDIRECT_TO`, so staging mail is funnelled to a single inbox and cannot reach
   real users. Deliverability itself is still unverified end to end.
2. **Error-reporting vendor** — none selected. `ERROR_REPORTING_PROVIDER=log` remains the seam.
3. **`REQUIRE_WORKER_READY`** — not set in staging, so readiness does not currently require a
   live worker heartbeat. Recommended `true` once a worker runs continuously in staging.
4. **Malware scanner service** — the variables are configured, but the scanner container does
   not yet reach a ready state on Railway's 1 GB Trial tier (ClamAV needs ~3 GiB; see the
   scanner deployment notes). Uploads therefore fail closed in staging until that is resolved.
5. **Everything in §A/§B still marked "No"** — genuinely unset.

## F. Limits of the automated checks

`runtime-config.ts` rejects absent, short, placeholder and low-entropy secrets, non-TLS
database URLs, plaintext scanner/app URLs, dev-labelled databases, and mock providers.

It **cannot** detect reuse of a genuinely random *development* secret in staging — the process
has no knowledge of the development value. That separation is enforced by generating staging
secrets independently (§A) and by comparing fingerprints, not by a runtime check. Two
environments printing the same fingerprint are sharing a secret.
