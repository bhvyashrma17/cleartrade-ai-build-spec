# Latest Usable Period (Phase 1G)

ClearTrade used to ask *"does this country have the globally newest year's data?"*. That question
silently favours statistics offices that file early. A 2025-only global screen of HS 100630
excluded the UAE, Iraq, Iran, Oman, Qatar and Yemen — several of the largest markets for the
product — not because they lack demand but because they had not filed yet.

Phase 1G asks the better question: **what is the latest sufficiently recent, authoritative, usable
annual evidence this country actually has?**

```
preferred year 2025
      ↓ usable?
      ├── yes → use 2025            (lag 0, confidence 1.00)
      └── no  → inspect 2024
                ├── usable → use 2024   (lag 1, confidence 0.80)
                └── no → inspect 2023
                          ├── usable → use 2023 (lag 2, confidence 0.64)
                          └── no → stale, not selectable
```

Provider-backed only. Nothing interpolates, forward-fills or invents a value; the walk chooses
*which real observation to use* and records how old it is.

## Country Period Selection Policy v1

`country_period_selection.policy` — versioned through `ConfigSetting` like every other Country
Truth policy, hashed into the run identity, and read from the run's frozen snapshot during
execution rather than from live config.

Both numeric constants are **derived from policy this repository already held**, not invented:

| Constant | Value | Derived from |
|---|---|---|
| `max_fallback_lookback_years` | 2 | `discovery.scoring.confidence.accepted_reporting_lag_years` |
| `recency_decay_per_year` | 0.8 | `discovery.scoring.recency_decay_per_year` |

## Four semantics that are each a separate branch

| Situation | Behaviour | Why |
|---|---|---|
| **Observed zero** | Terminates the walk | The market was measured. Searching past it until a non-zero year appears would manufacture demand that does not exist. |
| **Suppressed** | Stops the walk, reported `suppressed` | The provider says a value exists and is withheld. Walking back would leak information about it by proxy. |
| **Provider failure** | Stops the walk, stays retryable | Our outage is never evidence about a country. |
| **Not yet probed** | Pauses and names the next year | An unprobed year is not an absent year. This is what makes acquisition incremental. |

## Incremental waves, not a global 3× fetch

`executeGlobalCountryScreeningRun` runs at most `lookback + 1` waves. Wave 0 asks every market
about the preferred year; each later wave asks **only the markets still unresolved**. A market
drops out the moment it has a usable answer, and a market that failed is not retried inside the
same execution — a failure blocks the walk rather than advancing it.

For a 218-market universe where 96 answer at the preferred year, wave 1 asks 122 and wave 2 asks
only those still empty. The attempt budget is `max_acquisition_attempts_per_country × (lookback + 1)`,
because a walk legitimately spends one attempt per year it inspects.

## Mixed-vintage ranking

Once some markets are selected on 2025 data and others on 2023, comparing raw values alone would
let a lagging market outrank a current one purely on growth or inflation between the years. Two
numbers are kept and both persisted:

- **`screening_score`** — raw demand magnitude, a pure function of the observed value. Never
  discounted; comparable across runs.
- **`selection_score`** — that score × evidence confidence. **The only thing ordering and
  shortlist selection use.**

The provider's value itself is never altered: a market on two-year-old evidence reports exactly
what the provider said it imported in that year. Tie-breaking is total: selection score, then raw
score, then exact value, then fresher evidence, then numeric reporter code.

## Per-reporter deep analysis windows

A market selected on 2023 evidence would previously be handed to a deep planner that demanded
2021–2025 and failed it again for the same reason it was shortlisted late. Now
`planDeepCountryTruthFromScreening` derives each market's window from its own selected year:

```
Germany selected 2025 → deep history 2021–2025 → supplier distribution 2025
UAE     selected 2023 → deep history 2019–2023 → supplier distribution 2023
```

Every dimension of a reporter's package is pinned to that reporter's own latest year, so supplier
HHI cannot divide one year's suppliers by another year's denominator and India share cannot cross
years. `item_key` is hashed over the reporter's **own** window, so one market's fallback can never
shift another market's item identities.

Missing intermediate years stay missing. `assertConsecutivePeriodSet` refuses a gapped window at
plan time, because the growth family (CAGR, momentum, trend, volatility) divides by interval
counts derived from the array's length and would otherwise label a gapped span "per year".

## Freshness affects confidence, never attractiveness

v4 confidence is now `coverage_confidence × recency_decay^lag`, under
`weighted_component_evidence_coverage_and_recency_v5`. A country scored through 2023 is not a
worse market than one scored through 2025 — we are simply less certain its recorded demand still
holds. `overall_score` is untouched. The lag, the recency weight, the pre-decay coverage
confidence and the reporter's own latest year are all frozen into assessment provenance.

## Historical runs are untouched

The completed Phase 1F 2025-only run is immutable and stays exactly as it was. Its
`period_selection_policy_version` reads `unversioned_pre_phase_1g` — an explicit marker rather
than a fabricated identity — and a Phase 1G screen is a **new run** under a new
`run_key`, because the period policy hash is part of the frozen definition.

## Prerequisite fixed on the way in

`ensureCurrentComtradeNormalization` used to **relabel** rather than re-normalize: it copied
`trade_value_status` and every other semantic field forward from the previous version's rows and
stamped the new version on top. A parser change would therefore have minted rows whose version
label was a lie, and every downstream assertion would have passed. Since Phase 1G's entire
fallback decision rests on trusting `trade_value_status` to tell `observed_zero` from `missing`,
that had to be fixed first. The parser is now its own module (`src/lib/comtrade/parser.ts`), used
by both the acquisition path and re-normalization, which re-parses the immutable
`raw_response_text` and **fails closed** on any body it cannot re-derive.

## Defects found by adversarial review and fixed

Two independent review passes attacked the finished implementation. Six verified defects were
fixed; each now has a regression test.

| # | Defect | Consequence if shipped |
|---|---|---|
| 1 | `item_key` was narrowed to one reporter's window, making it byte-identical across plans whenever a window matched — while `item_key` is **globally** unique | The second deep plan for the same product died on a `P2002` constraint violation. Item identity now hashes the whole plan definition; letting one reporter's fallback shift another's key costs nothing, because evidence is reused by `request_fingerprint`, never by item key. |
| 2 | The v4 recency weight used integer rounding: `Math.round(0.8²) = 1` | The decay was **inert** for lags 1–3 and then cliffed a fully-evidenced market to **zero confidence** at lag 4. The weight is now kept at four decimals and only the product is rounded. |
| 3 | `period_lag` was measured against the plan's newest reporter rather than the preferred period | A country's confidence depended on who else happened to be shortlisted — add a current market and a lagging one's confidence changed with no change to its own evidence. The plan now freezes `preferred_period`. |
| 4 | A provider failure nulled `next_probe_period` and was re-asserted at the preferred year | The walk lost its position: acquisition re-bought a year already known absent while the real blocker was never retried, burning the attempt budget until the market was permanently `failed`. |
| 5 | A lagging reporter's own latest year was billed on the preferred period's 90-day freshness clock | A closed year that can never change would be re-acquired every quarter — for exactly the lagging markets this phase exists to serve. |
| 6 | The metrics dedup key covers neither `period_set` nor payload schema | A manifest scored before the deploy silently returned pre-1G rows as though freshly recomputed. A checksum mismatch now throws instead of drifting. |

Also fixed: a raw `Date` canonicalized to `{}` and dropped out of the manifest checksum entirely;
`recent_momentum` fabricated a `-100%` on a one-year window; a stored scoring config row could
advertise the pre-recency formula while the recency maths ran; and a single unparseable evidence
row aborted resolution for all 218 markets instead of degrading its own.
