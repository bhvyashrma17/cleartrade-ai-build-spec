# Customs Atlas machine-friendly scale wave — 21 September 2026

**Starting checkpoint:** `66222573115514c28e5b077951500c30bf47fd1e`  
**Scope:** 56 fresh ISO destinations not in the accepted 45, the Sri Lanka pending item, or the
named hard-case queue. This was a one-pass source gate, not a deep legal report.  
**Result:** 6 `GREEN_NOW` destinations locally qualified as authority-scope aliases; 32 `AMBER`;
18 `RED`. Accepted operational coverage remains **45**. No Railway or production operation ran.

`Tariff complete` below means the cited authority controls the customs-duty schedule. It never
means product-regulatory coverage is complete. Every implemented alias records
`regulatory_coverage_complete=false`; UK controls parsed from the tariff remain useful evidence,
but are not represented as a complete national regulatory corpus.

## GREEN_NOW — implemented immediately

| ISO | Destination | Authority and current artifact | Format / current identity | Deterministic acquisition and reuse basis | National execution / overlays | India preference | Family | Decision |
|---|---|---|---|---|---|---|---|---|
| AX | Åland Islands | European Commission, [TARIC monthly extraction](https://taxation-customs.ec.europa.eu/online-services/online-services-and-databases-customs/eu-customs-tariff-taric_en); the Commission's [territorial table](https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/how-does-vat-work/territorial-scope_en) says EU customs rules apply | Versioned ZIP/XLSX, monthly | Existing retained TARIC release, SHA-256 and schema controls; Commission reuse decision applies to Commission documents/data | EU common customs tariff; Åland fiscal exclusions are outside the tariff claim | TARIC measure state; never selected from `IN` alone | `EU_TARIC_ASSOCIATED` | `GREEN_NOW` → `LOCAL_QUALIFIED_STAGING_PENDING` |
| MC | Monaco | Same TARIC release; Commission territorial table treats Monaco as France for customs | Versioned ZIP/XLSX, monthly | Same retained TARIC controls and reuse basis | EU common customs tariff; national fiscal/regulatory layer excluded | Same conditional TARIC origin treatment | `EU_TARIC_ASSOCIATED` | `GREEN_NOW` → pending |
| GG | Guernsey | HMRC UK Integrated Online Tariff; [UK–Guernsey customs arrangement](https://www.gov.uk/government/publications/customs-arrangements-with-the-crown-dependencies) requires the UK Customs Tariff and common external rate | Documented public JSON:API, live version `vnd.hmrc.2.0` | Existing TLS/API acquisition and response hashes; UK Open Government Licence for HMRC public-sector information | Exact UK external tariff; Guernsey VAT/excise and controls excluded | Existing HMRC preference parser; unresolved groups stay unknown/origin-proof conditional | `UK_CD_CUSTOMS_UNION` | `GREEN_NOW` → pending |
| IM | Isle of Man | HMRC tariff plus the UK–Isle of Man arrangement | JSON:API `vnd.hmrc.2.0` | Same | Exact common external tariff; separate fiscal/regulatory coverage | Same | `UK_CD_CUSTOMS_UNION` | `GREEN_NOW` → pending |
| JE | Jersey | HMRC tariff plus the UK–Jersey arrangement | JSON:API `vnd.hmrc.2.0` | Same | Exact common external tariff; separate fiscal/regulatory coverage | Same | `UK_CD_CUSTOMS_UNION` | `GREEN_NOW` → pending |
| PR | Puerto Rico | USITC HTS REST export; CBP's current statement of [19 CFR 101.1](https://www.cbp.gov/sites/default/files/2025-05/vol_59_no_22_complete.pdf) includes Puerto Rico in US customs territory | Documented REST JSON; current USITC HTS revision | Existing bounded USITC acquisition and response SHA-256; US federal tariff facts/official work basis | HTS execution is exact for US customs territory; local taxes and non-HTS controls excluded | HTS programme symbols remain distinct from proven India qualification | `US_CUSTOMS_TERRITORY` | `GREEN_NOW` → pending |

All six reuse an already-qualified authority provider; no second copy of a tariff schedule, parser,
release, or evidence object was created. The returned `country_code` remains the exact destination,
so cross-portal evidence never masquerades as Finland, France, Great Britain, or a US state.

## AMBER — stop after one focused pass

| ISO | Authority / artifact found | Format and date signal | Exact blocker; India state | Candidate family |
|---|---|---|---|---|
| AD | European Commission, [Andorra customs union](https://taxation-customs.ec.europa.eu/andorra-customs-unions-and-preferential-arrangements_en) | Official legal web record | Union covers HS 25–97 while agriculture uses a separate regime; not a complete TARIC alias. India unasserted. | `PARTIAL_CUSTOMS_UNION` |
| SM | European Commission, [San Marino customs union](https://taxation-customs.ec.europa.eu/san-marino-customs-unions-and-preferential-arrangements_en) | Official legal web record | Coal and steel are excluded and need a separate complete treatment. India unasserted. | `PARTIAL_CUSTOMS_UNION` |
| GI | European Commission territorial-scope table | Official legal web record | Spanish offices apply EU customs rules, but preference/quota treatment has TCA exceptions; not a plain TARIC alias. | `SPECIAL_CUSTOMS_TERRITORY` |
| LI | Swiss Federal Office for Customs, [Tares](https://www.bazg.admin.ch/en/tares-application), whose customs territory includes Liechtenstein | Interactive tariff | No supported immutable bulk/API and reusable complete release; inherited Swiss blocker. | `CH_LI_CUSTOMS_UNION` |
| FO | Faroe TAKS, [official customs tariff](https://www.taks.fo/en/business/customs/customs-tariff) and section reports | Interactive HTML + generated PDFs | No complete versioned export/API, closed release identity, or reuse grant. | `OFFICIAL_PDF_TABLE` |
| GL | Greenland Tax Agency customs/excise publications | Web/PDF | No one current, complete executable import schedule with deterministic history and reuse pack found. | `OFFICIAL_PDF_TABLE` |
| BM | Bermuda Customs, [2026 pipe-delimited file](https://www.gov.bm/schedules-customs-tariff-act-1970), updated 1 Apr 2026 | Pipe text, 5,886 data rows | Best new structured candidate, but Bermuda says databases/web content receive copyright and no commercial reuse permission was found. India preference not published. | `STRUCTURED_TABLE` |
| KY | Cayman Government, [Customs Tariff Act 2026 Revision](https://gov.ky/w/customs-tariff-act-2026-revision-lg5-s3) plus July Schedule 2 amendment | Current official PDF + amendment | Clean source, but no deterministic structured release/reuse grant and the post-revision amendment must be replayed. | `BASELINE_PLUS_AMENDMENTS` |
| TC | Turks and Caicos Customs, [Tariff Finder](https://customs.gov.tc/trf) | Interactive | No documented complete export/API, immutable history, or dataset reuse basis. | `INTERACTIVE_ONLY` |
| BB | Barbados Customs [ASYCUDA tariff](https://asycuda.customs.gov.bb/portal/services/tariff/sections.jsf) | Interactive | No documented public bulk/API, release identity, or national overlay/reuse closure. | `INTERACTIVE_ONLY` |
| AW | Aruba Customs tariff publications | PDF/interactive | Current complete schedule, immutable release identity and reuse basis were not all established in one pass. | `OFFICIAL_PDF_TABLE` |
| CW | Curaçao Customs tariff publications | PDF/interactive | Same: national execution exists, but supported complete acquisition/history and reuse remain unproved. | `OFFICIAL_PDF_TABLE` |
| GY | Guyana Revenue Authority tariff/CET publications | PDF | CARICOM base does not prove complete current Guyana taxes, suspensions and national exceptions. | `REGIONAL_PLUS_OVERLAY` |
| SR | Suriname Customs tariff publications | PDF/interactive | CARICOM/national schedule and current overlays were not available as one deterministic release. | `REGIONAL_PLUS_OVERLAY` |
| GD | Grenada Customs / CARICOM CET | PDF/interactive | No closed current national overlay and amendment manifest. | `REGIONAL_PLUS_OVERLAY` |
| LC | Saint Lucia Customs / CARICOM CET | PDF/interactive | No closed current national overlay and amendment manifest. | `REGIONAL_PLUS_OVERLAY` |
| DM | Dominica Customs / CARICOM CET | PDF/interactive | No closed current national overlay and amendment manifest. | `REGIONAL_PLUS_OVERLAY` |
| AG | Antigua and Barbuda Customs / CARICOM CET | PDF/interactive | No closed current national overlay and amendment manifest. | `REGIONAL_PLUS_OVERLAY` |
| KN | St Kitts and Nevis Customs / CARICOM CET | PDF/interactive | No closed current national overlay and amendment manifest. | `REGIONAL_PLUS_OVERLAY` |
| VC | St Vincent and the Grenadines Customs / CARICOM CET | PDF/interactive | No closed current national overlay and amendment manifest. | `REGIONAL_PLUS_OVERLAY` |
| MO | Macao Customs / Economic and Technological Development Bureau tariff and consumption-tax tables | Interactive/table | Near-zero tariff framing is not a complete treatment: excisable/import-tax lines and current machine acquisition need closure. | `STRUCTURED_TABLE` |
| TL | Timor-Leste Customs tariff publications | PDF | Complete current national schedule and later fiscal changes were not proved as one immutable release; rights unclear. | `OFFICIAL_PDF_TABLE` |
| MV | Maldives Customs tariff service | Interactive/PDF | No supported full current export/API, history, or clear reusable artifact located. | `INTERACTIVE_ONLY` |
| UZ | State Customs Committee, [Integrated Tariff](https://tarif.customs.uz/en) | Interactive official service, current | Strong national execution, but no documented bulk/API or immutable public history; no reverse engineering attempted. | `DOCUMENTED_API_CANDIDATE` |
| TJ | Tajikistan Customs tariff/legal publications | Legal tables/PDF | No supported complete current machine/static national release and reuse pack found. | `OFFICIAL_PDF_TABLE` |
| TM | State Customs Service, [custom-duty tables](https://customs.gov.tm/en/customs-info/customs-fees/duties) | Official HTML tables, current site | Lists use broad “from” scopes, exceptions and conditions rather than a complete declarable-line schedule. | `STRUCTURED_HTML` |
| GA | Gabon Customs / CEMAC CET | Regional PDF/interactive | CEMAC base does not close Gabon national levies, exemptions and current overlays. | `REGIONAL_PLUS_OVERLAY` |
| CM | Cameroon Customs / CEMAC CET | Regional PDF/interactive | CEMAC base does not close Cameroon national execution and overlays. | `REGIONAL_PLUS_OVERLAY` |
| TD | Chad Customs / CEMAC CET | Regional PDF/interactive | CEMAC base does not close Chad national execution and overlays. | `REGIONAL_PLUS_OVERLAY` |
| CF | Central African Republic Customs / CEMAC CET | Regional PDF/interactive | CEMAC base does not close national execution and overlays. | `REGIONAL_PLUS_OVERLAY` |
| CG | Republic of Congo Customs / CEMAC CET | Regional PDF/interactive | CEMAC base does not close national execution and overlays. | `REGIONAL_PLUS_OVERLAY` |
| VU | Vanuatu Customs, [HS 2022 schedule](https://customsinlandrevenue.gov.vu/images/Customs_Tariff/HS2022_English_Final_V2.pdf) plus 2023 legislation index | Static official PDF + amendments | Parseable, but baseline-to-current amendment completeness and commercial reuse basis were not closed in one pass. | `BASELINE_PLUS_AMENDMENTS` |

For every AMBER row, India preference is `UNKNOWN` unless explicitly stated. No preference rate is
inferred from origin, a regional agreement, or an empty column.

## RED — reject for this wave

| ISO | Authority checked | Exact short reason |
|---|---|---|
| HT | Haiti Customs | No current complete official deterministic national tariff artifact located. |
| CU | Cuba General Customs | No supported current complete public machine/static tariff and reuse combination located. |
| AF | Afghanistan Customs | No stable current authority release and enforceable effective-date chain located. |
| LY | Libya Customs | No current consolidated executable tariff with deterministic official acquisition located. |
| SD | Sudan Customs | No stable current complete release and history suitable for safe replay located. |
| ER | Eritrea Customs | No current complete official machine/static tariff artifact located. |
| DJ | Djibouti Customs | No supported complete current tariff export/archive and reuse basis located. |
| SO | Somalia Customs | No complete current national execution source with stable acquisition located. |
| MR | Mauritania Customs | No current complete deterministic national tariff release located. |
| MG | Madagascar Customs, [2026 tariff](https://www.douanes.gov.mg/tarifs-des-douanes/) | Current PDF exists, but additional duties can be set separately and no closed machine overlay/reuse pack was established; reject from a throughput wave. |
| SC | Seychelles Revenue Commission | No current complete public tariff release and complete amendment/reuse pack located. |
| KM | Comoros Customs | No current complete deterministic national tariff artifact located. |
| WS | Samoa Customs, [customs services schedule](https://customs.gov.ws/customs-services/) | Published baseline is HS2017-era; not current enough for 2026 execution. |
| TO | Tonga Revenue, [tariffs and fees](https://www.revenue.gov.to/customs-tariffs-and-fees) | Linked amendment material does not establish a current consolidated schedule and gap-free replay. |
| SB | Solomon Islands Customs | No current complete deterministic tariff artifact found on the authority surface. |
| KI | Kiribati Revenue/Customs | No current complete deterministic tariff artifact found. |
| CK | Cook Islands Revenue Management | No official complete current tariff artifact found in the focused pass. |
| NU | Niue Customs | No official complete current tariff artifact found in the focused pass. |

## Implementation and qualification

Commit `81f2d2e` adds three real scope families without new tariff forks:

- `EU_TARIC_ASSOCIATED`: AX, MC; same immutable TARIC release/parser, exact destination retained.
- `UK_CD_CUSTOMS_UNION`: GG, IM, JE; same HMRC API/parser, legal scope allowlist, exact destination retained.
- `US_CUSTOMS_TERRITORY`: PR; same USITC API/parser, legal scope allowlist, exact destination retained.

The generic tests pin each scope allowlist, reject out-of-scope territories before network access,
and prove routing passes the exact destination. Existing TARIC semantic/real-release tests cover
legal zero, specific/mixed duty, refinement and conditional India treatment; the HMRC and USITC
parsers keep their existing duty/preference semantics. Focused result: **72/72 passed** across the
alias, routing, TARIC parser and staging-count suites; the broader provider persistence suite also
passed **21/21** in the first focused run.

Bounded live acquisition also passed: HMRC returned Guernsey HS 010121 as one exact declarable
line at the authority's printed `0.00 %`, and USITC returned Puerto Rico HS 460290 as one exact
line at `3.5%`. These checks exercised destination preservation and legal zero/non-zero treatment;
they did not write a database or contact Railway.

## Count and next source family

- Accepted operational: **45** (unchanged).
- Local-qualified staging pending: **7** total — Sri Lanka plus 6 new aliases.
- Potential after a later Railway qualification batch: **52**.

Recommended next pool, not started: obtain explicit commercial reuse clearance for the small
structured/clean-static cluster **Bermuda + Cabo Verde + Madagascar**, then reassess them as a real
`STRUCTURED_TABLE`/clean official-table family. Rights and payable-overlay closure, not parser
engineering, are the present gates.
