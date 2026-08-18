/**
 * POST /api/v1/deals/:dealId/documents/:documentId/review — the agent's review decision.
 *
 * Distinct from approval, and deliberately so. ClearTrade separates duties: an agent reviews
 * (`review_status`), the exporter approves (`approval_status`), and `document.approve` is
 * `agent: 'none'` in the permission matrix with the note "Cannot impersonate exporter — hard
 * no, not a policy toggle". This route fills in the agent half, which the enums declared and
 * nothing implemented; it cannot set an approval status.
 *
 * Thin: the state transition, the internal note and the audit event are all in
 * `agentReviewDocument`.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { agentReviewDocument } from '@/lib/document-lifecycle';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { zodFieldErrors } from '@/lib/validators';

const reviewSchema = z.object({
  outcome: z.enum(['reviewed', 'changes_needed']),
  /** Internal, agent-only. Never printed on a generated document. */
  note: z.string().trim().max(2000).optional(),
});

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string; documentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, documentId } = await ctx.params;

    const body = await request.json().catch(() => null);
    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const document = await agentReviewDocument({
      actor: principal, dealId, documentId,
      outcome: parsed.data.outcome, note: parsed.data.note, correlationId,
    });

    return NextResponse.json(
      single({ id: document.id, version: document.version, review_status: document.review_status, reviewed_at: document.reviewed_at }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
