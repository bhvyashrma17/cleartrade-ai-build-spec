# Customs Atlas three-country sovereign wave — 25 September 2026

**Starting checkpoint:** `37d8476` (after the Tunisia pack)
**Scope:** South Africa, Mexico and Colombia, reference date 2026-09-25. Each was source-gated on six points
(executable base, currentness route, tariff semantics, India preference, complete remedy route, reuse basis)
before any provider work. The pre-research hypotheses (all three "green") were checked against the official
sources rather than assumed. No authority was contacted. No Railway or production operation ran.

**Result:** 0 locally qualified; 3 blocked. Staging-pending sovereign count stays **10**; potential after
Railway stays **55**; accepted stays **45**. The three fail-closed entries in `unconfigured-sources.ts` were
updated with the verified findings below.

## South Africa (`ZA`) — `BLOCKED_RIGHTS`

- **Copyright is not the obstacle.** Copyright Act 98 of 1978 s12(8)(a): no copyright subsists in official
  texts of a legislative, administrative or legal nature.
- **SARS's website terms are.** Clause 4.1 limits use to personal, educational or non-commercial purposes,
  with no further reproduction or distribution. Clause 4.2 bars commercial use without prior written consent.
  Clause 4.8.2 bars using "any technology or applications (including web crawlers or web spiders) to search or
  copy the SARS website or material" without prior written consent. An automated acquisition would itself
  breach 4.8.2, so none was attempted, and `LOCAL_IMPLEMENTATION_READY_RIGHTS_PENDING` is not available either.
- **Recorded for a consented build:** Schedule 1 Part 1 is dated 28 August 2026. The 2026 Tariff Amendments
  ledger has 74 notices through 18 September 2026: sugar and wheat variable-formula rates, steel, rails,
  windscreens, flat-rolled steel anti-dumping and safeguards. It includes the mandatory India canary
  **GG 54974 R.7690** (10 July 2026): a provisional anti-dumping payment on ceramic and porcelain tiles
  (6904.90, 6907.21, 6907.22, 6907.40) from India, Mozambique, Zambia and Zimbabwe.
- **Unblocked by:** written SARS consent covering automated acquisition, retention and commercial derived display.

## Mexico (`MX`) — `BLOCKED_REMEDY_COMPLETENESS`

- **The base is sound.** SNICE's `FRACCIONESARANCELARIAS-LIGIE_20260420` workbook has 8,183 eight-digit
  fractions with import and export rates and 11,507 NICO rows. Every NICO maps to a fraction, and 49
  fractions carry no NICO. NICO is statistical; the fraction carries the duty. Rates include compound AMX
  sugar duties (e.g. 20% + USD 0.36/kg) and prohibited lines.
- **Currentness is sound.** SNICE's official modification ledger lists July 2025 (Totoaba, 11 fractions),
  November 2025 (sugar, 8), December 2025 (the 1 January 2026 reform, 1,463) and April 2026 (185, in force 24
  April 2026). The base workbook already incorporates every delta row, so replaying them would double-apply.
- **Remedies are the blocker.** Annex 2.5.1 of the Secretaría de Economía's Reglas y Criterios, and every
  compensatory-duty and safeguard resolution, exist only in the Diario Oficial de la Federación. DOF (and the
  Cámara de Diputados) is **TCP-filtered from the qualification environment**; public DNS resolves it, but
  ports 443 and 80 are closed. gob.mx (UPCI) serves a **proof-of-work bot challenge**. Neither was
  circumvented. SNICE describes Annex 2.5.1 but does not host it.
- **India:** SNICE's DOF index lists 36 remedy instruments in 2026 alone. From titles, likely-active
  India-origin measures include seamless carbon-steel pipe (review concluded September 2024), welded
  carbon-steel pipe (sunset review opened 6 April 2026), high-carbon ferromanganese (final June 2023),
  ferrosilicomanganese (continued April 2023), amoxicillin (continued November 2023) and textured polyester
  filament. Rates and states cannot be qualified from titles.
- **Rights are clear.** Ley Federal del Derecho de Autor art. 14 frac. VIII (last reform DOF 14-05-2026, via WIPO
  Lex) excludes legislative, regulatory, administrative and judicial texts and their official translations,
  provided publications conform to the official text.
- **India preference:** not determined in this pass. There is no bilateral Mexico–India goods agreement, but both
  are GSTP participants, and SNICE's origin pages do not enumerate agreements. A future build must resolve
  whether Mexico applies GSTP concessions before stating `not_applicable`.
- **Unblocked by:** unchallenged access to DOF, or an official current compensatory-duty register with rates,
  producers and dates.

## Colombia (`CO`) — `BLOCKED_CURRENTNESS`

- **Rights are clear for official texts.** Law 23 of 1982 art. 41, which DIAN's own compilation cites, allows
  reproduction of decrees conforming to the official edition. DIAN's vigencia notes, concordances and
  arrangement are protected and were not used as data.
- **The base is available.** Decree 1881 of 2021's table is clean text in DIAN's Compilación Jurídica (7,968
  ten-digit subpartidas). MinCIT's copy is a 549-page scan whose OCR corrupts codes, so it is unsuitable.
- **The remedy route is credible.** MinCIT's anti-dumping register lists 22 measures in force and 6
  investigations. High-pressure decorative laminates from India are in force (sunset 2022), and a new 2026
  investigation is open on the same product.
- **Currentness is the blocker.**
  - MinCIT's decree register is not a complete record of tariff instruments. Decree 455 of 2026 (extending the
    Ecuador reciprocal duties to 191 subpartidas at 35/50/75%) and Decree 583 of 2026 (repealing Decree 170)
    are absent from it and were found only through DIAN's bulletin and compilation.
  - The Presidency's decree register is TCP-filtered from the qualification environment, and SUIN-Juriscol is
    a private-API single-page application.
  - DIAN's compilation index itself lags: it says Decree 1530 of 2024 is still being incorporated.
  - The Andean Price Band cannot be modelled. Decree 547 of 1995 lists band products only in 1995
    nomenclature, and no reachable official static source publishes the current-nomenclature scope or the
    fortnightly variable duties.
  - The wheat 0% rate and band suspension of Decree 1092 of 2024 lapsed on 28 August 2026, so wheat is back
    under the band.
- **Further semantics recorded for a future build:**
  - Decree 1881 art. 2 keeps earlier decrees (1116/2017 … 1880/2021) in force on their own terms.
  - Price-threshold tariffs apply to apparel (2598/2022) and footwear (594/2026).
  - Vehicle and auto-part tariff quotas: 1880/2021, 1898/2023, and 1530/2024 until 2028-12-31.
  - Decree 1432/2025 is future-effective (11 January 2027).
- **India preference:** not established. MinCIT's list of 19 agreements in force includes none with India. Its
  treatment of GSTP (both countries are participants) was not resolved in this pass.
- **Unblocked by:** a complete reachable register of tariff decrees (or the Diario Oficial index) and an
  official current-nomenclature price-band product list with published variable duties.
