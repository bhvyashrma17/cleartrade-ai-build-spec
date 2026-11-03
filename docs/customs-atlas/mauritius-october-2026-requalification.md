# Mauritius — requalification on the 1 October 2026 integrated tariff

**Decision:** Mauritius stays `ACCEPTED`; its executable edition moves from the 13 August 2026
baseline (plus the 4 September VAT annex) to MRA's **Integrated Tariff as at 01 October 2026**.

## Why

MRA no longer serves the qualified baseline (`TariffInf130826.pdf` → HTTP 404). Its tariff page
(`/index.php/customs1/tariff-information`) now lists `TariffInf011026.pdf`, "Integrated Tariff as
at 01 October 2026" (Last-Modified 30 Sep 2026).

## The new baseline

| | 13 Aug 2026 (qualified) | 1 Oct 2026 |
|---|---|---|
| File | `TariffInf130826.pdf` | `TariffInf011026.pdf` |
| SHA-256 | `26c0e4c6…` | `c631ca50bfe4d5e8117983c35822af2dca858aa19285f5ce7d25de23141b035a` |
| Pages / table pages | 807 / 21–806 | 810 / 21–809 |
| Lines | 6,920 | 6,938 |

The existing reader (`mauritius_percent_row` layout) parses it with no change. Measured with it:

- Paired cells whose two printed values agree (`0 0`, `15 15`; 681 lines, a two-line row) read as
  one value. Where they disagree (54 cells, e.g. plastics 3923 `0 30`) the cell stays `unparsed`
  and is never declared. The India column's `1 5` on heading 4202 is one number split into glyphs
  4 pt apart under the INDIA header, so it reads as 15%.

## Notices reviewed (MRA Notice to Stakeholders, through 11 Oct 2026)

| Date | Notice | Treatment |
|---|---|---|
| 4 Sep | VAT replacement annex (6 rows) | Already in the 1 Oct baseline — general duty identical on all six, VAT/INDIA agree |
| 29 Sep | Plastic-bottle excise and tariff restructuring, effective 1 Oct | Already in the baseline — Annex I/II codes present; 3923.30.10 excise "Rs 2 per unit". Retained as evidence |
| 29 Sep | Refrigerating-appliance minimum energy performance standards (GN 56 of 2026) | Product control, not a commodity rate. Retained as evidence |
| 30 Sep | Ruling and electronic-seal fees | Not a commodity rate (recorded in the notice index) |
| after 1 Oct | — | None published |

So the post-baseline amendment layer is empty, and the 4 September annex is no longer applied
on top of a baseline that already contains it.

## Code

- `GREEN_WAVE_CONFIGS.MU` describes the 1 October edition; its 13 August artifact set moves to
  `retired_artifact_sets`, so the August release already retained in production stays readable.
- A retained green-wave release now supplies its own `effective_from` (recorded in its manifest at
  acquisition). Without this, an August release read under the October config would be dated
  1 October and hidden for queries in between.
- The August-only amendment layer is removed from acquisition; retained August releases carry
  their applied rows in `normalized-lines.json`, so reading them does not need it.

## Acquisition from staging

MRA serves this file at ~15 KB/s to the operator's network (17 MB ≈ 18 min, beyond the 180 s
per-artifact fetch timeout) but at full speed to Railway, so the acquisition canary runs inside the
staging worker (`railway ssh … npx tsx scripts/canary-green-wave-authority-packs.ts acquisition MU`).

## Staging evidence

Staging (`amused-insight`/`staging`, commit `2d2994c9`), 11 Oct 2026:

- Acquisition inside the staging worker, twice, byte-identical; composite bundle `26d38854…`
  (16,441,835 bytes); tariff `c631ca50…`, 6,938 rows; release created and activated.
- 010121: `0` — the authority's printed zero, `exact`; India (CECPA) `potentially_applicable_requires_origin_proof`.
- 090230: a `mixed` duty retained as mixed, no AVE.
- Worker job completed; idempotent reparse; `regulatory_coverage_complete=false`.
- Deployed check (`canary-staging-atlas.ts --only=MU`): pass.

The first in-worker run failed closed at import (`qualification_controls_changed`): the import
gate still expected the August edition's six amendment operations. Corrected in `2d2994c9`.
