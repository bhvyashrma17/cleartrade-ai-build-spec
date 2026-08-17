-- Existing warehouse rows have no trustworthy acquisition lineage. Keep them explicitly unknown;
-- never infer authenticated provenance from source='comtrade'.
CREATE TYPE "TradeSourceMode" AS ENUM ('legacy_unknown', 'fixture', 'mock', 'preview', 'authenticated');

ALTER TABLE "TradeFlow"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'unverified_legacy',
  ADD COLUMN "source_mode" "TradeSourceMode" NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN "ingest_run_id" TEXT,
  ADD COLUMN "retrieved_at" TIMESTAMP(3),
  ADD COLUMN "request_batch_id" TEXT,
  ADD COLUMN "source_dataset" TEXT,
  ADD COLUMN "source_dataset_version" TEXT;

UPDATE "TradeFlow" SET "retrieved_at" = "ingested_at" WHERE "retrieved_at" IS NULL;
ALTER TABLE "TradeFlow" ALTER COLUMN "retrieved_at" SET NOT NULL;

ALTER TABLE "IngestRun"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'unverified_legacy',
  ADD COLUMN "client_mode" "TradeSourceMode" NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN "authenticated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "credential_fingerprint" TEXT,
  ADD COLUMN "source_dataset" TEXT,
  ADD COLUMN "source_dataset_version" TEXT,
  ADD COLUMN "code_range" TEXT,
  ADD COLUMN "batch_size" INTEGER,
  ADD COLUMN "provider_throttle_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "local_quota_throttle_count" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "TradeFlow_reporter_partner_hs_code_year_source_key";
CREATE UNIQUE INDEX "TradeFlow_reporter_partner_hs_code_year_flow_direction_source_key"
  ON "TradeFlow"("reporter", "partner", "hs_code", "year", "flow_direction", "source");
CREATE INDEX "TradeFlow_ingest_run_id_idx" ON "TradeFlow"("ingest_run_id");
CREATE INDEX "TradeFlow_provider_source_mode_retrieved_at_idx" ON "TradeFlow"("provider", "source_mode", "retrieved_at");
CREATE INDEX "IngestRun_provider_client_mode_started_at_idx" ON "IngestRun"("provider", "client_mode", "started_at");
ALTER TABLE "TradeFlow" ADD CONSTRAINT "TradeFlow_ingest_run_id_fkey"
  FOREIGN KEY ("ingest_run_id") REFERENCES "IngestRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProviderQuotaWindow" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "credential_fingerprint" TEXT NOT NULL,
  "window_start" TIMESTAMP(3) NOT NULL,
  "window_end" TIMESTAMP(3) NOT NULL,
  "configured_limit" INTEGER NOT NULL,
  "requests_reserved" INTEGER NOT NULL DEFAULT 0,
  "provider_reported_limit" INTEGER,
  "provider_reported_remaining" INTEGER,
  "provider_reported_reset_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderQuotaWindow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProviderQuotaWindow_provider_credential_fingerprint_window_start_key"
  ON "ProviderQuotaWindow"("provider", "credential_fingerprint", "window_start");
CREATE INDEX "ProviderQuotaWindow_window_end_idx" ON "ProviderQuotaWindow"("window_end");
