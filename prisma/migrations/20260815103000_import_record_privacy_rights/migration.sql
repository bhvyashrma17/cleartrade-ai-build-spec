-- CreateEnum
CREATE TYPE "RawRetentionPolicy" AS ENUM ('retain_until_expiry', 'delete_at_expiry', 'pseudonymize_at_expiry');

-- CreateEnum
CREATE TYPE "DerivedDataPolicy" AS ENUM ('prohibited', 'retain_aggregates', 'retain_pseudonymous', 'retain_derived', 'unspecified');

-- CreateEnum
CREATE TYPE "DataDeletionRequestStatus" AS ENUM ('requested', 'under_review', 'approved', 'rejected', 'completed');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'import_record_retention';

-- AlterTable
ALTER TABLE "ImportRecord" ADD COLUMN     "buyer_ref_key_version" TEXT,
ADD COLUMN     "rights_grant_id" TEXT;

-- CreateTable
CREATE TABLE "SourceRightsGrant" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "delivery_batch_id" TEXT NOT NULL,
    "license_type" TEXT NOT NULL,
    "contract_license_ref" TEXT,
    "effective_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "allowed_to_display" BOOLEAN NOT NULL,
    "allowed_to_export" BOOLEAN NOT NULL,
    "allowed_to_cache" BOOLEAN NOT NULL,
    "raw_retention_policy" "RawRetentionPolicy" NOT NULL,
    "derived_data_policy" "DerivedDataPolicy" NOT NULL DEFAULT 'unspecified',
    "evidence_document_ref" TEXT,
    "evidence_checksum" TEXT NOT NULL,
    "verification_method" TEXT NOT NULL DEFAULT 'operator_asserted',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceRightsGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawImportIdentity" (
    "id" TEXT NOT NULL,
    "import_record_id" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "auth_tag" BYTEA NOT NULL,
    "key_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawImportIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawDataAccessEvent" (
    "id" TEXT NOT NULL,
    "import_record_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawDataAccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRetentionEvent" (
    "id" TEXT NOT NULL,
    "import_record_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "dry_run" BOOLEAN NOT NULL,
    "raw_identity_deleted" BOOLEAN NOT NULL DEFAULT false,
    "record_deleted" BOOLEAN NOT NULL DEFAULT false,
    "derived_preserved" BOOLEAN NOT NULL,
    "policy_snapshot" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_record_id" TEXT NOT NULL,

    CONSTRAINT "ImportRetentionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataDeletionRequest" (
    "id" TEXT NOT NULL,
    "subject_reference" TEXT NOT NULL,
    "request_scope" JSONB NOT NULL,
    "status" "DataDeletionRequestStatus" NOT NULL DEFAULT 'requested',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_id" TEXT,
    "decision_reason" TEXT,
    "completed_at" TIMESTAMP(3),
    "review_events" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "DataDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceRightsGrant_expires_at_idx" ON "SourceRightsGrant"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "SourceRightsGrant_provider_delivery_batch_id_evidence_check_key" ON "SourceRightsGrant"("provider", "delivery_batch_id", "evidence_checksum");

-- CreateIndex
CREATE UNIQUE INDEX "RawImportIdentity_import_record_id_key" ON "RawImportIdentity"("import_record_id");

-- CreateIndex
CREATE INDEX "RawDataAccessEvent_import_record_id_accessed_at_idx" ON "RawDataAccessEvent"("import_record_id", "accessed_at");

-- CreateIndex
CREATE INDEX "RawDataAccessEvent_actor_user_id_accessed_at_idx" ON "RawDataAccessEvent"("actor_user_id", "accessed_at");

-- CreateIndex
CREATE INDEX "ImportRetentionEvent_occurred_at_idx" ON "ImportRetentionEvent"("occurred_at");

-- CreateIndex
CREATE INDEX "DataDeletionRequest_status_requested_at_idx" ON "DataDeletionRequest"("status", "requested_at");

-- CreateIndex
CREATE INDEX "ImportRecord_rights_grant_id_idx" ON "ImportRecord"("rights_grant_id");

-- AddForeignKey
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_rights_grant_id_fkey" FOREIGN KEY ("rights_grant_id") REFERENCES "SourceRightsGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawImportIdentity" ADD CONSTRAINT "RawImportIdentity_import_record_id_fkey" FOREIGN KEY ("import_record_id") REFERENCES "ImportRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawDataAccessEvent" ADD CONSTRAINT "RawDataAccessEvent_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataDeletionRequest" ADD CONSTRAINT "DataDeletionRequest_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing rows only carried copied sidecar assertions. Classify them conservatively;
-- do not promote them to a reviewed grant or permit them in real workflows.
INSERT INTO "SourceRightsGrant" (
  "id", "provider", "delivery_batch_id", "license_type", "allowed_to_display",
  "allowed_to_export", "allowed_to_cache", "raw_retention_policy",
  "derived_data_policy", "evidence_checksum", "verification_method"
)
SELECT concat('legacy_rights_', md5(concat_ws('|', "source_provider", "license_type"))),
       "source_provider", 'unknown-legacy-batch', "license_type", false, false, false,
       'delete_at_expiry', 'unspecified',
       md5(concat_ws('|', "source_provider", "license_type")), 'legacy_unverified'
FROM "ImportRecord" GROUP BY "source_provider", "license_type"
ON CONFLICT DO NOTHING;

UPDATE "ImportRecord" r SET "rights_grant_id" = concat('legacy_rights_', md5(concat_ws('|', r."source_provider", r."license_type"))),
  "allowed_to_display" = false, "allowed_to_export" = false, "allowed_to_cache" = false,
  "raw_consignee_string" = NULL
WHERE r."rights_grant_id" IS NULL;

UPDATE "Buyer" b SET "legal_name" = concat('Legacy manifest buyer ', right(b."id", 10)),
  "display_name" = concat('Legacy manifest buyer ', right(b."id", 10))
WHERE EXISTS (SELECT 1 FROM "ImportRecord" r WHERE r."buyer_id" = b."id" AND r."rights_grant_id" LIKE 'legacy_rights_%');

UPDATE "BuyerAttributeClaim" c SET "value" = to_jsonb(concat('legacy-redacted:', right(c."buyer_id", 10)))
WHERE c."attribute" = 'name' AND EXISTS (
  SELECT 1 FROM "ImportRecord" r WHERE r."buyer_id" = c."buyer_id" AND r."rights_grant_id" LIKE 'legacy_rights_%'
);
