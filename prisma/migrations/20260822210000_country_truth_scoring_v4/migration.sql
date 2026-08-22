ALTER TABLE "MarketAssessment"
  ADD COLUMN "country_trade_metrics_id" TEXT,
  ADD COLUMN "country_trade_metrics_checksum" TEXT,
  ADD COLUMN "country_evidence_manifest_id" TEXT,
  ADD COLUMN "country_evidence_manifest_checksum" TEXT,
  ADD COLUMN "country_metric_policy_version" TEXT,
  ADD COLUMN "country_metric_policy_hash" TEXT,
  ADD COLUMN "country_truth_period_set" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "country_truth_as_of_date" TIMESTAMP(3),
  ADD COLUMN "country_truth_assessment_state" TEXT,
  ADD COLUMN "assessment_checksum" TEXT;

CREATE INDEX "MarketAssessment_country_trade_metrics_id_idx" ON "MarketAssessment"("country_trade_metrics_id");
ALTER TABLE "MarketAssessment" ADD CONSTRAINT "MarketAssessment_country_trade_metrics_id_fkey" FOREIGN KEY ("country_trade_metrics_id") REFERENCES "CountryTradeMetrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- v4 lineage is frozen once written. Legacy rows have all fields null and remain untouched.
CREATE FUNCTION protect_country_truth_assessment_lineage() RETURNS trigger AS $$
BEGIN
  IF OLD."model_version" = 'market-attractiveness-v4' AND
     (OLD."country_trade_metrics_id", OLD."country_trade_metrics_checksum", OLD."country_evidence_manifest_id", OLD."country_evidence_manifest_checksum", OLD."country_metric_policy_version", OLD."country_metric_policy_hash", OLD."country_truth_period_set", OLD."country_truth_as_of_date", OLD."scoring_policy_version", OLD."scoring_policy_hash", OLD."scoring_policy_snapshot", OLD."country_truth_assessment_state", OLD."assessment_checksum", OLD."field_provenance", OLD."overall_score", OLD."demand_score", OLD."growth_score", OLD."competition_score", OLD."market_access_score", OLD."export_economics_score", OLD."exporter_market_fit_score", OLD."logistics_feasibility_score", OLD."risk_resilience_score", OLD."confidence_score")
     IS DISTINCT FROM
     (NEW."country_trade_metrics_id", NEW."country_trade_metrics_checksum", NEW."country_evidence_manifest_id", NEW."country_evidence_manifest_checksum", NEW."country_metric_policy_version", NEW."country_metric_policy_hash", NEW."country_truth_period_set", NEW."country_truth_as_of_date", NEW."scoring_policy_version", NEW."scoring_policy_hash", NEW."scoring_policy_snapshot", NEW."country_truth_assessment_state", NEW."assessment_checksum", NEW."field_provenance", NEW."overall_score", NEW."demand_score", NEW."growth_score", NEW."competition_score", NEW."market_access_score", NEW."export_economics_score", NEW."exporter_market_fit_score", NEW."logistics_feasibility_score", NEW."risk_resilience_score", NEW."confidence_score") THEN
    RAISE EXCEPTION 'Country Truth v4 assessment scores and lineage are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "MarketAssessment_country_truth_v4_immutable" BEFORE UPDATE ON "MarketAssessment" FOR EACH ROW EXECUTE FUNCTION protect_country_truth_assessment_lineage();
