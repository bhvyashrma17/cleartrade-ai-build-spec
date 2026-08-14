CREATE TYPE "MarketEligibilityStatus" AS ENUM ('eligible', 'ineligible');
CREATE TYPE "MarketEligibilityRuleType" AS ENUM ('sanctions_restricted', 'import_prohibited', 'mandatory_certification');
ALTER TYPE "JobType" ADD VALUE 'sanctions_ingest';

ALTER TABLE "MarketAssessment" ALTER COLUMN "overall_score" DROP NOT NULL;
ALTER TABLE "MarketAssessment"
ADD COLUMN "market_access_score" INTEGER,
ADD COLUMN "export_economics_score" INTEGER,
ADD COLUMN "exporter_market_fit_score" INTEGER,
ADD COLUMN "logistics_feasibility_score" INTEGER,
ADD COLUMN "risk_resilience_score" INTEGER,
ADD COLUMN "confidence_score" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "eligibility_status" "MarketEligibilityStatus" NOT NULL DEFAULT 'eligible',
ADD COLUMN "eligibility_reasons" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "model_version" TEXT NOT NULL DEFAULT 'legacy-v1',
ADD COLUMN "weight_profile_key" TEXT NOT NULL DEFAULT 'general',
ADD COLUMN "weight_profile_version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "MarketEligibilityRule" (
  "id" TEXT NOT NULL,
  "country_code" VARCHAR(2) NOT NULL,
  "hs_code_prefix" TEXT,
  "rule_type" "MarketEligibilityRuleType" NOT NULL,
  "required_certification" TEXT,
  "certification_obtainable" BOOLEAN,
  "source" TEXT NOT NULL,
  "source_ref" TEXT,
  "effective_from" TIMESTAMP(3),
  "effective_to" TIMESTAMP(3),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "raw_snapshot" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketEligibilityRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MarketEligibilityRule_country_code_is_active_idx" ON "MarketEligibilityRule"("country_code", "is_active");
CREATE INDEX "MarketEligibilityRule_hs_code_prefix_idx" ON "MarketEligibilityRule"("hs_code_prefix");

CREATE TABLE "SanctionsIngestRun" (
  "id" TEXT NOT NULL,
  "status" "IngestStatus" NOT NULL DEFAULT 'running',
  "source_results" JSONB NOT NULL DEFAULT '[]',
  "records_observed" INTEGER NOT NULL DEFAULT 0,
  "restrictions_written" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "error" TEXT,
  CONSTRAINT "SanctionsIngestRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SanctionsSourceSnapshot" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "record_count" INTEGER NOT NULL,
  "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "SanctionsSourceSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SanctionsSourceSnapshot_source_key" ON "SanctionsSourceSnapshot"("source");
