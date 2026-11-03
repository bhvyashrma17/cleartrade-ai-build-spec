# Customs Atlas amber rescue triage — 20 September 2026

This is the bounded follow-up to the 74-destination harvest dated 15 September. It does not
reclassify a country from inference, a regional schedule, or an informational lookup. A source is
`GREEN_NOW` only when the current national tariff, tariff-affecting overlays, authenticated
acquisition, effective date and a defensible reuse basis are all closed.

**Selected:** 10 destinations. **GREEN_NOW:** 0. **REMAINS_AMBER:** 10. **RED_NOW:** 0.

Because fewer than two destinations cleared, no new provider batch is justified by this pass.

## Priority rescues

| Rank | Destination | Result | Focused primary-source finding | Exact remaining blocker |
|---:|---|---|---|---|
| 1 | Montenegro (`ME`) | `REMAINS_AMBER` | The [enacted 2026 regulation](https://www.gov.me/en/documents/c9ad2bc2-dfc4-4107-9fea-585c792b81af) now downloads over verified TLS from Government WAPI. The retained file is 35,508 bytes, four pages and SHA-256 `444d1d2f3f2cf1f6e98a87d08d51c6a7affd11871f1f7b8b75af724addd2edcb`. It names Annex I and appendices 1–4 but contains only their headings. The [Government proposal](https://www.gov.me/en/documents/7da4dc6c-49b9-4909-962e-e316c90a6000) is 727 pages and contains rows, but is explicitly a proposal. | Stable acquisition is no longer the blocker. The executable *enacted* Annex I and appendices are absent, and there is no official identity/equivalence proof permitting the proposal annex to stand in for the final legal artifact. TARICG has no supported export/history contract. |
| 2 | North Macedonia (`MK`) | `REMAINS_AMBER` | The Customs [2026 tariff index](https://customs.gov.mk/zakon-za-carinska-tarifa.nspx) still fails strict TLS verification because the certificate is expired; verification was not disabled. Search-visible index metadata identifies Official Gazette 261/25 and both correlation workbooks. The Ministry of Finance separately confirms a [tariff-changing law effective 1 July 2026](https://finance.gov.mk/en-GB/odnosi-so-javnost/novosti/mf-od-1-juli-2026-godina-se-vrsi-dopolnitelno-namaluvanje-i-celosno-usoglasuvanje-na-carinskite-stapki-so-eu-za-70-stoki-koi-kako-surovini-i-repromaterijali-se-koristat-vo-domasnata-industrija) for 70 goods. | No authenticated official alternative was found for the annual archive, and no secure line-level artifact was found for the July amendment. Both are required for a current executable release. |

## Ranked amber pass

| Rank | Destination | Result | Why it ranked here | Focused finding and blocker |
|---:|---|---|---|---|
| 3 | Bangladesh (`BD`) | `REMAINS_AMBER` | Static national tariff and indexed SROs; strong India relevance. | Customs publishes a [FY 2026/27 operative tariff](https://customs.gov.bd/content.jsf) and NBR publishes the [2026 Customs SRO register](https://nbr.gov.bd/regulations/sros/customs-sros/34/eng), including duty-changing and minimum/tariff-value instruments. Acquisition looks deterministic, but no licence or primary-law exclusion was tied to commercial normalization of the Customs compilation. Reuse remains unclosed; the SRO set also requires an ordered overlay manifest rather than a base-only parser. |
| 4 | Pakistan (`PK`) | `REMAINS_AMBER` | Deterministic official annual artifacts; high India relevance. | FBR publishes the [FY 2026/27 tariff and Fifth Schedule](https://www.fbr.gov.pk/categ/laws/144) plus an [active import-SRO register](https://www.fbr.gov.pk/Activesrosimport) that includes separate additional duty, regulatory duty and vehicle regulatory duty. This is not a clean annual table: the active SROs are additional tariff liabilities and FBR terms still require written commercial-reuse clearance. |
| 5 | Brunei (`BN`) | `REMAINS_AMBER` | Small official PDF-table candidate with AIFTA relevance. | RCED's [reference page](https://www.customs.gov.bn/ref-rced/) lists BDTTC 2022, 2023 duty changes and two 2026 classification/tariff notices, but the page does not certify a complete, supersession-aware 2022–current legal sequence or publish a current consolidated tariff. Absence from the curated list cannot be treated as no amendment. |
| 6 | Trinidad and Tobago (`TT`) | `REMAINS_AMBER` | Official CET documents and a bounded notice family. | Customs' [notices-to-importers register](https://www.customs.gov.tt/importing/notices-to-importers) exposes the 2024 CET Order and later suspension/variation notices, but the focused fetch returned a gateway failure and indexed results stop at 2025. There is no proved exhaustive, authenticated through-20-September-2026 replay. |
| 7 | Bolivia (`BO`) | `REMAINS_AMBER` | Annual national tariff plus numbered circulars. | Both the Customs [annual tariff page](https://portal.aduana.gob.bo/aduana7/content/arancel-aduanero-de-importaciones) and [circular register](https://aduana.gob.bo/NOR_circulares) timed out in the focused pass. More importantly, temporary 2026 suspensions and component-specific decrees still require a complete ordered manifest with expiry semantics, and commercial normalization rights remain unproved. |
| 8 | Thailand (`TH`) | `REMAINS_AMBER` | Existing delta/table mechanics and operative AIFTA preference. | Customs' [reference-file directory](https://www.customs.go.th/list_strc_download_with_document.php?ini_content=reference_files&lang=en&left_menu=nmenu_esevice_006&order_by=co_last_update_datetime&show_search=1&sort_type=0) is active and was publishing tariff deltas through 17 September 2026. It remains a large mutable delta stream, not an authenticated complete base plus gap-free legal-notification replay; the lookup defers to legal notifications. |
| 9 | Brazil (`BR`) | `REMAINS_AMBER` | Excellent structured national tables and explicit current consolidation. | CAMEX publishes an [updated workbook covering tariff annexes I–X](https://www.gov.br/mdic/pt-br/assuntos/camex/se-camex/strat/tarifas/vigentes) and a [consolidated tariff panel](https://www.gov.br/mdic/pt-br/assuntos/camex/360/painel-tarifario), but the panel is expressly consultative and non-binding. Full treatment also requires quotas, product-level Ex-tarifários, preferences and changing trade remedies; no one deterministic, authoritative bulk contract closing all of them was found. |
| 10 | China (`CN`) | `REMAINS_AMBER` | Official annual XLSX/PDF sources and a potential structured-table reader. | The national rules expressly distinguish MFN, conventional/preferential, temporary, tariff-quota, anti-dumping, countervailing and safeguard rates. The focused pass found no complete deterministic official bulk join for those active layers. A base tariff alone would falsely imply treatment completeness. |

## Decision

No destination met the source gate, so this run must retain all ten as unconfigured and must not
create a speculative provider abstraction. The next most promising bounded checks are:

1. Montenegro: obtain the enacted Annex I/appendices or official equivalence proof.
2. Bangladesh: obtain a primary reuse determination, then scope the annual SRO overlay manifest.
3. Brunei: obtain RCED confirmation of a complete consolidated or supersession-aware legal archive.
4. Brazil: identify an authoritative, documented bulk contract that closes current national
   exceptions, quotas and remedies rather than relying on the non-binding dashboard.

