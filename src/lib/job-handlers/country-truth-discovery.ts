import { JobStatus,JobType,ProductClassificationStatus,TradeSourceMode,UserRole,type Prisma } from '@prisma/client';
import { z } from 'zod';
import { createCountryEvidencePlan,executeCountryEvidencePlan } from '@/lib/country-evidence/service';
import { canonicalHash } from '@/lib/country-evidence/planner';
import { calculateAndPersistCountryTradeMetrics } from '@/lib/country-trade-metrics/service';
import { getConfigWithVersion } from '@/lib/config';
import { toIso2 } from '@/lib/comtrade/areas';
import { createCountryTruthV4Assessments } from '@/lib/discovery/country-truth-v4-service';
import type { JobContext,JobOutcome } from '@/lib/jobs';
import { updateJobStage } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { requireCountryTruthClassification } from '@/lib/product-classification';

const policyIdentitySchema=z.object({config_version:z.number().int().positive(),policy_hash:z.string().min(1)});
const payloadSchema=z.object({
  schema_version:z.literal('country-truth-discovery-job-v1'),
  exporter_org_id:z.string().min(1),product_id:z.string().min(1),product_classification_id:z.string().min(1),
  hs6:z.string().regex(/^\d{6}$/),hs_revision:z.enum(['2022','HS2022']),
  candidates:z.array(z.object({country_code:z.string().length(2),country_name:z.string().min(1),reporter_code:z.string().regex(/^\d{1,3}$/)})).min(1),
  requested_by_agent_id:z.string().min(1),requested_at:z.string().datetime(),
  policies:z.object({
    country_evidence:policyIdentitySchema.extend({policy_version:z.string().min(1)}),
    country_trade_metrics:policyIdentitySchema.extend({policy_version:z.string().min(1),calculation_version:z.string().min(1)}),
    country_truth_scoring:policyIdentitySchema.extend({model_version:z.literal('market-attractiveness-v4'),formula_version:z.string().min(1)}),
  }),
});

type Payload=z.infer<typeof payloadSchema>;
type Checkpoint={schema_version:'country-truth-discovery-checkpoint-v1';country_evidence_plan_id?:string;country_evidence_manifest_id?:string;country_trade_metrics_ids?:string[];discovery_run_id?:string;assessment_ids?:string[]};
const json=(value:unknown)=>value as Prisma.InputJsonValue;
const hashPolicy=(value:object,version:number)=>canonicalHash(Object.assign({},value,{config_version:version}));

async function validatePolicyIdentities(payload:Payload){
  const [evidence,metrics,scoring]=await Promise.all([getConfigWithVersion('country_evidence.policy'),getConfigWithVersion('country_trade_metrics.policy'),getConfigWithVersion('country_truth.scoring_v4')]);
  const checks=[
    ['Country Evidence',payload.policies.country_evidence.config_version===evidence.version&&payload.policies.country_evidence.policy_version===evidence.value.policy_version&&payload.policies.country_evidence.policy_hash===canonicalHash(evidence.value)],
    ['CountryTradeMetrics',payload.policies.country_trade_metrics.config_version===metrics.version&&payload.policies.country_trade_metrics.policy_version===metrics.value.policy_version&&payload.policies.country_trade_metrics.calculation_version===metrics.value.calculation_version&&payload.policies.country_trade_metrics.policy_hash===hashPolicy(metrics.value,metrics.version)],
    ['Country Truth scoring',payload.policies.country_truth_scoring.config_version===scoring.version&&payload.policies.country_truth_scoring.model_version===scoring.value.model_version&&payload.policies.country_truth_scoring.formula_version===scoring.value.formula_version&&payload.policies.country_truth_scoring.policy_hash===hashPolicy(scoring.value,scoring.version)],
  ] as const;
  const mismatch=checks.find(([,valid])=>!valid);if(mismatch)throw new Error(`${mismatch[0]} policy identity no longer matches the frozen job payload.`);
}

async function validateFrozenIdentity(ctx:JobContext,payload:Payload){
  const job=await prisma.job.findUnique({where:{id:ctx.job_id},select:{type:true,exporter_org_id:true,requested_by_id:true,target_type:true,target_id:true,checkpoint:true}});
  if(!job||job.type!==JobType.country_truth_discovery||job.exporter_org_id!==payload.exporter_org_id||ctx.exporter_org_id!==payload.exporter_org_id||job.requested_by_id!==payload.requested_by_agent_id||job.target_type!=='product_classification'||job.target_id!==payload.product_classification_id||ctx.target_id!==payload.product_classification_id)throw new Error('Country Truth job identity does not match its frozen payload.');
  const actor=await prisma.user.findUnique({where:{id:payload.requested_by_agent_id},select:{role:true}});if(!actor||![UserRole.agent,UserRole.ops_supervisor,UserRole.admin].includes(actor.role as 'agent'|'ops_supervisor'|'admin'))throw new Error('Country Truth requesting actor is no longer a permitted staff principal.');
  const org=await prisma.exporterOrg.findUnique({where:{id:payload.exporter_org_id},select:{id:true}});if(!org)throw new Error('Country Truth exporter no longer exists.');
  const product=await prisma.product.findFirst({where:{id:payload.product_id,exporter_org_id:payload.exporter_org_id},select:{id:true,exporter_org_id:true,hs_classification_revision:true,hs_classification_status:true,price_target_amount:true,price_target_currency:true,price_target_quantity_unit:true,price_target_incoterm:true}});if(!product)throw new Error('Country Truth product no longer belongs to the frozen exporter.');
  const classification=await requireCountryTruthClassification(payload.product_classification_id);
  if(classification.product_id!==product.id||classification.hs6_code!==payload.hs6||classification.nomenclature_version!==payload.hs_revision||classification.status!==ProductClassificationStatus.confirmed||classification.revision!==product.hs_classification_revision)throw new Error('Country Truth classification no longer matches the frozen job identity.');
  const reporters=new Set<string>();for(const candidate of payload.candidates){if(reporters.has(candidate.reporter_code)||toIso2(candidate.reporter_code)!==candidate.country_code.toUpperCase())throw new Error('Country Truth candidate reporter identity is invalid or duplicated.');reporters.add(candidate.reporter_code);}
  await validatePolicyIdentities(payload);
  return {product,checkpoint:((job.checkpoint??{schema_version:'country-truth-discovery-checkpoint-v1'}) as unknown) as Checkpoint};
}

export async function runCountryTruthDiscovery(ctx:JobContext):Promise<JobOutcome>{
  const parsed=payloadSchema.safeParse(ctx.payload);if(!parsed.success)throw new Error(`Invalid country_truth_discovery payload: ${parsed.error.issues.map(issue=>issue.path.join('.')).join(', ')}`);
  const payload=parsed.data,{product,checkpoint:stored}=await validateFrozenIdentity(ctx,payload),checkpoint:Checkpoint={...stored,schema_version:'country-truth-discovery-checkpoint-v1'};
  const stage=async(name:string,progress:number,patch:Partial<Checkpoint>={})=>{Object.assign(checkpoint,patch);if(ctx.reportStage)await ctx.reportStage(name,progress,json(checkpoint));else await updateJobStage(ctx.job_id,name,progress,json(checkpoint));};
  await stage('planning',5);
  const scoringClock=new Date(payload.requested_at);if(Number.isNaN(scoringClock.getTime()))throw new Error('Country Truth requested timestamp is invalid.');
  const plan=await createCountryEvidencePlan({product_classification_id:payload.product_classification_id,as_of_date:scoringClock,candidate_reporters:payload.candidates.map(candidate=>candidate.reporter_code),source_mode:TradeSourceMode.authenticated});
  if(plan.product_classification_id!==payload.product_classification_id||plan.hs_code!==payload.hs6||plan.hs_revision!==payload.hs_revision||plan.policy_version!==payload.policies.country_evidence.policy_version||plan.policy_hash!==payload.policies.country_evidence.policy_hash||JSON.stringify([...plan.candidate_reporters].sort())!==JSON.stringify(payload.candidates.map(candidate=>candidate.reporter_code).sort()))throw new Error('Resolved Country Evidence plan does not match the frozen job identity.');
  await stage('acquiring_evidence',20,{country_evidence_plan_id:plan.id});
  const acquisition=await executeCountryEvidencePlan(plan.id);
  if(!acquisition.manifest){await stage('acquiring_evidence',20);throw new Error(`Country Truth evidence acquisition is ${acquisition.status}; retry from persisted plan ${plan.id}.`);}
  await stage('building_manifest',55,{country_evidence_manifest_id:acquisition.manifest.id});
  const unresolved=await prisma.countryEvidencePlanItem.count({where:{plan_id:plan.id,resolution_state:{in:['fetch_required','fetching','failed','incompatible']}}});
  if(unresolved>0)throw new Error(`Country Truth evidence acquisition left ${unresolved} provider request(s) unresolved; retry will reuse completed evidence.`);
  await stage('calculating_metrics',70);
  const metrics=await calculateAndPersistCountryTradeMetrics(acquisition.manifest.id);
  if(metrics.length!==payload.candidates.length||metrics.some(metric=>metric.metric_policy_version!==payload.policies.country_trade_metrics.policy_version||metric.calculation_version!==payload.policies.country_trade_metrics.calculation_version||metric.metric_policy_hash!==payload.policies.country_trade_metrics.policy_hash))throw new Error('CountryTradeMetrics identities do not match the frozen job payload.');
  const metricIds=metrics.map(metric=>metric.id).sort();await stage('scoring',85,{country_trade_metrics_ids:metricIds});
  let run=checkpoint.discovery_run_id?await prisma.discoveryRun.findUnique({where:{id:checkpoint.discovery_run_id}}):await prisma.discoveryRun.findFirst({where:{job_id:ctx.job_id}});
  if(run&&(run.exporter_org_id!==payload.exporter_org_id||run.product_id!==payload.product_id))throw new Error('Checkpointed DiscoveryRun does not match the frozen Country Truth job.');
  if(!run)run=await prisma.discoveryRun.create({data:{exporter_org_id:payload.exporter_org_id,product_id:payload.product_id,job_id:ctx.job_id,requested_by_id:payload.requested_by_agent_id,status:JobStatus.processing,started_at:new Date(),as_of_date:scoringClock,filters:{candidate_countries:payload.candidates.map(candidate=>candidate.country_code)},input_snapshot:{schema_version:'country-truth-discovery-run-v1',job_payload:payload,country_evidence_plan_id:plan.id,country_evidence_manifest_id:acquisition.manifest.id,country_trade_metrics_ids:metricIds}}});
  await stage('scoring',90,{discovery_run_id:run.id});
  let assessments=await prisma.marketAssessment.findMany({where:{run_id:run.id},orderBy:{country_code:'asc'}});
  if(assessments.length){const assessmentMetricIds=assessments.map(item=>item.country_trade_metrics_id).filter((id):id is string=>Boolean(id)).sort();if(assessments.length!==metricIds.length||JSON.stringify(assessmentMetricIds)!==JSON.stringify(metricIds)||assessments.some(item=>item.model_version!=='market-attractiveness-v4'))throw new Error('Checkpointed Country Truth assessments are incomplete or incompatible.');}
  else assessments=await createCountryTruthV4Assessments({run_id:run.id,country_trade_metrics_ids:metricIds,source_mode:TradeSourceMode.authenticated,scoring_clock:scoringClock,contexts:Object.fromEntries(payload.candidates.map(candidate=>[candidate.reporter_code,{exporter_snapshot:{exporter_org_id:payload.exporter_org_id,product_id:payload.product_id,classification_id:payload.product_classification_id,price_target_amount:product.price_target_amount?.toString()??null,price_target_currency:product.price_target_currency,price_target_quantity_unit:product.price_target_quantity_unit,price_target_incoterm:product.price_target_incoterm}}]))});
  const assessmentIds=assessments.map(item=>item.id).sort(),partial=acquisition.status!=='metric_ready'||assessments.some(item=>item.country_truth_assessment_state!=='rankable');
  await prisma.discoveryRun.update({where:{id:run.id},data:{status:partial?JobStatus.partial:JobStatus.completed,completed_at:new Date()}});
  await stage('completed',100,{assessment_ids:assessmentIds});
  return {status:partial?JobStatus.partial:JobStatus.completed,result:json({schema_version:'country-truth-discovery-result-v1',stage:'completed',country_evidence_plan_id:plan.id,country_evidence_manifest_id:acquisition.manifest.id,country_trade_metrics_ids:metricIds,discovery_run_id:run.id,assessment_ids:assessmentIds,evidence_status:acquisition.status,physical_calls:acquisition.physical_calls})};
}

export const __test__={payloadSchema,validatePolicyIdentities};
