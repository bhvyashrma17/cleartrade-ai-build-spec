ALTER TABLE "ImportRecord"
  ADD COLUMN IF NOT EXISTS "evidence_origin" "EvidenceOrigin" NOT NULL DEFAULT 'unknown_legacy',
  ADD COLUMN IF NOT EXISTS "ingest_run_id" TEXT;
UPDATE "ImportRecord" SET "evidence_origin" = 'fixture' WHERE "source_record_id" LIKE 'verify-%';

ALTER TABLE "BuyerOutcome" ADD COLUMN IF NOT EXISTS "evidence_origin" "EvidenceOrigin" NOT NULL DEFAULT 'unknown_legacy';
ALTER TABLE "BuyerFitAssessment" ADD COLUMN IF NOT EXISTS "evidence_origins" "EvidenceOrigin"[] NOT NULL DEFAULT ARRAY['unknown_legacy']::"EvidenceOrigin"[];
ALTER TABLE "SanctionsEntity" ADD COLUMN IF NOT EXISTS "evidence_origin" "EvidenceOrigin" NOT NULL DEFAULT 'unknown_legacy';
ALTER TABLE "SanctionsIngestRun" ADD COLUMN IF NOT EXISTS "evidence_origin" "EvidenceOrigin" NOT NULL DEFAULT 'unknown_legacy';
ALTER TABLE "SanctionsSourceSnapshot"
  ADD COLUMN IF NOT EXISTS "evidence_origin" "EvidenceOrigin" NOT NULL DEFAULT 'unknown_legacy',
  ADD COLUMN IF NOT EXISTS "coverage_complete" BOOLEAN NOT NULL DEFAULT false;
UPDATE "SanctionsEntity" SET "evidence_origin" = 'fixture' WHERE "source" LIKE 'verify-%';

CREATE INDEX IF NOT EXISTS "ImportRecord_evidence_origin_shipment_date_idx" ON "ImportRecord"("evidence_origin", "shipment_date");
CREATE INDEX IF NOT EXISTS "ImportRecord_ingest_run_id_idx" ON "ImportRecord"("ingest_run_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ImportRecord_ingest_run_id_fkey') THEN
    ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_ingest_run_id_fkey"
      FOREIGN KEY ("ingest_run_id") REFERENCES "IngestRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
