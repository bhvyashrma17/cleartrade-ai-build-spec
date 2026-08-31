'use client';

/**
 * "Select this market" — persists the org's active target through the existing
 * `market-assessments/:id/select` route, which already enforces org-level exclusivity and the
 * two-step confirm when replacing a current target. Building a second selection path here
 * would have given the product two rival notions of "the target market".
 *
 * Buyer Discovery is named as the next step but is NOT implemented or invoked here.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Button, buttonClass, StatusChip } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function SelectMarket({
  exporterOrgId,
  assessmentId,
  country,
  initiallySelected,
}: {
  exporterOrgId: string;
  assessmentId: string;
  country: string;
  initiallySelected: boolean;
}) {
  const [selected, setSelected] = useState(initiallySelected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the server asks us to confirm replacing an existing target. */
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  void exporterOrgId;

  async function select(confirmReplace: boolean) {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/market-assessments/${assessmentId}/select`, confirmReplace ? { confirm_replace: true } : {});
      setSelected(true);
      setConfirmMessage(null);
    } catch (caught) {
      const needsConfirm = caught instanceof ApiClientError
        ? caught.fields?.find((field) => field.field === 'confirm_replace' && field.code === 'confirmation_required')
        : undefined;
      if (needsConfirm) {
        // The server refused pending confirmation and told us what it would replace. Ask.
        setConfirmMessage(needsConfirm.message);
      } else {
        setError(caught instanceof ApiClientError ? caught.message : 'Could not select this market.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (selected) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <StatusChip label={`${country} selected`} tone="positive" icon="check" />
        <span className="text-sm text-slate">Next: find verified buyers</span>
        <Link href="/app/buyers" className={buttonClass('secondary', 'sm')}>
          Go to buyers
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {confirmMessage ? (
        <div className="space-y-2">
          <p className="text-sm text-bone" role="alert">{confirmMessage}</p>
          <div className="flex gap-2">
            <Button onClick={() => select(true)} disabled={busy} size="sm">
              Yes, make {country} my target
            </Button>
            <Button onClick={() => setConfirmMessage(null)} variant="ghost" size="sm" disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => select(false)} disabled={busy}>
          {busy ? 'Selecting…' : 'Select this market'}
        </Button>
      )}
      {error ? <p className="text-sm text-[var(--crit)]" role="alert">{error}</p> : null}
    </div>
  );
}
