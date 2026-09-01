'use client';

/**
 * The ClearTrade staff review queue for exporter market-scan requests.
 *
 * A scan is metered work, so the reviewer is shown the two things that actually decide the
 * answer: whether a current screen already covers this classification (in which case approving
 * spends nothing), and — when the canonical planner can state one — how much acquisition would
 * be required against the available quota. Nothing here estimates a provider cost itself.
 *
 * A request whose classification moved after it was raised is flagged and cannot be approved
 * into a stale identity: the server refuses it and asks for a fresh request.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, SectionHeading, StatusChip } from '@/components/ui';
import { ApiClientError, apiGet, apiPost } from '@/lib/api-client';
import type { StaffQueueEntry } from '@/lib/country-discovery/scan-requests';

export function MarketScanQueue() {
  const [entries, setEntries] = useState<StaffQueueEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await apiGet<{ data: StaffQueueEntry[] }>('/api/v1/market-scan-requests');
      setEntries(response.data);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not load the market scan queue.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function approve(entry: StaffQueueEntry) {
    setBusy(entry.id); setError(null); setNotice(null);
    try {
      await apiPost(`/api/v1/market-scan-requests/${entry.id}/approve`, {});
      setNotice(`Market scan approved for ${entry.product.name}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not approve this request.');
      await load();
    } finally { setBusy(null); }
  }

  async function reject(entry: StaffQueueEntry) {
    if (!reason.trim()) return;
    setBusy(entry.id); setError(null); setNotice(null);
    try {
      await apiPost(`/api/v1/market-scan-requests/${entry.id}/reject`, { reason: reason.trim() });
      setNotice(`Request declined for ${entry.product.name}.`);
      setRejecting(null); setReason('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not decline this request.');
    } finally { setBusy(null); }
  }

  if (!entries) return <p className="text-sm text-slate">Loading market scan requests…</p>;

  // An empty queue is the common case and is not itself information worth a card's worth of
  // vertical space — a filled-out heading, description and bordered empty-state box for "there
  // is nothing here" pushed everything below it off the first screen. Collapse to one line;
  // expand back to the full card the moment there is something to review.
  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
        <span className="text-sm text-slate">Market scan requests</span>
        <StatusChip label="None pending" tone="neutral" icon="dot" size="sm" />
      </div>
    );
  }

  return (
    <Card as="section">
      <SectionHeading
        title="Market scan requests"
        description="Exporters request a global market scan; ClearTrade releases the work."
      />
      {notice ? <div className="mt-3"><StatusChip label={notice} tone="positive" icon="check" size="sm" /></div> : null}
      {error ? <p className="mt-3 text-sm text-[var(--crit)]" role="alert">{error}</p> : null}

      <ul className="mt-3 space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-bone">{entry.product.name}</p>
                  <p className="text-xs text-muted">
                    {entry.exporter_name} · HS {entry.hs6_code} ({entry.hs_revision}) · requested by {entry.requested_by} on{' '}
                    {new Date(entry.requested_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {entry.classification_stale ? (
                      <StatusChip label="Classification changed since request" tone="warning" icon="alert" size="sm" />
                    ) : null}
                    {entry.existing_run ? (
                      <StatusChip
                        label={`Current scan already exists (${entry.existing_run.shortlist_size ?? 0} shortlisted)`}
                        tone="info" icon="check" size="sm"
                      />
                    ) : (
                      <StatusChip label="No current scan for this product" tone="neutral" icon="dot" size="sm" />
                    )}
                    {entry.acquisition_estimate ? (
                      <StatusChip
                        label={
                          entry.acquisition_estimate.can_execute_full_screen
                            ? `${entry.acquisition_estimate.requires_acquisition} markets to acquire`
                            : `${entry.acquisition_estimate.requires_acquisition} to acquire, ${entry.acquisition_estimate.available_quota ?? 0} quota available`
                        }
                        tone={entry.acquisition_estimate.can_execute_full_screen ? 'neutral' : 'warning'}
                        icon={entry.acquisition_estimate.can_execute_full_screen ? 'dot' : 'alert'}
                        size="sm"
                      />
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" onClick={() => approve(entry)} disabled={busy === entry.id || entry.classification_stale}>
                    {busy === entry.id ? 'Working…' : 'Approve'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setRejecting(rejecting === entry.id ? null : entry.id); setReason(''); }} disabled={busy === entry.id}>
                    Decline
                  </Button>
                </div>
              </div>

              {entry.classification_stale ? (
                <p className="mt-2 text-xs text-muted">
                  This product&rsquo;s confirmed classification changed after the request was raised. Approving would
                  screen a different product identity than the exporter asked about, so a fresh request is required.
                </p>
              ) : null}

              {rejecting === entry.id ? (
                <div className="mt-3 space-y-2">
                  <label htmlFor={`reason-${entry.id}`} className="block text-xs text-muted">
                    Why not? The exporter is shown this exactly as written.
                  </label>
                  <Input
                    id={`reason-${entry.id}`}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="e.g. This product's classification needs confirming first."
                  />
                  <Button size="sm" onClick={() => reject(entry)} disabled={busy === entry.id || !reason.trim()}>
                    Confirm decline
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
    </Card>
  );
}
