# Wave 1C — Japan schedule completion, Australia, and the bulk-memory gate

This record follows `p1-cc4-wave1-implementation.md` (Canada) and the Wave 1B record. Earlier
predictions in those documents are left exactly as written, including where they turned out wrong;
this file adds what actually happened rather than editing history.

## Outcome

| Destination | Before Wave 1C | After Wave 1C |
|---|---|---|
| Japan | 1 chapter (ch29, schedule `2026_04_01`) | 96 chapters, schedule `2026_08_08` |
| Australia | not implemented | implemented, routed, canaried |
| Korea | stopped, `credential_not_provisioned` | unchanged — still stopped, same reason |
| Israel | not assessed | stopped, rights unresolved **and** automated access refused |
| Philippines | not assessed | stopped, no documented machine interface |

Operational destinations went from 32 to 33 (EU-27, GB, US, CA, NZ, JP, **AU**).

## Japan: coverage was the gap, not architecture

Wave 1B built the Japan pack correctly and imported one chapter to prove the mechanism. Two things
turned up when completing coverage.

**The imported schedule was stale.** Wave 1B imported `2026_04_01`. Japan Customs had since
published `2026_07_09`, `2026_08_01` and `2026_08_08`. Each dated schedule is a *complete*
96-chapter publication, not a partial amendment — verified by comparing chapter counts across four
dates — so completing coverage meant importing the current schedule, not topping up the old one.
The 2026-04-01 ch29 release is retained as immutable history and superseded, not deleted.

**Chapter 77 does not exist.** HS reserves it. The backfill discovers chapters from the authority's
own dated index rather than looping 1..97, so this is followed rather than reported as a failure.

`scripts/backfill-japan-schedule.ts` drives the existing `acquireAndImportJapanChapterRelease` in a
sequential loop. No new architecture, no per-chapter schema, no second release model.

Full run against `2026_08_08`:

| Metric | Value |
|---|---|
| Chapters published / attempted | 96 / 96 |
| Imported | 94 |
| Unchanged (idempotent no-op) | 2 |
| Failed | 0 |
| Rows parsed | 15,437 |
| Bytes retained | 40.2 MB |
| Peak RSS | 159 MB |
| Elapsed | 93.5 s (~0.97 s/chapter, incl. a 700 ms courtesy pause) |

The 2 "unchanged" rows are real evidence of idempotency, not an anomaly: ch01 and ch10 had been
imported minutes earlier in a two-chapter validation run, and the full run recognised identical
bytes and created nothing. A second full re-run would report 96 unchanged.

Post-backfill queries across eight chapters, all passing technical qualification:

| HS6 | Chapter | Resolution | General duty | India |
|---|---|---|---|---|
| `100630` rice | 10 | refinement required | — (quota/non-quota not equivalent) | unknown |
| `740710` copper | 74 | all children equivalent | 5.8% | requires origin proof |
| `847989` machinery | 84 | exact | Free | requires origin proof |
| `854449` cable | 85 | all children equivalent | Free | requires origin proof |
| `291511` chemical | 29 | exact | 6.4% | requires origin proof |
| `610910` apparel | 61 | refinement required | — | unknown |
| `870323` vehicle | 87 | exact | Free | requires origin proof |
| `220421` wine | 22 | refinement required | — | unknown |

`india: unknown` where refinement is required is correct and deliberate: with no single resolved
line there is no line-specific treatment to state.

## A real defect that full Japan coverage exposed

Each provider cached decoded bundles in a module-level `Map` keyed by release checksum, with no
eviction. That is safe while a source has one active release. Japan does not: it has one release
per (date, chapter), so a worker serving the whole schedule would retain 96 decoded chapters.

Measured against the real August 2026 schedule, a decoded chapter costs ~9 MB RSS. Ninety-six of
them is ~860 MB on top of a ~130 MB baseline — at the 1 GB worker's limit. This is the same class
of failure as the Wave 1B New Zealand OOM, arriving later and by a different route, and it would
have surfaced in production rather than in tests.

Fixed with `BoundedBundleCache` (LRU, `src/lib/market-access/bundle-cache.ts`): capacity 12 for
Japan and Australia (per-chapter releases), 2 for Canada and New Zealand (one active release at a
time, the bound retiring a superseded decode across a release rollover). Three identical unbounded
maps plus a demonstrated defect is real duplication, which is the bar for extracting a shared
abstraction here.

## The bulk-memory gate

`src/lib/market-access/bulk-operational-qualification.ts` complements — does not replace — the
semantic harness in `vendor-qualification.ts`. Semantics answers "is this duty represented
correctly?"; this answers "does decoding the real archive fit in the worker we run?"

**Thresholds, and why they are not fitted to current adapters.** The staging worker's limit is
1 GiB (Railway `MEMORY_LIMIT_GB` = 0.99999744). Three claims share it: a ~130 MB baseline, the
decode itself, and headroom V8 needs above steady state — a mark-compact pass can hold both copies
of what it moves, which is exactly how the NZ crash presented (the fatal log was a GC trace, not an
allocation failure). The ceiling is therefore **70% of the container (717 MB)**, leaving ~300 MB for
GC transients and concurrent work, with a **60% (614 MB) warn line** marking loss of comfortable
headroom. Post-fix NZ measures 552 MB and passes at ~77% of the ceiling — a real margin. Had the
threshold been drawn around the observed number it would sit just above 552 MB and would have
admitted regressions indefinitely; a test pins that the 977 MB pre-fix shape still fails.

CI does not download government archives. `tests/bulk-operational-qualification.test.ts` pins the
grading logic and the cache bound; `scripts/qualify-bulk-adapters.ts` is the explicit real-archive
command, exit code 1 on breach, archives cached between runs.

Measured against real archives:

| Adapter | Source | Rows | Peak RSS | % of worker | Result |
|---|---|---|---|---|---|
| `nz_customs_cusmod` | 4 MB gz → 73 MB | 944,255 | 552 MB | 53.9% | PASSED |
| `japan_customs_tariff_schedule` (ch84, largest) | 2.25 MB | 871 | 65 MB | 6.3% | PASSED |
| `canada_cbsa_customs_tariff` | — | — | — | — | not measured by this command |

Canada is deliberately registered as unmeasured rather than silently omitted: its release is a
composite assembled at acquisition time from two CBSA endpoints, so a faithful measurement has to
run through that path, not a single URL fetch. That is the honest gap in this gate today.

Absolute peak RSS is process-wide, so measuring several adapters in one process inflates the later
ones. The command says so, and the direction of error is safe: contamination can only cause a false
FAIL, never a false PASS. `attributed RSS` is the per-adapter figure.

## Australia

Rights: **cleared with conditions.** The ABF tariff site's own linked copyright statement
(homeaffairs.gov.au, ABF being in that portfolio) places all material under **CC BY 3.0 Australia**,
attribution "Australian Government Department of Home Affairs", excluding the Coat of Arms, logos
and third-party content — the same third-party carve-out that keeps WCO material out of scope, as
with Japan. `robots.txt` disallows only `/sitesearch`.

Australia needed a shape no previous pack had. Its Schedule 3 `Rate#` cell is a **composite**, and
its India treatment is not in that cell at all:

- `5% DCS:4% DCT:5%` — other countries' scheme rates share the cell with the general rate. India is
  deliberately absent from these codes.
- `5%, and $110.15/L of alcohol` — a genuine compound; both components are retained.
- `5%From 1 July 2018:3.75%From 1 July 2019:Free` — **legislated phased steps**. The rate in force
  is the latest commenced step (Free, as of 2026). Reporting the 5% base would be wrong, and so
  would applying a step that has not commenced. Steps are retained either way.
- `$10.57/L of alcohol, calculated on that alcohol content by which the percentage by volume of
  alcohol of the goods exceeds 1.15` — a specific duty with a threshold formula, kept verbatim.

**India ECTA is exception-list semantics**, a fourth distinct preference shape (Canada/Japan use a
per-line column, NZ a rate group). Schedule 10A states: *"Except for the subheadings outlined in the
table below, all rates are Free."* So a subheading's **absence** is positive evidence of duty-free
ECTA treatment. Two consequences: the reader **refuses a Schedule 10A that lacks that note**,
because without it absence proves nothing; and the determination still resolves through
`determineIndiaPreference`, so it can only ever reach
`potentially_applicable_requires_origin_proof` — originating status under sections 15/16 of the
Customs Tariff Act 1995 is a shipment fact no schedule can establish.

Each chapter release is a Canada-style composite (Schedule 3 chapter + Schedule 10A + acquisition
manifest), so the evidence records exactly which Schedule 10A text was in force for that chapter
rather than joining against whatever is current at query time.

## Korea, Israel, Philippines — stopped, with different reasons

**Korea** is unchanged: rights cleared (KOGL Type 1, dataset 15051179), documented API, but
`KCS_DATA_GO_KR_SERVICE_KEY` is absent from staging and there are no sealed variables. Confirmed by
inspection, not assumed. Nothing was fabricated and no alternative interface was scraped.

**Israel** is `UNRESOLVED` and deliberately not upgraded. No dataset-specific reuse licence was
found from a primary Israeli government source, *and* gov.il returns HTTP 403 to automated
retrieval including a plain identifying client. Defeating that block would be circumventing an
access control rather than acquiring an authorised source, so it was not attempted.

**Philippines** stops on **interface, not rights** — a distinction worth keeping. The Tariff Finder
carries the standard GOVPH footer "All content is in the public domain unless otherwise stated",
which is site-wide boilerplate whose "unless otherwise stated" qualifier is doing real work; that is
suggestive, not a dataset grant. The decisive fact is that the Finder publishes no bulk download and
no documented API — its schedules reach the page through an internal JSON endpoint. Consuming that
would be reverse-engineering a private browser API without authority support.

## Remaining gaps

1. Canada has no real-archive memory measurement (composite acquisition path needed).
2. Australia coverage is per-chapter and only the chapters exercised so far are imported; the Japan
   backfill pattern applies directly.
3. Japan and Australia both carry per-chapter releases, so schedule-wide freshness needs a periodic
   re-run rather than a single release check.
4. Israel and the Philippines need an authority-side change (licence statement, published dataset),
   not more engineering.
