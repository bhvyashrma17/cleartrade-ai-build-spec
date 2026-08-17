CREATE TYPE "FileScanStatus" AS ENUM ('pending', 'clean', 'infected', 'failed', 'unknown_legacy');

ALTER TABLE "Document"
  ADD COLUMN "storage_provider" TEXT,
  ADD COLUMN "storage_version_id" TEXT,
  ADD COLUMN "scan_status" "FileScanStatus" NOT NULL DEFAULT 'unknown_legacy',
  ADD COLUMN "scan_engine" TEXT,
  ADD COLUMN "scanned_at" TIMESTAMP(3),
  ADD COLUMN "uploaded_by_id" TEXT;

-- Existing references are development-local evidence unless independently migrated.
-- They deliberately remain unscanned/unknown rather than being relabelled clean.
UPDATE "Document" SET "storage_provider" = 'local' WHERE "file_ref" IS NOT NULL AND "source" = 'uploaded';
CREATE INDEX "Document_scan_status_idx" ON "Document"("scan_status");
