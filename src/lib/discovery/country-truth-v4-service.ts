import { EvidenceOrigin,MarketEligibilityStatus,Prisma,TradeSourceMode } from '@prisma/client';
import { getConfigWithVersion,type CountryTruthScoringV4Policy } from '@/lib/config';
import { canonicalHash } from '@/lib/country-evidence/planner';
import { tradeSourceModeToEvidenceOrigin } from '@/lib/evidence-environment';
import { prisma } from '@/lib/prisma';
import { scoreCountryTruthV4,type AuthoritativeComponentInput,type CountryTruthMetricPayload,type V4ScoringInput } from './country-truth-scoring-v4';

/**
 * Per-reporter Phase 1H context. `fact_snapshot` and `blockers` travel separately from
 * `non_trade` on purpose: a blocker is a gate on the whole market, not a low component score
 * that a weighted average may absorb.
 */
export interface CountryTruthV4Context{
  non_trade?:V4ScoringInput['non_trade'];
  exporter_unit_value?:V4ScoringInput['exporter_unit_value'];
  exporter_snapshot?:Record<string,unknown>;
  exporter_snapshot_checksum?:string;
  fact_snapshot?:{id:string;checksum:string;snapshot_key:string;policy_version:number;policy_hash:string};
  blockers?:Array<{pillar:string;code:string;subject:string|null;evidence_fact_ids:string[]}>;
}

export async function createCountryTruthV4Assessments(args:{run_id:string;country_trade_metrics_ids:string[];source_mode:TradeSourceMode;scoring_clock:Date;contexts?:Record<string,CountryTruthV4Context>;scoring_policy?:{value:CountryTruthScoringV4Policy;version:number}}){
  if(!args.country_trade_metrics_ids.length)throw new Error('Country Truth v4 requires at least one immutable CountryTradeMetrics record.');
  const run=await prisma.discoveryRun.findUniqueOrThrow({where:{id:args.run_id},include:{market_assessments:{select:{id:true}}}});
  if(run.market_assessments.length)throw new Error('Country Truth v4 only writes to a new DiscoveryRun; historical assessments are never replaced.');
  const metrics=await prisma.countryTradeMetrics.findMany({where:{id:{in:args.country_trade_metrics_ids}},include:{manifest:{include:{plan:true}}}});
  if(metrics.length!==new Set(args.country_trade_metrics_ids).size)throw new Error('One or more CountryTradeMetrics records do not exist.');
  const configured=args.scoring_policy??await getConfigWithVersion('country_truth.scoring_v4'),policyHash=canonicalHash({...configured.value,config_version:configured.version});
  const drafts:Array<{record:(typeof metrics)[number];result:ReturnType<typeof scoreCountryTruthV4>;blockers:NonNullable<CountryTruthV4Context['blockers']>;checksum:string;identity:string}>=[];
  for(const record of metrics){
    if(record.manifest.plan.source_mode!==args.source_mode)throw new Error('Country Truth v4 source mode must match the frozen metrics evidence origin.');
    if(args.source_mode===TradeSourceMode.authenticated&&record.manifest.plan.source_mode!==TradeSourceMode.authenticated)throw new Error('Authenticated v4 scoring refuses fixture metrics.');
    if(run.product_id&&record.product_classification_id!==await prisma.productClassification.findFirst({where:{id:record.product_classification_id,product_id:run.product_id},select:{id:true}}).then(x=>x?.id))throw new Error('CountryTradeMetrics classification does not belong to the DiscoveryRun product.');
    const payload=record.metrics_payload as unknown as {manifest_checksum:string;metrics:CountryTruthMetricPayload};
    if(payload.manifest_checksum!==record.manifest.checksum)throw new Error('CountryTradeMetrics manifest checksum does not match its frozen manifest.');
    const context=args.contexts?.[record.reporter_code]??{};
    const scoreInput:V4ScoringInput={country_trade_metrics_id:record.id,metrics_checksum:record.checksum,manifest_id:record.manifest_id,manifest_checksum:record.manifest.checksum,metrics_policy_version:record.metric_policy_version,metrics_policy_hash:record.metric_policy_hash,reporter_code:record.reporter_code,country_code:record.country_code??record.reporter_code,hs_code:record.hs_code,hs_revision:record.hs_revision,period_set:record.period_set,latest_common_year:record.latest_common_year,period_lag:Number((record.metrics_payload as unknown as {period_lag?:number}).period_lag??0),as_of_date:record.as_of_date.toISOString(),metrics:payload.metrics,non_trade:context.non_trade??{},exporter_unit_value:context.exporter_unit_value,policy:configured.value};
    const result=scoreCountryTruthV4(scoreInput);
    const blockers=[...(context.blockers??[])].sort((a,b)=>a.pillar.localeCompare(b.pillar)||a.code.localeCompare(b.code)||(a.subject??'').localeCompare(b.subject??''));
    const assessmentPayload={schema_version:'country-truth-assessment-v5',scoring_clock:args.scoring_clock.toISOString(),scoring_policy_version:configured.version,scoring_policy_hash:policyHash,exporter_snapshot:context.exporter_snapshot??{},exporter_snapshot_checksum:context.exporter_snapshot_checksum??null,country_truth_fact_snapshot:context.fact_snapshot??null,blockers,score:result};
    // Every input whose change would change the meaning of this row. Two runs may legitimately
    // produce the same CONTENT checksum; they may never produce the same record identity.
    const identity=canonicalHash({schema_version:'country-truth-assessment-identity-v1',run_id:run.id,product_id:run.product_id,country_code:record.country_code??record.reporter_code,reporter_code:record.reporter_code,classification_id:record.product_classification_id,hs_code:record.hs_code,hs_revision:record.hs_revision,country_trade_metrics_id:record.id,country_trade_metrics_checksum:record.checksum,manifest_id:record.manifest_id,manifest_checksum:record.manifest.checksum,metric_policy_version:record.metric_policy_version,metric_policy_hash:record.metric_policy_hash,period_set:record.period_set,as_of_date:record.as_of_date.toISOString(),scoring_clock:args.scoring_clock.toISOString(),model_version:configured.value.model_version,formula_version:configured.value.formula_version,scoring_policy_version:configured.version,scoring_policy_hash:policyHash,source_mode:args.source_mode,exporter_snapshot_checksum:context.exporter_snapshot_checksum??null,fact_snapshot_key:context.fact_snapshot?.snapshot_key??null,fact_snapshot_checksum:context.fact_snapshot?.checksum??null,phase_1h_policy_version:context.fact_snapshot?.policy_version??null,phase_1h_policy_hash:context.fact_snapshot?.policy_hash??null});
    drafts.push({record,result,blockers,checksum:canonicalHash(assessmentPayload),identity});
  }
  return prisma.$transaction(async tx=>{
  await tx.discoveryRun.update({where:{id:run.id},data:{as_of_date:args.scoring_clock,scoring_policy_version:configured.version,scoring_policy_hash:policyHash,scoring_policy_snapshot:configured.value as unknown as Prisma.InputJsonValue,reproducibility_status:'reproducible',input_snapshot:{...((run.input_snapshot as Record<string,unknown>|null)??{}),country_truth_v4:{country_trade_metrics_ids:metrics.map(m=>m.id).sort(),scoring_clock:args.scoring_clock.toISOString(),source_mode:args.source_mode}} as Prisma.InputJsonValue}});
  const created=[];
  for(const draft of drafts.sort((a,b)=>(b.result.overall_score??-1)-(a.result.overall_score??-1)||a.record.reporter_code.localeCompare(b.record.reporter_code))){
    const c=draft.result.components,p=draft.result.provenance,origin=tradeSourceModeToEvidenceOrigin(args.source_mode);
    const context=args.contexts?.[draft.record.reporter_code]??{};
    // A hard gate removes the market from ranking outright. Publishing an overall score beside
    // an explicit blocker would let a good tariff average away a legal impossibility.
    const blocked=draft.blockers.length>0;
    created.push(await tx.marketAssessment.create({data:{run_id:run.id,product_id:run.product_id,country_code:draft.record.country_code??draft.record.reporter_code,overall_score:blocked?null:draft.result.overall_score,eligibility_status:blocked?MarketEligibilityStatus.ineligible:MarketEligibilityStatus.eligible,eligibility_reasons:draft.blockers as unknown as Prisma.InputJsonValue,demand_score:c.demand_strength.score,growth_score:c.growth_momentum.score,competition_score:c.competitive_opportunity.score,market_access_score:c.market_access.score,export_economics_score:c.export_economics.score,exporter_market_fit_score:c.exporter_market_fit.score,logistics_feasibility_score:c.logistics_feasibility.score,risk_resilience_score:c.risk_resilience.score,confidence_score:draft.result.confidence_score,model_version:configured.value.model_version,weight_profile_key:'country_truth_v4',weight_profile_version:configured.version,as_of_date:args.scoring_clock,scoring_policy_version:configured.version,scoring_policy_hash:policyHash,scoring_policy_snapshot:configured.value as unknown as Prisma.InputJsonValue,reproducibility_status:'reproducible',evidence_origins:[origin as EvidenceOrigin],classification_id:draft.record.product_classification_id,classification_hs6_code:draft.record.hs_code,classification_version:draft.record.hs_revision,rationale:draft.result.rationale,field_provenance:{overall_score:{...p,assessment_checksum:draft.checksum,assessment_identity:draft.identity,formula_version:draft.result.formula_version,assessment_state:blocked?'blocked':draft.result.assessment_state,raw_available_score_before_blockers:draft.result.overall_score,blockers:draft.blockers,country_truth_fact_snapshot:context.fact_snapshot??null,available_base_weight:draft.result.available_base_weight},demand_score:c.demand_strength,growth_score:c.growth_momentum,competition_score:c.competitive_opportunity,market_access:c.market_access,export_economics:c.export_economics,exporter_market_fit:c.exporter_market_fit,logistics_feasibility:c.logistics_feasibility,risk_resilience:c.risk_resilience,confidence_score:{formula_version:configured.value.confidence.formula_version,value:draft.result.confidence_score,basis:'Base-weighted evidence coverage and component evidence quality; unavailable components contribute zero confidence.'},rationale:{source:'deterministic_country_truth_v4',note:'Programmatic summary of frozen facts and explicit missingness; no causal claims.'}} as unknown as Prisma.InputJsonValue,country_trade_metrics_id:draft.record.id,country_trade_metrics_checksum:draft.record.checksum,country_evidence_manifest_id:draft.record.manifest_id,country_evidence_manifest_checksum:draft.record.manifest.checksum,country_metric_policy_version:draft.record.metric_policy_version,country_metric_policy_hash:draft.record.metric_policy_hash,country_truth_period_set:draft.record.period_set,country_truth_as_of_date:draft.record.as_of_date,country_truth_assessment_state:blocked?'blocked':draft.result.assessment_state,assessment_checksum:draft.checksum,assessment_identity:draft.identity,country_truth_fact_snapshot_id:context.fact_snapshot?.id??null,country_truth_fact_snapshot_checksum:context.fact_snapshot?.checksum??null}}));
  }
  return created;
  });
}

export function reconcileCountryTruthV4(input:V4ScoringInput){const result=scoreCountryTruthV4(input);return[`${input.country_code} / HS ${input.hs_code}`,`Metrics: ${input.country_trade_metrics_id} (${input.metrics_checksum})`,`Manifest: ${input.manifest_id} (${input.manifest_checksum})`,`State: ${result.assessment_state}`,`Overall: ${result.overall_score??'unavailable'}`,`Confidence: ${result.confidence_score}`,...Object.entries(result.components).map(([name,c])=>`${name}: ${c.score??'unavailable'} | base ${c.base_weight} | effective ${(c.effective_weight*100).toFixed(2)}% | confidence ${c.confidence} | ${Object.entries(c.sub_signals).map(([s,v])=>`${s}=${v.score??'unavailable'}@${(v.effective_weight*100).toFixed(2)}%`).join(', ')}`)].join('\n');}

export type {AuthoritativeComponentInput};
