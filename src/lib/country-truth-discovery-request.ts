import { createHash } from 'node:crypto';
import { JobStatus, JobType, ProductClassificationStatus, UserRole, type Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { canonicalHash } from '@/lib/country-evidence/planner';
import { getConfigWithVersion } from '@/lib/config';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { enqueueJob, findInFlightJob } from '@/lib/jobs';
import { assertCan, assertOrgAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { projectHs6 } from '@/lib/product-classification';
import type { Principal } from '@/types';

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

export interface CountryTruthDiscoveryPayload {
  schema_version:'country-truth-discovery-job-v1';
  exporter_org_id:string;
  product_id:string;
  product_classification_id:string;
  hs6:string;
  hs_revision:string;
  candidates:Array<{country_code:string;country_name:string;reporter_code:string}>;
  requested_by_agent_id:string;
  requested_at:string;
  policies:{
    country_evidence:{config_version:number;policy_version:string;policy_hash:string};
    country_trade_metrics:{config_version:number;policy_version:string;calculation_version:string;policy_hash:string};
    country_truth_scoring:{config_version:number;model_version:string;formula_version:string;policy_hash:string};
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

export async function requestCountryTruthDiscovery(args:{actor:Principal;exporter_org_id:string;product_id:string;candidate_countries:string[];correlation_id:string;requested_at?:Date}){
  const {actor}=args;
  const allowedRoles:readonly UserRole[]=[UserRole.agent,UserRole.ops_supervisor,UserRole.admin];
  if(!allowedRoles.includes(actor.role))throw forbidden('Only assigned Agents or authorized operations staff can request Country Truth analysis.');
  assertCan(actor,'demand_discovery.run');
  await assertOrgAccess(actor,args.exporter_org_id);
  if(args.candidate_countries.length===0)throw validationError([{field:'candidate_countries',code:'required',message:'Select at least one candidate country.'}]);
  const candidates=mapCountryTruthCandidates(args.candidate_countries);

  const product=await prisma.product.findFirst({where:{id:args.product_id,exporter_org_id:args.exporter_org_id},include:{classification_history:{orderBy:{revision:'desc'}}}});
  if(!product)throw notFound('That product is not available for this exporter.');
  const classification=product.classification_history.find(item=>item.status===ProductClassificationStatus.confirmed);
  if(!classification||!classification.confirmed_at||!classification.confirmed_by_id)throw validationError([{field:'product_id',code:'classification_required',message:'Confirm the product classification before requesting Country Truth analysis.'}]);
  if(classification.revision!==product.hs_classification_revision||product.classification_history.some(item=>item.revision>classification.revision))throw validationError([{field:'product_id',code:'classification_stale',message:'A newer classification candidate must be resolved before requesting Country Truth analysis.'}]);
  if(product.hs_classification_status!==ProductClassificationStatus.confirmed||product.hs_code!==classification.hs6_code||product.itc_hs_code!==classification.itc_hs_code||product.hs_nomenclature!==classification.nomenclature||product.hs_nomenclature_version!==classification.nomenclature_version||product.hs_confirmed_by_id!==classification.confirmed_by_id||!product.hs_confirmed_at)throw validationError([{field:'product_id',code:'classification_stale',message:'The confirmed classification no longer matches the product’s current canonical classification.'}]);
  let hs6:string;
  try{hs6=projectHs6({itc_hs_code:classification.itc_hs_code,hs6_code:classification.hs6_code,nomenclature:classification.nomenclature,nomenclature_version:classification.nomenclature_version});}
  catch{throw validationError([{field:'product_id',code:'classification_unsupported',message:'Country Truth currently requires a confirmed ITC-HS or HS 2022 classification.'}]);}
  if(!['2022','HS2022'].includes(classification.nomenclature_version))throw validationError([{field:'product_id',code:'classification_unsupported',message:'Country Truth currently requires a confirmed ITC-HS or HS 2022 classification.'}]);

  const [evidence,metrics,scoring]=await Promise.all([
    getConfigWithVersion('country_evidence.policy'),
    getConfigWithVersion('country_trade_metrics.policy'),
    getConfigWithVersion('country_truth.scoring_v4'),
  ]);
  const requestedAt=args.requested_at??new Date();
  const payload:CountryTruthDiscoveryPayload={
    schema_version:'country-truth-discovery-job-v1',exporter_org_id:args.exporter_org_id,product_id:product.id,product_classification_id:classification.id,hs6,hs_revision:classification.nomenclature_version,candidates,requested_by_agent_id:actor.id,requested_at:requestedAt.toISOString(),
    policies:{
      country_evidence:{config_version:evidence.version,policy_hash:canonicalHash(evidence.value),policy_version:evidence.value.policy_version},
      country_trade_metrics:{...policyIdentity(metrics),policy_version:metrics.value.policy_version,calculation_version:metrics.value.calculation_version},
      country_truth_scoring:{...policyIdentity(scoring),model_version:scoring.value.model_version,formula_version:scoring.value.formula_version},
    },
  };
  const workIdentity={classification_id:classification.id,reporters:candidates.map(item=>item.reporter_code)};
  const dedupeKey=`country_truth_discovery:${createHash('sha256').update(JSON.stringify(workIdentity)).digest('hex')}`;
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
  await writeAuditEvent({actor,action:AUDIT_ACTIONS.create,object_type:'country_truth_job',object_id:job.id,exporter_org_id:args.exporter_org_id,after_summary:{product_id:product.id,classification_id:classification.id,hs6,candidate_countries:candidates.map(item=>item.country_code),reporter_codes:candidates.map(item=>item.reporter_code),job_status:JobStatus.queued},correlation_id:args.correlation_id});
  return {job,payload,created:true};
}
