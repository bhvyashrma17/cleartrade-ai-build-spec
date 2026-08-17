CREATE TABLE "TradeFlowAcquisition" (
  "id" TEXT NOT NULL,
  "trade_flow_id" TEXT NOT NULL,
  "ingest_run_id" TEXT NOT NULL,
  "reporter" TEXT NOT NULL,
  "partner" TEXT NOT NULL,
  "hs_code" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "period" TEXT NOT NULL,
  "flow_direction" "TradeFlowDirection" NOT NULL,
  "source" "TradeDataSource" NOT NULL,
  "value" DECIMAL(20,3) NOT NULL,
  "quantity" DECIMAL(18,3),
  "unit" TEXT,
  "unit_value" DECIMAL(18,6),
  "provider" TEXT NOT NULL,
  "source_mode" "TradeSourceMode" NOT NULL,
  "retrieved_at" TIMESTAMP(3) NOT NULL,
  "request_batch_id" TEXT NOT NULL,
  "source_dataset" TEXT,
  "source_dataset_version" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeFlowAcquisition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TradeFlowAcquisition_run_natural_key"
  ON "TradeFlowAcquisition"("ingest_run_id","reporter","partner","hs_code","year","flow_direction","source");
CREATE INDEX "TradeFlowAcquisition_trade_flow_id_retrieved_at_idx" ON "TradeFlowAcquisition"("trade_flow_id","retrieved_at");
CREATE INDEX "TradeFlowAcquisition_provider_source_mode_retrieved_at_idx" ON "TradeFlowAcquisition"("provider","source_mode","retrieved_at");
ALTER TABLE "TradeFlowAcquisition" ADD CONSTRAINT "TradeFlowAcquisition_trade_flow_id_fkey"
  FOREIGN KEY ("trade_flow_id") REFERENCES "TradeFlow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeFlowAcquisition" ADD CONSTRAINT "TradeFlowAcquisition_ingest_run_id_fkey"
  FOREIGN KEY ("ingest_run_id") REFERENCES "IngestRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
