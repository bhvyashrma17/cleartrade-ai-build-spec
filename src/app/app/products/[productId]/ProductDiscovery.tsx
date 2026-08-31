'use client';

/**
 * Product readiness + "Find best export markets".
 *
 * Progress is described in stages that are actually true of the backend
 * ("Scanning global trade markets", "Building shortlist") and never as a percentage: the
 * screening job publishes a status, not a completion fraction, and inventing `63%` would be a
 * number the system does not have.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, buttonClass, Card, SectionHeading, StatusChip } from '@/components/ui';
import { ApiClientError, apiGet, apiPost } from '@/lib/api-client';
import type { ProductDiscoveryState } from '@/lib/country-discovery/service';
import type { RequirementLevel } from '@/lib/country-discovery/readiness';

const LEVEL_COPY: Record<RequirementLevel, { heading: string; note: string }> = {
  blocking: { heading: 'Needed before markets can be compared', note: 'ClearTrade cannot compare markets until this is settled.' },
  improves_now: { heading: 'Would improve your analysis now', note: 'Your market analysis will run without these, but parts of it will stay unavailable until they are on file.' },
  later: { heading: 'Useful later', note: 'Not needed to compare markets. These come into play when you are costing a shipment.' },
};

/** Only ever the states the backend actually reports. No fabricated intermediate progress. */
const SCREENING_COPY: Record<ProductDiscoveryState['screening']['state'], string> = {
  not_started: '',
  queued: 'Preparing to scan world trade data…',
  running: 'Scanning global trade markets and checking reporting freshness…',
  completed: '',
  failed: '',
};

export function ProductDiscovery({ exporterOrgId, initial }: { exporterOrgId: string; initial: ProductDiscoveryState }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/v1/exporters/${exporterOrgId}/products/${initial.product.id}`;

  const refresh = useCallback(async () => {
    try {
      setState(await apiGet<ProductDiscoveryState>(`${base}/market-discovery`));
    } catch {
      // A failed refresh must not blank the page; the last good state stays on screen and the
      // next tick tries again.
    }
  }, [base]);

  const inFlight = state.screening.state === 'queued' || state.screening.state === 'running';
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [inFlight, refresh]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`${base}/market-discovery`, {});
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not start the market scan.');
    } finally {
      setBusy(false);
    }
  }

  const { readiness } = state;
  const groups: RequirementLevel[] = ['blocking', 'improves_now', 'later'];

  return (
    <div className="space-y-6">
      <Card ticked>
        <SectionHeading title="Ready to find markets?" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {readiness.can_discover ? (
            <StatusChip label="HS classification confirmed" tone="positive" icon="check" />
          ) : (
            <StatusChip label="HS classification pending" tone="warning" icon="clock" />
          )}
          {readiness.missing_now > 0 ? (
            <StatusChip label={`${readiness.missing_now} commercial ${readiness.missing_now === 1 ? 'detail' : 'details'} missing`} tone="neutral" icon="dot" />
          ) : (
            <StatusChip label="Commercial details complete" tone="positive" icon="check" />
          )}
        </div>
        <p className="mt-3 text-sm text-slate">
          {readiness.can_discover
            ? readiness.missing_now > 0
              ? 'You can find markets now. Adding the missing details later will unlock more of each market’s analysis.'
              : 'You can find markets now.'
            : readiness.blocked_because}
        </p>

        {state.screening.state === 'completed' ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-bone">
              {state.screening.universe_size
                ? `${state.screening.universe_size} markets assessed. `
                : ''}
              {state.screening.shortlist_size
                ? `${state.screening.shortlist_size} shortlisted for detailed analysis.`
                : 'Shortlist ready.'}
            </p>
            <Link href={`/app/products/${initial.product.id}/markets`} className={buttonClass('primary', 'md')}>
              View recommended markets
            </Link>
          </div>
        ) : inFlight ? (
          <div className="mt-5" role="status" aria-live="polite">
            <p className="text-sm text-bone">{SCREENING_COPY[state.screening.state]}</p>
            <p className="mt-1 text-xs text-muted">
              This takes a few minutes. You can leave this page — the scan keeps running.
            </p>
          </div>
        ) : state.screening.state === 'failed' ? (
          <div className="mt-5 space-y-3">
            <StatusChip label="Scan did not finish" tone="critical" icon="alert" />
            <p className="text-sm text-slate">{state.screening.failure_reason}</p>
            <Button onClick={start} disabled={busy}>Try again</Button>
          </div>
        ) : (
          <div className="mt-5">
            {state.viewer_can_start_screening ? (
              <>
                <Button onClick={start} disabled={busy || !readiness.can_discover}>
                  {busy ? 'Starting…' : 'Find best export markets'}
                </Button>
                {!readiness.can_discover ? (
                  <p className="mt-2 text-xs text-muted">{readiness.blocked_because}</p>
                ) : null}
              </>
            ) : (
              /* A global scan reads every reporting market and is run by ClearTrade. Showing the
                 exporter a button that the server will refuse would be worse than showing none. */
              <>
                <StatusChip label="ClearTrade runs this scan" tone="info" icon="clock" />
                <p className="mt-2 text-sm text-slate">
                  {readiness.can_discover
                    ? 'Your ClearTrade agent starts the global market scan for this product. You will see the recommended markets here as soon as it finishes.'
                    : readiness.blocked_because}
                </p>
              </>
            )}
          </div>
        )}
        {error ? <p className="mt-3 text-sm text-[var(--crit)]" role="alert">{error}</p> : null}
      </Card>

      {state.deep_analysis.state !== 'not_started' ? (
        <Card>
          <SectionHeading title="Detailed market analysis" />
          <p className="mt-2 text-sm text-slate">
            {state.deep_analysis.state === 'queued' || state.deep_analysis.state === 'running'
              ? 'ClearTrade is gathering detailed evidence for your shortlisted markets.'
              : state.deep_analysis.state === 'failed'
                ? 'The detailed analysis did not finish. ClearTrade has been notified.'
                : `${state.deep_analysis.assessed} ${state.deep_analysis.assessed === 1 ? 'market has' : 'markets have'} detailed analysis${state.deep_analysis.state === 'partial' ? ', with some evidence still outstanding' : ''}.`}
          </p>
        </Card>
      ) : null}

      <Card>
        <SectionHeading title="Product information" description="What ClearTrade knows about this product, and what would sharpen the answer." />
        <div className="mt-4 space-y-5">
          {groups.map((level) => {
            const items = readiness.requirements.filter((requirement) => requirement.level === level);
            if (!items.length) return null;
            return (
              <section key={level}>
                <h3 className="text-sm font-medium text-bone">{LEVEL_COPY[level].heading}</h3>
                <p className="mt-1 text-xs text-muted">{LEVEL_COPY[level].note}</p>
                <ul className="mt-2 space-y-2">
                  {items.map((requirement) => (
                    <li key={requirement.code} className="flex flex-wrap items-start justify-between gap-2 border-b border-line py-2 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm text-bone">{requirement.label}</p>
                        <p className="text-xs text-muted">{requirement.why}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {requirement.satisfied ? (
                          <StatusChip label="On file" tone="positive" icon="check" size="sm" />
                        ) : requirement.owner === 'cleartrade' ? (
                          <StatusChip label="ClearTrade will handle this" tone="info" icon="clock" size="sm" />
                        ) : (
                          <StatusChip label="Not provided" tone="neutral" icon="dot" size="sm" />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        <div className="mt-4">
          <Link href={`/app/products/${initial.product.id}/facts`} className={buttonClass('secondary', 'md')}>
            Add product details
          </Link>
        </div>
      </Card>
    </div>
  );
}
