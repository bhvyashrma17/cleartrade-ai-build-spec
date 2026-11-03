'use client';

/**
 * Regional demand on the market page (D-033, docs/38): where inside the market the product arrives.
 * For the US: destination states and ports of entry, from the Census Bureau's monthly figures.
 *
 * The figures are read by a background job; this component starts it, shows that it is running
 * (polling), and then shows the newest completed result. Every figure names its source and period.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, StatusChip } from '@/components/ui';
import { RupeeRateNote, useRupees } from '@/components/fx/RupeeRate';
import { ApiClientError, apiGet, apiPost } from '@/lib/api-client';
import { formatPercent, formatUsd } from '@/lib/demand-discovery-v5/explain';
import type { ImporterView, RegionalArea, RegionalDemandResultV1, RegionalView } from '@/lib/regional-demand/census';
import type { RegionalDemandView } from '@/lib/regional-demand/service';
import type { SingleResponse } from '@/types';

const POLL_MS = 4000;

const tonnes = (kg: number) => {
  const t = kg / 1000;
  return `${t >= 100 ? Math.round(t).toLocaleString('en-US') : Number(t.toFixed(1)).toLocaleString('en-US')} t`;
};

export function RegionalDemand({
  assessmentId,
  countryName,
  initial,
  canRequest,
}: {
  assessmentId: string;
  countryName: string;
  initial: RegionalDemandView;
  /** Starting a read is part of the paid plan; others see the result but not the button. */
  canRequest: boolean;
}) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = view.latest?.status === 'queued' || view.latest?.status === 'running';

  const refresh = useCallback(async () => {
    const res = await apiGet<SingleResponse<RegionalDemandView>>(`/api/v1/market-assessments/${assessmentId}/regional-demand`);
    setView(res.data);
  }, [assessmentId]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      refresh().catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/market-assessments/${assessmentId}/regional-demand`, {});
      await refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not start reading the regional figures.');
    } finally {
      setBusy(false);
    }
  }

  if (!view.supported) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-surface p-4 text-sm text-[var(--color-text-secondary)]">
        Regional figures for {countryName} are not connected yet.
      </p>
    );
  }

  const shown = view.shown?.result ?? null;
  const lastProblem = view.latest && (view.latest.status === 'failed' || view.latest.status === 'unavailable') ? view.latest : null;

  return (
    <div className="space-y-4">
      {running ? (
        <StatusChip label={`Reading the ${view.publisher}'s latest monthly figures…`} tone="neutral" icon="clock" size="sm" />
      ) : null}

      {!shown && !running ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-surface p-4">
          {lastProblem ? (
            <p className="text-sm text-primary">
              {lastProblem.status === 'unavailable' ? 'The regional figures are not available right now. ' : 'Reading the regional figures failed. '}
              <span className="text-[var(--color-text-secondary)]">{lastProblem.reason}</span>
            </p>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]">
              See where in {countryName} this product is imported, from the {view.publisher}&apos;s monthly figures.
            </p>
          )}
          {canRequest ? (
            <Button className="mt-3" onClick={start} disabled={busy}>
              {busy ? 'Starting…' : lastProblem ? 'Try again' : `Show where in ${countryName}`}
            </Button>
          ) : null}
        </div>
      ) : null}

      {shown ? <RegionalResult result={shown} /> : null}

      {shown && !running && canRequest ? (
        <button type="button" onClick={start} disabled={busy} className="text-sm font-medium text-primary underline underline-offset-2">
          {busy ? 'Starting…' : 'Read the newest figures'}
        </button>
      ) : null}
      {error ? <p className="text-xs text-critical">{error}</p> : null}
    </div>
  );
}

function Headline({ result }: { result: RegionalDemandResultV1 }) {
  const rupees = useRupees();
  const { totals, period } = result;
  if (totals.importer_count != null) {
    const india = totals.india_importer_count != null ? ` ${totals.india_importer_count} of them are listed as buying it from India.` : '';
    return (
      <>
        {totals.importer_count} {totals.importer_count === 1 ? 'business is' : 'businesses are'} listed as importing this product in {period.label}.{india}
      </>
    );
  }
  const indiaValue = totals.india_value_usd ?? 0;
  const shareText = totals.india_share_percent != null ? ` That is ${formatPercent(totals.india_share_percent)} of all imports of it.` : '';
  const containerText = totals.container_share_percent != null && indiaValue > 0 ? ` ${formatPercent(totals.container_share_percent)} of India's came in containers by sea.` : '';
  return (
    <>
      {rupees(`${formatUsd(indiaValue)} of this product came from India in ${period.label}.`)}
      {shareText}
      {containerText}
    </>
  );
}

function RegionalResult({ result }: { result: RegionalDemandResultV1 }) {
  const { period } = result;
  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-[var(--color-border)] bg-surface-muted p-4 text-sm text-primary">
        <Headline result={result} />
      </p>
      {result.views.map((view) => (view.measure === 'importers' ? <ImporterTable key={view.kind} view={view} /> : <AreaTable key={view.kind} view={view} />))}
      <div className="space-y-1 text-xs text-[var(--color-text-muted)]">
        <p>
          Source:{' '}
          <a href={result.source.url} className="underline underline-offset-2" target="_blank" rel="noreferrer">
            {result.source.label}
          </a>
          , HS {result.hs6}, {period.label}. Read {new Date(result.source.retrieved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.
        </p>
        {result.notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
        <p>{result.source.attribution}</p>
        <RupeeRateNote />
      </div>
    </div>
  );
}

function ImporterTable({ view }: { view: ImporterView }) {
  const showIndia = view.areas.some((area) => area.india_importer_count !== null);
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-surface">
      <h3 className="border-b border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-primary">{view.title}</h3>
      {view.areas.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">No importers listed for this product.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="text-xs text-[var(--color-text-secondary)]">
              <tr>
                <th className="px-4 py-2 font-normal">#</th>
                <th className="px-2 py-2 font-normal">{view.kind === 'region' ? 'Region' : 'Province'}</th>
                <th className="px-2 py-2 text-right font-normal">Importers</th>
                {showIndia ? <th className="px-2 py-2 text-right font-normal">From India</th> : null}
                <th className="px-4 py-2 font-normal">Main towns</th>
              </tr>
            </thead>
            <tbody>
              {view.areas.map((area, index) => (
                <tr key={area.code} className="border-t border-[var(--color-border)]">
                  <td className="px-4 py-2 text-[var(--color-text-secondary)]">{index + 1}</td>
                  <td className="px-2 py-2 text-primary">{area.name}</td>
                  <td className="px-2 py-2 text-right text-primary">{area.importer_count}</td>
                  {showIndia ? <td className="px-2 py-2 text-right">{area.india_importer_count ?? '—'}</td> : null}
                  <td className="px-4 py-2 text-[var(--color-text-secondary)]">{area.towns.map((town) => town.toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase())).join(', ') || '—'}</td>
                </tr>
              ))}
              {view.others ? (
                <tr className="border-t border-[var(--color-border)] text-[var(--color-text-secondary)]">
                  <td className="px-4 py-2" />
                  <td className="px-2 py-2">{view.others.count} more</td>
                  <td className="px-2 py-2 text-right">{view.others.importer_count}</td>
                  {showIndia ? <td className="px-2 py-2" /> : null}
                  <td className="px-4 py-2" />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AreaTable({ view }: { view: RegionalView }) {
  const noun = view.kind === 'state' ? 'State' : 'Port';
  const showWorld = view.areas.some((area) => area.world_value_usd !== null);
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-surface">
      <h3 className="border-b border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-primary">{view.title}</h3>
      {view.areas.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">No imports recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="text-xs text-[var(--color-text-secondary)]">
              <tr>
                <th className="px-4 py-2 font-normal">#</th>
                <th className="px-2 py-2 font-normal">{noun}</th>
                <th className="px-2 py-2 text-right font-normal">From India</th>
                {showWorld ? <th className="px-2 py-2 text-right font-normal">India&apos;s share</th> : null}
                <th className="px-2 py-2 text-right font-normal">India, in containers</th>
                {showWorld ? <th className="px-4 py-2 text-right font-normal">All origins</th> : null}
              </tr>
            </thead>
            <tbody>
              {view.areas.map((area, index) => (
                <AreaRow key={area.code} area={area} rank={index + 1} showWorld={showWorld} />
              ))}
              {view.others ? (
                <tr className="border-t border-[var(--color-border)] text-[var(--color-text-secondary)]">
                  <td className="px-4 py-2" />
                  <td className="px-2 py-2">
                    {view.others.count} more {view.kind === 'state' ? 'states' : 'ports'}
                  </td>
                  <td className="px-2 py-2 text-right">{formatUsd(view.others.india_value_usd)}</td>
                  {showWorld ? <td className="px-2 py-2" /> : null}
                  <td className="px-2 py-2" />
                  {showWorld ? <td className="px-4 py-2 text-right">{view.others.world_value_usd != null ? formatUsd(view.others.world_value_usd) : '—'}</td> : null}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AreaRow({ area, rank, showWorld }: { area: RegionalArea; rank: number; showWorld: boolean }) {
  return (
    <tr className="border-t border-[var(--color-border)]">
      <td className="px-4 py-2 text-[var(--color-text-secondary)]">{rank}</td>
      <td className="px-2 py-2 text-primary">
        {area.name}
        {area.name !== area.code ? <span className="ml-1 text-xs text-[var(--color-text-muted)]">{area.code}</span> : null}
      </td>
      <td className="px-2 py-2 text-right text-primary">
        {area.india_value_usd > 0 ? formatUsd(area.india_value_usd) : '—'}
        {area.india_value_usd > 0 ? <div className="text-xs text-[var(--color-text-muted)]">{area.india_months} of 12 months</div> : null}
      </td>
      {showWorld ? <td className="px-2 py-2 text-right">{area.india_share_percent != null ? formatPercent(area.india_share_percent) : '—'}</td> : null}
      <td className="px-2 py-2 text-right">
        {area.container_value_usd > 0 ? (
          <>
            {formatUsd(area.container_value_usd)}
            <div className="text-xs text-[var(--color-text-muted)]">{tonnes(area.container_weight_kg)}</div>
          </>
        ) : (
          '—'
        )}
      </td>
      {showWorld ? <td className="px-4 py-2 text-right">{area.world_value_usd != null ? formatUsd(area.world_value_usd) : '—'}</td> : null}
    </tr>
  );
}
