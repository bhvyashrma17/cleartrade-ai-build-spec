/**
 * AGT-04 Lead / Buyer Workspace — shared lead loader.
 *
 * Mirrors `loadExporterAccountScoped()`: one access-control decision, reused by every
 * route that acts on a lead, so an out-of-tenant lead id 404s consistently everywhere
 * rather than in some routes and 403s in others.
 */

import { notFound } from '@/lib/errors';
import { canReadBuyerLead } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

export async function loadLeadScoped(principal: Principal, buyerLeadId: string) {
  const lead = await prisma.buyerLead.findUnique({
    where: { id: buyerLeadId },
    select: { id: true, exporter_org_id: true, assigned_agent_id: true, stage: true, product_id: true, buyer_id: true, deal_id: true },
  });
  if (!lead) throw notFound('That lead is not available.');
  if (!(await canReadBuyerLead(principal, lead))) throw notFound('That lead is not available.');
  return lead;
}
