# Korea (KCS) — full semantic closure

Follows the South Korea activation (`e6dc93c`, `68963c5`). That pass got KR operational for MFN
with two of ~224 rate-type codes confirmed (`A`, `C`) and everything else — including the
plausible-but-unverified India candidates `FIN1`/`FCEPA1`/`FID1` — retained unresolved. This pass
closes that gap as far as a real, live, official KCS source permits.

## The rate-symbol dictionary — resolved to zero unexplained active symbols

Korea Customs Service's own 관세법령정보포털 CLIP portal
(`unipass.customs.go.kr/clip/hsinfosrch/openULS0401009Q.do`) publishes a `세율상세구분`
(rate-detail-classification) dropdown carrying **371 symbol→label pairs**, fetched directly as
live HTML (not reverse-engineered — this is the public search form's own rendered markup). Cross-
checked against every one of the **224 distinct `관세율구분` codes actually present** in the real
`관세청_품목번호별 관세율표_20260211.xlsx`: **zero misses**. The full dictionary, with a
deterministic classifier derived from the verbatim Korean label text (never from the symbol
string), lives in `src/lib/market-access/providers/korea-rate-programs.ts`.

Corrected finding: `FCEPA1`-`FCEPA8` are **Korea-Central America FTA, Panama's own schedule**
("한ㆍ중미 FTA협정세율_파나마"), not India — despite the "CEPA" in the name. `FIN1`-`FIN4` are the
**actual confirmed Korea-India FTA/CEPA rate codes** ("한ㆍ인도 FTA협정세율"). `FID1`-`FID9` are
Korea-Indonesia CEPA, a real, separate agreement. The prior pass's caution in *not* asserting any
of these was correct given what was known then; asserting them now is correct given what CLIP
itself states.

## India-Korea CEPA — closed

`FIN1`/`FIN2` are the only India codes with rows in the 2026-02-11 release (`FIN3`/`FIN4` exist in
CLIP's vocabulary, unused in this release). A published `FIN`-row is modeled as a direct India
measure through the existing `determineIndiaPreference` semantics, which caps it at
`potentially_applicable_requires_origin_proof` — never `confirmed_applicable` — because a schedule
entry is not proof a given shipment actually qualifies under the agreement's rules of origin.
Verified live on staging: HS6 `270900` (crude petroleum) resolves India preference to exactly that
state, naming `FIN1` as the basis.

## The 1.1 / 2.12 sheet question — proven

The two sheet names are **point-in-time snapshot dates**: `1.1` = the schedule as constituted on
2026-01-01, `2.12` = as constituted on 2026-02-12. Proof: the four rows unique to `2.12` are all
rate-type `P1` (할당관세, quota tariff requiring a recommendation) and all carry
`적용개시일` = `20260212` — matching the sheet's own name exactly. A full content cross-check
(every row, not a row count) additionally found **13 same-identity corrections** between the two
snapshots:

- 3 rows where `용도세율구분` was cleared (rate unchanged).
- **9 rows on HS heading 2709 (crude petroleum oils), rate-type `P1`, where the published quota
  rate was corrected from 1% to 0%** under the *same* nominal effective window — a genuine
  retroactive rate correction, not a new tier.
- 1 row gaining a purpose code that wasn't there before.

`2.12` is trusted for a same-identity correction (the same "latest wins" precedent this platform
already applies when one `AuthorityRelease` supersedes another). A row disappearing entirely
between snapshots remains a hard import-time failure. Practical consequence: a query dated in
January against one of the nine crude-oil corrections sees KCS's *current* 0% rate, not whatever
1% `1.1` published for that date at the time — a deliberate choice (serve the authority's best
current statement) rather than a literal historical replay.

## Quota, special safeguard, purpose/end-use — all now conditional, never unconditional

- **Quota (할당관세, `P1`-`P4`, `W1`-`W3`)**: `measure_kind: 'tariff_quota'`, plus a
  `material_non_tariff_requirement` record naming the recommendation gate. Never returned as a
  plain rate.
- **Special safeguard (특별긴급관세, `T1` volume-based / `T2` price-based, Customs Act Enforcement
  Decree Art. 90)**: `measure_kind: 'additional_duty'`. `T2`'s `기준가격` (reference price) is
  never computed into a duty — the actual surcharge needs the shipment's own import price, which a
  published schedule cannot supply.
- **Purpose/end-use (용도세율, a real mechanism: a conditionally reduced rate requiring 사후관리
  post-clearance monitoring for up to 3 years, Customs Act Arts. 83/97-98)**: every line's
  `conditions.purpose_conditional` flag is set whenever `용도세율구분` is populated, whatever the
  code turns out to mean precisely — never folded into an unconditional rate.

## Genuinely still open

- **The exact semantics of `용도세율구분`'s own `A`/`C` values** (a different code space from the
  top-level `관세율구분` codes of the same letters) — real, confirmed mechanism, unconfirmed exact
  per-value meaning.
- **Specific-duty quantity units** (kg, piece, ...) for compound rows — this dataset carries no
  unit column; KRW currency is asserted (a fact of Korean tariff law generally), the unit is not.
  CLIP's own per-item tariff-detail pages likely carry it; not pulled in this pass (a targeted,
  bounded follow-up, not a blanket re-scrape).
- **Max/min ("whichever is higher/lower") compound operators** — none observed in the real release
  to date; the architecture (retain both components, `kind: 'compound'`) does not lose the
  information if one appears, but the operator itself is not modeled.

## Memory architecture note

An earlier version of this pass's stronger cross-sheet verification ran on every query-time decode
and measured 560MB peak RSS / 287MB retained heap against the real archive — enough to make the
release evict itself from `SharedBudgetBundleCache` on every insert (its own declared weight would
have exceeded the entire 160MB shared budget), defeating caching. Splitting the verification out to
run once at import time only (`verifyKoreaSnapshotSuperset`, called from `korea-service.ts`'s
import validation) brought the query-time path back to 501MB peak / 102MB retained heap, cache
weight 112MB. Discovered along the way: `AuthorityRelease` rows are immutable by a database-level
trigger (`authority_release_is_immutable`) that explicitly blocks updating `parser_version`,
`reader_version`, or `validation` on an already-imported release — by design. The already-active
2026-02-11 release's metadata labels remain permanently frozen at their original v1 import-time
values; live query-time behavior always uses current code regardless, which is what actually
matters for correctness.
