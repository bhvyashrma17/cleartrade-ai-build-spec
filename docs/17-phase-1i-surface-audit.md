# Phase 1I — existing product-surface audit

Taken at `dea9bb2`, before any Phase 1I edit. Every row is a surface that exists today, what
Phase 1I does with it, and why. "Retire" means the code stays reachable for an existing
flow/test but stops being the primary product path; "remove later" means nothing new should
point at it and a later phase deletes it.

## Exporter surfaces

| Surface | Verdict | Why |
| --- | --- | --- |
| `/app/markets` (`MarketsPage`) | **Replace** | The tier-branching Demand Discovery entry. Phase 1I's canonical path starts at a *product*, not at a country search box. Kept as a redirect//pointer into `/app/products` so no bookmark 404s. |
| `markets/DemandDiscovery.tsx` | **Retire** | Free-text product context + country picking. Stage A must not accept client-selected countries. |
| `markets/MarketEstimate.tsx` | **Keep** | Pre-membership acquisition surface (guest/free). Not part of the paid discovery journey and not in scope. |
| `markets/RankedMarketsSample.tsx` | **Keep** | Constant sample shown to unpaid tiers. No live intelligence. |
| `/app/markets/[marketAssessmentId]` | **Migrate** | Real per-market detail, but keyed by assessment id and built on the pre-1H shape. Superseded by `/app/products/[productId]/markets/[country]`. |
| `/app/overview`, `/app/more`, `AppShell` nav | **Migrate** | Links point at `/app/markets`; repoint at `/app/products`. |
| No `/app/products` surface exists | **Build** | The journey's root. Products are only reachable today through agent screens. |

## Agent / ops surfaces

| Surface | Verdict | Why |
| --- | --- | --- |
| `components/agent/CountryAnalysis.tsx` | **Replace** | Hard-codes the three pilot countries as checkboxes and posts them as `candidate_countries`. This is the pilot alias path Phase 1F/1G replaced. |
| `lib/country-truth-ui.ts` | **Replace** | `COUNTRY_TRUTH_PILOT_COUNTRIES` (DE/AE/US) and a 3-entry `COUNTRY_NAMES` map. Country identity must come from the checked-in Comtrade reporter registry, which round-trips all 200+. |
| `/agent/exporters/[exporterOrgId]` | **Keep + extend** | The right home for the agent action surface (Part 11). |
| `api/v1/exporters/[id]/country-truth-discovery` | **Retire** | Pilot request path: takes 1–3 country *names* through an alias table. Kept for the existing test/flow, removed from the product path. |
| `api/v1/exporters/[id]/deep-country-truth` | **Keep** | Canonical Phase 1H entry. Names a completed screening run and a product — no country list. |

## Backend that Phase 1I consumes unchanged

`country-screening/service`, `country-truth-deep-request`, `country-trade-metrics`,
`country-truth-scoring-v4`, `market-access/*`, `classification-refinement`,
`exporter-facts/service`, `country-truth/pillars`. Phase 1I adds **no** scoring and **no**
metric. It projects `MarketAssessment.field_provenance` + `CountryTradeMetrics.metrics_payload`,
both already frozen per assessment.

## Gaps Phase 1I must close

1. **No API route enqueues a global screen.** `enqueueGlobalCountryScreening` is script-only.
2. **No read API for screening results** in exporter language.
3. **Refinement API takes tariff codes and candidate arrays from the browser.** The service
   validates them against the snapshot, but the exporter UI must never handle a tariff code at
   all — it needs an answers-only surface.
4. **`rationale` is raw** (`511317180.09`, `10.734514179614%`). Not exporter-facing prose.
5. **Nothing distinguishes exporter-owned from ClearTrade-owned missing evidence.**
