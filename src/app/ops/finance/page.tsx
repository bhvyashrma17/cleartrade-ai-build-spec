/** OPS-05 — Finance, fees & agent payouts (docs/06). Buyer payment and ClearTrade fee
 * are kept as separate records/views (AC01) — never merged into one row. */

import Link from 'next/link';
import { UserRole } from '@prisma/client';
import { AccessDenied } from '@/components/access-denied';
import { StatusChip } from '@/components/ui';
import { requirePortalAccess } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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

  const [lockedDeals, payments, disputedFeePayments] = await Promise.all([
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

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">Agent payout</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Eligible basis, share snapshot, amount and status.</p>
          <div className="mt-4">
            <EmptyQueue>
              Agent payout is not tracked as its own record yet — only the commission rate captured in each deal's fee
              policy snapshot exists today. No payout figures are shown here rather than estimating them.
            </EmptyQueue>
          </div>
        </section>
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
