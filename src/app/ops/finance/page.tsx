/** OPS-05 — Finance, fees & agent payouts (docs/06). Buyer payment and ClearTrade fee
 * are kept as separate records/views (AC01) — never merged into one row. */

import Link from 'next/link';
import { PayoutState, UserRole } from '@prisma/client';
import { AccessDenied } from '@/components/access-denied';
import { PayoutActions } from '@/components/ops/PayoutActions';
import { StatusChip } from '@/components/ui';
import { requirePortalAccess } from '@/lib/auth';
import { netPayable } from '@/lib/payouts';
import { prisma } from '@/lib/prisma';
import { PAYOUT_STATE_LABELS } from '@/lib/state-machines/payout';

function EmptyQueue({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-6 text-sm text-[var(--color-text-secondary)]">
      {children}
    </p>
  );
}

function money(amount: unknown, currency: string | null) {
  if (amount === null || amount === undefined) return '—';
  return `${currency ?? ''} ${Number(amount).toLocaleString('en-IN')}`.trim();
}

export default async function OpsFinancePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const principal = await requirePortalAccess('/ops');
  if (!([UserRole.ops_finance, UserRole.admin] as readonly UserRole[]).includes(principal.role)) {
    return <AccessDenied message="Finance records are available to Ops finance and administrators." />;
  }

  const { filter } = await searchParams;
  const overdueOnly = filter === 'overdue';
  const now = new Date();

  const [lockedDeals, payments, disputedFeePayments, payouts] = await Promise.all([
    prisma.deal.findMany({
      where: { locked_at: { not: null } },
      orderBy: { locked_at: 'desc' },
      take: 20,
      include: { exporter_org: true },
    }),
    prisma.payment.findMany({
      where: overdueOnly ? { due_at: { lt: now }, received_at: null } : {},
      orderBy: [{ due_at: 'asc' }],
      take: 30,
      include: { deal: { include: { exporter_org: true } } },
    }),
    prisma.payment.count({ where: { status: 'disputed' } }),
    prisma.payout.findMany({
      include: {
        agent: { select: { name: true } },
        deal: { include: { exporter_org: { select: { display_name: true } } } },
        adjustments: { orderBy: { created_at: 'asc' }, include: { created_by: { select: { name: true } } } },
      },
      orderBy: [{ state: 'asc' }, { updated_at: 'desc' }],
    }),
  ]);

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <header className="mb-6">
        <p className="text-sm font-medium text-primary">Operations</p>
        <h1 className="text-2xl font-semibold text-primary">Finance, fees &amp; payouts</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Commercial fee and buyer payment are separate records — never mixed into one figure.
        </p>
      </header>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Fee records</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Snapshot of the fee policy in force at lock time — later config changes never rewrite these.
        </p>
        {lockedDeals.length === 0 ? (
          <div className="mt-4">
            <EmptyQueue>No deals have been locked yet, so there are no fee snapshots to show.</EmptyQueue>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="pb-2">Deal</th>
                  <th className="pb-2">Exporter</th>
                  <th className="pb-2">Deal value</th>
                  <th className="pb-2">Locked</th>
                  <th className="pb-2">Fee snapshot</th>
                </tr>
              </thead>
              <tbody>
                {lockedDeals.map((deal) => (
                  <tr key={deal.id} className="border-t border-[var(--color-border)]">
                    <td className="py-3 font-medium text-primary">Deal {deal.id.slice(-6)}</td>
                    <td className="py-3 text-[var(--color-text-secondary)]">{deal.exporter_org.display_name}</td>
                    <td className="py-3 text-[var(--color-text-secondary)]">{money(deal.value_amount, deal.value_currency)}</td>
                    <td className="py-3 text-[var(--color-text-secondary)]">
                      {deal.locked_at?.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="py-3 text-[var(--color-text-secondary)]">
                      {deal.quoted_fee_policy ? <StatusChip label="Captured" tone="positive" icon="check" size="sm" /> : <StatusChip label="No snapshot" tone="neutral" icon="dot" size="sm" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-primary">
            Buyer payments <span className="font-normal text-[var(--color-text-secondary)]">({payments.length})</span>
          </h2>
          <div className="flex gap-2 text-sm">
            <Link
              href="/ops/finance"
              className={`focus-visible-ring rounded-full border px-3 py-1.5 font-medium ${!overdueOnly ? 'border-transparent bg-primary text-[var(--color-text-inverse)]' : 'border-[var(--color-border)] bg-surface text-primary hover:bg-surface-muted'}`}
            >
              All
            </Link>
            <Link
              href="/ops/finance?filter=overdue"
              className={`focus-visible-ring rounded-full border px-3 py-1.5 font-medium ${overdueOnly ? 'border-transparent bg-primary text-[var(--color-text-inverse)]' : 'border-[var(--color-border)] bg-surface text-primary hover:bg-surface-muted'}`}
            >
              Overdue only
            </Link>
          </div>
        </div>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Separate from ClearTrade's own fee — this tracks money owed by the buyer to the exporter.</p>
        {payments.length === 0 ? (
          <div className="mt-4">
            <EmptyQueue>{overdueOnly ? 'No payments are currently overdue.' : 'No payment records exist yet.'}</EmptyQueue>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="pb-2">Deal</th>
                  <th className="pb-2">Exporter</th>
                  <th className="pb-2">Amount</th>
                  <th className="pb-2">Due</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => {
                  const overdue = Boolean(payment.due_at && payment.due_at < now && !payment.received_at);
                  return (
                    <tr key={payment.id} className="border-t border-[var(--color-border)]">
                      <td className="py-3 font-medium text-primary">Deal {payment.deal_id.slice(-6)}</td>
                      <td className="py-3 text-[var(--color-text-secondary)]">{payment.deal.exporter_org.display_name}</td>
                      <td className="py-3 text-[var(--color-text-secondary)]">{money(payment.amount, payment.currency)}</td>
                      <td className="py-3 text-[var(--color-text-secondary)]">
                        {payment.due_at?.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) ?? 'Not due'}
                      </td>
                      <td className="py-3">
                        {overdue ? (
                          <StatusChip label="Overdue" tone="critical" icon="alert" size="sm" />
                        ) : (
                          <StatusChip label={payment.status.replace(/_/g, ' ')} tone={payment.status === 'realized' ? 'positive' : 'neutral'} icon="dot" size="sm" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">
          Agent payout <span className="font-normal text-[var(--color-text-secondary)]">({payouts.length})</span>
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Eligible basis, share snapshot, amount and status. Figures are frozen at eligibility — approving
          or adjusting never recalculates them from current config (AC02).
        </p>
        {payouts.length === 0 ? (
          <div className="mt-4">
            <EmptyQueue>
              No payout records yet. One is created per agent-owned deal from lock onward, and becomes eligible
              once the configured policy is satisfied.
            </EmptyQueue>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="pb-2">Agent</th>
                  <th className="pb-2">Deal / exporter</th>
                  <th className="pb-2">Eligible basis</th>
                  <th className="pb-2">Share</th>
                  <th className="pb-2">Amount</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => {
                  const net = netPayable(p, p.adjustments);
                  const adjusted = p.adjustments.length > 0;
                  const notEligible = p.state === PayoutState.not_eligible;
                  return (
                    <tr key={p.id} className="border-t border-[var(--color-border)] align-top">
                      <td className="py-3 font-medium text-primary">{p.agent.name}</td>
                      <td className="py-3 text-[var(--color-text-secondary)]">
                        Deal {p.deal_id.slice(-6)}
                        <div className="text-xs">{p.deal.exporter_org.display_name}</div>
                      </td>
                      <td className="py-3 text-[var(--color-text-secondary)]">
                        {notEligible ? '—' : `${p.basis_currency} ${Number(p.basis_amount).toLocaleString('en-IN')}`}
                        {!notEligible ? <div className="text-xs text-[var(--color-text-muted)]">fee policy v{p.fee_policy_version}</div> : null}
                      </td>
                      <td className="py-3 text-[var(--color-text-secondary)]">
                        {notEligible ? '—' : `${(Number(p.agent_share_rate) * 100).toFixed(1)}%`}
                      </td>
                      <td className="py-3 text-[var(--color-text-secondary)]">
                        {notEligible ? (
                          '—'
                        ) : (
                          <>
                            <span className="font-medium text-primary">{p.currency} {Number(p.amount).toLocaleString('en-IN')}</span>
                            {/* AC03: the original quote stays on screen next to the net. */}
                            {adjusted ? (
                              <div className="mt-0.5 text-xs">
                                <span className="text-[var(--color-text-muted)]">
                                  {p.adjustments.length} adjustment(s) — net {net.currency} {Number(net.amount).toLocaleString('en-IN')}
                                </span>
                                <ul className="mt-0.5 space-y-0.5">
                                  {p.adjustments.map((a) => (
                                    <li key={a.id} className="text-[var(--color-text-secondary)]">
                                      {Number(a.amount) >= 0 ? '+' : ''}{Number(a.amount).toLocaleString('en-IN')} — {a.reason} ({a.created_by.name})
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="py-3">
                        <StatusChip
                          label={PAYOUT_STATE_LABELS[p.state]}
                          tone={p.state === 'paid' ? 'positive' : p.state === 'disputed' ? 'critical' : p.state === 'approved' ? 'warning' : p.state === 'eligible' ? 'info' : 'neutral'}
                          icon={p.state === 'paid' ? 'check' : p.state === 'disputed' ? 'alert' : 'clock'}
                          size="sm"
                        />
                        {notEligible && p.ineligible_reason ? (
                          <p className="mt-1 max-w-xs text-xs text-[var(--color-text-secondary)]">{p.ineligible_reason}</p>
                        ) : null}
                        {p.state === PayoutState.paid && p.payment_reference ? (
                          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Ref {p.payment_reference}</p>
                        ) : null}
                        {p.state === PayoutState.disputed && p.dispute_id ? (
                          <p className="mt-1 text-xs">
                            <Link href="/ops/disputes" className="focus-visible-ring underline underline-offset-2">Open finance case</Link>
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3">
                        <PayoutActions payoutId={p.id} state={p.state} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">Exceptions</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Disputed fee or payment, or missing realization.</p>
          {disputedFeePayments === 0 ? (
            <div className="mt-4">
              <EmptyQueue>No disputed payments.</EmptyQueue>
            </div>
          ) : (
            <div className="mt-4">
              <Link href="/ops/disputes" className="focus-visible-ring inline-block">
                <StatusChip label={`${disputedFeePayments} disputed payment${disputedFeePayments === 1 ? '' : 's'} — open in disputes`} tone="warning" icon="alert" />
              </Link>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
