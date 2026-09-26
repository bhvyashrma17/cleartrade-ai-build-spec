# Customs Atlas wave: Guatemala and El Salvador — 27 September 2026

**Starting checkpoint:** `29e4d30`
**Scope:** Guatemala (all gates SOURCE_CONFIRMED) and El Salvador (SOURCE_CONFIRMED, plus one
RESEARCH_REQUIRED question: the effect of the 11 May 2023 latex-paint sunset review). A confirmed source
that failed stopped the country at that gate, and no replacement sources were hunted. No authority was
contacted. No Railway or production operation ran.

**Result:** 0 locally qualified; 2 blocked at the base-tariff gate.

- Staging-pending sovereign count: **10**, unchanged.
- Potential after Railway: **55**, unchanged.
- Accepted: **45**, unchanged.

Both fail-closed entries in `unconfigured-sources.ts` now record the findings below.

## Shared finding: SIECA is blocked

`www.sieca.int` (the Arancel Centroamericano de Importación, version 6, and the SAC legal tariff) answers
**HTTP 403 from its AWS load balancer for every path, including `robots.txt`**. That is a site-level block of
the qualification environment, and it was not circumvented. It removes the regional legal base for both
countries.

## Guatemala (`GT`) — `BLOCKED_SOURCE`

- **SIECA ACI:** HTTP 403 site-wide, as above.
- **SAT Arancel Integrado** (`portal.sat.gob.gt`): **Cloudflare challenge** (`challenge-platform`, HTTP 403).
  Not bypassed.
- **MINECO:** the DACE host does not connect, and the main site publishes no tariff.
- **Consequence:** there is no acquirable tariff base, and national overlays (2026 preferential schedules,
  quota instruments) cannot substitute for one. The remaining gates (currentness, remedies, India, rights,
  quotas) were not exercised.
- **Remedy note (source map, not re-verified):** DACE/ADP.01-2024, galvanized steel from China, was closed
  by Resolution 000627 (1 October 2025) without a finding of dumping. It is an investigation, not a duty.

## El Salvador (`SV`) — `BLOCKED_SOURCE`

- **National tariff:** DGA's SAC Electrónico (`aduana2.mh.gob.sv/SAC`) is an **Angular application** ("Please
  enable JavaScript…") over undocumented backend calls. Those calls were not used.
- **Lawful fallback:** rebuilding from SIECA legal material plus DGA dispositions is closed by the SIECA
  block. DGA's site exposes no tariff document.
- **Currentness note:** DGA has issued dispositions after DGA-001/002-2026 (DGA-010, DGA-011 with Annex III,
  DGA-012). A future build must review them.

### RESEARCH_REQUIRED result: 11 May 2023 latex-paint sunset review

**Source.** Resolución Definitiva, Examen Quinquenal ED-DATCO-2-ADP-2016, dated 11 May 2023, signed by the
Minister of Economy. It is an official scanned PDF on MINEC InfoTrade (25 pages, SHA-256
`ad46564bb779d245afb07e31e48b46e4222e269ca3468f7f18e8b6731569153a`), read by OCR of its operative section.

- **Legal effect:** **continued ("Prorrogar")** for five years, **12 May 2023 to 12 May 2028** (Resuelve II).
- **Scope:** standard-quality architectural latex paint originating in the **United States**, regardless of
  the country of provenance, classified in **SAC 3209.10.90.00 and 3209.90.10.00**.
- **Conditions (Resuelve II):** the exporter declared is **GDB INTERNATIONAL, INC.**, and the declared **FOB
  value is below US$5.12 per gallon**.
- **Duty:** a complementary **376% ad valorem on the declared FOB value**, applied in addition to the MFN or
  FTA tariff.
- **Resuelve III:** DGA applies it to standard-quality latex paint declared below US$5.12/gal FOB. Product
  declared "Premium" but below that FOB is also subject.
- **Resuelve IV:** it applies whatever the importer.
- **Price undertaking:** none. The procedure was declared concluded (Resuelve VII).
- **Later instruments:** InfoTrade's case file lists nothing after the 2023 resolution.
- **Modelling rule:** this is a **conditional, threshold- and exporter-dependent** measure. It must never be
  flattened into an unconditional 376% rate. It needs FOB-per-gallon and exporter evidence.
- **Unresolved:** a second InfoTrade case, fluid UHT milk from Costa Rica (DATCO-3-ADP, definitive resolution
  17 May 2019), was not read, because the base gate had already failed.
