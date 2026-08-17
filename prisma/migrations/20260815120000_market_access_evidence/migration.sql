-- CreateEnum
CREATE TYPE "MarketAccessRuleType" AS ENUM ('destination_tariff', 'preferential_tariff_india', 'import_prohibition', 'import_restriction', 'mandatory_certification', 'material_non_tariff_requirement');

-- CreateEnum
CREATE TYPE "MarketAccessEvidenceStatus" AS ENUM ('verified', 'not_applicable', 'needs_review', 'superseded', 'stale');

-- CreateEnum
CREATE TYPE "EvidenceCompletenessStatus" AS ENUM ('COMPLETE', 'PARTIAL', 'FAILED', 'STALE');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'market_access_ingest';

-- CreateTable
CREATE TABLE "MarketAccessEvidenceSnapshot" (
    "id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "hs_code_scope" TEXT NOT NULL,
    "source_authority" TEXT NOT NULL,
    "source_reference" TEXT NOT NULL,
    "source_version" TEXT,
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "effective_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "completeness_status" "EvidenceCompletenessStatus" NOT NULL,
    "tariff_coverage" BOOLEAN NOT NULL DEFAULT false,
    "regulatory_coverage" BOOLEAN NOT NULL DEFAULT false,
    "parser_version" TEXT NOT NULL,
    "raw_evidence" JSONB NOT NULL,

    CONSTRAINT "MarketAccessEvidenceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketAccessEvidence" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "hs_code_scope" TEXT NOT NULL,
    "rule_type" "MarketAccessRuleType" NOT NULL,
    "source_authority" TEXT NOT NULL,
    "source_reference" TEXT NOT NULL,
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "effective_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),
    "status" "MarketAccessEvidenceStatus" NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "tariff_rate_percent" DECIMAL(9,4),
    "requirement_code" TEXT,
    "requirement_description" TEXT,
    "requirement_obtainable" BOOLEAN,
    "raw_evidence" JSONB NOT NULL,

    CONSTRAINT "MarketAccessEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketAccessEvidenceSnapshot_country_code_hs_code_scope_ret_idx" ON "MarketAccessEvidenceSnapshot"("country_code", "hs_code_scope", "retrieved_at");

-- CreateIndex
CREATE INDEX "MarketAccessEvidence_country_code_hs_code_scope_rule_type_s_idx" ON "MarketAccessEvidence"("country_code", "hs_code_scope", "rule_type", "status");

-- CreateIndex
CREATE INDEX "MarketAccessEvidence_snapshot_id_idx" ON "MarketAccessEvidence"("snapshot_id");

-- AddForeignKey
ALTER TABLE "MarketAccessEvidence" ADD CONSTRAINT "MarketAccessEvidence_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "MarketAccessEvidenceSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
