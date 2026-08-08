/**
 * EXP-01 Dashboard modules. Each is its own async server component: the query runs and
 * fails independently of the other five, per AC05. None of these throw — a query error
 * is caught internally and rendered as this module's own failure state, so it degrades
 * without taking the page down with it (docs/03 §7 "partial data: render available
 * sections; mark the unavailable module").
 */

import Link from 'next/link';
import { format, isPast } from 'date-fns';
import { TaskPriority, TaskState, type UserRole } from '@prisma/client';
import { JourneyProgress, MetricCard, NextActionCard, StatusChip, UpgradeNotice } from '@/components/ui';
import type { JourneyStageValue } from '@/components/ui';
import { EXPORTER_ROLES } from '@/lib/permissions';
import { deriveJourneyStage } from '@/lib/journey';
import { prisma } from '@/lib/prisma';
import type { Blocker } from '@/types';

type Tier = 'free' | 'paid';

function ModuleError({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-4">
      <StatusChip label={`${label} could not load`} tone="critical" icon="alert" size="sm" />
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
        Refresh the page to try again. The rest of this page is unaffected.
      </p>
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card ${className}`}>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Journey rail
// ---------------------------------------------------------------------------

/** Only segments with a real org-level destination are clickable — a future page (Deal,
 * Docs, Ship, Paid) or one with no single canonical URL yet must not link to a 404. */
function journeyHref(segmentKey: string): string | null {
  switch (segmentKey) {
    case 'readiness':
      return '/app/readiness';
    case 'market':
      return '/app/markets';
    case 'buyers':
      return '/app/buyers';
    default:
      return null; // deal/docs/ship/paid have no single org-level URL to deep-link to
  }
}

export async function JourneyModule({ orgId }: { orgId: string }) {
  try {
    const stage = await deriveJourneyStage(orgId);
    return (
      <Card>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          Your export journey
        </h2>
        <JourneyProgress currentStage={stage as JourneyStageValue} getHref={journeyHref} />
      </Card>
    );
  } catch (error) {
    console.error('[overview] JourneyModule failed:', error);
    return <ModuleError label="Journey" />;
  }
}

// ---------------------------------------------------------------------------
// Next actions — max 6, sorted blocked/urgent -> due time -> priority
// ---------------------------------------------------------------------------

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 3,
  high: 2,
  normal: 1,
  low: 0,
};

function isBlockedOrUrgent(task: { sla_state: string; blocked_reason: string | null }): boolean {
  return task.sla_state === 'overdue' || task.sla_state === 'escalated' || task.blocked_reason !== null;
}

/** Best-effort deep link: only two object pages exist today (docs/04 EXP-06, EXP-04). */
function taskHref(scopeType: string): string {
  if (scopeType === 'buyer_lead') return '/app/buyers';
  return '/app/markets';
}

export async function NextActionsModule({ orgId }: { orgId: string }) {
  try {
    const tasks = await prisma.task.findMany({
      where: {
        exporter_org_id: orgId,
        visibility: 'exporter_visible',
        state: { in: [TaskState.not_started, TaskState.in_progress, TaskState.waiting] },
        owner_role: { in: EXPORTER_ROLES as UserRole[] },
      },
      orderBy: [{ due_at: 'asc' }],
      take: 20, // sorted in memory below, then sliced to 6 — the priority/urgency rule isn't expressible as a single Prisma orderBy
    });

    const sorted = [...tasks]
      .sort((a, b) => {
        const aBlocked = isBlockedOrUrgent(a) ? 1 : 0;
        const bBlocked = isBlockedOrUrgent(b) ? 1 : 0;
        if (aBlocked !== bBlocked) return bBlocked - aBlocked;
        const aDue = a.due_at?.getTime() ?? Infinity;
        const bDue = b.due_at?.getTime() ?? Infinity;
        if (aDue !== bDue) return aDue - bDue;
        return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
      })
      .slice(0, 6);

    return (
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          Next actions
        </h2>
        {sorted.length === 0 ? (
          // docs/04 "New account" state: welcome + a real next step, not a fake empty
          // dashboard.
          <div className="rounded border border-dashed border-[var(--color-border-strong)] p-4 text-center">
            <p className="text-sm font-medium text-primary">Nothing waiting on you right now.</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Start by finding export markets for what you make.
            </p>
            <Link href="/app/markets" className="mt-3 inline-block text-sm font-semibold text-primary underline underline-offset-2">
              Find export markets
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map((task) => {
              const overdue = task.due_at ? isPast(task.due_at) : false;
              const blocker: Blocker | null = task.blocked_reason
                ? { object_type: 'task', object_id: task.id, reason: task.blocked_reason }
                : null;
              return (
                <NextActionCard
                  key={task.id}
                  title={task.title}
                  owner={EXPORTER_ROLES.includes(task.owner_role) ? 'You' : null}
                  dueAt={task.due_at}
                  urgency={
                    task.sla_state === 'escalated'
                      ? { label: 'Escalated', tone: 'critical', icon: 'alert' }
                      : task.sla_state === 'overdue' || overdue
                        ? { label: 'Overdue', tone: 'critical', icon: 'alert' }
                        : task.sla_state === 'due_soon'
                          ? { label: 'Due soon', tone: 'warning', icon: 'clock' }
                          : { label: 'On time', tone: 'neutral', icon: 'dot' }
                  }
                  blocker={blocker}
                  href={taskHref(task.scope_type)}
                />
              );
            })}
          </div>
        )}
      </Card>
    );
  } catch (error) {
    console.error('[overview] NextActionsModule failed:', error);
    return <ModuleError label="Next actions" />;
  }
}

// ---------------------------------------------------------------------------
// Health summary
// ---------------------------------------------------------------------------

const READINESS_LABEL: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  ready: 'Ready',
  blocked: 'Blocked',
};

export async function HealthSummaryModule({ orgId, tier }: { orgId: string; tier: Tier }) {
  try {
    const [org, currentAssessment, activeBuyerCount] = await Promise.all([
      prisma.exporterOrg.findUnique({ where: { id: orgId }, select: { readiness_status: true } }),
      prisma.readinessAssessment.findFirst({
        where: { exporter_org_id: orgId, is_current: true },
        select: { score: true },
      }),
      prisma.buyerLead.findMany({
        where: { exporter_org_id: orgId, stage: { not: 'disqualified' } },
        distinct: ['buyer_id'],
        select: { buyer_id: true },
      }),
    ]);

    // "open deal value" / "shipment & payment alerts" require deals, which is a paid
    // capability (market_assessment/buyer_lead are free-tier; deal.create is not) — free
    // tier structurally cannot have this data, so it's gated rather than shown as zero.
    const dealMetrics =
      tier === 'paid'
        ? await (async () => {
            const openDeals = await prisma.deal.findMany({
              where: { exporter_org_id: orgId, stage: { notIn: ['closed_won', 'closed_lost', 'cancelled'] } },
              select: { total_amount: true, total_currency: true },
            });
            const byCurrency = new Map<string, number>();
            for (const d of openDeals) {
              if (d.total_amount == null) continue;
              const cur = d.total_currency ?? 'INR';
              byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + Number(d.total_amount));
            }
            const alertCount = await prisma.deal.count({
              where: { exporter_org_id: orgId, risk_state: { not: 'normal' } },
            });
            return { openDeals, byCurrency, alertCount };
          })()
        : null;

    return (
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          Health summary
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="Readiness"
            value={currentAssessment?.score != null ? `${currentAssessment.score}/100` : READINESS_LABEL[org?.readiness_status ?? 'not_started']}
          />
          <MetricCard label="Active buyers" value={activeBuyerCount.length} secondaryText="In your pipeline" />
          {tier === 'paid' && dealMetrics ? (
            <>
              <MetricCard
                label="Open deal value"
                value={
                  dealMetrics.byCurrency.size === 0
                    ? '—'
                    : [...dealMetrics.byCurrency.entries()].map(([c, v]) => `${c} ${v.toLocaleString()}`).join(', ')
                }
                secondaryText={`${dealMetrics.openDeals.length} open deal${dealMetrics.openDeals.length === 1 ? '' : 's'}`}
              />
              <MetricCard
                label="Risk alerts"
                value={dealMetrics.alertCount}
                secondaryText="Shipment & payment"
                comparison={dealMetrics.alertCount > 0 ? { label: 'Needs attention', tone: 'critical' } : undefined}
              />
            </>
          ) : (
            <div className="col-span-2">
              <UpgradeNotice
                variant="inline"
                title="Deal value & shipment alerts"
                requiredTier="paid"
              />
            </div>
          )}
        </div>
      </Card>
    );
  } catch (error) {
    console.error('[overview] HealthSummaryModule failed:', error);
    return <ModuleError label="Health summary" />;
  }
}

// ---------------------------------------------------------------------------
// Deal pipeline (paid only — deal.create is a paid capability)
// ---------------------------------------------------------------------------

export async function DealPipelineModule({ orgId, tier }: { orgId: string; tier: Tier }) {
  if (tier !== 'paid') {
    return (
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          Deal pipeline
        </h2>
        <UpgradeNotice
          title="See your deal pipeline"
          description="Deals, negotiation and execution tracking are part of the agent-assisted paid plan."
          requiredTier="paid"
        />
      </Card>
    );
  }

  try {
    const [contacted, interested, negotiating, dealLocked, executing] = await Promise.all([
      prisma.buyerLead.count({ where: { exporter_org_id: orgId, stage: 'contacted' } }),
      prisma.buyerLead.count({ where: { exporter_org_id: orgId, stage: 'interested' } }),
      prisma.deal.count({ where: { exporter_org_id: orgId, stage: 'negotiating' } }),
      prisma.deal.count({ where: { exporter_org_id: orgId, stage: 'deal_locked' } }),
      prisma.deal.count({ where: { exporter_org_id: orgId, stage: 'executing' } }),
    ]);
    const total = contacted + interested + negotiating + dealLocked + executing;

    return (
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          Deal pipeline
        </h2>
        {total === 0 ? (
          // docs/04 "Active, no deal": emphasize discovery/buyer actions, not a wall of zeros.
          <div className="rounded border border-dashed border-[var(--color-border-strong)] p-4 text-center">
            <p className="text-sm text-[var(--color-text-secondary)]">No deals in motion yet.</p>
            <Link href="/app/buyers" className="mt-2 inline-block text-sm font-semibold text-primary underline underline-offset-2">
              Find buyers to reach out to
            </Link>
          </div>
        ) : (
          <dl className="grid grid-cols-5 gap-2 text-center text-xs">
            {[
              ['Contacted', contacted],
              ['Interested', interested],
              ['Negotiating', negotiating],
              ['Deal locked', dealLocked],
              ['Executing', executing],
            ].map(([label, count]) => (
              <div key={label as string}>
                <dt className="text-[var(--color-text-secondary)]">{label}</dt>
                <dd className="mt-1 text-lg font-bold text-primary">{count}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    );
  } catch (error) {
    console.error('[overview] DealPipelineModule failed:', error);
    return <ModuleError label="Deal pipeline" />;
  }
}

// ---------------------------------------------------------------------------
// Assigned agent (paid only — agent assignment is a paid capability)
// ---------------------------------------------------------------------------

export async function AssignedAgentModule({ orgId, tier }: { orgId: string; tier: Tier }) {
  if (tier !== 'paid') {
    return (
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          Your agent
        </h2>
        <UpgradeNotice
          title="Get a dedicated agent"
          description="Paid plans are paired with a ClearTrade agent who handles negotiation, documents and shipping for you."
          requiredTier="paid"
        />
      </Card>
    );
  }

  try {
    const assignment = await prisma.agentAssignment.findFirst({
      where: { exporter_org_id: orgId, status: 'active' },
      orderBy: { started_at: 'desc' },
      select: { agent: { select: { name: true, email: true } } },
    });

    return (
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          Your agent
        </h2>
        {assignment ? (
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold text-primary">
              {assignment.agent.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <p className="text-sm font-medium text-primary">{assignment.agent.name}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">{assignment.agent.email}</p>
            </div>
          </div>
        ) : (
          // Real state, not fabricated: no assignment row exists yet. No invented
          // response-time promise — there is no data backing one.
          <p className="text-sm text-[var(--color-text-secondary)]">
            No agent assigned yet. Ops assigns one shortly after you upgrade.
          </p>
        )}
      </Card>
    );
  } catch (error) {
    console.error('[overview] AssignedAgentModule failed:', error);
    return <ModuleError label="Your agent" />;
  }
}

// ---------------------------------------------------------------------------
// Risk / exception banner — renders nothing when nothing is wrong
// ---------------------------------------------------------------------------

export async function RiskBannerModule({ orgId }: { orgId: string }) {
  try {
    const [riskyDeal, org] = await Promise.all([
      prisma.deal.findFirst({
        where: { exporter_org_id: orgId, risk_state: { in: ['at_risk', 'blocked'] } },
        orderBy: { updated_at: 'desc' },
        select: { id: true, risk_state: true, risk_reason: true },
      }),
      prisma.exporterOrg.findUnique({ where: { id: orgId }, select: { readiness_status: true } }),
    ]);

    if (!riskyDeal && org?.readiness_status !== 'blocked') return null; // nothing wrong — no banner

    const reason = riskyDeal?.risk_reason ?? 'Your readiness assessment has an unresolved blocker.';
    return (
      <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-critical)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-4">
        <div className="flex items-start gap-3">
          <StatusChip label={riskyDeal ? 'Deal at risk' : 'Readiness blocked'} tone="critical" icon="alert" size="sm" />
          <div className="flex-1">
            <p className="text-sm text-primary">{reason}</p>
            <Link
              href={riskyDeal ? '/app/deals' : '/app/markets'}
              className="mt-1 inline-block text-sm font-semibold text-primary underline underline-offset-2"
            >
              {riskyDeal ? 'View deals' : 'Review'}
            </Link>
          </div>
        </div>
      </div>
    );
  } catch (error) {
    console.error('[overview] RiskBannerModule failed:', error);
    // A hidden risk-check failure is worse than a visible one — silently returning null
    // here could mask a real blocker, so this module is the one exception that surfaces
    // its failure even though the "success" case is to render nothing.
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-surface p-3">
        <StatusChip label="Could not check for risk alerts" tone="warning" icon="alert" size="sm" />
      </div>
    );
  }
}
