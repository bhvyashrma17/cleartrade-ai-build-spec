-- Phase 7 — approval binds to immutable content.
--
-- The lifecycle rule the whole phase rests on: canonical data may change, an approved
-- document version may not. Application code already tries to honour that; these constraints
-- make it true regardless of which code path runs.

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "amended_from_version" INTEGER,
ADD COLUMN     "amendment_reason" TEXT;

-- An amendment states why it exists. Enforced as a shape rather than as "not null", because
-- version 1 of a document is not an amendment and has nothing to explain.
ALTER TABLE "Document" ADD CONSTRAINT "Document_amendment_shape" CHECK (
    ("amended_from_version" IS NULL AND "amendment_reason" IS NULL)
    OR ("amended_from_version" IS NOT NULL
        AND "amendment_reason" IS NOT NULL
        AND length(btrim("amendment_reason")) > 0));

-- An amendment supersedes an EARLIER version of itself, never a later one or itself.
ALTER TABLE "Document" ADD CONSTRAINT "Document_amendment_is_backward" CHECK (
    "amended_from_version" IS NULL OR "amended_from_version" < "version");

-- Backfill before constraining.
--
-- An approval whose binding can be reconstructed from the document's own content gets it.
-- One that cannot is reverted to `pending`: an approval bound to nothing is not a weaker
-- approval, it is a claim that no reviewer can be shown to have made, and inventing a
-- checksum to satisfy the constraint would make that claim permanent.
UPDATE "Document"
   SET "approved_version" = COALESCE("approved_version", "version"),
       "approved_checksum" = "checksum",
       "approved_at" = COALESCE("approved_at", "updated_at")
 WHERE "approval_status" = 'exporter_approved'
   AND "checksum" IS NOT NULL
   AND ("approved_checksum" IS NULL OR "approved_version" IS NULL OR "approved_at" IS NULL);

UPDATE "Document"
   SET "approval_status" = 'pending',
       "approved_version" = NULL,
       "approved_checksum" = NULL,
       "approved_at" = NULL,
       "approved_by_id" = NULL
 WHERE "approval_status" = 'exporter_approved'
   AND ("checksum" IS NULL OR "approved_by_id" IS NULL);

-- Approval carries the version and checksum it was given, or it is not an approval. The
-- application already writes all three together; this makes a partial write impossible.
ALTER TABLE "Document" ADD CONSTRAINT "Document_approval_binding_complete" CHECK (
    "approval_status" <> 'exporter_approved'
    OR ("approved_version" IS NOT NULL
        AND "approved_checksum" IS NOT NULL
        AND "approved_at" IS NOT NULL
        AND "approved_by_id" IS NOT NULL));

-- An approval belongs to the version that was approved. Without this, a row could claim
-- approval of v1 while presenting itself as v2.
ALTER TABLE "Document" ADD CONSTRAINT "Document_approval_matches_version" CHECK (
    "approved_version" IS NULL OR "approved_version" = "version");

-- ---------------------------------------------------------------------------
-- Approved content is frozen
-- ---------------------------------------------------------------------------

-- Once a version is approved, the bytes it was approved as cannot move underneath it.
--
-- This is the invariant whose violation would silently invalidate an approval: an exporter
-- approves the PDF they read, a regeneration replaces the stored file, and the approval still
-- reads as valid against content nobody ever saw. The service refuses it too, but a constraint
-- that only exists in application code is one forgotten call site away from being absent.
CREATE OR REPLACE FUNCTION "document_refuse_approved_content_change"() RETURNS trigger AS $$
BEGIN
    IF OLD."approval_status" = 'exporter_approved' THEN
        IF NEW."checksum" IS DISTINCT FROM OLD."checksum"
           OR NEW."file_ref" IS DISTINCT FROM OLD."file_ref"
           OR NEW."input_snapshot_id" IS DISTINCT FROM OLD."input_snapshot_id"
           OR NEW."version" IS DISTINCT FROM OLD."version"
           OR NEW."approved_checksum" IS DISTINCT FROM OLD."approved_checksum"
           OR NEW."approved_version" IS DISTINCT FROM OLD."approved_version" THEN
            RAISE EXCEPTION 'Document % is approved; its content and approval binding are frozen. Create a new version instead.', OLD."id"
                USING ERRCODE = 'restrict_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "document_approved_content_frozen"
    BEFORE UPDATE ON "Document"
    FOR EACH ROW EXECUTE FUNCTION "document_refuse_approved_content_change"();

-- The same rule one level down. `DocumentArtifact` is upserted by the renderer, so without
-- this a re-render of an approved version would replace the approved PDF in place — the exact
-- overwrite the phase spec calls out.
CREATE OR REPLACE FUNCTION "document_artifact_refuse_change_when_approved"() RETURNS trigger AS $$
DECLARE
    parent_status text;
    parent_id text;
BEGIN
    parent_id := COALESCE(NEW."document_id", OLD."document_id");
    SELECT "approval_status"::text INTO parent_status FROM "Document" WHERE "id" = parent_id;
    IF parent_status = 'exporter_approved' THEN
        RAISE EXCEPTION 'Document % is approved; its artifacts are frozen. Create a new version instead.', parent_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "document_artifact_frozen_when_approved"
    BEFORE UPDATE OR DELETE ON "DocumentArtifact"
    FOR EACH ROW EXECUTE FUNCTION "document_artifact_refuse_change_when_approved"();

-- Adding a NEW format to an already-approved version is refused for the same reason: it would
-- appear alongside the approved artifact as though it carried the same standing, without
-- having been reviewed. A new format after approval means a new version.
CREATE TRIGGER "document_artifact_no_insert_when_approved"
    BEFORE INSERT ON "DocumentArtifact"
    FOR EACH ROW EXECUTE FUNCTION "document_artifact_refuse_change_when_approved"();

-- ---------------------------------------------------------------------------
-- One current version
-- ---------------------------------------------------------------------------

-- Exactly one row per (deal, doc_type) may claim to be current. Concurrent amendments would
-- otherwise both set the flag and leave two "current" versions, which every read model in the
-- product would then have to guess between.
CREATE UNIQUE INDEX "Document_one_current_version_per_type"
    ON "Document"("deal_id", "doc_type") WHERE "is_current_version" = true;
