-- Phase 1F: Stage A global country screening. Additive only.

CREATE TABLE "CountryScreeningRun" (
  "id" TEXT NOT NULL,
  "run_key" TEXT NOT NULL,
  "product_classification_id" TEXT NOT NULL,
  "hs_code" TEXT NOT NULL,
  "hs_revision" TEXT NOT NULL,
  "as_of_date" TIMESTAMP(3) NOT NULL,
  "screening_period" INTEGER NOT NULL,
  "source_mode" "TradeSourceMode" NOT NULL,
  "policy_version" TEXT NOT NULL,
  "policy_hash" TEXT NOT NULL,
  "policy_snapshot" JSONB NOT NULL,
  "universe_version" TEXT NOT NULL,
  "universe_checksum" TEXT NOT NULL,
  "universe_size" INTEGER NOT NULL,
  "universe_snapshot" JSONB NOT NULL,
  "screening_algorithm_version" TEXT NOT NULL,
  "parser_version" TEXT NOT NULL,
  "normalization_version" TEXT NOT NULL,
  "shortlist_target_size" INTEGER NOT NULL,
  "max_shortlist_size" INTEGER NOT NULL,
  "estimated_call_cost" INTEGER NOT NULL,
  "allow_partial_execution" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "resolved_count" INTEGER NOT NULL DEFAULT 0,
  "eligible_count" INTEGER NOT NULL DEFAULT 0,
  "shortlist_size" INTEGER NOT NULL DEFAULT 0,
  "physical_call_count" INTEGER NOT NULL DEFAULT 0,
  "quota_snapshot" JSONB,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CountryScreeningRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CountryScreeningResult" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "result_key" TEXT NOT NULL,
  "reporter_code" TEXT NOT NULL,
  "country_code" VARCHAR(2) NOT NULL,
  "iso_numeric" TEXT NOT NULL,
  "country_name" TEXT NOT NULL,
  "request_fingerprint" TEXT NOT NULL,
  "screening_status" TEXT NOT NULL DEFAULT 'pending_acquisition',
  "screening_score" DECIMAL(9,6),
  "screening_rank" INTEGER,
  "import_value" DECIMAL(20,3),
  "import_value_status" TEXT,
  "observation_period" INTEGER,
  "freshness_state" TEXT NOT NULL DEFAULT 'unknown',
  "source_evidence_id" TEXT,
  "observation_id" TEXT,
  "evidence_retrieved_at" TIMESTAMP(3),
  "shortlisted" BOOLEAN NOT NULL DEFAULT false,
  "decision_reason" TEXT NOT NULL DEFAULT 'pending_acquisition',
  "provenance" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_attempted_at" TIMESTAMP(3),
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CountryScreeningResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CountryScreeningRun_run_key_key" ON "CountryScreeningRun"("run_key");
CREATE INDEX "CountryScreeningRun_product_classification_id_created_at_idx" ON "CountryScreeningRun"("product_classification_id", "created_at");
CREATE INDEX "CountryScreeningRun_status_created_at_idx" ON "CountryScreeningRun"("status", "created_at");
CREATE UNIQUE INDEX "CountryScreeningResult_result_key_key" ON "CountryScreeningResult"("result_key");
CREATE UNIQUE INDEX "CountryScreeningResult_run_id_reporter_code_key" ON "CountryScreeningResult"("run_id", "reporter_code");
CREATE INDEX "CountryScreeningResult_run_id_screening_rank_idx" ON "CountryScreeningResult"("run_id", "screening_rank");
CREATE INDEX "CountryScreeningResult_run_id_screening_status_idx" ON "CountryScreeningResult"("run_id", "screening_status");
CREATE INDEX "CountryScreeningResult_source_evidence_id_idx" ON "CountryScreeningResult"("source_evidence_id");

ALTER TABLE "CountryScreeningRun" ADD CONSTRAINT "CountryScreeningRun_product_classification_id_fkey" FOREIGN KEY ("product_classification_id") REFERENCES "ProductClassification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CountryScreeningResult" ADD CONSTRAINT "CountryScreeningResult_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "CountryScreeningRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CountryScreeningResult" ADD CONSTRAINT "CountryScreeningResult_source_evidence_id_fkey" FOREIGN KEY ("source_evidence_id") REFERENCES "SourceEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A screening run may advance execution state, but the question it asked — classification,
-- period, universe, policy and ranking identity — is frozen at creation. A completed run is
-- history: corrections create a new run under a new identity.
CREATE FUNCTION protect_country_screening_run() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Country screening runs are immutable history and are never deleted';
  END IF;
  IF OLD."status" = 'completed' THEN
    RAISE EXCEPTION 'Completed country screening runs are immutable; create a new run';
  END IF;
  IF (OLD."run_key", OLD."product_classification_id", OLD."hs_code", OLD."hs_revision", OLD."as_of_date", OLD."screening_period", OLD."source_mode", OLD."policy_version", OLD."policy_hash", OLD."policy_snapshot", OLD."universe_version", OLD."universe_checksum", OLD."universe_size", OLD."universe_snapshot", OLD."screening_algorithm_version", OLD."parser_version", OLD."normalization_version", OLD."shortlist_target_size", OLD."max_shortlist_size", OLD."estimated_call_cost")
     IS DISTINCT FROM
     (NEW."run_key", NEW."product_classification_id", NEW."hs_code", NEW."hs_revision", NEW."as_of_date", NEW."screening_period", NEW."source_mode", NEW."policy_version", NEW."policy_hash", NEW."policy_snapshot", NEW."universe_version", NEW."universe_checksum", NEW."universe_size", NEW."universe_snapshot", NEW."screening_algorithm_version", NEW."parser_version", NEW."normalization_version", NEW."shortlist_target_size", NEW."max_shortlist_size", NEW."estimated_call_cost") THEN
    RAISE EXCEPTION 'Country screening run definitions are immutable; create a new run';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CountryScreeningRun_definition_immutable" BEFORE UPDATE OR DELETE ON "CountryScreeningRun" FOR EACH ROW EXECUTE FUNCTION protect_country_screening_run();

-- A result's country identity never changes, and once its run completes the whole row is
-- frozen evidence of what was screened and why it was or was not shortlisted.
CREATE FUNCTION protect_country_screening_result() RETURNS trigger AS $$
DECLARE run_status TEXT;
BEGIN
  SELECT "status" INTO run_status FROM "CountryScreeningRun" WHERE "id" = OLD."run_id";
  IF run_status = 'completed' THEN
    RAISE EXCEPTION 'Country screening results are immutable once their run completes';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Country screening results are never deleted while their run exists';
  END IF;
  IF (OLD."run_id", OLD."result_key", OLD."reporter_code", OLD."country_code", OLD."iso_numeric", OLD."request_fingerprint")
     IS DISTINCT FROM
     (NEW."run_id", NEW."result_key", NEW."reporter_code", NEW."country_code", NEW."iso_numeric", NEW."request_fingerprint") THEN
    RAISE EXCEPTION 'Country screening result identities are immutable; create a new run';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CountryScreeningResult_immutable" BEFORE UPDATE OR DELETE ON "CountryScreeningResult" FOR EACH ROW EXECUTE FUNCTION protect_country_screening_result();
