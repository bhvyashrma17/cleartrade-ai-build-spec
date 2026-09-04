# MEGA-WAVE A — 24-country source clearance

Research date: **04 Sep 2026**. Research only: no adapters, runtime, schema, configuration, or
production changes. Starting repository state: `cc7ade128b38c6350dced43dfb6ffd07d85ff820` on
`agent-portal-and-document-engine`, with a clean worktree.

## Decision standard and result

`BUILD_NOW` means that the executing authority, a legitimate acquisition path, commercial reuse,
executable national treatment, and retention/transformation/derived customer display are all
affirmatively supported. Public access is not treated as a reuse grant. An official manual file is
a valid acquisition. A regional nomenclature or base rate is not counted as national execution
where national exceptions remain.

| # | Destination | Final status | Decisive fact |
|---:|---|---|---|
| 1 | Taiwan | **BUILD_NOW** | Current Customs CSV; OGD Licence 1.0 expressly permits commercial derivatives and sublicensing. |
| 2 | Philippines | **MANUAL_FILE_BUILDABLE** | Official PTF plus Tariff Book/EO releases; Finder says content is public domain; files require controlled manual acquisition. |
| 3 | Sri Lanka | **RIGHTS_UNRESOLVED** | Complete current 2026 ZIP is executable, but the site supplies copyright notice without a reuse grant. |
| 4 | Pakistan | **WRITTEN_PERMISSION_REQUIRED** | Current FBR tariff exists; terms permit only limited no-cost single-page sharing by Pakistani residents/citizens. |
| 5 | Bangladesh | **RIGHTS_UNRESOLVED** | Executable official tariff PDF/live tariff exists; no commercial reuse grant found. |
| 6 | Nepal | **RIGHTS_UNRESOLVED** | Current integrated tariff PDF is retrievable; no reuse terms found. |
| 7 | Mauritius | **WRITTEN_PERMISSION_REQUIRED** | Excellent integrated tariff with an India column; government copyright terms require approval for other uses. |
| 8 | Nigeria | **RIGHTS_UNRESOLVED** | NCS CET source and official schedules are real; no applicable reuse grant found. |
| 9 | Peru | **RIGHTS_UNRESOLVED** | SUNAT national tariff is executable; no dataset-level commercial reuse grant found. |
| 10 | Colombia | **SOURCE_INSUFFICIENT** | Official lookup/manual exists, but no complete current executable national release was retrieved. |
| 11 | Ecuador | **RIGHTS_UNRESOLVED** | SENAE's live REST service is semantically excellent; automated commercial reuse is not licensed. |
| 12 | Argentina | **SOURCE_INSUFFICIENT** | Government CC BY terms are favourable, but current national exceptions/11-digit execution layer is incomplete. |
| 13 | Uruguay | **RIGHTS_UNRESOLVED** | Official national XLSX is executable; an open-data licence was not attached to this file. |
| 14 | Paraguay | **SOURCE_INSUFFICIENT** | Detailed NCM/AEC/ANV PDF expressly says it is referential and has no legal force. |
| 15 | North Macedonia | **SOURCE_INSUFFICIENT** | 2026 legal decision identified, but its complete current executable annex was not retrieved. |
| 16 | Montenegro | **NEEDS_INDIVIDUAL_INVESTIGATION** | TARICG is current and interactive; export/interface semantics and reuse rights both need authority clarification. |
| 17 | Albania | **RIGHTS_UNRESOLVED** | Current 2026 national tariff PDF is executable; no commercial reuse grant found. |
| 18 | Georgia | **BUILD_NOW** | Tax Code Article 197 is executable and official legal texts are excluded from copyright by Article 8. |
| 19 | Tunisia | **RIGHTS_UNRESOLVED** | Current official Tariffweb exposes national treatment; no reuse grant found. |
| 20 | Costa Rica | **RIGHTS_UNRESOLVED** | Rich official XLSX exists, but the observed edition is stale and no file-specific reuse grant exists. |
| 21 | Panama | **WRITTEN_PERMISSION_REQUIRED** | Official 12-digit interactive tariff exists; ANA says “Todos los derechos reservados.” |
| 22 | Dominican Republic | **RIGHTS_UNRESOLVED** | Official 2022 tariff page is retrievable through the DGA site index, but the file and its reuse terms remain unverified. |
| 23 | Jamaica | **WRITTEN_PERMISSION_REQUIRED** | Current executable integrated tariff; Jamaica Customs says “All Rights Reserved.” |
| 24 | Trinidad & Tobago | **SOURCE_INSUFFICIENT** | Current official amendment orders exist, but no consolidated current executable First Schedule was retrieved. |

## Country evidence

### 1. Taiwan — BUILD_NOW

1. **Authority:** Customs Administration, Ministry of Finance; publication metadata is also held by
   the Ministry of Digital Affairs' Government Data Open Platform.
2. **Official sources:** [dataset record](https://data.gov.tw/en/datasets/80871), [current CSV](https://opendata.customs.gov.tw/data/80871/csv.csv), and [OGD Licence 1.0](https://data.gov.tw/en/license).
3. **Name:** *Customs import duty information*.
4. **Acquisition / observed retrieval:** anonymous HTTPS CSV; actually downloaded, HTTP 200,
   2.69 MB, 12,679 data rows plus header. The catalogue calls it primary data, annual, updated
   31 Aug 2026.
5. **Codes / HS:** 11-character published commodity key (10-digit tariff number plus check digit),
   current Customs nomenclature.
6. **Executable treatment:** English/Chinese descriptions and Column I/II/III duty fields. Column I
   is the general/MFN execution layer. The sample contains ad valorem, zero, specific
   (`NT$30/KGM`), and compound/alternative expressions (`NT$10/KGM or 15% whichever is higher`).
7. **Quota / dates / history / overrides:** quota statistics are a separate linked official dataset;
   the tariff feed has a current release timestamp but no line-level validity interval. Preserve each
   annual file as an immutable `AuthorityRelease`; national levy/import-regulation fields must not be
   flattened into duty.
8. **India / origin:** the current Column II beneficiary tokens were inspected and `IN` was not
   present. Therefore serve Column I for India unless a future release affirmatively names India;
   this is not a claim that a political agreement can never exist. No India RoO source is attached.
9. **Rights:** the dataset record expressly assigns OGD Licence 1.0. It grants a “perpetual,
   worldwide, non-exclusive, irrevocable, royalty-free copyright license to reproduce, distribute,
   publicly transmit ... compile, adapt ... for any purpose,” including derivative products or
   services, and permits sublicensing. Attribution in the prescribed agency/year/dataset form is
   mandatory. Patents and trademarks are excluded; moral rights and third-party rights remain.
10. **Engineering preflight:** CSV acquisition; parser **LOW–MEDIUM**, semantics **MEDIUM**; 2.69 MB;
    simple `AuthorityRelease` plus structured rate-expression parser. Primary risk is preserving
    specific/alternative duties and the check digit while separating non-duty regulations.
11. **Five-gate check:** source yes; acquisition yes; rights yes; executable rates yes; retained
    transformations/derived display yes, subject to attribution. **Final: BUILD_NOW.**

### 2. Philippines — MANUAL_FILE_BUILDABLE

1. **Authority:** Philippine Tariff Commission; the Bureau of Customs links to the same service.
2. **Official sources:** [Philippine Tariff Finder about](https://finder.tariffcommission.gov.ph/about),
   [MFN schedule](https://finder.tariffcommission.gov.ph/mfn), [AIFTA schedule](https://finder.tariffcommission.gov.ph/aifta),
   [Tariff Book 2022](https://tariffcommission.gov.ph/tariff-book-2022), and
   [Official Gazette EO 62 (2024)](https://www.officialgazette.gov.ph/2024/06/20/executive-order-no-62-s-2024/).
3. **Name:** *Philippine Tariff Finder* / *AHTN 2022 Tariff Book* / EO 62 MFN amendments.
4. **Acquisition / observed retrieval:** Finder pages were fetched successfully over HTTPS. The
   Commission's main host returned 403 from this environment, but its official documents and
   Google Drive file links are exposed by the Finder. This supports a logged, manual-release
   acquisition rather than an undocumented scrape.
5. **Codes / HS:** AHTN 2022, 8 digits, Chapters 1–97; Finder states that its MFN and twelve FTA
   schedules cover 2024–2028.
6. **Executable treatment:** annual ad valorem MFN and FTA columns. EO 62 is the controlling MFN
   amendment (rice from 7 Jul 2024; other lines from 22 Jul 2024). Preserve any textual/specific
   expressions found in the annex rather than assuming percentages. Quotas and safeguards must be
   separate measures when an EO/FTA annex supplies them.
7. **Dates / history / overrides:** store Tariff Book baseline plus every EO/annex as a composite
   release; do not replace earlier annual columns. National schedules, not AHTN alone, execute rates.
8. **India / origin:** AIFTA is an explicit Finder schedule. Claim only when the line/year is in the
   AIFTA schedule and a valid Form AI/certificate and applicable origin rule are satisfied; sensitive
   and exclusion tracks remain MFN. The [AIFTA page](https://finder.tariffcommission.gov.ph/aifta)
   is the origin/tariff entry point.
9. **Rights:** the official Finder states, verbatim, “All content is in the public domain unless
   otherwise stated.” No contrary statement was found on the located tariff artifacts. Preserve
   authority attribution and do not redistribute WCO explanatory material or unrelated third-party
   content.
10. **Engineering preflight:** controlled manual PDF/XLS acquisition; parser **MEDIUM**, semantics
    **MEDIUM–HIGH**; likely tens of MB across baseline and annexes; composite `AuthorityRelease`.
    Primary risk: proving which EO version overrides each Tariff Book year and keeping AIFTA origin
    qualification distinct from the displayed preferential rate.
11. **Five-gate check:** authority, rights and executable schedule are supported; automated bulk
    retrieval is not stable, but manual acquisition is legitimate. **Final: MANUAL_FILE_BUILDABLE.**
    **Next action:** download the current MFN and AIFTA annex files through the public Commission UI,
    record their checksums/landing-page URLs, and run a chapter/EO overlap preflight before coding.

### 3. Sri Lanka — RIGHTS_UNRESOLVED

1. **Authority / sources:** Sri Lanka Customs, [Import Tariff page](https://www.customs.gov.lk/customs-tariff/import-tariff/),
   [16 May 2026 ZIP](https://www.customs.gov.lk/wp-content/uploads/2026/06/Import%20Tariff%20Guide%2016.05.2026.zip),
   [preamble](https://www.customs.gov.lk/wp-content/uploads/2026/06/Preamble%20intergrated.pdf), and
   Department of Commerce [ISFTA overview](https://www.doc.gov.lk/index.php?Itemid=154&catid=13&id=43%3Aoverview-isfta&lang=en&option=com_content&view=article).
2. **Name / acquisition:** *National Imports Tariff Guide 2026*; anonymous manual ZIP/chapter PDFs.
   The ZIP was actually downloaded (HTTP 200, 35.35 MB), opened, and listed: 173 members, including
   the preamble and text-bearing chapter PDFs.
3. **Codes / HS:** HS 2022 national 8-digit schedule; complete chapters.
4. **Treatment:** Customs Duty plus PAL, CESS, Excise, SCL, SSCL, VAT and preference columns.
   Preserve ad valorem, specific and compound expressions. Separate SCL/time-bound measures and
   quota or permit measures from base duty.
5. **Dates / history / overrides:** guide “as at 16.05.2026”; chapter files carry independent edit
   dates. Use chapter releases under one versioned composite snapshot; prior guides are history.
6. **India / RoO:** ISFTA has operated since 1 Mar 2000. The official overview states Sri Lanka's
   negative list remains excluded and explains change-in-tariff-heading, domestic-value-addition and
   direct-consignment conditions. Preferential display requires the line to be eligible and origin
   proof to be present; agreement existence alone is insufficient.
7. **Rights:** the Customs site footer states “Copyright © 2026 Sri Lanka Customs.” No licence or
   permission covering commercial transformation, internal historical retention, derived SaaS
   display, or customer display was found on the source page or archive. Public download is not a
   grant. **Final: RIGHTS_UNRESOLVED.**
8. **Engineering preflight:** manual ZIP; parser **MEDIUM** (multi-PDF table extraction), semantics
   **HIGH**; 35 MB compressed / 173 files; chapter/composite `AuthorityRelease`. Main risk is levy
   precedence and date alignment across SCL and preference columns.
9. **Exact next action:** ask Sri Lanka Customs (`dgc@customs.gov.lk`) for a written licence covering
   periodic retrieval, normalization, immutable historical retention, paid derived display and
   customer display without raw-file redistribution, plus required attribution and WCO exclusions.

### 4. Pakistan — WRITTEN_PERMISSION_REQUIRED

1. **Authority / sources:** Federal Board of Revenue, [Customs laws/tariff index](https://www.fbr.gov.pk/categ/laws/144),
   [Tariff 2025–26 PDF](https://download1.fbr.gov.pk/Docs/20258111683941732Tariff-2025-26.pdf), and
   [FBR Terms of Use](https://www.fbr.gov.pk/Term-of-Use/544).
2. **Name / acquisition:** *Pakistan Customs Tariff* plus Fifth Schedule/SRO amendments; public
   manual PDF downloads. The index was observed listing FY 2026–27 and historical fiscal years;
   the 2025–26 PDF was fetched and is text-bearing.
3. **Codes / HS:** Pakistan Customs Tariff (PCT), 8 digits, HS 2022 family.
4. **Treatment:** line-level customs duty, with concessionary/exemption treatment in the Fifth
   Schedule and SROs. Preserve percentages and any specific/compound expressions; quotas,
   regulatory duties and exemptions are separate legal layers.
5. **Dates / history / overrides:** annual fiscal-year baseline plus dated SRO/Fifth Schedule
   amendments; composite `AuthorityRelease` with legal precedence.
6. **India / RoO:** no positive India preference is established by the fetched national schedule.
   SAFTA or bilateral eligibility must be proven from the current Pakistan concession notification
   and its certificate/origin rules before any preferential answer; political membership is not a
   rate source.
7. **Rights:** FBR grants only that “Permission is granted to residents and citizens of Pakistan to
   copy electronically and to print single pages ... without any deletion, addition or modification
   and for the sole purpose of sharing information with other citizens and residents without cost to
   them.” That excludes ClearTrade's normalization and paid international SaaS use. **Final:
   WRITTEN_PERMISSION_REQUIRED.**
8. **Engineering preflight:** manual PDFs; parser **MEDIUM**, semantics **HIGH**; hundreds of pages;
   composite release. Main risk is applying SRO/Fifth Schedule concessions without silently
   replacing the statutory base rate.
9. **Exact next action:** obtain FBR permission explicitly covering commercial use, transformation,
   caching, historical retention and derived/customer display; then acquire the FY 2026–27 baseline
   and every in-year SRO in one manifest.

### 5. Bangladesh — RIGHTS_UNRESOLVED

1. **Authority / sources:** Bangladesh Customs / National Board of Revenue,
   [Tariff FY 2025–26](https://customs.gov.bd/files/Tariff-2025-2026%2829-07-2025%29.pdf),
   [BCT 2025–26](https://customs.gov.bd/files/BCT-2025-2026-27-05-2025-Final-Ok.pdf), and
   [live harmonised tariff](https://customs.gov.bd/portal/services/tariff/tableOfContents.jsf).
2. **Name / acquisition:** *Bangladesh National Tariff FY 2025–2026*; public manual PDFs and public
   chapter HTML. The 174-page rate PDF was actually fetched and inspected.
3. **Codes / HS:** 8-digit HS 2022 schedule in the PDF; portal navigation can expose deeper national
   display structure.
4. **Treatment:** CD, SD, VAT, AIT, RD, AT and TTI columns. Preserve duty versus domestic/import
   taxes and any specific or mixed legal expressions. Quotas/exemptions are notification layers.
5. **Dates / history / overrides:** fiscal-year baseline, last observed update 29 Jul 2025. A 2026–27
   currentness delta must be acquired before production use; retain annual baselines and SROs.
6. **India / RoO:** SAFTA membership is not sufficient. No current Bangladesh line-level India
   concession schedule and operative proof-of-origin rule was established in the fetched tariff;
   answer MFN unless a separately versioned national preference instrument proves eligibility.
7. **Rights:** neither the tariff PDF, its landing path nor the tariff application exposed a licence
   granting commercial transformation, retention or customer display. There is no controlling grant
   to quote; publication alone is legally silent. **Final: RIGHTS_UNRESOLVED.**
8. **Engineering preflight:** annual PDF + HTML/SRO composite; parser **MEDIUM**, semantics **HIGH**;
   about 174 pages for the compact rate book; composite release. Main risk is confusing TTI/tax
   presentation with customs duty and missing fiscal-year amendments.
9. **Exact next action:** obtain NBR/Customs written reuse terms and the complete FY 2026–27 release,
   then separately evidence any India/SAFTA beneficiary schedule and certificate rule.

### 6. Nepal — RIGHTS_UNRESOLVED

1. **Authority / sources:** Department of Customs, [Integrated Tariff Rate page](https://customs.gov.np/content/46/integrated-tariff-rate/),
   [Custom Tariff Rate page](https://customs.gov.np/content/50/custom-tariff-rate/), and the official
   [2083/84 integrated tariff PDF](https://giwmscdnone.gov.np/media/files/%E0%A4%8F%E0%A4%95%E0%A5%80%E0%A4%95%E0%A5%83%E0%A4%A4%20%E0%A4%AD%E0%A4%A8%E0%A5%8D%E0%A4%B8%E0%A4%BE%E0%A4%B0%20%E0%A4%AE%E0%A4%B9%E0%A4%B8%E0%A5%81%E0%A4%B2%20%E0%A4%A6%E0%A4%B0%E0%A4%AC%E0%A4%A8%E0%A5%8D%E0%A4%A6%E0%A5%80%20%E0%A5%A8%E0%A5%A6%E0%A5%AE%E0%A5%A9%E0%A5%A4%E0%A5%A6%E0%A5%AE%E0%A5%AA_qv4xx54.pdf).
2. **Name / acquisition:** *Integrated Customs Tariff 2083/84*; public manual PDF. The current
   31.3 MB, 683-page PDF and prior 2082/83 edition were actually downloaded.
3. **Codes / HS:** national HS schedule, generally 8 digits; latest published integrated edition.
4. **Treatment:** customs duty plus excise/VAT and concession columns/notes. Preserve specific and
   mixed expressions; quota/exemption treatment belongs to the cited finance/customs notifications.
5. **Dates / history / overrides:** fiscal-year editions; simple annual snapshot becomes composite
   where finance ordinances amend it.
6. **India / RoO:** India–Nepal treaty treatment and SAFTA cannot be inferred into a rate. The pack
   must carry the exact beneficiary column/notification and certificate/direct-consignment rule; no
   universal positive India result was proven in this pass.
7. **Rights:** no licence or terms governing reuse of the tariff files was found on the Customs pages
   or download host. **Final: RIGHTS_UNRESOLVED.**
8. **Engineering preflight:** manual PDF; parser **HIGH** (Nepali script, large tables), semantics
   **HIGH**; 31 MB / 683 pages; composite release. Main risk is column/header continuation and
   distinguishing treaty concessions from general rates.
9. **Exact next action:** obtain Department of Customs/Ministry of Finance reuse permission or a
   published open licence, including translation/normalization and retained historical display;
   request the authoritative India-origin tariff and RoO instruments in the same exchange.

### 7. Mauritius — WRITTEN_PERMISSION_REQUIRED

1. **Authority / sources:** Mauritius Revenue Authority, [Tariff Information](https://www.mra.mu/index.php/customs1/tariff-information),
   Government of Mauritius [copyright policy](https://www.govmu.org/EN/Pages/Copyright.aspx), and
   the Customs Tariff page's current *Integrated Tariff* PDF.
2. **Name / acquisition:** *Customs Tariff Schedules (Integrated Tariff), HS 2022, as at 20 June
   2026*; official manual PDF. Actually downloaded: HTTP 200, 11.63 MB, 807 born-digital pages.
3. **Codes / HS:** national 8-digit HS 2022 schedule.
4. **Treatment:** General, Excise Duty, VAT, and COMESA/SADC/IOC/India/Pakistan/EC/Türkiye/UK/China/
   AfCFTA/UAE columns. Specific rates occur (for example cents per unit); preserve compound/mixed
   text. Quotas and agency conditions remain separate measures.
5. **Dates / history / overrides:** “as at 20 June 2026”; immutable snapshots by issue date. The PDF
   warns that only the latest official laws/regulations are authoritative, so cited instruments are
   a required provenance layer.
6. **India / RoO:** the explicit `INDIA` column and preamble definition of the Mauritius–India CECPA
   make this a high-value India source. Show a preference only for an eligible line/date and valid
   CECPA certificate/origin qualification.
7. **Rights:** the government policy says material “may be downloaded free of charge to file or
   printer without requiring specific permission” when reproduced accurately with source/copyright
   acknowledgement, but then states: “Any other proposed use of any State protected material is
   subject to approval.” Commercial normalization and derived SaaS display are an “other” use, not
   mere accurate reproduction. **Final: WRITTEN_PERMISSION_REQUIRED.**
8. **Engineering preflight:** manual PDF; parser **MEDIUM**, semantics **HIGH**; 11.6 MB / 807 pages;
   simple-to-composite release. Main risk is binding numerous agreement columns and units to the
   correct eligibility rules.
9. **Exact next action:** request Government Information Service/MRA approval for automated or
   manual periodic acquisition, transformation, historical retention and paid derived/customer
   display without raw redistribution, with the required attribution wording.

### 8. Nigeria — RIGHTS_UNRESOLVED

1. **Authority / sources:** Nigeria Customs Service (NCS), [CET page](https://customs.gov.ng/cet-tariff),
   [official page API](https://api.customs.gov.ng/api/pages/cet-tariff),
   [CET portal](https://cet.customs.gov.ng/), and
   [CET schedules PDF](https://cms.customs.gov.ng/wp-content/uploads/2026/07/CET-SCHEDULES-1.pdf).
2. **Name / acquisition:** *ECOWAS Common External Tariff / Nigeria CET* and schedules; official
   page JSON, lookup portal and downloadable documents. The metadata API returned real JSON and the
   59.2 MB schedules PDF was actually downloaded.
3. **Codes / HS:** ECOWAS TSN, 10 digits, HS 2022 family; Nigeria's portal adds the national list,
   regulated codes and prohibitions.
4. **Treatment:** five-band CET/general duty plus national list, schedules, levies, AfCFTA and
   prohibitions. Do not use schedule headings as rates. Preserve specific/compound expressions,
   quotas and safeguards as separate measures when present.
5. **Dates / history / overrides:** NCS page published 16 May 2026 and schedules uploaded Jul 2026;
   retain the regional baseline and Nigerian national overlay independently.
6. **India / RoO:** no India-specific preference was proven. AfCFTA is not an India preference;
   general treatment applies absent a national beneficiary instrument.
7. **Rights:** no NCS dataset licence or site term granting commercial reuse, automated retrieval,
   normalization, historical retention, or customer display was found. The official Nigeria
   Copyright Act was checked but no proven official-text exclusion was established for this
   operational compilation. **Final: RIGHTS_UNRESOLVED.**
8. **Engineering preflight:** page JSON + manual PDF/portal; parser **MEDIUM–HIGH**, semantics
   **HIGH**; at least 59 MB; regional-base-plus-national-override composite. Main risk is assuming
   the ECOWAS base alone executes Nigeria's levies, national list and prohibitions.
9. **Exact next action:** obtain a dataset-specific NCS/ECOWAS commercial reuse grant and a populated
   full-tariff workbook/export (the advertised Excel URL was null when observed), then validate the
   national override precedence.

### 9. Peru — RIGHTS_UNRESOLVED

1. **Authority / sources:** SUNAT, [Customs Tariffs](https://www.sunat.gob.pe/orientacionaduanera/aranceles/)
   and the official [2022 National Customs Tariff PDF](https://www.sunat.gob.pe/legislacion/procedim/normasadua/gja-04/ctrlCambios/anexos/Arancel_2022.pdf),
   enacted by Supreme Decree 404-2021-EF.
2. **Name / acquisition:** *Arancel de Aduanas 2022*; anonymous official PDF, with SUNAT
   concordance XLS/ZIP files as supporting classification inputs. The authority pages and PDF were
   actually retrieved.
3. **Codes / HS:** NANDINA common code through 8 digits, with Peru national subdivisions to 10
   digits; HS 2022 basis.
4. **Treatment:** line-level ad valorem general duty and national measures. Preserve any
   specific/compound measure or surcharge from its legal instrument; quota, antidumping and permit
   measures are not part of the naked NANDINA code.
5. **Dates / history / overrides:** baseline effective 1 Jan 2022, with subsequent decree-based
   modifications. Use a composite release: tariff baseline plus effective-dated national decrees.
6. **India / RoO:** no in-force India preference was established in the national tariff evidence.
   An India–Peru negotiation is not a preferential schedule; serve the general rate until SUNAT or
   MINCETUR publishes an operative beneficiary schedule and origin protocol.
7. **Rights:** no tariff-specific licence granting commercial reuse, transformation, retention or
   customer display was found on the SUNAT tariff page or PDF. No applicable official-text
   copyright exclusion was proven. **Final: RIGHTS_UNRESOLVED.**
8. **Engineering preflight:** manual PDF + decrees; parser **MEDIUM**, semantics **MEDIUM–HIGH**;
   several hundred pages; composite `AuthorityRelease`. Primary risk is treating the 2022 baseline
   as current without applying every later national modification.
9. **Exact next action:** obtain SUNAT/MEF reuse clarification and an official consolidated current
   change manifest; ask specifically about normalized paid display and retained historical copies.

### 10. Colombia — SOURCE_INSUFFICIENT

1. **Authority / sources:** DIAN, [Customs portal](https://www.dian.gov.co/aduanas/Paginas/Inicio.aspx)
   and official [MUISCA tariff consultation manual](https://www.dian.gov.co/atencionciudadano/LMDP/Cumplimiento-Obligaciones-Aduaneras-y-Cambiarias/Operacion-Aduanera/Manuales/MN-COA-0021.pdf);
   the legal baseline is Decree 1881 of 2021 and later amendments.
2. **Name / acquisition:** DIAN/MUISCA *Consulta Arancel* interactive system and decree annexes.
   The official manual was retrievable, but no complete, current, anonymous bulk national schedule
   or reproducible live payload was obtained.
3. **Codes / HS:** NANDINA through 8 digits with Colombian national subdivisions generally to 10
   digits; HS 2022 family.
4. **Treatment:** general duty and national measures are available in the DIAN system in principle,
   but specific/compound formulas, quotas and effective-dated overrides were not observed in a full
   payload and therefore are not parser-ready.
5. **Dates / history / overrides:** decree baseline plus amendments; no complete release manifest
   was established.
6. **India / RoO:** no positive India preferential schedule was established; do not infer one from
   CAN membership or political negotiations.
7. **Rights:** Colombia's open-data regime cannot be attached to a tariff dataset that was not found
   in the official catalogue. Rights therefore remain unproven, but source completeness is already
   dispositive. **Final: SOURCE_INSUFFICIENT.**
8. **Engineering preflight:** prospective live lookup or decree composite; parser **UNKNOWN/HIGH**,
   semantics **HIGH**; size unknown. Primary risk is designing against the user manual rather than an
   observed authoritative payload.
9. **Exact next action:** DIAN must identify a current export/API or provide the complete executable
   annex and amendment manifest, with the attached reuse terms and rate-field definitions.

### 11. Ecuador — RIGHTS_UNRESOLVED

1. **Authority / sources:** Servicio Nacional de Aduana del Ecuador (SENAE),
   [official tariff application](https://mesadeservicios.aduana.gob.ec/arancel/),
   [COMEX Resolution 002-2023 notice](https://www.aduana.gob.ec/gaceta-boletin/entrada-en-vigor-resolucion-comex-nro-002-2023--arancel-del-ecuador/),
   and an official [section PDF](https://www.aduana.gob.ec/gacnorm/data/Arancel-del-Ecuador-Seccion-XVI.pdf).
2. **Name / acquisition:** *Arancel del Ecuador*; public live lookup. Its own JavaScript exposed
   `/arancel/rest/data/subpartidas`, `/tributos`, `/liberaciones`, `/cupos`, `/restricciones`, and
   `/tributosvariables`. Real POST responses were obtained; this is observed source evidence, not an
   inferred private API.
3. **Codes / HS:** 10-digit national subpartidas, with complementary and supplementary codes;
   NANDINA/HS 2022 basis.
4. **Treatment:** fixed and variable duties/taxes, legal references, origin-country liberations,
   replacement/reduction semantics, quotas and restrictions. The service can express more than a
   simple percentage.
5. **Dates / history / overrides:** response rows carry validity dates and legal norms; baseline
   Resolution COMEX 002-2023 entered into force 1 Sep 2023. Immutable daily captures must retain
   each norm/version, not just the latest response.
6. **India / RoO:** India was absent from the beneficiary-country set in the inspected liberation
   payload, but that sample is not a global negative. Only an India-coded liberation row with its
   origin conditions can produce a preferential answer; otherwise use general treatment.
7. **Rights:** the public UI has no licence or terms granting automated commercial retrieval,
   retained caching, normalization, or customer display. An observable endpoint is not permission.
   **Final: RIGHTS_UNRESOLVED.**
8. **Engineering preflight:** public live REST lookup; parser **LOW–MEDIUM**, semantics **HIGH**;
   query-sized JSON; live-lookup plus captured `AuthorityRelease`. Primary risk is reproducing
   replacement/reduction precedence across complementary codes, dates, quotas and origin scope.
9. **Exact next action:** ask SENAE for written authorization and operational limits for these public
   REST calls, including caching/history/derived paid display, then receive a field/code dictionary.

### 12. Argentina — SOURCE_INSUFFICIENT

1. **Authority / sources:** Secretaría de Comercio/ARCA and the official MERCOSUR system;
   [Argentina government tariff page](https://www.argentina.gob.ar/produccion/comercio-exterior),
   [MERCOSUR NCM/AEC live system](https://polcom.mercosur.int/public/ncm/vigente?lang=es),
   [Decision 08/2022 record](https://normas.mercosur.int/public/normativas/4334), and
   [Argentina site terms](https://www.argentina.gob.ar/terminos-y-condiciones).
2. **Name / acquisition:** NCM/AEC and Argentina national tariff measures. An official NCM PDF was
   fetched, but the preserved copy was an older 2017 publication; the current regional AEC was
   observed, not a complete current Argentine execution layer.
3. **Codes / HS:** NCM 8 digits; Argentine SIM national extensions commonly reach 11 digits and are
   essential where measures attach below NCM. HS 2022/NCM current family.
4. **Treatment:** regional AEC plus national exception list, temporary changes, statistical tax and
   other SIM measures. AEC alone cannot safely answer Argentina; preserve specific/compound measures
   and quotas from national instruments.
5. **Dates / history / overrides:** MERCOSUR record is at Update 4 dated 23 Mar 2026; Argentine
   incorporation and later national decrees are separate effective-dated layers.
6. **India / RoO:** the MERCOSUR–India PTA must be implemented from Argentina's current concession
   annex and certificate/origin protocol. Agreement existence does not imply every NCM receives a
   preference; none was asserted from the incomplete source.
7. **Rights:** Argentina.gob.ar states, “El Administrador licencia todos sus contenidos bajo la
   licencia Creative Commons Atribución 4.0 Internacional,” unless otherwise indicated. This is a
   positive commercial adaptation/attribution route for content in scope, but it cannot cure a
   missing national data layer or automatically license separate MERCOSUR/ARCA systems.
8. **Engineering preflight:** regional feed + national files; parser **MEDIUM**, semantics **HIGH**;
   expected tens of thousands of national rows; composite release. Primary risk is false completeness
   at NCM 8 when SIM/LETEC/temporary national measures control.
9. **Final / next action:** **SOURCE_INSUFFICIENT.** Obtain an official current ARCA/SIM or VUCE
   national export (including exceptions, dates and units) and confirm which CC BY terms attach;
   acquire the operative India PTA annex separately.

### 13. Uruguay — RIGHTS_UNRESOLVED

1. **Authority / sources:** Ministerio de Economía y Finanzas (MEF),
   [Nomenclature and tariffs page](https://www.gub.uy/ministerio-economia-finanzas/politicas-y-gestion/nomenclatura-aranceles-uruguay),
   and [national XLSX](https://www.gub.uy/ministerio-economia-finanzas/sites/ministerio-economia-finanzas/files/2025-05/Arancel%20Nacional_Febrero%202025%20-final.xlsx).
2. **Name / acquisition:** *Arancel Nacional — Febrero 2025*; anonymous XLSX. Actually downloaded,
   1.29 MB and approximately 20,401 worksheet rows.
3. **Codes / HS:** NCM 8-digit base with Uruguayan national lines to 10 digits; HS 2022 family.
4. **Treatment:** real AEC and national tariff-rate columns. The workbook exposes national
   divergence from AEC; preserve zero, ad valorem and any specific/compound text. Quota, exception
   list and temporary decree measures remain overlays.
5. **Dates / history / overrides:** file dated Feb 2025; currentness needs a 2026 delta check against
   MERCOSUR Update 4 and Uruguayan decrees. Retain each workbook as a release.
6. **India / RoO:** the workbook does not itself prove line-level MERCOSUR–India PTA eligibility.
   Add the Uruguayan implementing concession annex and origin certificate/rule as a separate
   preference program before returning a positive India result.
7. **Rights:** Uruguay's open-data catalogue uses the national open-data licence for catalogue
   datasets, but this tariff workbook was not found in that catalogue and carries no attached
   licence. The licence cannot be inherited by domain alone. **Final: RIGHTS_UNRESOLVED.**
8. **Engineering preflight:** bulk XLSX; parser **LOW**, semantics **MEDIUM–HIGH**; 1.29 MB / ~20k
   rows; simple national release with separate preference/exception overlays. Primary risk is stale
   AEC and missing decree deltas.
9. **Exact next action:** MEF must confirm that the national open-data licence covers this exact
   workbook (commercial derivatives, retention and customer display) and provide the 2026 refresh/
   amendment manifest plus India PTA implementation annex.

### 14. Paraguay — SOURCE_INSUFFICIENT

1. **Authority / sources:** Ministerio de Economía y Finanzas,
   [Arancel Nacional Vigente](https://economia.gov.py/index.php/paraguay-y-el-mundo/aranceles-la-importacion/arancel-nacional-vigente),
   and [official working PDF](https://www.mef.gov.py/sites/default/files/2025-07/Arancel_Nacional_Vigente_setiembre_2024.pdf).
2. **Name / acquisition:** *Arancel Nacional Vigente — septiembre 2024*; anonymous official PDF.
   Actually obtained and inspected: about 9.7 MB, 476 text-extractable pages and roughly 7,951 rate
   rows.
3. **Codes / HS:** NCM 8 digits, HS VII/2022.
4. **Treatment:** AEC, ANV (national rate) and list marker columns. At least 2,512 observed rows had
   AEC different from ANV, proving that regional AEC cannot execute Paraguay by itself. Preserve
   rate expressions, quotas and exception-list flags separately.
5. **Dates / history / overrides:** based on Decree 6897/2022 and adjusted through Decree 2530/2024;
   not a current 2026 consolidated legal release.
6. **India / RoO:** no positive PTA result can be derived from the AEC/ANV sheet. Paraguay's
   implementing MERCOSUR–India concession annex and proof-of-origin rules are required.
7. **Authority / rights defect:** the document states “Documento de trabajo referencial” and “El
   mismo no tiene fuerza legal.” That makes it a useful parser/reference artifact, not the tariff of
   record. A licence for commercial transformation was also not established, but lack of legal force
   is already decisive. **Final: SOURCE_INSUFFICIENT.**
8. **Engineering preflight:** manual PDF/decree composite; parser **MEDIUM**, semantics **HIGH**;
   476 pages / ~8k lines; regional base + national override. Primary risk is treating a referential
   compilation as law and missing later decrees.
9. **Exact next action:** retrieve the official-gazette annex to Decree 6897/2022, every amendment
   through the current date, and an authoritative consolidation or change manifest; then establish
   legal-text reuse status and the national India PTA annex.

### 15. North Macedonia — SOURCE_INSUFFICIENT

1. **Authority / sources:** Customs Administration of the Republic of North Macedonia,
   [Customs Tariff page](https://customs.gov.mk/carinska-tarifa.nspx) and the official
   [Customs Tariff Law](https://customs.gov.mk/content/documents/zakon_za_carinska_tarifa.pdf).
2. **Name / acquisition:** annual *Decision on Harmonising and Amending the Customs Tariff*; public
   HTML/legal PDFs. The page was actually fetched (only by tolerating its then-expired TLS
   certificate) and identifies Official Gazette 261/25 as the 2026 decision.
3. **Codes / HS:** annually aligned with the EU Combined Nomenclature, generally 8 digits plus
   national measure context; 2026 CN family.
4. **Treatment:** national conventional/general rates and agreement measures. The complete 2026
   annex and its specific/compound/quota expressions were not retrieved, so no executable pack can
   be asserted.
5. **Dates / history / overrides:** annual decisions effective 1 January; 2026 source reference is
   known, but not a complete fetched release.
6. **India / RoO:** no India preference was established. EU-CN alignment is nomenclature alignment,
   not EU customs-union treatment or an India programme.
7. **Rights:** no tariff-specific commercial reuse grant was found, and no national official-text
   copyright exclusion was proven. Source insufficiency is independently dispositive.
8. **Engineering preflight:** likely annual gazette PDF; parser **MEDIUM**, semantics **HIGH**; size
   unknown; simple/composite release. Primary risks are incomplete annex acquisition and trusting a
   broken-TLS landing page without an immutable gazette source.
9. **Final / next action:** **SOURCE_INSUFFICIENT.** Obtain Official Gazette 261/25 and its complete
   machine-readable or text PDF annex from the Gazette/Customs authority, amendment history and
   applicable legal-text/reuse rule.

### 16. Montenegro — NEEDS_INDIVIDUAL_INVESTIGATION

1. **Authority / sources:** Revenue and Customs Administration,
   [TARICG](https://taric.carina.co.me/TariCG/) integrated tariff system.
2. **Name / acquisition:** *TARICG*; public interactive lookup. The application was reachable and
   displayed a current update date of 4 Sep 2026, but no supported bulk export, documented API or
   reproducible rate payload was established.
3. **Codes / HS:** EU-CN-aligned national integrated nomenclature, expected 8/10-digit measure
   structure; exact payload depth remains unverified.
4. **Treatment:** the system is intended to expose national duty/measures, but specific/compound
   duties, quotas, validity intervals and national overrides were not observed in sufficient payloads
   to freeze a schema.
5. **Dates / history:** live current view; no historical release path was identified.
6. **India / RoO:** no positive preference was established; do not infer EU preference treatment
   from CN alignment.
7. **Rights:** no licence was found. The UI displays “TARICG ... ©2009 [ZZI],” which may concern the
   software rather than tariff facts; neither commercial data reuse nor a prohibition can be inferred.
8. **Engineering preflight:** interactive lookup; parser **UNKNOWN/MEDIUM–HIGH**, semantics **HIGH**;
   size unknown; likely live lookup plus captured releases. Risks are undocumented interface,
   software/data-rights separation, and absence of history.
9. **Final / next action:** **NEEDS_INDIVIDUAL_INVESTIGATION.** Ask Customs for the supported tariff
   export/API, data dictionary, historical mechanism and dataset reuse terms before further technical
   probing.

### 17. Albania — RIGHTS_UNRESOLVED

1. **Authority / sources:** Albanian Customs, [2026 document record](https://dogana.gov.al/dokument/6715/nomenklatura-2026),
   [general nomenclature page](https://dogana.gov.al/d/182/248/0/231/nomenklatura-e-kombinuar-e-mallrave),
   and [preferential tariffs/quotas](https://dogana.gov.al/d/169/182/249/266/tarifat-preferenciale-dhe-kuotat-tarifore).
2. **Name / acquisition:** *Nomenklatura e Kombinuar e Mallrave 2026*; official manual PDF. It was
   actually fetched (HTTP 200, 9.86 MB, 961 born-digital pages).
3. **Codes / HS:** EU-CN-aligned 8-digit tariff lines, 2026 edition.
4. **Treatment:** genuine `Tarifa (%)` field with observed duty bands including free, 1, 2, 3, 4,
   5, 6, 10 and 15%. Preserve any note-based specific/minimum/maximum duties; quota/preference
   documents are separate measures.
5. **Dates / history / overrides:** annual nomenclature; separately versioned preferential tariff
   and quota PDFs. Use a composite annual snapshot.
6. **India / RoO:** the observed 2026 preference page names EU/CEFTA/Türkiye/EFTA/UK programmes, not
   India. Therefore no India preference is established; CN alignment is not EU tariff treatment.
7. **Rights:** the Customs pages and PDF contain no licence granting commercial transformation,
   caching, historical retention or customer display. No Albanian official-text exclusion was
   proven for this compilation. **Final: RIGHTS_UNRESOLVED.**
8. **Engineering preflight:** manual PDF; parser **MEDIUM**, semantics **MEDIUM–HIGH**; 9.86 MB /
   961 pages; simple annual release plus quota/preference overlays. Primary risk is note-driven duty
   expressions and linking preference quota instruments.
9. **Exact next action:** request Albanian Customs' written data-reuse terms, attribution/WCO
   exclusions and permission for normalized paid display and historical retention.

### 18. Georgia — BUILD_NOW

1. **Authority / sources:** Legislative Herald of Georgia (Matsne), official consolidated
   [Tax Code](https://matsne.gov.ge/en/document/view/1043717) and official consolidated
   [Copyright and Related Rights Law](https://matsne.gov.ge/en/document/view/16198).
2. **Name / acquisition:** Tax Code Article 197, *Import duty rates*; anonymous official HTML/PDF
   legal text. The consolidated Tax Code was actually fetched and Article 197 inspected.
3. **Codes / HS:** legal schedules use HS/National Commodity Nomenclature codes at varying depths;
   the operative code lists must be normalized without padding a legal prefix into false descendants.
4. **Treatment:** Article 197 supplies residual zero treatment, enumerated 5% and 12% code lists,
   specific EUR-per-litre and EUR/%vol/hectolitre formulas, and a GEL-per-engine-capacity/vehicle-age
   formula. This is executable law, not an average or commentary.
5. **Quota / dates / history / overrides:** no quota should be invented from Article 197; any quota
   or exemption comes from its own legal article. Matsne consolidated versions and amendment history
   provide an authoritative release sequence. Snapshot each legal version/effective date.
6. **India / RoO:** no Georgia–India preference was established in the executing law or official
   agreement evidence; use the general Article 197 treatment unless a later official programme and
   origin rule is added.
7. **Rights:** Article 8 of Georgia's copyright law says: “Copyright shall not be applicable to ...
   official documents (laws, court decisions, other administrative and normative texts), as well as
   their official translations.” Article 197 and its official translation are in that exclusion.
   This supports reproduction, transformation, retention and derived display of the legal tariff
   facts; Matsne marks/logos and non-legal editorial assets remain out of scope.
8. **Engineering preflight:** consolidated HTML/PDF legal release; parser **MEDIUM**, semantics
   **HIGH**; only a few hundred enumerated lines plus formulas; simple legal `AuthorityRelease`.
   Primary risk is implementing the residual/exception ordering and vehicle/alcohol formulas
   exactly, including units and effective versions.
9. **Five-gate check:** executing source yes; legitimate acquisition yes; rights yes; executable
   rates yes; retention/transformation/derived display yes for official legal text. **Final:
   BUILD_NOW.**

### 19. Tunisia — RIGHTS_UNRESOLVED

1. **Authority / sources:** Tunisian Customs, current [Tarifweb 2026](https://www.douane.gov.tn/tarifweb2026/),
   [live tariff consultation](https://www.douane.gov.tn/consultation-tarifweb/), and
   [tariff legal presentation](https://www.douane.gov.tn/tarif-douanier/).
2. **Name / acquisition:** *Tarif Web 2026 / Nomenclature de dédouanement des produits*; public
   chapter HTML/interactive lookup. The official pages were actually fetched; the live consultation
   reported update 2 Sep 2026.
3. **Codes / HS:** 10-character national coding: HS 6, EU-CN-derived digits 7–8, national tariff
   digit 9, national product-specialization digit 10; control key may be displayed separately.
4. **Treatment:** conventional/MFN and autonomous duty plus VAT, consumption/specific petroleum,
   fuel, vehicle and tobacco charges; preferential tariffs, documents and restrictions are exposed.
   Preserve specific/formula duties and separate each tax/measure.
5. **Dates / history / overrides:** live system is current but no bulk historical archive was found.
   Capture chapter releases with acquisition timestamp and cited legal bases; do not overwrite.
6. **India / RoO:** no India programme was proven from the official tariff evidence. GSTP
   membership, if relevant to a line, would still require a Tunisian concession row and operative
   origin proof; no positive result is asserted.
7. **Rights:** no licence or terms granting commercial automated extraction, transformation,
   historical caching or customer display was located on the tariff pages. **Final:
   RIGHTS_UNRESOLVED.**
8. **Engineering preflight:** chapter HTML/live lookup; parser **MEDIUM–HIGH**, semantics **HIGH**;
   full 97-chapter schedule; chapter `AuthorityRelease` or lookup capture. Primary risk is stable
   acquisition of the live tables and code-key/rate-formula semantics.
9. **Exact next action:** obtain Customs' permission and supported extraction route/data dictionary,
   explicitly including commercial normalized display, retained snapshots and attribution.

### 20. Costa Rica — RIGHTS_UNRESOLVED

1. **Authority / sources:** Ministerio de Comercio Exterior (COMEX),
   [Customs duties and charges](https://portaldecomercio.comex.go.cr/enlaces/derechos-y-cargas/derechos-y-cargas-aduaneros/)
   and [official XLSX](https://portaldecomercio.comex.go.cr/media/ar1iswz4/arancel-actualizado-11-mayo-2022.xlsx).
2. **Name / acquisition:** *Arancel actualizado 11 mayo 2022*; anonymous XLSX. Actually downloaded,
   1.57 MB, 17,319 rows and 53 columns.
3. **Codes / HS:** SAC-based national tariff to 12 digits; observed workbook uses the 2022 revision.
4. **Treatment:** DAI, VAT, ISC, Law 6946 and other national taxes plus more than twenty agreement
   columns. Preserve rate expressions and treat quotas/safeguards/permits as separate measures.
5. **Dates / history / overrides:** the observed workbook is dated 11 May 2022 and cannot be assumed
   current in Sep 2026. SIECA ACI and subsequent Costa Rican decrees must be reconciled.
6. **India / RoO:** country/agreement columns were inspected; India (ISO numeric 356) was absent.
   Therefore no positive India preference is supported by this edition. Absence must be rechecked in
   the current release, not generalized politically.
7. **Rights:** no workbook-specific licence or terms authorizing commercial transformation,
   retention or customer display was found on the COMEX page. **Final: RIGHTS_UNRESOLVED.**
8. **Engineering preflight:** XLSX; parser **LOW–MEDIUM**, semantics **HIGH**; 1.57 MB / 17k rows /
   53 columns; national composite release. Primary risks are staleness and decoding agreement/tax
   columns without a current dictionary.
9. **Exact next action:** COMEX must provide or point to the current workbook/change manifest and
   confirm its reuse licence for the full SaaS lifecycle; then validate it against the current SAC.

### 21. Panama — WRITTEN_PERMISSION_REQUIRED

1. **Authority / sources:** Autoridad Nacional de Aduanas (ANA),
   [interactive national tariff](https://aranceles-api.ana.gob.pa/),
   [tariff portal](https://aranceles.ana.gob.pa/), and official
   [tool manual](https://aranceles.ana.gob.pa/assets/documentos_aduanas/manual/Manual%20Herramienta%20Arancel%20Interactivo_Dic2020_V1.pdf).
2. **Name / acquisition:** *Herramienta Interactiva del Arancel Nacional*; public interactive
   search. The portal was actually fetched (HTTP 200), but no supported current bulk download/API
   contract was located.
3. **Codes / HS:** 12-digit Panamanian national subpartidas, 98 chapters; the 12-digit structure was
   introduced under Cabinet Decree 27 of 15 Oct 2019. Current SAC relationship needs a live check.
4. **Treatment:** national ad valorem tariff and temporary tariff modifications; preferences and
   other national charges require separate measures. Specific/compound/quota semantics remain to be
   observed in a complete response.
5. **Dates / history / overrides:** live current view; “Enmiendas Anteriores” and correlations are
   exposed, but no immutable complete release was captured.
6. **India / RoO:** no India preference was established; Panama's national agreement tool must
   affirmatively return a beneficiary programme and origin rule before any positive result.
7. **Rights:** ANA's official service footer says “© 2026 Todos los derechos reservados”; another
   ANA page states “Autoridad Nacional de Aduanas © Todos los derechos reservados.” This is explicit
   reservation, not silence, and no commercial data exception was found. **Final:
   WRITTEN_PERMISSION_REQUIRED.**
8. **Engineering preflight:** interactive lookup/manual export; parser **UNKNOWN/MEDIUM**, semantics
   **HIGH**; size unknown; live lookup plus captured releases. Primary risks are unsupported endpoint
   use and incomplete national/preferences history.
9. **Exact next action:** obtain ANA's written permission plus supported API/bulk route and data
   dictionary, covering automated retrieval, transformation, caching/history and derived paid display.

### 22. Dominican Republic — RIGHTS_UNRESOLVED

1. **Authority / sources:** Dirección General de Aduanas (DGA),
   [consultations index](https://www.aduanas.gob.do/de-interes/consultas/),
   [2022 tariff page](https://www.aduanas.gob.do/consultas/arancel-de-aduanas-7ma-enmienda-2022/),
   and [Seventh Amendment notice](https://www.aduanas.gob.do/media/rupaj0fj/aviso-entrada-en-vigor-enmienda.pdf).
2. **Name / acquisition:** *Arancel de Aduanas — 7ma Enmienda 2022*; official tariff page/file. The
   DGA index and notice were actually retrievable; the direct tariff page returned 403 to one client
   but was indexed/fetched by another legitimate path. A full tariff file was not preserved.
3. **Codes / HS:** 7,697 national operative subheadings under HS 2022; national depth must be read
   from the actual file before implementation.
4. **Treatment:** national tariff is asserted by DGA, but full MFN, specific/compound, quota and
   override rows were not independently inspected. Use neither SIECA nor CARICOM as a substitute;
   the Dominican Republic is not part of the Central American ACI execution set.
5. **Dates / history / overrides:** effective 1 Jan 2022; later amendments/currentness manifest not
   established.
6. **India / RoO:** no India preference or origin protocol was proven.
7. **Rights:** the DGA tariff page exposes no attached reuse licence. A related DGA-hosted CNFC terms
   page says portal content is protected intellectual property and “Todos los derechos reservados,”
   but its stated scope is the CNFC portal, so it is not stretched into a tariff-file permission
   rule. Commercial reuse therefore remains unresolved. **Final: RIGHTS_UNRESOLVED.**
8. **Engineering preflight:** manual official file, once acquired; parser **UNKNOWN/MEDIUM**,
   semantics **HIGH**; expected thousands of rows; simple/composite national release. Risks are file
   acquisition, currentness and rights attachment.
9. **Exact next action:** request the current complete tariff file and amendment manifest from DGA
   (`ayuda@aduanas.gob.do`) together with explicit commercial reuse/retention/display terms.

### 23. Jamaica — WRITTEN_PERMISSION_REQUIRED

1. **Authority / sources:** Jamaica Customs Agency (JCA),
   [Integrated Tariff Search](https://jca.gov.jm/e-services/integrated-tariff-search/),
   [trade agreements](https://jca.gov.jm/business/trade-agreements/), and
   [10 Aug 2026 Integrated Tariff PDF](https://jca.gov.jm/wp-content/uploads/2026/08/PRINTABLE-TARIFF-Fuel-Oil-update-August-10-2026.x86258.pdf).
2. **Name / acquisition:** *Integrated Tariff — Fuel Oil update, August 10 2026*; anonymous official
   PDF. Actually downloaded, HTTP 200, 5.72 MB, 754 born-digital pages.
3. **Codes / HS:** national 10-digit schedule, HS 2022 family.
4. **Treatment:** import duty plus ASD, GCT, EXC, SCT and other tax/unit fields. Preserve specific and
   compound expressions; national suspensions, quotas and CET derogations are separate measures.
5. **Dates / history / overrides:** dated 10 Aug 2026; release title itself demonstrates in-year
   updates. Snapshot every JCA issue and cited legal notice.
6. **India / RoO:** JCA's observed trade-agreement set did not establish an India programme. CARICOM
   membership creates no India preference; use national general treatment absent an eligible row.
7. **Rights:** JCA's footer states “2017 - 2026 Jamaica Customs Agency. All Rights Reserved.” No data
   reuse exception was found. Commercial normalization/retained display therefore needs permission.
   **Final: WRITTEN_PERMISSION_REQUIRED.**
8. **Engineering preflight:** PDF; parser **MEDIUM**, semantics **HIGH**; 5.72 MB / 754 pages;
   national composite release. Primary risk is separating CARICOM base duty from Jamaican taxes,
   suspensions and derogations.
9. **Exact next action:** obtain JCA written permission for periodic acquisition, transformation,
   historical retention and paid derived/customer display without raw-file redistribution.

### 24. Trinidad & Tobago — SOURCE_INSUFFICIENT

1. **Authority / sources:** Customs and Excise Division / Ministry of Finance,
   [Customs notices](https://www.customs.gov.tt/importing/notices-to-importers),
   [consolidated Customs Act copy](https://tradeind.gov.tt/wp-content/uploads/2016/02/Customs-Act-78.012.pdf),
   and official [Legal Notice 386 of 2025](https://www.finance.gov.tt/wp-content/uploads/2025/11/Legal_Notice_No._386_of_2025-1.pdf).
2. **Name / acquisition:** First Schedule/Common External Tariff plus amendment and suspension
   orders. The Customs host had repeated connectivity failures, but Ministry of Finance legal notices
   were retrievable; Notice 386 expressly amends the 2024 CET Order.
3. **Codes / HS:** CARICOM/national tariff schedule; exact current depth/revision awaits the complete
   2024 base First Schedule.
4. **Treatment:** base CET plus national amendments, suspensions/variations, taxes and possible
   specific duties. A single 2025 amendment cannot execute unmentioned lines, quotas or exceptions.
5. **Dates / history / overrides:** 2024 base order plus 2025 and 2026 legal notices; no consolidated
   complete release was obtained.
6. **India / RoO:** no India preference was established. CARICOM CET is third-country treatment, not
   an India agreement.
7. **Rights:** official legal-text reuse status was not conclusively proven. Regardless, the missing
   base schedule is dispositive. **Final: SOURCE_INSUFFICIENT.**
8. **Engineering preflight:** gazette-PDF composite; parser **MEDIUM–HIGH**, semantics **HIGH**; size
   unknown; CARICOM base + Trinidad national override. Primary risk is producing a false complete
   schedule from sparse amendment notices.
9. **Exact next action:** obtain the complete official 2024 CET Order First Schedule and all later
   notices from Finance/Customs, plus the jurisdiction's official-text copyright rule or permission.

## Regional-source conclusions

### ASEAN / AHTN

**Shared nomenclature only for this purpose; not one executable multi-country import source.** ASEAN
defines AHTN as an 8-digit classification system, while its Trade Repository points to each Member
State's tariff nomenclature and separate national schedules. The ASEAN tariff-schedule page itself
lists one AHTN 2022 schedule per member. The Philippines therefore remains one national acquisition;
no other ASEAN state is counted. Evidence: [ASEAN Customs](https://asean.org/our-communities/economic-community/asean-customs/),
[ASEAN Trade Repository](https://atr.asean.org/read/tariff-nomenclature/39), and
[member schedules](https://asean.org/annex-2-tariff-schedules/).

### ECOWAS

**A real regional 10-digit CET base exists, but this sprint does not establish one source that can
safely execute every member's complete border treatment.** ECOWAS says the CET applies common
duties, quotas and preferences; its 2022 regulation adopts the regional TSN. Nigeria's own NCS
portal nevertheless adds a national list, levies, regulated codes and prohibitions. Atlas should
model an ECOWAS base plus national overlays, and Nigeria remains one national authority acquisition.
No additional ECOWAS destination is counted. Evidence: [ECOWAS CET](https://ecotis.ecowas.int/policy-development/common-external-tariff-cet/)
and [2022 TSN regulation](https://www.ecowas.int/wp-content/uploads/2024/08/2021-vol-80-DEC-2021.pdf).

### CAN / NANDINA

**Regional nomenclature only, not multi-country execution.** The Andean Community describes NANDINA
as the common 8-digit identification/classification instrument. Peru, Colombia and Ecuador add
national subdivisions, rates, taxes, preferences and measures. Three national acquisitions are
required. Evidence: [Comunidad Andina](https://www.comunidadandina.org/temas/dg-com/aduanas-aranceles-y-facilitacion-del-comercio/).

### MERCOSUR

**Choice C: regional AEC base plus national override layer. Four logical acquisitions are required
for Argentina + Uruguay + Paraguay: one current MERCOSUR NCM/AEC base and three national overlays.**
The regional system maintains an 8-digit NCM/AEC, while Decision 08/2022 expressly authorizes
country-specific reductions and the exception regime assigns different national exception limits.
If each country's self-contained file is used instead, there are still three independent national
release pipelines; it does not become one regional acquisition. Evidence: [current NCM/AEC](https://polcom.mercosur.int/public/ncm/vigente?lang=es),
[Decision 08/2022](https://normas.mercosur.int/public/normativas/4334), and
[national exceptions](https://polcom.mercosur.int/textoOrdenado/a_3/52).

### SIECA / SAC

**Regional base plus national execution for Costa Rica and Panama; the Dominican Republic is a
separate national acquisition.** SIECA publishes the ACI (SAC VII Amendment, Aug 2025) with common
nomenclature/duties, but Costa Rica and Panama have deeper national codes, taxes, preferences and
temporary modifications. Required here: one SIECA base plus two national overlays, plus a distinct
Dominican Republic source — four logical acquisitions if the shared base is used. Evidence:
[SIECA ACI](https://www.sieca.int/producto/arancel-centroamericano-de-importacion/) and
[integration scope](https://www.sieca.int/integracion-economica-centroamericana/areas-de-la-integracion-economica/).

### CARICOM CET

**Regional base plus two national executions, not one source for Jamaica and Trinidad & Tobago.**
CARICOM publishes a revised CET schedule, but national suspensions, derogations and internal taxes
remain material; the regional literature explicitly recognizes national derogations. Required:
one CARICOM base plus Jamaica and Trinidad overlays (three logical acquisitions), or two
self-contained national pipelines if each legally consolidates the base. Evidence:
[CARICOM revised CET](https://caricom.org/documents/revised-common-external-tariff-of-the-caribbean-community/)
and [CET suspension decisions](https://caricom.org/wp-content/uploads/Suspensions-Report-granted-and-not-granted-54th-COTED.pdf).

## Research limits and safe interpretation

- “Absent” India means absent from the exact observed beneficiary/schedule evidence, never “the
  countries have no political relationship.” A positive answer always needs line, date, origin and
  proof.
- A rights status concerns the tariff artifact actually identified. A portal-wide open licence is
  not transferred to a file outside that portal without attachment evidence.
- `SOURCE_INSUFFICIENT` does not mean the country has no tariff. It means this pass did not obtain a
  complete current executable national authority layer fit for an immutable production release.
- No regional finding adds destinations to coverage. Coverage changes only when a destination's
  complete executing treatment and rights clear independently.
