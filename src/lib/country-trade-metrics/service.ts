import { Prisma } from '@prisma/client';
import { getConfigWithVersion, type CountryTradeMetricPolicy } from '@/lib/config';
import { canonicalHash } from '@/lib/country-evidence/planner';
import { tradeSourceModeToEvidenceOrigin } from '@/lib/evidence-environment';
import { prisma } from '@/lib/prisma';
import { toIso2 } from '@/lib/comtrade/areas';
import { COMTRADE_NORMALIZATION_VERSION } from '@/lib/comtrade/normalization';
import { calculateCountryTradeMetrics, calculateIndiaOriginUnitValues, INDIA_ORIGIN_UNIT_VALUE_VERSION, type CountryMetricInput, type MetricFact } from './calculator';

const json=(value:unknown)=>value as Prisma.InputJsonValue;

async function loadManifestInputs(manifestId:string,policy:CountryTradeMetricPolicy){
  const manifest=await prisma.countryEvidenceManifest.findUniqueOrThrow({where:{id:manifestId},include:{plan:true,references:{include:{source_evidence:{include:{observations:true}}}}}});
  const expectedOrigin=tradeSourceModeToEvidenceOrigin(manifest.plan.source_mode);
  const facts:MetricFact[]=[];
  for(const reference of manifest.references){
    if(reference.source_evidence.source_origin!==expectedOrigin)throw new Error(`Manifest ${manifest.id} contains evidence from an incompatible source origin.`);
    if(reference.source_evidence.completeness!==reference.evidence_completeness)throw new Error(`Manifest reference ${reference.id} completeness no longer matches its immutable evidence.`);
    const selected=new Set(reference.observation_ids);
    for(const observation of reference.source_evidence.observations){
      if(!selected.has(observation.id))continue;
      if(observation.reporter_code!==reference.reporter_code||observation.ref_year!==reference.period||observation.hs_code!==manifest.plan.hs_code||observation.hs_revision!==manifest.plan.hs_revision)throw new Error(`Manifest reference ${reference.id} contains an incompatible observation.`);
      if(observation.normalization_version!==COMTRADE_NORMALIZATION_VERSION)throw new Error(`Manifest reference ${reference.id} contains an incompatible normalization version.`);
      facts.push({purpose:reference.purpose as MetricFact['purpose'],reporter_code:observation.reporter_code,partner_code:observation.partner_code,partner_iso2:observation.partner_iso2,partner_is_world:observation.partner_is_world,partner2_code:observation.partner2_code,period:observation.ref_year,hs_code:observation.hs_code,hs_revision:observation.hs_revision,flow_direction:observation.flow_direction,frequency:observation.frequency,trade_value:observation.trade_value==null?null:Number(observation.trade_value),trade_value_status:observation.trade_value_status,quantity:observation.quantity==null?null:Number(observation.quantity),quantity_status:observation.quantity_status,quantity_unit:observation.quantity_unit,net_weight:observation.net_weight==null?null:Number(observation.net_weight),source_evidence_id:reference.source_evidence_id,observation_id:observation.id,retrieved_at:reference.evidence_retrieved_at.toISOString(),freshness_state:reference.freshness_state,evidence_completeness:reference.evidence_completeness,cell_state:reference.cell_state});
    }
  }
  return{manifest,facts,policy};
}

export async function calculateAndPersistCountryTradeMetrics(manifestId:string,policyOverride?:CountryTradeMetricPolicy|{value:CountryTradeMetricPolicy;version:number}){
  const configured=policyOverride?('value' in policyOverride?policyOverride:{value:policyOverride,version:0}):await getConfigWithVersion('country_trade_metrics.policy');
  const loaded=await loadManifestInputs(manifestId,configured.value),policyHash=canonicalHash({...configured.value,config_version:configured.version});
  const records=[];
  // Each reporter is measured across ITS OWN window when the plan carries one. Feeding the
  // plan-wide union to every reporter is what made a lagging market unrankable: its market size
  // was looked up at a year it never reported, so demand was unavailable and the score died.
  const windows=(loaded.manifest.plan.reporter_period_windows??null) as Record<string,number[]>|null;
  for(const reporter of [...loaded.manifest.plan.candidate_reporters].sort((a,b)=>Number(a)-Number(b))){
    const window=windows?.[reporter]??loaded.manifest.plan.period_set;
    const latestForReporter=window.at(-1)??loaded.manifest.plan.latest_common_year;
    const input:CountryMetricInput={reporter_code:reporter,hs_code:loaded.manifest.plan.hs_code,hs_revision:loaded.manifest.plan.hs_revision,period_set:window,latest_common_year:latestForReporter,facts:loaded.facts.filter(f=>f.reporter_code===reporter),policy:configured.value};
    const metrics=calculateCountryTradeMetrics(input);
    const payload={schema_version:'country-trade-metrics-payload-v2',manifest_id:loaded.manifest.id,manifest_checksum:loaded.manifest.checksum,reporter_code:reporter,country_code:toIso2(reporter),hs_code:input.hs_code,hs_revision:input.hs_revision,as_of_date:loaded.manifest.plan.as_of_date.toISOString(),period_set:input.period_set,latest_common_year:input.latest_common_year,plan_latest_common_year:loaded.manifest.plan.latest_common_year,period_lag:Math.max(0,(loaded.manifest.plan.preferred_period??loaded.manifest.plan.latest_common_year)-input.latest_common_year),metric_policy_version:configured.value.policy_version,metric_policy_hash:policyHash,calculation_version:configured.value.calculation_version,metrics};
    const checksum=canonicalHash(payload);
    const existing=await prisma.countryTradeMetrics.findUnique({where:{manifest_id_reporter_code_metric_policy_hash_calculation_version:{manifest_id:manifestId,reporter_code:reporter,metric_policy_hash:policyHash,calculation_version:configured.value.calculation_version}}});
    if(existing&&existing.checksum!==checksum)throw new Error(`CountryTradeMetrics ${existing.id} was computed under a different payload than the current code produces; recompute under a new calculation version rather than reusing it.`);
    records.push(existing??await prisma.countryTradeMetrics.create({data:{manifest_id:manifestId,product_classification_id:loaded.manifest.plan.product_classification_id,reporter_code:reporter,country_code:toIso2(reporter),hs_code:input.hs_code,hs_revision:input.hs_revision,as_of_date:loaded.manifest.plan.as_of_date,period_set:input.period_set,latest_common_year:input.latest_common_year,metric_policy_version:configured.value.policy_version,metric_policy_hash:policyHash,metric_policy_snapshot:json({...configured.value,config_version:configured.version}),calculation_version:configured.value.calculation_version,metrics_payload:json(payload),checksum}}));
  }
  return records;
}

/**
 * Supplemental India-origin unit value, per reporter, over an already-frozen manifest.
 *
 * It deliberately writes nothing. Persisting it as part of CountryTradeMetrics would change
 * that record's checksum and force a new calculation version, which is exactly what would make
 * an in-progress Phase 1G run recompute metrics it has already validated. Phase 1H records the
 * result in its own fact manifest instead.
 */
export async function calculateIndiaOriginUnitValueSupplement(manifestId:string,policy:CountryTradeMetricPolicy){
  const loaded=await loadManifestInputs(manifestId,policy);
  const windows=(loaded.manifest.plan.reporter_period_windows??null) as Record<string,number[]>|null;
  return [...loaded.manifest.plan.candidate_reporters].sort((a,b)=>Number(a)-Number(b)).map(reporter=>{
    const window=windows?.[reporter]??loaded.manifest.plan.period_set;
    const input:CountryMetricInput={reporter_code:reporter,hs_code:loaded.manifest.plan.hs_code,hs_revision:loaded.manifest.plan.hs_revision,period_set:window,latest_common_year:window.at(-1)??loaded.manifest.plan.latest_common_year,facts:loaded.facts.filter(f=>f.reporter_code===reporter),policy};
    return {reporter_code:reporter,country_code:toIso2(reporter),supplemental_version:INDIA_ORIGIN_UNIT_VALUE_VERSION,result:calculateIndiaOriginUnitValues(input)};
  });
}

export function formatCountryTradeMetricsReconciliation(record:{reporter_code:string;country_code:string|null;hs_code:string;hs_revision:string;checksum:string;metrics_payload:Prisma.JsonValue}){
  const payload=record.metrics_payload as Record<string,unknown>,metrics=payload.metrics as Record<string,{value:unknown;status:string;unit:string|null;periods_used:number[];calculation_method:string;exclusion_reason:string|null;evidence:Array<{source_evidence_id:string;observation_id:string;period:number}>;details?:unknown}>;
  return [`${record.country_code??record.reporter_code} / HS ${record.hs_code} (${record.hs_revision})`,`Metric checksum: ${record.checksum}`,...Object.entries(metrics).flatMap(([name,result])=>[`${name}: ${result.status}`,`  value: ${result.value==null?'unavailable':JSON.stringify(result.value)}${result.unit?` ${result.unit}`:''}`,`  periods: ${result.periods_used.join(', ')||'none'}`,`  method: ${result.calculation_method}`,...(result.exclusion_reason?[`  exclusion: ${result.exclusion_reason}`]:[]),`  evidence: ${result.evidence.map(ref=>`${ref.observation_id} @ ${ref.source_evidence_id}`).join(', ')||'none'}`,...(result.details?[`  details: ${JSON.stringify(result.details)}`]:[])])].join('\n');
}
