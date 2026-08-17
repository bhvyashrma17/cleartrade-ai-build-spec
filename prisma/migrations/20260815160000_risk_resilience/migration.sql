CREATE TYPE "RiskSignalDimension" AS ENUM ('macro_volatility', 'payment_country_risk', 'supplier_dependency', 'route_fragility');
CREATE TYPE "RiskSignalStatus" AS ENUM ('verified', 'needs_review', 'superseded');

CREATE TABLE "MarketRiskSignal" (
  "id" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "country_code" VARCHAR(2) NOT NULL,
  "hs_code_scope" TEXT,
  "dimension" "RiskSignalDimension" NOT NULL,
  "metric" TEXT NOT NULL,
  "value" DECIMAL(20,8) NOT NULL,
  "unit" TEXT NOT NULL,
  "observation_date" TIMESTAMP(3) NOT NULL,
  "period_start" TIMESTAMP(3),
  "period_end" TIMESTAMP(3),
  "retrieved_at" TIMESTAMP(3) NOT NULL,
  "valid_until" TIMESTAMP(3),
  "provider" TEXT NOT NULL,
  "source_reference" TEXT NOT NULL,
  "source_version" TEXT NOT NULL,
  "normalization_method" TEXT NOT NULL,
  "confidence" DECIMAL(5,4) NOT NULL,
  "status" "RiskSignalStatus" NOT NULL DEFAULT 'verified',
  "evidence_origin" "EvidenceOrigin" NOT NULL,
  "raw_evidence" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketRiskSignal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketRiskSignal_provider_source_reference_metric_observation_date_key"
  ON "MarketRiskSignal"("provider", "source_reference", "metric", "observation_date");
CREATE INDEX "MarketRiskSignal_country_code_dimension_observation_date_status_idx"
  ON "MarketRiskSignal"("country_code", "dimension", "observation_date", "status");
CREATE INDEX "MarketRiskSignal_country_code_hs_code_scope_valid_until_idx"
  ON "MarketRiskSignal"("country_code", "hs_code_scope", "valid_until");

