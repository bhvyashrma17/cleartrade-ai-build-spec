-- Phase 1G: per-reporter deep analysis windows. Additive only.
--
-- Nullable on purpose: a plan built before Phase 1G genuinely had one common window, and saying
-- so by absence is more honest than back-filling it with a window it never used.
ALTER TABLE "CountryEvidencePlan"
  ADD COLUMN "reporter_period_windows" JSONB,
  ADD COLUMN "preferred_period" INTEGER;

-- The windows are part of the frozen question the plan asked, so they join the immutable
-- definition rather than sitting beside it as mutable metadata.
CREATE OR REPLACE FUNCTION protect_country_evidence_plan_definition() RETURNS trigger AS $$
BEGIN
  IF (OLD."plan_key", OLD."product_classification_id", OLD."hs_code", OLD."hs_revision", OLD."as_of_date", OLD."candidate_reporters", OLD."source_mode", OLD."policy_version", OLD."policy_hash", OLD."policy_snapshot", OLD."period_set", OLD."latest_common_year", OLD."requested_history_years", OLD."actual_history_years", OLD."reporter_period_windows", OLD."preferred_period", OLD."candidate_strategy", OLD."estimated_call_cost", OLD."allow_partial_execution")
     IS DISTINCT FROM
     (NEW."plan_key", NEW."product_classification_id", NEW."hs_code", NEW."hs_revision", NEW."as_of_date", NEW."candidate_reporters", NEW."source_mode", NEW."policy_version", NEW."policy_hash", NEW."policy_snapshot", NEW."period_set", NEW."latest_common_year", NEW."requested_history_years", NEW."actual_history_years", NEW."reporter_period_windows", NEW."preferred_period", NEW."candidate_strategy", NEW."estimated_call_cost", NEW."allow_partial_execution") THEN
    RAISE EXCEPTION 'Country evidence plan definitions are immutable; create a new plan';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
