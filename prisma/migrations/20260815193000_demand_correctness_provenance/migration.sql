ALTER TABLE "DiscoveryRun"
  ADD COLUMN "as_of_date" TIMESTAMP(3),
  ADD COLUMN "scoring_policy_version" INTEGER,
  ADD COLUMN "scoring_policy_hash" TEXT,
  ADD COLUMN "scoring_policy_snapshot" JSONB,
  ADD COLUMN "reproducibility_status" TEXT NOT NULL DEFAULT 'legacy_non_recomputable';

ALTER TABLE "MarketAssessment"
  ADD COLUMN "as_of_date" TIMESTAMP(3),
  ADD COLUMN "scoring_policy_version" INTEGER,
  ADD COLUMN "scoring_policy_hash" TEXT,
  ADD COLUMN "scoring_policy_snapshot" JSONB,
  ADD COLUMN "reproducibility_status" TEXT NOT NULL DEFAULT 'legacy_non_recomputable';

ALTER TABLE "MarketAccessEvidenceSnapshot"
  ADD COLUMN "evidence_origin" "EvidenceOrigin" NOT NULL DEFAULT 'unknown_legacy',
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'unknown_legacy',
  ADD COLUMN "source_dataset" TEXT,
  ADD COLUMN "source_run_id" TEXT,
  ADD COLUMN "raw_response_checksum" TEXT;

ALTER TABLE "MarketAccessEvidence"
  ADD COLUMN "evidence_origin" "EvidenceOrigin" NOT NULL DEFAULT 'unknown_legacy';

CREATE TABLE "SupplierCoverageAssertion" (
  "id" TEXT NOT NULL,
  "country_code" VARCHAR(2) NOT NULL,
  "reporter" TEXT NOT NULL,
  "hs_code" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "world_total_value" DECIMAL(20,3) NOT NULL,
  "supplier_value_sum" DECIMAL(20,3) NOT NULL,
  "partner_count" INTEGER NOT NULL,
  "coverage_ratio" DECIMAL(12,8),
  "query_scope" JSONB NOT NULL,
  "acquisition_ids" TEXT[],
  "completeness_status" "EvidenceCompletenessStatus" NOT NULL,
  "threshold_version" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierCoverageAssertion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierCoverageAssertion_country_code_hs_code_year_created_idx"
  ON "SupplierCoverageAssertion"("country_code", "hs_code", "year", "created_at");

-- Deliberately no provenance backfill. Existing assessments and Market Access evidence
-- remain legacy_non_recomputable / unknown_legacy unless a future evidence-specific
-- reconciliation can prove their origin from immutable source records.
