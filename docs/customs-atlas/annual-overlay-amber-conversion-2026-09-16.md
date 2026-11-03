# Customs Atlas: annual base plus ordered tariff overlays

**Decision date:** 16 September 2026

**Starting checkpoint:** `54f99f9f7fc7a4ac5418ac9421a29a81c1f2a6de`

**Starting operational destinations:** 45

**Scope:** exactly 11 previously AMBER destinations; source qualification only
**Result:** **1 GREEN / 10 AMBER / 0 RED**. No provider, parser, staging ingestion or deployment was undertaken.

The test is a legally effective, date-replayable *tariff treatment*, not the existence of an HS
table. Publication and legal effective dates differ. A current-looking government guide is not
itself the law when it defers to Gazette instruments. An indexed instrument is not enough if
exhaustion, importer eligibility or a quantity balance changes the payable rate without a
reconstructible authoritative state. `GREEN` here qualifies a **source chain for implementation**;
the actual parser, exhaustive enumeration and reconciliation must still pass release gates before
activation. Research cut-off is 16 September 2026; ignore any subsequently dated entries displayed
by a live index. Ordinary permits may remain out of regulatory scope
(`regulatory_coverage_complete=false`), but a permit or named-importer condition that changes the
*rate* cannot be silently flattened into a universal rate.

## Decision ledger

| Destination | State | Baseline and official index/overlay route | Exact gate or disposition | India preference |
|---|---|---|---|---|
| Sri Lanka (`LK`) | **GREEN** | Customs [16 May 2026 97-chapter ZIP and preamble](https://www.customs.gov.lk/customs-tariff/import-tariff/) (PDFs in ZIP); [Ministry of Finance trade-policy Gazette register](https://www.treasury.gov.lk/si/web/trade-and-investment-policy-department-gazette/section/2026), [fiscal-policy register](https://www.treasury.gov.lk/web/fiscal-policy-department-gazette/section/2026), and [Government Printer extraordinary-Gazette index](https://documents.gov.lk/web/extra_gazettes). | A complete official baseline plus authoritative publication universe and specialized cross-check registers establish a defensible enumeration route. Every post-baseline Gazette item must be acquired and classified, including generic-titled entries; the Customs “Tariff Changes” widget is **not** the index. Legal Gazettes override the informational guide. | `OPERATIVE_PREFERENCE` (ISFTA column; origin proof required). |
| Kosovo (`XK`) | **AMBER** | Customs [TARIK 2026 downloads](https://dogana.rks-gov.net/CustomsFee/ProductLinks) (PDF) and [legislation register](https://dogana.rks-gov.net/law), including the Director-General acts register. | The DG register artifact could not be reliably acquired in this pass, and the public list did not establish a complete, current 2026 tariff-instruction chain or its relationship to TARIK. Indicative correlations do not amend law. | `UNKNOWN` |
| Serbia (`RS`) | **AMBER** | Customs [2026 tariff regulations](https://www.carina.rs/dokumenti/carinski-propisi/uredbe.html), [current notices](https://carina.rs/privreda/carinski-postupci/aktuelna-obavestenja-2.html), and [quota realization page](https://www.carina.rs/privreda/korisne-informacije/pregled-realizacije-kvota.html). | Cement/steel instruments switch to an additional 50% after quota exhaustion. The realization page points only to FTA quotas, not an authoritative timestamped steel/cement balance and exhaustion history. Instruments and allocation notices alone cannot replay the switch. | `UNKNOWN` |
| Thailand (`TH`) | **AMBER** | Customs [Integrated Tariff Database](https://itd.customs.go.th/igtf/viewerCont.do?param=en), [grouped reference files](https://www.customs.go.th/list_strc_download_with_document_group.php?ini_content=reference_files) and [dated ZIP/XLSX/PDF release directory](https://www.customs.go.th/list_strc_download_with_document.php?ini_content=reference_files&lang=en&left_menu=nmenu_esevice_006&order_by=co_last_update_datetime&show_search=1&sort_type=0). | Many official deltas are obtainable, but no controlling complete current base plus gap-free mapping of the release directory to every legally effective Ministry notification, precedence and replay was proved. The lookup itself defers to legal notifications. | `OPERATIVE_PREFERENCE` (AIFTA, conditional on origin). |
| Brunei (`BN`) | **AMBER** | RCED [BDTTC 2022, rate changes and selected 2026 notices](https://www.customs.gov.bn/ref-rced/) (downloadable documents). | The selected reference list does not certify a complete 2022–16 September 2026 amendment sequence or supply a current consolidated release. Exact missing releases/coverage must be resolved before parsing. | `OPERATIVE_PREFERENCE` (AIFTA, conditional on origin). |
| Bolivia (`BO`) | **AMBER** | Customs [annual tariff](https://portal.aduana.gob.bo/aduana7/content/arancel-aduanero-de-importaciones), [numbered circular register](https://aduana.gob.bo/NOR_circulares), and [Official Gazette](https://www.gacetaoficialdebolivia.gob.bo/) decrees. | Numerous temporary 2026 decrees have expiry dates, but the observed circular listing did not establish completeness through 16 September, the exact 2026 base artifact was not independently retrieved in this pass, and a clear commercial retention/normalization basis for the compiled tariff has not been established. | `UNKNOWN` |
| El Salvador (`SV`) | **AMBER** | [SIECA ACI/SAC baseline](https://www.sieca.int/producto/arancel-centroamericano-de-importacion/), Customs [2026 DACG quota disposition](https://sitio.aduana.gob.sv/wp-content/uploads/download-manager-files/DACG-002-2026-CONTINGENTES-ARANCELARIOS-EN-LOS-TLCS-2026.pdf) and [DACG index](https://sitio.aduana.gob.sv/wp-content/uploads/download-manager-files/INDICE-DACG-2026.pdf). | Quota activation/in- and out-of-quota rates are published, but a dated authoritative utilization/exhaustion history and full national override closure are not. SIECA compilation reuse terms for commercial normalization remain unconfirmed; national legal-text exclusion alone does not license SIECA presentation/database rights. | `UNKNOWN` |
| Tanzania (`TZ`) | **AMBER** | [EAC CET](https://www.eac.int/sectors/customs), [EAC Gazette archive](https://www.eac.int/documents?Itemid=297), plus national finance/customs instruments. | Partner-specific stays and manufacturer/quantity remissions cannot be read from CET alone; complete national overlay closure, including levies and Finance Act measures, is not proved. EAC [terms](https://www.eac.int/terms) require express written consent for commercial derivatives of portal material. | `UNKNOWN` |
| Uganda (`UG`) | **AMBER** | Same EAC CET and Gazette archive; the [4 September Gazette No. 25](https://www.eac.int/component/filery/?Itemid=297&controller=download&file=d80ca0c5-9daa-449f-873e-cf00046f01bd&name=EAC+Vol.+AT+1+NO.+25+SEPTEMBER+2026.pdf.pdf&task=download.file) contains numerous Uganda manufacturer/quantity remissions and corrigenda. | The current Gazette demonstrates changing conditional rates, not a closed national execution chain or consumption state. National overlays and the EAC commercial-use permission remain unresolved. | `UNKNOWN` |
| Rwanda (`RW`) | **AMBER** | Same EAC CET and Gazette archive; [RRA Gazette mirror](https://www.rra.gov.rw/en/customs-services/eac-gazette). | The local mirror did not cover the central July–September publications observed in this pass. Complete Rwanda-specific national overlays and EAC commercial-use permission remain unresolved. | `UNKNOWN` |
| Zambia (`ZM`) | **AMBER** | ZRA [January 2026 National Tariff Book](https://www.zra.org.zm/wp-content/uploads/2026/02/National-Tariff-Book-JANUARY-2026-1.pdf) (PDF) and [September wheat suspension](https://www.zra.org.zm/suspension-of-import-duty-on-wheat/). | No exhaustive 2026 statutory-instrument/customs-notice index was proved. Wheat SI 65/2026 applies 1–30 September only to specified importers/permit holders, demonstrating conditional scope; commercial reuse of the compilation also needs confirmation. | `UNKNOWN` |

`UNKNOWN` is deliberately not a claim that no India agreement exists. Do not auto-apply any
preference from Indian origin alone; keep MFN and conditional preference as separate evidence.

## Sri Lanka: qualified source chain and boundaries

The [Customs import-tariff page](https://www.customs.gov.lk/customs-tariff/import-tariff/)
identifies the complete 2026 ZIP as **16 May 2026**, although the separate
[downloads page](https://www.customs.gov.lk/downloads/) still labels a **1 April 2026** ZIP.
The [direct official ZIP](https://www.customs.gov.lk/wp-content/uploads/2026/06/Import%20Tariff%20Guide%2016.05.2026.zip)
is an HTTP 200, 35,346,358-byte `application/zip` with range support and a `Last-Modified` of
**9 June 2026** when checked on 16 September. That is a verifiable distribution timestamp,
**not proof of its first publication or of a legal 9 June effective date**. Use the 16 May edition
identity, direct URL, acquired bytes, content hash and per-chapter membership as the proposed
baseline; do not silently interchange the April and May editions. For replay before the known
distribution timestamp, reconstruct from the legal Gazette rather than pretending the June-hosted
file was knowable in May. A publication/upload date is not the legal effective date of every
contained rate. The guide's
[preamble](https://www.customs.gov.lk/wp-content/uploads/2026/05/Preamble%20intergrated.pdf)
explicitly defers to Acts and Gazette notifications and separates customs duty, SCL, PAL, CESS,
VAT, excise and SSCL. Its India column is only a *candidate* preference, not a grant without
rules-of-origin proof.

The [Ministry trade-policy 2026 register](https://www.treasury.gov.lk/si/web/trade-and-investment-policy-department-gazette/section/2026)
lists post-baseline Customs instruments **2488/69 (17 May), 2493/02 (15 June), and 2501/88
(14 August)**, while the Ministry's separate
[fiscal-policy register](https://www.treasury.gov.lk/web/fiscal-policy-department-gazette/section/2026)
covers other levy instruments. The [Government Printer index](https://documents.gov.lk/web/extra_gazettes)
is the broad publication universe, not just entries with “tariff” in their summaries. The
[Cabinet's May account](https://www.cabinetoffice.gov.lk/cab/index.php?Itemid=49&dID=13950&id=16&lang=en&option=com_content&view=article)
illustrates actual legal semantics: a 50% surcharge on the 30% customs-duty band for three
months from 16 May, with vehicle/letter-of-credit conditions and a subsequent 17 May order.
Represent it as a conditional additional-duty rule with its own effectivity, not as replacement
of the underlying 30% line. Gazette corrections, rescissions and expiries must be followed by
instrument reference, not assumed from publication order alone.

The reuse basis is narrow but concrete: Sri Lanka's
[Intellectual Property Act No. 36 of 2003, §8](https://www.nipo.gov.lk/web/images/pdf_downloads/Intellectual_Property_Act_No_36_of_2003.pdf)
excludes mere data and official legislative/administrative/legal text (and official translations)
from copyright protection. This supports normalization of rates and Gazette legal effects, **not**
a claim to copy Customs website design, proprietary software or a third-party database. Keep
official document provenance and do not republish the guide wholesale.

The future implementation must enumerate all Government Printer items from baseline publication
through the requested **publication-as-known-at** cut-off, inspect even generic descriptions,
cross-check the two Ministry registers and the Customs download versions, classify all
tariff-affecting measures, retain byte hashes and report any inaccessible/ambiguous item as an
unclosed release. Replay an effective date separately from the knowledge/publication cut-off;
backdated notices must not rewrite what was knowable earlier. This is a **qualification**, not a
claim that the entire Gazette has already been parsed or that ingestion passed.

## Specific AMBER evidence and next proof

- **Kosovo:** [Customs law register](https://dogana.rks-gov.net/law) identifies a DG acts
  register dated 22 October 2024 and import-quota administration instruction. Acquire that
  register from the official host without bypasses, enumerate the relevant 2026 instructions,
  and reconcile every amendment to the [TARIK release](https://dogana.rks-gov.net/CustomsFee/ProductLinks).
- **Serbia:** the [quota instruments](https://reg.pravno-informacioni-sistem.rs/api/viewdoc?doctype=reg&regactid=439959&uuid=ed8e09a0-d597-48db-af62-f6e1c216829b)
  and [amendment](https://reg.pravno-informacioni-sistem.rs/api/viewdoc?doctype=reg&regactid=440302&uuid=b0e0a0b9-1135-444a-a0fc-59119da0ca72)
  specify the after-exhaustion additional duty. Find an official, reproducible, timestamped
  opening/allocation/consumption/exhaustion record for those quotas, not merely the separate
  [FTA quota link](https://www.carina.rs/privreda/korisne-informacije/pregled-realizacije-kvota.html).
- **Thailand:** reconcile an immutable complete legal rate schedule to the
  [reference-file groups](https://www.customs.go.th/list_strc_download_with_document_group.php?ini_content=reference_files)
  and Ministry of Finance notifications; prove no release gaps, replacements or omitted categories.
- **Brunei:** obtain RCED confirmation or a complete indexed legal archive from the 2022 BDTTC
  through the latest [published notices](https://www.customs.gov.bn/ref-rced/), including effective
  and superseded instruments.
- **Bolivia:** prove the [circular register](https://aduana.gob.bo/NOR_circulares) and
  [Gaceta](https://www.gacetaoficialdebolivia.gob.bo/) cover every decree through the query
  date; obtain the exact annual file and a defensible commercial facts/legal-text retention basis.
  The circulars for DS 5516, 5518, 5543, 5547 and 5646 illustrate temporary, component-specific
  rates and expiries; circular numbering alone does not certify a closed date range.
- **El Salvador:** reconcile [SIECA ACI](https://www.sieca.int/producto/arancel-centroamericano-de-importacion/)
  and the national [2026 quota disposition](https://sitio.aduana.gob.sv/wp-content/uploads/download-manager-files/DACG-002-2026-CONTINGENTES-ARANCELARIOS-EN-LOS-TLCS-2026.pdf)
  against a dated official quota-state feed and all national DACG/bulletin overrides. The
  [government IP guidance](https://infotrade.economia.gob.sv/escritos-generales/propiedad-intelectual/)
  supports official legal-text exclusion, but does not resolve SIECA-specific rights.
- **Zambia:** an [SI 65/2026 wheat notice](https://www.zra.org.zm/suspension-of-import-duty-on-wheat/)
  gives a precise `SUSPEND`/`EXPIRE` example with named-importer eligibility. Find a complete
  ZRA/Gazette SI index and decide whether authoritative permit/eligibility state can be
  represented without implying that all importers receive the suspension.

## EAC family: one base, three different executions

The EAC CET is a shared nomenclature/rate base; it is not an operational country release. The
[central EAC document archive](https://www.eac.int/documents?Itemid=297) lists 2026 Gazettes,
including 31 July, 5 August and two on 4 September. Gazette **Vol. AT 1 No. 25 of 4 September**
contains Uganda company- and quantity-specific duty remissions through June 2027, plus
corrigenda to July notices that add Tanzania inputs. Notices have legal-notice IDs, HS codes,
named beneficiary, rate, quantity, conditions and sometimes an expiry. A company-specific
remission must not overwrite the universal CET rate; quantity exhaustion requires a separately
provable state or an explicitly conditional result. Tanzania, Uganda and Rwanda each need
their own stays, remissions, national Finance Act/levy and Gazette overlay manifest. The
[RRA mirror](https://www.rra.gov.rw/en/customs-services/eac-gazette) cannot replace the more
recent central archive without reconciliation.

Most importantly, the [EAC terms of use](https://www.eac.int/terms) say the EAC Gazette is
authentic for legal effects, but portal materials may be copied for personal/non-commercial
use and commercial derivatives/redistribution need **express written consent**. No such consent
was found. Treat this as a family-wide gating issue, not three independent GREENs. A shared
acquirer/Gazette identity layer would have high leverage once rights and national closure are
resolved; no country in this cluster is implementation-ready today.

## Recommended `AnnualTariffOverlayManifest` (design only)

One immutable manifest per destination and source-release cut-off, referencing content-addressed
artifacts. It records **both** legal time and knowledge time so a historical effective-date
query never silently uses a later-published correction:

```text
manifest_id, country_iso2, jurisdiction, authority, source_family,
baseline { artifact_uri, official_release_id, publication_date,
           effective_from, effective_until?, media_type, sha256,
           member_hashes?, coverage_assertion, rights_basis_uri },
source_indexes [{ authority, index_uri, observed_at, cutoff_publication_date,
                  enumeration_count, enumeration_hash, pagination_complete }],
overlays [{ instrument_id, parent_instrument_id?, amendment_of?,
            authority, artifact_uri, sha256, publication_date,
            effective_from, effective_until?, operation, component,
            affected_codes, origin_scope?, beneficiary_scope?,
            quantity_or_quota_id?, conditions, priority_basis,
            supersedes_ids, correction_of?, legal_text_locator }],
state_inputs [{ quota_id, authority, snapshot_uri, as_of, sha256,
                opening_amount, allocated, consumed, remaining }],
closure { enumerated_through, knowledge_cutoff, exclusions_with_reason,
          unresolved_instruments, rights_status, reviewer, reviewed_at }
```

The common layer acquires, hashes, versions, deduplicates, orders and replays immutable evidence.
Country adapters interpret legal scope and precedence. `ADD`, `REPLACE`, `SUSPEND`, `EXPIRE`,
`QUOTA_OVERRIDE`, `ADDITIONAL_DUTY`, `REMEDY`, `REMISSION` and `CORRECTION` are candidate typed
operations, **not** an invented universal legal hierarchy. Apply explicit legal cross-references,
scope and effective intervals before deterministic tie-breaks; publication order is not a
substitute for statutory precedence. Preserve component separation (customs duty versus surcharge,
SCL, CESS, etc.), rate formula/unit, origin and importer/beneficiary conditions. Quota consumption
is an event/state input, not an amendment to the annual schedule. Fail closed on missing index
pages, unacquired instruments, overlapping rules without established precedence, absent quota
state, uncertain rights or inconsistent hashes. Store the source and review status with each
computed result; never present a conditional rate as unconditionally payable.

## Next wave and count

**Only Sri Lanka is GREEN.** A 3–6-destination implementation batch cannot be honestly assembled
from this exact cohort. The next eligible batch is **Sri Lanka alone**, or defer the batch until
at least two more countries clear their individual gates; do not add AMBERs merely to hit the
target. If a later Sri Lanka implementation passes exhaustive Gazette reconciliation, real-file
parsing, semantic and release tests and is activated, the possible operational count is
**45 → 46**. This research sprint itself changes the count by **zero: 45 → 45**. Production was
not accessed or changed.
