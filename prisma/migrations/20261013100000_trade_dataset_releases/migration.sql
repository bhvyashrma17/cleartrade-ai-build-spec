-- docs/36 §3. Retained bulk trade dataset releases (CEPII BACI) and small reference datasets.
--
-- Forward-only. Trade rows are never stored here: an archive is partitioned by year and HS2
-- chapter into checksummed objects in storage, recorded below. Every record is evidence, so
-- partitions, country maps and reference rows are immutable, and a release's identity cannot
-- change once written.

CREATE TYPE "TradeDatasetReleaseStatus" AS ENUM ('importing', 'ready', 'failed', 'superseded');
CREATE TYPE "ReferenceDatasetReleaseStatus" AS ENUM ('active', 'superseded');

CREATE TABLE "TradeDatasetRelease" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "dataset_version" TEXT NOT NULL,
    "hs_revision" TEXT NOT NULL,
    "first_year" INTEGER NOT NULL,
    "last_year" INTEGER NOT NULL,
    "source_url" TEXT NOT NULL,
    "licence" TEXT NOT NULL,
    "archive_sha256" TEXT NOT NULL,
    "archive_bytes" BIGINT NOT NULL,
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "reader_version" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "status" "TradeDatasetReleaseStatus" NOT NULL DEFAULT 'importing',
    "row_count" BIGINT NOT NULL DEFAULT 0,
    "partition_count" INTEGER NOT NULL DEFAULT 0,
    "manifest_sha256" TEXT,
    "validation" JSONB NOT NULL DEFAULT '{}',
    "environment" TEXT NOT NULL,
    "evidence_origin" "EvidenceOrigin" NOT NULL,
    "imported_by_id" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),
    "correlation_id" TEXT,

    CONSTRAINT "TradeDatasetRelease_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TradeDatasetRelease_years_ordered" CHECK ("first_year" <= "last_year"),
    CONSTRAINT "TradeDatasetRelease_sha256_format" CHECK ("archive_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "TradeDatasetRelease_ready_is_complete" CHECK (
        "status" NOT IN ('ready', 'superseded')
        OR ("manifest_sha256" IS NOT NULL AND "completed_at" IS NOT NULL AND "partition_count" > 0)
    )
);

CREATE INDEX "TradeDatasetRelease_provider_status_idx"
    ON "TradeDatasetRelease"("provider", "hs_revision", "status", "last_year");

-- One live release per archive identity per environment. A failed attempt does not block a retry.
CREATE UNIQUE INDEX "TradeDatasetRelease_live_identity_key"
    ON "TradeDatasetRelease"("provider", "dataset_version", "hs_revision", "archive_sha256", "environment")
    WHERE "status" IN ('importing', 'ready');

ALTER TABLE "TradeDatasetRelease" ADD CONSTRAINT "TradeDatasetRelease_imported_by_id_fkey"
    FOREIGN KEY ("imported_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TradeDatasetPartition" (
    "id" TEXT NOT NULL,
    "release_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "hs_chapter" VARCHAR(2) NOT NULL,
    "object_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "row_count" INTEGER NOT NULL,
    "value_sum" DECIMAL(24,3) NOT NULL,

    CONSTRAINT "TradeDatasetPartition_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TradeDatasetPartition_chapter_format" CHECK ("hs_chapter" ~ '^[0-9]{2}$'),
    CONSTRAINT "TradeDatasetPartition_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "TradeDatasetPartition_counts_positive" CHECK ("row_count" > 0 AND "bytes" > 0)
);

CREATE UNIQUE INDEX "TradeDatasetPartition_release_year_chapter_key"
    ON "TradeDatasetPartition"("release_id", "year", "hs_chapter");

ALTER TABLE "TradeDatasetPartition" ADD CONSTRAINT "TradeDatasetPartition_release_id_fkey"
    FOREIGN KEY ("release_id") REFERENCES "TradeDatasetRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TradeDatasetCountry" (
    "id" TEXT NOT NULL,
    "release_id" TEXT NOT NULL,
    "provider_code" TEXT NOT NULL,
    "iso2" VARCHAR(2),
    "iso3" VARCHAR(3),
    "name" TEXT NOT NULL,

    CONSTRAINT "TradeDatasetCountry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TradeDatasetCountry_release_code_key"
    ON "TradeDatasetCountry"("release_id", "provider_code");
CREATE INDEX "TradeDatasetCountry_release_iso2_idx"
    ON "TradeDatasetCountry"("release_id", "iso2");

ALTER TABLE "TradeDatasetCountry" ADD CONSTRAINT "TradeDatasetCountry_release_id_fkey"
    FOREIGN KEY ("release_id") REFERENCES "TradeDatasetRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ReferenceDatasetRelease" (
    "id" TEXT NOT NULL,
    "dataset_key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "source_sha256" TEXT NOT NULL,
    "source_bytes" INTEGER NOT NULL,
    "licence" TEXT NOT NULL,
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "parser_version" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "rows" JSONB NOT NULL,
    "rows_sha256" TEXT NOT NULL,
    "validation" JSONB NOT NULL DEFAULT '{}',
    "status" "ReferenceDatasetReleaseStatus" NOT NULL DEFAULT 'active',
    "environment" TEXT NOT NULL,
    "evidence_origin" "EvidenceOrigin" NOT NULL,
    "imported_by_id" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMP(3),
    "correlation_id" TEXT,

    CONSTRAINT "ReferenceDatasetRelease_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReferenceDatasetRelease_sha256_format" CHECK ("source_sha256" ~ '^[0-9a-f]{64}$' AND "rows_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ReferenceDatasetRelease_rows_counted" CHECK ("row_count" = jsonb_array_length("rows")),
    CONSTRAINT "ReferenceDatasetRelease_superseded_is_timestamped" CHECK (("status" = 'superseded') = ("superseded_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "ReferenceDatasetRelease_identity_key"
    ON "ReferenceDatasetRelease"("dataset_key", "source_sha256", "parser_version", "environment");
CREATE INDEX "ReferenceDatasetRelease_key_status_idx"
    ON "ReferenceDatasetRelease"("dataset_key", "environment", "status", "imported_at");
-- At most one active release per dataset per environment.
CREATE UNIQUE INDEX "ReferenceDatasetRelease_one_active_key"
    ON "ReferenceDatasetRelease"("dataset_key", "environment")
    WHERE "status" = 'active';

ALTER TABLE "ReferenceDatasetRelease" ADD CONSTRAINT "ReferenceDatasetRelease_imported_by_id_fkey"
    FOREIGN KEY ("imported_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A release's identity never changes. While importing, only its progress fields move; once ready it
-- may only be superseded; a failed release is final. Nothing is ever deleted.
CREATE OR REPLACE FUNCTION trade_dataset_release_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TradeDatasetRelease is never deleted (id=%).', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."dataset_version" IS DISTINCT FROM OLD."dataset_version"
     OR NEW."hs_revision" IS DISTINCT FROM OLD."hs_revision"
     OR NEW."first_year" IS DISTINCT FROM OLD."first_year"
     OR NEW."last_year" IS DISTINCT FROM OLD."last_year"
     OR NEW."source_url" IS DISTINCT FROM OLD."source_url"
     OR NEW."licence" IS DISTINCT FROM OLD."licence"
     OR NEW."archive_sha256" IS DISTINCT FROM OLD."archive_sha256"
     OR NEW."archive_bytes" IS DISTINCT FROM OLD."archive_bytes"
     OR NEW."retrieved_at" IS DISTINCT FROM OLD."retrieved_at"
     OR NEW."reader_version" IS DISTINCT FROM OLD."reader_version"
     OR NEW."parser_version" IS DISTINCT FROM OLD."parser_version"
     OR NEW."environment" IS DISTINCT FROM OLD."environment"
     OR NEW."evidence_origin" IS DISTINCT FROM OLD."evidence_origin"
     OR NEW."imported_by_id" IS DISTINCT FROM OLD."imported_by_id"
     OR NEW."imported_at" IS DISTINCT FROM OLD."imported_at"
     OR NEW."correlation_id" IS DISTINCT FROM OLD."correlation_id" THEN
    RAISE EXCEPTION 'TradeDatasetRelease identity is immutable (id=%).', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" = 'importing' THEN
    IF NEW."status" NOT IN ('importing', 'ready', 'failed') OR NEW."superseded_at" IS NOT NULL THEN
      RAISE EXCEPTION 'An importing TradeDatasetRelease can only become ready or failed (id=%).', OLD."id" USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" = 'ready' AND NEW."status" = 'superseded' AND NEW."superseded_at" IS NOT NULL
     AND OLD."superseded_at" IS NULL
     AND NEW."row_count" = OLD."row_count" AND NEW."partition_count" = OLD."partition_count"
     AND NEW."manifest_sha256" IS NOT DISTINCT FROM OLD."manifest_sha256"
     AND NEW."validation" = OLD."validation"
     AND NEW."completed_at" IS NOT DISTINCT FROM OLD."completed_at" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'TradeDatasetRelease in status % is immutable (id=%).', OLD."status", OLD."id" USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trade_dataset_release_guard
  BEFORE UPDATE OR DELETE ON "TradeDatasetRelease"
  FOR EACH ROW EXECUTE FUNCTION trade_dataset_release_guard();

CREATE OR REPLACE FUNCTION trade_dataset_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (id=%).', TG_TABLE_NAME, OLD."id" USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trade_dataset_partition_append_only
  BEFORE UPDATE OR DELETE ON "TradeDatasetPartition"
  FOR EACH ROW EXECUTE FUNCTION trade_dataset_append_only();

CREATE TRIGGER trade_dataset_country_append_only
  BEFORE UPDATE OR DELETE ON "TradeDatasetCountry"
  FOR EACH ROW EXECUTE FUNCTION trade_dataset_append_only();

-- Reference rows are evidence: only `status` may move, once, from active to superseded.
CREATE OR REPLACE FUNCTION reference_dataset_release_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ReferenceDatasetRelease is never deleted (id=%).', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" = 'active' AND NEW."status" = 'superseded'
     AND (to_jsonb(NEW) - 'status' - 'superseded_at') = (to_jsonb(OLD) - 'status' - 'superseded_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ReferenceDatasetRelease is immutable except active -> superseded (id=%).', OLD."id" USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reference_dataset_release_guard
  BEFORE UPDATE OR DELETE ON "ReferenceDatasetRelease"
  FOR EACH ROW EXECUTE FUNCTION reference_dataset_release_guard();
