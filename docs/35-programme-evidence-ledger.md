# Programme Evidence Ledger

The running record for the ClearTrade AI Master Implementation Roadmap (12 Oct 2026): what was verified,
what was decided and by whom, which checks ran, and what remains unknown. **Append; never rewrite an
entry.** A correction is a new entry that names the one it corrects.

Conventions: every claim cites a file, command, run id or record id. "Not run" and "unknown" are recorded
as such — never rounded up to a pass. No secret values, personal data or raw buyer identity appear here.

## Decision log

| Id | Date | Decision | Decided by | Affects |
|---|---|---|---|---|
| D-001 | 2026-10-12 | Work-package checks run in GitHub CI: work branches off `staging/railway`, PRs into `staging/railway`; nothing lands on `staging/railway` or `master` without the owner. The Claude GitHub App is to be installed so the agent can push branches and open PRs. | Owner (@bhvyashrma17) | All WPs |
| D-002 | 2026-10-12 | Pull the one-line CI fix (`DIRECT_DATABASE_URL` in `ci.yml`) forward into WP1's first PR; the rest of WP4 stays in sequence. | Owner | WP1, WP4 |
| D-003 | 2026-10-12 | Build the Phase 1 gate on the audit defaults (supervised posture; rice `100630`, brassware `741810`, carpets `570110`; ≥ 5 rankable markets and ≥ 1 Atlas-backed tariff per archetype) **marked proposed**. A release `PASS` needs owner approval of the policy. | Owner | WP1 |
| D-004 | 2026-10-12 | WP2 tariff clock: trade evidence stays as of the screen; tariff evidence is admitted up to the deep run's acquisition time; both clocks recorded on every assessment (a versioned Phase 1H selection-rule change). | Owner | WP2 |

Open owner decisions: approval of every `phase-1-gate-v1` value (docs/34 §2); the meaning of
"1E Live Country Truth Reconciliation" (not found anywhere in the repository); all later decisions in
roadmap §26.

## Entries

### E-001 · 2026-10-12 · Live-state reconciliation (before WP1)

**Repository state.** Clone of `bhvyashrma17/cleartrade-ai-build-spec`. `staging/railway` = `f29fcf52`
(identical to `origin/staging/railway`, clean, no untracked files); `master` = `6d4733cb`; staging is
103 commits ahead and 0 behind (`git rev-list --count`). Third remote branch
`agent-portal-and-document-engine` (`cc7ade12`) is fully contained in staging. No commits since the
11 Oct audit. Staging's last code commit is `2d2994c9` (the two later commits are docs-only), matching
the deployed artifact the audit names.

**Checks on `f29fcf52`** (agent workspace, Node 22.22.0, PostgreSQL 16):

| Check | Result |
|---|---|
| `npx prisma validate` with CI's exact environment | **FAIL** — `directUrl = env("DIRECT_DATABASE_URL")` unset. Same failure on `master`'s schema. |
| `npx prisma validate` + `DIRECT_DATABASE_URL` | PASS |
| `npm run typecheck` (client types from `prisma generate --no-engine`) | PASS |
| `npm run lint` (`--max-warnings=0`) | PASS |
| `npm test` | **Not run** — the session's network policy blocks `binaries.prisma.sh`, so migrations and queries cannot run. |
| `npm run build` | **Not verified** — its only errors were three `next/font` downloads from `fonts.googleapis.com`, also blocked. |

**GitHub (API, read-only).** 0 pull requests ever opened. 10 CI runs, all pushes to `master`, **all failed
at `npx prisma validate`** — typecheck, lint, tests, build and the Docker build have never run in CI.
Runs 31995502925, 31995735496, 31995965371, 32012335060, 32013607241, 32719062403, 32745389084,
32759561391, 32762415813, 32763580694. Pushes from the agent session are refused until the Claude GitHub
App is installed.

**Audit findings re-verified.** CI triggers on `pull_request` and pushes to `main`/`master` only
(`.github/workflows/ci.yml`). `market_access_ingest` is registered (`job-handlers/index.ts`) but only
operator scripts and canaries enqueue it; `country-truth-discovery.ts` never does. No `buyer_discovery`
handler, no regional code, no buyer-facing send path. `docs/19-market-access-evidence.md` still says
"Great Britain only". The root `railway.json` moved to `deploy/railway/web.railway.json` on staging;
`master`'s copy has no `preDeployCommand`. Staging records (docs/33,
docs/customs-atlas/railway-staging-acceptance-2026-10-11.md) match the audit. 120 test files.

**Corrections to the audit.**
- Legacy warehouse engine: its Market Access query (`src/lib/discovery/warehouse-engine.ts:279`) requires
  `completeness_status = COMPLETE` with tariff **and** regulatory coverage — verified, no longer an inference.
- "No code sets `verified`" is too broad: agents can set `BuyerContact.verification_status = verified`
  with evidence and an AuditEvent (`src/app/api/v1/buyer-contacts/[contactId]/verify/route.ts`).
  `Buyer.verification_status` is never set to `verified`.

**New constraints for WP2** (not in the roadmap):
1. The deep run's clock is the screen's as-of (`country-truth-deep-request.ts:116`), and fact selection
   rejects market-access evidence retrieved after it (`fact-selection.ts:478`). Release-backed sources stamp
   the release's retrieval time; UK (GB, GG, IM, JE) and US (US, PR) are live APIs stamping fetch time.
   Resolved by D-004.
2. The worker runs one job at a time (`scripts/worker.ts`); a deep job waiting on child ingest jobs would
   deadlock staging's single worker.
3. Release-backed ingests dedupe on `ingest_identity` (`market-access/contract.ts`); TARIC's identity
   includes the resolution date, so the same release resolved on two days yields two snapshots. UK/US
   create a new snapshot per call.
4. A tariff rate is published only with an explicit India-preference determination
   (`selectApplicableIndiaTariff`); "requires origin proof" leaves it unavailable by design.

**Unknown from the agent session.** Staging and production database contents (row counts, sanctions
snapshots, migration state), Railway service state, what staging actually runs, and the operator's
local-only work (`wip/switzerland-tares`, `tmp/rw/`, `.artifacts/` — `tmp/` and `.artifacts/` are
gitignored; the agent's clone cannot touch them).

### E-002 · 2026-10-12 · WP1 Phase 1 acceptance gate — implementation (in review)

**Objective.** Gate spec, read-only evaluator and runbook (roadmap §8); CI env fix (D-002).
**Branch.** `wp1/phase-1-acceptance-gate` off `staging/railway@f29fcf52`.
**Decisions.** D-002, D-003. Policy `phase-1-gate-v1`, every value proposed.

**Files.** `src/lib/phase-1-gate/{policy,evaluate,load}.ts`, `scripts/gate-phase-1.ts`,
`tests/phase-1-gate.test.ts`, `docs/34-phase-1-acceptance-gate.md`, this ledger, `package.json`
(`gate:phase-1`), `.github/workflows/ci.yml` (`DIRECT_DATABASE_URL`), `AGENTS.md` (doc map). No schema
change, no migration, no runtime code path changed.

**Tests (agent workspace).** typecheck PASS; ESLint on the new files PASS. The 24 pure-evaluator tests
in `tests/phase-1-gate.test.ts` PASS under a local harness without the database global setup — **not the
canonical command**. The 3 database-backed tests (a from-scratch screen-derived deep run evaluated
end to end, the read-only write rejection, a product with no run) need `npm test` in CI.

**Security review.** One `REPEATABLE READ, READ ONLY` transaction (PostgreSQL rejects writes); refuses
production; validates staging identity pins before reading; reports IDs, checksums and a 12-character
fingerprint prefix only — no secrets, no personal data.

**Staging evidence.** None yet — running the gate on staging needs WP2 and WP3.

**Rollback.** Revert the merge; nothing persistent is created.

**Residual.** First CI result pending (and the first CI ever to reach typecheck/lint/tests/build, so
pre-existing failures may surface); pushes pending the GitHub App.

### E-003 · 2026-10-12 · Deployment footprint (GitHub deployments API, read-only)

Railway reports its deployments to GitHub. Across all recorded deployments:

| Railway project / environment | Deployments | First | Last | Refs |
|---|---|---|---|---|
| `amused-insight / production` | 11 | 2026-08-17 | 2026-08-24 | `master` era |
| `amused-insight / staging` | 87 | 2026-08-17 | 2026-10-11 | every push to `staging/railway`, docs-only commits included (newest `f29fcf52`) |
| `cleartrade-staging / staging` | 2 | 2026-10-09 | 2026-10-09 | `09c663a3`, `933614fa` (environment `ea0c9716-…`) |

- **Every merge into `staging/railway` redeploys staging** (web and worker, each running
  `npm run migrate:deploy` before start). A change with no migration redeploys harmlessly; one with a
  migration applies it to the staging database on merge.
- A **second Railway project, `cleartrade-staging`**, deployed this branch twice on 9 Oct and none of the
  seven pushes on 11 Oct, so it no longer appears to auto-deploy. Its database target and whether it
  still exists are unknown; docs/33 records that an earlier staging service carried production's
  database URL. → R-09.
- No pull request has ever existed, so whether Railway **PR environments** are enabled — and from which
  base environment they would copy variables — cannot be read from here. A PR environment copied from
  production would run this branch's pre-deploy migrations against production's database. → R-10.
  The agent opens no PR until the owner confirms PR environments are off or based on staging.

## Risk register

| Id | Risk | Status | Next evidence |
|---|---|---|---|
| R-01 | CI has never run tests or build; unknown pre-existing failures may surface | Open — env fix in WP1 PR | First CI run on the WP1 PR |
| R-02 | Agent session cannot run DB tests or build (blocked hosts) | Open — mitigated by CI (D-001) | Green CI on each WP PR |
| R-03 | Staging DB, Railway state and sanctions snapshots unverified from the agent session | Open | Operator read-only inventory (WP3/WP5) |
| R-04 | Production hazards (docs/33 §5): scanner URL → staging, failed scanner deploy, 8 Oct migration by old staging web, root `railway.json` move, shared Resend key | Open, unchanged | WP5 read-only inventory |
| R-05 | Tariff signal often unavailable by design (preference needs origin proof; specific duties) | Accepted in gate design | WP3 archetype runs |
| R-06 | WP2 design constraints (clock, single-worker deadlock, TARIC per-day identity) | Clock resolved (D-004); others open | WP2 design and tests |
| R-07 | Operator's local-only work unverified | Open | Operator confirmation |
| R-08 | Gate thresholds unapproved | Open | Owner approval PR |
| R-09 | Second Railway project `cleartrade-staging` (deployed this branch on 9 Oct); database target and status unknown | Open | Owner/WP5 inventory: confirm disconnected or deleted |
| R-10 | Railway PR environments, if enabled with a production base, would migrate production on PR open | Open — blocks opening PRs | Owner confirms PR environments off, or based on staging |
