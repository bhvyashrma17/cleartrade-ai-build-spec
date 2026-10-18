/**
 * Demand Discovery v5 for operations (docs/36 §7): can a run start here, what it reads, what a
 * missing dataset costs, and which runs are running, partial or failed — with each run's own notes
 * on what it could not use. Read-only.
 */
import type { JobStatus } from '@prisma/client';
import { StatusChip } from '@/components/ui';
import type { DemandDiscoveryV5Operations } from '@/lib/demand-discovery-v5/operations';

const fmt = (date: Date | null) => (date ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : '—');
const day = (date: Date | null) => (date ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date) : '—');

const RUN_TONE: Record<JobStatus, 'positive' | 'warning' | 'critical' | 'neutral' | 'info'> = {
  queued: 'neutral', processing: 'info', completed: 'positive', partial: 'warning', failed: 'critical', cancelled: 'neutral',
};

export function DemandDiscoveryV5Panel({ overview }: { overview: DemandDiscoveryV5Operations }) {
  const missing = overview.reference.filter((item) => !item.active);
  return (
    <section className="space-y-4 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card" aria-labelledby="v5-ops-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="v5-ops-heading" className="text-lg font-semibold text-primary">Demand Discovery v5</h2>
        {overview.available
          ? <StatusChip label="Runs can start" tone="positive" icon="check" size="sm" />
          : <StatusChip label="Runs cannot start" tone="critical" icon="block" size="sm" detail={overview.unavailable_reason ?? undefined} />}
      </div>
      {overview.unavailable_reason ? <p className="text-sm text-[var(--color-text-secondary)]">{overview.unavailable_reason} Product classifications keep using the earlier engine until this is fixed.</p> : null}
      <p className="text-xs text-[var(--color-text-muted)]">
        {overview.environment} · policy {overview.switches.policy_version} · auto-start {overview.switches.auto_start_on_classification ? 'on' : 'off'} ·
        official tariff look-up {overview.switches.tariff_acquisition ? 'on' : 'off'} ·
        Comtrade newest year {overview.switches.comtrade_newest_year ? 'on' : 'off'} · Comtrade market fallback {overview.switches.comtrade_market_fallback ? 'on' : 'off'} ·
        ECB rates {overview.switches.fx_fetch_missing ? 'fetched by runs when missing' : 'not fetched'} (newest stored EUR/USD: {day(overview.fx.latest_usd_observation)}) ·
        US Treasury rates for other currencies {overview.switches.fx_treasury_fallback ? 'on' : 'off'} (newest stored: {day(overview.fx.latest_treasury_observation)})
      </p>

      <div>
        <h3 className="text-sm font-semibold text-primary">Last 7 days</h3>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          {overview.last_7_days.completed} completed · {overview.last_7_days.partial} partial · {overview.last_7_days.failed} failed · {overview.last_7_days.processing} running · {overview.last_7_days.queued} queued
        </p>
      </div>

      <div className="overflow-x-auto">
        <h3 className="text-sm font-semibold text-primary">Datasets</h3>
        <table className="mt-2 w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-text-secondary)]">
              <th scope="col" className="py-1 font-medium">Dataset</th>
              <th scope="col" className="py-1 font-medium">Version</th>
              <th scope="col" className="py-1 font-medium">Imported</th>
              <th scope="col" className="py-1 font-medium">If missing</th>
            </tr>
          </thead>
          <tbody>
            {overview.baci.length ? overview.baci.map((release) => (
              <tr key={release.hs_revision} className="border-t border-[var(--color-border)]">
                <td className="py-1.5 text-primary">CEPII BACI {release.hs_revision}</td>
                <td className="py-1.5 text-primary">{release.dataset_version} · {release.first_year}–{release.last_year}</td>
                <td className="py-1.5 text-[var(--color-text-secondary)]">{day(release.completed_at)} · {release.evidence_origin.replaceAll('_', ' ')}</td>
                <td className="py-1.5 text-[var(--color-text-secondary)]">v5 cannot run without BACI.</td>
              </tr>
            )) : (
              <tr className="border-t border-[var(--color-border)]">
                <td className="py-1.5 text-primary">CEPII BACI</td>
                <td className="py-1.5"><StatusChip label="Not imported" tone="critical" icon="block" size="sm" /></td>
                <td className="py-1.5 text-[var(--color-text-secondary)]">—</td>
                <td className="py-1.5 text-[var(--color-text-secondary)]">v5 cannot run without BACI.</td>
              </tr>
            )}
            {overview.reference.map((item) => (
              <tr key={item.key} className="border-t border-[var(--color-border)]">
                <td className="py-1.5 text-primary">{item.label}<div className="text-xs text-[var(--color-text-muted)]">{item.key}</div></td>
                <td className="py-1.5">{item.active ? <span className="text-primary">{item.active.version} · {item.active.row_count} rows</span> : <StatusChip label="Not imported" tone="warning" icon="alert" size="sm" />}</td>
                <td className="py-1.5 text-[var(--color-text-secondary)]">{item.active ? `${day(item.active.imported_at)} · ${item.active.evidence_origin.replaceAll('_', ' ')}` : '—'}</td>
                <td className="py-1.5 text-[var(--color-text-secondary)]">{item.when_missing}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {missing.length ? <p className="mt-2 text-xs text-[var(--color-text-muted)]">{missing.length} reference dataset{missing.length === 1 ? ' is' : 's are'} not imported; runs still complete and say what they could not score.</p> : null}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-primary">Recent runs</h3>
        {overview.runs.length ? (
          <ul className="mt-2 divide-y divide-[var(--color-border)]">
            {overview.runs.map((run) => (
              <li key={run.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <StatusChip label={run.status} tone={RUN_TONE[run.status]} icon="dot" size="sm" />
                  <span className="font-medium text-primary">{run.product ?? 'Guest product'}</span>
                  <span className="text-[var(--color-text-secondary)]">{run.exporter}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">{run.trigger?.replaceAll('_', ' ') ?? 'manual'} · started {fmt(run.created_at)}{run.completed_at ? ` · finished ${fmt(run.completed_at)}` : ''}</span>
                </div>
                {run.ranked != null ? <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{run.ranked} markets ranked{run.top_markets.length ? ` · top: ${run.top_markets.join(', ')}` : ''}</p> : null}
                {run.notes.length ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-[var(--color-text-secondary)]">What this run could not use ({run.notes.length})</summary>
                    <ul className="mt-1 list-disc pl-5 text-xs text-[var(--color-text-secondary)]">
                      {run.notes.map((note) => <li key={note}>{note}</li>)}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-sm text-[var(--color-text-secondary)]">No v5 runs yet in this environment.</p>}
      </div>
    </section>
  );
}
