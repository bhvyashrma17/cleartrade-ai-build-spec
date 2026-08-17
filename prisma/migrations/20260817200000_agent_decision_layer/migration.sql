-- Agent decision layer: the audited human-control surface over Demand and Buyer Discovery.
--
-- Three guarantees live here rather than in application code, because a guarantee that only
-- holds while every caller behaves is not a guarantee:
--   1. Referential integrity to the real subject (explicit FKs, not a loose type/id pair).
--   2. Exactly one subject per row, and `target` agreeing with which FK is populated.
--   3. Append-only: UPDATE is refused by the database itself.

-- CreateEnum
CREATE TYPE "AgentDecisionTarget" AS ENUM ('market', 'buyer');

-- CreateEnum
CREATE TYPE "AgentDecisionAction" AS ENUM (
    'promote', 'demote', 'restore', 'pause_automation', 'resume_automation', 'request_review',
    'reject', 'mark_selected', 'mark_not_selected',
    'shortlist', 'disqualify', 'qualify', 'unqualify'
);

-- CreateTable
CREATE TABLE "AgentDecision" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "market_assessment_id" TEXT,
    "buyer_fit_assessment_id" TEXT,
    "target" "AgentDecisionTarget" NOT NULL,
    "action" "AgentDecisionAction" NOT NULL,
    "agent_priority" INTEGER,
    "reason" TEXT NOT NULL,
    "original_score" INTEGER,
    "original_rank" INTEGER,
    "original_confidence_score" INTEGER,
    "original_model_version" TEXT,
    "original_policy_hash" TEXT,
    "expires_at" TIMESTAMP(3),
    "supersedes_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentDecision_supersedes_id_key" ON "AgentDecision"("supersedes_id");
CREATE INDEX "AgentDecision_exporter_org_id_target_created_at_idx" ON "AgentDecision"("exporter_org_id", "target", "created_at");
CREATE INDEX "AgentDecision_market_assessment_id_created_at_idx" ON "AgentDecision"("market_assessment_id", "created_at");
CREATE INDEX "AgentDecision_buyer_fit_assessment_id_created_at_idx" ON "AgentDecision"("buyer_fit_assessment_id", "created_at");
CREATE INDEX "AgentDecision_actor_user_id_created_at_idx" ON "AgentDecision"("actor_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_exporter_org_id_fkey"
    FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_market_assessment_id_fkey"
    FOREIGN KEY ("market_assessment_id") REFERENCES "MarketAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_buyer_fit_assessment_id_fkey"
    FOREIGN KEY ("buyer_fit_assessment_id") REFERENCES "BuyerFitAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_supersedes_id_fkey"
    FOREIGN KEY ("supersedes_id") REFERENCES "AgentDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exactly one subject, and `target` must agree with which foreign key carries it.
--
-- One constraint rather than two, because the two facts are not independent: a row claiming
-- target='market' while carrying only a buyer FK is exactly as invalid as a row carrying
-- both, and splitting them would let each half pass while the pair stays nonsense.
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_target_shape" CHECK (
    ("target" = 'market' AND "market_assessment_id" IS NOT NULL AND "buyer_fit_assessment_id" IS NULL)
 OR ("target" = 'buyer'  AND "buyer_fit_assessment_id" IS NOT NULL AND "market_assessment_id" IS NULL)
);

-- Only actions that mean something for the target may be stored.
--
-- A market is never `shortlisted` and a buyer is never `mark_selected`; without this, such
-- rows are insertable and every reader downstream has to decide what they mean. Refusing
-- them at write time keeps that question from ever being asked.
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_action_matches_target" CHECK (
    ("target" = 'market' AND "action"::text IN (
        'promote', 'demote', 'restore', 'pause_automation', 'resume_automation', 'request_review',
        'reject', 'mark_selected', 'mark_not_selected'))
 OR ("target" = 'buyer' AND "action"::text IN (
        'promote', 'demote', 'restore', 'pause_automation', 'resume_automation', 'request_review',
        'shortlist', 'disqualify', 'qualify', 'unqualify'))
);

-- A stated reason is mandatory in substance, not just in type: NOT NULL alone would accept
-- an empty string, which is indistinguishable from no reason at all to whoever reviews it.
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_reason_not_blank"
    CHECK (length(btrim("reason")) > 0);

-- A decision may not supersede itself, which would create a cycle that no reader of the
-- chain could terminate on.
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_no_self_supersede"
    CHECK ("supersedes_id" IS NULL OR "supersedes_id" <> "id");

-- Append-only, enforced by the database.
--
-- The service layer exposes no update path, but "no caller does this" is a convention and
-- this table's whole value depends on the stronger claim. A BEFORE UPDATE trigger makes the
-- guarantee independent of application code, of a future migration, and of anyone holding a
-- psql prompt.
--
-- DELETE is deliberately NOT blocked: the foreign keys above cascade from ExporterOrg,
-- MarketAssessment and BuyerFitAssessment, and tenant erasure (DataDeletionRequest) has to
-- remain possible. Append-only here means "history is never rewritten", not "data can never
-- be erased" — a right-to-erasure request must not be defeated by an audit table.
CREATE OR REPLACE FUNCTION "agent_decision_refuse_update"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'AgentDecision is append-only: row % cannot be updated. Insert a new decision with supersedes_id instead.', OLD."id"
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "agent_decision_no_update"
    BEFORE UPDATE ON "AgentDecision"
    FOR EACH ROW EXECUTE FUNCTION "agent_decision_refuse_update"();
