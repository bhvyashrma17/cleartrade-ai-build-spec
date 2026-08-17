# Market Access evidence

Market Access is available only from a current `COMPLETE` evidence snapshot covering both tariffs and regulatory measures for the assessment's exact HS6 scope. Missing, partial, stale, superseded, low-confidence, or needs-review evidence returns unavailable and the component's ten-percent weight redistributes.

The connected jurisdiction is Great Britain (`GB`) only. Its authority is HM Revenue & Customs' UK Integrated Online Tariff v2 API. The connector resolves HS6 to every current declarable UK commodity line, preserves each official JSON response and checksum, extracts third-country duty, accepts an India preference only when the API directly identifies India, and records applicable controls/document conditions. Unresolved geographic-group membership, compound/non-ad-valorem duty expressions, or inconsistent national subdivisions make coverage partial or fail ingestion.

Formula `market-access-v1` is versioned in `discovery.scoring`: 70% applicable verified ad-valorem tariff burden and 30% verified regulatory burden. The regulatory portion applies configured penalties only for evidenced restrictions, mandatory certification/document requirements, and material non-tariff measures. No evidence means unavailable, never a neutral score.

An unconditional verified import prohibition, or a mandatory requirement explicitly evidenced as unobtainable and not held by the exporter, is evaluated before scoring and makes the market ineligible.

No US, EU, or other jurisdiction is currently supported. Those markets continue to return Market Access unavailable until an authoritative adapter and completeness policy are implemented and validated.
