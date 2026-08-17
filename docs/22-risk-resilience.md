# Risk & Resilience evidence contract

`risk-resilience-v1` fills the existing 5% Demand Discovery component. It is a soft
commercial-resilience score and is evaluated only after hard legal eligibility. Sanctions,
trade prohibitions, and unobtainable mandatory certification remain hard filters and never
become point penalties.

## Operational formula

- Demand stability: 60%. Standard deviation of consecutive annual import-growth rates from
  provenance-preserving TradeFlow observations. At least four consecutive annual observations
  are required and the newest observation must be within the configured lag tolerance.
- Macro resilience: 20%, when a current supported `index_0_100` risk signal is available.
- Payment/country-risk resilience: 20%, on the same evidence contract.

Available subweights renormalize. Signal inputs must be verified, current, confidence 0.8 or
higher, use `linear_0_100_risk_inverse_v1`, and preserve provider, reference, source version,
metric, observation date/period, retrieval time, validity, unit, and normalization method.
Unsupported or stale signals do not contribute. Missing dimensions reduce component confidence,
and component confidence feeds the separate MarketAssessment confidence score.

## Double-counting boundary

- Current supplier HHI and India share remain exclusively in Competitive Opportunity.
- Route availability, redundancy, transit, and freight remain exclusively in Logistics.
- Tariffs and regulatory requirements remain in Market Access.
- Exporter price plausibility and tariff burden remain in Export Economics.

`MarketRiskSignal` can retain `supplier_dependency` and `route_fragility` observations for future
model versions, but v1 intentionally does not score them. Reusing current HHI or the same route
record here would penalize identical evidence twice. Demand stability is distinct from Growth:
Growth scores direction and momentum; Risk scores dispersion around that trend.

## Current source coverage

Demand stability is operational for markets with sufficient allowed TradeFlow history. No live
macro-volatility or payment/country-risk provider is connected in this repository, so those
subfactors remain unavailable and the 60% demand-stability weight renormalizes when it qualifies.
No generic country assumptions or LLM output enter the score.

