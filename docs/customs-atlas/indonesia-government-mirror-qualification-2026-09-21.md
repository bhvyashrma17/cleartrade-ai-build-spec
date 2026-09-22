# Indonesia government-mirror qualification — 21 Sep 2026

**Decision:** `LOCAL_QUALIFIED_STAGING_PENDING`

This qualification is local only. No Railway, staging, or production system was contacted.

## Authority and deterministic acquisition

- Legal issuing authority: **Kementerian Keuangan Republik Indonesia**.
- Preferred retained repository for acquisition version `id-government-mirror-precedence-v1`: **JDIH BPK** (`peraturan.bpk.go.id`).
- Legal provenance cross-check: **JDIH Kementerian Keuangan**. The official DJBC repository is pinned for PMK 62/2025 and PMK 9/2025 where it supplies the reviewed artifact.
- Optional cross-check: `peraturan.go.id`; it is not selected opportunistically and is not part of this bundle identity.
- Every retained PDF is pinned by URL, exact byte length, and SHA-256. `acquisition.json` separately records issuing authority, publication repository, instrument number/title, publication date, effective date, official URL, byte length, and hash for all 31 official PDFs.
- A future repository or artifact change requires a new acquisition/bundle version; the downloader never races mirrors.

The pre-implementation acquisition gate passed with complete PDF bytes and expected instrument identity:

| Instrument | Official retained source | Bytes | SHA-256 |
|---|---|---:|---|
| PMK 26/PMK.010/2022 | `https://peraturan.bpk.go.id/Download/209374/26_PMK.010_2022.pdf` | 26,345,564 | `ae0caa3d9f49fbdd3378af0ff4cbf84350cfe29f28ef767d07e2a063bf5e1fd6` |
| PMK 50/2026 | `https://peraturan.bpk.go.id/Download/415909/2026pmkeuangan050.pdf` | 5,304,237 | `31d89a89d01af2e90da1e06d9a75a84f5eaede6fa59123fbec973e018b1e940f` |
| PMK 14/2026 sample remedy | `https://peraturan.bpk.go.id/Download/410515/2026pmkeuangan014.pdf` | 783,898 | `5c0f40b18a3b6d926d40c13951fc7d023ed4c01288b5e7747a1fd23ef7a87ae1` |

## MFN result

- Nomenclature: HS 2022 / AHTN 2022, eight-digit declarable national codes.
- Current rows: **11,702**.
- Replay: PMK 26/2022 baseline → PMK 10/2024 applicability amendment → PMK 62/2025 second replacement → PMK 50/2026 third replacement.
- Effective current snapshot: **28 Jul 2026**, reconciled from PMK 50/2026 legal text.
- The complete replacement schedules are diffed by code and retain typed `ADD`, `DELETE`, `REPLACE`, and `CORRECTION` records in `mfn-amendment-diff.json`; the replay produced 150 additions, 4 deletions, 3 rate replacements, and 11,549 description corrections/restatements.
- Blank, specific, ad-valorem, compound, and mixed expressions remain typed; no ad-valorem equivalent is invented.

## AIFTA result

- PMK 47/2022 yielded **11,414 published schedule entries**, **11,412 duty-bearing coordinate rows**, and **11,401 unique eight-digit codes**. Repeated ex-scope treatments remain product variants rather than being collapsed.
- PMK 92/2022 is applied as a replacement for 9031.20.00: 4% for electrically operated test benches and 0% otherwise. The code fails closed until product operation is established.
- PMK 35/2023 supplies the origin-documentation layer.
- A published preference means `preferenceExists = true`; India entitlement remains `potentially_applicable_requires_origin_proof` until the required origin evidence and product-specific origin rule are satisfied.

## Active remedies gate

The complete active-measure manifest at the reference date contains **24 measures: 15 anti-dumping and 9 safeguards**. Enumeration reconciled the KADI imposed-measure lists with JDIH BPK status/effective periods and the official legal PDFs, including measures issued before 2026 and PMK 32/2026's provisional measure. The manifest validates every covered code against a rate schedule and retains product, origin, producer/exporter, unit/currency, period, amendment, exclusion, and artifact-hash data.

| Instrument | Type | Effective period | Product | Retained PDF SHA-256 |
|---|---|---|---|---|
| 15/PMK.010/2022 | AD | 2022-03-15–2027-03-14 | Hot rolled coil of other alloy | `a24a769d876c2ea174297ba0c480006dbc63957deba6c637c215b516a1bf2183` |
| 40/PMK.010/2022 | AD | 2022-04-20–2027-04-19 | Feed-grade lysine, esters and salts | `8548404e77d9a41598cf726ebfcff05a863e8237f5d1cf708784c6ecb8ee60c1` |
| 176/PMK.010/2022 | AD | 2022-12-12–2027-12-11 | Polyester staple fibre | `183f1a9ac8deed77e706035f221c2e2fa3788a4784c9495ed7cb6753b687dae8` |
| PMK 32/2023 | AD | 2023-04-10–2028-04-09 | Frit/glaze preparations and glass frit | `0d76ec26277e4413ab9f5e78deca4deb7c8c3f238ab6510abb82e64fb74f8a46` |
| PMK 60/2024 | AD | 2024-10-01–2029-09-30 | BOPP | `03ebd5f739c724044ba23762fa359da960fdbac5753a07a6bdea861f74e2cf7d` |
| PMK 66/2024 | AD | 2024-10-18–2029-10-17 | Tinplate | `26d850ed6aa8c398602de2a89bf1d3d0546f8c21bf611b3af05655c14c1a868d` |
| PMK 70/2024 | AD | 2024-10-28–2029-10-27 | Ceramic tiles | `779ef6b39e6a014a07b2911bae5b125984eef3b3814e1db059ab96a343fab3d8` |
| PMK 71/2024 | AD | 2024-10-29–2029-10-28 | H/I sections | `615321c4365d4a9ea8d19aebf100fccc30257028c06d7eb375e8c4d34db06be3` |
| PMK 95/2024 | AD | 2024-12-30–2029-12-29 | BOPP | `9ed0fcf2d9d643287eb3f8bbb5d02f11edad4a4573c300480ae96502fd1f17eb` |
| PMK 103/2024 as amended by PMK 31/2026 | AD | 2025-01-15–2030-01-14 | Non-alloy hot rolled coil | `95aaf36e8439b22f8a4082d68f8a6b887a98da57966b8198a23974b9e9e67386` |
| PMK 9/2025 | AD | 2025-02-24–2030-02-23 | Hot rolled plate | `f11d0b129e351042736e617d850dcf72b48ababe4093eda8f630b9dde96cd36c` |
| PMK 21/2025 | AD | 2025-03-25–2029-03-24 | Nylon film | `c7afb64c64f70a6dbc36c4184961a28c66ab67d84fdf692113ff4ca504bf1699` |
| PMK 14/2026 | AD | 2026-04-04–2031-04-03 | BOPET | `5c0f40b18a3b6d926d40c13951fc7d023ed4c01288b5e7747a1fd23ef7a87ae1` |
| PMK 32/2026 | AD provisional | 2026-05-17–2026-11-16 | Non-alloy hot rolled coil | `52852bccc7bae30343ee76ca0f169800d1c58c3a0177059cb6accf432b556719` |
| PMK 40/2026 | AD | 2026-06-25–2031-06-24 | Duplex paperboard | `c7dbcb66aa3ccc01106a8a62a45268b27f265c23077a4ca8be3d00dd13433239` |
| PMK 151/2023 | Safeguard | 2024-01-05–2027-01-04 | Cigarette paper | `3ce2bf1a563159f61776148e4f1f6eb4e723f685efe14fc42b23b4e6cace7160` |
| PMK 48/2024 | Safeguard | 2024-08-09–2027-08-08 | Fabric | `d8ea0b24aa63a259f9ce2cfd8897d5918ae8c4bbec06d3d58a6fc5b5b1eb32f8` |
| PMK 49/2024 | Safeguard | 2024-08-06–2027-08-05 | Chapter 57 carpets/floor coverings | `11eea0075256050a7ba3a4c9db7339b51ed05ae1ca9c735657c69fa6b0d624a9` |
| PMK 14/2025 | Safeguard | 2025-02-25–2027-02-24 | Ceramic products | `c4898bd30c1c2aed13b6fc2493a986c1fa1b5d00300bb3b196f1ea1a1f953ea2` |
| PMK 29/2025 | Safeguard | 2025-05-23–2028-05-22 | Expansible polystyrene | `2fe70ccca5b038979216da4e2d7e11d466a0fa15831dfc7905e7ec5e9e9f60dd` |
| PMK 67/2025 | Safeguard | 2025-10-30–2028-10-29 | Cotton yarn | `3ad09e4a73001258c870020add86a890f7ff1a5d78b18d7867821c575f6d26dc` |
| PMK 98/2025 | Safeguard | 2026-01-11–2029-01-10 | Woven cotton fabric | `21253eeeab1bb69a2768bb861f0377aba5e7154a5eb08a78dd39701461ea949a` |
| PMK 36/2026 | Safeguard | 2026-05-22–2028-05-21 | Curtains/blinds/bed valances | `97faa09bd53c6c9db8e1d96ec5716b54a244b2324b9520b0ae7fdb35ac6bc077` |
| PMK 37/2026 | Safeguard | 2026-05-22–2028-05-21 | Synthetic/artificial staple-fibre yarn | `8c1f1b0f1e8091aff3dfb7649b2a6dae3db0c41afbb3b57900d4cfaf8958ef82` |

Important execution semantics:

- Producer identity is mandatory where an anti-dumping table contains producer/exporter-specific rates. India origin alone never selects a BOPET or PSF rate.
- PMK 31/2026 deletes the Wuhan producer treatment from PMK 103/2024; PMK 32/2026 applies Wuhan's provisional 17.5% once, without double application.
- Safeguard rate periods and code-specific tables remain specific IDR/unit measures. India exemptions were reviewed per annex and are explicit booleans; no AVE is created.

## Rights and bundle

The retained basis is deliberately narrow: UU 28/2014 Articles 41 and 42 support normalization of official tariff facts/data and laws/regulations. It does not claim rights over JDIH/BPK website design, database arrangement, software, logos, or third-party/WCO expression.

The deterministic bundle contains **35 artifacts** (31 official PDFs plus four derived JSON artifacts), is **80,105,823 bytes**, and has SHA-256 `6c575e13c1937fd8b640ff613b85dc2b99bb94c5e0edb085f4f720c2396aad95`.

## Verification

- Real-artifact qualifier: pass.
- Focused Indonesia suite: 8/8 pass.
- Full repository suite: 113 files passed; 1,911 tests passed and 4 intentionally skipped.
- TypeScript, ESLint, Prisma generation/validation, production build, secret scan, and `git diff --check`: pass.

Indonesia is added to the staging-pending queue as a sovereign-country provider and removed from the generic human-access-required list. Activation remains a separate staging operation.
