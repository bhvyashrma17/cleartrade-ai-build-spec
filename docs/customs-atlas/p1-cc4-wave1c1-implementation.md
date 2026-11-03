# Wave 1C.1 — operational closure, and what the gate found

Follows `p1-cc4-wave1c-implementation.md`. Earlier predictions are left as written.

The purpose of this wave was to close the operational gaps before scaling Customs Atlas in 5–10
pack batches. It closed three of them and **found a fourth that was worse than any of them**.

## Headline: EU TARIC fails the memory ceiling

Making qualification enforceable meant running it against every bulk family for the first time.
TARIC — the largest source in the Atlas, serving all 27 EU destinations — **fails**:

| | Measured (September 2026 extraction) |
|---|---|
| Source | 26 MB archive, 31 MB decompressed |
| Rows | 410,161 |
| Peak RSS | **931 MB — 90.9% of the 1 GiB worker** |
| Attributed RSS | 721 MB |
| Retained heap | 681 MB |
| Retention ratio | **23.5× the source** |
| Verdict | **FAILED** (ceiling 717 MB) |

The 23.5× ratio is the signature the gate was built to detect, and it is the same shape as the
pre-fix New Zealand defect: `readTaricBundle` materialises every sheet as `string[][]` up front and
holds them all. `parseSheets` does not gate this — it defaults to on, and the service calls the
reader with no options, so **this is exactly what the production query path commits**, not a
worst-case synthetic.

Why it has not already caused an outage: one active release, decoded lazily on the first EU query,
then cached. It has been surviving on the margin, one GC transient away from the NZ failure mode.

**Contained, not fixed.** TARIC's decoded-bundle cache is reduced from 2 to 1: at 681 MB retained
per bundle, holding two across a release rollover would be ~1.36 GB — a guaranteed OOM rather than
a risk of one. The reader's memory architecture still needs the same treatment NZ got (build rows
while walking; do not retain a full intermediate copy). That is deliberately **not** attempted here:
TARIC serves 27 destinations, and a rushed rewrite of its reader risks correctness bugs far worse
than the memory risk. It is the top item for the next wave.

The gate now records the failure and will **block re-activation of any TARIC release** until it
passes. Existing evidence is unaffected.

## Australia — complete

96/96 chapters imported and active (was 6).

| Metric | Value |
|---|---|
| Chapters discovered / attempted | 96 / 96 |
| Imported first pass | 93 |
| Failed first pass | 3 (transient staging transaction timeouts) |
| Imported on re-run | 3 |
| Final failed | 0 |
| Rows | 6,707 |
| Peak RSS | 165 MB |

The three failures are worth recording rather than smoothing over: they were transient database
timeouts, each isolated to its own chapter, and a re-run picked up exactly those three and no
others. That is the failure-isolation and resumability the loop was designed for, exercised for
real rather than asserted.

Broad canaries, all passing technical qualification, across eight chapters:

| Archetype | HS6 | Resolution | General duty |
|---|---|---|---|
| food/agriculture | 100630 | exact | Free |
| metals | 740710 | exact | Free |
| machinery | 847989 | refinement required | — |
| electrical | 854449 | refinement required | — |
| chemicals | 291511 | exact | Free |
| apparel | 610120 | exact | 5% |
| vehicles | 870323 | refinement required | — |
| beverages | 220300 | refinement required (12 candidates) | — |

## Canada — qualified

The Wave 1C hole is closed. Downloading a URL cannot reach Canada, whose release is a composite
assembled at acquisition time from two CBSA endpoints, so qualification now runs against the
**retained artifact** — strictly more faithful than a fresh download, because those are the exact
checksum-verified bytes the worker decodes.

Real T2026-2: 1.18 MB bundle → 24 MB materialised Access database, 22,461 rows, **268 MB peak
(26.2%)**, 280 ms. **PASSED**, comfortably.

## Concurrency — measured, and the answer was structural

`MAX_BULK_DECODES_PER_WORKER = 1`, on evidence rather than caution.

| Test | Peak RSS |
|---|---|
| NZ alone | 597 MB |
| CA + NZ + JP, concurrency 2 | 625 MB |
| CA + NZ + JP, concurrency 3 | 636 MB |
| **NZ × 2 overlapping (true worst case)** | **598 MB** |

Two overlapping decodes of the largest adapter measured the same as one. They did not overlap at
all, for two independent reasons: the worker claims exactly one job and awaits it to completion
before looping, and the NZ/Japan readers are synchronous functions that never yield the event loop
mid-decode. Mixing different adapters *understates* the worst case, because their durations differ
by an order of magnitude (NZ ~835 ms, Japan ~25 ms) so they rarely peak together — hence the
`--repeat` mode that overlaps copies of the same adapter.

**No semaphore was added.** A lock guarding a condition that cannot currently arise is machinery
that can strand jobs for no benefit. Instead both properties are pinned by test, so introducing
worker concurrency has to consciously confront the single-decode memory budget rather than silently
invalidating every recorded ceiling.

## The standing gate

`AuthorityReleaseQualification` (append-only, forward-only migration) records release identifier,
parser version, archive checksum, row count, peak RSS, ceiling, concurrency and status.

A bulk release is operationally trusted only while a qualification exists that matches its
**current** parser version and checksum, and did not fail. Qualification is invalidated by a parser
change, different archive bytes (which covers "the source grew" without a size heuristic), never
having been run, or a previous failure.

Enforced at **activation**, not in CI — requiring a real archive decode on every `npm test` would
make the suite depend on government web servers. Bulk families additionally may not
activate-on-import at all, because qualification needs the stored artifact: the order is
**import → qualify → activate**. An `acknowledge_unqualified` override exists for emergencies and is
recorded on the activation audit event.

Live verdicts after this wave:

| Family | Trusted | Reason |
|---|---|---|
| CA_CBSA | yes | qualified (passed) |
| NZ_CUSTOMS | yes | qualified (warned) |
| **EU_TARIC** | **no** | **last run failed** |
| JP_CUSTOMS | yes | not required (per-chapter pages) |
| AU_ABF | yes | not required (per-chapter pages) |

## Cache audit

| Provider | Finding |
|---|---|
| EU TARIC | **Unbounded `Map` — fixed**, and then bounded to 1 on measured retained heap |
| Canada, NZ, Japan, Australia | Already bounded in Wave 1C |
| UK, US | No module-level cache — live API providers, nothing retained |

Everything else matching `new Map`/`new Set` in the market-access tree is either function-local or a
frozen constant lookup. TARIC was the only real hazard remaining, and it was the most dangerous one.

## New Zealand

Re-measured on staging: **628 MB (61.4%), WARNED** — it crossed the 60% comfort line on this run,
having measured 552–597 MB on others. Run-to-run variance puts it right at the line. It passes, but
it is the adapter with the least room for source growth, and NZ's archive grows nightly.
