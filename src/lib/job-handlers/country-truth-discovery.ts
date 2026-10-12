import { JobStatus,JobType,ProductClassificationStatus,TradeSourceMode,UserRole,type Prisma } from '@prisma/client';
import { z } from 'zod';
import { createCountryEvidencePlan,executeCountryEvidencePlan } from '@/lib/country-evidence/service';
import { canonicalHash } from '@/lib/country-evidence/planner';
import { calculateAndPersistCountryTradeMetrics,calculateIndiaOriginUnitValueSupplement } from '@/lib/country-trade-metrics/service';
import { marketAccessOrchestrationPolicyProblems,type CountryEvidencePolicy,type CountryTradeMetricPolicy,type CountryTruthMarketAccessOrchestrationPolicy,type CountryTruthPhase1HPolicy,type CountryTruthScoringV4Policy } from '@/lib/config';
import { importBenchmarkFromTradeMetrics,resolveCountryTruthFactSnapshot } from '@/lib/country-truth/fact-snapshot-service';
import { calculateCountryTruthPillars } from '@/lib/country-truth/pillars';
import { acquireTariffEvidence,tariffClockFor,type TariffAcquisitionOutcome } from '@/lib/country-truth/tariff-acquisition';
import { COUNTRY_TRUTH_EXPORTER_FACTS_SCHEMA_VERSION,countryTruthExporterFactSnapshotChecksum,type CountryTruthExporterFactSnapshot } from '@/lib/country-truth/exporter-fact-snapshot';
import { toIso2 } from '@/lib/comtrade/areas';
import { createCountryTruthV4Assessments,type CountryTruthV4Context } from '@/lib/discovery/country-truth-v4-service';
import type { JobContext,JobOutcome } from '@/lib/jobs';
import { updateJobStage } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { requireCountryTruthClassification } from '@/lib/product-classification';

const policyIdentitySchema=z.object({config_version:z.number().int().positive(),policy_hash:z.string().min(1)});
const payloadSchema=z.object({
  schema_version:z.literal('country-truth-discovery-job-v3'),
  exporter_org_id:z.string().min(1),product_id:z.string().min(1),product_classification_id:z.string().min(1),
  hs6:z.string().regex(/^\d{6}$/),hs_revision:z.enum(['2022','HS2022']),
  candidates:z.array(z.object({country_code:z.string().length(2),country_name:z.string().min(1),reporter_code:z.string().regex(/^\d{1,3}$/)})).min(1),
  requested_by_agent_id:z.string().min(1),requested_at:z.string().datetime(),
  exporter_fact_snapshot:z.object({schema_version:z.literal(COUNTRY_TRUTH_EXPORTER_FACTS_SCHEMA_VERSION),captured_at:z.string().datetime(),identity:z.object({exporter_org_id:z.string().min(1),product_id:z.string().min(1),product_classification_id:z.string().min(1),classification_revision:z.number().int().positive(),hs6:z.string().regex(/^\d{6}$/),hs_revision:z.string().min(1)})}).passthrough(),
  exporter_fact_snapshot_checksum:z.string().regex(/^[a-f0-9]{64}$/),
  /** Phase 1G: each candidate's own consecutive analysis window, from Stage A period selection. */
  reporter_period_windows:z.record(z.string(),z.array(z.number().int()).min(1)).optional(),
  preferred_period:z.number().int().optional(),
  /**
   * Frozen Stage-A identity, present when the request came from a completed global screen.
   * Optional so historical `country-truth-discovery-job-v3` payloads still validate and replay.
   */
  provenance:z.object({
    screening_run_id:z.string().min(1),
    screening_run_key:z.string().min(1),
    screening_policy_version:z.string().min(1),
    screening_policy_hash:z.string().min(1),
    shortlist_size:z.number().int().positive(),
    shortlist_reporters:z.array(z.string().regex(/^[0-9]{1,3}$/)).min(1),
    country_evidence_plan_id:z.string().min(1),
    country_evidence_plan_key:z.string().min(1),
  }).optional(),
  policies:z.object({
    country_evidence:policyIdentitySchema.extend({policy_version:z.string().min(1),snapshot:z.record(z.string(),z.unknown())}),
    country_trade_metrics:policyIdentitySchema.extend({policy_version:z.string().min(1),calculation_version:z.string().min(1),snapshot:z.record(z.string(),z.unknown())}),
    country_truth_scoring:policyIdentitySchema.extend({model_version:z.literal('market-attractiveness-v4'),formula_version:z.string().min(1),snapshot:z.record(z.string(),z.unknown())}),
    country_truth_phase_1h:policyIdentitySchema.extend({policy_version:z.string().min(1),calculation_version:z.string().min(1),snapshot:z.record(z.string(),z.unknown())}),
    /** WP2 (docs/35 E-004): present only when tariff acquisition was enabled at request time. */
    market_access_orchestration:policyIdentitySchema.extend({policy_version:z.string().min(1),snapshot:z.record(z.string(),z.unknown())}).optional(),
  }),
});

type Payload=z.infer<typeof payloadSchema>;
type Checkpoint={schema_version:'country-truth-discovery-checkpoint-v3';country_evidence_plan_id?:string;country_evidence_manifest_id?:string;country_trade_metrics_ids?:string[];country_truth_fact_snapshot_ids?:string[];discovery_run_id?:string;assessment_ids?:string[];
  /** WP2: retained releases are resolved at this frozen instant, so a retry resolves identically. */
  tariff_resolution_at?:string;
  /** WP2: one outcome per finished destination; a retry does not acquire these again. */
  tariff_acquisitions?:TariffAcquisitionOutcome[];
  /** WP2: the frozen tariff clock (D-004). Once set, acquisition is complete for this job. */
  tariff_as_of?:string};
const json=(value:unknown)=>value as Prisma.InputJsonValue;
const hashPolicy=(value:object,version:number)=>canonicalHash(Object.assign({},value,{config_version:version}));

async function validatePolicyIdentities(payload:Payload){
  const evidence=payload.policies.country_evidence.snapshot as unknown as CountryEvidencePolicy,metrics=payload.policies.country_trade_metrics.snapshot as unknown as CountryTradeMetricPolicy,scoring=payload.policies.country_truth_scoring.snapshot as unknown as CountryTruthScoringV4Policy,phase1h=payload.policies.country_truth_phase_1h.snapshot as unknown as CountryTruthPhase1HPolicy;
  const checks=[
    ['Country Evidence',payload.policies.country_evidence.policy_version===evidence.policy_version&&payload.policies.country_evidence.policy_hash===canonicalHash(evidence)],
    ['CountryTradeMetrics',payload.policies.country_trade_metrics.policy_version===metrics.policy_version&&payload.policies.country_trade_metrics.calculation_version===metrics.calculation_version&&payload.policies.country_trade_metrics.policy_hash===hashPolicy(metrics,payload.policies.country_trade_metrics.config_version)],
    ['Country Truth scoring',payload.policies.country_truth_scoring.model_version===scoring.model_version&&payload.policies.country_truth_scoring.formula_version===scoring.formula_version&&payload.policies.country_truth_scoring.policy_hash===hashPolicy(scoring,payload.policies.country_truth_scoring.config_version)],
    ['Country Truth Phase 1H',payload.policies.country_truth_phase_1h.policy_version===phase1h.policy_version&&payload.policies.country_truth_phase_1h.calculation_version===phase1h.calculation_version&&payload.policies.country_truth_phase_1h.policy_hash===hashPolicy(phase1h,payload.policies.country_truth_phase_1h.config_version)],
  ] as const;
  const mismatch=checks.find(([,valid])=>!valid);if(mismatch)throw new Error(`${mismatch[0]} policy identity no longer matches the frozen job payload.`);
  const orchestration=payload.policies.market_access_orchestration;
  if(orchestration){
    const snapshot=orchestration.snapshot as unknown as CountryTruthMarketAccessOrchestrationPolicy;
    if(orchestration.policy_version!==snapshot.policy_version||orchestration.policy_hash!==hashPolicy(snapshot,orchestration.config_version))throw new Error('Market access orchestration policy identity no longer matches the frozen job payload.');
    const problems=marketAccessOrchestrationPolicyProblems(snapshot);if(problems.length)throw new Error(`Frozen market access orchestration policy is invalid: ${problems.join(' ')}`);
  }
}

async function validateFrozenIdentity(ctx:JobContext,payload:Payload){
  const job=await prisma.job.findUnique({where:{id:ctx.job_id},select:{type:true,exporter_org_id:true,requested_by_id:true,target_type:true,target_id:true,checkpoint:true}});
  if(!job||job.type!==JobType.country_truth_discovery||job.exporter_org_id!==payload.exporter_org_id||ctx.exporter_org_id!==payload.exporter_org_id||job.requested_by_id!==payload.requested_by_agent_id||job.target_type!=='product_classification'||job.target_id!==payload.product_classification_id||ctx.target_id!==payload.product_classification_id)throw new Error('Country Truth job identity does not match its frozen payload.');
  const actor=await prisma.user.findUnique({where:{id:payload.requested_by_agent_id},select:{role:true}});if(!actor||![UserRole.agent,UserRole.ops_supervisor,UserRole.admin].includes(actor.role as 'agent'|'ops_supervisor'|'admin'))throw new Error('Country Truth requesting actor is no longer a permitted staff principal.');
  const org=await prisma.exporterOrg.findUnique({where:{id:payload.exporter_org_id},select:{id:true}});if(!org)throw new Error('Country Truth exporter no longer exists.');
  const product=await prisma.product.findFirst({where:{id:payload.product_id,exporter_org_id:payload.exporter_org_id},select:{id:true,exporter_org_id:true,hs_classification_revision:true,hs_classification_status:true}});if(!product)throw new Error('Country Truth product no longer belongs to the frozen exporter.');
  const classification=await requireCountryTruthClassification(payload.product_classification_id);
  if(classification.product_id!==product.id||classification.hs6_code!==payload.hs6||classification.nomenclature_version!==payload.hs_revision||classification.status!==ProductClassificationStatus.confirmed||classification.revision!==product.hs_classification_revision)throw new Error('Country Truth classification no longer matches the frozen job identity.');
  const reporters=new Set<string>();for(const candidate of payload.candidates){if(reporters.has(candidate.reporter_code)||toIso2(candidate.reporter_code)!==candidate.country_code.toUpperCase())throw new Error('Country Truth candidate reporter identity is invalid or duplicated.');reporters.add(candidate.reporter_code);}
  const frozen=payload.exporter_fact_snapshot as unknown as CountryTruthExporterFactSnapshot;
  if(countryTruthExporterFactSnapshotChecksum(frozen)!==payload.exporter_fact_snapshot_checksum)throw new Error('Country Truth exporter fact snapshot checksum does not match its frozen payload.');
  if(frozen.identity.exporter_org_id!==payload.exporter_org_id||frozen.identity.product_id!==payload.product_id||frozen.identity.product_classification_id!==payload.product_classification_id||frozen.identity.classification_revision!==classification.revision||frozen.identity.hs6!==payload.hs6||frozen.identity.hs_revision!==payload.hs_revision.toUpperCase())throw new Error('Country Truth exporter fact snapshot scope does not match the job identity.');
  await validatePolicyIdentities(payload);
  return {product,checkpoint:((job.checkpoint??{schema_version:'country-truth-discovery-checkpoint-v3'}) as unknown) as Checkpoint};
}

/** What the run records about its own tariff acquisition: both clocks' policy, every outcome, and a tally. */
function tariffAcquisitionRecord(policy:CountryTruthMarketAccessOrchestrationPolicy,policyHash:string,tariffClock:Date,outcomes:TariffAcquisitionOutcome[]){
  const counts:Record<string,number>={};for(const item of outcomes)counts[item.outcome]=(counts[item.outcome]??0)+1;
  return {schema_version:'country-truth-tariff-acquisition-v1',policy_version:policy.policy_version,policy_hash:policyHash,tariff_as_of:tariffClock.toISOString(),outcome_counts:counts,snapshot_ids:[...new Set(outcomes.flatMap(item=>item.snapshot_id?[item.snapshot_id]:[]))].sort(),outcomes};
}

export async function runCountryTruthDiscovery(ctx:JobContext):Promise<JobOutcome>{
  const parsed=payloadSchema.safeParse(ctx.payload);if(!parsed.success)throw new Error(`Invalid country_truth_discovery payload: ${parsed.error.issues.map(issue=>issue.path.join('.')).join(', ')}`);
  const payload=parsed.data,{checkpoint:stored}=await validateFrozenIdentity(ctx,payload),checkpoint:Checkpoint={...stored,schema_version:'country-truth-discovery-checkpoint-v3'};
  const stage=async(name:string,progress:number,patch:Partial<Checkpoint>={})=>{Object.assign(checkpoint,patch);if(ctx.reportStage)await ctx.reportStage(name,progress,json(checkpoint));else await updateJobStage(ctx.job_id,name,progress,json(checkpoint));};
  await stage('planning',5);
  const scoringClock=new Date(payload.requested_at);if(Number.isNaN(scoringClock.getTime()))throw new Error('Country Truth requested timestamp is invalid.');
  const plan=await createCountryEvidencePlan({product_classification_id:payload.product_classification_id,as_of_date:scoringClock,candidate_reporters:payload.candidates.map(candidate=>candidate.reporter_code),source_mode:TradeSourceMode.authenticated,reporter_period_windows:payload.reporter_period_windows,preferred_period:payload.preferred_period},{value:payload.policies.country_evidence.snapshot as unknown as CountryEvidencePolicy,version:payload.policies.country_evidence.config_version});
  if(plan.product_classification_id!==payload.product_classification_id||plan.hs_code!==payload.hs6||plan.hs_revision!==payload.hs_revision||plan.policy_version!==payload.policies.country_evidence.policy_version||plan.policy_hash!==payload.policies.country_evidence.policy_hash||JSON.stringify([...plan.candidate_reporters].sort())!==JSON.stringify(payload.candidates.map(candidate=>candidate.reporter_code).sort()))throw new Error('Resolved Country Evidence plan does not match the frozen job identity.');
  if(payload.provenance){
    // The screen a deep run came from must be answerable from the plan itself, not only from a
    // job payload that a later retention sweep may age out.
    if(payload.provenance.country_evidence_plan_key!==plan.plan_key)throw new Error('Resolved Country Evidence plan does not match the screening provenance frozen into the job.');
    if(JSON.stringify([...payload.provenance.shortlist_reporters].sort())!==JSON.stringify([...plan.candidate_reporters].sort()))throw new Error('Frozen shortlist reporters do not match the resolved deep plan.');
    if(plan.screening_run_id==null)await prisma.countryEvidencePlan.update({where:{id:plan.id},data:{screening_run_id:payload.provenance.screening_run_id}});
    else if(plan.screening_run_id!==payload.provenance.screening_run_id)throw new Error(`Country Evidence plan ${plan.id} belongs to screening run ${plan.screening_run_id}, not ${payload.provenance.screening_run_id}.`);
  }
  await stage('acquiring_evidence',20,{country_evidence_plan_id:plan.id});
  const acquisition=await executeCountryEvidencePlan(plan.id);
  if(!acquisition.manifest){await stage('acquiring_evidence',20);throw new Error(`Country Truth evidence acquisition is ${acquisition.status}; retry from persisted plan ${plan.id}.`);}
  await stage('building_manifest',55,{country_evidence_manifest_id:acquisition.manifest.id});
  // A RETRYABLE unresolved item still stops the job: a provider failure is our outage, and
  // baking it into a frozen partial result would lose work a retry could recover. Data the
  // provider confirmed it does not have resolves to `missing`, which was never in this list —
  // so a lagging reporter no longer blocks the run, and under per-reporter analysis windows it
  // is asked only for years it actually reported.
  const unresolved=await prisma.countryEvidencePlanItem.count({where:{plan_id:plan.id,resolution_state:{in:['fetch_required','fetching','failed','incompatible']}}});
  if(unresolved>0)throw new Error(`Country Truth evidence acquisition left ${unresolved} provider request(s) unresolved; retry will reuse completed evidence.`);
  await stage('calculating_metrics',70);
  const metrics=await calculateAndPersistCountryTradeMetrics(acquisition.manifest.id,{value:payload.policies.country_trade_metrics.snapshot as unknown as CountryTradeMetricPolicy,version:payload.policies.country_trade_metrics.config_version});
  if(metrics.length!==payload.candidates.length||metrics.some(metric=>metric.metric_policy_version!==payload.policies.country_trade_metrics.policy_version||metric.calculation_version!==payload.policies.country_trade_metrics.calculation_version||metric.metric_policy_hash!==payload.policies.country_trade_metrics.policy_hash))throw new Error('CountryTradeMetrics identities do not match the frozen job payload.');
  const metricIds=metrics.map(metric=>metric.id).sort();
  // WP2 (docs/35 E-004, D-004): acquire tariff evidence for this run's own shortlist, inline — the
  // single worker runs one job at a time, so waiting on child ingest jobs would deadlock it. The
  // resolution instant, every finished destination and the tariff clock are checkpointed, so a
  // retry neither re-acquires nor moves a clock.
  const orchestrationPolicy=payload.policies.market_access_orchestration?.snapshot as unknown as CountryTruthMarketAccessOrchestrationPolicy|undefined;
  let tariffClock:Date|null=null,tariffAcquisitions:TariffAcquisitionOutcome[]=[];
  if(orchestrationPolicy?.enabled){
    if(checkpoint.tariff_as_of&&checkpoint.tariff_acquisitions){tariffClock=new Date(checkpoint.tariff_as_of);tariffAcquisitions=checkpoint.tariff_acquisitions;}
    else{
      const resolutionAt=checkpoint.tariff_resolution_at?new Date(checkpoint.tariff_resolution_at):new Date();
      await stage('acquiring_tariffs',74,{country_trade_metrics_ids:metricIds,tariff_resolution_at:resolutionAt.toISOString()});
      tariffAcquisitions=await acquireTariffEvidence({job_id:ctx.job_id,hs6:payload.hs6,destinations:payload.candidates.map(candidate=>candidate.country_code),resolution_clock:resolutionAt,policy:orchestrationPolicy,completed:checkpoint.tariff_acquisitions??[],onOutcome:async outcomes=>{await stage('acquiring_tariffs',74,{tariff_acquisitions:outcomes});},correlation_id:ctx.correlation_id});
      tariffClock=tariffClockFor(scoringClock,tariffAcquisitions);
    }
    if(Number.isNaN(tariffClock.getTime())||tariffClock.getTime()<scoringClock.getTime())throw new Error('Checkpointed tariff clock is invalid or precedes the scoring clock.');
  }
  await stage('freezing_facts',78,{country_trade_metrics_ids:metricIds,...(tariffClock?{tariff_acquisitions:tariffAcquisitions,tariff_as_of:tariffClock.toISOString()}:{})});
  const phase1hPolicy={value:payload.policies.country_truth_phase_1h.snapshot as unknown as CountryTruthPhase1HPolicy,version:payload.policies.country_truth_phase_1h.config_version};
  const frozenExporterFacts=payload.exporter_fact_snapshot as unknown as CountryTruthExporterFactSnapshot;
  const shipment=frozenExporterFacts.commercial.standard_shipment;
  const frozenShipmentBasis={
    quantity:shipment?.quantity.state==='present'?Number(shipment.quantity.value):null,
    quantity_unit:shipment?.quantity_unit.state==='present'?shipment.quantity_unit.value:null,
    container_count:shipment?.container_count.state==='present'?shipment.container_count.value:null,
    container_type:shipment?.container_type.state==='present'?shipment.container_type.value:null,
  };
  // Computed from the same frozen manifest, but persisted only in the Phase 1H fact manifest.
  // Nothing here writes to CountryTradeMetrics, so no Phase 1G identity moves.
  const indiaUnitValues=new Map((await calculateIndiaOriginUnitValueSupplement(acquisition.manifest.id,payload.policies.country_trade_metrics.snapshot as unknown as CountryTradeMetricPolicy)).map(item=>[item.reporter_code,{supplemental_version:item.supplemental_version,value:item.result.value,unit:item.result.unit,status:item.result.status,periods_used:item.result.periods_used,calculation_method:item.result.calculation_method,exclusion_reason:item.result.exclusion_reason}]));
  // Facts are frozen and persisted BEFORE any score exists, so the manifest a score cites can
  // never have been written to fit it.
  const contexts:Record<string,CountryTruthV4Context>={};
  const factSnapshotIds:string[]=[];
  for(const record of [...metrics].sort((left,right)=>left.reporter_code.localeCompare(right.reporter_code))){
    const countryCode=record.country_code??toIso2(record.reporter_code);
    if(!countryCode)throw new Error(`Country Truth cannot resolve an ISO alpha-2 destination for reporter ${record.reporter_code}.`);
    const metricsPayload=record.metrics_payload as unknown as {metrics?:{unit_value?:{value:{median:number;basis:string}|null;status:string}}};
    const resolved=await resolveCountryTruthFactSnapshot({
      exporter_org_id:payload.exporter_org_id,
      product_id:payload.product_id,
      product_classification_id:payload.product_classification_id,
      country_trade_metrics_id:record.id,
      reporter_code:record.reporter_code,
      country_code:countryCode,
      hs6:payload.hs6,
      hs_revision:payload.hs_revision,
      as_of_date:record.as_of_date,
      ...(tariffClock?{tariff_as_of_date:tariffClock}:{}),
      exporter_snapshot:frozenExporterFacts,
      exporter_snapshot_checksum:payload.exporter_fact_snapshot_checksum,
      policy:phase1hPolicy,
      india_origin_unit_value:indiaUnitValues.get(record.reporter_code)??null,
      // The exporter's declared standard shipment, frozen with the rest of the request. It is
      // what converts a per-shipment or per-container operational quote into a per-unit cost.
      shipment_basis:frozenShipmentBasis,
      import_benchmark:importBenchmarkFromTradeMetrics({policy:phase1hPolicy.value,country_trade_metrics_id:record.id,country_code:countryCode,hs_code:record.hs_code,hs_revision:record.hs_revision,as_of_date:record.as_of_date,latest_period_year:record.latest_common_year??record.period_set.at(-1)??null,unit_value:metricsPayload.metrics?.unit_value}),
    });
    const pillars=calculateCountryTruthPillars(resolved.facts,phase1hPolicy.value);
    factSnapshotIds.push(resolved.record.id);
    contexts[record.reporter_code]={
      non_trade:pillars.non_trade,
      blockers:pillars.blockers,
      exporter_snapshot:payload.exporter_fact_snapshot,
      exporter_snapshot_checksum:payload.exporter_fact_snapshot_checksum,
      fact_snapshot:{id:resolved.record.id,checksum:resolved.facts_checksum,snapshot_key:resolved.snapshot_key,policy_version:phase1hPolicy.version,policy_hash:resolved.record.selection_policy_hash,...(tariffClock?{tariff_as_of_date:tariffClock.toISOString()}:{})},
    };
  }
  await stage('scoring',85,{country_truth_fact_snapshot_ids:factSnapshotIds.sort()});
  let run=checkpoint.discovery_run_id?await prisma.discoveryRun.findUnique({where:{id:checkpoint.discovery_run_id}}):await prisma.discoveryRun.findFirst({where:{job_id:ctx.job_id}});
  if(run&&(run.exporter_org_id!==payload.exporter_org_id||run.product_id!==payload.product_id))throw new Error('Checkpointed DiscoveryRun does not match the frozen Country Truth job.');
  if(!run)run=await prisma.discoveryRun.create({data:{exporter_org_id:payload.exporter_org_id,product_id:payload.product_id,job_id:ctx.job_id,requested_by_id:payload.requested_by_agent_id,status:JobStatus.processing,started_at:new Date(),as_of_date:scoringClock,filters:{candidate_countries:payload.candidates.map(candidate=>candidate.country_code)},input_snapshot:json({schema_version:'country-truth-discovery-run-v2',job_payload:payload,screening_provenance:payload.provenance??null,exporter_fact_snapshot:payload.exporter_fact_snapshot,exporter_fact_snapshot_checksum:payload.exporter_fact_snapshot_checksum,country_evidence_plan_id:plan.id,country_evidence_manifest_id:acquisition.manifest.id,country_trade_metrics_ids:metricIds,...(tariffClock?{tariff_acquisition:tariffAcquisitionRecord(orchestrationPolicy!,payload.policies.market_access_orchestration!.policy_hash,tariffClock,tariffAcquisitions)}:{})})}});
  await stage('scoring',90,{discovery_run_id:run.id});
  let assessments=await prisma.marketAssessment.findMany({where:{run_id:run.id},orderBy:{country_code:'asc'}});
  if(assessments.length){const assessmentMetricIds=assessments.map(item=>item.country_trade_metrics_id).filter((id):id is string=>Boolean(id)).sort();if(assessments.length!==metricIds.length||JSON.stringify(assessmentMetricIds)!==JSON.stringify(metricIds)||assessments.some(item=>item.model_version!=='market-attractiveness-v4'))throw new Error('Checkpointed Country Truth assessments are incomplete or incompatible.');}
  else assessments=await createCountryTruthV4Assessments({run_id:run.id,country_trade_metrics_ids:metricIds,source_mode:TradeSourceMode.authenticated,scoring_clock:scoringClock,contexts,scoring_policy:{value:payload.policies.country_truth_scoring.snapshot as unknown as CountryTruthScoringV4Policy,version:payload.policies.country_truth_scoring.config_version}});
  const assessmentIds=assessments.map(item=>item.id).sort(),partial=acquisition.status!=='metric_ready'||assessments.some(item=>item.country_truth_assessment_state!=='rankable');
  await prisma.discoveryRun.update({where:{id:run.id},data:{status:partial?JobStatus.partial:JobStatus.completed,completed_at:new Date()}});
  await stage('completed',100,{assessment_ids:assessmentIds});
  return {status:partial?JobStatus.partial:JobStatus.completed,result:json({schema_version:'country-truth-discovery-result-v3',stage:'completed',screening_run_id:payload.provenance?.screening_run_id??null,country_evidence_plan_id:plan.id,country_evidence_manifest_id:acquisition.manifest.id,country_trade_metrics_ids:metricIds,country_truth_fact_snapshot_ids:[...factSnapshotIds].sort(),discovery_run_id:run.id,assessment_ids:assessmentIds,evidence_status:acquisition.status,physical_calls:acquisition.physical_calls,...(tariffClock?{tariff_acquisition:tariffAcquisitionRecord(orchestrationPolicy!,payload.policies.market_access_orchestration!.policy_hash,tariffClock,tariffAcquisitions)}:{})})};
}

export const __test__={payloadSchema,validatePolicyIdentities};
