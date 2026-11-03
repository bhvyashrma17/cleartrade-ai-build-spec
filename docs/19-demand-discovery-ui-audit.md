# Demand Discovery UI audit

Taken at `aeb90e5`, before any edit. Phase 1's intelligence is complete; this records what the
UI does with it today and what each surface becomes.

## Surface matrix

| Surface | Roles | Purpose today | Verdict |
| --- | --- | --- | --- |
| `/app/products` | exporter (paid) | Product list + readiness chips | **Keep** |
| `/app/products/[id]` | exporter | Readiness + scan request | **Redesign** — lead with a summary |
| `/app/products/[id]/markets` | exporter | All analysed markets, flat list | **Redesign** — top 5, then "view all" |
| `/app/products/[id]/markets/[country]` | exporter | Country detail | **Keep** — complexity belongs here |
| `.../classification`, `/compare`, `/facts` | exporter | Focused sub-tasks | **Keep** |
| `/app/markets` + `DemandDiscovery.tsx` | guest/free/paid | Pilot country-search entry | **Retire from nav** — superseded by `/app/products`; kept for the guest estimate |
| `/app/markets/[marketAssessmentId]` | exporter | Pre-1H per-assessment detail | **Retire from nav** — superseded by the country route |
| `agent/exporters/[id]?tab=demand` | agent/ops | Everything at once | **Redesign** — summary → prioritised queue → drill-down |
| `CountryTruthWork.tsx` | agent | **80 undifferentiated tasks in one prose list** | **Replace** |
| `DemandDiscoveryControl.tsx` | agent/ops | 20-row AI-vs-decision table | **Redesign** — keep both columns, move controls behind an overflow |
| `MarketDecisionControls.tsx` | agent/ops | **9 buttons rendered unconditionally** | **Redesign** — 2 primary + overflow, state-aware |
| `MarketScanQueue.tsx` | agent/ops | Pending scan requests | **Keep** — restyle only |
| — | ops/admin | *No Demand Discovery operations overview exists* | **Build** |

## The three defects driving this work

1. **No prioritisation.** `agentCountryTruthWork` emits every ClearTrade-owned action for every
   analysed market: 4 action kinds × 20 markets = up to 80 tasks, ordered by market rank alone.
   An agent is asked to collect freight quotes for Angola before the exporter has expressed any
   interest in Angola. Work must be ordered by *business relevance* — selected market first, then
   agent/exporter-marked, then top-ranked — and the tail must be deferrable rather than demanded.

2. **Unconditional controls.** `MarketDecisionControls` renders all nine actions with no
   awareness of current state, so "Pause automation" and "Resume automation" sit side by side, as
   do "Reject" and "Restore". The decision model already answers this: `bucketFor()` derives
   `active`/`flagged`/`terminal` from the current decision, and the current action tells us
   whether automation is paused. The data was there; the UI ignored it.

3. **No summary.** Every surface opens with its longest list. A product page should answer
   "where is this product, and what needs doing?" in one screen before any list appears.

## Shared-component decision

Exporter and agent currently reimplement market rendering separately. The redesign puts the
presentational pieces in `src/components/discovery/` — `ProductSummary`, `MarketTable`,
`WorkQueue`, `ActionMenu`, `StatRow` — and lets each role *compose* them with different data and
different affordances. Role differences stay in what is passed in, not in duplicated markup.

**UI visibility is not authorization.** Every control removed from a role's view is still refused
server-side; this document changes what is *shown*, never what is *permitted*.

## Preserved semantics

AI recommendation and agent decision remain separate columns and are never merged. A promotion
never alters `overall_score`, `confidence_score` or AI rank — it sets an operational order that is
labelled as such. Attractiveness and evidence confidence keep their distinct visual vocabularies.
`potentially_applicable_requires_origin_proof` and other engineering states never reach an
exporter as raw strings.
