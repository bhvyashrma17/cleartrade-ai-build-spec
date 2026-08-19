/**
 * POST/DELETE /api/v1/ops/agent-assignments — assign and unassign exporters.
 *
 * Assignment is what grants an agent access to a tenant, so authorization lives in
 * `assertCanProvisionStaff` (Ops only) inside the service, alongside the audit write. An agent
 * calling this endpoint is refused there — self-assignment would let any agent reach every
 * tenant, which is the boundary AgentAssignment exists to draw.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assignExporterToAgent, reassignExporterToAgent, unassignExporterFromAgent } from '@/lib/staff-provisioning';
import { zodFieldErrors } from '@/lib/validators';

const assignSchema = z.object({
  agent_user_id: z.string().min(1),
  exporter_org_id: z.string().min(1),
  reason: z.string().trim().max(500).nullish(),
});

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const body = await request.json().catch(() => null);
    const parsed = assignSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const assignment = await assignExporterToAgent({
      actor: principal,
      agentUserId: parsed.data.agent_user_id,
      exporterOrgId: parsed.data.exporter_org_id,
      reason: parsed.data.reason ?? null,
      correlationId,
    });
    return NextResponse.json(single(assignment), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

const unassignSchema = z.object({
  assignment_id: z.string().min(1),
  reason: z.string().trim().max(500).nullish(),
});

export async function DELETE(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const body = await request.json().catch(() => null);
    const parsed = unassignSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const ended = await unassignExporterFromAgent({
      actor: principal,
      assignmentId: parsed.data.assignment_id,
      reason: parsed.data.reason ?? null,
      correlationId,
    });
    return NextResponse.json(single(ended), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

const reassignSchema = z.object({
  assignment_id: z.string().min(1),
  new_agent_user_id: z.string().min(1),
  reason: z.string().trim().max(500).nullish(),
});

/**
 * Move one exporter to a different agent in one transactional step — the old assignment ends
 * and the new one starts together, so there is no request boundary between them where the
 * exporter would have no active agent at all.
 */
export async function PATCH(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const body = await request.json().catch(() => null);
    const parsed = reassignSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const result = await reassignExporterToAgent({
      actor: principal,
      assignmentId: parsed.data.assignment_id,
      newAgentUserId: parsed.data.new_agent_user_id,
      reason: parsed.data.reason ?? null,
      correlationId,
    });
    return NextResponse.json(single(result), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
