-- CreateEnum
CREATE TYPE "TradeFlowDirection" AS ENUM ('import', 'export');

-- CreateEnum
CREATE TYPE "TradeDataSource" AS ENUM ('comtrade');

-- CreateEnum
CREATE TYPE "IngestStatus" AS ENUM ('running', 'completed', 'failed', 'partial');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'comtrade_ingest';

-- CreateTable
CREATE TABLE "TradeFlow" (
    "id" TEXT NOT NULL,
    "reporter" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "hs_code" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "quantity" DECIMAL(18,3),
    "unit" TEXT,
    "unit_value" DECIMAL(18,6),
    "flow_direction" "TradeFlowDirection" NOT NULL,
    "source" "TradeDataSource" NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestRun" (
    "id" TEXT NOT NULL,
    "source" "TradeDataSource" NOT NULL,
    "status" "IngestStatus" NOT NULL DEFAULT 'running',
    "params" JSONB,
    "records_written" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "IngestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeFlow_hs_code_year_idx" ON "TradeFlow"("hs_code", "year");

-- CreateIndex
CREATE UNIQUE INDEX "TradeFlow_reporter_partner_hs_code_year_source_key" ON "TradeFlow"("reporter", "partner", "hs_code", "year", "source");

-- CreateIndex
CREATE INDEX "IngestRun_source_started_at_idx" ON "IngestRun"("source", "started_at");
