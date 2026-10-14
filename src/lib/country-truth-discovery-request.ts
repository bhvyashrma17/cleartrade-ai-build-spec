import { JobStatus, JobType, ProductClassificationStatus, UserRole, type Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { canonicalHash } from '@/lib/country-evidence/planner';
import { getConfigWithVersion, marketAccessOrchestrationPolicyProblems, type CountryEvidencePolicy, type CountryTradeMetricPolicy, type CountryTruthMarketAccessOrchestrationPolicy, type CountryTruthPhase1HPolicy, type CountryTruthScoringV4Policy } from '@/lib/config';
import { buildCountryTruthExporterFactSnapshot, type CountryTruthExporterFactSnapshot } from '@/lib/country-truth/exporter-fact-snapshot';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { enqueueJob, findInFlightJob } from '@/lib/jobs';
import { assertCan, assertOrgAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { projectHs6 } from '@/lib/product-classification';
import type { Principal } from '@/types';

/**
 * RETIRED FROM THE PRODUCT PATH (Phase 1I).
 *
 * This three-market alias table is the pilot's country resolver, and it is the reason the
 * exporter product could only ever analyse Germany, the UAE and the USA. Nothing user-facing
 * reaches it any more: `/app/products/...` starts a global screen and the deep pipeline reads
 * the frozen shortlist through `country-truth-deep-request`, which resolves identity from the
 * checked-in Comtrade reporter registry instead.
 *
 * It survives only because `requestCountryTruthDiscovery` is still exercised by the Phase 1H
 * handler and assessment test suites, which pin real backend behaviour. Do NOT route a new
 * surface through it, and do not extend it with a fourth country — a country list that a caller
 * supplies is exactly what Stage A exists to replace.
 */
const COUNTRY_ALIASES: Record<string,{country_code:string;country_name:string;reporter_code:string}>={
  DE:{country_code:'DE',country_name:'Germany',reporter_code:'276'},
  DEU:{country_code:'DE',country_name:'Germany',reporter_code:'276'},
  GERMANY:{country_code:'DE',country_name:'Germany',reporter_code:'276'},
  AE:{country_code:'AE',country_name:'United Arab Emirates',reporter_code:'784'},
  ARE:{country_code:'AE',country_name:'United Arab Emirates',reporter_code:'784'},
  UAE:{country_code:'AE',country_name:'United Arab Emirates',reporter_code:'784'},
  UNITEDARABEMIRATES:{country_code:'AE',country_name:'United Arab Emirates',reporter_code:'784'},
  US:{country_code:'US',country_name:'United States',reporter_code:'842'},
  USA:{country_code:'US',country_name:'United States',reporter_code:'842'},
  UNITEDSTATES:{country_code:'US',country_name:'United States',reporter_code:'842'},
  UNITEDSTATESOFAMERICA:{country_code:'US',country_name:'United States',reporter_code:'842'},
};

/** Frozen Stage-A identity, present when the request came from a completed global screen. */
export interface CountryTruthDiscoveryProvenance {
  screening_run_id:string;
  screening_run_key:string;
  screening_policy_version:string;
  screening_policy_hash:string;
  shortlist_size:number;
  shortlist_reporters:string[];
  country_evidence_plan_id:string;
  country_evidence_plan_key:string;
}

export interface CountryTruthDiscoveryPayload {
  schema_version:'country-truth-discovery-job-v3';
  exporter_org_id:string;
  product_id:string;
  product_classification_id:string;
  hs6:string;
  hs_revision:string;
  candidates:Array<{country_code:string;country_name:string;reporter_code:string}>;
  requested_by_agent_id:string;
  requested_at:string;
  exporter_fact_snapshot:CountryTruthExporterFactSnapshot;
  exporter_fact_snapshot_checksum:string;
  reporter_period_windows?:Record<string,number[]>;
  preferred_period?:number;
  provenance?:CountryTruthDiscoveryProvenance;
  policies:{
    country_evidence:{config_version:number;policy_version:string;policy_hash:string;snapshot:CountryEvidencePolicy};
    country_trade_metrics:{config_version:number;policy_version:string;calculation_version:string;policy_hash:string;snapshot:CountryTradeMetricPolicy};
    country_truth_scoring:{config_version:number;model_version:string;formula_version:string;policy_hash:string;snapshot:CountryTruthScoringV4Policy};
    country_truth_phase_1h:{config_version:number;policy_version:string;calculation_version:string;policy_hash:string;snapshot:CountryTruthPhase1HPolicy};
    /**
     * WP2 tariff acquisition (docs/35 E-004). Present ONLY when enabled at request time, so a payload
     * built with the switch off — and its dedupe key — is byte-identical to the pre-WP2 payload.
     */
    market_access_orchestration?:{config_version:number;policy_version:string;policy_hash:string;snapshot:CountryTruthMarketAccessOrchestrationPolicy};
  };
}

function normalizeCountry(value:string){return value.trim().toUpperCase().replace(/[^A-Z]/g,'');}

export function mapCountryTruthCandidates(values:string[]){
  const mapped=values.map(value=>COUNTRY_ALIASES[normalizeCountry(value)]).filter(Boolean);
  if(mapped.length!==values.length)throw validationError([{field:'candidate_countries',code:'unsupported',message:'Pilot Country Truth currently supports Germany, UAE, and USA.'}]);
  return [...new Map(mapped.map(item=>[item.country_code,item])).values()].sort((a,b)=>a.reporter_code.localeCompare(b.reporter_code));
}

function policyIdentity<T extends object>(configured:{value:T;version:number}){
  return {config_version:configured.version,policy_hash:canonicalHash(Object.assign({},configured.value,{config_version:configured.version}))};
}

/**
 * Resolve the exporter's product and its single confirmed classification, with every staleness
 * check the pilot path already applied. Shared so a second request surface cannot drift from it.
 */
export async function resolveCountryTruthClassificationContext(exporter_org_id:string,product_id:string){
  const product=await prisma.product.findFirst({where:{id:product_id,exporter_org_id},include:{exporter_org:true,certifications:true,classification_history:{orderBy:{revision:'desc'}}}});
  if(!product)throw notFound('That product is not available for this exporter.');
  const classification=product.classification_history.find(item=>item.status===ProductClassificationStatus.confirmed);
  if(!classification||!classification.confirmed_at||!classification.confirmed_by_id)throw validationError([{field:'product_id',code:'classification_required',message:'Confirm the product classification before requesting Country Truth analysis.'}]);
  if(classification.revision!==product.hs_classification_revision||product.classification_history.some(item=>item.revision>classification.revision))throw validationError([{field:'product_id',code:'classification_stale',message:'A newer classification candidate must be resolved before requesting Country Truth analysis.'}]);
  if(product.hs_classification_status!==ProductClassificationStatus.confirmed||product.hs_code!==classification.hs6_code||product.itc_hs_code!==classification.itc_hs_code||product.hs_nomenclature!==classification.nomenclature||product.hs_nomenclature_version!==classification.nomenclature_version||product.hs_confirmed_by_id!==classification.confirmed_by_id||!product.hs_confirmed_at)throw validationError([{field:'product_id',code:'classification_stale',message:'The confirmed classification no longer matches the product’s current canonical classification.'}]);
  let hs6:string;
  try{hs6=projectHs6({itc_hs_code:classification.itc_hs_code,hs6_code:classification.hs6_code,nomenclature:classification.nomenclature,nomenclature_version:classification.nomenclature_version});}
  catch{throw validationError([{field:'product_id',code:'classification_unsupported',message:'Country Truth currently requires a confirmed ITC-HS or HS 2022 classification.'}]);}
  if(!['2022','HS2022'].includes(classification.nomenclature_version))throw validationError([{field:'product_id',code:'classification_unsupported',message:'Country Truth currently requires a confirmed ITC-HS or HS 2022 classification.'}]);
  return {product,classification,hs6};
}

type ClassificationContext=Awaited<ReturnType<typeof resolveCountryTruthClassificationContext>>;

/**
 * Freeze the exporter facts and every policy identity into one job payload.
 *
 * `provenance` is optional and carries the frozen screening identity when the request came from
 * a completed global screen. It is additive to `country-truth-discovery-job-v3`: a historical
 * payload without it still validates and still replays.
 */
export async function buildCountryTruthDiscoveryPayload(args:{
  context:ClassificationContext;
  exporter_org_id:string;
  candidates:Array<{country_code:string;country_name:string;reporter_code:string}>;
  requested_by_agent_id:string;
  requested_at:Date;
  reporter_period_windows?:Record<string,number[]>;
  preferred_period?:number;
  provenance?:CountryTruthDiscoveryProvenance;
}):Promise<CountryTruthDiscoveryPayload>{
  const {product,classification,hs6}=args.context;
  const [evidence,metrics,scoring,phase1h,orchestration]=await Promise.all([
    getConfigWithVersion('country_evidence.policy'),
    getConfigWithVersion('country_trade_metrics.policy'),
    getConfigWithVersion('country_truth.scoring_v4'),
    getConfigWithVersion('country_truth.phase_1h'),
    getConfigWithVersion('country_truth.market_access_orchestration'),
  ]);
  // An enabled switch with a malformed shape is an operations error: fail loudly rather than freeze
  // a half-valid policy into a job. A disabled switch is never frozen at all.
  if(orchestration.value.enabled){
    const problems=marketAccessOrchestrationPolicyProblems(orchestration.value);
    if(problems.length)throw new Error(`country_truth.market_access_orchestration is enabled but invalid: ${problems.join(' ')}`);
  }
  const sourceReferences=Array.isArray(classification.source_references)?classification.source_references.filter((item):item is string=>typeof item==='string'):[];
  const exporterFacts=buildCountryTruthExporterFactSnapshot({
    exporter_org:{id:product.exporter_org.id,country:product.exporter_org.country,state:product.exporter_org.state,city:product.exporter_org.city,pickup_location_code:product.exporter_org.pickup_location_code,preferred_origin_gateway:product.exporter_org.preferred_origin_gateway,updated_at:product.exporter_org.updated_at},
    product:{id:product.id,exporter_org_id:product.exporter_org_id,updated_at:product.updated_at,evidence_origin:product.evidence_origin,hs_code:product.hs_code,hs_nomenclature_version:product.hs_nomenclature_version,hs_classification_revision:product.hs_classification_revision,hs_classification_status:product.hs_classification_status,price_target_amount:product.price_target_amount,price_target_currency:product.price_target_currency,price_target_quantity_unit:product.price_target_quantity_unit,price_target_incoterm:product.price_target_incoterm,capacity_value:product.capacity_value,capacity_unit:product.capacity_unit,available_capacity_value:product.available_capacity_value,available_capacity_unit:product.available_capacity_unit,capacity_period:product.capacity_period,moq_value:product.moq_value,moq_unit:product.moq_unit,lead_time_days:product.lead_time_days,delivery_commitment_days:product.delivery_commitment_days,logistics_constraint_codes:product.logistics_constraint_codes,logistics_constraints_confirmed:product.logistics_constraints_confirmed,desired_order_size_amount:product.desired_order_size_amount,desired_order_size_currency:product.desired_order_size_currency,customization_capability:product.customization_capability,packaging_capability:product.packaging_capability,packaging:product.packaging,packaging_format:product.packaging_format,container_compatibility:product.container_compatibility,special_handling_codes:product.special_handling_codes,shipment_quantity_value:product.shipment_quantity_value,shipment_quantity_unit:product.shipment_quantity_unit,shipment_container_count:product.shipment_container_count,shipment_container_type:product.shipment_container_type,origin_country:product.origin_country,origin_state:product.origin_state,origin_city:product.origin_city,origin_location_code:product.origin_location_code,origin_gateway_code:product.origin_gateway_code},
    // A certification only reaches the snapshot as agent-verified when an agent actually
    // reviewed it, and the review's author and timestamp travel with it. An exporter's own row
    // stays exporter_declared no matter what it says about itself.
    certifications:product.certifications.map(item=>({id:item.id,product_id:item.product_id,code:item.code,name:item.name,status:item.status,evidence_ref:item.certificate_reference??item.evidence_ref,issuer:item.issuer,certificate_reference:item.certificate_reference,document_id:item.document_id,issue_date:item.issue_date,valid_until:item.valid_until,declared_absent:item.declared_absent,declaration_state:item.declaration_state,updated_at:item.updated_at,
      ...(item.verification_state==='agent_verified'&&item.verified_by_id&&item.verified_at
        ? {verification:{verification_status:'verified' as const,verified_at:item.verified_at,actor_user_id:item.verified_by_id,evidence_refs:item.certificate_reference?[item.certificate_reference]:null}}
        : {}),
    })),
    classification:{id:classification.id,product_id:classification.product_id,revision:classification.revision,hs6_code:hs6,nomenclature_version:classification.nomenclature_version,status:'confirmed',confirmed_by_id:classification.confirmed_by_id!,confirmed_at:classification.confirmed_at!,evidence_refs:sourceReferences},
    captured_at:args.requested_at,
  });
  return {
    schema_version:'country-truth-discovery-job-v3',exporter_org_id:args.exporter_org_id,product_id:product.id,product_classification_id:classification.id,hs6,hs_revision:classification.nomenclature_version,candidates:args.candidates,
    requested_by_agent_id:args.requested_by_agent_id,requested_at:args.requested_at.toISOString(),exporter_fact_snapshot:exporterFacts.snapshot,exporter_fact_snapshot_checksum:exporterFacts.checksum,
    ...(args.reporter_period_windows?{reporter_period_windows:args.reporter_period_windows}:{}),
    ...(args.preferred_period==null?{}:{preferred_period:args.preferred_period}),
    ...(args.provenance?{provenance:args.provenance}:{}),
    policies:{
      country_evidence:{config_version:evidence.version,policy_hash:canonicalHash(evidence.value),policy_version:evidence.value.policy_version,snapshot:evidence.value},
      country_trade_metrics:{...policyIdentity(metrics),policy_version:metrics.value.policy_version,calculation_version:metrics.value.calculation_version,snapshot:metrics.value},
      country_truth_scoring:{...policyIdentity(scoring),model_version:scoring.value.model_version,formula_version:scoring.value.formula_version,snapshot:scoring.value},
      country_truth_phase_1h:{...policyIdentity(phase1h),policy_version:phase1h.value.policy_version,calculation_version:phase1h.value.calculation_version,snapshot:phase1h.value},
      ...(orchestration.value.enabled===true?{market_access_orchestration:{...policyIdentity(orchestration),policy_version:orchestration.value.policy_version,snapshot:orchestration.value}}:{}),
    },
  };
}

/** The identity a repeat of the same question must collapse onto. */
export function countryTruthDiscoveryDedupeKey(payload:CountryTruthDiscoveryPayload){
  return `country_truth_discovery:${canonicalHash({schema_version:payload.schema_version,exporter_org_id:payload.exporter_org_id,product_id:payload.product_id,classification_id:payload.product_classification_id,hs6:payload.hs6,hs_revision:payload.hs_revision,reporters:payload.candidates.map(item=>item.reporter_code),scoring_clock:payload.requested_at,exporter_fact_snapshot_checksum:payload.exporter_fact_snapshot_checksum,policy_hashes:Object.values(payload.policies).map(item=>item.policy_hash),screening_run_id:payload.provenance?.screening_run_id??null})}`;
}

export async function requestCountryTruthDiscovery(args:{actor:Principal;exporter_org_id:string;product_id:string;candidate_countries:string[];correlation_id:string;requested_at?:Date}){
  const {actor}=args;
  const allowedRoles:readonly UserRole[]=[UserRole.agent,UserRole.ops_supervisor,UserRole.admin];
  if(!allowedRoles.includes(actor.role))throw forbidden('Only assigned Agents or authorized operations staff can request Country Truth analysis.');
  assertCan(actor,'demand_discovery.run');
  await assertOrgAccess(actor,args.exporter_org_id);
  if(args.candidate_countries.length===0)throw validationError([{field:'candidate_countries',code:'required',message:'Select at least one candidate country.'}]);
  const candidates=mapCountryTruthCandidates(args.candidate_countries);
  const context=await resolveCountryTruthClassificationContext(args.exporter_org_id,args.product_id);
  const {product,classification}=context;
  const requestedAt=args.requested_at??new Date();
  const payload=await buildCountryTruthDiscoveryPayload({context,exporter_org_id:args.exporter_org_id,candidates,requested_by_agent_id:actor.id,requested_at:requestedAt});
  const hs6=payload.hs6;
  const dedupeKey=countryTruthDiscoveryDedupeKey(payload);
  const existing=await findInFlightJob(dedupeKey);
  if(existing)return {job:existing,payload:existing.payload as unknown as CountryTruthDiscoveryPayload,created:false};

  let job;
  try{
    job=await enqueueJob({type:JobType.country_truth_discovery,payload:payload as unknown as Prisma.InputJsonValue,exporter_org_id:args.exporter_org_id,requested_by_id:actor.id,target_type:'product_classification',target_id:classification.id,dedupe_key:dedupeKey,correlation_id:args.correlation_id});
  }catch(error){
    const raced=await findInFlightJob(dedupeKey);
    if(!raced)throw error;
    return {job:raced,payload:raced.payload as unknown as CountryTruthDiscoveryPayload,created:false};
  }
  await writeAuditEvent({actor,action:AUDIT_ACTIONS.create,object_type:'country_truth_job',object_id:job.id,exporter_org_id:args.exporter_org_id,after_summary:{product_id:product.id,classification_id:classification.id,hs6,candidate_countries:candidates.map(item=>item.country_code),reporter_codes:candidates.map(item=>item.reporter_code),exporter_fact_snapshot_checksum:payload.exporter_fact_snapshot_checksum,policy_hashes:Object.values(payload.policies).map(item=>item.policy_hash),job_status:JobStatus.queued},correlation_id:args.correlation_id});
  return {job,payload,created:true};
}
