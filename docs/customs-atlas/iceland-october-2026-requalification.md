# Iceland — requalification on the 1 October 2026 release

**Decision:** Iceland stays `ACCEPTED`; its executable release moves from 1 September to
**1 October 2026**. No semantic change to the adapter.

## Why

The qualified release (`TSKINN01092026.zip`, key file `Tollsk20260901.txt`, SHA-256 `fc664a01…`,
29,671 records) is no longer published. Skatturinn reissued that URL on 16 Sep 2026 with
`TollskIR20260901A.txt` (`dc9affd9…`, 29,758 records), and the publication page now lists
**`TSKINN01102026.ZIP` — "Tollskrárlyklar með gildistöku 1. október 2026"** as current. The
reader refused both, because the entry name no longer matched `Tollsk<date>.txt`.

## What changed in the source

| | 1 Sep (qualified) | 1 Sep reissue | 1 Oct |
|---|---|---|---|
| Entry | `Tollsk20260901.txt` | `TollskIR20260901A.txt` | `TollskIP20261001.txt` |
| Records | 29,671 | 29,758 | 31,483 |
| Declarable lines | 9,442 | 9,442 | 9,442 |
| Type 1/2/3/4/5 | — | 9,442 / 2,641 / 289 / 9,442 / 7,944 | 9,442 / 2,655 / 2,000 / 9,442 / 7,944 |

The record layout is unchanged (published 2013 layout, still listed as current on the page; same
record widths, no duplicate measures). Reissue → October, measure by measure:

- `A` (general duty) changed on exactly four lines, all seasonal vegetables in heading 0704
  (`07041010`, `07041021`, `07041029`, `07049001`).
- `YX` (EFTA–India TEPA) unchanged on every line.
- A new measure code `YZ` appears on 9,071 lines, and `Z` records grow from 289 to 1,981. The
  parser reads only `A` and `YX`; `YZ`/`Z` stay retained in the bundle and are given no meaning here.

## Adapter change

`iceland-bundle.ts` accepts `Tollsk[I<letter>]<release date>[<letter>].txt`. The infix and the
revision suffix are not interpreted; the effective date in the name must still equal the release
being read, and exactly one entry is still required. Tests cover both new names and refuse a
date mismatch, a three-letter infix, a two-letter suffix and an unrelated name.

`scripts/canary-iceland-authority-pack.ts` now pins the 1 October controls: keys `65466de4…`,
9,442 lines, 31,483 records.

## Staging evidence (11 Oct 2026)

- Live acquisition twice, byte-identical; composite bundle `75b68312…`.
- Import repeated → same release; reparse repeated → same snapshot.
- 610910: `0.00 %`, India `potentially_applicable_requires_origin_proof` (`YX`).
- 020110: compound `30.00 % + 357.00 ISK / kg`, no AVE.
- 100630: `all_children_equivalent`, 2 candidates.
