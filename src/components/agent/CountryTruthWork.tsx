'use client';

/**
 * The agent's Demand Discovery surface for one exporter.
 *
 * What this replaces: a single continuous list of every ClearTrade-owned action for every
 * analysed market — up to eighty entries for one product — headed "ClearTrade actions
 * outstanding (80)". Reading it top to bottom had an agent sourcing freight quotes for Angola
 * before the exporter had shown any interest in Angola.
 *
 * The shape now is summary → prioritised queue → drill-down:
 *
 *   1. A compact product summary: where the scan is, the top market, what is outstanding.
 *   2. The leading five markets, with a one-line status saying what each one NEEDS.
 *   3. A work queue ordered commercially (selected market first, then marked, then top-ranked),
 *      filterable, with the backlog collapsed rather than demanded.
 *
 * Nothing about the intelligence changed. This is the same data, ordered by what an operator
 * should do next instead of by what happens to exist in the database.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, buttonClass, Card, EmptyState, SectionHeading, StatusChip } from '@/components/ui';
import { MarketTable, SummaryHeader, WorkSummaryPanel, type MarketRow } from '@/components/discovery';
import { ApiClientError, apiGet, apiPost } from '@/lib/api-client';
import type { AgentProductView } from '@/lib/country-discovery/service';
import { CATEGORY_LABELS, PRIORITY_LABELS, type WorkCategory, type WorkPriority, type WorkTask } from '@/lib/country-discovery/work-queue';

const PRIORITY_TONE: Record<WorkPriority, { tone: 'positive' | 'info' | 'neutral'; icon: 'check' | 'clock' | 'dot' }> = {
  selected: { tone: 'positive', icon: 'check' },
  marked: { tone: 'info', icon: 'clock' },
  top_ranked: { tone: 'info', icon: 'clock' },
  backlog: { tone: 'neutral', icon: 'dot' },
};

export function CountryTruthWork({ exporterOrgId }: { exporterOrgId: string }) {
  const [views, setViews] = useState<AgentProductView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiGet<{ data: AgentProductView[] }>(`/api/v1/exporters/${exporterOrgId}/country-truth-work`);
      setViews(response.data);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not load Demand Discovery.');
    }
  }, [exporterOrgId]);

  useEffect(() => { void load(); }, [load]);

  async function requestDeep(view: AgentProductView) {
    if (!view.screening.screening_run_id) return;
    setBusy(view.product.id); setError(null); setNotice(null);
    try {
      // The canonical Phase 1H path: a product and a completed screening run, no country list.
      await apiPost(`/api/v1/exporters/${exporterOrgId}/deep-country-truth`, {
        product_id: view.product.id, screening_run_id: view.screening.screening_run_id,
      });
      setNotice(`Detailed analysis requested for ${view.product.name}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not request detailed analysis.');
    } finally { setBusy(null); }
  }

  if (!views) return <p className="text-sm text-slate">Loading Demand Discovery…</p>;
  if (!views.length) return <EmptyState title="No products" description="This exporter has no products to analyse yet." bordered />;

  return (
    <div className="space-y-6">
      {notice ? <StatusChip label={notice} tone="positive" icon="check" size="sm" /> : null}
      {error ? <p className="text-sm text-[var(--crit)]" role="alert">{error}</p> : null}
      {views.map((view) => (
        <ProductPanel
          key={view.product.id}
          view={view}
          busy={busy === view.product.id}
          onRequestDeep={() => requestDeep(view)}
        />
      ))}
    </div>
  );
}

function ProductPanel({ view, busy, onRequestDeep }: { view: AgentProductView; busy: boolean; onRequestDeep: () => void }) {
  const [showQueue, setShowQueue] = useState(false);
  const { summary, queue_summary: work } = view;

  const marketRows: MarketRow[] = view.top_markets.map((market) => ({
    ...market,
    action: (
      <Link
        href={`/app/products/${view.product.id}/markets/${market.country_code}`}
        className="text-sm text-slate hover:text-bone hover:underline"
      >
        Open
      </Link>
    ),
  }));

  return (
    <div className="space-y-4">
      <SummaryHeader
        title={view.product.name}
        subtitle={view.product.hs6 ? `Customs code ${view.product.hs6}` : 'No confirmed HS classification'}
        stats={[
          { label: 'Market scan', value: <StageValue state={view.screening.state} /> },
          { label: 'Deep analysis', value: <StageValue state={view.deep_analysis.state} /> },
          { label: 'Markets analysed', value: summary.markets_analysed || '—' },
          summary.top_market
            ? {
                label: 'Top market',
                value: summary.top_market.country,
                hint: `Attractiveness ${summary.top_market.attractiveness ?? '—'} · ${summary.top_market.confidence}% evidence confidence`,
              }
            : { label: 'Top market', value: '—' },
        ]}
        actions={
          view.deep_request_ready && view.deep_analysis.state === 'not_started' ? (
            <Button size="sm" onClick={onRequestDeep} disabled={busy}>
              {busy ? 'Requesting…' : 'Request detailed analysis'}
            </Button>
          ) : null
        }
      />

      {summary.selected_market ? (
        <StatusChip label={`Exporter selected ${summary.selected_market.country}`} tone="positive" icon="check" size="sm" />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <WorkSummaryPanel
          total={work.total}
          needsAttention={work.needs_attention}
          byCategory={work.by_category}
          action={
            work.total > 0 ? (
              <Button size="sm" variant="secondary" onClick={() => setShowQueue((open) => !open)} aria-expanded={showQueue}>
                {showQueue ? 'Hide tasks' : 'View tasks'}
              </Button>
            ) : null
          }
        />
        <Card as="section">
          <h3 className="text-sm font-medium text-bone">Exporter inputs</h3>
          <p className="mt-1 text-2xl font-medium text-bone">
            {summary.exporter_inputs_missing} <span className="text-sm font-normal text-slate">missing</span>
          </p>
          <p className="mt-2 text-xs text-muted">
            These belong to the exporter and are requested on their own product page. They are listed
            here for context, not as ClearTrade work.
          </p>
        </Card>
      </div>

      {marketRows.length ? (
        <Card as="section">
          <SectionHeading
            title="Top markets"
            description="The leading markets from the latest analysis, with what each still needs."
          />
          <div className="mt-3">
            <MarketTable rows={marketRows} caption={`Top markets for ${view.product.name}`} />
          </div>
          {summary.markets_analysed > marketRows.length ? (
            <div className="mt-3">
              <Link href={`/app/products/${view.product.id}/markets`} className={buttonClass('ghost', 'sm')}>
                View all {summary.markets_analysed} markets
              </Link>
            </div>
          ) : null}
        </Card>
      ) : null}

      {showQueue ? <WorkQueue tasks={view.queue} productId={view.product.id} /> : null}
    </div>
  );
}

function StageValue({ state }: { state: string }) {
  const label = state.replaceAll('_', ' ');
  const tone = state === 'completed' ? 'positive' : state === 'failed' ? 'critical' : state === 'not_started' ? 'neutral' : 'info';
  const icon = state === 'completed' ? 'check' : state === 'failed' ? 'alert' : state === 'not_started' ? 'dot' : 'clock';
  return <StatusChip label={label.charAt(0).toUpperCase() + label.slice(1)} tone={tone} icon={icon} size="sm" />;
}

/**
 * The queue itself: a table an operator can filter, not a wall of prose.
 *
 * The backlog is present but collapsed by default. It is real work, and hiding it would be
 * dishonest — but presenting it as due alongside the selected market is what made the original
 * surface unusable.
 */
function WorkQueue({ tasks, productId }: { tasks: readonly WorkTask[]; productId: string }) {
  const [market, setMarket] = useState('all');
  const [category, setCategory] = useState<'all' | WorkCategory>('all');
  const [showBacklog, setShowBacklog] = useState(false);

  const markets = useMemo(
    () => [...new Map(tasks.map((task) => [task.country_code, task.country])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [tasks],
  );
  const categories = useMemo(() => [...new Set(tasks.map((task) => task.category))], [tasks]);

  const visible = tasks.filter((task) =>
    (market === 'all' || task.country_code === market)
    && (category === 'all' || task.category === category)
    && (showBacklog || task.priority !== 'backlog'));

  const hiddenBacklog = tasks.filter((task) => task.priority === 'backlog').length;

  return (
    <Card as="section">
      <SectionHeading
        title="Work queue"
        description="Ordered by commercial relevance: the selected market first, then markets ClearTrade has marked, then the top-ranked."
      />

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="queue-market" className="block text-xs text-muted">Market</label>
          <select
            id="queue-market" value={market} onChange={(event) => setMarket(event.target.value)}
            className="mt-1 rounded-sm border border-line-strong bg-surface px-2 py-1.5 text-sm text-bone"
          >
            <option value="all">All markets</option>
            {markets.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="queue-category" className="block text-xs text-muted">Task type</label>
          <select
            id="queue-category" value={category} onChange={(event) => setCategory(event.target.value as 'all' | WorkCategory)}
            className="mt-1 rounded-sm border border-line-strong bg-surface px-2 py-1.5 text-sm text-bone"
          >
            <option value="all">All types</option>
            {categories.map((entry) => <option key={entry} value={entry}>{CATEGORY_LABELS[entry]}</option>)}
          </select>
        </div>
        {hiddenBacklog > 0 ? (
          <label className="flex items-center gap-2 pb-1.5 text-sm text-slate">
            <input type="checkbox" checked={showBacklog} onChange={(event) => setShowBacklog(event.target.checked)} />
            Show {hiddenBacklog} backlog {hiddenBacklog === 1 ? 'task' : 'tasks'}
          </label>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="Nothing matches these filters" description="Clear a filter, or show the backlog." bordered />
        </div>
      ) : (
        <>
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <caption className="sr-only">Outstanding ClearTrade tasks, highest priority first</caption>
              <thead>
                <tr className="border-b border-line-strong">
                  <th scope="col" className="py-2.5 text-left text-xs font-medium text-muted">Priority</th>
                  <th scope="col" className="py-2.5 text-left text-xs font-medium text-muted">Market</th>
                  <th scope="col" className="py-2.5 text-left text-xs font-medium text-muted">Task</th>
                  <th scope="col" className="py-2.5 text-left text-xs font-medium text-muted">Unblocks</th>
                  <th scope="col" className="w-20 py-2.5 text-right text-xs font-medium text-muted"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((task) => (
                  <tr key={task.code} className="border-b border-line last:border-0">
                    <td className="py-3 align-top">
                      <StatusChip
                        label={PRIORITY_LABELS[task.priority]}
                        tone={PRIORITY_TONE[task.priority].tone}
                        icon={PRIORITY_TONE[task.priority].icon}
                        size="sm"
                      />
                    </td>
                    <td className="py-3 align-top text-bone">
                      {task.country}
                      <span className="block text-xs text-muted">#{task.rank}</span>
                    </td>
                    <td className="py-3 align-top">
                      <span className="text-bone">{task.label}</span>
                      <span className="block text-xs text-muted">{task.detail}</span>
                    </td>
                    <td className="py-3 align-top text-xs text-slate">{task.unlocks.join(', ')}</td>
                    <td className="py-3 text-right align-top">
                      <Link href={`/app/products/${productId}/markets/${task.country_code}`} className="text-sm text-slate hover:text-bone hover:underline">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="mt-4 space-y-3 md:hidden">
            {visible.map((task) => (
              <li key={task.code} className="border-b border-line pb-3 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip
                    label={PRIORITY_LABELS[task.priority]}
                    tone={PRIORITY_TONE[task.priority].tone}
                    icon={PRIORITY_TONE[task.priority].icon}
                    size="sm"
                  />
                  <span className="text-xs text-muted">{task.country} · #{task.rank}</span>
                </div>
                <p className="mt-1 text-sm text-bone">{task.label}</p>
                <p className="text-xs text-muted">{task.detail}</p>
                <Link href={`/app/products/${productId}/markets/${task.country_code}`} className="mt-1 inline-block text-sm text-slate hover:text-bone hover:underline">
                  Open {task.country}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
