ALTER TABLE "Product" ADD COLUMN "evidence_origin" "EvidenceOrigin" NOT NULL DEFAULT 'unknown_legacy';

-- Only deterministic repository seed identifiers are mechanically proven fixtures.
UPDATE "Product" SET "evidence_origin" = 'fixture' WHERE "id" LIKE 'seed-%';
CREATE INDEX "Product_evidence_origin_idx" ON "Product"("evidence_origin");
