-- Official European Commission TARIC monthly extractions, uploaded by ClearTrade staff.
--
-- Immutable once imported: a new monthly extraction is a NEW release with its own identity, so an
-- assessment can always answer which exact release produced it. `bundle_sha256` is unique, which
-- is what stops the same bytes becoming two rival active releases.

CREATE TYPE "TaricReleaseStatus" AS ENUM ('imported', 'active', 'superseded', 'rejected');

CREATE TABLE "TaricRelease" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "reference_date" TIMESTAMP(3) NOT NULL,
    "source_authority" TEXT NOT NULL,
    "source_distribution" TEXT NOT NULL,
    "bundle_sha256" TEXT NOT NULL,
    "bundle_size_bytes" INTEGER NOT NULL,
    "artifact_object_key" TEXT NOT NULL,
    "file_manifest" JSONB NOT NULL,
    "reader_version" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "status" "TaricReleaseStatus" NOT NULL DEFAULT 'imported',
    "validation" JSONB NOT NULL,
    "imported_by_id" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),
    "correlation_id" TEXT,

    CONSTRAINT "TaricRelease_pkey" PRIMARY KEY ("id")
);

-- The same bytes are the same release. A re-upload is recognised, never duplicated.
CREATE UNIQUE INDEX "TaricRelease_bundle_sha256_key" ON "TaricRelease"("bundle_sha256");
CREATE INDEX "TaricRelease_status_reference_date_idx" ON "TaricRelease"("status", "reference_date");

-- At most one active release at a time: evidence must never be ambiguous about its source.
CREATE UNIQUE INDEX "TaricRelease_single_active" ON "TaricRelease"("status") WHERE "status" = 'active';

-- A rejected release never becomes readable evidence, and an active one must be activated.
ALTER TABLE "TaricRelease" ADD CONSTRAINT "TaricRelease_active_is_timestamped"
    CHECK ("status" <> 'active' OR "activated_at" IS NOT NULL);

ALTER TABLE "TaricRelease" ADD CONSTRAINT "TaricRelease_imported_by_id_fkey"
    FOREIGN KEY ("imported_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutability: an imported release is a frozen record of what the Commission published. Only the
-- lifecycle columns may move, and only forwards.
CREATE OR REPLACE FUNCTION taric_release_is_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TaricRelease is immutable: a release may not be deleted (id=%).', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.bundle_sha256 IS DISTINCT FROM OLD.bundle_sha256
     OR NEW.file_manifest::text IS DISTINCT FROM OLD.file_manifest::text
     OR NEW.reference_date IS DISTINCT FROM OLD.reference_date
     OR NEW.artifact_object_key IS DISTINCT FROM OLD.artifact_object_key
     OR NEW.parser_version IS DISTINCT FROM OLD.parser_version
     OR NEW.reader_version IS DISTINCT FROM OLD.reader_version
     OR NEW.imported_by_id IS DISTINCT FROM OLD.imported_by_id THEN
    RAISE EXCEPTION 'TaricRelease is immutable: source identity may not be altered (id=%).', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER taric_release_immutable
  BEFORE UPDATE OR DELETE ON "TaricRelease"
  FOR EACH ROW EXECUTE FUNCTION taric_release_is_immutable();
