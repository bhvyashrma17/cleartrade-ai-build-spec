import {NextResponse} from 'next/server';import {prisma} from '@/lib/prisma';import {operationsAuthorized} from '@/lib/operations-auth';import {sanctionsSourceHealth} from '@/lib/sanctions/source-health';
export const dynamic='force-dynamic';

/**
 * Operational metrics. Bearer-token protected; never returns raw buyer/trade rows.
 *
 * The sanctions block is derived from `sanctionsSourceHealth()` and is deliberately
 * BOUNDED: one row per required dataset (4), plus one global state. It previously read
 * every `SanctionsSourceSnapshot` ever created, which grew by four rows per refresh
 * forever — an unbounded time series that would degrade the endpoint and any scraper
 * consuming it.
 *
 * Labels are dataset name, authority, lifecycle/completeness enums and the global state —
 * all fixed-cardinality. Deliberately absent: sanctioned-party names, raw XML, object keys,
 * signed URLs, credentials and full checksums.
 */
export async function GET(request:Request){
  if(!operationsAuthorized(request))return NextResponse.json({error:'unauthorized'},{status:401});
  const [jobs,ingests,workers,health]=await Promise.all([
    prisma.job.groupBy({by:['type','status'],_count:{_all:true}}),
    prisma.ingestRun.groupBy({by:['source','status'],_count:{_all:true}}),
    prisma.workerHeartbeat.findMany({select:{instance_id:true,status:true,last_seen_at:true,consecutive_failures:true}}),
    sanctionsSourceHealth(),
  ]);
  return NextResponse.json({
    generated_at:new Date().toISOString(),
    jobs,ingests,workers,
    sanctions:{
      global_state:health.global_state,
      policy_version:health.policy_version,
      freshness_policy_status:health.freshness_policy_status,
      freshness_threshold_days:health.freshness_threshold_days,
      required_dataset_count:health.datasets.length,
      complete_dataset_count:health.datasets.filter(d=>d.completeness==='COMPLETE'&&d.freshness_status==='FRESH').length,
      authorities:health.authorities.map(a=>({authority:a.authority,complete:a.complete})),
      datasets:health.datasets.map(d=>({
        dataset:d.dataset,
        authority:d.authority,
        lifecycle_state:d.lifecycle_state,
        completeness:d.completeness,
        freshness_status:d.freshness_status,
        age_hours:d.age_hours,
        parsed_count:d.parsed_count,
        rejected_count:d.rejected_count,
        anomaly_count:d.anomaly_count,
        artifact_retained:d.artifact_retained,
        artifact_verification:d.artifact_verification,
        latest_failure_stage:d.latest_failure_stage,
        serving_previous_after_failure:d.serving_previous_after_failure,
        refresh_in_progress:d.refresh_in_progress,
        next_refresh_at:d.next_refresh_at,
      })),
    },
  },{headers:{'cache-control':'no-store'}});
}
