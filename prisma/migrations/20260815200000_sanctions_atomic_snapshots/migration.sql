-- Sanctions atomic snapshots (Phase 2/4/7).
--
-- Scoped deliberately to the sanctions tables only. `prisma migrate diff` also proposed
-- unrelated pre-existing drift repair (index renames, dropped MarketAssessment defaults,
-- FK recreation on Notification*). That drift predates this change and is left alone —
-- bundling it here would make a compliance-critical migration carry unreviewed collateral.

-- CreateEnum
CREATE TYPE "SanctionsSnapshotState" AS ENUM ('candidate', 'active', 'superseded', 'rejected');

-- CreateEnum
CREATE TYPE "SanctionsFailureStage" AS ENUM ('none', 'retrieval', 'artifact_validation', 'parsing', 'completeness', 'activation');

-- AlterTable: snapshot lifecycle, contract identity, artifact integrity, failure separation
ALTER TABLE "SanctionsSourceSnapshot"
  ADD COLUMN "state" "SanctionsSnapshotState" NOT NULL DEFAULT 'candidate',
  ADD COLUMN "activated_at" TIMESTAMP(3),
  ADD COLUMN "superseded_at" TIMESTAMP(3),
  ADD COLUMN "source_contract_version" TEXT,
  ADD COLUMN "authority" TEXT,
  ADD COLUMN "dataset_name" TEXT,
  ADD COLUMN "adapter_version" TEXT,
  ADD COLUMN "media_type" TEXT,
  ADD COLUMN "byte_length" INTEGER,
  ADD COLUMN "http_status" INTEGER,
  ADD COLUMN "etag" TEXT,
  ADD COLUMN "last_modified" TEXT,
  ADD COLUMN "artifact_ref" TEXT,
  ADD COLUMN "failure_stage" "SanctionsFailureStage" NOT NULL DEFAULT 'none',
  ADD COLUMN "failure_reason" TEXT,
  ADD COLUMN "anomalies" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "ingest_run_id" TEXT;

-- Phase 17: existing rows are historical evidence of the prior broken state. They are NOT
-- promoted. The legacy OFAC row (19199 retrieved / 0 parsed, evidence_origin
-- unknown_legacy) becomes `rejected` so it is preserved and auditable but never served,
-- rather than being deleted or relabelled as if it had been a real snapshot.
UPDATE "SanctionsSourceSnapshot"
SET "state" = 'rejected',
    "failure_stage" = 'parsing',
    "failure_reason" = COALESCE("failure_reason", 'Legacy snapshot predating the versioned source contract; retained as history, never served.')
WHERE "completeness_status" <> 'COMPLETE';

UPDATE "SanctionsSourceSnapshot" SET "state" = 'active', "activated_at" = "fetched_at"
WHERE "completeness_status" = 'COMPLETE';

-- Snapshot is no longer one-row-per-source: history is retained and exactly one row per
-- source is `active`.
DROP INDEX IF EXISTS "SanctionsSourceSnapshot_source_key";
CREATE INDEX "SanctionsSourceSnapshot_source_state_idx" ON "SanctionsSourceSnapshot"("source", "state");
CREATE INDEX "SanctionsSourceSnapshot_source_fetched_at_idx" ON "SanctionsSourceSnapshot"("source", "fetched_at");

-- AlterTable: bind entities to the snapshot that produced them (atomic activation).
ALTER TABLE "SanctionsEntity"
  ADD COLUMN "snapshot_id" TEXT,
  ADD COLUMN "normalized_aliases" JSONB NOT NULL DEFAULT '[]';

DROP INDEX IF EXISTS "SanctionsEntity_source_source_record_id_key";
CREATE INDEX "SanctionsEntity_snapshot_id_idx" ON "SanctionsEntity"("snapshot_id");
CREATE UNIQUE INDEX "SanctionsEntity_snapshot_id_source_source_record_id_key"
  ON "SanctionsEntity"("snapshot_id", "source", "source_record_id");

-- AddForeignKey
ALTER TABLE "SanctionsSourceSnapshot" ADD CONSTRAINT "SanctionsSourceSnapshot_ingest_run_id_fkey"
  FOREIGN KEY ("ingest_run_id") REFERENCES "SanctionsIngestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SanctionsEntity" ADD CONSTRAINT "SanctionsEntity_snapshot_id_fkey"
  FOREIGN KEY ("snapshot_id") REFERENCES "SanctionsSourceSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
