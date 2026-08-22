import { createHash, randomUUID } from 'node:crypto';
import { EvidenceOrigin, OrgTier, ProductClassificationMethod, ProductClassificationStatus, TradeSourceMode, UserRole } from '@prisma/client';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { setComtradeClient, type ComtradeFetchParams } from '../src/lib/comtrade';
import { createCountryEvidencePlan, executeCountryEvidencePlan, resolveCountryEvidencePlan } from '../src/lib/country-evidence/service';
import { prisma } from '../src/lib/prisma';
import { reserveProviderQuota } from '../src/lib/provider-quota';
import { calculateAndPersistCountryTradeMetrics, formatCountryTradeMetricsReconciliation } from '../src/lib/country-trade-metrics/service';
import { CONFIG_DEFAULTS } from '../src/lib/config';
import { createCountryTruthV4Assessments } from '../src/lib/discovery/country-truth-v4-service';

async function confirmedClassification(revision='HS2022'){
  const marker=`country-plan-${randomUUID()}`;
  const org=await prisma.exporterOrg.create({data:{display_name:marker,tier:OrgTier.paid}});
  const user=await prisma.user.create({data:{email:`${marker}@example.test`,name:'Planner',role:UserRole.exporter_owner,exporter_org_id:org.id}});
  const product=await prisma.product.create({data:{exporter_org_id:org.id,name:'Coffee',evidence_origin:EvidenceOrigin.fixture}});
  const now=new Date();await prisma.product.update({where:{id:product.id},data:{hs_code:'090111',hs_code_source:'exporter_supplied',hs_nomenclature:'HS',hs_nomenclature_version:revision,hs_classification_method:ProductClassificationMethod.exporter_supplied,hs_classification_status:ProductClassificationStatus.confirmed,hs_classification_confidence:.99,hs_classification_evidence:{source:'test'},hs_confirmed_by_id:user.id,hs_confirmed_at:now,hs_classification_revision:1}});
  return prisma.productClassification.create({data:{product_id:product.id,revision:1,hs6_code:'090111',nomenclature:'HS',nomenclature_version:revision,method:ProductClassificationMethod.exporter_supplied,product_facts_snapshot:{schema_version:'test'},evidence:{source:'test'},rationale:'Test classification',source_references:[],confidence:.99,status:ProductClassificationStatus.confirmed,proposed_by_id:user.id,confirmed_by_id:user.id,confirmed_at:now}});
}

function fixtureClient(options:{omitIndia?:boolean}={}){
  const calls=vi.fn();
  return {calls,client:{name:'country-evidence-fixture',identity:{provider:'un_comtrade' as const,mode:'fixture' as const,authenticated:false,credential_fingerprint:`fixture-${randomUUID()}`,source_dataset:'fixture-country-evidence',source_dataset_version:'v1'},async resolveChapter(){throw new Error('explicit HS6 should bypass reference');},async fetchChapter(params:ComtradeFetchParams){
    calls(params);
    const values=params.partner==='all'?[['156',60],['699',40]]:params.partner==='699'?(options.omitIndia?[]:[['699',10]]):[['0',100]];
    const rows=values.map(([partner,value])=>({reporter:params.reporter,partner:String(partner),partner2:'0',hs_code:'090111',year:params.year,period:String(params.year),value:Number(value),value_status:'observed' as const,quantity:null,quantity_status:'missing' as const,unit:null,flow_code:'M',frequency:'A',customs_code:'C00',mode_of_supply:'0'}));
    const raw=JSON.stringify({count:rows.length,data:rows});
    return {rows,request_count:1,retrieved_at:new Date(),source_dataset_version:'v1',evidence_pages:[{http_status:200,raw_response_text:raw,response_checksum:createHash('sha256').update(raw).digest('hex'),redacted_request:'comtrade://fixture',provider_row_count:rows.length,returned_row_count:rows.length,completeness:'COMPLETE' as const,completeness_metadata:{truncated:false,rejected_rows:0},quota_metadata:null,retrieved_at:new Date()}]};
  }}};
}

afterEach(()=>setComtradeClient(null));afterAll(()=>prisma.$disconnect());

describe('Country Evidence persisted plan and manifest',()=>{
  test('is idempotent, cache-resumable, supplier-complete, and freezes immutable lineage',async()=>{
    const classification=await confirmedClassification(),fixture=fixtureClient();setComtradeClient(fixture.client);
    const args={product_classification_id:classification.id,as_of_date:new Date('2026-08-22T00:00:00Z'),candidate_reporters:['276'],source_mode:TradeSourceMode.fixture};
    const first=await createCountryEvidencePlan(args),same=await createCountryEvidencePlan(args);
    expect(same.id).toBe(first.id);expect(first.items).toHaveLength(11);expect(first.estimated_call_cost).toBe(11);
    await expect(prisma.countryEvidencePlan.update({where:{id:first.id},data:{hs_revision:'rewritten'}})).rejects.toThrow(/immutable/);
    const executed=await executeCountryEvidencePlan(first.id);
    expect(executed).toMatchObject({status:'metric_ready',physical_calls:11});expect(fixture.calls).toHaveBeenCalledTimes(11);
    const rerun=await executeCountryEvidencePlan(first.id);
    expect(rerun).toMatchObject({status:'metric_ready',physical_calls:0});expect(fixture.calls).toHaveBeenCalledTimes(11);
    if(!rerun.manifest)throw new Error('Expected a frozen manifest.');
    expect(rerun.manifest.checksum).toBe(executed.manifest?.checksum);expect(rerun.manifest.references).toHaveLength(11);
    const metrics=await calculateAndPersistCountryTradeMetrics(rerun.manifest.id);
    expect(metrics).toHaveLength(1);const metric=metrics[0];
    await prisma.tradeFlow.updateMany({where:{reporter:'276'},data:{value:999999}});
    const recalculated=await calculateAndPersistCountryTradeMetrics(rerun.manifest.id);
    expect(recalculated[0].id).toBe(metric.id);expect(recalculated[0].checksum).toBe(metric.checksum);
    expect(formatCountryTradeMetricsReconciliation(metric)).toContain('evidence:');
    const v2=await calculateAndPersistCountryTradeMetrics(rerun.manifest.id,{...CONFIG_DEFAULTS['country_trade_metrics.policy'],policy_version:'country-trade-metrics-v2',calculation_version:'country-trade-calculator-v2'});
    expect(v2[0].checksum).not.toBe(metric.checksum);
    const product=await prisma.product.findUniqueOrThrow({where:{id:classification.product_id}});
    const makeRun=()=>prisma.discoveryRun.create({data:{exporter_org_id:product.exporter_org_id,product_id:product.id,input_snapshot:{phase:'country_truth_v4_test'}}});
    const legacyRun=await makeRun(),legacy=await prisma.marketAssessment.create({data:{run_id:legacyRun.id,product_id:product.id,country_code:'GB',overall_score:73,demand_score:70,confidence_score:44,model_version:'market-attractiveness-v3',weight_profile_key:'general',weight_profile_version:1}});
    const runA=await makeRun(),[assessmentA]=await createCountryTruthV4Assessments({run_id:runA.id,country_trade_metrics_ids:[metric.id],source_mode:TradeSourceMode.fixture,scoring_clock:new Date('2026-08-22T00:00:00Z')});
    await prisma.tradeFlow.updateMany({where:{reporter:'276'},data:{value:1}});
    const runB=await makeRun(),[assessmentB]=await createCountryTruthV4Assessments({run_id:runB.id,country_trade_metrics_ids:[metric.id],source_mode:TradeSourceMode.fixture,scoring_clock:new Date('2026-08-22T00:00:00Z')});
    expect(assessmentB).toMatchObject({model_version:'market-attractiveness-v4',overall_score:assessmentA.overall_score,confidence_score:assessmentA.confidence_score,assessment_checksum:assessmentA.assessment_checksum,country_trade_metrics_id:metric.id,country_evidence_manifest_id:rerun.manifest.id,evidence_origins:['fixture']});
    const forbiddenRun=await makeRun();await expect(createCountryTruthV4Assessments({run_id:forbiddenRun.id,country_trade_metrics_ids:[metric.id],source_mode:TradeSourceMode.authenticated,scoring_clock:new Date('2026-08-22T00:00:00Z')})).rejects.toThrow(/source mode|fixture/i);
    await expect(prisma.marketAssessment.update({where:{id:assessmentA.id},data:{overall_score:99}})).rejects.toThrow(/immutable/);
    expect(await prisma.marketAssessment.findUniqueOrThrow({where:{id:legacy.id}})).toMatchObject({overall_score:73,model_version:'market-attractiveness-v3',country_trade_metrics_id:null});
    await expect(prisma.countryTradeMetrics.update({where:{id:metric.id},data:{reporter_code:'999'}})).rejects.toThrow(/immutable/);
    await expect(prisma.countryEvidenceManifest.update({where:{id:rerun.manifest.id},data:{evaluation_state:'rewritten'}})).rejects.toThrow(/immutable/);
  });

  test('does not convert a provider-complete absent India row into zero',async()=>{
    const classification=await confirmedClassification(),fixture=fixtureClient({omitIndia:true});setComtradeClient(fixture.client);
    const plan=await createCountryEvidencePlan({product_classification_id:classification.id,as_of_date:new Date('2026-08-22T00:00:00Z'),candidate_reporters:['842'],source_mode:TradeSourceMode.fixture});
    const result=await executeCountryEvidencePlan(plan.id);
    expect(result.status).toBe('partial');
    const india=await prisma.countryEvidencePlanItem.findMany({where:{plan_id:plan.id,purpose:'INDIA_IMPORT_HISTORY'}});
    expect(india.every(item=>item.resolution_state==='missing'&&(item.resolution_metadata as {absence_is_not_zero?:boolean}).absence_is_not_zero===true)).toBe(true);
    const callCount=fixture.calls.mock.calls.length;
    await executeCountryEvidencePlan(plan.id);
    expect(fixture.calls).toHaveBeenCalledTimes(callCount);
  });

  test('preflights shared authenticated quota and defers the whole plan by default',async()=>{
    const classification=await confirmedClassification(),fixture=fixtureClient();
    const credential=`auth-${randomUUID()}`;
    setComtradeClient({...fixture.client,identity:{...fixture.client.identity,mode:'authenticated',authenticated:true,credential_fingerprint:credential}});
    await reserveProviderQuota({provider:'un_comtrade',credential_fingerprint:credential,configured_limit:450,request_count:450});
    const plan=await createCountryEvidencePlan({product_classification_id:classification.id,as_of_date:new Date('2026-08-22T00:00:00Z'),candidate_reporters:['826'],source_mode:TradeSourceMode.authenticated});
    const result=await executeCountryEvidencePlan(plan.id);
    expect(result).toMatchObject({status:'deferred_quota',estimated_calls:11,available_calls:0,physical_calls:0});
    expect(fixture.calls).not.toHaveBeenCalled();
  });

  test('refuses unsupported revisions and never admits fixture evidence to an authenticated plan',async()=>{
    const fixture=fixtureClient();setComtradeClient(fixture.client);
    const oldClassification=await confirmedClassification('HS2017');
    await expect(createCountryEvidencePlan({product_classification_id:oldClassification.id,as_of_date:new Date('2026-08-22T00:00:00Z'),candidate_reporters:['124'],source_mode:TradeSourceMode.fixture})).rejects.toThrow(/unsupported/);
    const currentClassification=await confirmedClassification('HS2022');
    const fixturePlan=await createCountryEvidencePlan({product_classification_id:currentClassification.id,as_of_date:new Date('2026-08-22T00:00:00Z'),candidate_reporters:['124'],source_mode:TradeSourceMode.fixture});
    await executeCountryEvidencePlan(fixturePlan.id);
    const authenticatedPlan=await createCountryEvidencePlan({product_classification_id:currentClassification.id,as_of_date:new Date('2026-08-22T00:00:00Z'),candidate_reporters:['124'],source_mode:TradeSourceMode.authenticated});
    const isolated=await resolveCountryEvidencePlan(authenticatedPlan.id);
    expect(isolated.items.every(item=>item.resolution_state==='fetch_required'&&item.source_evidence_id===null)).toBe(true);
  });
});
