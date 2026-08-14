/**
 * AGT-02 Exporter 360 — shared account loader.
 *
 * Both the SSR page and the JSON API route call this, so AC01 ("agent cannot reach an
 * unassigned exporter by URL manipulation") is enforced in exactly one place rather
 * than reimplemented twice and risking drift. `assertOrgAccess()` throws NOT_FOUND, not
 * FORBIDDEN — docs/09 §4: a 403 would itself confirm the org exists, which is the
 * leak AC01 exists to close.
 */

import { notFound } from '@/lib/errors';
import { assertOrgAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

export async function loadExporterAccountScoped(principal: Principal, exporterOrgId: string) {
  await assertOrgAccess(principal, exporterOrgId);

  const org = await prisma.exporterOrg.findUnique({
    where: { id: exporterOrgId },
    include: {
      assigned_agent: { select: { id: true, name: true } },
      products: { include: { certifications: true }, orderBy: { created_at: 'asc' } },
      readiness_assessments: { where: { is_current: true }, take: 1 },
    },
  });
  if (!org) throw notFound('That exporter account is not available.');

  return { principal, org };
}
