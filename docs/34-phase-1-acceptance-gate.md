# Phase 1 Acceptance Gate (WP1)

Phase 1 — Country Demand Discovery — is not complete because its code exists or its unit tests pass.
It is complete when a **from-scratch, screen-derived deep Country Truth run on staging** produces
evidence this gate accepts, for each approved product archetype, under thresholds the owner has
signed — and the named reviewers have signed the resulting report.

| | |
|---|---|
| Policy | `phase-1-gate-v1` — `src/lib/phase-1-gate/policy.ts` |
| Status | **Every decision PROPOSED** (12 Oct 2026). Built against; not yet approved. |
| Evaluator | `scripts/gate-phase-1.ts` → `src/lib/phase-1-gate/{load,evaluate}.ts` |
| Tests | `tests/phase-1-gate.test.ts` |
| Evidence ledger | `docs/35-programme-evidence-ledger.md` |

```
staging product ──► human-confirmed HS6 ──► completed global screen ──► deep Country Truth run
                                                                              │
             gate-phase-1.ts reads it all in ONE read-only snapshot ◄─────────┘
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

## 2. Decisions (policy v1 — all proposed)

The first four rows are the audit defaults the owner accepted on 12 Oct 2026 **as proposals to build
against**. The rest were proposed while building the gate. Each is restated with its reasoning in
`policy.ts` (`basis`).

| Decision | Proposed value | Why |
|---|---|---|
| Release posture | Supervised, exporter-facing; agents run screens and deep runs | Matches the staff-only deep request (`country-truth-deep-request.ts`). |
| Archetypes | Rice `100630`, brassware `741810`, carpets `570110` (all HS 2022) | Audit default: rice plus two non-rice archetypes. `830629` (base-metal ornaments) is the alternative brassware line. |
| Market count | ≥ 5 **qualifying** markets per archetype | Audit default. |
| Tariff evidence | ≥ 1 qualifying market per archetype with an **Atlas tariff signal** | Audit default. "Every qualifying market" was considered and not proposed — see §3. |
| Evidence environment | Staging only | A report read from a development or test database must not pass for staging evidence. |
| Classification | Human confirmation by an `agent`, `ops_supervisor` or `admin`, with its confirming `AuditEvent` | `requireCountryTruthClassification` already refuses unconfirmed classifications; the gate also proves who confirmed it. |
| Destination set | The frozen shortlist of a **completed global screen** (docs/31) | A pilot run over hand-named countries cannot evidence global discovery. |
| Confidence floor | `confidence_score` ≥ 40 | See the table below. |
| Freshness | Period lag ≤ 2 years · run completed ≤ 30 days before evaluation · tariff evidence ≤ 180 days old · TARIC ≤ 45 days | Lag mirrors `accepted_reporting_lag_years` (2) and `max_fallback_lookback_years` (2). TARIC is published monthly: 45 days allows one missed edition plus two weeks. Run and tariff ages are new proposals. |
| Evidence completeness | Demand required; growth **or** competition required; every other pillar may be unavailable, **never without a stated reason** | Mirrors `country_truth.scoring_v4` `ranking.require_demand` / `require_growth_or_competition`. |
| Repeatability | Re-verify every stored checksum link; no re-execution replay in v1 | The report keeps every identity a later replay needs. |
| Failure semantics | Run `completed`, or `partial` with an explicit gap; four operator-attested negative probes (§6.3) | Roadmap §8 failure cases. |
| Sign-off | Product owner **and** engineering owner | Roadmap WP1 review roles. |

**Confidence floor, computed.** Under `country-truth-scoring-v4` with default policies (pinned by a test, so
this table cannot silently go stale):

| Evidence | Lag 0 | Lag 1 | Lag 2 |
|---|---|---|---|
| Complete trade statistics only | 48 | 38 | 31 |
| … plus an available tariff | 54 | 43 | 35 |

A floor of 40 admits current trade-only markets and one-year-lagged markets that carry a tariff, and
excludes everything older. Phase 1H pillars (economics, fit, logistics) raise these numbers once an
exporter's commercial facts and operational quotes exist.

**Approving.** In one reviewed PR: set each decision's `status` to `approved`, fill `approval`
(`approved_by`, `approved_at`, `decision_reference` → docs/35), and bump `policy_version` if any value
changed. Never edit an approved version in place: reports cite the policy hash.

## 3. Definitions

**Qualifying market** — an assessment that is `rankable`, `eligible` (no hard blocker), at or above the
confidence floor, within the period-lag limit, has every required component available, and whose
classification is still current. Each non-qualifying market lists its disqualifiers.

**Atlas tariff signal** — the market-access component is available with a tariff rate, every tariff
fact it used resolves to a `MarketAccessEvidence` row, every row and its snapshot have an Atlas origin
(`public_real`, `imported_real`), and every row is within the age limit (TARIC 45 days, others 180)
measured at the **tariff clock**.

**Tariff clock** — the clock tariff evidence was admitted against. Today that is the run's single
assessment clock, which is the screen's as-of date. Once WP2 records a separate market-access clock
(owner decision, 12 Oct 2026), the loader reads `facts_payload.scope.market_access_as_of_date`.

Why "≥ 1 market", not "every market": the Phase 1H tariff calculation (`selectApplicableIndiaTariff`)
publishes a rate only when India's preference is explicitly determined — `confirmed_applicable` with a
rate, or `not_applicable` with an ad-valorem ordinary duty. A preference that needs origin proof, or a
specific (non-ad-valorem) duty, correctly leaves the tariff unavailable. Many Atlas destinations land
there, so "every market" would fail on correct behaviour.

## 4. Evidence matrix

| Dimension | Check | Evidence read | Fails when |
|---|---|---|---|
| Environment | `evidence_environment.required` | `APP_ENV`, `DATABASE_ENVIRONMENT` | not staging |
| Archetypes | `archetype.evidence_supplied`, `classification.matches_archetype` | `ProductClassification.hs6_code`, `nomenclature_version`; `Job.payload.product_classification_id` | no run named; HS6 or revision differs; run made for another classification |
| Classification | `classification.confirmed`, `.confirmer_role`, `.audit_event` | `ProductClassification.status`, `confirmed_by_id`, `confirmed_at`, `superseded_at`; `User.role`; `AuditEvent` (`product_classification`, `after_summary.status = confirmed`) | not confirmed; confirmer not staff; no confirming event |
| Destination set | `destination_set.completed_screen`, `.shortlist_assessed` | `Job.payload.provenance`; `CountryScreeningRun.status`; `CountryEvidencePlan.screening_run_id`; `CountryTradeMetrics.reporter_code` | no screen provenance; screen not completed; plan unbound; shortlist ≠ assessed reporters |
| Failure semantics | `failure_semantics.run_status`, `.no_silent_zero`, `.negative_probes` | `Job.status`, `DiscoveryRun.status`, `Job.result.evidence_status`; `field_provenance` components; probe record | unaccepted or disagreeing status; unexplained `partial`; a score without evidence; probe missing (→ INCOMPLETE) or not fail-closed |
| Evidence completeness | `evidence_completeness.unavailable_has_reason` (+ qualifying filter) | `field_provenance.<component>.available`, `.exclusion_reason` | an unavailable component without a reason |
| Freshness | `freshness.run_age` (+ lag and tariff-age filters) | `Job.completed_at`; `field_provenance.overall_score.period_lag`; `MarketAccessEvidence.retrieved_at` | run older than 30 days |
| Repeatability | `repeatability.stored_checksums`, `.replay` | `CountryTradeMetrics.checksum` and `metrics_payload.manifest_checksum`; `CountryEvidenceManifest.checksum`; `CountryTruthFactSnapshot.facts_checksum` **re-hashed from the stored payload**; the three `MarketAssessment.*_checksum` links | any link missing or different |
| Market count | `market_count.minimum` | qualifying markets | fewer than 5 (reasons tallied) |
| Tariff evidence | `tariff_evidence.atlas_signal` | `field_provenance.market_access.provenance.used_fact_ids`, `.details.tariff_rate_percent`; `MarketAccessEvidence`; `MarketAccessEvidenceSnapshot` | no qualifying market with an Atlas tariff signal (reasons tallied) |
| Sign-off | `sign_off.recorded_outside_evaluator` | docs/35 | — always `manual` |

## 5. Report — `phase-1-gate-report-v1`

Printed as deterministic JSON (keys sorted at every depth): the same evidence and `--evaluated-at` give a
byte-identical report.

- **Top level:** `verdict`, `phase_1_frozen` (always `false`), `evaluated_at`,
  `policy` {`policy_version`, `policy_hash`, `approved`, `unapproved_decisions`, `approval`},
  `environment` {`app_env`, `database_environment`, `database_fingerprint_prefix` (first 12 hex of the
  identity fingerprint, never the pin), `git_commit`}, `summary` {`archetypes_required`,
  `archetypes_passed`, `failed_checks`, `unverified_checks`}, `programme_checks`, `archetypes`,
  `report_checksum`.
- **Per archetype:** `selector`, `selection_note`, `result`; `identities` (product, classification and
  revision, confirmer role and time, job, screening run and policy hash, evidence plan and key,
  manifest and checksum, discovery run, scoring policy version and hash); `run` (scoring clock, status,
  created/completed, elapsed seconds, attempts, deep-run and screening provider calls, evidence status,
  period set); `counts` (assessed, rankable, qualifying, qualifying with an Atlas tariff signal);
  `checks`; `markets`.
- **Per market:** `country_code`, `assessment_id`, `qualifies`, `disqualifiers`, state, eligibility,
  overall and confidence scores, period lag, `unavailable_components` (each with its reason), `tariff`
  {signal, rate, basis, cited evidence and snapshot IDs, providers, authority versions, oldest evidence
  age, reasons}, `checksums`.

Every check is `{id, dimension, status, detail, reasons}` with status `pass`, `fail`, `unverified`,
`not_required` or `manual`.

## 6. Runbook

### 6.1 Preparing one archetype on staging

1. Create the archetype's product under a staging exporter that an agent is assigned to (the
   `[PILOT]` exporters from `scripts/staging-pilot.ts seed` are suitable), through the portal.
2. Propose and **confirm** its classification as an agent — the confirmation writes the `AuditEvent` the
   gate requires. HS6 and revision must match §2.
3. Request a **global screen** and let it complete (about 218 metered Comtrade calls on the shared
   development key — docs/31).
4. Request **Deep Country Truth from that screen** and let the worker finish it (about 11 calls per
   shortlisted market). Note the job id.
5. After WP2: the deep run acquires Customs Atlas tariff evidence itself. Until then, tariff evidence
   exists only where a snapshot was ingested before the screen's as-of date.

### 6.2 Running the gate

```
npx tsx --env-file=<staging operator env> scripts/gate-phase-1.ts \
  --archetype=rice=job:<jobId> --archetype=brassware=product:<productId> --archetype=carpets=job:<jobId> \
  --negative-probes=<probes.json> --out=<report.json>
```

- The operator env is the staging variable set with TCP-proxy database URLs (docs/33 §3). It lives only
  in the gitignored `tmp/rw/`. The script prints no secrets.
- It refuses production, validates the staging database identity pins first, and reads everything in one
  `REPEATABLE READ, READ ONLY` transaction: PostgreSQL rejects any write.
- `product:<id>` selects the newest completed/partial screen-derived deep run for the product's current
  confirmed classification, and says so in `selection_note`. Name a `job:<id>` to pin an exact run.

### 6.3 Negative-probe record

A JSON array; each entry `{id, method: staging_observation|ci_test, reference, observed_at, outcome:
refused|failed_closed|reported_unavailable, recorded_by, notes?}`. The gate checks completeness and that
the outcome failed closed; it **cannot** check that the probe happened, so `reference` must be something
a reviewer can re-read (a correlation id or AuditEvent id on staging, or a CI test name with its run URL).

| Probe id | What must be shown |
|---|---|
| `unconfirmed_classification_refused` | A deep request for a product without a confirmed classification is refused before analysis. |
| `incomplete_screen_refused` | A deep request naming a screen that is not `completed` is refused (`screening_incomplete`). |
| `provider_failure_not_minted_complete` | A provider failure or quota stop leaves the run retryable; no complete manifest is minted from a partial batch. |
| `missing_tariff_reported_unavailable` | A market without admissible tariff evidence shows market access unavailable with a reason, never a zero tariff. |

### 6.4 Evidence capture and retention

- Keep each report JSON under the gitignored `.artifacts/phase-1-gate/<date>/` on the operator machine.
- Record `verdict`, `report_checksum`, `policy_hash`, the job IDs and the run's provider-call counts in
  docs/35. The checksum is what reviewers sign.
- A rerun is a new report; never edit an old one. Rerun after a new deep run, a policy change, or when a
  run passes 30 days.

### 6.5 External dependencies

UN Comtrade (shared development key and quota until WP5), Customs Atlas releases (EU TARIC monthly via an
EU Login holder; Korea by manual download — docs/customs-atlas), and staging database access through the
Railway TCP proxy.

## 7. Known limits

- Operator-attested probes are checked for completeness and outcome only.
- v1 does not re-execute runs; checksum links are re-verified instead.
- The gate has not yet been run against staging: that needs WP2 (Atlas orchestration) and WP3 (the three
  archetype runs).
