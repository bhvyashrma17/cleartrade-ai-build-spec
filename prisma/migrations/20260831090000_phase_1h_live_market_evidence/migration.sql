-- Phase 1H.0/1H.1 — production deep pipeline provenance + live market-access and FX evidence.
--
-- Strictly additive. Every statement adds a nullable column, a new table or a new index; no
-- column is dropped, retyped or backfilled, so every historical row keeps its exact meaning and
-- the Phase 1G frozen artefacts stay reproducible.
--
-- `prisma migrate diff` also proposes a set of index renames, dropped column defaults and
-- foreign-key recreations that predate this change (naming drift between the migration history
-- and the schema file). They are deliberately NOT included: they are unrelated to this work and
-- some of them are destructive.

-- Which frozen Stage-A screening run produced a deep evidence plan. Nullable: the pilot request
-- path names countries directly and has no screening run behind it.
ALTER TABLE "CountryEvidencePlan" ADD COLUMN "screening_run_id" TEXT;
CREATE INDEX "CountryEvidencePlan_screening_run_id_idx" ON "CountryEvidencePlan"("screening_run_id");
ALTER TABLE "CountryEvidencePlan"
  ADD CONSTRAINT "CountryEvidencePlan_screening_run_id_fkey"
  FOREIGN KEY ("screening_run_id") REFERENCES "CountryScreeningRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- National tariff-line refinement outcome for a requested HS6.
ALTER TABLE "MarketAccessEvidenceSnapshot"
  ADD COLUMN "hs6_code" TEXT,
  ADD COLUMN "national_code_system" TEXT,
  ADD COLUMN "classification_resolution" TEXT,
  ADD COLUMN "candidate_line_count" INTEGER,
  ADD COLUMN "resolution_detail" JSONB;
CREATE INDEX "MarketAccessEvidenceSnapshot_country_code_hs6_code_retrieve_idx"
  ON "MarketAccessEvidenceSnapshot"("country_code", "hs6_code", "retrieved_at");

-- Duty fidelity and explicit India-origin applicability on the determination itself.
ALTER TABLE "MarketAccessEvidence"
  ADD COLUMN "national_tariff_code" TEXT,
  ADD COLUMN "national_code_system" TEXT,
  ADD COLUMN "duty_expression" TEXT,
  ADD COLUMN "duty_kind" TEXT,
  ADD COLUMN "preference_applicability" TEXT,
  ADD COLUMN "preference_basis" TEXT,
  ADD COLUMN "verification_grade" TEXT;

-- Every candidate national line beneath the requested HS6, including the rejected ones.
CREATE TABLE "MarketAccessTariffLine" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "hs6_code" TEXT NOT NULL,
    "hs_revision" TEXT NOT NULL,
    "national_tariff_code" TEXT NOT NULL,
    "national_code_system" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "declarable" BOOLEAN NOT NULL DEFAULT true,
    "measure_kind" TEXT NOT NULL,
    "origin_geographic_area_id" TEXT,
    "origin_scope" TEXT NOT NULL,
    "applies_to_origin_country" VARCHAR(2),
    "duty_expression" TEXT NOT NULL,
    "duty_kind" TEXT NOT NULL,
    "ad_valorem_rate_percent" DECIMAL(9,4),
    "specific_amount" DECIMAL(18,6),
    "specific_currency" VARCHAR(3),
    "specific_unit" TEXT,
    "specific_unit_quantity" DECIMAL(18,6),
    "conditions" JSONB NOT NULL,
    "effective_from" TIMESTAMP(3),
    "effective_to" TIMESTAMP(3),
    "source_reference" TEXT NOT NULL,
    "raw_measure" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketAccessTariffLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MarketAccessTariffLine_snapshot_id_idx" ON "MarketAccessTariffLine"("snapshot_id");
CREATE INDEX "MarketAccessTariffLine_country_code_hs6_code_national_tarif_idx"
  ON "MarketAccessTariffLine"("country_code", "hs6_code", "national_tariff_code");
ALTER TABLE "MarketAccessTariffLine"
  ADD CONSTRAINT "MarketAccessTariffLine_snapshot_id_fkey"
  FOREIGN KEY ("snapshot_id") REFERENCES "MarketAccessEvidenceSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Authoritative public FX: raw publisher response, kept immutable.
CREATE TABLE "AuthoritativeFxSnapshot" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "source_authority" TEXT NOT NULL,
    "source_dataset" TEXT NOT NULL,
    "source_dataset_version" TEXT,
    "series_key" TEXT NOT NULL,
    "request_reference" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "http_status" INTEGER NOT NULL,
    "raw_response_checksum" TEXT NOT NULL,
    "raw_response_text" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "normalization_version" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "evidence_origin" "EvidenceOrigin" NOT NULL DEFAULT 'unknown_legacy',
    "completeness" "EvidenceCompletenessStatus" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthoritativeFxSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuthoritativeFxSnapshot_provider_series_key_retrieved_at_idx"
  ON "AuthoritativeFxSnapshot"("provider", "series_key", "retrieved_at");
CREATE INDEX "AuthoritativeFxSnapshot_environment_retrieved_at_idx"
  ON "AuthoritativeFxSnapshot"("environment", "retrieved_at");

-- One published reference observation, for a stated date rather than a retrieval time.
CREATE TABLE "AuthoritativeFxObservation" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "series_key" TEXT NOT NULL,
    "base_currency" VARCHAR(3) NOT NULL,
    "quote_currency" VARCHAR(3) NOT NULL,
    "rate" DECIMAL(24,10) NOT NULL,
    "observation_date" DATE NOT NULL,
    "observation_status" TEXT NOT NULL,
    "normalization_version" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "evidence_origin" "EvidenceOrigin" NOT NULL DEFAULT 'unknown_legacy',
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthoritativeFxObservation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthoritativeFxObservation_identity_key"
  ON "AuthoritativeFxObservation"("provider", "series_key", "observation_date", "normalization_version", "environment");
CREATE INDEX "AuthoritativeFxObservation_environment_base_currency_quote__idx"
  ON "AuthoritativeFxObservation"("environment", "base_currency", "quote_currency", "observation_date");
CREATE INDEX "AuthoritativeFxObservation_snapshot_id_idx" ON "AuthoritativeFxObservation"("snapshot_id");
ALTER TABLE "AuthoritativeFxObservation"
  ADD CONSTRAINT "AuthoritativeFxObservation_snapshot_id_fkey"
  FOREIGN KEY ("snapshot_id") REFERENCES "AuthoritativeFxSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Published evidence is history, not state. The same trigger contract the rest of the evidence
-- layer uses: a retrieval may add observations, never rewrite one that a snapshot already cites.
CREATE OR REPLACE FUNCTION cleartrade_authoritative_fx_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Authoritative FX evidence is immutable; record a new observation instead of mutating %.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuthoritativeFxSnapshot_immutable"
  BEFORE UPDATE OR DELETE ON "AuthoritativeFxSnapshot"
  FOR EACH ROW EXECUTE FUNCTION cleartrade_authoritative_fx_immutable();

CREATE TRIGGER "AuthoritativeFxObservation_immutable"
  BEFORE UPDATE OR DELETE ON "AuthoritativeFxObservation"
  FOR EACH ROW EXECUTE FUNCTION cleartrade_authoritative_fx_immutable();
