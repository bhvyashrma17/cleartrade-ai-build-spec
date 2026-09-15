# Oman Customs Atlas — final qualification

**Decision date:** 14 September 2026

**Starting checkpoint:** `4cb403c87cca538350dfb7db3942688c72645bce`

**Destination:** Oman (`OM`)

**Authority family:** Royal Oman Police, Directorate General of Customs

**External release identifier:** `2026-09-14` (the acquisition-date snapshot key, not an
`AuthorityRelease` database id)

## Determination

The Oman authority pack is qualified for tariff treatment, the retained additional-customs-measure
column, the current ceramic-tile anti-dumping measure, and the Oman–India CEPA tariff schedule. It
is intentionally **not** represented as complete regulatory coverage. Oman Customs publishes a
live import/export-requirements lookup separately, and this implementation does not pretend that an
absent retained requirement means no restriction.[1]

Activation passed the operational evidence gate against the isolated Railway staging environment:
distinct staging database/direct-database/storage identities, successful web and worker deployments,
a real authority import, immutable snapshot persistence, an actual worker attempt, semantic
canaries, and the complete local validation gate. Production remained outside the scope of this
qualification.

## Authority and artifact chain

The composite is built only from the reviewed public sources below. Every retained artifact has a
SHA-256 entry in `acquisition.json`; the composite is a deterministic ZIP with stable member order,
timestamps, normalized retained HTML/text, and deterministic coordinate-parser output.

| Retained artifact | Authority role | Qualification use |
|---|---|---|
| `customs-tariff-2026.pdf` | Oman Customs consolidated 2026 tariff | 12-digit tariff lines, descriptions, general duty, additional duty, India category |
| `anti-dumping-current.pdf` | Oman Customs current national ceramic remedy schedule | Current company/rate cross-check and national execution |
| `gcc-anti-dumping-extension-55.pdf` | GCC Technical Secretariat Official Gazette 55 | Continuation, `% CIF` basis, producer/exporter rate schedule |
| `anti-dumping-tiles.xlsx` | Oman Customs legacy national workbook | Historical cross-check only; it does not override the current sources |
| `user-guides.html` | Oman Customs tariff/customs-fee index | Current authority context retained without CMS chrome |
| `india-cepa.html` | Oman Customs CEPA page | Entry into force, proof/transit/verification context |
| `india-cepa-rules-of-origin.pdf` | India Ministry of Commerce, agreement chapter 3 | Rules-of-origin process and documentary requirements |
| `india-cepa-product-specific-rules.pdf` | India Ministry of Commerce, annex 3B | Product-specific origin-rule authority |
| `copyright-law-article-4.txt` | WIPO Lex reproduction of Oman Copyright Law article 4 | Artifact-specific reuse analysis |
| `normalized-lines.json` | ClearTrade deterministic parser output | Replayable normalized tariff rows; never an independent authority |

Oman Customs publishes the 2026 tariff and related national material through its user-guides
surface.[2] The GCC Technical Secretariat publishes the trade-remedy decisions and investigations
that supply the controlling continuation instrument.[3] Oman Customs' CEPA page records Royal
Decree 30/2026 and entry into force on 1 June 2026, while the Indian Ministry of Commerce publishes
the agreement's origin chapter and product-specific-rule annex.[4]

## Deterministic acquisition and parser qualification

The authority's 18.3 MB tariff PDF repeatedly stalled when fetched as one long response in the
Node runtime. The acquisition client therefore uses validated 1 MiB HTTPS range requests for that
artifact: every response must carry the exact requested `Content-Range`, the total length must stay
fixed, an observed ETag must stay fixed, TLS verification remains enabled, retries are bounded, and
the reconstructed file must have the qualified hash. The other artifacts use bounded sequential
downloads because concurrent Oman Customs response bodies were observably less reliable. A missing,
timed-out, malformed, moved, or semantically changed source fails the acquisition; no such failure
is converted to a zero duty.

The coordinate parser reads pages 1–314 and treats page 315 as a legend, with explicit horizontal
bands for code, general duty, additional duty, English description, Arabic fallback description,
and India category. It recognizes six two-digit group rows and the authority's visually split
11-digit `009` ceramic entry. Duplicate tariff codes are merged only when every material treatment
is identical; otherwise import fails. The six actual duplicate codes are pharmaceutical/medical
list continuations with identical treatment and concatenated descriptions, not conflicting rates.

Qualified real-file controls:

- 14,364 physical rows and 14,311 unique 12-digit codes.
- 14,183 ad-valorem rows, 32 mixed/minimum rows, and 96 no-duty-expression rows.
- Of the 96 no-expression rows, 93 are expressly prohibited and three remain blank; neither state
  is converted to legal zero.
- General-rate distribution: 1,758 rows at 0%, 12,322 at 5%, 18 at 10%, four at 20%, four at 25%,
  and 77 at 100%, plus the 32 mixed/minimum rows.
- India categories retained exactly as published: A 13,942; B 45; C 5; E 93; X 116; blank 110.
- The current qualified source hashes are tariff
  `ea3be328e3d33813dd1b863a0e3b126b2e23edfea4678d6b31061b3a966d8a51`, current Oman remedy
  `6dbc6ad6681ecb59c32d8959d05fe9a3816b78032e541ab0a936be75968a8419`, GCC extension
  `8d259e4e7c558824b3ecf73643ba5f03afbc2bb838e69dbf4514d0f52d0047e9`, and legacy workbook
  `e26afd81913d8180b0ed9869a6117fe9ae9feceeb48e99782ca8a8a7ec0b7c4b`.
- Two consecutive final live acquisitions produced byte-identical 33,660,883-byte composites with
  SHA-256 `9fc9c663f384ffcf7f8ca6e07f4e9ad0d20888584764b046d44b1695664354cb`.

## Duty semantics

General customs duty and the tariff's additional-duty column are separate line records. The parser
supports legal zero, ordinary ad valorem, prohibited/no-rate, and the published mixed minimum form
(for example 100% subject to a minimum OMR amount per kg gross). It never creates an ad-valorem
equivalent and never labels an unknown additional entry as a customs procedure charge.

For ceramic-tile anti-dumping rows, the additional rate is a separate trade-remedy component on a
percentage-of-CIF basis, not a replacement for the ordinary customs duty. ClearTrade retains both
components and does not compute a shipment total without the necessary customs value and identity
facts.

## Ceramic-tile anti-dumping measure

The original GCC measure took effect on 6 June 2020. Official Gazette 55 continues the definitive
measure for five years from expiry of that original five-year term and publishes revised/current
company identities and rates on a `% CIF` basis.[3] Accordingly, `2025-06-06` is retained as the
continuation start. An end date of 5 June 2030 follows by calendar inference from the official
five-year continuation; the parser does not hard-code that inferred end date.

The current Oman schedule and GCC instrument agree on the material India rates, including Lexus
Granito 70.2%, Sunhearrt/SunShine 37%, Comet Granito 17.6%, and the cooperative-producer schedule.
The older Oman workbook says 70% for Lexus. That difference is retained in the manifest as a known
legacy discrepancy; the newer GCC instrument and current Oman schedule control.

The tariff differentiates named producer categories and re-export cases. For India-origin goods,
origin alone cannot select the applicable national subline or rate. The result therefore remains
`classification_refinement_required` and emits
`OM_ANTIDUMPING_PRODUCER_EXPORTER_IDENTITY`, requiring producer/exporter identity and exporting
country. Rates are evidence candidates until those facts are supplied, never a guessed single
answer.

## Oman–India CEPA and rules of origin

The tariff's A/B/C/E/X categories are retained line by line. Category A is zero from 1 June 2026;
B stages from 4% to zero in five annual steps; C stages from 4.5% to zero in ten annual steps; E and
X do not create a preferential rate. The 45 B lines and five C lines all have a published 5% MFN
base, so these category schedules are consistent with the qualified tariff file.

A schedule rate is only potentially applicable. Every India preference requires origin proof,
direct transport or qualifying transit, and the product-specific criterion in annex 3B to be
established for the actual goods.[4] `WO` and `PSR` are retained as possible rule classes, not as a
qualification result. The parser therefore returns
`potentially_applicable_requires_origin_proof`; it never infers originating status merely from an
India origin-country input.

## Rights boundary

Oman Copyright Law article 4 excludes bare ideas/procedures/data and official documents such as
laws, regulations, decisions, agreements, and treaties from protection, while original selection
or arrangement can still be protected.[5] This supports retaining the official facts and official
instruments needed for customs calculation. The pack makes no claim to Oman Customs' site design,
software, database structure, or any third-party compilation. Only narrow authority-authored HTML
fragments and article 4 text are retained; request-specific CMS chrome is removed. The WIPO Lex
reproduction is used in automated acquisition because the Oman Ministry of Justice PDF endpoint had
an incomplete TLS chain in the Node runtime; TLS validation was not bypassed. The manifest preserves
the Ministry's canonical law-page URL as the original-law reference.[6]

## Failure, replay, and scope guarantees

- Per-file and composite hashes, reader/parser versions, reference date, retrieval date, and source
  URLs are retained on an immutable `AuthorityRelease`.
- Import validates row counts, source signatures, semantic markers, anti-dumping rate sets, CEPA
  markers, rights text, and every manifest hash before activation.
- Query-time loading verifies the retained blob checksum. Historical reparsing names the immutable
  release and parser version, and snapshot persistence is idempotent.
- Source outages, HTML/PDF drift, a changed row layout, conflicting duplicates, blank rate cells,
  and unresolved national children all fail closed or remain explicitly unresolved.
- `tariff_treatment_complete=true`; `regulatory_coverage_complete=false`. The omitted live
  permits/requirements layer is named in every result.[1]

## Remaining destination blockers (no new wave)

- **Serbia (`RS`)** — the exact current 1,836-page consolidated tariff, its dated amendment overlay,
  and the quota rule after exhaustion (50% of the general rate) still need a qualified table/note
  parser and complete precedence proof.
- **Kosovo (`XK`)** — the 2026 TARIK baseline does not establish an exhaustive current chain of the
  later administrative instructions that its own publication says can control.
- **Türkiye (`TR`)** — the baseline and additional-customs-duty decision are not a complete
  executable import liability without the full additional-liability/fund/measure joins and tested
  precedence.

## Isolated staging proof

- Railway project `c99f8829-5056-4980-86e0-17083d67a6d8`, staging environment
  `e3e9bdae-38a4-4f8f-a85e-d49f295ee69f`.
- Final web deployment `996f11bd-6ca3-4e45-8b34-860afd103450`: `SUCCESS`.
- Final worker deployment `3e5180f2-d96e-4555-8003-316fe4dc5fcd`: `SUCCESS`; the worker process
  was restarted after the final canary-script change.
- Staging `DATABASE_URL` and `DIRECT_DATABASE_URL` fingerprint
  `15b1dd6be8bd9704b7aa944403951e121e4d865d458d8db06190e801756961aa` differs from production
  fingerprints `c7f159cd775ca74907ce0e9823068627d9b9033849038606caf3fbc9864bf537` and
  `fb31bfba251b727736d9048fdbe5a661ea511a66586bad61ec2b66946a4dd7d6`, respectively.
- Staging bucket `cleartrade-staging-isolated-j21z3g` differs from the production environment's
  bucket. The signed storage round trip passed 9/9 and removed its object; an independent anonymous
  bucket-root request returned HTTP 403.
- `/api/health/live` and `/api/health/ready` returned HTTP 200; readiness reported both database and
  S3-compatible storage `ready`. The staging environment inventory passed with zero errors.
- Actual active `AuthorityRelease` id `cmu2524ld0001lsa1h6usnn4g`, checksum
  `9fc9c663f384ffcf7f8ca6e07f4e9ad0d20888584764b046d44b1695664354cb`. The external identifier
  `2026-09-14` remains only its acquisition-date snapshot key.
- Direct immutable snapshots: legal zero `cmu25mymu0001ms41wdi9t2ay`; mixed/minimum
  `cmu25n211000hms4192cugy28`; anti-dumping refinement `cmu25n3sb000sms41ou07pplg`; prohibited
  line `cmu25n5xj001gms41tj4h7719`. Repeating the legal-zero reparse returned the same id.
- Worker job `cmu25n7w0001oms41qriucmfm` completed on first attempt
  `cmu25n9um0001ms0p6z45imw3`, producing ordinary/CEPA snapshot
  `cmu25ncll0003ms0p7bvxdv72`. Worker heartbeat instance `952c40d06d96-25` was current at
  `2026-09-15T04:11:43.589Z`.
- Real-source semantics: `010121` legal 0% and CEPA A only potentially applicable with origin proof;
  `030569` ordinary 5% plus CEPA A only potentially applicable with origin proof; `240110` 100%
  subject to minimum OMR 3/kg gross; `690721` refinement required across six candidates with
  additional rates 0/23.5/70.2/37/17.6/41.2 and producer/exporter identity required; `010310`
  expressly prohibited.
- A combined canary initially exposed a staging-memory peak after acquiring two 33.7 MB bundles.
  The permanent canary now runs acquisition/import/reacquisition and semantic persistence as two
  fail-closed processes. This preserves the checks and eliminates the avoidable simultaneous
  decoded-bundle peak.
- No production identifier was used as a deployment or write target, and production was not
  mutated.

## Sources

1. [Oman Customs import and export requirements search](https://www.customs.gov.om/en/search-import-and-export-requirements/).
2. [Oman Customs user guides and 2026 tariff](https://www.customs.gov.om/en/user-guides/); [current ceramic anti-dumping schedule](https://www.customs.gov.om/media/uiibi3km/ceramic-dumping-list-3.pdf).
3. [GCC Technical Secretariat trade-remedy releases](https://www.gcc-sg.org/ar/JointGulf/Cooperation/TSAD/Pages/Releases.aspx); [Official Gazette 55 announcement](https://www.gcc-sg.org/ar/MediaCenter/News/Pages/news-2026-4-21-5.aspx); [investigation register](https://www.gcc-sg.org/ar/JointGulf/Cooperation/TSAD/Pages/Investigations.aspx).
4. [Oman Customs Oman–India CEPA page](https://www.customs.gov.om/ar/agreements/cepa/); [India Ministry of Commerce chapter 3 rules of origin](https://www.commerce.gov.in/ministryofcommerce/node/4314); [annex 3B product-specific rules](https://www.commerce.gov.in/ministryofcommerce/node/4312).
5. [WIPO Lex reproduction of Oman Copyright Law, article 4](https://www.wipo.int/wipolex/en/text/589897).
6. [Oman Ministry of Justice and Legal Affairs copyright law record](https://mjla.gov.om/laws/ar/1/show/93).
