-- Immutable scoring-policy provenance for BuyerFit, analogous in intent to Demand Discovery's.
--
-- Before this, a BuyerFitAssessment recorded only `model_version` ('buyer-fit-v1'), so there
-- was no way to say WHICH policy produced a score — and because the row is upserted, no way to
-- recover it later either.
--
-- The persisted policy is the one the code actually applies (BUYER_FIT_POLICY in
-- src/lib/buyer-intelligence.ts), NOT the `buyers.fit_score_weights` config key. That key
-- describes a different, unused model — country_match / category_match / verification /
-- import_recency — while the live scorer combines volume / price / certification / outcome as
-- an unweighted mean. Nothing reads the key. Stamping it here would record a policy the
-- computation never used, and a wrong provenance claim is indistinguishable from a right one
-- after the fact.
--
-- Existing rows are left NULL with `legacy_non_recomputable`. They were computed before the
-- policy was captured and cannot be attributed to one now; a back-fill would be fabrication.

ALTER TABLE "BuyerFitAssessment"
    ADD COLUMN "scoring_policy_version"  INTEGER,
    ADD COLUMN "scoring_policy_hash"     TEXT,
    ADD COLUMN "scoring_policy_snapshot" JSONB,
    ADD COLUMN "reproducibility_status"  TEXT NOT NULL DEFAULT 'legacy_non_recomputable';

-- Policy version alongside the hash on a decision snapshot: the hash identifies the policy
-- content, the version identifies which revision the team believed it was running. Both are
-- copied at decision time for the same reason as the rest of the buyer snapshot — the
-- assessment they came from is overwritten on the next recompute.
ALTER TABLE "AgentDecision" ADD COLUMN "original_policy_version" INTEGER;
