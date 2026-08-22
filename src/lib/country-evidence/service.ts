import { Prisma, TradeSourceMode } from '@prisma/client';
import { getComtradeClient } from '@/lib/comtrade';
import { canonicalComtradeRequest, comtradeRequestFingerprint } from '@/lib/comtrade/request';
import { getConfig, getConfigWithVersion } from '@/lib/config';
import { isRealWorkflowEnvironment, tradeSourceModeToEvidenceOrigin } from '@/lib/evidence-environment';
import { runComtradeIngest } from '@/lib/job-handlers/comtrade';
import { prisma } from '@/lib/prisma';
import { requireCountryTruthClassification } from '@/lib/product-classification';
import { providerDailyWindow } from '@/lib/provider-quota';
import { buildCountryEvidencePlan, canonicalHash, type CountryEvidencePlanInput } from './planner';

const JSON = (value: unknown) => value as Prisma.InputJsonValue;

function requestFor(item: { reporter_code:string;partner_code:string;period:number;hs_code:string;hs_revision:string;flow_direction:string;frequency:string;customs_code:string;mode_of_supply:string }, sourceMode: string) {
  return canonicalComtradeRequest({provider:'un_comtrade',dataset:'goods-trade',source_mode:sourceMode as CountryEvidencePlanInput['source_mode'],purpose:'country_truth',reporter_code:item.reporter_code,partner_code:item.partner_code,partner2_code:'0',flow_direction:'import',frequency:'A',period:String(item.period),hs_codes:[item.hs_code],hs_revision:item.hs_revision,customs_code:item.customs_code,mode_of_supply:item.mode_of_supply});
}

export async function createCountryEvidencePlan(input: Omit<CountryEvidencePlanInput, 'policy'|'policy_config_version'|'hs_code'|'hs_revision'>) {
  if(isRealWorkflowEnvironment()&&input.source_mode!==TradeSourceMode.authenticated)throw new Error('Staging/production Country Evidence plans require authenticated source mode.');
  const classification = await requireCountryTruthClassification(input.product_classification_id);
  const configured = await getConfigWithVersion('country_evidence.policy');
  const built = buildCountryEvidencePlan({...input,hs_code:classification.hs6_code,hs_revision:classification.nomenclature_version,policy:configured.value,policy_config_version:configured.version});
  const existing = await prisma.countryEvidencePlan.findUnique({where:{plan_key:built.plan_key},include:{items:true,manifests:true}});
  if (existing) return existing;
  return prisma.countryEvidencePlan.create({
    data:{plan_key:built.plan_key,product_classification_id:input.product_classification_id,hs_code:classification.hs6_code,hs_revision:classification.nomenclature_version,as_of_date:input.as_of_date,candidate_reporters:built.candidate_reporters,source_mode:input.source_mode as TradeSourceMode,policy_version:configured.value.policy_version,policy_hash:built.policy_hash,policy_snapshot:JSON({...configured.value,config_version:configured.version,frozen_definition:built.frozen_definition}),period_set:built.period_set,latest_common_year:built.latest_common_year,requested_history_years:configured.value.history_years,actual_history_years:built.actual_history_years,candidate_strategy:configured.value.candidate_strategy,estimated_call_cost:built.items.length,allow_partial_execution:configured.value.allow_partial_execution,items:{create:built.items.map(item=>({...item,flow_direction:'import',frequency:'A',hs_code:classification.hs6_code,hs_revision:classification.nomenclature_version,customs_code:'C00',mode_of_supply:'0'}))}},
    include:{items:{orderBy:[{priority:'asc'},{reporter_code:'asc'},{period:'desc'}]},manifests:true},
  });
}

async function resolveItem(item: Awaited<ReturnType<typeof prisma.countryEvidencePlanItem.findFirstOrThrow>>, sourceMode: TradeSourceMode) {
  const request = requestFor(item, sourceMode);
  const evidence = await prisma.sourceEvidence.findMany({
    where:{request_fingerprint:comtradeRequestFingerprint(request),source_origin:tradeSourceModeToEvidenceOrigin(sourceMode),parser_version:'comtrade-parser-v2',status:{in:['accepted','partial']}},
    include:{observations:true},orderBy:{retrieved_at:'desc'},take:5,
  });
  const cutoff = new Date(Date.now() - item.freshness_days * 86_400_000);
  const candidate = evidence.find(row => row.completeness === 'COMPLETE' && row.status === 'accepted');
  if (!candidate) {
    if(evidence.length)return {state:'partial',evidence:null,metadata:{reason:'no_complete_response'}};
    const incompatible=await prisma.normalizedTradeObservation.findFirst({where:{source_origin:tradeSourceModeToEvidenceOrigin(sourceMode),reporter_code:item.reporter_code,hs_code:item.hs_code,ref_year:item.period,flow_direction:'import',...(item.partner_scope==='all_suppliers'?{}:{partner_code:item.partner_code}),NOT:{hs_revision:item.hs_revision}},select:{id:true,hs_revision:true,source_evidence_id:true}});
    return incompatible?{state:'incompatible',evidence:null,metadata:{reason:'hs_revision_mismatch',found_revision:incompatible.hs_revision,observation_id:incompatible.id,source_evidence_id:incompatible.source_evidence_id}}:{state:'fetch_required',evidence:null,metadata:{reason:'no_matching_evidence'}};
  }
  if (candidate.retrieved_at < cutoff) return {state:'fetch_required',evidence:null,metadata:{reason:'stale',stale_evidence_id:candidate.id,retrieved_at:candidate.retrieved_at.toISOString()}};
  const observations = candidate.observations.filter(row=>row.reporter_code===item.reporter_code&&row.hs_code===item.hs_code&&row.ref_year===item.period&&row.flow_direction==='import'&&row.hs_revision===item.hs_revision);
  if (item.partner_scope !== 'all_suppliers') {
    const cell = observations.find(row=>row.partner_code===item.partner_code);
    if (!cell) return {state:'missing',evidence:candidate,metadata:{reason:'complete_response_has_no_explicit_partner_row',absence_is_not_zero:true,observation_ids:[]}};
    if (cell.trade_value_status === 'suppressed') return {state:'suppressed',evidence:candidate,metadata:{observation_ids:[cell.id]}};
    if (!['observed','observed_zero'].includes(cell.trade_value_status)) return {state:'missing',evidence:candidate,metadata:{reason:cell.trade_value_status,observation_ids:[cell.id]}};
    return {state:'reusable',evidence:candidate,metadata:{cell_state:cell.trade_value_status,observation_ids:[cell.id]}};
  }
  const suppliers = observations.filter(row=>!row.partner_is_world&&['observed','observed_zero'].includes(row.trade_value_status));
  const bad = observations.filter(row=>row.trade_value_status==='suppressed'||row.trade_value_status==='invalid'||row.trade_value_status==='missing');
  if (!suppliers.length) return {state:bad.length?'suppressed':'missing',evidence:candidate,metadata:{reason:'no_complete_supplier_distribution',observation_ids:observations.map(row=>row.id)}};
  return {state:bad.length?'partial':'reusable',evidence:candidate,metadata:{cell_state:bad.length?'supplier_rows_incomplete':'observed',observation_ids:observations.map(row=>row.id),supplier_count:suppliers.length}};
}

export async function resolveCountryEvidencePlan(planId:string) {
  const plan=await prisma.countryEvidencePlan.findUniqueOrThrow({where:{id:planId},include:{items:{orderBy:[{priority:'asc'},{reporter_code:'asc'},{period:'desc'}]}}});
  for(const item of plan.items){
    const resolved=await resolveItem(item,plan.source_mode);
    await prisma.countryEvidencePlanItem.update({where:{id:item.id},data:{resolution_state:resolved.state,source_evidence_id:resolved.evidence?.id??null,resolution_metadata:JSON(resolved.metadata),error:null}});
  }
  return prisma.countryEvidencePlan.findUniqueOrThrow({where:{id:planId},include:{items:{orderBy:[{priority:'asc'},{reporter_code:'asc'},{period:'desc'}]},manifests:true}});
}

async function availableQuota(sourceMode:TradeSourceMode) {
  if (sourceMode === TradeSourceMode.fixture || sourceMode === TradeSourceMode.mock) return Number.MAX_SAFE_INTEGER;
  const comtrade=await getConfig('comtrade.policy'),identity=getComtradeClient(comtrade).identity;
  if (sourceMode !== TradeSourceMode.authenticated || identity.mode !== 'authenticated') return 0;
  const {window_start}=providerDailyWindow();
  const row=await prisma.providerQuotaWindow.findUnique({where:{provider_credential_fingerprint_window_start:{provider:identity.provider,credential_fingerprint:identity.credential_fingerprint,window_start}}});
  const local=(comtrade.daily_request_budget??450)-(row?.requests_reserved??0);
  const provider=row?.provider_reported_remaining??Number.MAX_SAFE_INTEGER;
  return Math.max(0,Math.min(local,provider));
}

export async function executeCountryEvidencePlan(planId:string, options:{allow_partial_execution?:boolean}={}) {
  let plan=await resolveCountryEvidencePlan(planId);
  const required=plan.items.filter(item=>['fetch_required','failed','incompatible'].includes(item.resolution_state)||(item.resolution_state==='partial'&&!item.source_evidence_id));
  const allowance=await availableQuota(plan.source_mode);
  const partial=options.allow_partial_execution??plan.allow_partial_execution;
  if(required.length>allowance&&!partial){
    await prisma.countryEvidencePlan.update({where:{id:plan.id},data:{status:'deferred_quota'}});
    return {plan_id:plan.id,status:'deferred_quota',estimated_calls:required.length,available_calls:allowance,physical_calls:0,manifest:null};
  }
  await prisma.countryEvidencePlan.update({where:{id:plan.id},data:{status:'executing'}});
  let physicalCalls=0;
  for(const item of required.slice(0,partial?allowance:required.length)){
    await prisma.countryEvidencePlanItem.update({where:{id:item.id},data:{resolution_state:'fetching',attempts:{increment:1},last_attempted_at:new Date(),error:null}});
    const outcome=await runComtradeIngest({job_id:`country-evidence:${item.id}`,attempt_no:item.attempts+1,payload:{hs_chapter:item.hs_code.slice(0,2),hs_codes:[item.hs_code],reporter:item.reporter_code,partner:item.partner_code,year:item.period,flow_direction:'import',hs_revision:item.hs_revision,frequency:'A',partner2:'0',customs_code:item.customs_code,mode_of_supply:item.mode_of_supply,purpose:'country_truth'},exporter_org_id:null,target_id:plan.id,correlation_id:`country-evidence:${plan.id}`,reportProgress:async()=>undefined});
    const result=outcome.result as Record<string,unknown>;
    const ingestId=typeof result.ingest_run_id==='string'?result.ingest_run_id:null;
    if(ingestId){const run=await prisma.ingestRun.findUnique({where:{id:ingestId},select:{request_count:true}});physicalCalls+=run?.request_count??0;}
    if(outcome.status==='failed')await prisma.countryEvidencePlanItem.update({where:{id:item.id},data:{resolution_state:'failed',error:String(result.error??'Provider acquisition failed.').slice(0,1000)}});
  }
  plan=await resolveCountryEvidencePlan(plan.id);
  const manifest=await createCountryEvidenceManifest(plan.id);
  await prisma.countryEvidencePlan.update({where:{id:plan.id},data:{status:manifest.evaluation_state==='metric_ready'?'complete':manifest.evaluation_state==='partial'?'partial':'failed'}});
  return {plan_id:plan.id,status:manifest.evaluation_state,estimated_calls:required.length,available_calls:allowance,physical_calls:physicalCalls,manifest};
}

export async function createCountryEvidenceManifest(planId:string) {
  const plan=await prisma.countryEvidencePlan.findUniqueOrThrow({where:{id:planId},include:{items:{orderBy:[{priority:'asc'},{reporter_code:'asc'},{period:'desc'}],include:{source_evidence:{include:{observations:true}}}}}});
  const policy=plan.policy_snapshot as unknown as {supplier_coverage_min_ratio:number;supplier_coverage_max_ratio:number};
  const references=plan.items.filter(item=>item.source_evidence).map(item=>{
    const ids=((item.resolution_metadata as {observation_ids?:string[]}|null)?.observation_ids??[]).sort();
    return {plan_item_key:item.item_key,purpose:item.purpose,reporter_code:item.reporter_code,period:item.period,source_evidence_id:item.source_evidence_id!,observation_ids:ids,cell_state:item.resolution_state,freshness_state:item.resolution_state==='fetch_required'?'stale':'fresh',evidence_completeness:item.source_evidence!.completeness,evidence_retrieved_at:item.source_evidence!.retrieved_at};
  });
  const coverageFailures:string[]=[];
  for(const supplier of plan.items.filter(item=>item.partner_scope==='all_suppliers'&&item.source_evidence)){
    const world=plan.items.find(item=>item.reporter_code===supplier.reporter_code&&item.period===supplier.period&&item.partner_scope==='world');
    const supplierRows=supplier.source_evidence!.observations.filter(row=>!row.partner_is_world&&row.trade_value!=null&&['observed','observed_zero'].includes(row.trade_value_status));
    const worldRow=world?.source_evidence?.observations.find(row=>row.partner_is_world&&row.hs_code===plan.hs_code&&row.ref_year===supplier.period);
    if(!worldRow?.trade_value||Number(worldRow.trade_value)<=0){coverageFailures.push(`${supplier.reporter_code}:missing_world_denominator`);continue;}
    const ratio=supplierRows.reduce((sum,row)=>sum+Number(row.trade_value),0)/Number(worldRow.trade_value);
    if(ratio<policy.supplier_coverage_min_ratio||ratio>policy.supplier_coverage_max_ratio)coverageFailures.push(`${supplier.reporter_code}:supplier_coverage_${ratio.toFixed(6)}`);
  }
  const allReusable=plan.items.every(item=>item.resolution_state==='reusable');
  const anyUsable=plan.items.some(item=>item.resolution_state==='reusable');
  const evaluationState=allReusable&&coverageFailures.length===0?'metric_ready':anyUsable?'partial':'not_evaluable';
  const payload={schema_version:'country-evidence-manifest-v1',plan_key:plan.plan_key,hs_code:plan.hs_code,hs_revision:plan.hs_revision,as_of_date:plan.as_of_date.toISOString(),period_set:plan.period_set,latest_common_year:plan.latest_common_year,source_mode:plan.source_mode,policy_version:plan.policy_version,policy_hash:plan.policy_hash,evaluation_state:evaluationState,coverage_failures:coverageFailures,references};
  const checksum=canonicalHash(payload),existing=await prisma.countryEvidenceManifest.findUnique({where:{checksum},include:{references:true}});
  if(existing)return existing;
  return prisma.countryEvidenceManifest.create({data:{plan_id:plan.id,checksum,evaluation_state:evaluationState,policy_version:plan.policy_version,policy_hash:plan.policy_hash,policy_snapshot:JSON(plan.policy_snapshot),manifest_payload:JSON(payload),references:{create:references}},include:{references:true}});
}
