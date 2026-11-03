# MEGA-WAVE A — frozen build queue

Decision date: **04 Sep 2026**. This queue is derived from
[`mega-wave-a-source-clearance.md`](mega-wave-a-source-clearance.md). It authorizes no runtime work;
each pack retains its listed gate until a later implementation task is explicitly approved.

## Queue summary

| Queue | Count | Destinations |
|---|---:|---|
| A — BUILD NOW | 2 | Taiwan, Georgia |
| B — CONDITIONS / MANUAL | 1 | Philippines |
| C — CREDENTIAL | 0 | — |
| D — WRITTEN PERMISSION | 4 | Mauritius, Pakistan, Jamaica, Panama |
| E — RIGHTS UNRESOLVED | 11 | Sri Lanka, Ecuador, Nigeria, Uruguay, Bangladesh, Nepal, Albania, Tunisia, Peru, Costa Rica, Dominican Republic |
| F — INDIVIDUAL INVESTIGATION | 1 | Montenegro |
| G — BLOCKED / INSUFFICIENT | 5 | Argentina, Paraguay, Colombia, North Macedonia, Trinidad & Tobago |
| **Total** | **24** | |

The ordering within A and B applies the requested factors in order: source certainty, rights
certainty, India export relevance, implementation cost, then architectural leverage. Ordering in
the gated queues reflects expected value after—not before—the gate is cleared.

## A — BUILD NOW

| Rank | Pack | Why it is here | Frozen implementation shape |
|---:|---|---|---|
| 1 | **Taiwan Customs import duty information** | Current primary CSV; explicit OGD 1.0 commercial derivative/sublicensing grant; 12,679 rows; strongest acquisition/right combination. | Simple `AuthorityRelease`; CSV parser; structured ad valorem/specific/alternative rates; mandatory attribution. |
| 2 | **Georgia Tax Code Article 197** | Executable consolidated law; official legal texts expressly excluded from copyright; very small schedule. | Legal `AuthorityRelease`; enumerate 5%/12% lists and residual zero; preserve alcohol and vehicle formulas. |

Both passed the final audit: **source yes, acquisition yes, rights yes, executable national rates
yes, retention/transformation/derived customer display yes**. Neither requires a credential or
human permission. Taiwan ranks first because its full table and update channel are more conventional;
Georgia is smaller but semantically more formula-heavy.

## B — BUILD NOW WITH CONDITIONS / MANUAL FILE

| Rank | Pack | Condition | Frozen implementation shape |
|---:|---|---|---|
| 1 | **Philippines Tariff Commission** | Acquire current MFN and AIFTA artifacts manually through the official Finder/Commission UI; record source URLs, timestamps and checksums; confirm EO 62 overlay before parsing. | Composite release: AHTN 2022 Tariff Book + MFN EO amendments + annual AIFTA schedule; Form AI/RoO gate. |

The official Finder's “All content is in the public domain unless otherwise stated” statement clears
reuse for the observed content. A stable automated bulk route was not established, but a controlled
manual official-file release is a supported Atlas pattern and is not a blocker.

## C — CREDENTIAL

**None.** No country in this wave was classified as merely waiting on an API key/account. A public
interactive page with undocumented endpoints was not converted into `CREDENTIAL_REQUIRED`.

## D — WRITTEN PERMISSION

| Priority | Destination | Exact release action |
|---:|---|---|
| 1 | **Mauritius** | Ask Government Information Service/MRA to approve periodic acquisition, normalization, historical retention and paid derived/customer display of the Integrated Tariff, without raw redistribution; obtain attribution wording. |
| 2 | **Pakistan** | Ask FBR for commercial international reuse beyond its residents/citizens, single-page, unmodified, no-cost permission; include the FY 2026–27 baseline and SRO/Fifth Schedule use. |
| 3 | **Jamaica** | Ask JCA to license the 10 Aug 2026 Integrated Tariff for transformation, retained releases and derived SaaS display; clarify CARICOM/WCO exclusions. |
| 4 | **Panama** | Ask ANA for data permission and the supported export/API, field dictionary, rate limits and history route; its service states all rights reserved. |

Mauritius is the highest-value human action because its current 807-page integrated tariff already
contains an explicit `INDIA`/CECPA rate column and the remaining blocker is narrow and external.

## E — RIGHTS UNRESOLVED

| Priority | Destination | Source readiness | Exact rights/currentness action |
|---:|---|---|---|
| 1 | **Sri Lanka** | Excellent: current 35 MB/173-file tariff ZIP with tax and preference columns. | Obtain Customs licence for commercial transformation, history and customer display; confirm WCO exclusions. |
| 2 | **Ecuador** | Excellent: live official REST payloads include dates, norms, variables, liberations, quotas and restrictions. | Obtain SENAE authorization for automated calls/caching/derived display and endpoint/data-dictionary support. |
| 3 | **Nigeria** | Strong: official NCS page API, CET portal and 59 MB schedules PDF. | Obtain NCS/ECOWAS dataset licence and populated full-tariff export; confirm national-list precedence. |
| 4 | **Uruguay** | Strong: 1.29 MB/~20k-row official national XLSX with AEC and national rates. | Attach the national open-data licence to this exact workbook and obtain 2026/amendment plus India-PTA files. |
| 5 | **Bangladesh** | Strong: executable compact tariff PDF and official live tariff. | Obtain NBR reuse grant and complete FY 2026–27 baseline/SRO set. |
| 6 | **Nepal** | Strong: current 31 MB/683-page integrated tariff PDF. | Obtain Customs/MOF reuse terms and authoritative India/SAFTA instrument; clarify translation rights. |
| 7 | **Albania** | Strong: current 2026, 961-page text tariff plus preference/quota page. | Obtain Customs commercial reuse/retention/display permission and attribution/WCO scope. |
| 8 | **Tunisia** | Strong live national tariff, updated 2 Sep 2026. | Obtain supported extraction route and reuse terms for retained paid display. |
| 9 | **Peru** | Moderate: authoritative 2022 baseline and decree route, but consolidation work remains. | Obtain SUNAT/MEF licence and current amendment manifest. |
| 10 | **Costa Rica** | Rich 17k-row/53-column workbook, but observed file is dated May 2022. | Obtain current COMEX file/change manifest and file-specific commercial licence. |
| 11 | **Dominican Republic** | Official page/notice exists; complete file not preserved. | DGA must provide current complete tariff + amendments and explicit reuse terms. |

Rights silence remains silence. None of these packs may enter implementation merely because its file
is public or technically easy to parse.

## F — INDIVIDUAL INVESTIGATION

| Priority | Destination | Investigation packet |
|---:|---|---|
| 1 | **Montenegro** | Ask Customs/TARICG owner for the supported export/API, an observed payload and code dictionary, historical releases, ownership split between tariff facts and ZZI software, and full commercial reuse terms. |

This is deliberately separate from `RIGHTS_UNRESOLVED`: both the acquisition contract and the
semantic payload remain unknown, so a permission email alone may not make the pack buildable.

## G — BLOCKED / INSUFFICIENT

| Priority | Destination | Missing authoritative layer |
|---:|---|---|
| 1 | **Argentina** | Current ARCA/SIM/VUCE national execution export: 11-digit measures, exception/temporary lists, dates/units, and national India–MERCOSUR PTA annex. Government CC BY is useful but the source is incomplete. |
| 2 | **Paraguay** | Official-gazette legal annex and current amendment chain. The fetched MEF compilation says it is referential and has no legal force. |
| 3 | **Colombia** | Complete current DIAN tariff export or reproducible public payload plus amendment manifest and attached reuse terms. |
| 4 | **North Macedonia** | Complete Official Gazette 261/25 annex/current tariff release, amendment history and official-text/reuse rule. |
| 5 | **Trinidad & Tobago** | Complete 2024 CET Order First Schedule plus every later amendment/suspension and the official legal-text reuse rule. |

No implementation starts from a user manual, search-result snippet, obsolete baseline, or isolated
amendment notice.

## Frozen implementation batches

These are six-pack planning cohorts. A pack enters engineering only when its row's status is A or B;
the grouping does not waive a gate.

| Batch | Authority packs | Activation rule | Purpose |
|---|---|---|---|
| **1 — cleared core (6)** | Taiwan; Georgia; Philippines; Mauritius; Sri Lanka; Ecuador | Start Taiwan/Georgia immediately and Philippines after manual checksum preflight. Mauritius, Sri Lanka and Ecuador remain frozen until their named rights actions clear. | Establish CSV, legal-schedule, manual composite, multi-column preference and live-measure patterns with the highest-value sources. |
| **2 — structured national (6)** | Uruguay; Nigeria; Bangladesh; Nepal; Albania; Costa Rica | Each pack activates only after its licence/current-release action. | Reuse XLSX, large PDF, chapter/composite and regional-overlay machinery without pretending a shared bloc source executes nationally. |
| **3 — permission / live systems (6)** | Pakistan; Jamaica; Panama; Tunisia; Peru; Dominican Republic | Written permission where required; otherwise licence plus complete current source. | Close high-value legal-PDF and live-lookup families, then add preference/levy overlays. |
| **4 — source reconstruction (6)** | Argentina; Paraguay; Colombia; North Macedonia; Montenegro; Trinidad & Tobago | Complete authoritative source and rights must be evidenced first. | Last cohort: national exception layers, Gazette composites and undocumented integrated systems. |

Within each activated batch, ingest a fresh source into a non-production research fixture, freeze its
checksum/metadata, and qualify semantic canaries before any destination is counted operational.

## Coverage math

Baseline is fixed at **35 operational destinations**.

| Stage | Added | Projected total | Distance to 120 |
|---|---:|---:|---:|
| Baseline | — | 35 | 85 |
| Immediate A queue: Taiwan + Georgia | 2 | **37** | **83** |
| After conditional/manual Philippines | +1 | **38** | **82** |
| Plausible first external-clearance tranche: ten strong rights/currentness packs (Sri Lanka, Ecuador, Nigeria, Uruguay, Bangladesh, Nepal, Albania, Tunisia, Peru, Costa Rica) | +10 | **48** | **72** |
| Ceiling if every remaining external/source action in this 24-country wave eventually clears | +11 more | **59** | **61** |

- **Immediate buildable additions:** 2.
- **Conditional/manual additions:** 1.
- **External-action queue:** 21 (4 permission, 11 rights-unresolved, 1 individual investigation,
  5 source-insufficient).
- **Projected total after the immediate build queue:** 37; 38 after the controlled manual pack.
- **Projected total after plausible external resolutions:** 48. This is a planning scenario, not a
  claim that permission has been granted.
- **Remaining distance to 120+:** 72 after the plausible tranche. Even the all-wave ceiling of 59
  leaves 61 destinations to reach 120.

Regional members are not multiplied into these totals. The model is: ASEAN and CAN are shared
nomenclatures with national execution; ECOWAS is a regional CET base plus national overlays;
MERCOSUR requires one regional base plus three national overlays for these three countries; SIECA
requires one base plus Costa Rica/Panama overlays while the Dominican Republic is separate; CARICOM
requires one base plus Jamaica and Trinidad overlays.

## Top five next engineering packs

1. **Taiwan** — implement first; best combination of source, rights, freshness and parser cost.
2. **Georgia** — implement second; small source with high-value formula semantics and clean legal
   rights.
3. **Philippines** — perform the manual acquisition/checksum preflight, then implement the MFN + EO
   + AIFTA composite.
4. **Sri Lanka, contingent** — prepare no code until rights clear; then use its complete 2026 ZIP to
   exercise chapter-release and India-FTA semantics.
5. **Mauritius, contingent** — prepare no code until written approval; then prioritize the explicit
   India/CECPA column and multi-program schedule.

## Top five human / external actions

1. Secure **Mauritius MRA/Government Information Service** approval for the current Integrated
   Tariff and CECPA display.
2. Secure **Sri Lanka Customs** commercial reuse/retention/display terms for the 2026 ZIP.
3. Secure **SENAE Ecuador** authorization, supported endpoint policy and field/code dictionary.
4. Ask **Uruguay MEF** to attach its open-data licence to the national workbook and supply the 2026
   delta plus India-PTA annex.
5. Ask **Nigeria Customs Service/ECOWAS** for a licensed full tariff export and national overlay
   definitions.

## Freeze rule

This queue remains frozen until new primary evidence changes a row. A response must explicitly cover
commercial use, acquisition, transformation/normalization, internal caching, historical retention,
derived SaaS/customer display, attribution, raw redistribution and third-party/WCO exclusions.
Anything less stays at its current status.
