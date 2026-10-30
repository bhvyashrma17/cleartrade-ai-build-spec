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

## 1. Where every market stands (19 Oct 2026)

| Status | Markets | Meaning |
|---|---|---|
| Connected | 88 | The official tariff is read automatically (Customs Atlas). 53 before this work, plus Martinique, San Marino and Andorra (chapters 25–97) on the EU tariff, Singapore, read from the copy saved each night in its permitted window (D-029, §5a), 24 members of three customs unions read from their union's common external tariff (D-028, §4a), and cluster 1 (D-030, §4b): the UAE and Bahrain on the GCC common tariff, Argentina, Paraguay and Uruguay on the Mercosur common external tariff, and China and Brazil read from their own published tariffs. |
| Researched, not automatable | 41 | The official source is known and recorded with the reason it cannot be read automatically (licence pending, source incomplete, no machine interface, credentials, investigation required). |
| Directory | 89 | The publishing authority and where its tariff can be read, for an agent; 6 of these are scored by a published rule. |

`tests/tariff-source-directory.test.ts` fails if any screened market has none of the three. Of the
directory's 89, 43 name an official page, schedule or law to read (6 of them the source of a published
rule) and 46 have no official copy online (the agent asks the authority; the duty stays estimated until
then). A connected market keeps its directory entry or researched source as the agent's pointer where
the automatic read can leave its duty open: Andorra's chapters 1–24, Singapore before its first saved
copy, a customs-union member's own exceptions, and the lines a retained tariff schedule leaves open
(§4b).

## 2. How v5 finds a market's duty, in order

1. **Official tariff line, read automatically** (Customs Atlas evidence, quality 1). Two kinds are
   labelled and score lower: a customs union's common tariff (D-028, quality 0.8, §4a and §4b), and a
   market's own tariff read from a retained official schedule without its trade remedies (D-031,
   quality 0.9, labelled "read from <the tariff>; trade remedies are not checked", §4b).
2. ~~**Official tariff line, read by an agent**~~ — retired 30 Oct 2026 (D-037, §3). Runs no longer
   read agent-recorded lines; a breakdown stored before still shows "read from the official tariff by a
   ClearTrade agent".
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

## 3. The agent's part (retired 30 Oct 2026, D-037)

**Retired.** The owner decided that Demand Discovery uses actual data or labelled estimates only: agents
no longer read tariffs. The "Official tariff to check" pointer and the **Record the official duty** form
are removed, `POST /api/v1/market-access/manual-captures` refuses every request, and runs ignore
`authoritative_manual` evidence (`run-inputs.ts`). A market without an automatically read tariff keeps
the labelled estimate (§2, step 4). The directory below remains the research list for automation
(§5). What follows describes the flow as it was.

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
| ECOWAS (UEMOA edition) | — | UEMOA TEC 2022 v4 (PDF, UEMOA Commission) | Connected (§4a) for the eight UEMOA members; the regional levies are charged on top. |
| ECOWAS | CV | ECOWAS Trade Information System page | Connected (§4a) for GM, GH, GN, LR, NG, SL from the UEMOA edition's DD column; Cabo Verde keeps its own Pauta Aduaneira. |
| EAC | SS, CD, SO | EAC CET 2022 updated June 2025, EAC Gazette of 30 June 2026 (both from the East African Business Council library) | Connected (§4a) for KE, UG, TZ, RW, BI; South Sudan applies the CET only in part; DR Congo and Somalia do not yet apply it. |
| EAEU | — | EEC Council Decision No. 80 (14 Sep 2021) on Kazakhstan's official legal portal | Connected (§4a); Kazakhstan, Kyrgyzstan and Armenia apply lower WTO-commitment rates on listed lines, not modelled. |
| CEMAC | CM, CF, TD, CG, GQ, GA | Not found online | New CEEAC–CEMAC tariff in force in Cameroon from 1 Jan 2026. |
| SACU | ZA, BW, NA, LS, SZ | SARS Schedule 1 | SARS terms require written consent for automated acquisition. |
| GCC | — | GCC unified customs tariff, 12-digit edition published by Dubai Customs (PDF) | Connected (§4b) for AE and BH; Saudi Arabia, Kuwait, Qatar and Oman are connected nationally; national exemptions differ. |
| MERCOSUR | — | Mercosur common external tariff, Annex I of Gecex Resolution 272/2021 (CAMEX workbook) | Connected (§4b): AR, PY and UY on the common tariff; Brazil on its own applied tariff from the same workbook. The other members' exception lists are not modelled. |
| CARICOM, SICA | national | — | National exception lists; read the national tariff. |

## 4a. Common external tariffs read for members (D-028)

The owner decided (18 Oct 2026) that a customs union's common tariff counts as official for its members
before national exceptions are modelled, labelled and below full quality. Three unions are read, each
from one retained release pinned to the official files read on 18 Oct 2026
(`src/lib/market-access/providers/customs-union-*.ts`):

| Union | Members | Release | Lines | Not scored automatically |
|---|---|---|---|---|
| ECOWAS (UEMOA TEC 2022 v4, DD column) | BF, BJ, CI, GH, GM, GN, GW, LR, ML, NE, NG, SL, SN, TG | `uemoa-tec-2022-v4` | 6,380 ten-digit lines (0/5/10/20/35%) | — (levies RS 1%, PCS 0.8%, PC 0.5% are charged on top and are not in the duty) |
| EAC (CET 2022 updated June 2025 + Legal Notice EAC/160/2026) | BI, KE, RW, TZ, UG | `eac-cet-2022-jun2025-ln160-2026`, valid 1 Jul 2026 – 30 Jun 2027 | 5,961 lines; sensitive items at their Schedule 2 rate; the ten lines of the Gazette's amendment table at their new rate | 1,055 lines named in the Gazette's stays of application: for the partner state its table names (Kenya: table III; Uganda: II, IV–VII), for every member where a table names states row by row (I, VIII, IX) |
| EAEU (Council Decision No. 80, consolidated on Adilet, updated 15 Sep 2026) | AM, BY, KG, KZ, RU | `adilet-H21EV000080-2026-09-15` | 13,007 lines (ad valorem, euro per unit, the higher of both, or both added) | 1,212 lines whose rate carries a note of the tariff (a temporary or conditional rate) |

- A duty read this way is official evidence labelled *common tariff*: v5 scores it at quality 0.8
  (`quality.official_common_tariff`, below a national tariff's 1 and an agent-read line's 0.9) and the
  market's reason says "under the <union> common external tariff; this market's own exceptions are not
  checked". Where a line is not scored automatically for a member, its duty falls back as for any market
  without an official rate and the agent's pointer is the member's national source.
- Mixed duties ("the higher of 25% or US$ 200/MT", EAEU "10%, but not less than €0.03/kg") are official
  but not reduced to one rate, so they fall back to the estimate with the reason; an EAEU duty in euro per
  kilogram is converted at the ECB rate.
- Not modelled, and said with every duty: Kazakhstan's, Kyrgyzstan's and Armenia's WTO-commitment rates;
  Ghana's and Nigeria's import adjustment measures; Sierra Leone's Finance Act measures; EAC duty
  remission for registered manufacturers; EAEU preferences for developing countries. The EAEU text's
  editor's note announces nomenclature amendments (Board Decision No. 43 of 7 Apr 2026, in force no
  earlier than 1 Jul 2026) that it did not yet carry.
- The EAC release states nothing after 30 June 2027: the July 2027 Gazette must be read first.
- Provenance: the EAC files came from the East African Business Council's library because the EAC
  Secretariat's repository did not answer; both are official EAC publications, and their checksums are
  pinned.
- Building and importing: `npx tsx scripts/build-customs-union-bundle.ts --union=<EAEU|ECOWAS|EAC>
  --file=<official file> … --out=<zip>` recognises the files by checksum, reads them and writes a
  deterministic bundle (the same files give the same bytes); `scripts/import-retained-authority-release.ts
  --family=<union>` imports it. Until a union's release is active, a run records its members as
  `no_release`.

## 4b. Cluster 1: tariff schedules read automatically (D-030, D-031)

The owner asked on 19 Oct 2026 for every market an agent still checks to be read by the system, cluster
by cluster (D-030). Cluster 1 is the largest Indian export markets among the researched sources whose
official tariff can be downloaded whole — the UAE, China and Brazil — with the partners the same files
serve. Four releases, each pinned to the official files read on 19 Oct 2026
(`src/lib/market-access/providers/tariff-schedule-*.ts`, ledger E-025):

| Release | Markets | Read as | Lines | Not scored automatically |
|---|---|---|---|---|
| GCC unified customs tariff, 12-digit edition of Dubai Customs (23 Jul 2025), with the UAE's CEPA schedule (Annex 2B) | AE, BH | Common tariff (D-028, quality 0.8) | 13,449; India's CEPA rate stated for the UAE on 11,650 lines, by year from 1 May 2022 | 117 PROHIBITED or special-goods lines; 3 lines with no printed rate; 88 lines excluded from the UAE's CEPA concessions carry no India rate |
| Mercosur common external tariff (Annex I of Gecex Resolution 272/2021, CAMEX workbook of 5 Oct 2026) | AR, PY, UY | Common tariff (D-028, quality 0.8) | 10,516 NCM lines | 1,618 capital-goods (BK) and IT (BIT) lines, which each member applies under its own regime |
| China's 2026 customs tariff with Annex 1 (provisional rates) of the 2026 adjustment plan | CN | Own tariff (D-031, quality 0.9) | 8,972 lines; 600 whole-line provisional rates replace MFN; the Asia-Pacific Trade Agreement rate is India's preference on 2,440 lines (needs origin proof); 31 duties per kilogram or square metre and 3 "the lower of" duties kept with every operand | Tariff-rate quotas (the out-of-quota rate is scored and the quota said); 335 provisional rates for part of a line (said, not scored); nothing after 31 Dec 2026 until the 2027 tariff is imported |
| Brazil's applied tariff (Annexes I–X of Gecex Resolution 272/2021, same workbook) | BR | Own tariff (D-031, quality 0.9) | 10,516 lines: Annex II's applied rate where listed (9,404), else the TEC; whole-line rates of the LETEC, LEBIT/BK and temporary-increase lists replace it while in force (1,517 lines) | A line with two different exception rates in force on the day; ex-tarifários, quotas and the automotive list (261 lines say them) |

- A market's own tariff read this way is official evidence labelled *read from <the tariff>*: v5 scores
  it at quality 0.9 (`quality.official_schedule_read`, policy v7) and the market's reason says "read
  from China's 2026 customs tariff; trade remedies are not checked". The GCC and Mercosur releases are
  common tariffs, labelled and scored as in §4a.
- Not modelled, and said with every duty: trade remedies (anti-dumping, countervailing, safeguard
  duties) and temporary measures outside the schedules; the GCC members' own exemptions; Argentina's,
  Paraguay's and Uruguay's national exception lists and regimes (Uruguay's own tariff stays
  licence-pending; the common tariff comes from Brazil's publication of it); India–Mercosur PTA margins.
- The UAE's CEPA year is counted from each anniversary of 1 May 2022 (the stricter reading: it never
  states a rate lower than the schedule's for the day); where lines beneath one HS6 carry different
  India rates, no single India rate is stated.
- Rights (D-030): UAE Federal Decree-Law No. 38 of 2021, Art. 3(2), Brazil's Law 9.610/1998, Art. 8(IV),
  and China's Copyright Law (2020), Art. 5, exclude official texts from copyright; each bundle and its
  import record carry the basis. Dubai Customs' own website terms were not located.
- Building and importing: `npx tsx scripts/build-tariff-schedule-bundle.ts --schedule=<GCC|MERCOSUR|CN|BR>
  --file=<official file> … --out=<zip>` recognises the files by checksum and writes a deterministic
  bundle (two builds give the same bytes, whatever the file order); `scripts/import-retained-authority-release.ts
  --family=<GCC|MERCOSUR|CN|BR>` imports it. Until a release is active, a run records its markets as
  `no_release`.

## 5. Automation order (D-030)

Clusters of researched national sources, largest Indian export markets first, each completed — sources,
rights check, reader, tests, staging import — before the next starts. Each cluster's membership is
confirmed against India's export values (BACI) before it starts.

| Cluster | Markets | Status |
|---|---|---|
| Customs unions | 24 members of ECOWAS, the EAC and the EAEU | Done (D-028, §4a) |
| SG | Singapore | Done (D-029, §5a): saved nightly |
| 1 | AE, BH, AR, PY, UY, CN, BR | Done (D-030, D-031, §4b), pending merge and staging import |
| 2 | TR, TH, MX | Next: the largest remaining Indian export markets among the researched sources |
| 3 | EG, PH, JO, CH | |
| 4 | Central America (GT, SV, HN, NI, CR — one common tariff; PA), CO, EC, DO | |
| 5 | UA, RS, BA, ME, MK, XK, MD | |
| 6 | BW, NA, ZM | SACU's own schedule is SARS's (licence pending), so each member's publication |
| 7 | KH, LA, MN, BN, MV, LB, BO, TT, BZ | |

Then the 37 small markets whose official page, schedule or law an agent can read (§1), as saved copies
where that is the only way (D-029); then the 45 that v5 ranks with nothing online (46 in the directory,
which also lists North Korea, excluded from v5), which depend on the UNCTAD and WTO replies. The seven
licence-pending sources (HK beyond its rule, MY, CL, ZA, BD, PK, JM) stay with agents until each licence
is settled (open decision, ledger).

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
  Atlas already defines. The owner extended it to the eight sources whose reuse is licence-pending (HK
  beyond its rule, MY, CL, ZA, UY, BD, PK, JM), one cited rate per line (D-028, ledger R-24).

## 7. Every market (generated 17 Oct 2026; Singapore and the customs-union members updated 18 Oct 2026, cluster 1 on 19 Oct 2026)

| Market | Official tariff now | Union | Where to read it |
|---|---|---|---|
| Afghanistan (AF) | No official copy found online |  | Afghanistan Customs Department, Ministry of Finance — Only third-party copies of the 2014 tariff were found online. |
| Albania (AL) | Connected (`al_customs_nomenclature_archive`) |  | Read automatically |
| Algeria (DZ) | No official copy found online |  | Direction Générale des Douanes, Algérie — Only third-party copies of the tariff were found online. |
| Andorra (AD) | Connected (`eu_taric`), chapters 25–97 | EU | Read automatically |
| Angola (AO) | No official copy found online |  | Administração Geral Tributária (AGT) — Pauta Aduaneira 2024; no official copy found online. |
| Anguilla (AI) | No official copy found online |  | Anguilla Customs Department — No current schedule found online. |
| Antigua and Barbuda (AG) | No official copy found online | CARICOM | Customs and Excise Division, Antigua and Barbuda — CET with national exceptions under the Customs Duties Act; no schedule found online. |
| Argentina (AR) | Connected (`mercosur_tec_camex`): Mercosur common external tariff | MERCOSUR | Read automatically; its own exceptions: [Argentina ARCA / Secretariat of Commerce — SIM national tariff execution](https://www.argentina.gob.ar/produccion/comercio-exterior) |
| Armenia (AM) | Connected (`eaeu_common_customs_tariff`): EAEU common customs tariff | EAEU | Read automatically; its own exceptions: [Kazakhstan Ministry of Finance / Open Data portal — EAEU nomenclature and Common Customs Tariff](https://data.egov.kz/datasets/view?index=euraziyalyk_ekonomikalyk_odakt) |
| Aruba (AW) | Agent reads it |  | [Departamento di Aduana Aruba](https://www.gobierno.aw/en/import-duties) — Government page on import duties. |
| Australia (AU) | Connected (`au_abf_working_tariff`) |  | Read automatically |
| Austria (AT) | Connected (`eu_taric`) | EU | Read automatically |
| Azerbaijan (AZ) | Agent reads it |  | [State Customs Committee of Azerbaijan](https://customs.gov.az/en/faydali/gomruk-statistikasi/tariff-statistics) — Rates set by Cabinet of Ministers decision; the committee publishes tariff statistics. |
| Bahamas (BS) | Agent reads it |  | [Bahamas Customs Department](https://www.bahamascustoms.gov.bs/resources/laws-on-line/) — Customs Duty (Most Favoured Nation) Tariff Act and amendments. |
| Bahrain (BH) | Connected (`gcc_unified_customs_tariff`): GCC common customs tariff | GCC | Read automatically; its own exceptions: [Bahrain Ministry of Interior, Customs Affairs — Unified Customs Tariff](https://www.bahrain.bh/wps/portal/en/BNP/ServicesCatalogue/GSX-UI-PServiceDetails?psID=1322) |
| Bangladesh (BD) | Researched, not automatable (license pending) |  | [Bangladesh National Board of Revenue / Customs — National Tariff](https://customs.gov.bd/files/Tariff-2025-2026%2829-07-2025%29.pdf) |
| Barbados (BB) | No official copy found online | CARICOM | Barbados Revenue Authority, Customs and Excise Department — CET with national exceptions; no schedule found online. |
| Belarus (BY) | Connected (`eaeu_common_customs_tariff`): EAEU common customs tariff | EAEU | Read automatically; its own exceptions: [Kazakhstan Ministry of Finance / Open Data portal — EAEU nomenclature and Common Customs Tariff](https://data.egov.kz/datasets/view?index=euraziyalyk_ekonomikalyk_odakt) |
| Belgium (BE) | Connected (`eu_taric`) | EU | Read automatically |
| Belize (BZ) | Researched, not automatable (source insufficient) | CARICOM | [Belize Customs and Excise — Tariff and Trade Classification](https://customs.gov.bz/ttpg.html) |
| Benin (BJ) | Connected (`ecowas_cet_uemoa_tec_2022`): ECOWAS common external tariff | UEMOA | Read automatically; its own exceptions: [Direction Générale des Douanes du Bénin](https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf) — Applies the UEMOA edition of the ECOWAS CET. |
| Bermuda (BM) | Agent reads it |  | [Government of Bermuda, Customs Department](https://www.gov.bm/schedules-customs-tariff-act-1970) — Schedules to the Customs Tariff Act 1970. |
| Bhutan (BT) | Connected (`bt_drc_tariff_pdf`) |  | Read automatically |
| Bolivia (BO) | Researched, not automatable (individual investigation required) |  | [Bolivia Aduana Nacional — Arancel Aduanero de Importaciones 2026](https://portal.aduana.gob.bo/aduana7/content/arancel-aduanero-de-importaciones) |
| Bonaire, Sint Eustatius and Saba (BQ) | Rule; v5 rule 0% |  | [Belastingdienst Caribisch Nederland](https://english.belastingdienst-cn.nl/topics/customs-business/company-import-tax) — Import tax is 0% on all goods; general expenditure tax applies separately. |
| Bosnia and Herzegovina (BA) | Researched, not automatable (source insufficient) |  | [Bosnia and Herzegovina Indirect Taxation Authority (UIO/ITA) — national customs tariff](https://www.uino.gov.ba/portal/bs/carine/carinska-tarifa/) |
| Botswana (BW) | Researched, not automatable (individual investigation required) | SACU | [Botswana Unified Revenue Service / SACU — Customs and Excise Tariff](https://www.burs.org.bw/index.php/customsexcisemain/customs-and-exercise-downloads) |
| Brazil (BR) | Connected (`br_camex_applied_tariff`): its CAMEX applied tariff, read without trade remedies | MERCOSUR | Read automatically; the lines left open: [Receita Federal / Portal Único de Comércio Exterior (Siscomex)](https://www.gov.br/mdic/pt-br/assuntos/camex/se-camex/strat/tarifas/vigentes) |
| Brunei Darussalam (BN) | Researched, not automatable (individual investigation required) |  | [Brunei Royal Customs and Excise Department — Brunei Darussalam Tariff and Trade Classification](https://www.customs.gov.bn/ref-rced/) |
| Bulgaria (BG) | Connected (`eu_taric`) | EU | Read automatically |
| Burkina Faso (BF) | Connected (`ecowas_cet_uemoa_tec_2022`): ECOWAS common external tariff | UEMOA | Read automatically; its own exceptions: [Direction Générale des Douanes du Burkina Faso](https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf) — Applies the UEMOA edition of the ECOWAS CET. |
| Burundi (BI) | Connected (`eac_common_external_tariff`): EAC common external tariff | EAC | Read automatically; its own exceptions: [Office Burundais des Recettes](https://obr.bi/images/pdf/TEC-2022--Version-Word-amend--30-Avril-2024-CORRIGE.pdf) — EAC CET 2022 as amended to 30 April 2024 (French). |
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
| Cote d'Ivoire (CI) | Connected (`ecowas_cet_uemoa_tec_2022`): ECOWAS common external tariff | UEMOA | Read automatically; its own exceptions: [Côte d’Ivoire Directorate General of Customs — ECOWAS CET enriched with national duties and taxes](https://apps.douanes.ci/info/tec) |
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
| Ghana (GH) | Connected (`ecowas_cet_uemoa_tec_2022`): ECOWAS common external tariff | ECOWAS | Read automatically; its own exceptions: [Ghana Revenue Authority Customs Division — ICUMS / ECOWAS CET national tariff](https://gra.gov.gh/customs/customs-tariffs-and-levies/) |
| Gibraltar (GI) | Agent reads it |  | [HM Customs Gibraltar](https://www.gibraltarlaws.gov.gi/legislations/integrated-tariff-regulations-2017-2817/download) — Integrated Tariff Regulations 2017. |
| Greece (GR) | Connected (`eu_taric`) | EU | Read automatically |
| Greenland (GL) | Agent reads it |  | [Greenland Tax Agency](https://aka.gl/-/media/aka/til-sitecore/niels-olav/import-custom-duties-2025/greenlandic-import-duties-january-2025.pdf) — Import duties on listed goods only (alcohol, sugar products, tobacco, vehicles and a few others). |
| Grenada (GD) | Agent reads it | CARICOM | [Customs and Excise Division, Grenada](https://grenadaparliament.gd/wp-content/uploads/2021/08/Cap75C-CUSTOMS-DUTIES-ACT.pdf) — Customs Duties Act (Cap. 75C) with the CET schedule. |
| Guatemala (GT) | Researched, not automatable (no documented machine interface) | SICA | [Guatemala Superintendence of Tax Administration — Integrated Permit/Tariff Catalog](https://www.sieca.int/producto/arancel-centroamericano-de-importacion/) |
| Guinea (GN) | Connected (`ecowas_cet_uemoa_tec_2022`): ECOWAS common external tariff | ECOWAS | Read automatically; its own exceptions: [Direction Générale des Douanes de Guinée](https://ecotis.ecowas.int/?p=24111) — Applies the ECOWAS CET; no national schedule found online. |
| Guinea-Bissau (GW) | Connected (`ecowas_cet_uemoa_tec_2022`): ECOWAS common external tariff | UEMOA | Read automatically; its own exceptions: [Direção-Geral das Alfândegas da Guiné-Bissau](https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf) — Applies the UEMOA edition of the ECOWAS CET. |
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
| Kazakhstan (KZ) | Connected (`eaeu_common_customs_tariff`): EAEU common customs tariff | EAEU | Read automatically; its own exceptions: [Kazakhstan Ministry of Finance / Open Data portal — EAEU nomenclature and Common Customs Tariff](https://data.egov.kz/datasets/view?index=euraziyalyk_ekonomikalyk_odakt) |
| Kenya (KE) | Connected (`eac_common_external_tariff`): EAC common external tariff | EAC | Read automatically; its own exceptions: [Kenya Revenue Authority (KRA) — EAC Common External Tariff and Kenya implementing measures](https://ikesra.kra.go.ke/items/538c6b1f-8c90-42da-ae0e-f20ea1d1fa6a) |
| Kiribati (KI) | Agent reads it |  | [Kiribati Customs Service](https://paclii.org/ki/legis/sub_leg/ca1993cto1998336) — Customs Tariff Order under the Customs Act; check later orders. |
| Kuwait (KW) | Connected (`kw_customs_integrated_tariff`) | GCC | Read automatically |
| Kyrgyzstan (KG) | Connected (`eaeu_common_customs_tariff`): EAEU common customs tariff | EAEU | Read automatically; its own exceptions: [Kazakhstan Ministry of Finance / Open Data portal — EAEU nomenclature and Common Customs Tariff](https://data.egov.kz/datasets/view?index=euraziyalyk_ekonomikalyk_odakt) |
| Lao People's Democratic Republic (LA) | Researched, not automatable (no documented machine interface) |  | [Lao PDR Ministry of Industry and Commerce — Lao Trade Portal commodity and tariff search](https://www.laotradeportal.gov.la/en-gb/site/listcommodity) |
| Latvia (LV) | Connected (`eu_taric`) | EU | Read automatically |
| Lebanon (LB) | Researched, not automatable (no documented machine interface) |  | [Lebanese Customs — Integrated Customs Tariff](https://www.customs.gov.lb/tariff/tariff.aspx) |
| Lesotho (LS) | No official copy found online | SACU | Revenue Services Lesotho — Applies the SACU tariff (SARS Schedule 1). |
| Liberia (LR) | Connected (`ecowas_cet_uemoa_tec_2022`): ECOWAS common external tariff | ECOWAS | Read automatically; its own exceptions: [Liberia Revenue Authority](https://ecotis.ecowas.int/?p=24111) — Applies the ECOWAS CET; no national schedule found online. |
| Libya (LY) | No official copy found online |  | Libyan Customs Authority — No official schedule found online. |
| Lithuania (LT) | Connected (`eu_taric`) | EU | Read automatically |
| Luxembourg (LU) | Connected (`eu_taric`) | EU | Read automatically |
| Macao (MO) | Rule; v5 rule 0% |  | [Macao Trade and Investment Promotion Institute](https://investhere.ipim.gov.mo/en/macau/investmentinformation/foreigntrade) — Free port: no duty on imports; consumption tax on tobacco and strong alcohol. |
| Madagascar (MG) | No official copy found online |  | Direction Générale des Douanes, Madagascar — A public eTariff tool was launched in July 2024; its address was not confirmed. |
| Malawi (MW) | No official copy found online |  | Malawi Revenue Authority — Customs and Excise (Tariff) orders in the Government Gazette; no consolidated copy found. |
| Malaysia (MY) | Researched, not automatable (license pending) |  | [Royal Malaysian Customs Department (JKDM/RMCD) — Customs Duties Order 2025](https://www.customs.gov.my/images/06-prosedur/perintah-kastam/perintah/PUA_384.pdf) |
| Maldives (MV) | Researched, not automatable (no documented machine interface) |  | [Maldives Customs Service — National Tariff Schedule](https://www.customs.gov.mv/eServices/Tariff) |
| Mali (ML) | Connected (`ecowas_cet_uemoa_tec_2022`): ECOWAS common external tariff | UEMOA | Read automatically; its own exceptions: [Direction Générale des Douanes du Mali](https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf) — Applies the UEMOA edition of the ECOWAS CET. |
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
| Niger (NE) | Connected (`ecowas_cet_uemoa_tec_2022`): ECOWAS common external tariff | UEMOA | Read automatically; its own exceptions: [Direction Générale des Douanes du Niger](https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf) — Applies the UEMOA edition of the ECOWAS CET. |
| Nigeria (NG) | Connected (`ecowas_cet_uemoa_tec_2022`): ECOWAS common external tariff | ECOWAS | Read automatically; its own exceptions: [Nigeria Customs Service — Nigeria Customs Tariff / ECOWAS CET](https://customs.gov.ng/cet-tariff) |
| Niue (NU) | Agent reads it |  | [Niue Customs](https://paclii.org/nu/legis/consol_act/cta1982178) — Customs Tariff Act 1982. |
| North Korea (KP) | No official copy found online |  | None (comprehensive UN sanctions) — Excluded from Demand Discovery: comprehensive UN Security Council sanctions. |
| Northern Mariana Islands (MP) | Agent reads it |  | [CNMI Department of Finance, Division of Customs](https://www.finance.gov.mp/cus-import-requirements.php) — Outside the US customs territory; excise tax on imports under 4 CMC. |
| Norway (NO) | Connected (`no_tolletaten_customs_tariff`) |  | Read automatically |
| Oman (OM) | Connected (`om_rop_customs_tariff`) | GCC | Read automatically |
| Pakistan (PK) | Researched, not automatable (license pending) |  | [Pakistan Federal Board of Revenue — Pakistan Customs Tariff](https://www.fbr.gov.pk/categ/laws/144) |
| Palau (PW) | No official copy found online |  | Palau Bureau of Revenue and Taxation — The 2023 tax reform introduced a goods and services tax; the remaining import tax was not confirmed. |
| Panama (PA) | Researched, not automatable (source insufficient) |  | [Panama National Customs Authority — Interactive National Tariff](https://aranceles.ana.gob.pa/) |
| Papua New Guinea (PG) | Agent reads it |  | [Papua New Guinea Customs Service](https://customs.gov.pg/tev/tariff) — Online tariff; also the Customs Tariff Act 1990, HS 2022 edition. |
| Paraguay (PY) | Connected (`mercosur_tec_camex`): Mercosur common external tariff | MERCOSUR | Read automatically; its own exceptions: [Paraguay Ministry of Economy and Finance — National Tariff](https://economia.gov.py/index.php/paraguay-y-el-mundo/aranceles-la-importacion/arancel-nacional-vigente) |
| People's Republic of China (CN) | Connected (`cn_customs_tariff_2026`): its 2026 customs tariff, read without trade remedies |  | Read automatically; the lines left open: [People's Republic of China Ministry of Finance / General Administration of Customs — 2026 Customs Tariff](https://gss.mof.gov.cn/gzdt/zhengcefabu/202512/t20251231_3981044.htm) |
| Peru (PE) | Connected (`pe_sunat_customs_tariff`) |  | Read automatically |
| Philippines (PH) | Researched, not automatable (no documented machine interface) |  | [Philippine Tariff Commission — Philippine Tariff Finder (MFN, AIFTA and other FTA schedules, AHTN 2022)](https://finder.tariffcommission.gov.ph/about) |
| Poland (PL) | Connected (`eu_taric`) | EU | Read automatically |
| Portugal (PT) | Connected (`eu_taric`) | EU | Read automatically |
| Qatar (QA) | Connected (`qa_customs_integrated_tariff`) | GCC | Read automatically |
| Republic of the Congo (CG) | No official copy found online | CEMAC | Direction Générale des Douanes et Droits Indirects du Congo — CEMAC member; regional instruments are republished by the Secrétariat Général du Gouvernement (sgg.cg). |
| Republic of The Gambia (GM) | Connected (`ecowas_cet_uemoa_tec_2022`): ECOWAS common external tariff | ECOWAS | Read automatically; its own exceptions: [Gambia Revenue Authority](https://ecotis.ecowas.int/?p=24111) — Applies the ECOWAS CET; no national schedule found online. |
| Romania (RO) | Connected (`eu_taric`) | EU | Read automatically |
| Russian Federation (RU) | Connected (`eaeu_common_customs_tariff`): EAEU common customs tariff | EAEU | Read automatically; its own exceptions: [Kazakhstan Ministry of Finance / Open Data portal — EAEU nomenclature and Common Customs Tariff](https://data.egov.kz/datasets/view?index=euraziyalyk_ekonomikalyk_odakt) |
| Rwanda (RW) | Connected (`eac_common_external_tariff`): EAC common external tariff | EAC | Read automatically; its own exceptions: [Rwanda Revenue Authority / East African Community — CET national execution](https://www.rra.gov.rw/fileadmin/user_upload/COMMON_EXTERNAL_TARIFF__Updated_June_2025.pdf) |
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
| Senegal (SN) | Connected (`ecowas_cet_uemoa_tec_2022`): ECOWAS common external tariff | UEMOA | Read automatically; its own exceptions: [Senegal Directorate General of Customs — ECOWAS CET and national duties and taxes](https://www.douanes.sn/ndn71/) |
| Serbia (RS) | Researched, not automatable (individual investigation required) |  | [Customs Administration of Serbia — 2026 Customs Tariff regulation](https://www.carina.rs/privreda/tarifski-poslovi/carinska-tarifa/privreda_carinska_tarifa_opste.html) |
| Seychelles (SC) | Agent reads it |  | [Seychelles Revenue Commission](https://src.gov.sc/faq/) — Imports pay trades tax on listed goods (Trades Tax Regulations). |
| Sierra Leone (SL) | Connected (`ecowas_cet_uemoa_tec_2022`): ECOWAS common external tariff | ECOWAS | Read automatically; its own exceptions: [National Revenue Authority of Sierra Leone](https://ecotis.ecowas.int/?p=24111) — Applies the ECOWAS CET; national measures in the annual Finance Act. |
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
| Togo (TG) | Connected (`ecowas_cet_uemoa_tec_2022`): ECOWAS common external tariff | UEMOA | Read automatically; its own exceptions: [Office Togolais des Recettes](https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf) — Applies the UEMOA edition of the ECOWAS CET. |
| Tokelau (TK) | Agent reads it |  | [Government of Tokelau](https://paclii.org/tk/legis/num_act/cr1991233) — Customs Regulations 1991. |
| Tonga (TO) | Agent reads it |  | [Ministry of Revenue and Customs, Tonga](https://paclii.org/to/legis/consol_act/caeas286) — Customs and Excise Act; duty orders on PacLII. |
| Trinidad and Tobago (TT) | Researched, not automatable (source insufficient) | CARICOM | [Trinidad and Tobago Customs and Excise Division / Ministry of Finance — CET](https://tradeind.gov.tt/wp-content/uploads/2025/04/Legal-Notice-No.-218-Customs-Common-External-Tariff-Order-2024.pdf) |
| Tunisia (TN) | Connected (`tn_douane_tarifweb`) |  | Read automatically |
| Türkiye (TR) | Researched, not automatable (source insufficient) |  | [Republic of Türkiye Ministry of Trade — national GTİP tariff schedule](https://www.ticaret.gov.tr/ithalat/ithalat-mevzuati/ithalat-rejimi-karari-igv-karari-ve-ithalat-tebligleri/1-ithalat-rejimi-kararikarar-sayisi3350karar-metni-ve-tablolar-konsolide-edilmis-olup-gunceldir) |
| Turkmenistan (TM) | Agent reads it |  | [State Customs Service of Turkmenistan](https://customs.gov.tm/en/customs-info/customs-fees/excices) — Customs fees and excise pages; import duty schedule not found. |
| Turks and Caicos Islands (TC) | Agent reads it |  | [Turks and Caicos Islands Customs Department](https://customs.gov.tc/webuploads/currdoc/Frequently%20Asked%20Questions.pdf) — Customs FAQ with the general rates. |
| Tuvalu (TV) | No official copy found online |  | Tuvalu Customs — No official schedule found online. |
| Uganda (UG) | Connected (`eac_common_external_tariff`): EAC common external tariff | EAC | Read automatically; its own exceptions: [Uganda Revenue Authority / East African Community — CET national execution](https://ura.go.ug/en/download/common-external-tariff-2022-version/0/) |
| Ukraine (UA) | Researched, not automatable (source insufficient) |  | [State Customs Service of Ukraine — Rates of import and export duties](https://data.gov.ua/dataset/duty-rates) |
| United Arab Emirates (AE) | Connected (`gcc_unified_customs_tariff`): GCC common customs tariff, with India's CEPA rate | GCC | Read automatically; its own exceptions: [Dubai Customs / Dubai Pulse — Customs Agreements, Commodity and Tariff](https://www.dubaicustoms.gov.ae/en/PoliciesAndNotices/Documents/IntegratedCustomsTariffv4.pdf) |
| United Kingdom (GB) | Connected (`uk_tariff`) |  | Read automatically |
| United Republic of Tanzania (TZ) | Connected (`eac_common_external_tariff`): EAC common external tariff | EAC | Read automatically; its own exceptions: [Tanzania Revenue Authority / East African Community — CET national execution](https://www.eac.int/press-releases/142-customs/3544-eac-ministers-adopt-measures-to-strengthen-regional-trade-and-industrialization) |
| United States of America (US) | Connected (`us_hts`) |  | Read automatically |
| Uruguay (UY) | Connected (`mercosur_tec_camex`): Mercosur common external tariff | MERCOSUR | Read automatically; its own exceptions (licence pending): [Uruguay Ministry of Economy and Finance — National Tariff](https://www.gub.uy/ministerio-economia-finanzas/politicas-y-gestion/nomenclatura-aranceles-uruguay) |
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
  adapter, except where the automatic read can leave a duty open: Andorra's chapters 1–24, Singapore
  before its first nightly copy, a customs-union member's own exceptions, and the lines a tariff
  schedule leaves open).
- Customs unions: the EAC release must be renewed with each July Gazette (it states nothing after
  30 June 2027); a new UEMOA or EAEU edition is a new release with its own pins (§4a).
- Tariff schedules (§4b): China's release states nothing after 31 December 2026, so the 2027 tariff must
  be imported when the Customs Tariff Commission publishes it (late December); the CAMEX workbook
  changes with most months' Gecex resolutions, so Brazil's and Mercosur's releases are re-read when it
  is updated; a new GCC edition or CEPA schedule is a new release with its own pins.
