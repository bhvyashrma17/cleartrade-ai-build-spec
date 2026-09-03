# TARIC memory closure

Follows `p1-cc4-wave1c1-implementation.md`, which recorded the breach. Prior reports are left as
written; this records what the profiling actually showed, including where it contradicted the
prediction.

## Prediction versus actual

Wave 1C.1 predicted the cause from the shape of the code:

> `readTaricBundle` materialises every sheet as `string[][]` up front and holds them all.

**That was half right, and the half it got wrong was the important half.** Profiling the real
September 2026 extraction stage by stage showed the retained `string[][]` was *not* the dominant
allocation. The dominant allocation was a transient nobody had looked at: the worksheet XML itself.

| Stage, `Duties Import 01-99.xlsx` | Cost |
|---|---|
| Compressed member file | 7.5 MB |
| Worksheet XML, uncompressed | 96.9 MB |
| **Worksheet XML as one JavaScript string** | **~194 MB** (2 bytes/char) |
| RSS delta for that single `async('string')` | **+276 MB** |
| RSS delta for building its 146K rows | +37 MB |

`zip.file(sheet).async('string')` materialised the whole document, and `matchAll` over it then
allocated a match object and substrings for each of its 1.75M cells. One file, one transient,
~276 MB. Guessing from code shape would have led to rewriting the retained representation and
leaving the actual peak driver in place.

The second cause only became visible after the first was fixed: with streaming in, peak fell to
628 MB but **post-GC retained heap was 505 MB** — genuinely retained, not garbage. 4.4M cells at
~1.2 KB per row, for rows of about ten short fields. The characters were not the cost; the *object
headers* were. TARIC is columnar and overwhelmingly repetitive — the same dates, origin codes,
measure-type codes and duty expressions recur across hundreds of thousands of rows — and every
occurrence was a distinct JavaScript string object.

## What changed

Two changes, both in `src/lib/market-access/taric/bundle.ts`:

**1. Stream the worksheet instead of materialising it.** `streamSheetRows` consumes the entry as a
Node stream, holds only the tail of the current row, and emits rows to a callback. A `StringDecoder`
handles multi-byte characters split across chunk boundaries. A cursor, rather than re-slicing the
buffer per row, keeps the consumed prefix from being copied 146K times.

**2. Intern cell values.** One intern table per worksheet, released with the sheet. Equal values
return the canonical instance, so the object count collapses to the distinct-value count while
every value stays byte-identical.

Reader version moved to `taric-bundle-reader-v2`. Output is identical, but memory behaviour is a
property of the reader and provenance should not imply v1 and v2 are the same program.

## Results, real September 2026 extraction

| | Before | After |
|---|---|---|
| Archive | 26 MB (31 MB decompressed) | unchanged |
| Rows | 410,161 | 410,161 |
| **Peak RSS** | **931 MB (90.9%)** | **338 MB (33.0%)** |
| Retained heap, post-GC | 505 MB | 148 MB |
| Amplification vs source | 23.5× | ~4.8× |
| Duration | 2,977 ms | ~3,700 ms |
| Verdict | **FAILED** (ceiling 717 MB) | **PASSED**, below the 614 MB warn line |

Peak is down 64%, comfortably under both the hard ceiling and the preferred warn line. Decode is
~25% slower — streaming trades a little throughput for a bounded footprint, and at ~3.7 s once per
release, cached thereafter, that is the right trade.

The amplification ratio is still ~4.8×, so the gate's whole-source-materialisation heuristic no
longer fires. What remains is the inherent cost of representing 4.4M cells as JS values at all.

## Semantic parity

The refactor must not change tariff truth, so parity was proven twice, both against the real
archive, and the old reader was reproduced verbatim rather than described.

**Row level.** Every parsed sheet, hashed cell-for-cell: 8 sheets, 4.4M cells, **0 divergences**.

**End to end.** Canonical `MarketAccessIngestResult` fingerprinted over duty kind, ad valorem rate,
specific amount, currency, unit, expression, quota lines, preference lines, origin scope, India
applicability, effective dates, refinement state, provenance and source reference — for 8 HS codes
across 6 EU destinations, 48 combinations. Old and new produced the **identical aggregate hash**
`476dc1b4…`.

## Adversarial cases observed in the real data

Not invented for coverage; these are what the September 2026 extraction actually contains:

| HS6 | Observed |
|---|---|
| `100630` rice | specific duty `175.000 EUR / 1 tonne`, 108 candidates, 4 quota lines, `all_children_equivalent` |
| `220421` beverage | 164 candidates, 15 quota lines, `classification_refinement_required` |
| `020230` meat | 34 candidates, quota line present, refinement required |
| `610910` apparel | `12.000 %`, preference line present, India requires origin proof |
| `291511` chemical | `5.500 %`, exact |
| `740710` copper | `4.800 %`, exact |
| `847989` / `854449` | refinement required (10 and 9 non-equivalent candidates) |

## EU destination parity

All 27 destinations share one TARIC release. Excluding destination identity itself, all 8 HS codes
produced exactly **one** distinct tariff-truth fingerprint across DE, FR, NL, IT, ES and PL —
common EU tariff truth, destination identity preserved separately.

## Cache policy

Unchanged at **capacity 1**, deliberately. Retention per decoded bundle fell from ~505 MB to
~148 MB, which would make a capacity of 2 survivable — but capacity 1 is sufficient for a source
with one active release at a time, and the task's rule stands: do not raise a bound merely because
the reader got smaller. Two retained decodes would put ~300 MB of purely optional cache against a
1 GiB worker for no measured benefit.

## Limitations

- Amplification is ~4.8×, not ~1×. Getting materially below that means abandoning `string[][]` for
  a columnar or offset-indexed representation, which would change the parser's access pattern. Not
  justified at a 33% footprint.
- Decode is ~25% slower. Acceptable once per release; it would not be if it ran per query.
- The gate's retention heuristic is tuned for whole-source materialisation and would not catch a
  future regression that stayed under 8× while still growing.
