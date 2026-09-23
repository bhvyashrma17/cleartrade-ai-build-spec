# Customs Atlas staging-pending queue

This is the single manifest for a future staging qualification batch. **None of these destinations
is accepted operational yet.** Accepted operational count remains **45 sovereign countries**.
There are **11 pending destinations but only 6 pending sovereign states**: Sri Lanka, Monaco, Indonesia, Saudi Arabia, Qatar and Kuwait.
Åland, Guernsey, Isle of Man, Jersey and Puerto Rico are associated territories/dependencies and
must not inflate the sovereign-country metric. Candidate commit for the six scope aliases is
`81f2d2e`; Sri Lanka's implementation commit is `5ec745a`.

The 21 September dual-lane public-source pass added no row: Jordan, Lebanon, Uzbekistan
failed a hard acquisition/completeness/reuse gate and moved to
[`human-access-required.md`](./human-access-required.md). No staging or production operation ran.

Singapore is no longer a human-access case: SSO legislation supplies a sanctioned autonomous
route. Its provider remains outside this queue and outside runtime routing until a complete live
First Schedule acquisition passes during SSO's 03:00–07:00 Singapore Time automation window.

Indonesia joined this queue after a local official-government-mirror qualification. JDIH BPK is
the pinned artifact repository, while Kementerian Keuangan remains the issuing authority and
JDIH Kemenkeu remains the legal-provenance cross-check. No staging import or activation ran.

| ISO | Authority / source family | Source and acquisition path | Expected rows/codes | Semantic canaries | Known limitation |
|---|---|---|---|---|---|
| LK | Sri Lanka Customs / `LK_CUSTOMS_PDF` | `GREEN_WAVE_CONFIGS.LK`; `acquireGreenWaveAuthorityBundle('LK')`; official 16 May 2026 ZIP plus ordered Gazette bundle | 641 PDF pages; 6,609 tariff codes; tariff SHA-256 `d9273968e731b8e626016eecc78c20a2db9b8bf0e5b865246229e8d8dc0f3947` | ordinary/general; printed free vs blank; SCL replacement; 50% surcharge phases; ISFTA India column must remain `potentially_applicable_requires_origin_proof` | Regulatory corpus incomplete; staging qualification still required. Do not change or investigate LK in this wave. |
| ID | Kementerian Keuangan / `ID_KEMENKEU_BTKI` | Pinned JDIH BPK PDFs with Kemenkeu provenance: PMK 26/2022 → 10/2024 → 62/2025 → 50/2026; AIFTA PMK 47/2022 + 92/2022 + origin PMK 35/2023; 24 active remedy instruments as at 21 Sep 2026 | 11,702 current eight-digit MFN lines; 11,401 unique AIFTA codes / 11,414 published schedule entries; 15 anti-dumping + 9 safeguard measures; every retained PDF content-addressed | specific IDR duties; PMK 92 product-variant refinement; India origin proof; producer-specific BMAD; safeguard India-exemption annexes; PMK 31/PMK 32 Wuhan non-double-application | Local qualification only. National taxes/controls are outside this tariff pack, so `regulatory_coverage_complete=false`; staging import, cross-portal persistence and activation remain pending. |
| SA | Saudi Ministry of Finance / ZATCA / `SA_ZATCA_INTEGRATED` | Live public ZATCA 12-digit chapter pagination (858 requests) plus Chapter 1 item trees; Decisions 2-88-1446, 1446-88-4, 1447-88-5, 10-88-1447 and 2-88-1448; current exact national-rate workbook; GAFT national/GCC remedy tracker as at 22 Sep 2026; bundle SHA-256 `e679a437fea589e51c83500c04113384987c95ad461bef1fc77303f987216696` | 15,200 unique public ZATCA codes (14,170 declarable, 1,030 non-declarable — see limitation); 36 2025 structural operations; 747 2026 structural operations; 598 exact national-rate rows; 51 June + 2 August rate replacements; 14 active remedy instruments | legal zero 120110000000; ordinary ad valorem (e.g. 10% on 841810); 20% subject to minimum SAR 1/net kg; exact 12-digit refinement; careful 8-to-12-digit rate propagation; India `not_applicable`; remedy identity evidence required | Local qualification only. ZATCA's own live public inquiry publishes two conflicting duty rates for the same 12-digit code on 1,030 lines (6.8% of the universe) with no later structural/rate instrument to disambiguate; those lines are retained non-declarable rather than guessed. Ordinary permits/prohibitions/product controls also remain outside this tariff pack, so `regulatory_coverage_complete=false`; staging import, cross-portal persistence and activation remain pending. |
| QA | Qatar General Authority of Customs / `QA_CUSTOMS_INTEGRATED` | Official current Integrated Customs Tariff schedule (customs.gov.qa, 402-page bilingual GCC-format PDF); Decree 63/2025 structural amendment (complete 3-table annex); Decree 31/2026 acknowledged with effective date only (tables not machine-published); complete MOCI anti-dumping register (customs.gov.qa Decisions 19/2025, 48/2026 + moci.gov.qa Decisions 21/2024, 22/2024, 107/2024); bundle SHA-256 `aae0f5b632629082299479a2750cd84ce3055f198f4202015ddbe1a36f0ee1b0` | 13,958 unique 12-digit codes; 57 Decree 63/2025 operations (32 modifications, 21 additions, 4 deletions); 4 active + 1 expired remedy instrument, all rate-confirmed with full producer tables | legal zero 120110000000; ordinary ad valorem (e.g. 5% on 850710); import-prohibited (khat, certain mushrooms) modelled as non-declarable, never zero; Decree 63 modification/addition/deletion; India `not_applicable`; anti-dumping producer refinement required with named-producer + all-other rates; AGM/EFB battery exclusions; expired-measure exclusion (ceramic tiles) | Local qualification only. Decree 31/2026's own add/delete/description tables are not separately machine-published by any official source, so 2025-06-01→2025-12-31 replay assumes no code overlap with Decree 63/2025; the current (2026-09-23) state is unaffected since the schedule artifact already reflects it. Trade-remedy register enumeration is now certified complete via moci.gov.qa/Industry's non-paginated decisions-and-circulars page (all 5 GCC/Qatar anti-dumping instruments retrieved and pinned; 0 safeguard/countervailing found). Decisions 21/2024, 22/2024 and 107/2024 are scanned PDFs verified by exact byte/SHA-256 pin (their own text layer is a watermark only) after hand-reading the producer tables from the page images. An amendment chain asserted for Decision 22/2024 (Decision 2/2025, Decision 21/2025) could not be independently located on the same primary channel and is not applied; the original verified 2024 table stands. `regulatory_coverage_complete=false`; staging import, cross-portal persistence and activation remain pending. |
| KW | Kuwait General Administration of Customs / `KW_CUSTOMS_INTEGRATED` | Live public HS Code 12-digit tariff portal (customs.gov.kw/HSCode/HsCode, stateless GET pagination, 751 pages, bounded 6-way concurrency); complete anti-dumping register from customs.gov.kw's complete non-paginated Instructions/Circulars archive (841 instruments, 2007-2026); Copyright Law No. 75/2019 article 4 (WIPO Lex, hand-verified from page images); bundle SHA-256 `c0a144c4f02716b719e11023cc3d03f86321c5f4b2765ef49394b19d899db928` | 7,510 unique 12-digit codes (deterministic pagination: no gaps, no overlaps, no duplicates); 6 active + 1 expired remedy instrument, all rate-confirmed with full producer tables | legal zero 120110000000; ordinary ad valorem (5% baseline, 100% on select excise-adjacent lines); Instruction 57/2024 base (2025-01-01, Word tariff distributed only via internal magnetic disk — live portal used instead); expired 2024-2025 steel national overlay confirmed reverted to 5% on the live portal; India `not_applicable` (India-GCC FTA at Terms-of-Reference stage only); anti-dumping producer refinement required with named-producer + all-other rates; Korea battery 5y+5y continuation; cement/ceramic remedies ongoing pending sunset review; expired paperboard measure excluded | Local qualification only. Instruction 57/2024's own Word tariff artifact was distributed only via internal magnetic disk, not published; the live public HS Code portal (Option B) is used as the base source instead, with deterministic stateless-pagination verification (no session/cookie dependency). All 6 active remedy instructions were independently retrieved and hand-verified from customs.gov.kw's own complete instructions archive (not copied from Saudi/Qatar's identical underlying GCC-wide investigations, though the rate tables match exactly where the same investigation applies). The Korea battery producer table required OCR/image reading (Kuwait Customs' scanned instructions have no reliable text layer); its exact original 2017 effective date defers to a separately-numbered gazette bulletin not independently isolated, so the register's own listed date is used as the best-evidenced proxy. `regulatory_coverage_complete=false`; staging import, cross-portal persistence and activation remain pending. |
| AX | European Commission TARIC / `EU_TARIC` associated scope | Existing `importTaricRelease` CIRCABC monthly ZIP; no alias-specific bundle | Release schema/file controls; HS 100630 real-release canary has 108 declarable candidates | legal zero, EUR/tonne specific duty, line refinement; India measure/exclusion and origin-proof state | TARIC does not supply a complete Åland regulatory/fiscal corpus. |
| MC | European Commission TARIC / `EU_TARIC` associated scope | Same active retained TARIC release as EU members | Same; destination must persist as `MC` | Same tariff canaries as AX; Monaco must not be persisted as France | National regulatory/fiscal corpus incomplete. |
| GG | HMRC / `UK_CD_CUSTOMS_UNION` | Existing `fetchUkMarketAccess`; public JSON:API `vnd.hmrc.2.0`; destination `GG` | Per-HS complete declarable set, hard cap 150 documents; no separate bundle | HS 100630 specific `GBP/1000 kg`, sibling refinement, quota/condition retention; India stays conditional/unknown absent proved membership | Guernsey VAT, excise and domestic controls are not claimed complete. |
| IM | HMRC / `UK_CD_CUSTOMS_UNION` | Same API path; destination `IM` | Same | Same, with snapshot country `IM` | Isle of Man fiscal/regulatory corpus is separate and incomplete here. |
| JE | HMRC / `UK_CD_CUSTOMS_UNION` | Same API path; destination `JE` | Same | Same, with snapshot country `JE` | Jersey fiscal/regulatory corpus is separate and incomplete here. |
| PR | USITC / `US_CUSTOMS_TERRITORY` | Existing `fetchUsMarketAccess`; official `reststop/exportList` JSON; destination `PR` | Per-HS complete returned range; response row count and SHA-256 retained | HS 460290 exact 3.5% live canary; legal `Free`, specific/mixed expressions and refinement; programme symbol must not imply India qualification | HTS is not a complete Puerto Rico tax or product-control corpus. |

## Future batch acceptance

For each row: deploy the exact candidate commit, acquire through the path above, retain the raw
artifact/response checksum, run ordinary/zero/specific-or-special/preference canaries through the
other portal's read path, and verify idempotent repeat ingest. Promote only destinations whose
staging evidence agrees with the authority source. One failure must not promote or contaminate
another destination.

If all eleven destinations qualify, the operational destination count becomes **56**, while the
operational sovereign-country count becomes **51**. Keep both metrics in reports; they answer
different questions.

## Operational note: Qatar Customs TLS chain

`customs.gov.qa` and `moci.gov.qa` (both fetched by `acquireQatarAuthorityBundle`) serve only their
leaf certificate (issuer `DigiCert Global G2 TLS RSA SHA256 2020 CA1`) without the intermediate.
Browsers and curl tolerate this via cached/AIA-fetched intermediates; Node's `fetch` does not, and a
direct request fails closed with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` — TLS validation is never disabled
to work around this. Any environment that runs `acquireQatarAuthorityBundle` (including a future
staging deploy) must supply the DigiCert intermediate via `NODE_EXTRA_CA_CERTS` (or an equivalent
trust-store addition) so the real chain can be completed and verified.

## Operational note: Kuwait Copyright Law source is a short-lived presigned URL

`acquireKuwaitAuthorityBundle` fetches the Kuwait Copyright Law (Law No. 75/2019) rights evidence
from WIPO Lex, which serves the PDF only via an S3 presigned URL that expires within minutes and is
regenerated on every visit to the legislation details page. The acquisition code fetches the details
page first, extracts the current presigned URL from its HTML (decoding both `&amp;` and numeric
`&#x..;` entities — an earlier version only decoded `&amp;` and silently fetched a malformed,
unsigned URL that returned an HTML error page instead of the PDF), and immediately fetches that URL.
Content identity is pinned by exact byte-length and SHA-256 against the reviewed copy, since the URL
itself is never stable across acquisitions.
