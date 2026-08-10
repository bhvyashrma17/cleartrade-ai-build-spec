-- AGT-06 Agent Execution Workspace.
--
-- AC02 requires every external filing/partner handoff to record owner, status, timestamp
-- and reference. Two gaps are closed here:
--   1. Document could record filed_at + filing_reference but not WHO filed it.
--   2. Partner assignment lived only as a bare FK on Shipment, which cannot express
--      "packet sent on this date by this agent, acknowledged under this reference".

-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('pending', 'sent', 'acknowledged', 'completed', 'rejected');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "filed_by_id" TEXT;

-- CreateTable
CREATE TABLE "PartnerHandoff" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "shipment_id" TEXT,
    "partner_id" TEXT NOT NULL,
    "lane" "PartnerType" NOT NULL,
    "status" "HandoffStatus" NOT NULL DEFAULT 'pending',
    "owner_user_id" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerHandoff_deal_id_lane_idx" ON "PartnerHandoff"("deal_id", "lane");

-- CreateIndex
CREATE INDEX "PartnerHandoff_partner_id_status_idx" ON "PartnerHandoff"("partner_id", "status");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_filed_by_id_fkey" FOREIGN KEY ("filed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerHandoff" ADD CONSTRAINT "PartnerHandoff_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerHandoff" ADD CONSTRAINT "PartnerHandoff_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerHandoff" ADD CONSTRAINT "PartnerHandoff_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerHandoff" ADD CONSTRAINT "PartnerHandoff_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
