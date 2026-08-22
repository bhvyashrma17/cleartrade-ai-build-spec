/**
 * AGT-05 Negotiation & Deal Conversion (agent side).
 *
 * Terms editor (draft vs. proposed), version compare, exporter approval status the agent
 * can read but never set, buyer status, risk flags, and the server-checked lock gate.
 */

import { DealStage } from '@prisma/client';
import Link from 'next/link';
import { PageHeader, StatusChip } from '@/components/ui';
import { ProposalDiff } from '@/components/commercial/ProposalDiff';
import { AGENT_STATUS_DISPLAY, ProposalHistory } from '@/components/commercial/ProposalHistory';
import { buildDealLockContext, NEGOTIABLE_STAGES } from '@/lib/commercial';
import { loadCommercialView } from '@/lib/commercial-view';
import { prisma } from '@/lib/prisma';
import { collectDealLockBlockers, DEAL_STAGE_LABELS } from '@/lib/state-machines/deal';
import { loadAgentDeal } from '../loadAgentDeal';
import { LockPanel } from './LockPanel';
import { TermsEditor, type TermsFormValues } from './TermsEditor';

const BUYER_STATUS_LABELS: Record<string, string> = {
  no_response: 'No response yet',
  verbal_interest: 'Verbal interest only',
  negotiating: 'Negotiating',
  accepted: 'Accepted in writing',
  declined: 'Declined',
};

function money(amount: unknown, currency: string | null) {
  if (amount === null || amount === undefined) return '—';
  return `${currency ?? ''} ${Number(amount).toLocaleString('en-IN')}`.trim();
}

export default async function AgentDealCommercialPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { deal } = await loadAgentDeal(dealId);

  const [view, lockContext] = await Promise.all([loadCommercialView(deal.id), buildDealLockContext(deal.id)]);
  const blockers = collectDealLockBlockers(lockContext);

  // Prefill the editor from the newest version — a draft continues, a sent version
  // becomes the starting point for the next one.
  const latestRow = await prisma.dealProposal.findFirst({
    where: { deal_id: deal.id },
    orderBy: { version: 'desc' },
  });
  const paymentTerms = (latestRow?.payment_terms ?? null) as { type?: string; description?: string } | null;

  const initial: TermsFormValues = {
    quantity: latestRow?.quantity?.toString() ?? '',
    unit: latestRow?.unit ?? '',
    unit_price_amount: latestRow?.unit_price_amount?.toString() ?? '',
    unit_price_currency: latestRow?.unit_price_currency ?? '',
    total_amount: latestRow?.total_amount?.toString() ?? '',
    total_currency: latestRow?.total_currency ?? '',
    incoterm: latestRow?.incoterm ?? '',
    incoterm_place: latestRow?.incoterm_place ?? '',
    payment_type: paymentTerms?.type ?? '',
    payment_description: paymentTerms?.description ?? '',
    ship_window_start: latestRow?.ship_window_start ? latestRow.ship_window_start.toISOString().slice(0, 10) : '',
    ship_window_end: latestRow?.ship_window_end ? latestRow.ship_window_end.toISOString().slice(0, 10) : '',
    special_conditions: latestRow?.special_conditions ?? '',
    agent_note: latestRow?.agent_note ?? '',
    buyer_status: latestRow?.buyer_status ?? '',
    buyer_status_note: latestRow?.buyer_status_note ?? '',
  };

  const riskFlags = (deal.buyer.risk_flags ?? []) as { code: string; severity: string; summary: string }[];
  const canEditTerms = !view.isLocked && NEGOTIABLE_STAGES.includes(deal.stage);
  const canLock = !view.isLocked && deal.stage !== DealStage.closed_won && deal.stage !== DealStage.closed_lost && deal.stage !== DealStage.cancelled;
  const previousVersion = view.latest && view.latest.version > 1 ? view.latest.version - 1 : null;

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-6">
        <PageHeader
          eyebrow={
            <>
              <Link href="/agent" className="underline underline-offset-2">
                Agent workspace
              </Link>{' '}
              · Commercial
            </>
          }
          title={deal.buyer.display_name}
          description={`${deal.exporter_org.display_name} · ${deal.product?.name ?? 'No product'} · ${deal.buyer.country_code}`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusChip label={DEAL_STAGE_LABELS[deal.stage]} tone="info" icon="dot" size="sm" />
          <span className="text-sm text-[var(--color-text-secondary)]">
            {money(deal.value_amount, deal.value_currency)}
          </span>
        </div>
      </div>

      {/* Risk — AGT-05 "Warnings before propose/lock". */}
      {riskFlags.length > 0 || deal.buyer.verification_status !== 'verified' ? (
        <section className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_6%,transparent)] p-4">
          <h2 className="text-sm font-semibold text-primary">Check before you propose or lock</h2>
          <ul className="mt-2 space-y-1 text-sm text-primary">
            {deal.buyer.verification_status !== 'verified' ? (
              <li>
                Buyer verification is <strong>{deal.buyer.verification_status.replace(/_/g, ' ')}</strong> — confirm
                identity before relying on these terms.
              </li>
            ) : null}
            {riskFlags.map((f) => (
              <li key={f.code}>
                <strong>{f.severity}</strong> · {f.summary}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-3">
          <TermsEditor
            dealId={deal.id}
            initial={initial}
            canEdit={canEditTerms}
            isDraft={view.latest?.status === 'draft'}
          />

          {view.latest ? (
            <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
              <ProposalDiff diff={view.diff} currentVersion={view.latest.version} previousVersion={previousVersion} />
            </section>
          ) : null}
        </div>

        <div className="space-y-6 xl:col-span-2">
          {/* Exporter approval — read-only for the agent. AGT-05-AC02. */}
          <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
            <h2 className="text-lg font-semibold text-primary">Exporter approval</h2>
            {view.approved ? (
              <>
                <div className="mt-2">
                  <StatusChip label="Accepted" tone="positive" icon="check" size="sm" />
                </div>
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                  Version {view.approved.version} accepted by {view.approved.approvedBy ?? 'the exporter'}
                  {view.approved.approvedAt
                    ? ` on ${new Date(view.approved.approvedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                    : ''}
                  .
                </p>
              </>
            ) : view.awaiting ? (
              <>
                <div className="mt-2">
                  <StatusChip label="Awaiting exporter approval" tone="warning" icon="clock" size="sm" />
                </div>
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                  Version {view.awaiting.version} is with the exporter. You cannot approve it on their behalf —
                  the exporter must approve their own terms.
                </p>
              </>
            ) : view.latest?.status === 'changes_requested' ? (
              <>
                <div className="mt-2">
                  <StatusChip label="Changes requested" tone="info" icon="alert" size="sm" />
                </div>
                <p className="mt-2 text-sm text-primary">{view.latest.changesRequestedNote}</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                Nothing has been sent to the exporter yet.
              </p>
            )}
          </section>

          {/* Buyer status — never presented as legal acceptance unless it is. */}
          <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
            <h2 className="text-lg font-semibold text-primary">Buyer status</h2>
            {view.latest?.buyerStatus ? (
              <>
                <p className="mt-2 text-sm font-normal text-primary">
                  {BUYER_STATUS_LABELS[view.latest.buyerStatus] ?? view.latest.buyerStatus}
                </p>
                {view.latest.buyerStatusNote ? (
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{view.latest.buyerStatusNote}</p>
                ) : null}
                {view.latest.buyerStatus === 'verbal_interest' ? (
                  <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                    Verbal interest is not acceptance — do not treat this as a commitment.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">No buyer position recorded yet.</p>
            )}
          </section>

          <LockPanel dealId={deal.id} dealVersion={view.dealVersion} blockers={blockers} canLock={canLock} />
        </div>
      </div>

      <section className="mt-6 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Version history</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Every revision is preserved — an accepted version is never mutated.
        </p>
        <div className="mt-4">
          <ProposalHistory history={view.history} display={AGENT_STATUS_DISPLAY} />
        </div>
      </section>
    </div>
  );
}
