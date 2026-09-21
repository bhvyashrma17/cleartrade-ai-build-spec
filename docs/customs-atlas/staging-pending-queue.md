# Customs Atlas staging-pending queue

This is the single manifest for the next Railway batch. **None of these destinations is accepted
operational yet.** Accepted operational count remains **45**. Candidate commit for the six new
scope aliases is `81f2d2e`; Sri Lanka's implementation commit is `5ec745a`.

| ISO | Authority / source family | Source and acquisition path | Expected rows/codes | Semantic canaries | Known limitation |
|---|---|---|---|---|---|
| LK | Sri Lanka Customs / `LK_CUSTOMS_PDF` | `GREEN_WAVE_CONFIGS.LK`; `acquireGreenWaveAuthorityBundle('LK')`; official 16 May 2026 ZIP plus ordered Gazette bundle | 641 PDF pages; 6,609 tariff codes; tariff SHA-256 `d9273968e731b8e626016eecc78c20a2db9b8bf0e5b865246229e8d8dc0f3947` | ordinary/general; printed free vs blank; SCL replacement; 50% surcharge phases; ISFTA India column must remain `potentially_applicable_requires_origin_proof` | Regulatory corpus incomplete; staging qualification still required. Do not change or investigate LK in this wave. |
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
