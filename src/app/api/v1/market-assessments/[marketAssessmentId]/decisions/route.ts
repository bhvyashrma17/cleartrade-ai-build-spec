/**
 * POST /api/v1/market-assessments/:assessmentId/decisions — record an agent decision about a
 * market, and GET the decision history for one.
 *
 * This route is deliberately thin. Every rule that matters — who may decide (assigned agent or
 * Ops), which actions are valid for a market, whether a reason is present, which decision is
 * superseded, and the frozen copy of the model's score/rank at decision time — lives in
 * `recordAgentDecision`, enforced again by database constraints and triggers. Re-checking any
 * of it here would create a second, drifting copy of the rules; the route's only jobs are to
 * parse the request and to map thrown ApiErrors onto responses.
 *
 * There is no PATCH and no DELETE, and there will not be: AgentDecision is append-only, and a
 * change of mind is a new POST that supersedes the previous decision.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { AgentDecisionAction, AgentDecisionTarget } from '@prisma/client';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { ACTIONS_BY_TARGET, assertCanRecordAgentDecision, marketDecisionView, recordAgentDecision } from '@/lib/agent-decisions';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { zodFieldErrors } from '@/lib/validators';

/** Only the actions the service permits for a market — the enum is filtered, not retyped. */
const MARKET_ACTIONS = ACTIONS_BY_TARGET[AgentDecisionTarget.market] as readonly AgentDecisionAction[];

const decisionSchema = z.object({
  action: z.enum(Object.values(AgentDecisionAction) as [string, ...string[]])
    .refine((value) => MARKET_ACTIONS.includes(value as AgentDecisionAction), {
      message: 'That action does not apply to a market decision.',
    }),
  // Mandatory in substance: the service and a CHECK constraint both reject whitespace, and
  // failing here first means the caller gets a field error rather than a constraint violation.
  reason: z.string().trim().min(1, 'A reason is required for every agent decision.').max(2000),
  agent_priority: z.coerce.number().int().min(1).max(9999).nullable().optional(),
  expires_at: z.coerce.date().nullable().optional(),
});

export async function POST(request: NextRequest, ctx: { params: Promise<{ marketAssessmentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { marketAssessmentId: assessmentId } = await ctx.params;

    const body = await request.json().catch(() => null);
    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const decision = await recordAgentDecision({
      actor: principal,
      target: AgentDecisionTarget.market,
      subjectId: assessmentId,
      action: parsed.data.action as AgentDecisionAction,
      reason: parsed.data.reason,
      agentPriority: parsed.data.agent_priority ?? null,
      expiresAt: parsed.data.expires_at ?? null,
      correlationId,
    });

    return NextResponse.json(single(decision), {
      status: 201,
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

/** The AI recommendation and the full decision history, unmerged. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ marketAssessmentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { marketAssessmentId: assessmentId } = await ctx.params;

    // Authorize BEFORE reading: the read model is shared with server components that guard
    // upstream, so it does not authorize on its own, and returning a view first would leak
    // another tenant's assessment to anyone who could guess an id.
    await assertCanRecordAgentDecision(principal, await marketOrgId(assessmentId));
    const view = await marketDecisionView(assessmentId);

    return NextResponse.json(single(view), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

async function marketOrgId(assessmentId: string): Promise<string> {
  const assessment = await prisma.marketAssessment.findUnique({
    where: { id: assessmentId },
    select: { run: { select: { exporter_org_id: true } } },
  });
  if (!assessment) throw notFound('Market assessment not found.');
  return assessment.run.exporter_org_id;
}
