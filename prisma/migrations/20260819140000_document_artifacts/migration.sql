-- Phase 6 — one rendered artifact per document version per format.
--
-- Document keeps identity, version and the four lifecycle dimensions. This table exists only
-- because one version can be rendered to PDF and DOCX from the same frozen input, and Document
-- has a single file_ref.

-- CreateEnum
CREATE TYPE "DocumentFormat" AS ENUM ('pdf', 'docx', 'html');
-- CreateTable
CREATE TABLE "DocumentArtifact" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "format" "DocumentFormat" NOT NULL,
    "file_ref" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "engine_name" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "input_snapshot_id" TEXT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by_id" TEXT,

    CONSTRAINT "DocumentArtifact_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "DocumentArtifact_input_snapshot_id_idx" ON "DocumentArtifact"("input_snapshot_id");
-- CreateIndex
CREATE UNIQUE INDEX "DocumentArtifact_document_id_format_key" ON "DocumentArtifact"("document_id", "format");
-- AddForeignKey
ALTER TABLE "DocumentArtifact" ADD CONSTRAINT "DocumentArtifact_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "DocumentArtifact" ADD CONSTRAINT "DocumentArtifact_input_snapshot_id_fkey" FOREIGN KEY ("input_snapshot_id") REFERENCES "DocumentInputSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "DocumentArtifact" ADD CONSTRAINT "DocumentArtifact_generated_by_id_fkey" FOREIGN KEY ("generated_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Both hashes are SHA-256 hex. A malformed checksum means the artifact cannot be verified
-- against its bytes, which defeats the point of storing one.
ALTER TABLE "DocumentArtifact" ADD CONSTRAINT "DocumentArtifact_checksum_shape" CHECK (
    "checksum" ~ '^[0-9a-f]{64}$');
ALTER TABLE "DocumentArtifact" ADD CONSTRAINT "DocumentArtifact_content_hash_shape" CHECK (
    "content_hash" ~ '^[0-9a-f]{64}$');

-- A zero-byte artifact is a failed render recorded as a success. Refusing it here means a
-- partially-written file can never be presented as a downloadable document.
ALTER TABLE "DocumentArtifact" ADD CONSTRAINT "DocumentArtifact_size_positive" CHECK (
    "file_size_bytes" > 0);

-- An artifact must say which engine built it. Without this an old file could be silently
-- attributed to a renderer that would produce something different today.
ALTER TABLE "DocumentArtifact" ADD CONSTRAINT "DocumentArtifact_engine_identified" CHECK (
    length(btrim("engine_name")) > 0 AND length(btrim("engine_version")) > 0);
