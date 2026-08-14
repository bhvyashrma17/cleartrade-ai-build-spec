'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, StatusChip } from '@/components/ui';
import { ApiClientError, apiPatch } from '@/lib/api-client';

type Tier = 'guest' | 'free' | 'paid';
type FeeStatus = 'not_due' | 'due' | 'paid' | 'waived' | 'refunded';

interface PayResult {
  commitment_fee_status: FeeStatus;
  tier: Tier;
  amount: string;
  currency: string;
}

export function CommitmentFeeCard({
  tier,
  status,
  amount,
  currency,
  paidAt,
  canPay,
}: {
  tier: Tier;
  status: FeeStatus;
  amount: string | null;
  currency: string | null;
  paidAt: string | null;
  canPay: boolean;
}) {
  const [state, setState] = useState<{ tier: Tier; status: FeeStatus; paidAt: string | null }>({
    tier,
    status,
    paidAt,
  });
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setPaying(true);
    setError(null);
    try {
      // `source: 'exporter_update'` — self-reported, exactly like a buyer payment status
      // update from the exporter side (this platform has no payment gateway; see the
      // route comment on why PaymentSource's vocabulary is reused here).
      const result = await apiPatch<{ data: PayResult }>('/api/v1/exporter-org/commitment-fee', {
        action: 'pay',
        source: 'exporter_update',
      });
      setState({ tier: result.data.tier, status: result.data.commitment_fee_status, paidAt: new Date().toISOString() });
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not record the payment. Please retry.');
    } finally {
      setPaying(false);
    }
  }

  if (!canPay) {
    return (
      <section className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-surface p-6 text-center">
        <h2 className="text-base font-semibold text-primary">Create an account first</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-text-secondary)]">
          The commitment fee applies once you&rsquo;ve registered — it&rsquo;s what unlocks the
          paid plan from there.
        </p>
        <Link
          href="/register"
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded bg-action px-4 text-sm font-semibold text-primary transition duration-fast hover:brightness-95"
        >
          Create free account
        </Link>
      </section>
    );
  }

  if (state.status === 'paid' || state.status === 'waived') {
    return (
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <StatusChip
          label={state.status === 'waived' ? 'Commitment fee waived' : 'Commitment fee paid'}
          tone="positive"
          icon="check"
        />
        <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
          {state.status === 'paid' && state.paidAt
            ? `Recorded on ${new Date(state.paidAt).toLocaleDateString('en-IN')}.`
            : null}{' '}
          Full ranked Demand Discovery and the agent-assisted workflow are unlocked.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
      <StatusChip label="Commitment fee due" tone="warning" icon="alert" />
      <p className="mt-3 text-2xl font-semibold text-primary">
        {amount ?? '—'} {currency ?? ''}
      </p>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        One-time, not recurring. Unlocks full ranked Demand Discovery — market scores,
        requirements, and Buyer Discovery contacts.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-critical">
          {error}
        </p>
      ) : null}
      <Button onClick={pay} disabled={paying} className="mt-4">
        {paying ? 'Recording payment…' : "I've paid — unlock my account"}
      </Button>
    </section>
  );
}
