# 37 — Official tariffs for every market

Owner decision D-024 (14 Oct 2026): official tariffs for all 218 markets Demand Discovery screens, from
free sources, researched country by country, with as little work for agents as possible; in parallel
the owner asks UNCTAD (TRAINS) and the WTO for permission to show their tariff data. This document is
the plan of record for that work and the country-by-country research behind it (ledger E-021).

The authoritative per-market data lives in code, where a test holds it complete:
`src/lib/market-access/tariff-source-directory.ts` (directory and customs unions),
`src/lib/job-handlers/market-access.ts` (`DESTINATION_ADAPTERS`, connected sources),
`src/lib/market-access/unconfigured-sources.ts` (researched sources that cannot be read automatically)
and `src/lib/demand-discovery-v5/policy.ts` (`rule_rates`). The table in §7 is generated from them.

## 1. Where every market stands (18 Oct 2026)

| Status | Markets | Meaning |
|---|---|---|
| Connected | 57 | The official tariff is read automatically (Customs Atlas). 53 before this work, plus Martinique, San Marino and Andorra (chapters 25–97) on the EU tariff, and Singapore, read from the copy saved each night in its permitted window (D-029, §5a). |
| Researched, not automatable | 61 | The official source is known and recorded with the reason it cannot be read automatically (licence pending, source incomplete, no machine interface, credentials, investigation required). |
| Directory | 100 | The publishing authority and where its tariff can be read, for an agent; 6 of these are scored by a published rule. |

`tests/tariff-source-directory.test.ts` fails if any screened market has none of the three. Of the
directory's 100, 54 name an official page, schedule or law to read (6 of them the source of a published
rule) and 46 have no official copy online (the agent asks the authority; the duty stays estimated until
then).

## 2. How v5 finds a market's duty, in order

1. **Official tariff line, read automatically** (Customs Atlas evidence, quality 1).
2. **Official tariff line, read by an agent** (authoritative-manual evidence, quality 0.9, labelled
   "read from the official tariff by a ClearTrade agent") — §3.
3. **A published rule** (policy v5 `rule_rates`, quality 1) where the market has no line for the product.
   Each rule names its official source, the goods it leaves out and a review date after which it is
   not used until checked again:

   | Market | Rule | Goods left out (their own tariff applies) | Source |
   |---|---|---|---|
   | Hong Kong | 0%: free port | HS 22, 24, 27, 290511, 87 | Customs and Excise Department FAQ |
   | Macao | 0%: free port | HS 22, 24, 87 | Macao Trade and Investment Promotion Institute |
   | Singapore | 0% except dutiable goods (only until its first nightly copy is saved, §5a) | HS 22, 24, 27, 3826, 87 | Singapore Customs |
   | Sint Maarten | 0%: no import duty | HS 27 | Government of Sint Maarten, Customs |
   | Bonaire, Sint Eustatius and Saba | 0% import tax on all goods | HS 22, 24, 27 | Belastingdienst Caribisch Nederland |
   | Holy See | 0%: goods cross Italy duty-free | — | Lateran Treaty, Art. 20 |
   | Timor-Leste | 5% on all imports (annual State Budget) | 190110, 9619 | Customs Authority of Timor-Leste |
   | Saint-Barthélemy | 5% droit de quai on all goods | — | French customs (DGDDI) |

   Hong Kong's rule rests on the Customs and Excise Department's published statement that imports are
   tax-free outside four dutiable commodities and motor vehicles. It does not use the C&ED duty-rate
   content whose reuse is recorded as licence-pending (`HK_CED_DUTIABLE_COMMODITIES`); the owner
   confirms this reading when merging the change (E-021).
4. **Estimate** (quality 0.5, labelled): the World Bank sector average for the market (or, policy v4,
   its customs union's), adjusted for India's trade agreement with it.

## 3. The agent's part

On the agent's market table (`/agent/exporters/…/markets/manage`), a market whose duty is estimated or
missing shows **"Official tariff to check"**: the authority and a link to where its tariff can be read
(the directory entry, or the researched source). **Record the official duty** opens a short form: the
declarable national line (at least seven digits, beneath the product's HS6), its description, the
duty exactly as published, the date it applies from and the address it was read at. The server takes
the market and HS6 from the stored assessment, allows only an agent assigned to that exporter (or
Ops), stores the line as manually entered evidence through `manual-authoritative.ts`, and writes an
audit event (`POST /api/v1/market-access/manual-captures`). The next analysis run uses it. A recorded
line serves every exporter with the same product and market until a newer one is recorded, so each
line is read once.

## 4. Customs unions

One union source can serve many markets, with national exceptions that must be checked:

| Union | Members not connected | Common tariff source found | Note |
|---|---|---|---|
| ECOWAS (UEMOA edition) | BJ, BF, CI, GW, ML, NE, SN, TG | UEMOA TEC 2022 v4 (PDF, UEMOA Commission) | One schedule for eight markets, with the regional levies. |
| ECOWAS | CV, GM, GH, GN, LR, NG, SL | ECOWAS Trade Information System page | Ghana, Nigeria and Senegal publish national executions (researched, E-021 table). |
| EAC | KE, UG, TZ, RW, BI, SS, CD, SO | EAC CET 2022 (EAC repository); Burundi's French edition to April 2024 | Changed each July by the EAC Gazette with per-country stays; DR Congo and Somalia do not yet apply it. |
| EAEU | RU, BY, KZ, KG, AM | EEC Council Decision No. 80 (14 Sep 2021) on Kazakhstan's official legal portal | Kazakhstan, Kyrgyzstan and Armenia apply lower WTO-commitment rates on listed lines. |
| CEMAC | CM, CF, TD, CG, GQ, GA | Not found online | New CEEAC–CEMAC tariff in force in Cameroon from 1 Jan 2026. |
| SACU | ZA, BW, NA, LS, SZ | SARS Schedule 1 | SARS terms require written consent for automated acquisition. |
| GCC | AE, BH | — | Saudi Arabia, Kuwait, Qatar and Oman are connected; national exceptions differ. |
| CARICOM, SICA, MERCOSUR | national | — | National exception lists; read the national tariff. |

## 5. Proposed automation order

Largest gains for Indian exporters first; each needs a source qualification like the existing Customs
Atlas packs, and the first three need the owner's decision on whether a common-tariff rate may be used
as the official rate where national exceptions are not yet modelled.

| Order | Markets | Source | What it needs |
|---|---|---|---|
| 1 | RU, BY, KZ, KG, AM | EAEU common customs tariff (Decision No. 80 and amendments) | Parser for the official text; the KZ/KG/AM exception lists. |
| 2 | BJ, BF, CI, GW, ML, NE, SN, TG | UEMOA TEC 2022 v4 | PDF table parser; national supplementary measures. |
| 3 | KE, UG, TZ, RW, BI | EAC CET 2022 + annual Gazette | PDF parser; per-country stays of application. |
| 4 | BR | Camex TEC with national exceptions (official spreadsheet) | Owner decision to replace the Siscomex route recorded for BR. |
| 5 | NC | Open data (data.gouv.nc, Licence Ouverte 2.0, updated daily) | Live API check from a machine that can reach it. |
| 6 | AE | Dubai Customs open data | Terms of the dataset and GCC exceptions. |
| 7 | SG | Implemented provider; acquisition only inside 03:00–07:00 SGT | Done (D-029): saved nightly by the worker, §5a. |

## 5a. Singapore: saved in its window every night (D-029)

Singapore Statutes Online allows automated extraction only from 03:00 to 07:00 Singapore Time, so a run
cannot fetch Singapore's tariff when it needs it. The worker does it inside the window instead
(`src/lib/market-access/providers/singapore-refresh.ts`, swept from `scripts/worker.ts` every ten
minutes; outside the window the sweep reads nothing):

- Once per Singapore day, starting between 03:00 and 06:00, it acquires the consolidated First
  Schedule with its provenance pages (six requests), reads it with the strict bundle reader (layout,
  at least 8,000 lines, deterministic replay, retained terms and amendment provenance) and compares its
  canonical tariff with the copy already saved.
- **Same tariff:** nothing is imported; the check is recorded. **No copy yet:** it is saved and becomes
  the release runs read once it passes qualification — the reader plus checks a real Singapore
  schedule always passes (rice not dutiable; liquor, tobacco, motor cars and petrol dutiable; at least
  90% of lines duty-free; line count within 10% of the release in use). **Changed tariff:** it is
  saved and held for review, because a saved release records the amendment chain reviewed in code (to
  S 67/2026); the release in use stays active. An operator activates a held release with
  `scripts/activate-authority-release.ts`, or turns on `activate_changed_tariff` and the next night
  activates it.
- A failed attempt is retried at most three times a night, 30 minutes apart; the release in use is
  never touched by a failure. Each attempt is an audit event (`authority_refresh` /
  `SG_SSO_CUSTOMS_DUTIES`) with the reason, the qualification checks and, for a change, the lines that
  moved.
- Switch: `market_access.authority_refresh` (off by default; written through the audited config API
  or `scripts/authority-refresh.ts --enable --actor-email=<ops supervisor> --changed-by=<admin>`). The
  state shows on Ops → Demand Discovery v5 and with `scripts/authority-refresh.ts --status`.
- Until the first copy is saved, a run records Singapore's look-up as `no_release` (not a failure, so
  the run is not partial) and the duty comes from the published rule (§2.3); the agent's pointer is
  the SSO First Schedule.
- If the worker's host cannot reach SSO, the same acquisition can run on any machine in the window
  (`scripts/authority-refresh.ts --acquire-only --out=<file>`), and the file is imported with
  `scripts/import-retained-authority-release.ts --family=SG` — the "saved copy" route the owner allowed
  for other markets too (D-029).

## 6. Licences and permissions

- WTO tariff data: non-commercial use only without the WTO Secretariat's approval; the owner's request
  is pending (D-024).
- UNCTAD TRAINS (also through WITS): free access, terms for commercial display unclear; the owner's
  request is pending (D-024).
- ITC Market Access Map: commercial exploitation needs ITC's written permission. Not used.
- National tariffs are legal instruments; many copyright laws exclude official texts, but each
  automated source still gets its own rights check (as the existing packs record). An agent reading
  one published rate from an official page and citing it is the authoritative-manual path the Customs
  Atlas already defines. Whether that extends to the eight sources whose reuse is licence-pending (HK
  beyond its rule, MY, CL, ZA, UY, BD, PK, JM) is an owner decision pending with PR #5 (ledger R-24);
  the form allows it as built.

## 7. Every market (generated 17 Oct 2026)

| Market | Official tariff now | Union | Where to read it |
|---|---|---|---|
| Afghanistan (AF) | No official copy found online |  | Afghanistan Customs Department, Ministry of Finance — Only third-party copies of the 2014 tariff were found online. |
| Albania (AL) | Connected (`al_customs_nomenclature_archive`) |  | Read automatically |
| Algeria (DZ) | No official copy found online |  | Direction Générale des Douanes, Algérie — Only third-party copies of the tariff were found online. |
| Andorra (AD) | Connected (`eu_taric`), chapters 25–97 | EU | Read automatically |
| Angola (AO) | No official copy found online |  | Administração Geral Tributária (AGT) — Pauta Aduaneira 2024; no official copy found online. |
| Anguilla (AI) | No official copy found online |  | Anguilla Customs Department — No current schedule found online. |
| Antigua and Barbuda (AG) | No official copy found online | CARICOM | Customs and Excise Division, Antigua and Barbuda — CET with national exceptions under the Customs Duties Act; no schedule found online. |
| Argentina (AR) | Researched, not automatable (source insufficient) | MERCOSUR | [Argentina ARCA / Secretariat of Commerce — SIM national tariff execution](https://www.argentina.gob.ar/produccion/comercio-exterior) |
| Armenia (AM) | Researched, not automatable (source insufficient) | EAEU | [Kazakhstan Ministry of Finance / Open Data portal — EAEU nomenclature and Common Customs Tariff](https://data.egov.kz/datasets/view?index=euraziyalyk_ekonomikalyk_odakt) |
| Aruba (AW) | Agent reads it |  | [Departamento di Aduana Aruba](https://www.gobierno.aw/en/import-duties) — Government page on import duties. |
| Australia (AU) | Connected (`au_abf_working_tariff`) |  | Read automatically |
| Austria (AT) | Connected (`eu_taric`) | EU | Read automatically |
| Azerbaijan (AZ) | Agent reads it |  | [State Customs Committee of Azerbaijan](https://customs.gov.az/en/faydali/gomruk-statistikasi/tariff-statistics) — Rates set by Cabinet of Ministers decision; the committee publishes tariff statistics. |
| Bahamas (BS) | Agent reads it |  | [Bahamas Customs Department](https://www.bahamascustoms.gov.bs/resources/laws-on-line/) — Customs Duty (Most Favoured Nation) Tariff Act and amendments. |
| Bahrain (BH) | Researched, not automatable (bulk distribution only) | GCC | [Bahrain Ministry of Interior, Customs Affairs — Unified Customs Tariff](https://www.bahrain.bh/wps/portal/en/BNP/ServicesCatalogue/GSX-UI-PServiceDetails?psID=1322) |
| Bangladesh (BD) | Researched, not automatable (license pending) |  | [Bangladesh National Board of Revenue / Customs — National Tariff](https://customs.gov.bd/files/Tariff-2025-2026%2829-07-2025%29.pdf) |
| Barbados (BB) | No official copy found online | CARICOM | Barbados Revenue Authority, Customs and Excise Department — CET with national exceptions; no schedule found online. |
| Belarus (BY) | Researched, not automatable (source insufficient) | EAEU | [Kazakhstan Ministry of Finance / Open Data portal — EAEU nomenclature and Common Customs Tariff](https://data.egov.kz/datasets/view?index=euraziyalyk_ekonomikalyk_odakt) |
| Belgium (BE) | Connected (`eu_taric`) | EU | Read automatically |
| Belize (BZ) | Researched, not automatable (source insufficient) | CARICOM | [Belize Customs and Excise — Tariff and Trade Classification](https://customs.gov.bz/ttpg.html) |
| Benin (BJ) | Agent reads it | UEMOA | [Direction Générale des Douanes du Bénin](https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf) — Applies the UEMOA edition of the ECOWAS CET. |
| Bermuda (BM) | Agent reads it |  | [Government of Bermuda, Customs Department](https://www.gov.bm/schedules-customs-tariff-act-1970) — Schedules to the Customs Tariff Act 1970. |
| Bhutan (BT) | Connected (`bt_drc_tariff_pdf`) |  | Read automatically |
| Bolivia (BO) | Researched, not automatable (individual investigation required) |  | [Bolivia Aduana Nacional — Arancel Aduanero de Importaciones 2026](https://portal.aduana.gob.bo/aduana7/content/arancel-aduanero-de-importaciones) |
| Bonaire, Sint Eustatius and Saba (BQ) | Rule; v5 rule 0% |  | [Belastingdienst Caribisch Nederland](https://english.belastingdienst-cn.nl/topics/customs-business/company-import-tax) — Import tax is 0% on all goods; general expenditure tax applies separately. |
| Bosnia and Herzegovina (BA) | Researched, not automatable (source insufficient) |  | [Bosnia and Herzegovina Indirect Taxation Authority (UIO/ITA) — national customs tariff](https://www.uino.gov.ba/portal/bs/carine/carinska-tarifa/) |
| Botswana (BW) | Researched, not automatable (individual investigation required) | SACU | [Botswana Unified Revenue Service / SACU — Customs and Excise Tariff](https://www.burs.org.bw/index.php/customsexcisemain/customs-and-exercise-downloads) |
| Brazil (BR) | Researched, not automatable (credential not provisioned) | MERCOSUR | [Receita Federal / Portal Único de Comércio Exterior (Siscomex)](https://www.gov.br/mdic/pt-br/assuntos/camex/se-camex/strat/tarifas/vigentes) |
| Brunei Darussalam (BN) | Researched, not automatable (individual investigation required) |  | [Brunei Royal Customs and Excise Department — Brunei Darussalam Tariff and Trade Classification](https://www.customs.gov.bn/ref-rced/) |
| Bulgaria (BG) | Connected (`eu_taric`) | EU | Read automatically |
| Burkina Faso (BF) | Agent reads it | UEMOA | [Direction Générale des Douanes du Burkina Faso](https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf) — Applies the UEMOA edition of the ECOWAS CET. |
| Burundi (BI) | Agent reads it | EAC | [Office Burundais des Recettes](https://obr.bi/images/pdf/TEC-2022--Version-Word-amend--30-Avril-2024-CORRIGE.pdf) — EAC CET 2022 as amended to 30 April 2024 (French). |
| Cambodia (KH) | Researched, not automatable (source insufficient) |  | [Cambodia General Department of Customs and Excise — Customs Tariff 2022 and amending instruments](https://tools.customs.gov.kh/documents/reader/17709/17373560374410226/Manual%20on%20Customs%20Procedures%20in%20Cambodia%20%28English%29) |
| Cameroon (CM) | No official copy found online | CEMAC | Direction Générale des Douanes du Cameroun — Applies the CEEAC–CEMAC CET from 1 January 2026; no official copy found online. |
| Canada (CA) | Connected (`canada_cbsa_customs_tariff`) |  | Read automatically |
| Cape Verde (CV) | No official copy found online | ECOWAS | Direção Nacional de Receitas do Estado, Alfândegas de Cabo Verde — ECOWAS member with its own Pauta Aduaneira, published in the Boletim Oficial; no current copy found online. |
| Cayman Islands (KY) | Agent reads it |  | [Cayman Islands Customs and Border Control](https://www.gov.ky/cbc/trade/imports/import-entry) — Rates in the Customs Tariff Act schedules. |
| Central African Republic (CF) | No official copy found online | CEMAC | Direction Générale des Douanes et Droits Indirects (RCA) — CEMAC member; national application of the 2026 CET not confirmed. |
| Chad (TD) | No official copy found online | CEMAC | Direction Générale des Douanes et Droits Indirects du Tchad — CEMAC member; national application of the 2026 CET not confirmed. |
| Chile (CL) | Researched, not automatable (license pending) |  | [Servicio Nacional de Aduanas (SNA) — Arancel Aduanero Nacional](https://www.bcn.cl/leychile/navegar?idNorma=28933) |
| Colombia (CO) | Researched, not automatable (source insufficient) |  | [Colombia DIAN — MUISCA Customs Tariff Consultation](https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1881_2021.htm) |
| Comoros (KM) | No official copy found online |  | Administration Générale des Douanes et Droits Indirects, Comores — Customs code published on the customs site; tariff schedule not found online. |
| Cook Islands (CK) | Agent reads it |  | [Cook Islands Ministry of Finance and Economic Management, Revenue Management](https://paclii.org/ck/legis/num_act/cta1980178) — Customs Tariff Act 1980 and orders. |
| Costa Rica (CR) | Researched, not automatable (source insufficient) | SICA | [Costa Rica Ministry of Foreign Trade — National Customs Tariff](https://serviciosnet.hacienda.go.cr/arancelnet/) |
| Cote d'Ivoire (CI) | Researched, not automatable (source insufficient) | UEMOA | [Côte d’Ivoire Directorate General of Customs — ECOWAS CET enriched with national duties and taxes](https://apps.douanes.ci/info/tec) |
| Croatia (HR) | Connected (`eu_taric`) | EU | Read automatically |
| Cuba (CU) | No official copy found online |  | Aduana General de la República de Cuba — The Arancel de Aduanas is published in the Gaceta Oficial; no consolidated official copy found. |
| Curaçao (CW) | Agent reads it |  | [Douane Curaçao](https://gobiernu.cw/wp-content/uploads/2026/04/70-GT.-Lvo.-tarief-van-invoerrechten.pdf) — Landsverordening tarief van invoerrechten (consolidated, April 2026). |
| Cyprus (CY) | Connected (`eu_taric`) | EU | Read automatically |
| Czech Republic (CZ) | Connected (`eu_taric`) | EU | Read automatically |
| Democratic Republic of the Congo (CD) | No official copy found online | EAC | Direction Générale des Douanes et Accises (DGDA) — EAC member since 2022 that still applies its own tariff; no official copy found online. |
| Denmark (DK) | Connected (`eu_taric`) | EU | Read automatically |
| Djibouti (DJ) | No official copy found online |  | Direction des Douanes et Droits Indirects, Djibouti — Customs code published; tariff schedule not found online. |
| Dominica (DM) | No official copy found online | CARICOM | Customs and Excise Division, Dominica — CET with national exceptions; no schedule found online. |
| Dominican Republic (DO) | Researched, not automatable (source insufficient) |  | [Dominican Republic Directorate General of Customs — National Customs Tariff](https://onda.gob.do/wp-content/uploads/2022/10/Ley-No.65-00-sobre-Derecho-de-Autor.pdf) |
| Ecuador (EC) | Researched, not automatable (no documented machine interface) |  | [Ecuador National Customs Service (SENAE) — National Tariff / ECUAPASS](https://www.aduana.gob.ec/servicio-al-ciudadano/para-importar/) |
| Egypt (EG) | Researched, not automatable (no documented machine interface) |  | [Egyptian Customs Authority — integrated customs tariff](https://customs.gov.eg/Services/Tarif) |
| El Salvador (SV) | Researched, not automatable (individual investigation required) | SICA | [El Salvador Directorate General of Customs — SAC and 2026 national dispositions](https://aduana2.mh.gob.sv/SAC) |
| Equatorial Guinea (GQ) | No official copy found online | CEMAC | Dirección General de Aduanas de Guinea Ecuatorial — CEMAC member; national application of the 2026 CET not confirmed. |
| Eritrea (ER) | No official copy found online |  | Customs Department, Ministry of Finance, Eritrea — No official schedule found online. |
| Estonia (EE) | Connected (`eu_taric`) | EU | Read automatically |
| Eswatini (SZ) | No official copy found online | SACU | Eswatini Revenue Service — Applies the SACU tariff (SARS Schedule 1). |
| Ethiopia (ET) | No official copy found online |  | Ethiopian Customs Commission — No official schedule found online. |
| Faroe Islands (FO) | Agent reads it |  | [TAKS (Faroese tax and customs administration)](https://www.taks.fo/en/business/customs/customs-tariff) — Official customs tariff page. |
| Fiji (FJ) | Agent reads it |  | [Fiji Revenue and Customs Service](https://www.frcs.org.fj/wp-content/uploads/2012/11/Customs_-Tariff_-Act_Revised_-29_-Jan_-2010.pdf) — Customs Tariff Act (revised 2010), amended by each budget. |
| Finland (FI) | Connected (`eu_taric`) | EU | Read automatically |
| France (FR) | Connected (`eu_taric`) | EU | Read automatically |
| French Polynesia (PF) | Agent reads it |  | [Direction régionale des douanes de Polynésie française](https://www.service-public.pf/douane/professionnels/la-fiscalite-douaniere/) — Customs taxation page; the tarif des douanes is also published by ISPF. |
| Gabon (GA) | No official copy found online | CEMAC | Direction Générale des Douanes et Droits Indirects du Gabon — CEMAC member; national application of the 2026 CET not confirmed. |
| Georgia (GE) | Connected (`ge_matsne_tax_code_article_197`) |  | Read automatically |
| Germany (DE) | Connected (`eu_taric`) | EU | Read automatically |
| Ghana (GH) | Researched, not automatable (no documented machine interface) | ECOWAS | [Ghana Revenue Authority Customs Division — ICUMS / ECOWAS CET national tariff](https://gra.gov.gh/customs/customs-tariffs-and-levies/) |
| Gibraltar (GI) | Agent reads it |  | [HM Customs Gibraltar](https://www.gibraltarlaws.gov.gi/legislations/integrated-tariff-regulations-2017-2817/download) — Integrated Tariff Regulations 2017. |
| Greece (GR) | Connected (`eu_taric`) | EU | Read automatically |
| Greenland (GL) | Agent reads it |  | [Greenland Tax Agency](https://aka.gl/-/media/aka/til-sitecore/niels-olav/import-custom-duties-2025/greenlandic-import-duties-january-2025.pdf) — Import duties on listed goods only (alcohol, sugar products, tobacco, vehicles and a few others). |
| Grenada (GD) | Agent reads it | CARICOM | [Customs and Excise Division, Grenada](https://grenadaparliament.gd/wp-content/uploads/2021/08/Cap75C-CUSTOMS-DUTIES-ACT.pdf) — Customs Duties Act (Cap. 75C) with the CET schedule. |
| Guatemala (GT) | Researched, not automatable (no documented machine interface) | SICA | [Guatemala Superintendence of Tax Administration — Integrated Permit/Tariff Catalog](https://www.sieca.int/producto/arancel-centroamericano-de-importacion/) |
| Guinea (GN) | Agent reads it | ECOWAS | [Direction Générale des Douanes de Guinée](https://ecotis.ecowas.int/?p=24111) — Applies the ECOWAS CET; no national schedule found online. |
| Guinea-Bissau (GW) | Agent reads it | UEMOA | [Direção-Geral das Alfândegas da Guiné-Bissau](https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf) — Applies the UEMOA edition of the ECOWAS CET. |
| Guyana (GY) | Agent reads it | CARICOM | [Guyana Revenue Authority](https://www.gra.gov.gy/) — CET with national exceptions; GRA publishes rate changes as notices. |
| Haiti (HT) | No official copy found online |  | Administration Générale des Douanes, Haïti — CARICOM member not applying the CET; rates set by the annual finance law. |
| Holy See (Vatican City State) (VA) | Rule; v5 rule 0% |  | [Holy See / Italy (Lateran Treaty)](https://spcp.prf.cuni.cz/dokument/lateran.htm) — Goods for the Vatican City cross Italy free of customs duties (Art. 20). |
| Honduras (HN) | Researched, not automatable (no documented machine interface) | SICA | [Honduras Customs Administration — national Sistema Arancelario Centroamericano execution](https://www.aduanas.gob.hn/) |
| Hong Kong (HK) | Researched, not automatable (license pending); v5 rule 0% |  | [Hong Kong Customs and Excise Department — Dutiable Commodities Ordinance duty rates](https://www.customs.gov.hk/en/service-enforcement-information/trade-facilitation/dutiable-commodities/types-and-duty-rates/) |
| Hungary (HU) | Connected (`eu_taric`) | EU | Read automatically |
| Iceland (IS) | Connected (`is_skatturinn_tollskrarlyklar`) |  | Read automatically |
| Indonesia (ID) | Connected (`id_kemenkeu_btki`) |  | Read automatically |
| Iraq (IQ) | Agent reads it |  | [General Commission of Customs, Ministry of Finance, Iraq](https://moj.gov.iq/upload/pdf/%D9%82%D8%A7%D9%86%D9%88%D9%86%20%D8%A7%D9%84%D8%AA%D8%B9%D8%B1%D9%8A%D9%81%D8%A9%20%D8%A7%D9%84%D9%83%D9%85%D8%B1%D9%83%D9%8A%D8%A9.pdf) — Customs Tariff Law (Arabic); rates updated in 2025 are contested, so check current instructions. |
| Ireland (IE) | Connected (`eu_taric`) | EU | Read automatically |
| Islamic Republic of Iran (IR) | No official copy found online |  | Islamic Republic of Iran Customs Administration (IRICA) — Annual Export and Import Regulations Book, in Persian; no official copy found online. |
| Israel (IL) | Connected (`il_tax_authority_customs_book`) |  | Read automatically |
| Italy (IT) | Connected (`eu_taric`) | EU | Read automatically |
| Jamaica (JM) | Researched, not automatable (license pending) | CARICOM | [Jamaica Customs Agency — Integrated Tariff](https://laws.moj.gov.jm/legislation/statutes/C/The%20Copyright%20Act.pdf) |
| Japan (JP) | Connected (`japan_customs_tariff_schedule`) |  | Read automatically |
| Jordan (JO) | Researched, not automatable (no documented machine interface) |  | [Jordan Customs — Integrated Customs Tariff](https://customs.gov.jo/EN/List/Integrated_customs_tariff) |
| Kazakhstan (KZ) | Researched, not automatable (source insufficient) | EAEU | [Kazakhstan Ministry of Finance / Open Data portal — EAEU nomenclature and Common Customs Tariff](https://data.egov.kz/datasets/view?index=euraziyalyk_ekonomikalyk_odakt) |
| Kenya (KE) | Researched, not automatable (source insufficient) | EAC | [Kenya Revenue Authority (KRA) — EAC Common External Tariff and Kenya implementing measures](https://ikesra.kra.go.ke/items/538c6b1f-8c90-42da-ae0e-f20ea1d1fa6a) |
| Kiribati (KI) | Agent reads it |  | [Kiribati Customs Service](https://paclii.org/ki/legis/sub_leg/ca1993cto1998336) — Customs Tariff Order under the Customs Act; check later orders. |
| Kuwait (KW) | Connected (`kw_customs_integrated_tariff`) | GCC | Read automatically |
| Kyrgyzstan (KG) | Researched, not automatable (source insufficient) | EAEU | [Kazakhstan Ministry of Finance / Open Data portal — EAEU nomenclature and Common Customs Tariff](https://data.egov.kz/datasets/view?index=euraziyalyk_ekonomikalyk_odakt) |
| Lao People's Democratic Republic (LA) | Researched, not automatable (no documented machine interface) |  | [Lao PDR Ministry of Industry and Commerce — Lao Trade Portal commodity and tariff search](https://www.laotradeportal.gov.la/en-gb/site/listcommodity) |
| Latvia (LV) | Connected (`eu_taric`) | EU | Read automatically |
| Lebanon (LB) | Researched, not automatable (no documented machine interface) |  | [Lebanese Customs — Integrated Customs Tariff](https://www.customs.gov.lb/tariff/tariff.aspx) |
| Lesotho (LS) | No official copy found online | SACU | Revenue Services Lesotho — Applies the SACU tariff (SARS Schedule 1). |
| Liberia (LR) | Agent reads it | ECOWAS | [Liberia Revenue Authority](https://ecotis.ecowas.int/?p=24111) — Applies the ECOWAS CET; no national schedule found online. |
| Libya (LY) | No official copy found online |  | Libyan Customs Authority — No official schedule found online. |
| Lithuania (LT) | Connected (`eu_taric`) | EU | Read automatically |
| Luxembourg (LU) | Connected (`eu_taric`) | EU | Read automatically |
| Macao (MO) | Rule; v5 rule 0% |  | [Macao Trade and Investment Promotion Institute](https://investhere.ipim.gov.mo/en/macau/investmentinformation/foreigntrade) — Free port: no duty on imports; consumption tax on tobacco and strong alcohol. |
| Madagascar (MG) | No official copy found online |  | Direction Générale des Douanes, Madagascar — A public eTariff tool was launched in July 2024; its address was not confirmed. |
| Malawi (MW) | No official copy found online |  | Malawi Revenue Authority — Customs and Excise (Tariff) orders in the Government Gazette; no consolidated copy found. |
| Malaysia (MY) | Researched, not automatable (license pending) |  | [Royal Malaysian Customs Department (JKDM/RMCD) — Customs Duties Order 2025](https://www.customs.gov.my/images/06-prosedur/perintah-kastam/perintah/PUA_384.pdf) |
| Maldives (MV) | Researched, not automatable (no documented machine interface) |  | [Maldives Customs Service — National Tariff Schedule](https://www.customs.gov.mv/eServices/Tariff) |
| Mali (ML) | Agent reads it | UEMOA | [Direction Générale des Douanes du Mali](https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf) — Applies the UEMOA edition of the ECOWAS CET. |
| Malta (MT) | Connected (`eu_taric`) | EU | Read automatically |
| Marshall Islands (MH) | Agent reads it |  | [Division of Customs, Marshall Islands](https://paclii.org/mh/legis/consol_act/ida1989178) — Import Duties Act 1989 and amendments. |
| Martinique (MQ) | Connected (`eu_taric`) | EU | Read automatically |
| Mauritania (MR) | No official copy found online |  | Direction Générale des Douanes, Mauritanie — No current schedule found online. |
| Mauritius (MU) | Connected (`mu_mra_integrated_tariff`) |  | Read automatically |
| Mexico (MX) | Researched, not automatable (source insufficient) |  | [Mexico Ministry of Economy (SNICE) / SAT — LIGIE/TIGIE](https://www.snice.gob.mx/cs/avi/snice/ligie.info22.html) |
| Micronesia, Federated States of (FM) | Agent reads it |  | [FSM Department of Finance and Administration, Customs and Tax](https://fsmlaw.org/fsm/code/title54/T54_Ch02_SubChpII_2014.html) — Import duty of 4% of CIF on goods not otherwise listed (FSM Code Title 54 §221(11), 2014 compilation; later amendments not checked). |
| Moldova, Republic of (MD) | Researched, not automatable (source insufficient) |  | [Customs Service of the Republic of Moldova — national customs tariff and customs-revenue instruments](https://customs.gov.md/en/articles/acte-normative-1856-ro) |
| Mongolia (MN) | Researched, not automatable (no documented machine interface) |  | [Mongolia General Customs Administration — import customs tariff](https://customs.gov.mn/%D0%B3%D0%B0%D0%B0%D0%BB%D0%B8%D0%B9%D0%BD-%D1%82%D0%B0%D1%80%D0%B8%D1%84/) |
| Montenegro (ME) | Researched, not automatable (individual investigation required) |  | [Montenegro Revenue and Customs Administration — TARICG](https://www.gov.me/en/documents/c9ad2bc2-dfc4-4107-9fea-585c792b81af) |
| Montserrat (MS) | No official copy found online | CARICOM | Montserrat Customs and Revenue Service — CET with national exceptions; no schedule found online. |
| Morocco (MA) | Connected (`ma_adii_tariff`) |  | Read automatically |
| Mozambique (MZ) | No official copy found online |  | Autoridade Tributária de Moçambique — Pauta Aduaneira (Lei 11/2016 as amended in 2022), published in the Boletim da República; no official copy found online. |
| Myanmar (MM) | Agent reads it |  | [Customs Department, Ministry of Planning and Finance, Myanmar](https://www.mopf.gov.mm/sites/default/files/Customs%20Tariff%20of%20Myanmar%202022_0.pdf) — Customs Tariff of Myanmar 2022 (AHTN 2022). |
| Namibia (NA) | Researched, not automatable (individual investigation required) | SACU | [Namibia Revenue Agency / SACU — eTariff and Customs and Excise Tariff](https://www.namra.org.na/documents/cms/uploaded/namra-etariff-pocket-guide-11eaf6db86.pdf) |
| Nauru (NR) | Agent reads it |  | [Nauru Customs, Department of Finance](https://paclii.org/nr/legis/num_act/coda2010267) — Customs (Rates of Duty) Act 2010. |
| Nepal (NP) | Connected (`np_customs_tariff_pdf`) |  | Read automatically |
| Netherlands (NL) | Connected (`eu_taric`) | EU | Read automatically |
| New Caledonia (NC) | Agent reads it |  | [Direction régionale des douanes de Nouvelle-Calédonie](https://douane.gouv.nc/sites/default/files/atoms/files/tarif_des_douanes_mj01012023.pdf) — Tarif des douanes; also published daily as open data on data.gouv.nc (a candidate for automation). |
| New Zealand (NZ) | Connected (`nz_customs_cusmod`) |  | Read automatically |
| Nicaragua (NI) | Researched, not automatable (no documented machine interface) | SICA | [Nicaragua Directorate General of Customs — national Sistema Arancelario Centroamericano execution](https://www.dga.gob.ni/) |
| Niger (NE) | Agent reads it | UEMOA | [Direction Générale des Douanes du Niger](https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf) — Applies the UEMOA edition of the ECOWAS CET. |
| Nigeria (NG) | Researched, not automatable (source insufficient) | ECOWAS | [Nigeria Customs Service — Nigeria Customs Tariff / ECOWAS CET](https://customs.gov.ng/cet-tariff) |
| Niue (NU) | Agent reads it |  | [Niue Customs](https://paclii.org/nu/legis/consol_act/cta1982178) — Customs Tariff Act 1982. |
| North Korea (KP) | No official copy found online |  | None (comprehensive UN sanctions) — Excluded from Demand Discovery: comprehensive UN Security Council sanctions. |
| Northern Mariana Islands (MP) | Agent reads it |  | [CNMI Department of Finance, Division of Customs](https://www.finance.gov.mp/cus-import-requirements.php) — Outside the US customs territory; excise tax on imports under 4 CMC. |
| Norway (NO) | Connected (`no_tolletaten_customs_tariff`) |  | Read automatically |
| Oman (OM) | Connected (`om_rop_customs_tariff`) | GCC | Read automatically |
| Pakistan (PK) | Researched, not automatable (license pending) |  | [Pakistan Federal Board of Revenue — Pakistan Customs Tariff](https://www.fbr.gov.pk/categ/laws/144) |
| Palau (PW) | No official copy found online |  | Palau Bureau of Revenue and Taxation — The 2023 tax reform introduced a goods and services tax; the remaining import tax was not confirmed. |
| Panama (PA) | Researched, not automatable (source insufficient) |  | [Panama National Customs Authority — Interactive National Tariff](https://aranceles.ana.gob.pa/) |
| Papua New Guinea (PG) | Agent reads it |  | [Papua New Guinea Customs Service](https://customs.gov.pg/tev/tariff) — Online tariff; also the Customs Tariff Act 1990, HS 2022 edition. |
| Paraguay (PY) | Researched, not automatable (source insufficient) | MERCOSUR | [Paraguay Ministry of Economy and Finance — National Tariff](https://economia.gov.py/index.php/paraguay-y-el-mundo/aranceles-la-importacion/arancel-nacional-vigente) |
| People's Republic of China (CN) | Researched, not automatable (individual investigation required) |  | [People's Republic of China Ministry of Finance / General Administration of Customs — 2026 Customs Tariff](https://gss.mof.gov.cn/gzdt/zhengcefabu/202512/t20251231_3981044.htm) |
| Peru (PE) | Connected (`pe_sunat_customs_tariff`) |  | Read automatically |
| Philippines (PH) | Researched, not automatable (no documented machine interface) |  | [Philippine Tariff Commission — Philippine Tariff Finder (MFN, AIFTA and other FTA schedules, AHTN 2022)](https://finder.tariffcommission.gov.ph/about) |
| Poland (PL) | Connected (`eu_taric`) | EU | Read automatically |
| Portugal (PT) | Connected (`eu_taric`) | EU | Read automatically |
| Qatar (QA) | Connected (`qa_customs_integrated_tariff`) | GCC | Read automatically |
| Republic of the Congo (CG) | No official copy found online | CEMAC | Direction Générale des Douanes et Droits Indirects du Congo — CEMAC member; regional instruments are republished by the Secrétariat Général du Gouvernement (sgg.cg). |
| Republic of The Gambia (GM) | Agent reads it | ECOWAS | [Gambia Revenue Authority](https://ecotis.ecowas.int/?p=24111) — Applies the ECOWAS CET; no national schedule found online. |
| Romania (RO) | Connected (`eu_taric`) | EU | Read automatically |
| Russian Federation (RU) | Researched, not automatable (source insufficient) | EAEU | [Kazakhstan Ministry of Finance / Open Data portal — EAEU nomenclature and Common Customs Tariff](https://data.egov.kz/datasets/view?index=euraziyalyk_ekonomikalyk_odakt) |
| Rwanda (RW) | Researched, not automatable (individual investigation required) | EAC | [Rwanda Revenue Authority / East African Community — CET national execution](https://www.rra.gov.rw/fileadmin/user_upload/COMMON_EXTERNAL_TARIFF__Updated_June_2025.pdf) |
| Saint Barthélemy (BL) | Rule; v5 rule 5% |  | [French customs (DGDDI) for the Collectivité de Saint-Barthélemy](https://www.douane.gouv.fr/fiche/cas-particuliers-de-lile-de-saint-martin-et-de-lile-de-saint-barthelemy) — Outside the EU customs territory; 5% droit de quai on all goods brought onto the island. |
| Saint Helena (SH) | Agent reads it |  | [St Helena Government, Customs](https://www.sainthelena.gov.sh/wp-content/uploads/2023/04/LN-4-Customs-and-Excise-Tariffs-and-ExemptionsAmendment-Regulations-2023-002.pdf) — Customs and Excise Tariffs regulations, amended each year. |
| Saint Kitts and Nevis (KN) | No official copy found online | CARICOM | Customs and Excise Department, Saint Kitts and Nevis — CET with national exceptions; no schedule found online. |
| Saint Lucia (LC) | Agent reads it | CARICOM | [Customs and Excise Department, Saint Lucia](https://www.customs.gov.lc/customs-tariff.php) — Official customs tariff page. |
| Saint Pierre and Miquelon (PM) | Agent reads it |  | [Collectivité territoriale de Saint-Pierre-et-Miquelon](https://www.jo-spm.fr/) — Rates set by deliberations published in the Journal officiel de Saint-Pierre-et-Miquelon. |
| Saint Vincent and the Grenadines (VC) | Agent reads it | CARICOM | [Customs and Excise Department, Saint Vincent and the Grenadines](https://www.gov.vc/index.php/business/regulations) — Government regulations page; CET with national exceptions. |
| Samoa (WS) | Agent reads it |  | [Ministry of Customs and Revenue, Samoa](https://palemene.ws/PDFfiles/Customs%20Tariff%20Amendment%20Act%202022%20-%20Eng_English.pdf) — Customs Tariff Act as amended in 2022. |
| San Marino (SM) | Connected (`eu_taric`) | EU | Read automatically |
| Sao Tome and Principe (ST) | No official copy found online |  | Direção das Alfândegas de São Tomé e Príncipe — No official schedule found online. |
| Saudi Arabia (SA) | Connected (`sa_zatca_integrated_tariff`) | GCC | Read automatically |
| Senegal (SN) | Researched, not automatable (source insufficient) | UEMOA | [Senegal Directorate General of Customs — ECOWAS CET and national duties and taxes](https://www.douanes.sn/ndn71/) |
| Serbia (RS) | Researched, not automatable (individual investigation required) |  | [Customs Administration of Serbia — 2026 Customs Tariff regulation](https://www.carina.rs/privreda/tarifski-poslovi/carinska-tarifa/privreda_carinska_tarifa_opste.html) |
| Seychelles (SC) | Agent reads it |  | [Seychelles Revenue Commission](https://src.gov.sc/faq/) — Imports pay trades tax on listed goods (Trades Tax Regulations). |
| Sierra Leone (SL) | Agent reads it | ECOWAS | [National Revenue Authority of Sierra Leone](https://ecotis.ecowas.int/?p=24111) — Applies the ECOWAS CET; national measures in the annual Finance Act. |
| Singapore (SG) | Connected (`sg_sso_customs_duties_order`), saved nightly in the SSO window; v5 rule 0% until the first copy |  | Read automatically; before the first copy, [Singapore Statutes Online — Customs (Duties) Order, First Schedule](https://sso.agc.gov.sg/SL/CA1960-OR4?ProvIds=Sc4-XX-Sc4-) |
| Sint Maarten (Dutch part) (SX) | Rule; v5 rule 0% |  | [Government of Sint Maarten, Customs](https://www.sintmaartengov.org/Ministries/Departments/Pages/Customs.aspx) — No import duty; customs taxes only petrol. |
| Slovakia (SK) | Connected (`eu_taric`) | EU | Read automatically |
| Slovenia (SI) | Connected (`eu_taric`) | EU | Read automatically |
| Solomon Islands (SB) | No official copy found online |  | Customs and Excise Division, Solomon Islands — Tariff changes are gazetted (Solomon Islands Gazette on PacLII); no consolidated schedule found. |
| Somalia (SO) | Agent reads it | EAC | [Federal Ministry of Finance, Revenue Directorate](https://mail.revenuedirectorate.gov.so/sites/default/files/gva-sliderlayer-upload/Somali_Customs_Tariff_Final.pdf) — Somali Customs Tariff (federal). EAC member since 2024; the EAC CET is not yet applied. |
| South Africa (ZA) | Researched, not automatable (license pending) | SACU | [South African Revenue Service (SARS) — Schedules to the Customs and Excise Act](https://www.sars.gov.za/legal-counsel/primary-legislation/schedules-to-the-customs-and-excise-act-1964/) |
| South Korea (KR) | Connected (`kr_kcs_customs_tariff`) |  | Read automatically |
| South Sudan (SS) | No official copy found online | EAC | National Revenue Authority of South Sudan — EAC member applying the CET only in part; national rates set in the annual Financial Act. |
| Spain (ES) | Connected (`eu_taric`) | EU | Read automatically |
| Sri Lanka (LK) | Connected (`lk_customs_tariff`) |  | Read automatically |
| State of Palestine (PS) | No official copy found online |  | Palestinian Ministry of Finance, Customs, Excise and VAT Department — Applies Israel's customs tariff under the Paris Protocol (1994), except for listed goods. |
| Sudan (SD) | No official copy found online |  | Sudan Customs Authority — No official schedule found online. |
| Suriname (SR) | No official copy found online | CARICOM | Douane Suriname — Wet Tarief van Invoerrechten, amended by decrees in the Staatsblad (sris.sr); no consolidated copy found. |
| Sweden (SE) | Connected (`eu_taric`) | EU | Read automatically |
| Switzerland (CH) | Researched, not automatable (source insufficient) |  | [Federal Office for Customs and Border Security (BAZG/FOCBS) — Tares customs tariff](https://www.bazg.admin.ch/en/customs-tariff-tares-services-companies) |
| Syrian Arab Republic (SY) | No official copy found online |  | General Directorate of Customs, Syria — A new unified tariff was introduced in 2025; no official copy found online. |
| Tajikistan (TJ) | No official copy found online |  | Customs Service under the Government of Tajikistan — No official schedule found online. |
| Thailand (TH) | Researched, not automatable (individual investigation required) |  | [Thai Customs Department — integrated tariff / ASEAN Harmonised Tariff Nomenclature schedules](https://www.customs.go.th/list_strc_download_with_document.php?ini_content=reference_files&lang=en&left_menu=nmenu_esevice_006&order_by=co_last_update_datetime&show_search=1&sort_type=0) |
| The Republic of North Macedonia (MK) | Researched, not automatable (individual investigation required) |  | [North Macedonia Customs Administration — Customs Tariff 2026](https://customs.gov.mk/zakon-za-carinska-tarifa.nspx) |
| Timor-Leste (TL) | Rule; v5 rule 5% |  | [Customs Authority of Timor-Leste](https://customs.gov.tl/doing-business/duties-taxes/) — One customs duty rate (5%) on the value of all imports, set in the annual State Budget. |
| Togo (TG) | Agent reads it | UEMOA | [Office Togolais des Recettes](https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf) — Applies the UEMOA edition of the ECOWAS CET. |
| Tokelau (TK) | Agent reads it |  | [Government of Tokelau](https://paclii.org/tk/legis/num_act/cr1991233) — Customs Regulations 1991. |
| Tonga (TO) | Agent reads it |  | [Ministry of Revenue and Customs, Tonga](https://paclii.org/to/legis/consol_act/caeas286) — Customs and Excise Act; duty orders on PacLII. |
| Trinidad and Tobago (TT) | Researched, not automatable (source insufficient) | CARICOM | [Trinidad and Tobago Customs and Excise Division / Ministry of Finance — CET](https://tradeind.gov.tt/wp-content/uploads/2025/04/Legal-Notice-No.-218-Customs-Common-External-Tariff-Order-2024.pdf) |
| Tunisia (TN) | Connected (`tn_douane_tarifweb`) |  | Read automatically |
| Türkiye (TR) | Researched, not automatable (source insufficient) |  | [Republic of Türkiye Ministry of Trade — national GTİP tariff schedule](https://www.ticaret.gov.tr/ithalat/ithalat-mevzuati/ithalat-rejimi-karari-igv-karari-ve-ithalat-tebligleri/1-ithalat-rejimi-kararikarar-sayisi3350karar-metni-ve-tablolar-konsolide-edilmis-olup-gunceldir) |
| Turkmenistan (TM) | Agent reads it |  | [State Customs Service of Turkmenistan](https://customs.gov.tm/en/customs-info/customs-fees/excices) — Customs fees and excise pages; import duty schedule not found. |
| Turks and Caicos Islands (TC) | Agent reads it |  | [Turks and Caicos Islands Customs Department](https://customs.gov.tc/webuploads/currdoc/Frequently%20Asked%20Questions.pdf) — Customs FAQ with the general rates. |
| Tuvalu (TV) | No official copy found online |  | Tuvalu Customs — No official schedule found online. |
| Uganda (UG) | Researched, not automatable (individual investigation required) | EAC | [Uganda Revenue Authority / East African Community — CET national execution](https://ura.go.ug/en/download/common-external-tariff-2022-version/0/) |
| Ukraine (UA) | Researched, not automatable (source insufficient) |  | [State Customs Service of Ukraine — Rates of import and export duties](https://data.gov.ua/dataset/duty-rates) |
| United Arab Emirates (AE) | Researched, not automatable (individual investigation required) | GCC | [Dubai Customs / Dubai Pulse — Customs Agreements, Commodity and Tariff](https://www.dubaicustoms.gov.ae/en/PoliciesAndNotices/Documents/IntegratedCustomsTariffv4.pdf) |
| United Kingdom (GB) | Connected (`uk_tariff`) |  | Read automatically |
| United Republic of Tanzania (TZ) | Researched, not automatable (individual investigation required) | EAC | [Tanzania Revenue Authority / East African Community — CET national execution](https://www.eac.int/press-releases/142-customs/3544-eac-ministers-adopt-measures-to-strengthen-regional-trade-and-industrialization) |
| United States of America (US) | Connected (`us_hts`) |  | Read automatically |
| Uruguay (UY) | Researched, not automatable (license pending) | MERCOSUR | [Uruguay Ministry of Economy and Finance — National Tariff](https://www.gub.uy/ministerio-economia-finanzas/politicas-y-gestion/nomenclatura-aranceles-uruguay) |
| Uzbekistan (UZ) | Connected (`uz_lex_customs_tariff`) |  | Read automatically |
| Vanuatu (VU) | Agent reads it |  | [Vanuatu Customs and Inland Revenue](https://vanuatucustoms.gov.vu/images/Customs_Tariff/2024/IMPORT%20DUTIES%20CONSOLIDATION%20AMENDMENT%20ACT%20NO.%2024%20OF%202023.pdf) — Import Duties (Consolidation) Amendment Act No. 24 of 2023. |
| Venezuela (VE) | No official copy found online |  | SENIAT — Arancel de Aduanas by decree in the Gaceta Oficial; temporary exonerations change often. |
| Vietnam (VN) | Connected (`vn_congbao_tariff`) |  | Read automatically |
| Virgin Islands, British (VG) | No official copy found online |  | BVI Customs Department — Customs Management and Duties Act; temporary reductions are announced by press release. |
| Wallis and Futuna (WF) | No official copy found online |  | Service des douanes de Wallis-et-Futuna — No official schedule found online. |
| Yemen (YE) | No official copy found online |  | Yemen Customs Authority — No official schedule found online. |
| Zambia (ZM) | Researched, not automatable (individual investigation required) |  | [Zambia Revenue Authority — Customs and Excise Tariff 2026](https://www.zra.org.zm/wp-content/uploads/2026/02/National-Tariff-Book-JANUARY-2026-1.pdf) |
| Zimbabwe (ZW) | Agent reads it |  | [Zimbabwe Revenue Authority (ZIMRA)](https://www.zimra.co.zw/downloads/category/85-statutory-instruments-2024) — Tariff set and changed by statutory instruments. |

## 8. Keeping it current

- Rules: each has a `review_by` date (Timor-Leste's follows the State Budget, 31 Jan 2027; the others
  14 Oct 2027). After it, the rule is skipped and the duty falls back to the estimate.
- Directory: re-check the links yearly; a changed source is a code change with the test.
- A market that becomes connected leaves the directory (the test refuses an entry that shadows an
  adapter, except where the automatic read can leave a duty open: Andorra's chapters 1–24, and
  Singapore before its first nightly copy).
