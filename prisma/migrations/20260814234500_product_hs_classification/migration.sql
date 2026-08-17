CREATE TYPE "ProductClassificationMethod" AS ENUM ('exporter_supplied','agent_supplied','deterministic_catalogue','ai_assisted_candidate','manually_verified');
CREATE TYPE "ProductClassificationStatus" AS ENUM ('candidate','needs_review','confirmed','superseded');
ALTER TABLE "Product" ADD COLUMN "itc_hs_code" TEXT, ADD COLUMN "hs_nomenclature" TEXT,
  ADD COLUMN "hs_nomenclature_version" TEXT, ADD COLUMN "hs_classification_method" "ProductClassificationMethod",
  ADD COLUMN "hs_classification_status" "ProductClassificationStatus", ADD COLUMN "hs_classification_confidence" DECIMAL(5,4),
  ADD COLUMN "hs_classification_evidence" JSONB, ADD COLUMN "hs_confirmed_by_id" TEXT,
  ADD COLUMN "hs_confirmed_at" TIMESTAMP(3), ADD COLUMN "hs_classification_revision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "ProductClassification" (
  "id" TEXT NOT NULL, "product_id" TEXT NOT NULL, "revision" INTEGER NOT NULL, "itc_hs_code" TEXT,
  "hs6_code" TEXT NOT NULL, "nomenclature" TEXT NOT NULL, "nomenclature_version" TEXT NOT NULL,
  "method" "ProductClassificationMethod" NOT NULL, "evidence" JSONB NOT NULL, "confidence" DECIMAL(5,4) NOT NULL,
  "status" "ProductClassificationStatus" NOT NULL, "proposed_by_id" TEXT NOT NULL,
  "proposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "confirmed_by_id" TEXT,
  "confirmed_at" TIMESTAMP(3), "superseded_at" TIMESTAMP(3), CONSTRAINT "ProductClassification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductClassification_product_id_revision_key" ON "ProductClassification"("product_id","revision");
CREATE INDEX "ProductClassification_product_id_status_idx" ON "ProductClassification"("product_id","status");
ALTER TABLE "ProductClassification" ADD CONSTRAINT "ProductClassification_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductClassification" ADD CONSTRAINT "ProductClassification_proposed_by_id_fkey" FOREIGN KEY ("proposed_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductClassification" ADD CONSTRAINT "ProductClassification_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_hs_confirmed_by_id_fkey" FOREIGN KEY ("hs_confirmed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketAssessment" ADD COLUMN "classification_id" TEXT, ADD COLUMN "classification_hs6_code" TEXT,
  ADD COLUMN "classification_itc_hs_code" TEXT, ADD COLUMN "classification_nomenclature" TEXT,
  ADD COLUMN "classification_version" TEXT, ADD COLUMN "classification_current" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "classification_invalidated_at" TIMESTAMP(3), ADD COLUMN "classification_invalidation_reason" TEXT;
-- Existing codes remain usable historical values but are deliberately not marked confirmed.
UPDATE "Product" SET "hs_classification_status"='needs_review', "hs_classification_evidence"='{"migration":"legacy code; confirmation unproven"}' WHERE "hs_code" IS NOT NULL;
UPDATE "MarketAssessment" ma SET "classification_hs6_code"=(dr."input_snapshot"->>'hs_code'),
  "classification_nomenclature"='unknown_legacy', "classification_version"='unknown_legacy'
  FROM "DiscoveryRun" dr WHERE ma."run_id"=dr."id";
