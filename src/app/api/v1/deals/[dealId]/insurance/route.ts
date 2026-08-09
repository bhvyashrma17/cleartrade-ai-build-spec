/**
 * POST /api/v1/deals/:dealId/insurance — EXP-15 "Request insurance quote".
 *
 * "No policy" (no `InsuranceCase` row at all) and `not_started` are the same state as
 * far as this route is concerned — requesting a quote either creates the first row
 * directly at `quote_requested`, or transitions an existing `not_started`/`declined`
 * row forward through the guarded machine.
 */

import { InsuranceCaseStatus, PartnerStatus, PartnerType, TaskPriority, TaskState, UserRole, Visibility } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { assertInsuranceCaseTransition } from '@/lib/state-machines/payment';
import { scheduleFromThreshold } from '@/lib/state-machines/task';
import { requestInsuranceQuoteSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    assertCan(principal, 'payment.update');

    const body = await request.json().catch(() => null);
    const parsed = requestInsuranceQuoteSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const existing = await prisma.insuranceCase.findFirst({ where: { deal_id: dealId }, orderBy: { created_at: 'desc' } });
    if (existing && existing.status !== InsuranceCaseStatus.not_started && existing.status !== InsuranceCaseStatus.declined) {
      // Already in flight — return the existing case rather than erroring; requesting
      // twice is a no-op, not a failure.
      return NextResponse.json(single(existing), { headers: { 'x-correlation-id': correlationId } });
    }
    if (existing) assertInsuranceCaseTransition(existing.status, InsuranceCaseStatus.quote_requested);

    // "Handle partner unavailable": look for an active insurance partner, but do not
    // fail the request if none exists — the case is still opened, and the UI says so.
    const partner = await prisma.partner.findFirst({
      where: { type: PartnerType.insurance, partner_status: PartnerStatus.active },
    });

    const result = await prisma.$transaction(async (tx) => {
      const insuranceCase = existing
        ? await tx.insuranceCase.update({
            where: { id: existing.id },
            data: { status: InsuranceCaseStatus.quote_requested, notes: parsed.data.notes ?? existing.notes, quote_requested_at: new Date() },
          })
        : await tx.insuranceCase.create({
            data: {
              deal_id: dealId,
              status: InsuranceCaseStatus.quote_requested,
              notes: parsed.data.notes ?? null,
              quote_requested_at: new Date(),
            },
          });

      if (partner) {
        const thresholds = await getConfig('sla.thresholds');
        const schedule = scheduleFromThreshold(thresholds.default);
        await tx.task.create({
          data: {
            scope_type: 'deal',
            scope_id: dealId,
            deal_id: dealId,
            exporter_org_id: deal.exporter_org_id,
            title: 'Get an insurance quote from the partner',
            description: parsed.data.notes ?? 'Exporter requested an insurance quote.',
            owner_user_id: deal.owner_agent_id,
            owner_role: UserRole.agent,
            state: TaskState.not_started,
            priority: TaskPriority.normal,
            due_at: schedule.due_at,
            warning_at: schedule.warning_at,
            visibility: Visibility.exporter_visible,
            task_type: 'request_insurance_quote',
          },
        });
      }

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'insurance_case',
        object_id: insuranceCase.id,
        exporter_org_id: deal.exporter_org_id,
        after_summary: { deal_id: dealId, status: insuranceCase.status, partner_available: Boolean(partner) },
        correlation_id: correlationId,
      });

      return { insuranceCase, partnerAvailable: Boolean(partner) };
    });

    return NextResponse.json(
      single({ ...result.insuranceCase, partner_available: result.partnerAvailable }),
      { status: 201, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
