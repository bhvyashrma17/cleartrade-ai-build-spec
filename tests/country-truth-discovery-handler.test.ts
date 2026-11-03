import { createHash,randomUUID } from 'node:crypto';
import { EvidenceOrigin,JobType,OrgTier,ProductClassificationMethod,ProductClassificationStatus,TradeSourceMode,UserRole,type Prisma } from '@prisma/client';
import { afterAll,afterEach,describe,expect,test,vi } from 'vitest';
import { setComtradeClient,type ComtradeFetchParams } from '../src/lib/comtrade';
import { createCountryEvidencePlan,executeCountryEvidencePlan } from '../src/lib/country-evidence/service';
import { requestCountryTruthDiscovery } from '../src/lib/country-truth-discovery-request';
import { claimNextJob,getJobHandler,runClaimedJob } from '../src/lib/jobs';
import { runCountryTruthDiscovery } from '../src/lib/job-handlers/country-truth-discovery';
import { registerAllJobHandlers } from '../src/lib/job-handlers';
import { prisma } from '../src/lib/prisma';
import { reserveProviderQuota } from '../src/lib/provider-quota';
import type { Principal } from '../src/types';

afterEach(()=>setComtradeClient(null));afterAll(()=>prisma.$disconnect());

/**
 * A collision-free HS6 per fixture.
 *
 * This previously derived the HS6 from a UUID modulo 1000, which gave every fixture in the whole
 * suite a 1-in-1000 draw from the SAME namespace — and `country-truth-phase-1h-assessment` drew
 * from that identical range. Vitest runs every file against one schema, so two fixtures landing
 * on the same HS6 made the second one find the first one's evidence already `reusable`: the
 * provider was never called, and assertions counting provider calls or expecting `partial`
 * failed intermittently (~16% per run, and dependent on file order). A monotonic counter in a
 * per-file band removes the draw entirely.
 */
let fixtureHs6Counter = 0;
const nextFixtureHs6 = () => String(970000 + (fixtureHs6Counter += 1)).padStart(6, '0');

async function fixture(){
  const marker=`ct-handler-${randomUUID()}`,hs6=nextFixtureHs6(),itcHs=`${hs6}12`,org=await prisma.exporterOrg.create({data:{display_name:marker,tier:OrgTier.paid}}),agent=await prisma.user.create({data:{email:`${marker}@example.test`,name:'Agent',role:UserRole.agent}});
  await prisma.agentAssignment.create({data:{exporter_org_id:org.id,agent_user_id:agent.id,status:'active'}});
  const product=await prisma.product.create({data:{exporter_org_id:org.id,name:'Basmati rice',evidence_origin:EvidenceOrigin.authenticated_real,price_target_amount:1200,price_target_currency:'USD',price_target_quantity_unit:'kg',price_target_incoterm:'FOB'}}),now=new Date('2026-08-24T00:00:00.000Z');
  await prisma.product.update({where:{id:product.id},data:{itc_hs_code:itcHs,hs_code:hs6,hs_code_source:'manually_verified',hs_nomenclature:'ITC-HS',hs_nomenclature_version:'2022',hs_classification_method:ProductClassificationMethod.manually_verified,hs_classification_status:ProductClassificationStatus.confirmed,hs_classification_confidence:.99,hs_classification_evidence:{source:'test'},hs_confirmed_by_id:agent.id,hs_confirmed_at:now,hs_classification_revision:1}});
  const classification=await prisma.productClassification.create({data:{product_id:product.id,revision:1,itc_hs_code:itcHs,hs6_code:hs6,nomenclature:'ITC-HS',nomenclature_version:'2022',method:ProductClassificationMethod.manually_verified,product_facts_snapshot:{name:product.name},evidence:{source:'test'},rationale:'Confirmed pilot classification.',source_references:[],confidence:.99,status:ProductClassificationStatus.confirmed,proposed_by_id:agent.id,confirmed_by_id:agent.id,confirmed_at:now}});
  const actor:Principal={id:agent.id,email:agent.email,name:agent.name,role:UserRole.agent,exporter_org_id:null,tier:OrgTier.paid};
  const requested=await requestCountryTruthDiscovery({actor,exporter_org_id:org.id,product_id:product.id,candidate_countries:['Germany'],correlation_id:randomUUID(),requested_at:now});
  return{org,agent,product,classification,job:requested.job,payload:requested.payload};
}

function authenticatedClient(options:{credential?:string;failOnce?:(params:ComtradeFetchParams)=>boolean;missingIndia?:boolean}={}){
  const calls=vi.fn(),failed=new Set<string>();
  const client={name:'mocked-authenticated-comtrade',identity:{provider:'un_comtrade' as const,mode:'authenticated' as const,authenticated:true,credential_fingerprint:options.credential??`auth-${randomUUID()}`,source_dataset:'un-comtrade-api',source_dataset_version:'mock-v1'},async resolveChapter(){throw new Error('Explicit HS6 must bypass reference data.');},async fetchChapter(params:ComtradeFetchParams){
    calls(params);const key=`${params.reporter}:${params.partner}:${params.year}`;if(options.failOnce?.(params)&&!failed.has(key)){failed.add(key);throw new Error('Mock provider temporary failure.');}
    const values=params.partner==='all'?[['156',60],['699',40]]:params.partner==='699'?(options.missingIndia?[]:[['699',40]]):[['0',100]];
    const rows=values.map(([partner,value])=>({reporter:params.reporter,partner:String(partner),partner2:'0',hs_code:params.hs_codes[0],year:params.year,period:String(params.year),value:Number(value),value_status:'observed' as const,quantity:10,quantity_status:'observed' as const,unit:'kg',net_weight:10,flow_code:'M',frequency:'A',customs_code:'C00',mode_of_supply:'0'}));
    const raw=JSON.stringify({count:rows.length,data:rows});return{rows,request_count:1,retrieved_at:new Date('2026-08-24T01:00:00.000Z'),source_dataset_version:'mock-v1',evidence_pages:[{http_status:200,raw_response_text:raw,response_checksum:createHash('sha256').update(raw).digest('hex'),redacted_request:'https://comtradeapi.un.org/redacted',provider_row_count:rows.length,returned_row_count:rows.length,completeness:'COMPLETE' as const,completeness_metadata:{provider_count:rows.length,response_rows:rows.length,accepted_rows:rows.length,rejected_rows:0,truncated:false,pagination_supported:false,parser_version:'comtrade-parser-v2'},quota_metadata:null,retrieved_at:new Date('2026-08-24T01:00:00.000Z')}]};
  }};return{client,calls};
}

const context=(f:Awaited<ReturnType<typeof fixture>>)=>({job_id:f.job.id,attempt_no:1,payload:f.job.payload,exporter_org_id:f.org.id,target_id:f.classification.id,correlation_id:f.job.correlation_id,reportProgress:async()=>undefined});

describe('country_truth_discovery orchestration handler',()=>{
  test('is registered and executes authenticated plan, manifest, metrics, dedicated run and v4 assessments',async()=>{
    registerAllJobHandlers();expect(getJobHandler(JobType.country_truth_discovery)).toBe(runCountryTruthDiscovery);
    const f=await fixture(),provider=authenticatedClient();setComtradeClient(provider.client);
    // Vitest runs every file against one schema, and the request tests deliberately leave queued deep
    // jobs behind. claimNextJob takes the oldest run_after first, so put THIS fixture's job at the front
    // rather than assume an empty queue — which held only when this file happened to run first.
    await prisma.job.update({where:{id:f.job.id},data:{run_after:new Date(0)}});
    const claimed=await claimNextJob([JobType.country_truth_discovery]);expect(claimed?.id).toBe(f.job.id);await runClaimedJob(claimed!);
    const completedJob=await prisma.job.findUniqueOrThrow({where:{id:f.job.id}}),result=completedJob.result as Record<string,unknown>;
    expect(completedJob.status).toBe('completed');expect(provider.calls).toHaveBeenCalledTimes(11);expect(result).toMatchObject({stage:'completed',physical_calls:11});
    const plan=await prisma.countryEvidencePlan.findUniqueOrThrow({where:{id:String(result.country_evidence_plan_id)}}),manifest=await prisma.countryEvidenceManifest.findUniqueOrThrow({where:{id:String(result.country_evidence_manifest_id)}}),metrics=await prisma.countryTradeMetrics.findMany({where:{id:{in:result.country_trade_metrics_ids as string[]}}}),run=await prisma.discoveryRun.findUniqueOrThrow({where:{id:String(result.discovery_run_id)}}),assessments=await prisma.marketAssessment.findMany({where:{id:{in:result.assessment_ids as string[]}}});
    expect(plan).toMatchObject({source_mode:TradeSourceMode.authenticated,hs_code:f.payload.hs6,candidate_reporters:['276']});expect(manifest.evaluation_state).toBe('metric_ready');expect(metrics).toHaveLength(1);expect(run).toMatchObject({job_id:f.job.id,product_id:f.product.id,status:'completed'});expect(assessments).toHaveLength(1);expect(assessments[0]).toMatchObject({model_version:'market-attractiveness-v4',country_trade_metrics_id:metrics[0].id,country_evidence_manifest_id:manifest.id});
    expect(await prisma.job.findUniqueOrThrow({where:{id:f.job.id}})).toMatchObject({progress_stage:'completed',progress:100,checkpoint:expect.objectContaining({country_evidence_plan_id:plan.id,country_evidence_manifest_id:manifest.id,discovery_run_id:run.id})});
    expect(await prisma.job.count({where:{type:JobType.demand_discovery,exporter_org_id:f.org.id}})).toBe(0);
  });

  test('reuses cached evidence, manifest, metrics, run and assessments on duplicate invocation',async()=>{
    const f=await fixture(),provider=authenticatedClient();setComtradeClient(provider.client);const first=await runCountryTruthDiscovery(context(f)),calls=provider.calls.mock.calls.length,second=await runCountryTruthDiscovery({...context(f),attempt_no:2});
    expect(first.result).toMatchObject({physical_calls:11});expect(second.result).toMatchObject({physical_calls:0});expect(provider.calls).toHaveBeenCalledTimes(calls);
    const a=first.result as Record<string,unknown>,b=second.result as Record<string,unknown>;expect(b.discovery_run_id).toBe(a.discovery_run_id);expect(b.country_evidence_manifest_id).toBe(a.country_evidence_manifest_id);expect(b.country_trade_metrics_ids).toEqual(a.country_trade_metrics_ids);expect(b.assessment_ids).toEqual(a.assessment_ids);
  });

  test('persists a partial provider attempt and resumes only unresolved evidence on retry',async()=>{
    const f=await fixture(),provider=authenticatedClient({failOnce:params=>params.partner==='699'&&params.year===2023});setComtradeClient(provider.client);
    await expect(runCountryTruthDiscovery(context(f))).rejects.toThrow(/unresolved/);expect(provider.calls).toHaveBeenCalledTimes(11);
    const checkpoint=(await prisma.job.findUniqueOrThrow({where:{id:f.job.id}})).checkpoint as {country_evidence_plan_id?:string};expect(checkpoint.country_evidence_plan_id).toBeTruthy();expect(await prisma.normalizedTradeObservation.groupBy({by:['source_evidence_id'],where:{source_origin:EvidenceOrigin.authenticated_real,reporter_code:'276',hs_code:f.payload.hs6}}).then(rows=>rows.length)).toBe(10);
    const resumed=await runCountryTruthDiscovery({...context(f),attempt_no:2});expect(resumed.status).toBe('completed');expect(provider.calls).toHaveBeenCalledTimes(12);expect(await prisma.countryEvidencePlan.count({where:{product_classification_id:f.classification.id,source_mode:TradeSourceMode.authenticated}})).toBe(1);
  });

  test('quota exhaustion performs no provider call and retains the plan checkpoint for retry',async()=>{
    const f=await fixture(),credential=`quota-${randomUUID()}`,provider=authenticatedClient({credential});setComtradeClient(provider.client);await reserveProviderQuota({provider:'un_comtrade',credential_fingerprint:credential,configured_limit:450,request_count:450});
    await expect(runCountryTruthDiscovery(context(f))).rejects.toThrow(/deferred_quota/);expect(provider.calls).not.toHaveBeenCalled();expect(await prisma.job.findUniqueOrThrow({where:{id:f.job.id}})).toMatchObject({progress_stage:'acquiring_evidence',checkpoint:expect.objectContaining({country_evidence_plan_id:expect.any(String)})});
  });

  test('authenticated execution rejects fixture cache and fetches its own evidence',async()=>{
    const f=await fixture(),fixtureProvider=authenticatedClient();setComtradeClient({...fixtureProvider.client,identity:{...fixtureProvider.client.identity,mode:'fixture',authenticated:false,credential_fingerprint:`fixture-${randomUUID()}`,source_dataset:'fixture-country-truth'}});
    const fixturePlan=await createCountryEvidencePlan({product_classification_id:f.classification.id,as_of_date:new Date(f.payload.requested_at),candidate_reporters:['276'],source_mode:TradeSourceMode.fixture});await executeCountryEvidencePlan(fixturePlan.id);
    const provider=authenticatedClient();setComtradeClient(provider.client);const outcome=await runCountryTruthDiscovery(context(f));expect(outcome.status).toBe('completed');expect(provider.calls).toHaveBeenCalledTimes(11);expect(await prisma.countryEvidencePlan.count({where:{product_classification_id:f.classification.id}})).toBe(2);
  });

  test('complete provider responses with missing India remain partial rather than fabricated or retried',async()=>{
    const f=await fixture(),provider=authenticatedClient({missingIndia:true});setComtradeClient(provider.client);const outcome=await runCountryTruthDiscovery(context(f)),result=outcome.result as Record<string,unknown>;
    expect(outcome.status).toBe('partial');expect(result.evidence_status).toBe('partial');const assessments=await prisma.marketAssessment.findMany({where:{run_id:String(result.discovery_run_id)}});expect(assessments).toHaveLength(1);expect(assessments[0].model_version).toBe('market-attractiveness-v4');
  });

  test('a frozen policy hash mismatch fails closed before provider access',async()=>{
    const f=await fixture(),provider=authenticatedClient();setComtradeClient(provider.client);const payload=structuredClone(f.job.payload) as unknown as {policies:{country_evidence:{policy_hash:string}}};payload.policies.country_evidence.policy_hash='tampered';await prisma.job.update({where:{id:f.job.id},data:{payload:payload as unknown as Prisma.InputJsonValue}});
    await expect(runCountryTruthDiscovery({...context(f),payload})).rejects.toThrow(/policy identity/);expect(provider.calls).not.toHaveBeenCalled();
  });
});
