-- Phase 1H: immutable non-trade fact manifests and collision-resistant assessment identity.
-- Facts and scores remain separate records. Historical v4 rows are not backfilled or rewritten.

CREATE TYPE "EvidenceAssertionClass" AS ENUM (
  'authoritative_public',
  'exporter_declared',
  'agent_verified',
  'partner_quote',
  'unknown_legacy'
);

ALTER TABLE "MarketAssessment"
  ADD COLUMN "assessment_identity" TEXT,
  ADD COLUMN "country_truth_fact_snapshot_id" TEXT,
  ADD COLUMN "country_truth_fact_snapshot_checksum" TEXT;

CREATE UNIQUE INDEX "MarketAssessment_assessment_identity_key"
  ON "MarketAssessment"("assessment_identity");
CREATE INDEX "MarketAssessment_country_truth_fact_snapshot_id_idx"
  ON "MarketAssessment"("country_truth_fact_snapshot_id");

CREATE TABLE "CountryTruthFactSnapshot" (
  "id" TEXT NOT NULL,
  "snapshot_key" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL,
  "calculation_version" TEXT NOT NULL,
  "exporter_org_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "product_classification_id" TEXT NOT NULL,
  "country_trade_metrics_id" TEXT NOT NULL,
  "reporter_code" TEXT NOT NULL,
  "country_code" VARCHAR(2) NOT NULL,
  "hs_code" TEXT NOT NULL,
  "hs_revision" TEXT NOT NULL,
  "as_of_date" TIMESTAMP(3) NOT NULL,
  "exporter_snapshot_checksum" TEXT NOT NULL,
  "selection_policy_version" INTEGER NOT NULL,
  "selection_policy_hash" TEXT NOT NULL,
  "selection_policy_snapshot" JSONB NOT NULL,
  "facts_payload" JSONB NOT NULL,
  "facts_checksum" TEXT NOT NULL,
  "evidence_origins" "EvidenceOrigin"[] NOT NULL DEFAULT ARRAY['unknown_legacy']::"EvidenceOrigin"[],
  "assertion_classes" "EvidenceAssertionClass"[] NOT NULL DEFAULT ARRAY['unknown_legacy']::"EvidenceAssertionClass"[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CountryTruthFactSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CountryTruthFactSnapshot_snapshot_key_key"
  ON "CountryTruthFactSnapshot"("snapshot_key");
CREATE UNIQUE INDEX "CountryTruthFactSnapshot_input_identity_key"
  ON "CountryTruthFactSnapshot"(
    "country_trade_metrics_id",
    "exporter_snapshot_checksum",
    "selection_policy_hash",
    "calculation_version"
  );
CREATE INDEX "CountryTruthFactSnapshot_org_product_country_created_idx"
  ON "CountryTruthFactSnapshot"("exporter_org_id", "product_id", "country_code", "created_at");
CREATE INDEX "CountryTruthFactSnapshot_classification_reporter_as_of_idx"
  ON "CountryTruthFactSnapshot"("product_classification_id", "reporter_code", "as_of_date");
CREATE INDEX "CountryTruthFactSnapshot_facts_checksum_idx"
  ON "CountryTruthFactSnapshot"("facts_checksum");

ALTER TABLE "CountryTruthFactSnapshot"
  ADD CONSTRAINT "CountryTruthFactSnapshot_exporter_org_id_fkey"
  FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CountryTruthFactSnapshot_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CountryTruthFactSnapshot_product_classification_id_fkey"
  FOREIGN KEY ("product_classification_id") REFERENCES "ProductClassification"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CountryTruthFactSnapshot_country_trade_metrics_id_fkey"
  FOREIGN KEY ("country_trade_metrics_id") REFERENCES "CountryTradeMetrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MarketAssessment"
  ADD CONSTRAINT "MarketAssessment_country_truth_fact_snapshot_id_fkey"
  FOREIGN KEY ("country_truth_fact_snapshot_id") REFERENCES "CountryTruthFactSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_country_truth_fact_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CountryTruthFactSnapshot is immutable; resolve a new versioned fact manifest';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CountryTruthFactSnapshot_immutable"
  BEFORE UPDATE OR DELETE ON "CountryTruthFactSnapshot"
  FOR EACH ROW EXECUTE FUNCTION reject_country_truth_fact_snapshot_mutation();

-- Replace the original partial UPDATE-only guard. A caller must not be able to escape the guard
-- by first changing model_version, and a cascade must not erase historical v4 assessments.
DROP TRIGGER "MarketAssessment_country_truth_v4_immutable" ON "MarketAssessment";
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MarketAssessment_country_truth_v4_immutable"
  BEFORE UPDATE OR DELETE ON "MarketAssessment"
  FOR EACH ROW EXECUTE FUNCTION protect_country_truth_assessment_lineage();

-- Legacy non-trade evidence was documented as historical evidence but had no database guard.
-- New acquisitions create new rows; status/currentness is resolved as-of the assessment clock.
CREATE FUNCTION reject_historical_evidence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable evidence; append a new version instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MarketAccessEvidenceSnapshot_immutable"
  BEFORE UPDATE OR DELETE ON "MarketAccessEvidenceSnapshot"
  FOR EACH ROW EXECUTE FUNCTION reject_historical_evidence_mutation();
CREATE TRIGGER "MarketAccessEvidence_immutable"
  BEFORE UPDATE OR DELETE ON "MarketAccessEvidence"
  FOR EACH ROW EXECUTE FUNCTION reject_historical_evidence_mutation();
CREATE TRIGGER "SupplierCoverageAssertion_immutable"
  BEFORE UPDATE OR DELETE ON "SupplierCoverageAssertion"
  FOR EACH ROW EXECUTE FUNCTION reject_historical_evidence_mutation();
CREATE TRIGGER "LogisticsRouteEvidence_immutable"
  BEFORE UPDATE OR DELETE ON "LogisticsRouteEvidence"
  FOR EACH ROW EXECUTE FUNCTION reject_historical_evidence_mutation();
CREATE TRIGGER "MarketRiskSignal_immutable"
  BEFORE UPDATE OR DELETE ON "MarketRiskSignal"
  FOR EACH ROW EXECUTE FUNCTION reject_historical_evidence_mutation();
CREATE TRIGGER "ExporterMarketFitBenchmark_immutable"
  BEFORE UPDATE OR DELETE ON "ExporterMarketFitBenchmark"
  FOR EACH ROW EXECUTE FUNCTION reject_historical_evidence_mutation();
CREATE TRIGGER "ExchangeRateQuote_immutable"
  BEFORE UPDATE OR DELETE ON "ExchangeRateQuote"
  FOR EACH ROW EXECUTE FUNCTION reject_historical_evidence_mutation();
