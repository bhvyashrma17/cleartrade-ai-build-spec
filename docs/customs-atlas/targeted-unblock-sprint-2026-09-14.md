# Customs Atlas targeted unblock sprint — eight near-pass destinations

**Decision date:** 14 September 2026

**Starting checkpoint:** `df52e168eebd37a9d0f30adfa666753a94bc55d9`

**Scope:** Iceland, Serbia, Kosovo, Oman, Bahrain, Chile, Switzerland, Türkiye

**Result:** 8/8 re-investigated; Iceland activated; seven precise blockers retained; operational coverage 39 → 40.

**Environment:** research and local validation only at this point in the record; production was not accessed or changed.

This is an evidence-gate record, not a substitute for the retained source artifacts. `PASS` means
the gate is satisfied for the provider scope that is actually published. `PARTIAL` means the source
supports a narrower, explicit answer (for example tariff but not complete regulation) and the
provider must publish the gap rather than a zero. `BLOCK` prevents activation.

## Outcome

Iceland's prior `license_pending` classification was wrong. Skatturinn's own fixed-width layout says
the text file may be used in customs-declaration software and similar uses; its software guide
independently describes the file as available for free use in declaration and import-duty software.[1]
The 1 September 2026 ZIP is effective-dated, archived by the authority and byte-stable across two
live acquisitions. Its five fixed-width record types separately encode duties, fees, permits,
prohibitions and quantity units.[2] The authority's India notice maps `YX` to EFTA–India TEPA from
1 October 2025 and requires originating status, direct transport and proof of origin.[3]

The implemented composite retains the tariff-key ZIP, canonical authority-authored article fragments
from the release and India-notice pages, two schema documents, known-
deviations document, controlling printed tariff, India-TEPA notice and software-use guide. The live
qualified file contains 29,671 physical records and 9,442 declarable tariff lines. Three lines have
no `A` record and remain explicitly missing, not zero. Known manual/quantity-dependent quota
reductions remain outside the key file, so `regulatory_coverage_complete=false` even when tariff
evidence resolves.

## Twenty-gate disposition

| # | Gate | Iceland | Serbia | Kosovo | Oman | Bahrain | Chile | Switzerland | Türkiye |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | Competent authority | PASS — Skatturinn | PASS — Customs Administration | PASS — Kosovo Customs | PASS — ROP Customs | PASS — MOI Customs Affairs | PASS — SNA | PASS — BAZG/FOCBS | PASS — Ministry of Trade |
| 2 | Current executable tariff | PASS — dated keys | PASS — consolidated 107/25+45/26 PDF | PARTIAL — 01 Jan TARIK; later acts control | PASS source — 2026 PDF, but not parsed | BLOCK — e-copy not acquired | BLOCK — newest consolidated workbook page says 2023 | PARTIAL — Tares live, no complete export | PARTIAL — GTİP Excel is nomenclature; executable import regime separate |
| 3 | Deterministic acquisition | PASS — static dated ZIP and archive | PASS for baseline PDF | PASS for baseline PDF | PASS for 315-page PDF | BLOCK — authenticated three-day fulfilment | PASS for published workbooks, not current state | BLOCK — no documented complete Tares delivery contract | PASS per artifact; BLOCK for complete joined pack |
| 4 | Reuse/commercial basis | PASS — artifact-specific software-use grant | PASS lead — official materials excluded | BLOCK — current 08/L-205 effect on compilation unresolved | PASS for facts/official documents under art. 4 | BLOCK — paid artifact terms not disclosed; OGD licence not attached | BLOCK — facts excluded, workbook compilation reuse unresolved | PASS for official enactments under CopA art. 5 | PASS for official instruments under Law 5846 art. 31 |
| 5 | Sep 2026 currentness | PASS — 01 Sep 2026 | PARTIAL — baseline consolidated May; independent notices continue | BLOCK — no complete post-01-Jan act reconciliation | PARTIAL — 2026 PDF generated May; active lookup can move | BLOCK — release unobserved | BLOCK — no 2026 consolidation | PASS for live Tares, not a retained pack | PARTIAL — amendments through 11 Jul found; completeness not proven |
| 6 | Amendment/refresh | PASS — dated archive and release notices | BLOCK — no exhaustive overlay manifest | BLOCK — regular administrative instructions, no exhaustive 2026 index | BLOCK — PDF/lookups not joined by a history contract | BLOCK — update mechanism unobserved | BLOCK — no exhaustive decree manifest | BLOCK — regular Excel deliveries described, full revision identity absent | BLOCK — separate baseline and multiple amendment indexes not joined |
| 7 | National execution | PASS — Iceland national keys | PASS baseline | PASS baseline | PASS baseline | BLOCK — GCC text is not Bahrain execution | PASS baseline only | PASS via Tares | PASS only when national regime layers are joined |
| 8 | Exceptions/overlays | PARTIAL — published codes parsed; documented manual quota gap disclosed | BLOCK — quotas/excise/VAT/controls separate | BLOCK — later instructions not reconciled | BLOCK — protection fees/permits/antidumping separate | BLOCK — bytes and Bahrain overlays unknown | BLOCK — later decrees/overlays not consolidated | BLOCK — agricultural components/quotas/restrictions lack complete export | BLOCK — additional duty/funds/financial liabilities separate |
| 9 | Tariff-code semantics | PASS — 8-digit declarable lines, HS6 fans out | BLOCK pending PDF parser/note hierarchy | BLOCK pending 9th/10th-digit parser | BLOCK pending 12-digit PDF parser | BLOCK schema unseen | BLOCK current parser absent | BLOCK complete Tares schema absent | PARTIAL — 12-digit GTİP workbook; rate joins absent |
| 10 | Ad-valorem | PASS — hundredths preserved | BLOCK parser not qualified | BLOCK parser not qualified | BLOCK parser not qualified | BLOCK schema unseen | BLOCK current parser absent | BLOCK complete parser absent | BLOCK import-regime parser absent |
| 11 | Specific duty | PASS — ISK and base unit retained | BLOCK | BLOCK | BLOCK | BLOCK | BLOCK | BLOCK — important CHF/100kg semantics | BLOCK |
| 12 | Mixed/compound/min/max | PASS — percentage + ISK preserved, no AVE | BLOCK | BLOCK | BLOCK | BLOCK | BLOCK | BLOCK | BLOCK |
| 13 | Other customs measures separate | PASS — fee/control records never become tariff | BLOCK overlay manifest | BLOCK legal overlay chain | BLOCK external protection/permit layers | BLOCK | BLOCK | BLOCK | BLOCK |
| 14 | India preference status | PASS — `YX` is India TEPA; absence is observed only per resolved line | PASS no preference asserted; authoritative complete negative not established | PASS unknown | PASS — CEPA categories exist | PASS unknown | PASS — operative partial-scope agreement | PASS — TEPA replaced GSP | PASS — no operative India agreement found in official inventories, but must be bound to complete regime |
| 15 | Exact concession schedule | PASS — line-level `YX` values in keys | BLOCK/not found | BLOCK/not found | PASS source exists as line category, parser absent | BLOCK | PASS source exists at SUBREI, not bound to current tariff | PASS source exists in TEPA/Tares, bulk join absent | Not applicable only after complete negative enumeration |
| 16 | Rules of origin | PASS semantics — qualification always requires shipment proof | BLOCK/not applicable unresolved | BLOCK | PASS source — origin proof/direct transport; parser absent | BLOCK | PASS source — product rules and certificate; join absent | PASS source — current proof guidance; join absent | No preference asserted; complete negative still tied to gate 14 |
| 17 | Effective dates | PASS — release date and TEPA 01 Oct 2025 | BLOCK overlay precedence | BLOCK amendments | BLOCK category staging/overlays not encoded | BLOCK | BLOCK amendments | BLOCK components/quotas | BLOCK multiple 2026 decisions |
| 18 | Provenance/checksums | PASS — per-file SHA-256 and bundle checksum | Feasible, not implemented | Feasible, not implemented | Feasible, not implemented | BLOCK bytes absent | Feasible for stale workbooks only | BLOCK complete bytes absent | Feasible per artifact; complete pack absent |
| 19 | Historical replay | PASS — immutable AuthorityRelease and version dispatch | BLOCK | BLOCK | BLOCK | BLOCK | BLOCK | BLOCK | BLOCK |
| 20 | Failure semantics | PASS — malformed/outage/missing/release-version fail closed | Existing structured blocker | Existing structured blocker | Existing structured blocker | Existing structured blocker | Existing structured blocker | Existing structured blocker | Existing structured blocker |

## Final blockers

- **Serbia — `individual_investigation_required`.** The official integral tariff is reproducible and
  official-text rights are not the blocker. Customs publishes quota, excise, VAT, phytosanitary,
  control and temporary-rate notices independently.[4] Unblock with an exhaustive September 2026
  overlay manifest and a real-file PDF table/note parser proving rate and effective-date precedence.
- **Kosovo — `individual_investigation_required`.** TARIK is stable and national, but it says current
  legal texts control and regular Director-General instructions amend it.[5] Unblock with an
  exhaustive 2026 instruction chain, authoritative current-law reuse treatment for the compilation,
  and a qualified parser. The correlation table remains non-legal.
- **Oman — `individual_investigation_required`.** Rights, official tariff, CEPA categories and RoO
  leads are cleared; the remaining gap is engineering plus completeness. The official PDF is 315
  pages with 12-digit rows and India A/B/C/E/X categories, while protection fees, permits and live
  configuration are separate.[6] Unblock with a deterministic table parser and exhaustive dated
  overlay manifest.
- **Bahrain — `bulk_distribution_only`.** The authority charges BHD 3 and fulfils an Ofoq 2 e-copy
  request in three working days.[7] No eligible account purchase, bytes or purchase licence were
  available, and Bahrain's OGD licence is not identified on that artifact. Acquire it and preserve
  the terms before schema, overlay, India and replay qualification.
- **Chile — `license_pending`.** SUBREI clears agreement/RoO existence, but SNA's current-tariff page
  still exposes a 2023 consolidated workbook and no complete September 2026 amendment chain.[8]
  Chilean law excludes underlying data from compilation copyright, not necessarily the workbook's
  selection/presentation.[9] Unblock both current national execution and compilation reuse.
- **Switzerland — `source_insufficient`.** CopA article 5 overturns the blanket rights blocker, BAZG
  advertises regularly updated free Excel deliveries, and TEPA/RoO sources are current.[10] No
  documented complete bulk Tares pack was found for normal/preferential rates, agricultural
  components, quotas and restrictions. A complete schema/revision contract is the unblock.
- **Türkiye — `source_insufficient`.** Article 31 overturns the website-footer rights hypothesis and
  the 2026 GTİP Excel is official.[11] It does not contain the complete executable regime: the
  Ministry separately indexes the baseline, six 2026 import-regime amendments, additional customs
  duties and other financial liabilities.[12] Unblock with a complete joined manifest and parser.

## Live Iceland controls

| Control | Observed value |
|---|---|
| Tariff-key ZIP SHA-256 | `fc664a01b46622ab282e1c37935d163a193d6fd6df4e0f42c1be051518e6f48f` |
| Composite SHA-256 | `2b130a97c44e7ef6cbdcfa181867894681acd44abfad187eff70fd907e3e6995` |
| Composite bytes | 3,544,937 |
| Declarable lines | 9,442 |
| Physical records | 29,671 (`1`: 9,442; `2`: 2,625; `3`: 218; `4`: 9,442; `5`: 7,944) |
| Reacquisition | Two consecutive live downloads were byte-identical |
| HTML normalization | Request-specific CMS chrome is excluded; authority-authored article fragments are retained |
| Canary semantics | `610910`: legal zero + `YX` requiring origin proof; `020110`: 30% + ISK 357/kg compound; `100630`: two equivalent national children |

## Sources

1. [Skatturinn fixed-width layout and permitted software use](https://www.skatturinn.is/media/annad/Tollskrarlyklar_INNFL_Faerslulysing_01_03_2013.pdf); [software guide](https://www.skatturinn.is/media/annad/SAD_SMT_Tollskyrsluforrit-innfl-villuprof.pdf).
2. [Skatturinn tariff-key releases and archive](https://www.skatturinn.is/fagadilar/tollamal/hugbunadarhus/tollskrarlyklar/); [known deviations](https://www.skatturinn.is/media/annad/tollskrarlyklar_fyrirvarar_fravik.pdf); [controlling printed tariff](https://www.skatturinn.is/atvinnurekstur/tollamal/tollskra/prentvaenar-utgafur/).
3. [Skatturinn EFTA–India activation notice](https://www.skatturinn.is/fagadilar/tollamal/hugbunadarhus/tilkynningar-til-hugbunadarhusa/tollskrarlyklar-med-gildistoku-1.-oktober-2025-friverslunarsamningur-vid-indland-og-fleira); [EFTA entry-into-force communiqué](https://www.efta.int/media-resources/news/efta-india-trade-and-economic-partnership-agreement-enters-force-joint).
4. [Serbian Customs 2026 consolidated tariff](https://www.carina.rs/privreda/tarifski-poslovi/carinska-tarifa/privreda_carinska_tarifa_opste.html); [implementing notices](https://www.carina.rs/dokumenti/carinski-propisi/objasnjenjaupravecarina.html).
5. [Kosovo TARIK 2026](https://dogana.rks-gov.net/sharedfolder/ProductFiles/2026_488f89e7-9610-4161-b671-3e11c747d458.pdf); [current copyright law record](https://gzk.rks-gov.net/ActDocumentDetail.aspx?ActID=83132).
6. [Oman Customs Tariff 2026](https://www.customs.gov.om/en/user-guides/); [India–Oman CEPA customs page](https://www.customs.gov.om/ar/agreements/cepa/); [Oman Copyright Law, article 4](https://qanoon.om/p/2008/l2008065/); [requirements search](https://www.customs.gov.om/en/search-import-and-export-requirements/).
7. [Bahrain official e-copy service](https://www.bahrain.bh/wps/portal/en/BNP/ServicesCatalogue/GSX-UI-PServiceDetails?psID=1322); [Bahrain Open Government Data Licence](https://www.bahrain.bh/wps/wcm/connect/0d8e85f5-f34a-4e2c-bcba-e75debbe32c9/Open%2BData%2BLicense%2B%D8%B1%D8%AE%D8%B5%D8%A9%2B%D8%A7%D9%84%D8%A8%D9%8A%D8%A7%D9%86%D8%A7%D8%AA%2B%D8%A7%D9%84%D9%85%D9%81%D8%AA%D9%88%D8%AD%D8%A9.pdf?CVID=pxw8t4P&MOD=AJPERES).
8. [Chile SNA current tariff page](https://www.aduana.cl/arancel-aduanero-vigente/aduana/2016-12-30/090118.html); [SUBREI Chile–India agreement and annexes](https://www.subrei.gob.cl/acuerdos-comerciales/acuerdos-comerciales-vigentes/india).
9. [Chile Intellectual Property Law 17,336](https://www.bcn.cl/leychile/navegar?idNorma=28933).
10. [Swiss Copyright Act, article 5](https://www.fedlex.admin.ch/eli/cc/1993/1798_1798_1798/en?version=20250701); [BAZG free data deliveries](https://www.bazg.admin.ch/en/tares-free-data-delivery-on-customers-request); [BAZG EFTA–India implementation](https://www.bazg.admin.ch/de/inkraftsetzung-handels-und-wirtschaftspartnerschaftsabkommen-efta-indien); [Swiss TEPA concession schedule](https://www.efta.int/sites/default/files/documents/legal-texts/free-trade-relations/india/2.F%20-%20CH%20Schedule%20of%20Tariff%20Commitments%20on%20Goods%20to%20IN.pdf).
11. [Türkiye Copyright Law 5846](https://telifhaklari.ktb.gov.tr/Eklenti/106879%2Cfikir-ve-sanat-eserleri-kanunupdf.pdf?0=); [official 2026 GTİP Excel publication](https://ggm.ticaret.gov.tr/duyurular/istatistik-pozisyonlarina-bolunmus-turk-gumruk-tarife-cetveli-karar-sayisi-10781-yayimlanmistir).
12. [Türkiye 2026 import-regime amendment index](https://www.ticaret.gov.tr/ithalat/ithalat-mevzuati/ithalat-rejimi-karari-igv-karari-ve-ithalat-tebligleri/1-1-ithalat-rejimi-kararinda-degisiklik-yapilmasina-iliskin-kararlar-2026-yili); [Decision 10790 baseline](https://ithalat.ticaret.gov.tr/duyurular/ithalat-rejimi-kararinda-degisiklik-yapilmasina-iliskin-karar-karar-sayisi10790).
