# Authority packs, implementation waves, and canary selection

Ranking is `coverage-optimizer.md`'s output, filtered to remove every `D_blocked` source
regardless of its raw score (Switzerland, Saudi, Kuwait, the GCC and EAEU family rollups) — a
blocked source is not "low priority," it is not buildable at all until its licence question is
resolved, and does not belong in a build-order list.

## Authority packs

Each pack is what one engineering effort actually produces. A pack's "destinations unlocked"
counts only what the underlying research supports — never a bloc's full membership on the strength
of a shared nomenclature alone (see `source-families.md`).

| Pack ID | Family | Destinations unlocked | Source(s) | Acquisition | Licensing state | Modules | Complexity | Eng. estimate | Maint. estimate | Dependencies |
|---|---|---|---|---|---|---|---|---|---|---|
| P-CA | national | Canada | CBSA annual XLSX/PDF release | file ingest (authoritative-manual pattern, like TARIC) | **high** — OGL-Canada 2.0 confirmed commercial-permissive | tariff strong; preference partial (FTA columns per line); RoO/quota/regulatory unknown | medium | medium | low | none |
| P-NZ | national | New Zealand | data.govt.nz CusMod Tariff/Concession API | live API, 24h refresh | medium — licence listed "other, check with agency"; **licence confirmation is the pack's first task, not its last** | tariff strong; rest unknown | low–medium | low | low | licence confirmation email |
| P-KR | national | South Korea | data.go.kr HSK classification API | live API, registration required | medium — KOGL is multi-tier; **must confirm this specific dataset's KOGL type before acquisition**, not assume the platform's general openness | tariff partial; rest unknown | medium | medium | medium | KOGL-type confirmation |
| P-AE | GCC (anchor) | UAE (1; template for the bloc) | Dubai Pulse open-data tariff dataset | structured API/dataset | medium — general Dubai Pulse licence confirmed commercial-permissive with attribution; the specific tariff dataset's licence page not individually re-checked | tariff partial; rest unknown | medium | medium | medium | none (GCC follow-ons depend on this) |
| P-SG | ASEAN_AHTN (anchor) | Singapore (1; template for AHTN concordance) | Tariff Finder / HS-CA Product Code Checker | structured web (no confirmed API) | unresolved | tariff strong; import-control/certification partial | medium | medium | medium | none (AHTN follow-ons benefit from its concordance work) |
| P-JP | national | Japan | dated tariff-schedule releases (customs.go.jp) | structured HTML/PDF per dated release, authoritative-manual pattern | unresolved | tariff strong; rest unknown | medium–high | medium | medium | none |
| P-BR | MERCOSUR (anchor) | Brazil (1; NCM template) | Portal Único de Comércio Exterior API surface | live API (scope/auth unconfirmed) | unresolved | tariff strong (NCM); rest unknown | high (LETEC exception handling from day one) | high | medium | none |
| P-ZA | SACU (anchor) | South Africa (1 now; 4 more as cheap follow-ons: BW/SZ/LS/NA) | SARS Schedule 1 Part 1 (~700pp PDF) | authoritative-manual file parse | unresolved | tariff strong; trade remedies present (Schedule 2); rest unknown | high (large document) | high | medium | none for ZA; BW/SZ/LS/NA depend on ZA's override-layer design |
| P-CH-pending | national | Switzerland | opendata.swiss Tares API | live API | **blocked** — commercial use requires the data owner's written permission | tariff strong (best module breadth researched, non-EU) | low (once permitted) | low | low | **written permission from FOCBS** |
| P-AU | national | Australia | Working Tariff (PDF) | authoritative-manual file parse | unresolved | tariff strong; rest unknown | high | high | high | none |
| P-MX | national | Mexico | SIAVI web platform (Spanish) | structured web, no API found | unresolved | tariff strong; rest unknown | high | high | medium | none |

## Implementation waves

### Wave 1 — highest-value packs (7)

**P-CA, P-NZ, P-KR, P-AE, P-SG, P-JP, P-BR** — the top-scoring non-blocked candidates from the
optimizer, chosen to also seed one template each for GCC (P-AE), ASEAN/AHTN (P-SG) and MERCOSUR
(P-BR) so their respective families' Wave 2 follow-ons are cheaper.

- **Cumulative destinations reached: 36** (29 already integrated + 7).
- **Tariff (MFN) coverage:** likely strong for all seven — every one has a confirmed national
  schedule of record. Not yet proven machine-parseable end to end for any of them.
- **Preference coverage:** partial at best (Canada's per-line FTA columns are the most promising
  finding); unconfirmed for the rest.
- **RoO coverage:** unconfirmed for all seven. This is a real gap — see Part 12 below.
- **Regulatory coverage:** unconfirmed for all seven, and per the existing `EvidenceCompletenessStatus`
  contract, "unconfirmed" must ship as "not proven complete," never as "no regulation exists."
- **Engineering burden:** medium overall; P-BR (LETEC from day one) and P-ZA-scale documents are
  the heavier builds, not represented in this wave.
- **Maintenance burden:** low–medium; P-NZ and P-KR carry a genuine risk of becoming blocked
  *after* being built if their licence questions resolve unfavourably — sequence their licence
  confirmation before any parser work, not after.

### Wave 2 — regional/customs-union leverage (11)

**P-ZA's four SACU follow-ons** (Botswana, Eswatini, Lesotho, Namibia) **+ ASEAN/AHTN follow-ons**
(Philippines, Malaysia, Vietnam — already researched to `B_structured_web`, each its own national
acquisition) **+ MERCOSUR follow-ons** (Argentina, Paraguay, Uruguay, each requiring its own LETEC
exception-list verification against Brazil's TEC baseline) **+ South Africa itself** (the SACU
anchor, scored lower than the Wave-1 cut on the optimizer's numbers but placed here deliberately
because its value is the four-country follow-on, not its solo score).

- **Cumulative destinations reached: 47.**
- Every follow-on in this wave is cheaper *in design* than its Wave-1 anchor (shared nomenclature
  or shared rate), never cheaper in *acquisition* — each is still a separate integration, per
  `source-families.md`.
- **Regulatory coverage:** still not claimed complete for any destination in this wave.

### Wave 3 — remaining high-value individual authorities (up to 10)

Australia, Mexico, Israel, Türkiye, China, Thailand, Indonesia, plus GCC's remaining licence-
permitting members (Qatar, Bahrain, Oman) **contingent on P-AE's licence finding actually holding**
for the platform generally, checked per state.

- **Cumulative destinations reached: up to 57.**
- China is included at reduced confidence: `C_manual_authoritative`, licensing unresolved with the
  weakest presumption-of-openness of any government source researched (see `licensing-risks.md`).
- Thailand and Indonesia were never individually researched this pass (see
  `destination-universe.json`) — their Wave 3 placement rests on the ASEAN/AHTN family finding,
  not on direct evidence, and each needs its own pass before being scheduled for real.

### Wave 4 — long tail toward 120+

Everything else in `destination-universe.json`: the ECOWAS members beyond Nigeria/Ghana, the EAC
members beyond Kenya, the Middle East destinations outside the GCC (Egypt, Jordan, Iraq, Lebanon,
Iran), South Asia (Bangladesh, Sri Lanka, Nepal, Pakistan), the remaining Latin American and
Sub-Saharan African destinations, Hong Kong/Taiwan, and the EAEU family (deprioritized on both data
availability and geopolitical grounds, not merely queued).

Almost every destination in this wave is `research_status: "unresolved"` — Wave 4 is explicitly
"go research this properly before scheduling it," not "build these next." Reaching 120+ genuinely
covered destinations requires several more research passes at the depth this document gave Wave
1–3, not a mechanical continuation of this pass's remaining budget.

## Canary selection (Wave 1, but flagged first)

**Canada, UAE, Brazil, Japan.**

Chosen from Wave 1 to stress different architecture dimensions rather than because they were
suggested in advance:

| Canary | Primary stress dimension |
|---|---|
| Canada | File-release ingestion (authoritative-manual pattern, like TARIC); per-line FTA preference columns — a genuine **no-India-preference** case, since no India–Canada FTA-style arrangement is in force, which is exactly the honest-negative path the architecture must prove it can represent without inventing a preference |
| Japan | File/dated-release ingestion via a DIFFERENT mechanism than Canada's (structured HTML per dated URL, not one downloadable archive); strongest effective-date/historical-versioning candidate researched (each release keeps its own permanent URL) |
| UAE | Live structured-API/dataset acquisition (Dubai Pulse); a second national-tariff-line refinement shape (12-digit GCC) distinct from Canada's 8-digit and Japan's 9-digit; the first real test of whether the GCC's harmonised code *structure* actually yields a transferable parser design, per `source-families.md`'s central finding about that bloc |
| Brazil | Live API acquisition via a different platform (Portal Único) than UAE's; forces the national-override-layer question immediately, because MERCOSUR's LETEC exceptions mean "read the TEC rate" is not sufficient — Brazil is the one Wave-1 canary that cannot be built without the override layer from day one |

**What none of the four canaries confirm, and must not be assumed:** specific-duty representation,
compound/mixed-duty representation, and quota-conditioned representation are `"unknown"` in the
registry for all four — not researched deeply enough this pass to say either way. The correct next
step per canary, before writing a parser, is exactly what `vendor-qualification.ts` already
enforces for licensed content: run the real payload through the same discriminator questions that
disqualified TRAINS (does a non-ad-valorem line collapse to zero or a percentage? is a quota
presented as unconditional?) before trusting it. Observed-zero (a genuine 0% MFN line) is expected
to be present and testable in all four, since duty-free treatment on some manufactured-goods lines
is common in every developed-market schedule researched.

## Architecture pressure discovered (Part 12 — report only, no changes made)

The `MarketAccessAdapter` contract formalised in the previous checkpoint (`347160e`) assumes a
per-HS6, per-destination, live-or-file call returning one `MarketAccessIngestResult`. Real sources
researched this pass press on that assumption in three specific ways:

1. **Whole-country/whole-release acquisition, not per-HS6 lookup.** Canada's annual file, Japan's
   dated releases, and South Africa's Schedule 1 PDF are each a **complete national tariff
   release** covering every HS line at once — the same shape TARIC already handles by importing
   one release and resolving many HS6 requests against it in memory. The `MarketAccessAdapter`
   interface itself is fine (it is called per-request); what it assumes is that *acquisition*
   happens per-call, which is false for every file-delivered source found. This is not a new
   problem — TARIC already solved it with its own `TaricRelease` model — but it means the *next*
   file-delivered source (Canada, Japan, South Africa) needs the same release-management shape
   TARIC has, and that shape is not yet generalised for reuse. This is the concrete evidence behind
   the "generalise `TaricRelease`" item already flagged in the prior audit's gap matrix.
2. **Multi-destination source families need a source-level identity distinct from a
   destination-level one.** UAE's dataset and Brazil's API are structurally single-destination
   today, but the GCC and MERCOSUR findings mean a **second** state (Qatar, or Argentina) sharing
   the *same underlying acquisition mechanism* with its *own* national exceptions is a realistic
   near-term case (Wave 2/3), and the current contract has no place to express "this release covers
   several destinations, with per-destination overrides" the way TARIC's EU-member handling already
   does for one specific family. TARIC's own pattern — one release, many destinations resolved
   against it — is the template; it has not yet been asked to generalise beyond the EU.
3. **National tariff-line refinement must accept more code shapes than TARIC/UK/US established.**
   The existing `resolveNationalTariffLine`/`ClassificationResolutionResult` machinery is generic
   over "some national code beneath an HS6," which is sound — but the digit counts and structures
   in scope now (Canada's 8-digit tariff item, Japan's 9-digit statistical code, the GCC's 12-digit
   structure, MERCOSUR's 8-digit NCM) are all genuinely different code systems, not variations on
   one. Nothing found this pass suggests the existing `NationalCodeSystem` type (currently
   `'UK_COMMODITY' | 'EU_TARIC' | 'US_HTS' | 'GCC_INTEGRATED'`) is structurally wrong — it already
   anticipated GCC — but it will need a new member per family (`CA_TARIFF_ITEM`, `JP_STATISTICAL`,
   `MERCOSUR_NCM`, and so on) as each pack is actually built. Not a redesign; an enumeration that
   grows with real work, exactly as intended.

No source researched this pass revealed a case the current contract cannot express in principle.
The pressure is entirely about **acquisition and release management for file-delivered sources**,
which TARIC already answers — the open work is generalising that answer, not inventing a new one.
