/**
 * EXP-15 Payment, Banking Visibility & Insurance. This is a visibility surface only
 * (AC01) — every buyer payment described here moves directly between buyer and
 * exporter/bank; nothing in this copy or these components implies ClearTrade holds or
 * settles funds. Every payment milestone (a `Payment` row) shows its provenance label
 * (AC02) and supports a partial receipt (AC03). `brc_status` is rendered and controlled
 * completely separately from `status`/`received_at`/`realized_at` (AC04).
 */

import { BrcStatusControl } from '@/components/payment/BrcStatusControl';
import { InsuranceQuoteButton } from '@/components/payment/InsuranceQuoteButton';
import { OpenDisputeButton } from '@/components/payment/OpenDisputeButton';
import { PaymentEvidenceUpload } from '@/components/payment/PaymentEvidenceUpload';
import { PaymentStatusForm } from '@/components/payment/PaymentStatusForm';
import {
  BRC_STATUS_DISPLAY,
  INSURANCE_STATUS_DISPLAY,
  PAYMENT_STATUS_DISPLAY,
  PROVENANCE_DISPLAY,
  paymentChip,
} from '@/components/payment/statusDisplay';
import { StatusChip } from '@/components/ui';
import { prisma } from '@/lib/prisma';
import { loadDealForWorkspace } from '../loadDeal';

function fmt(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d);
}

function money(amount: string | number | null, currency: string): string {
  if (amount === null) return '—';
  const n = typeof amount === 'number' ? amount : Number(amount);
  return `${currency} ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface EvidenceEntry {
  ref?: string;
  name?: string;
  note?: string;
  recorded_by?: string;
  recorded_at?: string;
  uploaded_at?: string;
}

export default async function DealPaymentPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { deal } = await loadDealForWorkspace(dealId);
  if (!deal) return null;

  const [payments, insuranceCase] = await Promise.all([
    prisma.payment.findMany({ where: { deal_id: dealId }, orderBy: { sequence: 'asc' } }),
    prisma.insuranceCase.findFirst({ where: { deal_id: dealId }, orderBy: { created_at: 'desc' } }),
  ]);

  if (payments.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-surface p-8 text-center">
        <p className="text-sm font-normal text-primary">No payment milestones yet</p>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Payment tracking begins once your agent sets up the payment schedule for this deal. There is
          nothing to show until then.
        </p>
      </section>
    );
  }

  const overdue = payments.filter((p) => p.status === 'overdue');
  const insuranceChip = insuranceCase ? paymentChip(INSURANCE_STATUS_DISPLAY, insuranceCase.status) : null;
  const canRequestQuote = !insuranceCase || insuranceCase.status === 'not_started' || insuranceCase.status === 'declined';

  return (
    <div className="space-y-4">
      {overdue.length > 0 ? (
        <div
          role="alert"
          className="rounded-lg border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-4"
        >
          <p className="text-sm font-normal text-primary">
            {overdue.length} payment{overdue.length > 1 ? 's' : ''} overdue from the buyer.
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            This tracks what the buyer owes you directly. ClearTrade does not hold or settle these funds — follow
            up with the buyer or your bank, and record what you learn below.
          </p>
        </div>
      ) : null}

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Payment milestones</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Tracks what the buyer owes and has paid you directly — a visibility record, not funds ClearTrade holds.
        </p>

        <div className="mt-4 space-y-4">
          {payments.map((p) => {
            const statusChip = paymentChip(PAYMENT_STATUS_DISPLAY, p.status);
            const brcChip = paymentChip(BRC_STATUS_DISPLAY, p.brc_status);
            const provenanceChip = paymentChip(PROVENANCE_DISPLAY, p.source);
            const entries = Array.isArray(p.evidence_refs) ? (p.evidence_refs as unknown as EvidenceEntry[]) : [];

            return (
              <div key={p.id} className="rounded-md border border-[var(--color-border)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-normal text-primary">{p.label ?? `Milestone ${p.sequence}`}</p>
                    <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
                      {money(p.amount.toString(), p.currency)}
                      {p.amount_received ? ` · ${money(p.amount_received.toString(), p.currency)} received` : ''}
                      {p.due_at ? ` · due ${fmt(p.due_at)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip {...statusChip} size="sm" />
                    <StatusChip {...brcChip} size="sm" />
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-secondary)]">
                  <span>Provenance:</span>
                  <StatusChip {...provenanceChip} size="sm" />
                  {p.payment_method ? <span>via {p.payment_method}</span> : null}
                </div>

                {entries.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-secondary)]">
                    {entries.map((e, i) => (
                      <li key={i}>{e.name ? `File: ${e.name}` : e.note ? `Note: ${e.note}` : 'Evidence recorded'}</li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <PaymentStatusForm dealId={dealId} paymentId={p.id} />
                  <BrcStatusControl dealId={dealId} paymentId={p.id} brcStatus={p.brc_status} />
                  <PaymentEvidenceUpload dealId={dealId} paymentId={p.id} />
                  <OpenDisputeButton dealId={dealId} paymentId={p.id} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-primary">Insurance</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Trade credit / cargo cover for this deal, tracked separately from payment status.</p>
          </div>
          {insuranceChip ? <StatusChip {...insuranceChip} /> : <StatusChip label="No policy" tone="neutral" icon="dot" />}
        </div>
        {insuranceCase?.provider_name || insuranceCase?.policy_ref ? (
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase text-[var(--color-text-muted)]">Provider</dt>
              <dd className="mt-0.5 text-sm text-primary">{insuranceCase?.provider_name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-[var(--color-text-muted)]">Policy ref</dt>
              <dd className="record mt-0.5 select-all text-primary">{insuranceCase?.policy_ref ?? '—'}</dd>
            </div>
          </dl>
        ) : null}
        {canRequestQuote ? (
          <div className="mt-4">
            <InsuranceQuoteButton dealId={dealId} />
          </div>
        ) : null}
      </section>
    </div>
  );
}
