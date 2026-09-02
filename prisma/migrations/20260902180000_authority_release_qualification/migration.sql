-- Real-archive operational qualification for bulk authority adapters.
--
-- Forward-only. This cannot be stored on "TaricRelease" (the AuthorityRelease table): that row is
-- immutable by trigger, `validation` included, and qualification is legitimately re-derived when a
-- parser version changes or an archive grows. Rows here are appended, never updated, so a memory
-- regression stays visible as history instead of overwriting the result that preceded it.
CREATE TABLE "AuthorityReleaseQualification" (
  "id" TEXT NOT NULL,
  "release_id" TEXT NOT NULL,
  "source_family" TEXT NOT NULL,
  "release_identifier" TEXT NOT NULL,
  "parser_version" TEXT NOT NULL,
  "archive_checksum" TEXT NOT NULL,
  "row_count" INTEGER NOT NULL,
  "peak_rss_bytes" BIGINT NOT NULL,
  "ceiling_bytes" BIGINT NOT NULL,
  "concurrency" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL,
  "qualified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuthorityReleaseQualification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuthorityReleaseQualification_release_idx"
  ON "AuthorityReleaseQualification"("release_id", "qualified_at");

CREATE INDEX "AuthorityReleaseQualification_family_idx"
  ON "AuthorityReleaseQualification"("source_family", "qualified_at");

ALTER TABLE "AuthorityReleaseQualification"
  ADD CONSTRAINT "AuthorityReleaseQualification_release_id_fkey"
  FOREIGN KEY ("release_id") REFERENCES "TaricRelease"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only: a qualification result is evidence of what was measured at a point in time.
-- Re-qualifying appends a new row; it never rewrites the previous verdict.
CREATE OR REPLACE FUNCTION authority_release_qualification_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuthorityReleaseQualification is append-only: record a new qualification (id=%).', OLD.id
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER authority_release_qualification_append_only
  BEFORE UPDATE OR DELETE ON "AuthorityReleaseQualification"
  FOR EACH ROW EXECUTE FUNCTION authority_release_qualification_append_only();
