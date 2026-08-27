-- Freeze the UN Comtrade reporter-registry identity into every screening run. Additive only.
--
-- The transient default exists so the statement is safe on a table that already holds rows in
-- some environment; it is dropped immediately, so no new run can be written without a real
-- registry identity. Any pre-registry row is marked as exactly that rather than being given a
-- fabricated version.
ALTER TABLE "CountryScreeningRun"
  ADD COLUMN "reporter_registry_version" TEXT NOT NULL DEFAULT 'unversioned_pre_registry',
  ADD COLUMN "reporter_registry_checksum" TEXT NOT NULL DEFAULT 'unversioned_pre_registry';
ALTER TABLE "CountryScreeningRun"
  ALTER COLUMN "reporter_registry_version" DROP DEFAULT,
  ALTER COLUMN "reporter_registry_checksum" DROP DEFAULT;

-- The reporter registry is part of the frozen question a run asked, so it joins the immutable
-- definition rather than sitting beside it as mutable metadata.
CREATE OR REPLACE FUNCTION protect_country_screening_run() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Country screening runs are immutable history and are never deleted';
  END IF;
  IF OLD."status" = 'completed' THEN
    RAISE EXCEPTION 'Completed country screening runs are immutable; create a new run';
  END IF;
  IF (OLD."run_key", OLD."product_classification_id", OLD."hs_code", OLD."hs_revision", OLD."as_of_date", OLD."screening_period", OLD."source_mode", OLD."policy_version", OLD."policy_hash", OLD."policy_snapshot", OLD."universe_version", OLD."universe_checksum", OLD."universe_size", OLD."universe_snapshot", OLD."reporter_registry_version", OLD."reporter_registry_checksum", OLD."screening_algorithm_version", OLD."parser_version", OLD."normalization_version", OLD."shortlist_target_size", OLD."max_shortlist_size", OLD."estimated_call_cost")
     IS DISTINCT FROM
     (NEW."run_key", NEW."product_classification_id", NEW."hs_code", NEW."hs_revision", NEW."as_of_date", NEW."screening_period", NEW."source_mode", NEW."policy_version", NEW."policy_hash", NEW."policy_snapshot", NEW."universe_version", NEW."universe_checksum", NEW."universe_size", NEW."universe_snapshot", NEW."reporter_registry_version", NEW."reporter_registry_checksum", NEW."screening_algorithm_version", NEW."parser_version", NEW."normalization_version", NEW."shortlist_target_size", NEW."max_shortlist_size", NEW."estimated_call_cost") THEN
    RAISE EXCEPTION 'Country screening run definitions are immutable; create a new run';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
