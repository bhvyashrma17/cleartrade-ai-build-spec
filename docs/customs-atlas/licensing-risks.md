# Licensing discipline — findings, not inferences

The three rules this document holds itself to: publicly viewable is not reusable, an open API is
not automatically redistributable, and an open-source code mirror is never the evidence source. No
GitHub mirror was used as a source in this research — every finding traces to the authority's own
site or a source directly quoting it. Unknown stays unknown; nothing here infers permission from
silence.

Each authority is classified across the seven rights dimensions the task asked for — commercial
use, automated retrieval, caching/raw retention, derived-data use, customer display,
redistribution, attribution — with `unresolved` as the default whenever a search did not surface
an explicit statement, never `permitted`.

## Confirmed permissive (rare, and worth naming precisely)

- **Canada — Open Government Licence 2.0.** Directly quoted: "worldwide, royalty-free, perpetual,
  non-exclusive licence to use the Information, including for commercial purposes." Requires
  attribution; excludes third-party IP, official marks/symbols, patents. This is the cleanest
  licensing finding of the entire pass.
- **United Arab Emirates — UAE Federal Open Data License (Dubai Pulse).** Directly quoted: "free to
  exploit the information for both commercial and non-commercial purposes," with attribution, no
  implied endorsement, no misleading use, images/trademarks excluded. Strong, but the specific
  customs-tariff dataset page was not individually re-checked against this general platform
  finding — confirm before building.
- **United States — 17 U.S.C. §105 public domain.** Already the basis for the existing USITC
  integration; U.S. government works carry no domestic copyright by default.

## Confirmed blocked (the WTO/TRAINS pattern repeats)

- **WTO** (Step 2 finding, restated for completeness): commercial use requires the WTO's written
  permission. Recorded in `src/lib/market-access/unconfigured-sources.ts`.
- **UNCTAD TRAINS via WITS** (Step 2 finding): re-dissemination terms deferred to an UNCTAD
  document that does not state them; also structurally unsuitable as a duty-of-record regardless.
- **Switzerland — opendata.swiss.** Directly quoted: attribution required, and "commercial use
  requires permission from the data owner." Same shape as WTO — a real, well-documented API sitting
  behind a permission precondition, not a technical gap.
- **Saudi Arabia — ZATCA.** Already recorded as `D_blocked` in `unconfigured-sources.ts`: no
  documented public interface, only undocumented private browser endpoints.

## Confirmed as requiring per-dataset (not per-platform) verification — the most dangerous middle case

- **South Korea — KOGL.** The Korea Open Government License has multiple types. The general rule
  found: "works shall be used only for nonprofit purposes... it is possible to use for commercial
  purpose with special permissions." A public-data platform's overall reputation for openness
  (data.go.kr genuinely is one of the largest and most active open-data programs in the world) does
  **not** mean any specific dataset on it carries the permissive KOGL type. This is the single most
  important licensing lesson of this pass: **platform-level openness reputation must never
  substitute for dataset-level licence confirmation.**
- **New Zealand — data.govt.nz.** The tariff-classifications-rates dataset is explicitly tagged
  "Other (check with source agency)" rather than a standard open licence, despite sitting on a
  generally open government data portal. Same lesson as Korea, from the opposite direction: the
  platform being open by default does not mean every listing inherits that default.

## Unresolved — no licence text located this pass (the majority)

Japan, Australia, Israel, Singapore, Malaysia, Philippines, Vietnam, Brazil, Mexico, Türkiye,
China, South Africa, and every regional-family rollup except the four cases above. This is not
evidence of restriction — it is evidence that a search pass did not reach the relevant page or
that the authority does not publish explicit terms at all, which is itself common for a
government website that has simply never been asked the question. Each requires a direct check
(usually a dedicated terms/legal page, or a written enquiry to the publishing agency) before any
integration decision, exactly like Canada, UAE and Korea required before their status above could
be stated with any confidence.

## China — flagged separately

Not classified as blocked, because no explicit blocking statement was found — but also not given
the benefit of the doubt the UK/Canada/US/EU government-openness convention would normally extend.
PRC government data is not presumed open by the same default as Five-Eyes/EU government data; the
existence of a public lookup tool says nothing about redistribution rights. Recorded as
`licensing_certainty: "medium"` (an authority genuinely exists and is high-quality) with
`commercial_use_status: "unresolved"` and an explicit note not to infer permission — this
combination deliberately signals "do not treat this the way Canada's finding reads," despite both
carrying the same `unresolved` label mechanically in a few adjacent fields.

## The discipline this document is trying to hold

A source scoring well on `authority_quality` or `machine_readability` in `coverage-optimizer.md`
says nothing about whether ClearTrade may actually use it. Every pack in `implementation-waves.md`
still needs its licence status resolved to `permitted` or `permitted_with_attribution` — confirmed,
not assumed from a platform's reputation or a country's general government-openness posture —
before the first line of connector code is written for it.
