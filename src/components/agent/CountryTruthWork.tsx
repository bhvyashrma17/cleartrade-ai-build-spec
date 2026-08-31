'use client';

/**
 * The agent's Country Truth surface, replacing the three-country pilot picker.
 *
 * What changed and why: the old component rendered Germany/UAE/USA as checkboxes and posted
 * their NAMES to a request path that resolved them through an alias table. That predates Phase
 * 1F/1G, where the candidate markets are derived from a global screen and frozen into a
 * shortlist. An agent choosing countries by hand would reintroduce exactly the selection bias
 * screening exists to remove, so this component has no country input at all: it names a
 * completed screening run and the server reads the shortlist from it.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Card, EmptyState, SectionHeading, StatusChip } from '@/components/ui';
import { ApiClientError, apiGet, apiPost } from '@/lib/api-client';
import type { AgentProductView } from '@/lib/country-discovery/service';

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
      setError(caught instanceof ApiClientError ? caught.message : 'Could not load Country Truth tasks.');
    }
  }, [exporterOrgId]);

  useEffect(() => { void load(); }, [load]);

  async function requestDeep(view: AgentProductView) {
    if (!view.screening.screening_run_id) return;
    setBusy(view.product.id);
    setError(null);
    setNotice(null);
    try {
      // The canonical Phase 1H path: a product and a completed screening run, no country list.
      await apiPost(`/api/v1/exporters/${exporterOrgId}/deep-country-truth`, {
        product_id: view.product.id,
        screening_run_id: view.screening.screening_run_id,
      });
      setNotice(`Detailed analysis requested for ${view.product.name}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not request detailed analysis.');
    } finally {
      setBusy(null);
    }
  }

  if (!views) return <p className="text-sm text-slate">Loading Country Truth tasks…</p>;
  if (!views.length) return <EmptyState title="No products" description="This exporter has no products to analyse yet." bordered />;

  return (
    <div className="space-y-4">
      {notice ? <StatusChip label={notice} tone="positive" icon="check" size="sm" /> : null}
      {error ? <p className="text-sm text-[var(--crit)]" role="alert">{error}</p> : null}
      {views.map((view) => (
        <Card key={view.product.id} as="section">
          <SectionHeading
            title={view.product.name}
            description={view.product.hs6 ? `HS ${view.product.hs6}` : 'No confirmed HS classification'}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusChip
              label={`Market scan: ${view.screening.state.replace('_', ' ')}`}
              tone={view.screening.state === 'completed' ? 'positive' : view.screening.state === 'failed' ? 'critical' : 'info'}
              icon={view.screening.state === 'completed' ? 'check' : view.screening.state === 'failed' ? 'alert' : 'clock'}
              size="sm"
            />
            <StatusChip
              label={`Detailed analysis: ${view.deep_analysis.state.replace('_', ' ')}`}
              tone={view.deep_analysis.state === 'completed' ? 'positive' : view.deep_analysis.state === 'failed' ? 'critical' : 'info'}
              icon={view.deep_analysis.state === 'completed' ? 'check' : view.deep_analysis.state === 'failed' ? 'alert' : 'clock'}
              size="sm"
            />
            {view.screening.shortlist_size ? (
              <StatusChip label={`${view.screening.shortlist_size} markets shortlisted`} tone="neutral" icon="dot" size="sm" />
            ) : null}
          </div>

          {view.deep_request_ready && view.deep_analysis.state === 'not_started' ? (
            <div className="mt-4">
              <Button onClick={() => requestDeep(view)} disabled={busy === view.product.id} size="sm">
                {busy === view.product.id ? 'Requesting…' : 'Request detailed analysis'}
              </Button>
              <p className="mt-2 text-xs text-muted">
                Analyses every market the completed screen shortlisted. The market set comes from the
                frozen screening run and cannot be edited here.
              </p>
            </div>
          ) : null}

          {view.tasks.length ? (
            <div className="mt-5">
              <h4 className="text-sm font-medium text-bone">
                ClearTrade actions outstanding ({view.tasks.length})
              </h4>
              <ul className="mt-2 space-y-2">
                {view.tasks.map((task) => (
                  <li key={task.code} className="border-b border-line py-2 last:border-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm text-bone">{task.label}</span>
                      <span className="text-xs text-muted">{task.country}</span>
                    </div>
                    <p className="text-xs text-slate">{task.detail}</p>
                    <p className="text-xs text-muted">Unlocks: {task.unlocks}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : view.deep_analysis.state === 'completed' ? (
            <p className="mt-4 text-sm text-slate">No outstanding ClearTrade actions for this product.</p>
          ) : null}

          {view.deep_analysis.assessed > 0 ? (
            <p className="mt-4 text-xs text-muted">
              <Link href={`/app/products/${view.product.id}/markets`} className="underline">
                {view.deep_analysis.assessed} markets analysed
              </Link>
            </p>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
