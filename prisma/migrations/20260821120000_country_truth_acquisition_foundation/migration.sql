-- Data Phase 1A: immutable provider evidence and normalized Comtrade observations.
CREATE TABLE "SourceEvidence" (
  "id" TEXT NOT NULL,
  "ingest_run_id" TEXT,
  "provider" TEXT NOT NULL,
  "dataset" TEXT NOT NULL,
  "dataset_version" TEXT,
  "source_origin" "EvidenceOrigin" NOT NULL,
  "environment" TEXT NOT NULL,
  "request_fingerprint" TEXT NOT NULL,
  "request_parameters" JSONB NOT NULL,
  "redacted_request" TEXT NOT NULL,
  "http_status" INTEGER NOT NULL,
  "response_checksum" TEXT NOT NULL,
  "raw_response_text" TEXT NOT NULL,
  "retrieved_at" TIMESTAMP(3) NOT NULL,
  "provider_row_count" INTEGER,
  "returned_row_count" INTEGER NOT NULL,
  "completeness" "EvidenceCompletenessStatus" NOT NULL,
  "completeness_metadata" JSONB,
  "quota_metadata" JSONB,
  "parser_version" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error_metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NormalizedTradeObservation" (
  "id" TEXT NOT NULL,
  "source_evidence_id" TEXT NOT NULL,
  "trade_flow_acquisition_id" TEXT,
  "observation_key" TEXT NOT NULL,
  "reporter_code" TEXT NOT NULL,
  "reporter_iso2" VARCHAR(2),
  "partner_code" TEXT NOT NULL,
  "partner_iso2" VARCHAR(2),
  "partner_is_world" BOOLEAN NOT NULL DEFAULT false,
  "partner2_code" TEXT,
  "flow_direction" "TradeFlowDirection" NOT NULL,
  "frequency" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "ref_year" INTEGER NOT NULL,
  "hs_code" TEXT NOT NULL,
  "hs_level" INTEGER NOT NULL,
  "hs_revision" TEXT NOT NULL,
  "customs_code" TEXT,
  "mode_of_supply" TEXT,
  "trade_value" DECIMAL(20,3),
  "trade_value_status" TEXT NOT NULL,
  "quantity" DECIMAL(18,3),
  "quantity_status" TEXT NOT NULL,
  "quantity_unit" TEXT,
  "alternate_quantity" DECIMAL(18,3),
  "alternate_quantity_unit" TEXT,
  "net_weight" DECIMAL(18,3),
  "gross_weight" DECIMAL(18,3),
  "estimate_flag" BOOLEAN,
  "suppression_flag" BOOLEAN,
  "confidentiality_flag" BOOLEAN,
  "normalization_version" TEXT NOT NULL,
  "retrieved_at" TIMESTAMP(3) NOT NULL,
  "source_origin" "EvidenceOrigin" NOT NULL,
  "incompatibility_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NormalizedTradeObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HsReferenceSnapshot" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "nomenclature" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "response_checksum" TEXT NOT NULL,
  "raw_response_text" TEXT NOT NULL,
  "retrieved_at" TIMESTAMP(3) NOT NULL,
  "dataset_version" TEXT,
  "parser_version" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HsReferenceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SourceEvidence_request_fingerprint_source_origin_retrieved_at_idx" ON "SourceEvidence"("request_fingerprint", "source_origin", "retrieved_at");
CREATE INDEX "SourceEvidence_response_checksum_idx" ON "SourceEvidence"("response_checksum");
CREATE UNIQUE INDEX "NormalizedTradeObservation_trade_flow_acquisition_id_key" ON "NormalizedTradeObservation"("trade_flow_acquisition_id");
CREATE UNIQUE INDEX "NormalizedTradeObservation_observation_key_key" ON "NormalizedTradeObservation"("observation_key");
CREATE INDEX "NormalizedTradeObservation_reporter_partner_hs_year_flow_idx" ON "NormalizedTradeObservation"("reporter_code", "partner_code", "hs_code", "ref_year", "flow_direction");
CREATE INDEX "NormalizedTradeObservation_source_evidence_id_idx" ON "NormalizedTradeObservation"("source_evidence_id");
CREATE UNIQUE INDEX "HsReferenceSnapshot_provider_revision_checksum_key" ON "HsReferenceSnapshot"("provider", "revision", "response_checksum");
CREATE INDEX "HsReferenceSnapshot_provider_revision_retrieved_at_idx" ON "HsReferenceSnapshot"("provider", "revision", "retrieved_at");

ALTER TABLE "SourceEvidence" ADD CONSTRAINT "SourceEvidence_ingest_run_id_fkey" FOREIGN KEY ("ingest_run_id") REFERENCES "IngestRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NormalizedTradeObservation" ADD CONSTRAINT "NormalizedTradeObservation_source_evidence_id_fkey" FOREIGN KEY ("source_evidence_id") REFERENCES "SourceEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NormalizedTradeObservation" ADD CONSTRAINT "NormalizedTradeObservation_trade_flow_acquisition_id_fkey" FOREIGN KEY ("trade_flow_acquisition_id") REFERENCES "TradeFlowAcquisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION reject_country_truth_evidence_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; create a new acquisition instead.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "source_evidence_no_update" BEFORE UPDATE ON "SourceEvidence" FOR EACH ROW EXECUTE FUNCTION reject_country_truth_evidence_update();
CREATE TRIGGER "normalized_trade_observation_no_update" BEFORE UPDATE ON "NormalizedTradeObservation" FOR EACH ROW EXECUTE FUNCTION reject_country_truth_evidence_update();
CREATE TRIGGER "hs_reference_snapshot_no_update" BEFORE UPDATE ON "HsReferenceSnapshot" FOR EACH ROW EXECUTE FUNCTION reject_country_truth_evidence_update();
CREATE TRIGGER "source_evidence_no_delete" BEFORE DELETE ON "SourceEvidence" FOR EACH ROW EXECUTE FUNCTION reject_country_truth_evidence_update();
CREATE TRIGGER "normalized_trade_observation_no_delete" BEFORE DELETE ON "NormalizedTradeObservation" FOR EACH ROW EXECUTE FUNCTION reject_country_truth_evidence_update();
CREATE TRIGGER "hs_reference_snapshot_no_delete" BEFORE DELETE ON "HsReferenceSnapshot" FOR EACH ROW EXECUTE FUNCTION reject_country_truth_evidence_update();
