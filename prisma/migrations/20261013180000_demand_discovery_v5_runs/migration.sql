-- docs/36 §7. Demand Discovery v5 runs on the canonical DiscoveryRun / MarketAssessment records.
--
-- Forward-only and additive: v2–v4 rows keep every column they had and read exactly as before.
-- A v5 run scores every screening market, so its assessments also record the market's status
-- (ranked, not enough data, no recorded demand, excluded), its rank, the live points behind the
-- score, the data year, the five-part breakdown with every metric's inputs, labels and reasons.
-- The run records what started it, the classification it scored, the frozen dataset releases it
-- read and a summary naming the markets handed on to regional discovery.

-- Not used in this transaction, so adding the value here is safe (PostgreSQL ≥ 12).
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'demand_discovery_v5';

ALTER TABLE "DiscoveryRun"
    ADD COLUMN "model_version" TEXT,
    ADD COLUMN "trigger" TEXT,
    ADD COLUMN "classification_id" TEXT,
    ADD COLUMN "frozen_inputs" JSONB,
    ADD COLUMN "summary" JSONB;

ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_classification_id_fkey"
    FOREIGN KEY ("classification_id") REFERENCES "ProductClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_trigger_known" CHECK (
    "trigger" IS NULL OR "trigger" IN ('classification_confirmed', 'manual', 'refresh')
);

CREATE INDEX "DiscoveryRun_product_model_idx" ON "DiscoveryRun"("product_id", "model_version", "created_at");

ALTER TABLE "MarketAssessment"
    ADD COLUMN "market_status" TEXT,
    ADD COLUMN "rank" INTEGER,
    ADD COLUMN "live_points" INTEGER,
    ADD COLUMN "data_year" INTEGER,
    ADD COLUMN "score_breakdown" JSONB,
    ADD COLUMN "labels" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "reasons" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "flag_reasons" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "handed_off" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "MarketAssessment" ADD CONSTRAINT "MarketAssessment_market_status_known" CHECK (
    "market_status" IS NULL OR "market_status" IN ('ranked', 'not_enough_data', 'no_recorded_demand', 'excluded')
);
-- A v5 row always says which of the four it is; only a ranked row has a rank, and every rank
-- is positive. Live points are a share of the 100 points the policy defines.
ALTER TABLE "MarketAssessment" ADD CONSTRAINT "MarketAssessment_v5_has_status" CHECK (
    "model_version" <> 'market-opportunity-v5' OR "market_status" IS NOT NULL
);
ALTER TABLE "MarketAssessment" ADD CONSTRAINT "MarketAssessment_rank_only_when_ranked" CHECK (
    ("rank" IS NULL AND ("market_status" IS NULL OR "market_status" <> 'ranked'))
    OR ("rank" > 0 AND "market_status" = 'ranked')
);
ALTER TABLE "MarketAssessment" ADD CONSTRAINT "MarketAssessment_live_points_range" CHECK (
    "live_points" IS NULL OR ("live_points" >= 0 AND "live_points" <= 100)
);
ALTER TABLE "MarketAssessment" ADD CONSTRAINT "MarketAssessment_handoff_is_ranked" CHECK (
    NOT "handed_off" OR "market_status" = 'ranked'
);

CREATE UNIQUE INDEX "MarketAssessment_run_rank_key" ON "MarketAssessment"("run_id", "rank") WHERE "rank" IS NOT NULL;
