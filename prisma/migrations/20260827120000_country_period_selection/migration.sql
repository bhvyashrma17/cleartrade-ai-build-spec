-- Phase 1G: latest-usable-period selection. Additive only.
--
-- Existing Phase 1F runs are 2025-only and must stay exactly as they are. The transient
-- defaults below let the columns be added to a table that already holds those historical rows;
-- they are dropped immediately so no new run can be written without a real period policy, and
-- a pre-1G row is marked as exactly that rather than being given a fabricated policy identity.
ALTER TABLE "CountryScreeningRun"
  ADD COLUMN "period_selection_policy_version" TEXT NOT NULL DEFAULT 'unversioned_pre_phase_1g',
  ADD COLUMN "period_selection_policy_hash" TEXT NOT NULL DEFAULT 'unversioned_pre_phase_1g',
  ADD COLUMN "period_selection_policy_snapshot" JSONB NOT NULL DEFAULT '{"policy_version":"unversioned_pre_phase_1g","max_fallback_lookback_years":0}'::jsonb,
  ADD COLUMN "max_fallback_lookback_years" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CountryScreeningRun"
  ALTER COLUMN "period_selection_policy_version" DROP DEFAULT,
  ALTER COLUMN "period_selection_policy_hash" DROP DEFAULT,
  ALTER COLUMN "period_selection_policy_snapshot" DROP DEFAULT,
  ALTER COLUMN "max_fallback_lookback_years" DROP DEFAULT;

ALTER TABLE "CountryScreeningResult"
  ADD COLUMN "preferred_period" INTEGER,
  ADD COLUMN "period_lag" INTEGER,
  ADD COLUMN "evidence_confidence" DECIMAL(6,4),
  ADD COLUMN "selection_score" DECIMAL(9,6),
  ADD COLUMN "next_probe_period" INTEGER;

CREATE INDEX "CountryScreeningResult_run_id_next_probe_period_idx" ON "CountryScreeningResult"("run_id", "next_probe_period");

-- The period policy is part of the frozen question a run asked, so it joins the immutable
-- definition. A completed Phase 1F run stays byte-identical: its columns carry the explicit
-- pre-1G marker and nothing rewrites them.
CREATE OR REPLACE FUNCTION protect_country_screening_run() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Country screening runs are immutable history and are never deleted';
  END IF;
  IF OLD."status" = 'completed' THEN
    RAISE EXCEPTION 'Completed country screening runs are immutable; create a new run';
  END IF;
  IF (OLD."run_key", OLD."product_classification_id", OLD."hs_code", OLD."hs_revision", OLD."as_of_date", OLD."screening_period", OLD."source_mode", OLD."policy_version", OLD."policy_hash", OLD."policy_snapshot", OLD."universe_version", OLD."universe_checksum", OLD."universe_size", OLD."universe_snapshot", OLD."reporter_registry_version", OLD."reporter_registry_checksum", OLD."period_selection_policy_version", OLD."period_selection_policy_hash", OLD."period_selection_policy_snapshot", OLD."max_fallback_lookback_years", OLD."screening_algorithm_version", OLD."parser_version", OLD."normalization_version", OLD."shortlist_target_size", OLD."max_shortlist_size", OLD."estimated_call_cost")
     IS DISTINCT FROM
     (NEW."run_key", NEW."product_classification_id", NEW."hs_code", NEW."hs_revision", NEW."as_of_date", NEW."screening_period", NEW."source_mode", NEW."policy_version", NEW."policy_hash", NEW."policy_snapshot", NEW."universe_version", NEW."universe_checksum", NEW."universe_size", NEW."universe_snapshot", NEW."reporter_registry_version", NEW."reporter_registry_checksum", NEW."period_selection_policy_version", NEW."period_selection_policy_hash", NEW."period_selection_policy_snapshot", NEW."max_fallback_lookback_years", NEW."screening_algorithm_version", NEW."parser_version", NEW."normalization_version", NEW."shortlist_target_size", NEW."max_shortlist_size", NEW."estimated_call_cost") THEN
    RAISE EXCEPTION 'Country screening run definitions are immutable; create a new run';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
