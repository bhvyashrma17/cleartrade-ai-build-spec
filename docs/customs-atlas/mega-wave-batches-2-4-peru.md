# Customs Atlas mega-wave: Peru source-gate decision

**Decision date:** 10 September 2026
**Disposition:** PASS — operational provider implemented
**Scope:** current national customs tariff for imports into Peru, including the agricultural price-band overlay; regulatory controls remain explicitly incomplete.

## Decision

Peru passes the source gate. SUNAT's official consolidated workbook contains 8,017 unique ten-digit national subheadings and includes the changes made by both 2022 amending decrees. MEF's current tariff page independently states that the current tariff plus amendments has 8,017 national subheadings. The identical count and the presence of all amendment-created codes reconcile the apparent conflict between SUNAT's incomplete change-log page and MEF's fuller legal index.

The source is reusable for Customs Atlas's limited purpose because Peru's Copyright Law excludes official legislative, administrative and judicial texts, official translations, and simple facts/data from copyright. ClearTrade retains the exact official bytes, cites SUNAT/MEF, preserves text and source provenance, and does not copy the website presentation, logos, software, or unvetted WCO material.

## Authority and current-state chain

| Dimension | Finding |
|---|---|
| Competent authorities | SUNAT publishes and administers the customs tariff; MEF makes tariff policy and publishes the controlling decrees. |
| Baseline | `D.S. 404-2021-EF`, Arancel de Aduanas 2022, effective 1 January 2022. The official PDF has 320 pages and 8,015 unique ten-digit codes. [1] |
| SUNAT executable consolidation | `Cap01-98-Descripcion.zip` contains one XLSX worksheet, `ARANCEL 2022`, with 8,017 tariff rows and the published general ad-valorem rate. [2] |
| Amendment 1 | `D.S. 163-2022-EF`, published 13 July 2022, adds national subheading `9811.00.00.00` for military material. It appears in SUNAT's change log and consolidated XLSX. [3][4] |
| Amendment 2 | `D.S. 194-2022-EF`, published in August 2022, creates the `0208.90.00.10` guinea-pig-meat subdivision and `0208.90.00.90` residual subdivision. It appears in MEF's legal index and the consolidated XLSX, but is absent from SUNAT's change-log page. [5][6] |
| September 2026 control | MEF states that the current Arancel 2022 and its modifications comprise 8,017 ten-digit national subheadings, with general rates of 0%, 6%, and 11% on CIF value. The workbook also contains one 4% postal chapter-98 line; the parser therefore accepts the observed set `{0,4,6,11}` and refuses every other scalar. [7] |
| Reconciliation | Baseline unique codes `8,015`; consolidated rows `8,017`; amendment-created `9811000000`, `0208900010`, and `0208900090` are all present. The split replaces one predecessor and adds one net line; the military code adds the other. Thus the workbook and MEF's current count reconcile to the same state. |

The provider does not pretend the SUNAT change-log page is exhaustive. Import validation uses the consolidated artifact, checks the MEF current-state count, and requires the three amendment-created codes. A future row-count or schema change fails the release import for review instead of silently dropping data.

## Tariff semantics

Peru uses ten-digit national subheadings built on eight-digit NANDINA and HS 2022. The workbook's `AD VALOREM` column is the general customs duty. It is kept separate from VAT/IGV, excise and other internal taxes, which are outside this provider's declared coverage.

The agricultural `Sistema de Franja de Precios` is a separate variable specific-duty mechanism under `D.S. 115-2001-EF`. SUNAT identifies 48 national subheadings for corn, sugar, rice and dairy. `D.S. 338-2025-EF` updates the customs tables through 31 December 2026. The current monthly decision at the investigation date is `RVM 016-2026-EF/15.01`, published 20 August 2026 from prices observed 1–31 July 2026: USD 0/TM corn, USD 64/TM sugar, USD 100/TM paddy rice, USD 142/TM milled rice, and USD 0/TM whole milk powder. [8][9][10]

The provider emits these as `additional_duty` records with `kind=specific`, currency USD and unit tonne. It never converts them to an ad-valorem equivalent. The raw evidence retains the governing decision, observation period, product group, cap metadata and conditional milk-content notes. A legal zero in the variable layer stays an observed zero measure; absence from the 48-code list does not imply absence of every other import control.

## India preference and rules of origin

Peru's official trade-agreement inventory lists its agreements in force and identifies India as a negotiation. There is no operative India concession schedule on 10 September 2026. [11] For an India-origin query the provider therefore records `not_applicable` and applies no preference. It does not construct a preferential rate or rules-of-origin qualification from the negotiation.

## Acquisition, integrity and refresh

The provider downloads the fixed official HTTPS SUNAT ZIP, enforces an 8 MiB ceiling, rejects empty/non-success responses, retries transient failures, and validates the exact archive, worksheet and column schema. It requires 8,017 unique ten-digit codes and all known amendment-created codes. Each accepted release is stored as immutable source bytes with SHA-256, reference/retrieval dates, parser/reader versions and an activation audit event. Reparse creates a new canonical evidence snapshot keyed by release and parser version.

The operational refresh check is: reacquire the SUNAT ZIP; compare checksum/schema/count; review SUNAT and MEF tariff-law indexes; update the active price-band resolution; import and activate only after those controls agree. The August resolution has no manufactured expiry date: a later monthly resolution supersedes it. `D.S. 338-2025-EF`'s table authority is recorded through 31 December 2026.

## Limits

`regulatory_coverage_complete=false`. The source proves the tariff and named price-band layer; it does not prove the complete set of licences, prohibitions, safeguards, anti-dumping measures, VAT or excise for a product. The snapshot therefore remains discovery-grade where those controls matter. Classification resolution is also explicit: an HS6 with materially different ten-digit children requires refinement.

## Sources

1. SUNAT, [Arancel de Aduanas 2022, D.S. 404-2021-EF (official PDF)](https://www.sunat.gob.pe/legislacion/procedim/normasadua/gja-04/ctrlCambios/anexos/Arancel_2022.pdf).
2. SUNAT, [Capítulos 01–98 consolidated description/rate ZIP](https://www.sunat.gob.pe/orientacionaduanera/aranceles/Cap01-98-Descripcion.zip).
3. SUNAT, [Arancel 2022 control de cambios](https://www.sunat.gob.pe/legislacion/procedim/normasadua/gja-04/ctrlCambios/index.htm).
4. MEF, [D.S. 163-2022-EF official publication](https://www.mef.gob.pe/es/por-instrumento/decreto-supremo/29655-decreto-supremo-n-163-2022-ef/file).
5. MEF, [Política arancelaria — normative index](https://www.mef.gob.pe/es/normatividad/por-temas/politica-arancelaria).
6. Peru government, [D.S. 194-2022-EF](https://www.gob.pe/institucion/mef/normas-legales/3378081-194-2022-ef).
7. MEF, [Información arancelaria — current composition and rates](https://www.mef.gob.pe/es/?id=287&option=com_content&view=article).
8. SUNAT, [Reglas generales para la aplicación del Arancel](https://www.sunat.gob.pe/orientacionaduanera/aranceles/reglasAplicacion.html).
9. Peru government, [D.S. 338-2025-EF](https://www.gob.pe/institucion/mef/normas-legales/7574373-338-2025-ef).
10. El Peruano, [RVM 016-2026-EF/15.01](https://busquedas.elperuano.pe/dispositivo/NL/2545338-1).
11. Peru Ministry of Foreign Trade and Tourism, [Acuerdos Comerciales del Perú](https://www.acuerdoscomerciales.gob.pe/).
12. Peru government, [Decreto Legislativo 822 — Ley sobre el Derecho de Autor](https://www.gob.pe/institucion/pcm/normas-legales/1670023-822); Art. 9 is also available in the [WIPO Lex consolidated text](https://wipolex-res.wipo.int/edocs/lexdocs/laws/es/pe/pe077es.html).
