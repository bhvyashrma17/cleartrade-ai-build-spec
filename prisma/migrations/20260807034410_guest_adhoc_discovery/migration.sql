-- AlterTable
ALTER TABLE "DiscoveryRun" ADD COLUMN     "input_snapshot" JSONB;

-- AlterTable
ALTER TABLE "MarketAssessment" ALTER COLUMN "product_id" DROP NOT NULL;
