# Logistics Feasibility evidence contract

`logistics-feasibility-v1` fills the existing 10% Demand Discovery component. It uses
normalized `LogisticsRouteEvidence`; it never generates routes, rates, or transit times.

Configured subweights are route feasibility/redundancy 35%, transit compatibility 25%,
freight burden 25%, and product/mode compatibility 15%. Missing subfactors are omitted and
their weights renormalize. Component confidence is the available-weight share multiplied by
provider evidence confidence; that confidence also affects the separate assessment confidence.

Evidence preserves exporter pickup geography/code, preferred origin gateway, destination
country/port, transport mode, availability, transit range, provider/reference/version,
retrieval and validity dates, equipment assumption, explicit constraint support, and—where
present—freight amount, currency, rate basis, quote timestamps, and assumed shipment value.

Transit compatibility uses:

`transit allowance = end-to-end delivery commitment - production lead time`

The fields remain separate in Product and discovery snapshots. No production time is called
transit time or vice versa.

Freight burden is sourceable only for a fresh `per_shipment` quote with an explicitly recorded
shipment-value assumption in the same currency. No FX, container utilization, load factor, or
margin is inferred. A stale freight quote is excluded while independently current route and
transit evidence can remain usable.

Product compatibility contributes only after logistics constraints have explicitly been
confirmed. A route must declare support for every recorded constraint code; absence is not
treated as compatibility.

## Current source coverage

No live carrier, freight marketplace, port-pair schedule, or official routing provider is
connected in this repository. Consequently, production Logistics Feasibility remains
unavailable until operator-reviewed evidence with a real provider and source reference is
loaded. The implementation supplies the normalized storage, environment isolation, scoring,
freshness enforcement, provenance, and tests; it does not claim country, port, rate, or route
coverage that does not exist.

