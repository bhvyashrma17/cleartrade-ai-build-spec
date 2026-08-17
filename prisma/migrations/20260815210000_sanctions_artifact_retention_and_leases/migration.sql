-- Sanctions raw-artifact retention + refresh leases (Parts D, F).
-- Scoped to sanctions tables only; unrelated pre-existing drift is deliberately not bundled.

CREATE TYPE "SanctionsArtifactVerification" AS ENUM ('unverified', 'verified', 'mismatch', 'unsupported');

CREATE TABLE "SanctionsArtifact" (
    "id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "source_contract_version" TEXT NOT NULL,
    "evidence_origin" "EvidenceOrigin" NOT NULL DEFAULT 'public_real',
    "source_reference" TEXT NOT NULL,
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "provider_published_at" TIMESTAMP(3),
    "provider_version" TEXT,
    "http_status" INTEGER,
    "media_type" TEXT,
    "byte_length" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "etag" TEXT,
    "last_modified" TEXT,
    "storage_provider" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "object_version_id" TEXT,
    "persisted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verification_status" "SanctionsArtifactVerification" NOT NULL DEFAULT 'unverified',
    "verification_detail" TEXT,
    "verified_at" TIMESTAMP(3),
    "snapshot_id" TEXT,
    "ingest_run_id" TEXT,
    CONSTRAINT "SanctionsArtifact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SanctionsArtifact_snapshot_id_key" ON "SanctionsArtifact"("snapshot_id");
CREATE INDEX "SanctionsArtifact_dataset_retrieved_at_idx" ON "SanctionsArtifact"("dataset", "retrieved_at");
CREATE INDEX "SanctionsArtifact_sha256_idx" ON "SanctionsArtifact"("sha256");
ALTER TABLE "SanctionsArtifact" ADD CONSTRAINT "SanctionsArtifact_snapshot_id_fkey"
  FOREIGN KEY ("snapshot_id") REFERENCES "SanctionsSourceSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Part F4: cross-process refresh lease. In-memory mutexes cannot coordinate across worker
-- processes; expires_at guarantees a crashed worker cannot hold a dataset locked forever.
CREATE TABLE "SanctionsRefreshLease" (
    "dataset" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "job_id" TEXT,
    CONSTRAINT "SanctionsRefreshLease_pkey" PRIMARY KEY ("dataset")
);
CREATE INDEX "SanctionsRefreshLease_expires_at_idx" ON "SanctionsRefreshLease"("expires_at");

-- Part F5: enforce the <=1-active-snapshot-per-dataset invariant IN THE DATABASE.
-- Application convention is not sufficient under concurrency: two workers activating
-- competing candidates simultaneously would each pass an application-level check. A partial
-- unique index makes a second concurrent activation impossible at the storage layer.
CREATE UNIQUE INDEX "SanctionsSourceSnapshot_one_active_per_source"
  ON "SanctionsSourceSnapshot"("source") WHERE "state" = 'active';
