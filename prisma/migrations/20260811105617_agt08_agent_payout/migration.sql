-- CreateEnum
CREATE TYPE "PayoutState" AS ENUM ('not_eligible', 'eligible', 'approved', 'paid', 'disputed');

-- DropIndex
DROP INDEX "Document_deal_id_doc_type_version_idx";

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "agent_user_id" TEXT NOT NULL,
    "state" "PayoutState" NOT NULL DEFAULT 'not_eligible',
    "basis_amount" DECIMAL(18,4) NOT NULL,
    "basis_currency" VARCHAR(3) NOT NULL,
    "fee_amount" DECIMAL(18,4) NOT NULL,
    "fee_currency" VARCHAR(3) NOT NULL,
    "fee_rule" TEXT,
    "agent_share_rate" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "fee_policy_version" INTEGER NOT NULL,
    "calculation_snapshot" JSONB NOT NULL,
    "ineligible_reason" TEXT,
    "eligibility_rule" TEXT,
    "eligible_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "payment_reference" TEXT,
    "dispute_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutAdjustment" (
    "id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payout_agent_user_id_state_idx" ON "Payout"("agent_user_id", "state");

-- CreateIndex
CREATE INDEX "Payout_state_idx" ON "Payout"("state");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_deal_id_agent_user_id_key" ON "Payout"("deal_id", "agent_user_id");

-- CreateIndex
CREATE INDEX "PayoutAdjustment_payout_id_idx" ON "PayoutAdjustment"("payout_id");

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_agent_user_id_fkey" FOREIGN KEY ("agent_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "Dispute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAdjustment" ADD CONSTRAINT "PayoutAdjustment_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "Payout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAdjustment" ADD CONSTRAINT "PayoutAdjustment_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
