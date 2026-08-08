/**
 * POST /api/v1/market-assessments/:id/select — "Select target market" (docs/04 EXP-04).
 *
 * Exclusive at the ORG level, not just within a run: at most one MarketAssessment may be
 * `is_selected` per exporter org at a time, even across different discovery runs. That
 * exclusivity can't be expressed as a DB unique constraint (it isn't "unique per row",
 * it's "at most one true per org"), so it's enforced in this transaction instead.
 *
 * "Confirm if replacing the current active target" (docs/04 EXP-04) is a two-step
 * confirm, not a modal: the first call without `confirm_replace` returns the currently
 * selected market (if different) so the client can ask; the second call with
 * `confirm_replace: true` commits the swap.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan, tenantScopeVia } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { zodFieldErrors } from '@/lib/validators';

const bodySchema = z.object({ confirm_replace: z.boolean().optional() });

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ marketAssessmentId: string }> },
) {
  const correlationId = newCorrelationId();

  try {
    const principal = await requirePrincipal();
    assertCan(principal, 'market_assessment.save');

    const { marketAssessmentId } = await context.params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return errorResponse(validationError(zodFieldErrors(parsed.error)), correlationId);

    const scope = await tenantScopeVia(principal, 'run');
    const target = await prisma.marketAssessment.findFirst({
      where: { id: marketAssessmentId, ...scope },
      select: { id: true, is_selected: true, country_code: true, run: { select: { exporter_org_id: true } } },
    });
    if (!target) throw notFound('That market is not available.');

    if (target.is_selected) {
      // Already the active target — idempotent no-op, matches "Save market" semantics.
      return NextResponse.json(single({ id: target.id, selected: true, replaced: null }), {
        headers: { 'x-correlation-id': correlationId },
      });
    }

    const orgId = target.run.exporter_org_id;
    const current = await prisma.marketAssessment.findFirst({
      where: { is_selected: true, run: { exporter_org_id: orgId } },
      select: { id: true, country_code: true },
    });

    if (current && !parsed.data.confirm_replace) {
      // Ask, don't act. The route stays side-effect-free until the client confirms.
      throw validationError(
        [
          {
            field: 'confirm_replace',
            code: 'confirmation_required',
            message: `${current.country_code} is your current target market. Selecting ${target.country_code} replaces it.`,
          },
        ],
        'Confirm replacing your current target market.',
      );
    }

    await prisma.$transaction(async (tx) => {
      if (current) {
        await tx.marketAssessment.update({ where: { id: current.id }, data: { is_selected: false } });
      }
      await tx.marketAssessment.update({ where: { id: target.id }, data: { is_selected: true } });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.update,
        object_type: 'market_assessment',
        object_id: target.id,
        exporter_org_id: orgId,
        before_summary: current ? { previously_selected: current.id, country_code: current.country_code } : null,
        after_summary: { selected: target.id, country_code: target.country_code },
        correlation_id: correlationId,
      });
    });

    return NextResponse.json(
      single({ id: target.id, selected: true, replaced: current?.id ?? null }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
