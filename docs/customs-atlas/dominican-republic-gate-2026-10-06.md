# Dominican Republic (DO) — acquisition gate, 6 October 2026

**Status: `MANUAL_ACQUISITION_REQUIRED`.** Not qualified. No provider, parser or route was added.
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

## Unchanged positions (source-confirmed, carried forward)

- India: no Dominican tariff-preference instrument with India. The 2025 AEO mutual-recognition
  arrangement is trade facilitation, not preferential origin. Expected `not_applicable`. Origin
  `IN` never activates a preference.
- Rights: Law 65-00 art. 41 permits reproduction of laws, decrees, regulations and administrative
  acts with source identification and textual fidelity. The DGA portal's generic IP terms do not
  remove that permission for covered official instruments, and do not extend it to unrelated
  portal material.
