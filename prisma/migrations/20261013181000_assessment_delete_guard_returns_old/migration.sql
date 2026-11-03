-- Fix: the MarketAssessment lineage guard silently cancelled every delete of a non-v4 row.
--
-- `protect_country_truth_assessment_lineage()` (20260829120000) runs BEFORE UPDATE OR DELETE and
-- ended with `RETURN NEW` on every path. In a BEFORE DELETE trigger NEW is NULL, and returning NULL
-- skips the row without an error. So since that migration:
--   - a discovery retry's `deleteMany({ run_id })` deleted nothing and appended a second result set;
--   - deleting a run, product or organisation cascaded to its assessments, the cascade was
--     skipped, and the assessments were left pointing at a run that no longer exists.
-- Only v4 rows were ever meant to be protected (the function's own condition). This keeps every v4
-- protection exactly as it was and lets the other deletes proceed. It deletes nothing itself; any
-- rows already orphaned are left for an explicit, reviewed clean-up.
CREATE OR REPLACE FUNCTION protect_country_truth_assessment_lineage() RETURNS trigger AS $$
BEGIN
  IF OLD."model_version" = 'market-attractiveness-v4' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Country Truth v4 assessments are immutable history and are never deleted';
    END IF;
    IF
      (OLD."run_id", OLD."product_id", OLD."country_code", OLD."overall_score", OLD."demand_score",
       OLD."growth_score", OLD."competition_score", OLD."market_access_score",
       OLD."export_economics_score", OLD."exporter_market_fit_score",
       OLD."logistics_feasibility_score", OLD."risk_resilience_score", OLD."confidence_score",
       OLD."eligibility_status", OLD."eligibility_reasons", OLD."model_version",
       OLD."weight_profile_key", OLD."weight_profile_version", OLD."as_of_date",
       OLD."scoring_policy_version", OLD."scoring_policy_hash", OLD."scoring_policy_snapshot",
       OLD."reproducibility_status", OLD."evidence_origins", OLD."india_share",
       OLD."classification_id", OLD."classification_hs6_code", OLD."classification_itc_hs_code",
       OLD."classification_nomenclature", OLD."classification_version", OLD."tariff_summary",
       OLD."certification_requirements", OLD."logistics_summary", OLD."price_band_min",
       OLD."price_band_max", OLD."price_band_currency", OLD."rationale", OLD."field_provenance",
       OLD."generated_at", OLD."country_trade_metrics_id", OLD."country_trade_metrics_checksum",
       OLD."country_evidence_manifest_id", OLD."country_evidence_manifest_checksum",
       OLD."country_metric_policy_version", OLD."country_metric_policy_hash",
       OLD."country_truth_period_set", OLD."country_truth_as_of_date",
       OLD."country_truth_assessment_state", OLD."assessment_checksum", OLD."assessment_identity",
       OLD."country_truth_fact_snapshot_id", OLD."country_truth_fact_snapshot_checksum")
      IS DISTINCT FROM
      (NEW."run_id", NEW."product_id", NEW."country_code", NEW."overall_score", NEW."demand_score",
       NEW."growth_score", NEW."competition_score", NEW."market_access_score",
       NEW."export_economics_score", NEW."exporter_market_fit_score",
       NEW."logistics_feasibility_score", NEW."risk_resilience_score", NEW."confidence_score",
       NEW."eligibility_status", NEW."eligibility_reasons", NEW."model_version",
       NEW."weight_profile_key", NEW."weight_profile_version", NEW."as_of_date",
       NEW."scoring_policy_version", NEW."scoring_policy_hash", NEW."scoring_policy_snapshot",
       NEW."reproducibility_status", NEW."evidence_origins", NEW."india_share",
       NEW."classification_id", NEW."classification_hs6_code", NEW."classification_itc_hs_code",
       NEW."classification_nomenclature", NEW."classification_version", NEW."tariff_summary",
       NEW."certification_requirements", NEW."logistics_summary", NEW."price_band_min",
       NEW."price_band_max", NEW."price_band_currency", NEW."rationale", NEW."field_provenance",
       NEW."generated_at", NEW."country_trade_metrics_id", NEW."country_trade_metrics_checksum",
       NEW."country_evidence_manifest_id", NEW."country_evidence_manifest_checksum",
       NEW."country_metric_policy_version", NEW."country_metric_policy_hash",
       NEW."country_truth_period_set", NEW."country_truth_as_of_date",
       NEW."country_truth_assessment_state", NEW."assessment_checksum", NEW."assessment_identity",
       NEW."country_truth_fact_snapshot_id", NEW."country_truth_fact_snapshot_checksum")
    THEN
      RAISE EXCEPTION 'Country Truth v4 assessment scores, identity and lineage are immutable';
    END IF;
  END IF;
  -- A BEFORE DELETE trigger must return OLD to let the delete proceed; NEW is NULL there.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
