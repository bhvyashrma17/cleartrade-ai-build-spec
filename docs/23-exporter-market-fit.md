# Contextual Exporter-Market Fit evidence contract

`exporter-market-fit-v1` fills the existing 15% Demand Discovery component. Fit is calculated
inside one candidate assessment from exporter/Product capabilities plus destination/HS evidence.
It is never stored as a global Product score.

Configured subweights are order-size fit 20%, capacity/MOQ fit 20%, certification fit 25%,
production lead-time fit 15%, customization relevance/readiness 10%, and packaging/compliance
relevance/readiness 10%. Only subfactors with both sides of the comparison contribute; available
weights renormalize and missing subfactors lower component and assessment confidence.

`ExporterMarketFitBenchmark` preserves destination, HS scope, benchmark type/range/unit/currency,
provider and source reference/version, observation and retrieval dates, validity, confidence,
evidence origin, and optional raw evidence. No connected source currently populates these rows.

Evidence rules:

- Desired order value is compared only with a same-currency sourced destination order-value range.
- Capacity and MOQ require a destination order-quantity range and the same recognized quantity
  unit across all three values. No conversions are inferred.
- Certification requirements come from current verified mandatory-certification Market Access
  evidence. Product certification state distinguishes held with evidence, held without evidence,
  in progress, expired, not started/absent. A held certification past `valid_until` is expired.
- An unobtainable missing mandatory certification remains a hard eligibility blocker before fit.
- Production lead time requires a destination production-time maximum. Transit remains Logistics.
- Customization and packaging contribute only when a current destination benchmark marks them
  relevant. Existing Product text is treated as a self-reported readiness claim, with reduced
  evidence confidence—not proof of exact regulatory compliance.

The former shortcuts—desired order value divided by annual imports and certification readiness
without a destination requirement—were removed because they did not measure contextual fit.

## Current source coverage

Certification fit is operational where complete Market Access evidence contains mandatory
certification requirements. Order value/quantity, lead-time, customization, and packaging remain
unavailable until a legitimate market/customer benchmark source is connected. CBP manifest
package counts are not used as product order quantities.

