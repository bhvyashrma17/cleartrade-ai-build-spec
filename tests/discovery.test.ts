import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { TradeDataSource, TradeFlowDirection, TradeSourceMode } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { WarehouseDiscoveryEngine } from '../src/lib/discovery/warehouse-engine';
import { canonicalQuantityUnit, combineScores, marketAccessHardBlockers, marketAccessScopeMatches, scoreCandidate, scoreCandidateByModel, scoreCompetition, scoreExporterMarketFit, scoreExportEconomics, scoreLogisticsFeasibility, scoreMarketAccess, scoreRiskResilience, type CandidateInput, type ExporterContext, type ExporterMarketFitBenchmarkInput, type LogisticsRouteEvidenceInput, type MarketAccessInput, type MarketRiskSignalInput } from '../src/lib/discovery/scoring';
import { CONFIG_DEFAULTS, type DiscoveryComponentWeights, type DiscoveryScoringPolicy } from '../src/lib/config';
import { composeRationale, setRationaleWriter } from '../src/lib/discovery/rationale';
import { historicalPolicyFromSnapshot, scoringPolicyHash } from '../src/lib/discovery/policy';

const policy:DiscoveryScoringPolicy={...CONFIG_DEFAULTS['discovery.scoring'],model_version:'test-model-v7',archetype_profiles:{},volume_floor_usd:0,growth_window_years:3,rationale_top_n:0};
const weights=policy.base_weights as DiscoveryComponentWeights;
const row=(year:number,value:number,partner='0')=>({reporter:'842',partner,hs_code:'090111',year,value,quantity:100,unit:'kg',unit_value:value/100,ingested_at:new Date(`${year}-12-31T00:00:00Z`)});
const candidate:CandidateInput={reporter:'842',country_code:'US',totalRows:[row(2022,800),row(2023,900),row(2024,1000)],indiaRows:[row(2024,100,'699')],supplierRowsLatestYear:[row(2024,250,'156'),row(2024,250,'76'),row(2024,250,'704'),row(2024,250,'699')],supplierCoverage:{assertion_id:'coverage-1',world_total_value:1000,supplier_value_sum:1000,partner_count:4,coverage_ratio:1,completeness:'COMPLETE',query_scope:{scope:'test'},acquisition_ids:[],threshold_version:'supplier-coverage-v1'}};
const context:ExporterContext={};
const denominator=(values:number[])=>({metric:'candidate_market_share' as const,total:values.reduce((sum,value)=>sum+value,0),values,hs_code:'090111',year:2024,completeness:'PARTIAL' as const,evidence_ids:[]});
const asOf=new Date('2026-08-14T00:00:00Z');

afterAll(async()=>{setRationaleWriter(null);await prisma.$disconnect();});

describe('eight-component scoring',()=>{
  test('demand, growth, competition, renormalization, and confidence are arithmetic',()=>{
    const scored=scoreCandidate(candidate,denominator([1000,100]),asOf,context,policy,weights)!;
    expect(scored.demand.score).toBe(99);
    expect(scored.growth.score).toBe(64);
    expect(scored.competition.score).toBe(73);
    expect(scored.overall_score).toBe(Math.round((99*25+64*10+73*10)/45));
    expect(scored.confidence_score).toBe(70);
    expect(scored.market_access.score).toBeNull();
  });

  test('all unavailable components produce no score rather than a default',()=>{
    const unavailable={score:null,provenance:{status:'unavailable' as const,reason:'missing'}};
    expect(combineScores({a:unavailable,b:unavailable},{a:25,b:75})).toEqual({overall:0,weightsApplied:{}});
  });

  test('growth_window_years changes the actual historical window',()=>{
    const long=scoreCandidate({...candidate,totalRows:[row(2020,5000),...candidate.totalRows]},denominator([1000]),asOf,context,{...policy,growth_window_years:5},weights)!;
    const short=scoreCandidate({...candidate,totalRows:[row(2020,5000),...candidate.totalRows]},denominator([1000]),asOf,context,{...policy,growth_window_years:2},weights)!;
    expect(long.growth.score).not.toBe(short.growth.score);
    expect(long.growth.provenance).toMatchObject({row_count:4});
    expect(short.growth.provenance).toMatchObject({row_count:3});
  });

  test('digit-bearing rationale output is rejected and computed numerals are appended',async()=>{
    const scored=scoreCandidate(candidate,denominator([1000]),asOf,context,policy,weights)!;
    setRationaleWriter({name:'bad-writer',async write(){return 'Demand grew 47 percent.';}});
    const result=await composeRationale(scored,'coffee',true);
    expect(result.fell_back).toBe(true);
    expect(result.writer).toBe('template-v1');
    expect(result.text).not.toContain('47');
    expect(result.text).toContain('2024');
  });
});

describe('v3 correctness and frozen provenance',()=>{
  test('candidate filtering and volume floors cannot change the fixed share denominator',()=>{
    const fixed=denominator([1000,500,100]);
    const first=scoreCandidate(candidate,fixed,asOf,context,policy,weights)!;
    const filtered=scoreCandidate({...candidate,country_code:'US'},fixed,asOf,context,{...policy,volume_floor_usd:999999},weights)!;
    expect(first.demand).toEqual(filtered.demand);
    expect(first.demand.provenance).toMatchObject({input_evidence:{share_metric:'candidate_market_share',share_denominator:1600}});
  });

  test('an incomplete denominator cannot masquerade as global import share',()=>{
    const globalIncomplete={...denominator([1000,500]),metric:'global_import_share' as const};
    const result=scoreCandidate(candidate,globalIncomplete,asOf,context,policy,weights)!;
    expect(result.demand.provenance).toMatchObject({input_evidence:{share_metric:'global_import_share',denominator_completeness:'PARTIAL'}});
    expect((result.demand.provenance as {basis:string}).basis).not.toContain('global share');
  });

  test.each(['PARTIAL','FAILED','STALE'] as const)('HHI is unavailable for %s coverage while India share remains available',(completeness)=>{
    const partial={...candidate,supplierCoverage:{...candidate.supplierCoverage!,completeness}};
    const hhi=scoreCompetition(partial.supplierRowsLatestYear,partial.supplierCoverage);
    const result=scoreCandidate(partial,denominator([1000]),asOf,context,policy,weights)!;
    expect(hhi.score).toBeNull();expect(result.india_share.score).not.toBeNull();expect(result.competition.score).toBe(result.india_share.score);
  });

  test('complete reconciled supplier coverage permits HHI and records the assertion',()=>{
    const result=scoreCompetition(candidate.supplierRowsLatestYear,candidate.supplierCoverage);
    expect(result.score).toBe(75);
    expect(result.provenance).toMatchObject({input_evidence:{supplier_coverage:{assertion_id:'coverage-1',coverage_ratio:1,completeness:'COMPLETE'}}});
  });

  test('recency uses frozen as_of_date and all equally stale markets remain stale',()=>{
    const fresh=scoreCandidate(candidate,denominator([1000]),new Date('2026-01-01'),context,policy,weights)!;
    const staleA=scoreCandidate(candidate,denominator([1000]),new Date('2032-01-01'),context,policy,weights)!;
    const staleB=scoreCandidate({...candidate,country_code:'GB'},denominator([1000]),new Date('2032-01-01'),context,policy,weights)!;
    expect(staleA.confidence_score).toBeLessThan(fresh.confidence_score);expect(staleA.confidence_score).toBe(staleB.confidence_score);
    expect(scoreCandidate(candidate,denominator([1000]),new Date('2032-01-01'),context,policy,weights)).toEqual(staleA);
  });

  test('frozen policy hash and version dispatch survive changed current configuration',()=>{
    const frozen=structuredClone(policy);const hash=scoringPolicyHash(frozen);
    const baseline=scoreCandidateByModel({candidate,demandDenominator:denominator([1000]),asOfDate:asOf,context,policy:frozen,weights:frozen.base_weights})!;
    const changed={...policy,base_weights:{...policy.base_weights,demand_strength:1,growth_momentum:99}};
    expect(scoringPolicyHash(changed)).not.toBe(hash);
    const restored=historicalPolicyFromSnapshot(frozen)!;
    expect(scoringPolicyHash(restored)).toBe(hash);
    expect(scoreCandidateByModel({candidate,demandDenominator:denominator([1000]),asOfDate:asOf,context,policy:restored,weights:restored.base_weights})).toEqual(baseline);
    expect(historicalPolicyFromSnapshot(null)).toBeNull();
  });

  test('Market Access provenance includes explicit real snapshot identity',()=>{
    const access:MarketAccessInput={snapshot_id:'hmrc-snapshot',completeness:'COMPLETE',tariff_coverage:true,regulatory_coverage:true,evidence_origin:'public_real',provider:'HMRC',source_dataset:'UK Integrated Online Tariff v2',raw_response_checksum:'abc',evidence:[{id:'ordinary',rule_type:'destination_tariff',status:'verified',confidence:1,tariff_rate_percent:10,retrieved_at:new Date('2026-01-01'),evidence_origin:'public_real'},{id:'pref',rule_type:'preferential_tariff_india',status:'not_applicable',confidence:1,tariff_rate_percent:null,retrieved_at:new Date('2026-01-01'),evidence_origin:'public_real'}]};
    expect(scoreMarketAccess(access,new Date('2026-01-02')).provenance).toMatchObject({input_evidence:{snapshot_id:'hmrc-snapshot',evidence_origin:'public_real',provider:'HMRC',raw_response_checksum:'abc'}});
  });
});

describe('authoritative Market Access scoring',()=>{
  const evidence=(overrides:Record<string,unknown>={})=>({id:randomUUID(),rule_type:'destination_tariff' as const,status:'verified' as const,confidence:1,tariff_rate_percent:10,requirement_code:null,requirement_obtainable:null,retrieved_at:new Date('2026-01-01'),effective_at:null,expires_at:null,...overrides});
  const access=(items:ReturnType<typeof evidence>[]):MarketAccessInput=>({snapshot_id:randomUUID(),completeness:'COMPLETE',tariff_coverage:true,regulatory_coverage:true,evidence:items as MarketAccessInput['evidence']});
  test('ordinary tariff and verified India preference are deterministic',()=>{
    const ordinary=scoreMarketAccess(access([evidence(),evidence({rule_type:'preferential_tariff_india',tariff_rate_percent:5})]),new Date('2026-02-01'));
    const preferred=scoreMarketAccess(access([evidence(),evidence({rule_type:'preferential_tariff_india',tariff_rate_percent:0})]),new Date('2026-02-01'));
    expect(ordinary.score).toBe(86);expect(preferred.score).toBe(99);expect(preferred.provenance).toMatchObject({formula_version:'market-access-v1'});
  });
  test('missing, stale, superseded, HS-mismatched upstream selection, and low-confidence evidence are unavailable',()=>{
    expect(scoreMarketAccess(null).score).toBeNull();
    expect(scoreMarketAccess({...access([]),completeness:'STALE'}).score).toBeNull();
    expect(scoreMarketAccess(access([evidence({status:'superseded'}),evidence({rule_type:'preferential_tariff_india',status:'not_applicable',tariff_rate_percent:null})])).score).toBeNull();
    expect(scoreMarketAccess(access([evidence({confidence:.5}),evidence({rule_type:'preferential_tariff_india',status:'not_applicable',tariff_rate_percent:null})])).score).toBeNull();
    expect(marketAccessScopeMatches('6302600010','630260')).toBe(true);expect(marketAccessScopeMatches('090111','630260')).toBe(false);
  });
  test('mandatory certification lowers access while impossible certification and prohibition hard-block',()=>{
    const base=[evidence(),evidence({rule_type:'preferential_tariff_india',status:'not_applicable',tariff_rate_percent:null})];
    const cert=evidence({rule_type:'mandatory_certification',tariff_rate_percent:null,requirement_code:'CERT-X'});
    expect(scoreMarketAccess(access([...base,cert])).score).toBe(66);
    expect(marketAccessHardBlockers(access([...base,evidence({rule_type:'import_prohibition',tariff_rate_percent:null})]))).toHaveLength(1);
    expect(marketAccessHardBlockers(access([...base,evidence({rule_type:'mandatory_certification',tariff_rate_percent:null,requirement_code:'CERT-X',requirement_obtainable:false})]))).toHaveLength(1);
  });
});

describe('Export Economics scoring',()=>{
  const access:MarketAccessInput={snapshot_id:'snapshot-1',completeness:'COMPLETE',tariff_coverage:true,regulatory_coverage:true,evidence:[
    {id:'ordinary',rule_type:'destination_tariff',status:'verified',confidence:1,tariff_rate_percent:10,retrieved_at:new Date('2026-01-01')},
    {id:'india-preference',rule_type:'preferential_tariff_india',status:'verified',confidence:1,tariff_rate_percent:5,retrieved_at:new Date('2026-01-01')},
  ]};
  const economicsCandidate:CandidateInput={...candidate,marketAccess:access,totalRows:[{...row(2024,1000),quantity:100,unit:'kg',unit_value:10}],indiaRows:[{...row(2024,900,'699'),quantity:100,unit:'kg',unit_value:9}]};
  const priceContext:ExporterContext={price_target:9.5,price_target_currency:'USD',price_target_quantity_unit:'KGM',price_target_incoterm:'CIF'};

  test('uses only basis-compatible prices and stores auditable formula inputs',()=>{
    const result=scoreExportEconomics(economicsCandidate,priceContext,policy.export_economics,new Date('2026-02-01'));
    expect(result.score).toBe(92);
    expect(result.provenance).toMatchObject({formula_version:'export-economics-v1',currencies:['USD'],fx:{required:false},quantity_basis:{exporter:'kg',conversion_applied:false,package_units_rejected:true},incoterm_basis:{exporter:'CIF',trade_import_values:'CIF-type'}});
    const scored=scoreCandidate(economicsCandidate,denominator([1000]),asOf,priceContext,policy,weights)!;
    expect(scored.weights_applied.export_economics).toBe(15);
  });

  test.each([
    ['incompatible quantity unit',{price_target_quantity_unit:'No'}],
    ['package count',{price_target_quantity_unit:'CTN'}],
    ['different price basis',{price_target_incoterm:'FOB'}],
    ['missing FX evidence',{price_target_currency:'INR'}],
  ])('%s makes the component unavailable',(_label,override)=>{
    const result=scoreExportEconomics(economicsCandidate,{...priceContext,...override},policy.export_economics,new Date('2026-02-01'));
    expect(result.score).toBeNull();
    expect(result.provenance).toMatchObject({status:'unavailable',formula_version:'export-economics-v1',confidence_score:0,unavailable_reasons:expect.any(Array)});
  });

  test('unknown units and manifest package units are never normalized into product units',()=>{
    expect(canonicalQuantityUnit('kg')).toBe('kg');
    expect(canonicalQuantityUnit('No')).toBe('No');
    expect(canonicalQuantityUnit('litres')).toBe('l');
    expect(canonicalQuantityUnit('packages')).toBeNull();
  });
});

describe('Logistics Feasibility scoring',()=>{
  const now=new Date('2026-08-14T00:00:00Z');
  const route=(overrides:Partial<LogisticsRouteEvidenceInput>={}):LogisticsRouteEvidenceInput=>({id:randomUUID(),origin_country:'IN',origin_state:'Gujarat',origin_city:'Ahmedabad',origin_gateway:'Mundra',destination_country:'US',destination_port:'New York',transport_mode:'ocean',route_available:true,transit_time_min_days:18,transit_time_max_days:20,freight_amount:1000,freight_currency:'USD',freight_rate_basis:'per_shipment',freight_retrieved_at:new Date('2026-08-10'),freight_valid_until:new Date('2026-08-20'),assumed_shipment_value_amount:10000,assumed_shipment_value_currency:'USD',provider:'test-provider',source_reference:randomUUID(),retrieved_at:new Date('2026-08-10'),valid_until:new Date('2026-09-01'),equipment_assumption:'one dry container',supported_product_constraint_codes:['DRY'],confidence:1,status:'verified',...overrides});
  const logisticsContext:ExporterContext={origin_country:'IN',origin_state:'Gujarat',origin_city:'Ahmedabad',lead_time_days:10,delivery_commitment_days:40,logistics_constraints_confirmed:true,logistics_constraint_codes:['DRY']};

  test('no route data and missing exporter location are unavailable',()=>{
    expect(scoreLogisticsFeasibility({...candidate,logisticsRoutes:[]},logisticsContext,policy.logistics,now).score).toBeNull();
    expect(scoreLogisticsFeasibility({...candidate,logisticsRoutes:[route()]},{...logisticsContext,origin_state:null,origin_city:null},policy.logistics,now).score).toBeNull();
  });

  test('a viable route scores all four independently sourced subfactors',()=>{
    const result=scoreLogisticsFeasibility({...candidate,logisticsRoutes:[route()]},logisticsContext,policy.logistics,now);
    expect(result.score).toBe(82);
    expect(result.provenance).toMatchObject({formula_version:'logistics-feasibility-v1',confidence_score:100,evidence_ids:expect.any(Array),input_evidence:{production_lead_time_days:10,delivery_commitment_days:40}});
  });

  test('multiple viable routes improve route redundancy deterministically',()=>{
    const one=scoreLogisticsFeasibility({...candidate,logisticsRoutes:[route({freight_amount:null})]},{...logisticsContext,lead_time_days:null,delivery_commitment_days:null,logistics_constraints_confirmed:false},policy.logistics,now);
    const two=scoreLogisticsFeasibility({...candidate,logisticsRoutes:[route({freight_amount:null}),route({transport_mode:'multimodal',freight_amount:null})]},{...logisticsContext,lead_time_days:null,delivery_commitment_days:null,logistics_constraints_confirmed:false},policy.logistics,now);
    expect(one.score).toBe(85);expect(two.score).toBe(92);
  });

  test('stale freight is excluded while current route evidence remains usable',()=>{
    const result=scoreLogisticsFeasibility({...candidate,logisticsRoutes:[route({freight_valid_until:new Date('2026-08-01')})]},logisticsContext,policy.logistics,now);
    expect(result.score).toBe(92);
    expect(result.provenance).toMatchObject({confidence_score:75,unavailable_reasons:expect.arrayContaining([expect.stringContaining('freight')])});
  });

  test('incompatible product constraints score poorly rather than being guessed compatible',()=>{
    const compatible=scoreLogisticsFeasibility({...candidate,logisticsRoutes:[route()]},logisticsContext,policy.logistics,now);
    const incompatible=scoreLogisticsFeasibility({...candidate,logisticsRoutes:[route({supported_product_constraint_codes:[]})]},logisticsContext,policy.logistics,now);
    expect(incompatible.score).toBeLessThan(compatible.score!);
  });

  test('lead-time mismatch compares transit with commitment after production time',()=>{
    const viable=scoreLogisticsFeasibility({...candidate,logisticsRoutes:[route()]},logisticsContext,policy.logistics,now);
    const mismatch=scoreLogisticsFeasibility({...candidate,logisticsRoutes:[route()]},{...logisticsContext,delivery_commitment_days:20},policy.logistics,now);
    expect(mismatch.score).toBeLessThan(viable.score!);
  });
});

describe('Risk & Resilience scoring',()=>{
  const now=new Date('2025-06-01T00:00:00Z');
  const withValues=(values:number[],supplierRows=candidate.supplierRowsLatestYear):CandidateInput=>({...candidate,totalRows:values.map((value,index)=>row(2021+index,value)),supplierRowsLatestYear:supplierRows});
  const signal=(overrides:Partial<MarketRiskSignalInput>={}):MarketRiskSignalInput=>({id:randomUUID(),dimension:'macro_volatility',metric:'macro_volatility_index',value:20,unit:'index_0_100',observation_date:new Date('2025-01-01'),retrieved_at:new Date('2025-05-01'),valid_until:new Date('2025-12-31'),provider:'test-authority',source_reference:randomUUID(),source_version:'2025-v1',normalization_method:'linear_0_100_risk_inverse_v1',confidence:1,status:'verified',...overrides});

  test('stable demand is more resilient than a volatile series',()=>{
    const stable=scoreRiskResilience(withValues([100,110,121,133.1]),policy.risk_resilience,now);
    const volatile=scoreRiskResilience(withValues([100,200,100,300]),policy.risk_resilience,now);
    expect(stable.score).toBe(99);expect(volatile.score).toBe(1);
    expect(stable.provenance).toMatchObject({formula_version:'risk-resilience-v1',input_evidence:{trade_years:[2021,2022,2023,2024]}});
  });

  test('current macro and payment signals are auditable and renormalized',()=>{
    const input={...withValues([100,110,121,133.1]),riskSignals:[signal(),signal({dimension:'payment_country_risk',metric:'payment_risk_index',value:40})]};
    const result=scoreRiskResilience(input,policy.risk_resilience,now);
    expect(result.score).toBe(87);
    expect(result.provenance).toMatchObject({evidence_ids:expect.any(Array),input_evidence:{signals:expect.arrayContaining([expect.objectContaining({provider:'test-authority',source_version:'2025-v1',normalization_method:'linear_0_100_risk_inverse_v1'})])}});
  });

  test('supplier concentration remains in Competition and is not double-counted',()=>{
    const fragmented=withValues([100,110,121,133.1],[row(2024,25,'1'),row(2024,25,'2'),row(2024,25,'3'),row(2024,25,'4')]);
    const concentrated=withValues([100,110,121,133.1],[row(2024,100,'1')]);
    concentrated.riskSignals=[signal({dimension:'supplier_dependency',metric:'supplier_hhi',value:99})];
    expect(scoreRiskResilience(fragmented,policy.risk_resilience,now).score).toBe(scoreRiskResilience(concentrated,policy.risk_resilience,now).score);
    expect(scoreCompetition(fragmented.supplierRowsLatestYear,fragmented.supplierCoverage).score).toBeGreaterThan(scoreCompetition(concentrated.supplierRowsLatestYear,concentrated.supplierCoverage).score!);
  });

  test('missing required trade evidence is unavailable and stale signals do not rescue it',()=>{
    const missing=withValues([100,110,120]);
    missing.riskSignals=[signal({retrieved_at:new Date('2024-01-01'),valid_until:new Date('2024-12-31')})];
    expect(scoreRiskResilience(missing,policy.risk_resilience,now)).toMatchObject({score:null,provenance:{status:'unavailable',confidence_score:0}});
  });

  test('stale optional evidence is excluded and lowers component confidence',()=>{
    const baseline=scoreRiskResilience(withValues([100,110,121,133.1]),policy.risk_resilience,now);
    const stale=scoreRiskResilience({...withValues([100,110,121,133.1]),riskSignals:[signal({retrieved_at:new Date('2024-01-01'),valid_until:new Date('2024-12-31')})]},policy.risk_resilience,now);
    expect(stale.score).toBe(baseline.score);
    expect(stale.provenance).toMatchObject({confidence_score:45,unavailable_reasons:expect.arrayContaining([expect.stringContaining('macro')])});
  });
});

describe('contextual Exporter-Market Fit',()=>{
  const now=new Date('2026-02-01T00:00:00Z');
  const benchmark=(benchmark_type:ExporterMarketFitBenchmarkInput['benchmark_type'],overrides:Partial<ExporterMarketFitBenchmarkInput>={}):ExporterMarketFitBenchmarkInput=>({id:randomUUID(),benchmark_type,minimum_value:null,maximum_value:null,unit:null,currency:null,required:null,requirement_code:null,provider:'test-market-source',source_reference:randomUUID(),source_version:'2026-v1',observed_at:new Date('2026-01-01'),retrieved_at:new Date('2026-01-02'),valid_until:new Date('2026-12-31'),confidence:1,status:'verified',...overrides});
  const access:MarketAccessInput={snapshot_id:'fit-access',completeness:'COMPLETE',tariff_coverage:true,regulatory_coverage:true,evidence:[{id:'cert-requirement',rule_type:'mandatory_certification',status:'verified',confidence:1,tariff_rate_percent:null,requirement_code:'CERT-X',requirement_obtainable:true,retrieved_at:new Date('2026-01-02')}]};
  const contextualCandidate:CandidateInput={...candidate,marketAccess:access,fitBenchmarks:[benchmark('order_value',{minimum_value:5000,maximum_value:20000,currency:'USD'}),benchmark('order_quantity',{minimum_value:500,maximum_value:1000,unit:'kg'}),benchmark('production_lead_time',{maximum_value:30,unit:'days'}),benchmark('customization_required',{required:true,requirement_code:'PRIVATE_LABEL'}),benchmark('packaging_required',{required:true,requirement_code:'RETAIL_READY'})]};
  const exporterA:ExporterContext={desired_order_size_amount:10000,desired_order_size_currency:'USD',capacity:1000,capacity_unit:'kg',moq_value:100,moq_unit:'kg',lead_time_days:20,customization_capability:'Private label supported',packaging_capability:'Retail-ready packaging supported',certifications:[{code:'CERT-X',name:'Required certificate',status:'held',evidence_ref:'doc-1',valid_until:'2027-01-01'}]};
  const exporterB:ExporterContext={desired_order_size_amount:50000,desired_order_size_currency:'USD',capacity:200,capacity_unit:'kg',moq_value:2000,moq_unit:'kg',lead_time_days:60,customization_capability:null,packaging_capability:null,certifications:[{code:'CERT-X',name:'Required certificate',status:'in_progress',evidence_ref:null}]};

  test('two exporters selling the same HS6 into the same market receive different fit',()=>{
    const a=scoreExporterMarketFit(contextualCandidate,exporterA,policy.exporter_market_fit,now);
    const b=scoreExporterMarketFit(contextualCandidate,exporterB,policy.exporter_market_fit,now);
    expect(a.score).toBeGreaterThan(b.score!);
    expect(a.provenance).toMatchObject({formula_version:'exporter-market-fit-v1',input_evidence:{country_code:'US'}});
    const integrated=scoreCandidate(contextualCandidate,denominator([1000]),asOf,exporterA,policy,weights)!;
    expect(integrated.weights_applied.exporter_market_fit).toBe(15);
  });

  test('Product capabilities without destination evidence do not create fit',()=>{
    expect(scoreExporterMarketFit({...candidate,marketAccess:null,fitBenchmarks:[]},exporterA,policy.exporter_market_fit,now)).toMatchObject({score:null,provenance:{status:'unavailable',confidence_score:0}});
  });

  test('certification states use actual mandatory Market Access evidence',()=>{
    const certOnly={...candidate,marketAccess:access,fitBenchmarks:[]};
    const held=scoreExporterMarketFit(certOnly,exporterA,policy.exporter_market_fit,now);
    const progress=scoreExporterMarketFit(certOnly,exporterB,policy.exporter_market_fit,now);
    const expired=scoreExporterMarketFit(certOnly,{...exporterA,certifications:[{code:'CERT-X',name:'Required certificate',status:'held',evidence_ref:'old-doc',valid_until:'2025-01-01'}]},policy.exporter_market_fit,now);
    const absent=scoreExporterMarketFit(certOnly,{...exporterA,certifications:[]},policy.exporter_market_fit,now);
    expect(held.score).toBeGreaterThan(progress.score!);expect(progress.score).toBeGreaterThan(expired.score!);expect(expired.score).toBeGreaterThan(absent.score!);
  });
});

describe('warehouse discovery contract',()=>{
  async function insertFlows(hs:string,reporter='842'){
    await prisma.tradeFlow.createMany({data:[2022,2023,2024].map((year,index)=>({reporter,partner:'0',hs_code:hs,year,period:String(year),value:1_000_000+index*100_000,quantity:100_000,unit:'kg',unit_value:10+index,flow_direction:TradeFlowDirection.import,source:TradeDataSource.comtrade,provider:'un_comtrade',source_mode:TradeSourceMode.authenticated,retrieved_at:new Date(),source_dataset:'vitest'}))});
  }

  test('requires exact HS6 and never falls back to a chapter',async()=>{
    const marker=`09${String(Math.floor(Math.random()*10000)).padStart(4,'0')}`;
    await prisma.tradeFlow.create({data:{reporter:'842',partner:'0',hs_code:marker.slice(0,2),year:2024,period:'2024',value:9_000_000,quantity:null,unit:null,unit_value:null,flow_direction:TradeFlowDirection.import,source:TradeDataSource.comtrade,provider:'fixture',source_mode:TradeSourceMode.fixture,retrieved_at:new Date(),source_dataset:'vitest'}});
    try{const result=await new WarehouseDiscoveryEngine().rank({description:'test',hs_code:marker,target_countries:['US'],origin_country:'IN'});expect(result.assessments).toHaveLength(0);expect(result.provenance).toMatchObject({reason:'no_warehouse_data',hs_scope:marker});}
    finally{await prisma.tradeFlow.deleteMany({where:{source_dataset:'vitest',hs_code:marker.slice(0,2)}});}
  });

  test('hard eligibility is ineligible, while deterministic reruns preserve versions and provenance',async()=>{
    const hs=`08${String(Math.floor(Math.random()*10000)).padStart(4,'0')}`;
    await insertFlows(hs);
    const rule=await prisma.marketEligibilityRule.create({data:{country_code:'US',hs_code_prefix:hs,rule_type:'sanctions_restricted',source:'vitest',source_ref:randomUUID()}});
    try{
      const engine=new WarehouseDiscoveryEngine(),input={description:'fresh fruit',hs_code:hs,target_countries:['US'],origin_country:'IN'};
      const first=await engine.rank(input),second=await engine.rank(input);
      expect(first.assessments).toEqual(second.assessments);
      expect(first.assessments[0]).toMatchObject({eligibility_status:'ineligible',overall_score:null,risk_resilience_score:null,model_version:expect.any(String),weight_profile_version:expect.any(Number)});
      expect(first.assessments[0].field_provenance).toHaveProperty('eligibility');
    }finally{await prisma.marketEligibilityRule.delete({where:{id:rule.id}});await prisma.tradeFlow.deleteMany({where:{source_dataset:'vitest',hs_code:hs}});}
  });

  test('computed fields carry numeric provenance and authenticated origin',async()=>{
    const hs=`07${String(Math.floor(Math.random()*10000)).padStart(4,'0')}`;await insertFlows(hs);
    try{const result=await new WarehouseDiscoveryEngine().rank({description:'vegetables',hs_code:hs,target_countries:['US'],origin_country:'IN'});const assessment=result.assessments[0];expect(assessment.evidence_origins).toEqual(['authenticated_real']);expect(assessment.model_version).toBeTruthy();expect(assessment.weight_profile_version).toBeGreaterThan(0);expect(assessment.field_provenance).toMatchObject({demand_score:{source:'comtrade',row_count:1},growth_score:{source:'comtrade',row_count:3}});}
    finally{await prisma.tradeFlow.deleteMany({where:{source_dataset:'vitest',hs_code:hs}});}
  });
});
