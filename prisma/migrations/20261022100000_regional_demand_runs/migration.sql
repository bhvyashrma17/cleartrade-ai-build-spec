-- D-033, docs/38. Regional demand inside one Demand Discovery v5 market: where in the market a
-- product's imports arrive. For the US, states of destination and ports of entry from the Census
-- Bureau's monthly trade figures.
--
-- Forward-only and additive: one new job type, one new enum and one new table hanging off
-- MarketAssessment. Nothing existing changes.

-- Not used in this transaction, so adding the value here is safe (PostgreSQL >= 12).
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'regional_demand_discovery';

CREATE TYPE "RegionalDemandStatus" AS ENUM ('queued', 'running', 'completed', 'unavailable', 'failed');

CREATE TABLE "RegionalDemandRun" (
    "id" TEXT NOT NULL,
    "market_assessment_id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "product_id" TEXT,
    "country_code" VARCHAR(2) NOT NULL,
    "hs6_code" VARCHAR(6) NOT NULL,
    "source_key" TEXT NOT NULL,
    "status" "RegionalDemandStatus" NOT NULL DEFAULT 'queued',
    "trigger" TEXT NOT NULL,
    "requested_by_id" TEXT,
    "job_id" TEXT,
    "result" JSONB,
    "reason" TEXT,
    "evidence_origin" "EvidenceOrigin" NOT NULL DEFAULT 'public_real',
    "retrieved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "RegionalDemandRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RegionalDemandRun_trigger_known" CHECK ("trigger" IN ('hand_off', 'requested', 'operator')),
    CONSTRAINT "RegionalDemandRun_hs6_digits" CHECK ("hs6_code" ~ '^[0-9]{6}$')
);

CREATE INDEX "RegionalDemandRun_market_assessment_id_created_at_idx" ON "RegionalDemandRun"("market_assessment_id", "created_at");
CREATE INDEX "RegionalDemandRun_exporter_org_id_created_at_idx" ON "RegionalDemandRun"("exporter_org_id", "created_at");

ALTER TABLE "RegionalDemandRun" ADD CONSTRAINT "RegionalDemandRun_market_assessment_id_fkey"
    FOREIGN KEY ("market_assessment_id") REFERENCES "MarketAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
