DO $$
DECLARE
  prior "ConfigSetting"%ROWTYPE;
  next_version INTEGER;
  next_value JSONB;
BEGIN
  SELECT * INTO prior FROM "ConfigSetting"
  WHERE "key"='discovery.scoring' AND "is_active"=TRUE
  ORDER BY "version" DESC LIMIT 1;

  IF FOUND AND COALESCE(prior."value"->>'model_version','') <> 'market-attractiveness-v3' THEN
    next_version := prior."version" + 1;
    next_value := prior."value" || jsonb_build_object(
      'model_version','market-attractiveness-v3',
      'demand',jsonb_build_object('formula_version','demand-strength-v3','share_metric','candidate_market_share','value_weight',60,'share_weight',20,'buyer_depth_weight',20),
      'competition',jsonb_build_object('formula_version','competitive-opportunity-v3','hhi_weight',70,'india_share_weight',30,'minimum_supplier_coverage_ratio',0.95,'maximum_supplier_coverage_ratio',1.05,'minimum_partner_count',2,'coverage_policy_version','supplier-coverage-v1'),
      'confidence',jsonb_build_object('formula_version','assessment-confidence-v3','freshness_policy_version','comtrade-reporting-lag-v1','accepted_reporting_lag_years',2,'stale_after_lag_years',5,'recency_weight',35,'reporting_completeness_weight',35,'buyer_coverage_weight',15,'missingness_weight',15)
    );
    UPDATE "ConfigSetting" SET "is_active"=FALSE,"updated_at"=CURRENT_TIMESTAMP
      WHERE "key"='discovery.scoring' AND "is_active"=TRUE;
    INSERT INTO "ConfigSetting" ("id","key","version","value","description","is_active","effective_from","created_at","updated_at")
      VALUES ('demand-v3-'||md5(random()::text||clock_timestamp()::text),'discovery.scoring',next_version,next_value,'Demand Discovery v3 correctness policy',TRUE,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
  END IF;
END $$;
