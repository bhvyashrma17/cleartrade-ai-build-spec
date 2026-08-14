/**
 * AGT-08 agent performance metrics — computed server-side, in one place.
 *
 * AGT-08-AC03 ("performance metrics define time window and denominator") is enforced by
 * the TYPE, not by remembering to write a caption: every metric returned from here is an
 * `AgentMetric`, and `AgentMetric` cannot be constructed without a `window` and, for any
 * rate, a `denominator` naming what was counted. A rate with an ambiguous base is
 * unrepresentable rather than merely discouraged.
 *
 * Two further rules from docs/05, both structural:
 *
 *   - **No single composite score.** There is no `overallScore` field and no weighting
 *     anywhere in this file. The Blueprint's nine metrics are returned as nine
 *     independent values because collapsing them is the "vanity leaderboard" the spec
 *     explicitly rules out.
 *   - **Sufficient-sample-size caveats.** A rate computed over a denominator below
 *     `MIN_SAMPLE` is returned with `low_sample: true` so the UI can say so instead of
 *     presenting "100% conversion" off a single deal as if it were a track record.
 *
 * Computed here rather than in the page so the numbers can never be derived
 * client-side from a partial fetch — the brief's explicit requirement.
 */

import { BuyerLeadStage, DealStage, DisputeStatus, RiskState, SlaState, TaskState } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** Below this denominator, a rate is reported but flagged as statistically thin. */
export const MIN_SAMPLE = 5;

export interface AgentMetric {
  key: string;
  label: string;
  /** What the number means operationally — the Blueprint's "Use" column. */
  use: string;
  /** Formatted value, already rendered (e.g. "42%", "12", "8.4 days", "—"). */
  value: string;
  /** REQUIRED: the period this was computed over. */
  window: string;
  /**
   * REQUIRED for any rate: what the denominator actually counts. Null only for a raw
   * count, where a denominator would be meaningless rather than merely absent.
   */
  denominator: string | null;
  /** True when the denominator is under MIN_SAMPLE — the UI must caveat it. */
  low_sample: boolean;
}

export interface AgentMetrics {
  window_label: string;
  window_days: number;
  workload: {
    assigned_exporters: number;
    active_leads: number;
    active_deals: number;
    overdue_tasks: number;
  };
  performance: AgentMetric[];
  quality: AgentMetric[];
}

/** Format a rate, or an explicit em-dash when there is nothing to divide by. */
function rate(numerator: number, denominator: number): string {
  if (denominator === 0) return '—';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

const ACTIVE_LEAD_STAGES: BuyerLeadStage[] = [
  BuyerLeadStage.new,
  BuyerLeadStage.shortlisted,
  BuyerLeadStage.contacted,
  BuyerLeadStage.replied,
  BuyerLeadStage.interested,
  BuyerLeadStage.negotiation,
];

const ACTIVE_DEAL_STAGES: DealStage[] = [
  DealStage.qualifying,
  DealStage.negotiating,
  DealStage.terms_agreed,
  DealStage.deal_locked,
  DealStage.executing,
];

export async function computeAgentMetrics(agentUserId: string, windowDays = 90): Promise<AgentMetrics> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const windowLabel = `last ${windowDays} days`;
  const allTime = 'all time';

  const assignments = await prisma.agentAssignment.findMany({
    where: { agent_user_id: agentUserId, status: 'active' },
    select: { exporter_org_id: true },
  });
  const orgIds = assignments.map((a) => a.exporter_org_id);

  const [
    activeLeads,
    activeDeals,
    overdueTasks,
    leadsInWindow,
    dealsInWindow,
    closedWonDeals,
    firstResponseTasks,
    recoveredDeals,
    stillBlockedDeals,
    shipments,
    disputes,
    repeatExporters,
    eligibleValue,
  ] = await Promise.all([
    prisma.buyerLead.count({ where: { exporter_org_id: { in: orgIds }, stage: { in: ACTIVE_LEAD_STAGES } } }),
    prisma.deal.count({ where: { exporter_org_id: { in: orgIds }, stage: { in: ACTIVE_DEAL_STAGES } } }),
    prisma.task.count({
      where: {
        owner_user_id: agentUserId,
        state: { notIn: [TaskState.done, TaskState.cancelled] },
        sla_state: { in: [SlaState.overdue, SlaState.escalated] },
      },
    }),
    // Denominator for the outreach funnel: leads this agent's book CONTACTED in-window.
    prisma.buyerLead.findMany({
      where: { exporter_org_id: { in: orgIds }, last_contact_at: { gte: since } },
      select: { stage: true },
    }),
    prisma.deal.findMany({
      where: { exporter_org_id: { in: orgIds }, created_at: { gte: since } },
      select: { stage: true },
    }),
    prisma.deal.findMany({
      where: { exporter_org_id: { in: orgIds }, stage: DealStage.closed_won, updated_at: { gte: since } },
      select: { created_at: true, updated_at: true },
    }),
    // First-response SLA: agent-owned outreach tasks that reached a terminal state
    // in-window, split by whether they breached.
    prisma.task.findMany({
      where: {
        owner_user_id: agentUserId,
        updated_at: { gte: since },
        state: { in: [TaskState.done, TaskState.cancelled] },
      },
      select: { sla_state: true },
    }),
    prisma.deal.count({
      where: { exporter_org_id: { in: orgIds }, risk_state: RiskState.normal, updated_at: { gte: since }, disputes: { some: {} } },
    }),
    prisma.deal.count({ where: { exporter_org_id: { in: orgIds }, risk_state: RiskState.blocked } }),
    prisma.shipment.findMany({
      where: { deal: { exporter_org_id: { in: orgIds } }, updated_at: { gte: since } },
      select: { status: true, exception_state: true },
    }),
    prisma.dispute.findMany({
      where: { deal: { exporter_org_id: { in: orgIds } }, created_at: { gte: since } },
      select: { status: true },
    }),
    prisma.deal.groupBy({
      by: ['exporter_org_id'],
      where: { exporter_org_id: { in: orgIds }, stage: DealStage.closed_won },
      _count: true,
    }),
    prisma.payout.aggregate({
      where: { agent_user_id: agentUserId, state: { in: ['eligible', 'approved', 'paid'] } },
      _sum: { basis_amount: true },
    }),
  ]);

  // ---- Performance ------------------------------------------------------
  const contactedCount = leadsInWindow.length;
  const qualifiedCount = leadsInWindow.filter((l) =>
    ([BuyerLeadStage.interested, BuyerLeadStage.negotiation, BuyerLeadStage.converted] as BuyerLeadStage[]).includes(l.stage),
  ).length;
  const convertedCount = leadsInWindow.filter((l) => l.stage === BuyerLeadStage.converted).length;

  const cycleTimes = closedWonDeals.map((d) => (d.updated_at.getTime() - d.created_at.getTime()) / 86_400_000);
  const avgCycle = cycleTimes.length > 0 ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : null;

  const repeatCount = repeatExporters.filter((r) => r._count > 1).length;

  const performance: AgentMetric[] = [
    {
      key: 'qualified_buyer_rate',
      label: 'Qualified buyer rate',
      use: 'Outreach quality',
      value: rate(qualifiedCount, contactedCount),
      window: windowLabel,
      denominator: `${contactedCount} lead(s) contacted in window`,
      low_sample: contactedCount > 0 && contactedCount < MIN_SAMPLE,
    },
    {
      key: 'deal_conversion',
      label: 'Deal conversion',
      use: 'Commercial effectiveness',
      value: rate(convertedCount, contactedCount),
      window: windowLabel,
      denominator: `${contactedCount} lead(s) contacted in window`,
      low_sample: contactedCount > 0 && contactedCount < MIN_SAMPLE,
    },
    {
      key: 'deal_cycle_time',
      label: 'Deal cycle time',
      use: 'Speed without gaming volume',
      value: avgCycle === null ? '—' : `${avgCycle.toFixed(1)} days`,
      window: windowLabel,
      denominator: `${closedWonDeals.length} deal(s) closed-won in window`,
      low_sample: closedWonDeals.length > 0 && closedWonDeals.length < MIN_SAMPLE,
    },
    {
      key: 'repeat_exporters',
      label: 'Repeat exporters',
      use: 'Relationship quality',
      value: String(repeatCount),
      window: allTime,
      denominator: `${repeatExporters.length} exporter(s) with at least one closed-won deal`,
      low_sample: false,
    },
    {
      key: 'success_fee_eligible_value',
      label: 'Success-fee eligible value',
      use: 'Payout basis and auditability',
      value: eligibleValue._sum.basis_amount ? Number(eligibleValue._sum.basis_amount).toLocaleString('en-IN') : '0',
      window: allTime,
      denominator: null,
      low_sample: false,
    },
  ];

  // ---- Quality ----------------------------------------------------------
  const slaTotal = firstResponseTasks.length;
  const slaMet = firstResponseTasks.filter((t) => t.sla_state === SlaState.on_time || t.sla_state === SlaState.due_soon).length;

  const shipmentsTotal = shipments.length;
  const shipmentsClean = shipments.filter((s) => s.exception_state === 'none').length;

  const disputeOpenCount = disputes.filter((d) =>
    ([DisputeStatus.open, DisputeStatus.investigating, DisputeStatus.waiting_external, DisputeStatus.proposed_resolution] as DisputeStatus[]).includes(d.status),
  ).length;

  const quality: AgentMetric[] = [
    {
      key: 'first_response_sla',
      label: 'First-response SLA compliance',
      use: 'Service quality',
      value: rate(slaMet, slaTotal),
      window: windowLabel,
      denominator: `${slaTotal} task(s) completed in window`,
      low_sample: slaTotal > 0 && slaTotal < MIN_SAMPLE,
    },
    {
      key: 'shipment_success',
      label: 'Shipment success rate',
      use: 'Execution quality',
      value: rate(shipmentsClean, shipmentsTotal),
      window: windowLabel,
      denominator: `${shipmentsTotal} shipment(s) active in window`,
      low_sample: shipmentsTotal > 0 && shipmentsTotal < MIN_SAMPLE,
    },
    {
      key: 'dispute_rate',
      label: 'Disputes / escalations',
      use: 'Execution quality',
      value: `${disputes.length} raised · ${disputeOpenCount} open`,
      window: windowLabel,
      denominator: `${dealsInWindow.length} deal(s) created in window`,
      low_sample: dealsInWindow.length > 0 && dealsInWindow.length < MIN_SAMPLE,
    },
    {
      key: 'blocked_deal_recovery',
      label: 'Blocked-deal recovery',
      use: 'Operational problem solving',
      value: `${recoveredDeals} recovered · ${stillBlockedDeals} still blocked`,
      window: windowLabel,
      denominator: `${recoveredDeals + stillBlockedDeals} deal(s) that hit a dispute or block`,
      low_sample: recoveredDeals + stillBlockedDeals > 0 && recoveredDeals + stillBlockedDeals < MIN_SAMPLE,
    },
    {
      key: 'exporter_satisfaction',
      label: 'Exporter satisfaction',
      use: 'Relationship quality',
      // The Blueprint lists this metric; nothing in the product collects a satisfaction
      // signal yet. Showing a proxy (message volume, deal count) dressed up as
      // satisfaction would be exactly the fabricated metric docs/00 forbids, so it
      // reports honestly as not-yet-measured.
      value: 'Not measured yet',
      window: '—',
      denominator: 'No satisfaction signal is collected in the product today',
      low_sample: false,
    },
  ];

  return {
    window_label: windowLabel,
    window_days: windowDays,
    workload: {
      assigned_exporters: orgIds.length,
      active_leads: activeLeads,
      active_deals: activeDeals,
      overdue_tasks: overdueTasks,
    },
    performance,
    quality,
  };
}
