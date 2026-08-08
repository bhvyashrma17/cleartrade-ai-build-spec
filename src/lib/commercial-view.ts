/**
 * Read model shared by EXP-10 (exporter) and AGT-05 (agent).
 *
 * Both screens render the same proposal history and the same version diff — the
 * difference is what each may *do* with it, not what the negotiation actually is. One
 * loader keeps them from drifting into two different opinions about which version is
 * current (EXP-09-AC01: "all deal tabs render the same deal ID and role-scoped shared
 * objects").
 */

import { ProposalStatus } from '@prisma/client';
import { diffProposals, type ProposalFieldDiff } from '@/lib/commercial';
import { prisma } from '@/lib/prisma';

export interface ProposalView {
  id: string;
  version: number;
  status: ProposalStatus;
  proposedBy: string | null;
  proposedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  changesRequestedBy: string | null;
  changesRequestedAt: Date | null;
  changesRequestedNote: string | null;
  agentNote: string | null;
  buyerStatus: string | null;
  buyerStatusNote: string | null;
}

export interface CommercialView {
  dealVersion: number;
  /** The version the exporter is being asked to act on, if any. */
  awaiting: ProposalView | null;
  /** The most recent version overall — what the agent is working with. */
  latest: ProposalView | null;
  /** The accepted version, if terms have been agreed. */
  approved: ProposalView | null;
  /** `latest` diffed against the version before it. */
  diff: ProposalFieldDiff[];
  /** Full history, newest first (AGT-05-AC04). */
  history: ProposalView[];
  isLocked: boolean;
}

function toView(row: {
  id: string;
  version: number;
  status: ProposalStatus;
  proposed_at: Date | null;
  approved_at: Date | null;
  changes_requested_at: Date | null;
  changes_requested_note: string | null;
  agent_note: string | null;
  buyer_status: string | null;
  buyer_status_note: string | null;
  proposed_by: { name: string } | null;
  approved_by: { name: string } | null;
  changes_requested_by: { name: string } | null;
}): ProposalView {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    proposedBy: row.proposed_by?.name ?? null,
    proposedAt: row.proposed_at,
    approvedBy: row.approved_by?.name ?? null,
    approvedAt: row.approved_at,
    changesRequestedBy: row.changes_requested_by?.name ?? null,
    changesRequestedAt: row.changes_requested_at,
    changesRequestedNote: row.changes_requested_note,
    agentNote: row.agent_note,
    buyerStatus: row.buyer_status,
    buyerStatusNote: row.buyer_status_note,
  };
}

export async function loadCommercialView(dealId: string): Promise<CommercialView> {
  const [deal, rows] = await Promise.all([
    prisma.deal.findUniqueOrThrow({ where: { id: dealId }, select: { version: true, locked_at: true, stage: true } }),
    prisma.dealProposal.findMany({
      where: { deal_id: dealId },
      orderBy: { version: 'desc' },
      include: {
        proposed_by: { select: { name: true } },
        approved_by: { select: { name: true } },
        changes_requested_by: { select: { name: true } },
      },
    }),
  ]);

  const latestRow = rows[0] ?? null;
  const previousRow = rows[1] ?? null;
  const awaitingRow = rows.find((r) => r.status === ProposalStatus.awaiting_exporter) ?? null;
  const approvedRow = rows.find((r) => r.status === ProposalStatus.approved) ?? null;

  return {
    dealVersion: deal.version,
    awaiting: awaitingRow ? toView(awaitingRow) : null,
    latest: latestRow ? toView(latestRow) : null,
    approved: approvedRow ? toView(approvedRow) : null,
    diff: latestRow ? diffProposals(latestRow, previousRow) : [],
    history: rows.map(toView),
    isLocked: Boolean(deal.locked_at),
  };
}
