# Staging deployment and controlled-pilot runbook

## Architecture

ClearTrade ships as one platform-neutral OCI image with separate process commands:

- `npm start`: Next.js web/API process.
- `npm run worker`: supervised background worker using PostgreSQL as its durable queue.
- `npm run migrate:deploy`: one-shot migration process, run before web/worker rollout.
- External scheduler: invokes `npm run purge:guests`, `npm run ingest:sanctions`, and deliberately scoped Comtrade commands. Scheduler retries must retain each command's dedupe key.
- PostgreSQL 16+: separate database/credentials per environment. Use a pooled URL for application processes and `DIRECT_DATABASE_URL` for migrations/backups.
- S3-compatible private object storage: no public bucket access; encryption, versioning, lifecycle, and access logging enabled. Workload identity is preferred over static access keys.
- A malware scanning service implementing the configured private HTTP scan contract. Uploads fail closed on scanner errors; only clean objects become downloadable. Restrict the scanner endpoint to the application network.

`Dockerfile` and `compose.staging.yml` are reference baselines, not a cloud decision. The image can run on any container platform offering process supervision, secret injection, HTTPS ingress, PostgreSQL and S3-compatible storage.

## Environment boundaries and secrets

Use four independent environments: development, test, staging and production. Staging/production startup fails unless `DATABASE_ENVIRONMENT` exactly matches `APP_ENV`, the DB URL is not labelled dev/test/local, secrets meet minimum length, Comtrade is real, discovery is not mock, and storage is durable.

Inject secrets through the platform secret manager; never bake `.env` into an image. Rotate the previously example-exposed `AUTH_SECRET` before staging. Required real-environment values are documented in `.env.staging.example`. Use distinct values and credentials for staging and production. Restrict DB, object storage, operational metrics, provider and AI credentials to the process that needs them.

## Deploy and migrate

1. CI must pass schema validation, typecheck, lint, tests, application build and container build.
2. Trigger `Prepare staging release`; the protected `staging` GitHub environment requires explicit approvers. It creates an OCI artifact but does not deploy it.
3. Pin the immutable image digest and review migration SQL. Take a verified backup/PITR checkpoint.
4. Run exactly one `npm run migrate:deploy` task using the direct DB URL. Never run `migrate dev` in staging/production.
5. Roll out web, then worker. Require `/api/health/ready` to return 200. Keep the previous image digest available.
6. Smoke-test login, one non-network job, upload round-trip, metrics authorization, and evidence-origin guards. Enable scheduled provider jobs separately.

### Existing local uploads

`npm run storage:migrate` copies uploaded `Document` objects marked local into the configured S3-compatible private bucket, verifies byte length and the persisted SHA-256 checksum, and only then switches the database reference. It retains local source files by default for rollback. After a verified backup and application smoke test, `npm run storage:migrate -- --delete-source` removes each source after its database reference is safely switched. Legacy rows remain `scan_status=unknown_legacy`; migration does not falsely certify them as malware-scanned. Production migration is not complete until this command has run against a configured bucket and its output and restore path have been reviewed.

Prisma migrations are forward migrations. Roll back application code only when the old version tolerates the new schema. For destructive/incompatible schema changes, ship expand → migrate data → contract across separate releases. If a migration corrupts data, stop writes and restore/PITR; do not edit `_prisma_migrations` by hand.

## Database operations

- Automated encrypted backups: daily full backup plus provider-managed continuous WAL/PITR; pilot target is at most 24-hour full-backup loss and a 15-minute PITR window. Final RPO/RTO require business approval.
- Retain staging backups separately from production and test restores monthly.
- `npm run db:backup` creates a custom-format dump and checksum. Move it immediately to encrypted restricted storage.
- Restore drill: create an empty isolated database whose URL contains `restore_drill`, set `RESTORE_DRILL_DATABASE_URL`, run `npm run db:restore-drill`, verify migration and row counts, run smoke queries, then destroy it. Never use a production/staging target URL.
- Use the provider's transaction/session pool compatible with Prisma. Start with 10 connections per web/worker replica and ensure aggregate maximum remains below DB capacity. Migrations use an unpooled direct URL.
- DB readiness is checked through `/api/health/ready`; provider-native DB alerts remain mandatory.

## Worker and scheduled jobs

Run the worker under the container platform's restart policy with a ten-minute termination grace period. SIGTERM stops claims, finishes the active job and exits. A second signal forces exit; stale recovery later requeues eligible work. Heartbeats are stored in `WorkerHeartbeat`; readiness can require a recent `ready`/`busy` worker with `REQUIRE_WORKER_READY=true`.

Infrastructure tick failures mark the heartbeat degraded. After `WORKER_MAX_CONSECUTIVE_FAILURES`, the worker exits nonzero so supervision restarts it. Failed domain jobs remain visible in Job/JobAttempt and metrics; they are not logged as healthy completion.

Recommended schedule, subject to provider/legal approval:

- Guest purge: daily; run dry-run before first enablement.
- Sanctions refresh: run `npm run sanctions:schedule` hourly. The tick is not the cadence — it enqueues only datasets whose per-dataset interval has elapsed (default 12h), so a frequent tick does not increase provider load. Overlapping runs are safe: a per-dataset lease, a job dedupe key and a partial unique index each independently prevent two concurrent refreshes or two active snapshots. Any PARTIAL/FAILED/STALE source blocks real buyer surfacing and routes to `/ops/sanctions`. Raw artifact retention is mandatory in staging/production — a failed persist or failed post-write verification refuses activation and leaves the previous COMPLETE snapshot serving. See docs/25-sanctions-source-operations.md.
- Comtrade: invoke only explicitly scoped chapter commands. Respect persistent quota/retry times; never overlap `--all` jobs.
- Backup/restore validation: automated backup daily, restore drill monthly.

## Health, metrics and incidents

- `/api/health/live`: process liveness only.
- `/api/health/ready`: runtime config, PostgreSQL, object storage and optionally worker heartbeat. Do not route traffic on 503.
- `/api/metrics`: protected by `Authorization: Bearer $OPERATIONS_TOKEN`; reports job, ingest, worker and sanctions coverage metrics without raw buyer/trade rows.
- Logs are JSON with request/job/org identifiers where safely known. Never add API keys, authorization headers, raw consignee strings, contact data or document bytes.
- `ERROR_REPORTING_PROVIDER=log` is the default seam. A production error vendor and data-processing terms remain a platform decision; preserve the redaction contract when integrating it.

Provider outage: pause the schedule, retain partial/resumable job state, display the provider-specific failure, and resume after recovery. Comtrade throttling must follow `retry_after`; do not rotate credentials to evade limits. Sanctions partial/stale coverage must remain fail-closed.

Incident response: declare severity/owner, stop risky schedules or writes, preserve logs/audit/job attempts, rotate compromised secrets, assess tenant/data scope, restore/PITR when necessary, document timeline and corrective actions, and obtain legal/privacy review before external notification.

Secret rotation: add the new provider/DB/object credential, roll processes, verify readiness, then revoke the old credential. Rotating `AUTH_SECRET` invalidates sessions and requires an announced maintenance action. Rotate `IMPORT_BUYER_REF_SECRET` only with a versioned re-key plan because it deterministically pseudonymizes buyer references.

## Platform decisions and production gates

Still undecided: container runtime/ingress, managed PostgreSQL vendor, S3-compatible provider, scheduler, secret manager, error-reporting vendor, notification vendor and backup retention/RPO/RTO. Production additionally requires completed sanctions coverage, official HS reference data, authenticated Comtrade validation, privacy/legal approval, load/security testing, domain/TLS/email configuration and an audited restore drill.
