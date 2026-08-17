-- CreateEnum
CREATE TYPE "OutreachChannel" AS ENUM ('call', 'email', 'message', 'meeting', 'other');

-- CreateEnum
CREATE TYPE "OutreachAutomation" AS ENUM ('manual', 'automated');

-- CreateEnum
CREATE TYPE "OutreachDeliveryStatus" AS ENUM ('unknown', 'queued', 'sent', 'delivered', 'bounced', 'failed');

-- CreateEnum
CREATE TYPE "BuyerReplyClassification" AS ENUM ('no_response', 'positive_interest', 'not_interested', 'wrong_contact', 'already_sourced', 'price_mismatch', 'moq_mismatch', 'certification_issue', 'lead_time_issue', 'product_mismatch', 'timing_issue', 'other');

-- AlterTable
ALTER TABLE "BuyerOutcome" ADD COLUMN     "deal_id" TEXT,
ADD COLUMN     "payment_evidence" JSONB;

-- CreateTable
CREATE TABLE "OutreachAttempt" (
    "id" TEXT NOT NULL,
    "buyer_lead_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "channel" "OutreachChannel" NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "template_id" TEXT,
    "template_version" TEXT,
    "automation" "OutreachAutomation" NOT NULL DEFAULT 'manual',
    "sequence_number" INTEGER NOT NULL,
    "delivery_status" "OutreachDeliveryStatus" NOT NULL DEFAULT 'unknown',
    "reply_classification" "BuyerReplyClassification",
    "reply_notes" TEXT,
    "replied_at" TIMESTAMP(3),
    "evidence_origin" "EvidenceOrigin" NOT NULL DEFAULT 'unknown_legacy',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerLeadTransition" (
    "id" TEXT NOT NULL,
    "buyer_lead_id" TEXT NOT NULL,
    "from_stage" "BuyerLeadStage",
    "to_stage" "BuyerLeadStage" NOT NULL,
    "actor_user_id" TEXT,
    "reason" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerLeadTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerLeadSnapshot" (
    "id" TEXT NOT NULL,
    "buyer_lead_id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "destination_country" TEXT NOT NULL,
    "buyer_fit_assessment_id" TEXT,
    "fit_model_version" TEXT,
    "fit_score" INTEGER,
    "fit_confidence" INTEGER,
    "fit_components" JSONB,
    "fit_input_snapshot" JSONB,
    "buyer_rank" INTEGER,
    "market_assessment_id" TEXT,
    "market_context" JSONB,
    "sanctions_screening_case_id" TEXT,
    "sanctions_result" TEXT,
    "sanctions_algorithm_version" TEXT,
    "buyer_evidence_coverage" JSONB NOT NULL,
    "offered_price_amount" DECIMAL(18,4),
    "offered_price_currency" VARCHAR(3),
    "incoterm" TEXT,
    "commercial_basis" TEXT,
    "moq_value" DECIMAL(18,4),
    "moq_unit" TEXT,
    "offered_order_size" DECIMAL(18,4),
    "offered_order_size_unit" TEXT,
    "production_lead_time_days" INTEGER,
    "customization_claim" TEXT,
    "certification_claims" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerLeadSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutreachAttempt_buyer_lead_id_attempted_at_idx" ON "OutreachAttempt"("buyer_lead_id", "attempted_at");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachAttempt_buyer_lead_id_sequence_number_key" ON "OutreachAttempt"("buyer_lead_id", "sequence_number");

-- CreateIndex
CREATE INDEX "BuyerLeadTransition_buyer_lead_id_occurred_at_idx" ON "BuyerLeadTransition"("buyer_lead_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerLeadSnapshot_buyer_lead_id_key" ON "BuyerLeadSnapshot"("buyer_lead_id");

-- AddForeignKey
ALTER TABLE "OutreachAttempt" ADD CONSTRAINT "OutreachAttempt_buyer_lead_id_fkey" FOREIGN KEY ("buyer_lead_id") REFERENCES "BuyerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachAttempt" ADD CONSTRAINT "OutreachAttempt_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLeadTransition" ADD CONSTRAINT "BuyerLeadTransition_buyer_lead_id_fkey" FOREIGN KEY ("buyer_lead_id") REFERENCES "BuyerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLeadTransition" ADD CONSTRAINT "BuyerLeadTransition_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLeadSnapshot" ADD CONSTRAINT "BuyerLeadSnapshot_buyer_lead_id_fkey" FOREIGN KEY ("buyer_lead_id") REFERENCES "BuyerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing leads predate instrumentation. Preserve only provable identifiers and mark
-- context explicitly unknown; never reconstruct historical fit/commercial claims from
-- today's mutable Product or ranking rows.
INSERT INTO "BuyerLeadSnapshot" (
  "id", "buyer_lead_id", "exporter_org_id", "product_id", "buyer_id",
  "destination_country", "buyer_evidence_coverage", "created_at"
)
SELECT concat('legacy_snapshot_', l."id"), l."id", l."exporter_org_id", l."product_id", l."buyer_id",
       b."country_code", '{"status":"unknown_legacy","reason":"lead predates outcome instrumentation"}'::jsonb,
       l."created_at"
FROM "BuyerLead" l JOIN "Buyer" b ON b."id" = l."buyer_id"
ON CONFLICT ("buyer_lead_id") DO NOTHING;

INSERT INTO "BuyerLeadTransition" (
  "id", "buyer_lead_id", "from_stage", "to_stage", "actor_user_id", "reason", "occurred_at"
)
SELECT concat('legacy_transition_', l."id"), l."id", NULL, l."stage", l."created_by_id",
       'legacy baseline; prior transitions unavailable', l."created_at"
FROM "BuyerLead" l
WHERE NOT EXISTS (SELECT 1 FROM "BuyerLeadTransition" t WHERE t."buyer_lead_id" = l."id");

CREATE FUNCTION reject_buyer_lead_snapshot_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'BuyerLeadSnapshot is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BuyerLeadSnapshot_immutable"
BEFORE UPDATE ON "BuyerLeadSnapshot"
FOR EACH ROW EXECUTE FUNCTION reject_buyer_lead_snapshot_update();
