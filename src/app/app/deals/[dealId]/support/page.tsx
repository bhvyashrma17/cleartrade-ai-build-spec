/**
 * EXP-16 Messages, Support & Disputes.
 *
 * AC01 ("chat and dispute records are separate object types — a message must never be
 * the only record of a blocker") is structural here, not a convention this page has to
 * remember: `messages` and `disputes` are two independent queries against two
 * independent Prisma models, rendered in two independent sections. There is no code path
 * from a `Message` row into a `Dispute` row anywhere in this file — raising an issue
 * always goes through `CreateCaseForm`, which posts to `/disputes`, never `/messages`.
 *
 * The critical-case banner required by docs/04 ("Critical case → banner on Deal
 * Workspace") needs no bespoke UI here: opening a dispute calls
 * `applyDisputeOpenedRiskEffect()` server-side, which raises `Deal.risk_state`, and the
 * workspace layout already renders that banner on every tab (EXP-09-AC04). This page
 * only has to make sure the domain rule fires — the persistent banner is inherited.
 */

import { AcceptResolutionButton } from '@/components/support/AcceptResolutionButton';
import { CreateCaseForm } from '@/components/support/CreateCaseForm';
import { SendMessageForm } from '@/components/support/SendMessageForm';
import { DISPUTE_SEVERITY_DISPLAY, DISPUTE_STATUS_DISPLAY, DISPUTE_TYPE_LABELS, supportChip } from '@/components/support/statusDisplay';
import { StatusChip } from '@/components/ui';
import { prisma } from '@/lib/prisma';
import { loadDealForWorkspace } from '../loadDeal';

function fmt(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export default async function DealSupportPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { principal, deal } = await loadDealForWorkspace(dealId);
  if (!deal) return null;

  const [messages, disputes, shipment, payments] = await Promise.all([
    prisma.message.findMany({
      where: { deal_id: dealId },
      orderBy: { created_at: 'asc' },
      include: { author: { select: { name: true, role: true } } },
    }),
    prisma.dispute.findMany({
      where: { deal_id: dealId },
      orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
      include: { owner: { select: { name: true } } },
    }),
    prisma.shipment.findFirst({ where: { deal_id: dealId }, select: { id: true } }),
    prisma.payment.findMany({ where: { deal_id: dealId }, select: { id: true, label: true, sequence: true } }),
  ]);

  const openDisputes = disputes.filter((d) => !['resolved', 'closed'].includes(d.status));
  const closedDisputes = disputes.filter((d) => ['resolved', 'closed'].includes(d.status));

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Conversation</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Messages with your agent and ClearTrade support.</p>

        <div className="mt-4 max-h-96 space-y-3 overflow-y-auto rounded-md border border-[var(--color-border)] p-3">
          {messages.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">No messages yet — send the first one below.</p>
          ) : (
            messages.map((m) => {
              const mine = m.author_user_id === principal.id;
              return (
                <div key={m.id} className={mine ? 'text-right' : 'text-left'}>
                  <div
                    className={`inline-block max-w-[80%] rounded-lg px-3 py-2 text-left text-sm ${
                      mine ? 'bg-ink-900 text-bone' : 'bg-paper-sunk text-ink-900'
                    }`}
                  >
                    <p>{m.body}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                    {m.author.name} · {fmt(m.created_at)}
                  </p>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-4">
          <SendMessageForm dealId={dealId} />
        </div>
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-primary">Open cases</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Structured issues, tracked separately from the conversation above.
            </p>
          </div>
          <CreateCaseForm
            dealId={dealId}
            shipmentId={shipment?.id ?? null}
            payments={payments.map((p) => ({ id: p.id, label: p.label ?? `Payment ${p.sequence}` }))}
          />
        </div>

        {openDisputes.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
            No open cases. If something needs attention beyond a message, open a case above.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {openDisputes.map((d) => {
              const statusChip = supportChip(DISPUTE_STATUS_DISPLAY, d.status);
              const severityChip = supportChip(DISPUTE_SEVERITY_DISPLAY, d.severity);
              return (
                <li key={d.id} className="rounded-md border border-[var(--color-border)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-primary">
                      {DISPUTE_TYPE_LABELS[d.type] ?? d.type} <span className="font-normal text-[var(--color-text-secondary)]">· Case {d.id.slice(-6)}</span>
                    </span>
                    <div className="flex gap-1.5">
                      <StatusChip {...severityChip} size="sm" />
                      <StatusChip {...statusChip} size="sm" />
                    </div>
                  </div>
                  <p className="mt-1.5 text-sm text-primary">{d.summary}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    Owner: {d.owner?.name ?? 'Not yet assigned'} · Updated {fmt(d.updated_at)}
                  </p>

                  {d.status === 'waiting_external' ? (
                    <p className="mt-2 rounded-md bg-surface-muted p-2 text-xs text-[var(--color-text-secondary)]">
                      Waiting on {d.waiting_on ?? 'an external party'}. Next update expected {fmt(d.sla_due_at)}.
                    </p>
                  ) : null}

                  {d.status === 'proposed_resolution' && d.resolution ? (
                    <div className="mt-2 rounded-md border border-[color-mix(in_srgb,var(--color-info)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-info)_6%,transparent)] p-2.5">
                      <p className="text-xs font-normal text-primary">Proposed resolution</p>
                      <p className="mt-1 text-sm text-primary">{d.resolution}</p>
                      <div className="mt-2">
                        <AcceptResolutionButton dealId={dealId} disputeId={d.id} />
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {closedDisputes.length > 0 ? (
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">Resolved history</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Immutable — closed cases are never edited.</p>
          <ul className="mt-3 space-y-2">
            {closedDisputes.map((d) => {
              const statusChip = supportChip(DISPUTE_STATUS_DISPLAY, d.status);
              return (
                <li key={d.id} className="border-t border-[var(--color-border)] pt-2 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-primary">{DISPUTE_TYPE_LABELS[d.type] ?? d.type}</span>
                    <StatusChip {...statusChip} size="sm" />
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{d.resolution ?? d.summary}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Closed {fmt(d.closed_at)}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
