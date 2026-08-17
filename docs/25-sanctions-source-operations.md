# Sanctions source operations

How the four required sanctions datasets are retrieved, retained, scheduled and observed —
and, just as importantly, which decisions this document does **not** make.

Screening semantics (matching, review workflow, fail-closed behaviour) are unchanged by
anything here and are not restated. This is about the supply of data to that gate.

## 1. Required datasets

| Dataset | Authority | Why it is separate |
|---|---|---|
| `ofac_sdn` | OFAC | The SDN list. |
| `ofac_non_sdn_consolidated` | OFAC | OFAC publishes SSI, CMIC/EO13959, CAATSA-RUSSIA, HKAA and NS-PLC in a *separate* artifact. When only SDN was screened, 388 of 481 active non-SDN designations were invisible — 93 overlapped. Screening "OFAC" therefore requires both files. |
| `eu_financial_sanctions` | EU | Consolidated financial sanctions list. |
| `un_security_council` | UN | Consolidated list: 736 individuals + 275 entities = 1,011. |

An authority counts as covered only when **all** its datasets are complete and fresh
(`authorityCoverage()`). A green "OFAC" indicator with a failing member dataset is exactly
the failure this rollup is designed to prevent.

## 2. Raw artifact retention

A checksum proves two byte strings are identical; it does not retain the bytes. If an
authority republishes a file, a checksum-only record cannot show what was actually screened
against — which is the question an audit asks. So the raw artifact is persisted.

- Stored through the existing provider-neutral `DocumentStorage` (`local` | `s3`), not a
  second storage system, and **not** through `secureUpload()` — that path's MIME allow-list
  and malware scan are built for user-supplied documents and would reject a 28 MB government
  XML outright.
- Object key: `sanctions/<dataset>/<year>/<32 hex>.xml`. Contains no sanctions record names,
  no secrets, and no provider query credentials; the random component is collision-resistant.
- Private objects only. Server-side encryption is requested where the adapter supports it. No
  public ACLs are created and no direct public object URL is ever returned.
- **Post-write verification**: the object is re-read and its SHA-256 recomputed. A mismatch
  refuses activation. Where an adapter cannot read back, the status is `unsupported` — never
  `verified`. We do not record an integrity check that did not happen.

### Retention is fail-closed where it matters

`SANCTIONS_REQUIRE_ARTIFACT_RETENTION` forces the requirement on or off; unset, it defaults to
"required in staging/production" via `isRealWorkflowEnvironment()`. When retention is required
and persistence or verification fails, the candidate snapshot **does not activate** and the
previous COMPLETE snapshot keeps serving.

### Historical snapshots

Snapshots activated before retention existed have `artifact_ref = null` and have been left
that way. Backfilling a reference would claim a retention that never occurred. The current
active snapshots carry real artifacts because the datasets were retrieved again through the
normal path (`npm run sanctions:refresh-retained`), not because history was relabelled.

## 3. Scheduling and concurrency

Two ideas are kept strictly apart, because conflating them turns a compliance control into a
timer:

- **Refresh cadence** — how often we *ask* the provider. Operational, tunable, per-dataset
  (`SANCTIONS_REFRESH_HOURS`, `SANCTIONS_REFRESH_HOURS_<DATASET>`; default 12h).
- **Freshness threshold** — how stale data may be before screening fails closed
  (`SANCTIONS_MAX_AGE_DAYS`, default 2). A policy control, still unratified (§6).

Refreshing more often does not widen the freshness tolerance; lengthening the cadence does not
make stale data acceptable.

### The tick

`npm run sanctions:schedule` is safe to run as often as convenient (hourly is fine). It is not
the cadence: it asks which datasets have actually elapsed their interval and enqueues only
those. `--dry-run` reports without enqueueing.

`next_refresh_at` is derived from the last **attempt**, not the last success — otherwise a
persistently failing source would be retried in a tight loop, which is precisely the hammering
this is meant to avoid.

### Mutual exclusion

Three independent mechanisms, in increasing order of authority:

1. The tick skips a dataset whose lease is currently held.
2. `enqueueJob` dedupe keys collapse two ticks in the same cadence window into one job.
3. **The lease is the real control.** `SanctionsRefreshLease` has `dataset` as its primary
   key, so a second concurrent acquire fails outright. An expired lease is stolen through a
   conditional `updateMany` whose WHERE re-asserts expiry, so of two workers racing to
   reclaim, exactly one wins.

And beneath all three, the database itself:

```sql
CREATE UNIQUE INDEX "SanctionsSourceSnapshot_one_active_per_source"
  ON "SanctionsSourceSnapshot"("source") WHERE "state" = 'active';
```

Two active snapshots for one dataset are not merely avoided by application logic — they are
**unrepresentable**. This is the invariant every concurrency test asserts.

### Crash recovery

| Crash point | Result |
|---|---|
| After retrieval, before persistence | No candidate exists. Nothing activated. Next tick retries. |
| During artifact persistence | Candidate not activated; incumbent keeps serving. An orphaned object may exist in storage — harmless, and cheaper than a partial activation. |
| After candidate creation, before activation | Candidate remains `candidate`. Screening reads only `active`, so it is invisible to the gate. |
| Holding a lease | The lease expires (`SANCTIONS_LEASE_TTL_MINUTES`, default 30) and the next tick reclaims it. A dead worker cannot lock a dataset permanently. |
| Mid-download of a large artifact | The body read is inside the retry boundary; it surfaces as a `retrieval` failure, not a parse failure. |

No recovery path can produce two active snapshots, and none silently downgrades coverage:
a failed refresh leaves the previous COMPLETE snapshot serving and is reported as such.

### Provider backoff

Retries are exponential. `408`, `429` and `5xx` are retryable; other `4xx` are not — retrying
a request the provider has rejected on its merits returns the same rejection. A `Retry-After`
header (delta-seconds or HTTP-date) is honoured, but only ever to wait **longer** than our own
backoff, capped at 10 minutes so a hostile or absurd value cannot park a worker and its lease
indefinitely. A provider cannot use `Retry-After` to make us retry sooner.

## 4. Operational visibility — `/ops/sanctions`

Restricted to `ops_supervisor` and `admin`, behind the `/ops` portal gate. Exporters, agents,
ops-finance and unauthenticated callers are all denied; this is asserted in tests, not assumed.

Everything shown is computed **server-side** in `sanctionsSourceHealth()` from the same
`sanctionsCoverage()` call that gates screening. The page renders and derives nothing. A
dashboard that recomputed policy could disagree with the gate that actually blocks buyer
screening, and would then be worse than no dashboard.

- **Global state**: `READY` / `DEGRADED` / `BLOCKED`, with the specific reasons named.
  `DEGRADED` means coverage is intact but a refresh failed. It cannot read `READY` while
  coverage is incomplete — asserted directly.
- **Per dataset**: lifecycle, completeness, provider publication date and version, retrieval
  and last-complete-refresh timestamps, age against threshold, retrieved/parsed/rejected
  counts, parse errors, anomalies, abbreviated checksum, artifact retention and verification
  status, cadence and next refresh.
- **Refresh failures** are stated in words — "Serving previous COMPLETE snapshot — the latest
  refresh failed at the *retrieval* stage" — rather than left to be inferred from timestamps.

The page shows no sanctioned-party names, no raw XML and no artifact URLs. It is a source
operations view, not a data browser.

### Metrics

`/api/metrics` (bearer-token protected) reports one row per required dataset plus the global
state — fixed cardinality. It previously returned every snapshot ever created, which grew by
four rows per refresh forever. Labels are dataset, authority, and lifecycle/completeness
enums. Never emitted: sanctioned-party names, raw XML, object keys, signed URLs, credentials,
full checksums.

## 5. Runbook

```bash
npm run sanctions:schedule -- --dry-run   # what is due, enqueue nothing
npm run sanctions:schedule                # enqueue due datasets
npm run sanctions:refresh-retained        # force all four now, retention mandatory
npm run ingest:sanctions                  # legacy: refresh everything immediately
```

Environment:

| Variable | Default | Meaning |
|---|---|---|
| `SANCTIONS_REFRESH_HOURS` | `12` | Cadence for all datasets. |
| `SANCTIONS_REFRESH_HOURS_<DATASET>` | — | Per-dataset override, e.g. `SANCTIONS_REFRESH_HOURS_OFAC_SDN`. |
| `SANCTIONS_LEASE_TTL_MINUTES` | `30` | Must exceed a slow refresh; self-heals after a crash. |
| `SANCTIONS_REQUIRE_ARTIFACT_RETENTION` | env-derived | Forces retention on/off. Required in staging/production. |
| `SANCTIONS_MAX_AGE_DAYS` | `2` | Freshness threshold. **Policy, not cadence** (§6). |

**A dataset is BLOCKED.** Read the named reason on `/ops/sanctions`. Buyer screening is
already failing closed; that is the control working. Do not activate a snapshot manually and
do not widen `SANCTIONS_MAX_AGE_DAYS` to clear it.

**A dataset is DEGRADED.** The previous COMPLETE snapshot is serving. Check the failure stage:
`retrieval` is a provider problem (wait for cadence, check the provider's status),
`parsing`/`completeness` suggests the provider changed the artifact shape and the contract
needs review.

**A refresh appears stuck.** Check `refresh_in_progress`. A lease from a dead worker expires
within its TTL and the next tick reclaims it; leases are not deleted by hand.

## 6. What is NOT decided here

These are compliance determinations. Engineering defaults are deliberately conservative and
are labelled `pending_policy_approval` in the product itself, not silently treated as settled:

- **The required dataset set.** Adding `ofac_non_sdn_consolidated` closed a measured coverage
  gap and can only make screening stricter. Whether non-SDN designations are *legally*
  required for this product's jurisdictions is not an engineering call.
- **The freshness tolerance.** Two days is an engineering default, not a ratified control.
- **Exact-identifier matches being definitive.** This records existing behaviour truthfully;
  it has not been ratified.
- **Reviewer SOP and training** for the possible-match queue.

Name similarity remains review-only and can never auto-confirm a match.
