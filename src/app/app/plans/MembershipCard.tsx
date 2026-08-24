'use client';

/**
 * Current membership state, for a tenant that has one.
 *
 * The distinction this card exists to make legible: CANCELLED is not the same as ENDED.
 * A member who cancels keeps everything until the date they have paid through, and the
 * card says which date that is. Collapsing the two into "cancelled" is what generates the
 * "I cancelled and lost access immediately, refund me" ticket.
 */

import { useState } from 'react';
import { Button, StatusChip } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';
import type { StatusIconName, StatusTone } from '@/types';

export interface MembershipView {
  planLabel: string;
  status: string;
  /** Pre-formatted server-side. */
  priceDisplay: string;
  renewsOn: string | null;
  accessUntil: string | null;
  cancelAtPeriodEnd: boolean;
  /** A manual/comped membership has no gateway to cancel against. */
  cancellable: boolean;
}

const STATUS_VIEW: Record<string, { label: string; tone: StatusTone; icon: StatusIconName }> = {
  active: { label: 'Membership active', tone: 'positive', icon: 'check' },
  authenticated: { label: 'Payment authorized', tone: 'info', icon: 'clock' },
  created: { label: 'Awaiting payment', tone: 'warning', icon: 'clock' },
  pending: { label: 'Payment retrying', tone: 'warning', icon: 'alert' },
  // Deliberately not phrased as a failure to the member: their access is intact, and the
  // action they need to take is on their card, not on this product.
  halted: { label: 'Payment needs attention', tone: 'warning', icon: 'alert' },
  // Not phrased as a payment problem: a pause is deliberate, and telling someone their
  // card failed when it did not is the confusion this status exists to prevent.
  paused: { label: 'Membership paused', tone: 'neutral', icon: 'pause' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'clock' },
  completed: { label: 'Membership ended', tone: 'neutral', icon: 'check' },
  expired: { label: 'Membership ended', tone: 'neutral', icon: 'alert' },
};

export function MembershipCard({ membership }: { membership: MembershipView }) {
  const [state, setState] = useState(membership);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const view = STATUS_VIEW[state.status] ?? { label: state.status, tone: 'neutral' as StatusTone, icon: 'clock' as StatusIconName };

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{ data: { cancel_at_period_end: boolean; access_until: string | null } }>(
        '/api/v1/billing/subscription/cancel',
        {},
      );
      setState((current) => ({
        ...current,
        cancelAtPeriodEnd: result.data.cancel_at_period_end,
        accessUntil: result.data.access_until
          ? new Date(result.data.access_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
          : current.accessUntil,
      }));
      setConfirming(false);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not cancel. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <StatusChip label={view.label} tone={view.tone} icon={view.icon} />
          <p className="mt-3 text-subtitle text-bone">{state.planLabel}</p>
          <p className="mt-1 text-sm text-muted">{state.priceDisplay}</p>
        </div>
        <div className="text-right">
          {state.cancelAtPeriodEnd ? (
            <>
              <p className="text-xs uppercase tracking-wide text-muted">Access until</p>
              <p className="mt-1 text-sm font-medium text-bone">{state.accessUntil ?? '—'}</p>
            </>
          ) : state.renewsOn ? (
            <>
              <p className="text-xs uppercase tracking-wide text-muted">Renews on</p>
              <p className="mt-1 text-sm font-medium text-bone">{state.renewsOn}</p>
            </>
          ) : null}
        </div>
      </div>

      {state.cancelAtPeriodEnd ? (
        <p className="mt-5 border-t border-line pt-5 text-sm text-slate">
          Your membership will not renew. You keep full Premium access until{' '}
          <span className="font-medium text-bone">{state.accessUntil ?? 'the end of your paid period'}</span>,
          and nothing is charged after that.
        </p>
      ) : state.status === 'paused' ? (
        <p className="mt-5 border-t border-line pt-5 text-sm text-slate">
          Billing is paused, so you will not be charged again until it resumes. Your Premium
          access continues until{' '}
          <span className="font-medium text-bone">{state.accessUntil ?? 'the end of your paid period'}</span>.
        </p>
      ) : state.status === 'halted' ? (
        <p className="mt-5 border-t border-line pt-5 text-sm text-slate">
          Your last renewal payment did not go through. Your access is unaffected for now —
          update your card with your bank or card issuer and Razorpay will retry
          automatically.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-sm text-[var(--crit)]">
          {error}
        </p>
      ) : null}

      {state.cancellable && !state.cancelAtPeriodEnd ? (
        <div className="mt-5 border-t border-line pt-5">
          {confirming ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-slate">
                Stop renewing? You keep Premium until{' '}
                {state.renewsOn ?? 'the end of the period you have paid for'}.
              </p>
              <Button variant="danger" size="sm" onClick={cancel} disabled={busy}>
                {busy ? 'Cancelling…' : 'Yes, stop renewing'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                Keep my membership
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              Cancel membership
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
