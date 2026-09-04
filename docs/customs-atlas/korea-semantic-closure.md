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

## 용도세율구분 A/C — closed

The main tariff dataset's own primary catalogue description states `용도세율구분` and the top-level
`관세율구분` field **share one code vocabulary** — "A(기본세율), C(WTO 협정에 의한 양허관세)" is given
as a single joint description covering both fields, not two independent code spaces that happen to
reuse the same letters. Read against that: a non-null `용도세율구분` value means the row's
conditional end-use rate (용도세율 — Customs Act Arts. 83/97-98, requiring prior approval and up to
3 years of post-clearance 사후관리 monitoring) is administered **against that same base-rate
category** — `A` anchors it to 기본세율 (the basic/general rate), `C` anchors it to the WTO-bound
concession rate. Only `A` and `C` are observed active in the real 2026-02-11 release, matching this
reading exactly with zero unexplained values. Implemented as `conditions.purpose_code_anchor` in
`korea-parser.ts`. Never treated as unconditional either way — the anchor names which base category
the reduced rate is pegged to, not a certification that a given shipment already holds the required
approval.

## Specific/compound-duty quantity units — closed

The main tariff dataset (`관세청_품목번호별 관세율표`) carries no unit column of its own. KCS
publishes it as a **separate, companion open dataset**: `관세청_HS부호` (data.go.kr catalogue
15049722), columns `수량단위코드` (quantity-unit code) and `중량단위코드` (weight-unit code, always
`KG` when populated) keyed by the same 10-digit HS item number. Cross-referencing this dataset
against every item carrying an active `단위당세액` (per-unit tax amount) row in the real release —
**942 rows, collapsing to 108 distinct HS10 items** — resolved:

- **105 items unambiguously**: the companion dataset publishes exactly one unit candidate for the
  item (overwhelmingly `KG`/kilogram; a handful of `U` piece-count and other codes).
- **3 items with two published candidates** (`3706100000`, `3706900000` — photographic/cinema film;
  `8523292020` — recorded video media) resolved by the item's own official Korean name in that same
  dataset: 3706100000/3706900000's name states a width-in-millimetres threshold ("폭이
  35밀리미터 이상인 것"), so metres (`M`) is chosen over the competing kilogram candidate; 8523292020's
  name states "recorded" media ("비디오 녹화된 것"), a discrete-item description, so pieces (`U`) is
  chosen over kilogram. Both cases retain the untaken alternative in the registry and in the
  parsed duty's own note rather than silently dropping it.
- **0 items unresolved.**

Currency is `KRW` throughout (a fact of Korean tariff law generally, not per-row published data).
Registry lives in `src/lib/market-access/providers/korea-tariff-units.ts`
(`KOREA_UNIT_VERIFIED_AT = '2026-09-04'`); consumed by `parseKoreaDuty` in `korea-parser.ts`, which
now takes the HS10 item as an explicit argument. Live-staging-verified: HS 070610 (carrots) resolves
every rate program to kilogram; HS 370610 item 3706100000 (photographic film) resolves to metres
with the kilogram alternative named in the parsed duty's own note.

## Compound-duty operator — 선택관세 identified, not yet per-line confirmed

Korea's Customs Act Enforcement Rule (관세법 시행규칙) documents a **선택관세** (elective-tariff)
mechanism for designated ad-valorem/specific goods: apply whichever of the ad valorem or specific
component yields the **higher** amount — distinct from a true **복합관세** (compound: both
components applied together, additive). The rows carrying the two-component shape in the real
release cluster in HS chapters 3/4/7/8 (fish, dairy/honey, vegetables, fruit) — the classic Korean
agricultural-protection category where 선택관세 is the well-established pattern per Korean
secondary legal sources — but this has **not** been confirmed per individual HS line from a source
naming the exact operator for each one. `ParsedDuty` therefore asserts no operator: both components
are retained separately (`kind: 'compound'`, `ad_valorem_rate_percent` and `specific_amount` both
populated), so no information is lost or guessed if a per-line source is found later. This is the
one item carried into "genuinely still open" below.

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

- **Per-line compound-duty operator confirmation** — 선택관세 (whichever-is-higher) is the
  identified, legally-documented mechanism and the overwhelmingly likely operator for every
  two-component row observed, but no source naming the exact operator for each individual HS line
  has been found. The architecture (retain both components, `kind: 'compound'`, no operator
  asserted) does not lose information if such a source is found later — nothing is guessed today.

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
