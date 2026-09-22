# Customs Atlas staging-pending queue

This is the single manifest for a future staging qualification batch. **None of these destinations
is accepted operational yet.** Accepted operational count remains **45 sovereign countries**.
There are **10 pending destinations but only 5 pending sovereign states**: Sri Lanka, Monaco, Indonesia, Saudi Arabia and Qatar.
Åland, Guernsey, Isle of Man, Jersey and Puerto Rico are associated territories/dependencies and
must not inflate the sovereign-country metric. Candidate commit for the six scope aliases is
`81f2d2e`; Sri Lanka's implementation commit is `5ec745a`.

The 21 September dual-lane public-source pass added no row: Jordan, Lebanon, Kuwait, Uzbekistan
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
| QA | Qatar General Authority of Customs / `QA_CUSTOMS_INTEGRATED` | Official current Integrated Customs Tariff schedule (customs.gov.qa, 402-page bilingual GCC-format PDF); Decree 63/2025 structural amendment (complete 3-table annex); Decree 31/2026 acknowledged with effective date only (tables not machine-published); Decisions 19/2025 and 48/2026 anti-dumping (complete); bundle SHA-256 `c6b829351b98a5ed8dad603c73723fa077d87fa95e726311299f3c27f48ca480` | 13,958 unique 12-digit codes; 57 Decree 63/2025 operations (32 modifications, 21 additions, 4 deletions); 4 active remedy instruments (2 rate-confirmed, 2 scope-confirmed-rate-unconfirmed) | legal zero 120110000000; ordinary ad valorem (e.g. 5% on 850710); import-prohibited (khat, certain mushrooms) modelled as non-declarable, never zero; Decree 63 modification/addition/deletion; India `not_applicable`; anti-dumping producer refinement required | Local qualification only. Decree 31/2026's own add/delete/description tables are not separately machine-published by any official source, so 2025-06-01→2025-12-31 replay assumes no code overlap with Decree 63/2025; the current (2026-09-23) state is unaffected since the schedule artifact already reflects it. Trade-remedy register enumeration is not certified complete (moci.gov.qa unreachable; customs.gov.qa's decisions page shows only a recent window); Decisions 21/2024 and 22/2024 are retained active-but-rate-unresolved rather than invented, and Decision 107/2024 (ceramic tiles) named only in the intake brief was not independently corroborated and is excluded. `regulatory_coverage_complete=false`; staging import, cross-portal persistence and activation remain pending. |
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

If all ten destinations qualify, the operational destination count becomes **55**, while the
operational sovereign-country count becomes **50**. Keep both metrics in reports; they answer
different questions.

## Operational note: Qatar Customs TLS chain

`customs.gov.qa` serves only its leaf certificate (issuer `DigiCert Global G2 TLS RSA SHA256 2020
CA1`) without the intermediate. Browsers and curl tolerate this via cached/AIA-fetched
intermediates; Node's `fetch` does not, and a direct request fails closed with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE` — TLS validation is never disabled to work around this. Any
environment that runs `acquireQatarAuthorityBundle` (including a future staging deploy) must supply
the DigiCert intermediate via `NODE_EXTRA_CA_CERTS` (or an equivalent trust-store addition) so the
real chain can be completed and verified.
