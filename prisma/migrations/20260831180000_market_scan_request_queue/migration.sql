-- Exporter-initiated market scan requests, and the staff approval that releases the metered work.
--
-- A global screen costs roughly 218 metered provider calls, so execution stays staff-gated
-- (see runGlobalCountryScreening). This table is the safe front door: the exporter records a
-- request, and approval hands off to the canonical screening service. There is deliberately no
-- column for reporters, provider mode, quota or policy — those are derived server-side.

CREATE TYPE "MarketScanRequestStatus" AS ENUM ('pending', 'approved', 'queued', 'running', 'completed', 'rejected', 'failed');

CREATE TABLE "MarketScanRequest" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_classification_id" TEXT NOT NULL,
    "hs6_code" TEXT NOT NULL,
    "hs_revision" TEXT NOT NULL,
    "status" "MarketScanRequestStatus" NOT NULL DEFAULT 'pending',
    "requested_by_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "screening_job_id" TEXT,
    "screening_run_id" TEXT,
    "resolution_note" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketScanRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketScanRequest_exporter_org_id_status_requested_at_idx" ON "MarketScanRequest"("exporter_org_id", "status", "requested_at");
CREATE INDEX "MarketScanRequest_status_requested_at_idx" ON "MarketScanRequest"("status", "requested_at");
CREATE INDEX "MarketScanRequest_product_classification_id_status_idx" ON "MarketScanRequest"("product_classification_id", "status");

-- At most ONE open request per classification. This is the idempotency guarantee that makes a
-- double-clicked button a no-op rather than a queue full of identical metered work, and it is
-- enforced by the database rather than by a read-then-write the UI could race.
CREATE UNIQUE INDEX "MarketScanRequest_one_open_per_classification"
    ON "MarketScanRequest"("product_classification_id")
    WHERE "status" IN ('pending', 'approved', 'queued', 'running');

-- A rejection must say why, and only a rejection may carry a reason.
ALTER TABLE "MarketScanRequest" ADD CONSTRAINT "MarketScanRequest_rejection_reason_required"
    CHECK (("status" = 'rejected') = ("rejection_reason" IS NOT NULL));

-- A decision must record who made it and when, together.
ALTER TABLE "MarketScanRequest" ADD CONSTRAINT "MarketScanRequest_decision_is_attributed"
    CHECK (("decided_by_id" IS NULL) = ("decided_at" IS NULL));

ALTER TABLE "MarketScanRequest" ADD CONSTRAINT "MarketScanRequest_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketScanRequest" ADD CONSTRAINT "MarketScanRequest_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketScanRequest" ADD CONSTRAINT "MarketScanRequest_product_classification_id_fkey" FOREIGN KEY ("product_classification_id") REFERENCES "ProductClassification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketScanRequest" ADD CONSTRAINT "MarketScanRequest_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketScanRequest" ADD CONSTRAINT "MarketScanRequest_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
