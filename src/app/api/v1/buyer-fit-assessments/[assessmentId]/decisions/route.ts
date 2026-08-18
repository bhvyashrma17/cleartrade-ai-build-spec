/**
 * POST /api/v1/buyer-fit-assessments/:assessmentId/decisions — record an agent decision about a
 * buyer, together with any canonical state change it implies.
 *
 * Thin by design. Authorization, action validity, the mandatory reason, the immutable
 * decision-time snapshot, the canonical transition and its atomicity all live in
 * `runBuyerCommand` and the database constraints beneath it. This route parses the request and
 * maps thrown ApiErrors onto responses; it performs NO Prisma writes of its own, so there is no
 * path by which canonical state and the decision layer could be written separately.
 *
 * No PATCH and no DELETE: AgentDecision is append-only, and a change of mind is a new POST that
 * supersedes the previous decision.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { AgentDecisionAction, AgentDecisionTarget, DisqualificationReason } from '@prisma/client';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { ACTIONS_BY_TARGET } from '@/lib/agent-decisions';
import { runBuyerCommand } from '@/lib/buyer-commands';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { zodFieldErrors } from '@/lib/validators';

/** Filtered from the service's own map, not retyped — one source for which actions are legal. */
const BUYER_ACTIONS = ACTIONS_BY_TARGET[AgentDecisionTarget.buyer] as readonly AgentDecisionAction[];

const decisionSchema = z.object({
  action: z.enum(Object.values(AgentDecisionAction) as [string, ...string[]])
    .refine((v) => BUYER_ACTIONS.includes(v as AgentDecisionAction), {
      message: 'That action does not apply to a buyer decision.',
    }),
  reason: z.string().trim().min(1, 'A reason is required for every agent decision.').max(2000),
  agent_priority: z.coerce.number().int().min(1).max(9999).nullable().optional(),
  expires_at: z.coerce.date().nullable().optional(),
  /** Required by the service when disqualifying; validated there, shaped here. */
  disqualification_reason: z.enum(Object.values(DisqualificationReason) as [string, ...string[]]).nullable().optional(),
});

export async function POST(request: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { assessmentId } = await ctx.params;

    const body = await request.json().catch(() => null);
    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const result = await runBuyerCommand(parsed.data.action as AgentDecisionAction, {
      actor: principal,
      subjectId: assessmentId,
      reason: parsed.data.reason,
      agentPriority: parsed.data.agent_priority ?? null,
      expiresAt: parsed.data.expires_at ?? null,
      disqualificationReason: (parsed.data.disqualification_reason as DisqualificationReason | null) ?? null,
      correlationId,
    });

    // The canonical effect is reported back so the client can describe what actually changed
    // rather than assuming — for a decision-only action it is null, and saying so is the point.
    return NextResponse.json(single(result), {
      status: 201,
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
