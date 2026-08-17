CREATE TYPE "ExporterFitBenchmarkType" AS ENUM ('order_value', 'order_quantity', 'production_lead_time', 'customization_required', 'packaging_required');
CREATE TYPE "ExporterFitBenchmarkStatus" AS ENUM ('verified', 'needs_review', 'superseded');

CREATE TABLE "ExporterMarketFitBenchmark" (
  "id" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "country_code" VARCHAR(2) NOT NULL,
  "hs_code_scope" TEXT NOT NULL,
  "benchmark_type" "ExporterFitBenchmarkType" NOT NULL,
  "minimum_value" DECIMAL(20,8),
  "maximum_value" DECIMAL(20,8),
  "unit" TEXT,
  "currency" VARCHAR(3),
  "required" BOOLEAN,
  "requirement_code" TEXT,
  "provider" TEXT NOT NULL,
  "source_reference" TEXT NOT NULL,
  "source_version" TEXT NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "retrieved_at" TIMESTAMP(3) NOT NULL,
  "valid_until" TIMESTAMP(3),
  "confidence" DECIMAL(5,4) NOT NULL,
  "status" "ExporterFitBenchmarkStatus" NOT NULL DEFAULT 'verified',
  "evidence_origin" "EvidenceOrigin" NOT NULL,
  "raw_evidence" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExporterMarketFitBenchmark_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExporterMarketFitBenchmark_provider_source_reference_benchmark_type_hs_code_scope_key"
  ON "ExporterMarketFitBenchmark"("provider", "source_reference", "benchmark_type", "hs_code_scope");
CREATE INDEX "ExporterMarketFitBenchmark_country_code_hs_code_scope_benchmark_type_status_idx"
  ON "ExporterMarketFitBenchmark"("country_code", "hs_code_scope", "benchmark_type", "status");
CREATE INDEX "ExporterMarketFitBenchmark_country_code_valid_until_idx"
  ON "ExporterMarketFitBenchmark"("country_code", "valid_until");

