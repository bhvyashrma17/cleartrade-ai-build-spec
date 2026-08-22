CREATE TABLE "CountryTradeMetrics" (
  "id" TEXT NOT NULL,
  "manifest_id" TEXT NOT NULL,
  "product_classification_id" TEXT NOT NULL,
  "reporter_code" TEXT NOT NULL,
  "country_code" VARCHAR(2),
  "hs_code" TEXT NOT NULL,
  "hs_revision" TEXT NOT NULL,
  "as_of_date" TIMESTAMP(3) NOT NULL,
  "period_set" INTEGER[],
  "latest_common_year" INTEGER NOT NULL,
  "metric_policy_version" TEXT NOT NULL,
  "metric_policy_hash" TEXT NOT NULL,
  "metric_policy_snapshot" JSONB NOT NULL,
  "calculation_version" TEXT NOT NULL,
  "metrics_payload" JSONB NOT NULL,
  "checksum" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CountryTradeMetrics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CountryTradeMetrics_checksum_key" ON "CountryTradeMetrics"("checksum");
CREATE UNIQUE INDEX "CountryTradeMetrics_manifest_id_reporter_code_metric_policy_hash_calculation_version_key" ON "CountryTradeMetrics"("manifest_id", "reporter_code", "metric_policy_hash", "calculation_version");
CREATE INDEX "CountryTradeMetrics_product_classification_id_reporter_code_created_at_idx" ON "CountryTradeMetrics"("product_classification_id", "reporter_code", "created_at");
ALTER TABLE "CountryTradeMetrics" ADD CONSTRAINT "CountryTradeMetrics_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "CountryEvidenceManifest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CountryTradeMetrics" ADD CONSTRAINT "CountryTradeMetrics_product_classification_id_fkey" FOREIGN KEY ("product_classification_id") REFERENCES "ProductClassification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_country_trade_metrics_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CountryTradeMetrics is immutable; calculate a new policy/version record';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CountryTradeMetrics_immutable" BEFORE UPDATE OR DELETE ON "CountryTradeMetrics" FOR EACH ROW EXECUTE FUNCTION reject_country_trade_metrics_mutation();
