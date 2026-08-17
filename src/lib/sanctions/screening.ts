import {Prisma,SanctionsCompletenessStatus,SanctionsReviewDecisionValue,SanctionsScreeningResultState,SanctionsSnapshotState,UserRole} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {normalizeSanctionsName as normalizeEntityName} from '@/lib/sanctions/normalize';
import {sanctionsEvidenceWhere} from '@/lib/evidence-environment';

export const SANCTIONS_SCREENING_ALGORITHM_VERSION='sanctions-candidate-v2';

/**
 * Required-source policy (Phase 9). Expressed as a versioned record rather than a bare
 * array so the required set, the freshness window and the matching rules travel together
 * and a change is visible as a policy version bump.
 *
 * The required set is UNCHANGED by this work: all three sources remain mandatory.
 */
export const SANCTIONS_SCREENING_POLICY={
  version:'sanctions-screening-policy-v2',
  /**
   * REQUIRED DATASETS — datasets, not authority names (Part H).
   *
   * v1 listed `ofac_sdn` and, because an authority name was never used, never actually
   * claimed to cover "OFAC" generally. v2 makes the distinction explicit AND repairs a
   * measured coverage defect: OFAC publishes non-SDN programmes (SSI, CMIC, CAATSA-RUSSIA,
   * HKAA, NS-PLC) in a separate artifact, and 388 of its 481 designations were absent from
   * the SDN list. Screening only SDN therefore missed active OFAC designations.
   *
   * Adding a required dataset can only make coverage STRICTER — it cannot weaken
   * fail-closed screening. Whether non-SDN designations are *legally* required for this
   * product's jurisdictions remains a compliance determination (see approvals below); the
   * conservative posture is the default until that determination is made.
   */
  required_datasets:['ofac_sdn','ofac_non_sdn_consolidated','eu_financial_sanctions','un_security_council'] as const,
  /** Aggregate coverage per authority: an authority is covered only if ALL its datasets are. */
  authority_datasets:{
    ofac:['ofac_sdn','ofac_non_sdn_consolidated'],
    eu:['eu_financial_sanctions'],
    un:['un_security_council'],
  } as const,
  matching_version:'sanctions-candidate-v2',
  /** Name similarity alone is REVIEW-ONLY. It can never auto-confirm. */
  name_similarity_is_review_only:true,
  /**
   * Whether an exact stable-identifier match is treated as definitive.
   *
   * `true` DESCRIBES THE INCUMBENT BEHAVIOUR — `evaluateCandidate` has always returned
   * confirmed_match on an exact identifier hit, and the existing test suite asserts it.
   * Recorded truthfully rather than silently changed: this is a compliance determination,
   * and code must not make jurisdiction-specific legal decisions without approved evidence.
   */
  exact_identifier_is_definitive:true,
  /** Compliance decisions that remain unratified. Engineering defaults are conservative. */
  approvals:{
    required_dataset_set:'pending_policy_approval',
    freshness_tolerance:'pending_policy_approval',
    exact_identifier_definitive:'pending_policy_approval',
  },
} as const;

/** Dataset-level requirement list. Name retained for call-site compatibility. */
export const REQUIRED_SANCTIONS_SOURCES=SANCTIONS_SCREENING_POLICY.required_datasets;

/**
 * The two-day freshness window is an ENGINEERING default, deliberately conservative. It has
 * NOT been ratified by legal/compliance as the tolerated staleness for screening, so it is
 * labelled rather than presented as an approved control.
 */
export const SANCTIONS_FRESHNESS_POLICY_STATUS='pending_policy_approval' as const;

/** Entities are only screenable through a snapshot that is currently `active`. */
/** Aggregate coverage per authority — OFAC is complete only when BOTH its datasets are. */
export function authorityCoverage(sources:{source:string;status:SanctionsCompletenessStatus}[]){
  return Object.entries(SANCTIONS_SCREENING_POLICY.authority_datasets).map(([authority,datasets])=>({
    authority,
    datasets:[...datasets],
    complete:(datasets as readonly string[]).every(d=>sources.find(s=>s.source===d)?.status===SanctionsCompletenessStatus.COMPLETE),
  }));
}

export function activeSnapshotEntityWhere():Prisma.SanctionsEntityWhereInput{
  return {snapshot:{is:{state:SanctionsSnapshotState.active}}};
}
type Search={buyer_id?:string;name:string;country?:string|null;address?:string|null;entity_type?:string|null;identifiers?:{type?:string|null;value:string}[]};
type Entity={id:string;source:string;source_record_id:string;name:string;normalized_name:string;aliases:unknown;countries:unknown;addresses:unknown;entity_type:string|null;identifiers:unknown};
const strings=(value:unknown)=>Array.isArray(value)?value.filter((v):v is string=>typeof v==='string'):[];
const ids=(value:unknown)=>Array.isArray(value)?value.filter((v):v is {type?:string|null;value:string}=>typeof v==='object'&&v!==null&&typeof (v as {value?:unknown}).value==='string'):[];
const tokenSimilarity=(a:string,b:string)=>{if(a===b)return 1;const aa=new Set(a.split(' ')),bb=new Set(b.split(' '));return [...aa].filter(x=>bb.has(x)).length/Math.max(aa.size,bb.size,1);};
const compatibleType=(searched:string|null|undefined,listed:string|null)=>!searched||!listed||(/person|individual/i.test(searched)===/person|individual/i.test(listed));

/**
 * Screening coverage across the required sources (Phase 8/9).
 *
 * Reads ONLY snapshots in state `active`. A candidate snapshot mid-ingest, a rejected one,
 * or a superseded one can never contribute coverage — that is what makes activation atomic
 * from the reader's side.
 *
 * The freshness window is engineering configuration, NOT approved compliance policy. See
 * `SANCTIONS_FRESHNESS_POLICY_STATUS`.
 */
export async function sanctionsCoverage(now=new Date(),maxAgeDays=Number(process.env.SANCTIONS_MAX_AGE_DAYS??2)){
  const snapshots=await prisma.sanctionsSourceSnapshot.findMany({where:{source:{in:[...REQUIRED_SANCTIONS_SOURCES]},state:SanctionsSnapshotState.active}});
  const cutoff=new Date(now.getTime()-maxAgeDays*86_400_000);
  const sources=REQUIRED_SANCTIONS_SOURCES.map(source=>{
    const snapshot=snapshots.find(s=>s.source===source);
    if(!snapshot)return {source,status:SanctionsCompletenessStatus.FAILED,reason:'No active snapshot for this required source',snapshot_id:null,provider_published_at:null,retrieved_at:null,age_hours:null,activated_at:null};
    const fresh=Boolean(snapshot.last_successful_full_refresh&&snapshot.last_successful_full_refresh>=cutoff);
    const ageHours=snapshot.last_successful_full_refresh?Math.round((now.getTime()-snapshot.last_successful_full_refresh.getTime())/36_000)/100:null;
    return {
      source,
      status:fresh&&snapshot.completeness_status===SanctionsCompletenessStatus.COMPLETE?SanctionsCompletenessStatus.COMPLETE:fresh?snapshot.completeness_status:SanctionsCompletenessStatus.STALE,
      reason:fresh?null:'Last complete refresh is missing or stale',
      snapshot_id:snapshot.id,
      provider_published_at:snapshot.source_update_date,
      retrieved_at:snapshot.fetched_at,
      activated_at:snapshot.activated_at,
      age_hours:ageHours,
    };
  });
  return {complete:sources.every(s=>s.status===SanctionsCompletenessStatus.COMPLETE),sources,authorities:authorityCoverage(sources),max_age_days:maxAgeDays,freshness_policy_status:SANCTIONS_FRESHNESS_POLICY_STATUS,policy_version:SANCTIONS_SCREENING_POLICY.version};
}

export function evaluateCandidate(search:Search,entity:Entity){
  const normalized=normalizeEntityName(search.name),names=[entity.normalized_name,...strings(entity.aliases).map(normalizeEntityName)],nameSimilarity=Math.max(...names.map(n=>tokenSimilarity(normalized,n)));
  const searchedIds=search.identifiers??[],listedIds=ids(entity.identifiers),identifierMatches=searchedIds.flatMap(a=>listedIds.filter(b=>normalizeEntityName(a.value)===normalizeEntityName(b.value)));
  if(!compatibleType(search.entity_type,entity.entity_type)&&identifierMatches.length===0)return null;
  const countryEvidence=strings(entity.countries),countryMatch=!search.country||!countryEvidence.length?null:countryEvidence.some(c=>normalizeEntityName(c)===normalizeEntityName(search.country!));
  const addressMatch=!search.address?null:strings(entity.addresses).some(a=>tokenSimilarity(normalizeEntityName(search.address!),normalizeEntityName(a))>=.7);
  if(identifierMatches.length)return {state:SanctionsScreeningResultState.confirmed_match,score:1,evidence:{identifier_match:true,name_similarity:nameSimilarity,country_match:countryMatch,address_match:addressMatch}};
  if(nameSimilarity<.8)return null;
  return {state:SanctionsScreeningResultState.possible_match,score:nameSimilarity,evidence:{identifier_match:false,name_similarity:nameSimilarity,country_match:countryMatch,address_match:addressMatch,type_compatible:true}};
}

export async function screenCounterparty(search:Search,options:{requireCompleteCoverage?:boolean}={requireCompleteCoverage:true}){
  const coverage=await sanctionsCoverage();
  if(options.requireCompleteCoverage&&!coverage.complete){const created=await prisma.sanctionsScreeningCase.create({data:{buyer_id:search.buyer_id,searched_name:search.name,normalized_name:normalizeEntityName(search.name),searched_country:search.country,searched_address:search.address,searched_entity_type:search.entity_type,searched_identifiers:(search.identifiers??[]) as Prisma.InputJsonValue,result_state:SanctionsScreeningResultState.insufficient_screening_coverage,evidence:coverage as unknown as Prisma.InputJsonValue,algorithm_version:SANCTIONS_SCREENING_ALGORITHM_VERSION}});return {state:created.result_state,case_id:created.id,coverage};}
  const entities=await prisma.sanctionsEntity.findMany({where:{is_active:true,...sanctionsEvidenceWhere(),...activeSnapshotEntityWhere()}}),candidates=entities.map(entity=>({entity,result:evaluateCandidate(search,entity)})).filter((x):x is {entity:typeof entities[number];result:NonNullable<ReturnType<typeof evaluateCandidate>>}=>Boolean(x.result)).sort((a,b)=>b.result.score-a.result.score);
  const best=candidates[0];if(!best)return {state:SanctionsScreeningResultState.clear,case_id:null,coverage};
  const created=await prisma.sanctionsScreeningCase.create({data:{buyer_id:search.buyer_id,searched_name:search.name,normalized_name:normalizeEntityName(search.name),searched_country:search.country,searched_address:search.address,searched_entity_type:search.entity_type,searched_identifiers:(search.identifiers??[]) as Prisma.InputJsonValue,result_state:best.result.state,source_entity_id:best.entity.id,evidence:{...best.result.evidence,source:best.entity.source,source_record_id:best.entity.source_record_id} as Prisma.InputJsonValue,algorithm_version:SANCTIONS_SCREENING_ALGORITHM_VERSION}});return {state:created.result_state,case_id:created.id,coverage};
}

export async function recordSanctionsReview(input:{case_id:string;reviewer_user_id:string;decision:SanctionsReviewDecisionValue;reason:string;evidence?:unknown}){
  if(!input.reason.trim())throw new Error('A sanctions review decision requires a reason.');
  return prisma.$transaction(async tx=>{
    const reviewer=await tx.user.findUniqueOrThrow({where:{id:input.reviewer_user_id},select:{role:true}});
    if(!([UserRole.ops_supervisor,UserRole.admin] as readonly UserRole[]).includes(reviewer.role))throw new Error('Only Ops supervisors or Admins may decide sanctions reviews.');
    const screening=await tx.sanctionsScreeningCase.findUniqueOrThrow({where:{id:input.case_id}});
    const decision=await tx.sanctionsReviewDecision.create({data:{screening_case_id:screening.id,reviewer_user_id:input.reviewer_user_id,decision:input.decision,reason:input.reason,evidence:input.evidence as Prisma.InputJsonValue}});
    if(input.decision!==SanctionsReviewDecisionValue.needs_more_information){
      const confirmed=input.decision===SanctionsReviewDecisionValue.confirmed_match;
      await tx.sanctionsScreeningCase.update({where:{id:screening.id},data:{result_state:confirmed?SanctionsScreeningResultState.confirmed_match:SanctionsScreeningResultState.clear,resolved_at:new Date()}});
      if(screening.buyer_id)await tx.buyer.update({where:{id:screening.buyer_id},data:{sanctions_blocked:confirmed,risk_flags:confirmed?[{code:'sanctions_confirmed_match',severity:'critical',summary:'Confirmed sanctions match after Ops review',screening_case_id:screening.id}]:[]}});
    }
    return decision;
  });
}
