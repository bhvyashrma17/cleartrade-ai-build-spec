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
| D-020 | 2026-10-14 | v5 runs look up the product's official tariff in every market with a Customs Atlas source, behind a config switch (`demand_discovery.v5.tariff_acquisition`, on by default) (E-018, E-019). | Owner | Demand Discovery v5 |
| D-021 | 2026-10-14 | A World Bank value more than 10 years old on the run's date counts as missing (R-20; policy v3). | Owner | Demand Discovery v5 |
| D-022 | 2026-10-14 | No release-level Comtrade-only fallback: an environment without a BACI release keeps the earlier engine, and the BACI import is part of each environment's bootstrap. The owner's reply "yes" to the recommendation "no" was read as agreement; recorded as such pending correction. | Owner | Demand Discovery v5 |
| D-023 | 2026-10-14 | Rupee figures beside dollar figures in the Demand Discovery views follow today's ECB rate (the owner chose this over the rate frozen with the run); stored run values stay in US dollars. | Owner | Demand Discovery v5 |
| D-024 | 2026-10-14 | Official tariffs for every market from free sources, researched country by country, keeping agents' work to a minimum; in parallel the owner asks UNCTAD (TRAINS) and the WTO for permission to show their tariff data in the product. | Owner | Demand Discovery v5, Customs Atlas |
| D-025 | 2026-10-14 | Fill four further data gaps: the six missing capitals and customs-union duty estimates; a second exchange-rate source (IMF) after a terms check; market-level sanctions programmes from the UN, US and EU lists; UNCTAD's shipping-connectivity index as a logistics fallback after a terms check. | Owner | Demand Discovery v5 |
| D-026 | 2026-10-18 | v5 scores India's preferential rate where the official tariff publishes one for India and it is not a tariff quota, instead of the ordinary rate; the ordinary rate stays beside it (policy v6, E-022). | Owner | Demand Discovery v5 |
| D-027 | 2026-10-18 | The agent's 10% is a tenth of ClearTrade's 1% success fee. Owner's words: "yes, but charged as additional agent fee later" — read as a separate agent fee charged to the exporter on top of the 1%, at a later stage. The owner confirmed this reading on 19 Oct 2026 ("you're right"). Recorded, not built: `payouts.ts` still pays the agent share out of the success fee. | Owner | Fees, payouts |
| D-028 | 2026-10-18 | Approved as built in PR #5: Hong Kong's zero duty from C&ED's published statement; the seven other published rules; agent-read official lines at quality 0.9; agents may record lines from the eight licence-pending sources, one cited rate per line (R-24); the logistics estimate from shipping connectivity at quality 0.5; sanctions as flags only. Also approved: a customs union's common tariff counts as its members' official duty before national exceptions are modelled, labelled and below full quality; currencies the ECB does not publish use US Treasury reporting rates. | Owner | Demand Discovery v5, Customs Atlas |
| D-029 | 2026-10-18 | Singapore's tariff is acquired automatically inside SSO's permitted window (03:00–07:00 SGT) every day and saved; runs read the saved copy at any time. Saved copies refreshed on a schedule are acceptable for other markets where that is the only way. | Owner | Customs Atlas |
| D-030 | 2026-10-19 | Every remaining market's tariff is to be read by the system so agents no longer check it, built in small clusters completed one at a time, until all the markets v5 screens are covered. Owner's words: "integrate them in our system in order that agent doesn't has to check, break in small clusters and complete chunk to chunk. in the end i want all 200+ markets incorporated." Order: the recommendation in E-022, which the owner accepted ("your recommendation"): the 40 researched national sources first, as saved copies where that is the only way (D-029), largest Indian export markets first; the seven licence-pending sources stay with agents until a licence is settled. Each cluster still gets its own source and rights check (docs/37 §6). | Owner | Customs Atlas, Demand Discovery v5 |
| D-031 | 2026-10-19 | A market's own tariff read automatically from a retained official schedule scores like an agent's reading of it (quality 0.9) and is labelled "read from <the tariff>; trade remedies are not checked", because trade remedies and temporary measures outside the schedule are not read. Owner's choice: "Like an agent's reading (Recommended)" (policy v7, E-025). | Owner | Demand Discovery v5, Customs Atlas |
| D-032 | 2026-10-19 | v5 scoring policy v8: India's own success no longer counts against a market — openness is measured among India's competitors, and where India already supplies 10% or more of a market a lower market price is not counted against it — and a new metric, India's sales (10 points), scores how much India already sells there; price headroom 10 → 5 and market size 20 → 15. Owner's choice, "B: fix both + India's sales (Recommended)", after the re-score in E-028. | Owner | Demand Discovery v5 |
| D-033 | 2026-10-22 | Country expansion (D-030) is on hold. For a pitch on 24 Oct, Regional Demand Discovery and Real Buyer Discovery are built for a smaller set of markets and must work end to end on staging. Owner's words: "hold on country expansion … i want operational demand, regional, buyer. maybe for a shorter area not 218. but operational. full fledged." Owner's choices: the US, the UK and Canada ("US + UK + Canada (Recommended)"); demonstration product carpets 570110; the owner signs up for the free Census Bureau API key; the agent may download HMRC's `importers2608.zip` and ISED's three 2023 importer files to the owner's Mac. | Owner | Regional and buyer discovery (docs/38) |
| D-034 | 2026-10-22 | Buyers from the official importer lists are shown as published, including sole traders' names — the owner chose "Every published entry" over the recommended "Companies only, no contacts". No contact details are added. | Owner | Real Buyer Discovery (docs/38) |
| D-035 | 2026-10-30 | Regional demand (stage 2) and real buyers (stage 3) are to cover every market Demand Discovery scores (all 218), each from the best source it has and labelled as such; stages 4 and 5 are the owner's. Owner's words: "why are you counting just UK, Canada for regional and real buyers? We want it for all the countries we are getting in the demand discovery, right? We want all the 200 plus countries on board." and "I have outreach and agent ready." | Owner | Regional and buyer discovery (docs/38), the plan of E-031 |
| D-036 | 2026-10-30 | The earlier discovery engines are retired: in staging and production nothing starts a Country Truth v4 scan, scan request or detailed analysis, or a warehouse-engine run, and acceptance gates check v5 runs only. Owner's words: "the acceptance gates should not run old v4s." | Owner | Demand Discovery, Phase 1 gate (docs/34) |
| D-037 | 2026-10-30 | Demand Discovery uses actual data or labelled estimates only; agents neither read nor record tariffs. Owner's words: "we don't want agents reading, either have labeled estimates or actual data in demand discovery." | Owner | Demand Discovery v5, Customs Atlas (docs/36, docs/37) |
| D-038 | 2026-10-30 | Build order: finish Demand Discovery first, then regional demand for all its markets, then buyers for the same markets, with source research and tariff work alongside; tariff automation for every market (D-030) resumes as part of finishing stage 1. Owner's words: "Ideate well about what to build in demand discovery first to finish it once and for all, then covering the region for all the countries covered in it, and then the buyer discovery for the same countries. It's a simultaneous project, I guess." and "The completion of the demand discovery first, right? If yes, then let's proceed with it." | Owner | Programme |

Open owner decisions: approval of every `phase-1-gate-v1` value (docs/34 §2); the meaning of
"1E Live Country Truth Reconciliation" (not found anywhere in the repository); all later decisions in
roadmap §26; how the seven licence-pending sources and the 45 ranked markets with no tariff online are
covered once the researched sources are done (D-030; the replies from
UNCTAD and the WTO bear on both).

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

### E-014 · 2026-10-13 · v5: ECGC country risk and CEPII capitals wired; BACI parser v2 keeps Namibia

**Built** on `dd5/demand-discovery-v5` (docs/36 §3.2, §7.1):
- `src/lib/reference-datasets/ecgc.ts`: the ECGC short-term list from the circular's
  `pdftotext -layout` text — four tables, wrapped names, footnotes, table notes; strict checks
  (effective date on every page, "Page n of N" complete, serials 1…n per table, no row-like line
  left unread, every name on one ISO code). `geodist.ts`: one capital per country from
  `geo_cepii`; withdrawn 2011 codes map to the successor with the same capital, checked on the city.
- Both registered (`ecgc:country-risk:short-term`, `cepii:geo_cepii`) as
  `derived_from_publisher_file`: importable only with the original's URL, sha256, bytes, retrieval
  time and method, which `data/reference/manifest.json` records and the release stores
  (`validation.derived_from`); a repeat import claiming another original is refused.
  `scripts/import-reference-dataset.ts` reads that provenance from the manifest.
- `data/reference/`: `ecgc-country-risk-st-2026-07-01.txt` and `geo_cepii.csv`, byte-identical
  to the owner's snapshot branch (`50834cd`), and `manifest.json` for all three reference files.
- v5 runs read both: country risk for 217 of 218 markets (Saint Barthélemy is not on ECGC's list),
  distance fit for 212 (no 2011 capital row for BL, BQ, ME, SS, SX, VA). BACI 490 is placed at
  Taipei because CEPII documents it as Taiwan and GeoDist numbers Taiwan 490; 697 and 711 stay off
  the map. The frozen inputs name both releases and the placement.

**Defect found and fixed (real-file conformance, before any import).** CEPII's V202601 country file
leaves Namibia's `country_iso2` empty — its code "NA" is the usual not-available token — while
`country_iso3` is NAM. Parser v1 kept the empty cell, so Namibia had no ISO identity and would have
looked uncovered by BACI. v2 (`cepii-baci-parser-v2`) takes the alpha-2 from the file's own alpha-3
when ISO pairs them both ways, lists each case in the release validation, and refuses a row whose
two ISO cells disagree (none in the real file). No release was ever imported with v1.

**Engineering choices inside approved decisions** (each reversible in code):
- Text forms of the ECGC PDF and the Stata table rather than PDF or Stata readers in the app: no
  new dependency, and the parsers are tested here on the real files. The alternative is parsing the
  publisher's bytes directly (pdf.js, a .dta reader).
- 32 hand-reviewed ECGC spellings; the Channel Isles row rates both GG and JE; the Canary Islands
  row is left out (Spain has its own row; same grade, A2).
- A territory with no 2011 capital row gets no distance score; no neighbour's coordinates are borrowed.
- With risk now live, a market no trade dataset covers can show a partial score from its ECGC grade
  alone (`not_enough_data`, never ranked), as docs/36 §5.2 specifies.

**Checks run.** `tsc --noEmit` clean; ESLint clean on every changed file. Vitest on the local
harness: `reference-datasets-ecgc-geodist` (11, new: synthetic edge cases, the real files, the
manifest, derived-file imports), `trade-dataset-baci` (11, two new incl. the real country file),
`demand-discovery-v5-run` (2; now imports the real ECGC and GeoDist files: US risk 100, Nepal 55,
US distance from five suppliers with full coverage, Taiwan placed), `reference-datasets` (8),
`trade-dataset-import` (8), `trade-dataset-zip-reader` (6), v5 `assess` (10), `metrics` (28),
`score` (19), `country-screening-universe` (19), `architecture-guards` (13),
`customs-territory-aliases` (3): all passing.

**CI record (GitHub Actions, `pull_request`).** PR #1 (`wp2/atlas-orchestration` → `staging/railway`):
run 38356527288 on `f480198` failed in `npm test` — annotation: the CI-only
`IMPORT_BUYER_REF_SECRET` was under 32 characters (`src/lib/import-identity.ts`); run
38357458483 on `75788e5` (the fix) passed. PR #2 (draft, `dd5/demand-discovery-v5` → PR #1's
branch): 38389783915 on `6342cd0` passed; 38392419416 on `048bee5` cancelled by the next push;
38393057935 on `d015675`, 38397537823 on `002de14` and 38398854225 on `205ca26` passed. Job logs
cannot be downloaded from this session (blob storage refused); annotations can. CI notices:
`ubuntu-latest` moves to Ubuntu 26 from 19 Oct 2026, and the Node 20 actions now run on Node 24.

**Not verified.** How the two derived files were made: the ECGC command is inferred from the text's
layout and the GeoDist export tool was not recorded (R-19). ECGC's reuse terms.

### E-015 · 2026-10-13 · v5: official Customs Atlas duty for Indian goods

**Built** on `dd5/demand-discovery-v5` (docs/36 §7.1, §9):
- `selectTariffFactsOnly` (`src/lib/country-truth/fact-selection.ts`): the deep assessment's own
  admission rules for tariff rows, exported for callers without an exporter fact snapshot. The
  selection logic is unchanged.
- `src/lib/demand-discovery-v5/official-duty.ts`: per market, the newest current ordinary duty on the
  exact HS6 line (authoritative public, confidence ≥ policy minimum); ad valorem as published; a
  specific duty per kg or tonne converted to USD/kg at the frozen ECB rate; anything else official
  but unusable, with the reason. A preference published for India is noted, never scored.
- The score turns USD/kg into a percentage with the market's median supplier unit value and falls
  back to the labelled estimate (saying why) when that value is unknown. Reasons read "Duty on
  Indian goods is 5%; duty-free entry may apply with proof of Indian origin" and "about 7.7% (175.00
  EUR / 1000 kg at this market's prices)".
- Runs freeze, per market, the resolution, fact ids, snapshot ids and FX used; the policy is v2
  (`duty.official_minimum_confidence: 50`, the deep assessment's value). No run ever used v1.

**Engineering choice inside D-017 (owner may reverse in code).** The scored official rate is the
ordinary (MFN) duty, because the deep assessment already rules that a published preference is not
applicability (rules of origin and quotas are shipment facts) and because Korea, Japan and the UK
publish quota-only preferences the evidence rows do not flag structurally. Consequence: for a
market with official evidence and an Indian preference, v5 can read higher than the estimate path,
which assumes an agreement in force is used (§4.7). The alternative — score the published
preference where it is not a quota — needs the quota condition persisted at ingest first.

**Not built (decision for the owner).** v5 reads stored tariff evidence only; it does not acquire
it. A market has an official duty only where evidence was ingested earlier, so until acquisition is
switched on somewhere, every v5 duty is the labelled estimate and the run says so. Acquiring inside
v5 means up to 53 adapter runs per product (two of them live fetches with 60 s timeouts) and the
WP2 orchestration switch is still off.

**Checks run.** `tsc --noEmit` clean; ESLint clean on every changed file. Vitest on the local
harness: `demand-discovery-v5-official-duty` (6, new: admission through the deep assessment's rules,
ad valorem, specific with FX, compound / per-litre / no-FX, heading-level, late, expired,
preference-only, unapproved licensed content, newest wins, low confidence), `metrics` (29),
`score` (19), `assess` (10), `run` (2; seeds Germany's EUR 175/t and Nepal's 10% with a 0%
preference: Germany scores 7.7% against its USD 2.50/kg unit value, Nepal 10% with the preference
noted), and the deep-run suites `country-truth-fact-integrity` (23), `country-truth-phase-1h-
assessment` (11), `phase-1h-operational-pillars` (4), `licensed-tariff-evidence` (25),
`demand-discovery-ui` (22): all passing. The run suite now scores HS 100890, which no other suite
uses, because market-access evidence is immutable and stays in the shared test schema.

**CI defect found after push (`8f9b344`, run 38435824816; also `65c5f99`).** CI runs every suite
against one database. The ECGC suite imported the real ECGC text and superseded it in its clean-up;
the v5 run suite then imported the same bytes and was refused ("since superseded" — by design, an
older source is never re-activated). Local runs had used a fresh schema per file and missed it.
Fixed in `bde7c5c`: each suite appends a suffix the parsers ignore, so its bytes are its own.
Reproduced first by running both suites in one schema, then verified by the full suite in one
schema in CI's file order: 2,145 passed, 5 skipped, 3 failed — the same three local-harness-only
failures as E-006. From here every push is preceded by that single-schema full run.

### E-016 · 2026-10-13 · v5: agent and ops views, calibration script, environment runbook

**Built** on `dd5/demand-discovery-v5` (docs/36 §7.1, §10):
- `src/lib/demand-discovery-v5/detail.ts`: one builder for the v5 view of a stored assessment, used
  by the exporter's market page (replacing its inline copy) and the agent control surface.
- Agent control table: for a v5 run the model rank is the stored rank — only `ranked` markets have
  one, so a partial score (a not-ranked market can score above ranked ones) is shown as partial and
  never ranked; rows order by rank, then score with unscored markets last; the market cell shows the
  v5 status, flags and top-10 hand-off; the details open the same five-part, twelve-measure
  breakdown the exporter sees. An empty operational order now reads "Not ranked" unless an agent
  excluded the market. `agent-decisions.ts` freezes the stored v5 rank on a decision instead of
  counting higher scores, which would have frozen a rank v5 never gave.
- `/ops/discovery`: a v5 panel (`src/lib/demand-discovery-v5/operations.ts`, Ops only): whether runs
  can start and why not, switches and policy version, every dataset a run reads with version, import
  date, origin and what its absence costs, last-7-day counts by status, and the 20 latest runs with
  ranked count, top markets and each run's notes on what it could not use.
- `scripts/dd5-compare-top10.ts` and `calibration.ts`: the docs/36 §8 check — a finished run's top 10
  against India's ten largest destinations in the BACI release the run used, over the size metric's
  years; `calibration_failure` when fewer than half appear, with what the run said about each miss.
  Read-only.
- docs/36 §10: the environment runbook (BACI, WDI, getDa, the repository's reference files, R-19
  re-derivation, the ops check, the three archetype runs and the calibration check), with every
  sha256.
- `vitest.config.ts` compiles JSX with React's automatic runtime (as Next.js does) so a test can
  render a component; no existing test rendered JSX.

**Decisions left with the owner** (recommended defaults in docs/36 §7.1): tariff acquisition inside
v5 runs (not built; official duty appears only where evidence was ingested); the release-level
Comtrade fallback (not built; an environment without BACI keeps the earlier engine, and BACI becomes
a bootstrap step).

**Checks run.** `tsc --noEmit` clean; ESLint `--max-warnings=0` clean on every changed file. New
tests: `demand-discovery-v5-operations` (2: Ops only; datasets with what their absence costs; a run's
status, ranked count, top markets and notes; the panel rendered server-side),
`demand-discovery-v5-calibration` (2: overlap, misses with the run's reasons, failure and
no-exports verdicts), two v5 cases in `demand-control` (stored rank, a partial score above two
ranked markets left unranked, the v5 breakdown, a promoted unranked market, the stored rank frozen
on decisions); `agent-decisions` (41) unchanged and passing. Full suite in one schema, CI's file
order: 136 files, 2,151 passed, 5 skipped, 3 failed — the three local-harness-only failures of E-006.
CI on `bde7c5c` (run 38439833133): passed. `65c5f99` (run 38438664689) failed on the shared-bytes
defect above, as `8f9b344` had.

### E-017 · 2026-10-14 · Status report for the owner; tariff acquisition recommendation revised

The owner asked what "complete" meant. Answer, recorded in the Claude Doc "Demand Discovery v5 —
Workflow and Status" (https://claude.ai/code/artifact/f70f1f8f-756f-48c0-9161-89f8c9bf05b3): the code
is written and tested (CI green on `9935f11`); nothing runs on staging or production; most duties
would be estimates; accuracy is unproven until the three archetype runs.

**Verified for the report.**
- Customs Atlas destination adapters: 60 codes, 53 of them screening markets — 51 read retained
  authority releases (27 EU members through TARIC, plus 24 national sources) and GB and US are live
  look-ups (`DESTINATION_ADAPTERS`, listed at runtime). The 11 Oct staging acceptance
  (`docs/customs-atlas/railway-staging-acceptance-2026-10-11.md`) loaded those releases; staging holds
  market-access snapshots only for the pairs it checked (for HS 100630: ID, UZ, VN, and MC outside
  the universe).
- World Bank coverage of the 218 markets, from the 13 Oct files: tariff averages 187 (latest value
  per country, years 2002 to 2022), logistics index 168 (2007 to 2022). 31 markets have no tariff
  average; of those only LU has an Atlas source. India has an agreement in force with 32 markets.

**Recommendation revised (owner decision pending).** Tariff acquisition inside v5 runs: E-015 said
not to build it yet, on the cost of up to 53 adapter runs per product. With the releases already on
staging, 51 of those runs read local releases and two are live calls, so the recommendation is now to
build it behind a switch. New proposal: treat a World Bank value older than 10 years as missing (R-20).

### E-018 · 2026-10-14 · v5 on staging: merges, deploy and data load; owner decisions

**Merges** (owner-authorised in this conversation; done from the agent session through the GitHub
REST API). PR #1 merged as `a6ce402` (merge commit; parents `f29fcf5`, `75788e5`) at 06:58Z. PR #2
retargeted to `staging/railway`, marked ready, renamed "Demand Discovery v5" and merged as `76fb4a7`
(parents `a6ce402`, `8c9f6c4`) at 07:00:23Z. CI on `8c9f6c4` (run 38522158682) passed, and the trees
merged are the trees CI tested: `a6ce402^{tree}` = `75788e5^{tree}` = `f8b8dfed…`, `76fb4a7^{tree}` =
`8c9f6c4^{tree}`. Branches kept; `master` untouched at `6d4733c`. Repository settings found: merge
commits allowed, `delete_branch_on_merge` false, no branch protection or rulesets on
`staging/railway`; CI runs on pull requests and on pushes to `main`/`master` only.

**Deploy.** Railway deployed both merges by itself (GitHub deployments by `railway-app[bot]`,
environment `amused-insight / staging`), which settles E-009's open point: staging auto-deploys from
`staging/railway`. `76fb4a7` went live on the scanner at 07:03:42Z, web 07:05:31Z and worker
07:06:44Z (commit statuses), after `a6ce402`'s web and scanner and before its worker finished. The
owner's local Claude Code confirmed web deployment `88c917a9…` and worker `853eecc9…` successful;
`prisma migrate status` up to date at 83 migrations, with `20261013100000`, `20261013180000` and
`20261013181000` finished at 07:04:51Z and none rolled back; `/api/health/ready` 200 with database,
storage and worker ready.

**Data load** (owner's machine, `tmp/rw/operator.env` — the only file with `APP_ENV` and
`DATABASE_ENVIRONMENT` both `staging`; staging database fingerprint `62587019d354`). The first attempt
stopped before any write: the owner's email has no staging account. One read-only query found one
`ops_supervisor`/`admin` account, `atlas-ops@staging-atlas.invalid` (admin, created 11 Oct), which the
owner approved as the actor. Every import was NEW, then UNCHANGED on its built-in second run:

| Dataset | Release id | Rows |
|---|---|---|
| BACI HS17 V202601, 2017–2024 (768 partitions) | `cmv7s0itq0001uesdw7rxwb8t` | 89,207,221 |
| BACI HS22 V202601, 2022–2024 (288 partitions) | `cmv7sij5m0001uemd5n498sob` | 33,900,195 |
| `wdi:LP.LPI.OVRL.XQ` | `cmv7sn4iv0001ue5vn2vfhi84` | 169 |
| `wdi:TM.TAX.MANF.SM.AR.ZS` | `cmv7sn6300001ue6do782n8nz` | 188 |
| `wdi:TM.TAX.TCOM.SM.AR.ZS` | `cmv7sn7k70001ue6u99x5p8me` | 188 |
| `comtrade:availability:2024` | `cmv7snfoh0001ue7ze3tmpk09` | 148 |
| `comtrade:availability:2025` | `cmv7snhd10001ue8hikt0gmy3` | 122 |
| `ecgc:country-risk:short-term` | `cmv7sny7d0001ue9x7ro4ufv5` | 239 |
| `cepii:geo_cepii` | `cmv7snzu20001ueae4uvef7wu` | 225 |
| `india:trade-agreements` | `cmv7so1p80001ueav6bikoxpq` | 43 |

- Both BACI releases `ready`; each validation lists exactly
  `iso2_from_iso3: [{ provider_code: "516", iso2_cell: "", iso3: "NAM", iso2: "NA" }]`.
- Every downloaded file matched the snapshot manifest's sha256 and size. The Comtrade reporting lists
  were downloaded on 14 Oct (sha256 `de88860b…f729ab` for 2024, `1bef69a8…98a3` for 2025).
- World Bank rows against file rows, checked in the agent session by running the importer's parser
  on the snapshot files: the LPI file's 217 entries are 169 countries and 48 aggregates; each tariff
  file's 189 are 188 countries and "European Union", whose members carry their own rows. No country
  was dropped.
- `india:trade-agreements` cites the full merge-commit hash as its source URL. Import logs are in
  `.artifacts/dd5/logs/` on the owner's machine (gitignored).

**R-19 closed.** `pdftotext -layout` (Poppler 26.09.0) on the ECGC PDF, and pandas 2.3.3
`read_stata` then `to_csv(index=False)` on `geo_cepii.dta`, reproduce `7985b79e…0311` and
`cd6398ae…fe93` byte for byte. Nothing re-derived was imported.

**Found while checking.** A v5 run converts the exporter's price and specific duties with ECB
observations stored in the environment, and nothing in the codebase stores them
(`ingestEcbSeries` has no caller): on staging every price outside US dollars and every specific duty
would be unconverted, and `/ops/discovery` would not show it. Fixed in E-019.

**Owner decisions.** D-020, D-021, D-022. The owner reports the UN Comtrade permission request sent
(R-14).

**Not yet verified.** `/ops/discovery` showing "Runs can start" (asked of the owner). No v5 run has
run on staging.

### E-019 · 2026-10-14 · v5: ECB rates fetched by runs, World Bank age limit, tariff look-up in runs

**Built** on `dd5/v5-fixes`, branched from `staging/railway` at `76fb4a7` (docs/36 §7.1, §9, §10):
- `src/lib/demand-discovery-v5/fx.ts`: a run's rates come from stored ECB observations first; when
  none cover the run's date within `fx_max_lookback_days`, and `fx_fetch_missing` (new, on) allows,
  the run fetches the missing series over that window through `ingestEcbSeries` (immutable, raw
  response kept) and derives again. One fetch per series per run, frozen in `fx_fetches`. A failed
  fetch leaves the rate unavailable and makes the run `partial`; an ECB 404 is recorded, not a
  failure; a malformed currency code is never fetched.
- Policy v3: `world_bank.max_age_years` 10 (D-021). Logistics and the duty estimate say when a value
  is too old; the run notes how many markets lost one; the dropped values are frozen in
  `world_bank_too_old`. Against the 14 Oct files this drops logistics for AZ (2014) and TL (2007) and
  tariff averages for DJ (2014), ER (2006) and TM (2002).
- `src/lib/demand-discovery-v5/tariff-step.ts` (D-020): with `tariff_acquisition` (new, on), a run
  asks every market with a Customs Atlas source for the product's HS6 before reading tariff
  evidence, through the deep run's `acquireTariffEvidence`, one source at a time so EU TARIC is
  decoded once for its 27 members; acquired evidence is admitted at the tariff clock; every outcome
  is frozen in `tariff_acquisition`; a failed or timed-out look-up makes the run `partial`.
  `tariffAdapterFor` added to `tariff-acquisition.ts`. Run duration with 53 look-ups on staging is
  not yet measured.
- `/ops/discovery` shows the tariff look-up switch, the ECB fetch switch and the newest stored
  EUR/USD day. Frozen inputs schema `demand-discovery-v5-inputs-v2`.

**Checks run.** `tsc --noEmit` and ESLint `--max-warnings=0` clean on every changed file. New tests:
`demand-discovery-v5-fx` (4: fetch, store and derive; stored rates read first; EUR, USD and malformed
codes; a failed fetch against an ECB 404; fetching off), `demand-discovery-v5-tariff-step` (2: only
markets with a source are asked, one source at a time; outcomes; the tariff clock), two age-limit
cases in `demand-discovery-v5-metrics`; `demand-discovery-v5-run` now has a live UAE look-up during
the run replace the agreement estimate with the official 5%, reads the stored EUR rate without a
fetch, and drops a 2010 logistics score with its note. Full suite in one schema, CI's file order:
138 files, 2,159 passed, 5 skipped, 3 failed — the three local-harness-only failures of E-006. CI on
`21025dc` (run 38538913819): passed. PR #3 into `staging/railway`.

### E-020 · 2026-10-14 · v5: rupees beside dollars, customs-union estimates, missing capitals; tariff programme baseline

**Built** on `dd5/v5-coverage`, stacked on PR #3 (docs/36 §7.1, §9, §10):
- Rupees (D-023): `src/lib/fx/display-rate.ts` reads the newest ECB INR and USD observations, fetches
  both series when the newest stored day is older than the newest the ECB could have published (at
  most once an hour per process) and crosses them on one day; `src/lib/money-format.ts` writes lakh
  and crore and appends the rupee figure to every dollar amount; the exporter's market list, market
  page and the agent control table show it with the rate and its day. Price sentences now give the
  per-kilogram prices behind the ratio.
- Policy v4 `customs_unions`: LU, MQ, SM (EU, all chapters) and AD (EU, chapters 25–97) borrow the EU's
  common external tariff average for the estimate, labelled as such; each entry names its legal basis.
- `curated:capitals-supplement` (`data/reference/capitals-supplement-v1.json`, sha256 `b799dd98…0823`):
  BL, BQ, ME, SS, SX and VA, a source per row (Natural Earth v5.1.2, public domain, for ME, SS, VA;
  Wikipedia infobox coordinates for BL, BQ, SX); used only where GeoDist has no row. Not yet imported on
  staging (docs/36 §10 step 5).

**Tariff programme baseline** (D-024), from the repository's own registries over the 218 markets:
53 connected (`DESTINATION_ADAPTERS`), 62 researched and blocked with a recorded reason
(`unconfigured-sources.ts`: licence pending, source insufficient, no machine interface, credentials,
investigation required), 103 not yet researched. Two near-term routes found: Singapore's provider,
bundle reader and parser are implemented and wait only for an acquisition inside SSO's permitted
03:00–07:00 SGT window plus qualification; Hong Kong levies no customs tariff on imports (Customs and
Excise Department, Cargo Clearance page; Basic Law Art. 114), only excise on four commodities. UNCTAD
TRAINS (via WITS) is free to access but silent on commercial display; the WTO's terms permit
non-commercial use only without the Secretariat's approval; ITC Market Access Map forbids commercial
exploitation without ITC's written permission. Permission emails to UNCTAD and the WTO were drafted for
the owner.

**Checks run.** New tests: `money-format` (3), `fx-display-rate` (3), `capitals-supplement` (3), one
customs-union case in `demand-discovery-v5-metrics`. Full suite in one schema: 141 files, 2,169 passed,
5 skipped, 3 failed — the three local-harness-only failures of E-006. ESLint and `tsc --noEmit` clean on
every changed file. CI on `3cb7656` (run 38548231223): passed. PR #4, stacked on PR #3.

### E-021 · 2026-10-17 · Tariffs for every market, pegged currencies, logistics estimate, sanctions flags

**Built** on `dd5/tariff-coverage`, stacked on PR #4 (docs/36 §2, §4, §7.1, §9, §10; docs/37):
- Customs Atlas: Martinique and San Marino join Åland and Monaco on the EU tariff, Andorra for HS
  chapters 25–97 only (refused before any release is read otherwise); `src/lib/market-access/taric/service.ts`.
  Releases imported before this record the narrower destination scope; the legal basis is in code.
- Policy v5 (`demand-discovery-v5-policy-v5`; no run used v4): `rule_rates` for HK, MO, SG, SX, BQ, VA
  (0%) and TL, BL (5%), each with source, excepted goods and review date; quality
  `official_agent_recorded` 0.9; `logistics.lsci_fallback_minimum_pairs` 30 and quality
  `logistics_lsci_estimate` 0.5.
- `src/lib/market-access/tariff-source-directory.ts`: all 218 screened markets resolve to a connected
  adapter (56), a researched determination (62) or a directory entry (100: 54 with an official page,
  schedule or law, 46 with none online); customs-union sources for ECOWAS/UEMOA, EAC, EAEU, CEMAC,
  SACU, GCC, CARICOM, SICA, MERCOSUR. The agent's market table shows where to read the tariff and
  records the declarable line (`src/components/agent/RecordOfficialDuty.tsx`,
  `POST /api/v1/market-access/manual-captures`, `src/lib/market-access/manual-capture-service.ts`):
  market and HS6 from the stored assessment, assigned agent or Ops only, authoritative-manual
  evidence, audit event `market_access_manual_capture`. v5 labels such a line "read from the official
  tariff by a ClearTrade agent".
- `curated:currency-pegs` (`data/reference/currency-pegs-v1.json`, sha256 `64ddb6d2…0825`): 14
  currencies, 9 read on the authority's own page, 4 from the authority's statement as reported, 1 from
  a reference work; the v5 resolver converts through the anchor's ECB rate without requesting a series
  the ECB does not publish.
- `wdi:IS.SHP.GCNW.XQ` registered; `src/lib/demand-discovery-v5/logistics-fallback.ts` fits LPI on
  ln(LSCI) per run; frozen inputs v3 carry `logistics_estimate`.
- `curated:sanctions-programmes` (`data/reference/sanctions-programmes-v1.json`, sha256 `bf2660fa…6c50`):
  24 programmes checked 17 Oct 2026 (UN regimes for 14 markets; US CU, IR, KP comprehensive and RU, BY,
  VE sectoral; EU RU, BY, IR, KP), shown as v5 flags.

**Duty coverage** (policy v5 against the 13 Oct World Bank files, over the 217 markets v5 ranks): official
without an agent in 64 (56 connected, 8 by rule), estimated in 128, neither in 25. Of the 153 an agent can
make official, 60 have a researched source and 48 a directory page, schedule or law; in 45 nothing is
online and the agent asks the authority.

**Research** (docs/37 §7 lists every market): country by country for the 103 markets without a recorded
source, from the authorities' own sites and official legal publications. IMF exchange rates need the
IMF's permission for commercial reuse, so pegs were curated instead; US Treasury reporting rates
(public domain, quarterly, about 170 currencies) are the free route for floating currencies but their
live format could not be checked from the agent session (R-17). Iran's UN sanctions were re-imposed on
27 Sep 2025 and remain contested (CRS IF11583, July 2026); the UN arms embargo on South Sudan was
renewed in May 2026; OFAC lists no Syria programme (Syrian Sanctions Regulations removed in 2025).

**Not done:** floating currencies (Treasury source); common-tariff parsers (docs/37 §5); Singapore's
window acquisition job; replies from UNCTAD and the WTO.

**Staging after merge:** import `curated:currency-pegs`, `curated:sanctions-programmes` and
`wdi:IS.SHP.GCNW.XQ` (docs/36 §10 step 5), after PR #4's capitals supplement.

**Checks run.** New tests: `tariff-source-directory` (6), `currency-pegs` (3), `sanctions-programmes` (3),
`manual-tariff-capture` (3, including the next run reading the recorded line as official and labelled),
two peg cases in `demand-discovery-v5-fx`, rule-rate and logistics-estimate cases in
`demand-discovery-v5-metrics`, a sanctions-flag case in `demand-discovery-v5-assess`, the Andorra scope
case in `customs-territory-aliases`, and the agent hand-check line in `demand-control`. Full suite in one
schema: 145 files, 2,189 passed, 5 skipped, 3 failed — the three local-harness-only failures of E-006.
`tsc --noEmit` and ESLint clean on every changed file. CI on `8e07d05` (run 39024922864): passed. PR #5,
stacked on PR #4. CI's first attempt then failed on both docs-only ledger commits, `4714db8` (run
39025584959, passed on re-run) and `154d582` (run 39026589659), in `country-truth-phase-1h-assessment`
("computed under a different payload"), whose code and test this change does not touch. That file
passes locally in isolation (4 of 4) and in the full suite; CI's logs cannot be read from the agent
session (R-25). Later attempts are on the PR's checks.

### E-022 · 2026-10-18 · Preferential rate scored, US Treasury rates, Singapore saved nightly (in review)

**Owner decisions applied** (18 Oct 2026): D-026 (preferential rate), D-028 (Treasury rates; the
customs-union part is E-023), D-029 (Singapore). D-027 is recorded only.

**Built** on `dd5/tariffs-auto`, stacked on PR #5 (docs/36 §2, §4, §7.1, §10; docs/37 §1, §5a):
- *Preferential rate (D-026).* Policy v6 (`demand-discovery-v5-policy-v6`; no run used it before):
  `duty.score_india_preference` (on). Where the official tariff publishes a preference for India that is
  not a tariff quota and not above the ordinary rate, v5 scores it; the ordinary rate stays beside it and
  the reason says claiming it needs proof of Indian origin; a quota preference is shown, never scored.
  `tariff-semantics.ts` records `is_quota`; `contract.ts` keeps the pack's parsed preferential duty on the
  evidence row; frozen inputs v4 carry the rate basis (`official-duty.ts`, `duty-inputs.ts`,
  `metrics.ts`, `explain.ts`, `run-inputs.ts`).
- *US Treasury reporting rates (D-028).* `src/lib/fx/treasury.ts` reads the Fiscal Data
  `rates_of_exchange` API (public domain, quarterly, amended between quarters after a 10% move). Its
  live format was checked on 18 Oct through the owner's browser and is the fixture (record date
  30 Sep 2026: 168 rows, sha256 `4cfa4df8…53a8`, three amendments effective 15 Oct). 158 descriptions
  map to ISO codes; 10 are left out on purpose (dollarised markets, the euro zone, Cuba's discontinued
  convertible peso, and Syria's pound, whose 15 Feb 2026 amendment from 11,000 to 110 per dollar is a
  redenomination with an unconfirmed ISO code). Each response is kept raw with
  one observation per row, an amendment under its own effective date. A run uses a Treasury rate only
  for a currency the ECB does not publish (or answered 404 for), within 120 days, and fetches the list
  once when none is stored (`fx_treasury_fallback`, `fx_treasury_max_lookback_days`). The Ops panel
  shows the switch and the newest stored day.
- *Singapore saved nightly (D-029).* `src/lib/market-access/providers/singapore-refresh.ts`, swept from
  the worker every ten minutes (outside 03:00–07:00 SGT it reads nothing): once per Singapore day,
  starting before 06:00, it acquires the consolidated First Schedule and its provenance pages, reads
  them with the strict reader and compares the canonical tariff with the saved copy. Unchanged →
  recorded only; no copy yet → imported and activated once it passes qualification (the reader plus
  shape checks: rice not dutiable; liquor, tobacco, motor cars and petrol dutiable; ≥90% of lines
  duty-free; line count within 10% of the release in use); changed → imported and held for review,
  because a saved release records the amendment chain reviewed in code (to S 67/2026);
  `activate_changed_tariff` makes changes active, and a held release activates the next night once it
  is on. Failures: at most 3 a night, 30 minutes apart, the release in use untouched. Every attempt is
  an audit event (`authority_refresh` / `SG_SSO_CUSTOMS_DUTIES`). Switch `market_access.authority_refresh`
  (off), through the audited config API (validated) or `scripts/authority-refresh.ts`
  (`--enable/--disable/--status/--run-now/--acquire-only`); `import-retained-authority-release.ts`
  takes `--family=SG` for a bundle acquired elsewhere. Singapore joins `DESTINATION_ADAPTERS` as a
  retained release and leaves the unconfigured list (connected 57, researched 61, directory 100). A
  retained-release source with nothing imported is now `no_release` in the acquisition (noted in the
  run, not a failure, the run is not partial); before Singapore's first copy its duty comes from its
  published rule and the SSO First Schedule is the agent's pointer. Ops → Demand Discovery v5 shows the
  refresh state.

**Checks run.** New tests: `fx-treasury` (5), `singapore-refresh` (7: window and once-a-night rules,
config validation, qualification, first copy activated and read by the adapter at any hour, unchanged,
changed and held then activated, failures capped and spaced); preference cases in
`demand-discovery-v5-official-duty` (2), `-metrics` (1) and `-run`; `no_release` in
`demand-discovery-v5-tariff-step`; routing, directory and ops-view updates. The affected files (12)
pass together locally. Full suite in one schema, run on this branch with E-023's changes on top: 149
files, 2,215 passed, 5 skipped, 3 failed — the three local-harness-only failures of E-006. `tsc --noEmit`
and ESLint clean on every changed file. CI on PR #6's head `aae6baf` (run 39125655678): passed. The
staging commands below were run as written, apart from the env file, against a throwaway local test
database: `--status`, `--enable` (config version 1, through the audited path), `--run-now` outside the
window (`not_due`, nothing fetched) and `--disable`.

**Next automation wave (open owner decision, proposed here).** Of the 153 markets that needed an agent
for an official duty (E-021), 24 are read automatically after E-023, leaving 129: 40 with a researched
national source that cannot be read in place but could be saved and refreshed on a schedule as D-029
allows (China, the UAE, Türkiye, Mexico, Thailand, Brazil, Egypt, Switzerland and the Philippines among
them), one reader each, largest Indian export markets first; 37 small markets whose official page,
schedule or law an agent can read; 7 licence-pending sources, which stay with agents until a licence is
settled; and 45 with nothing online (Cabo Verde and South Sudan among them).

**Not verified.** Whether the Railway worker can reach `sso.agc.gov.sg`, and the live SSO page against
the reader: the first window run on staging is the live qualification (R-26). A staging run with a
Treasury-converted price.

**Staging after merge** (owner's Claude Code; nothing fetches from SSO until switched on):
1. Deploy; policy v6 and Treasury rates apply to new runs.
2. `npx tsx --env-file=tmp/rw/operator.env scripts/authority-refresh.ts --enable
   --actor-email=<ops supervisor> --changed-by=<admin> --reason="Save Singapore's tariff nightly on
   staging (D-029)"`; after the next window (00:30–04:30 IST) `--status` shows the attempt. If SSO
   refuses the worker, run `--acquire-only --out=<file>` inside the window on a machine that can reach
   it and import the file with `import-retained-authority-release.ts --family=SG`.

### E-023 · 2026-10-18 · Customs-union tariffs read for 24 members (in review)

**Decision applied:** D-028 — a customs union's common tariff counts as its members' official duty
before national exceptions are modelled, labelled and below full quality.

**Sources** (retrieved 18 Oct 2026 through the owner's browser; pinned in
`src/lib/market-access/providers/customs-union-sources.ts`):

| File | Bytes | SHA-256 | From |
|---|---|---|---|
| UEMOA TEC 2022 v4 (PDF, 482 pages) | 2,739,663 | `e7774d3f…c5ae` | UEMOA Commission document centre |
| EAC CET 2022 as updated June 2025 (PDF, 577 pages) | 4,818,693 | `9d894c29…af9f` | East African Business Council library |
| EAC Gazette Vol. AT 1 No. 16, 30 June 2026 (PDF, 122 pages) | 2,034,714 | `555b8fdd…3907` | East African Business Council library |
| EAEU Council Decision No. 80, consolidated (Adilet API JSON, updated 15 Sep 2026) | 5,349,622 | `34724774…ed88` | Kazakhstan's Legal Information System |

The EAC Secretariat's repository did not answer, so both EAC publications came from the EABC's library;
they are the official texts and their checksums are pinned. The EAEU text's editor's note announces
nomenclature amendments (Board Decision No. 43 of 7 Apr 2026, in force no earlier than 1 Jul 2026) that
it did not yet carry.

**Built** on `dd5/customs-unions`, stacked on PR #6 (docs/36 §4, §9; docs/37 §1, §4, §4a, §5, §7, §8):
- Members served: ECOWAS (UEMOA edition, DD column) BF, BJ, CI, GH, GM, GN, GW, LR, ML, NE, NG, SL, SN,
  TG; EAC BI, KE, RW, TZ, UG; EAEU AM, BY, KG, KZ, RU. Not served: Cabo Verde (own Pauta Aduaneira) and
  South Sudan (applies the EAC CET only in part).
- `customs-union-parsers.ts`: UEMOA and EAC PDFs from pdfjs coordinates (columns from each page's header
  row; a continuation page without one uses the last headed page with the same layout; a rate is tied to
  its code row wherever the wrapped description puts it); the Gazette's tables by notice and table, the
  amendment table's new rates by row; the EAEU HTML rows with rate forms and footnote marks. Duty
  remission notices are not read.
- `customs-union-sources.ts` assembles the lines: EAC sensitive items at their Schedule 2 rate, the ten
  amended lines at their new rate, stays as exceptions (Kenya: table III; Uganda: II, IV–VII; tables I,
  VIII and IX, which name states row by row, for every member); EAEU rates under a tariff note as
  exceptions for every member.
- `customs-union-bundle.ts` (deterministic bundle; reading checks every file against the pins, the line
  count and each line), `customs-union-market-access.ts` (the member's result names the union and what is
  not modelled for it; no duty where the release records the member applies a line differently; nothing
  after the EAC release's 30 June 2027), `customs-union-service.ts` (shared release lifecycle; a member
  of a union without an active release is `no_release`). 24 adapters (connected 81, researched 48,
  directory 89); members keep their national source as the agent's pointer.
- v5: `quality.official_common_tariff` 0.8, inside policy v6 (no run has used v6); the reason reads
  "under the <union> common external tariff; this market's own exceptions are not checked".
- `scripts/build-customs-union-bundle.ts` builds a bundle from the official files without a database;
  `import-retained-authority-release.ts` takes `--family=EAEU|ECOWAS|EAC`.

**Real files, read locally (18 Oct):**
- ECOWAS: 380 tariff pages, 6,380 lines (0% 102, 5% 2,368, 10% 1,469, 20% 2,289, 35% 152), no conflicts.
  The text's only other ten-digit code (8701.20.10.00) appears inside descriptions.
- EAC: Schedule 1 5,961 lines — every eight-digit code row in the text — and Schedule 2 50 (all 50 "SI"
  resolved); 10 amendments, all on Schedule 1 lines; 1,056 codes named in stays (1,055 on Schedule 1
  lines). Duties: 5,911 ad valorem, 50 "the higher of" mixed.
- EAEU: 13,007 lines: 11,229 ad valorem, 503 euro per unit, 1,000 "not less than", 34 added, 214 set only
  by a note, 27 other forms (kept, unparsed); 1,212 carry a tariff note.
- Bundles, rebuilt byte-identical: ECOWAS 2,050,473 bytes `ce0cc831b182562414776d930f3f06892f782db23bc5afe8a1a48ff8ced38454`;
  EAC 5,198,660 bytes `ae02dfdf82348b279940163f1cd02fa1db44119a7e2ebbe539e8a0c4f16f02d3`; EAEU 851,709 bytes
  `16d9ceb360f67f0b10ce597f7ecb84f319077b1b44ce44e931ef4e9861d338a1`.
- Read back through the market-access code at 18 Oct 2026, for example: Senegal and Nigeria rice 10%,
  shirts 20%, medicines 0%; Kenya and Tanzania tea 35%, cotton yarn 10%, shirts 25%, rice not scored
  (Gazette stay); Russia and Kazakhstan tea 0%, cotton yarn 5%, cotton T-shirts €1.75/kg, medicines and
  auto parts not scored (tariff notes), rice split across lines with different duties.

**Checks run.** New tests: `customs-union-parsers` (7), `customs-union-pack` (4). Updated:
`market-access-providers`, `market-access-job-routing`, `tariff-source-directory`,
`green-wave-authority-pack`. Full suite in one schema: 149 files, 2,215 passed, 5 skipped, 3 failed — the
three local-harness-only failures of E-006. `tsc --noEmit` (scripts included) and ESLint clean on every
changed file. CI on PR #7's head `b19c33e` (run 39125800182): passed. The three import commands below
were run as written, apart from the env file, against a throwaway local test database with the
delivered bundles: each NEW_RELEASE then UNCHANGED, and active. Read back from those releases at 18 Oct
2026: Senegal rice 10%, Nigeria cotton shirts 20%, Kenya black tea 35%, Tanzania rice not scored (stay),
Russia black tea 0%, Kazakhstan cotton yarn 5%, Russia medicines not scored (tariff notes).

**Staging after merge** (owner's Claude Code, after PR #6's steps). The three bundles are in
`~/Downloads/cleartrade-union-bundles/` on the owner's Mac (delivered 18 Oct; SHA-256 checked there); a
rebuild from the official files in `~/Downloads` with `scripts/build-customs-union-bundle.ts` gives the
same bytes. For each union, with `D=~/Downloads/cleartrade-union-bundles`:
```
npx tsx --env-file=tmp/rw/operator.env scripts/import-retained-authority-release.ts --family=ECOWAS --file=$D/cleartrade-union-ECOWAS-uemoa-tec-2022-v4.zip --expect-sha256=ce0cc831b182562414776d930f3f06892f782db23bc5afe8a1a48ff8ced38454 --release=uemoa-tec-2022-v4 --reference-date=2024-09-01 --retrieved-at=2026-10-18 --source-url=https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf --actor-email=<ops supervisor> --activate
npx tsx --env-file=tmp/rw/operator.env scripts/import-retained-authority-release.ts --family=EAC --file=$D/cleartrade-union-EAC-cet-2022-ln160-2026.zip --expect-sha256=ae02dfdf82348b279940163f1cd02fa1db44119a7e2ebbe539e8a0c4f16f02d3 --release=eac-cet-2022-jun2025-ln160-2026 --reference-date=2026-06-30 --retrieved-at=2026-10-18 --source-url="https://eabc-online.com/download/eac-common-external-tariff-version-2022-as-updated-june-2025/?wpdmdl=11694" --actor-email=<ops supervisor> --activate
npx tsx --env-file=tmp/rw/operator.env scripts/import-retained-authority-release.ts --family=EAEU --file=$D/cleartrade-union-EAEU-adilet-2026-09-15.zip --expect-sha256=16d9ceb360f67f0b10ce597f7ecb84f319077b1b44ce44e931ef4e9861d338a1 --release=adilet-H21EV000080-2026-09-15 --reference-date=2026-09-15 --retrieved-at=2026-10-18 --source-url=https://adilet.zan.kz/rus/docs/H21EV000080 --actor-email=<ops supervisor> --activate
```
Each import runs twice and must report the second as UNCHANGED. Then run a product with a member market
(Senegal or Kenya): its duty reads "under the … common external tariff".

### E-024 · 2026-10-19 · Archetype runs scripted; #4–#7 landed on staging by PR #8 (in review)

**Staging state.** On 18 Oct the owner's local Claude Code stopped at step 1 of the status-page prompt:
`gh` is not installed on the owner's Mac, and nothing was merged or run. Read from GitHub on 19 Oct:
`staging/railway` still at `76fb4a7`; PRs #3–#7 open and mergeable, CI passed on each head, and each
head contains the one before it (`compare` behind 0), so each merge lands exactly the code CI tested.
At the owner's request ("complete it, either by another prompt or by yourself") the agent tried to merge;
the session's safety check refused it (a person must merge), and nothing changed. The owner then merged
all five in the browser at 04:18–04:19 UTC, but #4–#7 still had their stacked bases, so each merged into
the branch of the PR before it and only #3 reached `staging/railway` (`8c5b9ff`, deployed). PR #8
(`dd5/customs-unions` → `staging/railway`, head `9496b15`) lands #4–#7 in one merge; the merged tree is
the one CI tested on PR #7. After it, the prompt continues from step 5, whose commit check catches a
partial landing like this one.

**Owner decisions** (19 Oct): D-030 (every remaining market automated, cluster by cluster, in the E-022
order); D-027's reading confirmed. The UNCTAD and WTO permission requests were redrafted for the owner to
send, to trains@unctad.org and idb@wto.org, the contacts the WITS and WTO terms give.

**Built** on `dd5/archetype-runs`, from PR #7's head (PR #9, into `staging/railway`; docs/36 §10 step 7):
the portal has no screen for adding a product (products come from sign-up or the seed scripts), so the
D-003 runs could not be set up by hand.
- `src/lib/demand-discovery-v5/archetype-runs.ts`, `scripts/dd5-archetype-runs.ts`. `start
  --actor-email=<agent, ops supervisor or admin>` creates or reuses "[TEST] DD5 archetypes": a test
  exporter made paid by a manual membership the named account grants (`grantManualMembership`, 90 days,
  at the configured monthly plan price, no money moved, audited), with one product per archetype in
  `PHASE_1_GATE_POLICY_V1` (rice 100630, brassware 741810, carpets 570110). It proposes and confirms each
  HS 2022 code as that account with `proposeClassification` / `confirmClassification`, the portal's own
  services, so the confirmation is audited and starts v5 by itself. Repeating it confirms nothing again
  (a confirmed code without a run gets one, trigger `manual`); `--rerun` starts fresh runs. `status`
  shows each product's newest run and, once it has finished, markets by status, how each market's duty
  was found (official, a union's common tariff, agent-read, published rule, estimate, none), the top N
  and the docs/36 §8 comparison with India's real destinations. Refuses production.
- `src/lib/demand-discovery-v5/calibration-report.ts`: the comparison itself, moved out of
  `scripts/dd5-compare-top10.ts` (unchanged output) so both scripts share it.

**Checks run.** New test `demand-discovery-v5-archetype-runs` (4: duty basis, staff only, exporter,
membership, products and confirmations with their audit trail, repeat safety, status). The 13 related
files (v5, Phase 1 gate, product classification, membership) pass together locally: 181 tests.
`tsc --noEmit` and ESLint clean.

**Staging after merge** (owner's Claude Code, after PR #8 and the status-page steps):
`npx tsx --env-file=tmp/rw/operator.env scripts/dd5-archetype-runs.ts start
--actor-email=atlas-ops@staging-atlas.invalid`, then the same script with `status` until all three runs
have finished; each archetype's `comparison.verdict` is the docs/36 §8 check.

### E-025 · 2026-10-19 · Cluster 1: seven markets read from four retained tariff schedules (in review)

**What and why.** The first cluster of D-030, in E-022's order (accepted by the owner): the researched
national sources, largest Indian export markets first. The UAE, China and Brazil are the largest Indian
export markets among the researched sources whose official tariff can be downloaded whole; the same
files serve Bahrain (the GCC common tariff) and Argentina, Paraguay and Uruguay (the Mercosur common
external tariff). Connected markets 81 → 88; researched, not automatable 48 → 41; directory 89,
unchanged (`tests/tariff-source-directory.test.ts`).

**Sources.** Downloaded through the owner's built-in browser on 19 Oct with the owner's permission for
the batch ("Yes, download them"), copied into the session and pinned by SHA-256 and size
(`tariff-schedule-sources.ts`): Dubai Customs' 12-digit GCC unified tariff of 23 Jul 2025
(`IntegratedCustomsTariff.pdf`, 13,777,457 bytes, `f1be9097…`); the UAE's schedule under the India–UAE
CEPA, Annex 2B (`Schedule-of-UAE.pdf`, as circulated by the Council for Leather Exports; the Commerce
Ministry's own page no longer resolves; 1,445,387 bytes, `b9cd37fd…`); CAMEX's workbook of Annexes I–X
of Gecex Resolution 272/2021, updated 5 Oct 2026 (1,439,408 bytes, `37954a6f…`); China's 2026 import and
export tariff (70,026,277 bytes, `76af4db0…`) and Annex 1 of the 2026 adjustment plan (517,981 bytes,
`0600b251…`). Three more Chinese files of the batch (the plan, its Annex 4 line changes and Annex 6 FTA
rates) were read for context and are not used.

**Rights check (D-030).** Each release records its basis in the bundle manifest (`rights_basis`, which the
reader requires) and in the import record: UAE Federal Decree-Law No. 38 of 2021, Art. 3(2) (official
documents, such as laws, regulations, resolutions and international conventions, are not protected);
Brazil's Law 9.610/1998, Art. 8(IV) (texts of treaties, laws, decrees, regulations and other official
acts); China's Copyright Law (2020), Art. 5 (resolutions, decisions and orders of State organs, other
administrative documents, mere information about facts). Tariff facts only are used; the files are
retained privately as provenance. Dubai Customs' own website terms were searched for and not found (R-29).

**Owner decision** (19 Oct): D-031, scoring like an agent's reading.

**Built** on `dd5/cluster-1-schedules`, from PR #9's head (PR #10, into `staging/railway`):
- `src/lib/market-access/providers/tariff-schedule-readers.ts` (the GCC tariff and the CEPA schedule by
  measured column positions, each duty tied to the nearest code row; China's book with provisional △,
  footnotes resolved on their page, the AP rate among wrapped agreement entries, split glyphs joined;
  China's Annex 1; the CAMEX workbook by column names), `tariff-schedule-sources.ts` (the four releases
  and the assembly of the lines a market pays), `tariff-schedule-bundle.ts` (deterministic bundle; every
  official file re-hashed at import), `tariff-schedule-market-access.ts` (the duty on the day asked, dated
  rates, India's preference, validity), `tariff-schedule-service.ts` (import, activation, look-up,
  `no_release` before import); seven adapters in `job-handlers/market-access.ts`; three national code
  systems in `contract.ts`; pointers in `tariff-source-directory.ts`.
- v5: policy v7 adds `quality.official_schedule_read` = 0.9 (a new version because v6 was live on staging,
  E-026); a schedule read is marked in `run-inputs.ts` and carried by `official-duty.ts`,
  `duty-inputs.ts`, `metrics.ts` and `assess.ts`; `explain.ts` says "(read from <the tariff>; trade
  remedies are not checked)"; the archetype status counts `schedule_read`.
- `scripts/build-tariff-schedule-bundle.ts`; families GCC, MERCOSUR, CN and BR in
  `scripts/import-retained-authority-release.ts`.
- Two defects in existing code, fixed: (1) v5 read an ordinary official duty only from its expression
  text, so a duty published in words (the EAEU's "0,03 евро за 1 кг", China's "1 元 / 千克") never
  converted and no exchange rate was fetched for it; the pack's own parsed duty now comes first, as it
  already did for preferences (`official-duty.ts`, `run-inputs.ts`). Until this lands, staging scores
  EAEU duties per kilogram as estimates, although docs/37 §4a said they were converted. (2) Where lines
  beneath one HS6 carry the same duty but different India rates, the first line's rate would have been
  stated; now none is.

**What the releases read** (build output from the official files): GCC 13,449 lines, of which 117
PROHIBITED or special-goods lines and 3 without a printed rate are not scored; India's CEPA rate on
11,650 lines for the UAE, 88 lines excluded. Mercosur 10,516 lines; 1,618 BK/BIT lines not scored.
China 8,972 lines: 600 whole-line provisional rates, the AP rate on 2,440, 31 duties per kilogram or
square metre, 3 "the lower of" duties, 335 provisional rates for part of a line said as notes. Brazil
10,516 lines: Annex II's rate on 9,404, dated exception rates on 1,517, notes on 261.

**Bundles.** Two builds of each, with the file arguments in either order, gave the same bytes:

| Release | Identifier | Bytes | SHA-256 |
|---|---|---|---|
| GCC | `gcc-ict-dubai-2025-07-23-uae-cepa-annex2b` | 15,447,069 | `b978a31d78d039da28970fd05b16194121ae78afc6a87ab0a204d972dde3fb51` |
| MERCOSUR | `camex-tec-2026-10-05` | 1,620,953 | `3b6c6d559945d530994e1b0925c397ee553b912d2d538bea6ccc5ccf31575263` |
| CN | `cn-tariff-2026` | 70,698,823 | `0e9c7bf7c7a8577810d94ba69e19dfb98a7cb5cc0e2010eca93631b57a692b43` |
| BR | `camex-applied-2026-10-05` | 1,662,998 | `f60b7eefdc841b3541e54d6460c9772b8e789553075f541eb466d6a5c5e44e38` |

**Local import check** (a fresh local database with every migration; the real import command with
`--expect-sha256` and `--activate`): each release imported as `NEW_RELEASE`, active, and its repeat as
`UNCHANGED` (same release). Read back for Indian goods on 19 Oct 2026:

| Market | Rice 100630 | Brassware 741810 | Carpets 570110 | Black tea 090240 | Cotton yarn 520512 | Cotton shirts 620520 |
|---|---|---|---|---|---|---|
| AE | 0% (India 0%) | 5% (India 0%) | 5% (India 0%) | 0% (India 0%) | 5% (India 0%) | 5% (India 0%) |
| BH | 0% | 5% | 5% | 0% | 5% | 5% |
| AR, PY, UY | — (4 lines, different duties) | 16% | 35% | 9% | 18% | 35% |
| CN | 65% (out-of-quota) | 7% | 6% | 15% (India 7.5%) | 5% (India 3.5%) | 6% (India 3%) |
| BR | — (4 lines, different duties) | 14.4% | 35% | 9% | 18% | 35% |

**Checks run.** New test `tariff-schedule-pack` (16 tests): the five readers on layouts measured from the
official files; the assembly rules; the bundle (deterministic; another file, a changed line count,
edited lines, a swapped official file and a missing rights basis all refused); import, activation and
look-ups for China, the GCC and Brazil (`no_release` first, the validity window, dated rates, India's rate
by CEPA year, lines with different India rates); v5 end to end (a stored snapshot becomes an official
duty marked as a schedule read, scored at 0.9 with its sentence; a duty in yuan per kilogram converted);
the real releases' configuration. `demand-discovery-v5-official-duty` gains a test for a duty published
in words. Updated for the seven markets: routing (six routes added; AE and BR leave the unconfigured
list), provider lists, the adapter count (88 → 95), directory counts and pointers, archetype status, the
policy version. `tsc --noEmit` clean; ESLint clean on the 26 changed files. Full suite locally: 2,240
passed, 5 skipped, 3 failed, the three that fail only in this local harness (`market-scan-requests`,
`pilot-e2e`, `staff-provisioning`), as before. CI passed on PR #10 at `4cb27b7` (run 39238917895: Prisma
validate, typecheck, lint, the full test suite, the production build and the Docker build).

**Staging** (owner's Claude Code, after PR #10 merges): build each bundle from the files already in the
owner's `~/Downloads/cleartrade-tariff-sources/cluster-1/` with `scripts/build-tariff-schedule-bundle.ts`,
confirm the printed SHA-256 against the table above, and import it with
`scripts/import-retained-authority-release.ts --family=<GCC|MERCOSUR|CN|BR> --expect-sha256=<that value>
--activate` and `--env-file=tmp/rw/operator.env`.

### E-026 · 2026-10-19 · Staging: archetype runs finished; carpets pass, rice and brassware are calibration failures

**Merged.** The owner merged PR #8 at 04:57:45 UTC and PR #9 at 04:57:59 UTC (`staging/railway` at
`96c4176`). The owner's Claude Code then ran `scripts/dd5-archetype-runs.ts start` and `status` (checks
at 10:48, 10:58 and 11:08 IST; final output exit 0, staging, database fingerprint `62587019d354`,
exporter `cmveszmdh0000ue64agqpuzy6`; `comparison_error` null for all three):

| | Rice 100630 | Brassware 741810 | Carpets 570110 |
|---|---|---|---|
| Run | `cmveszorv000eue640z3rbw2v` | `cmveszqy2000uue64qe42f9wm` | `cmveszsr3001aue64l381xl0m` |
| Status (finished, UTC) | partial (05:23:41) | completed (05:28:51) | completed (05:34:07) |
| Markets by status | ranked 214, not_enough_data 3, excluded 1 | ranked 196, not_enough_data 13, no_recorded_demand 8, excluded 1 | ranked 188, not_enough_data 23, no_recorded_demand 6, excluded 1 |
| Duty basis | official 47, common tariff 14, rule 8, estimate 122, none 26 | official 19, common tariff 24, rule 8, estimate 138, none 28 | official 20, common tariff 19, rule 8, estimate 144, none 26 |
| Common tariffs used | ECOWAS 14 | EAEU 5, EAC 5, ECOWAS 14 | EAC 5, ECOWAS 14 |
| Overlap with India's real top 10 | 3/10 | 4/10 | 8/10 |
| Verdict | calibration_failure | calibration_failure | pass |
| Missed (rank in run) | IR 112, GN 81, IQ 48, BJ 43, YE 40, TG 30, CI 19 | ET 172, MU 67, SA 51, NP 36, GB 13, CA 11 | SE 21, FR 13 |

Run top 10: rice US, GB, SA, AU, JP, CA, OM, AE, DE, QA; brassware US, DE, AU, IT, NL, CN, FR, KR, AE,
JP; carpets US, CH, AE, JP, SG, GB, CA, IT, AU, DE. India's real top 10: rice SA, IR, IQ, BJ, AE, GN, YE,
US, TG, CI; brassware US, NP, GB, CA, SA, AE, DE, AU, ET, MU; carpets US, DE, AU, CA, GB, SE, IT, AE,
CH, FR. No duty was agent-recorded.

**Reading** (docs/36 §10 step 7: a calibration failure is a finding, starting from the missed markets).
Rice ranks high-income markets first, while India's real rice buyers in West Africa and the Gulf are
ranked 19th to 112th; brassware misses Nepal, Ethiopia and Mauritius, with the UK and Canada just
outside the top 10. The customs-union releases are in use; rice gets ECOWAS only, as E-023 found (EAC
rice is stayed, EAEU rice spans lines with different duties). Not yet known: why the rice run is
`partial`. Requested from the owner's Claude Code, read-only: the rice run's job result and its failed
tariff outcomes; the policy version and hash each run used and whether staging stores a v5 policy; the
metric scores of the missed markets and of each run's top 3. No scoring change before the owner sees
the options (R-30).

**Singapore.** `market_access.authority_refresh` is on (actor `atlas-ops@staging-atlas.invalid`, first
release activated automatically, a changed tariff held for review, 3 attempts 30 minutes apart); no
attempt yet at 15:30 IST; the first window opens at 19:00 UTC (00:30 IST on 20 Oct). The step 11 check
of `/ops/discovery` is still the owner's.

### E-027 · 2026-10-19 · Calibration investigation (read-only); Andorra no longer fails a run (in review)

**Investigation** (owner's Claude Code, read-only on staging: guard values and database identity checked,
fingerprint `62587019d354`, every query in a `READ ONLY` transaction, nothing written; requested in E-026):
- **Why rice is `partial`.** One cause: Andorra's look-up `failed` (provider `eu_taric`, reason "Some
  details need attention before this can be saved."). Andorra applies the EU tariff to HS chapters 25–97
  only; rice is chapter 10, and the TARIC service refuses it by design (`outside_customs_union`, already
  tested in `customs-territory-aliases`). Andorra was acquired in the brassware and carpets runs. The rest
  of the rice run: 79 look-ups acquired, Singapore `no_release`, both Comtrade steps used, no ECB fetch
  failed. The job's notes are kept under `result.missing`.
- **Scoring identity.** All three runs: `demand-discovery-v5-policy-v6`, policy hash
  `fa51be0c05c734cefe5ceeaa6651fcfb7157474fc791679ec685b96d4550e658`. Staging has no
  `demand_discovery.v5` config row in any state, so runs use the policy in the code (v7 from PR #10).
- **The missed markets** (scores 0–100). Rice: demand is high (84–90; Iran 59.6), and they lose on price
  headroom (Benin 8.4, Guinea 3.5, Iraq 44.3), openness (Iran 0.7, Guinea 4.4), country risk (Iran and
  Iraq 20, Yemen 0), logistics (30–52) and duty (the ECOWAS members 60, a 10% rate). Brassware: price
  headroom 0 for the UK and Saudi Arabia, 7 for Mauritius, 16.2 for Nepal; openness 1.1 for Nepal, 11.8
  for Mauritius. The test products have no price or capacity, so exporter fit is empty and every run is
  scored on 90 of 100 points; brassware stability is missing everywhere (3 growth rates, 4 needed).
- **Reading.** Two metrics count India's own success against a market. Openness, `100 × (1 − HHI)`, is
  lowest where India itself supplies most of the imports. Price headroom compares the market's typical
  price with India's median export price across all markets, so a market where India sells at the local
  price (West African rice) or sells a niche above the market's average (UK brassware) scores near zero.
  Country risk, logistics and duty reflect real costs of those markets and are not in question.

**Fixed** on `dd5/acquisition-not-covered`, from PR #10's head (PR #11): a source that refuses a product
outside its coverage for a market (`outside_customs_union`) is recorded as `not_covered`, not `failed`, so
the run is not degraded and says the market's own tariff applies there. A validation error's reason now
carries what its fields say instead of the generic message. The run's tariff notes are one function,
`summarizeTariffOutcomes` (`tariff-step.ts`).

**Checks run.** `demand-discovery-v5-tariff-step` (+2: not covered, and only a failure or timeout
degrades), `customs-territory-aliases` (+1: the real TARIC adapter records Andorra's rice as not covered),
with `country-truth-tariff-acquisition`, `customs-union-pack` and `tariff-schedule-pack`: 38 tests pass.
`tsc --noEmit` and ESLint clean.

**Next.** A read-only export of the three runs' assessments to the owner's Downloads (outside the
repository), so each scoring option can be re-scored on the real runs before the owner chooses (R-30).

### E-028 · 2026-10-19 · Cluster 1 on staging; the archetypes re-scored; scoring v8 (in review)

**Merged.** PR #10 at 12:49:11 UTC (`d2455ba`) and PR #11 at 12:59:00 UTC (`1ecac58`), by the owner.

**Cluster 1 on staging** (owner's Claude Code, before PR #11): guard values staging; `staging/railway`
at `d2455ba` deployed to both services (`SUCCESS`, 12:49Z) and `/api/health/ready` ready. The four
bundles were built on the owner's Mac from the files in `~/Downloads/cleartrade-tariff-sources/cluster-1`
and each SHA-256 equalled E-025's, so the build is reproducible across machines. Imports (staging,
fingerprint `62587019d354`): GCC `cmvf9ej460001uemer7yyjhyo`, MERCOSUR `cmvf9eq1l0001uenbf8t5zra5`, BR
`cmvf9ew1l0001ueo22x6eqblz`, CN `cmvf9f4ve0001ueoq927bm5ck`; each `NEW_RELEASE`, active, its repeat
`UNCHANGED`. No runs started, no config changed. Connected markets on staging: 88.

**Calibration export** (owner's Claude Code; guard values and database identity checked, every query in
one `READ ONLY` transaction, nothing written, no secrets printed):
`~/Downloads/cleartrade-calibration/archetype-assessments-2026-10-19.json`, 3,955,624 bytes, SHA-256
`c7d7e269498c1ab5bab44dc9cd6a546720c7154f158d3035f6e17fcf416ea353`: every assessment of the three runs
with its score breakdown, and the comparison with India's top 10 and top 20 (top 20: rice 7, brassware
10, carpets 16). Copied into the session through the desktop bridge and checked by hash.

**Re-score.** Re-scoring the stored metrics reproduces every stored rank of the three runs exactly. India's
real top 10 within the run's top 10 (rice / brassware / carpets; 5 passes):

| Scoring | Rice | Brassware | Carpets |
|---|---|---|---|
| Policy v7 (today) | 3 | 4 | 8 |
| Openness among India's competitors | 2 | 5 | 8 |
| No price penalty where India has ≥ 10% | 3 | 5 | 8 |
| Both | 2 | 5 | 8 |
| Both, and India's sales (10 points; price headroom 5, market size 15) | 5 | 7 | 10 |

India's sales were approximated as the stored share times the stored imports (the code uses India's
exports over the market-size years); with ±25% noise on them, rice stayed at 5 in 39 of 40 draws, and a
floor of $1 million or $10 million instead of $100,000 did worse. Under the last option the rice top 10 is
US, SA, GB, QA, AU, AE, BJ, CA, SG, CI; brassware gains GB (4th) and NP (9th); carpets equals India's
top 10. Iran, Iraq and Yemen stay out on payment risk. The owner chose it (D-032).

**Built** on `dd5/scoring-v8`, from `staging/railway` at `1ecac58` (PR #12): policy v8 (`points`, `parts`,
`prices.proven_share_percent` 10, `openness.exclude_india`, `india_sales.floor_usd` $100,000; checked by
`assertPolicy`); `metrics.ts` (`averageIndiaSalesUsd`, `scoreIndiaSales`, the price floor with the share
it rests on, openness over India's competitors with India's share and the all-supplier HHI kept beside
it); `assess.ts` (India's sales over the same years and series as the foothold; the largest across the
markets); plain-language sentences (`explain.ts`); the market page lists "India's sales here"; docs/36
§4 and §5.1. Earlier runs keep their stored scores; an old breakdown shows only the measures it has.

**Checks run (agent workspace, 22 Oct 2026).** `tsc --noEmit` clean. ESLint clean on the 9 changed code and
test files. The 16 Demand Discovery, tariff and gate test files (`demand-discovery-v5-*`, `demand-control`,
`phase-1-gate`, `money-format`, `manual-tariff-capture`, `tariff-schedule-pack`, `customs-union-pack`): 197
passed, 0 failed, under the local database harness. The full suite runs in CI on the PR.

**Staging after merge.** Re-run the three archetypes (`scripts/dd5-archetype-runs.ts start --rerun`, then
`status`); these runs also use cluster 1's tariffs and the Andorra fix.

### E-029 · 2026-10-22 · Regional demand for the US (D-033), PR A

**Objective.** Stage 2 of the product order for the pitch on 24 Oct: where inside a v5 market the
product's imports arrive, starting with the US. docs/38 §1.

**Sources verified today.** The Census Bureau's `intltrade/imports/statehs` and `porths` variable lists
(STATE or PORT/PORT_NAME, I_COMMODITY at HS2/4/6/10, CTY_CODE, GEN/CNT/VES/AIR values and weights,
YEAR, MONTH); a request without a key is refused ("A valid key must be included with each data API
request"), so the key is required (D-033). HMRC's importer file (`importers2608.zip`, 4,541,202 bytes,
SHA-256 `68a53b84d61cedfe30e8b5849d9cb3184ed5eaad768aca9babc483ed0aa4f46b`, 107,633 lines: period, line
number, name, five address lines, postcode, up to 50 eight-digit codes; 86 traders list a 570110 code
for Aug 2026) and ISED's Canadian Importers Database 2023 file list (licence `ca-ogl-lgo`) were
checked for the next PR; ISED's site answered 503 ("urgent maintenance") on 22 Oct, so its files are
not downloaded yet.

**Branch.** `dd6/regional-demand-us`, stacked on `dd5/scoring-v8` (PR #12).

**Files.** `prisma/schema.prisma` and migration `20261022100000_regional_demand_runs` (job type
`regional_demand_discovery`, enum `RegionalDemandStatus`, table `RegionalDemandRun`);
`src/lib/regional-demand/{census,service}.ts`; `src/lib/job-handlers/regional-demand.ts` (registered in
`job-handlers/index.ts`; costed in `billing/costed-work.ts`); the hand-off in
`job-handlers/demand-discovery-v5.ts`; `GET`/`POST /api/v1/market-assessments/:id/regional-demand`; the
market page (`page.tsx`, `MarketDetail.tsx`, new `RegionalDemand.tsx`); `scripts/regional-demand.ts`;
`tests/regional-demand-census.test.ts` (8) and `tests/regional-demand.test.ts` (7); docs/38 (new), docs/28
and `.env.example` (`CENSUS_API_KEY`), AGENTS.md (doc map).

**Checks run (agent workspace).** `tsc --noEmit` clean. ESLint clean on the 13 changed or new code and test
files. New tests: 15 passed. Full suite under the local database harness: 2,260 passed, 5 skipped, 3
failed — the same three local-harness-only failures as on earlier PRs (`market-scan-requests`,
`pilot-e2e`, `staff-provisioning`). CI runs the canonical suite on the PR.

**Not verified.** No live Census answer has been read: the agent session has no key and cannot reach
api.census.gov. The reader follows the published variable lists; the first staging run after the key
is set is the first real read (R-32).

**Staging after merge (owner).** Set `CENSUS_API_KEY` on the staging web and worker services, then run
`scripts/regional-demand.ts request --run=<carpets v5 run> --actor-email=<ops supervisor>` and `status`.

### E-030 · 2026-10-22 · Real buyers from official importer lists (D-033, D-034), PR B

**Objective.** Stage 3 of the product order for the pitch on 24 Oct: named importers of the product in
the UK (HMRC) and Canada (ISED), and the UK and Canada regional views built from the same lists.
docs/38 §1.2 and §2.

**Branch.** `dd6/buyers-uk-ca`, stacked on `dd6/regional-demand-us` (PR #13).

**Files.** Schema and migration `20261022120000_official_importer_lists` (`ImporterListRelease`,
`ImporterListEntry` with GIN indexes on the HS6 headings and origin pairs, `Buyer.source_entity_key`);
`src/lib/buyer-discovery/{importer-lists,importer-list-service,service,uk-regions}.ts`; the
`buyer_discovery` handler (registered; it had none, E-001); `src/lib/regional-demand/importer-regions.ts`
and the GB/CA regional sources; the hand-off of GB/CA top markets in the v5 handler; `POST
/api/v1/exporters/:id/buyer-discovery`; the agent's Buyers tab form (`FindBuyersForm.tsx`) and the buyer
control (`buyer-control.ts`, `BuyerDiscoveryControl.tsx`) reading the new model's components, place,
reason and address; the market page (importer-count regions; the buyer section now says how many
importers were found and that the agent reviews them — exporters cannot run buyer discovery, docs/11
§7, so the old "Find buyers" link led to a search that refused them); `scripts/import-importer-list.ts`,
`scripts/buyer-discovery.ts`; `scripts/demo-account.ts` (a staging exporter login, an assigned agent
login, a dated 30-day manual membership and the three archetype products with confirmed codes, which
start v5; the password comes from `DEMO_PASSWORD` in the operator's shell and is never printed); tests
`importer-lists.test.ts` (5), `buyer-discovery.test.ts` (8), and the regional tests updated; docs/38.

**Real file, local database.** `importers2608.zip` (SHA-256 `68a53b84…f46b`) imported with the real script
into a fresh local database: NEW in 30 s (release of 106,285 importers, period 2026-08, 167 with only
chapter codes, none without a region), then UNCHANGED. Buyer discovery for HS 570110 in GB: 86 importers
found, 86 buyers created in 1.5 s; sanctions not screened (no sanctions lists in that database, so every
buyer carries the flag). Regions: London 52, South East 11, Scotland 7, South West 5, East of England 4,
North West 4, Yorkshire and The Humber 2, West Midlands 1.

**Canada.** Not done: ISED's site answered 503 ("urgent maintenance") all day on 22 Oct, so the CID files
could not be downloaded and their layout is unknown. Importing a Canadian list is refused with that
reason; Canada's regional view and buyer discovery say no list is imported.

**Checks run (agent workspace).** `tsc --noEmit` clean. ESLint clean on every changed or new code and test
file. New and updated tests: 56 passed (with `buyer-control.test.ts`). Full suite under the local
database harness: 2,273 passed, 5 skipped, 3 failed — the same three local-harness-only failures as on
earlier PRs. The demo-account script was run twice against the local check database (created, then
reused unchanged), and an assigned agent's request found the 86 UK carpet importers and read them back
through the agent's buyer control (specialist rug importers score 100; John Lewis, with 9 of its 334
codes in chapter 57, scores 58). CI runs the canonical suite on the PR.

### E-031 · 2026-10-30 · Plan for stages 1–3 in every market; owner decisions D-035 to D-038

**Verified today (agent workspace, GitHub API).** `staging/railway` = `95e9ac6` (the merge of PR #14);
`master` = `6d4733cb`, unchanged since the audit; staging is 157 commits ahead and 0 behind
(`GET /repos/…/compare/master...staging/railway`). CI passed on PRs #9–#14; nothing has merged since 22
Oct. The UK town-count fix (`0e0a369`) was committed after PR #14 merged and is not on staging: PR #15.
The demo-setup report (staging steps of 24 Oct) never came back, so the first live Census read (R-32),
sanctions coverage and the scoring-v8 re-run (R-30) are still unverified.

**APIs already linked.** `COMTRADE_API_KEY` configured on staging; `CENSUS_API_KEY` in the code, its
staging value unconfirmed; `ANTHROPIC_API_KEY` in the code (rationale writer) but not configured on
staging (docs/26 §B). The Claude API's web search costs $10 per 1,000 searches plus tokens
(platform.claude.com, web search tool page, read today); it is the planned engine for buyer web
discovery (D-035).

**Sources checked for stages 2–3** (pages opened today): Statistics Canada publishes imports by
province only for the 12 NAPCS sections (open.canada.ca dataset ceca9f02…); HMRC's regional trade
statistics allocate trade to 12 regions by employee location, at SITC division (gov.uk explanatory
notes, Q1 2023); French customs' regional and departmental files use CPF4 product groups, NC8 being
withheld for confidentiality (DGDDI dataset description); Natural Earth's admin-1 layer covers all but
a few tiny countries and its maintainers say about half its ISO codes are missing; Brazil's SECEX
register of importing companies ended in 2023 over privacy, last file 2021 (Trase); DGCI&S does not
disseminate company-wise or IEC-wise data (its data dissemination policy); Volza lists 249 export
partner countries for India without naming its source.

**Plan.** A claude.ai doc, "ClearTrade stages 1–3: plan for all 218 markets": per-market source tiers
for regional demand (official regional imports, importer concentration, a labelled regional baseline)
and buyers (official importer lists, bought shipment records, web discovery for every market); the
stage 1 finish list (retire v4, no agent-entered tariffs, a v5-only gate, automatic refresh of every
input, re-runs on new data, calibration on 15–20 products, exporter-fit prompts, a labels check); and
a timeline with two streams: stage 1 finished 20 Nov, a regional view in every market 4 Dec, buyer
candidates in every market 8 Jan, all three stages 15 Jan 2027 (late January to mid-February with one
stream). Estimates, not commitments.

### E-032 · 2026-10-30 · Earlier engines retired; agent-entered tariffs closed (D-036, D-037) (in review)

**Branch.** `dd5/v5-only`, from `staging/railway` at `95e9ac6`.

**Engines (D-036).** `src/lib/demand-discovery-v5/earlier-engines.ts`: `assertEarlierEnginesRetired`
refuses in staging and production (`PREREQUISITES_NOT_MET`, blocker `RETIRED: …`) before anything is
written. Called first by `requestMarketScan`, `approveMarketScan`, `startMarketDiscovery`,
`enqueueGlobalCountryScreening`, `requestDeepCountryTruthFromScreening`, `requestCountryTruthDiscovery`
and `scripts/verify-warehouse-discovery.ts`. `POST /api/v1/discovery-runs` goes to v5 or is refused
with v5's reason; the warehouse-engine path (and its `demand_discovery` job) is removed from it. The
UI starts nothing on the earlier engines: the scan-request queue (`MarketScanQueue.tsx`) is deleted
from the ops and agent pages; the agent's Demand Discovery panel loses "Request detailed analysis" and
the v4 stage chips; the exporter's product page points to Markets instead of starting or requesting a
scan. Stored runs stay readable. Other environments still run the earlier code so its suites keep
passing (R-33).

**Agent-entered tariffs (D-037).** v5 runs no longer read `authoritative_manual` evidence
(`run-inputs.ts`); `POST /api/v1/market-access/manual-captures` refuses every request; the agent's
"Official tariff to check" pointer and "Record the official duty" form are removed (`demand-control.ts`,
`DemandDiscoveryControl.tsx`, `V5Breakdown.tsx`, `RecordOfficialDuty.tsx` deleted). A breakdown stored
before still says an agent read its line. docs/36 and docs/37 say so.

**Checks run (agent workspace, local database harness).** `tsc --noEmit` clean. ESLint
(`--max-warnings=0`) clean on all 24 changed code and test files. Full suite, run twice: 2,283 passed,
5 skipped, 3 failed, the same three local-harness-only failures as in E-029 and E-030
(`market-scan-requests`: the pg adapter cannot read Postgres's `name` type in a raw query;
`pilot-e2e`; `staff-provisioning`). New tests: `earlier-engines-retired` (9) and the closed capture
endpoint in `manual-tariff-capture`. CI runs the canonical suite on the PR.

**Not verified.** The pages in a browser; the refusals on staging (after merge, a POST to a retired
route there must answer 422 with the retired reason).

### E-033 · 2026-10-30 · Phase 1 gate v2: Demand Discovery v5 runs only (D-036) (in review)

**Branch.** `dd5/gate-v5`, stacked on `dd5/v5-only` (PR #16, not merged).

**Gate.** Policy `phase-1-gate-v2` replaces v1, which evaluated Country Truth v4 deep runs; the v1
loader, evaluator and tests are removed, and so is the v1 gate assertion inside the WP2
tariff-acquisition test. For each archetype the gate reads one v5 run in a single read-only snapshot
and checks: the engine (`market-opportunity-v5` only; any other run fails and is not evaluated
further); a staff confirmation with its audit event, for the archetype's code, that the run scored;
the run status (`completed`, or `partial` with notes, agreeing with its job); coverage (every market of
the frozen universe, once); at least 10 ranked markets; calibration (docs/36 §8, from the run's own
BACI release); no silent zero; every estimate labelled (D-037); no agent-recorded duty and at least one
official duty in the top 10 (D-037); run age and BACI lag; that the stored policy re-hashes; and a
replay that re-scores every market from its stored metrics. Every threshold is **proposed**
(docs/34 §2); R-08 stays open.

**Supporting changes.** `duty-basis.ts` holds `dutyBasisOf` as a pure module (re-exported by
`archetype-runs.ts`); `compareRunWithIndiaExports` and `readProductFlows` take an optional database
handle and storage, so the comparison runs inside the gate's snapshot; the archetype scripts cite
policy v2.

**Checks run (agent workspace, local database harness).** `tsc --noEmit` clean; ESLint clean on all 13
changed code and test files. `phase-1-gate` (22 tests, new); `demand-discovery-v5-run` (4, two new: an
unconfirmed product is refused before any run exists; the gate reads the suite's real end-to-end run
back and passes it, its replay reproducing all 218 stored markets exactly); `archetype-runs`,
`country-truth-tariff-acquisition`, `calibration`, `earlier-engines-retired` and
`manual-tariff-capture` (28) pass. Full suite: 2,280 passed, 5 skipped, 3 failed: the same three local-harness-only failures as in E-032 (the local pg adapter cannot read a raw query's result: `market-scan-requests`, `pilot-e2e`, `staff-provisioning`). Three fewer passes than E-032 because the v1 gate file's 27 tests are replaced by 22 and the v5 run suite gains 2. The command refuses a v1 `job:`
selector and an unknown archetype (exit 3).

**Expected on staging (not run).** The 19 Oct runs used policy v6 and would fail calibration for rice
(3/10) and brassware (4/10) (E-026); they also pass 30 days on 18 Nov. Order: merge #16 and this PR,
re-run the archetypes under v8 (`dd5-archetype-runs.ts start --rerun`), then run the gate (docs/34 §6.2)
with a probe record (§6.3).

**Finding.** A failed Comtrade market-fallback step marks a run partial without a note (`run-inputs.ts`:
of the two Comtrade steps, only the newest-year step adds one). The gate fails such a run
(`partial_run_without_notes`), correctly: the exporter would see a partial run with no reason (R-34).

### E-034 · 2026-10-30 · A failed Comtrade fallback says why (R-34) (in review)

**Branch.** `dd5/fallback-note`, stacked on `dd5/gate-v5` (PR #17).

**Change.** `run-inputs.ts`: when the Comtrade market-fallback step does not deliver, the run's notes
say so, as the newest-year step's already do — failed: "Comtrade figures for the N markets BACI does
not cover could not be fetched (reason), so those markets are not scored on trade this run." (the run
is `partial`, as before); unavailable (no authenticated client): "The N markets BACI does not cover are
not scored on trade: reason". This is what docs/36 §7 already said ("A failed Comtrade step makes the
run `partial` with the reason").

**Correction to E-033.** The gate's `partial_run_without_notes` check sees only whether a partial run
has any note. The new test's run had three unrelated notes, so the gate would not have caught this
case; the note itself is the fix. docs/34 §7 now says so.

**Checks run (agent workspace, local database harness).** New test in `demand-discovery-v5-run`
("a Comtrade fallback that fails leaves the run partial and says why"): fails without the change
(the partial run's three notes do not mention the fallback), passes with it. Every
`demand-discovery-v5-*` suite, `phase-1-gate` and `manual-tariff-capture` pass (12 files, 126 tests);
`tsc --noEmit` and ESLint clean. The full suite was run on the parent commit (E-033).

### E-035 · 2026-10-30 · Data freshness for every Demand Discovery input (stage 1, item 4) (in review)

**Branch.** `dd5/input-freshness`, on top of `dd5/fallback-note` (PR #18); its PR targets
`staging/railway` and is merged after #16.

**Built.** `src/lib/demand-discovery-v5/input-freshness.ts`: a rule per input for when its current
release stops being current, each with its basis (docs/36 §7a): BACI due from 1 January once its last
year is more than two years old and overdue from 1 March; World Bank indicators 365 days; Comtrade
reporting lists 30 days; India's trade agreements and ECGC 182 days; sanctions programmes 31 days
(R-21); currency pegs 365 days; GeoDist never; tariff releases by family (TARIC and CAMEX 45 days,
China at year end, EAC on 30 June, Singapore's nightly copy after 7 days while its refresh is on, any
other source 365 days); each published duty rule at its `review_by` (R-22); ECB rates automatic. Rows
turn *due soon* 14 days ahead. `/ops/discovery` shows every row, worst first, under **Data freshness**;
the Control Tower gains **Stale data inputs** (overdue plus missing), linking there; the worker logs
the same rows once a day (`input_freshness`). Nothing imports data; refreshing stays an operator step.

**Why no notification.** Notifications have a screen only in the exporter portal; ops staff would never
see one. The ops pages and the worker log are where ops look.

**Open decisions (not built; owner's call).**
1. *Automatic imports for keyless sources* (World Bank indicators, Comtrade reporting lists).
   (a) the worker downloads and activates them on schedule when the import's checks pass; (b) it
   downloads them and holds each for an operator to activate; (c) operators import, as now (built).
   Recommended: (a). These are versioned public statistics, every import is checksummed and kept, and
   a run cites the release it used.
2. *Re-runs when newer data lands* (stage 1, item 5). (a) mark each run a new BACI year or tariff
   release would change, and re-run them automatically, oldest first, within a daily Comtrade budget;
   (b) mark them and let the agent or exporter start the re-run; (c) mark only. Recommended: (a) with a
   budget of 100 runs a day. A run makes two batched Comtrade calls plus its tariff look-ups, and the
   free key allows 500 calls a day.

**Checks run (agent workspace, local database harness).** `tsc --noEmit` clean; ESLint clean on the
changed files. New `demand-discovery-v5-input-freshness` (7 tests: every rule at fixed dates, the
loader on stored data, the Control Tower card and the worker sweep); `demand-discovery-v5-operations`
now also renders the table from stored data; `demand-discovery-ui` passes. Full suite: 2,288 passed, 5 skipped, 3 failed: the same three local-harness-only failures as in E-033.

**Not verified.** The table and the Control Tower card in a browser; the worker's daily log on staging.

### E-036 · 2026-10-30 · Exporter fit: ask for the FOB price and capacity (stage 1, item 7) (in review)

**Branch.** `dd5/exporter-fit`, on top of `dd5/input-freshness` (PR #19); merged after #19.

**Merged and staging (owner, 30 Oct, 17:57–17:59 UTC).** PRs #15, #18, #17 and #16, in that order.
`staging/railway` is at `5af655a`; CI passed on #16–#18 together (run 41102882368, with the build).
The owner's Claude Code ran the stage 1 staging check and stopped at its step 2: the worker deployed
`5af655a`, but the web service failed Railway's health check twice (#15's and #16's deploys) and the
19 Oct build is still live. `/api/health/ready` returns 503 with the database ready and the storage
check failing, on the live build too. That check returned ready on 13 and 18 Oct, so the failure is
new and not from these PRs. The error text, `UnknownError`, is what this SDK version reports for an
HTTP error on a request with no response body (S3 HEAD): storage answered with an error status
(denied, missing bucket, or server errors) that the check does not show. No runs were started and
nothing was changed. A read-only diagnostic was sent to the owner; v5 runs read BACI from the same
storage, so the archetype re-runs wait for it (R-35).

**Built.** The results API returns the product and the exporter's two figures as the run froze them
(`exporterFitView`: each value, or its reason when missing, and the points its measure carries in the
run's policy). `/app/markets` then says when fit with the exporter's business is left out of the
scores, names each missing figure with the run's reason, and links to the product's details, after
which the exporter runs Demand Discovery again; a ranked card whose score used fewer than 100 points
says how many.

**Checks run (agent workspace, local database harness).** `tsc --noEmit` clean; ESLint clean on the
changed files. New `demand-discovery-v5-exporter-fit` (6 tests: the figures from frozen inputs, the
prompt with both, one or neither figure missing and without a product, the points line, the API
fields); `demand-discovery-v5-run` now reads the figures back from its real run; full suite:
2,294 passed, 5 skipped, 3 failed: the same three local-harness-only failures as in E-033.

**Not verified.** The page in a browser.

### E-037 · 2026-10-30 · Every figure names its source and years (stage 1, item 8); staging storage restored (in review)

**Branch.** `dd5/source-labels`, from `staging/railway` at `6c2ea75`.

**Merged (owner, 30 Oct).** #19 at 18:28:44 UTC and #20 at 18:31:09; `staging/railway` is at `6c2ea75`.
CI passed on #19 (run 41105496831) and #20 (run 41106532672, 18:23:31–18:32:59). #20's run tested its
head `325e880` merged into `5af655a`, staging's tip when it started. That merge's tree, `7845d16`, is
`6c2ea75`'s tree (`git merge-tree`), so run 41106532672 is CI evidence for the deployed code. The five
negative-probe tests of docs/34 §6.3 are all present at `6c2ea75`.

**Staging storage (R-35).** The owner's Claude Code found the cause, read-only:
- Railway rolled the credentials of every storage bucket after its 21 Oct security incident (21 Oct,
  22:52:55 UTC).
- Web and worker held the bucket's variables as literal copies. The access key ID survived the reset
  and the secret did not.
- Every storage call has failed since: HeadBucket 403 and ListObjectsV2 403 `SignatureDoesNotMatch`.
  The readiness check shows `UnknownError` because a HEAD answer has no body for the SDK to name.
- No v5 run could read BACI in that time, and the gate's calibration could not either.

With the owner's authorization, on 30 Oct it:
- made the access key ID, secret, bucket, endpoint and region references to the bucket on both
  services;
- gave the worker `CENSUS_API_KEY` as a reference to web's, since the regional-demand job runs on the
  worker (R-32);
- redeployed `6c2ea75` on both: web SUCCESS and through the health check at 18:41:04, worker SUCCESS
  at 18:41:14.

`/api/health/ready` answered 200 at 21:52:40, with database, storage and worker ready. The identity pin
is unchanged and matches the rendered values.

**Open decision (owner's).** The region reference renders `sin`, the bucket's location. Before, the
services used `auto`, which is also what the bucket's credential API and Railway's docs give. Only
HeadBucket has been tried with `sin`.
- (a) Keep `sin`.
- (b) Set `STORAGE_REGION` back to the literal `auto`. A credential reset cannot change a region, so
  the literal loses nothing.

Recommended: (b), the value storage used for every kind of call before the reset. Either way, follow
with `scripts/verify-staging-storage.ts`, a full round trip (upload, metadata, read, SHA-256, delete).
The prompt sent to the owner makes (b), updates `tmp/rw/operator.env`, runs the probe and the round
trip, and resumes the stage 1 check with run 41106532672 in the negative-probe record.

**Built (item 8).** Under every measure with data, the market page (exporter's and agent's, one
component) now names where the figure comes from and for which years; an estimate says "Estimate:".
docs/36 §6 has the line for each measure. The engine records these years with each measure's inputs:
- `first_year` and `last_year` for every live trade measure (size and India's sales over the years they
  average, the trends over their windows, the structure measures their structure year);
- the LPI's year;
- the World Bank tariff average's year in an estimated duty;
- the ECGC list's version with each grade.

These are inputs only: statuses, scores, confidence, ranks and the policy hash are unchanged. The
assess test checks that market by market, and the gate's replay passes on the end-to-end run. Runs
from before name a year only where the stored row says exactly which; size and India's figures name
the source alone.

**Checks run (agent workspace, local database harness).** `tsc --noEmit` clean; ESLint clean on the
changed files.
- New `demand-discovery-v5-sources` (7 tests): the context read from stored rows; a line for every
  measure, including estimates, linked years, partner-only and fallback markets, and older runs; the
  market page's rendering.
- `demand-discovery-v5-assess`: one new test for the recorded years, and that no status, score or rank
  moves.
- `demand-discovery-v5-run`: reads the years and lines back from its real run (the 2022 LPI and tariff
  average, the ECGC list, Germany's official tariff with its date).
- `demand-discovery-v5-metrics`: three `dutyInputs` tests compare whole objects, so their estimates now
  carry `sector_average_year`. In the customs-union case it is the reference market's year, the average
  the estimate uses.
- Full suite: 2,299 passed, 5 skipped, 6 failed. Three were those `dutyInputs` tests before their
  correction; with it, the file passes 37 of 37. That leaves 2,302 passed (E-036's 2,294 plus the 8 new
  tests) and the same three local-harness-only failures as in E-033.

**Not verified.** The lines in a browser, and on staging after the archetype re-runs.

**Recommended, not built.** The readiness check reports `UnknownError` for any failed storage HEAD.
Reporting the HTTP status (403, 404) would have shown the cause on 21 Oct. It is a small change, for the
owner to schedule.

### E-038 · 2026-10-30 · Calibration on eighteen products: tooling (stage 1, item 6) (in review)

**Branch.** `dd5/calibration-set`, on top of `dd5/source-labels` (#21); merged after #21. CI passed on
#21 (run 41137168211, finished 22:25 UTC): typecheck, lint, tests, build and image.

**Built.** `calibration-set.ts` lists eighteen products: the three archetypes and fifteen more, one
HS 2022 subheading each:

| Sector | Products |
|---|---|
| Food | rice `100630`, black tea `090240`, cumin `090931`, cashew `080132` |
| Marine | frozen shrimps and prawns `030617` |
| Textiles and apparel | carpets `570110`, cotton yarn `520512`, T-shirts `610910`, bed linen `630231` |
| Gems and jewellery | worked diamonds `710239`, precious-metal jewellery `711319` |
| Pharmaceuticals | medicaments `300490` |
| Engineering | motor-vehicle parts `870899`, centrifugal pumps `841370` |
| Leather | leather footwear `640399` |
| Building materials | ceramic tiles `690721`, worked granite `680293` |
| Handicrafts | brassware `741810` |

`scripts/dd5-archetype-runs.ts` takes `--set=archetypes|calibration`; the archetypes stay the
default, with the same wording and evidence as before. `start --set=calibration` reuses the archetype
products and runs, and proposes and confirms the fifteen others as staff, marked as calibration
products. `status --set=calibration` adds a summary across the set: products compared, passes,
calibration failures, products India does not export, the median overlap with India's top
destinations, and each failure, worst first. docs/34 §6.1 now shows the `--actor-email` that `start`
requires.

**Cost.** Eighteen staging runs use two batched Comtrade calls each, 36 of the free key's 500 a day,
plus their tariff look-ups. Nothing is bought.

**Open decisions (owner's; nothing has run).**
1. *The list.* Proposed as above, to cover the sectors Indian manufacturers export in and three
   destination patterns: hubs, neighbours and long-haul buyers. Change it before the staging runs if
   other products matter more.
2. *What accepts the scoring.* (a) every product passes; (b) at least 15 of 18 pass, and each failure
   is explained through its `missed` markets; (c) report only, and the owner judges. Recommended: (b).
   Hubs such as diamonds through Hong Kong and Belgium are the likeliest honest misses, and one failing
   product should not block stage 1 if its misses are understood.

**Checks run (agent workspace, local database harness).** `tsc --noEmit` clean; ESLint clean on the
changed files. `demand-discovery-v5-archetype-runs` (8 tests, 4 new): the set's codes, sectors and
archetypes; `start --set=calibration` reusing the archetypes and confirming the rest with their own
rationale and evidence; `status --set=calibration` with its summary; the summary's counts, median and
order. Full suite on this branch (which includes #21): 2,306 passed, 5 skipped, 3 failed. That is #21's
2,302 plus the 4 new tests, and the same three local-harness-only failures as in E-033. It also
confirms #21's corrected `dutyInputs` tests in a full run.

**Not verified.** The runs on staging. They follow the stage 1 check, which waits on the storage
region decision (E-037).

### E-039 · 2026-10-31 · Stage 1 staging check stopped; v5 writes and stuck runs fixed (in review)

**Staging (owner's Claude Code, 30 Oct 22:24 – 31 Oct).**
- Storage: `STORAGE_REGION` is the literal `auto` on web and worker, and the other bucket variables are
  references. `verify-staging-storage.ts` passed 9 of 9. R-35 is closed.
- Census: the worker's first live read completed (US, 22:42). R-32 is closed.
- Rice (run `cmvvjlsel0001ueze8m0k8gts`, policy v8): completed with 214 ranked, but calibration failed
  with an overlap of 4 of 10. Missed: Iran (ranked 91), Iraq (35), Guinea (27), Yemen (36), Togo (20)
  and Côte d'Ivoire (11). R-30 stays open.
- Brassware and carpets never finished:
  - Attempts 1 and 2 timed out in `writeV5Results`, whose transaction took 5.2 s against Prisma's 5 s
    limit. The worker runs in Amsterdam and the database in Singapore.
  - Merging #21 and #22 redeployed the worker during both third attempts.
  - The stale reclaim then failed both jobs, but left their attempts and runs `processing`.
- The gate was not run; the negative-probe record is prepared.

**Built.**
- `writeV5Results` holds its transaction for up to 120 s (`V5_RESULTS_WRITE_TIMEOUT_MS`).
- The stale reclaim closes the stopped attempt (`WORKER_TIMEOUT`). A job type can register an end hook,
  which runs on a reclaim and after `failJobAttempt`. v5 registers `settleV5Run`: the run follows its job,
  `queued` while a retry is due and `failed` or `cancelled` once none is, and a finished run never moves.
- The worker sweeps every 10 minutes (`closeOrphanedAttempts`, `reconcileV5Runs`). On deploy it settles
  the two stuck staging runs and attempts as failed; that is a staging data change, made by code.

**Decisions (owner's).** Move the worker to Singapore with the database (recommended; R-37). Rice
calibration waits on the reasons for its six misses (`dd5-compare-top10.ts`, read-only).

**Checks run (agent workspace).** `tsc --noEmit` clean; ESLint clean on the changed files; new
`job-recovery` (6 tests); full suite: 2,312 passed, 5 skipped, and the same three local-harness-only
failures as in E-033.

### E-040 · 2026-10-31 · Automatic imports and re-runs on new data (stage 1, items 4 and 5) (in review)

**Branch.** `dd5/v5-refresh`, on top of `dd5/run-write-recovery` (#23); merged after #23. It builds the
recommended defaults of E-035's two open decisions; the owner can still say no before merging.

**Built.**
- *Automatic imports* (`reference-auto-import.ts`, worker, daily). The four World Bank indicators and
  the Comtrade reporting lists are downloaded from the runbook URLs when their freshness row is
  missing, due soon or overdue, and imported through `importReferenceDataset`. Its checks apply,
  changed bytes become the active release and unchanged bytes change nothing. The imports run as the
  staff account in `reference_auto_import_actor_email` (config `demand_discovery.v5`); with none, nothing
  is downloaded and each due input says why. A publisher failure is reported, and the other inputs
  still import.
- *Re-runs on new data* (`refresh.ts`, worker, hourly). A product's newest finished run, under its
  confirmed code, is re-run (trigger `refresh`) when one of three things has happened since:
  - a newer BACI release is ready;
  - a reference dataset it froze has a newer, or a first, active release;
  - an official tariff release was activated after its date.

  Runs go oldest first, at most `refresh_daily_budget` (100) a day. The paid-tier rule and the
  in-flight dedupe apply, and a refused start costs no budget.
- `refresh_on_new_data` and `reference_auto_import` switch each off.

**Owner action.** Set `reference_auto_import_actor_email` on staging to an ops supervisor or admin account.

**Checks run (agent workspace).** `tsc --noEmit` clean; ESLint clean on the changed files. New
`demand-discovery-v5-refresh` (3 tests) and `demand-discovery-v5-reference-auto-import` (3). Full suite:
2,318 passed, 5 skipped, and the same three local-harness-only failures as in E-033.

**Not verified.** Live downloads from the World Bank and Comtrade on staging.

### E-041 · 2026-10-31 · The free estimate answers for every product (owner-approved idea 1) (in review)

**Staging (owner's Claude Code, 31 Oct).** #23 deployed at 06:27–06:28 UTC. The worker's sweep settled
the two stuck runs and their attempts as failed at 06:28:59. #24 was merged at 06:26:45, before its CI
finished; that CI run, 41176496446, passed at 06:35:37 on the tree now deployed (`276713c`). The first
auto-import loop imported nothing: no import account is set yet.

**Built.**
- `POST /api/v1/market-estimates`, the free and guest estimate, now reads CEPII BACI, which covers
  every HS6 product. It uses the newest ready release holding the code (HS 2022 first, else HS 2017),
  over its latest three years.
- Each market shows its imports by year, ordered by its latest year. Prices are per kg, across its
  suppliers, from the 10th to the 90th percentile by value. India itself, provider aggregates and
  markets under the volume floor are left out.
- The Comtrade warehouse, which holds only the products someone has ingested, answers only where BACI
  is missing or cannot be read.
- The result names its source (`source`, `source_label`), and the page shows it.
- The framing rules are unchanged: observed history only, the disclaimer verbatim, no projections.
- AGENTS.md and docs/14 §3 now describe the new data source.

**Checks run (agent workspace).** `tsc --noEmit` clean; new `market-estimate-baci` (2 tests): the
estimate from flows (order, price band, exclusions, framing) and the fallback when BACI is missing or
unreadable.

### E-042 · 2026-10-31 · Calibration on every run; a health check across sectors (owner-approved ideas 2 and 3) (in review)

**Branch.** `dd5/run-calibration`, on top of `dd5/estimate-from-baci` (#25); merged after #25.

**Built.**
- *Every run* records how its top 10 compares with India's own top destinations (`summary.calibration`):
  overlap, verdict, India's top and the markets missed. It is computed from the BACI flows the run already
  read, by the docs/36 §8 rule. `/ops/discovery` shows it on each recent run, and a 30-day line gives
  runs compared, passes, failures and the median overlap. Calibration now grows with every product run.
- *Health check* (`scripts/dd5-health-check.ts`, `health-check.ts`). India's top export products in the
  newest BACI HS22 year (default 100, read from every chapter partition), or `--codes`, are scored as a
  run would score them, from stored data only, without exporter figures, and each is compared.
  - Comtrade, tariff look-ups and FX fetches are off, and the rows a run could write are counted
    before and after.
  - The report gives passes, the median overlap, results by chapter, and the markets missed most often.
  - It refuses production and has not run yet.

**Checks run (agent workspace).** `tsc --noEmit` clean; ESLint clean on the changed files.
- New `demand-discovery-v5-run-calibration` (2 tests) and `demand-discovery-v5-health-check` (3 tests).
- `demand-discovery-v5-run` checks its stored calibration against its own top 10.
- Full suite (with #25): 2,325 passed, 5 skipped, and the same three local-harness-only failures as in
  E-033.

### E-043 · 2026-10-31 · Product code finder without AI (owner's choice: option B) (in review)

**Decision (owner, 31 Oct).** The finder uses no AI, so it works whatever outside service is down.

**Built.**
- `cepii:product-codes:HS22`: every HS 2022 code with its description, from the BACI archive's product
  list, under the same Etalab 2.0 licence. Operator import, docs/36 §10 step 9.
- `src/lib/hs-finder/` searches the official descriptions, rarer words counting more. A one-letter slip
  still matches, and curated everyday names ("jeera", "pooja thali", "agarbatti") lift the codes they
  may fall under.
- It reads details from the exporter's own words: "brass" as copper or brass, "steel" as stainless,
  "powder" as ground.
- It asks about the detail that separates the closest codes, with the answers the descriptions offer
  plus "Other / not sure". The details are material, fresh or frozen, whole or ground, roasted, shelled,
  kind of rice, knitted, printed, who it is for and pack size. It shows at most three codes with their
  official descriptions.
- A code's own exclusions ("other than cotton", "(not printed, knitted or crocheted)") never count as
  its own.
- `POST /api/v1/hs-finder` needs no session, reads only the code list and writes nothing. It never
  decides a code: a picked code still goes to an agent to confirm.

**Not built yet.** The screens: the product form and the guest estimate form.

**Checks run (agent workspace).** `tsc --noEmit` clean; ESLint clean on the changed files. New
`hs-finder` (6 tests) and `hs-finder-route` (2 tests). Full suite on `staging/railway` plus this change,
before it was stacked on #26: 2,326 passed, 5 skipped, and the same three local-harness-only failures
as in E-033. Stacked, it is left to CI.

### E-044 · 2026-10-31 · Stage 1 gate: FAIL on rice calibration only; an audited auto-import switch (in review)

**Staging (owner's Claude Code, 31 Oct 06:40–06:55 UTC, `276713c`, policy v8).**
- Runs: rice `cmvw17upd0001ue35jwagb23h`, brassware `cmvw17w2b0007ue351scfbz9i`, carpets
  `cmvw17wz1000due35dyfgyq95`, all completed. No agent-recorded tariff was used.
- The negative-probe record cites CI run 41176496446. Its tested tree, `1372f02`, is `276713c`'s.
- Gate verdict FAIL (policy `phase-1-gate-v2`, thresholds unapproved). Report checksum
  `490250412797b1d64cb778bbabacc728793fbf7b3faa5627aa212a603440fc11`, policy hash
  `d5b99949fca395da4f16c2d51640a428c3b85b71f0c68b6c2667c1cc119071a7`.
- The only failed check was `rice:calibration.india_top_overlap`: 4 of India's 10 largest destinations
  are in the run's top 10, where 5 are needed. Brassware matched 7 of 10 and carpets 9 of 10, and every
  other check passed.
- Rice's misses, all ranked:
  - payment risk: Iraq (#35, ECGC C2, restricted cover), Guinea (#27, C1), Yemen (#36, D);
  - falling imports: Iran (#91, imports down 15.9% a year);
  - near misses: Togo (#20, B2) and Côte d'Ivoire (#11, the ECOWAS 10% duty).
- No refresh sweep started a run. The Comtrade list imports failed for want of an import account.
- Setting that account needs an admin. Claude Code holds no admin session, and forging one from
  `AUTH_SECRET` was declined pending the owner.

**Decision for the owner: rice calibration (R-30).**
1. Keep the score. Show "where India already sells most" on the results page, each market with its rank
   and the reason it ranks lower. The gate counts a miss as explained when the run marks the market's
   ECGC cover restricted or off cover, or flags sanctions. Rice: 4 matched plus Iraq and Yemen = 6.
2. Change the score (policy v9): where India holds a large and rising share, payment risk pulls a market
   down less. Rice would likely pass outright, but risky markets would enter first-time exporters' top
   10 for many products.
3. Accept rice as a documented exception and approve the gate as it is.

Recommended: 1, after the sector health check (E-042) shows whether payment risk explains most misses
across India's top products.

**Built.** `writeAutoImportSwitch` and `scripts/dd5-auto-import.ts` (`--status`, `--enable`, `--disable`,
`--run-now`). The switch writes a new `demand_discovery.v5` version as the audited config API does: an
admin in `--changed-by`, a `config_change` audit event, the history kept. Only the two auto-import fields
change on top of the stored row, so the policy keeps following the code. No admin web session is needed.

**Checks run (agent workspace).** `tsc --noEmit` clean; ESLint clean on the changed files;
`demand-discovery-v5-reference-auto-import` 4 tests (1 new), restoring the shared config afterwards.

### E-045 · 2026-10-31 · Rice calibration: the owner keeps the score and shows India's markets (gate policy v3) (in review)

**Evidence first.** Sector health check on staging (owner's Claude Code, 31 Oct, stored data only, no
writes): 88 of India's top 100 export products pass; median overlap 7 of 10. Across all 100 products,
the markets missed most often are Brazil (24 products), Italy (22), Bangladesh (16) and Canada (16):
open-cover markets, so payment risk is not what most misses have in common.

**Owner decision (31 Oct, option 1 of E-044, as recommended).**
- The score is unchanged (policy v8): risky markets still rank lower for a first-time exporter.
- Every results page lists "Where India already sells most": each of India's top destinations with the
  run's rank, India's share and, below the top 10, why it ranks lower.
- The calibration check counts a miss as explained when ECGC offers no cover, the cover is restricted,
  or a UN/US/EU/UK sanctions programme is flagged. Any other miss still counts against the run.

**Built.**
- `calibration.ts`: `riskExplanation` reads the payment-risk measure's ECGC cover, then the sanctions
  flags; `compareWithIndiaExports` passes on (overlap + explained) × 2 ≥ India's top N, and every stored
  `summary.calibration` keeps `explained` and each miss's `explained_by`. The job handler, the
  calibration report and the health check pass the explanation through.
- Gate policy `phase-1-gate-v3` (thresholds still unapproved): `calibration.explained_misses` lists the
  accepted reasons. The check names the explained misses in its detail and fails with only the
  unexplained ones.
- Rice under v3. The repository's ECGC parser on the 1 Jul 2026 list shows restricted cover for four
  of the misses: Iraq and Guinea (Group I), Iran and Yemen (Group II). Togo and Côte d'Ivoire are open.
  So 4 + 4 = 8 counted, with 5 needed. E-044 counted 6 because it took Guinea and Iran as open.
  Sanctions play no part in rice's result.
- Correction to the option as offered: a sanctions flag never changes a score (docs/36 §5.2), so no
  miss is *caused* by sanctions. The rule as built accepts a flagged market outside the top 10 as one
  not to steer a first-time exporter to. The results page shows the run's own reason as the cause, and
  the ECGC cover or the flag only as a note.
- `india-markets.ts` and the results route's `meta.india_markets`; `V5Results.tsx` shows the list
  below the ranking.
- docs/34 and AGENTS.md name policy v3; docs/36 §8 records both rules.

**Open for the owner (at gate approval).** Whether sanctions stay among the accepted reasons. Most
flagged programmes are targeted: Iraq's UN 1518 covers the former regime's assets, and Yemen's UN 2140
covers the Houthis. Counting every flag is generous. Recommended: ECGC reasons only. They are what the
score itself uses, and rice passes on them alone. The change is one line of policy.

**Checks run (agent workspace).** See the PR; listed there with the CI run.

**Not yet verified.** The gate has not been re-run on staging under v3. The loader recomputes the
comparison from each run's stored rows (`compareRunWithIndiaExports` reads each market's ECGC cover and
flags), so the three 31 Oct runs can be re-read as they are with `run:` selectors.

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
| R-08 | Gate thresholds unapproved | Open — policy v2 (v5 runs only) proposed in E-033 | Owner approval PR |
| R-09 | Second Railway project `cleartrade-staging` (deployed this branch on 9 Oct); database target and status unknown | Closed — project deleted 9–10 Oct (E-009) | — |
| R-10 | Railway PR environments, if enabled with a production base, would migrate production on PR open | Closed — PR environments off (E-009); `focusedPrEnvironments` flag unverified | Re-check before enabling PR environments |
| R-11 | `reclaimStaleJobs` requeues any job still processing 300 s after it **started** (no heartbeat); with more than one worker a long deep run would execute twice. Safe today only because staging runs one worker and the sweep runs between jobs | Open (pre-existing; WP2 lengthens deep runs); v5 runs now include up to 53 tariff look-ups (E-019), so they run longer too | Keep one worker until staleness is heartbeat-based (WP5) |
| R-12 | The owner's local clone holds unpushed work; `wip/switzerland-tares` touches `market-access.ts`, where WP2 adds a required `retrieval` field | Open (E-009) | Owner rebases after WP2 lands; the typecheck names a missing field |
| R-13 | Production web's `STORAGE_BUCKET` names the bucket `cleartrade-staging`; if it resolves to staging's bucket, production files land in staging storage (or the reverse) | Open — unverified (E-009) | Owner dashboard check; WP5 read-only inventory |
| R-14 | UN Comtrade's licence prohibits commercial use without the UN's written permission; D-010 shows Comtrade-derived figures to customers before permission | Open — accepted by the owner (D-010); permission request sent by the owner on 14 Oct (E-018) | UNSD's reply; Comtrade display stays switchable in config |
| R-15 | BACI is built from Comtrade data; Etalab 2.0 is CEPII's licence, and the position of the underlying UN data is unverified | Open (E-010) | Legal check before the production launch |
| R-16 | Agreement-based duty estimates can be wrong for a specific product | Accepted (D-017); always labelled, evidence quality 0.5 | Calibration on the three archetype products |
| R-17 | The agent session cannot reach CEPII, World Bank or Comtrade hosts | Open (E-010) | Imports run on the owner's machine or the Railway worker |
| R-18 | Since `20260829120000`, deleting a run, product or organisation left its non-v4 `MarketAssessment` rows orphaned, and discovery retries appended duplicate result sets; staging/production may hold such rows | Open (E-012) — guard fixed going forward; no rows changed | Read-only counts on staging: assessments whose run is missing, and runs with more than one row per country; clean-up only with the owner's authorization |
| R-19 | The ECGC text and the GeoDist CSV were made on the owner's machine; the ECGC command is inferred from the output (`pdftotext -layout`) and the GeoDist export tool was not recorded | Closed (E-018) — the owner re-derived both from the originals; byte-identical | — |
| R-20 | v5 uses each country's latest World Bank value however old: tariff averages as old as 2002 and logistics scores as old as 2007 feed the duty estimate and the logistics metric | Decided (D-021): values more than 10 years old count as missing — built in E-019, pending merge | v5 runs on staging after E-019 deploys |
| R-21 | Sanctions programmes change often; a stale flag misleads in either direction | Open (E-021) — the list carries its check date | Monthly re-check; a new edition of `curated:sanctions-programmes` |
| R-22 | A published rule or a directory link goes stale (Timor-Leste's rate is set each budget) | Open (E-021) — rules stop applying after `review_by` | Review dates in policy; yearly directory re-check |
| R-23 | An agent mistypes a tariff line | Open (E-021) — reader, source and date kept; quality 0.9; audit event | A newer record supersedes; spot checks by Ops |
| R-24 | An agent records a rate from one of the eight tariff sources whose reuse terms are not settled (Chile's research found no commercial reuse basis) | Accepted (D-028): allowed as built, one cited rate per line | Automated reading of these sources still waits for each licence |
| R-25 | Intermittent CI failure in `country-truth-phase-1h-assessment`: a resumed Phase 1G calculation finds its stored CountryTradeMetrics row "computed under a different payload". The payload depends on the order of its input facts (`loadManifestInputs` in `src/lib/country-trade-metrics/service.ts` reads references and observations in no stated order; the supplier HHI and unit-value evidence follow input order), but the trigger is not confirmed: physically reordering the manifest references did not reproduce it locally. A resumed run in an environment could fail the same way | Open (pre-existing code; first CI attempt failed in runs 39025584959 and 39026589659 on PR #5's docs-only commits; no failure on other branches) | Diagnose in CI with the differing payload printed; then make the fact order deterministic, keeping stored rows' checksums valid |
| R-26 | The Railway worker may not reach Singapore Statutes Online, or SSO may refuse automated requests from a cloud address; the live First Schedule has only been read through fixtures that follow the reviewed pack | Open (E-022) — nothing is fetched until `market_access.authority_refresh` is switched on; failures are recorded and the release in use is untouched | The first window run on staging is the live qualification; otherwise `--acquire-only` on a machine that can reach SSO, inside the window, and import the file |
| R-27 | The EAC release reads the 2026/27 measures only: after 30 June 2027 it states nothing until the July 2027 Gazette is read; table I's stays are applied to every member because its rows name states one by one (over-exclusion: 500 lines) | Open (E-023) | Import each July Gazette; read table I row by row when it is worth the effort |
| R-28 | A common tariff is not the member's whole tariff: Kazakhstan's, Kyrgyzstan's and Armenia's WTO-commitment rates, Ghana's and Nigeria's import adjustment measures and other national exceptions are not modelled; the EAEU text on Adilet lagged nomenclature amendments (Board Decision No. 43 of 7 Apr 2026) | Accepted (D-028): labelled, quality 0.8, said with every duty | Model the national lists where published; re-read the EAEU text after amendments enter into force |
| R-29 | A tariff schedule read is not the whole applied tariff: trade remedies and temporary measures outside the schedules, the GCC members' exemptions, Argentina's, Paraguay's and Uruguay's national lists and regimes (Uruguay's own tariff is licence-pending), ex-tarifários and quota rates are not modelled; China's release states nothing after 31 Dec 2026; the CAMEX workbook changes most months; the UAE's CEPA year is counted from each anniversary of 1 May 2022 (if UAE customs counts calendar years, India's rate can be one step lower from January to April); Dubai Customs' website terms were not found | Accepted (D-028, D-031): labelled, quality 0.8 or 0.9, said with every duty (E-025) | Import China's 2027 tariff in late December; re-read the workbook when CAMEX updates it; confirm the CEPA year from a UAE customs notice; find Dubai Customs' terms |
| R-30 | v5's top 10 for rice and brassware overlaps India's real top destinations 3 and 4 times in 10 (carpets 8): the score may undervalue markets India already supplies heavily (West African and Gulf rice buyers rank 19th to 112th) | Open: under v8 on 31 Oct rice still matches 4 of 10 (brassware 7, carpets 9). The misses are payment-risk and falling-import markets (E-044); the owner chooses among E-044's three options | The sector health check (E-042), then the owner's choice |
| R-31 | HMRC's importer list names sole traders, and both the Open Government Licence v3.0 and the Open Government Licence – Canada exclude personal data; showing every published entry (D-034) relies on the publishers having published them | Accepted by the owner (D-034) | Legal check before production; honour HMRC's monthly opt-outs by importing each new file |
| R-32 | The Census reader has not read a live answer (no key in the agent session); a variable or format difference would show as a failed or empty run | Closed (E-039): the worker read the US live on 30 Oct | — |
| R-33 | The earlier engines' code stays in the repository: it is refused only where `APP_ENV` is staging or production (D-036), so a misconfigured environment could still start a v4 run | Open (E-032) | Delete the earlier engines once v5's gate passes and no stored v4 run needs its code to be read |
| R-34 | A failed Comtrade market-fallback step made a v5 run partial without a note saying so (`run-inputs.ts`), so the exporter saw no reason; the gate's notes check sees only whether a partial run has any note | Closed (E-034) — the step's outcome is now a note | — |
| R-35 | Staging storage fails its readiness check (S3 answers HEAD with an error status the check does not show), so the web service cannot deploy and v5 runs cannot read BACI | Closed (E-039): the bucket variables are references, the region is the literal `auto`, and the round trip passed 9 of 9 | — |
| R-36 | Railway recommends rotating every sensitive variable stored before its 21 Oct security incident. Staging's include `AUTH_SECRET`, `OPERATIONS_TOKEN`, the database credential, the Resend key and the Comtrade key shared with development (docs/33); production on Railway may hold the same kind | Open — the owner's decision (E-037); recommended: rotate staging's, starting with the keys shared across environments, and check production | The owner's decision |
| R-37 | The staging worker runs in Amsterdam and the database in Singapore: every query crosses continents, and a v5 results write took 5.2 s | Mitigated (E-039): a 120 s write timeout | The owner moves the worker to Singapore |
