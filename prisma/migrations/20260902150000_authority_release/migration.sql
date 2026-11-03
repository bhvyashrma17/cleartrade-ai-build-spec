-- Generalise the existing physical TaricRelease table in place. The table and enum names remain
-- untouched so all historical TARIC rows and migration checksums remain valid; Prisma maps the
-- widened table as AuthorityRelease.

CREATE TYPE "AuthorityReleaseChange" AS ENUM ('NEW_RELEASE', 'CHANGED');

ALTER TABLE "TaricRelease"
  ADD COLUMN "source_family" TEXT,
  ADD COLUMN "destination_scope" JSONB,
  ADD COLUMN "source_url" TEXT,
  ADD COLUMN "release_identifier" TEXT,
  ADD COLUMN "retrieved_at" TIMESTAMP(3),
  ADD COLUMN "source_format" TEXT,
  ADD COLUMN "change_classification" "AuthorityReleaseChange",
  ADD COLUMN "change_basis" JSONB,
  ADD COLUMN "previous_release_id" TEXT;

-- Preserve old TARIC rows exactly while supplying the generic identity they always represented.
UPDATE "TaricRelease"
SET
  "source_family" = 'EU_TARIC',
  "destination_scope" = '["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"]'::jsonb,
  "source_url" = 'CIRCABC TARIC & Quota Data and Information',
  "release_identifier" = "label",
  "retrieved_at" = "imported_at",
  "source_format" = 'zip+xlsx',
  "change_classification" = 'NEW_RELEASE',
  "change_basis" = jsonb_build_object('migration_backfill', true, 'checksum', "bundle_sha256")
WHERE "source_family" IS NULL;

ALTER TABLE "TaricRelease"
  ALTER COLUMN "source_family" SET NOT NULL,
  ALTER COLUMN "destination_scope" SET NOT NULL,
  ALTER COLUMN "source_url" SET NOT NULL,
  ALTER COLUMN "release_identifier" SET NOT NULL,
  ALTER COLUMN "retrieved_at" SET NOT NULL,
  ALTER COLUMN "source_format" SET NOT NULL,
  ALTER COLUMN "change_classification" SET NOT NULL,
  ALTER COLUMN "change_basis" SET NOT NULL;

-- A checksum is evidence integrity, not a global business key. Idempotency is scoped to the
-- authority, its release identifier, and the retained bytes.
DROP INDEX "TaricRelease_bundle_sha256_key";
CREATE UNIQUE INDEX "AuthorityRelease_logical_acquisition_key"
  ON "TaricRelease"("source_family", "source_authority", "release_identifier", "bundle_sha256");

DROP INDEX "TaricRelease_status_reference_date_idx";
CREATE INDEX "AuthorityRelease_source_status_reference_idx"
  ON "TaricRelease"("source_family", "source_authority", "status", "reference_date");
CREATE INDEX "AuthorityRelease_previous_release_id_idx" ON "TaricRelease"("previous_release_id");

-- One active release per source, not one active release for the entire planet.
DROP INDEX "TaricRelease_single_active";
CREATE UNIQUE INDEX "AuthorityRelease_single_active_per_source"
  ON "TaricRelease"("source_family", "source_authority", "status") WHERE "status" = 'active';

ALTER TABLE "TaricRelease" ADD CONSTRAINT "AuthorityRelease_previous_release_id_fkey"
  FOREIGN KEY ("previous_release_id") REFERENCES "TaricRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MarketAccessEvidenceSnapshot"
  ADD COLUMN "ingest_identity" TEXT,
  ADD COLUMN "authority_release_id" TEXT;
CREATE UNIQUE INDEX "MarketAccessEvidenceSnapshot_ingest_identity_key"
  ON "MarketAccessEvidenceSnapshot"("ingest_identity");
CREATE INDEX "MarketAccessEvidenceSnapshot_authority_release_id_idx"
  ON "MarketAccessEvidenceSnapshot"("authority_release_id");
ALTER TABLE "MarketAccessEvidenceSnapshot" ADD CONSTRAINT "MarketAccessEvidenceSnapshot_authority_release_id_fkey"
  FOREIGN KEY ("authority_release_id") REFERENCES "TaricRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Replace the TARIC-specific immutability trigger with one covering every generic source field.
DROP TRIGGER "taric_release_immutable" ON "TaricRelease";
DROP FUNCTION "taric_release_is_immutable"();

CREATE OR REPLACE FUNCTION authority_release_is_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AuthorityRelease is immutable: a release may not be deleted (id=%).', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW."label" IS DISTINCT FROM OLD."label"
     OR NEW."source_family" IS DISTINCT FROM OLD."source_family"
     OR NEW."source_authority" IS DISTINCT FROM OLD."source_authority"
     OR NEW."destination_scope" IS DISTINCT FROM OLD."destination_scope"
     OR NEW."source_url" IS DISTINCT FROM OLD."source_url"
     OR NEW."release_identifier" IS DISTINCT FROM OLD."release_identifier"
     OR NEW."reference_date" IS DISTINCT FROM OLD."reference_date"
     OR NEW."source_distribution" IS DISTINCT FROM OLD."source_distribution"
     OR NEW."retrieved_at" IS DISTINCT FROM OLD."retrieved_at"
     OR NEW."source_format" IS DISTINCT FROM OLD."source_format"
     OR NEW."bundle_sha256" IS DISTINCT FROM OLD."bundle_sha256"
     OR NEW."bundle_size_bytes" IS DISTINCT FROM OLD."bundle_size_bytes"
     OR NEW."file_manifest" IS DISTINCT FROM OLD."file_manifest"
     OR NEW."artifact_object_key" IS DISTINCT FROM OLD."artifact_object_key"
     OR NEW."parser_version" IS DISTINCT FROM OLD."parser_version"
     OR NEW."reader_version" IS DISTINCT FROM OLD."reader_version"
     OR NEW."validation" IS DISTINCT FROM OLD."validation"
     OR NEW."change_classification" IS DISTINCT FROM OLD."change_classification"
     OR NEW."change_basis" IS DISTINCT FROM OLD."change_basis"
     OR NEW."previous_release_id" IS DISTINCT FROM OLD."previous_release_id"
     OR NEW."imported_by_id" IS DISTINCT FROM OLD."imported_by_id"
     OR NEW."imported_at" IS DISTINCT FROM OLD."imported_at"
     OR NEW."correlation_id" IS DISTINCT FROM OLD."correlation_id" THEN
    RAISE EXCEPTION 'AuthorityRelease is immutable: source identity may not be altered (id=%).', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER authority_release_immutable
  BEFORE UPDATE OR DELETE ON "TaricRelease"
  FOR EACH ROW EXECUTE FUNCTION authority_release_is_immutable();
