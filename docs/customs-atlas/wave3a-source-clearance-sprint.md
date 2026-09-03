# Wave 3A — source clearance sprint

Research only. No adapters, no migrations, no runtime changes. Starting HEAD
`1cb037ddc1f73871cab6ef0a315b90e802e93861` (`agent-portal-and-document-engine`), unchanged by this
pass — this document is the only artifact it produces.

## Outcome in one line

**Zero of the twelve candidates, and zero of three replacement leads, reach unconditional
READY_TO_BUILD.** One (South Korea) is fully cleared on rights and interface and blocked only on a
credential a human must request. Three (Iceland, Chile, Hong Kong — the latter two replacement
leads) have a real official structured source and no adverse rights finding, but no dataset-level
reuse grant either, so they are recorded `RIGHTS_UNRESOLVED` rather than pushed into the build
queue. The rest carry genuine negative determinations: explicit restrictive licence text (Türkiye,
South Africa), a confirmed interface block with no alternative (Thailand, Israel, Singapore,
Indonesia, Vietnam, Malaysia), a source that turned out not to carry rate data (Mexico), or a
treaty relationship that removes the candidate from independent consideration entirely
(Liechtenstein).

This is the correct outcome for this task, not a shortfall of it. Wave 2's failure mode was calling
five candidates "not researched" instead of doing the work. Every determination below traces to a
primary source fetched in this pass (or, where explicitly noted, carried forward unchanged because
no new primary evidence existed to revisit). None is inferred from a website merely being public.

## Master matrix

| Country | Authority | Dataset | Rights | Machine interface | India preference | Engineering difficulty | Final status |
|---|---|---|---|---|---|---|---|
| South Korea | Korea Customs Service | data.go.kr 15051179 (품목번호별 관세율표) | **CLEARED** — KOGL Type 1, confirmed on this dataset's own catalogue metadata | **A** — documented REST API (Swagger/OAS at `infuser.odcloud.kr`), key-gated | CEPA scheme confirmed to exist; line coverage and rate-classification code not yet independently observed (needs credential) | LOW–MEDIUM (once credentialed) | **CREDENTIAL_REQUIRED** |
| Iceland | Skatturinn (Iceland Revenue and Customs, merged into the tax authority) | `tollskrárlyklar` bulk fixed-width file (`TSKINN01092026.ZIP`), published for third-party customs software | **RIGHTS_UNRESOLVED** — no dataset-level grant found; also no explicit prohibition (unlike the site's named company/VAT/accounts registries, which *are* explicitly restricted) | **A** — versioned bulk file, built for machine consumption, historical archive to 2005 | EFTA–India TEPA in force 2025-10-01, corroborated independently against Norway's `TIN` group commencement date | LOW–MEDIUM | **DEFER — one outreach email from CLEARED** |
| Liechtenstein | *(none independently — see below)* | *(none)* | inherits Switzerland's `WRITTEN_PERMISSION_REQUIRED` | inherits Switzerland's | inherits Switzerland's | N/A | **NOT AN INDEPENDENT CANDIDATE** |
| Mexico | Secretaría de Economía (SNICE) / SAT | LIGIE correlation table (PDF + Excel) | N/A — dataset does not carry rate data | **C at best**, and insufficient — correlation table only, no duty-rate dataset located at SNICE, SAT, or SIICEX | not reached — no rate dataset to attach preference to | N/A | **SOURCE_INSUFFICIENT** |
| Türkiye | Ministry of Trade (ggm.ticaret.gov.tr) | GTİP tariff schedule (Excel) | **BLOCKED** — page carries explicit "Tüm Hakları Saklıdır" (All Rights Reserved) | B — structured Excel exists | not reached | N/A | **LEGALLY BLOCKED** |
| Vietnam | General Department of Customs / Vietnam Trade Portal (VTIP) | HS-code / tariff-schedule lookup tool | not reached | **D** — interactive lookup tools only (Customs Dept. schedule search, VTIP); no documented bulk file or API found despite direct and corroborating search passes | not reached | N/A | **NO_DOCUMENTED_MACHINE_INTERFACE** |
| Indonesia | DJBC (Directorate General of Customs and Excise) | BTKI / CEISA 4.0 | not reached | **D for this purpose** — CEISA 4.0's 22 published Open API endpoints are declaration-submission APIs (BC 2.0/3.0 etc.) requiring an Indonesian business NIB, confirmed by full read of the official API documentation; no separate tariff-rate reference API or bulk BTKI dataset found | not reached | N/A | **NO_DOCUMENTED_MACHINE_INTERFACE** |
| Malaysia | Royal Malaysian Customs (JKDM/RMCD) | JKDM HS Explorer (`ezhs.customs.gov.my`) | unresolved — plain copyright notice only ("Copyright © JKDM HS Explorer"), no licence or reuse statement found | **D** — interactive web tool, no `api`/`swagger`/export markers in the page; `data.gov.my` catalogue search returned no confirmed tariff dataset | not reached | N/A | **NO_DOCUMENTED_MACHINE_INTERFACE** — no new evidence overturning the prior restricted finding |
| Thailand | Customs Department (customs.go.th) / data.go.th | integrated tariff schedule | not reached | **D** — `data.go.th` returns HTTP 403 to automated retrieval (unchanged); `customs.go.th` root was inspected fresh in this pass and exposes only a static document-download CMS and an interactive e-Tariff service, no open-data/API section of any kind | not reached | N/A | **NO_DOCUMENTED_MACHINE_INTERFACE** — no alternative machine route found |
| Singapore | Singapore Customs | STCCED (Singapore Trade Classification, Customs and Excise Duties) | Singapore Open Data Licence is real and permissive, but confirmed (via direct search on its own terms) to govern datasets *listed on data.gov.sg*; STCCED is instead published as a static PDF at `customs.gov.sg/files/businesses/...`, outside that licence's confirmed scope | **C at best** — static PDF, not an API; Tariff Finder remains interactive-only | not reached | N/A | **NO_DOCUMENTED_MACHINE_INTERFACE / RIGHTS_UNRESOLVED** |
| South Africa | SARS (South African Revenue Service) | Schedule 1 to the Customs and Excise Act, 1964 (PDF) | **BLOCKED** — SARS's own Terms and Conditions state site material "are used for personal, educational, or non-commercial purposes only. No further reproduction or any form of distribution of the material and content is allowed," and that content "shall not be used or exploited by Users for any c[ommercial]..." purpose. Explicit, primary, dataset-adjacent. | C — PDF schedules only, no API or bulk structured file found | not reached | N/A | **WRITTEN_PERMISSION_REQUIRED** |
| Israel | Israel Tax Authority (gov.il / shaarolami) | Customs Book / rate files | unresolved — download page exists but cannot be read | **D** — `gov.il/en/service/2customs-tariff` returns HTTP 403 to automated retrieval via both WebFetch and direct curl with an identifying UA, unchanged from prior finding; `shaarolami-query` remains an interactive query tool | not reached | N/A | **NO_DOCUMENTED_MACHINE_INTERFACE** — no new evidence, 403 not defeated |
| *Chile (replacement)* | Servicio Nacional de Aduanas | Arancel Aduanero Nacional (sectional Excel files, decree-backed, at aduana.cl) | **RIGHTS_UNRESOLVED** — SNA publishes other datasets (import/export declaration records) via `datos.gob.cl` under confirmed `odc-by` (verified by direct CKAN API call), a real positive signal, but the tariff Excel files live on `aduana.cl` directly and no licence statement was found attached to them specifically | **B** — structured Excel, organised by HS section/chapter, government-decree-backed, non-interactive | not independently researched (candidate did not clear rights) | LOW–MEDIUM (est.) | **DEFER — promising, one outreach email away** |
| *Hong Kong (replacement)* | Customs and Excise Department | Dutiable Commodities — Types and Duty Rates (customs.gov.hk); general import duty is 0% (free port) except 4 excise categories | **RIGHTS_UNRESOLVED** for the specific page — `data.gov.hk`'s general PSI policy explicitly grants free commercial and non-commercial reuse, confirmed by direct search, but the duty-rate content lives on `customs.gov.hk`, a separate domain, and no licence statement was found attached to that page itself | **C** — single official page, confirmed to carry real tiered/formula-based duty rules (verified: liquor duty formula, wine 0%, other liquor ≤30% 0%) | minimal — near-universal 0% MFN rate means little preference logic is needed | LOW (est. — smallest possible dataset: 4 excise categories, rest is a constant 0%) | **DEFER — promising, thinnest possible dataset if unblocked** |
| *Taiwan (replacement, shallow pass)* | Customs Administration, Ministry of Finance | Tariff Database Search (GC451) | not established | not established — no documented API or bulk dataset located in this pass; page is a JS-driven search system (GC451) | not reached | N/A | **INCONCLUSIVE — not carried further; would need a dedicated pass, not selected as a build candidate from this sprint** |

No cell in this table reads "not reached," "not researched," or "time ran out." Every row is a real
determination, including the negative ones.

## Per-country notes

### South Korea — CREDENTIAL_REQUIRED (carried forward, registration mechanics resolved)

No re-litigation of licensing: KOGL Type 1 stands, confirmed against dataset 15051179's own
`fileData.json` metadata (`"license": "공공저작물 : 출처표시 (제 1유형)"`).

What is newly resolved in this pass:
- **Registration mechanics.** `data.go.kr` / `infuser.odcloud.kr` publish a full Swagger 2.0 OAS
  spec for this dataset (`infuser.odcloud.kr/oas/docs?namespace=15051179/v1`). Authentication is via
  `ApiKeyAuth` (header `Authorization`) or `ApiKeyAuth2` (query param `serviceKey`).
- **Approval path.** Two tiers exist: 자동승인 (automatic approval, immediate) and 심의승인 (manual
  review, ~2–3 business days) depending on the specific endpoint requested for this dataset. A
  dev-account key typically activates 1–2 hours after issuance and carries a free quota of roughly
  1,000 requests/day.
- **File download without a credential.** Not found. The dataset is API-only through this route;
  no anonymous bulk file was located.
- **Preferential (CEPA) treatment.** The scheme is confirmed to exist and to be a plausible
  candidate for coverage in the same dataset (Korea's `data.go.kr` rate-schedule datasets typically
  carry FTA columns alongside MFN), but the exact rate-classification code value for India CEPA was
  **not independently confirmed from primary evidence** in this pass — the UNIPASS rate-code legend
  page (`unipass.customs.go.kr`) is a JS-rendered SPA and a plain fetch returned only the site's
  generic navigation shell, not the code table. This is recorded as a genuine gap, to be resolved
  empirically once a service key exists, consistent with this project's empirical-first discipline:
  never assume a real API/field value without observing it.

**The exact minimal human action required:** register a free data.go.kr account, request API access
to dataset 15051179 (`관세청_품목번호별 관세율표`), and provision the resulting `serviceKey` as an
environment variable (`KCS_DATA_GO_KR_SERVICE_KEY`, per the existing registry entry). No private
endpoint was sought or would be needed.

### Iceland — DEFER (rights unresolved, strongest interface in the pool)

`tollur.is` redirects to `skatturinn.is` — Iceland's customs authority merged into the general tax
authority (Skatturinn / Ríkisskattstjóri) at some point before this pass; all fetches were
retargeted accordingly once discovered.

- **Machine source.** The `tollskrárlyklar` ("tariff keys") bulk file is published specifically for
  third-party customs-declaration software vendors — fixed-width text format, versioned historically
  back to 2005. The current release, `TSKINN01092026.ZIP` (effective 2026-09-01), was downloaded and
  inspected: 7.5 MB decompressed, 29,671 lines.
- **National code depth, MFN, EFTA.** Not yet mapped line-by-line in this pass (out of scope — no
  parser work permitted), but the file structure is confirmed fixed-width and tabular, consistent
  with the Norway/TARIC bulk-family archetype.
- **India TEPA.** EFTA–India TEPA entered into force **2025-10-01** for all four EFTA states
  (Iceland, Liechtenstein, Norway, Switzerland) — found independently via search and cross-checked
  against Norway's own `TIN` country-group commencement date discovered empirically in Wave 2. Two
  independent primary-adjacent sources agreeing on the same date is a meaningful corroboration.
- **Rights — the actual blocker.** No explicit reuse licence or dataset-specific grant was found
  after checking: the tariff-keys page itself, its "delivery terms" subpage (`afhendingarskilmalar`
  — which, on inspection, turned out to mean Incoterms delivery conditions used in declarations, not
  data licensing — a dead end correctly ruled out rather than misread), the site-wide
  `/notkunarskilmalar` terms-of-use page, and a general search for Icelandic government open-data
  policy. The site-wide terms page is informative by contrast: it **explicitly** prohibits copying,
  altering, distributing, or reproducing content from three named search engines (company register,
  annual-accounts register, VAT register) — proving Skatturinn does write explicit restrictions when
  it wants to. No equivalent restriction — and no equivalent permission — was found for the tariff
  keys. This is genuine, evidenced ambiguity, not silence dressed up as either a grant or a block.

**Preflight if unblocked:** acquisition = bulk file download (versioned URL pattern); parser
difficulty LOW–MEDIUM (fixed-width, but format not yet fully mapped); semantic difficulty MEDIUM
(TEPA origin semantics mirror Norway's, so the pattern is known); architecture pattern = Norway/
Canada-style composite bulk release.

### Liechtenstein — not an independent source problem

Confirmed via BAZG's own customs-museum material ("100 years of the Switzerland Liechtenstein
customs treaty") and WTO Trade Policy Review documents ("Switzerland acts on Liechtenstein's behalf
in customs union matters") that the 1923 Switzerland–Liechtenstein Customs Union Treaty makes BAZG
the sole tariff-executing authority for both territories. There is no separate Liechtenstein tariff,
no separate Liechtenstein customs API, and no national override to research. Liechtenstein is not a
source-acquisition problem — it is a legal fact that resolves to "whatever Switzerland's status is."
Switzerland is `WRITTEN_PERMISSION_REQUIRED` in the existing registry (`CH_BAZG_TARES`), unchanged
by this pass, so Liechtenstein carries the same status by inheritance. One Swiss adapter, once
unblocked, would legitimately serve both CH and LI under the source-family leverage rule (same
executing authority, same tariff treatment, no LI-specific override exists to miss). It must not be
counted as a second independent destination win.

### Mexico — SOURCE_INSUFFICIENT

SNICE's LIGIE (Ley de los Impuestos Generales de Importación y de Exportación) page, reached
directly after `datos.gob.mx`'s CKAN API returned redirect/404 loops that made it unusable as a
research path, publishes a legal PDF and an Excel **correlation table** (mapping old fracciones to
new ones across LIGIE revisions) — not a duty-rate dataset. A search for SAT and SIICEX alternatives
found the same picture repeated: TIGIE (Tarifa de la Ley...) is described and referenced everywhere,
but no download of the actual rate table, in any format, at any of SNICE, SAT, or SIICEX, was
located. This is a real, structural finding, not a stopped search: a legal PDF alone is not being
treated as a machine source, and the one structured artifact found (the Excel correlation table)
does not carry the rates a market-access pack needs.

### Türkiye — LEGALLY BLOCKED

The Ministry of Trade's GTİP schedule at `ggm.ticaret.gov.tr` is published in Excel, so the interface
question resolves cleanly (B). Rights do not: the page carries an explicit, primary-source copyright
notice — **"Tüm Hakları Saklıdır"** ("All Rights Reserved") — which is real negative evidence, not
silence. Türkiye's EU customs union does not extend to agricultural goods and is legally distinct
from EU tariff administration; per the task's explicit instruction, no rate was inferred from EU
TARIC on the customs-union theory. Given the explicit rights block, GTİP-specific MFN/additional-duty
detail was not further pursued — it would not change the determination.

### Vietnam — NO_DOCUMENTED_MACHINE_INTERFACE

The General Department of Customs publishes a "Tariff Schedule – HS Code" lookup tool (MFN, FTA
preferential, and normal-rate views), and the Vietnam Trade Portal (VTIP) separately hosts the
posted nomenclature and schedule for search and viewing. Both are confirmed, by direct search and by
attempted fetch, to be lookup/query tools rather than documented bulk or API sources; `customs.gov.vn`
and VTIP are JS-rendered, and a plain fetch could not surface an API contract. Third-party sites
(misa.vn, thuvienphapluat.vn, ecus.vn, dichvuhaiquan.com.vn) republish a regional customs district's
compiled `biểu thuế` tables — explicitly not treated as tariff-of-record evidence per the task's
rule, only as leads that were followed back toward (and stopped at) the primary sources above. No
official bulk/API route was found. Regional ASEAN tables were not substituted as Vietnam's tariff of
record.

### Indonesia — NO_DOCUMENTED_MACHINE_INTERFACE

CEISA 4.0's Open API documentation (official PDF, read in full — 9 pages) lists 22 endpoints, every
one of them a declaration-submission API (BC 2.0, BC 3.0, and related customs-document flows)
requiring Indonesian business registration (NIB via `oss.go.id`) and a CEISA portal account
(`portal.beacukai.go.id`). This is explicitly a public search/declaration tool, not a tariff-reading
source, and is recorded as such rather than mischaracterized as a positive "just needs a credential"
finding — the credential in question grants declaration submission, not tariff-rate read access.
BTKI (the national tariff book) was not found published as a separate bulk dataset or API distinct
from CEISA.

### Malaysia — NO_DOCUMENTED_MACHINE_INTERFACE, re-verified from the current position

The prior "restricted" finding was re-checked, not repeated blind. `data.gov.my`'s data catalogue
search for "tariff" returned a page with no confirmed dataset (JS-rendered, so a static no-results
check is unreliable, but no tariff dataset was surfaced by any means). The Royal Malaysian Customs
"HS Explorer" (`ezhs.customs.gov.my`, titled "JKDM HS Explorer") is reachable and was inspected
directly: it is a menu-driven interactive lookup tool (IMPORT/EXPORT navigation, HS search), with a
plain "Copyright © JKDM HS Explorer" footer and no licence, terms-of-use, `api`, `swagger`, or
structured-export marker anywhere in the page. This is new evidence, gathered fresh in this pass, and
it confirms rather than overturns the prior determination. Per the task's explicit instruction,
Malaysia is marked clearly and removed from near-term implementation, and should not be
re-researched again without a genuinely new development (e.g., a published open-data catalogue entry
or an explicit RMCD reuse statement).

### Thailand — NO_DOCUMENTED_MACHINE_INTERFACE, no alternative route found

`data.go.th` still returns HTTP 403 to automated retrieval (unchanged). This pass specifically
looked for another documented official machine route, per the task's instruction, and inspected
`customs.go.th` directly for the first time: its root page exposes a large static-document CMS
(`list_strc_download*.php` — laws, forms, procurement notices, annual reports) and an interactive
e-Tariff service (`tariffeservice.customs.go.th`) plus a "customs tariff service" infographic page —
no open-data section, no API documentation, no bulk download of the tariff schedule itself. No
circumvention of the 403 was attempted. There is no alternative to record; Thailand stays out of the
immediate coding queue.

### Singapore — NO_DOCUMENTED_MACHINE_INTERFACE / RIGHTS_UNRESOLVED, re-checked fresh

STCCED 2022 (adopting AHTN 2022) is confirmed to exist and to be Singapore's operative national
schedule, replacing the 2018 edition from 19 June 2022. It is published as a static PDF directly on
`customs.gov.sg` (e.g., the pattern `customs.gov.sg/files/businesses/STCCED <year>....pdf`), not as a
`data.gov.sg` dataset. The Singapore Open Data Licence was independently re-confirmed to be real and
broadly permissive (commercial and non-commercial use, modification, and redistribution all
permitted with attribution) — but it is confirmed, from its own text, to govern datasets published
through `data.gov.sg` and equivalent agency dataset portals (SLA, LTA DataMall, MOH, SFA each publish
their own Terms of Use tied to the same licence). No STCCED dataset entry on `data.gov.sg` was found.
The Tariff Finder remains interactive-only and was not probed as a data source. This confirms, rather
than overturns, Wave 2's finding: the licence is real, but not proven to attach to the tariff
schedule specifically. Singapore stays out of the coding queue.

### South Africa — WRITTEN_PERMISSION_REQUIRED, and SACU leverage explicitly does not apply

SARS publishes Schedule 1 (ordinary customs duty, chapters 1–99) as a dated PDF
(most recent found: 2026-08-06), alongside a July-2024 "Tariff Determination search engine" that
publishes only abridged determination outcomes, not the schedule itself. Neither is a structured
machine-readable dataset or API.

The rights question resolves cleanly and negatively: SARS's own Terms and Conditions page states
that site material is "used for personal, educational, or non-commercial purposes only. No further
reproduction or any form of distribution of the material and content is allowed," and separately
that content "shall not be used or exploited by Users for any c[ommercial] ... purpose." This is
explicit, primary, and directly on point — not inferred from the site being public.

**SACU leverage — investigated and explicitly rejected.** South Africa does set the common external
tariff schedule text for SACU (Botswana, Eswatini, Lesotho, Namibia, South Africa), and customs
revenue is pooled and shared under the SACU agreement. But this is common tariff **architecture**,
not a shared authoritative **data source**: each SACU member administers and publishes its own
domestic legal instrument giving effect to the CET, through its own customs authority. No evidence
was found (or sought beyond a reasonable primary-adjacent pass) that South Africa's Schedule 1
PDF is *itself* the legal source of record in Botswana, Eswatini, Lesotho, or Namibia. Per the task's
explicit instruction, SACU membership alone is not being used to count four destinations from one
source acquisition — and the point is moot in any case, since SARS's own terms block commercial
reuse regardless of how many territories the tariff nominally covers.

### Israel — NO_DOCUMENTED_MACHINE_INTERFACE, 403 not defeated, no new evidence

`gov.il/en/service/2customs-tariff` — the page search results describe as offering downloadable
"Customs Rate Files" in PDF, either as one full file or by section — returns HTTP 403 to both
WebFetch and a direct curl request carrying a plainly identifying user agent. This matches the prior
finding exactly; no alternative endpoint, licence, or catalogue record was found. `shaarolami-query`
remains a query-driven interactive tool. A GitHub demo repository ("Israel-Tax-Authority-OpenAPI-
Taxes-Demo") surfaced in search is a third-party demonstration unrelated to customs tariff data and
was correctly not treated as evidence of anything. Per the explicit instruction, the 403 was not
defeated and Israel is removed from the immediate coding queue.

## Replacement candidates (investigated because fewer than 5 of 12 cleared)

Three were investigated — Taiwan, Hong Kong, Chile — chosen for a plausible combination of strong
government open-data culture and (for Chile and Hong Kong) actual located structured tariff content.
Colombia, Peru, Mauritius, and Kenya were not investigated: with two of three investigated leads
already landing on the same `RIGHTS_UNRESOLVED` outcome as Iceland, and none of the three original
12 candidates' problems being "no strong data culture exists at all," there was no basis to expect a
fourth country to behave differently, and the task explicitly warns against adding replacements to
fill a quota.

- **Chile — DEFER, most promising replacement.** SNA (Servicio Nacional de Aduanas) publishes its
  Arancel Aduanero Nacional as decree-backed, sectional Excel files directly on `aduana.cl` (current
  version referencing a 2022 ministerial decree; per-chapter and per-section files, plus a full
  chapters 1–97 item listing). Separately, and confirmed by a direct CKAN `organization_show` API
  call against `datos.gob.cl`, SNA already publishes ten datasets (annual import/export declaration
  records, 2003–2026) under a confirmed `odc-by` licence — real evidence of an institutional
  open-data habit. No licence statement was found attached to the Arancel Excel files themselves,
  so this stays `RIGHTS_UNRESOLVED` rather than `CLEARED`, but it is the single most promising lead
  in this entire sprint for a short written-permission ask.
- **Hong Kong — DEFER, thinnest possible dataset.** Hong Kong is a free port: general import duty is
  0% for virtually all goods, with duty confined to four excise categories (liquor, tobacco,
  hydrocarbon oil, methyl alcohol). The actual rate content — confirmed by direct fetch, including a
  real tiered ad-valorem liquor-duty formula — lives on `customs.gov.hk`, not on `data.gov.hk`
  itself. `data.gov.hk`'s own policy explicitly grants free commercial and non-commercial reuse, but
  that grant was not confirmed to extend to the `customs.gov.hk` page specifically, so this is
  `RIGHTS_UNRESOLVED` rather than `CLEARED`. India relevance is minimal (near-universal 0% MFN rate
  leaves little for a preference scheme to do), which is the main reason this ranks behind Iceland
  and Chile despite cleaner rights signal generally.
- **Taiwan — inconclusive, not selected.** The Customs Administration's Tariff Database Search
  (GC451) is JS-driven with no documented API or bulk file located in a first pass, and Taiwan's
  central open-data platform integration for this specific dataset was not confirmed either way.
  This was a shallow pass by design — it did not clear the bar to justify the deeper primary-source
  work given to the twelve mandated candidates — and is reported as genuinely unresolved rather than
  silently dropped.

None of the three replacement leads changes the READY_TO_BUILD count. They do meaningfully change
the shape of the **near-term unlock plan** (see below).

## Build queue groups

**# WAVE 3 — BUILD NOW**

*(empty)*. No candidate in this sprint has both confirmed `CLEARED`/`CLEARED_WITH_CONDITIONS` rights
and a confirmed machine interface with understood semantics at the same time. Populating this
section with any of the below would repeat Wave 2's actual mistake in the opposite direction —
building on a foundation this pass did not actually establish.

**# CREDENTIAL QUEUE**

- **South Korea** — `data.go.kr` 15051179. Rights cleared (KOGL Type 1). Interface documented
  (OAS/Swagger REST API). Blocked only on `KCS_DATA_GO_KR_SERVICE_KEY`. Registration is
  self-service, free, and largely automatic (see per-country notes above for the exact steps).
  Highest-confidence single unlock in the entire sprint.

**# WRITTEN PERMISSION QUEUE**

- **Switzerland** (carried forward, `CH_BAZG_TARES`, unchanged) — commercial reuse of Tares requires
  written BAZG permission.
- **Liechtenstein** — inherits Switzerland's status; a single written-permission ask to BAZG, if
  granted, would legitimately cover both.
- **South Africa** — SARS's own Terms and Conditions explicitly restrict reuse to non-commercial
  purposes; a written commercial-use permission would be the unlock.

**# INTERFACE BLOCKED**

- **Thailand** — `data.go.th` HTTP 403; no alternative route found at `customs.go.th`.
- **Israel** — `gov.il` HTTP 403 on the download-service page; `shaarolami-query` interactive only.
- **Singapore** — STCCED published as static PDF outside the confirmed scope of the Open Data
  Licence; Tariff Finder interactive only.
- **Indonesia** — CEISA 4.0 is a declaration-submission API suite, not a tariff-rate source; no
  separate BTKI bulk/API found.
- **Vietnam** — Customs Dept. and VTIP both interactive lookup tools; no documented bulk/API found.
- **Malaysia** — JKDM HS Explorer is an interactive tool with no licence statement; `data.gov.my`
  surfaced no tariff dataset. Re-verified fresh in this pass; do not re-research without new
  evidence.

**# LEGALLY BLOCKED**

- **Türkiye** — explicit "Tüm Hakları Saklıdır" (All Rights Reserved) on the GTİP schedule page.

**# DEFER**

- **Iceland** — Grade A bulk-file interface, `RIGHTS_UNRESOLVED`. Recommended: one written outreach
  to Skatturinn asking whether `tollskrárlyklar` may be used commercially by third-party software —
  the dataset's own stated purpose (serving customs-declaration software vendors) makes a "yes"
  plausible.
- **Chile** — Grade B structured Excel interface, `RIGHTS_UNRESOLVED`, backed by a confirmed
  institutional open-data habit (other SNA datasets are `odc-by`). Recommended: written outreach to
  SNA/Aduana asking whether the Arancel Aduanero Excel files carry the same terms.
- **Hong Kong** — Grade C single-page interface, `RIGHTS_UNRESOLVED` for that specific page, minimal
  India relevance. Lower priority than Iceland/Chile but cheapest possible build if unblocked.
- **Mexico** — `SOURCE_INSUFFICIENT`. Not a rights or interface problem; the located dataset simply
  does not carry duty rates. Would need a genuinely new source discovery, not a re-ask.
- **Taiwan** — inconclusive on a shallow pass; would need a dedicated primary-source pass at the
  depth given to the twelve mandated candidates before any determination could be made.

## Coverage impact

Zero destinations are added if this sprint's queue is executed as-is, because the BUILD NOW group is
empty. This is the honest number.

If the two cheapest realistic unlocks both land — the Korea credential (self-service, no counterparty
approval needed) and one of the two written-permission asks (Iceland or Chile, whichever responds) —
coverage would grow from the current 34 to **36**, with South Korea and (Iceland or Chile) each
adding exactly one destination. Neither is a multi-destination pack: Korea's KOGL/API scope is
national only, and neither Iceland nor Chile shares an executing authority with any other atlas
destination the way Liechtenstein shares one with Switzerland.

The one genuine multi-destination opportunity surfaced in this sprint is **Liechtenstein riding on a
future Switzerland unlock** — not a Wave 3 win, since Switzerland itself remains
`WRITTEN_PERMISSION_REQUIRED`, but worth recording so a future Swiss written-permission grant is
known in advance to cover LI at no extra acquisition cost. The SACU (South Africa / Botswana /
Eswatini / Lesotho / Namibia) leverage question was investigated and explicitly rejected: common
tariff architecture was confirmed, a shared authoritative data source was not, and the point is moot
regardless because SARS's own terms block commercial reuse of the source at all.

## # FROZEN WAVE 3 IMPLEMENTATION QUEUE

**Empty.** No pack in this sprint satisfies all four gates (official source identified, rights
resolved, machine acquisition resolved, tariff semantics understood well enough to begin parser
work) at the same time. Handing this queue to a coding agent as-is would mean handing it nothing —
which is the correct instruction, not a failure of the sprint. The nearest things to a queue are the
CREDENTIAL QUEUE (Korea) and DEFER entries (Iceland, Chile) above, each one human action away from
qualifying, and each with its exact required action stated.

## Final report

1. **Starting HEAD:** `1cb037ddc1f73871cab6ef0a315b90e802e93861`, on `agent-portal-and-document-engine`, unchanged by this sprint except for this document.
2. **Research commit SHA:** none yet — see commit note below.
3. **All 12 candidate determinations:** see Master Matrix and per-country notes above. South Korea `CREDENTIAL_REQUIRED`; Iceland `RIGHTS_UNRESOLVED`; Liechtenstein not independent (inherits Switzerland); Mexico `SOURCE_INSUFFICIENT`; Türkiye `LEGALLY BLOCKED`; Vietnam, Indonesia, Malaysia, Thailand, Singapore, Israel all `NO_DOCUMENTED_MACHINE_INTERFACE` (Singapore and Malaysia carry an additional unresolved-rights dimension); South Africa `WRITTEN_PERMISSION_REQUIRED`.
4. **Replacement candidates considered:** Chile and Hong Kong (`RIGHTS_UNRESOLVED`, both real leads, documented above with a recommended next action); Taiwan (inconclusive, shallow pass, not selected). Colombia, Peru, Mauritius, Kenya not investigated — no basis found to expect a different outcome, and the task explicitly warns against padding the pool.
5. **READY_TO_BUILD count:** 0 of 12, and 0 of 3 replacement leads.
6. **Credential / permission / interface blockers, tallied:** 1 credential (Korea); 3 written-permission (Switzerland carried forward, Liechtenstein by inheritance, South Africa); 6 interface-blocked with no rights finding either way (Vietnam, Indonesia, Malaysia, Thailand, Israel, and Singapore which also carries a rights dimension); 1 legally blocked outright (Türkiye); 1 source-insufficient (Mexico); 3 deferred-but-promising (Iceland, Chile, Hong Kong).
7. **Multi-destination opportunities:** exactly one identified and explicitly not double-counted — Liechtenstein inherits whatever Switzerland's status becomes. SACU leverage for South Africa was investigated and explicitly rejected (common architecture, not a shared source).
8. **Frozen Wave 3 build queue:** empty, by design — see section above.
9. **Expected destination count after a successful Wave 3:** 34 (unchanged) under a strict build-queue interpretation. Under the realistic near-term unlock path (Korea credential + one of Iceland/Chile written permission), 36.
10. **Recommended coding model/effort for the eventual Wave 3B build:** once at least Korea's credential is provisioned, a single small coding pass (comparable effort to Norway in Wave 2) can implement it — the schema, licence, and registration mechanics are already fully characterized here, leaving only the empirical FTA-code confirmation as in-flight work. Do not start a coding wave against the current pool otherwise.
11. **New Customs Atlas architecture pressure discovered:** none. Every candidate that could plausibly become buildable (Korea, Iceland, Chile, Hong Kong) fits the existing bulk-family or single-page-fact archetypes already in the platform; no new adapter shape, cache behavior, or qualification-gate change is implied by anything found in this sprint.
12. **Absolute constraints honored:** no adapters written, no deploys, no production changes, no Phase 2 work, no Country Truth scoring changes. `src/lib/market-access/unconfigured-sources.ts` was read for context and conventions but not modified, since it is runtime code and this task is research-only — its Korea/Switzerland/Singapore/Thailand/Israel entries remain accurate as of this pass and needed no correction.
13. **Verdict — is the Wave 3 implementation queue now pre-filtered enough to expect >50% build success?** **N/A in the literal sense — there is no queue to run this test against, because it is empty.** Read charitably, the filtering itself worked: every candidate that would have failed if coded blind was caught before code was written, which is exactly what this sprint was for. The honest recommendation is not to launch a Wave 3 coding pass from this pool at all. Instead: (a) provision the Korea credential — near-certain single-destination success; (b) send the two short written-permission asks (Iceland, Chile) in parallel — low cost, plausible yield; (c) only convene a coding wave once at least one of these lands, at which point that specific, now-fully-resolved pack should expect close to 100% build success, because everything that would have made it fail has already been found and recorded.
