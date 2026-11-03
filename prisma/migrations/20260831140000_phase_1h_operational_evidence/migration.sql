-- Phase 1H.2 — operational Country Truth evidence.
--
-- Strictly additive: a new enum value, nullable columns, new tables, new indexes. No column is
-- dropped, retyped or backfilled, so every historical row keeps its exact meaning and the
-- Phase 1G frozen artefacts and the deep baseline stay reproducible.
--
-- `prisma migrate diff` again proposes index renames, dropped defaults and foreign-key
-- recreations that predate this work. They are deliberately excluded: they are unrelated and
-- some are destructive.

-- AlterEnum
ALTER TYPE "EvidenceAssertionClass" ADD VALUE 'system_derived';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "available_capacity_value" DECIMAL(18,4),
ADD COLUMN     "capacity_period" TEXT,
ADD COLUMN     "cartons_per_pallet" INTEGER,
ADD COLUMN     "container_compatibility" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "origin_city" TEXT,
ADD COLUMN     "origin_country" VARCHAR(2),
ADD COLUMN     "origin_gateway_code" TEXT,
ADD COLUMN     "origin_location_code" TEXT,
ADD COLUMN     "origin_postal_code" TEXT,
ADD COLUMN     "origin_provenance" TEXT,
ADD COLUMN     "origin_state" TEXT,
ADD COLUMN     "pack_size_unit" TEXT,
ADD COLUMN     "pack_size_value" DECIMAL(18,4),
ADD COLUMN     "packaging_format" TEXT,
ADD COLUMN     "palletized" BOOLEAN,
ADD COLUMN     "special_handling_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "temperature_controlled" BOOLEAN,
ADD COLUMN     "temperature_max_celsius" DECIMAL(6,2),
ADD COLUMN     "temperature_min_celsius" DECIMAL(6,2),
ADD COLUMN     "units_per_carton" INTEGER,
ADD COLUMN     "shipment_container_count" INTEGER,
ADD COLUMN     "shipment_container_type" TEXT,
ADD COLUMN     "shipment_quantity_unit" TEXT,
ADD COLUMN     "shipment_quantity_value" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "ProductCertification" ADD COLUMN     "certificate_reference" TEXT,
ADD COLUMN     "declared_absent" BOOLEAN,
ADD COLUMN     "document_id" TEXT,
ADD COLUMN     "issuer" TEXT,
ADD COLUMN     "valid_from" TIMESTAMP(3),
ADD COLUMN     "verification_state" TEXT NOT NULL DEFAULT 'unverified',
ADD COLUMN     "verified_at" TIMESTAMP(3),
ADD COLUMN     "verified_by_id" TEXT;

-- CreateTable
CREATE TABLE "ProductClassificationRefinement" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_classification_id" TEXT NOT NULL,
    "hs6_code" TEXT NOT NULL,
    "hs_revision" TEXT NOT NULL,
    "destination_country" VARCHAR(2) NOT NULL,
    "national_code_system" TEXT NOT NULL,
    "source_snapshot_id" TEXT,
    "state" TEXT NOT NULL DEFAULT 'unresolved',
    "candidate_lines" JSONB NOT NULL,
    "candidate_count" INTEGER NOT NULL,
    "selected_national_code" TEXT,
    "selection_rationale" TEXT,
    "deciding_attributes" JSONB,
    "outstanding_questions" JSONB,
    "source_authority" TEXT NOT NULL,
    "source_reference" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3),
    "effective_to" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "evidence_origin" "EvidenceOrigin" NOT NULL DEFAULT 'unknown_legacy',
    "assertion_class" "EvidenceAssertionClass" NOT NULL DEFAULT 'unknown_legacy',
    "superseded_at" TIMESTAMP(3),
    "superseded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductClassificationRefinement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalCostEvidence" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_classification_id" TEXT,
    "destination_country" VARCHAR(2),
    "hs6_code" TEXT,
    "hs_revision" TEXT,
    "component" TEXT NOT NULL,
    "quote_type" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "rate_basis" TEXT NOT NULL,
    "quantity_unit" TEXT,
    "percent_of_value" DECIMAL(9,4),
    "percent_basis" TEXT,
    "cost_owner" TEXT NOT NULL DEFAULT 'exporter',
    "route_evidence_id" TEXT,
    "transport_mode" TEXT,
    "equipment_code" TEXT,
    "carrier_name" TEXT,
    "partner_name" TEXT,
    "quote_reference" TEXT,
    "coverage_terms" TEXT,
    "coverage_percent" DECIMAL(6,2),
    "observed_at" TIMESTAMP(3) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "assertion_class" "EvidenceAssertionClass" NOT NULL,
    "evidence_origin" "EvidenceOrigin" NOT NULL,
    "source" TEXT NOT NULL,
    "source_reference" TEXT NOT NULL,
    "document_id" TEXT,
    "entered_by_id" TEXT,
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "derivation" JSONB,
    "confidence" DECIMAL(5,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'verified',
    "superseded_at" TIMESTAMP(3),
    "superseded_by_id" TEXT,
    "raw_evidence" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalCostEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomsValuationBasisEvidence" (
    "id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "valuation_type" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "included_components" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excluded_components" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_authority" TEXT NOT NULL,
    "source_reference" TEXT NOT NULL,
    "source_version" TEXT,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "observed_at" TIMESTAMP(3) NOT NULL,
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "verification_grade" TEXT NOT NULL DEFAULT 'discovery_grade',
    "assertion_class" "EvidenceAssertionClass" NOT NULL,
    "evidence_origin" "EvidenceOrigin" NOT NULL,
    "recorded_by_id" TEXT,
    "confidence" DECIMAL(5,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'verified',
    "superseded_at" TIMESTAMP(3),
    "notes" TEXT,
    "raw_evidence" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomsValuationBasisEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductClassificationRefinement_exporter_org_id_product_id__idx" ON "ProductClassificationRefinement"("exporter_org_id", "product_id", "destination_country", "created_at");

-- CreateIndex
CREATE INDEX "ProductClassificationRefinement_product_classification_id_d_idx" ON "ProductClassificationRefinement"("product_classification_id", "destination_country", "state");

-- CreateIndex
CREATE INDEX "OperationalCostEvidence_exporter_org_id_destination_country_idx" ON "OperationalCostEvidence"("exporter_org_id", "destination_country", "component", "valid_until");

-- CreateIndex
CREATE INDEX "OperationalCostEvidence_exporter_org_id_product_id_componen_idx" ON "OperationalCostEvidence"("exporter_org_id", "product_id", "component", "status");

-- CreateIndex
CREATE INDEX "OperationalCostEvidence_route_evidence_id_idx" ON "OperationalCostEvidence"("route_evidence_id");

-- CreateIndex
CREATE INDEX "CustomsValuationBasisEvidence_country_code_valuation_type_e_idx" ON "CustomsValuationBasisEvidence"("country_code", "valuation_type", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "CustomsValuationBasisEvidence_identity_key" ON "CustomsValuationBasisEvidence"("country_code", "valuation_type", "basis", "effective_from", "source_reference");

-- CreateIndex
CREATE INDEX "ProductCertification_product_id_verification_state_idx" ON "ProductCertification"("product_id", "verification_state");

-- AddForeignKey
ALTER TABLE "ProductCertification" ADD CONSTRAINT "ProductCertification_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductClassificationRefinement" ADD CONSTRAINT "ProductClassificationRefinement_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductClassificationRefinement" ADD CONSTRAINT "ProductClassificationRefinement_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductClassificationRefinement" ADD CONSTRAINT "ProductClassificationRefinement_product_classification_id_fkey" FOREIGN KEY ("product_classification_id") REFERENCES "ProductClassification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductClassificationRefinement" ADD CONSTRAINT "ProductClassificationRefinement_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductClassificationRefinement" ADD CONSTRAINT "ProductClassificationRefinement_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "ProductClassificationRefinement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalCostEvidence" ADD CONSTRAINT "OperationalCostEvidence_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalCostEvidence" ADD CONSTRAINT "OperationalCostEvidence_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalCostEvidence" ADD CONSTRAINT "OperationalCostEvidence_entered_by_id_fkey" FOREIGN KEY ("entered_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalCostEvidence" ADD CONSTRAINT "OperationalCostEvidence_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalCostEvidence" ADD CONSTRAINT "OperationalCostEvidence_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "OperationalCostEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsValuationBasisEvidence" ADD CONSTRAINT "CustomsValuationBasisEvidence_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Operational evidence is history, not state. A revised quote supersedes its predecessor with a
-- new row; a refinement that changes supersedes rather than rewrites. Both are enforced here so
-- an assessment can never have the evidence it cited altered underneath it.
CREATE OR REPLACE FUNCTION cleartrade_operational_evidence_immutable() RETURNS trigger AS $$
BEGIN
  -- Supersession is a forward-only annotation on an existing row, so it is the one permitted
  -- update: everything that gives the row its meaning must stay exactly as recorded.
  IF TG_OP = 'UPDATE'
     AND OLD."superseded_at" IS NULL
     AND NEW."amount" IS NOT DISTINCT FROM OLD."amount"
     AND NEW."currency" IS NOT DISTINCT FROM OLD."currency"
     AND NEW."rate_basis" IS NOT DISTINCT FROM OLD."rate_basis"
     AND NEW."component" IS NOT DISTINCT FROM OLD."component"
     AND NEW."observed_at" IS NOT DISTINCT FROM OLD."observed_at"
     AND NEW."effective_from" IS NOT DISTINCT FROM OLD."effective_from"
     AND NEW."valid_until" IS NOT DISTINCT FROM OLD."valid_until"
     AND NEW."assertion_class" IS NOT DISTINCT FROM OLD."assertion_class"
     AND NEW."source_reference" IS NOT DISTINCT FROM OLD."source_reference" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Operational cost evidence is immutable; supersede it with a new row instead of mutating %.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OperationalCostEvidence_immutable"
  BEFORE UPDATE OR DELETE ON "OperationalCostEvidence"
  FOR EACH ROW EXECUTE FUNCTION cleartrade_operational_evidence_immutable();

CREATE OR REPLACE FUNCTION cleartrade_refinement_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."superseded_at" IS NULL
     AND NEW."state" IS NOT DISTINCT FROM OLD."state"
     AND NEW."selected_national_code" IS NOT DISTINCT FROM OLD."selected_national_code"
     AND NEW."candidate_lines"::text IS NOT DISTINCT FROM OLD."candidate_lines"::text
     AND NEW."hs6_code" IS NOT DISTINCT FROM OLD."hs6_code"
     AND NEW."destination_country" IS NOT DISTINCT FROM OLD."destination_country"
     AND NEW."assertion_class" IS NOT DISTINCT FROM OLD."assertion_class" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A classification refinement is immutable; supersede it with a new record instead of mutating it.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProductClassificationRefinement_immutable"
  BEFORE UPDATE OR DELETE ON "ProductClassificationRefinement"
  FOR EACH ROW EXECUTE FUNCTION cleartrade_refinement_immutable();
