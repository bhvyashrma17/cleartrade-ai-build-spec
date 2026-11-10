-- D-044 (policy v9): every v5 market but an excluded one is ranked. A market without enough data,
-- or with no recorded imports, may now hold a rank after the fully scored markets; a fully scored
-- market must hold one, an excluded market (or a row of an earlier engine) never does, and every rank
-- stays positive and unique in its run (MarketAssessment_run_rank_key). Only a fully scored market is
-- handed on (MarketAssessment_handoff_is_ranked, unchanged).
--
-- Written NULL-safe, as a CASE: the constraint it replaces let a NULL comparison pass. NOT VALID: it
-- holds for every row written from now on; rows already stored passed the constraint it replaces and
-- are not re-read here, so the release cannot stop on them.
ALTER TABLE "MarketAssessment" DROP CONSTRAINT "MarketAssessment_rank_only_when_ranked";
ALTER TABLE "MarketAssessment" ADD CONSTRAINT "MarketAssessment_rank_by_status" CHECK (
    CASE COALESCE("market_status", '')
        WHEN 'ranked' THEN "rank" IS NOT NULL AND "rank" > 0
        WHEN 'not_enough_data' THEN "rank" IS NULL OR "rank" > 0
        WHEN 'no_recorded_demand' THEN "rank" IS NULL OR "rank" > 0
        ELSE "rank" IS NULL
    END
) NOT VALID;
