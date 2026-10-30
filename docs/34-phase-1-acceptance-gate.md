# Phase 1 Acceptance Gate (WP1)

Phase 1 — Country Demand Discovery — is not complete because its code exists or its unit tests pass.
It is complete when a **from-scratch Demand Discovery v5 run on staging** produces evidence this gate
accepts, for each approved product archetype, under thresholds the owner has signed — and the named
reviewers have signed the resulting report.

| | |
|---|---|
| Policy | `phase-1-gate-v2` — `src/lib/phase-1-gate/policy.ts` |
| Engine | **Demand Discovery v5 only** (`market-opportunity-v5`, D-036). A run from an earlier engine fails. |
| Status | **Every decision PROPOSED** (30 Oct 2026). Built against; not yet approved. |
| Evaluator | `scripts/gate-phase-1.ts` → `src/lib/phase-1-gate/{load,evaluate}.ts` |
| Tests | `tests/phase-1-gate.test.ts`; the from-scratch case (a real run through the job handler, read back through the gate) in `tests/demand-discovery-v5-run.test.ts` |
| Evidence ledger | `docs/35-programme-evidence-ledger.md` |

```
staging product ──► staff-confirmed HS6 ──► v5 run starts by itself (D-018) ──► all 218 markets scored
                                                                                        │
          gate-phase-1.ts reads it all in ONE read-only snapshot ◄──────────────────────┘
          and compares the top 10 with India's own destinations in the run's BACI release
                                     │
              FAIL ◄─ INCOMPLETE ◄─ PASS_UNDER_PROPOSED_POLICY ◄─ PASS
                                                                    │
                           named sign-off in docs/35 ──► Phase 1 frozen (WP6)
```

## 1. Verdicts

| Verdict | Meaning | Exit |
|---|---|---|
| `FAIL` | At least one check failed. Every failure carries a named reason. | 1 |
| `INCOMPLETE` | Nothing failed, but something the data cannot establish was not supplied (today: the negative-probe record). | 2 |
| `PASS_UNDER_PROPOSED_POLICY` | Every check passed, but at least one threshold is still a proposal. **Not a release pass.** | 10 |
| `PASS` | Every check passed under a fully approved policy. | 0 |

`phase_1_frozen` is always `false` in a report. Freezing Phase 1 needs a `PASS` **and** the sign-offs
in §2, recorded in docs/35 against the report's `report_checksum`. No machine verdict freezes Phase 1
on its own.

## 2. Decisions (policy v2 — all proposed)

Rows marked *v1* carry over unchanged from policy v1 (accepted on 12 Oct 2026 as proposals to build
against). The rest were proposed on 30 Oct 2026 while building v2. Each is restated with its
reasoning in `policy.ts` (`basis`).

| Decision | Proposed value | Why |
|---|---|---|
| Release posture | Exporter-facing; v5 starts when a product's HS code is confirmed | D-018. The gate's own evidence is made by staff (see Classification). |
| Evidence environment *v1* | Staging only | A report read from a development or test database must not pass for staging evidence. |
| Archetypes *v1* | Rice `100630`, brassware `741810`, carpets `570110` (all HS 2022) | Audit default (D-003). `830629` (base-metal ornaments) is the alternative brassware line. |
| Engine | `market-opportunity-v5` only | Owner, 30 Oct (D-036): "the acceptance gates should not run old v4s". Any other run fails and is not evaluated further. |
| Classification *v1* | Human confirmation by an `agent`, `ops_supervisor` or `admin`, with its confirming `AuditEvent` | `scripts/dd5-archetype-runs.ts start` proposes and confirms each code as staff. An exporter confirming its own code still starts v5, but that run is not gate evidence. |
| Coverage | Every market of the run's frozen universe, assessed once | docs/36: v5 scores every product in all 218 screening markets; the run freezes the universe it used. |
| Market count | ≥ 10 **ranked** markets per archetype | The top 10 is what v5 hands on (`ranking.handoff_count`) and what calibration compares. Staging runs ranked 188–214 (E-026). |
| Calibration | The top 10 holds at least half of India's own ten largest destinations | docs/36 §8. On 19 Oct, rice (3/10) and brassware (4/10) failed and carpets (8/10) passed (E-026); scoring v8 (D-032) is the response, not yet re-run (R-30). |
| Evidence labels | Every unscored metric states its reason; every estimate carries its label | Owner, 30 Oct (D-037): actual data or labelled estimates. |
| Duty evidence | No duty an agent read by hand; ≥ 1 of the top 10 with an official duty read automatically | D-037. Staging runs had 19–47 official markets each (E-026). |
| Freshness | Run ≤ 30 days old at evaluation · newest BACI base year ≤ 2 years before the run | Run age as v1. BACI is published yearly with data to two years earlier; between New Year and the new release's import this fails, by design. |
| Repeatability | Re-hash the stored policy · recompute every market's score and rank from its stored metrics | A v5 run freezes its policy and hash (docs/36 §7); `score.ts` is pure. |
| Failure semantics | Run `completed`, or `partial` with notes; five operator-attested negative probes (§6.3) | Roadmap §8 failure cases, plus the owner's two 30 Oct decisions. |
| Sign-off *v1* | Product owner **and** engineering owner | Roadmap WP1 review roles. |

**Approving.** In one reviewed PR: set each decision's `status` to `approved`, fill `approval`
(`approved_by`, `approved_at`, `decision_reference` → docs/35), and bump `policy_version` if any value
changed. Never edit an approved version in place: reports cite the policy hash.

## 3. Definitions

**Ranked market** — an assessment with `market_status = ranked`: v5 found at least
`ranking.minimum_live_points` live points, market size and growth among them (docs/36 §5).

**Official duty** — a duty metric whose basis (`dutyBasisOf`, `src/lib/demand-discovery-v5/duty-basis.ts`)
is `official` (a connected or retained source), `common_tariff` (a customs union's common external
tariff) or `schedule_read` (a market's own retained schedule). `agent_recorded` is forbidden (D-037);
`rule` and `estimate` are not official.

**Labelled estimate** — a duty estimated from tariff averages (`basis: estimate`) or a logistics score
estimated from shipping connectivity (`basis: lsci_estimate`) carries `estimated: true`, which is what
the portal shows as "(estimated)"; a market measured only from its partners' reports carries the
label `estimated_from_partners`.

**No silent zero** — in every ranked or not-ranked (`not_enough_data`) market, each of the policy's
metrics appears once, either scored 0–100 or unscored with its reason; a not-ranked market says what
it fell short of; an excluded or no-demand market carries no score and no rank; an excluded market
says why.

**Calibration** (docs/36 §8) — India's exports of the product by destination, from the BACI release
the run froze, summed over the years the market-size metric averages, against the run's top 10. Only
screening markets count.

**Scoring replay** — the stored policy snapshot must hash to the hash the run, its frozen inputs and
every assessment carry. Then every market is scored again from its stored metrics under that
snapshot (`scoreMarket`, `rankMarkets`), and status, overall score, live points, confidence, lag,
rank and hand-off must come out exactly as stored. The metrics themselves are not recomputed from
the source releases; `frozen_inputs` pins each release by checksum.

## 4. Evidence matrix

| Dimension | Check | Evidence read | Fails when |
|---|---|---|---|
| Environment | `evidence_environment.required` | `APP_ENV`, `DATABASE_ENVIRONMENT` | not staging |
| Archetypes | `archetype.evidence_supplied`, `classification.matches_archetype` | `ProductClassification.hs6_code`, `nomenclature_version`; `DiscoveryRun.classification_id`, `input_snapshot.hs_code` | no run named; HS6 or revision differs; run made for another classification or code |
| Engine | `engine.v5_only` | `DiscoveryRun.model_version`, `MarketAssessment.model_version` | not `market-opportunity-v5` |
| Classification | `classification.confirmed`, `.confirmer_role`, `.audit_event` | `ProductClassification.status`, `confirmed_by_id`, `confirmed_at`, `superseded_at`; `User.role`; `AuditEvent` (`product_classification`, `after_summary.status = confirmed`) | not confirmed; confirmer not staff; no confirming event |
| Failure semantics | `failure_semantics.run_status`, `.negative_probes` | `DiscoveryRun.status`, `Job.status`, `summary.notes`; probe record | status not accepted; job disagrees; `partial` without notes; probe missing (→ INCOMPLETE) or not fail-closed |
| Coverage | `coverage.every_market` | `frozen_inputs.universe.size`; `MarketAssessment` rows; `summary.markets` | a market missing or repeated; a status that is not v5's; a row for another classification |
| Market count | `market_count.minimum_ranked` | `market_status` | fewer than 10 ranked (statuses tallied) |
| Calibration | `calibration.india_top_overlap` | `frozen_inputs.baci.chosen_release_id`, `base_years`; the release's partitions (SHA-256 checked); `rank` | under half of India's top 10 in the run's top 10 (missed markets named); comparison impossible |
| Evidence labels | `evidence_labels.no_silent_zero`, `.estimates_labelled` | `score_breakdown.metrics` (`score`, `reason`, `estimated`, `inputs.basis`), `shortfall`, `facts.partner_only`; `labels`; `eligibility_reasons` | §3 |
| Duty evidence | `duty_evidence.no_forbidden_basis`, `.official_in_top` | the duty metric's `inputs` | an agent-recorded duty; no official duty in the top 10 |
| Freshness | `freshness.run_age`, `.base_data_lag` | `completed_at`; `as_of_date`; `frozen_inputs.baci.base_years` | run older than 30 days; newest base year more than 2 years before the run |
| Repeatability | `repeatability.policy_hash`, `.scoring_replay` | `scoring_policy_snapshot`, `scoring_policy_hash`, `frozen_inputs.policy_hash`, each assessment's `scoring_policy_hash`; `score_breakdown` | §3 — each difference named by market and field |
| Sign-off | `sign_off.recorded_outside_evaluator` | docs/35 | — always `manual` |

## 5. Report — `phase-1-gate-report-v2`

Printed as deterministic JSON (keys sorted at every depth): the same evidence and `--evaluated-at` give
a byte-identical report.

- **Top level:** `verdict`, `phase_1_frozen` (always `false`), `evaluated_at`,
  `policy` {`policy_version`, `policy_hash`, `approved`, `unapproved_decisions`, `approval`},
  `environment` {`app_env`, `database_environment`, `database_fingerprint_prefix` (first 12 hex of the
  identity fingerprint, never the pin), `git_commit`}, `summary` {`archetypes_required`,
  `archetypes_passed`, `failed_checks`, `unverified_checks`}, `programme_checks`, `archetypes`,
  `report_checksum`.
- **Per archetype:** `selector`, `selection_note`, `result`; `identities` (product, classification and
  revision, confirmer role and time, discovery run, job, engine, scoring policy version and hash, BACI
  release, universe version); `run` (status, trigger, dates, elapsed seconds, base years, notes);
  `counts` (universe, assessed, ranked, not ranked, no demand, excluded, official duties in the top
  10); `calibration` (India's top, the run's top, overlap, missed markets with their rank or status);
  `checks`; `markets`.
- **Per market:** `country_code`, `assessment_id`, status, rank, overall score, live points, data year,
  `duty_basis`, `estimated` (estimated metrics, and `partner_figures`), `unscored` (each metric with
  its reason), `flag_reasons`, and `problems` — every failed-check reason that names the market.

Every check is `{id, dimension, status, detail, reasons}` with status `pass`, `fail`, `unverified`,
`not_required` or `manual`.

## 6. Runbook

### 6.1 Preparing the archetypes on staging

`scripts/dd5-archetype-runs.ts` (docs/36 §10 step 7) makes the test exporter and one product per
archetype, and proposes and confirms each HS code as staff; the confirmation writes the `AuditEvent`
the gate requires and starts v5 (D-018).

```
npx tsx --env-file=tmp/rw/operator.env scripts/dd5-archetype-runs.ts start [--rerun]
npx tsx --env-file=tmp/rw/operator.env scripts/dd5-archetype-runs.ts status
```

`--rerun` starts a fresh run for codes that already have one (needed after a policy change, such as
scoring v8). `status` prints each product id and run id.

### 6.2 Running the gate

```
npx tsx --env-file=tmp/rw/operator.env scripts/gate-phase-1.ts \
  --archetype=rice=product:<productId> --archetype=brassware=product:<productId> --archetype=carpets=run:<runId> \
  --negative-probes=<probes.json> --out=<report.json>
```

- The operator env is the staging variable set with TCP-proxy database URLs (docs/33 §3). It lives only
  in the gitignored `tmp/rw/`. The script prints no secrets.
- It refuses production, validates the staging database identity pins first, and reads everything in one
  `REPEATABLE READ, READ ONLY` transaction: PostgreSQL rejects any write. The calibration reads the BACI
  partition files from document storage, checking each against its recorded SHA-256 (the same read
  `dd5-archetype-runs.ts status` makes).
- `product:<id>` selects the newest completed/partial v5 run for the product's current confirmed
  classification, and says so in `selection_note`. Name a `run:<id>` to pin an exact run. A `job:<id>`
  selector (v1) is refused.

### 6.3 Negative-probe record

A JSON array; each entry `{id, method: staging_observation|ci_test, reference, observed_at, outcome:
refused|failed_closed|reported_unavailable, recorded_by, notes?}`. The gate checks completeness and that
the outcome failed closed; it **cannot** check that the probe happened, so `reference` must be something
a reviewer can re-read (a correlation id or AuditEvent id on staging, or a CI test name with its run URL).

| Probe id | What must be shown | Evidence available today |
|---|---|---|
| `unconfirmed_classification_refused` | Starting Demand Discovery for a product without a confirmed HS6 is refused before any run exists. | CI: `demand-discovery-v5-run` › "a product without a confirmed HS6 is refused before any run exists" |
| `earlier_engine_refused` | In staging, a Country Truth v4 scan, scan request or detailed analysis is refused with the retired reason (D-036). | CI: `earlier-engines-retired`; on staging, a POST to a retired route must answer 422 |
| `provider_failure_left_partial` | A provider step that fails leaves the run `partial` with a note, never `completed`. | CI: `demand-discovery-v5-tariff-step` › "only a failed or timed-out look-up degrades the run"; staging: the rice run of 19 Oct (E-027). A failed Comtrade market-fallback step leaves no note yet (R-34). |
| `missing_duty_never_zero` | A market without an official or estimated duty shows the duty unscored with a reason, never as zero. | CI: `demand-discovery-v5-metrics` duty tests (`scoreDuty(null)` and an unusable duty have no score) |
| `agent_tariff_refused` | Recording a tariff line as an agent is refused, and a run ignores lines agents recorded before (D-037). | CI: `manual-tariff-capture` › "the capture endpoint refuses every request…" and "a run no longer reads a line an agent recorded" |

### 6.4 Evidence capture and retention

- Keep each report JSON under the gitignored `.artifacts/phase-1-gate/<date>/` on the operator machine.
- Record `verdict`, `report_checksum`, `policy_hash`, the run IDs and each run's policy version in
  docs/35. The checksum is what reviewers sign.
- A rerun is a new report; never edit an old one. Rerun after a new archetype run, a policy change, or
  when a run passes 30 days.

### 6.5 External dependencies

The staging database through the Railway TCP proxy; staging document storage (the BACI partitions);
the inputs each v5 run itself reads (docs/36 §3, docs/37).

## 7. Known limits

- Operator-attested probes are checked for completeness and outcome only.
- The replay recomputes scores and ranks from the stored metrics; it does not recompute the metrics
  from the source releases.
- The gate has not yet been run against staging. On the 19 Oct runs (policy v6) calibration would fail
  rice and brassware (E-026): the scoring v8 re-run (R-30) comes first.

## 8. History

Policy v1 (12 Oct 2026) evaluated screen-derived Country Truth v4 deep runs: qualifying markets above
a confidence floor, an Atlas tariff signal, and stored checksum links. It was never run against
staging, and it was retired with the engine on 30 Oct 2026 (D-036); git history keeps it.
