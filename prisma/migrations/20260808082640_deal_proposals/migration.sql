-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('draft', 'awaiting_exporter', 'approved', 'changes_requested', 'superseded', 'withdrawn');

-- CreateTable
CREATE TABLE "DealProposal" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'draft',
    "quantity" DECIMAL(18,4),
    "unit" TEXT,
    "unit_price_amount" DECIMAL(18,4),
    "unit_price_currency" VARCHAR(3),
    "total_amount" DECIMAL(18,4),
    "total_currency" VARCHAR(3),
    "incoterm" TEXT,
    "incoterm_place" TEXT,
    "payment_terms" JSONB,
    "ship_window_start" TIMESTAMP(3),
    "ship_window_end" TIMESTAMP(3),
    "special_conditions" TEXT,
    "agent_note" TEXT,
    "buyer_status" TEXT,
    "buyer_status_note" TEXT,
    "proposed_by_id" TEXT,
    "proposed_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "changes_requested_by_id" TEXT,
    "changes_requested_at" TIMESTAMP(3),
    "changes_requested_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DealProposal_deal_id_status_idx" ON "DealProposal"("deal_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DealProposal_deal_id_version_key" ON "DealProposal"("deal_id", "version");

-- AddForeignKey
ALTER TABLE "DealProposal" ADD CONSTRAINT "DealProposal_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealProposal" ADD CONSTRAINT "DealProposal_proposed_by_id_fkey" FOREIGN KEY ("proposed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealProposal" ADD CONSTRAINT "DealProposal_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealProposal" ADD CONSTRAINT "DealProposal_changes_requested_by_id_fkey" FOREIGN KEY ("changes_requested_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
