# Customs Atlas global source harvest

**Decision date:** 15 September 2026  
**Repository checkpoint:** `9b9b0edf3a949985cf088a3c11e10c873042f601`  
**Scope:** 74 non-operational destinations across Asia, the Middle East, Europe, Africa, Latin
America, the Caribbean and the Pacific  
**Result:** **6 GREEN / 22 AMBER / 46 RED**

This was a source-discovery pass only. It did not create providers, parsers, releases, database
records, staging changes or deployments. The operational set was excluded. Prior blocked
destinations were stopped quickly unless a new current artifact or reuse rule materially changed
their gate. `GREEN` means all four discovery gates have primary evidence; it does not mean a parser
has passed implementation validation.

The result is deliberately below the requested 15–25. Only six countries cleared currentness,
deterministic acquisition, reuse and complete national tariff execution without assuming that an
interactive lookup or regional nomenclature is executable national evidence.

## GREEN — ready for an implementation wave

| Rank | Country | Authority and current national source | Deterministic format | Reuse basis | India preference | Provider family |
|---:|---|---|---|---|---|---|
| 1 | Nepal (`NP`) | Department of Customs, [Customs Tariff 2026/27](https://customs.gov.np/content/50/custom-tariff-rate/) (complete duty schedule and notes) | One stable official 555-page PDF | Copyright Act s.4 excludes administrative decisions and ordinary facts/data; [official statute record](https://repository.lawcommission.gov.np/np/category/documents/law-archives/statutes-acts-law-archives/%E0%A4%AA%E0%A5%8D%E0%A4%B0%E0%A4%A4%E0%A4%BF%E0%A4%B2%E0%A4%BF%E0%A4%AA%E0%A4%BF-%E0%A4%85%E0%A4%A7%E0%A4%BF%E0%A4%95%E0%A4%BE%E0%A4%B0-%E0%A4%90%E0%A4%A8-%E0%A5%A8%E0%A5%A6%E0%A5%AB%E0%A5%AF/) | `OPERATIVE_PREFERENCE` — the Government of India lists the [India–Nepal Trade Treaty](https://www.commerce.gov.in/ministryofcommerce/node/3398) | `OFFICIAL_PDF_TABLE` |
| 2 | Bhutan (`BT`) | Department of Revenue and Customs, [Bhutan Trade Classification and Tariff Schedule, 7th ed., amended 2026](https://www.drc.gov.bt/bts-publication/) | One stable consolidated official PDF | Copyright Act s.7 excludes mere data and official legislative, administrative and legal texts; [official Act](https://www.moice.gov.bt/wp-content/uploads/2023/03/Copyright-Act-of-Kingdom-of-Bhutan-2001.pdf) | `OPERATIVE_PREFERENCE` — the bilateral agreement provides a free-trade regime; [official agreement index](https://www.commerce.gov.in/ministryofcommerce/node/3398) | `OFFICIAL_PDF_TABLE` |
| 3 | Montenegro (`ME`) | Government of Montenegro, [2026 Customs Tariff Regulation](https://www.gov.me/en/documents/c9ad2bc2-dfc4-4107-9fea-585c792b81af), Official Gazette 157/2025, Annex I and appendices 1–4, effective 1 Jan 2026 | Versioned official PDF download | The current law excludes official legislative, administrative and judicial texts and translations; [official law record](https://www.gov.me/en/documents/6bcfee53-7f07-435d-a32f-9422d4ddf94d) | `UNKNOWN` | `OFFICIAL_PDF_TABLE` |
| 4 | Albania (`AL`) | Albanian Customs, [Combined Nomenclature 2026](https://dogana.gov.al/english/d/182/248/0/231/combined-nomenclature-of-goods), 2025–2026 correlations and [2026 preferential tariff](https://www.dogana.gov.al/dokument/6717/tarifa-preferenciale-2026) | Stable annual official documents with a dated correlation release | Copyright Law 35/2016 Art. 12 excludes official public-information texts and simple facts/data; [official-law record](https://www.wipo.int/wipolex/en/text/410069) | `UNKNOWN` | `VERSIONED_ARCHIVE` |
| 5 | North Macedonia (`MK`) | Customs Administration, [2026 Customs Tariff decision and correlation archive](https://customs.gov.mk/zakon-za-carinska-tarifa.nspx), Official Gazette 261/2025 | Stable annual official decisions plus version-to-version correlation files | Copyright law Art. 16 excludes official legislative, executive, administrative and judicial texts and facts/data; [law record](https://www.wipo.int/wipolex/en/legislation/details/11672) | `UNKNOWN` | `VERSIONED_ARCHIVE` |
| 6 | Mauritius (`MU`) | Mauritius Revenue Authority, [Integrated Tariff as at 13 Aug 2026](https://www.mra.mu/index.php/customs1/tariff-information) plus the complete dated [stakeholder-notice index](https://www.mra.mu/customs1/notice-to-stakeholders), including later Finance Act measures | Stable official baseline PDF plus ordered official notices and annexes | Government material may be reproduced accurately with source acknowledgement; [government copyright policy](https://www.govmu.org/EN/Pages/Copyright.aspx). The Copyright Act also excludes official texts and mere data; [law record](https://www.wipo.int/wipolex/en/legislation/details/15447) | `OPERATIVE_PREFERENCE` — MRA publishes an India CECPA tariff column and [implementation notice](https://www.mra.mu/download/NoticeCECPA260321.pdf) | `BASELINE_PLUS_AMENDMENTS` |

For these six, the observed artifacts contain the national commodity schedule and rates rather than
only HS/AHTN/CN nomenclature. Their appendices or indexed notices expose the tariff-affecting
exceptions needed to reproduce the current legal state. Ordinary permits may still remain outside
the tariff provider with `regulatory_coverage_complete=false`.

## AMBER — viable only after one country investigation

| # | Country | One unresolved issue |
|---:|---|---|
| 1 | Bangladesh (`BD`) | The complete FY 2026/27 operative tariff and all-SRO bundle are static official PDFs, but the national open-data licence is not clearly attached to Customs files outside the open-data catalogue. |
| 2 | Pakistan (`PK`) | The current FBR tariff is deterministic, but [FBR terms](https://www.fbr.gov.pk/Term-of-Use/544) limit copying/sharing by user and purpose; written commercial reuse clearance is still required. |
| 3 | Türkiye (`TR`) | Current 2026 GTIP Excel files and the official-text exclusion now clear acquisition/rights, but the full import-regime, additional-duty, quota and safeguard chain has not been proved complete. |
| 4 | Ukraine (`UA`) | The [current CSV/XLSX duty-rate dataset](https://data.gov.ua/dataset/duty-rates) is openly licensed, but wartime exemptions, quotas and temporary tariff measures still need an exhaustive current overlay manifest. |
| 5 | Kosovo (`XK`) | The [2026 TARIK PDF](https://dogana.rks-gov.net/sharedfolder/ProductFiles/2026_488f89e7-9610-4161-b671-3e11c747d458.pdf) and official-text exclusion are strong, but Customs says amendments occur regularly and exposes no proved complete amending-instruction manifest. |
| 6 | Serbia (`RS`) | The [2026 consolidated tariff](https://www.carina.rs/privreda/tarifski-poslovi/carinska-tarifa/privreda_carinska_tarifa_opste.html) is official and reproducible, but quotas, excise/control changes and dated amendments have not been closed as one exhaustive replay. |
| 7 | Sri Lanka (`LK`) | The complete official 2026 PDF bundle is public-domain, but Customs has not published a proved reconciliation of tariff-changing gazettes after the 16 May bundle. |
| 8 | China (`CN`) | Official 2026 XLSX/PDF schedules exist, but a complete join of temporary rates, quotas, preferences and product-specific trade remedies remains unproved. |
| 9 | Thailand (`TH`) | Customs publishes deterministic ZIP/XLSX/PDF deltas, but no authoritative full base and gap-free replay of roughly 1,952 releases has been demonstrated. |
| 10 | Brunei (`BN`) | The 2022 BDTTC and later official orders/notices are downloadable, but the complete 2022-to-current amendment chain has not been established. |
| 11 | Brazil (`BR`) | Current CAMEX XLSX/JSON sources are strong, but complete TTCE treatments require unavailable credentials or a proved public quotas/remedies/preferences overlay. |
| 12 | Bolivia (`BO`) | An annual official base exists, but temporary 2026 suspensions and circulars need a proven exhaustive, ordered manifest with expiry semantics. |
| 13 | El Salvador (`SV`) | SIECA plus national notices is promising, but the national quota, temporary-DAI and extension replay has not been proved complete. |
| 14 | Côte d’Ivoire (`CI`) | The national 6,381-line PDF was updated 27 Mar 2026, but no complete post-March tariff-circular reconciliation was found. |
| 15 | Tanzania (`TZ`) | The EAC base is deterministic, but Tanzania-specific 2026/27 stays, remissions, levies and expiries lack a closed national overlay manifest. |
| 16 | Uganda (`UG`) | The EAC base is deterministic, but Uganda-specific 2026/27 stays, remissions and sector measures lack a closed national overlay manifest. |
| 17 | Rwanda (`RW`) | Rwanda has the best EAC archive, but the visible Gazette index does not close all July–September 2026 partner-state overrides. |
| 18 | Zambia (`ZM`) | The January 2026 national PDF is usable, but later conditional and temporary statutory instruments, including September wheat suspensions, need a complete manifest. |
| 19 | Botswana (`BW`) | SACU provides genuine shared rates, but the complete SARS multi-schedule amendment chain plus Botswana rebates, exemptions and tax overlay has not been qualified. |
| 20 | Mozambique (`MZ`) | Law 8/2025 and its tariff files are official and reusable as legal texts, but it appears to amend rather than conclusively consolidate the full current schedule. |
| 21 | Malawi (`MW`) | A 2022 tariff base and 2026/27 official tax-measures release exist, but no gap-free 2022-to-current customs amendment chain was found. |
| 22 | Trinidad and Tobago (`TT`) | The 2024 CET Order and later suspension/variation notices are official, but the authority has not exposed an exhaustive through-current notice replay. |

## RED — reject for the present engineering wave

| # | Country | Rejection reason |
|---:|---|---|
| 1 | Hong Kong (`HK`) | No supported immutable bulk/API release and dataset-attached reuse basis were found for the live tariff/excise presentation. |
| 2 | Singapore (`SG`) | Tariff Finder is interactive-only; no documented Customs bulk/API or tariff-dataset licence is attached. |
| 3 | Malaysia (`MY`) | The national tariff remains an unsupported interactive service; AHTN is not national duty execution. |
| 4 | Indonesia (`ID`) | INSW/BTKI is interactive and no documented full public export/API with history was found. |
| 5 | Vietnam (`VN`) | Current rates depend on legal schedules and national measures without a supported full export/API or complete current compilation. |
| 6 | Cambodia (`KH`) | The 2022 tariff plus later decrees is not a current consolidated schedule or exhaustive amendment chain. |
| 7 | Laos (`LA`) | The portal is interactive-only and says AIFTA is under revision; neither acquisition nor preference state is deterministic. |
| 8 | Mongolia (`MN`) | Customs exposes interactive tables but no documented bulk/API, immutable release or history. |
| 9 | Saudi Arabia (`SA`) | The integrated-tariff export is an undocumented UI function with no supported automated contract or immutable history. |
| 10 | United Arab Emirates (`AE`) | The static baseline does not close 2026 national amendments, India CEPA schedules, quotas and GCC trade-remedy execution. |
| 11 | Qatar (`QA`) | The tariff is a dynamic inquiry and 2026 decisions, without a supported full export/API or version history. |
| 12 | Kuwait (`KW`) | Customs provides only an interactive HS lookup with no documented bulk/API, release identity or history. |
| 13 | Bahrain (`BH`) | A paid third-party schedule cannot replace a supported current Customs release; official machine acquisition remains absent. |
| 14 | Lebanon (`LB`) | Chapter HTML is queryable but there is no supported bulk/API, immutable release or complete machine amendment manifest. |
| 15 | Egypt (`EG`) | The national tariff is exposed through interactive/legal surfaces without a current complete deterministic release. |
| 16 | Jordan (`JO`) | Interactive tariff services do not expose a supported complete export/API or immutable national history. |
| 17 | Morocco (`MA`) | ADIL is interactive-only for this purpose; no documented full tariff export/API and replay contract was found. |
| 18 | Tunisia (`TN`) | The current tariff application is interactive-only, with no supported bulk/API or immutable release. |
| 19 | Algeria (`DZ`) | The 2026 Finance Law and gazettes do not form a proved current consolidated national tariff or exhaustive replay. |
| 20 | Iraq (`IQ`) | No competent-authority current complete deterministic tariff artifact was found in the fast pass. |
| 21 | Iran (`IR`) | No current complete official machine/static tariff and defensible reuse combination was found. |
| 22 | Philippines (`PH`) | The national schedule is fragmented across orders and temporary measures; no proved complete current execution release was found. |
| 23 | Myanmar (`MM`) | No current complete official deterministic tariff with a defensible reuse basis was found. |
| 24 | Kenya (`KE`) | The EAC CET does not encode Kenya-specific stays, remissions, levies and current national execution. |
| 25 | South Africa (`ZA`) | SARS rates are deterministic, but restrictive publication terms and the multi-schedule amendment model remain unsuitable without permission. |
| 26 | Namibia (`NA`) | The national portal lacks a supported bulk/history contract and SACU rates do not supply Namibia's complete national overlays. |
| 27 | Ghana (`GH`) | Public band/levy guidance and ICUMS do not provide a complete supported commodity-level national export/API. |
| 28 | Senegal (`SN`) | ECOWAS documents and national tax guidance do not provide a dated current line schedule with all Senegal overlays. |
| 29 | Fiji (`FJ`) | Current changes exist, but no clearly current complete static base or supported ASYCUDA export/API was found. |
| 30 | Papua New Guinea (`PG`) | The base Act plus later budget measures is not a current consolidated source or complete amendment manifest. |
| 31 | Zimbabwe (`ZW`) | The authority still exposes an old tariff handbook plus scattered statutory instruments, not current reproducible execution. |
| 32 | Angola (`AO`) | The tariff portal does not expose a supported current bulk/API or immutable complete national release. |
| 33 | Colombia (`CO`) | DIAN's live tariff/normative surfaces do not provide a complete supported machine release with all current national measures. |
| 34 | Ecuador (`EC`) | ECUAPASS is interactive; no complete anonymous export/API or immutable national release was established. |
| 35 | Guatemala (`GT`) | SAT/SIECA is interactive and the regional SAC preserves national DAI changes not supplied as a complete overlay. |
| 36 | Honduras (`HN`) | No complete national tariff export/API or exhaustive Honduras overlay on the SIECA base was found. |
| 37 | Nicaragua (`NI`) | No complete current supported bulk/API, immutable release or exhaustive national amendment chain was found. |
| 38 | Mexico (`MX`) | Legal schedules and correlations do not yield one complete current executable tariff with all exceptions and remedies. |
| 39 | Argentina (`AR`) | MERCOSUR nomenclature/rates do not supply a complete current Argentine national execution source and overlay. |
| 40 | Paraguay (`PY`) | MERCOSUR CET material does not supply a complete current Paraguayan national execution source and overlay. |
| 41 | Uruguay (`UY`) | MERCOSUR material plus national exceptions was not available as one complete current deterministic execution release. |
| 42 | Panama (`PA`) | The live tariff service lacks a supported full export/API, immutable history and closed national overlay chain. |
| 43 | Costa Rica (`CR`) | The SIECA base and national interactive presentation do not provide complete deterministic Costa Rican execution. |
| 44 | Dominican Republic (`DO`) | The tariff lookup/legal releases do not expose one complete supported current machine/static execution source. |
| 45 | Bahamas (`BS`) | A 2026 amendment Act was found, but not a current consolidated baseline plus exhaustive amendment manifest and reuse pack. |
| 46 | Jamaica (`JM`) | No current complete official deterministic national tariff and closed CARICOM/national amendment chain was found. |

Detailed evidence for many carried-forward AMBER/RED decisions remains in the
[Mega-Wave D gate](./mega-wave-d-source-gate-2026-09-15.md),
[Mega-Wave C gate](./mega-wave-c-source-gate.md), and
[targeted unblock sprint](./targeted-unblock-sprint-2026-09-14.md). This harvest changes a prior
decision only where newer primary evidence closed the old blocker: national official-text/data
rules for Nepal, Bhutan, Montenegro, Albania and North Macedonia, and the combined government
reuse/statutory basis plus current notice chain for Mauritius.

## GREEN family clusters

| Shared reader family | GREEN countries | Reusable implementation shape |
|---|---|---|
| `OFFICIAL_PDF_TABLE` | Nepal, Bhutan, Montenegro | Immutable PDF acquisition, page/layout fingerprint, tabular row extraction, note/appendix association and fail-closed totals |
| `VERSIONED_ARCHIVE` | Albania, North Macedonia | Annual release manifest, correlation-table ingestion, version effectivity and archive supersession |

Mauritius is the single qualified `BASELINE_PLUS_AMENDMENTS` member, so it is not presented as a
cluster. No GREEN member qualified for `STRUCTURED_TABLE`, `FIXED_WIDTH`, `DOCUMENTED_API` or
`REGIONAL_BASE_PLUS_SIMPLE_NATIONAL_OVERLAY` in this pass.

## Implementation wave recommendation

Select **all six GREEN destinations**, in this order:

1. **Nepal** — one current national table, an existing destination code, operative India treaty,
   and maximum leverage for the PDF reader.
2. **Bhutan** — one amended consolidated table, operative India free-trade treatment and the same
   PDF reader shape.
3. **Montenegro** — one effective annual regulation with bounded appendices; third validation case
   for the PDF reader.
4. **Albania** — stable annual archive and correlations; establishes the versioned-archive reader.
5. **North Macedonia** — reuses the annual-archive reader while validating a second Gazette-backed
   release pattern.
6. **Mauritius** — excellent India relevance and an explicit India column, but implement last
   because ordered post-baseline notices require the most effectivity logic.

**Expected provider families:** `OFFICIAL_PDF_TABLE`, `VERSIONED_ARCHIVE`,
`BASELINE_PLUS_AMENDMENTS`  
**Expected activations:** **5–6** after real-file parser, semantic, checksum and release-manifest
qualification. Do not substitute an AMBER country if one fails; return it to individual research.

Implementation and deployment were not started. Production was not accessed or changed.
