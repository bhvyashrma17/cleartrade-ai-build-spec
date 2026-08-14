ALTER TYPE "JobType" ADD VALUE 'buyer_intelligence';

ALTER TABLE "Buyer" ADD COLUMN "deprioritized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "deprioritization_reasons" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "sanctions_blocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ImportRecord" ADD COLUMN "buyer_id" TEXT,
ADD COLUMN "value_currency" VARCHAR(3),
ADD COLUMN "resolution_confidence" DECIMAL(6,5), ADD COLUMN "resolution_method" TEXT,
ADD COLUMN "resolved_at" TIMESTAMP(3);
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Buyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ImportRecord_buyer_id_shipment_date_idx" ON "ImportRecord"("buyer_id", "shipment_date");

CREATE TABLE "BuyerAttributeClaim" ("id" TEXT NOT NULL,"buyer_id" TEXT NOT NULL,"attribute" TEXT NOT NULL,"value" JSONB NOT NULL,"source" TEXT NOT NULL,"source_record_id" TEXT,"observed_at" TIMESTAMP(3) NOT NULL,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "BuyerAttributeClaim_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "BuyerAttributeClaim_buyer_id_attribute_source_source_record_id_key" ON "BuyerAttributeClaim"("buyer_id","attribute","source","source_record_id");
CREATE INDEX "BuyerAttributeClaim_buyer_id_attribute_observed_at_idx" ON "BuyerAttributeClaim"("buyer_id","attribute","observed_at");
ALTER TABLE "BuyerAttributeClaim" ADD CONSTRAINT "BuyerAttributeClaim_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BuyerFeatureSnapshot" ("id" TEXT NOT NULL,"buyer_id" TEXT NOT NULL,"import_frequency_per_year" DECIMAL(12,4),"last_shipment_date" TIMESTAMP(3),"shipment_count_12m" INTEGER NOT NULL,"typical_shipment_size" DECIMAL(20,3),"quantity_unit" TEXT,"origin_mix" JSONB NOT NULL,"india_sourcing_history" BOOLEAN,"supplier_concentration" DECIMAL(8,6),"purchasing_trend" DECIMAL(12,6),"provenance" JSONB NOT NULL,"computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "BuyerFeatureSnapshot_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "BuyerFeatureSnapshot_buyer_id_key" ON "BuyerFeatureSnapshot"("buyer_id");
ALTER TABLE "BuyerFeatureSnapshot" ADD CONSTRAINT "BuyerFeatureSnapshot_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BuyerFitAssessment" ("id" TEXT NOT NULL,"buyer_id" TEXT NOT NULL,"product_id" TEXT NOT NULL,"exporter_org_id" TEXT NOT NULL,"score" INTEGER,"confidence_score" INTEGER NOT NULL,"components" JSONB NOT NULL,"input_snapshot" JSONB NOT NULL,"model_version" TEXT NOT NULL,"computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "BuyerFitAssessment_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "BuyerFitAssessment_buyer_id_product_id_exporter_org_id_key" ON "BuyerFitAssessment"("buyer_id","product_id","exporter_org_id");
CREATE INDEX "BuyerFitAssessment_exporter_org_id_product_id_score_idx" ON "BuyerFitAssessment"("exporter_org_id","product_id","score");
ALTER TABLE "BuyerFitAssessment" ADD CONSTRAINT "BuyerFitAssessment_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuyerFitAssessment" ADD CONSTRAINT "BuyerFitAssessment_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuyerFitAssessment" ADD CONSTRAINT "BuyerFitAssessment_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BuyerOutcome" ("id" TEXT NOT NULL,"buyer_id" TEXT NOT NULL,"exporter_org_id" TEXT NOT NULL,"buyer_lead_id" TEXT NOT NULL,"contacted_at" TIMESTAMP(3),"replied_at" TIMESTAMP(3),"converted" BOOLEAN,"rejection_reason" TEXT,"payment_behavior" TEXT,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "BuyerOutcome_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "BuyerOutcome_buyer_lead_id_key" ON "BuyerOutcome"("buyer_lead_id");
CREATE INDEX "BuyerOutcome_buyer_id_exporter_org_id_idx" ON "BuyerOutcome"("buyer_id","exporter_org_id");
ALTER TABLE "BuyerOutcome" ADD CONSTRAINT "BuyerOutcome_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuyerOutcome" ADD CONSTRAINT "BuyerOutcome_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuyerOutcome" ADD CONSTRAINT "BuyerOutcome_buyer_lead_id_fkey" FOREIGN KEY ("buyer_lead_id") REFERENCES "BuyerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SanctionsEntity" ("id" TEXT NOT NULL,"source" TEXT NOT NULL,"source_record_id" TEXT NOT NULL,"name" TEXT NOT NULL,"normalized_name" TEXT NOT NULL,"entity_type" TEXT,"observed_at" TIMESTAMP(3) NOT NULL,"is_active" BOOLEAN NOT NULL DEFAULT true,"raw_snapshot" JSONB,CONSTRAINT "SanctionsEntity_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "SanctionsEntity_source_source_record_id_key" ON "SanctionsEntity"("source","source_record_id");
CREATE INDEX "SanctionsEntity_normalized_name_is_active_idx" ON "SanctionsEntity"("normalized_name","is_active");
