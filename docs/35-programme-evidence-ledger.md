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
| D-005 | 2026-10-12 | Claude GitHub App installed; the agent pushes work branches (verified, E-007). | Owner | All WPs |
| D-006 | 2026-10-12 | Deploy WP1 + WP2 to `amused-insight / staging`. Route (PR with CI, or direct push) still to be chosen — E-007. | Owner | WP1, WP2, WP3 |
| D-007 | 2026-10-13 | Launch-ready programme instead of a one-week target: all 218 markets first, then regional discovery (US first), then buyer discovery. The agent works primary from the cloud; the owner's local Claude Code handles the Mac and live systems from agent-written prompts. Free data until deals fund paid sources. | Owner | Programme |
| D-008 | 2026-10-13 | Demand Discovery v5 scores all 218 markets in depth for every product; the 20-market shortlist is dropped (E-010). | Owner | Demand Discovery v5 |
| D-009 | 2026-10-13 | Trade data: CEPII BACI primary, UN Comtrade API as fallback (the owner's change to the proposal "BACI instead of Comtrade"). | Owner | Demand Discovery v5 |
| D-010 | 2026-10-13 | Comtrade-derived figures go live for customers now; the owner sends UNSD a written-permission request in parallel and accepts the licence risk (R-14). | Owner | Demand Discovery v5 |
| D-011 | 2026-10-13 | Where Comtrade has a newer year than BACI, that year changes the score (docs/36 §5.3). | Owner | Demand Discovery v5 |
| D-012 | 2026-10-13 | Score parts: Demand 35, India's opportunity 25, Access 20, Risk 10, Exporter fit 10. | Owner | Demand Discovery v5 |
| D-013 | 2026-10-13 | India's existing import share counts as a plus, not as crowding. | Owner | Demand Discovery v5 |
| D-014 | 2026-10-13 | Market size = 3-year average on a log scale against the product's largest market. | Owner | Demand Discovery v5 |
| D-015 | 2026-10-13 | Prices compared FOB to FOB: the market against India's usual export price, and against the exporter's own price. | Owner | Demand Discovery v5 |
| D-016 | 2026-10-13 | Risk = ECGC short-term rating; markets ECGC won't cover are flagged; markets under comprehensive UN sanctions are excluded. | Owner | Demand Discovery v5 |
| D-017 | 2026-10-13 | Duty from official Customs Atlas sources where configured; elsewhere a labelled estimate built on India's trade agreements (R-16). | Owner | Demand Discovery v5 |
| D-018 | 2026-10-13 | Discovery starts automatically when the HS code is confirmed; agents review and flag, never approve a run. | Owner | Demand Discovery v5 |
| D-019 | 2026-10-13 | A market is ranked at ≥ 60 live points including size and growth; the top 10 go on to regional and buyer discovery. | Owner | Demand Discovery v5 |

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

### E-004 · 2026-10-12 · WP2 Customs Atlas orchestration — scoped plan

**Objective.** The deep Country Truth run acquires tariff evidence for its own shortlisted markets and its
assessments cite the exact snapshots, under the separate tariff clock (D-004). Branch
`wp2/atlas-orchestration`, stacked on WP1.

**Design.**
1. *Switch.* New policy `country_truth.market_access_orchestration` (default `enabled: false`), frozen into
   the job payload **only when enabled**. With it off, payloads, dedupe keys, fact manifests and
   assessments are byte-identical to today — the existing read path is the rollback.
2. *Worker-owned, inline.* A new stage `acquiring_tariffs`, after trade metrics and before facts are frozen,
   runs each shortlisted destination's Atlas adapter inside the deep job. Child `market_access_ingest`
   jobs are not used: staging runs one worker, which runs one job at a time, so a deep job waiting on
   children would deadlock (E-001).
3. *Clocks.* Release-backed adapters resolve at the acquisition start time (frozen in the checkpoint, so a
   retry yields the same `ingest_identity` and reuses the snapshot). The live UK and US APIs are called at
   real time, because they stamp `retrieved_at` with it and must never be backdated. The **tariff clock** is
   frozen when acquisition ends.
4. *Tariff evidence only.* Fact selection admits `destination_tariff` and `preferential_tariff_india` rows
   retrieved up to the tariff clock and scopes those facts to it; tariff selection in the Market Access and
   Export Economics pillars evaluates admission and in-force at that clock. Requirements, regulatory
   coverage, certification benchmarks and every other fact stay on the screen clock — an exporter fact or
   quote recorded after the screen is still not admitted. The fact manifest records `tariff_as_of_date`
   and `tariff_clock_version` (key and payload, only when present); assessments carry it in their
   fact-manifest context.
5. *Degraded mode.* A destination with no Atlas source, an unconfigured source, an adapter error or a live
   timeout is recorded with its reason and the run continues; its market access stays unavailable with a
   reason, never zero. Tariff evidence is a gate requirement (≥ 1 market, docs/34), not a run requirement.
6. *Retries.* Each destination's outcome is checkpointed as it completes; a retry skips finished
   destinations and reuses both clocks. A crash between persisting a live UK/US snapshot and checkpointing
   it can leave one duplicate snapshot; selection stays deterministic (newest wins).
7. *Trace.* Snapshots created by the run carry `source_run_id` = deep job id; the job result, the
   `DiscoveryRun.input_snapshot` and structured log events record every destination outcome.

**No migration.** New fields live in existing JSON (job payload/checkpoint/result, fact payload) and a new
`ConfigSetting` key with a code default.

**External calls.** UK Trade Tariff and USITC HTS public APIs, only for shortlisted GB/GG/IM/JE/US/PR
markets; release-backed sources read retained artifacts (no network). Comtrade calls unchanged.

**Acceptance criteria.**
1. Switch off: no adapter is called, and payload, fact-manifest and assessment identities match pre-WP2.
2. Switch on: a run-acquired release-backed snapshot and a live snapshot fetched **after** the screen clock
   are both cited by their assessments (tariff facts in `used_fact_ids`, `source_run_id` = the job) and show
   a tariff signal; the same live row is rejected (`retrieved_after_assessment_clock`) with the switch off.
3. Non-tariff evidence retrieved between the two clocks is still rejected.
4. Adapter failure, timeout and missing source each produce a recorded reason and a completed/partial run.
5. A retry reuses checkpointed outcomes and clocks: no second adapter call, the same fact manifests and the
   same assessments.
6. The Phase 1 gate reads the tariff clock and reports the run-acquired snapshot as an Atlas tariff signal.
7. Typecheck, lint and the full suite green in CI. Staging proof (an assessment citing a run-acquired
   snapshot) is WP3 evidence.

**Rollback.** Leave the switch off (default) or deactivate the config version; acquired snapshots and
manifests stay as history; nothing is rewritten.

### E-005 · 2026-10-12 · WP2 Customs Atlas orchestration — implementation (in review)

**Branch.** `wp2/atlas-orchestration`, stacked on WP1 (`e02802a`). Design as E-004; decision D-004.

**Files.** New `src/lib/country-truth/tariff-acquisition.ts` (per-destination acquisition, outcomes,
tariff clock) and `tests/country-truth-tariff-acquisition.test.ts`. Changed:
`job-handlers/country-truth-discovery.ts` (stage `acquiring_tariffs`; outcomes and both clocks
checkpointed; trace in the job result and `DiscoveryRun.input_snapshot`);
`country-truth/{fact-selection,fact-snapshot-service,phase-1h-calculations,pillars}.ts` (tariff-only
clock, `separate-tariff-clock-v1`, folded into the selection-policy hash so the manifest key stays
unique without a migration); `config.ts`, `validators/index.ts`, `api/v1/config/route.ts` (switch
`country_truth.market_access_orchestration`, default off, shape-validated, written only through the
audited config API — not an Ops-console setting); `country-truth-discovery-request.ts` (frozen into
the payload only when on); `job-handlers/market-access.ts` (each adapter declares `live_fetch` or
`retained_release`); `discovery/country-truth-v4-service.ts` (context type); `phase-1-gate/load.ts` and
docs/34 (the gate reads `tariff_as_of_date`); `tests/admin-settings.test.ts` (route test). No schema
change, no migration.

**Acceptance criteria (E-004).**

| # | Result | Evidence |
|---|---|---|
| 1 | PASS — structural | Switch off: no adapter call; the payload keeps its four policies; manifests carry no tariff clock. Byte-identity with a pre-WP2 run holds by construction (every new field is conditional) and through the unchanged pre-existing suites (E-006); it was not measured against a pre-WP2 run. |
| 2 | PASS | A release-backed DE snapshot and a live US snapshot fetched after the screen clock, both with `source_run_id` = the job, are cited in `used_fact_ids` with the tariff basis recorded. **Correction to E-004:** a switch-off run does not reject those live rows as `retrieved_after_assessment_clock`; it never loads them, because single-clock reads bound every market-access query by the screen clock (unchanged from before WP2). The test asserts that instead: US tariffs empty and market access unavailable, while the DE release (retrieved before the screen) stays cited. |
| 3 | PASS | The live US `import_restriction` row is rejected `retrieved_after_assessment_clock` in the same run whose tariffs were admitted. |
| 4 | PASS | Adapter error → `failed` with a one-line reason; a hanging live fetch → `timed_out` at the policy timeout; UAE → `unconfigured_source` with its documented authority reason; the run completes; each market access is unavailable with a reason and a null score. Over the cap → `skipped_over_cap`. |
| 5 | PASS | Second attempt: no adapter call; identical manifests, assessments and acquisition record. A checkpoint holding only Germany resumes with the USA alone, at the same resolution instant, and cites the German snapshot from the first attempt. |
| 6 | PASS | The gate loader reads `tariff_as_of_date`; the run-acquired live US snapshot counts as an Atlas tariff signal, age 0 days. |
| 7 | Partial | `prisma validate`, typecheck and full-repo lint PASS against the standard client. Full suite: no regressions under the local harness (E-006). **GitHub CI not yet run.** |

**Mutation check.** Three deliberate breaks each failed exactly the intended test and were reverted
(checksums verified): tariff selection forced onto the screen clock → switch-on test; the
checkpointed clock ignored → retry test; checkpointed destinations ignored → retry test.

**Defect found by running the DB tests.** The test fixture created its `AuthorityRelease` as `active`
without `activated_at`, which `TaricRelease_active_is_timestamped` rejects (and a second fixture would
have hit the one-active-per-source index). Fixed to the default `imported`, as
`tests/market-access-providers.test.ts` does.

**External calls.** None in tests (in-process doubles; `tests/setup.ts` denies the network). At run time,
only the UK and US public APIs, for shortlisted destinations, once the switch is on.

**Rollback.** As E-004. **Residual.** Enabling the switch on staging and the archetype runs are WP3. A
crash between persisting a live snapshot and checkpointing it can leave one duplicate snapshot (newest
wins). R-11 unchanged.

### E-006 · 2026-10-12 · First full-suite runs, in CI's file order — baseline vs WP1+WP2

**Method.** Prisma's native engines cannot be downloaded in the agent workspace, and GitHub CI runs
only on pull requests (R-10 blocks opening one). A local harness — kept under `node_modules/`, never
committed — generates the same schema with Prisma's Rust-free client (`engineType = "client"`, the
WASM query compiler shipped in the npm package) over `@prisma/adapter-pg@6.19.3`; applies all 80
migrations in order through `pg` into a throwaway schema behind the same guards as
`tests/global-setup.ts`; reuses `tests/setup.ts` (network denied); and orders files as CI will — with
no results cache, vitest's `BaseSequencer` runs files largest first. It is **not** `npm test` and does
not replace CI.

| Tree | Files | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|---|
| `staging/railway@f29fcf52` | 120 | 1,995 | 1,986 | 4 | 5 |
| WP1 + WP2 working tree | 122 | 2,031 | 2,022 | 4 | 5 |

Compared test by test: nothing that passes on the baseline fails on WP1 + WP2, nothing is missing, and
all 36 added tests pass (27 gate, 8 tariff acquisition, 1 config route). The same four fail on both:

- `country-truth-discovery-handler` › "is registered and executes…" — **pre-existing, and CI would hit
  it.** It claimed with `claimNextJob` and assumed an empty queue; `country-truth-deep-request`
  (15,195 B) runs before it (13,432 B) in CI's order and leaves queued deep jobs. On the unmodified
  baseline it passes alone and fails after deep-request. Fixed test-only in `e02802a` on the WP1
  branch, so the first CI run is meaningful (an agent call in the spirit of D-002 — the owner may
  veto): the fixture's job goes to the front of the queue and the real claim path is still exercised.
  The pair passes in CI order on both trees.
- `market-scan-requests` and `pilot-e2e` — both read `information_schema` identifiers (type `name`),
  which the pg driver adapter cannot deserialize. Harness artifact; expected to pass on the native
  engine; **unverified until CI**.
- `staff-provisioning` › "refuses two pending LEGACY invitations" — matches PostgreSQL's key detail
  ("already exists"), which the driver adapter's error text omits. Harness artifact; **unverified until
  CI**.

### E-007 · 2026-10-12 · Owner update: push access, deployment target, staging topology

- The Claude GitHub App is installed (D-005). `wp1/phase-1-acceptance-gate` pushed (`fb0c3a0`, then
  `e02802a`); no CI ran (CI triggers on pull requests and on pushes to `main`/`master` only) and nothing
  deployed (no Railway service tracks a work branch).
- The owner directs WP1 + WP2 to `amused-insight / staging` (D-006). Staging per the owner's dashboard
  screenshot (14:17 IST): `cleartrade-ai-build-spec` (web), `cleartrade-worker` and `cleartrade-scanner`
  (GitHub sources, Online); `Postgres` (Online, volume `postgres-volume-oQRq`); buckets
  `cleartrade-staging-env` (554.1 MB) and `cleartrade-staging` (185.5 MB); a volume `postgres-volume`
  shown without a service.
- The owner also commits, pushes and deploys from a local clone. `origin/staging/railway` was still
  `f29fcf52` at 08:50 UTC, so WP1 and WP2 need no rebase. That machine's local-only state is being
  gathered read-only by the owner's local Claude Code, not from this workspace (R-12).
- Route to staging still open: a PR into `staging/railway` runs CI but needs R-10 answered first; a
  direct push to `staging/railway` cannot create a PR environment but lands without CI.

### E-008 · 2026-10-12 · Production build of WP1 + WP2 (`0ff4b10`) compiles

`next build` (Next.js 15.5.23) on a clean tree at `0ff4b10`: compiled, lint and type validity passed,
77 pages generated, no warnings, exit 0 (2 min 25 s). The only change from the Dockerfile's
`npm run build` is Next's own test hook `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`, which answers the three
`next/font/google` CSS requests from a local file so nothing is fetched from the blocked font hosts;
font bytes are therefore placeholders, which a compile check does not depend on. Every route is
dynamic (ƒ), so the build ran no database query. Railway's own build remains the deploy-time check.

### E-009 · 2026-10-13 · Owner's local read-only inventory (machine, Railway, staging database)

**Source.** The owner's local Claude Code ran the read-only inventory requested in this conversation (12
Oct) and reported on 13 Oct, 11:51 IST. The full report is a file on the owner's machine; the agent
received its summary plus one correction to the active-release table (D5), not the full tables.
Reported conduct: no repository file created, edited or deleted (`git status` clean; the only git write
was `git fetch origin`); Railway read-only and the folder's project link unchanged; the staging database
host was checked against production's (Neon) host before any query, and every query ran in a read-only
transaction; no secret printed (database hosts as host, port and name only).

**Owner's machine.**
- Not on GitHub: `wip/switzerland-tares` (1 commit; touches `src/lib/job-handlers/market-access.ts`) and
  `scanner-clamd-listener-diagnostics` (2 commits). `tmp/rw/` holds secrets; `.artifacts/` holds 1.4 GB
  of tariff source files. → R-07, R-12.
- WP2 adds a required `retrieval` field to every adapter in `market-access.ts`. Rebased after WP2, the
  Swiss branch's adapter must declare it (`retained_release` for a retained TARES release); the
  typecheck names it if missed.

**Staging database (amused-insight / staging).**
- Migrations 80 / 80 applied, matching `staging/railway`.
- Phase 1 has never run there: 0 confirmed classifications, 0 screening runs, 0 `country_screening` or
  `country_truth_discovery` jobs.
- No sanctions data. No `ConfigSetting` rows, so every policy is its code default and
  `country_truth.market_access_orchestration` does not exist (off).
- Customs Atlas authority releases are active; the per-source table is in the owner's report. The
  corrected row: `AL_CUSTOMS_ARCHIVE`, Albanian Customs Administration, release `2026-10-11`, reference
  2026-10-11, retrieved and activated 2026-10-11 09:58:39.473.

**Railway.**
- `amused-insight`: PR environments **off**, so opening a PR creates no environment (R-10 closed).
  Wait-for-CI is off on every deploy trigger. Production web auto-deploys from `master` on a Neon
  database separate from staging's. Production has no worker. The production scanner has no deploy
  trigger, and its last deploy (24 Aug) failed. **Production web's `STORAGE_BUCKET` names the bucket
  `cleartrade-staging`;** which environment's bucket that resolves to is unverified (R-13). Staging's
  volume `postgres-volume` is attached to nothing.
- `cleartrade-staging` project: deleted between 9 and 10 Oct (R-09 closed). Its database host can no
  longer be read.
- Unverified: whether the root `railway.json` still applies to production web; a per-trigger
  auto-deploy toggle the API does not expose (auto-deploy inferred from the trigger existing); what the
  dashboard flag `focusedPrEnvironments=true` means. The agent reads it as a PR-environment sub-option,
  inert while PR environments are off — an interpretation, not verified.

### E-010 · 2026-10-13 · Demand Discovery v5: research, design and owner decisions

**Source.** The design doc "Demand Discovery: Final Design" (Claude Doc, 13 Oct) and its "Decision
comparison" tab. The owner marked each decision in the doc's table and answered three follow-ups in
chat (D-009 to D-011, D-017). Engineering spec: docs/36.

**Findings, each page opened or command run on 13 Oct.**
- Comtrade free key: 500 calls a day, up to 100,000 records a call (`uncomtrade.org/docs/subscriptions/`;
  rOpenSci `comtradr` documentation). One call may name many reporters and up to 12 years.
- Comtrade data availability, public `getDa` endpoint: 99 reporters have annual HS data for 2025 and
  139 for 2024 (the 2024 list includes group entries such as the EU and "Other Asia, nes").
- Comtrade licence (`comtrade.un.org/licenseagreement.html`): commercial exploitation is prohibited
  without the UN's prior written permission. Premium plans are "Internal Use"; re-dissemination needs a
  Premium Pro subscription ($12,000 a year for the private sector), with no fee for small extracts or
  free public dashboards (`shop.un.org/de/node/55`). Nothing in the repository records a permission. → R-14.
- Today's cost per product: 218 screen calls, plus fallback waves for markets without the preferred
  year (docs/32's example: 122, then the rest), plus about 11 calls for each of 20 deep markets — about
  600 calls against a 450-a-day budget. `CanonicalComtradeRequest` carries one reporter per call
  (`src/lib/comtrade/request.ts`); staff approval of a scan exists to ration those calls
  (`src/lib/country-discovery/scan-requests.ts`, header).
- CEPII BACI V202601 (`cepii.fr`, item 37, and `DescriptionBACI.html`): 200 countries, about 5,000 HS6
  products; HS17 file 2017–2024, HS22 file 2022–2024; `v` in thousand current USD (reconciled, FOB),
  `q` in metric tons; numeric codes inherited from Comtrade; Taiwan = 490; licence Etalab 2.0, which
  allows commercial reuse with credit and the update date. → R-15.
- CEPII GeoDist (item 6): 225 countries, Etalab 2.0. ECGC short-term list from 1 Jul 2026: 239
  countries and territories, grades A1 to D, Restricted Cover Groups I and II, Pakistan off cover.
  WDI `LP.LPI.OVRL.XQ` and `TM.TAX.MANF.SM.AR.ZS`: latest 2022, CC BY 4.0. LPI 2.0 (2025 edition) has
  no single country score.
- Customs Atlas inside the 218-market universe (`DESTINATION_ADAPTERS`,
  `UNCONFIGURED_MARKET_ACCESS_SOURCES` and `buildCountryScreeningUniverse`, run locally): 53 markets
  have an adapter (51 retained releases; live GB and US); 7 adapter codes are territories outside the
  universe (AX, GG, IM, JE, MC, PR, TW: no Comtrade reporter identity); 62 documented-blocked; 103 not
  researched. Uncovered markets include AE, CN, BD, SG, MY and BR.
- Tiers: `buyer_discovery.run` has been absent from `CAPABILITY_MIN_TIER` (so paid) since `3ebb37f`
  (14 Aug), while docs/14 still lists it as guest. Recorded only; no change made.
- `cepii.fr` is unreachable from the agent session (`curl`, 13 Oct). → R-17.

**Decisions.** D-007 to D-019. Work branch `dd5/demand-discovery-v5`, stacked on
`wp2/atlas-orchestration` while PR #1 is open.

### E-011 · 2026-10-13 · Demand Discovery v5: data foundation and scoring engine (in review)

**Built** on `dd5/demand-discovery-v5` (draft PR #2, base `wp2/atlas-orchestration`):
- Data foundation (`15ee927`, `6342cd0`): `TradeDatasetRelease` / partitions / country map and
  `ReferenceDatasetRelease`, with append-only triggers (migration `20261013100000`); a streaming,
  ZIP64-aware BACI importer (`scripts/import-trade-dataset-release.ts`, `--expect-sha256`, run twice);
  WDI and Comtrade-availability parsers (`scripts/import-reference-dataset.ts`).
- Scoring engine (`src/lib/demand-discovery-v5/`): the 12 metrics, the score, ranking, confidence,
  gates, labels, reasons, the newest-year chain-link, the HS-revision test, BACI unit and identity
  conversion, and `assessMarkets` over every universe market. Pure functions; nothing reads a network.

**Engineering choices inside approved decisions** (docs/36 updated; each reversible in code):
- D-011 refinement: the newest year extends total imports and India's imports, so size, growth,
  stability and India's foothold (45 of 100 points) use `L+1`. Supplier mix, unit values and
  quantities stay on BACI's `L`: Comtrade's newest import values are CIF and its newest quantities
  are often estimated, so per-supplier linking would add noise and Comtrade calls for little signal.
  The alternative — per-supplier linking for every metric — is the original §5.3 wording.
- A newest-year change beyond 10× either way is treated as a provisional-data error and not linked
  (policy `chain_link.max_change_ratio`).
- Growth: a zero at the end of the window scores momentum at −100% (v4's convention); CAGR stays
  `not_calculable` on a zero endpoint, as in v4.

**Checks run.** `tsc --noEmit` clean; ESLint `--max-warnings=0` clean on the new files; Vitest:
51 new engine tests (metrics, score, chain-link, HS revision, BACI conversion, an eight-market
synthetic world, and a 300-world property test that a dropped input leaves its metric unavailable
and outside the overall, never zero) plus the 29 data-foundation tests, all passing.

**Not yet:** ECGC, GeoDist and India-agreement parsers (waiting on the owner's
`data/dd5-reference-snapshots` branch for the real file formats); the batched Comtrade client;
the run job, auto-start and screens (task 18); a staging run on the three archetype products.

### E-012 · 2026-10-13 · Demand Discovery v5: runs wired end to end (in review), and a delete-guard defect

**Built** on `dd5/demand-discovery-v5` (docs/36 §7.1): the batched Comtrade client
(`src/lib/comtrade/batch.ts`: split by period then reporter halves at the cap, never truncated);
v5 persistence (migration `20261013180000`: `DiscoveryRun` model, trigger, classification, frozen
inputs, summary; `MarketAssessment` status, rank, live points, data year, breakdown, labels, reasons,
flags, hand-off, with CHECKs and a unique rank per run); JobType `demand_discovery_v5` (costed);
config `demand_discovery.v5`; auto-start from `confirmClassification` (paid tier, v5 available,
audited either way); `POST /api/v1/discovery-runs` routes to v5 where a BACI release is ready; the
results API and the `/app/markets` and market-detail screens.

**Defect found and fixed (pre-existing since `20260829120000`).** The `MarketAssessment` lineage
guard ran `BEFORE UPDATE OR DELETE` and returned `NEW` on every path; in a delete trigger `NEW` is
NULL, so every delete of a non-v4 assessment was cancelled silently. Probed in a scratch schema:
`DELETE` of a `model_version = 'test'` row reported `DELETE 0`; deleting its run reported
`DELETE 1` and left the assessment pointing at a run that no longer exists. Consequences: a
discovery retry's `deleteMany` appended a second result set instead of replacing the first, and
deleting a run, product or organisation (including the guest purge) left orphaned assessments.
Migration `20261013181000` returns `OLD` for permitted deletes and keeps every v4 protection
(`tests/market-assessment-delete-guard.test.ts`). It deletes nothing; existing orphans are R-18.

**Checks run.** `tsc --noEmit` and ESLint `--max-warnings=0` clean. Full suite in CI's file order on
the local harness: 2,120 passed, 5 skipped, 3 failed — the same three local-harness-only failures as
the baseline in E-006 (`market-scan-requests`, `pilot-e2e`, `staff-provisioning`); none involve this
work. New: an end-to-end v5 run test (two synthetic BACI archives, reference releases, a fake
Comtrade endpoint; auto-start for paid only; 218 assessments; retry replaces rather than appends).
`reference-datasets.test.ts` now reads only its own releases, so it no longer depends on running
before other suites that import the same dataset key.

**Not yet:** official Customs Atlas duty in v5; ECGC, GeoDist and agreements parsers; the
release-level Comtrade fallback; agent and ops views of v5 fields; a staging run (needs the BACI
import on the owner's machine or the Railway worker).

### E-013 · 2026-10-13 · India's trade agreements, curated for the duty estimate

`data/reference/india-trade-agreements-v1.json` (43 agreement–partner rows), checked against:
DGFT Appendix 2A (FTAs/PTAs signed and in force, with dates, including ASEAN's staggered entry);
PIB, Aug 2026 (`static.pib.gov.in/…/2026/aug/doc2026818961401.pdf`): UAE CEPA in force 1 May 2022,
Australia ECTA 29 Dec 2022, EFTA TEPA operational Oct 2025, Oman CEPA implemented June 2026, New
Zealand FTA "signed, yet to be effective"; EFTA joint communiqué: TEPA in force 1 Oct 2025; PIB blog
(2 Jun 2026): Oman CEPA from 1 June; Welsh Government business news: UK CETA in force 15 Jul 2026;
NZ reporting (21 Sep 2026): ratified, in force 20 Oct 2026 (so not yet applied on 13 Oct). Scope
(comprehensive 0.5 / partial 0.8, D-017) is the agent's classification by agreement type, recorded
per row; SAFTA counts as partial because of its sensitive lists. Owner review welcome; nothing is
imported anywhere yet.

## Risk register

| Id | Risk | Status | Next evidence |
|---|---|---|---|
| R-01 | CI has never run tests or build; unknown pre-existing failures may surface | Open — env fix in WP1; the one order-dependent failure CI would hit is fixed on WP1 (E-006); three tests are unverifiable locally | First CI run on the WP1 PR |
| R-02 | Agent session cannot run DB tests or build (blocked hosts) | Partly mitigated — a local harness runs the full DB suite (E-006) and the build compiles with mocked font CSS (E-008); neither is canonical | Green CI on each WP PR |
| R-03 | Staging DB, Railway state and sanctions snapshots unverified from the agent session | Partly resolved (E-009): migrations current; Phase 1 never run; no sanctions data; no config rows | WP3 staging runs and sanctions refresh |
| R-04 | Production hazards (docs/33 §5): scanner URL → staging, failed scanner deploy, 8 Oct migration by old staging web, root `railway.json` move, shared Resend key; production has no worker; production scanner has no deploy trigger and its last deploy (24 Aug) failed (E-009) | Open — extended by E-009 | WP5 read-only inventory |
| R-05 | Tariff signal often unavailable by design (preference needs origin proof; specific duties) | Accepted in gate design | WP3 archetype runs |
| R-06 | WP2 design constraints (clock, single-worker deadlock, TARIC per-day identity) | Resolved in code (E-005): D-004 clock; inline acquisition avoids the deadlock; one release-backed snapshot per destination per resolution day accepted | WP3 staging runs |
| R-07 | Operator's local-only work unverified | Identified (E-009): two local-only branches, `tmp/rw/` (secrets), `.artifacts/` (1.4 GB) | Owner pushes or retires the two branches |
| R-08 | Gate thresholds unapproved | Open | Owner approval PR |
| R-09 | Second Railway project `cleartrade-staging` (deployed this branch on 9 Oct); database target and status unknown | Closed — project deleted 9–10 Oct (E-009) | — |
| R-10 | Railway PR environments, if enabled with a production base, would migrate production on PR open | Closed — PR environments off (E-009); `focusedPrEnvironments` flag unverified | Re-check before enabling PR environments |
| R-11 | `reclaimStaleJobs` requeues any job still processing 300 s after it **started** (no heartbeat); with more than one worker a long deep run would execute twice. Safe today only because staging runs one worker and the sweep runs between jobs | Open (pre-existing; WP2 lengthens deep runs) | Keep one worker until staleness is heartbeat-based (WP5) |
| R-12 | The owner's local clone holds unpushed work; `wip/switzerland-tares` touches `market-access.ts`, where WP2 adds a required `retrieval` field | Open (E-009) | Owner rebases after WP2 lands; the typecheck names a missing field |
| R-13 | Production web's `STORAGE_BUCKET` names the bucket `cleartrade-staging`; if it resolves to staging's bucket, production files land in staging storage (or the reverse) | Open — unverified (E-009) | Owner dashboard check; WP5 read-only inventory |
| R-14 | UN Comtrade's licence prohibits commercial use without the UN's written permission; D-010 shows Comtrade-derived figures to customers before permission | Open — accepted by the owner (D-010); permission request drafted for the owner to send | UNSD's reply; Comtrade display stays switchable in config |
| R-15 | BACI is built from Comtrade data; Etalab 2.0 is CEPII's licence, and the position of the underlying UN data is unverified | Open (E-010) | Legal check before the production launch |
| R-16 | Agreement-based duty estimates can be wrong for a specific product | Accepted (D-017); always labelled, evidence quality 0.5 | Calibration on the three archetype products |
| R-17 | The agent session cannot reach CEPII, World Bank or Comtrade hosts | Open (E-010) | Imports run on the owner's machine or the Railway worker |
| R-18 | Since `20260829120000`, deleting a run, product or organisation left its non-v4 `MarketAssessment` rows orphaned, and discovery retries appended duplicate result sets; staging/production may hold such rows | Open (E-012) — guard fixed going forward; no rows changed | Read-only counts on staging: assessments whose run is missing, and runs with more than one row per country; clean-up only with the owner's authorization |
