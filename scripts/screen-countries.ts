/**
 * Guarded Stage A global country screening.
 *
 * Dry-run is the default and no mode in this script can acquire trade data: `--persist` writes a
 * run and resolves it against evidence already in the database, and acquisition additionally
 * demands `--execute` plus an explicit live-acquisition confirmation.
 */
import { getConfigWithVersion } from '../src/lib/config';
import { comtradeReporterRegistry } from '../src/lib/comtrade/reporter-registry';
import { appEnvironment } from '../src/lib/evidence-environment';
import { buildCountryScreeningPlan } from '../src/lib/country-screening/planner';
import { createGlobalCountryScreeningRun, estimateGlobalCountryScreeningQuota, executeGlobalCountryScreeningRun, globalCountryScreeningShortlist, resolveGlobalCountryScreeningRun } from '../src/lib/country-screening/service';
import { prisma } from '../src/lib/prisma';
import { requireCountryTruthClassification } from '../src/lib/product-classification';

function arg(name:string){return process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);}
function flag(name:string){return process.argv.includes(`--${name}`);}

async function main(){
  const classificationId=arg('classification-id'),asOfText=arg('as-of');
  if(!classificationId||!asOfText)throw new Error('Usage: npm run screen:countries -- --classification-id=<id> --as-of=2026-08-26 [--persist] [--execute] [--allow-partial]');
  const asOf=new Date(`${asOfText}T00:00:00.000Z`);if(Number.isNaN(asOf.getTime()))throw new Error('--as-of must be YYYY-MM-DD.');
  const classification=await requireCountryTruthClassification(classificationId);
  const configured=await getConfigWithVersion('country_screening.policy');
  const periodConfigured=await getConfigWithVersion('country_period_selection.policy');
  const mode=(process.env.COMTRADE_CLIENT==='real'?'authenticated':process.env.COMTRADE_CLIENT==='fixture'?'fixture':'mock') as 'authenticated'|'fixture'|'mock';
  const registry=comtradeReporterRegistry();
  const planned=buildCountryScreeningPlan({product_classification_id:classification.id,hs_code:classification.hs6_code,hs_revision:classification.nomenclature_version,as_of_date:asOf,source_mode:mode,policy:configured.value,policy_config_version:configured.version,period_selection_policy:periodConfigured.value,period_selection_policy_config_version:periodConfigured.version});
  const exclusionCounts=planned.universe.exclusions.reduce<Record<string,number>>((counts,row)=>({...counts,[row.reason]:(counts[row.reason]??0)+1}),{});
  const summary={
    environment:appEnvironment(),source_mode:mode,run_key:planned.run_key,
    classification_id:classification.id,hs_code:classification.hs6_code,hs_revision:classification.nomenclature_version,
    as_of_date:asOf.toISOString(),screening_period_requested:planned.screening_period,
    policy_version:configured.value.policy_version,policy_config_version:configured.version,policy_hash:planned.policy_hash,period_selection_policy_version:periodConfigured.value.policy_version,period_selection_policy_hash:planned.period_selection_policy_hash,max_fallback_lookback_years:periodConfigured.value.max_fallback_lookback_years,
    universe_version:planned.universe.version,universe_checksum:planned.universe.checksum,
    reporter_registry:{version:registry.version,checksum:registry.checksum,live_reporters:registry.reporters.length,source:registry.source,anomalies:registry.anomalies},
    total_screening_markets:planned.universe.size,
    markets_with_valid_reporter_identity:planned.universe.entries.length,
    markets_excluded_by_reason:exclusionCounts,
    markets_without_provider_reporter:planned.universe.exclusions.filter(row=>row.reason==='no_provider_reporter_identity').map(row=>row.iso2),
    live_reporters_not_screened:planned.universe.unmatched_reporters,
    freshness_days:configured.value.latest_period_freshness_days,
    shortlist_target_size:configured.value.shortlist_target_size,
    estimated_logical_requests_if_nothing_cached:planned.items.length,
  };

  // Plan only: nothing is written and no provider is contacted.
  if(!flag('persist')&&!flag('execute')){console.log(JSON.stringify({mode:'plan_only',...summary},null,2));return;}

  const run=await createGlobalCountryScreeningRun({product_classification_id:classification.id,as_of_date:asOf,source_mode:mode as 'authenticated',allow_partial_execution:flag('allow-partial')});
  // Read-only resolution against persisted evidence. Still no provider call.
  const resolved=await resolveGlobalCountryScreeningRun(run.id);
  const quota=await estimateGlobalCountryScreeningQuota(run.id);
  const statusCounts=resolved.results.reduce<Record<string,number>>((counts,row)=>({...counts,[row.screening_status]:(counts[row.screening_status]??0)+1}),{});
  const freshness=resolved.results.reduce<Record<string,number>>((counts,row)=>({...counts,[row.freshness_state]:(counts[row.freshness_state]??0)+1}),{});
  const observationPeriods=[...new Set(resolved.results.map(row=>row.observation_period).filter((period):period is number=>period!=null))].sort();
  const dryRun={mode:'dry_run',run_id:run.id,...summary,run_status:resolved.status,result_status_counts:statusCounts,freshness_state_counts:freshness,observation_periods_present:observationPeriods,quota,shortlist:await globalCountryScreeningShortlist(run.id)};
  if(!flag('execute')){console.log(JSON.stringify(dryRun,null,2));return;}

  if(appEnvironment()==='production')throw new Error('This guarded screening tool refuses production execution.');
  if((appEnvironment()==='staging'||mode==='authenticated')&&!flag('confirm-live-acquisition'))throw new Error('Live acquisition requires --confirm-live-acquisition.');
  const execution=await executeGlobalCountryScreeningRun(run.id,{allow_partial_execution:flag('allow-partial')});
  console.log(JSON.stringify({...dryRun,mode:'executed',execution,shortlist:await globalCountryScreeningShortlist(run.id)},null,2));
}

main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}).finally(()=>prisma.$disconnect());
