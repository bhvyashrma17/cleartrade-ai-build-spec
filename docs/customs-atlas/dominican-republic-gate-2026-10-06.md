# Dominican Republic (DO) — acquisition gate, 6 October 2026

**Status: `BLOCKED_RIGHTS` (8 Oct; see "Rights gate outcome"); acquisition suspended.** Not qualified. No provider, parser or route was added.
Ledger unchanged: ACCEPTED 45, LOCAL_QUALIFIED_STAGING_PENDING 10, ENGINEERING_COMPLETE 55.

This is not a source failure. The official sources exist and are published for normal browsers;
this network is refused before any content is served. They are not to be bypassed.

## What stopped the run

| Source | Official URL | Result from this network |
|---|---|---|
| DGA tariff (7ma Enmienda 2022) | `https://www.aduanas.gob.do/consultas/arancel-de-aduanas-7ma-enmienda-2022/` | HTTP 403, `Microsoft-Azure-Application-Gateway/v2` (every DGA path, incl. homepage and the entry-into-force notice). Bare `aduanas.gob.do` does not connect. |
| DGA entry-into-force notice | `https://www.aduanas.gob.do/media/rupaj0fj/aviso-entrada-en-vigor-enmienda.pdf` | Same WAF 403. |
| CDC remedy repository | `https://www.cdc.gob.do/` | HTTP 403, Cloudflare managed challenge (`cf-mitigated: challenge`). Not bypassed. |
| Ministerio de Hacienda | `https://www.hacienda.gob.do/` | HTTP 403, Cloudflare CAPTCHA. Not bypassed. |
| DGII legislation | `https://www.dgii.gov.do/legislacion/leyesTributarias/` | Reachable. |
| WTO I-TIP / docs.wto.org | — | Reachable. |

Gate 1 (tariff base) cannot close without the DGA file, and gate 3 (remedy completeness) cannot
close without the CDC resolutions. Remedy, TRQ and currentness conclusions are therefore **not**
drawn from secondary summaries.

## Retained so far

- **Law No. 30-26** (*Medidas pro-crecimiento económico, simplificación fiscal y mitigación de la
  crisis internacional*), DGII copy:
  `https://www.dgii.gov.do/legislacion/leyesTributarias/Documents/Codigo Tributario y Leyes que lo modifican y complementan/30-26.pdf`,
  16,490,170 bytes, SHA-256 `755b032ca4eb97a82053e41938ab7a4078747fdd81d78cb7287786f19720ed39`.
  Promulgated 18 June 2026. Art. 62 says it takes effect on promulgation **and publication**.
  The Gaceta Oficial number and date are not yet established, so no effective date is fixed.

### Law 30-26, as read from the controlling text (not yet implemented)

- **Art. 36** adds 25 subheadings to the ITBIS exempt-goods list of Código Tributario art. 343:
  `2715.00.90` (asphalt products for road paving), the ambulance lines `8703.21.10 8703.22.10
  8703.23.10 8703.24.40 8703.31.40 8703.32.11 8703.33.40 8703.40.11 8703.50.11 8703.60.11 8703.70.11
  8703.80.11`, the refuse-collection truck lines `8704.21.70 8704.22.50 8704.23.50 8704.31.70
  8704.32.50 8704.41.16 8704.42.14 8704.43.14 8704.51.16 8704.52.14 8704.60.15`, and fire trucks
  `8705.30.00`.
- **Art. 37** exempts customs duties ("derechos arancelarios") and other import charges **only** for
  fire trucks, refuse trucks with compactors, and ambulances within those Art. 36 subheadings.
  `2715.00.90` is in Art. 36 but is **not** covered by Art. 37. Its ITBIS exemption must not become
  a customs-duty exemption.
- **Art. 38** adds goods to the art. 343 párrafo III list. That is an internal-tax provision, not a
  customs duty.

## Needed from a normal browser (exact files)

Save into `.artifacts/customs-atlas/dominican-republic/`. Each is checksummed on arrival.

1. **The complete tariff** from the DGA page above. Use the embedded viewer's own download/print-to-file
   control, or its direct document link if the page offers one. Keep the original file name.
2. **The DGA notice** `aviso-entrada-en-vigor-enmienda.pdf` (URL above).
3. **Any later DGA tariff notices/avisos** listed on `https://www.aduanas.gob.do/de-interes/consultas/`
   after January 2022. A saved copy of that index page is also needed as completeness evidence.
4. **CDC resolutions** from `https://www.cdc.gob.do/`, plus the saved index page of each repository
   section (antidumping, countervailing, safeguards):
   - China rebar: original final resolution; `CDC-RD-AD-001-2022`; `CDC-RD-AD-009-2026`, and every
     later 2026 resolution in that review.
   - Türkiye rebar: original final resolution; `CDC-RD-AD-003-2021`; the 2025 sunset-review
     initiation and every 2026 procedural or final resolution.
   - Costa Rica rebar: `CDC-RD-AD-007-2019`; the 2025 initiation and every 2026 resolution
     (provisional or final, if any).
   - Spain rebar: the original final resolution and any continuation instrument.
   - EMT conduit, China: the 2024 initiation and its final, provisional or termination resolution.
5. **Gaceta Oficial publication of Law 30-26** (number and date), to fix its effective date.

Hacienda (Cloudflare CAPTCHA) is needed only if items 3–5 point to a Hacienda-only instrument.

## Rights gate re-opened — 7 October 2026

**Status: `RIGHTS_PENDING` — one decisive document.** The bundle request above is suspended until
this resolves.

**Why it re-opened.** Law 65-00 art. 41 permits reproduction of laws, decrees, regulations and
administrative acts only "siempre y cuando no esté prohibido". The DGA 2022 tariff publication
carries its own specific notice: total or partial reproduction is prohibited without prior DGA
authorization, and DGA asserts edition and reproduction rights in the publication and its Spanish HS
nomenclature. That is a specific prohibition, not a generic portal footer. **The DGA edition
therefore cannot be the commercial base**, whether the facts are extracted or the text reproduced.
"Facts are not copyrightable" is not accepted as project policy.

**Routes checked:**

1. **Statutory instrument — candidate.** The current nomenclature was not enacted by the DGA
   publication. **Ministerio de Hacienda Resolución Núm. 004-2022** "incorpora la VII Enmienda de
   la Nomenclatura del Sistema Armonizado de Designación y Codificación de Mercancías versión 2022"
   to the Dominican tariff, under the Law 146-00 delegation to Hacienda (on DGA recommendation) to
   create or eliminate subheadings and adapt the nomenclature. As an administrative act it falls
   within art. 41. The DGA prohibition attaches to DGA's edition, not to Hacienda's act. Official
   copy (7.9 MB, posted 7 March 2023):
   `https://www.hacienda.gob.do/transparencia/wp-content/uploads/2023/03/Resolucio%CC%81n-004-2022-que-incorpora-la-VII-Enmienda-de-la-Nomenclatura-del-Sistema-Armonizado-de-Designacio%CC%81n-y-Codificacio%CC%81n-de-Mercanci%CC%81as-v2022.pdf`.
   Hacienda serves a Cloudflare CAPTCHA to this network, and WebFetch is refused too, so the
   contents are **unread**. This route clears the gate only if, read from the document itself:
   - the resolution (or an annex that forms part of it) contains the operative 8-digit codes **and**
     their gravamen. If it contains only nomenclature, the rates must also come from Law 146-00
     and its later legal instruments;
   - the document carries no reproduction prohibition of its own;
   - nothing in it adopts the DGA edition as the official text, which would carry the prohibition
     over.
2. **Official open-data dataset — none.** No tariff dataset was found on the national open-data
   portal or DGA transparency material, with or without a licence.
3. **Other statutory schedule.** Law 146-00 (Congress, Gaceta Oficial) is covered by art. 41, but
   its annex predates HS 2022. It can supply rates only where Res. 004-2022 maps current codes to
   them. WTO tariff data is not national execution and is not a substitute.
   Third-party copies (Scribd, PDFCoffee, AnyFlip) are unusable.
4. **Explicit DGA permission — none on record.**

**What clears the block if route 1 fails.** Written authorization from the Dirección General de
Aduanas (the notice requires prior DGA authorization). Contact: `ayuda@aduanas.gob.do`. The
authorization would need to permit ClearTrade, commercially, to extract, normalize, retain (with
checksums), and display or redistribute to its customers the tariff codes, national descriptions
and duty rates of the *Arancel de Aduanas 7ma Enmienda 2022* and its updates. Alternatively, a
published open licence of equivalent scope from DGA or Hacienda.

If route 1 fails and no such permission exists: **`BLOCKED_RIGHTS`**.

## Rights gate outcome — 8 October 2026: `BLOCKED_RIGHTS`

**Input.** Res. 004-2022 was inspected from Hacienda's official PDF (by the user). It is an
administrative act with no reproduction prohibition. It carries SA-8 codes and NMF/gravámenes **only
for the modifications it orders**. Its Article Sixth refers separately to communicating "la
nomenclatura arancelaria según la VII Enmienda versión 2022". It is not the complete schedule.

**1. A separate Hacienda publication of the complete nomenclature — not found.** Indexed official
material surfaces only Res. 004-2022 for the 2022 tariff. The complete schedule appears only as the
joint *Ministerio de Hacienda – Dirección General de Aduanas* edition, and that edition carries the
reproduction prohibition. The 2017 (VI Amendment) edition was published the same way, as "Ministerio
de Hacienda – DGA, enero 2017". Residual check that would reopen this item: Hacienda's own *Base
legal* listing (`/transparencia/base-legal-de-la-institucion/`) could not be read from this network
(Cloudflare CAPTCHA). If a browser shows a separate Hacienda nomenclature/annex file there, the gate
reopens.

**2. Statutory reconstruction — not possible.** The chain would have to start at Law 146-00 Annex I
(the full code and gravamen schedule; Arts. 1–2). The official Senate archive copy
(`memoriahistorica.senadord.gob.do`, retained as `ley-146-00-senado-cuerpo.pdf`, SHA-256
`9e499f231048360d28e442ae45e798d12de0c37f8c8ada2ec8c5d9e3d1c4b254`) is the 7-page body **without
Annex I**. No official repository reachable here holds the annex. The intermediate HS-amendment
incorporations (2002, 2007, 2012, 2017) were not located as standalone legal acts. Res. 004-2022
covers only changed lines; every unchanged 2022 line inherits its code, description and rate from
the prior edition, which exists only in the restricted joint edition. Laws 12-01 and 557-05 change
rates but supply no nomenclature.

**3. Completeness cannot be proved without the restricted edition.** All 7,697 operative codes, their
current NMF rates and every intermediate amendment would be needed. The unchanged lines, which are
most of the schedule, have no covered source.

**4. Descriptions.** Law 146-00 art. 1 states the national designation "se basa en la Nomenclatura de
la Versión Única en Español del Sistema Armonizado", which is WCO-derived Spanish text, and DGA
asserts rights in that nomenclature. The Atlas precedent (Japan, Australia, Norway) keeps WCO
material out of scope and normalizes only the authority's own tariff data. Here the authority's
complete national data exists only in the edition with the specific prohibition. Removing
descriptions would not cure that, because codes and rates for unchanged lines come from the same
restricted source.

**Result: outcome C — `BLOCKED_RIGHTS`.** The complete current tariff inevitably requires DGA's
restricted joint edition.

**Unblocker (any one):**
- Written authorization from the Dirección General de Aduanas, with Ministerio de Hacienda as
  co-publisher of the edition (`ayuda@aduanas.gob.do`). It would need to permit ClearTrade to
  commercially extract, normalize, retain (checksummed copies), update, and display or redistribute
  to its customers the national tariff codes, national descriptions and duty rates of the *Arancel
  de Aduanas 7ma Enmienda 2022* and its later editions. It should state how the WCO Spanish HS text
  is treated: Atlas excludes WCO explanatory material.
- An explicit commercial or open licence of equivalent scope published by DGA or Hacienda.
- An official Hacienda publication of the complete nomenclature and rates without a reproduction
  prohibition (see the residual check above).

Do not re-request the manual bundle (remedies, TRQs, avisos, Gaceta) until one of these exists.

## Unchanged positions (source-confirmed, carried forward)

- India: no Dominican tariff-preference instrument with India. The 2025 AEO mutual-recognition
  arrangement is trade facilitation, not preferential origin. Expected `not_applicable`. Origin
  `IN` never activates a preference.
- Rights (superseded 7 Oct, see above): Law 65-00 art. 41 permits reproduction of laws, decrees, regulations and administrative
  acts with source identification and textual fidelity. The DGA portal's generic IP terms do not
  remove that permission for covered official instruments, and do not extend it to unrelated
  portal material.
