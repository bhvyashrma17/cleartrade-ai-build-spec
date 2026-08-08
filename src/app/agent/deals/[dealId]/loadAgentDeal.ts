/**
 * Agent-side deal loader. Same shared object as `/app/deals/:dealId`, different
 * permissions and density (docs/12 §B: "the same deal rendered with different
 * permissions — not two different records").
 *
 * Scope comes from `canReadDeal()`, which for an agent resolves to their assigned orgs.
 * An out-of-scope id renders `notFound()` rather than 403, so a guessed id cannot
 * confirm another agent's deal exists.
 */

import { notFound } from 'next/navigation';
import { requirePortalAccess } from '@/lib/auth';
import { canReadDeal } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export async function loadAgentDeal(dealId: string) {
  const principal = await requirePortalAccess('/agent');

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      buyer: { select: { display_name: true, legal_name: true, country_code: true, verification_status: true, risk_flags: true } },
      product: { select: { name: true } },
      owner_agent: { select: { name: true } },
      exporter_org: { select: { id: true, display_name: true, iec: true } },
    },
  });
  if (!deal) notFound();
  if (!(await canReadDeal(principal, deal))) notFound();

  return { principal, deal };
}

export type AgentDeal = Awaited<ReturnType<typeof loadAgentDeal>>['deal'];
