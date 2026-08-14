ALTER TYPE "TradeDataSource" ADD VALUE 'cbp_vessel_manifest';
ALTER TYPE "JobType" ADD VALUE 'cbp_manifest_ingest';

ALTER TABLE "IngestRun"
  ADD COLUMN "records_total" INTEGER,
  ADD COLUMN "records_processed" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ImportRecord" (
  "id" TEXT NOT NULL,
  "buyer_ref" TEXT,
  "raw_consignee_string" TEXT,
  "hs_code" TEXT,
  "country" VARCHAR(2) NOT NULL,
  "shipment_date" TIMESTAMP(3) NOT NULL,
  "value" DECIMAL(20,3),
  "quantity" DECIMAL(20,3),
  "quantity_unit" TEXT,
  "origin_country" VARCHAR(2),
  "port" TEXT,
  "shipper_name" TEXT,
  "source" "TradeDataSource" NOT NULL,
  "source_record_id" TEXT NOT NULL,
  "retrieved_at" TIMESTAMP(3) NOT NULL,
  "source_provider" TEXT NOT NULL,
  "license_type" TEXT NOT NULL,
  "allowed_to_display" BOOLEAN NOT NULL,
  "allowed_to_export" BOOLEAN NOT NULL,
  "allowed_to_cache" BOOLEAN NOT NULL,
  "retention_limit" TIMESTAMP(3),
  "personal_data_flag" BOOLEAN NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ImportRecord_source_record_id_key" ON "ImportRecord"("source_record_id");
CREATE INDEX "ImportRecord_hs_code_country_shipment_date_idx" ON "ImportRecord"("hs_code", "country", "shipment_date");
CREATE INDEX "ImportRecord_buyer_ref_shipment_date_idx" ON "ImportRecord"("buyer_ref", "shipment_date");
CREATE INDEX "ImportRecord_retention_limit_idx" ON "ImportRecord"("retention_limit");
