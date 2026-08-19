/**
 * PATCH /api/v1/ops/agents/[agentId] — deactivate or reactivate one agent.
 *
 * The two are the only lifecycle transitions this route exposes. There is deliberately no
 * DELETE here: an agent is never hard-removed while any row (AgentDecision, AgentAssignment
 * history, audit events) still references them — `deactivateAgent` is the safe substitute, and
 * it refuses while active assignments remain rather than silently detaching them.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { deactivateAgent, reactivateAgent } from '@/lib/staff-provisioning';
import { zodFieldErrors } from '@/lib/validators';

const patchSchema = z.object({
  action: z.enum(['deactivate', 'reactivate']),
  reason: z.string().trim().max(500).nullish(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { agentId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const result = parsed.data.action === 'deactivate'
      ? await deactivateAgent({ actor: principal, agentUserId: agentId, reason: parsed.data.reason ?? null, correlationId })
      : await reactivateAgent({ actor: principal, agentUserId: agentId, correlationId });

    return NextResponse.json(single(result), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
