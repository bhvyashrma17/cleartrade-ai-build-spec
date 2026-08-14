/**
 * AGT-08 Agent Performance & Payout (docs/05).
 *
 * Every number on this page comes from `computeAgentMetrics()` or from stored `Payout`
 * columns — nothing is derived in the browser from a partial fetch, and nothing is
 * recalculated from live config. That is the difference between AC02 holding and merely
 * appearing to hold: the payout figures below are read straight off the frozen snapshot,
 * so a fee-policy change in OPS-07 cannot move them.
 *
 * AC01 (agent cannot edit the payout calculation) is visible in what this page does NOT
 * render: there is no amount input, no approve control, no mark-paid control. The only
 * payout action available is "Raise a query", which opens a finance case.
 *
 * AC03 (every metric declares window and denominator) is carried by the `AgentMetric`
 * type — each card below prints `metric.window` and `metric.denominator` from the data,
 * so a metric cannot reach the screen without them.
 */

import Link from 'next/link';
import { PayoutState } from '@prisma/client';
import { RaisePayoutQueryButton } from '@/components/agent/RaisePayoutQueryButton';
import { MetricCard, StatusChip } from '@/components/ui';
import { computeAgentMetrics, MIN_SAMPLE, type AgentMetric } from '@/lib/agent-metrics';
import { requirePortalAccess } from '@/lib/auth';
import { netPayable } from '@/lib/payouts';
import { prisma } from '@/lib/prisma';
import { PAYOUT_STATE_LABELS } from '@/lib/state-machines/payout';

function fmt(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d);
}

const PAYOUT_TONE: Record<PayoutState, 'positive' | 'info' | 'warning' | 'critical' | 'neutral'> = {
  not_eligible: 'neutral',
  eligible: 'info',
  approved: 'warning',
  paid: 'positive',
  disputed: 'critical',
};

function MetricRow({ metric }: { metric: AgentMetric }) {
  return (
    <li className="rounded-md border border-[var(--color-border)] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-primary">{metric.label}</span>
        <span className="text-lg font-semibold text-primary">{metric.value}</span>
      </div>
      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{metric.use}</p>
      {/* AC03: window and denominator are printed for every metric, from the data. */}
      <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
        Window: {metric.window}
        {metric.denominator ? ` · Denominator: ${metric.denominator}` : ' · Count, no denominator'}
      </p>
      {metric.low_sample ? (
        <p className="mt-1">
          <StatusChip
            label={`Small sample — under ${MIN_SAMPLE}`}
            tone="warning"
            icon="alert"
            size="sm"
            detail="Too few data points to read this as a trend."
          />
        </p>
      ) : null}
    </li>
  );
}

export default async function AgentPerformancePage() {
  const principal = await requirePortalAccess('/agent');

  const [metrics, payouts] = await Promise.all([
    computeAgentMetrics(principal.id),
    prisma.payout.findMany({
      where: { agent_user_id: principal.id },
      include: {
        deal: { include: { exporter_org: { select: { display_name: true } }, buyer: { select: { display_name: true } } } },
        adjustments: { orderBy: { created_at: 'asc' }, include: { created_by: { select: { name: true } } } },
      },
      orderBy: [{ state: 'asc' }, { updated_at: 'desc' }],
    }),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <header>
        <p className="text-sm font-medium text-primary">Agent workspace</p>
        <h1 className="text-2xl font-semibold text-primary">Performance &amp; payout</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Your workload, outcome quality and commission records. Every metric states the period it
          covers and what it is measured against — there is no single overall score.
        </p>
      </header>

      {/* Workload — operational first, per the anatomy table. */}
      <section aria-label="Workload" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Assigned exporters" value={metrics.workload.assigned_exporters} secondaryText="Current book" />
        <MetricCard label="Active leads" value={metrics.workload.active_leads} secondaryText="Across assigned exporters" />
        <MetricCard label="Active deals" value={metrics.workload.active_deals} secondaryText="Qualifying through executing" />
        <MetricCard
          label="Overdue tasks"
          value={metrics.workload.overdue_tasks}
          secondaryText="Owned by you, past SLA"
          comparison={metrics.workload.overdue_tasks > 0 ? { label: 'Needs attention', tone: 'critical' } : undefined}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">Performance</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Outreach and commercial outcomes over the {metrics.window_label}.
          </p>
          <ul className="mt-4 space-y-3">
            {metrics.performance.map((m) => <MetricRow key={m.key} metric={m} />)}
          </ul>
        </section>

        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">Quality</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Service and execution quality. These are reported separately on purpose — no composite score.
          </p>
          <ul className="mt-4 space-y-3">
            {metrics.quality.map((m) => <MetricRow key={m.key} metric={m} />)}
          </ul>
        </section>
      </div>

      {/* Payouts — read-only. */}
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Payouts</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Read-only. Amounts are frozen at the moment each payout became eligible and are never
          recalculated — a later fee-policy change does not move them. Finance approves and pays.
        </p>

        {payouts.length === 0 ? (
          <div className="mt-4 rounded border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-6 text-sm text-[var(--color-text-secondary)]">
            <p className="font-medium text-primary">No payout records yet</p>
            <p className="mt-1">
              A commission record is created once one of your deals is locked. It becomes eligible
              when the buyer payment realizes and no dispute is open on the deal.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {payouts.map((p) => {
              const net = netPayable(p, p.adjustments);
              const hasAdjustments = p.adjustments.length > 0;
              const isNotEligible = p.state === PayoutState.not_eligible;
              const snapshot = p.calculation_snapshot as Record<string, unknown> | null;

              return (
                <li key={p.id} className="rounded-md border border-[var(--color-border)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-primary">
                        {p.deal.exporter_org.display_name} · {p.deal.buyer.display_name}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Deal {p.deal_id.slice(-6)}</p>
                    </div>
                    <StatusChip
                      label={PAYOUT_STATE_LABELS[p.state]}
                      tone={PAYOUT_TONE[p.state]}
                      icon={p.state === 'paid' ? 'check' : p.state === 'disputed' ? 'alert' : 'clock'}
                      size="sm"
                    />
                  </div>

                  {/* "No payout yet | Explain eligibility" and "Payout pending | Show
                      dependency/reason" — the same stored reason drives both. */}
                  {isNotEligible ? (
                    <p className="mt-2 rounded-md bg-surface-muted p-2 text-xs text-[var(--color-text-secondary)]">
                      {p.ineligible_reason ?? 'Not eligible yet.'}
                    </p>
                  ) : (
                    <>
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                        <div>
                          <dt className="uppercase text-[var(--color-text-muted)]">Eligible basis</dt>
                          <dd className="text-primary">{p.basis_currency} {Number(p.basis_amount).toLocaleString('en-IN')}</dd>
                        </div>
                        <div>
                          <dt className="uppercase text-[var(--color-text-muted)]">ClearTrade fee</dt>
                          <dd className="text-primary">{p.fee_currency} {Number(p.fee_amount).toLocaleString('en-IN')}</dd>
                        </div>
                        <div>
                          <dt className="uppercase text-[var(--color-text-muted)]">Your share</dt>
                          <dd className="text-primary">{(Number(p.agent_share_rate) * 100).toFixed(1)}%</dd>
                        </div>
                        <div>
                          <dt className="uppercase text-[var(--color-text-muted)]">Amount</dt>
                          <dd className="font-semibold text-primary">{p.currency} {Number(p.amount).toLocaleString('en-IN')}</dd>
                        </div>
                      </dl>

                      <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
                        Snapshot: fee policy v{p.fee_policy_version}
                        {p.fee_rule ? ` · rule ${p.fee_rule.replace(/_/g, ' ')}` : ''}
                        {p.eligible_at ? ` · frozen ${fmt(p.eligible_at)}` : ''}
                      </p>

                      {/* Adjustments are shown NEXT TO the original, never folded into
                          it — the visible half of OPS-05-AC03. */}
                      {hasAdjustments ? (
                        <div className="mt-2 rounded-md bg-surface-muted p-2">
                          <p className="text-xs font-medium text-primary">Adjustments</p>
                          <ul className="mt-1 space-y-1">
                            {p.adjustments.map((a) => (
                              <li key={a.id} className="text-xs text-[var(--color-text-secondary)]">
                                {Number(a.amount) >= 0 ? '+' : ''}{Number(a.amount).toLocaleString('en-IN')} {a.currency} — {a.reason}
                                <span className="text-[var(--color-text-muted)]"> · {a.created_by.name}, {fmt(a.created_at)}</span>
                              </li>
                            ))}
                          </ul>
                          <p className="mt-1.5 text-xs text-primary">
                            Originally quoted {p.currency} {Number(p.amount).toLocaleString('en-IN')} ·{' '}
                            <span className="font-semibold">Net payable {net.currency} {Number(net.amount).toLocaleString('en-IN')}</span>
                          </p>
                        </div>
                      ) : null}

                      {p.state === PayoutState.paid ? (
                        <p className="mt-1.5 text-xs text-[var(--color-text-secondary)]">
                          Paid {fmt(p.paid_at)}{p.payment_reference ? ` · reference ${p.payment_reference}` : ''}
                        </p>
                      ) : null}

                      {/* "Disputed | Finance case link" */}
                      {p.state === PayoutState.disputed && p.dispute_id ? (
                        <p className="mt-1.5 text-xs">
                          <Link href={`/agent/deals/${p.deal_id}`} className="focus-visible-ring font-medium text-primary underline underline-offset-2">
                            Open the linked finance case on this deal
                          </Link>
                        </p>
                      ) : null}

                      {snapshot ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-[var(--color-text-secondary)]">Calculation breakdown</summary>
                          <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-surface-muted p-2 text-xs text-primary">
                            {JSON.stringify(snapshot, null, 2)}
                          </pre>
                        </details>
                      ) : null}

                      {p.state !== PayoutState.disputed ? (
                        <div className="mt-2">
                          <RaisePayoutQueryButton payoutId={p.id} />
                        </div>
                      ) : null}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
