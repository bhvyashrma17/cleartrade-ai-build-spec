/**
 * Sanctions source health panel (Part E).
 *
 * Presentation only. Every judgement — global state, freshness, authority rollup — is decided
 * in `sanctionsSourceHealth()` on the server. This component must not re-derive any of it,
 * because a dashboard that computes its own verdict can disagree with the gate that actually
 * blocks screening, and then it is worse than no dashboard at all.
 *
 * It also deliberately shows NO sanctioned-party names, no raw XML and no artifact URLs —
 * this is a source-operations view, not a data browser. Checksums appear abbreviated, and the
 * object key is shown as a storage location without any signed or public URL.
 */

import {StatusChip} from '@/components/ui';
import type {StatusIconName,StatusTone} from '@/types';
import type {DatasetHealth,GlobalScreeningState,SanctionsSourceHealth} from '@/lib/sanctions/source-health';

const GLOBAL_TONE:Record<GlobalScreeningState,{tone:StatusTone;icon:StatusIconName;label:string;blurb:string}>={
  READY:{tone:'positive',icon:'check',label:'Screening READY',blurb:'All required datasets are complete, fresh and active. Buyer screening is operating on full coverage.'},
  DEGRADED:{tone:'warning',icon:'clock',label:'Screening DEGRADED',blurb:'Screening still has complete coverage, but at least one dataset failed its most recent refresh and is serving an older snapshot.'},
  BLOCKED:{tone:'critical',icon:'block',label:'Screening BLOCKED',blurb:'Required coverage is incomplete. Buyer screening fails closed — it will not return clear results until this is resolved.'},
};

const fmt=(d:Date|null|undefined)=>d?new Date(d).toISOString().replace('T',' ').slice(0,16)+' UTC':'unavailable';

function datasetTone(d:DatasetHealth):{tone:StatusTone;icon:StatusIconName;label:string}{
  if(!d.active_snapshot_id)return {tone:'critical',icon:'block',label:'No active snapshot'};
  if(d.completeness!=='COMPLETE')return {tone:'critical',icon:'alert',label:d.completeness??'UNKNOWN'};
  if(d.freshness_status==='STALE')return {tone:'critical',icon:'alert',label:'STALE'};
  if(d.serving_previous_after_failure||d.latest_failure_stage)return {tone:'warning',icon:'clock',label:'COMPLETE · refresh failed'};
  return {tone:'positive',icon:'check',label:'COMPLETE'};
}

function Field({label,value,muted}:{label:string;value:React.ReactNode;muted?:boolean}){
  return <div><dt className="text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)]">{label}</dt><dd className={`mt-0.5 text-sm ${muted?'text-[var(--color-text-secondary)]':''}`}>{value}</dd></div>;
}

export function SanctionsSourceHealthPanel({health}:{health:SanctionsSourceHealth}){
  const g=GLOBAL_TONE[health.global_state];
  return <section className="space-y-4 rounded-lg border border-[var(--color-border)] bg-surface p-4">
    {/* E3 — one server-computed verdict, stated before any per-dataset detail. */}
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-semibold">Sanctions source health</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">{g.blurb}</p>
      </div>
      <StatusChip label={g.label} tone={g.tone} icon={g.icon}/>
    </div>

    {health.global_reasons.length>0&&<ul className="space-y-1 rounded border border-[var(--color-border)] bg-surface-muted p-3 text-sm">
      {health.global_reasons.map(r=><li key={r}>· {r}</li>)}
    </ul>}

    {/* E2 — authority rollup. A failing member dataset is named, never absorbed into a chip. */}
    <div className="flex flex-wrap gap-2">
      {health.authorities.map(a=><StatusChip key={a.authority} size="sm" tone={a.complete?'positive':'critical'} icon={a.complete?'check':'alert'}
        label={`${a.authority.toUpperCase()} · ${a.complete?'covered':`incomplete (${a.failing_datasets.join(', ')})`}`}
        detail={`Datasets: ${a.datasets.join(', ')}`}/>)}
    </div>

    {/* E1 — per-dataset detail. */}
    <div className="space-y-3">
      {health.datasets.map(d=>{
        const t=datasetTone(d);
        return <article key={d.dataset} className="rounded border border-[var(--color-border)] p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">{d.dataset_name} <span className="text-[var(--color-text-secondary)]">· {d.dataset}</span></p>
              <p className="text-xs text-[var(--color-text-secondary)]">{d.authority.toUpperCase()} · contract {d.source_contract_version} · required dataset</p>
            </div>
            <StatusChip size="sm" label={t.label} tone={t.tone} icon={t.icon}/>
          </div>

          {/* E4 — say plainly that an older snapshot is serving, rather than leaving Ops to infer it. */}
          {d.serving_previous_after_failure&&<p className="mt-2 rounded border border-[var(--color-status-warning-border,var(--color-border))] bg-surface-muted p-2 text-xs">
            Serving previous COMPLETE snapshot — the latest refresh failed at the <strong>{d.latest_failure_stage}</strong> stage
            {d.latest_attempt_at?` on ${fmt(d.latest_attempt_at)}`:''}. Screening continues on the last good data; it was not silently reset.
          </p>}
          {!d.serving_previous_after_failure&&d.latest_failure_stage&&<p className="mt-2 rounded border border-[var(--color-border)] bg-surface-muted p-2 text-xs">
            Most recent attempt failed at the <strong>{d.latest_failure_stage}</strong> stage{d.latest_attempt_at?` on ${fmt(d.latest_attempt_at)}`:''}.
            {d.latest_failure_reason?` ${d.latest_failure_reason}`:''}
          </p>}

          <dl className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Field label="Lifecycle" value={d.lifecycle_state??'none'}/>
            <Field label="Provider published" value={fmt(d.provider_published_at)}/>
            <Field label="Provider version" value={d.provider_version??'unavailable'}/>
            <Field label="Retrieved" value={fmt(d.retrieved_at)}/>
            <Field label="Last complete refresh" value={fmt(d.last_complete_refresh)}/>
            <Field label="Age" value={d.age_hours===null?'unavailable':`${d.age_hours} h`}/>
            <Field label="Freshness" value={<>{d.freshness_status} <span className="text-xs text-[var(--color-text-secondary)]">(threshold {d.freshness_threshold_days} d)</span></>}/>
            <Field label="Evidence origin" value={d.evidence_origin??'unavailable'}/>
            <Field label="Retrieved records" value={d.retrieved_count??'unavailable'}/>
            <Field label="Parsed entities" value={d.parsed_count??'unavailable'}/>
            <Field label="Rejected records" value={d.rejected_count??'unavailable'}/>
            <Field label="Parse errors" value={d.parse_error_count}/>
            <Field label="Checksum" value={<code className="text-xs">{d.checksum_abbrev??'unavailable'}</code>}/>
            <Field label="Raw artifact" value={d.artifact_retained
              ?<>retained · {d.artifact_storage_provider} · verification {d.artifact_verification??'unknown'}</>
              :<span className="text-[var(--color-text-secondary)]">{d.artifact_required?'NOT RETAINED (required)':'not retained (not required in this environment)'}</span>}/>
            <Field label="Refresh cadence" value={`every ${d.refresh_interval_hours} h`}/>
            <Field label="Next refresh" value={d.refresh_in_progress?'in progress now':fmt(d.next_refresh_at)}/>
            <Field label="Snapshot" value={<code className="text-xs">{d.active_snapshot_id??'none'}</code>} muted/>
          </dl>

          {d.anomaly_count>0&&<div className="mt-3 rounded border border-[var(--color-border)] bg-surface-muted p-2">
            <p className="text-xs font-medium">{d.anomaly_count} anomaly finding{d.anomaly_count===1?'':'s'}</p>
            <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-text-secondary)]">
              {d.anomalies.slice(0,5).map((a,i)=><li key={`${a.code}-${i}`}>· [{a.severity}] {a.code}: {a.detail}</li>)}
            </ul>
          </div>}

          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">Required-dataset set: {d.policy_approval.replace(/_/g,' ')}.</p>
        </article>;
      })}
    </div>

    {/* Policy boundary stated on the surface Ops actually reads (Part H). */}
    <p className="text-xs text-[var(--color-text-secondary)]">
      Policy {health.policy_version}. The {health.freshness_threshold_days}-day freshness threshold is an
      engineering default and is <strong>{health.freshness_policy_status.replace(/_/g,' ')}</strong> — it has not been
      ratified as the tolerated staleness for screening.
    </p>
  </section>;
}
