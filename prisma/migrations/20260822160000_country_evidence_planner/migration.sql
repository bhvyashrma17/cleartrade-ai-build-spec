-- Country Evidence Planner: frozen plan definitions, resumable request cells, and immutable manifests.
CREATE TABLE "CountryEvidencePlan" (
  "id" TEXT NOT NULL,
  "plan_key" TEXT NOT NULL,
  "product_classification_id" TEXT NOT NULL,
  "hs_code" TEXT NOT NULL,
  "hs_revision" TEXT NOT NULL,
  "as_of_date" TIMESTAMP(3) NOT NULL,
  "candidate_reporters" TEXT[],
  "source_mode" "TradeSourceMode" NOT NULL,
  "policy_version" TEXT NOT NULL,
  "policy_hash" TEXT NOT NULL,
  "policy_snapshot" JSONB NOT NULL,
  "period_set" INTEGER[],
  "latest_common_year" INTEGER NOT NULL,
  "requested_history_years" INTEGER NOT NULL,
  "actual_history_years" INTEGER NOT NULL,
  "candidate_strategy" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "estimated_call_cost" INTEGER NOT NULL,
  "allow_partial_execution" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CountryEvidencePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CountryEvidencePlanItem" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "item_key" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "reporter_code" TEXT NOT NULL,
  "partner_scope" TEXT NOT NULL,
  "partner_code" TEXT NOT NULL,
  "flow_direction" TEXT NOT NULL,
  "frequency" TEXT NOT NULL,
  "period" INTEGER NOT NULL,
  "hs_code" TEXT NOT NULL,
  "hs_revision" TEXT NOT NULL,
  "customs_code" TEXT NOT NULL,
  "mode_of_supply" TEXT NOT NULL,
  "priority" INTEGER NOT NULL,
  "freshness_days" INTEGER NOT NULL,
  "estimated_call_cost" INTEGER NOT NULL DEFAULT 1,
  "resolution_state" TEXT NOT NULL DEFAULT 'fetch_required',
  "source_evidence_id" TEXT,
  "resolution_metadata" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_attempted_at" TIMESTAMP(3),
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CountryEvidencePlanItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CountryEvidenceManifest" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "evaluation_state" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "policy_hash" TEXT NOT NULL,
  "policy_snapshot" JSONB NOT NULL,
  "manifest_payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CountryEvidenceManifest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CountryEvidenceManifestReference" (
  "id" TEXT NOT NULL,
  "manifest_id" TEXT NOT NULL,
  "plan_item_key" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "reporter_code" TEXT NOT NULL,
  "period" INTEGER NOT NULL,
  "source_evidence_id" TEXT NOT NULL,
  "observation_ids" TEXT[],
  "cell_state" TEXT NOT NULL,
  "freshness_state" TEXT NOT NULL,
  "evidence_completeness" TEXT NOT NULL,
  "evidence_retrieved_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CountryEvidenceManifestReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CountryEvidencePlan_plan_key_key" ON "CountryEvidencePlan"("plan_key");
CREATE INDEX "CountryEvidencePlan_product_classification_id_created_at_idx" ON "CountryEvidencePlan"("product_classification_id", "created_at");
CREATE INDEX "CountryEvidencePlan_status_created_at_idx" ON "CountryEvidencePlan"("status", "created_at");
CREATE UNIQUE INDEX "CountryEvidencePlanItem_item_key_key" ON "CountryEvidencePlanItem"("item_key");
CREATE INDEX "CountryEvidencePlanItem_plan_id_priority_reporter_code_period_idx" ON "CountryEvidencePlanItem"("plan_id", "priority", "reporter_code", "period");
CREATE INDEX "CountryEvidencePlanItem_resolution_state_updated_at_idx" ON "CountryEvidencePlanItem"("resolution_state", "updated_at");
CREATE UNIQUE INDEX "CountryEvidenceManifest_checksum_key" ON "CountryEvidenceManifest"("checksum");
CREATE INDEX "CountryEvidenceManifest_plan_id_created_at_idx" ON "CountryEvidenceManifest"("plan_id", "created_at");
CREATE UNIQUE INDEX "CountryEvidenceManifestReference_manifest_id_plan_item_key_key" ON "CountryEvidenceManifestReference"("manifest_id", "plan_item_key");
CREATE INDEX "CountryEvidenceManifestReference_source_evidence_id_idx" ON "CountryEvidenceManifestReference"("source_evidence_id");

ALTER TABLE "CountryEvidencePlan" ADD CONSTRAINT "CountryEvidencePlan_product_classification_id_fkey" FOREIGN KEY ("product_classification_id") REFERENCES "ProductClassification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CountryEvidencePlanItem" ADD CONSTRAINT "CountryEvidencePlanItem_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "CountryEvidencePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CountryEvidencePlanItem" ADD CONSTRAINT "CountryEvidencePlanItem_source_evidence_id_fkey" FOREIGN KEY ("source_evidence_id") REFERENCES "SourceEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CountryEvidenceManifest" ADD CONSTRAINT "CountryEvidenceManifest_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "CountryEvidencePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CountryEvidenceManifestReference" ADD CONSTRAINT "CountryEvidenceManifestReference_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "CountryEvidenceManifest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CountryEvidenceManifestReference" ADD CONSTRAINT "CountryEvidenceManifestReference_source_evidence_id_fkey" FOREIGN KEY ("source_evidence_id") REFERENCES "SourceEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Frozen manifests are evidence lineage records. Corrections create a new manifest.
CREATE FUNCTION reject_country_evidence_manifest_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Country evidence manifests and references are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CountryEvidenceManifest_immutable" BEFORE UPDATE OR DELETE ON "CountryEvidenceManifest" FOR EACH ROW EXECUTE FUNCTION reject_country_evidence_manifest_mutation();
CREATE TRIGGER "CountryEvidenceManifestReference_immutable" BEFORE UPDATE OR DELETE ON "CountryEvidenceManifestReference" FOR EACH ROW EXECUTE FUNCTION reject_country_evidence_manifest_mutation();

-- A plan may advance operational state, but its classification, periods, source mode,
-- request identity, cost estimate, and policy snapshot are frozen at creation.
CREATE FUNCTION protect_country_evidence_plan_definition() RETURNS trigger AS $$
BEGIN
  IF (OLD."plan_key", OLD."product_classification_id", OLD."hs_code", OLD."hs_revision", OLD."as_of_date", OLD."candidate_reporters", OLD."source_mode", OLD."policy_version", OLD."policy_hash", OLD."policy_snapshot", OLD."period_set", OLD."latest_common_year", OLD."requested_history_years", OLD."actual_history_years", OLD."candidate_strategy", OLD."estimated_call_cost", OLD."allow_partial_execution")
     IS DISTINCT FROM
     (NEW."plan_key", NEW."product_classification_id", NEW."hs_code", NEW."hs_revision", NEW."as_of_date", NEW."candidate_reporters", NEW."source_mode", NEW."policy_version", NEW."policy_hash", NEW."policy_snapshot", NEW."period_set", NEW."latest_common_year", NEW."requested_history_years", NEW."actual_history_years", NEW."candidate_strategy", NEW."estimated_call_cost", NEW."allow_partial_execution") THEN
    RAISE EXCEPTION 'Country evidence plan definitions are immutable; create a new plan';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CountryEvidencePlan_definition_immutable" BEFORE UPDATE ON "CountryEvidencePlan" FOR EACH ROW EXECUTE FUNCTION protect_country_evidence_plan_definition();

CREATE FUNCTION protect_country_evidence_item_definition() RETURNS trigger AS $$
BEGIN
  IF (OLD."plan_id", OLD."item_key", OLD."purpose", OLD."reporter_code", OLD."partner_scope", OLD."partner_code", OLD."flow_direction", OLD."frequency", OLD."period", OLD."hs_code", OLD."hs_revision", OLD."customs_code", OLD."mode_of_supply", OLD."priority", OLD."freshness_days", OLD."estimated_call_cost")
     IS DISTINCT FROM
     (NEW."plan_id", NEW."item_key", NEW."purpose", NEW."reporter_code", NEW."partner_scope", NEW."partner_code", NEW."flow_direction", NEW."frequency", NEW."period", NEW."hs_code", NEW."hs_revision", NEW."customs_code", NEW."mode_of_supply", NEW."priority", NEW."freshness_days", NEW."estimated_call_cost") THEN
    RAISE EXCEPTION 'Country evidence plan item definitions are immutable; create a new plan';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CountryEvidencePlanItem_definition_immutable" BEFORE UPDATE ON "CountryEvidencePlanItem" FOR EACH ROW EXECUTE FUNCTION protect_country_evidence_item_definition();
