# Demand Discovery v3 correctness contract

`market-attractiveness-v3` corrects three material semantics in v2 and therefore does not
silently replace historical v2 assessments.

- Demand Strength no longer labels a locally observed reporter denominator as global. The
  implemented metric is `candidate_market_share`, calculated against the fixed, unfiltered
  set of reporter/world totals held for the same HS6 and year. Target-country filters and
  the volume floor do not alter that denominator. It remains explicitly partial; a future
  `global_import_share` may be used only with a complete authoritative denominator.
- Supplier HHI contributes only when an immutable `SupplierCoverageAssertion` reconciles
  non-world partner values to the reporter/world total within the versioned coverage range
  and meets the minimum partner count. Otherwise HHI is unavailable; India share remains an
  independent Competition subfactor and the subweights renormalize.
- Confidence recency uses the assessment's frozen `as_of_date`, annual reporting lag, and
  the versioned `comtrade-reporting-lag-v1` freshness policy. It is not relative to the best
  year present in the candidate set.

Every new run and assessment stores the full effective scoring policy, configuration
version, deterministic SHA-256 policy hash, and `reproducibility_status=reproducible`.
Scoring dispatch is explicit for v2 and v3. Assessments created before policy freezing stay
`legacy_non_recomputable`; no current policy is invented for them.

Market Access snapshots now carry the shared evidence origin, provider/dataset identity,
optional source-run identity, and raw-response checksum. Existing snapshots were migrated
conservatively to `unknown_legacy`. Staging/production selection accepts only approved real
origins and still requires complete, fresh, unexpired tariff and regulatory coverage.

Current limitation: the existing authenticated Comtrade warehouse does not prove complete
global reporter coverage or complete partner coverage. The system therefore reports a
candidate-market share and normally leaves HHI unavailable for the small authenticated
smoke-test datasets. That loss of apparent coverage is intentional correctness behavior.
