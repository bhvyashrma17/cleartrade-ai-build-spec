'use client';

/**
 * Regional demand on the market page (D-033, D-048, docs/38 §1.3): where inside the market the
 * product arrives, or, where nothing official is published, where its buyers are likely to sit.
 *
 * Every market shows its evidence label first. A market with an official source shows the newest
 * completed run as the v2 view: the 10 largest areas, the ones holding 80% marked in words, the rest
 * summed; the figures are read by a background job that this component starts and follows. A market
 * without one shows its labelled estimate, or "Not needed" for a one-place market. Every figure names
 * its source.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, StatusChip } from '@/components/ui';
import { RupeeRateNote, useRupees } from '@/components/fx/RupeeRate';
import { ApiClientError, apiGet, apiPost } from '@/lib/api-client';
import { formatPercent, formatUsd } from '@/lib/demand-discovery-v5/explain';
import type { RegionalArea } from '@/lib/regional-demand/census';
import type { RegionalEstimate } from '@/lib/regional-demand/estimate';
import type { RegionalDemandView, RegionalEvidenceInfo } from '@/lib/regional-demand/service';
import type { CoreSummary, PresentedImporterView, PresentedRegionalResult, PresentedValueView, RankedBy, RankedMeta, RegionalEvidence } from '@/lib/regional-demand/view';
import type { SingleResponse, StatusIconName, StatusTone } from '@/types';

const POLL_MS = 4000;

const tonnes = (kg: number) => {
  const t = kg / 1000;
  return `${t >= 100 ? Math.round(t).toLocaleString('en-US') : Number(t.toFixed(1)).toLocaleString('en-US')} t`;
};

/** Label and icon carry the meaning; the tone only reinforces it (docs/10 §4). */
const EVIDENCE_CHIP: Record<RegionalEvidence, { tone: StatusTone; icon: StatusIconName }> = {
  your_product: { tone: 'positive', icon: 'check' },
  product_group: { tone: 'info', icon: 'check' },
  traders: { tone: 'info', icon: 'dot' },
  all_goods: { tone: 'neutral', icon: 'dot' },
  estimate: { tone: 'warning', icon: 'alert' },
  not_needed: { tone: 'neutral', icon: 'dot' },
};

const RANKED_BY: Record<RankedBy, string> = {
  all_origins_value: 'Ranked by imports from all origins',
  india_value: 'Ranked by imports from India',
  importers: 'Ranked by the number of importers',
  city_population: 'Ranked by the population of the main cities, not by imports',
};

const MEASURE: Record<RankedBy, string> = {
  all_origins_value: 'the product’s imports',
  india_value: 'India’s shipments of it',
  importers: 'the importers listed',
  city_population: 'the main cities’ population',
};

/** What the 80% line says: how many areas it takes, or why it cannot be placed. */
export function coreSentence(core: CoreSummary, rankedBy: RankedBy, listed: number): string | null {
  const measure = MEASURE[rankedBy];
  if (core.listed_share_percent === null) return null;
  if (core.count === null) return `The ${listed} listed hold ${formatPercent(core.listed_share_percent)} of ${measure}; the rest are summed, so the 80% line cannot be placed.`;
  if (core.count <= listed) return `The first ${core.count === 1 ? 'one holds' : `${core.count} hold`} 80% or more of ${measure}, marked “In the 80%”.`;
  return `It takes ${core.count} to reach 80% of ${measure}; the ${listed} listed hold ${formatPercent(core.listed_share_percent)}.`;
}

function EvidenceLine({ evidence }: { evidence: RegionalEvidenceInfo }) {
  const chip = EVIDENCE_CHIP[evidence.key];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusChip label={evidence.label} tone={chip.tone} icon={chip.icon} size="sm" />
      <span className="text-xs text-[var(--color-text-secondary)]">{evidence.meaning}</span>
    </div>
  );
}

function CoreMark({ meta }: { meta: RankedMeta | undefined }) {
  if (!meta?.in_core) return null;
  return <span className="ml-2 whitespace-nowrap rounded-sm border border-line-strong px-1 py-0.5 text-[11px] font-medium text-primary">In the 80%</span>;
}

function RankingCaption({ rankedBy, core, listed }: { rankedBy: RankedBy; core: CoreSummary; listed: number }) {
  const sentence = coreSentence(core, rankedBy, listed);
  return (
    <p className="border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-secondary)]">
      {RANKED_BY[rankedBy]}.{sentence ? ` ${sentence}` : ''}
    </p>
  );
}

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
    if (!view.estimate || !view.evidence) {
      return (
        <p className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-surface p-4 text-sm text-[var(--color-text-secondary)]">
          No regional view is available for {countryName}.
        </p>
      );
    }
    return (
      <div className="space-y-4">
        <EvidenceLine evidence={view.evidence} />
        <EstimateResult estimate={view.estimate} countryName={countryName} />
      </div>
    );
  }

  const shown = view.shown?.result ?? null;
  const lastProblem = view.latest && (view.latest.status === 'failed' || view.latest.status === 'unavailable') ? view.latest : null;

  return (
    <div className="space-y-4">
      {view.evidence ? <EvidenceLine evidence={view.evidence} /> : null}
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

function Headline({ result }: { result: PresentedRegionalResult }) {
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

function RegionalResult({ result }: { result: PresentedRegionalResult }) {
  const { period } = result;
  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-[var(--color-border)] bg-surface-muted p-4 text-sm text-primary">
        <Headline result={result} />
      </p>
      {result.views.map((view) => (view.measure === 'importers' ? <ImporterTable key={view.kind} view={view} /> : <AreaTable key={view.kind} view={view as PresentedValueView} />))}
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

function ImporterTable({ view }: { view: PresentedImporterView }) {
  const showIndia = view.areas.some((area) => area.india_importer_count !== null);
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-surface">
      <h3 className="border-b border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-primary">{view.title}</h3>
      {view.areas.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">No importers listed for this product.</p>
      ) : (
        <>
          <RankingCaption rankedBy={view.ranked_by} core={view.core} listed={view.areas.length} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-sm">
              <thead className="text-xs text-[var(--color-text-secondary)]">
                <tr>
                  <th className="px-4 py-2 font-normal">#</th>
                  <th className="px-2 py-2 font-normal">{view.kind === 'region' ? 'Region' : 'Province'}</th>
                  <th className="px-2 py-2 text-right font-normal">Importers</th>
                  <th className="px-2 py-2 text-right font-normal">Share</th>
                  {showIndia ? <th className="px-2 py-2 text-right font-normal">From India</th> : null}
                  <th className="px-4 py-2 font-normal">Main towns</th>
                </tr>
              </thead>
              <tbody>
                {view.areas.map((area, index) => (
                  <tr key={area.code} className="border-t border-[var(--color-border)]">
                    <td className="px-4 py-2 text-[var(--color-text-secondary)]">{index + 1}</td>
                    <td className="px-2 py-2 text-primary">
                      {area.name}
                      <CoreMark meta={view.ranked[index]} />
                    </td>
                    <td className="px-2 py-2 text-right text-primary">{area.importer_count}</td>
                    <td className="px-2 py-2 text-right">{view.ranked[index]?.share_percent != null ? formatPercent(view.ranked[index]!.share_percent!) : '—'}</td>
                    {showIndia ? <td className="px-2 py-2 text-right">{area.india_importer_count ?? '—'}</td> : null}
                    <td className="px-4 py-2 text-[var(--color-text-secondary)]">{area.towns.map((town) => town.toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase())).join(', ') || '—'}</td>
                  </tr>
                ))}
                {view.others ? (
                  <tr className="border-t border-[var(--color-border)] text-[var(--color-text-secondary)]">
                    <td className="px-4 py-2" />
                    <td className="px-2 py-2">{view.others.count} more, summed</td>
                    <td className="px-2 py-2 text-right">{view.others.importer_count}</td>
                    <td className="px-2 py-2" />
                    {showIndia ? <td className="px-2 py-2" /> : null}
                    <td className="px-4 py-2" />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function AreaTable({ view }: { view: PresentedValueView }) {
  const noun = view.kind === 'state' ? 'State' : 'Port';
  const showWorld = view.areas.some((area) => area.world_value_usd !== null);
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-surface">
      <h3 className="border-b border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-primary">{view.title}</h3>
      {view.areas.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">No imports recorded.</p>
      ) : (
        <>
          <RankingCaption rankedBy={view.ranked_by} core={view.core} listed={view.areas.length} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs text-[var(--color-text-secondary)]">
                <tr>
                  <th className="px-4 py-2 font-normal">#</th>
                  <th className="px-2 py-2 font-normal">{noun}</th>
                  {showWorld ? <th className="px-2 py-2 text-right font-normal">All origins</th> : null}
                  <th className="px-2 py-2 text-right font-normal">From India</th>
                  {showWorld ? <th className="px-2 py-2 text-right font-normal">India&apos;s share</th> : null}
                  <th className="px-4 py-2 text-right font-normal">India, in containers</th>
                </tr>
              </thead>
              <tbody>
                {view.areas.map((area, index) => (
                  <AreaRow key={area.code} area={area} meta={view.ranked[index]} showWorld={showWorld} />
                ))}
                {view.others ? (
                  <tr className="border-t border-[var(--color-border)] text-[var(--color-text-secondary)]">
                    <td className="px-4 py-2" />
                    <td className="px-2 py-2">
                      {view.others.count} more {view.kind === 'state' ? 'states' : 'ports'}, summed
                    </td>
                    {showWorld ? <td className="px-2 py-2 text-right">{view.others.world_value_usd != null ? formatUsd(view.others.world_value_usd) : '—'}</td> : null}
                    <td className="px-2 py-2 text-right">{formatUsd(view.others.india_value_usd)}</td>
                    {showWorld ? <td className="px-2 py-2" /> : null}
                    <td className="px-4 py-2" />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function AreaRow({ area, meta, showWorld }: { area: RegionalArea; meta: RankedMeta | undefined; showWorld: boolean }) {
  return (
    <tr className="border-t border-[var(--color-border)]">
      <td className="px-4 py-2 text-[var(--color-text-secondary)]">{meta?.rank ?? ''}</td>
      <td className="px-2 py-2 text-primary">
        {area.name}
        {area.name !== area.code ? <span className="ml-1 text-xs text-[var(--color-text-muted)]">{area.code}</span> : null}
        <CoreMark meta={meta} />
      </td>
      {showWorld ? (
        <td className="px-2 py-2 text-right">
          {area.world_value_usd != null ? formatUsd(area.world_value_usd) : '—'}
          {meta?.share_percent != null ? <div className="text-xs text-[var(--color-text-muted)]">{formatPercent(meta.share_percent)}</div> : null}
        </td>
      ) : null}
      <td className="px-2 py-2 text-right text-primary">
        {area.india_value_usd > 0 ? formatUsd(area.india_value_usd) : '—'}
        {area.india_value_usd > 0 ? <div className="text-xs text-[var(--color-text-muted)]">{area.india_months} of 12 months</div> : null}
      </td>
      {showWorld ? <td className="px-2 py-2 text-right">{area.india_share_percent != null ? formatPercent(area.india_share_percent) : '—'}</td> : null}
      <td className="px-4 py-2 text-right">
        {area.container_value_usd > 0 ? (
          <>
            {formatUsd(area.container_value_usd)}
            <div className="text-xs text-[var(--color-text-muted)]">{tonnes(area.container_weight_kg)}</div>
          </>
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}

const population = (value: number) => (value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} million` : `${Math.round(value / 1000).toLocaleString('en-US')} thousand`);

function Gateways({ estimate }: { estimate: RegionalEstimate }) {
  const ports = estimate.gateways.filter((gateway) => gateway.kind === 'port');
  const airports = estimate.gateways.filter((gateway) => gateway.kind === 'airport');
  if (ports.length === 0 && airports.length === 0) return <p className="text-sm text-[var(--color-text-secondary)]">No ports or airports are recorded for this market yet.</p>;
  return (
    <dl className="space-y-1 text-sm">
      {ports.length ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-[var(--color-text-secondary)]">Ports:</dt>
          <dd className="text-primary">{ports.map((gateway) => gateway.name).join(', ')}</dd>
        </div>
      ) : null}
      {airports.length ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-[var(--color-text-secondary)]">Airports:</dt>
          <dd className="text-primary">{airports.map((gateway) => (gateway.iata ? `${gateway.name} (${gateway.iata})` : gateway.name)).join(', ')}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/** The labelled estimate, or "Not needed" for a one-place market (docs/38 §1.3). */
export function EstimateResult({ estimate, countryName }: { estimate: RegionalEstimate; countryName: string }) {
  const regions = estimate.areas.some((area) => area.kind === 'region');
  return (
    <div className="space-y-4">
      {estimate.evidence === 'not_needed' ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-surface-muted p-4 text-sm text-primary">
          <p>One search area: buyers anywhere in {countryName} can be searched as one market.</p>
          {estimate.areas[0] ? <p className="mt-1 text-[var(--color-text-secondary)]">Main city: {estimate.areas[0].name}{estimate.areas[0].hubs.length ? ` (with ${estimate.areas[0].hubs.join(', ')})` : ''}.</p> : null}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-surface">
          <h3 className="border-b border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-primary">{estimate.title}</h3>
          {estimate.areas.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">No city of 300,000 or more is recorded for this market.</p>
          ) : (
            <>
              <RankingCaption rankedBy={estimate.ranked_by} core={estimate.core} listed={estimate.areas.length} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[30rem] text-left text-sm">
                  <thead className="text-xs text-[var(--color-text-secondary)]">
                    <tr>
                      <th className="px-4 py-2 font-normal">#</th>
                      <th className="px-2 py-2 font-normal">{regions ? 'Region' : 'City'}</th>
                      <th className="px-2 py-2 font-normal">{regions ? 'Its main cities' : 'Region'}</th>
                      <th className="px-4 py-2 text-right font-normal">Population, share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estimate.areas.map((area, index) => (
                      <tr key={area.code} className="border-t border-[var(--color-border)]">
                        <td className="px-4 py-2 text-[var(--color-text-secondary)]">{index + 1}</td>
                        <td className="px-2 py-2 text-primary">
                          {area.name}
                          {!regions && area.hubs.length ? <span className="ml-1 text-xs text-[var(--color-text-muted)]">with {area.hubs.join(', ')}</span> : null}
                          <CoreMark meta={estimate.ranked[index]} />
                        </td>
                        <td className="px-2 py-2 text-[var(--color-text-secondary)]">{regions ? area.hubs.join(', ') : area.region?.name ?? '—'}</td>
                        <td className="px-4 py-2 text-right">
                          {population(area.population)}
                          {estimate.ranked[index]?.share_percent != null ? <div className="text-xs text-[var(--color-text-muted)]">{formatPercent(estimate.ranked[index]!.share_percent!)}</div> : null}
                        </td>
                      </tr>
                    ))}
                    {estimate.others ? (
                      <tr className="border-t border-[var(--color-border)] text-[var(--color-text-secondary)]">
                        <td className="px-4 py-2" />
                        <td className="px-2 py-2">{estimate.others.count} more, summed</td>
                        <td className="px-2 py-2" />
                        <td className="px-4 py-2 text-right">{population(estimate.others.population)}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
      <div className="rounded-lg border border-[var(--color-border)] bg-surface p-4">
        <h3 className="mb-2 text-sm font-semibold text-primary">Gateways</h3>
        <Gateways estimate={estimate} />
      </div>
      <div className="space-y-1 text-xs text-[var(--color-text-muted)]">
        {estimate.notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
        <p>
          Source:{' '}
          <a href={estimate.source.url} className="underline underline-offset-2" target="_blank" rel="noreferrer">
            {estimate.source.label}
          </a>
          .
        </p>
      </div>
    </div>
  );
}
