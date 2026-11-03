-- Phase 1H.2 independent handoff corrections.
--
-- A manually captured route is confidential exporter evidence, not a globally reusable public
-- route. Existing rows created through recordRouteEvidence are recoverably scoped from their
-- append-only AuditEvent; manually-entered rows without such provenance are fail-closed.
ALTER TABLE "LogisticsRouteEvidence"
  ADD COLUMN "exporter_org_id" TEXT,
  ADD COLUMN "assertion_class" "EvidenceAssertionClass" NOT NULL DEFAULT 'authoritative_public';

UPDATE "LogisticsRouteEvidence" AS route
SET "exporter_org_id" = audit."exporter_org_id",
    "assertion_class" = 'partner_quote'
FROM "AuditEvent" AS audit
WHERE audit."object_type" = 'logistics_route_evidence'
  AND audit."object_id" = route."id"
  AND audit."exporter_org_id" IS NOT NULL;

-- A manually entered row with no recoverable tenant is not public evidence. Leaving its tenant
-- null while marking it non-authoritative makes every selector exclude it instead of leaking it.
UPDATE "LogisticsRouteEvidence"
SET "assertion_class" = 'agent_verified'
WHERE "evidence_origin" = 'manually_entered_real'
  AND "exporter_org_id" IS NULL;

ALTER TABLE "LogisticsRouteEvidence"
  ADD CONSTRAINT "LogisticsRouteEvidence_exporter_org_id_fkey"
  FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "LogisticsRouteEvidence_provider_source_reference_key";
CREATE INDEX "LogisticsRouteEvidence_exporter_org_id_destination_country_idx"
  ON "LogisticsRouteEvidence"("exporter_org_id", "destination_country", "status");
CREATE INDEX "LogisticsRouteEvidence_provider_source_reference_idx"
  ON "LogisticsRouteEvidence"("provider", "source_reference");
CREATE UNIQUE INDEX "LogisticsRouteEvidence_exporter_org_id_provider_source_reference_key"
  ON "LogisticsRouteEvidence"("exporter_org_id", "provider", "source_reference");
CREATE UNIQUE INDEX "LogisticsRouteEvidence_global_provider_source_reference_key"
  ON "LogisticsRouteEvidence"("provider", "source_reference")
  WHERE "exporter_org_id" IS NULL;

-- The original immutability triggers compared only a subset of each row, allowing scope,
-- provenance and source fields to be rewritten. Supersession annotations are the sole permitted
-- update; every other column must remain byte-for-byte equivalent.
CREATE OR REPLACE FUNCTION cleartrade_operational_evidence_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."superseded_at" IS NULL
     AND NEW."superseded_at" IS NOT NULL
     AND NEW."superseded_by_id" IS NOT NULL
     AND NEW."id" IS NOT DISTINCT FROM OLD."id"
     AND NEW."exporter_org_id" IS NOT DISTINCT FROM OLD."exporter_org_id"
     AND NEW."product_id" IS NOT DISTINCT FROM OLD."product_id"
     AND NEW."product_classification_id" IS NOT DISTINCT FROM OLD."product_classification_id"
     AND NEW."destination_country" IS NOT DISTINCT FROM OLD."destination_country"
     AND NEW."hs6_code" IS NOT DISTINCT FROM OLD."hs6_code"
     AND NEW."hs_revision" IS NOT DISTINCT FROM OLD."hs_revision"
     AND NEW."component" IS NOT DISTINCT FROM OLD."component"
     AND NEW."quote_type" IS NOT DISTINCT FROM OLD."quote_type"
     AND NEW."amount" IS NOT DISTINCT FROM OLD."amount"
     AND NEW."currency" IS NOT DISTINCT FROM OLD."currency"
     AND NEW."rate_basis" IS NOT DISTINCT FROM OLD."rate_basis"
     AND NEW."quantity_unit" IS NOT DISTINCT FROM OLD."quantity_unit"
     AND NEW."percent_of_value" IS NOT DISTINCT FROM OLD."percent_of_value"
     AND NEW."percent_basis" IS NOT DISTINCT FROM OLD."percent_basis"
     AND NEW."cost_owner" IS NOT DISTINCT FROM OLD."cost_owner"
     AND NEW."route_evidence_id" IS NOT DISTINCT FROM OLD."route_evidence_id"
     AND NEW."transport_mode" IS NOT DISTINCT FROM OLD."transport_mode"
     AND NEW."equipment_code" IS NOT DISTINCT FROM OLD."equipment_code"
     AND NEW."carrier_name" IS NOT DISTINCT FROM OLD."carrier_name"
     AND NEW."partner_name" IS NOT DISTINCT FROM OLD."partner_name"
     AND NEW."quote_reference" IS NOT DISTINCT FROM OLD."quote_reference"
     AND NEW."coverage_terms" IS NOT DISTINCT FROM OLD."coverage_terms"
     AND NEW."coverage_percent" IS NOT DISTINCT FROM OLD."coverage_percent"
     AND NEW."observed_at" IS NOT DISTINCT FROM OLD."observed_at"
     AND NEW."effective_from" IS NOT DISTINCT FROM OLD."effective_from"
     AND NEW."valid_until" IS NOT DISTINCT FROM OLD."valid_until"
     AND NEW."assertion_class" IS NOT DISTINCT FROM OLD."assertion_class"
     AND NEW."evidence_origin" IS NOT DISTINCT FROM OLD."evidence_origin"
     AND NEW."source" IS NOT DISTINCT FROM OLD."source"
     AND NEW."source_reference" IS NOT DISTINCT FROM OLD."source_reference"
     AND NEW."document_id" IS NOT DISTINCT FROM OLD."document_id"
     AND NEW."entered_by_id" IS NOT DISTINCT FROM OLD."entered_by_id"
     AND NEW."verified_by_id" IS NOT DISTINCT FROM OLD."verified_by_id"
     AND NEW."verified_at" IS NOT DISTINCT FROM OLD."verified_at"
     AND NEW."derivation" IS NOT DISTINCT FROM OLD."derivation"
     AND NEW."confidence" IS NOT DISTINCT FROM OLD."confidence"
     AND NEW."status" IS NOT DISTINCT FROM OLD."status"
     AND NEW."raw_evidence" IS NOT DISTINCT FROM OLD."raw_evidence"
     AND NEW."created_at" IS NOT DISTINCT FROM OLD."created_at" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Operational cost evidence is immutable; supersede it with a new row instead of mutating %.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleartrade_refinement_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."superseded_at" IS NULL
     AND NEW."superseded_at" IS NOT NULL
     AND NEW."superseded_by_id" IS NOT NULL
     AND NEW."id" IS NOT DISTINCT FROM OLD."id"
     AND NEW."exporter_org_id" IS NOT DISTINCT FROM OLD."exporter_org_id"
     AND NEW."product_id" IS NOT DISTINCT FROM OLD."product_id"
     AND NEW."product_classification_id" IS NOT DISTINCT FROM OLD."product_classification_id"
     AND NEW."hs6_code" IS NOT DISTINCT FROM OLD."hs6_code"
     AND NEW."hs_revision" IS NOT DISTINCT FROM OLD."hs_revision"
     AND NEW."destination_country" IS NOT DISTINCT FROM OLD."destination_country"
     AND NEW."national_code_system" IS NOT DISTINCT FROM OLD."national_code_system"
     AND NEW."source_snapshot_id" IS NOT DISTINCT FROM OLD."source_snapshot_id"
     AND NEW."state" IS NOT DISTINCT FROM OLD."state"
     AND NEW."candidate_lines" IS NOT DISTINCT FROM OLD."candidate_lines"
     AND NEW."candidate_count" IS NOT DISTINCT FROM OLD."candidate_count"
     AND NEW."selected_national_code" IS NOT DISTINCT FROM OLD."selected_national_code"
     AND NEW."selection_rationale" IS NOT DISTINCT FROM OLD."selection_rationale"
     AND NEW."deciding_attributes" IS NOT DISTINCT FROM OLD."deciding_attributes"
     AND NEW."outstanding_questions" IS NOT DISTINCT FROM OLD."outstanding_questions"
     AND NEW."source_authority" IS NOT DISTINCT FROM OLD."source_authority"
     AND NEW."source_reference" IS NOT DISTINCT FROM OLD."source_reference"
     AND NEW."effective_from" IS NOT DISTINCT FROM OLD."effective_from"
     AND NEW."effective_to" IS NOT DISTINCT FROM OLD."effective_to"
     AND NEW."decided_by_id" IS NOT DISTINCT FROM OLD."decided_by_id"
     AND NEW."decided_at" IS NOT DISTINCT FROM OLD."decided_at"
     AND NEW."evidence_origin" IS NOT DISTINCT FROM OLD."evidence_origin"
     AND NEW."assertion_class" IS NOT DISTINCT FROM OLD."assertion_class"
     AND NEW."created_at" IS NOT DISTINCT FROM OLD."created_at" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A classification refinement is immutable; supersede it with a new record instead of mutating it.';
END;
$$ LANGUAGE plpgsql;
