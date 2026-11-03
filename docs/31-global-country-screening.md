# Global Country Screening (Phase 1F, Stage A)

Phase 1A–1E answers "how good is this market for this product?" for a market someone already
named. Phase 1F removes the naming step: given one confirmed `ProductClassification`, it decides
which countries in the world are worth spending deep Country Truth quota on.

```
confirmed ProductClassification
  → Stage A global screening        (this document)
  → shortlist, ~20 markets
  → existing CountryEvidencePlanner → CountryEvidenceManifest → CountryTradeMetrics
  → Country Truth v4
```

Stage A is not an attractiveness score and must never be presented as one. It sees exactly one
signal — the latest usable World import value for the confirmed HS6, by reporter — and nothing
about growth, competition, market access, export economics, logistics or risk. Those arrive
downstream, from the pipeline that already computes them.

## Two identity systems, deliberately separate

**Geographic identity** is ISO-3166 alpha-2/alpha-3 and the UN M49 numeric, from the snapshot
`src/lib/comtrade/areas.ts` already uses. World and every regional, economic and miscellaneous
partner aggregate have no entry there, so they are absent by construction rather than by blocklist.

**Provider reporting identity** is the UN Comtrade reporter code, and it comes from the provider's
own reference — `src/lib/comtrade/reporter-registry.ts` over the verbatim snapshot in
`reference/comtrade-reporters.json`, captured from the public, keyless
`https://comtradeapi.un.org/files/v1/app/reference/Reporters.json` (the same reference host the
client already reads HS.json from; no trade observation, no authenticated quota).

The two are not interchangeable, and inferring one from the other was a real defect. Phase 1F
originally derived reporter codes by inverting `COMTRADE_LEGACY_AREA_TO_ISO2` and produced **381
for Italy**; the provider lists Italy as **380** and lists no reporter or partner under 381 at all.
Italy would have screened as `unavailable`, silently, with no error anywhere. An alias map reads
area codes that are already sitting in stored evidence; it is not an authority on who may be asked
a question.

Only five countries diverge from M49, all confirmed against the reference: FR 251, IN 699, NO 579,
CH 757, US 842. Historical rows (`entryExpiredDate`), aggregates (`isGroup`) and rows with no ISO
identity are kept as explicit aliases, never as canonical identity. The registry fails closed: a
country with two live reporters, or a reporter that does not round-trip through `toIso2`, is
recorded as an anomaly and excluded rather than guessed at.

## The screening universe

A market is screenable only when a geographic identity and a live reporter identity both exist.

| Exclusion reason | What it removes | Count |
|---|---|---|
| `no_provider_reporter_identity` | ISO countries UN Comtrade has no reporter for | 23 |
| `no_resident_population` | AQ, BV, GS, HM, IO, TF, UM — no civilian population, no customs administration | 7 |
| `not_un_m49_identity` | ISO user-assigned codes M49 never assigned — XK/983 | 1 |
| `origin_country` | India. ClearTrade exports *from* India | 1 |

**218 screening markets** result from the default policy, out of 250 ISO country/area identities
and 219 live provider reporters (219 minus India as origin).

These are *screening markets*, not "sovereign countries", and the distinction is load-bearing.
The set deliberately contains separately reporting customs and economic territories — Hong Kong
(344) and Macao are real, separately reporting export destinations. Sovereignty is not a property
either source records, so nothing in this system asserts it. The 23 excluded markets are excluded
on a provider fact, not a political one: Taiwan reports inside the "Other Asia, nes" aggregate
(490), Puerto Rico / US Virgin Islands / Guam / American Samoa inside USA 842, Liechtenstein inside
Switzerland 757, Monaco and the overseas departments inside France 251, Svalbard inside Norway 579.
The provider's own coverage notes say so, and they are stored on each entry as provenance.

An excluded market is named with its reason rather than left to resolve as `unavailable`, so a
market that cannot be asked is never mistaken for a market with no demand.

## Country Screening Policy v1

`country_screening.policy` (`src/lib/config.ts`), versioned through `ConfigSetting` like every
other Country Truth policy. It carries the universe version, the reporter-registry version, the
exclusions, the shortlist target and maximum, the minimum evidence requirement, freshness, the
required parser and normalization versions, the ranking identity, the demand transformation band,
the tie-break rule, and the per-country acquisition attempt cap. Nothing that changes a screening
outcome lives outside it.

A run freezes `policy_hash` (over the policy plus its config version), `universe_checksum`,
`reporter_registry_version`, `reporter_registry_checksum`, and the full universe snapshot.
Execution reads that frozen snapshot and never live config, so a resumed run cannot silently
change its own rules — a policy or registry change produces a *new* run instead.

## Cache identity

A reporter code is inside the canonical Comtrade request, so moving one moves the
`request_fingerprint`: evidence acquired under Italy 381 can never be read back as Italy 380. The
registry checksum is inside the run definition, so it also moves the `run_key` and every
per-country `result_key`. A refreshed provider reference therefore opens a new run rather than
reinterpreting a completed one, and a completed run's results stay frozen as history.

Reuse of genuinely compatible evidence is preserved: changing a policy field that does not change
the question — the shortlist size, the minimum demand threshold — opens a new run that cites the
same immutable `SourceEvidence` and `NormalizedTradeObservation` rows and spends nothing.

## Evidence

One request per country: reporter, partner World, annual frequency, the confirmed HS6, one
period. The canonical request is byte-identical to the deep plan's latest-year
`WORLD_IMPORT_HISTORY` item, so the two share a `request_fingerprint`: a screen warms the deep
plan's cache and evidence the deep pipeline already holds costs a screen nothing. There is no
second evidence architecture — `SourceEvidence` → parser → `comtrade-normalization-v2` →
immutable `NormalizedTradeObservation` is the only path, and evidence lookup is scoped by the
origin derived from the run's frozen source mode, so fixture and preview evidence can never
satisfy an authenticated screen.

Result statuses are explicit and never collapse to zero: `eligible`, `below_minimum_demand`
(a real observation, including an observed zero, under the policy minimum), `insufficient_evidence`
(including a complete response with no World row — absence is not zero), `suppressed`,
`unavailable`, `stale`, `incompatible`, `deferred_quota`, `failed`, `pending_acquisition`.

## Rank and shortlist

`screening_score` is the same log10 band the v4 demand component uses, over one observed value and
two policy constants — auditable from persisted evidence, with no model and no LLM anywhere in the
path. Ranking is total and order-independent: score desc, then exact import value desc, then
numeric reporter code. The shortlist is the top `shortlist_target_size` (default 20) eligible
markets, or fewer when fewer qualify; it is never padded.

## Quota, resumability, handoff

`estimateGlobalCountryScreeningQuota` answers, before any provider is touched: countries
considered, evidence already reusable, countries requiring acquisition, estimated logical requests,
estimated physical authenticated calls, available quota, whether the whole screen can execute, and
what would remain after a partial run. It reads the same `ProviderQuotaWindow` ledger the deep
pipeline reserves against.

Every country's state is a row, so a restarted worker, a retried job, a duplicate execution or a
quota-exhausted run resumes exactly where it stopped and re-costs nothing. Quota exhaustion and
provider failure are applied *after* re-resolution, because resolving over them would downgrade
unattempted work to a terminal `unavailable` and let the run complete. A completed run and its
results are immutable in the database.

`planDeepCountryTruthFromScreening` hands the shortlist to the existing `CountryEvidencePlanner`
as its candidate reporter set. It refuses an incomplete screen unless the caller explicitly asks
for a provisional handoff, because deep analysis costs roughly eleven provider calls per market.

## Phase 1G seam

Phase 1F evaluates exactly one screening period, chosen by the same annual release rule as
`country_evidence.policy`. `period_fallback_lookback_years` must be `0` and the planner fails
closed if it is not: the per-country latest-usable-period walk is Phase 1G's, under its own policy
version. `CountryScreeningResult.observation_period` is already per-country and nullable, so Phase
1G needs no schema change and UAE's current missing-data behaviour is unchanged.

## Operational notes

**Refreshing the reporter snapshot.** Replace `src/lib/comtrade/reference/comtrade-reporters.json`
with the verbatim response body, update `COMTRADE_REPORTER_REFERENCE_SOURCE` (last-modified, etag,
retrieved_at, sha256), and bump `COMTRADE_REPORTER_REGISTRY_VERSION`. The registry test asserts the
checksum, so an edited snapshot fails the suite rather than shipping. Existing completed runs are
untouched: the new registry checksum produces new run keys and new request fingerprints.

**Concurrency.** The job queue's atomic claim and the dedupe key already make two simultaneous
executions of one screen unreachable, but the persistence layer does not rely on that. Racing
creations converge on the unique `run_key`, and an execution that loses the completion race
recognises the immutability trigger's own refusal and returns the winner's run instead of failing
the job. The triggers, not a lock, are what guarantee the data.

**Known conservative behaviours.** Evidence lookup inspects the five most recent responses for a
fingerprint, matching the deep resolver exactly; a country with more than five superseded partial
responses would be re-acquired rather than reusing an older complete one. That costs a request, and
never fabricates a value. Quota estimation constructs the Comtrade client to read its identity, so
it requires the same client configuration acquisition would — it makes no provider call.
